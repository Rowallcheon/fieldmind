// 문서 관리: 체크박스로 고른 문서를 다른 제품군의 모델로 이동·복사 브라우저 시험 (가짜 DB 사용)
// 실행: node tests/doc-move/e2e.js   (Playwright + Chromium 필요)
const http = require('http'), fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
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
  const counts = () => page.evaluate(() => products.map(p => p.name + ':' + p.models.map(m => m.name + '(' + m.docs.map(d => d.title).join('/') + ')').join(',')).join('|'));
  const check = async t => { const cb = page.locator('.dl-doc', { hasText: t }).locator('input'); if (!(await cb.isChecked())) await cb.check(); };
  const uncheckAll = () => page.click('button:has-text("선택 해제")');
  const mvOpenBtn = n => page.click('#dl-' + n + '-btn');
  const confirmMv = async () => { await page.click('#mv-ok'); await page.waitForFunction(() => !document.getElementById('modal-mv').classList.contains('open')); await page.waitForTimeout(200); };
  const pre = async () => (await page.textContent('#mv-pre')).replace(/\s+/g, ' ');
  const pick = async (prod, model) => { await page.selectOption('#mv-prod', { label: new RegExp(prod) .source ? (await page.$$eval('#mv-prod option', (l, k) => l.map(o => o.textContent).find(t => t.includes(k)), prod)) : prod }); if (model) await page.selectOption('#mv-model', { label: (await page.$$eval('#mv-model option', (l, k) => l.map(o => o.textContent).find(t => t.startsWith(k)), model)) }); };
  const openLists = () => page.evaluate(() => { products.forEach((p, i) => p.models.forEach((m, j) => _docOpen.add(i + '-' + j))); renderDocTree(); });

  await page.goto(BASE + '/'); await page.waitForTimeout(600);
  await page.fill('#login-id', 'admin'); await page.fill('#login-pw', '1234'); await page.click('.login-btn');
  await page.waitForSelector('#screen-admin.active', { timeout: 8000 });
  await page.evaluate(() => {
    showPanel('docs'); const t = document.getElementById('doc-tree');
    const open = () => document.querySelectorAll('.cat-models').forEach(x => x.classList.add('open'));
    new MutationObserver(open).observe(t, { childList: true }); open();
  });
  await page.waitForSelector('.model-row'); await openLists();

  console.log('[다운로드 막대의 이동·복사 버튼]');
  ok((await page.$$('#doc-dl-bar button')).length >= 5 && await page.isVisible('#dl-move-btn') && await page.isVisible('#dl-copy-btn'), '다운로드 막대에 「↔ 선택 문서 이동」 「⧉ 선택 문서 복사」 버튼이 있다');
  ok(await page.$eval('#dl-move-btn', b => b.disabled) && await page.$eval('#dl-copy-btn', b => b.disabled), '문서를 체크하지 않으면 두 버튼은 잠겨 있다');
  ok((await page.$$('.model-row button:has-text("제품군 이동")')).length === 0, '(요청과 다른) 모델 줄 이동 버튼은 없다');
  await check('결재 방법'); await check('휴가 신청');
  ok(!(await page.$eval('#dl-move-btn', b => b.disabled)) && (await page.textContent('#dl-count')).includes('2건'), '체크하면 버튼이 켜지고 선택 건수가 보인다');

  await page.screenshot({ path: path.join(OUT, 'dl-bar.png'), clip: { x: 0, y: 0, width: 1200, height: 500 } });
  console.log('[이동: 확인 창]');
  await mvOpenBtn('move'); await page.waitForSelector('#modal-mv.open');
  ok((await page.textContent('#mv-src')).includes('선택한 문서 2건') && (await page.textContent('#mv-src')).includes('사무행정 › 그룹웨어 — 2건'), '선택한 문서 2건과 출처(사무행정 › 그룹웨어)가 보인다');
  const prodOpts = await page.$$eval('#mv-prod option', l => l.map(o => ({ t: o.textContent, d: o.disabled })));
  ok(prodOpts.length === 3 && prodOpts.find(o => o.t.includes('비데')).d, '제품군 목록에 모든 제품군이 나오고, 모델이 없는 제품군(비데)은 고를 수 없다');
  ok(await page.$eval('#mv-prod', s => s.selectedOptions[0].textContent.includes('정수기')), '기본 선택은 선택한 문서와 다른 제품군(정수기)이다');
  await pick('정수기', 'CP-100');
  await page.screenshot({ path: path.join(OUT, 'move-modal.png') });
  let t = await pre();
  ok(/→ 💧 정수기 › CP-100/.test(t) && /지금 보는 그룹: 행정팀, 전체팀/.test(t) && /이동 후 보는 그룹: 전체팀/.test(t), '정수기 › CP-100으로: 행정팀·전체팀 → 전체팀만 보게 된다고 보여준다');
  await pick('사무행정', 'ERP');
  ok(/접근 권한은 그대로/.test(await pre()), '같은 제품군 안의 이동이면 "접근 권한은 그대로"라고 안내한다');
  await pick('정수기', 'CP-100');
  await clearW(); await page.click('#modal-mv .btn-ghost'); await page.waitForTimeout(150);
  ok((await writes()).length === 0 && (await counts()).includes('그룹웨어(결재 방법/휴가 신청)'), '취소하면 아무것도 바뀌지 않는다');

  console.log('[이동 실행]');
  await uncheckAll(); await check('결재 방법');
  await mvOpenBtn('move'); await page.waitForSelector('#modal-mv.open'); await pick('정수기', 'ERP');
  await clearW(); await confirmMv();
  const w1 = await writes();
  ok(w1.length === 1 && w1[0].t === 'documents' && w1[0].k === 'update' && w1[0].a.model_id === 'm4' && w1[0].m.id === 'd1', '체크한 문서 1건의 모델만 DB에서 바뀐다 (documents.model_id = m4)');
  ok((await counts()).includes('정수기:CP-100(필터 교체),ERP(결재 방법)') && (await counts()).includes('그룹웨어(휴가 신청)'), '화면: 결재 방법이 정수기 › ERP로 옮겨졌고 나머지는 그대로');
  ok((await page.textContent('#dl-count')).includes('0건') && await page.$eval('#dl-move-btn', b => b.disabled), '이동 후 선택은 해제된다');
  ok(await page.isVisible('.dl-doc:has-text("결재 방법")'), '결과를 볼 수 있게 대상 모델의 문서 목록이 펼쳐져 있다');

  console.log('[복사 실행]');
  await check('휴가 신청');
  await mvOpenBtn('copy'); await page.waitForSelector('#modal-mv.open');
  ok((await page.textContent('#mv-title')).includes('복사') && (await page.textContent('#mv-ok')) === '복사', '복사 창은 제목과 버튼이 "복사"다');
  await pick('정수기', 'CP-100');
  t = await pre();
  ok(/원본은 그대로/.test(t) && /복사본을 볼 수 있는 그룹: 전체팀/.test(t), '복사 안내: 원본은 그대로, 복사본을 볼 수 있는 그룹이 보인다');
  await clearW(); await confirmMv();
  const w2 = await writes(), ins = w2.filter(x => x.t === 'documents' && x.k === 'insert').flatMap(x => x.a);
  ok(ins.length === 1 && ins[0].model_id === 'm3' && ins[0].title === '휴가 신청' && ins[0].content === '휴가 신청 방법입니다. 여기에 내용' && ins[0].id !== 'd2', '문서가 새 번호로, 내용 그대로 복사된다');
  ok((await counts()).includes('그룹웨어(휴가 신청)') && (await counts()).includes('CP-100(필터 교체/휴가 신청)'), '화면: 원본(그룹웨어)은 그대로 있고 정수기 › CP-100에 복사본이 생겼다');

  console.log('[여러 모델·제품군에서 한꺼번에]');
  await check('필터 교체'); await check('결재 방법');
  await mvOpenBtn('move'); await page.waitForSelector('#modal-mv.open');
  ok((await page.textContent('#mv-src')).includes('선택한 문서 2건') && (await page.textContent('#mv-src')).includes('정수기 › CP-100 — 1건') && (await page.textContent('#mv-src')).includes('정수기 › ERP — 1건'), '여러 모델에서 고른 문서의 출처가 모두 나온다');
  await pick('정수기', 'CP-100');
  ok(/이미 이 모델에 있는 문서 1건은 제외/.test(await pre()), '대상 모델에 이미 있는 문서는 제외된다고 알려준다');
  await pick('사무행정', 'ERP');
  t = await pre();
  ok(/"정수기"의 문서 2건 — 지금 보는 그룹: 전체팀\s*→ 이동 후 보는 그룹: 행정팀, 전체팀/.test(t), '사무행정으로 옮기면 전체팀 → 행정팀·전체팀으로 넓어지는 것을 보여준다');
  await clearW(); await confirmMv();
  const w3 = await writes();
  ok(w3.filter(x => x.k === 'update' && x.a.model_id === 'm2').length === 2, '두 문서 모두 사무행정 › ERP(m2)로 옮겨진다');
  ok((await counts()).includes('ERP(필터 교체/결재 방법)'), '화면에도 반영된다');

  console.log('[이미 그 모델에 있는 경우 / 저장 실패]');
  await uncheckAll(); await check('필터 교체');
  await mvOpenBtn('move'); await page.waitForSelector('#modal-mv.open'); await pick('사무행정', 'ERP');
  ok(/모두 이미 이 모델에 있습니다/.test(await pre()) && await page.$eval('#mv-ok', b => b.disabled), '선택한 문서가 전부 이미 그 모델에 있으면 경고하고 실행 버튼이 잠긴다');
  await pick('정수기', 'CP-100');
  await page.evaluate(() => { window.__failNext = 'documents.update'; });
  await page.click('#mv-ok'); await page.waitForTimeout(500);
  ok(/0건만 이동하고 저장 오류로 멈췄습니다/.test(await page.textContent('#toast')) && (await counts()).includes('ERP(필터 교체/결재 방법)'), 'DB 저장이 실패하면 그 문서는 옮기지 않고 화면도 그대로다');
  await uncheckAll(); await check('필터 교체');
  await mvOpenBtn('copy'); await page.waitForSelector('#modal-mv.open'); await pick('정수기', 'CP-100');
  await page.evaluate(() => { window.__failNext = 'documents.insert'; });
  const before = await counts();
  await page.click('#mv-ok'); await page.waitForTimeout(500);
  ok(/복사를 취소/.test(await page.textContent('#toast')) && (await counts()) === before, '복사 저장이 실패하면 취소하고 화면에 복사본이 남지 않는다');
  await page.evaluate(() => closeModal('modal-mv'));

  console.log('[모델 문서 목록 안쪽 작업 막대 / 삭제]');
  await page.evaluate(() => window.__dialogMode = null);
  let dialogs = [], accept = false; page.on('dialog', d => { dialogs.push(d.message()); accept ? d.accept() : d.dismiss(); });
  await uncheckAll(); await openLists();
  ok(await page.$$eval('.dl-inline', l => l.length >= 3 && l.every(e => getComputedStyle(e).display === 'none')), '아무것도 체크하지 않으면 모델 안쪽 작업 막대는 보이지 않는다');
  const box = page.locator('.model-docs', { hasText: '결재 방법' }).first();
  await box.locator('.dl-doc', { hasText: '결재 방법' }).locator('input').check();
  const bar = box.locator('.dl-inline');
  ok(await bar.isVisible(), '문서를 체크하면 그 모델의 "전체 선택" 줄 오른쪽에 작업 막대가 나타난다');
  const btnTexts = await bar.locator('button').allTextContents();
  ok(JSON.stringify(btnTexts) === JSON.stringify(['⬇ 선택 문서 다운로드', '🗑 삭제', '⧉ 복사', '↔ 이동']), '버튼 순서: 선택 문서 다운로드 / 삭제 / 복사 / 이동 (' + btnTexts.join(' | ') + ')');
  const rowBox = await box.locator('.dl-allwrap label').boundingBox(), barBox = await bar.boundingBox();
  ok(Math.abs((rowBox.y + rowBox.height / 2) - (barBox.y + barBox.height / 2)) < 30 && barBox.x > rowBox.x + 100, '작업 막대는 "이 모델 문서 전체 선택"과 같은 줄의 오른쪽에 있다');
  ok((await bar.textContent()).includes('선택 1건'), '막대에 선택 건수가 보인다');
  ok(await page.$eval('.model-docs:not(:has(input:checked)) .dl-inline', e => getComputedStyle(e).display === 'none'), '체크한 문서가 없는 다른 모델에는 막대가 나타나지 않는다');
  ok(await page.$eval('.dl-allwrap', e => getComputedStyle(e).position) === 'sticky', '막대가 있는 줄은 스크롤해도 화면 위쪽에 붙어 있다(sticky)');
  await page.screenshot({ path: path.join(OUT, 'inline-bar.png'), clip: { x: 230, y: Math.max(0, barBox.y - 120), width: 970, height: 330 } });
  await bar.locator('button:has-text("이동")').click(); await page.waitForSelector('#modal-mv.open');
  ok((await page.textContent('#mv-src')).includes('선택한 문서 1건'), '안쪽 「↔ 이동」을 누르면 같은 이동 창이 열린다');
  await page.click('#modal-mv .btn-ghost');
  await box.locator('.dl-doc', { hasText: '필터 교체' }).count().then(async n => { if (n) await box.locator('.dl-doc', { hasText: '필터 교체' }).locator('input').check(); });
  ok((await bar.textContent()).includes('선택 2건'), '같은 모델에서 더 체크하면 건수가 늘어난다');
  const otherBox = page.locator('.model-docs', { hasText: '휴가 신청' }).first();
  await otherBox.locator('.dl-doc', { hasText: '휴가 신청' }).first().locator('input').check();
  ok((await bar.textContent()).includes('다른 모델 포함') && await otherBox.locator('.dl-inline').isVisible(), '다른 모델에서도 체크하면 두 모델에 막대가 보이고 "(다른 모델 포함)"이 표시된다');
  ok(!(await page.$eval('#dl-del-btn', b => b.disabled)), '위쪽 막대에도 「🗑 선택 문서 삭제」가 있고 체크하면 켜진다');
  await uncheckAll(); await box.locator('.dl-doc', { hasText: '결재 방법' }).locator('input').check();
  await clearW(); dialogs = []; accept = false;
  await bar.locator('button:has-text("삭제")').click(); await page.waitForTimeout(300);
  ok(dialogs.length === 1 && /1건을 삭제/.test(dialogs[0]) && /결재 방법/.test(dialogs[0]) && (await writes()).length === 0 && (await counts()).includes('결재 방법'), '삭제는 확인 창이 먼저 뜨고, 취소하면 아무것도 지우지 않는다');
  accept = true; dialogs = [];
  await bar.locator('button:has-text("삭제")').click(); await page.waitForTimeout(500);
  const wd = (await writes()).filter(x => x.t === 'documents' && x.k === 'delete');
  ok(wd.length === 1 && wd[0].m.id && !(await counts()).includes('결재 방법') && (await page.textContent('#dl-count')).includes('0건'), '확인하면 DB(documents)에서 실제로 삭제되고 화면·선택 건수도 갱신된다');
  await box.locator('.dl-doc').first().locator('input').check().catch(() => {});
  await uncheckAll();
  const left = await page.evaluate(() => products.flatMap(p => p.models.flatMap(m => m.docs.map(d => d.title))));
  const target = left[0];
  await page.locator('.dl-doc', { hasText: target }).first().locator('input').check();
  await page.evaluate(() => { window.__failNext = 'documents.delete'; });
  accept = true; await page.locator('.dl-inline:visible button:has-text("삭제")').first().click(); await page.waitForTimeout(500);
  ok(/0건만 삭제하고 저장 오류로 멈췄습니다/.test(await page.textContent('#toast')) && (await page.evaluate(() => products.flatMap(p => p.models.flatMap(m => m.docs.map(d => d.title))).length)) === left.length, '삭제 저장이 실패하면 그 문서는 남아 있고 화면도 그대로다');
  await uncheckAll();
  await page.evaluate(() => { const i = products.findIndex(p => p.models.some(m => m.docs.length)); const j = products[i].models.findIndex(m => m.docs.length); openDocInputModal(i, j); });
  await page.waitForSelector('#existing-docs-list .doc-card');
  await clearW(); const cardsBefore = (await page.$$('#existing-docs-list .doc-card')).length;
  await page.locator('#existing-docs-list .doc-card').first().locator('button:has-text("삭제")').click(); await page.waitForTimeout(400);
  ok((await writes()).some(x => x.t === 'documents' && x.k === 'delete') && (await page.$$('#existing-docs-list .doc-card')).length === cardsBefore - 1, '문서 입력창의 「삭제」도 이제 DB에서 실제로 삭제한다 (예전에는 화면에서만 지워짐)');
  await page.evaluate(() => closeModal('modal-doc-input'));

  const realErrs = errs.filter(e => !/\{message: fail\}/.test(e));
  ok(realErrs.length === 0, '페이지 오류 없음(의도한 저장 실패 로그 제외)' + (realErrs.length ? ' ' + JSON.stringify(realErrs) : ''));
  await browser.close(); srv.close();
  console.log('\n통과 ' + pass + ' / 실패 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('시험 중단:', e); process.exit(2); });
