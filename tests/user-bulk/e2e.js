// 회원 일괄 등록(CSV/엑셀) · 그룹 배정 · 1000건 넘는 회원 읽기 브라우저 시험 (가짜 DB/Gemini)
// 실행: node tests/user-bulk/e2e.js   (Playwright + Chromium 필요. 엑셀 시험은 tests/doc-images/vendor/xlsx.full.min.js 가 있을 때만)
const http = require('http'), fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const PORT = 54343, BASE = 'http://127.0.0.1:' + PORT, INDEX = path.join(__dirname, '..', '..', 'index.html');
const XLSX_PATH = path.join(__dirname, '..', 'doc-images', 'vendor', 'xlsx.full.min.js'), HAVE_XLSX = fs.existsSync(XLSX_PATH);
const srv = http.createServer((req, res) => { if (req.url.split('?')[0] === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(fs.readFileSync(INDEX)); } res.statusCode = 404; res.end(); });
// 회원 2300명(서버는 한 번에 1000줄까지만 돌려준다), 그룹 회원 1500줄
const many = Array.from({ length: 2300 }, (_, i) => ({ id: 'old' + String(i).padStart(4, '0'), pw: '1234', name: '기존' + i, dept: '지국', role: 'user', status: 'active' }));
const FIXTURE = {
  users: [{ id: 'admin', pw: '1234', name: '관리자', role: 'admin', status: 'active' }].concat(many),
  products: [{ id: 'p1', name: '사무행정', icon: '🗂️', sort_order: 1 }], models: [{ id: 'm1', product_id: 'p1', name: '그룹웨어', sort_order: 1 }], documents: [],
  groups: [{ id: 'g1', name: '지국_행정' }, { id: 'g2', name: '지국' }],
  group_products: [{ group_id: 'g1', product_id: 'p1' }],
  group_members: many.slice(0, 1500).map(u => ({ group_id: 'g2', user_id: u.id })),
  app_settings: [], notices: [], inquiries: [], chat_logs: [], user_chat_logs: []
};
const STUB = `(function(){
 const FX=${JSON.stringify(FIXTURE)}; window.__writes=[]; window.__reads=[]; window.__failTable=null;
 function mk(t){ const q={}; let r=null, ord=[];
  ['select','eq','neq','in','gte','limit','is'].forEach(k=>q[k]=()=>q);
  q.order=c=>{ord.push(c);return q;}; q.range=(a,b)=>{r=[a,b];return q;};
  q.insert=a=>{ window.__writes.push({t,k:'insert',a}); if(window.__failTable===t&&Array.isArray(a)&&a.length>1) return Promise.resolve({error:{message:'batch fail'}}); return Promise.resolve({error:null}); };
  q.upsert=a=>Promise.resolve({error:null}); q.update=a=>({match:m=>Promise.resolve({error:null})}); q.delete=()=>({match:m=>Promise.resolve({error:null}),in:m=>Promise.resolve({error:null}),eq:()=>({eq:()=>Promise.resolve({error:null})})});
  q.then=(res,rej)=>{ let d=(FX[t]||[]).slice(); if(r){ window.__reads.push({t,r,ord}); d=d.slice(r[0],r[1]+1); } else { d=d.slice(0,1000); }   // 서버 제한: 범위를 안 주면 1000줄까지만
    return Promise.resolve({data:d,error:null,count:0}).then(res,rej); }; return q; }
 window.supabase={createClient:()=>({from:mk, rpc:()=>Promise.resolve({data:null,error:{message:'x'}}), storage:{from:()=>({})}})};
})()`;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
(async () => {
  await new Promise(r => srv.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 1400 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.route('**/*', r => { const u = r.request().url();
    if (u.includes('supabase-js')) return r.fulfill({ contentType: 'application/javascript', body: STUB });
    if (HAVE_XLSX && u.includes('/xlsx/0.18.5/xlsx.full.min.js')) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(XLSX_PATH) });
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); return r.abort(); });
  await page.goto(BASE + '/'); await page.waitForTimeout(1200);

  console.log('[1000줄이 넘는 회원 읽기]');
  const n = await page.evaluate(() => ({ users: users.length, gm: groups.find(g => g.id === 'g2').memberIds.length }));
  ok(n.users === 2301, '회원 2301명(1000줄 제한을 넘어도)이 전부 읽힌다: ' + n.users);
  ok(n.gm === 1500, '그룹 회원 1500줄도 전부 읽힌다: ' + n.gm);
  const rd = await page.evaluate(() => window.__reads.filter(x => x.t === 'users').map(x => x.r.join('-') + '/' + x.ord.join(',')));
  ok(rd.length === 3 && rd[0] === '0-999/id', '회원은 1000줄씩 정렬 기준(id)으로 3번에 나눠 읽는다: ' + rd.join(' | '));

  await page.fill('#login-id', 'admin'); await page.fill('#login-pw', '1234'); await page.click('.login-btn');
  await page.waitForSelector('#screen-admin.active', { timeout: 8000 });
  await page.evaluate(() => { showPanel('users'); switchUtab('csv'); });
  const up = async (name, buf) => { await page.setInputFiles('#csv-file-input', { name, mimeType: 'text/csv', buffer: buf }); await page.waitForSelector('#csv-preview', { state: 'visible', timeout: 8000 }); await page.waitForTimeout(100); };
  const submit = async () => { await page.evaluate(() => window.__writes.length = 0); await page.click('#csv-submit-btn'); await page.waitForSelector('#csv-result', { state: 'visible', timeout: 15000 }); };

  console.log('[일괄 등록: 미리보기 안내]');
  const csv1 = '아이디,이름,소속,비밀번호,권한,그룹\n' + [
    'new001,김하나,서부법인지국,pw1,user,지국 행정',       // 띄어쓰기가 달라도 "지국_행정"으로 본다
    'new002,이둘,남전주지국,pw2,user,지국_행정',
    'new003,박셋,마포지국,pw3,user,없는그룹',
    'new004,최넷,,pw4,user,',                                // 소속·그룹이 비어 있어도 등록
    'new002,중복행,x,x,user,지국_행정',                      // 파일 안 중복
    'old0001,기존계정,x,x,user,지국_행정',                   // 이미 있는 계정 + 그룹 아직 없음
    'old0002,기존계정2,x,x,user,지국',                       // 이미 있는 계정, 이미 그 그룹
  ].join('\n');
  await up('a.csv', Buffer.from(csv1, 'utf8'));
  const pv = await page.textContent('#csv-preview-rows');
  ok(/새로 등록 4명/.test(pv) && /이미 있는 계정 2명/.test(pv) && /파일 안 중복 1건 제외/.test(pv), '미리보기에 새 계정 4명 · 이미 있는 계정 2명 · 파일 안 중복 1건이 먼저 나온다: ' + pv.slice(0, 160).replace(/\s+/g, ' '));
  ok(/그룹을 찾지 못한 이름: 없는그룹 \(1명\)/.test(pv) && /현재 그룹: 지국_행정, 지국/.test(pv), '못 찾는 그룹 이름과 현재 그룹 목록을 등록 전에 알려 준다');
  await page.screenshot({ path: path.join(OUT, 'preview.png') });

  console.log('[일괄 등록: 저장 · 그룹 배정]');
  await submit();
  const w = await page.evaluate(() => window.__writes.map(x => ({ t: x.t, n: Array.isArray(x.a) ? x.a.length : 1, a: x.a })));
  const uw = w.filter(x => x.t === 'users'), gw = w.filter(x => x.t === 'group_members');
  ok(uw.length === 1 && uw[0].n === 4 && uw[0].a.map(r => r.id).join() === 'new001,new002,new003,new004', '새 계정 4명이 한 번에(묶음으로) 저장되고 이미 있는 계정·중복 줄은 저장하지 않는다');
  ok(uw[0].a[0].pw === 'pw1' && uw[0].a[3].dept === '' && uw[0].a.every(r => r.status === 'active'), '비밀번호·소속·상태가 맞게 저장된다 (소속이 빈 계정도 저장)');
  const gs = (gw[0] && gw[0].a || []).map(r => r.group_id + ':' + r.user_id).sort().join();
  ok(gs === 'g1:new001,g1:new002,g1:old0001', '그룹 배정: 새 계정 2명(띄어쓰기 달라도 인식) + 이미 있던 계정 1명(old0001)이 지국_행정에 들어간다 (이미 그 그룹에 있던 old0002는 다시 넣지 않음): ' + gs);
  const rs = await page.textContent('#csv-result');
  ok(/새 계정 4명 등록/.test(rs) && /그룹 배정 3명/.test(rs) && /이미 그 그룹에 있음 1명/.test(rs) && /없는그룹 \(1명\)/.test(rs), '결과가 화면에 남는다: ' + rs.replace(/\s+/g, ' ').slice(0, 220));
  ok(await page.evaluate(() => users.length === 2305 && groups.find(g => g.id === 'g1').memberIds.length === 3), '화면 데이터에도 반영된다 (회원 2305명, 지국_행정 3명)');
  await page.screenshot({ path: path.join(OUT, 'result.png') });

  console.log('[같은 파일을 다시 올리면]');
  await up('a.csv', Buffer.from(csv1, 'utf8'));
  const pv2 = await page.textContent('#csv-preview-rows');
  ok(/새로 등록 0명/.test(pv2) && /이미 있는 계정 6명/.test(pv2), '다시 올리면 새 계정 0명, 이미 있는 계정 6명으로 안내한다 (예전처럼 "중복이라 안 됨"이 아님)');
  await submit();
  const w2 = await page.evaluate(() => window.__writes.filter(x => x.t === 'users' || x.t === 'group_members').length);
  ok(w2 === 0, '모두 이미 반영된 상태에서는 저장 요청이 한 건도 나가지 않는다 (중복 저장·오류 없음)');
  ok(/새 계정 0명 등록/.test(await page.textContent('#csv-result')) && /그룹 배정 0명/.test(await page.textContent('#csv-result')), '결과: 새 계정 0명 · 그룹 배정 0명');

  console.log('[그룹을 나중에 고쳐서 다시 올리면: 이미 있는 계정에 그룹만 추가]');
  const csv2 = '아이디,이름,소속,비밀번호,권한,그룹\nnew003,박셋,마포지국,pw3,user,지국행정\nnew004,최넷,,pw4,user,지국';
  await up('b.csv', Buffer.from(csv2, 'utf8')); await submit();
  const g2 = await page.evaluate(() => window.__writes.filter(x => x.t === 'group_members').flatMap(x => x.a).map(r => r.group_id + ':' + r.user_id).sort().join());
  ok(g2 === 'g1:new003,g2:new004', '이미 있는 계정 new003·new004에 그룹만 추가된다 ("지국행정" → 지국_행정으로 인식): ' + g2);
  ok(await page.evaluate(() => users.find(u => u.id === 'new003').pw === 'pw3' && users.length === 2305), '이미 있는 계정의 이름·비밀번호는 바뀌지 않고 새로 만들어지지도 않는다');

  console.log('[한글 엑셀 CSV(EUC-KR) · 엑셀 파일]');
  // EUC-KR 바이트는 Node 기본에 인코더가 없어 브라우저의 TextEncoder 대신 미리 만든 바이트로 시험: "아이디,이름\nkr001,가나다" (EUC-KR)
  const euc = Buffer.from([0xbe, 0xc6, 0xc0, 0xcc, 0xb5, 0xf0, 0x2c, 0xc0, 0xcc, 0xb8, 0xa7, 0x2c, 0xbc, 0xd2, 0xbc, 0xd3, 0x2c, 0xba, 0xf1, 0xb9, 0xf8, 0x2c, 0xb1, 0xc7, 0xc7, 0xd1, 0x2c, 0xb1, 0xd7, 0xb7, 0xec, 0x0a, 0x6b, 0x72, 0x30, 0x30, 0x31, 0x2c, 0xb0, 0xa1, 0xb3, 0xaa, 0xb4, 0xd9, 0x2c, 0xc1, 0xf6, 0xb1, 0xb9, 0x2c, 0x31, 0x32, 0x2c, 0x75, 0x73, 0x65, 0x72, 0x2c, 0xc1, 0xf6, 0xb1, 0xb9, 0x0a]);
  await up('euckr.csv', euc);
  const pe = await page.textContent('#csv-preview-rows');
  ok(/가나다/.test(pe) && /지국/.test(pe) && !/�/.test(pe), '엑셀 기본 CSV(EUC-KR)도 한글이 깨지지 않고 읽힌다');
  await page.evaluate(() => resetCsv());
  if (!HAVE_XLSX) console.log('  skip 엑셀(.xlsx) 시험 (tests/doc-images/vendor/xlsx.full.min.js 가 없음)');
  else {
    const XLSX = require(XLSX_PATH);
    const ws = XLSX.utils.aoa_to_sheet([['아이디', '이름', '소속', '비밀번호', '권한', '그룹'], ['x001', '엑셀일', '사상지국', 'a1', 'user', '지국_행정'], [2002, '엑셀이', '팔달지국', 1234, 'admin', '지국']]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const xb = Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    await page.setInputFiles('#csv-file-input', { name: 'm.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xb });
    await page.waitForSelector('#csv-preview', { state: 'visible', timeout: 10000 }); await page.waitForTimeout(150);
    ok(/새로 등록 2명/.test(await page.textContent('#csv-preview-rows')), '.xlsx 파일도 읽힌다 (예전에는 "준비 중"이라며 거절)');
    await submit();
    const xw = await page.evaluate(() => window.__writes.filter(x => x.t === 'users').flatMap(x => x.a).map(r => r.id + '/' + r.name + '/' + r.pw + '/' + r.role).join());
    ok(xw === 'x001/엑셀일/a1/user,2002/엑셀이/1234/admin', '엑셀 칸 값(숫자 아이디·비밀번호 포함)이 그대로 저장된다: ' + xw);
  }

  console.log('[저장 일부 실패 시]');
  await page.evaluate(() => { resetCsv(); window.__failTable = 'users'; });
  await up('c.csv', Buffer.from('아이디,이름\nf001,실패일\nf002,실패이', 'utf8'));
  await page.evaluate(() => window.__writes.length = 0); await page.click('#csv-submit-btn'); await page.waitForSelector('#csv-result', { state: 'visible' });
  const fw = await page.evaluate(() => window.__writes.filter(x => x.t === 'users').map(x => Array.isArray(x.a) ? x.a.length : 1).join());
  ok(fw === '2,1,1', '묶음 저장이 실패하면 한 줄씩 다시 시도한다 (묶음 2줄 → 1줄 → 1줄): ' + fw);
  await page.evaluate(() => { window.__failTable = null; });

  console.log('[그룹 화면: 회원이 많을 때]');
  await page.evaluate(() => { switchUtab('group'); });
  await page.waitForTimeout(300);
  const chips = await page.$$eval('#group-list .group-card:nth-child(2) .member-chip', l => l.length);
  const more = await page.$$eval('#group-list .group-card:nth-child(2) .group-members', l => l[0].textContent);
  ok(chips === 60 && /외 \d+명/.test(more), '회원이 많은 그룹은 이름표를 60개까지만 보여 주고 "외 N명"으로 안내한다 (' + chips + '개)');
  ok(/회원 1\d{3}명/.test(await page.textContent('#group-list .group-card:nth-child(2) .group-meta')), '그룹 제목의 회원 수는 전체 인원이다: ' + (await page.textContent('#group-list .group-card:nth-child(2) .group-meta')));
  await page.evaluate(() => openGrpMemberModal('g2')); await page.waitForTimeout(200);
  const rows = await page.$$eval('#grp-member-list > div', l => l.length);
  ok(rows <= 151 && /앞의 150명만 표시/.test(await page.textContent('#grp-member-list')), '회원 추가 창은 150명까지만 그리고 검색을 안내한다 (' + rows + '줄)');
  await page.fill('#grp-member-search', 'new001'); await page.waitForTimeout(150);
  ok(/검색 결과 1명/.test(await page.textContent('#grp-member-list')), '검색하면 해당 회원만 나온다');
  ok(errs.length === 0, '페이지 오류 없음' + (errs.length ? JSON.stringify(errs) : ''));
  await browser.close(); srv.close();
  console.log('\n통과 ' + pass + ' / 실패 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('시험 중단:', e); process.exit(2); });
