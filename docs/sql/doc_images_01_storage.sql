-- ============================================================
-- 문서 사진 저장소 (Supabase Storage 버킷 'doc-images') — 비공개 방식
-- 방식: 버킷은 비공개. 브라우저(anon)는 정책이 없어 직접 읽기·쓰기·목록 조회가 모두 막혀 있고,
--       서버 함수(/api/doc-image-url, /api/doc-image-upload-url)가 서비스 키로
--       로그인한 사용자에게만 임시 열람 주소(5분), 관리자에게만 임시 업로드 토큰을 발급합니다.
-- 여러 번 실행해도 안전합니다.
-- ============================================================

-- 1. 버킷: 비공개, 한 장 2MB 이하, 사진 형식만
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('doc-images', 'doc-images', false, 2097152, array['image/webp','image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/webp','image/jpeg'];

-- 2. 브라우저용 정책은 만들지 않음 (이전 공개 방식에서 만든 업로드 정책이 있으면 제거)
drop policy if exists "doc_images_upload" on storage.objects;

-- 3. 사용량 조회 (관리자 대시보드 에너지바용): 사진 총 용량·장수
create or replace function public.get_storage_usage()
returns json
language sql
security definer
set search_path = public, storage
as $fn$
  select json_build_object(
    'bytes', coalesce(sum((metadata->>'size')::bigint), 0),
    'files', count(*)
  ) from storage.objects where bucket_id = 'doc-images';
$fn$;
revoke all on function public.get_storage_usage() from public;
grant execute on function public.get_storage_usage() to anon, authenticated;
