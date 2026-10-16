'use strict';
// 실행: node --test tests/doc-images/api.test.js   (가짜 Supabase 응답 사용, 외부 접속 없음)
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://proj.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
process.env.LIBRARY_TOKEN_SECRET = 'x'.repeat(40);

const { makeStorage } = require('../../api/_lib/storage');
const { signToken } = require('../../api/_lib/http');
const urlApi = require('../../api/doc-image-url');
const upApi = require('../../api/doc-image-upload-url');

const USERS = { u1: { id: 'u1', name: '사용자', role: 'user', status: 'active' }, adm: { id: 'adm', name: '관리자', role: 'admin', status: 'active' }, off: { id: 'off', name: '중지', role: 'user', status: 'inactive' } };
let calls = [];
function fakeFetch(storageReply) {
  return async (u, init = {}) => {
    u = String(u); calls.push({ u, init });
    const reply = (status, obj) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => JSON.stringify(obj) });
    if (u.includes('/rest/v1/users')) { const id = decodeURIComponent((/id=eq\.([^&]+)/.exec(u) || [])[1] || ''); return reply(200, USERS[id] ? [USERS[id]] : []); }
    return storageReply(u, init, reply);
  };
}
function call(mod, body, token) {
  return new Promise(async resolve => {
    const req = { method: 'POST', headers: token ? { authorization: 'Bearer ' + token } : {}, body };
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(t) { resolve({ status: this.statusCode, json: JSON.parse(t) }); } };
    await mod(req, res);
  });
}
const tok = uid => signToken({ uid });

test('임시 읽기 주소: 요청 형식, 서비스 키 사용, 절대 주소로 변환', async () => {
  calls = [];
  const st = makeStorage(process.env, fakeFetch((u, init, reply) => reply(200, [
    { path: 'aaaaaaaaaaaa.webp', signedURL: '/object/sign/doc-images/aaaaaaaaaaaa.webp?token=T1', error: null },
    { path: 'bbbbbbbbbbbb.webp', signedURL: null, error: 'Object not found' },
  ])));
  const out = await st.signMany('doc-images', ['aaaaaaaaaaaa.webp', 'bbbbbbbbbbbb.webp', 'cccccccccccc.webp'], 300);
  assert.equal(out['aaaaaaaaaaaa.webp'], 'https://proj.supabase.co/storage/v1/object/sign/doc-images/aaaaaaaaaaaa.webp?token=T1');
  assert.equal(out['bbbbbbbbbbbb.webp'], null);
  assert.equal(out['cccccccccccc.webp'], null);
  const c = calls[0];
  assert.equal(c.u, 'https://proj.supabase.co/storage/v1/object/sign/doc-images');
  assert.equal(c.init.headers.Authorization, 'Bearer service-key-for-test');
  assert.deepEqual(JSON.parse(c.init.body), { expiresIn: 300, paths: ['aaaaaaaaaaaa.webp', 'bbbbbbbbbbbb.webp', 'cccccccccccc.webp'] });
});

test('업로드 토큰: 응답의 주소에서 token을 꺼낸다', async () => {
  calls = [];
  const st = makeStorage(process.env, fakeFetch((u, init, reply) => reply(200, { url: '/object/upload/sign/doc-images/n.webp?token=UP123' })));
  const r = await st.createUploadToken('doc-images', 'n.webp');
  assert.deepEqual(r, { token: 'UP123', path: 'n.webp' });
  assert.equal(calls[0].u, 'https://proj.supabase.co/storage/v1/object/upload/sign/doc-images/n.webp');
});

test('저장소 오류는 502로 바뀌고 내부 내용은 화면에 보이지 않는다', async () => {
  const st = makeStorage(process.env, fakeFetch((u, init, reply) => reply(500, { message: 'secret internal' })));
  await assert.rejects(() => st.signMany('doc-images', ['aaaaaaaaaaaa.webp'], 60), e => e.status === 502 && !/secret/.test(e.message));
});

test('열람 주소 API: 로그인 필수 / 비활성 계정 거부', async () => {
  global.fetch = fakeFetch((u, i, reply) => reply(200, []));
  assert.equal((await call(urlApi, { names: ['aaaaaaaaaaaa.webp'] })).status, 401);
  assert.equal((await call(urlApi, { names: ['aaaaaaaaaaaa.webp'] }, 'garbage.token')).status, 401);
  assert.equal((await call(urlApi, { names: ['aaaaaaaaaaaa.webp'] }, tok('off'))).status, 401);
  assert.equal((await call(urlApi, { names: ['aaaaaaaaaaaa.webp'] }, tok('nobody'))).status, 401);
});

