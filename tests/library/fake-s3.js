// 테스트용 R2 흉내: 임시 주소(SigV4 쿼리 서명)를 실제로 다시 계산해 검증하고 PUT/GET/HEAD/DELETE 처리
const http = require('http');
const { presignUrl } = require('../../api/_lib/r2');
const store = new Map();
const ACCESS = process.env.R2_ACCESS_KEY_ID, SECRET = process.env.R2_SECRET_ACCESS_KEY;
let clock = () => new Date();
const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,PUT,HEAD,DELETE,OPTIONS', 'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': 'ETag,Content-Length' };
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  const full = 'http://' + req.headers.host + req.url;
  const u = new URL(full);
  const sig = u.searchParams.get('X-Amz-Signature');
  const fail = (st, msg) => { res.writeHead(st, CORS); res.end(msg); };
  if (!sig) return fail(403, 'no signature');
  const amzDate = u.searchParams.get('X-Amz-Date'), exp = Number(u.searchParams.get('X-Amz-Expires'));
  const t = new Date(amzDate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
  if (clock() > new Date(t.getTime() + exp * 1000)) return fail(403, 'expired');
  const stripped = new URL(full); ['X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date', 'X-Amz-Expires', 'X-Amz-SignedHeaders', 'X-Amz-Signature'].forEach(k => stripped.searchParams.delete(k));
  const expected = presignUrl({ method: req.method, url: stripped.toString(), accessKeyId: ACCESS, secretAccessKey: SECRET, expires: exp, now: t });
  if (new URL(expected).searchParams.get('X-Amz-Signature') !== sig) return fail(403, 'signature mismatch');
  const key = decodeURIComponent(u.pathname);
  if (req.method === 'PUT') { store.set(key, { body, type: req.headers['content-type'] || 'application/octet-stream' }); res.writeHead(200, CORS); return res.end(); }
  const obj = store.get(key);
  if (req.method === 'DELETE') { store.delete(key); res.writeHead(204, CORS); return res.end(); }
  if (!obj) return fail(404, 'NoSuchKey');
  res.writeHead(200, Object.assign({ 'Content-Length': obj.body.length, 'Content-Type': obj.type }, CORS));
  res.end(req.method === 'HEAD' ? undefined : obj.body);
});
module.exports = { listen: port => new Promise(r => server.listen(port, '127.0.0.1', r)), close: () => new Promise(r => server.close(r)), store, setClock: f => { clock = f; } };
