-- ============================================================
-- 원본 자료실 2/2: 접근 차단 (RLS)
-- 방식: 자료실 테이블은 브라우저(anon / authenticated)에서 절대 접근할 수 없게 막고,
--       서버 함수(Vercel)가 서비스 키로만 읽고 씁니다. (설계서 '결정 1')
-- 서비스 키(service_role)는 RLS를 우회하므로 별도 정책이 필요 없습니다.
-- ============================================================

alter table public.library_categories     enable row level security;
alter table public.library_docs           enable row level security;
alter table public.library_groups         enable row level security;
alter table public.library_group_members  enable row level security;
alter table public.library_permissions    enable row level security;
alter table public.library_view_logs      enable row level security;

-- 정책을 하나도 만들지 않으면 anon/authenticated 는 모든 행이 거부됩니다. (기본 거부)
-- 한 겹 더: 테이블 권한 자체도 회수합니다.
revoke all on public.library_categories     from anon, authenticated;
revoke all on public.library_docs           from anon, authenticated;
revoke all on public.library_groups         from anon, authenticated;
revoke all on public.library_group_members  from anon, authenticated;
revoke all on public.library_permissions    from anon, authenticated;
revoke all on public.library_view_logs      from anon, authenticated;
revoke usage, select on sequence public.library_view_logs_id_seq from anon, authenticated;

-- 단계 검증용 트리거 함수는 브라우저에서 호출할 이유가 없으므로 실행 권한 회수
revoke all on function public.library_categories_check_hierarchy() from public, anon, authenticated;
