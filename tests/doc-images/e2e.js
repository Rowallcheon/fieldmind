// 문서 사진 기능 브라우저 시험 (실제 Supabase 없이: 가짜 저장소/DB/Gemini 응답 사용)
// 실행: node tests/doc-images/e2e.js   (Playwright + Chromium 필요)
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const PORT = 54340, BASE = 'http://127.0.0.1:' + PORT;
const INDEX = path.join(__dirname, '..', '..', 'index.html');

// ── 시험용 큰 PNG(1800x1000) 만들기 ──
function crc32(buf) { let c, crc = ~0; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function makePng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { const o = y * (w * 3 + 1); raw[o] = 0; for (let x = 0; x < w; x++) { const i = o + 1 + x * 3, band = (Math.floor(x / 90) + Math.floor(y / 60)) % 2; raw[i] = band ? 200 : 40 + (x % 200); raw[i + 1] = band ? 220 : 90 + (y % 150); raw[i + 2] = band ? 240 : 160; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const BIG = makePng(1800, 1000);
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });

// ── 가짜 서버: 화면 + 사진 저장소 ──
const files = new Map(), tokens = new Map(), apiLog = [];
let loginOk = true, failNextImg = false, sigN = 0;
const NAME_RE = /^[a-z0-9]{8,24}\.(webp|jpg)$/;
const srv = http.createServer((req, res) => {
  const [u, qs] = req.url.split('?');
  const json = (st, o) => { res.statusCode = st; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  if (u === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(fs.readFileSync(INDEX)); }
  const chunks = []; req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    if (u.startsWith('/__up/') && req.method === 'POST') {
      const name = decodeURIComponent(u.slice(6));
      if (tokens.get(name) !== req.headers['x-token']) return json(403, { error: 'bad token' });
      files.set(name, { body: raw, type: req.headers['content-type'] }); return res.end('ok');
    }
    if (u.startsWith('/__img/')) {                      // 서명된 임시 주소로만 사진을 내려줌
      const name = decodeURIComponent(u.slice(7)), f = files.get(name);
      if (!/sig=ok\d+/.test(qs || '') || !f) { res.statusCode = 403; return res.end('no'); }
      if (failNextImg) { failNextImg = false; res.statusCode = 403; return res.end('expired'); }
      res.setHeader('Content-Type', f.type); return res.end(f.body);
    }
    if (u.startsWith('/api/')) {
      let b = {}; try { b = JSON.parse(raw.toString() || '{}'); } catch (e) {}
      const auth = req.headers.authorization || '';
      apiLog.push({ u, b, auth });
      if (u === '/api/library-login') return loginOk ? json(200, { token: b.id === 'admin' ? 'TOK-ADMIN' : 'TOK-USER', expiresIn: 28800, user: { id: b.id } }) : json(404, { error: 'nf' });
      if (!/^Bearer TOK-(ADMIN|USER)$/.test(auth)) return json(401, { error: '로그인이 필요합니다.' });
      if (u === '/api/doc-image-upload-url') {
        if (auth !== 'Bearer TOK-ADMIN') return json(403, { error: '관리자만 사용할 수 있습니다.' });
        const name = Math.random().toString(36).slice(2, 14).padEnd(12, 'x') + '.' + b.ext, token = 'UP' + Math.random().toString(36).slice(2);
        tokens.set(name, token);
        return json(200, { name, path: name, token, bucket: 'doc-images', contentType: b.ext === 'webp' ? 'image/webp' : 'image/jpeg', maxBytes: 2097152 });
      }
      if (u === '/api/doc-image-url') {
        const urls = {}; (b.names || []).forEach(n => { urls[n] = NAME_RE.test(n) && files.has(n) ? BASE + '/__img/' + n + '?sig=ok' + (++sigN) : null; });
        return json(200, { urls, expiresIn: 300 });
      }
    }
    res.statusCode = 404; res.end();
  });
});

