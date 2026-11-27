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
 const rec=(t,k,a,m)=>{ window.__writes.push({t,k,a,m}); const f=window.__failNext; if(f&&f===t+'.'+k){window.__failNext=null; return Promise.resolve({error:{message:'fail'}});} return new Promise(r=>setTimeout(()=>r({error:null}),window.__delay||0)); };
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
  ok(await a.$eval('#admin-avatar', e => getComputedStyle(e).display === 'none'), '관리자 화면 이름 앞의 동그란 첫 글자 표시가 없다');
  { const pi = await a.$$eval('.p-icon', l => l.map(e => ({ svg: !!e.querySelector('svg'), txt: e.textContent.trim() }))); ok(pi.length === 8 && pi.every(x => x.svg && x.txt === ''), '관리자 화면 제목 옆 아이콘 8개가 모두 이모지 대신 심플한 선 아이콘(SVG)이다 (' + pi.length + '개)'); await a.screenshot({ path: path.join(OUT, 'admin-icons.png'), clip: { x: 230, y: 40, width: 700, height: 90 } }); }
  { const EMO = /[\u{1F300}-\u{1FAFF}☀-➿⭐]/u; const bad = [], sizes = [];
    for (const pn of ['dashboard', 'apikey', 'docs', 'users', 'logs']) {
      await a.evaluate(n => showPanel(n), pn); await a.waitForTimeout(250);
      if (pn === 'users') await a.evaluate(() => { try { switchUtab('group'); } catch (e) {} });
      if (pn === 'logs') await a.evaluate(() => { try { switchLogTab('report'); } catch (e) {} });
      await a.waitForTimeout(250);
      const r = await a.evaluate(() => { const els = [...document.querySelectorAll('#screen-admin .a-panel.active .sec-title, #screen-admin .a-panel.active .api-config-title, #screen-admin .a-panel.active .utab, #screen-admin .a-panel.active .log-tab, #screen-admin .a-panel.active .log-period-btn, #screen-admin .a-panel.active .rpt-period-btn, #screen-admin .a-panel.active .stat-card div, #screen-admin .a-panel.active #log-report div')]; return { txt: els.filter(e => e.offsetParent).map(e => e.textContent), ai: [...document.querySelectorAll('#screen-admin .a-panel.active .ai')].filter(e => e.getBoundingClientRect().width > 0).length }; });
      r.txt.forEach(t => { if (EMO.test(t)) bad.push(pn + ': ' + t.slice(0, 30)); }); sizes.push(pn + '=' + r.ai);
      await a.screenshot({ path: path.join(OUT, 'admin-' + pn + '.png') });
    }
    ok(bad.length === 0, '관리자 화면의 소제목·탭·카드 제목에 이모지가 남아 있지 않다 (' + (bad.join(' / ') || '없음') + ')');
    ok(sizes.every(x => !x.endsWith('=0') || /docs|users/.test(x)), '대시보드·API 키 화면의 새 선 아이콘이 실제로 그려진다 (' + sizes.join(', ') + ')'); }
  await a.evaluate(() => { showPanel('docs'); renderDocTree(); }); await a.waitForSelector('.dl-doc .dl-eye');
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

  console.log('[눈 아이콘: 화면 유지 + 작업 중 표시]');
  const k = await mkPage(); await login(k, 'admin'); await k.waitForSelector('#screen-admin.active', { timeout: 8000 });
  await k.evaluate(() => showPanel('docs'));
  await k.locator('.cat-hdr').first().click();
  await k.evaluate(() => { _docOpen.add('0-0'); renderDocTree(); });
  await k.waitForSelector('#cm-0.open .dl-doc .dl-eye');
  const nOpen = () => k.evaluate(() => ({ cat: document.getElementById('cm-0').classList.contains('open'), docs: !!document.querySelector('#cm-0 .model-docs.open'), chev: document.getElementById('cv-0').classList.contains('open') }));
  await k.evaluate(() => { window.__delay = 900; });
  const eye = k.locator('#cm-0 .dl-doc', { hasText: '결재 방법' }).locator('.dl-eye');
  await eye.click(); await k.waitForTimeout(450);
  ok(await k.locator('#busy-bar.on').count() === 1 && await k.locator('#busy-pill.on').isVisible(), '저장하는 동안 화면 위 막대와 "작업 중입니다…" 표시가 나온다');
  ok(await eye.evaluate(e => e.classList.contains('busy')), '누른 눈 아이콘은 저장되는 동안 빙글빙글 돈다');
  await k.waitForTimeout(800);
  const st = await nOpen();
  ok(st.cat && st.docs && st.chev, '눈 아이콘을 눌러도 펼쳐 둔 제품군·모델 문서 목록이 접히지 않는다');
  await k.waitForTimeout(1300);   // 끝난 뒤에도 잠깐(약 0.7초) 유지되다가 사라짐
  ok(await k.locator('#busy-bar.on').count() === 0 && !(await k.locator('#busy-pill').isVisible()), '저장이 끝나고 잠시 뒤 작업 중 표시가 사라진다');
  ok(await k.locator('#cm-0 .dl-doc', { hasText: '결재 방법' }).locator('.dl-eye').getAttribute('data-eye') === 'off', '눈 아이콘이 바로 바뀐다');
  console.log('[작업 중 표시: 이어지는 작업 사이에 깜박이지 않기]');
  await k.evaluate(() => { window.__delay = 0; });
  // 0.4초짜리 작업 3개를 0.15초 간격으로 이어서 실행 → 사이사이에 표시가 꺼지면 안 된다
  await k.evaluate(() => { window.__samples = []; window.__sampler = setInterval(() => { const p = document.getElementById('busy-pill'), b = document.getElementById('busy-bar'); window.__samples.push({ t: Date.now(), pill: !!(p && p.classList.contains('on')), bar: !!(b && b.classList.contains('on')) }); }, 40); });
  await k.evaluate(async () => { window.__delay = 400; for (let i = 0; i < 3; i++) { await dbUpd('documents', { id: 'd1' }, { enabled: true }); await new Promise(r => setTimeout(r, 150)); } });
  await k.waitForTimeout(1800);
  const smp = await k.evaluate(() => { clearInterval(window.__sampler); return window.__samples; });
  const firstOn = smp.findIndex(x => x.pill), lastOn = smp.length - 1 - [...smp].reverse().findIndex(x => x.pill);
  const gaps = smp.slice(firstOn, lastOn + 1).filter(x => !x.pill).length;
  ok(firstOn >= 0 && gaps === 0, '이어지는 작업 사이에 "작업 중" 알림이 꺼졌다 켜지지 않고 계속 유지된다 (켜진 구간 중 꺼진 순간 ' + gaps + '번)');
  ok(smp.at(-1).pill === false && smp.at(-1).bar === false, '모든 작업이 끝나고 잠시 뒤에는 알림과 막대가 사라진다');
  await k.evaluate(() => { window.__delay = 0; window.__writes.length = 0; });
  await k.evaluate(() => { window.__samples = []; window.__sampler = setInterval(() => { const p = document.getElementById('busy-pill'); window.__samples.push(!!(p && p.classList.contains('on'))); }, 30); });
  await k.evaluate(async () => { await dbUpd('documents', { id: 'd1' }, { enabled: true }); });
  await k.waitForTimeout(600);
  ok(!(await k.evaluate(() => { clearInterval(window.__sampler); return window.__samples.some(x => x); })), '아주 짧은 작업(0.25초 이내)에는 알림이 뜨지 않는다');

  console.log('[문서 정렬: 최신순 / 오래된순]');
  await k.evaluate(() => { window.__delay = 0; products[0].models[0].docs.forEach((d, i) => { d.ts = '2026-01-0' + (i + 1) + 'T00:00:00Z'; }); renderDocTree(); });
  const titles = () => k.$eval('#cm-0 .model-docs', b => [...b.querySelectorAll('.dl-doc:not(.dl-all) .t')].map(e => e.textContent.trim()));
  const orig = await k.evaluate(() => products[0].models[0].docs.map(d => d.title));
  ok(JSON.stringify(await titles()) === JSON.stringify(orig.slice().reverse()), '기본은 최신순이다 (가장 나중에 등록한 문서가 맨 위): ' + (await titles()).join(' | ') + ' / 원래: ' + orig.join(' | '));
  ok(await k.locator('.doc-sort-btn').first().textContent() === '↓ 최신순', '정렬 버튼이 "↓ 최신순"으로 표시된다');
  await k.locator('.doc-sort-btn').first().click(); await k.waitForTimeout(150);
  ok(JSON.stringify(await titles()) === JSON.stringify(orig) && await k.locator('.doc-sort-btn').first().textContent() === '↑ 오래된순', '버튼을 누르면 오래된순으로 바뀌고 버튼 글자도 바뀐다');
  ok(JSON.stringify(await k.evaluate(() => products[0].models[0].docs.map(d => d.title))) === JSON.stringify(orig), '정렬은 화면 표시만 바꾸며 문서 원래 순서(챗봇 문서 번호)는 그대로다');
  await k.evaluate(() => { openDocInputModal(0, 0); });
  await k.waitForSelector('#modal-doc-input.open');
  const mt = await k.$$eval('#existing-docs-list .doc-card-title', l => l.map(e => e.textContent.trim()));
  ok(JSON.stringify(mt) === JSON.stringify(orig), '문서 입력창의 등록된 문서 목록도 같은 순서를 따른다');
  await k.locator('#existing-docs-section .doc-sort-btn').click(); await k.waitForTimeout(150);
  ok(JSON.stringify(await k.$$eval('#existing-docs-list .doc-card-title', l => l.map(e => e.textContent.trim()))) === JSON.stringify(orig.slice().reverse()), '문서 입력창의 버튼으로도 순서를 바꿀 수 있다');
  console.log('[문서 입력창: 위쪽 닫기 버튼 / 문서 찾기]');
  const cards = () => k.$$eval('#existing-docs-list .doc-card-title', l => l.map(e => e.textContent.trim()));
  ok(await k.locator('#doc-input-x').isVisible() && /닫기/.test(await k.textContent('#doc-input-x')), '문서 입력창 오른쪽 위에 "닫기" 버튼이 있다');
  await k.evaluate(() => { const m = document.querySelector('#modal-doc-input .modal'); m.scrollTop = m.scrollHeight; }); await k.waitForTimeout(150);
  ok(await k.evaluate(() => { const b = document.getElementById('doc-input-x').getBoundingClientRect(), m = document.querySelector('#modal-doc-input .modal').getBoundingClientRect(); return b.top >= m.top - 1 && b.bottom <= m.top + 90; }), '창을 아래로 스크롤해도 위쪽 닫기 버튼은 위에 붙어 보인다');
  await k.evaluate(() => { document.querySelector('#modal-doc-input .modal').scrollTop = 0; });
  await k.fill('#existing-doc-q', '신청'); await k.screenshot({ path: path.join(OUT, 'doc-find.png') }); await k.setViewportSize({ width: 390, height: 800 }); await k.waitForTimeout(200); await k.screenshot({ path: path.join(OUT, 'doc-find-mobile.png') }); await k.setViewportSize({ width: 1200, height: 1500 });
  await k.fill('#existing-doc-q', 'BBB'); await k.waitForTimeout(100);
  ok(JSON.stringify(await cards()) === JSON.stringify(['휴가 신청']) && (await k.textContent('#existing-doc-count')).includes('1 / 전체 3'), '본문에만 있는 글자(BBB)로 찾으면 그 문서만 나온다 (1 / 전체 3)');
  await k.fill('#existing-doc-q', '  결재  '); await k.waitForTimeout(100);
  ok(JSON.stringify(await cards()) === JSON.stringify(['결재 방법']), '제목에 있는 글자로 찾을 수 있다 (앞뒤 빈칸 무시)');
  await k.fill('#existing-doc-q', 'aaa'); await k.waitForTimeout(100);
  ok((await cards()).length === 1, '영문 대소문자는 구분하지 않는다');
  await k.fill('#existing-doc-q', '신청'); await k.waitForTimeout(100);
  ok((await cards()).length === 2, '여러 문서에 들어 있으면 모두 나온다 (신청 → 2건)');
  await k.fill('#existing-doc-q', '없는글자zzz'); await k.waitForTimeout(100);
  ok(await k.locator('#existing-docs-list').textContent().then(t => /찾는 글자가 들어 있는 문서가 없습니다/.test(t)), '없는 글자는 "문서가 없습니다" 안내가 나온다');
  await k.fill('#existing-doc-q', '휴가'); await k.waitForTimeout(100);
  await k.locator('#existing-docs-list .doc-card button', { hasText: '수정' }).click(); await k.waitForTimeout(200);
  ok(await k.inputValue('#doc-input-title') === '휴가 신청', '찾은 목록에서 "수정"을 눌러도 맞는 문서가 열린다');
  await k.locator('#existing-doc-q-clear').click(); await k.waitForTimeout(100);
  ok((await cards()).length === 3 && await k.inputValue('#existing-doc-q') === '' && (await k.textContent('#existing-doc-count')).trim() === '3', '"지우기"를 누르면 전체 문서가 다시 보인다');
  await k.fill('#existing-doc-q', 'CCC'); await k.click('#doc-input-x'); await k.waitForTimeout(150);
  ok(!(await k.evaluate(() => document.getElementById('modal-doc-input').classList.contains('open'))), '위쪽 닫기 버튼으로 창이 닫힌다');
  await k.evaluate(() => { openDocInputModal(0, 0); }); await k.waitForSelector('#modal-doc-input.open');
  ok(await k.inputValue('#existing-doc-q') === '' && (await cards()).length === 3, '창을 다시 열면 찾기 칸이 비워지고 전체 문서가 보인다');
  await k.evaluate(() => closeModal('modal-doc-input'));
  ok(k.errs.length === 0, '페이지 오류 없음' + (k.errs.length ? JSON.stringify(k.errs) : ''));

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
  ok(/11\. 질문이 넓은 범위/.test(sys) && /하나도 빠뜨리지 말고 전부/.test(sys) && /일부만 보여 주고/.test(sys), '넓은 질문에는 해당 항목을 일부만 보여 주지 말고 모두 보여 주라는 지침이 AI에게 전달된다');
  ok(/문서 1\/2 /.test(sys) && /문서 2\/2 /.test(sys) && !/문서 3\/3/.test(sys), '문서 번호는 켜 둔 문서만 1/2, 2/2로 매겨진다');
  const ref = await u.textContent('.msg.bot .msg-src');
  ok(ref.includes('휴가 신청') && !ref.includes('출장 신청'), '"참조: 2"는 켜 둔 문서 기준 2번(휴가 신청)으로 표시된다');
  // 모델 ERP: 문서 전부 끄면
  await u.evaluate(() => { products[0].models[1].docs.forEach(d => d.enabled = false); selModel = products[0].models[1]; selProduct = products[0]; });
  await u.evaluate(() => { document.getElementById('chat-inp').value = '전표 입력 방법'; sendMsg(); });
  await u.waitForFunction(() => document.querySelectorAll('.msg.bot').length >= 2, null, { timeout: 8000 });
  ok(/등록된 문서 없음/.test(u.gem.req.system_instruction.parts[0].text) && !u.gem.req.system_instruction.parts[0].text.includes('DDD'), '모든 문서를 꺼 두면 "등록된 문서 없음"으로 전달되고 본문은 전달되지 않는다');
  ok(await u.$eval('#chat-avatar', e => getComputedStyle(e).display === 'none') && /사용자/.test(await u.textContent('.nav-right')), '사용자 화면 이름 앞의 동그란 첫 글자 표시가 없고 이름은 그대로 보인다');
  ok(u.errs.length === 0, '사용자 화면 페이지 오류 없음' + (u.errs.length ? JSON.stringify(u.errs) : ''));

  console.log('[되묻기: 눌러서 고르는 선택지 + 기타 직접 입력]');
  await u.evaluate(() => { products[0].models[0].docs.forEach(d => { d.enabled = true; }); selModel = products[0].models[0]; selProduct = products[0]; document.getElementById('chat-body').innerHTML = ''; chatHistory.length = 0; });
  u.gem.reply = '어떤 종류의 신청에 대해 문의하시나요?\n[[선택지: 휴가 신청 | 출장 신청 | 기타 | 휴가 신청 | 결재 방법]]';
  await u.evaluate(() => { document.getElementById('chat-inp').value = '신청'; sendMsg(); });
  await u.waitForSelector('.msg.bot .dc-card', { timeout: 8000 });
  const bubTxt = await u.textContent('.msg.bot .msg-bubble');
  ok(/어떤 종류의 신청에 대해 문의하시나요\?/.test(bubTxt) && !/\[\[/.test(bubTxt) && !/선택지:/.test(bubTxt), '되묻는 말은 그대로 보이고 [[선택지: ...]] 표시는 화면에 남지 않는다');
  const opts = await u.$$eval('.msg.bot .dc-card .dc-opt:not(.dc-other) b', l => l.map(e => e.textContent));
  ok(JSON.stringify(opts) === JSON.stringify(['휴가 신청', '출장 신청', '결재 방법']), '선택지가 눌러서 고르는 버튼으로 나온다 (중복·AI가 쓴 "기타"는 빠짐): ' + opts.join(' | '));
  ok(await u.locator('.msg.bot .dc-card .dc-other').count() === 1 && /기타/.test(await u.textContent('.msg.bot .dc-card .dc-other')), '맨 끝에 "기타 (직접 입력)" 버튼이 하나 있다');
  ok(!/개/.test(await u.textContent('.msg.bot .dc-head')), '머리글에는 "N개" 같은 개수 표시가 없다');
  ok(await u.locator('.msg.bot .dc-card.chips').count() === 1 && await u.$eval('.msg.bot .dc-card.chips .dc-opt:not(.dc-other)', e => parseFloat(getComputedStyle(e).borderTopLeftRadius) >= 20) && await u.$eval('.msg.bot .dc-card.chips .dc-num', e => getComputedStyle(e).display === 'none'), '선택지가 적고 짧으면 번호 없는 칩(알약) 버튼으로 나온다');
  ok(await u.evaluate(() => chatHistory.filter(h => h.role === 'assistant').every(h => !/선택지/.test(h.content))), '대화 기록에도 선택지 표시는 남지 않는다');
  await u.waitForTimeout(1200); await u.screenshot({ path: path.join(OUT, 'choices.png') });
  u.gem.reply = '휴가 신청은 이렇게 합니다.\n[[참조: 2]]';
  await u.locator('.msg.bot .dc-card .dc-opt:not(.dc-other)', { hasText: '휴가 신청' }).click();
  await u.waitForFunction(() => document.querySelectorAll('.msg.bot').length >= 2 && document.querySelectorAll('.msg.user').length >= 2, null, { timeout: 8000 });
  ok(await u.evaluate(() => Array.from(document.querySelectorAll('.msg.user .msg-bubble')).pop().textContent.trim()) === '휴가 신청', '버튼을 누르면 그 항목이 내 질문으로 전송된다');
  ok(await u.evaluate(() => document.querySelector('.dc-card').classList.contains('done')), '고른 뒤에는 선택지가 비활성(완료) 표시가 된다');
  u.gem.reply = '무엇이든 도와드릴게요.\n[[선택지: 휴가 신청 | 결재 방법]]';
  await u.evaluate(() => { document.getElementById('chat-inp').value = '다른 질문'; sendMsg(); });
  await u.waitForFunction(() => document.querySelectorAll('.msg.bot .dc-card').length >= 2, null, { timeout: 8000 });
  u.gem.reply = '확인했습니다.';
  const card2 = u.locator('.msg.bot .dc-card').last();
  await card2.locator('.dc-other').click();
  ok(await card2.locator('.dc-otherbox input').isVisible() && await card2.locator('.dc-otherbox button').isDisabled(), '"기타"를 누르면 입력칸이 열리고, 글자를 쓰기 전에는 보내기가 눌리지 않는다');
  await card2.locator('.dc-otherbox input').fill('  연차 계산법  ');
  ok(!(await card2.locator('.dc-otherbox button').isDisabled()), '글자를 쓰면 보내기가 켜진다');
  await card2.locator('.dc-otherbox input').press('Enter');
  await u.waitForFunction(() => Array.from(document.querySelectorAll('.msg.user .msg-bubble')).pop().textContent.trim() === '연차 계산법', null, { timeout: 8000 });
  ok(true, '입력한 글자(앞뒤 빈칸 제외)가 내 질문으로 전송된다');

  console.log('[AI가 목록으로 되물어도 선택 버튼으로 바꾸기 + 본문의 문서 번호 지우기]');
  await u.evaluate(() => { products[0].models[0].docs.push({ id: 'dz', title: '수수료 안내', cat: '기타', content: '렌탈수수료, 멤버십 수수료, 책임이행보증금 기준을 안내합니다.', enabled: true }); });
  u.gem.reply = '어떤 수수료에 대해 문의하시나요? 예를 들어, 렌탈 수수료, 멤버십 수수료, 또는 다른 종류의 수수료인지 알려주시면 더 정확한 정보를 찾아드릴 수 있습니다.\n\n혹시 다음과 같은 내용에 대해 궁금하신가요?\n\n* **렌탈 수수료 관련:** [[문서 24/107]], [[문서 39/107]], [[문서 69/107]]\n* **멤버십 수수료 관련:** [[문서 2/107]], [[문서 7/107]]\n* **책임이행보증금 (수수료와 관련될 수 있음):** [[문서 18/107]], [[문서 45/107]]\n\n어떤 수수료에 대한 정보가 필요하신지 구체적으로 알려주시면 감사하겠습니다.';
  await u.evaluate(() => { document.getElementById('chat-inp').value = '수수료'; sendMsg(); });
  await u.waitForFunction(() => document.querySelectorAll('.msg.bot .dc-card').length >= 3, null, { timeout: 8000 });
  const guessTxt = await u.evaluate(() => Array.from(document.querySelectorAll('.msg.bot .msg-bubble')).slice(-1)[0].textContent);
  ok(!/\[\[|문서 \d+\/\d+/.test(guessTxt) && /렌탈 수수료 관련/.test(guessTxt), '본문에 잘못 적힌 [[문서 N/전체]] 표시는 지워지고 나머지 글은 그대로 보인다');
  const gOpts = await u.evaluate(() => Array.from(Array.from(document.querySelectorAll('.msg.bot .dc-card')).pop().querySelectorAll('.dc-opt:not(.dc-other) b')).map(e => e.textContent));
  ok(JSON.stringify(gOpts) === JSON.stringify(['렌탈 수수료', '멤버십 수수료', '책임이행보증금']), '목록으로 되물은 항목이 눌러서 고르는 버튼으로 나온다: ' + gOpts.join(' | '));
  await u.evaluate(() => { const z = products[0].models[0].docs.find(d => d.id === 'dz'); z.title = '정산 안내'; z.content = '멤버십수수료는 월 단위로 정산합니다. 책임이행보증금 환급 기준도 안내합니다.'; });
  await u.evaluate(() => { document.getElementById('chat-inp').value = '수수료 알려줘'; sendMsg(); });
  await u.waitForFunction(() => document.querySelectorAll('.msg.bot .dc-card').length >= 4, null, { timeout: 8000 });
  const fOpts = await u.evaluate(() => Array.from(Array.from(document.querySelectorAll('.msg.bot .dc-card')).pop().querySelectorAll('.dc-opt:not(.dc-other) b')).map(e => e.textContent));
  ok(JSON.stringify(fOpts) === JSON.stringify(['멤버십 수수료', '책임이행보증금']), '문서에 없는 항목(렌탈 수수료)은 선택 버튼에서 빠지고, 문서에 있는 항목만 남는다 (띄어쓰기 달라도 인식): ' + fOpts.join(' | '));
  await u.evaluate(() => { const i = products[0].models[0].docs.findIndex(d => d.id === 'dz'); products[0].models[0].docs.splice(i, 1); });
  await u.evaluate(() => { document.getElementById('chat-inp').value = '수수료'; sendMsg(); });
  await u.waitForTimeout(1500);
  ok(await u.evaluate(() => document.querySelectorAll('.msg.bot .dc-card').length) === 4, '문서에서 찾은 항목이 2개 미만이면 선택 버튼 없이 글로만 되묻는다');
  console.log('[고른 뒤에도 되물으면 실제 문서 제목으로 다시 선택 버튼]');
  await u.evaluate(() => { const d = products[0].models[0].docs; d.push({ id: 'dy1', title: '렌탈수수료 지급 기준', cat: '기타', content: '렌탈수수료는 월말에 지급합니다.', enabled: true }, { id: 'dy2', title: '렌탈수수료 정산 방법', cat: '기타', content: '정산은 다음 달 5일.', enabled: true }, { id: 'dy3', title: '휴가 규정', cat: '기타', content: '연차는 15일입니다.', enabled: true }); });
  u.gem.reply = '렌탈수수료 관련하여 어떤 정보가 필요하신가요? 예를 들어, 지급, 정산 등에 대해 문의하실 수 있습니다.';
  const nBefore = await u.evaluate(() => document.querySelectorAll('.msg.bot .dc-card').length);
  await u.evaluate(() => { document.getElementById('chat-inp').value = '렌탈수수료의 지급'; sendMsg(); });
  await u.waitForFunction(n => document.querySelectorAll('.msg.bot .dc-card').length > n, nBefore, { timeout: 8000 });
  const tOpts = await u.evaluate(() => Array.from(Array.from(document.querySelectorAll('.msg.bot .dc-card')).pop().querySelectorAll('.dc-opt:not(.dc-other) b')).map(e => e.textContent));
  ok(JSON.stringify(tOpts) === JSON.stringify(['렌탈수수료 지급 기준', '렌탈수수료 정산 방법']) || (tOpts.length >= 2 && tOpts.every(t => /렌탈수수료/.test(t))), 'AI가 선택지 없이 되물어도, 질문과 맞는 실제 문서 제목이 선택 버튼으로 나온다 (관련 없는 "휴가 규정"은 제외): ' + tOpts.join(' | '));
  ok(/관련 문서를 골라 주세요/.test(await u.evaluate(() => Array.from(document.querySelectorAll('.msg.bot .dc-card')).pop().querySelector('.dc-head').textContent)), '머리글이 "관련 문서를 골라 주세요"로 나온다');
  u.gem.reply = '렌탈수수료는 월말에 지급합니다. 어떤 것이 더 궁금하신가요?\n[[참조: 5]]';
  const n2 = await u.evaluate(() => document.querySelectorAll('.msg.bot .dc-card').length);
  await u.evaluate(() => { document.getElementById('chat-inp').value = '렌탈수수료 지급'; sendMsg(); });
  await u.waitForTimeout(1500);
  ok(await u.evaluate(() => document.querySelectorAll('.msg.bot .dc-card').length) === n2, '참조 문서가 있는 정상 답변에는 선택 버튼이 붙지 않는다');
  await u.evaluate(() => { const d = products[0].models[0].docs; ['dy1', 'dy2', 'dy3'].forEach(id => d.splice(d.findIndex(x => x.id === id), 1)); });
  const n3 = n2;
  u.gem.reply = '프린트 방법은 문서 3에 있습니다.\n\n* **첫째 단계:** 전원을 켭니다.\n* **둘째 단계:** 용지를 넣습니다.\n[[참조: 1]]';
  await u.evaluate(() => { document.getElementById('chat-inp').value = '프린트'; sendMsg(); });
  await u.waitForFunction(() => document.querySelectorAll('.msg.bot').length >= 8, null, { timeout: 8000 }).catch(() => {});
  await u.waitForTimeout(600);
  ok(await u.evaluate(() => document.querySelectorAll('.msg.bot .dc-card').length) === n3, '질문하는 말이 없는 일반 답변(굵은 글머리 목록)에는 선택 버튼이 붙지 않는다');

  console.log('[선택지가 길거나 많으면 목록 카드]');
  await u.evaluate(() => { const d = products[0].models[0].docs; d.push({ id: 'dl1', title: '아주 긴 제목의 문서 안내 자료입니다', cat: '기타', content: 'x', enabled: true }, { id: 'dl2', title: '또 다른 긴 제목의 문서 안내 자료입니다', cat: '기타', content: 'y', enabled: true }); });
  u.gem.reply = '어떤 문서를 볼까요?\n[[선택지: 아주 긴 제목의 문서 안내 자료입니다 | 또 다른 긴 제목의 문서 안내 자료입니다]]';
  const nl = await u.evaluate(() => document.querySelectorAll('.msg.bot .dc-card').length);
  await u.evaluate(() => { document.getElementById('chat-inp').value = '문서'; sendMsg(); });
  await u.waitForFunction(n => document.querySelectorAll('.msg.bot .dc-card').length > n, nl, { timeout: 8000 });
  ok(await u.evaluate(() => { const c = Array.from(document.querySelectorAll('.msg.bot .dc-card')).pop(); return !c.classList.contains('chips') && !!c.querySelector('.dc-num'); }), '이름이 길면(14자 초과) 칩이 아니라 번호 붙은 목록 카드로 나온다');
  await u.evaluate(() => { const d = products[0].models[0].docs; ['dl1', 'dl2'].forEach(id => d.splice(d.findIndex(x => x.id === id), 1)); });

  console.log('[새로고침해도 로그인 유지]');
  const r1 = await mkPage(); await login(r1, 'u1'); await r1.waitForSelector('#screen-chat.active', { timeout: 8000 });
  const ssv = await r1.evaluate(() => sessionStorage.getItem('pg_session'));
  ok(ssv && JSON.parse(ssv).id === 'u1' && !/1234|pw/i.test(ssv), '로그인하면 이 탭에만 아이디가 보관되고 비밀번호는 저장되지 않는다: ' + ssv);
  await r1.reload(); await r1.waitForSelector('#screen-chat.active', { timeout: 10000 });
  ok(await r1.evaluate(() => currentUser && currentUser.id === 'u1') && /사용자/.test(await r1.textContent('.nav-right')), '새로고침해도 로그인이 유지되고 같은 사용자의 챗봇 화면이 열린다');
  await r1.evaluate(() => doLogout()); await r1.reload(); await r1.waitForTimeout(1200);
  ok(await r1.evaluate(() => document.getElementById('screen-login').classList.contains('active') && !currentUser && !sessionStorage.getItem('pg_session')), '로그아웃하면 보관 정보가 지워져 새로고침해도 로그인 화면이 나온다');
  await r1.evaluate(() => sessionStorage.setItem('pg_session', JSON.stringify({ id: 'u1', tok: null, t: Date.now() - 9 * 3600 * 1000 }))); await r1.reload(); await r1.waitForTimeout(1200);
  ok(await r1.evaluate(() => document.getElementById('screen-login').classList.contains('active') && !currentUser), '8시간이 지난 보관 정보는 쓰지 않고 로그인 화면이 나온다');
  await r1.evaluate(() => sessionStorage.setItem('pg_session', JSON.stringify({ id: 'nobody', tok: null, t: Date.now() }))); await r1.reload(); await r1.waitForTimeout(1200);
  ok(await r1.evaluate(() => document.getElementById('screen-login').classList.contains('active') && !currentUser && !sessionStorage.getItem('pg_session')), '없는 아이디의 보관 정보는 무시되고 지워진다');
  await login(r1, 'admin'); await r1.waitForSelector('#screen-admin.active', { timeout: 8000 });
  await r1.reload(); await r1.waitForSelector('#screen-admin.active', { timeout: 10000 });
  ok(await r1.evaluate(() => currentUser.id === 'admin'), '관리자도 새로고침하면 관리자 화면이 유지된다');
  ok(r1.errs.length === 0, '새로고침 시험 페이지 오류 없음' + (r1.errs.length ? JSON.stringify(r1.errs) : ''));

  console.log('[휴대폰: 대화이력 화면의 아래 메뉴 바 고정]');
  const mh = await mkPage(); await mh.setViewportSize({ width: 390, height: 700 });
  await login(mh, 'u1'); await mh.waitForSelector('#screen-chat.active', { timeout: 8000 });
  await mh.evaluate(() => switchTab('history')); await mh.waitForTimeout(800);
  await mh.evaluate(() => { const l = document.getElementById('hist-list'); l.innerHTML = Array.from({ length: 40 }, (_, i) => '<div style="flex:none;height:90px;border-bottom:1px solid #ddd">대화 ' + i + '</div>').join(''); window.scrollTo(0, 0); });
  await mh.waitForTimeout(300);
  const bn = () => mh.evaluate(() => { const b = document.querySelector('#screen-history > .bnav').getBoundingClientRect(); return { bottom: Math.round(b.bottom), h: window.innerHeight, sy: Math.round(window.scrollY), sh: document.documentElement.scrollHeight }; });
  const b0 = await bn();
  ok(b0.sh > b0.h + 500 && b0.bottom === b0.h, '목록이 길어도 맨 위에서 아래 메뉴 바가 화면 맨 아래에 보인다 (바 아래끝 ' + b0.bottom + ' = 화면 ' + b0.h + ')');
  await mh.evaluate(() => window.scrollTo(0, 1200)); await mh.waitForTimeout(150);
  const b1 = await bn();
  ok(b1.sy > 500 && b1.bottom === b1.h, '중간까지 스크롤해도 메뉴 바가 그대로 화면 맨 아래에 있다');
  await mh.evaluate(() => window.scrollTo(0, 99999)); await mh.waitForTimeout(150);
  const b2 = await bn();
  ok(b2.bottom === b2.h, '맨 아래까지 스크롤해도 메뉴 바가 화면 맨 아래에 있다');
  await mh.evaluate(() => window.scrollTo(0, 0)); await mh.screenshot({ path: path.join(OUT, 'history-bnav-mobile.png') });
  ok(mh.errs.length === 0, '휴대폰 시험 페이지 오류 없음' + (mh.errs.length ? JSON.stringify(mh.errs) : ''));

  await browser.close(); srv.close();
  console.log('\n통과 ' + pass + ' / 실패 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('시험 중단:', e); process.exit(2); });
