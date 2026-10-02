'use strict';
// POST /api/library-admin  { action, ... }  — 관리자 전용 자료실 관리
// 분류/자료/그룹/권한/열람 기록. 자료실 테이블은 브라우저에서 직접 접근할 수 없어 모든 관리가 이 함수를 거칩니다.
const { handler, HttpError } = require('./_lib/http');
const { MAX_BYTES } = require('./library-upload-url');

const VIS = ['inherit', 'all', 'restricted'];
const R2_FREE_BYTES = 10 * 1024 * 1024 * 1024; // R2 무료 저장공간 10GB
const KEY_RE = /^library\/\d{4}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpe?g|webp|gif)$/i;
const isUuid = s => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

function str(v, max, label, optional) {
  if (v === undefined || v === null || v === '') { if (optional) return null; throw new HttpError(400, (label || '값') + '을(를) 입력해 주세요.'); }
  if (typeof v !== 'string') throw new HttpError(400, (label || '값') + '이(가) 올바르지 않습니다.');
  const t = v.trim();
  if (!t) { if (optional) return null; throw new HttpError(400, (label || '값') + '을(를) 입력해 주세요.'); }
  if (t.length > max) throw new HttpError(400, (label || '값') + '이(가) 너무 깁니다. (' + max + '자 이하)');
  return t;
}
function vis(v) {
  if (!VIS.includes(v)) throw new HttpError(400, '공개 범위가 올바르지 않습니다.');
  return v;
}
function needUuid(v, label) {
  if (!isUuid(v)) throw new HttpError(400, (label || '대상') + '이(가) 올바르지 않습니다.');
  return v;
}
const one = async (db, table, id, select) => (await db.select(table, { select: select || '*', filters: [['id', 'eq', id]], limit: 1 }))[0];

/** 같은 이전 버전 묶음(연결된 모든 버전)의 자료 id */
async function chainIds(db, docId) {
  const all = await db.selectAll('library_docs', { select: 'id,previous_doc_id', order: 'id' });
  const adj = new Map();
  for (const d of all) {
    if (!adj.has(d.id)) adj.set(d.id, new Set());
    if (d.previous_doc_id) {
      if (!adj.has(d.previous_doc_id)) adj.set(d.previous_doc_id, new Set());
      adj.get(d.id).add(d.previous_doc_id); adj.get(d.previous_doc_id).add(d.id);
    }
  }
  const seen = new Set([docId]), q = [docId];
  while (q.length) for (const n of adj.get(q.pop()) || []) if (!seen.has(n)) { seen.add(n); q.push(n); }
  return [...seen];
}