// ── 가짜 supabase-js ──
const FIXTURE = {
  users: [{ id: 'admin', pw: '1234', name: '관리자', role: 'admin', status: 'active' }, { id: 'u1', pw: '1234', name: '사용자', role: 'user', status: 'active' }],
  products: [{ id: 'p1', name: '사무행정', icon: '🗂️', sort_order: 1 }],
  models: [{ id: 'm1', product_id: 'p1', name: '그룹웨어', sort_order: 1 }],
  documents: [], app_settings: [{ key: 'gemini_api_key', value: 'AIzaFAKEFAKEFAKE' }],
  notices: [], inquiries: [], chat_logs: [], groups: [], group_members: [], group_products: [], user_chat_logs: []
};
const STUB = `(function(){
 const FX=${JSON.stringify(FIXTURE)}; window.__writes=[];
 function mk(t){ const q={}; ['select','order','eq','match','in','gte','limit','neq','is','range'].forEach(k=>q[k]=()=>q);
  ['insert','update','delete','upsert'].forEach(k=>q[k]=(...a)=>{ window.__writes.push({t,k,a}); return Promise.resolve({data:null,error:null}); });
  q.then=(res,rej)=>Promise.resolve({data:(FX[t]||[]).slice(),error:null,count:0}).then(res,rej); return q; }
 window.supabase={createClient:()=>({from:mk, rpc:()=>Promise.resolve({data:null,error:{message:'x'}}),
  storage:{from:(b)=>({uploadToSignedUrl:async(path,token,blob,o)=>{ window.__uploads=(window.__uploads||[]); window.__uploads.push({b,name:path,token,type:blob.type,size:blob.size,opts:o});
     const r=await fetch('${BASE}/__up/'+encodeURIComponent(path),{method:'POST',body:blob,headers:{'Content-Type':blob.type,'x-token':token}}); return r.ok?{data:{path},error:null}:{data:null,error:{message:'upload '+r.status}}; }})}})};
})()`;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

