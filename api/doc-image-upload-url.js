'use strict';
// POST /api/doc-image-upload-url  { ext: "webp"|"jpg", size }  →  { name, path, token, bucket, contentType, maxBytes }
// 관리자만 사용. 파일 이름은 서버가 무작위로 정하고, 그 이름에만 올릴 수 있는 임시 업로드 토큰을 발급합니다.
const crypto = require('crypto');
const { handler, HttpError } = require('./_lib/http');

const BUCKET = 'doc-images';
const MAX_BYTES = 2 * 1024 * 1024; // 버킷 한도와 같게
const MIME = { webp: 'image/webp', jpg: 'image/jpeg' };
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomName(ext) {
  const bytes = crypto.randomBytes(15);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s + '.' + ext;
}

async function run({ body, storage }) {
  const ext = typeof body.ext === 'string' ? body.ext : '';
  if (!MIME[ext]) throw new HttpError(400, '사진은 WebP 또는 JPG 형식이어야 합니다.');
  const size = Number(body.size);
  if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, '사진 크기를 확인할 수 없습니다.');
  if (size > MAX_BYTES) throw new HttpError(413, '사진은 2MB 이하여야 합니다. 크기를 "작게"로 바꿔 보세요.');
  const name = randomName(ext);
  const t = await storage.createUploadToken(BUCKET, name);
  return { name, path: t.path, token: t.token, bucket: BUCKET, contentType: MIME[ext], maxBytes: MAX_BYTES };
}

module.exports = handler(run, { auth: 'admin', needsStorage: true });
module.exports.run = run;
module.exports.randomName = randomName;