test('열람 주소 API: 잘못된 이름·너무 많은 요청은 거부, 중복은 합침', async () => {
  global.fetch = fakeFetch((u, init, reply) => reply(200, JSON.parse(init.body).paths.map(p => ({ path: p, signedURL: '/object/sign/doc-images/' + p + '?token=t', error: null }))));
  for (const bad of [[], ['../secret.webp'], ['abc.webp'], ['aaaaaaaaaaaa.png'], ['AAAAAAAAAAAA.webp'], [123], ['aaaaaaaaaaaa.webp/../x.webp'], 'aaaaaaaaaaaa.webp'])
    assert.equal((await call(urlApi, { names: bad }, tok('u1'))).status, 400, JSON.stringify(bad));
  assert.equal((await call(urlApi, { names: Array.from({ length: 25 }, (_, i) => 'a'.repeat(11) + String.fromCharCode(97 + i % 26) + '.webp') }, tok('u1'))).status, 400);
  const ok = await call(urlApi, { names: ['aaaaaaaaaaaa.webp', 'aaaaaaaaaaaa.webp', 'bbbbbbbbbbbb.jpg'] }, tok('u1'));
  assert.equal(ok.status, 200);
  assert.deepEqual(Object.keys(ok.json.urls).sort(), ['aaaaaaaaaaaa.webp', 'bbbbbbbbbbbb.jpg']);
  assert.match(ok.json.urls['aaaaaaaaaaaa.webp'], /^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/sign\/doc-images\/aaaaaaaaaaaa\.webp\?token=/);
  assert.equal(ok.json.expiresIn, 300);
  const sent = calls.filter(c => c.u.endsWith('/object/sign/doc-images')).pop();
  assert.equal(JSON.parse(sent.init.body).expiresIn, 300);
});

test('업로드 주소 API: 관리자만, 이름은 서버가 무작위로 정함', async () => {
  global.fetch = fakeFetch((u, init, reply) => reply(200, { url: u.replace('https://proj.supabase.co/storage/v1', '') + '?token=UPTOK' }));
  assert.equal((await call(upApi, { ext: 'webp', size: 1000 })).status, 401);
  assert.equal((await call(upApi, { ext: 'webp', size: 1000 }, tok('u1'))).status, 403);
  const a = await call(upApi, { ext: 'webp', size: 50000, name: 'hack.webp' }, tok('adm'));
  const b = await call(upApi, { ext: 'jpg', size: 50000 }, tok('adm'));
  assert.equal(a.status, 200);
  assert.match(a.json.name, /^[a-z0-9]{15}\.webp$/);
  assert.match(b.json.name, /^[a-z0-9]{15}\.jpg$/);
  assert.notEqual(a.json.name, b.json.name);
  assert.equal(a.json.token, 'UPTOK'); assert.equal(a.json.bucket, 'doc-images'); assert.equal(a.json.contentType, 'image/webp');
  assert.ok(!a.json.name.includes('hack'));
  assert.equal(a.json.path, a.json.name);
});

test('업로드 주소 API: 형식·크기 검증', async () => {
  global.fetch = fakeFetch((u, init, reply) => reply(200, { url: '/x?token=T' }));
  for (const body of [{ ext: 'png', size: 10 }, { ext: 'exe', size: 10 }, { ext: 'webp' }, { ext: 'webp', size: 0 }, { ext: 'webp', size: -5 }, { ext: 'webp', size: 'abc' }, {}])
    assert.equal((await call(upApi, body, tok('adm'))).status, 400, JSON.stringify(body));
  assert.equal((await call(upApi, { ext: 'webp', size: 2 * 1024 * 1024 + 1 }, tok('adm'))).status, 413);
  assert.equal((await call(upApi, { ext: 'webp', size: 2 * 1024 * 1024 }, tok('adm'))).status, 200);
});

test('GET 요청과 환경변수 누락은 안전하게 거부', async () => {
  global.fetch = fakeFetch((u, i, reply) => reply(200, []));
  const r = await new Promise(async resolve => { const res = { setHeader() {}, end(t) { resolve({ status: this.statusCode, json: JSON.parse(t) }); } }; await urlApi({ method: 'GET', headers: {} }, res); });
  assert.equal(r.status, 405);
  const saved = process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r2 = await call(urlApi, { names: ['aaaaaaaaaaaa.webp'] }, tok('u1'));
  process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
  assert.equal(r2.status, 500); assert.ok(!/SERVICE_ROLE/.test(JSON.stringify(r2.json)));
});

test('서비스 키 형식: 옛 방식(JWT)은 Bearer도 보내고, 새 방식(sb_secret_)은 apikey만 보낸다', async () => {
  const { makeDb } = require('../../api/_lib/db');
  for (const [key, bearer] of [['eyJhbGciOi.fake.jwt', true], ['sb_secret_fake123', false]]) {
    const seen = [];
    const env = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: key };
    const f = async (u, init) => { seen.push(init.headers); return { ok: true, status: 200, headers: { get: () => null }, text: async () => '[]' }; };
    await makeDb(env, f).select('users', { limit: 1 });
    await makeStorage(env, f).signMany('doc-images', ['aaaaaaaaaaaa.webp'], 60);
    for (const h of seen) { assert.equal(h.apikey, key); assert.equal('Authorization' in h, bearer); }
    assert.equal(seen.length, 2);
  }
});
