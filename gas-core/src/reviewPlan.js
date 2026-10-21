var ReviewPlan_ = (function () {
  var domains = ['セールス・マーケ', 'EC', '生産管理', '経理・バックオフィス', 'Salesforce・AI', '経営'];
  function arrays(value) { return ReviewSecurity_.list(value); }
  function canonical(value) { return JSON.stringify(Array.isArray(value) ? value.slice().sort() : value); }
  function snapshot(row) { var out = {}; ['status', 'scope_final', 'placement_final', 'domains_final', 'related_project_ids_final', 'minutes_title', 'folder_id_final', 'confirmed_by', 'confirmed_at'].forEach(function (k) { out[k] = row[k] || ''; }); return out; }
  function plan(row, request, masters, user, now) {
    if (!['confirm', 'edit_confirm', 'hold', 'exclude'].includes(request.action)) throw new Error('操作が不正です。');
    if (row.status === '要対応') throw new Error('先に再実行で未完了の処理を再開してください。');
    if (row.status === '対象外' || row.status === '対象外（Meet優先）') throw new Error('対象外の議事録はこの画面から復帰できません。');
    if (!row.meeting_folder_id || !row.notion_page_id) throw new Error('取り込みが未完了です。先に再実行してください。');
    var next = snapshot(row), edits = request.action === 'edit_confirm' ? request.edits || {} : {}, newClient = null;
    var allowed = ['scope', 'placement', 'domains', 'projectIds', 'minutesTitle', 'newClient', 'ackExternal'];
    Object.keys(edits).forEach(function (key) { if (!allowed.includes(key)) throw new Error('未定義の編集項目です。'); });
    if (request.action === 'edit_confirm') {
      if (!['社内', '社外'].includes(edits.scope)) throw new Error('社内・社外を選んでください。');
      if (typeof edits.minutesTitle !== 'string' || !edits.minutesTitle.trim() || edits.minutesTitle.length > 2000) throw new Error('議事録名を1〜2000文字で入力してください。');
      if (!Array.isArray(edits.domains) || edits.domains.some(function (d) { return !domains.includes(d); }) || new Set(edits.domains).size !== edits.domains.length) throw new Error('事業部領域は指定の6択から選んでください。');
      if (!Array.isArray(edits.projectIds) || edits.projectIds.length > 100 || edits.projectIds.some(function (id) { return typeof id !== 'string' || !/^[0-9a-f-]{32,36}$/i.test(id); }) || new Set(edits.projectIds).size !== edits.projectIds.length) throw new Error('関連プロジェクトが不正です。');
      next.scope_final = edits.scope; next.placement_final = edits.placement; next.domains_final = JSON.stringify(edits.domains); next.related_project_ids_final = JSON.stringify(edits.projectIds); next.minutes_title = edits.minutesTitle.trim();
      if (edits.newClient && edits.newClient.name) {
        if (!user.admin || edits.scope !== '社外') throw new Error('新規顧客は管理者が社外の格納先として登録します。');
        var name = String(edits.newClient.name).trim(), clientDomains = arrays(edits.newClient.domains).map(function (d) { return String(d).trim().toLowerCase(); });
        if (!name || name.length > 80 || !clientDomains.length || clientDomains.some(function (d) { return !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(d); })) throw new Error('新規顧客の名前とドメインを入力してください。');
        if (masters.clients.some(function (c) { return InboxPlan_.safeName(c.client_name) === InboxPlan_.safeName(name); })) throw new Error('同名・同じフォルダ名の顧客は既存の候補から選んでください。');
        newClient = { name: name, domains: Array.from(new Set(clientDomains)) }; next.placement_final = '社外/' + name;
      }
    }
    var confirm = ['confirm', 'edit_confirm'].includes(request.action);
    if (confirm) {
      if (typeof next.placement_final !== 'string' || !next.placement_final.startsWith(next.scope_final + '/')) throw new Error('社内・社外と格納先が一致しません。');
      if (!newClient && !masters.folders.some(function (f) { return f.placement === next.placement_final; })) throw new Error('登録済みの格納先を選んでください。');
      var attendees = JSON.parse(row.attendees_json || '[]'), rule = MeetingRules_.classify(attendees, masters);
      if (rule.scope === '社外' && next.scope_final === '社内' && !(request.edits || {}).ackExternal) throw new Error('社外参加者がいる会議です。社内へ配置する確認チェックが必要です。');
    }
    var changed = ['scope_final', 'placement_final', 'minutes_title'].some(function (k) { return next[k] !== row[k]; }) ||
      canonical(arrays(next.domains_final)) !== canonical(arrays(row.domains_final)) || canonical(arrays(next.related_project_ids_final)) !== canonical(arrays(row.related_project_ids_final));
    if (confirm) {
      next.status = changed || row.status === '確定・修正あり' ? '確定・修正あり' : '確定'; next.confirmed_by = user.email; next.confirmed_at = now;
    } else next.status = request.action === 'hold' ? '保留' : '対象外';
    return { action: request.action, before: snapshot(row), desired: next, newClient: newClient, changed: changed,
      reconfirmed: confirm && ['確定', '確定・修正あり'].includes(row.status) && changed, archive: request.action === 'exclude', updateProperties: confirm };
  }
  function notionProperties(row, schema, projectIds) {
    var p = schema.properties, selected = arrays(row.domains_final), ids = arrays(row.related_project_ids_final);
    if (!p['議事録名'] || p['議事録名'].type !== 'title' || !p['事業部領域'] || p['事業部領域'].type !== 'multi_select' || !p['関連するプロジェクト'] || p['関連するプロジェクト'].type !== 'relation') throw new Error('Notionの編集対象プロパティがSPECと異なります。');
    var options = (p['事業部領域'].multi_select.options || []).map(function (o) { return o.name; });
    if (selected.some(function (name) { return !domains.includes(name) || !options.includes(name); })) throw new Error('Notionに存在しない事業部領域は送信できません。');
    if (ids.some(function (id) { return !projectIds.includes(id); })) throw new Error('テスト用タスクDBに存在しない関連プロジェクトです。');
    return { '議事録名': { title: [{ type: 'text', text: { content: row.minutes_title } }] }, '事業部領域': { multi_select: selected.map(function (name) { return { name: name }; }) }, '関連するプロジェクト': { relation: ids.map(function (id) { return { id: id }; }) } };
  }
  function reply(plan) {
    return '確定後の修正内容\n' + ['scope_final', 'placement_final', 'domains_final', 'related_project_ids_final', 'minutes_title'].filter(function (k) { return plan.before[k] !== plan.desired[k]; }).map(function (k) {
      var names = { scope_final: '区分', placement_final: '格納先', domains_final: '事業部領域', related_project_ids_final: '関連プロジェクト', minutes_title: '議事録名' };
      return names[k] + '：' + String(plan.before[k] || '未設定') + ' → ' + String(plan.desired[k] || '未設定');
    }).join('\n');
  }
  return { plan: plan, snapshot: snapshot, notionProperties: notionProperties, reply: reply };
})();
