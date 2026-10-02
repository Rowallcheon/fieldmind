'use strict';
// 원본 자료실 권한 판정 (순수 함수: DB/네트워크 없이 값만 받아 계산)
// 설계서 '권한 규칙' + 아래 해석:
//  - visibility 'inherit'은 가장 가까운 상위 분류의 설정을 따르고, 대그룹이 inherit이면 전체 공개.
//  - 'restricted'인데 허용 대상이 하나도 없으면 아무도 볼 수 없다(관리자 제외).
//  - 상위 분류가 보이지 않으면 그 아래 분류와 자료도 보이지 않는다. (분류 접근이 우선)
//  - 이전 버전(is_latest=false)은 관리자만 볼 수 있다.

/**
 * @param {object} p
 * @param {Array} p.categories   library_categories 행
 * @param {Array} p.docs         library_docs 행
 * @param {Array} p.permissions  library_permissions 행
 * @param {{id:string, role:string}} p.user
 * @param {string[]} p.groupIds     사용자가 속한 기존 그룹(groups) id
 * @param {string[]} p.libGroupIds  사용자가 속한 자료실 그룹(library_groups) id
 */
function createAccess({ categories, docs, permissions, user, groupIds = [], libGroupIds = [] }) {
  const isAdmin = user.role === 'admin';
  const catById = new Map(categories.map(c => [c.id, c]));
  const myGroups = new Set(groupIds), myLibGroups = new Set(libGroupIds);

  const permsByTarget = new Map();
  for (const p of permissions) {
    const key = p.target_type + ':' + (p.target_type === 'category' ? p.category_id : p.doc_id);
    if (!permsByTarget.has(key)) permsByTarget.set(key, []);
    permsByTarget.get(key).push(p);
  }
  function subjectMatches(p) {
    if (p.subject_type === 'group') return myGroups.has(p.group_id);
    if (p.subject_type === 'library_group') return myLibGroups.has(p.library_group_id);
    if (p.subject_type === 'user') return p.user_id === user.id;
    return false;
  }
  function allowedBy(targetType, targetId) {
    return (permsByTarget.get(targetType + ':' + targetId) || []).some(subjectMatches);
  }

  // 분류의 실제 적용 규칙: 가장 가까운 inherit 아닌 설정 (없으면 전체 공개)
  function effectiveCategoryRule(cat) {
    const seen = new Set();
    let c = cat;
    while (c && !seen.has(c.id)) {
      seen.add(c.id);
      if (c.visibility !== 'inherit') return { visibility: c.visibility, ownerId: c.id };
      c = c.parent_id ? catById.get(c.parent_id) : null;
    }
    return { visibility: 'all', ownerId: null };
  }

  const catMemo = new Map();
  function isCategoryVisible(id) {
    if (isAdmin) return catById.has(id);
    if (catMemo.has(id)) return catMemo.get(id);
    catMemo.set(id, false); // 순환 방지(안전)
    const cat = catById.get(id);
    let ok = false;
    if (cat) {
      const parentOk = cat.parent_id ? isCategoryVisible(cat.parent_id) : true;
      if (parentOk) {
        const rule = effectiveCategoryRule(cat);
        ok = rule.visibility === 'all' || (rule.visibility === 'restricted' && allowedBy('category', rule.ownerId));
      }
    }
    catMemo.set(id, ok);
    return ok;
  }

  function isDocVisible(doc) {
    if (!doc) return false;
    if (isAdmin) return catById.has(doc.category_id);
    if (!doc.is_latest) return false;
    if (!isCategoryVisible(doc.category_id)) return false;
    if (doc.visibility === 'all') return true;
    if (doc.visibility === 'restricted') return allowedBy('doc', doc.id);
    const rule = effectiveCategoryRule(catById.get(doc.category_id));
    return rule.visibility === 'all' || (rule.visibility === 'restricted' && allowedBy('category', rule.ownerId));
  }

  return {
    isCategoryVisible,
    isDocVisible,
    visibleCategories: () => categories.filter(c => isCategoryVisible(c.id)),
    visibleDocs: () => docs.filter(isDocVisible),
  };
}

module.exports = { createAccess };
