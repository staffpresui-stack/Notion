var NotionTestEnvironment_ = (function () {
  var parent = '400ca178-7419-80e8-bb9a-f157874b6105';
  var ids = { minutes: 'd9cc47f9-543e-4bcb-8ec8-27bebc0feac5', tasks: 'c908936a-6999-4119-9e9c-df364f5f5d1b' };
  function normalize(value) { return String(value || '').replace(/-/g, '').toLowerCase(); }
  function open(writingWorkflow) {
    var properties = PropertiesService.getScriptProperties();
    if (properties.getProperty('ENV') !== 'test') throw new Error('ENV=test が必要です。');
    var dryRun = properties.getProperty('DRY_RUN');
    if (writingWorkflow && !['true', 'false'].includes(dryRun)) throw new Error('DRY_RUN は true または false を明示してください。');
    var token = String(properties.getProperty('NOTION_TOKEN') || '').trim();
    if (!token) throw new Error('MTG議事録連携（GAS）のNOTION_TOKENが必要です。');
    ['minutes', 'tasks'].forEach(function (k) {
      var name = k === 'minutes' ? 'NOTION_DB_MINUTES_TEST' : 'NOTION_DB_TASKS_TEST';
      if (normalize(properties.getProperty(name)) !== normalize(ids[k])) throw new Error(name + ' が確認済みテストDBのIDと一致しません。');
    });
    var verified = {};
    function request(method, path, body, optionalStatuses) {
      if (method !== 'get') {
        if (!writingWorkflow || dryRun !== 'false' || method !== 'post' || path !== 'pages' || !verified.minutes || !verified.tasks ||
            !body.parent || body.parent.type !== 'data_source_id' || normalize(body.parent.data_source_id) !== normalize(verified.minutes.sourceId)) throw new Error('テスト議事録DBへのページ作成以外は禁止です。');
      }
      var options = { method: method, headers: { Authorization: 'Bearer ' + token, 'Notion-Version': '2025-09-03' }, muteHttpExceptions: true };
      if (body) { options.contentType = 'application/json'; options.payload = JSON.stringify(body); }
      Utilities.sleep(350);
      var response;
      try { response = UrlFetchApp.fetch('https://api.notion.com/v1/' + path, options); }
      catch (e) { throw new Error('Notionとの通信に失敗しました。書き込み結果は実Notionで確認してください。'); }
      var status = response.getResponseCode(), data;
      try { data = JSON.parse(response.getContentText()); } catch (e) { throw new Error('NotionからJSON以外の応答が返りました。HTTP ' + status); }
      if (status < 200 || status >= 300) {
        if ((optionalStatuses || []).includes(status)) return null;
        throw new Error('Notionテスト接続: HTTP ' + status + ' / ' + String(data.code || '不明'));
      }
      return data;
    }
    function schema(databaseId, key) {
      var db = request('get', 'databases/' + encodeURIComponent(databaseId));
      if (normalize(db.id) !== normalize(databaseId) || !db.parent || db.parent.type !== 'page_id' || normalize(db.parent.page_id) !== normalize(parent) || db.archived || db.in_trash) throw new Error('管理用ページ下の有効なDBではありません。');
      if (!db.data_sources || db.data_sources.length !== 1) throw new Error('DBのデータソースを1つに特定できません。');
      var ds = request('get', 'data_sources/' + encodeURIComponent(db.data_sources[0].id));
      if (!ds.parent || normalize(ds.parent.database_id) !== normalize(db.id) || normalize(ds.id) !== normalize(db.data_sources[0].id) || !ds.properties || ds.archived || ds.in_trash) throw new Error('データソースの所属・状態を確認できません。');
      var result = { databaseId: db.id, sourceId: ds.id, properties: ds.properties };
      if (key) {
        if (normalize(db.id) !== normalize(ids[key])) throw new Error('本番または未確認のDBです。');
        verified[key] = result;
        if (verified.minutes && verified.tasks && normalize(verified.minutes.sourceId) === normalize(verified.tasks.sourceId)) throw new Error('テスト用2DBのデータソースが同一です。');
      }
      return result;
    }
    function discoverInbox() {
      var matches = [], cursor;
      do {
        var page = request('get', 'blocks/' + parent + '/children?page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''));
        (page.results || []).forEach(function (b) {
          if (b.type === 'child_database' && b.child_database.title === 'tl;dv 受信' && !b.archived && !b.in_trash) matches.push(b.id);
        });
        cursor = page.has_more ? page.next_cursor : null;
      } while (cursor);
      if (matches.length !== 1) throw new Error('管理用ページ直下の「tl;dv 受信」DBが' + matches.length + '件あります。1件に特定できません。');
      return schema(matches[0]);
    }
    function project(id) {
      var page = request('get', 'pages/' + encodeURIComponent(id), null, [400, 403, 404]);
      if (!page || page.archived || page.in_trash || !page.parent || !verified.tasks) return null;
      return page.parent.type === 'data_source_id' && normalize(page.parent.data_source_id) === normalize(verified.tasks.sourceId) ||
        page.parent.type === 'database_id' && normalize(page.parent.database_id) === normalize(ids.tasks) ? page.id : null;
    }
    function createPage(payload) { return request('post', 'pages', payload); }
    return { properties: properties, dryRun: dryRun === 'true', schema: schema, inbox: discoverInbox, project: project, createPage: createPage,
      ids: { minutes: ids.minutes, tasks: ids.tasks } };
  }
  return { open: open, normalize: normalize };
})();

function checkTestEnvironment() {
  var env = NotionTestEnvironment_.open(false), report = { databases: [], differences: [], inboxId: null };
  function inspect(key, schema) {
    var comparison = NotionFixturePlan_.compareSchema(key, schema.properties);
    report.databases.push({ name: key, databaseId: schema.databaseId, properties: comparison.properties });
    comparison.differences.forEach(function (d) { report.differences.push(Object.assign({ database: key }, d)); });
    console.log('項目名・型: ' + key + ' / ' + JSON.stringify(comparison.properties));
  }
  inspect('minutes', env.schema(env.ids.minutes, 'minutes'));
  inspect('tasks', env.schema(env.ids.tasks, 'tasks'));
  try {
    var inbox = env.inbox();
    report.inboxId = inbox.databaseId;
    inspect('inbox', inbox);
    console.log('NOTION_DB_TLDV_INBOX = ' + inbox.databaseId + ' をスクリプトプロパティに登録してください。');
  } catch (e) { report.differences.push({ database: 'inbox', kind: '取得失敗', message: e.message }); }
  console.log('SPECとの差分一覧: ' + JSON.stringify(report.differences));
  console.log('依頼者の型・tl;dvの参加者形式などSPECで未確定の部分は参考として表示します。設定・Notionへの書き込みは行っていません。');
  return report;
}
