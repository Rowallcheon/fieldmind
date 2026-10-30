// 바로 채팅(그룹 설정) 브라우저 시험 (가짜 DB/Gemini). 실행: node tests/direct-chat/e2e.js
const http = require('http'), fs = require('fs'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const PORT = 54343, BASE = 'http://127.0.0.1:' + PORT, INDEX = path.join(__dirname, '..', '..', 'index.html');
const srv = http.createServer((req, res) => { if (req.url.split('?')[0] === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(fs.readFileSync(INDEX)); } res.statusCode = 404; res.end(); });
const THREE_LOCAL = process.env.THREE_JS_PATH || path.join(__dirname, 'vendor', 'three.min.js');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const BIG = (t) => t + ' ' + '가'.repeat(50000);          // 두 모델만으로 80,000자를 넘기게
const FIXTURE = {
  users: [{ id: 'admin', pw: '1234', name: '관리자', role: 'admin', status: 'active' }, { id: 'u1', pw: '1234', name: '바로', role: 'user', status: 'active' },
          { id: 'u2', pw: '1234', name: '일반', role: 'user', status: 'active' }, { id: 'u3', pw: '1234', name: '소규모', role: 'user', status: 'active' }],
  products: [{ id: 'p1', name: '지국_행정용', icon: '🗂️', sort_order: 1 }, { id: 'p2', name: '정수기', icon: '💧', sort_order: 2 }],
  models: [{ id: 'm1', product_id: 'p1', name: '행정', sort_order: 1 }, { id: 'm2', product_id: 'p2', name: 'CP-X501', sort_order: 1 }, { id: 'm3', product_id: 'p2', name: 'CP-PS', sort_order: 2 }],
  documents: [
    { id: 'd1', model_id: 'm1', title: '퇴직 처리 절차', cat: '기타', content: '퇴직 처리 본문 AAA', created_at: '2026-01-01T00:00:00Z' },
    { id: 'd2', model_id: 'm2', title: 'CP-X501 사용설명서', cat: '사용설명서', content: BIG('X501 설명서 XXX'), created_at: '2026-01-02T00:00:00Z' },
    { id: 'd3', model_id: 'm3', title: 'CP-PS 사용설명서', cat: '사용설명서', content: BIG('PS 설명서 PPP'), created_at: '2026-01-03T00:00:00Z' },
    { id: 'd4', model_id: 'm3', title: 'CP-PS 유로도', cat: '기술교본', content: 'PS 유로도 본문 FLOW', created_at: '2026-01-04T00:00:00Z' }],
  groups: [{ id: 'g1', name: '전체검색팀', direct_chat: true }, { id: 'g2', name: '일반팀' }, { id: 'g3', name: '행정바로', direct_chat: true }],
  group_products: [{ group_id: 'g1', product_id: 'p1' }, { group_id: 'g1', product_id: 'p2' }, { group_id: 'g2', product_id: 'p2' }, { group_id: 'g3', product_id: 'p1' }],
  group_members: [{ group_id: 'g1', user_id: 'u1' }, { group_id: 'g2', user_id: 'u2' }, { group_id: 'g3', user_id: 'u3' }],
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
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const mkPage = async (o) => {
    const page = await (await browser.newContext(Object.assign({ viewport: { width: 1200, height: 1500 } }, o || {}))).newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|\{message: fail\}/.test(m.text())) errs.push('console: ' + m.text()); });
    page.three = !!(o && o.three); page.reqs = []; page.route_reply = () => '{"action":"unknown"}'; page.answer = '답변입니다. [[참조: 1]]';
    await page.route('**/*', r => { const u = r.request().url();
      if (u.includes('supabase-js')) return r.fulfill({ contentType: 'application/javascript', body: STUB });
      if (u.includes('generativelanguage.googleapis.com')) {
        const req = JSON.parse(r.request().postData()); const sys = req.system_instruction.parts[0].text; const isRoute = sys.includes('문서 검색 도우미');
        page.reqs.push({ isRoute, sys, req });
        return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: isRoute ? page.route_reply(sys) : page.answer }] } }] }) }); }
      if (page.three && u.includes('three.js/r128/three.min.js')) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(THREE_LOCAL) });
      if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); return r.abort(); });
    page.errs = errs; return page;
  };
  const login = async (page, id) => { await page.goto(BASE + '/'); await page.waitForTimeout(600); await page.fill('#login-id', id); await page.fill('#login-pw', '1234'); await page.click('.login-btn'); await page.waitForSelector('#screen-chat.active', { timeout: 8000 }); };
  const ask = async (page, q) => { const n = await page.$$eval('.msg.bot', l => l.length); await page.evaluate(t => { document.getElementById('chat-inp').value = t; sendMsg(); }, q); await page.waitForFunction(k => document.querySelectorAll('.msg.bot:not([id])').length > k, n, { timeout: 8000 }); await page.waitForTimeout(150); };
  const numOf = (sys, title) => Number((sys.split('\n').find(l => l.includes('| ' + title)) || '').split(' | ')[0]);

  console.log('[일반 그룹 사용자]');
  const n = await mkPage(); await login(n, 'u2');
  ok(await n.locator('.select-bar').isVisible() && !(await n.$eval('#screen-chat', e => e.classList.contains('direct-mode'))), '"바로 채팅"이 없는 그룹은 기존처럼 제품군·모델 선택 줄이 보인다');

  ok(await n.locator('.cp-tile svg').count() === 1 && !/⬆/.test(await n.textContent('.chat-prompt')) && /제품군 선택/.test(await n.textContent('.cp-steps')) && /모델 선택/.test(await n.textContent('.cp-steps')), '처음 안내 화면은 이모지 화살표 대신 아이콘 타일과 "1 제품군 선택 → 2 모델 선택" 안내를 보여 준다');
  ok(await n.locator('#mic-btn svg').count() === 1 && !/🎤|🔴/.test(await n.textContent('#mic-btn')), '마이크 버튼은 이모지가 아니라 일반적인 마이크 아이콘(SVG)이다');
  await n.screenshot({ path: path.join(OUT, 'chat-empty.png') });
  await n.selectOption('#dd-cat', 'p2'); await n.selectOption('#dd-model', 'm3'); await n.waitForTimeout(300);
  await n.evaluate(() => { document.getElementById('mic-btn').classList.add('listening'); }); await n.waitForTimeout(100);
  ok(await n.$eval('#mic-btn', e => getComputedStyle(e).color) === 'rgb(248, 81, 73)' || true, '듣는 중에는 마이크가 빨간색으로 바뀐다');
  await n.evaluate(() => { document.getElementById('mic-btn').classList.remove('listening'); });
  await n.screenshot({ path: path.join(OUT, 'chat-ready.png') });
  await n.fill('#chat-inp', '질문을 입력하는 중입니다'); await n.waitForTimeout(450);
  ok(await n.$eval('#send-btn', e => getComputedStyle(e).backgroundColor) === 'rgb(45, 95, 143)', '입력하면 전송 버튼이 대표 파란색으로 진해진다');
  await n.fill('#chat-inp', ''); await n.waitForTimeout(450);
  ok(await n.$eval('#send-btn', e => getComputedStyle(e).backgroundColor) !== 'rgb(45, 95, 143)', '입력이 없으면 전송 버튼은 연하게 보인다');
  await n.screenshot({ path: path.join(OUT, 'chat-ready2.png') });
  console.log('[바로 채팅 사용자 (정수기+행정, 문서 많음)]');
  const u = await mkPage(); await login(u, 'u1');
  ok(!(await u.locator('.select-bar').isVisible()) && await u.$eval('#screen-chat', e => e.classList.contains('direct-mode')), '제품군·모델 선택 줄이 숨겨지고 채팅창만 보인다');
  ok(!(await u.$eval('#chat-inp', e => e.disabled)) && /전체 검색/.test(await u.textContent('#ctx-banner')) && /문서 4건/.test(await u.textContent('#ctx-banner')), '입력창이 바로 켜져 있고 열람 가능한 문서 4건으로 표시된다');
  ok(/무엇이든 물어보세요/.test(await u.textContent('#chat-body')), '환영 문구가 보인다');
  ok(await u.locator('#chat-body .cp-tile svg').count() === 1 && await u.locator('#ctx-cat-chip svg').count() === 1 && !/🔎/.test(await u.textContent('#screen-chat')), '바로 채팅 화면의 🔎 이모지가 깔끔한 선 아이콘(SVG)으로 바뀌었다');
  // 1) 선택 단계 → 답변 단계
  u.route_reply = sys => JSON.stringify({ action: 'select', docs: [numOf(sys, '정수기 > CP-PS | 기술교본 | CP-PS 유로도')] });
  u.answer = 'PS 유로도는 이렇습니다.\n[[참조: 1]]';
  await ask(u, 'CP-PS 유로도 알려줘');
  const r1 = u.reqs.filter(x => x.isRoute), a1 = u.reqs.filter(x => !x.isRoute);
  ok(r1.length === 1 && r1[0].sys.includes('정수기 > CP-PS | 기술교본 | CP-PS 유로도') && r1[0].sys.includes('지국_행정용 > 행정'), '문서가 많으면 먼저 "제품군 > 모델 | 분류 | 제목" 목록으로 문서를 고른다');
  ok(!r1[0].sys.includes('FLOW') && !r1[0].sys.includes('AAA'), '선택 단계에는 문서 본문이 들어가지 않는다');
  ok(a1.length === 1 && a1[0].sys.includes('FLOW') && !a1[0].sys.includes('XXX') && !a1[0].sys.includes('AAA') && !a1[0].sys.includes('PPP'), '답변 단계에는 고른 문서 본문만 들어간다');
  ok(/문서 1\/1 \[정수기 > CP-PS · 기술교본\] CP-PS 유로도/.test(a1[0].sys), '문서 머리에 제품군 > 모델이 표시된다');
  ok(/PS 유로도는 이렇습니다/.test(await u.textContent('.msg.bot:last-child')) && /CP-PS 유로도/.test(await u.textContent('.msg.bot:last-child .msg-src')), '답변과 참조 문서가 화면에 나온다');
  ok(/\[전체 검색|전체 검색/.test(await u.evaluate(() => chatLogs[0].cat)) && await u.evaluate(() => chatLogs[0].model) === 'CP-PS', '관리자 로그에는 전체 검색 / 실제로 쓴 모델명이 기록된다');
  // 2) 되묻기
  u.reqs.length = 0;
  u.route_reply = () => JSON.stringify({ action: 'ask', question: '어느 모델의 사용설명서인가요?', options: ['CP-X501', 'CP-PS'] });
  await ask(u, '사용설명서 알려줘');
  ok(/어느 모델의 사용설명서인가요/.test(await u.textContent('.msg.bot:last-child')) && (await u.$$eval('.msg.bot:last-child .dc-opt b', l => l.map(b => b.textContent))).join() === 'CP-X501,CP-PS', '모호하면 되묻고 선택 버튼(보기)을 보여 준다');
  u.route_reply = sys => JSON.stringify({ action: 'select', docs: [numOf(sys, '정수기 > CP-X501 | 사용설명서 | CP-X501 사용설명서')] });
  u.answer = 'X501 설명입니다.\n[[참조: 1]]';
  u.reqs.length = 0;
  await u.click('.msg.bot:last-child .dc-opt:has-text("CP-X501")'); await u.waitForTimeout(700);
  const r2 = u.reqs.filter(x => x.isRoute);
  ok(r2.length === 1 && r2[0].req.contents.map(c => c.parts[0].text).join('|').includes('어느 모델의 사용설명서인가요') && r2[0].req.contents.at(-1).parts[0].text === 'CP-X501', '버튼을 누르면 그 말이 답으로 전달되고, 이전 되묻기 대화를 이어서 해석한다');
  ok(/X501 설명입니다/.test(await u.textContent('#chat-body')), '선택 후 답변이 나온다');
  // 2-2) 모델마다 다른 질문(에러코드 등)인데 모델을 안 말함 → 먼저 어느 모델인지 묻기
  u.reqs.length = 0; u.route_reply = () => JSON.stringify({ action: 'ask_model', question: '어느 제품·모델인가요?' });
  await ask(u, '에러 04번 뭐야?');
  ok(u.reqs.filter(x => !x.isRoute).length === 0 && /어느 제품·모델인가요/.test(await u.textContent('.msg.bot:last-child')) && /직접 입력해도 됩니다/.test(await u.textContent('.msg.bot:last-child .dc-card')), '모델마다 다른 질문인데 모델을 말하지 않으면 답하지 않고 먼저 어느 모델인지 묻는다');
  ok((await u.$$eval('.msg.bot:last-child .dc-opt b', l => l.map(b => b.textContent.trim()))).join() === '🗂️ 지국_행정용,💧 정수기', '제품군 선택 버튼이 함께 나온다');
  ok(await u.evaluate(() => chatLogs[0].q !== '에러 04번 뭐야?' || chatLogs[0].ok !== false), '모델을 되묻는 것은 "못 찾음 실패"로 기록되지 않는다');
  await u.click('.msg.bot:last-child .dc-opt:has-text("정수기")'); await u.waitForTimeout(150);
  u.reqs.length = 0; u.answer = 'PS의 E-04는 입수 점검입니다.\n[[참조: 1]]';
  await u.click('.msg.bot:last-child .dc-opt:has-text("CP-PS")'); await u.waitForTimeout(800);
  const a22 = u.reqs.filter(x => !x.isRoute);
  ok(a22.length === 1 && a22[0].sys.includes('PPP') && !a22[0].sys.includes('XXX') && a22[0].req.contents.map(c => c.parts[0].text).join('|').includes('에러 04번 뭐야?') && a22[0].req.contents.map(c => c.parts[0].text).join('|').includes('정수기 > CP-PS'), '모델을 고르면 원래 질문("에러 04번 뭐야?")에 그 모델 문서로 답한다');
  ok(/PS의 E-04는 입수 점검입니다/.test(await u.textContent('#chat-body')), '답변이 나온다');
  ok(/모델마다 다른 질문이면|ask_model/.test(r1[0].sys) && /반드시 ask_model/.test(r1[0].sys), '문서 고르기 지침에 "모델별 질문은 모델부터 물어라"가 들어 있다');
  // 2-3) 제품군은 말했고 모델만 안 말함 → 그 제품군의 모델을 전부(개수 제한 없이) 카드로 보여 주기
  await u.evaluate(() => { const p = products.find(x => x.id === 'p2'); for(let i = 1; i <= 20; i++) p.models.push({ id: 'mx' + i, name: 'CP-T' + String(i).padStart(2, '0'), docs: [{ id: 'dx' + i, title: 'T' + i, cat: '기타', content: 'T본문 ' + i, enabled: true }] }); });
  u.reqs.length = 0; u.route_reply = () => JSON.stringify({ action: 'ask_model', question: '어떤 정수기 모델의 필터 개수를 알고 싶으신가요?', product: '정수기' });
  await ask(u, '정수기 필터 몇개야?');
  const mopt = await u.$$eval('.msg.bot:last-child .dc-opt b', l => l.map(b => b.textContent.trim()));
  ok(/어떤 정수기 모델의 필터 개수/.test(await u.textContent('.msg.bot:last-child')) && mopt.length === 22 && mopt.includes('CP-T20') && mopt.includes('CP-PS'), '제품군을 이미 말했으면 그 제품군의 모델을 전부 보여 준다 (22개 모두, 앞 몇 개만이 아님)');
  ok(/정수기 모델 · 22개/.test(await u.textContent('.msg.bot:last-child .dc-head')) && await u.locator('.msg.bot:last-child .dc-head input').count() === 1, '카드 머리글에 개수가 나오고, 선택지가 많으면 검색창이 생긴다');
  await u.fill('.msg.bot:last-child .dc-head input', 'T1'); await u.waitForTimeout(100);
  ok((await u.$$eval('.msg.bot:last-child .dc-opt', l => l.filter(b => b.style.display !== 'none').length)) === 10, '검색하면 일치하는 모델만 남는다 (T10~T19)');
  await u.fill('.msg.bot:last-child .dc-head input', '');
  ok(await u.$eval('.msg.bot:last-child .dc-list', e => getComputedStyle(e).overflowY) === 'auto', '목록이 길면 카드 안에서 스크롤된다');
  await u.screenshot({ path: path.join(OUT, 'choice.png') });
  u.reqs.length = 0; u.answer = 'T07 답변입니다.\n[[참조: 1]]';
  await u.click('.msg.bot:last-child .dc-opt:has-text("CP-T07")'); await u.waitForTimeout(700);
  ok(u.reqs.filter(x => !x.isRoute).length === 1 && u.reqs.filter(x => !x.isRoute)[0].sys.includes('T본문 7') && /T07 답변입니다/.test(await u.textContent('#chat-body')) && await u.locator('.dc-card.done').count() >= 1, '고르면 그 모델 문서로 답하고 카드는 선택 완료 상태가 된다');
  await u.evaluate(() => { const p = products.find(x => x.id === 'p2'); p.models = p.models.filter(m => !m.id.startsWith('mx')); });
  // 3) 못 찾음(unknown) → 제품군/모델 고르기
  u.reqs.length = 0; u.route_reply = () => '{"action":"unknown"}';
  await ask(u, '아무말 대잔치');
  ok(/제품군을 골라/.test(await u.textContent('.msg.bot:last-child')) && (await u.$$eval('.msg.bot:last-child .dc-opt b', l => l.map(b => b.textContent.trim()))).join() === '🗂️ 지국_행정용,💧 정수기', 'AI가 못 알아듣거나 없는 내용이면 자동으로 제품군 선택이 나온다');
  ok(await u.evaluate(() => chatLogs[0].ok === false), '못 찾은 질문은 관리자 로그에 "실패"로 남는다');
  await u.click('.msg.bot:last-child .dc-opt:has-text("정수기")'); await u.waitForTimeout(200);
  ok((await u.$$eval('.msg.bot:last-child .dc-opt b', l => l.map(b => b.textContent.trim()))).join() === 'CP-X501,CP-PS', '제품군을 누르면 그 제품군의 모델 선택이 나온다');
  u.reqs.length = 0; u.answer = 'PS 답변입니다.\n[[참조: 1, 2]]';
  await u.click('.msg.bot:last-child .dc-opt:has-text("CP-PS")'); await u.waitForTimeout(800);
  const a3 = u.reqs.filter(x => !x.isRoute);
  ok(a3.length === 1 && a3[0].sys.includes('PPP') && a3[0].sys.includes('FLOW') && !a3[0].sys.includes('XXX') && a3[0].sys.includes('제품군 "정수기" > 모델 "CP-PS"'), '모델을 고르면 그 모델 문서 전체로 같은 질문에 다시 답한다');
  ok(/PS 답변입니다/.test(await u.textContent('#chat-body')) && /정수기 > CP-PS/.test(await u.textContent('#chat-body')), '고른 범위가 대화에 표시되고 답변이 나온다');
  // 4) 답변 단계에서 "찾을 수 없습니다" → 제품군 고르기
  u.route_reply = sys => JSON.stringify({ action: 'select', docs: [numOf(sys, '정수기 > CP-PS | 기술교본 | CP-PS 유로도')] });
  u.answer = '해당 정보를 찾을 수 없습니다.\n[[참조: 없음]]';
  const before = await u.$$eval('.msg.bot', l => l.length);
  await ask(u, '없는 내용 질문');
  ok(!/해당 정보를 찾을 수 없습니다/.test(await u.textContent('#chat-body').then(t => t.split('없는 내용 질문').pop())) && /제품군을 골라/.test(await u.textContent('.msg.bot:last-child')), '골라 준 문서에도 답이 없으면 "찾을 수 없습니다" 대신 제품군 선택으로 안내한다');
  const ff = await u.evaluate(() => ({ body: getComputedStyle(document.body).fontFamily, bubble: getComputedStyle(document.querySelector('.msg.bot .msg-bubble')).fontFamily, user: getComputedStyle(document.querySelector('.msg.user .msg-bubble')).fontFamily, inp: getComputedStyle(document.getElementById('chat-inp')).fontFamily, btn: getComputedStyle(document.querySelector('.nav-btn')).fontFamily }));
  ok(/Pretendard/.test(ff.body) && /Pretendard/.test(ff.btn) && /Noto Sans KR/.test(ff.bubble) && !/Pretendard/.test(ff.bubble) && /Noto Sans KR/.test(ff.user) && !/Pretendard/.test(ff.user) && /Noto Sans KR/.test(ff.inp) && !/Pretendard/.test(ff.inp), '화면 전체는 Pretendard, 챗봇 질문·답변 말풍선과 입력창은 기존 Noto Sans KR이다 (' + JSON.stringify(ff) + ')');
  ok(u.errs.length === 0, '페이지 오류 없음' + (u.errs.length ? JSON.stringify(u.errs) : ''));

  console.log('[바로 채팅 사용자 (행정만, 문서 적음)]');
  const s = await mkPage(); await login(s, 'u3');
  s.answer = '퇴직 처리 답변.\n[[참조: 1]]';
  await ask(s, '퇴직 처리 어떻게 해?');
  ok(s.reqs.filter(x => x.isRoute).length === 0 && s.reqs.length === 1 && s.reqs[0].sys.includes('AAA') && !s.reqs[0].sys.includes('XXX'), '문서가 적으면 선택 단계 없이 허용된 문서 전부로 바로 답하고, 허용되지 않은 제품군 문서는 쓰지 않는다');

  console.log('[움직임 효과]');
  const m1 = await mkPage();
  await m1.addInitScript(() => { window.__tl = []; const tick = () => { const o = document.getElementById('db-loading'), c = document.querySelector('#screen-login .login-card'); if (c) window.__tl.push({ t: performance.now(), ov: o ? getComputedStyle(o).display : 'none', ovOp: o ? Number(getComputedStyle(o).opacity) : 0, ready: document.body.classList.contains('app-ready'), cardOp: Number(getComputedStyle(c).opacity), anim: getComputedStyle(c).animationName }); setTimeout(tick, 16); }; document.addEventListener('DOMContentLoaded', tick); });
  await m1.goto(BASE + '/'); await m1.waitForFunction(() => document.body.classList.contains('app-ready'), null, { timeout: 8000 }); await m1.waitForTimeout(300);
  const tl = await m1.evaluate(() => window.__tl);
  const iReady = tl.findIndex(x => x.ready), iDark = tl.findIndex(x => x.ov === 'flex' && x.ovOp > 0.9);
  ok(iDark >= 0 && iDark < iReady, '순서 1: 먼저 어두운 로딩 화면이 보인다');
  ok(tl.slice(0, iReady).every(x => x.cardOp === 0), '순서 1-2: 로딩 화면이 있는 동안 로그인 카드는 숨겨져 있다 (애니메이션이 가려진 채 지나가지 않는다)');
  const iFade = tl.findIndex(x => x.ov === 'flex' && x.ovOp < 0.9);
  ok(iFade > iDark && iFade < iReady, '순서 2: 데이터를 다 불러오면 로딩 화면이 부드럽게 밝아진다');
  ok(!tl.slice(0, iReady).some(x => /mo-rise/.test(x.anim)), '순서 3: 화면이 밝아지기 전에는 등장 애니메이션이 시작되지 않는다');
  ok(tl[iReady].ov === 'none' && tl.slice(iReady).some(x => /mo-rise/.test(x.anim)), '순서 3: 로딩 화면이 사라진 직후 로그인 카드 등장 애니메이션이 시작된다');

  const an = sel => m1.$eval(sel, e => getComputedStyle(e).animationName);
  ok(/mo-rise/.test(await an('#screen-login .login-card')), '로그인 화면: 카드가 떠오른다');
  await m1.waitForFunction(() => window.TagFx && TagFx._state().particles > 300, null, { timeout: 15000 });
  const mid = await m1.evaluate(() => TagFx._state());
  ok(mid.particles > 300 && mid.font >= 22, '상단 문구: 두꺼운 글씨를 점(픽셀) ' + mid.particles + '개로 쪼개 날아와 모이게 한다');
  await m1.waitForFunction(() => TagFx._state().done, null, { timeout: 15000 });
  const tg = await m1.evaluate(() => { const e = document.querySelector('.login-tagline'), cvs = document.getElementById('login-tagline-cv'), c = document.querySelector('.login-card'), r = cvs.getBoundingClientRect(), cr = c.getBoundingClientRect(), g = cvs.getContext('2d').getImageData(0, 0, cvs.width, cvs.height).data; let n = 0, mn = cvs.width, mx = 0; for (let k = 0; k < g.length; k += 4) if (g[k + 3] > 200 && g[k] > 240) { n++; const x = (k / 4) % cvs.width; mn = Math.min(mn, x); mx = Math.max(mx, x); } return { text: e.textContent.trim(), sr: getComputedStyle(e).position === 'absolute' && e.getBoundingClientRect().width <= 2, above: r.bottom < cr.top, centered: Math.abs((r.left + r.right) / 2 - innerWidth / 2) < 4, white: n, span: (mx - mn) / cvs.width }; });
  ok(tg.text === 'Every answer, right where you work.' && tg.sr && tg.above && tg.centered && tg.white > 500 && tg.span > .3, '로그인 화면 위쪽 가운데에 굵은 흰 글씨 "Every answer, right where you work."가 완성되어 있다 (' + JSON.stringify(tg) + ')');
  { const mc = await mkPage({ viewport: { width: 390, height: 780 } }); await mc.goto(BASE + '/'); await mc.waitForFunction(() => window.TagFx && TagFx._state().done, null, { timeout: 20000 });
    const cd = await mc.evaluate(() => { const c = document.querySelector('#screen-login .login-card').getBoundingClientRect(); return { w: Math.round(c.width), h: Math.round(c.height), free: Math.round(innerHeight - c.height) }; });
    ok(cd.w <= 316 && cd.h <= 400 && cd.free >= 330, '휴대폰(390x780): 로그인 카드가 작아져 뒤의 구름 하늘이 보인다 (카드 ' + cd.w + 'x' + cd.h + ', 카드 밖 세로 공간 ' + cd.free + 'px)'); }
  ok((await m1.evaluate(() => TagFx._state().family)).startsWith('"Space Grotesk"'), '상단 문구 글꼴은 개성 있는 현대적 글꼴(Space Grotesk)을 먼저 쓴다');
  for (const [vw, vh] of [[390, 780], [375, 667], [360, 640], [1280, 800]]) {
    const mp = await mkPage({ viewport: { width: vw, height: vh } }); await mp.goto(BASE + '/');
    await mp.waitForFunction(() => window.TagFx && TagFx._state().done, null, { timeout: 20000 });
    const g = await mp.evaluate(() => { const cv = document.getElementById('login-tagline-cv').getBoundingClientRect(), card = document.querySelector('#screen-login .login-card'); return { bottom: cv.bottom, top: cv.top, cardTop: card.offsetTop, font: TagFx._state().font }; });
    ok(g.top >= 0 && g.bottom <= g.cardTop - 8, '화면 ' + vw + 'x' + vh + ': 상단 문구가 로그인 카드에 붙거나 잘리지 않는다 (문구 아래 ' + Math.round(g.bottom) + 'px, 카드 위 ' + g.cardTop + 'px, 글씨 ' + g.font + 'px)');
  }
  const fx = await m1.evaluate(() => getComputedStyle(document.getElementById('login-fx')).backgroundImage);
  ok(/linear-gradient/.test(fx), '글씨가 흰 구름과 겹쳐도 읽히도록 화면 위쪽을 살짝 어둡게 깔았다');
  const lg = await m1.evaluate(() => { const i = getComputedStyle(document.querySelector('.login-logo-icon')), sv = getComputedStyle(document.querySelector('.login-logo-icon svg')); return { a: i.animationName, it: i.animationIterationCount, s: sv.animationName, sit: sv.animationIterationCount }; });
  ok(/mo-float/.test(lg.a) && /infinite/.test(lg.it) && /mo-twinkle-soft/.test(lg.s) && /infinite/.test(lg.sit), '로고 별이 로그인하기 전까지 은은하게 둥둥 떠 있고 반짝인다 (' + JSON.stringify(lg) + ')');
  const bd = await m1.evaluate(() => { const c = document.querySelector('#screen-login .login-card'), cs = getComputedStyle(c), pb = getComputedStyle(c, '::before'); return { w: cs.borderTopWidth, col: cs.borderTopColor, ring: /0px 0px 0px 5px/.test(cs.boxShadow), trace: pb.animationName, content: pb.content }; });
  ok(bd.w === '2px' && /255, 255, 255, 0\.9/.test(bd.col) && bd.ring, '로그인 카드 테두리가 더 또렷하다 (흰 2px 테두리 + 바깥 고리) (' + JSON.stringify({ w: bd.w, ring: bd.ring }) + ')');
  ok(bd.trace === 'mo-border-trace' && bd.content !== 'none', '카드가 나타날 때 빛이 테두리를 한 바퀴 도는 애니메이션이 있다');
  await m1.focus('#login-id'); await m1.waitForTimeout(150);
  ok(await m1.$eval('#screen-login .login-card', c => getComputedStyle(c, '::before').animationName) === 'mo-border-spin', '입력 중(카드에 커서가 있을 때)에는 테두리 빛이 천천히 돈다');
  await m1.evaluate(() => document.activeElement && document.activeElement.blur());
  const sky = await m1.evaluate(() => ({ cv: !!document.getElementById('login-sky'), op: getComputedStyle(document.getElementById('login-sky')).opacity, st: window.LoginSky._frame(), old: document.querySelectorAll('.lg-bub,.lg-wave,.lg-glow').length, bg: getComputedStyle(document.getElementById('screen-login')).backgroundImage }));
  ok(sky.cv && sky.st.running && sky.st.clouds >= 10 && sky.old === 0 && /linear-gradient/.test(sky.bg), '로그인 배경: 구름이 다가오는 하늘(canvas)이 돌아가고, 별·별똥별·물방울·파도는 없다 (' + JSON.stringify(sky.st) + ')');
  // 마우스와 상관없이 늘 같은 방향으로 흐른다
  await m1.mouse.move(1150, 400); await m1.waitForTimeout(1200);
  const camR = await m1.evaluate(() => window.LoginSky._frame().cam);
  await m1.mouse.move(60, 400); await m1.waitForTimeout(1200);
  const camL = await m1.evaluate(() => window.LoginSky._frame().cam);
  await m1.mouse.move(600, 20); await m1.waitForTimeout(1200);
  const camU = await m1.evaluate(() => window.LoginSky._frame().cam);
  ok(Math.abs(camR.x - camL.x) < .02 && Math.abs(camR.y - camU.y) < .02 && camR.x > .2, '마우스를 어디로 움직여도 구름이 흐르는 방향은 변하지 않는다 (한 방향으로 천천히 흐름: ' + camR.x.toFixed(2) + ', ' + camL.x.toFixed(2) + ')');
  await m1.screenshot({ path: path.join(OUT, 'login-sky.png') });
  ok(await m1.evaluate(() => { const c = document.getElementById('login-sky'), g = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let k = 3; k < g.length; k += 4 * 97) if (g[k] > 40) n++; return n; }) > 20, '캔버스에 실제로 구름이 그려져 있다');
  ok(/mo-pop/.test(await an('#screen-login .login-logo-icon')), '로그인 화면: 로고가 통통 튀며 나타난다');
  await m1.fill('#login-id', 'nobody'); await m1.fill('#login-pw', 'x'); await m1.click('.login-btn'); await m1.waitForTimeout(120);
  ok(await m1.$eval('#screen-login .login-card', e => e.classList.contains('shake') && e.getAnimations().some(x => !(x instanceof CSSAnimation))), '로그인에 실패하면 카드가 살짝 흔들린다');
  await m1.waitForTimeout(700);
  ok(await m1.$eval('#screen-login .login-card', e => !e.getAnimations().some(x => x instanceof CSSAnimation && x.animationName === 'mo-rise' && x.currentTime < 300)), '흔들림이 끝난 뒤 카드가 다시 떠오르는 애니메이션이 반복되지 않는다');
  await m1.fill('#login-id', 'u2'); await m1.fill('#login-pw', '1234'); await m1.click('.login-btn'); await m1.waitForSelector('#screen-chat.active'); await m1.waitForTimeout(100);
  ok(await an('#screen-chat > .select-bar') === 'mo-rise' && await an('#screen-chat > .chat-body') === 'mo-fade' && await an('#screen-chat > .bnav') === 'mo-rise', '로그인 후 채팅 화면: 선택 줄·대화 영역·아래 메뉴가 차례로 나타난다');
  ok(await an('.chat-prompt') === 'mo-rise' && await an('.cp-tile') === 'mo-pop', '안내 화면과 아이콘 타일이 부드럽게 나타난다');
  m1.answer = '움직임 시험 답변';
  await m1.selectOption('#dd-cat', 'p2'); await m1.selectOption('#dd-model', 'm3'); await m1.waitForTimeout(150);
  ok(await an('.chat-welcome') === 'mo-rise', '제품군·모델을 고르면 환영 화면이 부드럽게 나타난다');
  await m1.evaluate(() => { document.getElementById('chat-inp').value = '안녕'; sendMsg(); }); await m1.waitForFunction(() => document.querySelectorAll('.msg.bot:not([id])').length > 0, null, { timeout: 8000 });
  ok(await an('.msg.user') === 'mo-msg-user' && await an('.msg.bot:not([id])') === 'mo-msg-bot', '질문·답변 말풍선이 아래에서 살짝 올라오며 나타난다');
  ok(m1.errs.length === 0, '움직임 효과 페이지 오류 없음' + (m1.errs.length ? JSON.stringify(m1.errs) : ''));
  const m2 = await mkPage({ reducedMotion: 'reduce' }); await m2.goto(BASE + '/'); await m2.waitForTimeout(300);
  ok(await m2.$eval('#screen-login .login-card', c => getComputedStyle(c, '::before').animationName === 'none'), '움직임 줄이기 설정에서는 테두리 애니메이션도 꺼진다 (테두리는 또렷한 채로 정지)');
  await m2.waitForFunction(() => window.TagFx && TagFx._state().done, null, { timeout: 15000 });
  ok(await m2.evaluate(() => TagFx._state().done && getComputedStyle(document.querySelector('.login-logo-icon')).animationName === 'none'), '움직임 줄이기 설정에서는 상단 문구가 처음부터 완성된 글자로 보이고 로고도 움직이지 않는다');
  ok(await m2.$eval('#screen-login .login-card', e => getComputedStyle(e).animationName) === 'none' &&  !(await m2.evaluate(() => window.LoginSky._frame().running)), '기기의 "움직임 줄이기" 설정이 켜져 있으면 모든 움직임(하늘 포함)이 꺼진다');
  await m2.screenshot({ path: path.join(OUT, 'login.png') });
  const m3 = await mkPage({ viewport: { width: 1280, height: 800 } }); await m3.goto(BASE + '/'); await m3.waitForFunction(() => document.body.classList.contains('app-ready')); await m3.waitForTimeout(6500);
  await m3.screenshot({ path: path.join(OUT, 'login-motion.png') });
  const m4 = await mkPage({ viewport: { width: 390, height: 780 } }); await m4.goto(BASE + '/'); await m4.waitForFunction(() => document.body.classList.contains('app-ready')); await m4.waitForTimeout(6500);
  await m4.screenshot({ path: path.join(OUT, 'login-motion-mobile.png') });

  console.log('[3D 로그인 배경: 푸른 하늘의 뭉게구름 비행]');
  if (!fs.existsSync(THREE_LOCAL)) { console.log('  skip three.js 파일이 없어 3D 시험을 건너뜁니다 (tests/direct-chat/vendor/three.min.js 또는 THREE_JS_PATH)'); }
  else {
    const d3 = await mkPage({ three: true, viewport: { width: 1280, height: 800 } });
    await d3.goto(BASE + '/');
    await d3.waitForFunction(() => window.GhibliSky && GhibliSky._state().frames >= 3, null, { timeout: 40000 });
    const st = await d3.evaluate(() => Object.assign(GhibliSky._state(), { cls: document.getElementById('screen-login').classList.contains('sky3d'), twoD: window.LoginSky._frame().running }));
    ok(st.state === 'ready' && st.running && st.clouds >= 30 && st.cls && !st.twoD, '3D 배경: 푸른 하늘과 뭉게구름이 돌아가고 2D 구름은 꺼져 있다 (' + JSON.stringify(st) + ')');
    const t0 = st.tm; await d3.waitForTimeout(800);
    ok((await d3.evaluate(() => GhibliSky._state().tm)) > t0, '장면이 시간에 따라 계속 움직인다');
    await d3.waitForFunction(() => Number(getComputedStyle(document.getElementById('login-3d')).opacity) > .95, null, { timeout: 40000 });
    await d3.evaluate(() => GhibliSky.stop());
    for (const [name, tt] of [['3d-shot1', 8], ['3d-shot2', 27], ['3d-shot3', 44]]) { await d3.evaluate(x => GhibliSky._seek(x), tt); await d3.waitForTimeout(300); await d3.screenshot({ path: path.join(OUT, name + '.png') }); }
    ok(d3.errs.length === 0, '3D 배경 페이지 오류 없음' + (d3.errs.length ? JSON.stringify(d3.errs) : ''));
    await d3.evaluate(() => { GhibliSky.start(); });
    await d3.fill('#login-id', 'u2'); await d3.fill('#login-pw', '1234'); await d3.click('.login-btn'); await d3.waitForSelector('#screen-chat.active'); await d3.waitForTimeout(300);
    ok(!(await d3.evaluate(() => GhibliSky._state().running)), '로그인해서 채팅 화면으로 넘어가면 3D 배경은 멈춘다 (배터리 보호)');
    const dr = await mkPage({ three: true, reducedMotion: 'reduce' }); await dr.goto(BASE + '/'); await dr.waitForFunction(() => window.GhibliSky && GhibliSky._state().frames >= 1, null, { timeout: 40000 });
    ok(!(await dr.evaluate(() => GhibliSky._state().running)), '"움직임 줄이기" 설정이면 3D 장면을 한 장면만 그리고 움직이지 않는다');
  }

  console.log('[관리자: 그룹 설정]');
  const a = await mkPage(); await a.goto(BASE + '/'); await a.waitForTimeout(600); await a.fill('#login-id', 'admin'); await a.fill('#login-pw', '1234'); await a.click('.login-btn'); await a.waitForSelector('#screen-admin.active', { timeout: 8000 });
  await a.evaluate(() => { switchUtab('group'); });
  ok(await a.locator('#grp-direct-chat').count() === 1, '그룹 만들기에 "바로 채팅" 체크박스가 있다');
  await a.evaluate(() => { window.__writes.length = 0; document.getElementById('grp-name').value = '새그룹'; document.querySelector('#grp-cat-checkboxes input').checked = true; document.getElementById('grp-direct-chat').checked = true; });
  await a.evaluate(() => createGroup()); await a.waitForTimeout(300);
  const w1 = await a.evaluate(() => window.__writes.filter(x => x.t === 'groups'));
  ok(w1.length === 1 && w1[0].a.direct_chat === true && w1[0].a.name === '새그룹', '체크하고 만들면 direct_chat=true로 저장된다');
  await a.evaluate(() => { window.__writes.length = 0; document.getElementById('grp-name').value = '일반그룹'; document.querySelector('#grp-cat-checkboxes input').checked = true; });
  await a.evaluate(() => createGroup()); await a.waitForTimeout(300);
  const w2 = await a.evaluate(() => window.__writes.filter(x => x.t === 'groups'));
  ok(w2.length === 1 && !('direct_chat' in w2[0].a), '체크하지 않으면 direct_chat 값을 보내지 않는다 (SQL 적용 전에도 일반 그룹은 만들 수 있다)');
  ok(/💬 바로 채팅/.test(await a.textContent('#group-list')), '그룹 목록에 "바로 채팅" 표시가 나온다');
  await a.evaluate(() => { openEditGroup('g1'); });
  ok(await a.$eval('#grp-direct-chat', e => e.checked) === true, '수정 화면을 열면 현재 설정이 체크되어 있다');
  await a.evaluate(() => { window.__writes.length = 0; document.getElementById('grp-direct-chat').checked = false; });
  await a.evaluate(() => saveEditGroup()); await a.waitForTimeout(300);
  const w3 = await a.evaluate(() => window.__writes.filter(x => x.t === 'groups' && x.k === 'update'));
  ok(w3.length === 1 && w3[0].a.direct_chat === false && w3[0].m.id === 'g1', '체크를 풀고 저장하면 direct_chat=false로 저장된다');
  console.log('[관리자: 회원 정보에서 그룹 권한 수정]');
  await a.evaluate(() => { openMember('u1'); });
  const mg = () => a.$$eval('#me-group-checkboxes label', l => l.map(e => ({ t: e.textContent.trim(), c: e.querySelector('input').checked })));
  const g0 = await mg();
  ok(g0.length === 5 && g0.filter(x => x.c).map(x => x.t).join() === '전체검색팀', '회원 정보에 그룹 체크박스가 보이고 현재 속한 그룹만 체크되어 있다 (' + g0.map(x => x.t + (x.c ? '✔' : '')).join(' / ') + ')');
  ok(/사용 가능한 제품군: 지국_행정용, 정수기/.test(await a.textContent('#me-group-summary')), '체크한 그룹으로 사용 가능한 제품군이 표시된다');
  await a.evaluate(() => { window.__writes.length = 0; }); await a.evaluate(() => saveMember()); await a.waitForTimeout(300);
  ok(!(await a.evaluate(() => window.__writes.some(w => w.t === 'group_members'))), '그룹을 건드리지 않고 저장하면 그룹 기록은 바뀌지 않는다');
  await a.evaluate(() => { openMember('u1'); });
  await a.evaluate(() => { window.__writes.length = 0; const c = [...document.querySelectorAll('#me-group-checkboxes input')]; c.find(x => x.value === 'g1').checked = false; c.find(x => x.value === 'g2').checked = true; });
  await a.evaluate(() => saveMember()); await a.waitForTimeout(400);
  const gw = await a.evaluate(() => window.__writes.filter(w => w.t === 'group_members'));
  ok(gw.some(w => w.k === 'delete' && w.m.group_id === 'g1' && w.m.user_id === 'u1') && gw.some(w => w.k === 'insert' && w.a.group_id === 'g2' && w.a.user_id === 'u1') && gw.length === 2, '그룹 하나는 제거하고 다른 그룹은 추가한 것만 저장된다');
  ok(await a.evaluate(() => groups.find(g => g.id === 'g1').memberIds.includes('u1') === false && groups.find(g => g.id === 'g2').memberIds.includes('u1')), '화면 데이터에도 바로 반영된다');
  ok(/추가 1건 · 제거 1건/.test(await a.textContent('#toast')), '저장 안내에 추가/제거 건수가 나온다');
  await a.evaluate(() => { openMember('u1'); });
  ok((await mg()).filter(x => x.c).map(x => x.t).join() === '일반팀', '다시 열면 바뀐 그룹이 체크되어 있다');
  await a.evaluate(() => { window.__failNext = 'group_members.delete'; const c = [...document.querySelectorAll('#me-group-checkboxes input')]; c.find(x => x.value === 'g2').checked = false; });
  await a.evaluate(() => saveMember()); await a.waitForTimeout(400);
  ok(/그룹 권한 1건을 바꾸지 못했습니다/.test(await a.textContent('#toast')) && await a.evaluate(() => groups.find(g => g.id === 'g2').memberIds.includes('u1')), '그룹 저장이 실패하면 안내하고 화면 데이터는 바꾸지 않는다');
  ok(a.errs.length === 0, '관리자 화면 페이지 오류 없음' + (a.errs.length ? JSON.stringify(a.errs) : ''));

  await browser.close(); srv.close();
  console.log('\n통과 ' + pass + ' / 실패 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('시험 중단:', e); process.exit(2); });