(async () => {
  await new Promise(r => srv.listen(PORT, r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push('console: ' + m.text()); });
  let geminiReq = null, geminiReply = '';
  await page.route('**/*', async r => {
    const u = r.request().url();
    if (u.includes('supabase-js')) return r.fulfill({ contentType: 'application/javascript', body: STUB });
    if (u.includes('generativelanguage.googleapis.com')) { geminiReq = JSON.parse(r.request().postData()); return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: geminiReply }] } }] }) }); }
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    return r.abort();
  });
  const dialogs = []; let dialogAnswer = false;
  page.on('dialog', d => { dialogs.push(d.message()); dialogAnswer ? d.accept() : d.dismiss(); });

  console.log('[관리자: 문서 입력창]');
  await page.goto(BASE + '/'); await page.waitForTimeout(600);
  await page.fill('#login-id', 'admin'); await page.fill('#login-pw', '1234'); await page.click('.login-btn');
  await page.waitForSelector('#screen-admin.active', { timeout: 8000 });
  await page.evaluate(() => { openDocInputModal(0, 0); });
  await page.waitForSelector('#modal-doc-input.open');
  const hidden = () => page.inputValue('#doc-input-content');

  await page.fill('#doc-input-title', '결재 올리는 방법');
  await page.fill('#doc-editor .de-text', '1. 그룹웨어에 접속합니다.\n2. 상단의 결재 메뉴를 누릅니다.\n3. 완료합니다.');
  await page.evaluate(() => { const t = document.querySelector('#doc-editor .de-text'); const p = t.value.indexOf('3. 완료'); t.focus(); t.setSelectionRange(p, p); t.dispatchEvent(new Event('keyup')); });
  await page.setInputFiles('#doc-img-file', { name: 'cap.png', mimeType: 'image/png', buffer: BIG });
  await page.waitForSelector('#doc-editor .de-img', { timeout: 8000 });
  const up = await page.evaluate(() => window.__uploads);
  ok(up && up.length === 1 && up[0].b === 'doc-images' && /^UP/.test(up[0].token), '사진이 doc-images 저장소로, 서버가 준 업로드 토큰으로 올라간다');
  ok(apiLog.some(a => a.u === '/api/doc-image-upload-url' && a.auth === 'Bearer TOK-ADMIN' && a.b.ext === 'webp'), '업로드 토큰은 관리자 로그인 토큰으로 요청한다');
  ok(!apiLog.some(a => a.u === '/api/doc-image-upload-url' && 'name' in a.b), '파일 이름은 화면이 정하지 않고 서버가 정한다');
  ok(up && /^[a-z0-9]{8,24}\.webp$/.test(up[0].name), '파일명이 무작위 영소문자/숫자 + .webp 이다 (' + (up && up[0].name) + ')');
  ok(up && up[0].type === 'image/webp', '브라우저가 WebP로 변환했다');
  ok(up && up[0].size < BIG.length / 5 && up[0].size < 1.9 * 1024 * 1024, '용량이 크게 줄었다 (' + BIG.length + ' → ' + (up && up[0].size) + ' bytes)');

  const layout = await page.$$eval('#doc-editor > *', l => l.map(e => e.classList.contains('de-img') ? 'IMG' : 'TEXT:' + e.value));
  ok(layout.length === 3 && layout[0].startsWith('TEXT:1. 그룹웨어') && layout[0].includes('2. 상단') && layout[1] === 'IMG' && layout[2] === 'TEXT:3. 완료합니다.', '사진이 커서 위치(2번과 3번 사이)에 그림 칸으로 들어가고 글은 앞뒤로 나뉜다');
  const visible = await page.$eval('#doc-editor', e => e.innerText + Array.from(e.querySelectorAll('textarea,input')).map(x => x.value + x.placeholder).join(''));
  ok(!/\[\[그림|\.webp/.test(visible), '입력 화면에 그림 코드(파일명)가 보이지 않는다');
  const wh = await page.$eval('#doc-editor .de-img img', i => new Promise(r => { if (i.complete && i.naturalWidth) return r([i.naturalWidth, i.naturalHeight]); i.onload = () => r([i.naturalWidth, i.naturalHeight]); setTimeout(() => r([0, 0]), 3000); }));
  ok(wh[0] === 1000 && wh[1] === 556, '글 쓰는 자리에 사진 미리보기가 바로 보이고 가로 1000px로 줄었다 (' + wh.join('x') + ')');
  ok(await page.$eval('#doc-editor .de-cap', e => document.activeElement === e && e.classList.contains('empty') && e.value === ''), '사진 아래 설명 칸에 커서가 가 있고, 비어 있으면 빨간 테두리로 표시된다');
  ok((await hidden()).includes('[[그림:' + up[0].name + '|]]') && (await hidden()).indexOf('[[그림') > (await hidden()).indexOf('2. 상단'), '저장 형식(숨김)에는 자리표가 같은 위치에 만들어진다');
  ok((await page.textContent('#char-count')) === String('1. 그룹웨어에 접속합니다.\n2. 상단의 결재 메뉴를 누릅니다.'.length + '3. 완료합니다.'.length), '글자 수에는 사진 코드가 포함되지 않는다');
  await page.screenshot({ path: path.join(OUT, 'admin-modal.png') });

  // 설명 비운 채 저장 → 확인창, 취소하면 저장 안 됨
  await page.evaluate(() => { window.__writes.length = 0; });
  dialogAnswer = false; await page.click('#modal-doc-input .modal-actions .btn-primary'); await page.waitForTimeout(300);
  ok(dialogs.length === 1 && /설명이 없습니다/.test(dialogs[0]), '설명이 비었으면 저장 전에 확인창이 뜬다');
  ok(!(await page.evaluate(() => window.__writes.some(w => w.t === 'documents'))), '확인창에서 취소하면 저장되지 않는다');

  // 설명 입력 후 저장 (설명 칸에 커서가 있으므로 바로 입력)
  await page.click('#doc-editor .de-cap');
  await page.keyboard.type('결재 메뉴 위치 (화면 상단 가운데)');
  ok(!(await page.$eval('#doc-editor .de-cap', e => e.classList.contains('empty'))) && (await hidden()).includes('|결재 메뉴 위치 (화면 상단 가운데)]]'), '설명을 쓰면 빨간 표시가 사라지고 저장 형식에 설명이 반영된다');
  dialogs.length = 0; await page.click('#modal-doc-input .modal-actions .btn-primary'); await page.waitForTimeout(300);
  const w = await page.evaluate(() => window.__writes.filter(x => x.t === 'documents' && x.k === 'insert'));
  ok(dialogs.length === 0 && w.length === 1, '설명이 있으면 확인창 없이 저장된다');
  const saved = w[0] && w[0].a[0].content;
  ok(saved && saved.includes('[[그림:' + up[0].name + '|결재 메뉴 위치 (화면 상단 가운데)]]'), '문서 글에 [[그림:파일명|설명]] 형태로 저장된다');
  ok(saved === '1. 그룹웨어에 접속합니다.\n2. 상단의 결재 메뉴를 누릅니다.\n[[그림:' + up[0].name + '|결재 메뉴 위치 (화면 상단 가운데)]]\n3. 완료합니다.', '저장된 글이 "앞 글 / 사진 / 뒷 글" 순서 그대로다');
  const card = await page.$eval('#existing-docs-list .doc-card', e => e.textContent);
  ok(/🖼️/.test(card) && !/\[\[그림/.test(card), '등록된 문서 목록에는 자리표 대신 🖼️ 로 보인다');
  ok((await page.$$('#doc-editor .de-img')).length === 0 && (await hidden()) === '', '저장 후 입력 칸은 비워진다');

  // 저장된 문서를 다시 열면(수정) 그림 칸으로 복원되고, 그대로 저장해도 글이 같다
  await page.evaluate(() => { editDocContent(0); });
  const re = await page.$$eval('#doc-editor > *', l => l.map(e => e.classList.contains('de-img') ? 'IMG:' + e.querySelector('.de-cap').value : 'TEXT'));
  ok(re.length === 3 && re[1] === 'IMG:결재 메뉴 위치 (화면 상단 가운데)', '수정 화면에서 사진 칸과 설명이 그대로 복원된다');
  ok((await hidden()) === saved, '불러왔다가 다시 직렬화해도 저장 형식이 똑같다');
  const wh2 = await page.$eval('#doc-editor .de-img img', i => new Promise(r => { const ck = () => i.complete && i.naturalWidth ? r(i.naturalWidth) : setTimeout(ck, 100); ck(); setTimeout(() => r(0), 5000); }));
  ok(wh2 === 1000, '수정 화면의 사진은 서버가 준 임시 주소로 불러와진다');
  await page.evaluate(() => { openDocInputModal(0, 0); });

  // 붙여넣기(Ctrl+V)
  await page.evaluate(() => { document.querySelector('#doc-editor .de-text').focus(); });
  await page.evaluate(async (b64) => {
    const bin = atob(b64), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    const dt = new DataTransfer(); dt.items.add(new File([a], 'p.png', { type: 'image/png' }));
    document.querySelector('#doc-editor .de-text').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, BIG.toString('base64'));
  await page.waitForSelector('#doc-editor .de-img', { timeout: 8000 });
  ok((await page.evaluate(() => window.__uploads.length)) === 2, '캡처 이미지를 붙여넣기(Ctrl+V)해도 올라간다');
  await page.click('#doc-editor .de-imgbox .x'); await page.waitForTimeout(100);
  ok((await page.$$('#doc-editor .de-img')).length === 0 && (await page.$$('#doc-editor .de-text')).length === 1 && (await hidden()) === '', '✕ 를 누르면 사진 칸이 빠지고 글 칸이 하나로 합쳐진다');
  // 사진이 아닌 파일
  await page.setInputFiles('#doc-img-file', { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await page.waitForTimeout(300);
  ok((await page.evaluate(() => window.__uploads.length)) === 2, '사진이 아닌 파일은 올라가지 않는다');
  // 두 장 연속 + 글 사이
  await page.fill('#doc-editor .de-text', 'AAA\nBBB');
  await page.evaluate(() => { const t = document.querySelector('#doc-editor .de-text'); t.focus(); t.setSelectionRange(3, 3); t.dispatchEvent(new Event('keyup')); });
  await page.setInputFiles('#doc-img-file', [{ name: 'a.png', mimeType: 'image/png', buffer: BIG }, { name: 'b.png', mimeType: 'image/png', buffer: BIG }]);
  await page.waitForFunction(() => document.querySelectorAll('#doc-editor .de-img').length === 2, null, { timeout: 12000 });
  const lay2 = await page.$$eval('#doc-editor > *', l => l.map(e => e.classList.contains('de-img') ? 'IMG' : 'T:' + e.value));
  ok(JSON.stringify(lay2) === JSON.stringify(['T:AAA', 'IMG', 'IMG', 'T:BBB']) || JSON.stringify(lay2) === JSON.stringify(['T:AAA', 'IMG', 'T:', 'IMG', 'T:BBB']), '여러 장을 한 번에 올리면 차례대로 같은 위치에 이어서 들어간다 (' + lay2.join(' | ') + ')');
  await page.evaluate(() => { setDocContent(''); closeModal('modal-doc-input'); });

  // ── 사용자 챗봇 ──
  console.log('[사용자: 챗봇 답변]');
  const name = up[0].name;
  // 저장된 문서가 챗봇 컨텍스트에 있도록 데이터에 반영(저장 시 이미 화면 데이터에 push 됨)
  await page.evaluate(() => { closeModal('modal-doc-input'); doLogout(); }); await page.waitForTimeout(300);
  await page.fill('#login-id', 'u1'); await page.fill('#login-pw', '1234'); await page.click('.login-btn');
  await page.waitForSelector('#screen-chat.active', { timeout: 8000 });
  await page.evaluate(() => { selProduct = products[0]; selModel = products[0].models[0]; });
  geminiReply = '결재는 아래 순서로 올립니다.\n1. 상단 결재 메뉴를 누릅니다.\n[[그림:' + name + ']]\n2. 완료합니다.\n[[그림:zzzzzzzzzz.exe]]\n[[그림:ab12.webp]]\n[[참조: 1]]';
  await page.evaluate(() => { document.getElementById('chat-inp').value = '결재 올리는 법'; sendMsg(); });
  await page.waitForSelector('.msg.bot .chat-img', { timeout: 8000 });
  await page.setViewportSize({ width: 390, height: 800 }); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'chat-mobile.png') });
  await page.setViewportSize({ width: 1100, height: 900 });
  const sys = geminiReq.system_instruction.parts[0].text;
  ok(sys.includes('[[그림:' + name + '|결재 메뉴 위치 (화면 상단 가운데)]]'), 'AI에게 보내는 문서에 사진 자리표와 설명이 들어간다');
  ok(/\[\[그림:파일명\]\] 만 그대로 출력/.test(sys), '사진 표시 규칙이 AI 지시문에 들어간다');
  ok(JSON.stringify(geminiReq).length < 6000, 'AI 요청에 사진 데이터는 없다 (글만: ' + JSON.stringify(geminiReq).length + ' bytes)');
  const imgs = await page.$$eval('.msg.bot .chat-img', l => l.map(i => i.getAttribute('src')));
  ok(imgs.length === 1 && imgs[0].includes('/__img/' + name + '?sig=ok'), '답변에 사진이 한 장, 서버가 준 임시 주소(서명 포함)로 표시된다 (형식이 틀린 파일명은 무시)');
  const lastUrlReq = apiLog.filter(a => a.u === '/api/doc-image-url').pop();
  ok(lastUrlReq && lastUrlReq.auth === 'Bearer TOK-USER' && lastUrlReq.b.names.length === 1 && lastUrlReq.b.names[0] === name, '임시 주소는 사용자 로그인 토큰으로 요청하고, 형식이 틀린 이름은 요청에 넣지 않는다' + (lastUrlReq ? ' ' + JSON.stringify(lastUrlReq).slice(0, 200) : ''));
  ok(await page.evaluate(() => docImgCache.size) >= 1, '받은 임시 주소가 화면에 보관된다');
  const direct = await fetch(BASE + '/__img/' + name);
  ok(direct.status === 403, '임시 주소(서명) 없이 사진 주소를 직접 열면 거부된다');
  const nat = await page.$eval('.msg.bot .chat-img', i => new Promise(r => { if (i.complete) return r(i.naturalWidth); i.onload = () => r(i.naturalWidth); setTimeout(() => r(0), 3000); }));
  ok(nat === 1000, '사진이 실제로 불러와진다');
  const bubble = await page.$eval('.msg.bot .msg-bubble', e => e.textContent);
  ok(!/\[\[그림|\[\[참조/.test(bubble), '답변 글에 [[ ]] 표시가 남지 않는다' + (/\[\[/.test(bubble) ? ' → ' + bubble.slice(-80) : ''));
  const ttsText = await page.$eval('.msg.bot .tts-speak-btn', b => b.dataset.text);
  ok(!/그림|webp/.test(ttsText), '읽기(음성)에서 사진 파일명을 읽지 않는다');
  await page.click('.msg.bot .chat-img');
  ok(await page.$eval('#img-lb', e => e.classList.contains('open')) && (await page.$eval('#img-lb-img', i => i.getAttribute('src'))).includes('/__img/' + name), '사진을 누르면 크게 보기가 열린다');
  await page.keyboard.press('Escape');
  ok(!(await page.$eval('#img-lb', e => e.classList.contains('open'))), '닫으면 크게 보기가 닫힌다');
  // 사진이 20장을 넘으면 20장까지만
  const many = Array.from({ length: 24 }, () => '[[그림:' + name + ']]').join('\n');
  const html = await page.evaluate(m => mdToHtml(m), many);
  ok((html.match(/<img /g) || []).length === 20, '한 답변에 사진은 최대 20장까지만 보인다');
  // 설명(alt)에 따옴표·태그가 있어도 깨지거나 실행되지 않음
  const safe = await page.evaluate(n => { const d = document.createElement('div'); d.innerHTML = mdToHtml('[[그림:' + n + '|"><script>window.__x=1</script><img src=x onerror=window.__x=2>]]'); return { script: !!d.querySelector('script'), imgs: d.querySelectorAll('img').length, onerr: d.querySelector('img').getAttribute('onerror') }; }, name);
  ok(!safe.script && safe.imgs === 1 && /^docImgFail/.test(safe.onerr), '설명 글에 태그·따옴표가 있어도 실행되지 않는다');
  // 임시 주소가 만료된 경우: 한 번 새 주소를 받아 다시 시도
  await page.evaluate(n => { docImgCache.clear(); }, name);
  failNextImg = true;
  const n0 = apiLog.filter(a => a.u === '/api/doc-image-url').length;
  await page.evaluate(n => { appendMsg('bot', '다시 보여드립니다.\n[[그림:' + n + ']]', null); }, name);
  await page.waitForFunction(() => { const i = Array.from(document.querySelectorAll('.msg.bot .chat-img')).pop(); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 });
  ok(apiLog.filter(a => a.u === '/api/doc-image-url').length === n0 + 2, '만료된 주소는 새 주소를 한 번 더 받아 불러온다 (요청 ' + (apiLog.filter(a => a.u === '/api/doc-image-url').length - n0) + '회)');
  // 같은 사진을 다시 보여줄 때는 주소를 새로 요청하지 않는다(5분 보관)
  const n1 = apiLog.filter(a => a.u === '/api/doc-image-url').length;
  await page.evaluate(n => { appendMsg('bot', '한 번 더.\n[[그림:' + n + ']]', null); }, name);
  await page.waitForFunction(() => { const i = Array.from(document.querySelectorAll('.msg.bot .chat-img')).pop(); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 });
  ok(apiLog.filter(a => a.u === '/api/doc-image-url').length === n1, '이미 받은 임시 주소는 5분 동안 다시 쓴다 (서버 요청 없음)');
  await page.evaluate(() => { libReset(); });
  ok(await page.evaluate(() => docImgCache.size) === 0, '로그아웃하면 사진 임시 주소 보관분도 지워진다');
  // 로그인 토큰이 없으면(서버 미설정/만료) 깨진 그림 대신 안내 문구
  await page.evaluate(n => { libToken = null; docImgCache.clear(); appendMsg('bot', '사진 없이 보이는지.\n[[그림:' + n + ']]', null); }, name);
  await page.waitForSelector('.msg.bot:last-child .chat-img-miss', { timeout: 8000 });
  ok(/불러올 수 없습니다/.test(await page.$eval('.msg.bot:last-child .chat-img-miss', e => e.textContent)), '로그인 정보가 없으면 "사진을 불러올 수 없습니다" 안내가 나온다');
  ok(errs.length === 0, '페이지 오류 없음' + (errs.length ? ' ' + JSON.stringify(errs) : ''));

  await browser.close(); srv.close();
  console.log('\n통과 ' + pass + ' / 실패 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('시험 중단:', e); process.exit(2); });
