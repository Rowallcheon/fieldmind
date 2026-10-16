'use strict';
// Cloudflare R2 (S3 호환) 임시 주소 발급(SigV4 쿼리 서명)과 파일 확인/삭제.
// 비밀키는 Vercel 환경변수에만 있고, 브라우저로는 만료되는 임시 주소만 나갑니다.
const crypto = require('crypto');
const { HttpError } = require('./http');

function uriEncode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
const sha256hex = s => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();

/** AWS SigV4 쿼리 서명 방식의 임시 주소 만들기 */
function presignUrl({ method, url, accessKeyId, secretAccessKey, region = 'auto', service = 's3', expires = 60, now = new Date(), extraQuery = {} }) {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const scope = date + '/' + region + '/' + service + '/aws4_request';
  const q = [];
  for (const [k, v] of u.searchParams.entries()) q.push([k, v]);
  for (const [k, v] of Object.entries(extraQuery)) q.push([k, v]);
  q.push(['X-Amz-Algorithm', 'AWS4-HMAC-SHA256']);
  q.push(['X-Amz-Credential', accessKeyId + '/' + scope]);
  q.push(['X-Amz-Date', amzDate]);
  q.push(['X-Amz-Expires', String(expires)]);
  q.push(['X-Amz-SignedHeaders', 'host']);
  q.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const canonicalQuery = q.map(([k, v]) => uriEncode(k) + '=' + uriEncode(v)).join('&');
  const canonicalUri = u.pathname.split('/').map(seg => uriEncode(decodeURIComponent(seg))).join('/');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, 'host:' + u.host + '\n', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, date), region), service), 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');
  return u.origin + canonicalUri + '?' + canonicalQuery + '&X-Amz-Signature=' + signature;
}

function makeR2(env = process.env, fetchImpl = (...a) => fetch(...a)) {
  const account = env.R2_ACCOUNT_ID, bucket = env.R2_BUCKET;
  const accessKeyId = env.R2_ACCESS_KEY_ID, secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey || !(account || env.R2_ENDPOINT)) {
    throw new HttpError(500, '서버 설정이 완료되지 않았습니다.', { missing: 'R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET' });
  }
  const endpoint = (env.R2_ENDPOINT || ('https://' + account + '.r2.cloudflarestorage.com')).replace(/\/$/, '');

  function objectUrl(key) {
    return endpoint + '/' + bucket + '/' + key.split('/').map(encodeURIComponent).join('/');
  }
  function presign(method, key, expires = 60, now = new Date()) {
    return presignUrl({ method, url: objectUrl(key), accessKeyId, secretAccessKey, expires, now });
  }
  return {
    presign,
    /** 파일이 실제로 올라왔는지 확인하고 크기를 돌려줌 */
    async head(key) {
      const res = await fetchImpl(presign('HEAD', key, 60), { method: 'HEAD' });
      if (res.status === 404) return { exists: false, size: 0, contentType: null };
      if (!res.ok) throw new HttpError(502, '파일 저장소 확인에 실패했습니다.', { status: res.status, key });
      return { exists: true, size: Number(res.headers.get('content-length') || 0), contentType: res.headers.get('content-type') };
    },
    /** 파일 삭제. 이미 없어도 성공으로 취급 */
    async remove(key) {
      const res = await fetchImpl(presign('DELETE', key, 60), { method: 'DELETE' });
      if (res.status === 404 || res.ok) return true;
      throw new HttpError(502, '파일 저장소에서 삭제하지 못했습니다.', { status: res.status, key });
    },
  };
}

module.exports = { makeR2, presignUrl, uriEncode };
