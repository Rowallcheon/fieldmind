-- ============================================================
-- 원본 자료실 4/4: 폴더(분류) 이동 (끌어서 놓기용)
-- 기준: docs/원본자료실_설계서.md '폴더·자료 이동' 결정
-- 여러 번 실행해도 안전합니다. 운영 DB 변경이므로 적용 전에 확인합니다.
--
-- 1) 단계 검증 트리거: 이동 함수가 실행 중일 때만 '하위가 있는 분류의 단계 변경 금지' 검사를 건너뜀
-- 2) library_move_category(분류, 새 상위, 공개 범위 유지 여부): 위치·단계·공개 범위 고정을 한 번에(원자적으로) 처리
-- ============================================================

create or replace function public.library_categories_check_hierarchy()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  p_level smallint;
begin
  if new.parent_id is not null then
    select level into p_level from public.library_categories where id = new.parent_id;
    if p_level is null then
      raise exception '상위 분류를 찾을 수 없습니다.';
    end if;
    if new.level <> p_level + 1 then
      raise exception '분류 단계는 상위 분류보다 한 단계 아래여야 합니다. (최대 3단계)';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.level <> old.level
     and coalesce(current_setting('library.moving', true), '') <> '1'
     and exists (select 1 from public.library_categories where parent_id = new.id) then
    raise exception '하위 분류가 있는 분류의 단계는 바꿀 수 없습니다.';
  end if;

  return new;
end;
$fn$;

create or replace function public.library_move_category(p_id uuid, p_parent uuid, p_keep boolean default true)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c public.library_categories;
  np public.library_categories;
  owner public.library_categories;
  new_level smallint;
  delta integer;
  max_level integer;
  materialized boolean := false;
  i integer;
begin
  select * into c from public.library_categories where id = p_id for update;
  if not found then
    raise exception '분류를 찾을 수 없습니다.';
  end if;

  if p_parent is not null then
    select * into np from public.library_categories where id = p_parent;
    if not found then
      raise exception '이동할 위치를 찾을 수 없습니다.';
    end if;
    if p_parent = p_id or exists (
      with recursive d as (
        select id from public.library_categories where parent_id = p_id
        union all
        select x.id from public.library_categories x join d on x.parent_id = d.id
      ) select 1 from d where d.id = p_parent
    ) then
      raise exception '자기 자신이나 자기 하위 분류로는 옮길 수 없습니다.';
    end if;
    new_level := np.level + 1;
  else
    new_level := 1;
  end if;

  -- 이미 그 위치에 있으면 할 일 없음
  if c.parent_id is not distinct from p_parent then
    return json_build_object('moved', false, 'materialized', false);
  end if;

  -- 하위 포함 가장 깊은 단계가 3을 넘으면 막음
  delta := new_level - c.level;
  with recursive t as (
    select id, level from public.library_categories where id = p_id
    union all
    select x.id, x.level from public.library_categories x join t on x.parent_id = t.id
  ) select max(level) into max_level from t;
  if max_level + delta > 3 then
    raise exception '3단계(대그룹 › 중그룹 › 소그룹)를 넘어 옮길 수 없습니다. 하위 분류가 있는 분류는 더 위쪽 단계로만 옮길 수 있습니다.';
  end if;

  -- 같은 이름이 이동할 위치에 이미 있으면 막음
  if exists (
    select 1 from public.library_categories
    where parent_id is not distinct from p_parent and id <> p_id and lower(name) = lower(c.name)
  ) then
    raise exception '이동할 위치에 같은 이름("%")의 분류가 이미 있습니다. 이름을 먼저 바꿔 주세요.', c.name;
  end if;

  -- 공개 범위 유지: "상위 따름"이고 이동 전 적용 규칙이 '지정한 사람만'이면 같은 허용 대상을 직접 지정해 고정
  if p_keep and c.visibility = 'inherit' then
    with recursive up as (
      select id, parent_id, visibility, 0 as dep from public.library_categories where id = p_id
      union all
      select x.id, x.parent_id, x.visibility, up.dep + 1 from public.library_categories x join up on x.id = up.parent_id
    )
    select lc.* into owner from public.library_categories lc
    join (select id from up where visibility <> 'inherit' order by dep limit 1) o on o.id = lc.id;
    if found and owner.visibility = 'restricted' then
      update public.library_categories set visibility = 'restricted' where id = p_id;
      insert into public.library_permissions (target_type, category_id, subject_type, group_id, library_group_id, user_id)
      select 'category', p_id, subject_type, group_id, library_group_id, user_id
      from public.library_permissions where target_type = 'category' and category_id = owner.id
      on conflict do nothing;
      materialized := true;
    end if;
  end if;

  -- 위치·단계 변경 (상위부터 차례로: 트리거가 부모의 단계를 보고 검사하므로 깊이 순서대로)
  perform set_config('library.moving', '1', true);
  update public.library_categories
     set parent_id = p_parent, level = new_level,
         sort_order = coalesce((select max(s.sort_order) + 1 from public.library_categories s where s.parent_id is not distinct from p_parent and s.id <> p_id), 0)
   where id = p_id;
  for i in 1..2 loop
    update public.library_categories lc set level = lc.level + delta
    where lc.id in (
      with recursive t as (
        select id, 0 as dep from public.library_categories where id = p_id
        union all
        select x.id, t.dep + 1 from public.library_categories x join t on x.parent_id = t.id
      ) select id from t where dep = i
    );
  end loop;
  perform set_config('library.moving', '', true);

  return json_build_object('moved', true, 'materialized', materialized);
end;
$fn$;

revoke all on function public.library_move_category(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.library_move_category(uuid, uuid, boolean) to service_role;
