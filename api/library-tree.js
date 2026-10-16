'use strict';
// POST /api/library-tree  →  { categories, docs, role }
// 로그인한 사용자가 볼 수 있는 분류와 자료(최신본)만 돌려줍니다. 권한 없는 항목은 목록에도 나오지 않습니다.
const { handler } = require('./_lib/http');
const { createAccess } = require('./_lib/access');

async function loadAccess(db, user) {
  const admin = user.role === 'admin';
  const [categories, docs, permissions, gm, lgm] = await Promise.all([
    db.selectAll('library_categories', { select: 'id,name,parent_id,level,sort_order,visibility,description', order: 'id' }),
    db.selectAll('library_docs', { select: 'id,title,category_id,file_type,file_size,version,is_latest,visibility,previous_doc_id,created_at', order: 'id' }),
    admin ? Promise.resolve([]) : db.selectAll('library_permissions', { select: 'id,target_type,category_id,doc_id,subject_type,group_id,library_group_id,user_id', order: 'id' }),
    admin ? Promise.resolve([]) : db.select('group_members', { select: 'group_id', filters: [['user_id', 'eq', user.id]] }),
    admin ? Promise.resolve([]) : db.select('library_group_members', { select: 'group_id', filters: [['user_id', 'eq', user.id]] }),
  ]);
  const access = createAccess({
    categories, docs, permissions, user,
    groupIds: gm.map(r => r.group_id), libGroupIds: lgm.map(r => r.group_id),
  });
  return { access, categories, docs, permissions };
}

async function run({ user, db }) {
  const { access } = await loadAccess(db, user);
  const categories = access.visibleCategories()
    .map(c => ({ id: c.id, name: c.name, parentId: c.parent_id, level: c.level, sortOrder: c.sort_order, description: c.description || '' }));
  const docs = access.visibleDocs().filter(d => d.is_latest)
    .map(d => ({ id: d.id, title: d.title, categoryId: d.category_id, fileType: d.file_type, version: d.version, createdAt: d.created_at }));
  return { categories, docs, role: user.role };
}

module.exports = handler(run, { auth: 'user' });
module.exports.run = run;
module.exports.loadAccess = loadAccess;
