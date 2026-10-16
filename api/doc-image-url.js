'use strict';
// POST /api/doc-image-url  { names: ["abc….webp", ...] }  →  { urls: { 이름: 주소|null }, expiresIn }
// 로그인한 사용자에게 문서 사진의 임시 열람 주소(5분)를 발급합니다. 비공개 버킷이라 이 주소가 없으면 사진을 볼 수 없습니다.
const { handler, HttpError } = require('./_lib/http');

const BUCKET = 'doc-images';
const NAME_RE = /^[a-z0-9]{8,24}\.(?:webp|jpg)$/;
const MAX_NAMES = 24;
const URL_TTL_SEC = 300;

async function run({ body, storage }) {
  const raw = Array.isArray(body.names) ? body.names : [];
  if (!raw.length) throw new HttpError(400, '사진 이름이 없습니다.');
  if (raw.length > MAX_NAMES) throw new HttpError(400, '한 번에 요청할 수 있는 사진 수를 넘었습니다.');
  const names = [...new Set(raw)];
  if (!names.every(n => typeof n === 'string' && NAME_RE.test(n))) throw new HttpError(400, '사진 이름이 올바르지 않습니다.');
  const urls = await storage.signMany(BUCKET, names, URL_TTL_SEC);
  return { urls, expiresIn: URL_TTL_SEC };
}

module.exports = handler(run, { auth: 'user', needsStorage: true });
module.exports.run = run;
module.exports.NAME_RE = NAME_RE;
