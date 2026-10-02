require('./env');
const fs = require('fs'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const shim = require('./shim-postgrest'), s3 = require('./fake-s3'), srv = require('./api-server').create(54332);
const BASE = 'http://127.0.0.1:54332';
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const STUB = `(function(){
 function mk(t){ const q={ select(){return q}, order(){return q}, eq(){return q}, match(){return q}, in(){return q}, gte(){return q}, limit(){return q}, insert(){return q}, update(){return q}, delete(){return q}, upsert(){return q},
  then(res,rej){ return fetch('http://127.0.0.1:54330/rest/v1/'+t+'?select=*',{headers:{apikey:'k',Authorization:'Bearer k'}}).then(r=>r.json()).then(d=>({data:Array.isArray(d)?d:[],error:null,count:0})).then(res,rej);} }; return q; }
 window.supabase={createClient:()=>({from:mk, rpc:()=>Promise.resolve({data:null,error:{message:'x'}})})};})()`;
async function api(name, body, token) {
  const r = await fetch(BASE + '/api/' + name, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: JSON.stringify(body || {}) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
async function uploadFile(token, fileName, bytes, extra) {
  const u = await api('library-upload-url', { fileName, size: bytes.length }, token);
  await fetch(u.json.uploadUrl, { method: 'PUT', body: bytes, headers: { 'Content-Type': u.json.contentType } });
  return (await api('library-admin', Object.assign({ action: 'doc.register', r2Key: u.json.r2Key, title: fileName }, extra), token)).json;
}
async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }, opts));
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push('console: ' + m.text()); });
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.includes('supabase-js')) return r.fulfill({ contentType: 'application/javascript', body: STUB });
    if (u.includes('cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js')) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(__dirname, 'node_modules/pdfjs-dist/build/pdf.min.js')) });
    if (u.includes('cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js')) return r.fulfill({ contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(path.join(__dirname, 'node_modules/pdfjs-dist/build/pdf.worker.min.js')) });
    if (u.startsWith('http://127.0.0.1') || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    return r.abort();
  });
  return { ctx, page, errs };
}
async function chatLogin(page, id, pw) {
  await page.goto(BASE + '/'); await page.waitForTimeout(700);
  await page.fill('#login-id', id); await page.fill('#login-pw', pw);
  await page.click('.login-btn'); await page.waitForSelector('#screen-chat.active, #screen-admin.active', { timeout: 8000 });
}
const start = () => Promise.all([shim.listen(54330), s3.listen(54331), srv.listen()]);
const stop = async () => { await Promise.all([shim.close(), s3.close(), srv.close()]); await shim.pool.end(); };
module.exports = { BASE, OUT, api, uploadFile, newPage, chatLogin, start, stop, shim, s3, chromium, fs, __dirname };
