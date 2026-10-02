'use strict';
// 실행: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccess } = require('../api/_lib/access');
const { presignUrl } = require('../api/_lib/r2');

// ── SigV4: AWS 공식 문서의 쿼리 서명 예제와 같은 값이 나와야 한다 ──
test('SigV4 임시 주소 서명이 AWS 문서 예제와 일치한다', () => {
  const url = presignUrl({
    method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1', expires: 86400, now: new Date('2013-05-24T00:00:00Z'),
  });
  assert.match(url, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
  assert.ok(url.startsWith('https://examplebucket.s3.amazonaws.com/test.txt?'));
  assert.ok(url.includes('X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request'));
});

test('SigV4: 한글/특수문자 키도 한 번만 인코딩된다', () => {
  const a = presignUrl({ method: 'GET', url: 'https://x.r2.cloudflarestorage.com/b/library/한글 파일(1).pdf', accessKeyId: 'a', secretAccessKey: 'b', now: new Date('2026-01-01T00:00:00Z') });
  assert.ok(a.includes('/b/library/%ED%95%9C%EA%B8%80%20%ED%8C%8C%EC%9D%BC%281%29.pdf?'));
});

// ── 권한 판정 ──
const user = { id: 'u1', role: 'user' };
const admin = { id: 'adm', role: 'admin' };
const cat = (id, parent, level, visibility = 'inherit') => ({ id, name: id, parent_id: parent, level, visibility });
const doc = (id, category_id, visibility = 'inherit', is_latest = true) => ({ id, category_id, visibility, is_latest, title: id });
const perm = (target_type, targetId, subject_type, subjectId) => ({
  target_type, category_id: target_type === 'category' ? targetId : null, doc_id: target_type === 'doc' ? targetId : null,
  subject_type, group_id: subject_type === 'group' ? subjectId : null,
  library_group_id: subject_type === 'library_group' ? subjectId : null, user_id: subject_type === 'user' ? subjectId : null,
});
const ids = a => a.map(x => x.id).sort();

test('대그룹이 inherit이면 전체 공개', () => {
  const A = createAccess({ categories: [cat('c1', null, 1), cat('c2', 'c1', 2)], docs: [doc('d1', 'c2')], permissions: [], user });
  assert.deepEqual(ids(A.visibleCategories()), ['c1', 'c2']);
  assert.deepEqual(ids(A.visibleDocs()), ['d1']);
});

test('restricted 분류는 허용된 기존 그룹/자료실 그룹/개인만', () => {
  const cats = [cat('c1', null, 1, 'restricted')];
  const docs = [doc('d1', 'c1')];
  const none = createAccess({ categories: cats, docs, permissions: [perm('category', 'c1', 'group', 'g1')], user });
  assert.deepEqual(none.visibleCategories(), []);
  const byGroup = createAccess({ categories: cats, docs, permissions: [perm('category', 'c1', 'group', 'g1')], user, groupIds: ['g1'] });
  assert.deepEqual(ids(byGroup.visibleCategories()), ['c1']);
  const byLib = createAccess({ categories: cats, docs, permissions: [perm('category', 'c1', 'library_group', 'L1')], user, libGroupIds: ['L1'] });
  assert.deepEqual(ids(byLib.visibleDocs()), ['d1']);
  const byUser = createAccess({ categories: cats, docs, permissions: [perm('category', 'c1', 'user', 'u1')], user });
  assert.deepEqual(ids(byUser.visibleDocs()), ['d1']);
  const otherUser = createAccess({ categories: cats, docs, permissions: [perm('category', 'c1', 'user', 'zzz')], user });
  assert.deepEqual(otherUser.visibleDocs(), []);
});

test('허용 대상이 하나도 없는 restricted는 사용자에게 보이지 않고 관리자는 본다', () => {
  const cats = [cat('c1', null, 1, 'restricted')], docs = [doc('d1', 'c1')];
  assert.deepEqual(createAccess({ categories: cats, docs, permissions: [], user }).visibleCategories(), []);
  assert.deepEqual(ids(createAccess({ categories: cats, docs, permissions: [], user: admin }).visibleDocs()), ['d1']);
});

test('하위 분류는 가장 가까운 상위 설정을 따른다', () => {
  const cats = [cat('c1', null, 1, 'restricted'), cat('c2', 'c1', 2), cat('c3', 'c2', 3)];
  const docs = [doc('d3', 'c3')];
  const p = [perm('category', 'c1', 'group', 'g1')]; // 상위(c1)의 허용 목록이 하위에도 적용
  assert.deepEqual(createAccess({ categories: cats, docs, permissions: p, user }).visibleDocs(), []);
  assert.deepEqual(ids(createAccess({ categories: cats, docs, permissions: p, user, groupIds: ['g1'] }).visibleCategories()), ['c1', 'c2', 'c3']);
  assert.deepEqual(ids(createAccess({ categories: cats, docs, permissions: p, user, groupIds: ['g1'] }).visibleDocs()), ['d3']);
});

test('중간 분류가 자기 설정(all)을 가져도 상위가 막혀 있으면 보이지 않는다', () => {
  const cats = [cat('c1', null, 1, 'restricted'), cat('c2', 'c1', 2, 'all')];
  const A = createAccess({ categories: cats, docs: [doc('d2', 'c2')], permissions: [], user });
  assert.deepEqual(A.visibleCategories(), []);
  assert.deepEqual(A.visibleDocs(), []);
});

test('하위 분류에서 restricted로 좁히면 그 분류의 허용 목록만 적용', () => {
  const cats = [cat('c1', null, 1), cat('c2', 'c1', 2, 'restricted')];
  const docs = [doc('d1', 'c1'), doc('d2', 'c2')];
  const p = [perm('category', 'c2', 'user', 'u1')];
  assert.deepEqual(ids(createAccess({ categories: cats, docs, permissions: p, user }).visibleDocs()), ['d1', 'd2']);
  assert.deepEqual(ids(createAccess({ categories: cats, docs, permissions: p, user: { id: 'u9', role: 'user' } }).visibleDocs()), ['d1']);
});

test('자료 자체의 restricted는 자료의 허용 목록만 본다 (분류가 전체 공개여도)', () => {
  const cats = [cat('c1', null, 1, 'all')];
  const docs = [doc('d1', 'c1', 'restricted'), doc('d2', 'c1')];
  const p = [perm('doc', 'd1', 'user', 'u1'), perm('category', 'c1', 'user', 'u1')];
  assert.deepEqual(ids(createAccess({ categories: cats, docs, permissions: p, user }).visibleDocs()), ['d1', 'd2']);
  assert.deepEqual(ids(createAccess({ categories: cats, docs, permissions: [perm('category', 'c1', 'user', 'u1')], user }).visibleDocs()), ['d2']);
});

test('자료가 all이어도 분류가 막혀 있으면 보이지 않는다', () => {
  const cats = [cat('c1', null, 1, 'restricted')];
  const A = createAccess({ categories: cats, docs: [doc('d1', 'c1', 'all')], permissions: [], user });
  assert.deepEqual(A.visibleDocs(), []);
});

test('자료의 inherit은 소속 분류의 실제 규칙을 따른다 (상위에서 물려받은 것 포함)', () => {
  const cats = [cat('c1', null, 1, 'restricted'), cat('c2', 'c1', 2)];
  const p = [perm('category', 'c1', 'group', 'g1')];
  assert.deepEqual(ids(createAccess({ categories: cats, docs: [doc('d', 'c2')], permissions: p, user, groupIds: ['g1'] }).visibleDocs()), ['d']);
  assert.deepEqual(createAccess({ categories: cats, docs: [doc('d', 'c2')], permissions: p, user }).visibleDocs(), []);
});

test('이전 버전은 관리자만 볼 수 있다', () => {
  const cats = [cat('c1', null, 1)];
  const docs = [doc('old', 'c1', 'inherit', false), doc('new', 'c1')];
  assert.deepEqual(ids(createAccess({ categories: cats, docs, permissions: [], user }).visibleDocs()), ['new']);
  assert.deepEqual(ids(createAccess({ categories: cats, docs, permissions: [], user: admin }).visibleDocs()), ['new', 'old']);
});

test('상위가 없는(고아) 분류와 순환 구조는 안전하게 숨긴다', () => {
  const orphan = createAccess({ categories: [cat('c2', 'nope', 2)], docs: [doc('d', 'c2')], permissions: [], user });
  assert.deepEqual(orphan.visibleCategories(), []);
  assert.deepEqual(orphan.visibleDocs(), []);
  const loop = createAccess({ categories: [cat('a', 'b', 2), cat('b', 'a', 2)], docs: [], permissions: [], user });
  assert.deepEqual(loop.visibleCategories(), []);
});

test('다른 사람/다른 그룹의 허용은 적용되지 않는다', () => {
  const cats = [cat('c1', null, 1, 'restricted')];
  const p = [perm('category', 'c1', 'group', 'g2'), perm('category', 'c1', 'library_group', 'L2')];
  assert.deepEqual(createAccess({ categories: cats, docs: [], permissions: p, user, groupIds: ['g1'], libGroupIds: ['L1'] }).visibleCategories(), []);
});
