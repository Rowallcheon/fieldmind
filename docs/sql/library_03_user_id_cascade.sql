-- ============================================================
-- (선택, 별도 실행) 회원 아이디 변경 시 기존 기록도 함께 바뀌도록 설정
-- 설계서 '결정 4'. 기존 3개 테이블의 외래키를 다시 만듭니다. (데이터는 그대로)
-- 삭제 시 연쇄 삭제(ON DELETE CASCADE)는 지금과 똑같이 유지합니다.
-- ============================================================
begin;

alter table public.inquiries      drop constraint inquiries_user_id_fkey;
alter table public.inquiries      add  constraint inquiries_user_id_fkey
  foreign key (user_id) references public.users(id) on update cascade on delete cascade;

alter table public.user_chat_logs drop constraint user_chat_logs_user_id_fkey;
alter table public.user_chat_logs add  constraint user_chat_logs_user_id_fkey
  foreign key (user_id) references public.users(id) on update cascade on delete cascade;

alter table public.group_members  drop constraint group_members_user_id_fkey;
alter table public.group_members  add  constraint group_members_user_id_fkey
  foreign key (user_id) references public.users(id) on update cascade on delete cascade;

commit;
