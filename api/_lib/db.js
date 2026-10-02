'use strict';
// Supabase(PostgREST) 서버 전용 클라이언트. 서비스 키를 쓰므로 서버 함수 안에서만 사용합니다.
const { HttpError } = require('./http');

const PAGE = 1000; // Supabase 기본 최대 행 수

function quoteListValue(v) {
  const s = String(v);
  return /[,()"\\\s]/.test(s) ? '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' : s;
}

function filterParam(op, val) {
  if (op === 'in') return 'in.(' + val.map(quoteListValue).join(',') + ')';
  if (op === 'is') return 'is.' + val; // is.null
  return op + '.' + val;
}

function mapDbError(status, body) {
  const code = body && body.code;
  const detail = { status, body };
  if (code === '23505') return new HttpError(409, '이미 같은 항목이 있습니다.', detail);
  if (code === '23503') return new HttpError(409, '연결된 항목이 있거나 존재하지 않는 대상이 포함되어 있습니다.', detail);
  if (code === '23514' || code === '22P02' || code === '23502') return new HttpError(400, '입력값이 올바르지 않습니다.', detail);
  if (code === 'P0001') return new HttpError(400, (body && body.message) || '처리할 수 없는 요청입니다.', detail);
  return new HttpError(500, '데이터베이스 오류가 발생했습니다.', detail);
}

function makeDb(env = process.env, fetchImpl = (...a) => fetch(...a)) {
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(500, '서버 설정이 완료되지 않았습니다.', { missing: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' });
  const base = url.replace(/\/$/, '') + '/rest/v1';

  async function request(method, table, { select, filters = [], order, limit, offset, body, returning = false, count = false } = {}) {
    const u = new URL(base + '/' + table);
    if (select) u.searchParams.set('select', select);
    for (const [col, op, val] of filters) u.searchParams.append(col, filterParam(op, val));
    if (order) u.searchParams.set('order', order);
    if (limit !== undefined) u.searchParams.set('limit', String(limit));
    if (offset) u.searchParams.set('offset', String(offset));
    const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
    const prefer = [];
    if (returning) prefer.push('return=representation');
    if (count) prefer.push('count=exact');
    if (prefer.length) headers.Prefer = prefer.join(',');
    const res = await fetchImpl(u.toString(), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch (e) { json = null; } }
    if (!res.ok) throw mapDbError(res.status, json);
    let total = null;
    const cr = res.headers && res.headers.get && res.headers.get('content-range');
    if (cr) { const m = /\/(\d+|\*)$/.exec(cr); if (m && m[1] !== '*') total = Number(m[1]); }
    return { rows: Array.isArray(json) ? json : [], total };
  }

  return {
    async select(table, opts = {}) { return (await request('GET', table, opts)).rows; },
    async selectCount(table, opts = {}) { return (await request('GET', table, Object.assign({}, opts, { select: opts.select || 'id', limit: 1, count: true }))).total || 0; },
    async selectAll(table, opts = {}) {
      const all = [];
      for (let off = 0; ; off += PAGE) {
        const rows = (await request('GET', table, Object.assign({}, opts, { limit: PAGE, offset: off }))).rows;
        all.push(...rows);
        if (rows.length < PAGE) break;
      }
      return all;
    },
    async insert(table, rows) { return (await request('POST', table, { body: rows, returning: true })).rows; },
    async update(table, filters, patch) { return (await request('PATCH', table, { filters, body: patch, returning: true })).rows; },
    async remove(table, filters) { return (await request('DELETE', table, { filters, returning: true })).rows; },
  };
}

module.exports = { makeDb, mapDbError, filterParam };
