-- ============================================================
-- 원본 자료실 1/2: 테이블 생성
-- 기준: docs/원본자료실_설계서.md (결정 사항 포함)
-- 여러 번 실행해도 안전하도록 IF NOT EXISTS / OR REPLACE 를 사용했습니다.
-- ============================================================

-- ── 1. 분류 (대그룹 → 중그룹 → 소그룹, 최대 3단계) ──────────────
create table if not exists public.library_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  parent_id   uuid references public.library_categories(id) on delete restrict,
  level       smallint not null check (level between 1 and 3),
  sort_order  integer not null default 0,
  visibility  text not null default 'inherit' check (visibility in ('inherit','all','restricted')),
  description text,
  created_at  timestamptz not null default now(),
  -- 대그룹(1단계)만 상위가 없고, 2·3단계는 반드시 상위가 있어야 함
  constraint library_categories_level_parent_chk
    check ((level = 1 and parent_id is null) or (level > 1 and parent_id is not null))
);

-- 같은 상위 안에서 같은 이름 중복 방지 (대소문자 무시)
create unique index if not exists library_categories_unique_name
  on public.library_categories (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create index if not exists library_categories_parent_idx on public.library_categories (parent_id, sort_order);

-- 단계 규칙 검증: 하위 분류의 단계 = 상위 분류의 단계 + 1, 하위가 있는 분류의 단계는 바꿀 수 없음
create or replace function public.library_categories_check_hierarchy()
returns trigger
language plpgsql
set search_path = public
as $$
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
     and exists (select 1 from public.library_categories where parent_id = new.id) then
    raise exception '하위 분류가 있는 분류의 단계는 바꿀 수 없습니다.';
  end if;

  return new;
end;
$$;

drop trigger if exists library_categories_hierarchy_trg on public.library_categories;
create trigger library_categories_hierarchy_trg
  before insert or update of parent_id, level on public.library_categories
  for each row execute function public.library_categories_check_hierarchy();


-- ── 2. 자료 (원본 파일 정보. 파일 자체는 R2에 저장) ──────────────
create table if not exists public.library_docs (
  id              uuid primary key default gen_random_uuid(),
  title           text not null check (length(btrim(title)) > 0),
  category_id     uuid not null references public.library_categories(id) on delete restrict,
  r2_key          text not null unique,
  file_type       text not null check (file_type in ('pdf','image')),
  file_size       bigint not null default 0 check (file_size >= 0),   -- 바이트. 무료 용량 에너지바 계산용
  version         integer not null default 1 check (version >= 1),
  is_latest       boolean not null default true,
  previous_doc_id uuid references public.library_docs(id) on delete set null,
  visibility      text not null default 'inherit' check (visibility in ('inherit','all','restricted')),
  uploader        text references public.users(id) on update cascade on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists library_docs_category_idx on public.library_docs (category_id) where is_latest;
create index if not exists library_docs_prev_idx on public.library_docs (previous_doc_id);
create index if not exists library_docs_created_idx on public.library_docs (created_at desc);


-- ── 3. 자료실 전용 그룹 (기존 groups/group_members와 별개) ─────────
create table if not exists public.library_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(btrim(name)) > 0),
  description text,
  created_at  timestamptz not null default now()
);

create table if not exists public.library_group_members (
  group_id   uuid not null references public.library_groups(id) on delete cascade,
  user_id    text not null references public.users(id) on update cascade on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists library_group_members_user_idx on public.library_group_members (user_id);


-- ── 4. 권한 (분류 또는 자료 + 허용 대상: 기존 그룹 / 자료실 그룹 / 개인) ──
create table if not exists public.library_permissions (
  id               uuid primary key default gen_random_uuid(),
  target_type      text not null check (target_type in ('category','doc')),
  category_id      uuid references public.library_categories(id) on delete cascade,
  doc_id           uuid references public.library_docs(id) on delete cascade,
  subject_type     text not null check (subject_type in ('group','library_group','user')),
  group_id         text references public.groups(id) on delete cascade,              -- 기존 그룹 (챗봇과 공용)
  library_group_id uuid references public.library_groups(id) on delete cascade,      -- 자료실 전용 그룹
  user_id          text references public.users(id) on update cascade on delete cascade,
  created_at       timestamptz not null default now(),
  -- 대상은 target_type에 맞는 하나만, 허용 대상은 subject_type에 맞는 하나만
  constraint library_permissions_target_chk check (
    (target_type = 'category' and category_id is not null and doc_id is null) or
    (target_type = 'doc'      and doc_id is not null      and category_id is null)),
  constraint library_permissions_subject_chk check (
    (subject_type = 'group'         and group_id is not null         and library_group_id is null and user_id is null) or
    (subject_type = 'library_group' and library_group_id is not null and group_id is null         and user_id is null) or
    (subject_type = 'user'          and user_id is not null          and group_id is null         and library_group_id is null))
);
-- 같은 대상에 같은 허용 대상을 중복 지정하지 못하게 함
create unique index if not exists library_permissions_unique
  on public.library_permissions (
    target_type,
    coalesce(category_id::text, ''), coalesce(doc_id::text, ''),
    subject_type,
    coalesce(group_id, ''), coalesce(library_group_id::text, ''), coalesce(user_id, ''));
create index if not exists library_permissions_category_idx on public.library_permissions (category_id) where category_id is not null;
create index if not exists library_permissions_doc_idx on public.library_permissions (doc_id) where doc_id is not null;


-- ── 5. 열람 기록 (자료·사용자가 삭제되어도 기록은 남도록 이름 사본을 함께 저장) ──
create table if not exists public.library_view_logs (
  id         bigint generated always as identity primary key,
  user_id    text references public.users(id) on update cascade on delete set null,
  user_name  text,
  doc_id     uuid references public.library_docs(id) on delete set null,
  doc_title  text,
  viewed_at  timestamptz not null default now()
);
create index if not exists library_view_logs_doc_idx  on public.library_view_logs (doc_id, viewed_at desc);
create index if not exists library_view_logs_user_idx on public.library_view_logs (user_id, viewed_at desc);
create index if not exists library_view_logs_time_idx on public.library_view_logs (viewed_at desc);
