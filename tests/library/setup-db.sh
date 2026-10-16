#!/bin/bash
# 테스트용 임시 PostgreSQL 16 기동 + 기존 테이블 구조 복제 + 자료실 SQL 적용 (운영 DB와 무관)
# 사용: sudo ./setup-db.sh   (postgres 사용자로 서버를 띄웁니다)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; SQLDIR="$HERE/../../docs/sql"
D=${PGHOST:-/var/tmp/pgtest-lib}
mkdir -p "$D" && chown postgres "$D" && chmod 755 "$D"
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $D/data -A trust >/dev/null && /usr/lib/postgresql/16/bin/pg_ctl -D $D/data -o '-p 54329 -k $D' -l $D/log start >/dev/null"
sleep 2
P="psql -h $D -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "create database lib"
$P -d lib -f "$HERE/stub-schema.sql"
$P -d lib -f "$SQLDIR/library_01_tables.sql" 2>&1 | grep -v NOTICE || true
$P -d lib -f "$SQLDIR/library_02_rls.sql"
$P -d lib -f "$SQLDIR/library_03_user_id_cascade.sql"
$P -d lib -f "$HERE/seed.sql"
echo "DB ready"
