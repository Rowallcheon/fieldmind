// 문서 관리: 모델을 다른 제품군으로 이동·복사, 문서를 다른 모델로 이동 브라우저 시험 (가짜 DB 사용)
// 실행: node tests/doc-move/e2e.js   (Playwright + Chromium 필요)
const http = require('http'), fs = require('fs'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const PORT = 54341, BASE = 'http://127.0.0.1:' + PORT, INDEX = path.join(__dirname, '..', '..', 'index.html');
const srv = http.createServer((req, res) => { if (req.url.split('?')[0] === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(fs.readFileSync(INDEX)); } res.statusCode = 404; res.end(); });

const FIXTURE = {
  users: [{ id: 'admin', pw: '1234', name: '관리자', role: 'admin', status: 'active' }],
  products: [{ id: 'p1', name: '사무행정', icon: '🗂️', sort_order: 1 }, { id: 'p2', name: '정수기', icon: '💧', sort_order: 2 }, { id: 'p3', name: '비데', icon: '🚿', sort_order: 3 }],
  models: [
    { id: 'm1', product_id: 'p1', name: '그룹웨어', sort_order: 1 }, { id: 'm2', product_id: 'p1', name: 'ERP', sort_order: 2 },
    { id: 'm3', product_id: 'p2', name: 'CP-100', sort_order: 1 }, { id: 'm4', product_id: 'p2', name: 'ERP', sort_order: 2 }],
  documents: [
    { id: 'd1', model_id: 'm1', title: '결재 방법', cat: '기술교본', content: '1. 접속\n[[그림:abcdefgh1234.webp|결재 메뉴]]\n2. 완료', created_at: '2026-01-01T00:00:00Z' },
    { id: 'd2', model_id: 'm1', title: '휴가 신청', cat: '사용설명서', content: '휴가 신청 방법입니다. 여기에 내용', created_at: '2026-01-02T00:00:00Z' },
    { id: 'd3', model_id: 'm3', title: '필터 교체', cat: '서비스정보지', content: '필터 교체 순서 안내 본문입니다', created_at: '2026-01-03T00:00:00Z' }],
  groups: [{ id: 'g1', name: '행정팀' }, { id: 'g2', name: '전체팀' }],
  group_products: [{ group_id: 'g1', product_id: 'p1' }, { group_id: 'g2', product_id: 'p1' }, { group_id: 'g2', product_id: 'p2' }],
  group_members: [], app_settings: [], notices: [], inquiries: [], chat_logs: [], user_chat_logs: []
};
const STUB = `(function(){
 const FX=${JSON.stringify(FIXTURE)}; window.__writes=[]; window.__failNext=null;
 const rec=(t,k,a,m)=>{ window.__writes.push({t,k,a,m}); const f=window.__failNext; if(f&&f===t+'.'+k){window.__failNext=null; return Promise.resolve({error:{message:'fail'}});} return Promise.resolve({error:null}); };
 function mk(t){ const q={}; ['select','order','eq','neq','in','gte','limit','is','range'].forEach(k=>q[k]=()=>q);
  q.insert=a=>rec(t,'insert',a); q.upsert=a=>rec(t,'upsert',a);
  q.update=a=>({match:m=>rec(t,'update',a,m)}); q.delete=()=>({match:m=>rec(t,'delete',null,m),in:()=>rec(t,'delete',null)});
  q.then=(res,rej)=>Promise.resolve({data:(FX[t]||[]).slice(),error:null,count:0}).then(res,rej); return q; }
 window.supabase={createClient:()=>({from:mk, rpc:()=>Promise.resolve({data:null,error:{message:'x'}}), storage:{from:()=>({})}})};
})()`;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
(async () => {
  await new Promise(r => srv.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 1500 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push('console: ' + m.text()); });
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('supabase-js')) return r.fulfill({ contentType: 'application/javascript', body: STUB }); if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); return r.abort(); });
  const writes = () => page.evaluate(() => window.__writes.slice());
  const clearW = () => page.evaluate(() => { window.__writes.length = 0; });
  const tree = () => page.evaluate(() => products.map(p => p.name + ':' + p.models.map(m => m.name + '(' + m.docs.length + ')').join(',')));
  const confirmMv = async () => { await page.click('#mv-ok'); await page.waitForFunction(() => !document.getElementById('modal-mv').classList.contains('open')); await page.waitForTimeout(200); };
  const preText = () => page.textContent('#mv-pre');
  const modelRow = n => page.locator('.model-row', { has: page.locator('.model-nm', { hasText: new RegExp('^' + n + '$') }) });

  await page.goto(BASE + '/'); await page.waitForTimeout(600);
  await page.fill('#login-id', 'admin'); await page.fill('#login-pw', '1234'); await page.click('.login-btn');
  await page.waitForSelector('#screen-admin.active', { timeout: 8000 });
  await page.evaluate(() => {          // 화면이 다시 그려져도 모든 제품군을 펼친 채로 두어 조작하기 쉽게 함
    showPanel('docs'); const t = document.getElementById('doc-tree');
    const open = () => document.querySelectorAll('.cat-models').forEach(x => x.classList.add('open'));
    new MutationObserver(open).observe(t, { childList: true }); open();
  });
  await page.waitForSelector('.model-row');
  console.log('[모델 이동: 버튼]');
  ok((await tree()).join('|') === '사무행정:그룹웨어(2),ERP(0)|정수기:CP-100(1),ERP(0)|비데:', '시작 상태: 사무행정(그룹웨어2, ERP0) / 정수기(CP-100, ERP) / 비데(빈)');
  ok((await page.$$('.model-row button:has-text("↔ 제품군 이동")')).length === 4 && (await page.$$('.model-row button:has-text("⧉ 복사")')).length === 4, '모델마다 「↔ 제품군 이동」 「⧉ 복사」 버튼이 있다');

  await clearW();
  await modelRow('그룹웨어').locator('button:has-text("↔ 제품군 이동")').click();
  await page.waitForSelector('#modal-mv.open');
  let opts = await page.$$eval('#mv-target option', l => l.map(o => o.textContent));
  ok(opts.length === 2 && !opts.some(t => t.includes('사무행정')), '현재 제품군은 선택지에서 빠진다');
  await page.selectOption('#mv-target', { label: opts.find(t => t.includes('비데')) });
  let t = await preText();
  ok(t.includes('행정팀') && t.includes('전체팀') && t.includes('그룹 없음'), '비데로 옮기면: 지금 보는 그룹(행정팀, 전체팀) / 이동 후(그룹 없음) 이 보인다');
  ok(/하나도 없어/.test(t), '이동 후 볼 수 있는 그룹이 없으면 경고가 뜬다');
  ok((await page.textContent('#mv-src')).includes('문서 2건'), '문서 건수가 함께 표시된다');
  await page.click('#modal-mv .btn-ghost'); await page.waitForTimeout(150);
  ok((await writes()).length === 0, '취소하면 아무것도 저장하지 않는다');

  await modelRow('그룹웨어').locator('button:has-text("↔ 제품군 이동")').click(); await page.waitForSelector('#modal-mv.open');
  await page.selectOption('#mv-target', { label: opts.find(t => t.includes('정수기')) });
  t = await preText();
  ok(t.includes('전체팀') && /지금 이 모델을 볼 수 있는 그룹: 행정팀, 전체팀/.test(t.replace(/\s+/g, ' ')) && /이동 후 볼 수 있는 그룹: 전체팀/.test(t.replace(/\s+/g, ' ')), '정수기로 옮기면: 행정팀·전체팀 → 전체팀만 보게 된다고 보여준다');
  await confirmMv();
  const w1 = await writes();
  ok(w1.some(x => x.t === 'models' && x.k === 'update' && x.a.product_id === 'p2' && x.m.id === 'm1'), '모델의 제품군만 DB에서 바뀐다 (models.product_id = p2)');
  ok(!w1.some(x => x.t === 'documents'), '문서는 건드리지 않는다(모델에 붙어 있어 그대로 따라감)');
  ok(w1.some(x => x.t === 'models' && x.k === 'update' && 'sort_order' in x.a), '순서도 새로 저장된다');
  ok((await tree()).join('|') === '사무행정:ERP(0)|정수기:CP-100(1),ERP(0),그룹웨어(2)|비데:', '화면: 그룹웨어(문서 2건)가 정수기로 옮겨졌다');

  console.log('[모델 이동: 이름 충돌 / 실패]');
  await clearW();
  await modelRow('ERP').first().locator('button:has-text("↔ 제품군 이동")').click(); await page.waitForSelector('#modal-mv.open');
  await page.selectOption('#mv-target', { label: (await page.$$eval('#mv-target option', l => l.map(o => o.textContent))).find(x => x.includes('정수기')) });
  ok(/같은 이름\("ERP"\)의 모델이 이미 있습니다/.test(await preText()) && await page.$eval('#mv-ok', b => b.disabled), '같은 이름이 있으면 경고하고 이동 버튼이 잠긴다');
  await page.click('#modal-mv .btn-ghost');
  await modelRow('그룹웨어').locator('button:has-text("↔ 제품군 이동")').click(); await page.waitForSelector('#modal-mv.open');
  await page.selectOption('#mv-target', { label: (await page.$$eval('#mv-target option', l => l.map(o => o.textContent))).find(x => x.includes('비데')) });
  await page.evaluate(() => { window.__failNext = 'models.update'; });
  await page.click('#mv-ok'); await page.waitForTimeout(400);
  ok(/DB 저장 실패/.test(await page.textContent('#toast')) && (await tree()).join('|').includes('정수기:CP-100(1),ERP(0),그룹웨어(2)'), 'DB 저장이 실패하면 이동하지 않고 화면도 그대로다');
  await page.click('#modal-mv .btn-ghost');

  console.log('[모델 복사]');
  await clearW();
  await modelRow('그룹웨어').locator('button:has-text("⧉ 복사")').click(); await page.waitForSelector('#modal-mv.open');
  await page.selectOption('#mv-target', { label: (await page.$$eval('#mv-target option', l => l.map(o => o.textContent))).find(x => x.includes('사무행정')) });
  ok(/원본은 그대로/.test(await preText()), '복사 안내: 원본은 그대로 두고 복사본을 만든다');
  await confirmMv();
  const w2 = await writes();
  const mIns = w2.find(x => x.t === 'models' && x.k === 'insert'), dIns = w2.filter(x => x.t === 'documents' && x.k === 'insert').flatMap(x => x.a);
  ok(mIns && mIns.a.product_id === 'p1' && mIns.a.name === '그룹웨어', '새 모델이 사무행정에 만들어진다 (같은 이름이 없으면 이름 그대로)');
  ok(dIns.length === 2 && dIns.every(d => d.model_id === mIns.a.id) && dIns.some(d => d.title === '결재 방법' && d.content.includes('[[그림:abcdefgh1234.webp|결재 메뉴]]')), '문서 2건이 새 번호로 복사되고, 사진 자리표를 포함한 내용이 그대로다');
  ok(new Set(dIns.map(d => d.id)).size === 2 && !dIns.some(d => ['d1', 'd2'].includes(d.id)), '복사된 문서 번호는 원본과 다르다');
  ok((await tree()).join('|') === '사무행정:ERP(0),그룹웨어(2)|정수기:CP-100(1),ERP(0),그룹웨어(2)|비데:', '화면: 정수기의 원본은 그대로, 사무행정에 복사본이 생겼다');
  await clearW();
  await modelRow('그룹웨어').nth(1).locator('button:has-text("⧉ 복사")').click(); await page.waitForSelector('#modal-mv.open');
  await page.selectOption('#mv-target', { label: (await page.$$eval('#mv-target option', l => l.map(o => o.textContent))).find(x => x.includes('사무행정')) });
  ok(/복사본 이름은 "그룹웨어 \(복사\)"/.test((await preText()).replace(/\s+/g, ' ')), '같은 이름이 이미 있으면 복사본 이름은 "그룹웨어 (복사)"가 된다');
  await page.evaluate(() => { window.__failNext = 'documents.insert'; });
  await page.click('#mv-ok'); await page.waitForTimeout(500);
  const w3 = await writes();
  ok(/복사를 취소/.test(await page.textContent('#toast')) && w3.some(x => x.t === 'documents' && x.k === 'delete') && w3.some(x => x.t === 'models' && x.k === 'delete'), '문서 복사 중 오류가 나면 만든 것을 지우고 취소한다');
  ok((await tree()).join('|').startsWith('사무행정:ERP(0),그룹웨어(2)|'), '그때 화면에는 반쪽짜리 복사본이 남지 않는다');
  await page.evaluate(() => closeModal('modal-mv'));

  console.log('[모델 이동: 끌어서 놓기]');
  await page.click('#sort-mode-btn'); await page.waitForTimeout(300);
  ok(/모델 줄을 다른 제품군의 모델 위나 제품군 위로 끌어/.test(await page.textContent('#sort-mode-guide')), '순서 변경 모드 안내에 제품군 간 이동이 적혀 있다');
  await clearW();
  await modelRow('CP-100').dragTo(modelRow('ERP').first());   // 같은 제품군이 아닌 모델(사무행정 ERP) 위로
  await page.waitForSelector('#modal-mv.open', { timeout: 5000 });
  ok(/사무행정/.test(await page.textContent('#mv-target').catch(() => '') + await page.$eval('#mv-target', s => s.selectedOptions[0].textContent)), '다른 제품군의 모델 위에 놓으면 이동 확인 창이 그 제품군을 선택한 채 열린다');
  await confirmMv();
  ok((await tree()).join('|').startsWith('사무행정:CP-100(1),ERP(0),그룹웨어(2)|'), '놓은 모델 앞에 끼워 넣어진다 (사무행정: CP-100, ERP, 그룹웨어)');
  await clearW();
  await modelRow('CP-100').dragTo(page.locator('.cat-block').nth(2).locator('.cat-hdr'));   // 비데(빈 제품군) 머리 위로
  await page.waitForSelector('#modal-mv.open', { timeout: 5000 });
  ok(/하나도 없어/.test(await preText()), '빈 제품군(비데) 위에 놓아도 확인 창이 열리고 접근 그룹 경고가 뜬다');
  await page.click('#modal-mv .btn-ghost'); await page.waitForTimeout(150);
  ok((await writes()).length === 0 && (await tree()).join('|').startsWith('사무행정:CP-100(1)'), '확인 창에서 취소하면 그대로다');
  // 같은 제품군 안의 순서 변경은 예전처럼 확인 창 없이
  await clearW();
  await modelRow('그룹웨어').nth(0).dragTo(modelRow('CP-100').nth(0));
  await page.waitForTimeout(500);
  const w4 = await writes();
  ok(!(await page.isVisible('#modal-mv')) && w4.some(x => x.t === 'models' && 'sort_order' in x.a) && (await tree())[0].startsWith('사무행정:그룹웨어') , '같은 제품군 안에서 순서만 바꾸는 끌기는 확인 창 없이 저장된다');
  await page.click('#sort-mode-btn');

  console.log('[문서 이동]');
  await page.evaluate(() => openDocInputModal(0, 0));          // 사무행정 첫 모델
  await page.waitForSelector('#modal-doc-input.open');
  const firstModel = await page.evaluate(() => products[0].models[0].name);
  const docBtns = await page.$$('#existing-docs-list button:has-text("↔ 이동")');
  ok(docBtns.length === (await page.evaluate(() => products[0].models[0].docs.length)) && docBtns.length >= 1, '문서 입력창의 등록된 문서마다 「↔ 이동」 버튼이 있다 (' + firstModel + ')');
  await page.evaluate(() => { const i = products[0].models[0].docs.length; openDocInputModal(0, products[0].models.findIndex(m => m.name === '그룹웨어')); });
  await page.waitForSelector('#existing-docs-list .doc-card');
  await clearW();
  await page.locator('#existing-docs-list .doc-card', { hasText: '휴가 신청' }).locator('button:has-text("↔ 이동")').click();
  await page.waitForSelector('#modal-mv.open');
  const dOpts = await page.$$eval('#mv-target option', l => l.map(o => o.textContent));
  ok(dOpts.length >= 3 && !dOpts.some(x => x.includes('사무행정 › 그룹웨어')) && dOpts.some(x => x.includes('정수기 › ERP')) && dOpts.some(x => x.includes('사무행정 › CP-100')), '문서 이동 선택지: 현재 모델은 빠지고 모든 제품군의 모델이 나온다');
  await page.selectOption('#mv-target', { label: dOpts.find(x => x.includes('사무행정 › CP-100')) });
  ok(/같은 제품군 안에서의 이동이라/.test(await preText()), '같은 제품군 안의 문서 이동은 접근 그룹이 그대로라고 안내한다');
  await page.selectOption('#mv-target', { label: dOpts.find(x => x.includes('정수기 › ERP')) });
  const dt = (await preText()).replace(/\s+/g, ' ');
  ok(/지금 이 문서를 볼 수 있는 그룹: 행정팀, 전체팀/.test(dt) && /이동 후 볼 수 있는 그룹: 전체팀/.test(dt), '다른 제품군으로 옮기면 보는 그룹이 어떻게 바뀌는지 보여준다');
  await confirmMv();
  const w5 = await writes();
  ok(w5.some(x => x.t === 'documents' && x.k === 'update' && x.a.model_id === 'm4' && x.m.id), '문서의 모델만 DB에서 바뀐다 (documents.model_id)');
  ok((await page.$$('#existing-docs-list .doc-card')).length === 1 && !(await page.textContent('#existing-docs-list')).includes('휴가 신청'), '입력창의 문서 목록에서 옮긴 문서가 빠진다');
  ok(await page.evaluate(() => products.find(p => p.name === '정수기').models.find(m => m.name === 'ERP').docs.length) === 1, '정수기 ERP 모델에 문서 1건이 생겼다');

  const realErrs = errs.filter(e => !/\{message: fail\}/.test(e));   // 일부러 실패시킨 저장의 로그는 제외
  ok(realErrs.length === 0, '페이지 오류 없음(의도한 저장 실패 로그 제외)' + (realErrs.length ? ' ' + JSON.stringify(realErrs) : ''));
  await browser.close(); srv.close();
  console.log('\n통과 ' + pass + ' / 실패 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('시험 중단:', e); process.exit(2); });