const actions = {
  /* ── 전체 현황 ── */
  async overview({ db }) {
    const [categories, docs, groups, members, permissions, users, baseGroups] = await Promise.all([
      db.selectAll('library_categories', { select: '*', order: 'id' }),
      db.selectAll('library_docs', { select: 'id,title,category_id,file_type,file_size,version,is_latest,previous_doc_id,visibility,uploader,created_at', order: 'id' }),
      db.selectAll('library_groups', { select: '*', order: 'id' }),
      db.selectAll('library_group_members', { select: 'group_id,user_id', order: 'group_id' }),
      db.selectAll('library_permissions', { select: '*', order: 'id' }),
      db.selectAll('users', { select: 'id,name,dept,role,status', order: 'id' }),
      db.selectAll('groups', { select: 'id,name', order: 'id' }),
    ]);
    const usedBytes = docs.reduce((a, d) => a + Number(d.file_size || 0), 0);
    return { categories, docs, groups, members, permissions, users, baseGroups, usage: { usedBytes, limitBytes: R2_FREE_BYTES, docCount: docs.length } };
  },

  /* ── 분류 ── */
  async 'category.create'({ db, body }) {
    const name = str(body.name, 100, '분류 이름');
    const description = str(body.description, 500, '설명', true);
    const visibility = body.visibility === undefined ? 'inherit' : vis(body.visibility);
    let level = 1, parentId = null;
    if (body.parentId) {
      parentId = needUuid(body.parentId, '상위 분류');
      const parent = await one(db, 'library_categories', parentId, 'id,level');
      if (!parent) throw new HttpError(404, '상위 분류를 찾을 수 없습니다.');
      if (parent.level >= 3) throw new HttpError(400, '소그룹 아래에는 분류를 만들 수 없습니다. (최대 3단계)');
      level = parent.level + 1;
    }
    const last = await db.select('library_categories', {
      select: 'sort_order', filters: [['parent_id', parentId ? 'eq' : 'is', parentId || 'null']], order: 'sort_order.desc', limit: 1,
    });
    const row = (await db.insert('library_categories', [{ name, parent_id: parentId, level, visibility, description, sort_order: last.length ? last[0].sort_order + 1 : 0 }]))[0];
    return { ok: true, category: row };
  },
  async 'category.update'({ db, body }) {
    const id = needUuid(body.id, '분류');
    const patch = {};
    if (body.name !== undefined) patch.name = str(body.name, 100, '분류 이름');
    if (body.description !== undefined) patch.description = str(body.description, 500, '설명', true);
    if (body.visibility !== undefined) patch.visibility = vis(body.visibility);
    if (!Object.keys(patch).length) throw new HttpError(400, '바꿀 내용이 없습니다.');
    const rows = await db.update('library_categories', [['id', 'eq', id]], patch);
    if (!rows.length) throw new HttpError(404, '분류를 찾을 수 없습니다.');
    return { ok: true, category: rows[0] };
  },
  async 'category.reorder'({ db, body }) {
    const parentId = body.parentId ? needUuid(body.parentId, '상위 분류') : null;
    const ids = Array.isArray(body.ids) ? body.ids : [];
    ids.forEach(i => needUuid(i, '분류'));
    const sibs = await db.select('library_categories', { select: 'id', filters: [['parent_id', parentId ? 'eq' : 'is', parentId || 'null']] });
    const a = sibs.map(s => s.id).sort().join(','), b = [...ids].sort().join(',');
    if (!ids.length || a !== b) throw new HttpError(400, '같은 단계의 분류 전체를 순서대로 보내야 합니다.');
    await Promise.all(ids.map((id, i) => db.update('library_categories', [['id', 'eq', id]], { sort_order: i })));
    return { ok: true };
  },
  async 'category.delete'({ db, body }) {
    const id = needUuid(body.id, '분류');
    const cat = await one(db, 'library_categories', id, 'id,name');
    if (!cat) throw new HttpError(404, '분류를 찾을 수 없습니다.');
    const children = await db.selectCount('library_categories', { filters: [['parent_id', 'eq', id]] });
    const docs = await db.selectCount('library_docs', { filters: [['category_id', 'eq', id]] });
    if (children || docs) {
      throw new HttpError(409, '"' + cat.name + '"에는 하위 분류 ' + children + '개, 자료 ' + docs + '건이 있어 삭제할 수 없습니다. 먼저 비우거나 다른 곳으로 옮겨 주세요.', null, { children, docs });
    }
    await db.remove('library_categories', [['id', 'eq', id]]);
    return { ok: true };
  },

  /* ── 자료 ── */
  /** 업로드가 끝난 파일을 자료로 등록(새 자료 또는 기존 자료의 새 버전) */
  async 'doc.register'({ db, r2, body, user }) {
    const r2Key = typeof body.r2Key === 'string' ? body.r2Key : '';
    if (!KEY_RE.test(r2Key)) throw new HttpError(400, '업로드된 파일 정보가 올바르지 않습니다.');
    const fileType = /\.pdf$/i.test(r2Key) ? 'pdf' : 'image';

    const head = await r2.head(r2Key);
    if (!head.exists) throw new HttpError(400, '파일이 아직 업로드되지 않았거나 만료되었습니다. 다시 올려 주세요.');
    if (head.size > MAX_BYTES) { await r2.remove(r2Key); throw new HttpError(413, '파일이 너무 큽니다.'); }

    let old = null;
    if (body.replaceDocId) {
      old = await one(db, 'library_docs', needUuid(body.replaceDocId, '교체할 자료'));
      if (!old) throw new HttpError(404, '교체할 자료를 찾을 수 없습니다.');
      if (!old.is_latest) throw new HttpError(400, '최신 버전만 새 버전으로 교체할 수 있습니다.');
    }
    const title = str(body.title !== undefined ? body.title : (old && old.title), 200, '자료 제목');
    const categoryId = old ? old.category_id : needUuid(body.categoryId, '분류 위치');
    if (!old && !(await one(db, 'library_categories', categoryId, 'id'))) throw new HttpError(404, '분류를 찾을 수 없습니다.');
    const visibility = body.visibility === undefined ? (old ? old.visibility : 'inherit') : vis(body.visibility);

    const created = (await db.insert('library_docs', [{
      title, category_id: categoryId, r2_key: r2Key, file_type: fileType, file_size: head.size,
      version: old ? old.version + 1 : 1, is_latest: true, previous_doc_id: old ? old.id : null,
      visibility, uploader: user.id,
    }]))[0];

    if (old) {
      try {
        await db.update('library_docs', [['id', 'eq', old.id]], { is_latest: false });
        const perms = await db.select('library_permissions', { select: 'subject_type,group_id,library_group_id,user_id', filters: [['target_type', 'eq', 'doc'], ['doc_id', 'eq', old.id]] });
        if (perms.length) await db.insert('library_permissions', perms.map(p => Object.assign({ target_type: 'doc', doc_id: created.id }, p)));
      } catch (e) {
        await db.remove('library_docs', [['id', 'eq', created.id]]).catch(() => {});
        await db.update('library_docs', [['id', 'eq', old.id]], { is_latest: true }).catch(() => {});
        throw e;
      }
    }
    return { ok: true, doc: created };
  },
  async 'doc.update'({ db, body }) {
    const id = needUuid(body.id, '자료');
    const doc = await one(db, 'library_docs', id, 'id');
    if (!doc) throw new HttpError(404, '자료를 찾을 수 없습니다.');
    const chainPatch = {};
    if (body.title !== undefined) chainPatch.title = str(body.title, 200, '자료 제목');
    if (body.categoryId !== undefined) {
      chainPatch.category_id = needUuid(body.categoryId, '분류 위치');
      if (!(await one(db, 'library_categories', chainPatch.category_id, 'id'))) throw new HttpError(404, '분류를 찾을 수 없습니다.');
    }
    if (!Object.keys(chainPatch).length) throw new HttpError(400, '바꿀 내용이 없습니다.');
    // 제목·위치는 이전 버전까지 함께 바꿔 한 묶음으로 유지
    const ids = await chainIds(db, id);
    await db.update('library_docs', [['id', 'in', ids]], chainPatch);
    return { ok: true };
  },
  async 'doc.delete'({ db, r2, body }) {
    const id = needUuid(body.id, '자료');
    const target = await one(db, 'library_docs', id, 'id,r2_key,previous_doc_id,is_latest');
    if (!target) throw new HttpError(404, '자료를 찾을 수 없습니다.');
    const ids = body.allVersions ? await chainIds(db, id) : [id];
    const rows = await db.select('library_docs', { select: 'id,r2_key', filters: [['id', 'in', ids]] });
    // 최신 버전만 지우면 바로 이전 버전이 다시 최신이 된다
    if (!body.allVersions && target.is_latest && target.previous_doc_id) {
      await db.update('library_docs', [['id', 'eq', target.previous_doc_id]], { is_latest: true });
    }
    await db.remove('library_docs', [['id', 'in', ids]]);
    const orphaned = [];
    for (const r of rows) {
      try { await r2.remove(r.r2_key); } catch (e) { orphaned.push(r.r2_key); console.error('[library] R2 삭제 실패', r.r2_key, e && e.message); }
    }
    return { ok: true, deleted: rows.length, orphanedKeys: orphaned };
  },

  /* ── 자료실 전용 그룹 ── */
  async 'group.create'({ db, body }) {
    const g = await db.insert('library_groups', [{ name: str(body.name, 100, '그룹 이름'), description: str(body.description, 500, '설명', true) }]);
    return { ok: true, group: g[0] };
  },
  async 'group.update'({ db, body }) {
    const id = needUuid(body.id, '그룹');
    const patch = {};
    if (body.name !== undefined) patch.name = str(body.name, 100, '그룹 이름');
    if (body.description !== undefined) patch.description = str(body.description, 500, '설명', true);
    if (!Object.keys(patch).length) throw new HttpError(400, '바꿀 내용이 없습니다.');
    const rows = await db.update('library_groups', [['id', 'eq', id]], patch);
    if (!rows.length) throw new HttpError(404, '그룹을 찾을 수 없습니다.');
    return { ok: true };
  },
  async 'group.delete'({ db, body }) {
    const id = needUuid(body.id, '그룹');
    const rows = await db.remove('library_groups', [['id', 'eq', id]]);
    if (!rows.length) throw new HttpError(404, '그룹을 찾을 수 없습니다.');
    return { ok: true };
  },
  async 'group.setMembers'({ db, body }) {
    const id = needUuid(body.groupId, '그룹');
    if (!(await one(db, 'library_groups', id, 'id'))) throw new HttpError(404, '그룹을 찾을 수 없습니다.');
    const want = new Set((Array.isArray(body.userIds) ? body.userIds : []).filter(u => typeof u === 'string' && u && u.length <= 100));
    const have = new Set((await db.select('library_group_members', { select: 'user_id', filters: [['group_id', 'eq', id]] })).map(r => r.user_id));
    const add = [...want].filter(u => !have.has(u)), del = [...have].filter(u => !want.has(u));
    if (add.length) await db.insert('library_group_members', add.map(u => ({ group_id: id, user_id: u })));
    if (del.length) await db.remove('library_group_members', [['group_id', 'eq', id], ['user_id', 'in', del]]);
    return { ok: true, added: add.length, removed: del.length };
  },

  /* ── 공개 범위 + 허용 대상 ── */
  async 'access.set'({ db, body }) {
    const targetType = body.targetType;
    if (targetType !== 'category' && targetType !== 'doc') throw new HttpError(400, '대상 종류가 올바르지 않습니다.');
    const targetId = needUuid(body.targetId);
    const visibility = vis(body.visibility);
    const table = targetType === 'category' ? 'library_categories' : 'library_docs';
    const col = targetType === 'category' ? 'category_id' : 'doc_id';
    const upd = await db.update(table, [['id', 'eq', targetId]], { visibility });
    if (!upd.length) throw new HttpError(404, '대상을 찾을 수 없습니다.');

    if (visibility === 'restricted' || Array.isArray(body.subjects)) {
      const subs = (Array.isArray(body.subjects) ? body.subjects : []).map(s => {
        if (!s || !['group', 'library_group', 'user'].includes(s.type) || typeof s.id !== 'string' || !s.id || s.id.length > 100) throw new HttpError(400, '허용 대상이 올바르지 않습니다.');
        if (s.type === 'library_group') needUuid(s.id, '자료실 그룹');
        return s;
      });
      const key = s => s.type + ':' + s.id;
      const have = await db.select('library_permissions', { select: 'id,subject_type,group_id,library_group_id,user_id', filters: [['target_type', 'eq', targetType], [col, 'eq', targetId]] });
      const haveKey = r => r.subject_type + ':' + (r.subject_type === 'group' ? r.group_id : r.subject_type === 'library_group' ? r.library_group_id : r.user_id);
      const wantSet = new Set(subs.map(key)), haveSet = new Set(have.map(haveKey));
      const delIds = have.filter(r => !wantSet.has(haveKey(r))).map(r => r.id);
      const addRows = [...new Map(subs.filter(s => !haveSet.has(key(s))).map(s => [key(s), s])).values()].map(s => ({
        target_type: targetType, [col]: targetId, subject_type: s.type,
        group_id: s.type === 'group' ? s.id : null, library_group_id: s.type === 'library_group' ? s.id : null, user_id: s.type === 'user' ? s.id : null,
      }));
      if (addRows.length) await db.insert('library_permissions', addRows);
      if (delIds.length) await db.remove('library_permissions', [['id', 'in', delIds]]);
    }
    return { ok: true };
  },

  /* ── 열람 기록 ── */
  async logs({ db, body }) {
    const limit = Math.min(Math.max(parseInt(body.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(body.offset, 10) || 0, 0);
    const filters = [];
    if (body.docId) filters.push(['doc_id', 'eq', needUuid(body.docId, '자료')]);
    if (body.userId) filters.push(['user_id', 'eq', String(body.userId).slice(0, 100)]);
    const [rows, total] = await Promise.all([
      db.select('library_view_logs', { select: 'id,user_id,user_name,doc_id,doc_title,viewed_at', filters, order: 'viewed_at.desc,id.desc', limit, offset }),
      db.selectCount('library_view_logs', { filters }),
    ]);
    return { logs: rows, total };
  },
};

async function run(ctx) {
  const fn = actions[ctx.body && ctx.body.action];
  if (!fn) throw new HttpError(400, '알 수 없는 요청입니다.');
  return fn(ctx);
}

module.exports = handler(run, { auth: 'admin', needsR2: true });
module.exports.run = run;
module.exports.actions = actions;
