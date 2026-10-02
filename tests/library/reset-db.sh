#!/bin/bash
# 테스트 사이에 자료실 데이터와 회원 상태를 초기화
D=${PGHOST:-/var/tmp/pgtest-lib}
psql -h "$D" -p 54329 -U postgres -d lib -q -v ON_ERROR_STOP=1 <<'SQL'
truncate library_view_logs, library_permissions, library_group_members, library_groups, library_docs, library_categories restart identity cascade;
update users set id='u1' where id='u1_new';
update users set status='active' where id in ('u1','u2','admin','mgr');
update users set role='admin' where id in ('admin','mgr');
SQL
