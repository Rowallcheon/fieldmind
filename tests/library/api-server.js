// 테스트용: /api/* 를 실제 핸들러로 연결하고 index.html 등 정적 파일도 제공
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
function create(port) {
  const handlers = {};
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/api/')) {
      const name = u.pathname.slice(5);
      if (!/^[a-z-]+$/.test(name) || !fs.existsSync(path.join(ROOT, 'api', name + '.js'))) { res.writeHead(404); return res.end('{}'); }
      handlers[name] = handlers[name] || require(path.join(ROOT, 'api', name + '.js'));
      const chunks = []; for await (const c of req) chunks.push(c);
      const text = Buffer.concat(chunks).toString('utf8');
      // Vercel처럼 JSON 본문은 미리 파싱해서 req.body 로 전달
      req.body = text ? (() => { try { return JSON.parse(text); } catch (e) { return text; } })() : undefined;
      res.status = c => { res.statusCode = c; return res; };
      return handlers[name](req, res);
    }
    const file = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return { listen: () => new Promise(r => server.listen(port, '127.0.0.1', r)), close: () => new Promise(r => server.close(r)) };
}
module.exports = { create };
