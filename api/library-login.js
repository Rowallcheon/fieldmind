'use strict';
// POST /api/library-login  { id, pw }  →  { token, expiresIn, user }
// 챗봇 로그인과 같은 아이디/비밀번호를 서버에서 확인하고, 자료실용 토큰을 발급합니다.
const { handler, HttpError, signToken, safeEqual, TOKEN_TTL_SEC } = require('./_lib/http');

// 서버 인스턴스 안에서의 간단한 무차별 대입 완화 (인스턴스가 여러 개면 완전하지는 않음)
const fails = new Map();
const MAX_FAILS = 8, WINDOW_MS = 10 * 60 * 1000;
function tooMany(key, now) {
  const f = fails.get(key);
  return !!f && now - f.first < WINDOW_MS && f.n >= MAX_FAILS;
}
function noteFail(key, now) {
  const f = fails.get(key);
  if (!f || now - f.first >= WINDOW_MS) fails.set(key, { n: 1, first: now });
  else f.n++;
  if (fails.size > 5000) fails.clear();
}

async function run({ body, db, req }) {
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const pw = typeof body.pw === 'string' ? body.pw : '';
  if (!id || !pw || id.length > 100 || pw.length > 200) throw new HttpError(400, '아이디와 비밀번호를 입력해 주세요.');

  const now = Date.now();
  const ip = String((req && req.headers && (req.headers['x-forwarded-for'] || '')) || '').split(',')[0].trim();
  const key = id.toLowerCase() + '|' + ip;
  if (tooMany(key, now)) throw new HttpError(429, '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.');

  const rows = await db.select('users', { select: 'id,pw,name,role,status', filters: [['id', 'eq', id]], limit: 1 });
  const u = rows[0];
  const ok = !!u && safeEqual(u.pw, pw);
  if (!ok) {
    noteFail(key, now);
    await new Promise(r => setTimeout(r, 300));
    throw new HttpError(401, '아이디 또는 비밀번호가 올바르지 않습니다.');
  }
  if (u.status !== 'active') throw new HttpError(403, '비활성화된 계정입니다.');
  fails.delete(key);
  const role = u.role === 'admin' ? 'admin' : 'user';
  return { token: signToken({ uid: u.id, name: u.name, role }), expiresIn: TOKEN_TTL_SEC, user: { id: u.id, name: u.name, role } };
}

module.exports = handler(run, { auth: 'none' });
module.exports.run = run;
