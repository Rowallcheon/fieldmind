require('./env');
const assert = require('node:assert/strict');
const shim = require('./shim-postgrest'), s3 = require('./fake-s3'), srv = require('./api-server').create(54332);
const BASE = 'http://127.0.0.1:54332';
let pass = 0; const fails = [];
const step = async (name, fn) => { try { await fn(); pass++; console.log('  ok  ' + name); } catch (e) { fails.push(name); console.log('  FAIL ' + name + '\n       ' + (e.message || e).toString().split('\n').slice(0, 4).join('\n       ')); } };
async function api(name, body, token) {
  const r = await fetch(BASE + '/api/' + name, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: JSON.stringify(body || {}) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
const login = async (id, pw) => (await api('library-login', { id, pw })).json.token;
const PDF = Buffer.from('%PDF-1.4\n% fake pdf for test\n');
async function upload(token, fileName, bytes, extra) {
  const u = await api('library-upload-url', { fileName, size: bytes.length }, token);
  assert.equal(u.status, 200, JSON.stringify(u.json));
  const put = await fetch(u.json.uploadUrl, { method: 'PUT', body: bytes, headers: { 'Content-Type': u.json.contentType } });
  assert.equal(put.status, 200);
  return api('library-admin', Object.assign({ action: 'doc.register', r2Key: u.json.r2Key, title: fileName }, extra), token);
}

(async () => {
  await Promise.all([shim.listen(54330), s3.listen(54331), srv.listen()]);
  let A, M, U1, U2;

  console.log('[로그인/토큰]');
  await step('잘못된 비밀번호 → 401, 없는 아이디도 같은 메시지', async () => {
    const a = await api('library-login', { id: 'u1', pw: 'nope' }), b = await api('library-login', { id: 'ghost', pw: 'x' });
    assert.equal(a.status, 401); assert.equal(b.status, 401); assert.equal(a.json.error, b.json.error);
  });
  await step('비활성 계정 → 403', async () => assert.equal((await api('library-login', { id: 'off', pw: 'pwoff' })).status, 403));
  await step('정상 로그인 4종', async () => { A = await login('admin', 'adminpw'); M = await login('mgr', 'mgrpw'); U1 = await login('u1', 'pw1'); U2 = await login('u2', 'pw2'); assert.ok(A && M && U1 && U2); });
  await step('토큰 없음/변조/만료 → 401', async () => {
    assert.equal((await api('library-tree', {})).status, 401);
    assert.equal((await api('library-tree', {}, U1.slice(0, -3) + 'abc')).status, 401);
    const { signToken } = require('../../api/_lib/http');
    assert.equal((await api('library-tree', {}, signToken({ uid: 'u1' }, -10))).status, 401);
  });
  await step('GET 요청은 405', async () => assert.equal((await fetch(BASE + '/api/library-tree')).status, 405));
  await step('일반 사용자는 관리 함수 호출 불가(403), 관리자는 가능', async () => {
    assert.equal((await api('library-admin', { action: 'overview' }, U1)).status, 403);
    assert.equal((await api('library-upload-url', { fileName: 'a.pdf', size: 5 }, U1)).status, 403);
    assert.equal((await api('library-admin', { action: 'overview' }, A)).status, 200);
    assert.equal((await api('library-admin', { action: 'overview' }, M)).status, 200);
  });
  await step('토큰 발급 후 계정이 비활성화되면 즉시 거부', async () => {
    const t = await login('u2', 'pw2');
    await shim.pool.query("update users set status='inactive' where id='u2'");
    assert.equal((await api('library-tree', {}, t)).status, 401);
    await shim.pool.query("update users set status='active' where id='u2'");
  });
  await step('관리자 권한이 회수되면 이전 토큰으로 관리 불가', async () => {
    const t = await login('mgr', 'mgrpw');
    await shim.pool.query("update users set role='user' where id='mgr'");
    assert.equal((await api('library-admin', { action: 'overview' }, t)).status, 403);
    await shim.pool.query("update users set role='admin' where id='mgr'");
  });

  console.log('[분류 관리]');
  let c1, c2, c3, c1b;
  await step('대/중/소그룹 생성, 4단계는 거부', async () => {
    c1 = (await api('library-admin', { action: 'category.create', name: '교육과정' }, A)).json.category;
    c2 = (await api('library-admin', { action: 'category.create', name: '신입 입문', parentId: c1.id }, A)).json.category;
    c3 = (await api('library-admin', { action: 'category.create', name: '1주차', parentId: c2.id }, A)).json.category;
    assert.deepEqual([c1.level, c2.level, c3.level], [1, 2, 3]);
    const r = await api('library-admin', { action: 'category.create', name: '4단계', parentId: c3.id }, A);
    assert.equal(r.status, 400);
    c1b = (await api('library-admin', { action: 'category.create', name: '제품 자료' }, A)).json.category;
    assert.equal(c1b.sort_order, 1);
  });
  await step('같은 이름 중복은 409, 빈 이름은 400', async () => {
    assert.equal((await api('library-admin', { action: 'category.create', name: '교육과정' }, A)).status, 409);
    assert.equal((await api('library-admin', { action: 'category.create', name: '   ' }, A)).status, 400);
  });
  await step('이름 수정 / 순서 변경', async () => {
    assert.equal((await api('library-admin', { action: 'category.update', id: c1b.id, name: '제품 자료실' }, A)).status, 200);
    assert.equal((await api('library-admin', { action: 'category.reorder', parentId: null, ids: [c1b.id, c1.id] }, A)).status, 200);
    const o = (await api('library-admin', { action: 'overview' }, A)).json;
    const top = o.categories.filter(c => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order).map(c => c.name);
    assert.deepEqual(top, ['제품 자료실', '교육과정']);
    assert.equal((await api('library-admin', { action: 'category.reorder', parentId: null, ids: [c1b.id] }, A)).status, 400);
  });

  console.log('[업로드/등록]');
  let d1;
  await step('허용되지 않는 확장자/큰 파일 거부', async () => {
    assert.equal((await api('library-upload-url', { fileName: 'virus.exe', size: 10 }, A)).status, 400);
    assert.equal((await api('library-upload-url', { fileName: 'big.pdf', size: 101 * 1024 * 1024 }, A)).status, 413);
    assert.equal((await api('library-upload-url', { fileName: 'a.pdf', size: 0 }, A)).status, 400);
  });
  await step('업로드 → 등록, 파일 크기가 실제 R2 값으로 기록됨', async () => {
    const r = await upload(A, '입문 교재.pdf', PDF, { categoryId: c3.id });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    d1 = r.json.doc; assert.equal(Number(d1.file_size), PDF.length); assert.equal(d1.file_type, 'pdf'); assert.equal(d1.uploader, 'admin');
  });
  await step('업로드하지 않은 키/형식이 다른 키/남의 키는 등록 거부', async () => {
    const u = await api('library-upload-url', { fileName: 'x.pdf', size: 5 }, A);
    const noUp = await api('library-admin', { action: 'doc.register', r2Key: u.json.r2Key, title: 'x', categoryId: c3.id }, A);
    assert.equal(noUp.status, 400);
    const bad = await api('library-admin', { action: 'doc.register', r2Key: '../etc/passwd', title: 'x', categoryId: c3.id }, A);
    assert.equal(bad.status, 400);
    const other = await api('library-admin', { action: 'doc.register', r2Key: 'other/secret.pdf', title: 'x', categoryId: c3.id }, A);
    assert.equal(other.status, 400);
  });
  await step('같은 파일을 두 번 등록할 수 없다', async () => {
    const r = await api('library-admin', { action: 'doc.register', r2Key: d1.r2_key, title: 'dup', categoryId: c3.id }, A);
    assert.equal(r.status, 409);
  });
  await step('만료된 업로드 주소는 R2가 거부(PUT 403)', async () => {
    const u = await api('library-upload-url', { fileName: 'old.pdf', size: 5 }, A);
    s3.setClock(() => new Date(Date.now() + 11 * 60 * 1000));
    const put = await fetch(u.json.uploadUrl, { method: 'PUT', body: 'abcde' });
    s3.setClock(() => new Date());
    assert.equal(put.status, 403);
  });

  console.log('[열람 권한/주소 발급]');
  await step('전체 공개 상태에서는 일반 사용자도 목록·주소를 받는다', async () => {
    const t = (await api('library-tree', {}, U1)).json;
    assert.equal(t.categories.length, 4); assert.equal(t.docs.length, 1);
    const r = await api('library-url', { docId: d1.id }, U1);
    assert.equal(r.status, 200); assert.equal(r.json.expiresIn, 60);
    assert.ok(!r.json.url.includes('TESTSECRET'));
    const f = await fetch(r.json.url); assert.equal(f.status, 200); assert.deepEqual(Buffer.from(await f.arrayBuffer()), PDF);
  });
  await step('열람 기록이 남는다', async () => {
    const l = (await api('library-admin', { action: 'logs', docId: d1.id }, A)).json;
    assert.equal(l.total, 1); assert.equal(l.logs[0].user_id, 'u1'); assert.equal(l.logs[0].doc_title, '입문 교재.pdf');
  });
  await step('주소는 60초 뒤 만료된다', async () => {
    const r = await api('library-url', { docId: d1.id }, U1);
    s3.setClock(() => new Date(Date.now() + 61 * 1000));
    const f = await fetch(r.json.url); s3.setClock(() => new Date());
    assert.equal(f.status, 403);
  });
  await step('주소의 키를 바꾸면 서명 불일치로 거부', async () => {
    const r = await api('library-url', { docId: d1.id }, U1);
    const tampered = r.json.url.replace(/library\/\d{4}\//, 'library/2099/');
    assert.equal((await fetch(tampered)).status, 403);
    assert.equal((await fetch(r.json.url, { method: 'DELETE' })).status, 403);
  });
  await step('분류를 restricted로 두고 개인(u1)만 허용 → u1만 보임', async () => {
    const r = await api('library-admin', { action: 'access.set', targetType: 'category', targetId: c1.id, visibility: 'restricted', subjects: [{ type: 'user', id: 'u1' }] }, A);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal((await api('library-tree', {}, U1)).json.docs.length, 1);
    const t2 = (await api('library-tree', {}, U2)).json;
    assert.equal(t2.docs.length, 0); assert.deepEqual(t2.categories.map(c => c.name), ['제품 자료실']);
  });
  await step('권한 없는 사용자가 자료 ID로 직접 요청해도 404 (존재 여부도 숨김)', async () => {
    const r = await api('library-url', { docId: d1.id }, U2);
    assert.equal(r.status, 404);
    const ghost = await api('library-url', { docId: '00000000-0000-0000-0000-000000000000' }, U2);
    assert.equal(ghost.status, 404); assert.equal(r.json.error, ghost.json.error);
    assert.equal((await api('library-url', { docId: 'not-a-uuid' }, U2)).status, 404);
  });
  await step('관리자는 제한된 자료도 열람', async () => assert.equal((await api('library-url', { docId: d1.id }, M)).status, 200));
  await step('기존 그룹(g2 스토어)을 허용하면 u2도 보임', async () => {
    await api('library-admin', { action: 'access.set', targetType: 'category', targetId: c1.id, visibility: 'restricted', subjects: [{ type: 'user', id: 'u1' }, { type: 'group', id: 'g2' }] }, A);
    assert.equal((await api('library-tree', {}, U2)).json.docs.length, 1);
    assert.equal((await api('library-url', { docId: d1.id }, U2)).status, 200);
  });
  let lg;
  await step('자료실 전용 그룹: 만들고 구성원 지정 → 허용 대상으로 사용', async () => {
    lg = (await api('library-admin', { action: 'group.create', name: '신입 1기' }, A)).json.group;
    assert.equal((await api('library-admin', { action: 'group.create', name: '신입 1기' }, A)).status, 409);
    const sm = await api('library-admin', { action: 'group.setMembers', groupId: lg.id, userIds: ['u2'] }, A);
    assert.deepEqual([sm.json.added, sm.json.removed], [1, 0]);
    await api('library-admin', { action: 'access.set', targetType: 'category', targetId: c1.id, visibility: 'restricted', subjects: [{ type: 'library_group', id: lg.id }] }, A);
    assert.equal((await api('library-tree', {}, U2)).json.docs.length, 1);
    assert.equal((await api('library-tree', {}, U1)).json.docs.length, 0);
    const sm2 = await api('library-admin', { action: 'group.setMembers', groupId: lg.id, userIds: ['u1'] }, A);
    assert.deepEqual([sm2.json.added, sm2.json.removed], [1, 1]);
    assert.equal((await api('library-tree', {}, U2)).json.docs.length, 0);
    assert.equal((await api('library-tree', {}, U1)).json.docs.length, 1);
  });
  await step('존재하지 않는 사용자/그룹을 허용 대상으로 지정하면 거부', async () => {
    assert.equal((await api('library-admin', { action: 'access.set', targetType: 'category', targetId: c1.id, visibility: 'restricted', subjects: [{ type: 'user', id: 'ghost' }] }, A)).status, 409);
    assert.equal((await api('library-admin', { action: 'group.setMembers', groupId: lg.id, userIds: ['ghost'] }, A)).status, 409);
  });
  await step('자료 단위 restricted: 분류가 전체 공개여도 자료는 지정된 사람만', async () => {
    await api('library-admin', { action: 'access.set', targetType: 'category', targetId: c1.id, visibility: 'all', subjects: [] }, A);
    await api('library-admin', { action: 'access.set', targetType: 'doc', targetId: d1.id, visibility: 'restricted', subjects: [{ type: 'user', id: 'u2' }] }, A);
    assert.equal((await api('library-tree', {}, U2)).json.docs.length, 1);
    assert.equal((await api('library-tree', {}, U1)).json.docs.length, 0);
    await api('library-admin', { action: 'access.set', targetType: 'doc', targetId: d1.id, visibility: 'inherit', subjects: [] }, A);
    assert.equal((await api('library-tree', {}, U1)).json.docs.length, 1);
  });
  await step('restricted인데 허용 대상이 없으면 아무도(관리자 제외) 못 본다', async () => {
    await api('library-admin', { action: 'access.set', targetType: 'category', targetId: c1.id, visibility: 'restricted', subjects: [] }, A);
    assert.equal((await api('library-tree', {}, U1)).json.docs.length, 0);
    assert.equal((await api('library-tree', {}, A)).json.docs.length, 1);
    await api('library-admin', { action: 'access.set', targetType: 'category', targetId: c1.id, visibility: 'inherit', subjects: [] }, A);
  });

  console.log('[버전 교체/이동/삭제]');
  let d2;
  await step('새 버전으로 교체: 기존본 숨김, 새 버전 공개, 권한 복사', async () => {
    await api('library-admin', { action: 'access.set', targetType: 'doc', targetId: d1.id, visibility: 'restricted', subjects: [{ type: 'user', id: 'u1' }] }, A);
    const r = await upload(A, '입문 교재 v2.pdf', Buffer.from('%PDF-1.4\nversion two'), { replaceDocId: d1.id, title: '입문 교재' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    d2 = r.json.doc; assert.equal(d2.version, 2); assert.equal(d2.previous_doc_id, d1.id); assert.equal(d2.visibility, 'restricted');
    const t = (await api('library-tree', {}, U1)).json;
    assert.deepEqual(t.docs.map(d => d.id), [d2.id]);
    assert.equal((await api('library-url', { docId: d1.id }, U1)).status, 404, '일반 사용자는 이전 버전 열람 불가');
    assert.equal((await api('library-url', { docId: d1.id }, A)).status, 200, '관리자는 이전 버전 열람 가능');
    assert.equal((await api('library-tree', {}, U2)).json.docs.length, 0, '복사된 권한: u2는 못 봄');
    const again = await api('library-admin', { action: 'doc.register', r2Key: 'library/2026/00000000-0000-0000-0000-000000000000.pdf', replaceDocId: d1.id, title: 'x' }, A);
    assert.equal(again.status, 400);
  });
  await step('이전 버전은 다시 교체할 수 없다(최신만)', async () => {
    const r = await upload(A, 'again.pdf', PDF, { replaceDocId: d1.id });
    assert.equal(r.status, 400);
  });
  await step('자료 이동/제목 수정은 이전 버전까지 함께', async () => {
    const r = await api('library-admin', { action: 'doc.update', id: d2.id, title: '입문 교재(개정)', categoryId: c1b.id }, A);
    assert.equal(r.status, 200);
    const o = (await api('library-admin', { action: 'overview' }, A)).json;
    const rows = o.docs.filter(d => [d1.id, d2.id].includes(d.id));
    assert.ok(rows.every(d => d.category_id === c1b.id && d.title === '입문 교재(개정)'));
  });
  await step('분류 삭제: 자료/하위가 있으면 개수와 함께 거부, 비면 삭제', async () => {
    const r = await api('library-admin', { action: 'category.delete', id: c1b.id }, A);
    assert.equal(r.status, 409); assert.equal(r.json.docs, 2); assert.match(r.json.error, /자료 2건/);
    const r2 = await api('library-admin', { action: 'category.delete', id: c1.id }, A);
    assert.equal(r2.status, 409); assert.equal(r2.json.children, 1);
    assert.equal((await api('library-admin', { action: 'category.delete', id: c3.id }, A)).status, 200);
    assert.equal((await api('library-admin', { action: 'category.delete', id: c2.id }, A)).status, 200);
    assert.equal((await api('library-admin', { action: 'category.delete', id: c1.id }, A)).status, 200);
  });
  await step('최신 버전만 삭제하면 이전 버전이 최신으로 복원되고 R2 파일도 삭제', async () => {
    await api('library-url', { docId: d2.id }, A); // 삭제 전에 열람 기록을 하나 남겨 둠
    const before = s3.store.size;
    const r = await api('library-admin', { action: 'doc.delete', id: d2.id }, A);
    assert.equal(r.status, 200); assert.equal(r.json.deleted, 1); assert.deepEqual(r.json.orphanedKeys, []);
    assert.equal(s3.store.size, before - 1);
    const o = (await api('library-admin', { action: 'overview' }, A)).json;
    const old = o.docs.find(d => d.id === d1.id); assert.equal(old.is_latest, true);
    assert.equal((await api('library-tree', {}, U1)).json.docs.length, 1);
  });
  await step('열람 기록은 자료가 삭제돼도 남는다', async () => {
    const l = (await api('library-admin', { action: 'logs', limit: 100 }, A)).json;
    assert.ok(l.total >= 3); assert.ok(l.logs.some(x => x.doc_id === null && x.doc_title));
  });
  await step('전체 버전 삭제 + R2 파일 모두 삭제, 사용량 0', async () => {
    const r2 = await upload(A, 'v2.pdf', PDF, { replaceDocId: d1.id });
    const before = s3.store.size;
    const r = await api('library-admin', { action: 'doc.delete', id: r2.json.doc.id, allVersions: true }, A);
    assert.equal(r.json.deleted, 2); assert.equal(s3.store.size, before - 2);
    const o = (await api('library-admin', { action: 'overview' }, A)).json;
    assert.equal(o.docs.length, 0); assert.equal(o.usage.usedBytes, 0);
  });
  await step('R2 삭제가 실패해도 DB는 정리되고 남은 키를 알려준다', async () => {
    const r = await upload(A, 'keep.pdf', PDF, { categoryId: c1b.id });
    const real = s3.store.get; // R2가 DELETE에 500을 돌려주도록 시계를 쓰지 않고 키만 바꿔서 흉내
    const key = r.json.doc.r2_key;
    const { makeR2 } = require('../../api/_lib/r2');
    const broken = makeR2(process.env, async () => ({ status: 500, ok: false, headers: { get: () => null } }));
    const admin = require('../../api/library-admin');
    const out = await admin.run({ body: { action: 'doc.delete', id: r.json.doc.id }, db: require('../../api/_lib/db').makeDb(), r2: broken });
    assert.deepEqual(out.orphanedKeys, [key]);
  });

  console.log('[사용량]');
  await step('overview 사용량 합계가 파일 크기와 일치', async () => {
    await upload(A, 'a.pdf', Buffer.alloc(1000, 1), { categoryId: c1b.id });
    await upload(A, 'b.png', Buffer.alloc(2500, 2), { categoryId: c1b.id });
    const o = (await api('library-admin', { action: 'overview' }, A)).json;
    assert.equal(o.usage.usedBytes, 3500); assert.equal(o.usage.limitBytes, 10 * 1024 ** 3);
    assert.deepEqual(o.docs.map(d => d.file_type).sort(), ['image', 'pdf']);
    assert.ok(!JSON.stringify(o.users).includes('pw'), '회원 비밀번호가 응답에 없어야 함');
  });
  await step('1000건 넘는 자료도 전부 불러온다(페이지 이동)', async () => {
    await shim.pool.query("insert into library_docs(title,category_id,r2_key,file_type,file_size) select 'bulk '||g,'" + c1b.id + "','library/2026/bulk-'||g||'.pdf','pdf',1 from generate_series(1,1100) g");
    const o = (await api('library-admin', { action: 'overview' }, A)).json;
    assert.equal(o.docs.length, 1102);
    assert.equal((await api('library-tree', {}, U1)).json.docs.length, 1102);
  });
  await step('아이디 변경 시 자료실 기록이 따라온다(연쇄 갱신)', async () => {
    await api('library-admin', { action: 'group.setMembers', groupId: lg.id, userIds: ['u1'] }, A);
    await shim.pool.query("update users set id='u1_new' where id='u1'");
    const g = await shim.pool.query("select user_id from library_group_members where group_id=$1", [lg.id]);
    assert.equal(g.rows[0].user_id, 'u1_new');
    const lg2 = await shim.pool.query("select count(*)::int n from library_view_logs where user_id='u1_new'");
    assert.ok(lg2.rows[0].n >= 1);
    await shim.pool.query("update users set id='u1' where id='u1_new'");
  });

  console.log('\n통과 ' + pass + ' / 실패 ' + fails.length);
  if (fails.length) console.log('실패 목록:\n - ' + fails.join('\n - '));
  await Promise.all([shim.close(), s3.close(), srv.close()]); await shim.pool.end();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('테스트 중단:', e); process.exit(2); });
