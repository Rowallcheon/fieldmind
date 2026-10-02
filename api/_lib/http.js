'use strict';
// 원본 자료실 서버 함수 공통: 오류, 요청 처리, 로그인 토큰
// 설계서: docs/원본자료실_설계서.md (결정 1: 서버 함수가 토큰을 발급)
const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, message, detail, extra) {
    super(message);
    this.status = status;
    this.detail = detail; // 서버 로그에만 남기고 화면에는 보내지 않음
    this.extra = extra;   // 화면에 함께 보내도 되는 부가 정보 (예: 삭제 불가 사유의 개수)
  }
}

const TOKEN_TTL_SEC = 8 * 60 * 60; // 8시간 (화면 메모리에만 보관)

function getSecret() {
  const s = process.env.LIBRARY_TOKEN_SECRET;
  if (!s || s.length < 32) {
    throw new HttpError(500, '서버 설정이 완료되지 않았습니다.', { missing: 'LIBRARY_TOKEN_SECRET (32자 이상)' });
  }
  return s;
}

function signToken(payload, ttlSec = TOKEN_TTL_SEC, now = Date.now()) {
  const body = Object.assign({}, payload, { exp: Math.floor(now / 1000) + ttlSec });
  const p = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(p).digest('base64url');
  return p + '.' + sig;
}

function verifyToken(token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const expect = crypto.createHmac('sha256', getSecret()).update(parts[0]).digest();
  let given;
  try { given = Buffer.from(parts[1], 'base64url'); } catch (e) { return null; }
  if (given.length !== expect.length || !crypto.timingSafeEqual(given, expect)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!payload || typeof payload.exp !== 'number' || payload.exp * 1000 < now) return null;
  return payload;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if (x.length !== y.length) { crypto.timingSafeEqual(x, x); return false; }
  return crypto.timingSafeEqual(x, y);
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') { try { return JSON.parse(req.body || '{}'); } catch (e) { throw new HttpError(400, '요청 형식이 올바르지 않습니다.'); } }
    if (Buffer.isBuffer(req.body)) { try { return JSON.parse(req.body.toString('utf8') || '{}'); } catch (e) { throw new HttpError(400, '요청 형식이 올바르지 않습니다.'); } }
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1024 * 1024) throw new HttpError(413, '요청이 너무 큽니다.');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { throw new HttpError(400, '요청 형식이 올바르지 않습니다.'); }
}

// 로그인한 사용자 확인: 토큰 검증 후, 회원 정보를 DB에서 다시 읽어 상태/권한을 최신으로 맞춤
async function authenticate(req, db) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  const payload = m ? verifyToken(m[1].trim()) : null;
  if (!payload || !payload.uid) throw new HttpError(401, '로그인이 필요합니다. 다시 로그인해 주세요.');
  const rows = await db.select('users', { select: 'id,name,role,status', filters: [['id', 'eq', payload.uid]], limit: 1 });
  const u = rows[0];
  if (!u || u.status !== 'active') throw new HttpError(401, '로그인이 필요합니다. 다시 로그인해 주세요.');
  return { id: u.id, name: u.name, role: u.role === 'admin' ? 'admin' : 'user' };
}

/**
 * 엔드포인트 생성기
 * opts.auth: 'none' | 'user' | 'admin'
 * run({ body, user, db, r2, req }) 의 반환값을 JSON으로 응답
 */
function handler(run, opts = {}) {
  const auth = opts.auth || 'user';
  return async function (req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const send = (status, obj) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); };
    try {
      if (req.method !== 'POST') throw new HttpError(405, '허용되지 않는 요청입니다.');
      const { makeDb } = require('./db');
      const { makeR2 } = require('./r2');
      const db = makeDb();
      const body = await readBody(req);
      let user = null;
      if (auth !== 'none') {
        user = await authenticate(req, db);
        if (auth === 'admin' && user.role !== 'admin') throw new HttpError(403, '관리자만 사용할 수 있습니다.');
      }
      const result = await run({ body, user, db, r2: opts.needsR2 ? makeR2() : null, req });
      send(200, result === undefined ? { ok: true } : result);
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.detail) console.error('[library]', e.status, e.message, JSON.stringify(e.detail));
        send(e.status, Object.assign({ error: e.message }, e.extra || {}));
      } else {
        console.error('[library] unexpected', e && e.stack || e);
        send(500, { error: '서버 오류가 발생했습니다.' });
      }
    }
  };
}

module.exports = { HttpError, handler, authenticate, signToken, verifyToken, safeEqual, readBody, TOKEN_TTL_SEC };
