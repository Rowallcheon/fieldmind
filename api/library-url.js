'use strict';
// POST /api/library-url  { docId }  →  { url, fileType, title, expiresIn }
// 로그인·권한을 서버에서 다시 확인하고, R2 임시 열람 주소(60초)를 발급하며 열람 기록을 남깁니다.
// 자료 ID를 알아내 직접 요청해도 권한이 없으면 '찾을 수 없음'으로 응답합니다.
const { handler, HttpError } = require('./_lib/http');
const { loadAccess } = require('./library-tree');

const URL_TTL_SEC = 60;

async function run({ body, user, db, r2 }) {
  const docId = typeof body.docId === 'string' ? body.docId : '';
  if (!/^[0-9a-f-]{36}$/i.test(docId)) throw new HttpError(404, '자료를 찾을 수 없습니다.');

  const { access, docs } = await loadAccess(db, user);
  const doc = docs.find(d => d.id === docId);
  if (!doc || !access.isDocVisible(doc)) throw new HttpError(404, '자료를 찾을 수 없습니다.');

  const full = (await db.select('library_docs', { select: 'id,title,r2_key,file_type', filters: [['id', 'eq', docId]], limit: 1 }))[0];
  if (!full) throw new HttpError(404, '자료를 찾을 수 없습니다.');

  const url = r2.presign('GET', full.r2_key, URL_TTL_SEC);
  try {
    await db.insert('library_view_logs', [{ user_id: user.id, user_name: user.name, doc_id: full.id, doc_title: full.title }]);
  } catch (e) {
    console.error('[library] 열람 기록 저장 실패', e && e.message); // 열람 자체는 막지 않음
  }
  return { url, fileType: full.file_type, title: full.title, expiresIn: URL_TTL_SEC };
}

module.exports = handler(run, { auth: 'user', needsR2: true });
module.exports.run = run;
