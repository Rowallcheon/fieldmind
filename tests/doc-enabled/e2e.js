// 문서 사용 켜기/끄기(눈 아이콘) + 사용자 화면 모델 목록에서 문서 건수 제거 브라우저 시험 (가짜 DB/Gemini)
// 실행: node tests/doc-enabled/e2e.js   (Playwright + Chromium 필요)
const http = require('http'), fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const PORT = 54342, BASE = 'http://127.0.0.1:' + PORT, INDEX = path.join(__dirname, '..', '..', 'index.html');
const srv = http.createServer((req, res) => { if (req.url.split('?')[0] === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(fs.readFileSync(INDEX)); } res.statusCode = 404; res.end(); });
const FIXTURE = {
  users: [{ id: 'admin', pw: '1234', name: '관리자', role: 'admin', status: 'active' }, { id: 'u1', pw: '1234', name: '사용자', role: 'user', status: 'active' }],
  products: [{ id: 'p1', name: '사무행정', icon: '🗂️', sort_order: 1 }],
  models: [{ id: 'm1', product_id: 'p1', name: '그룹웨어', sort_order: 1 }, { id: 'm2', product_id: 'p1', name: 'ERP', sort_order: 2 }],
  documents: [
    { id: 'd1', model_id: 'm1', title: '결재 방법', cat: '기술교본', content: '결재 본문 내용입니다 AAA', created_at: '2026-01-01T00:00:00Z' },
    { id: 'd2', model_id: 'm1', title: '휴가 신청', cat: '사용설명서', content: '휴가 신청 본문 내용입니다 BBB', created_at: '2026-01-02T00:00:00Z' },
    { id: 'd3', model_id: 'm1', title: '출장 신청', cat: '기타', content: '출장 신청 본문 내용입니다 CCC', enabled: false, created_at: '2026-01-03T00:00:00Z' },
    { id: 'd4', model_id: 'm2', title: '전표 입력', cat: '기술교본', content: '전표 입력 본문 내용입니다 DDD', created_at: '2026-01-04T00:00:00Z' }],
  groups: [{ id: 'g1', name: '행정팀' }], group_products: [{ group_id: 'g1', product_id: 'p1' }], group_members: [{ group_id: 'g1', user_id: 'u1' }],
  app_settings: [{ key: 'gemini_api_key', value: 'AIzaFAKEFAKEFAKE' }], notices: [], inquiries: [], chat_logs: [], user_chat_logs: []
};
const STUB = `(function(){
 const FX=${JSON.stringify(FIXTURE)}; window.__writes=[]; window.__failNext=null;
 const rec=(t,k,a,m)=>{ window.__writes.push({t,k,a,m}); const f=window.__failNext; if(f&&f===t+'.'+k){window.__failNext=null; return Promise.resolve({error:{message:'fail'}});} return Promise.resolve({error:null}); };
 function mk(t){ const q={}; ['select','order','eq','neq','in','gte','limit','is','range'].forEach(k=>q[k]=()=>q);
  q.insert=a=>rec(t,'insert',a); q.upsert=a=>rec(t,'upsert',a); q.update=a=>({match:m=>rec(t,'update',a,m)}); q.delete=()=>({match:m=>rec(t,'delete',null,m),in:()=>rec(t,'delete',null)});
  q.then=(res,rej)=>Promise.resolve({data:(FX[t]||[]).slice(),error:null,count:0}).then(res,rej); return q; }
 window.supabase={createClient:()=>({from:mk, rpc:()=>Promise.resolve({data:null,error:{message:'x'}}), storage:{from:()=>({})}})};
})()`;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
(async () => {
  await new Promise(r => srv.listen(PORT, r));
  const browser = await chromium.launch();
  const mkPage = async () => {
    const page = await (await browser.newContext({ viewport: { width: 1200, height: 1500 } })).newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|\{message: fail\}/.test(m.text())) errs.push('console: ' + m.text()); });
    page.gem = { req: null, reply: '' };
    await page.route('**/*', r => { const u = r.request().url();
      if (u.includes('supabase-js')) return r.fulfill({ contentType: 'application/javascript', body: STUB });
      if (u.includes('generativelanguage.googleapis.com')) { page.gem.req = JSON.parse(r.request().postData()); return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: page.gem.reply }] } }] }) }); }
      if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); return r.abort(); });
    page.errs = errs; return page;
  };
  const login = async (page, id) => { await page.goto(BASE + '/'); await page.waitForTimeout(600); await page.fill('#login-id', id); await page.fill('#login-pw', '1234'); await page.click('.login-btn'); };

  console.log('[관리자: 눈 아이콘]');
  const a = await mkPage(); await login(a, 'admin'); await a.waitForSelector('#screen-admin.active', { timeout: 8000 });
  await a.evaluate(() => { showPanel('docs'); const t = document.getElementById('doc-tree'); const open = () => document.querySelectorAll('.cat-models').forEach(x => x.classList.add('open')); new MutationObserver(open).observe(t, { childList: true }); open(); products.forEach((p, i) => p.models.forEach((m, j) => _docOpen.add(i + '-' + j))); renderDocTree(); });
  await a.waitForSelector('.dl-doc .dl-eye');
  const writes = () => a.evaluate(() => window.__writes.slice());
  const row = t => a.locator('.dl-doc', { hasText: t });
  await a.screenshot({ path: path.join(OUT, 'eye.png'), clip: { x: 230, y: 520, width: 970, height: 380 } });
  ok((await a.$$('.dl-doc .dl-eye')).length === 4, '문서마다 눈 아이콘이 있다 (4건)');
  ok(await row('결재 방법').locator('.dl-eye').getAttribute('data-eye') === 'on' && await row('출장 신청').locator('.dl-eye').getAttribute('data-eye') === 'off', '사용 중인 문서는 열린 눈, 꺼 둔 문서(출장 신청)는 눈에 줄이 그어진 아이콘이다');
  ok(await row('출장 신청').locator('.off-tag').isVisible() && await row('출장 신청').evaluate(e => e.classList.contains('off')) && !(await row('결재 방법').locator('.off-tag').count()), '꺼 둔 문서에는 "사용 안 함" 표시와 흐린 글씨가 있다');
  ok(/사용 중입니다/.test(await row('결재 방법').locator('.dl-eye').getAttribute('title')) && /사용하지 않습니다/.test(await row('출장 신청').locator('.dl-eye').getAttribute('title')), '아이콘에 마우스를 올리면 현재 상태 설명이 나온다');
  await a.evaluate(() => window.__writes.length = 0);
  await row('결재 방법').locator('.dl-eye').click(); await a.waitForTimeout(300);
  const w1 = await writes();
  ok(w1.length === 1 && w1[0].t === 'documents' && w1[0].k === 'update' && w1[0].a.enabled === false && w1[0].m.id === 'd1', '눈을 누르면 그 문서만 DB에서 enabled=false로 바뀐다');
  ok(await row('결재 방법').locator('.dl-eye').getAttribute('data-eye') === 'off' && await row('결재 방법').locator('.off-tag').isVisible(), '화면에도 "사용 안 함"으로 바뀐다');
  ok(!(await row('결재 방법').locator('input').isChecked()) && (await a.textContent('#dl-count')).includes('0건'), '눈을 눌러도 문서 체크박스는 체크되지 않는다');
  ok(/사용하지 않습니다/.test(await a.textContent('#toast')), '안내 문구: 챗봇이 이 문서를 사용하지 않습니다 (문서는 그대로 보관)');
  await a.evaluate(() => window.__writes.length = 0);
  await row('출장 신청').locator('.dl-eye').click(); await a.waitForTimeout(300);
  const w2 = await writes();
  ok(w2.length === 1 && w2[0].a.enabled === true && w2[0].m.id === 'd3' && await row('출장 신청').locator('.dl-eye').getAttribute('data-eye') === 'on', '꺼 둔 문서의 눈을 누르면 다시 켜진다 (enabled=true)');
  await a.evaluate(() => { window.__failNext = 'documents.update'; });
  await row('휴가 신청').locator('.dl-eye').click(); await a.waitForTimeout(300);
  ok(/DB 저장 실패/.test(await a.textContent('#toast')) && await row('휴가 신청').locator('.dl-eye').getAttribute('data-eye') === 'on', 'DB 저장이 실패하면 상태를 바꾸지 않고 안내한다');
  await a.evaluate(() => openDocInputModal(0, 0)); await a.waitForSelector('#existing-docs-list .doc-card');
  ok((await a.$$('#existing-docs-list .dl-eye')).length === 3, '문서 입력창의 등록된 문서 목록에도 눈 아이콘이 있다');
  await a.evaluate(() => window.__writes.length = 0);
  await a.locator('#existing-docs-list .doc-card', { hasText: '휴가 신청' }).locator('.dl-eye').click(); await a.waitForTimeout(300);
  ok((await writes()).some(x => x.a && x.a.enabled === false && x.m.id === 'd2') && await a.locator('#existing-docs-list .doc-card', { hasText: '휴가 신청' }).evaluate(e => e.classList.contains('off')), '문서 입력창에서도 끄고 켤 수 있다 (흐리게 표시)');
  ok(a.errs.length === 0, '관리자 화면 페이지 오류 없음' + (a.errs.length ? JSON.stringify(a.errs) : ''));

  console.log('[사용자: 모델 선택 / 챗봇 답변]');
  const u = await mkPage(); await login(u, 'u1'); await u.waitForSelector('#screen-chat.active', { timeout: 8000 });
  await u.selectOption('#dd-cat', 'p1');
  const mopts = await u.$$eval('#dd-model option', l => l.map(o => o.textContent.trim()));
  ok(JSON.stringify(mopts) === JSON.stringify(['-- 모델 선택 --', '그룹웨어', 'ERP']) && !mopts.some(t => /문서|건|\(/.test(t)), '모델 선택 목록에 "(문서 N건)" 표시가 없다: ' + mopts.join(' | '));
  await u.selectOption('#dd-model', 'm1'); await u.waitForTimeout(400);
  const welcome = await u.textContent('#chat-body');
  ok(/등록된 3건의 문서를 기반으로/.test(welcome) || /등록된 2건의 문서를 기반으로/.test(welcome), '환영 문구의 건수는 챗봇이 실제로 쓰는(켜 둔) 문서 수다: ' + (welcome.match(/등록된 \d+건/) || ['?'])[0]);
  // 그룹웨어: d1(켜짐→관리자 화면에서 끈 상태는 이 사용자 세션에 반영되지 않음) 이므로, 사용자 세션의 기준 데이터(픽스처)로 확인: d3만 꺼져 있음
  u.gem.reply = '답변입니다.\n[[참조: 2]]';
  await u.evaluate(() => { document.getElementById('chat-inp').value = '휴가 어떻게 신청해'; sendMsg(); });
  await u.waitForSelector('.msg.bot .msg-src-item', { timeout: 8000 });
  const sys = u.gem.req.system_instruction.parts[0].text;
  ok(sys.includes('AAA') && sys.includes('BBB') && !sys.includes('CCC'), '켜 둔 문서(결재·휴가)는 AI에게 전달되고, 꺼 둔 문서(출장 신청)는 전달되지 않는다');
  ok(/문서 1\/2 /.test(sys) && /문서 2\/2 /.test(sys) && !/문서 3\/3/.test(sys), '문서 번호는 켜 둔 문서만 1/2, 2/2로 매겨진다');
  const ref = await u.textContent('.msg.bot .msg-src');
  ok(ref.includes('휴가 신청') && !ref.includes('출장 신청'), '"참조: 2"는 켜 둔 문서 기준 2번(휴가 신청)으로 표시된다');
  // 모델 ERP: 문서 전부 끄면
  await u.evaluate(() => { products[0].models[1].docs.forEach(d => d.enabled = false); selModel = products[0].models[1]; selProduct = products[0]; });
  await u.evaluate(() => { document.getElementById('chat-inp').value = '전표 입력 방법'; sendMsg(); });
  await u.waitForFunction(() => document.querySelectorAll('.msg.bot').length >= 2, null, { timeout: 8000 });
  ok(/등록된 문서 없음/.test(u.gem.req.system_instruction.parts[0].text) && !u.gem.req.system_instruction.parts[0].text.includes('DDD'), '모든 문서를 꺼 두면 "등록된 문서 없음"으로 전달되고 본문은 전달되지 않는다');
  ok(u.errs.length === 0, '사용자 화면 페이지 오류 없음' + (u.errs.length ? JSON.stringify(u.errs) : ''));

  await browser.close(); srv.close();
  console.log('\n통과 ' + pass + ' / 실패 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('시험 중단:', e); process.exit(2); });
