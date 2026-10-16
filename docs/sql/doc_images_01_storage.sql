-- ============================================================
-- 문서 사진 저장소 (Supabase Storage 버킷 'doc-images')
-- 방식: 1차 = 주소를 알아야만 볼 수 있는 공개 버킷 (파일명은 무작위, 목록 조회는 막음)
--       나중에 서버 함수가 임시 주소를 발급하는 방식(로그인한 사람만)으로 올릴 수 있습니다.
-- 여러 번 실행해도 안전합니다.
-- ============================================================

-- 1. 버킷: 공개 읽기, 한 장 2MB 이하, 사진 형식만
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('doc-images', 'doc-images', true, 2097152, array['image/webp','image/jpeg','image/png'])
on conflict (id) do update
  set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/webp','image/jpeg','image/png'];

-- 2. 업로드만 허용 (조회·목록·수정·삭제 정책은 만들지 않음 → 브라우저에서 파일 목록을 볼 수 없음)
--    공개 버킷은 파일 주소를 알면 정책 없이도 읽을 수 있습니다.
drop policy if exists "doc_images_upload" on storage.objects;
create policy "doc_images_upload" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'doc-images');

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
