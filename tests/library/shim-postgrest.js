// 테스트용 PostgREST 흉내: /rest/v1/:table 의 GET/POST/PATCH/DELETE (eq, neq, in, is, order, limit, offset, count)
const http = require('http');
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.PGHOST, port: Number(process.env.PGPORT), user: 'postgres', database: 'lib' });
const ident = s => { if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw Object.assign(new Error('bad ident ' + s), { status: 400 }); return '"' + s + '"'; };

function parseList(s) { // (a,b,"c d")
  const inner = s.slice(1, -1); const out = []; let cur = '', q = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (q) { if (ch === '\\') { cur += inner[++i]; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}
function buildWhere(searchParams, params) {
  const conds = [];
  for (const [k, v] of searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    const i = v.indexOf('.'); const op = v.slice(0, i), val = v.slice(i + 1);
    if (op === 'eq') { params.push(val); conds.push(ident(k) + '::text = $' + params.length); }
    else if (op === 'neq') { params.push(val); conds.push(ident(k) + '::text <> $' + params.length); }
    else if (op === 'in') { params.push(parseList(val)); conds.push(ident(k) + '::text = any($' + params.length + '::text[])'); }
    else if (op === 'is') { conds.push(ident(k) + ' is ' + (val === 'null' ? 'null' : 'not null')); }
    else throw Object.assign(new Error('bad op ' + op), { status: 400 });
  }
  return conds.length ? ' where ' + conds.join(' and ') : '';
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Expose-Headers': 'Content-Range' };
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  const u = new URL(req.url, 'http://x');
  const chunks = []; for await (const c of req) chunks.push(c);
  const bodyText = Buffer.concat(chunks).toString('utf8');
  const send = (st, obj, headers = {}) => { res.writeHead(st, Object.assign({ 'Content-Type': 'application/json' }, CORS, headers)); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
  try {
    if (!req.headers.apikey || !/^Bearer /.test(req.headers.authorization || '')) return send(401, { message: 'no key' });
    const m = /^\/rest\/v1\/([a-z_]+)$/.exec(u.pathname);
    if (!m) return send(404, { message: 'not found' });
    const table = ident(m[1]); const prefer = req.headers.prefer || '';
    const params = []; let sql, result;
    if (req.method === 'GET') {
      const sel = u.searchParams.get('select') || '*';
      const cols = sel === '*' ? '*' : sel.split(',').map(ident).join(',');
      const where = buildWhere(u.searchParams, params);
      let q = 'select ' + cols + ' from ' + table + where;
      const ord = u.searchParams.get('order');
      if (ord) q += ' order by ' + ord.split(',').map(o => { const [c, d] = o.split('.'); return ident(c) + (d === 'desc' ? ' desc' : ' asc'); }).join(',');
      const lim = u.searchParams.get('limit'), off = u.searchParams.get('offset');
      if (lim) q += ' limit ' + Number(lim); if (off) q += ' offset ' + Number(off);
      result = await pool.query(q, params);
      const headers = {};
      if (prefer.includes('count=exact')) {
        const p2 = []; const w2 = buildWhere(u.searchParams, p2);
        const c = await pool.query('select count(*)::int n from ' + table + w2, p2);
        headers['Content-Range'] = (result.rows.length ? '0-' + (result.rows.length - 1) : '*') + '/' + c.rows[0].n;
      }
      return send(200, result.rows, headers);
    }
    if (req.method === 'POST') {
      const rows = JSON.parse(bodyText); const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
      const vals = []; const tuples = rows.map(r => '(' + cols.map(c => { vals.push(r[c] === undefined ? null : r[c]); return '$' + vals.length; }).join(',') + ')');
      result = await pool.query('insert into ' + table + ' (' + cols.map(ident).join(',') + ') values ' + tuples.join(',') + ' returning *', vals);
      return send(201, result.rows);
    }
    if (req.method === 'PATCH') {
      const patch = JSON.parse(bodyText); const sets = Object.keys(patch).map(k => { params.push(patch[k]); return ident(k) + ' = $' + params.length; });
      const where = buildWhere(u.searchParams, params);
      result = await pool.query('update ' + table + ' set ' + sets.join(',') + where + ' returning *', params);
      return send(200, result.rows);
    }
    if (req.method === 'DELETE') {
      const where = buildWhere(u.searchParams, params);
      result = await pool.query('delete from ' + table + where + ' returning *', params);
      return send(200, result.rows);
    }
    send(405, { message: 'method' });
  } catch (e) {
    send(e.status || (e.code ? 400 : 500), { code: e.code, message: e.message, details: e.detail });
  }
});
module.exports = { listen: port => new Promise(r => server.listen(port, '127.0.0.1', r)), close: () => new Promise(r => server.close(r)), pool };
