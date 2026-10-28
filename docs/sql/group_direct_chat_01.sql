-- 그룹 '바로 채팅' 설정: 체크된 그룹의 사용자는 제품군/모델 선택 없이 채팅창만 보이고,
-- 허용된 제품군의 전체 문서에서 검색해 답변합니다. (기본값 false → 기존 그룹은 영향 없음)
alter table public.groups add column if not exists direct_chat boolean not null default false;
