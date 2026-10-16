'use strict';
// Supabase 파일 저장소(Storage) 서버 전용 클라이언트. 서비스 키를 쓰므로 서버 함수 안에서만 사용합니다.
// 문서 사진 버킷은 비공개이며, 이 모듈이 만든 "임시 주소"로만 올리고 볼 수 있습니다.
const { HttpError } = require('./http');

function makeStorage(env = process.env, fetchImpl = (...a) => fetch(...a)) {
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(500, '서버 설정이 완료되지 않았습니다.', { missing: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' });
  const root = url.replace(/\/$/, '');
  const api = root + '/storage/v1';
  const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };

  async function post(path, body) {
    const res = await fetchImpl(api + path, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    const text = await res.text();
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch (e) { json = null; } }
    if (!res.ok) throw new HttpError(502, '사진 저장소 오류가 발생했습니다.', { status: res.status, body: json });
    return json;
  }
  const absolute = p => (/^https?:\/\//.test(p) ? p : api + (p.startsWith('/') ? p : '/' + p));

  return {
    // 여러 파일의 읽기용 임시 주소를 한 번에 발급. 없는 파일은 null.
    async signMany(bucket, names, expiresIn) {
      const out = {};
      if (!names.length) return out;
      const arr = await post('/object/sign/' + encodeURIComponent(bucket), { expiresIn, paths: names });
      for (const it of Array.isArray(arr) ? arr : []) {
        out[it.path] = it.signedURL && !it.error ? absolute(it.signedURL) : null;
      }
      for (const n of names) if (!(n in out)) out[n] = null;
      return out;
    },
    // 업로드용 임시 토큰 발급 (브라우저가 이 토큰으로 지정한 이름에만 올릴 수 있음)
    async createUploadToken(bucket, name) {
      const j = await post('/object/upload/sign/' + encodeURIComponent(bucket) + '/' + encodeURI(name), {});
      const u = new URL(absolute(j && (j.url || j.signedURL) || ''));
      const token = u.searchParams.get('token');
      if (!token) throw new HttpError(502, '사진 저장소 오류가 발생했습니다.', { body: j });
      return { token, path: name };
    },
  };
}

module.exports = { makeStorage };
