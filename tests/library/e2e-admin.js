const assert = require('node:assert/strict');
const C = require('./e2e-common');
let pass = 0; const fails = [];
const step = async (name, fn) => { try { await fn(); pass++; console.log('  ok  ' + name); } catch (e) { fails.push(name); console.log('  FAIL ' + name + '\n       ' + String(e.message || e).split('\n').slice(0, 5).join('\n       ')); } };
(async () => {
  await C.start();
  const browser = await C.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const { ctx, page, errs } = await C.newPage(browser, { viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false });
  page.on('dialog', d => d.accept());
  const overview = async () => (await C.api('library-admin', { action: 'overview' }, await tok())).json;
  let _t = null; const tok = async () => _t || (_t = (await C.api('library-login', { id: 'admin', pw: 'adminpw' })).json.token);
  const modalText = async v => { await page.waitForSelector('#modal-la-text.open'); await page.fill('#lat-input', v); await page.click('#modal-la-text .btn-primary'); };
  const toast = async () => (await page.textContent('#toast')).trim();
  const waitText = async t => page.waitForFunction(x => document.getElementById('la-body').textContent.includes(x), t, { timeout: 8000 });

  console.log('[admin 계정: 분류 관리]');
  await step('로그인 → 사이드바에 원본 자료실, 열면 용량 에너지바(admin 전용)가 보인다', async () => {
    await C.chatLogin(page, 'admin', 'adminpw');
    await page.click('#sb-library'); await waitText('아직 분류가 없습니다');
    assert.ok(await page.isVisible('#la-usage'));
    const t = await page.textContent('#la-usage'); assert.ok(t.includes('남음 100%') && t.includes('0KB 사용 / 10.00GB'), t);
  });
  await step('대그룹/중그룹/소그룹 추가, 소그룹에는 하위 추가 버튼이 없다', async () => {
    await page.click('button:has-text("＋ 대그룹 추가")'); await modalText('교육과정'); await waitText('교육과정');
    await page.click('.la-head:has-text("교육과정") button:has-text("＋ 하위")'); await modalText('신입 입문'); await waitText('신입 입문');
    await page.click('.la-head:has-text("신입 입문") button:has-text("＋ 하위")'); await modalText('1주차'); await waitText('1주차');
    assert.equal(await page.locator('.la-head:has-text("1주차") button:has-text("＋ 하위")').count(), 0);
    const lv = await page.$$eval('.la-head .lv', e => e.map(x => x.textContent)); assert.deepEqual(lv, ['대그룹', '중그룹', '소그룹']);
    await page.click('button:has-text("＋ 대그룹 추가")'); await modalText('제품 자료'); await waitText('제품 자료');
  });
  await step('같은 이름은 오류 안내, 이름 수정', async () => {
    await page.click('button:has-text("＋ 대그룹 추가")'); await modalText('교육과정');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('이미 같은 항목'), null, { timeout: 5000 });
    await page.click('.la-head:has-text("제품 자료") button:has-text("이름")'); await modalText('제품 자료실'); await waitText('제품 자료실');
  });
  await step('순서 변경(▼): 서버에 저장되어 새로고침해도 유지', async () => {
    await page.click('.la-head:has-text("교육과정") button[aria-label="아래로"]');
    await page.waitForFunction(() => { const n = [...document.querySelectorAll('#la-body > .la-cat > .la-head .nm')].map(x => x.textContent.trim()); return n[0].includes('제품 자료실'); });
    await page.click('#la-body button:has-text("새로고침")');
    await page.waitForSelector('#la-body > .la-cat > .la-head .nm');
    await page.waitForFunction(() => [...document.querySelectorAll('#la-body > .la-cat > .la-head .nm')][0].textContent.includes('제품 자료실'));
    const o = await overview(); const tops = o.categories.filter(c => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order).map(c => c.name);
    assert.deepEqual(tops, ['제품 자료실', '교육과정']);
  });

  console.log('[admin 계정: 자료 업로드]');
  await step('PDF 업로드(브라우저 → R2 직접): 제목 자동 입력, 진행 후 v1로 표시, 크기 기록', async () => {
    await page.click('.la-head:has-text("1주차") button:has-text("⬆ 자료")');
    await page.setInputFiles('#lau-file', __dirname + '/sample.pdf');
    assert.equal(await page.inputValue('#lau-name'), 'sample');
    await page.fill('#lau-name', '입문 교재');
    assert.equal(await page.$eval('#lau-cat', e => e.selectedOptions[0].textContent), '교육과정 › 신입 입문 › 1주차');
    await page.click('#lau-ok'); await page.waitForSelector('#modal-la-upload:not(.open)', { state: 'attached', timeout: 15000 });
    await waitText('입문 교재');
    const row = await page.textContent('.la-doc'); assert.ok(row.includes('v1') && row.includes('PDF'), row);
    const o = await overview(); assert.equal(o.docs.length, 1); assert.ok(o.docs[0].file_size > 5000); assert.equal(o.usage.usedBytes, Number(o.docs[0].file_size));
    assert.equal(o.docs[0].uploader, 'admin');
  });
  await step('이미지 업로드 + 공개범위 "지정한 사람만" 선택 시 업로드 직후 대상 선택창이 열린다', async () => {
    await page.click('button:has-text("⬆ 자료 올리기")');
    await page.setInputFiles('#lau-file', __dirname + '/sample.png');
    await page.selectOption('#lau-cat', { label: '제품 자료실' });
    await page.check('input[name="lau-vis"][value="restricted"]');
    await page.click('#lau-ok'); await page.waitForSelector('#modal-la-access.open', { timeout: 15000 });
    assert.ok((await page.textContent('#laa-sub')).includes('sample'));
    await page.fill('#laa-q', 'u2');
    assert.equal(await page.locator('#laa-users label:visible').count(), 1);
    await page.check('#laa-users label:visible input'); await page.click('#modal-la-access .btn-primary');
    await page.waitForSelector('#modal-la-access:not(.open)', { state: 'attached' });
    await waitText('지정한 사람만 (1)');
  });
  await step('허용 대상이 없는 채로 저장하면 경고 확인을 거친다', async () => {
    let asked = null; page.removeAllListeners('dialog'); page.on('dialog', d => { asked = d.message(); d.accept(); });
    await page.click('.la-head:has-text("교육과정") button:has-text("🔒 공개범위")');
    await page.check('#laa-vis input[value="restricted"]');
    await page.click('#modal-la-access .btn-primary'); await waitText('지정한 사람만 (0)');
    assert.ok(asked && asked.includes('아무도 볼 수 없습니다'), asked);
    page.removeAllListeners('dialog'); page.on('dialog', d => d.accept());
    await page.click('.la-head:has-text("교육과정") button:has-text("🔒 공개범위")');
    await page.check('#laa-vis input[value="inherit"]'); await page.click('#modal-la-access .btn-primary'); await waitText('전체 공개(기본)');
  });
  await step('기존 그룹(설치법인)과 자료실 그룹을 허용 대상으로 고를 수 있다', async () => {
    await page.click('.la-head:has-text("교육과정") button:has-text("🔒 공개범위")');
    await page.check('#laa-vis input[value="restricted"]');
    assert.deepEqual(await page.$$eval('#laa-base label', e => e.map(x => x.textContent.trim())), ['설치법인', '스토어']);
    await page.check('#laa-base label:has-text("설치법인") input'); await page.click('#modal-la-access .btn-primary');
    await page.waitForFunction(() => { const h = [...document.querySelectorAll('.la-head')].find(x => x.querySelector('.nm').textContent.includes('교육과정')); return h && h.textContent.includes('지정한 사람만 (1)'); }, null, { timeout: 8000 });
    const o = await overview(); assert.ok(o.permissions.some(p => p.subject_type === 'group' && p.group_id === 'g1'));
  });
  await step('새 버전으로 교체: v2, 기존본은 "이전 버전"으로 접혀 있다가 펼치면 보인다', async () => {
    await page.click('.la-doc:has-text("입문 교재") button:has-text("새 버전")');
    assert.ok((await page.textContent('#lau-note')).includes('v2'));
    assert.equal(await page.isVisible('#lau-cat-wrap'), false);
    await page.setInputFiles('#lau-file', __dirname + '/sample.pdf'); await page.click('#lau-ok');
    await page.waitForSelector('#modal-la-upload:not(.open)', { state: 'attached', timeout: 15000 });
    await page.waitForFunction(() => document.getElementById('la-body').textContent.includes('이전 버전 1개'), null, { timeout: 8000 });
    assert.ok((await page.textContent('.la-doc:has-text("입문 교재")')).includes('v2'));
    await page.click('button:has-text("이전 버전 1개")'); await waitText('이전 버전');
    assert.equal(await page.locator('.la-doc.old').count(), 1);
    assert.equal((await overview()).usage.docCount, 3);
  });
  await step('자료 제목 수정 / 이동', async () => {
    await page.click('.la-doc:not(.old):has-text("입문 교재") button:has-text("제목")'); await modalText('입문 교재(개정)'); await waitText('입문 교재(개정)');
    await page.click('.la-doc:not(.old):has-text("입문 교재(개정)") button:has-text("이동")');
    await page.selectOption('#las-select', { label: '교육과정 › 신입 입문' }); await page.click('#modal-la-select .btn-primary');
    await page.waitForFunction(() => { const c = [...document.querySelectorAll('.la-cat')].find(x => x.querySelector('.la-head .nm').textContent.includes('1주차')); return c && !c.textContent.includes('입문 교재'); });
    const o = await overview(); assert.ok(o.docs.filter(d => d.title === '입문 교재(개정)').every(d => laCatName(o, d.category_id) === '신입 입문'));
    function laCatName(o, id) { return o.categories.find(c => c.id === id).name; }
  });
  await step('비어 있지 않은 분류 삭제는 개수와 함께 경고(서버 호출 없이)', async () => {
    await page.click('.la-head:has-text("제품 자료실") button:has-text("삭제")');
    assert.ok((await toast()).includes('자료 1건이 있어 삭제할 수 없습니다'));
    assert.equal((await overview()).categories.length, 4);
  });
  await step('열기: 관리자는 이전 버전도 볼 수 있고 열람 기록에 남는다', async () => {
    await page.click('.la-doc.old button:has-text("열기")');
    await page.waitForFunction(() => { const c = document.getElementById('lv-canvas'); return c && c.width > 100 && document.getElementById('lv-msg').style.display === 'none'; }, null, { timeout: 15000 });
    assert.ok((await page.textContent('#lv-title')).includes('이전 버전 v1'));
    await page.click('button[aria-label="닫기"]');
    await page.click('#la-tabs button[data-t="logs"]'); await page.waitForSelector('.la-table');
    const t = await page.textContent('.la-table'); assert.ok(t.includes('최고관리자') && t.includes('입문 교재'), t);
  });
  await step('자료 삭제: 이전 버전도 함께(확인=예) → R2 파일까지 삭제', async () => {
    await page.click('#la-tabs button[data-t="tree"]'); await waitText('입문 교재(개정)');
    const before = C.s3.store.size;
    await page.click('.la-doc:not(.old):has-text("입문 교재(개정)") button:has-text("삭제")');
    await page.waitForFunction(() => !document.getElementById('la-body').textContent.includes('입문 교재(개정)'), null, { timeout: 8000 });
    assert.equal(C.s3.store.size, before - 2);
    assert.equal((await overview()).usage.docCount, 1);
  });
  await step('분류 삭제: 비워진 소그룹/중그룹/대그룹 순서로 삭제 가능', async () => {
    for (const n of ['1주차', '신입 입문', '교육과정']) {
      await page.click('.la-head:has-text("' + n + '") button:has-text("삭제")');
      await page.waitForFunction(x => ![...document.querySelectorAll('.la-head .nm')].some(e => e.textContent.trim().replace(/^[▾▸]\s*/, '') === x), n, { timeout: 8000 });
    }
    assert.equal((await overview()).categories.length, 1);
  });

  console.log('[admin 계정: 자료실 그룹/에너지바]');
  await step('자료실 그룹 만들기 → 구성원 검색/선택/저장 → 구성원 수 표시', async () => {
    await page.click('#la-tabs button[data-t="groups"]'); await waitText('아직 자료실 전용 그룹이 없습니다');
    await page.click('button:has-text("＋ 그룹 만들기")'); await modalText('신입 1기'); await waitText('신입 1기');
    await page.click('.la-doc:has-text("신입 1기") button:has-text("구성원")');
    await page.fill('#lam-q', '현장'); const shown = await page.locator('#lam-list label:visible').count(); assert.equal(shown, 2);
    await page.click('button:has-text("보이는 항목 모두 선택")'); assert.equal(await page.textContent('#lam-count'), '선택 2명');
    await page.click('#modal-la-members .btn-primary'); await waitText('구성원 2명');
    assert.equal((await overview()).members.length, 2);
  });
  await step('그룹 삭제', async () => {
    await page.click('.la-doc:has-text("신입 1기") button:has-text("삭제")'); await waitText('아직 자료실 전용 그룹이 없습니다');
  });
  await step('대시보드 무료 사용량에 자료실 파일 저장공간이 표시된다', async () => {
    await page.click('#sb-dashboard'); await page.waitForFunction(() => document.getElementById('usage-bars').textContent.includes('자료실 파일 저장공간'), null, { timeout: 8000 });
    const t = await page.textContent('#usage-bars'); assert.ok(/자료 1건, 이전 버전 포함/.test(t) && /남음 100%/.test(t), t);
    await page.screenshot({ path: C.OUT + '/e2e_adm_dash.png' });
  });
  await step('콘솔/페이지 오류 없음', async () => assert.deepEqual(errs, []));
  await ctx.close();

  console.log('[다른 관리자(mgr) / 일반 사용자]');
  const m = await C.newPage(browser, { viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false });
  await step('mgr: 자료실 관리는 가능, 용량 에너지바는 보이지 않는다', async () => {
    await C.chatLogin(m.page, 'mgr', 'mgrpw');
    await m.page.click('#sb-library'); await m.page.waitForSelector('#la-body .la-bar');
    assert.equal(await m.page.isVisible('#la-usage'), false);
    assert.equal(await m.page.isVisible('#usage-card'), false);
  });
  await step('mgr 콘솔 오류 없음', async () => assert.deepEqual(m.errs, []));
  await m.ctx.close();
  const o = await C.api('library-login', { id: 'u1', pw: 'pw1' });
  await step('일반 사용자 토큰으로는 관리 기능 호출 불가(서버 403)', async () => assert.equal((await C.api('library-admin', { action: 'overview' }, o.json.token)).status, 403));

  console.log('\n통과 ' + pass + ' / 실패 ' + fails.length);
  if (fails.length) console.log('실패 목록:\n - ' + fails.join('\n - '));
  await browser.close(); await C.stop(); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('테스트 중단:', e); process.exit(2); });
