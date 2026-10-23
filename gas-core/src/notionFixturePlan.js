var NotionFixturePlan_ = (function () {
  function normalize(value) { return String(value || '').replace(/-/g, '').toLowerCase(); }
  var domains = ['セールス・マーケ', 'EC', '生産管理', '経理・バックオフィス', 'Salesforce・AI', '経営'];
  var expected = {
    minutes: { '議事録名': ['title'], '日付': ['date'], '参加者': ['people'], 'MTG URL': ['url'], '事業部領域': ['multi_select'], '関連するプロジェクト': ['relation'] },
    tasks: { 'プロジェクト/タスク名': ['title'], 'ステータス': ['status', 'select'], '期日': ['date'], '担当者': ['people'], '備考': ['rich_text'], '完了条件': ['rich_text'], '事業部領域': ['multi_select'], '関連するMTG': ['relation'], '親アイテム': ['relation'] },
    // タイトル名や参加者形式は実機確認対象です。本文の文字起こしも許容します。
    inbox: { '取り込み状態': ['select'], 'meeting_key': ['rich_text'], '日付': ['date'], '会議URL': ['url'], '長さ': ['number', 'rich_text'], '参加者': ['rich_text', 'people', 'multi_select'], 'AIメモ': ['rich_text'], 'トランスクリプト': ['rich_text'] }
  };
  function compareSchema(key, properties, requesterType) {
    requesterType = requesterType || 'people';
    if (!['people', 'rich_text', 'email'].includes(requesterType)) throw new Error('NOTION_REQUESTER_TYPE が不正です。');
    var differences = [], knownAdditions = [], wanted = Object.assign({}, expected[key]);
    if (key === 'tasks') wanted['依頼者'] = [requesterType];
    Object.keys(wanted).forEach(function (name) {
      var p = properties[name], optionalBody = key === 'inbox' && ['AIメモ', 'トランスクリプト'].includes(name);
      if (!p || !wanted[name].includes(p.type)) differences.push({ kind: optionalBody ? '本文での提供可・要確認' : '項目名・型', name: name, expected: wanted[name], actual: p ? p.type : '未設定' });
    });
    Object.keys(properties).filter(function (name) { return !wanted[name] && !(key === 'inbox' && properties[name].type === 'title'); }).forEach(function (name) {
      if (key === 'minutes' && name==='確認状態') knownAdditions.push({name:name,type:properties[name].type});
      else if (key === 'tasks' && ['関連プロジェクト（参照元）', 'サブアイテム', '関連プロジェクト'].includes(name)) knownAdditions.push({ name: name, type: properties[name].type });
      else differences.push({ kind: '追加項目', name: name, actual: properties[name].type });
    });
    if (key === 'inbox' && !Object.keys(properties).some(function (n) { return properties[n].type === 'title'; })) differences.push({ kind: '項目名・型', name: 'タイトル', expected: ['title'], actual: '未設定' });
    function options(name, values) {
      var p = properties[name];
      if (!p || !['select', 'multi_select', 'status'].includes(p.type)) return;
      var actual = ((p[p.type] || {}).options || []).map(function (o) { return o.name; });
      var missing = values.filter(function (v) { return !actual.includes(v); });
      var extra = actual.filter(function (v) { return !values.includes(v); });
      if (missing.length || extra.length) differences.push({ kind: '選択肢', name: name, missing: missing, extra: extra });
    }
    if (key !== 'inbox') options('事業部領域', domains);
    if (key === 'tasks') options('ステータス', ['未着手', '保留', '進行中', '対応不要', '完了']);
    if (key === 'inbox') options('取り込み状態', ['未処理', '取り込み済み', '対象外（Meet優先）', 'エラー']);
    return { properties: Object.keys(properties).map(function (n) { return { name: n, type: properties[n].type }; }), differences: differences, knownAdditions: knownAdditions };
  }
  function clean(value) { return String(value || '').replace(/https?:\/\/[^\s<>]+/gi, '（URL省略）'); }
  function richText(value) {
    var chars = Array.from(clean(value)), result = [];
    for (var i = 0; i < chars.length; i += 1000) result.push({ type: 'text', text: { content: chars.slice(i, i + 1000).join('') } });
    if (result.length > 100) throw new Error('テスト本文が長すぎます。');
    return result;
  }
  function block(type, value) { var b = { object: 'block', type: type }; b[type] = { rich_text: richText(value) }; return b; }
  function plan(judgement, manifest, masters, minutes, tasks, projectIds) {
    var comparison = compareSchema('minutes', minutes.properties);
    if (comparison.differences.some(function (d) { return d.kind === '項目名・型'; })) throw new Error('議事録DBの項目名・型がSPECと異なります。checkTestEnvironmentで確認してください。');
    var relation = minutes.properties['関連するプロジェクト'].relation || {};
    if (normalize(relation.data_source_id) !== normalize(tasks.sourceId) && !(relation.database_id && tasks.databaseId && normalize(relation.database_id) === normalize(tasks.databaseId))) throw new Error('関連するプロジェクトがテスト用タスクDBを参照していません。');
    if (!Number.isFinite(Date.parse(manifest.start))) throw new Error('会議の開始日時が不正です。');
    if (judgement.minutes_title.length > 2000) throw new Error('議事録名が長すぎます。');
    var projects = projectIds.map(function (id) { return { id: id }; });
    var placement = MeetingRules_.placementPlan(judgement, manifest, masters, projects);
    var warnings = [], choices = (minutes.properties['事業部領域'].multi_select.options || []).map(function (o) { return o.name; });
    var selected = placement.domains.filter(function (d) { return choices.includes(d); });
    var rejected = placement.domains.filter(function (d) { return !choices.includes(d); }).concat(placement.rejected_domains);
    if (rejected.length) warnings.push('送信しない事業部領域: ' + rejected.join('、'));
    if (placement.rejected_project_ids.length) warnings.push('テストDBに存在しない、または参照不可のため送信しない関連PJ: ' + placement.rejected_project_ids.join('、'));
    var participants = manifest.attendees || [];
    var people = (masters.people || []).filter(function (person) {
      return person.notion_user_id && participants.some(function (a) { return a.email && a.email.toLowerCase() === String(person.google_email || '').toLowerCase(); });
    }).map(function (person) { return { object: 'user', id: person.notion_user_id }; });
    var properties = {
      '議事録名': { title: richText(judgement.minutes_title) }, '日付': { date: { start: manifest.start } },
      '参加者': { people: people }, 'MTG URL': { url: null },
      '事業部領域': { multi_select: selected.map(function (name) { return { name: name }; }) },
      '関連するプロジェクト': { relation: placement.related_project_ids.map(function (id) { return { id: id }; }) }
    };
    var state=minutes.properties['確認状態'];
    if(state && state.type==='select' && (state.select.options||[]).some(function(o){return o.name===placement.status;})) properties['確認状態']={select:{name:placement.status}};
    var children = [block('heading_2', '基本情報'), block('paragraph', '日時：' + manifest.start),
      block('paragraph', '参加者：' + participants.map(function (a) { return a.name || a.email || '要確認'; }).join('、')),
      block('paragraph', '記録元：' + (manifest.source === 'meet' ? 'Meet' : 'tl;dv')),
      block('heading_2', '決定事項')];
    judgement.summary.decisions.forEach(function (text) { children.push(block('bulleted_list_item', text)); });
    if (!judgement.summary.decisions.length) children.push(block('paragraph', '決定事項はありません。'));
    children.push(block('heading_2', 'ネクストアクション'));
    judgement.summary.next_actions.forEach(function (a) { children.push(block('bulleted_list_item', a.who + '／' + a.what + '／期日：' + (a.due || '要確認'))); });
    if (!judgement.summary.next_actions.length) children.push(block('paragraph', 'ネクストアクションはありません。'));
    if (children.length > 100) throw new Error('本文が100ブロックを超えます。');
    return { placement: placement, warnings: warnings, payload: { parent: { type: 'data_source_id', data_source_id: minutes.sourceId }, properties: properties, children: children }, taskProposals: judgement.task_proposals };
  }
  return { compareSchema: compareSchema, plan: plan };
})();
