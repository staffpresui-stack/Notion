var TestDbSetup_ = (function () {
  var version = '2025-09-03';
  var parentId = '400ca178-7419-80e8-bb9a-f157874b6105';
  var definitions = {
    minutes: { databaseId: '4cf02dee-7a11-4319-ace1-e866d6a1a914', name: 'MTG議事録（テスト）', property: 'NOTION_DB_MINUTES_TEST' },
    tasks: { databaseId: 'e321f1cb-3365-4a2c-9844-47f34734a9d7', name: 'プロジェクト・タスク（テスト）', property: 'NOTION_DB_TASKS_TEST' }
  };
  function run() {
    var settings = PropertiesService.getScriptProperties();
    if (settings.getProperty('ENV') !== 'test' || settings.getProperty('SETUP_CREATE_TEST_DB') !== 'true') throw new Error('ENV=test、SETUP_CREATE_TEST_DB=true のときだけ実行できます。');
    var token = String(settings.getProperty('NOTION_TOKEN') || '').trim();
    if (!token) throw new Error('MTG議事録連携（GAS）のNOTION_TOKENを設定してください。');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new Error('初期化が実行中です。後でもう一度実行してください。');
    try { return execute(token); } finally { lock.releaseLock(); }
  }
  function execute(token) {
    var keys = ['minutes', 'tasks'], sources = {}, targets = {}, scalar = {};
    var allowed = new Set(), forbidden = new Set(keys.map(function (k) { return TestDbSchema_.id(definitions[k].databaseId); }));
    function guard(method, path, body) {
      if (method === 'get') return;
      // 初期化専用: 管理ページ直下へのDB作成と、検証済みテストDSへのリレーション追加だけを許可します。
      if (method === 'post' && path === 'databases') {
        if (!body.parent || body.parent.type !== 'page_id' || TestDbSchema_.id(body.parent.page_id) !== TestDbSchema_.id(parentId)) throw new Error('管理用ページ以外には作成できません。');
        var props = (body.initial_data_source || {}).properties || {};
        if (Object.keys(props).some(function (n) { return props[n].type === 'relation'; })) throw new Error('作成時のリレーションは禁止です。');
        return;
      }
      var match = /^data_sources\/([A-Za-z0-9-]+)$/.exec(path);
      if (method !== 'patch' || !match || forbidden.has(TestDbSchema_.id(match[1])) || !allowed.has(TestDbSchema_.id(match[1]))) throw new Error('本番または未検証の対象への書き込みは禁止です。');
      if (!body.properties || Object.keys(body).length !== 1) throw new Error('リレーション以外の更新は禁止です。');
      Object.keys(body.properties).forEach(function (name) {
        var p = body.properties[name], r = p.relation || {};
        if (p.type !== 'relation' || r.database_id || !allowed.has(TestDbSchema_.id(r.data_source_id)) || forbidden.has(TestDbSchema_.id(r.data_source_id))) throw new Error('本番または対象外DBへのリレーションは禁止です。');
      });
    }
    function request(method, path, body) {
      guard(method, path, body);
      var options = { method: method, headers: { Authorization: 'Bearer ' + token, 'Notion-Version': version }, muteHttpExceptions: true };
      if (body) { options.contentType = 'application/json'; options.payload = JSON.stringify(body); }
      // Notionの平均3リクエスト/秒を超えないよう、連続呼び出しを間引きます。
      Utilities.sleep(350);
      var response = UrlFetchApp.fetch('https://api.notion.com/v1/' + path, options), status = response.getResponseCode(), data;
      try { data = JSON.parse(response.getContentText()); } catch (e) { throw new Error('NotionからJSON以外の応答が返りました。HTTP ' + status); }
      if (status < 200 || status >= 300) throw new Error('Notion初期化: HTTP ' + status + ' / ' + String(data.code || '不明'));
      return data;
    }
    function schema(databaseId, testKey) {
      var db = request('get', 'databases/' + encodeURIComponent(databaseId));
      if (TestDbSchema_.id(db.id) !== TestDbSchema_.id(databaseId)) throw new Error('DBのIDが応答と一致しません。');
      if (testKey) {
        var title = (db.title || []).map(function (t) { return t.plain_text || (t.text || {}).content || ''; }).join('');
        if (!db.parent || db.parent.type !== 'page_id' || TestDbSchema_.id(db.parent.page_id) !== TestDbSchema_.id(parentId) || title !== definitions[testKey].name || forbidden.has(TestDbSchema_.id(db.id)) || db.archived || db.in_trash) throw new Error('テストDBの親ページ・名前・状態を確認してください。');
      }
      if (!db.data_sources || db.data_sources.length !== 1) throw new Error('DBのデータソースを1つに特定できません。');
      var ds = request('get', 'data_sources/' + encodeURIComponent(db.data_sources[0].id));
      if (!ds.properties || TestDbSchema_.id(ds.id) !== TestDbSchema_.id(db.data_sources[0].id) || !ds.parent || TestDbSchema_.id(ds.parent.database_id) !== TestDbSchema_.id(db.id)) throw new Error('データソースの所属を確認できません。');
      if (testKey && (forbidden.has(TestDbSchema_.id(ds.id)) || ds.archived || ds.in_trash)) throw new Error('本番または無効なデータソースです。');
      return { databaseId: db.id, sourceId: ds.id, properties: ds.properties };
    }
    // 本番はスキーマのGETだけ。本文・会議データは取得しません。
    keys.forEach(function (k) {
      sources[k] = schema(definitions[k].databaseId);
      forbidden.add(TestDbSchema_.id(sources[k].sourceId));
      scalar[k] = TestDbSchema_.scalarProperties(sources[k].properties);
      scalar[k].skipped.forEach(function (s) { console.log('スキップ: ' + definitions[k].name + ' / ' + s.name + ' / ' + s.type + ' / ' + s.reason); });
    });
    var relationPlan = TestDbSchema_.relations(sources);
    relationPlan.skipped.forEach(function (s) { console.log('スキップ: ' + s.database + ' / ' + s.name + ' / ' + s.reason); });
    var children = [], cursor;
    do {
      var page = request('get', 'blocks/' + parentId + '/children?page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''));
      children = children.concat(page.results || []); cursor = page.has_more ? page.next_cursor : null;
    } while (cursor);
    // 既存の同名DBをすべて確認してから、新しいDBを作成します。
    keys.forEach(function (k) {
      var matches = children.filter(function (b) { return b.type === 'child_database' && b.child_database.title === definitions[k].name && !b.archived && !b.in_trash; });
      if (matches.length > 1) throw new Error('管理ページに同名DBが複数あります: ' + definitions[k].name);
      if (matches.length === 1) {
        targets[k] = schema(matches[0].id, k);
        TestDbSchema_.assertCompatible(targets[k].properties, scalar[k].properties);
        console.log('既存DBを使用: ' + definitions[k].name + ' / ' + targets[k].databaseId);
      }
    });
    keys.forEach(function (k) {
      if (!targets[k]) {
        var created = request('post', 'databases', { parent: { type: 'page_id', page_id: parentId },
          title: [{ type: 'text', text: { content: definitions[k].name } }], initial_data_source: { properties: scalar[k].properties } });
        console.log('作成したDB: ' + definitions[k].name + ' / ' + created.id);
        targets[k] = schema(created.id, k);
        TestDbSchema_.assertCompatible(targets[k].properties, scalar[k].properties);
      }
      allowed.add(TestDbSchema_.id(targets[k].sourceId));
    });
    function matchesRelation(property, target, reverseName) {
      return property && property.type === 'relation' && TestDbSchema_.id((property.relation || {}).data_source_id) === TestDbSchema_.id(target.sourceId) &&
        (!reverseName || property.relation.type === 'dual_property' && (property.relation.dual_property || {}).synced_property_name === reverseName);
    }
    function checkEdge(edge) {
      var from = targets[edge.from].properties[edge.name], reverse = edge.reverseName ? targets[edge.to].properties[edge.reverseName] : null;
      if (from && !matchesRelation(from, targets[edge.to], edge.reverseName)) throw new Error('既存リレーションが異なります。上書きしません: ' + edge.name);
      if (edge.reverseName && reverse && !matchesRelation(reverse, targets[edge.from], edge.name)) throw new Error('既存の相手リレーションが異なります: ' + edge.reverseName);
      if (edge.reverseName && Boolean(from) !== Boolean(reverse)) throw new Error('双方向リレーションの片側だけが存在します。上書きしません: ' + edge.name);
      return !!from;
    }
    relationPlan.edges.forEach(checkEdge);
    relationPlan.edges.forEach(function (edge) {
      if (checkEdge(edge)) return;
      var properties = Object.create(null);
      properties[edge.name] = TestDbSchema_.relationProperty(edge, targets);
      request('patch', 'data_sources/' + targets[edge.from].sourceId, { properties: properties });
      // 相手側に自動生成された項目も読み直し、再実行時の重複を防ぎます。
      targets[edge.from] = schema(targets[edge.from].databaseId, edge.from);
      if (edge.from !== edge.to) targets[edge.to] = schema(targets[edge.to].databaseId, edge.to);
      if (!checkEdge(edge)) throw new Error('作成後のリレーションを確認できません: ' + edge.name);
    });
    var result = {};
    keys.forEach(function (k) {
      result[definitions[k].property] = targets[k].databaseId;
      console.log(definitions[k].property + ' = ' + targets[k].databaseId);
    });
    console.log('上のIDをGASのスクリプトプロパティに設定してください。SETUP_CREATE_TEST_DBはfalseに戻してください。');
    return result;
  }
  return { run: run };
})();

function setupTestDatabases() { return TestDbSetup_.run(); }
