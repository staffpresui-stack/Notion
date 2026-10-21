// GAS・外部APIに依存しない照合と仕分けです。実際の移動・投稿は行いません。
var MeetingRules_ = (function () {
  var domains = ['セールス・マーケ', 'EC', '生産管理', '経理・バックオフィス', 'Salesforce・AI', '経営'];
  function email(value) { return String(value || '').trim().toLowerCase(); }
  function emailDomain(value) {
    var e = email(value);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e.split('@')[1] : null;
  }
  function title(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu, ''); }
  function sameMeeting(a, b, windowMinutes) {
    var window = windowMinutes === undefined ? 15 : Number(windowMinutes);
    var aTime = Date.parse(a.start), bTime = Date.parse(b.start);
    if (!Number.isFinite(aTime) || !Number.isFinite(bTime) || !Number.isFinite(window) || window < 0 || Math.abs(aTime - bTime) > window * 60000) return false;
    var at = title(a.title), bt = title(b.title);
    if (at && bt) return at === bt;
    var aEmails = new Set((a.attendees || []).map(function (p) { return email(p.email); }).filter(emailDomain));
    var shared = new Set((b.attendees || []).map(function (p) { return email(p.email); }).filter(function (e) { return emailDomain(e) && aEmails.has(e); }));
    return shared.size >= 2;
  }
  function classify(attendees, masters, freeMailDomains) {
    var internal = new Set((masters.internal || []).map(email));
    var free = new Set((freeMailDomains || ['gmail.com', 'yahoo.co.jp', 'outlook.jp', 'outlook.com', 'icloud.com', 'hotmail.com']).map(email));
    var external = [], incomplete = !(attendees || []).length;
    (attendees || []).forEach(function (p) {
      var e = email(p.email), d = emailDomain(e);
      if (!d) { incomplete = true; return; }
      if (!internal.has(e) && !internal.has(d)) external.push(d);
    });
    var clients = (masters.clients || []).filter(function (c) {
      var accepted = (c.domains || []).map(email);
      return external.some(function (d) { return !free.has(d) && accepted.includes(d); });
    }).map(function (c) { return c.client_name; });
    clients = Array.from(new Set(clients));
    return { scope: external.length ? '社外' : incomplete ? null : '社内', incomplete: incomplete,
      client: clients.length === 1 ? clients[0] : null, ambiguous_client: clients.length > 1 };
  }
  function placementPlan(judgement, manifest, masters, projects) {
    if (judgement.meeting_key !== manifest.meeting_key || judgement.source !== manifest.source) throw new Error('会議キーまたは記録元が一致しません。');
    var rule = classify(manifest.attendees, masters), conflicts = [];
    if (rule.incomplete) conflicts.push('参加者のメール情報が不足しています。');
    if (rule.scope && rule.scope !== judgement.scope) conflicts.push('社内・社外の判定が一致しません。');
    if (!judgement.placement.startsWith(judgement.scope + '/')) conflicts.push('格納先と社内・社外の区分が一致しません。');
    var placements = (masters.folders || []).map(function (f) { return f.placement; }).concat((masters.clients || []).map(function (c) { return '社外/' + c.client_name; }));
    if (!placements.includes(judgement.placement)) conflicts.push('格納先がマスタに登録されていません。');
    if (rule.client && judgement.placement !== '社外/' + rule.client) conflicts.push('顧客ドメインと格納先が一致しません。');
    if (rule.ambiguous_client) conflicts.push('複数の顧客候補があります。');
    var rejectedDomains = judgement.domains.filter(function (d) { return !domains.includes(d); });
    var projectIds = new Set((projects || []).map(function (p) { return p.id; }));
    var rejectedProjects = judgement.related_project_ids.filter(function (id) { return !projectIds.has(id); });
    // 未登録PJは除外して記録します。SPEC 8章の格納先の食い違いとは区別します。
    var automatic = judgement.confidence === '高' && judgement.sensitive === false && conflicts.length === 0;
    return { meeting_key: manifest.meeting_key, status: automatic ? '確認待ち' : '仕分け待ち',
      placement: automatic ? judgement.placement : '00_仕分け待ち', rule: rule, conflicts: conflicts,
      domains: judgement.domains.filter(function (d) { return domains.includes(d); }), rejected_domains: rejectedDomains,
      related_project_ids: judgement.related_project_ids.filter(function (id) { return projectIds.has(id); }), rejected_project_ids: rejectedProjects };
  }
  function tldvPlan(page, meetManifests, now, settings) {
    settings = settings || {};
    if (page['取り込み状態'] && page['取り込み状態'] !== '未処理') return { action: '処理済み' };
    var duration = /^(\d+(?:\.\d+)?)分$/.exec(String(page['長さ'] || '').trim());
    var start = Date.parse(page['日付']), clock = Date.parse(now);
    var wait = settings.waitMinutes === undefined ? 60 : Number(settings.waitMinutes);
    if (!duration || !Number.isFinite(start) || !Number.isFinite(clock) || !Number.isFinite(wait) || wait < 0) return { action: '要確認', reason: '日時または会議の長さを確認してください。' };
    if (clock < start + (Number(duration[1]) + wait) * 60000) return { action: '待機' };
    var candidate = { title: page['名前'], start: page['日付'], attendees: page.attendees || [] };
    var duplicate = (meetManifests || []).find(function (m) { return m.source === 'meet' && sameMeeting(candidate, m, settings.matchWindowMinutes); });
    if (duplicate) return { action: '対象外（Meet優先）', matched_meeting_key: duplicate.meeting_key };
    var match = /^https:\/\/(?:www\.)?tldv\.io\/app\/meetings\/([A-Za-z0-9_-]+)(?:[/?#]|$)/.exec(String(page['会議URL'] || ''));
    var key = match ? 'tldv:' + match[1] : page.id ? 'tldv:notion-' + page.id : null;
    if (!key) return { action: '要確認', reason: '会議URLまたは受信ページIDを確認してください。' };
    if (!String(page['トランスクリプト'] || '').trim()) return { action: '要確認', reason: '文字起こしがありません。' };
    return { action: '文字起こしの取り込み予定', meeting_key: key, folder_key: key.replace(/:/g, '_'),
      // tl;dv無料プランの経路では録画のダウンロード・保存を計画しません。
      file_kinds: ['tldv_transcript'] };
  }
  return { normalizeTitle: title, sameMeeting: sameMeeting, classify: classify, placementPlan: placementPlan, tldvPlan: tldvPlan };
})();
