var NotionTestEnvironment_ = (function () {
  var parent = '400ca178-7419-80e8-bb9a-f157874b6105';
  var ids = { minutes: 'd9cc47f9-543e-4bcb-8ec8-27bebc0feac5', tasks: 'c908936a-6999-4119-9e9c-df364f5f5d1b' };
  function normalize(value) { return String(value || '').replace(/-/g, '').toLowerCase(); }
  function open(writingWorkflow, purpose) {
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
    var verifiedProjectInfo = {}, verified = {}, allowedPages = new Set(), inboxPatch = null, statusPatch = null, lastRequestAt = 0;
    function request(method, path, body, optionalStatuses) {
      if (method !== 'get') {
        var create = method === 'post' && path === 'pages' && verified.minutes && verified.tasks && body.parent && body.parent.type === 'data_source_id' && normalize(body.parent.data_source_id) === normalize(verified.minutes.sourceId);
        var append = /^blocks\/([^/]+)\/children$/.exec(path);
        var appendAllowed = method === 'patch' && append && allowedPages.has(normalize(append[1])) && body.children && body.children.length <= 100;
        var reviewAllowed = ['review', 'review-setup'].includes(purpose) && method === 'patch' && /^pages\/[^/]+$/.test(path) && allowedPages.has(normalize(path.split('/')[1])) && Object.keys(body).every(function (k) { return k === 'properties'; }) && (!body.properties || Object.keys(body.properties).every(function (k) { return ['議事録名', '事業部領域', '関連するプロジェクト', '確認状態'].includes(k); }));
        var query = method === 'post' && verified.tasks && path === 'data_sources/' + verified.tasks.sourceId + '/query';
        var statusAllowed = purpose === 'review-setup' && statusPatch && method === 'patch' && path === statusPatch.path && JSON.stringify(body) === statusPatch.body;
        var optionAllowed = purpose === 'inbox-options' && inboxPatch && method === 'patch' && path === inboxPatch.path && JSON.stringify(body) === inboxPatch.body;
        if (!query && (!writingWorkflow || dryRun !== 'false' || !(create || appendAllowed || optionAllowed || reviewAllowed || statusAllowed))) throw new Error('確認済みテスト対象以外への書き込みは禁止です。');
      }
      var options = { method: method, headers: { Authorization: 'Bearer ' + token, 'Notion-Version': '2025-09-03' }, muteHttpExceptions: true };
      if (body) { options.contentType = 'application/json'; options.payload = JSON.stringify(body); }
      if (lastRequestAt) { var pause=350-(Date.now()-lastRequestAt); if(pause>0) Utilities.sleep(pause); }
      lastRequestAt=Date.now();
      var response;
      try { response = UrlFetchApp.fetch('https://api.notion.com/v1/' + path, options); }
      catch (e) { throw new Error('Notionとの通信に失敗しました。書き込み結果は実Notionで確認してください。'); }
      var status = response.getResponseCode(), data;
      try { data = JSON.parse(response.getContentText()); } catch (e) { throw new Error('NotionからJSON以外の応答が返りました。HTTP ' + status); }
      if (status < 200 || status >= 300) {
        if ((optionalStatuses || []).includes(status)) return null;
        var error = new Error('Notionテスト接続: HTTP ' + status + ' / ' + String(data.code || '不明')); error.httpStatus = status; throw error;
      }
      return data;
    }
    function schema(databaseId, key, useCache) {
      var cacheKey='schema:'+normalize(databaseId), cached=useCache && purpose==='review' && key && typeof ReviewCache_ !== 'undefined' && ReviewCache_.get(cacheKey);
      if (cached && normalize(cached.databaseId)===normalize(ids[key]) && cached.sourceId && cached.properties) { verified[key]=cached; return cached; }
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
      if (purpose==='review' && key && typeof ReviewCache_ !== 'undefined') ReviewCache_.put(cacheKey,result,120);
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
      var belongs=page.parent.type === 'data_source_id' && normalize(page.parent.data_source_id) === normalize(verified.tasks.sourceId) || page.parent.type === 'database_id' && normalize(page.parent.database_id) === normalize(ids.tasks);
      if(!belongs) return null;
      verifiedProjectInfo[id]={id:page.id,domains:((((page.properties || {})['事業部領域'] || {}).multi_select) || []).map(function(o){return o.name;})};
      return page.id;
    }
    function verifyMinutesPage(id) {
      var page = request('get', 'pages/' + encodeURIComponent(id));
      if (!verified.minutes || (page.archived || page.in_trash) || !page.parent || !(page.parent.type === 'data_source_id' && normalize(page.parent.data_source_id) === normalize(verified.minutes.sourceId) || page.parent.type === 'database_id' && normalize(page.parent.database_id) === normalize(ids.minutes))) throw new Error('記録済みページがテスト議事録DBに属していません。');
      allowedPages.add(normalize(page.id)); return page;
    }
    function updateReviewPage(id, props) {
      if (!['review','review-setup'].includes(purpose)) throw new Error('確認画面専用です。');
      if (arguments.length>2 || !props || Object.keys(props).some(function(k){return !['議事録名','事業部領域','関連するプロジェクト','確認状態'].includes(k);})) throw new Error('状態を含むプロパティ更新だけを許可します。ゴミ箱は使用できません。');
      if (!allowedPages.has(normalize(id))) verifyMinutesPage(id);
      return request('patch', 'pages/' + id, { properties: props });
    }
    function prepareReviewStatus() {
      if (purpose!=='review-setup' || !verified.minutes) throw new Error('テスト議事録DBの準備専用です。');
      var plan=ReviewPlan_.statusSchema(verified.minutes.properties['確認状態']);
      console.log('確認状態の追加予定: '+JSON.stringify(plan.added));
      if (!plan.changed || dryRun==='true') return plan;
      var body={properties:{'確認状態':{type:'select',select:{options:plan.options}}}};
      statusPatch={path:'data_sources/'+verified.minutes.sourceId,body:JSON.stringify(body)};
      request('patch',statusPatch.path,body);statusPatch=null;
      verified.minutes.properties['確認状態']={type:'select',select:{options:plan.options}};
      if (typeof ReviewCache_ !== 'undefined') ReviewCache_.remove('schema:'+normalize(ids.minutes));
      return plan;
    }
    function projects() {
      if (!verified.tasks) throw new Error('テストDBを確認してください。');
      var out = [], cursor;
      do {
        var body = { page_size: 100 }; if (cursor) body.start_cursor = cursor;
        var data = request('post', 'data_sources/' + verified.tasks.sourceId + '/query', body);
        (data.results || []).forEach(function (p) { if (p.archived || p.in_trash) return; var title = Object.values(p.properties || {}).find(function (v) { return v.type === 'title'; }); out.push({ id: p.id, domains: ((p.properties['事業部領域'] || {}).multi_select || []).map(function (v) { return v.name; }), title: title ? title.title.map(function (t) { return t.plain_text || t.text && t.text.content || ''; }).join('') : p.id }); });
        cursor = data.has_more ? data.next_cursor : null;
        if (out.length >= 500 && cursor) throw new Error('プロジェクト候補が500件を超えました。refを整備してください。');
      } while (cursor);
      return out;
    }
    function createPage(payload) { var page = request('post', 'pages', payload); if (page.id) allowedPages.add(normalize(page.id)); return page; }
    function appendBlocks(id, children) { return request('patch', 'blocks/' + id + '/children', { children: children }); }
    function addInboxOptions() {
      if (purpose !== 'inbox-options') throw new Error('選択肢追加専用の呼び出しではありません。');
      var inbox = discoverInbox();
      if (normalize(inbox.databaseId) !== normalize('400ca178-7419-80dd-a3e0-ef9e2267a64c') || normalize(properties.getProperty('NOTION_DB_TLDV_INBOX')) !== normalize(inbox.databaseId)) throw new Error('確認済みtl;dv受信DBのIDが必要です。');
      var property = inbox.properties['取り込み状態'];
      if (!property || property.type !== 'select') throw new Error('取り込み状態はselect型が必要です。');
      var plan = InboxPlan_.mergeOptions(property.select.options || []);
      console.log('取り込み状態の追加予定: ' + JSON.stringify(plan.added));
      if (dryRun === 'true' || !plan.added.length) return { added: plan.added, dryRun: dryRun === 'true' };
      var body = { properties: { '取り込み状態': { type: 'select', select: { options: plan.options } } } };
      inboxPatch = { path: 'data_sources/' + inbox.sourceId, body: JSON.stringify(body) };
      request('patch', inboxPatch.path, body); inboxPatch = null;
      console.log('不足していた選択肢だけを追加しました。');
      return { added: plan.added, dryRun: false };
    }
    return { properties: properties, dryRun: dryRun === 'true', schema: schema, inbox: discoverInbox, project: project, createPage: createPage,
      verifyMinutesPage: verifyMinutesPage, appendBlocks: appendBlocks, addInboxOptions: addInboxOptions,
      updateReviewPage: updateReviewPage, prepareReviewStatus: prepareReviewStatus, projectDetails:function(id){return verifiedProjectInfo[id] || null;}, projects: projects,
      ids: { minutes: ids.minutes, tasks: ids.tasks } };
  }
  return { open: open, normalize: normalize };
})();

function checkTestEnvironment() {
  if (typeof assertFinanceOperator_ === 'function') assertFinanceOperator_();
  var env = NotionTestEnvironment_.open(false), report = { databases: [], differences: [], inboxId: null };
  function inspect(key, schema) {
    var comparison = NotionFixturePlan_.compareSchema(key, schema.properties, env.properties.getProperty('NOTION_REQUESTER_TYPE') || 'people');
    report.databases.push({ name: key, databaseId: schema.databaseId, properties: comparison.properties });
    comparison.differences.forEach(function (d) { report.differences.push(Object.assign({ database: key }, d)); });
    console.log('項目名・型: ' + key + ' / ' + JSON.stringify(comparison.properties));
    if (comparison.knownAdditions.length) console.log('既知の追加項目（書き込みには使いません）: ' + JSON.stringify(comparison.knownAdditions));
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
  console.log('依頼者はNOTION_REQUESTER_TYPE（既定people）で照合します。設定・Notionへの書き込みは行っていません。');
  return report;
}

function addTldvInboxStatusOptions() {
  if (typeof assertFinanceOperator_ === 'function') assertFinanceOperator_(); return Ledger_.withLock(function () { return NotionTestEnvironment_.open(true, 'inbox-options').addInboxOptions(); }); }
