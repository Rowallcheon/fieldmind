// 바로 채팅(그룹 설정) 브라우저 시험 (가짜 DB/Gemini). 실행: node tests/direct-chat/e2e.js
const http = require('http'), fs = require('fs'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const PORT = 54343, BASE = 'http://127.0.0.1:' + PORT, INDEX = path.join(__dirname, '..', '..', 'index.html');
const srv = http.createServer((req, res) => { if (req.url.split('?')[0] === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(fs.readFileSync(INDEX)); } res.statusCode = 404; res.end(); });
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
  const browser = await chromium.launch();
  const mkPage = async () => {
    const page = await (await browser.newContext({ viewport: { width: 1200, height: 1500 } })).newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|\{message: fail\}/.test(m.text())) errs.push('console: ' + m.text()); });
    page.reqs = []; page.route_reply = () => '{"action":"unknown"}'; page.answer = '답변입니다. [[참조: 1]]';
    await page.route('**/*', r => { const u = r.request().url();
      if (u.includes('supabase-js')) return r.fulfill({ contentType: 'application/javascript', body: STUB });
      if (u.includes('generativelanguage.googleapis.com')) {
        const req = JSON.parse(r.request().postData()); const sys = req.system_instruction.parts[0].text; const isRoute = sys.includes('문서 검색 도우미');
        page.reqs.push({ isRoute, sys, req });
        return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: isRoute ? page.route_reply(sys) : page.answer }] } }] }) }); }
      if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); return r.abort(); });
    page.errs = errs; return page;
  };
  const login = async (page, id) => { await page.goto(BASE + '/'); await page.waitForTimeout(600); await page.fill('#login-id', id); await page.fill('#login-pw', '1234'); await page.click('.login-btn'); await page.waitForSelector('#screen-chat.active', { timeout: 8000 }); };
  const ask = async (page, q) => { const n = await page.$$eval('.msg.bot', l => l.length); await page.evaluate(t => { document.getElementById('chat-inp').value = t; sendMsg(); }, q); await page.waitForFunction(k => document.querySelectorAll('.msg.bot:not([id])').length > k, n, { timeout: 8000 }); await page.waitForTimeout(150); };
  const numOf = (sys, title) => Number((sys.split('\n').find(l => l.includes('| ' + title)) || '').split(' | ')[0]);

  console.log('[일반 그룹 사용자]');
  const n = await mkPage(); await login(n, 'u2');
  ok(await n.locator('.select-bar').isVisible() && !(await n.$eval('#screen-chat', e => e.classList.contains('direct-mode'))), '"바로 채팅"이 없는 그룹은 기존처럼 제품군·모델 선택 줄이 보인다');

  console.log('[바로 채팅 사용자 (정수기+행정, 문서 많음)]');
  const u = await mkPage(); await login(u, 'u1');
  ok(!(await u.locator('.select-bar').isVisible()) && await u.$eval('#screen-chat', e => e.classList.contains('direct-mode')), '제품군·모델 선택 줄이 숨겨지고 채팅창만 보인다');
  ok(!(await u.$eval('#chat-inp', e => e.disabled)) && /전체 검색/.test(await u.textContent('#ctx-banner')) && /문서 4건/.test(await u.textContent('#ctx-banner')), '입력창이 바로 켜져 있고 열람 가능한 문서 4건으로 표시된다');
  ok(/무엇이든 물어보세요/.test(await u.textContent('#chat-body')), '환영 문구가 보인다');
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
  ok(/어느 모델의 사용설명서인가요/.test(await u.textContent('.msg.bot:last-child')) && (await u.$$eval('.msg.bot:last-child .quick-btn', l => l.map(b => b.textContent))).join() === 'CP-X501,CP-PS', '모호하면 되묻고 선택 버튼(보기)을 보여 준다');
  u.route_reply = sys => JSON.stringify({ action: 'select', docs: [numOf(sys, '정수기 > CP-X501 | 사용설명서 | CP-X501 사용설명서')] });
  u.answer = 'X501 설명입니다.\n[[참조: 1]]';
  u.reqs.length = 0;
  await u.click('.msg.bot:last-child .quick-btn:has-text("CP-X501")'); await u.waitForTimeout(700);
  const r2 = u.reqs.filter(x => x.isRoute);
  ok(r2.length === 1 && r2[0].req.contents.map(c => c.parts[0].text).join('|').includes('어느 모델의 사용설명서인가요') && r2[0].req.contents.at(-1).parts[0].text === 'CP-X501', '버튼을 누르면 그 말이 답으로 전달되고, 이전 되묻기 대화를 이어서 해석한다');
  ok(/X501 설명입니다/.test(await u.textContent('#chat-body')), '선택 후 답변이 나온다');
  // 3) 못 찾음(unknown) → 제품군/모델 고르기
  u.reqs.length = 0; u.route_reply = () => '{"action":"unknown"}';
  await ask(u, '아무말 대잔치');
  ok(/제품군을 골라/.test(await u.textContent('.msg.bot:last-child')) && (await u.$$eval('.msg.bot:last-child .quick-btn', l => l.map(b => b.textContent.trim()))).join() === '🗂️ 지국_행정용,💧 정수기', 'AI가 못 알아듣거나 없는 내용이면 자동으로 제품군 선택이 나온다');
  ok(await u.evaluate(() => chatLogs[0].ok === false), '못 찾은 질문은 관리자 로그에 "실패"로 남는다');
  await u.click('.msg.bot:last-child .quick-btn:has-text("정수기")'); await u.waitForTimeout(200);
  ok((await u.$$eval('.msg.bot:last-child .quick-btn', l => l.map(b => b.textContent.trim()))).join() === 'CP-X501,CP-PS,← 다른 제품군', '제품군을 누르면 그 제품군의 모델 선택이 나온다');
  u.reqs.length = 0; u.answer = 'PS 답변입니다.\n[[참조: 1, 2]]';
  await u.click('.msg.bot:last-child .quick-btn:has-text("CP-PS")'); await u.waitForTimeout(800);
  const a3 = u.reqs.filter(x => !x.isRoute);
  ok(a3.length === 1 && a3[0].sys.includes('PPP') && a3[0].sys.includes('FLOW') && !a3[0].sys.includes('XXX') && a3[0].sys.includes('제품군 "정수기" > 모델 "CP-PS"'), '모델을 고르면 그 모델 문서 전체로 같은 질문에 다시 답한다');
  ok(/PS 답변입니다/.test(await u.textContent('#chat-body')) && /정수기 > CP-PS/.test(await u.textContent('#chat-body')), '고른 범위가 대화에 표시되고 답변이 나온다');
  // 4) 답변 단계에서 "찾을 수 없습니다" → 제품군 고르기
  u.route_reply = sys => JSON.stringify({ action: 'select', docs: [numOf(sys, '정수기 > CP-PS | 기술교본 | CP-PS 유로도')] });
  u.answer = '해당 정보를 찾을 수 없습니다.\n[[참조: 없음]]';
  const before = await u.$$eval('.msg.bot', l => l.length);
  await ask(u, '없는 내용 질문');
  ok(!/해당 정보를 찾을 수 없습니다/.test(await u.textContent('#chat-body').then(t => t.split('없는 내용 질문').pop())) && /제품군을 골라/.test(await u.textContent('.msg.bot:last-child')), '골라 준 문서에도 답이 없으면 "찾을 수 없습니다" 대신 제품군 선택으로 안내한다');
  ok(u.errs.length === 0, '페이지 오류 없음' + (u.errs.length ? JSON.stringify(u.errs) : ''));

  console.log('[바로 채팅 사용자 (행정만, 문서 적음)]');
  const s = await mkPage(); await login(s, 'u3');
  s.answer = '퇴직 처리 답변.\n[[참조: 1]]';
  await ask(s, '퇴직 처리 어떻게 해?');
  ok(s.reqs.filter(x => x.isRoute).length === 0 && s.reqs.length === 1 && s.reqs[0].sys.includes('AAA') && !s.reqs[0].sys.includes('XXX'), '문서가 적으면 선택 단계 없이 허용된 문서 전부로 바로 답하고, 허용되지 않은 제품군 문서는 쓰지 않는다');

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
