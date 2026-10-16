const assert = require('node:assert/strict');
const C = require('./e2e-common');
let pass = 0; const fails = [];
const step = async (name, fn) => { try { await fn(); pass++; console.log('  ok  ' + name); } catch (e) { fails.push(name); console.log('  FAIL ' + name + '\n       ' + String(e.message || e).split('\n').slice(0, 4).join('\n       ')); } };
(async () => {
  await C.start();
  const browser = await C.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  // 시드 데이터: 관리자 API로 분류/자료 생성
  const A = (await C.api('library-login', { id: 'admin', pw: 'adminpw' })).json.token;
  const mk = async (name, parentId, visibility) => (await C.api('library-admin', { action: 'category.create', name, parentId, visibility }, A)).json.category;
  const c1 = await mk('교육과정'), c2 = await mk('신입 입문', c1.id), c3 = await mk('1주차', c2.id), c4 = await mk('제품 자료'), c5 = await mk('특별 과정', null, 'restricted');
  const pdf = C.fs.readFileSync(__dirname + '/sample.pdf'), png = C.fs.readFileSync(__dirname + '/sample.png');
  const dPdf = (await C.uploadFile(A, 'sample.pdf', pdf, { categoryId: c3.id, title: '입문 교재' })).doc;
  const dDirect = (await C.uploadFile(A, 'sample.pdf', pdf, { categoryId: c2.id, title: '입문 과정 안내' })).doc;
  const dImg = (await C.uploadFile(A, 'sample.png', png, { categoryId: c4.id, title: '제품 사진' })).doc;
  const dSec = (await C.uploadFile(A, 'sample.pdf', pdf, { categoryId: c5.id, title: '비공개 교재' })).doc;
  await C.api('library-admin', { action: 'access.set', targetType: 'category', targetId: c5.id, visibility: 'restricted', subjects: [{ type: 'user', id: 'u2' }] }, A);

  console.log('[일반 사용자 u1: 모바일 화면]');
  const { ctx, page, errs } = await C.newPage(browser);
  await step('챗봇 로그인 후 하단 메뉴에 자료실이 있고 5칸이 한 줄에 들어간다', async () => {
    await C.chatLogin(page, 'u1', 'pw1');
    const r = await page.evaluate(() => { const b = [...document.querySelectorAll('#screen-chat .bnav button')]; return { n: b.length, labels: b.map(x => x.textContent.trim()), right: Math.max(...b.map(x => x.getBoundingClientRect().right)), w: innerWidth }; });
    assert.deepEqual(r.labels, ['챗봇', '대화이력', '공지', '자료실', '마이페이지']);
    assert.ok(r.right <= r.w + 1);
  });
  await step('자료실 진입: 로그인 때 받은 토큰으로 대그룹 카드만 보인다(권한 없는 분류 숨김)', async () => {
    await page.click('#screen-chat .bnav button:has-text("자료실")');
    await page.waitForSelector('#lib-body .lib-card');
    const names = await page.$$eval('#lib-body .lib-card .nm', e => e.map(x => x.textContent));
    assert.deepEqual(names, ['교육과정', '제품 자료']);
    await page.screenshot({ path: C.OUT + '/e2e_lib_root.png' });
  });
  await step('중그룹/소그룹 이동, 위치 표시, 각 단계의 자료 함께 표시, 상위로', async () => {
    await page.click('.lib-card:has-text("교육과정")');
    assert.equal(await page.textContent('#lib-crumb'), '자료실›교육과정');
    await page.click('.lib-row:has-text("신입 입문")');
    const secs = await page.$$eval('#lib-body .lib-sec', e => e.map(x => x.textContent));
    assert.deepEqual(secs, ['분류', '자료']);
    assert.ok((await page.textContent('#lib-body')).includes('입문 과정 안내'));
    await page.click('.lib-row:has-text("1주차")');
    assert.equal(await page.textContent('#lib-crumb'), '자료실›교육과정›신입 입문›1주차');
    await page.screenshot({ path: C.OUT + '/e2e_lib_folder.png' });
    await page.click('#lib-crumb button:has-text("신입 입문")');
    assert.equal(await page.textContent('#lib-crumb'), '자료실›교육과정›신입 입문');
    await page.click('.lib-up'); await page.click('.lib-up');
    assert.equal(await page.textContent('#lib-crumb'), '자료실');
  });
  await step('제목 검색: 권한 있는 자료만, 경로 표시', async () => {
    await page.fill('#lib-q', '교재');
    const rows = await page.$$eval('#lib-body .lib-row .tt', e => e.map(x => x.textContent));
    assert.deepEqual(rows, ['입문 교재']);
    assert.ok((await page.textContent('#lib-body')).includes('교육과정 › 신입 입문 › 1주차'));
    await page.fill('#lib-q', '비공개'); assert.ok((await page.textContent('#lib-body')).includes('일치하는 자료가 없습니다'));
    await page.fill('#lib-q', '');
  });
  await step('PDF 열기: 캔버스에 실제 PDF가 그려진다(붉은 제목 픽셀)', async () => {
    await page.fill('#lib-q', '입문 교재'); await page.click('.lib-row:has-text("입문 교재")');
    await page.waitForFunction(() => { const c = document.getElementById('lv-canvas'); return c && c.width > 100 && document.getElementById('lv-msg').style.display === 'none'; }, null, { timeout: 15000 });
    await page.waitForTimeout(800);
    const red = await page.evaluate(() => { const c = document.getElementById('lv-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] < 60 && d[i + 2] < 60) n++; return n; });
    assert.ok(red > 200, '붉은 제목 픽셀 수: ' + red);
    assert.equal(await page.textContent('#lv-pageno'), '1 / 3');
    await page.screenshot({ path: C.OUT + '/e2e_lib_viewer.png' });
  });
  await step('파일 주소가 화면·링크·새 탭 어디에도 노출되지 않는다', async () => {
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    assert.ok(!/X-Amz|54331|r2\.cloudflarestorage|blob:/.test(html));
    assert.equal(await page.evaluate(() => location.href), C.BASE + '/');
    assert.equal(ctx.pages().length, 1);
    assert.equal(await page.$$eval('#lib-viewer a, #lib-viewer img, #lib-viewer iframe, #lib-viewer embed, #lib-viewer object', e => e.length), 0);
  });
  await step('페이지 이동 / 확대·축소', async () => {
    await page.click('#lv-next'); assert.equal(await page.textContent('#lv-pageno'), '2 / 3');
    await page.click('#lv-next'); assert.equal(await page.textContent('#lv-pageno'), '3 / 3');
    assert.equal(await page.$eval('#lv-next', e => e.disabled), true);
    await page.click('#lv-prev'); assert.equal(await page.textContent('#lv-pageno'), '2 / 3');
    const w0 = await page.$eval('#lv-canvas', e => parseInt(e.style.width));
    await page.click('button[aria-label="확대"]'); await page.waitForTimeout(500);
    assert.equal(await page.textContent('#lv-zoom'), '125%');
    const w1 = await page.$eval('#lv-canvas', e => parseInt(e.style.width)); assert.ok(w1 > w0 * 1.2, w0 + ' → ' + w1);
    await page.click('button[aria-label="축소"]'); await page.click('button[aria-label="축소"]'); await page.waitForTimeout(500);
    assert.equal(await page.textContent('#lv-zoom'), '75%');
  });
  await step('두 손가락 핀치로 확대된다', async () => {
    const cdp = await ctx.newCDPSession(page);
    const z0 = await page.evaluate(() => LIBV.zoom);
    const pt = (x, y, id) => ({ x, y, id });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(150, 400, 1), pt(240, 400, 2)] });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(150 - i * 15, 400, 1), pt(240 + i * 15, 400, 2)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(700);
    const z1 = await page.evaluate(() => LIBV.zoom); assert.ok(z1 > z0 * 1.5, z0 + ' → ' + z1);
  });
  await step('우클릭·드래그·선택·복사 차단, Ctrl+S / Ctrl+P 차단', async () => {
    const r = await page.evaluate(() => { const v = document.getElementById('lib-viewer'); return ['contextmenu', 'dragstart', 'selectstart', 'copy'].map(t => { const e = new Event(t, { bubbles: true, cancelable: true }); v.dispatchEvent(e); return e.defaultPrevented; }); });
    assert.deepEqual(r, [true, true, true, true]);
    for (const k of ['Control+s', 'Control+p', 'Meta+s']) {
      await page.keyboard.press(k);
      assert.ok((await page.textContent('#toast')).includes('저장하거나 인쇄할 수 없습니다'), k);
    }
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('lib-viewer')).userSelect), 'none');
  });
  await step('인쇄 화면에서는 내용이 숨겨지고 안내만 나온다', async () => {
    await page.emulateMedia({ media: 'print' });
    const r = await page.evaluate(() => ({ body: [...document.body.children].every(e => getComputedStyle(e).display === 'none' || e.tagName === 'SCRIPT'), after: getComputedStyle(document.body, '::after').content }));
    await page.emulateMedia({ media: 'screen' });
    assert.ok(r.body); assert.ok(r.after.includes('인쇄할 수 없습니다'));
  });
  await step('닫으면 메모리 정리 + 화면 복귀', async () => {
    await page.click('button[aria-label="닫기"]');
    const r = await page.evaluate(() => ({ hidden: document.getElementById('lib-viewer').hidden, pdf: LIBV.pdf, bm: LIBV.bitmap, cls: document.documentElement.classList.contains('lib-open'), ov: document.body.style.overflow }));
    assert.deepEqual(r, { hidden: true, pdf: null, bm: null, cls: false, ov: '' });
  });
  await step('이미지 열기: 캔버스에 그려지고 쪽 이동 버튼은 숨겨진다', async () => {
    await page.fill('#lib-q', '제품 사진'); await page.click('.lib-row:has-text("제품 사진")');
    await page.waitForFunction(() => document.getElementById('lv-msg').style.display === 'none' && document.getElementById('lv-canvas').width > 100, null, { timeout: 10000 });
    const colored = await page.evaluate(() => { const c = document.getElementById('lv-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && (d[i] > 150 || d[i + 2] > 150)) n++; return n; });
    assert.ok(colored > 1000);
    assert.equal(await page.$eval('#lv-pager', e => e.style.display), 'none');
    await page.screenshot({ path: C.OUT + '/e2e_lib_image.png' });
    await page.click('button[aria-label="닫기"]');
  });
  await step('권한 없는 자료의 열람 주소 직접 요청은 서버가 거부', async () => {
    const r = await page.evaluate(async id => { try { await libApi('library-url', { docId: id }); return 'ok'; } catch (e) { return e.status; } }, dSec.id);
    assert.equal(r, 404);
  });
  await step('로그아웃하면 자료실 상태와 토큰이 지워진다', async () => {
    await page.evaluate(() => doLogout());
    const r = await page.evaluate(() => ({ t: libToken, d: libData, p: libPath.length }));
    assert.deepEqual(r, { t: null, d: null, p: 0 });
  });
  await step('콘솔/페이지 오류 없음', async () => assert.deepEqual(errs, []));
  await ctx.close();

  console.log('[일반 사용자 u2: 지정된 사람만 보이는 분류]');
  const u2 = await C.newPage(browser);
  await step('u2는 특별 과정(지정됨)을 보고 열 수 있다', async () => {
    await C.chatLogin(u2.page, 'u2', 'pw2');
    await u2.page.click('#screen-chat .bnav button:has-text("자료실")'); await u2.page.waitForSelector('#lib-body .lib-card');
    const names = await u2.page.$$eval('#lib-body .lib-card .nm', e => e.map(x => x.textContent));
    assert.deepEqual(names, ['교육과정', '제품 자료', '특별 과정']);
    await u2.page.click('.lib-card:has-text("특별 과정")'); await u2.page.click('.lib-row:has-text("비공개 교재")');
    await u2.page.waitForFunction(() => document.getElementById('lv-msg').style.display === 'none' && document.getElementById('lv-canvas').width > 100, null, { timeout: 15000 });
  });
  await step('토큰이 없을 때(서버 미설정 등) 안내와 로그아웃 버튼', async () => {
    await u2.page.click('button[aria-label="닫기"]');
    await u2.page.evaluate(() => { libToken = null; libLoginP = null; libLoginMsg = '자료실 기능이 아직 설정되지 않았습니다.'; });
    await u2.page.evaluate(() => renderLibrary(true));
    assert.ok((await u2.page.textContent('#lib-body')).includes('자료실 기능이 아직 설정되지 않았습니다.'));
  });
  await step('u2 콘솔 오류 없음', async () => assert.deepEqual(u2.errs, []));
  await u2.ctx.close();

  console.log('\n통과 ' + pass + ' / 실패 ' + fails.length);
  if (fails.length) console.log('실패 목록:\n - ' + fails.join('\n - '));
  await browser.close(); await C.stop(); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('테스트 중단:', e); process.exit(2); });
