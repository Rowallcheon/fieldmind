'use strict';
// POST /api/library-upload-url  { fileName, contentType, size }  →  { uploadUrl, r2Key, fileType, contentType, expiresIn }
// 관리자 확인 후 R2 임시 업로드 주소(10분)를 발급합니다. 브라우저가 R2로 직접 올립니다.
const crypto = require('crypto');
const { handler, HttpError } = require('./_lib/http');

const MAX_BYTES = 100 * 1024 * 1024; // 파일당 최대 100MB
const UPLOAD_TTL_SEC = 600;
const EXT = { pdf: 'pdf', png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image' };
const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

async function run({ body, r2 }) {
  const fileName = typeof body.fileName === 'string' ? body.fileName : '';
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const fileType = EXT[ext];
  if (!fileType) throw new HttpError(400, 'PDF 또는 이미지(PNG, JPG, WEBP, GIF) 파일만 올릴 수 있습니다.');
  const size = Number(body.size);
  if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, '파일 크기를 확인할 수 없습니다.');
  if (size > MAX_BYTES) throw new HttpError(413, '파일은 ' + Math.round(MAX_BYTES / 1048576) + 'MB 이하만 올릴 수 있습니다.');

  const year = new Date().getUTCFullYear();
  const r2Key = 'library/' + year + '/' + crypto.randomUUID() + '.' + ext;
  return {
    uploadUrl: r2.presign('PUT', r2Key, UPLOAD_TTL_SEC),
    r2Key, fileType, contentType: MIME[ext], expiresIn: UPLOAD_TTL_SEC, maxBytes: MAX_BYTES,
  };
}

module.exports = handler(run, { auth: 'admin', needsR2: true });
module.exports.run = run;
module.exports.MAX_BYTES = MAX_BYTES;
