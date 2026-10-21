// config.js
var Config_ = (function () {
  var defaults = { ENV: 'test', DRY_RUN: 'true', GENERATOR_MODE: 'CHATGPT',
    NOTION_VERSION: '2025-09-03', TASK_DB_MODE: 'single', NOTION_MTG_URL_SOURCE: 'none', NOTION_REQUESTER_TYPE: 'people' };
  // テスト対象を本番IDで代用しません。不明な値は安全側で拒否します。
  function inspect(values, profile) {
    var c = Object.assign({}, defaults, values), missing = [], errors = [];
    var required = ['LEDGER_SPREADSHEET_ID', 'NOTION_TOKEN', 'NOTION_DB_TLDV_INBOX'];
    if (c.ENV !== 'test') required.push('SHARED_DRIVE_ID');
    if (!['test', 'prod'].includes(c.ENV)) errors.push('ENV は test または prod を指定してください。');
    if (!['true', 'false'].includes(c.DRY_RUN)) errors.push('DRY_RUN は true または false を指定してください。');
    if (c.ENV !== 'test') errors.push('この開発環境はENV=test専用です。');
    if (!['people', 'rich_text', 'email'].includes(c.NOTION_REQUESTER_TYPE)) errors.push('NOTION_REQUESTER_TYPE が不正です。');
    if (!['CHATGPT', 'OPENAI_API'].includes(c.GENERATOR_MODE)) errors.push('GENERATOR_MODE が不正です。');
    if (!['single', 'dual'].includes(c.TASK_DB_MODE)) errors.push('TASK_DB_MODE が不正です。');
    if (!['none', 'folder', 'meet'].includes(c.NOTION_MTG_URL_SOURCE)) errors.push('NOTION_MTG_URL_SOURCE が不正です。');
    required = required.concat(['FOLDER_SYSTEM_TEST_ID', 'NOTION_DB_MINUTES_TEST', 'NOTION_DB_TASKS_TEST']);
    if (c.CHATWORK_TOKEN) required.push('CHATWORK_ROOM_ID_TEST');
    if (c.GENERATOR_MODE === 'OPENAI_API') required = required.concat(['OPENAI_API_KEY', 'OPENAI_MODEL']);
    if (c.TASK_DB_MODE === 'dual') required.push('NOTION_DB_NONPROJECT_TEST');
    // Notionの読み取り確認は、まだ使わないChatworkやDriveの設定で止めません。
    if (profile === 'notion') {
      required = ['NOTION_TOKEN', 'NOTION_DB_MINUTES_TEST', 'NOTION_DB_TASKS_TEST', 'NOTION_DB_TLDV_INBOX'];
      if (c.TASK_DB_MODE === 'dual') required.push('NOTION_DB_NONPROJECT_TEST');
    }
    required.forEach(function (k) { if (typeof c[k] !== 'string' || !c[k].trim()) missing.push(k); });
    ['NOTION_DB_MINUTES', 'NOTION_DB_TASKS', 'NOTION_DB_NONPROJECT', 'CHATWORK_ROOM_ID'].forEach(function (k) {
      if (c[k + '_TEST'] && c[k] === c[k + '_TEST']) errors.push(k + ' の本番用とテスト用が同じです。');
    });
    if (c.FOLDER_SYSTEM_ID && c.FOLDER_SYSTEM_ID === c.FOLDER_SYSTEM_TEST_ID) errors.push('本番用とテスト用のシステムフォルダが同じです。');
    var normalize = function (id) { return String(id || '').replace(/-/g, '').toLowerCase(); };
    ['NOTION_DB_MINUTES_TEST', 'NOTION_DB_TASKS_TEST', 'NOTION_DB_NONPROJECT_TEST', 'NOTION_DB_TLDV_INBOX'].forEach(function (k) {
      if (['4cf02dee7a114319ace1e866d6a1a914', 'e321f1cb33654a2c984447f34734a9d7'].includes(normalize(c[k]))) errors.push(k + ' に仕様書の本番DBは使えません。');
    });
    return { ok: !missing.length && !errors.length, missing: missing, errors: errors };
  }
  function load() { return Object.assign({}, defaults, PropertiesService.getScriptProperties().getProperties()); }
  function assertSafe(profile) {
    var c = load(), result = inspect(c, profile);
    if (!result.ok) throw new Error('設定を確認してください。不足: ' + result.missing.join('、') + '。' + result.errors.join(' '));
    return c;
  }
  return { inspect: inspect, load: load, assertSafe: assertSafe };
})();

function checkConfig() {
  var result = Config_.inspect(Config_.load());
  console.log(JSON.stringify(result));
  return result;
}

function checkNotionConfig() {
  var result = Config_.inspect(Config_.load(), 'notion');
  console.log(JSON.stringify(result));
  return result;
}


// driveUtil.js
var DriveUtil_ = (function () {
  var folderMime = 'application/vnd.google-apps.folder';
  function escape(value) { return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
  function folders(parent, driveId) {
    var all = [], token;
    do {
      var r = Drive.Files.list({ q: "'" + escape(parent) + "' in parents and trashed = false and mimeType = '" + folderMime + "'",
        corpora: 'drive', driveId: driveId, supportsAllDrives: true, includeItemsFromAllDrives: true,
        pageSize: 100, pageToken: token, fields: 'nextPageToken,files(id,name,parents,driveId,mimeType)' });
      all = all.concat(r.files || []); token = r.nextPageToken;
    } while (token);
    return all;
  }
  function exact(parent, name, driveId) {
    var matches = folders(parent, driveId).filter(function (f) { return f.name === name; });
    if (matches.length !== 1) throw new Error('フォルダ「' + name + '」が見つからないか、同名が複数あります。');
    return matches[0];
  }
  function verifyTestRoot(c) {
    if (!c.SHARED_DRIVE_ID) return Stage2Drive_.open(c).root;
    var root = Drive.Files.get(c.FOLDER_SYSTEM_TEST_ID, { supportsAllDrives: true, fields: 'id,name,parents,driveId,mimeType' });
    if (root.name !== '_test' || root.driveId !== c.SHARED_DRIVE_ID || root.mimeType !== folderMime || !root.parents || root.parents.length !== 1) throw new Error('テスト用フォルダを確認してください。');
    var parent = Drive.Files.get(root.parents[0], { supportsAllDrives: true, fields: 'id,name,driveId' });
    if (parent.name !== '_system' || parent.driveId !== c.SHARED_DRIVE_ID) throw new Error('_system/_test 配下が必要です。');
    return root;
  }
  return { folders: folders, exact: exact, verifyTestRoot: verifyTestRoot };
})();


// inboxPlan.js
var InboxPlan_ = (function () {
  function mergeOptions(existing) {
    var required = ['未処理', '取り込み済み', '対象外（Meet優先）', 'エラー'];
    var names = existing.map(function (o) { return o.name; });
    var added = required.filter(function (n) { return !names.includes(n); });
    return { added: added, options: existing.map(function (o) {
      var result = { name: o.name }; if (o.id) result.id = o.id; if (o.color) result.color = o.color; return result;
    }).concat(added.map(function (name) { return { name: name }; })) };
  }
  // 提供されたJSON Schemaで使うキーワードをGAS内で検証します。外部コードは読み込みません。
  function validate(value, schema, path) {
    path = path || '$'; var errors = [], types = Array.isArray(schema.type) ? schema.type : [schema.type];
    var type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (schema.type && !types.includes(type)) return [path + ': 型が不正です。'];
    if (schema.enum && !schema.enum.includes(value)) errors.push(path + ': 選択肢が不正です。');
    if (typeof value === 'string') {
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(path + ': 形式が不正です。');
      if (schema.maxLength && Array.from(value).length > schema.maxLength) errors.push(path + ': 長すぎます。');
    }
    if (type === 'object') {
      (schema.required || []).forEach(function (key) { if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(path + '.' + key + ': 必須です。'); });
      Object.keys(value).forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(schema.properties || {}, key)) errors = errors.concat(validate(value[key], schema.properties[key], path + '.' + key));
        else if (schema.additionalProperties === false) errors.push(path + '.' + key + ': 未定義の項目です。');
      });
    }
    if (type === 'array') {
      if (schema.uniqueItems && new Set(value.map(function (v) { return JSON.stringify(v); })).size !== value.length) errors.push(path + ': 重複があります。');
      value.forEach(function (v, i) { if (schema.items) errors = errors.concat(validate(v, schema.items, path + '[' + i + ']')); });
    }
    return errors;
  }
  function judgement(input) {
    var data = JSON.parse(JSON.stringify(input)), warnings = [], choices = ['セールス・マーケ', 'EC', '生産管理', '経理・バックオフィス', 'Salesforce・AI', '経営'];
    if (Array.isArray(data.domains)) data.domains = data.domains.filter(function (d) { if (choices.includes(d)) return true; warnings.push('未定義の事業部領域を除外しました。'); return false; });
    var errors = validate(data, InboxJudgementSchema_);
    if (errors.length) throw new Error('判定JSONが不正です: ' + errors.join(' '));
    return { data: data, warnings: warnings };
  }
  function safeName(value) {
    var chars = { '\\': '＼', '/': '／', ':': '：', '*': '＊', '?': '？', '"': '＂', '<': '＜', '>': '＞', '|': '｜' };
    return Array.from(String(value || '会議').replace(/[\\/:*?"<>|]/g, function (c) { return chars[c]; })).slice(0, 40).join('');
  }
  function card(row, reviewUrl) {
    function clean(v) { return String(v || '').replace(/https?:\/\/[^\s<>]+/gi, '（URL省略）').replace(/\[/g, '［').replace(/\]/g, '］'); }
    function date(value, timeOnly) {
      var valueMs = Date.parse(value);
      if (!Number.isFinite(valueMs)) return '日時：要確認';
      var local = new Date(valueMs + 9 * 60 * 60 * 1000), iso = local.toISOString();
      return timeOnly ? iso.slice(11, 16) : Number(iso.slice(5, 7)) + '/' + Number(iso.slice(8, 10)) + '(' + '日月火水木金土'[local.getUTCDay()] + ') ' + iso.slice(11, 16);
    }
    function values(value) { try { var data = JSON.parse(value || '[]'); return Array.isArray(data) ? data : []; } catch (e) { return []; } }
    var body = '[info][title]【' + clean(row.status) + '】議事録の格納先を確認してください（' + clean(row.display_id) + '）[/title]\n' +
      date(row.event_start, false) + '–' + date(row.event_end, true) + '　' + clean(row.title) + '（' + (row.source === 'meet' ? 'Meet' : row.source === 'tldv' ? 'tl;dv' : '記録元：要確認') + '）' +
      '\nDrive：' + clean(row.placement_final).replace('/', ' ＞ ') + '\nNotion：' + clean(row.minutes_title) + '（' + clean(row.notion_status) + '）' +
      '\n事業部領域：' + clean(values(row.domains_final).join('／') || '未設定') + '／関連PJ：' + values(row.related_project_ids_final).length + '件' +
      '\n根拠：' + clean(row.reason) + '（確信度 ' + clean(row.confidence) + '）';
    if (/^https:\/\/script\.google\.com\/(?:a\/macros\/[^/]+\/)?s\/[A-Za-z0-9_-]+\/exec$/.test(reviewUrl || '')) body += '\n確認画面：' + reviewUrl;
    else body += '\n確認画面はまだ公開していません。';
    return body + '[/info]';
  }
  return { mergeOptions: mergeOptions, validate: validate, judgement: judgement, safeName: safeName, card: card };
})();


// inboxSchema.generated.js
// schemas/inbox_judgement.schema.jsonから生成します。
var InboxJudgementSchema_ = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "inbox_judgement.schema.json",
  "title": "議事録の判定JSON（_system/inbox/{folder_key}.json）",
  "type": "object",
  "additionalProperties": false,
  "required": ["meeting_key", "source", "scope", "placement", "domains", "related_project_ids", "minutes_title", "confidence", "reason", "sensitive", "summary", "task_proposals", "open_questions"],
  "properties": {
    "meeting_key": { "type": "string", "pattern": "^(meet|tldv):.+$", "description": "manifest.json の meeting_key をそのまま入れる" },
    "source": { "type": "string", "enum": ["meet", "tldv"] },
    "scope": { "type": "string", "enum": ["社内", "社外"] },
    "placement": {
      "type": "string",
      "description": "格納先。社内は 社内/{部署}（部署は8つから）。社外は 社外/{顧客名}。顧客名が ref/masters.json の clients に無いときは末尾に（要確認）を付ける",
      "pattern": "^(社内/(事業部全体|セールス・マーケ|EC|生産管理|経理・バックオフィス|Salesforce・AI|経営)|社外/.+)$"
    },
    "domains": {
      "type": "array",
      "description": "Notion の事業部領域。6つの選択肢の完全一致名だけ",
      "items": { "type": "string", "enum": ["セールス・マーケ", "EC", "生産管理", "経理・バックオフィス", "Salesforce・AI", "経営"] },
      "uniqueItems": true
    },
    "related_project_ids": {
      "type": "array",
      "description": "ref/projects.json にある Notion ページ ID だけ",
      "items": { "type": "string" },
      "uniqueItems": true
    },
    "minutes_title": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2} .+$" },
    "minutes_doc_id": { "type": ["string", "null"], "description": "GENERATOR_MODE=CHATGPT のとき、inbox に作った議事録 Google ドキュメントの ID" },
    "minutes_markdown": { "type": ["string", "null"], "description": "GENERATOR_MODE=OPENAI_API のとき、議事録本文（GAS が Doc にする）" },
    "confidence": { "type": "string", "enum": ["高", "中", "低"] },
    "reason": { "type": "string", "maxLength": 200, "description": "判定の根拠を1文で" },
    "sensitive": { "type": "boolean", "description": "経営・人事・評価・健康など個人に関わる話題を含むか" },
    "summary": {
      "type": "object",
      "additionalProperties": false,
      "required": ["decisions", "next_actions"],
      "properties": {
        "decisions": { "type": "array", "items": { "type": "string" } },
        "next_actions": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["who", "what", "due"],
            "properties": {
              "who": { "type": "string" },
              "what": { "type": "string" },
              "due": { "type": ["string", "null"], "description": "YYYY-MM-DD。不明は null" }
            }
          }
        }
      }
    },
    "task_proposals": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["type", "task_db", "target_id", "title", "requester_email", "assignee_email", "fields", "evidence"],
        "properties": {
          "type": { "type": "string", "enum": ["新規", "更新", "リンク"] },
          "task_db": { "type": "string", "enum": ["プロジェクト", "非プロジェクト"] },
          "target_id": { "type": ["string", "null"], "description": "更新・リンクのときは ref/projects.json のページ ID。新規は null" },
          "title": { "type": "string" },
          "requester_email": { "type": ["string", "null"] },
          "assignee_email": { "type": ["string", "null"] },
          "fields": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "ステータス": { "type": "string", "enum": ["未着手", "保留", "進行中", "対応不要", "完了"] },
              "期日": { "type": ["string", "null"] },
              "備考": { "type": "string" },
              "完了条件": { "type": "string" },
              "親プロジェクトID": { "type": ["string", "null"] },
              "事業部領域": { "type": "array", "items": { "type": "string", "enum": ["セールス・マーケ", "EC", "生産管理", "経理・バックオフィス", "Salesforce・AI", "経営"] } }
            }
          },
          "evidence": { "type": "string", "description": "根拠となる発言の要約" }
        }
      }
    },
    "open_questions": { "type": "array", "items": { "type": "string" }, "description": "聞き取れない箇所・不確かな固有名詞や数字" }
  }
};


// ingestFixturesToNotionTest.js
function ingestFixturesToNotionTest() {
  var env = NotionTestEnvironment_.open(true), lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('別のサンプル取り込みが実行中です。');
  try {
    var minutes = env.schema(env.ids.minutes, 'minutes'), tasks = env.schema(env.ids.tasks, 'tasks');
    var results = [], verifiedProjects = [], requested = new Set();
    NotionFixtures_.judgements.forEach(function (j) { j.related_project_ids.forEach(function (id) { requested.add(id); }); });
    requested.forEach(function (id) { var found = env.project(id); if (found) verifiedProjects.push(found); });
    // 作成前に3件すべてのペイロードを検査します。
    var plans = NotionFixtures_.judgements.map(function (j) {
      var manifest = NotionFixtures_.manifests.find(function (m) { return m.meeting_key === j.meeting_key; });
      if (!manifest) throw new Error('サンプルのmanifestがありません: ' + j.meeting_key);
      return { meetingKey: j.meeting_key, plan: NotionFixturePlan_.plan(j, manifest, NotionFixtures_.masters, minutes, tasks, verifiedProjects) };
    });
    plans.forEach(function (item) {
      var key = 'NOTION_FIXTURE:' + NotionTestEnvironment_.normalize(minutes.databaseId) + ':' + item.meetingKey;
      var saved = env.properties.getProperty(key) || env.properties.getProperty('NOTION_PAGE:' + NotionTestEnvironment_.normalize(minutes.databaseId) + ':' + item.meetingKey), plan = item.plan;
      console.log('判定: ' + item.meetingKey + ' / ' + JSON.stringify(plan.placement));
      plan.warnings.forEach(function (w) { console.log(w); });
      console.log('タスク提案（書き込まない）: ' + JSON.stringify(plan.taskProposals));
      if (saved) {
        var record;
        try { record = JSON.parse(saved); } catch (e) { throw new Error('重複防止記録が不正です。削除せず確認してください: ' + key); }
        var status = record.state === 'created' && record.pageId ? '作成済み・スキップ' : '作成結果未確認・再作成しません';
        console.log(status + ': ' + item.meetingKey + ' / ' + (record.pageId || '実Notionを確認してください。'));
        results.push({ meeting_key: item.meetingKey, status: status, pageId: record.pageId || null });
        return;
      }
      if (env.dryRun) {
        console.log('DRY_RUN・送信予定: ' + JSON.stringify(plan.payload));
        results.push({ meeting_key: item.meetingKey, status: plan.placement.status, dryRun: true });
        return;
      }
      // POST直前に予約を保存。通信中断やID保存失敗後も自動で二重作成しません。
      env.properties.setProperty(key, JSON.stringify({ state: 'pending' }));
      try {
        var page = env.createPage(plan.payload);
        if (!page.id) throw new Error('作成結果にページIDがありません。');
        console.log('作成したページID: ' + item.meetingKey + ' / ' + page.id);
        env.properties.setProperty(key, JSON.stringify({ state: 'created', pageId: page.id }));
        results.push({ meeting_key: item.meetingKey, status: plan.placement.status, pageId: page.id });
      } catch (e) {
        console.log('作成結果を確認してください。自動再作成しません: ' + item.meetingKey + ' / ' + e.message);
        results.push({ meeting_key: item.meetingKey, status: '要対応', error: e.message });
      }
    });
    console.log('サンプル取り込み結果: ' + JSON.stringify(results));
    return results;
  } finally { lock.releaseLock(); }
}


// ingestInbox.js
var InboxIngest_ = (function () {
  function hash(value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(value), Utilities.Charset.UTF_8).map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join(''); }
  function state(row) { return row && row.step_done_json ? JSON.parse(row.step_done_json) : {}; }
  function run() {
    var c = Stage2Drive_.config(), drive = Stage2Drive_.open(c);
    drive.within(c.LEDGER_SPREADSHEET_ID);
    if (c.CHATWORK_TOKEN && (!/^\d+$/.test(c.CHATWORK_ROOM_ID_TEST || '') || c.CHATWORK_ROOM_ID_TEST === c.CHATWORK_ROOM_ID)) throw new Error('Chatworkのテスト専用ルームIDが必要です。');
    var ledger = Stage2Ledger_.open(SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID)), masters = ledger.masters();
    var env = NotionTestEnvironment_.open(true), minutes = env.schema(env.ids.minutes, 'minutes'), tasks = env.schema(env.ids.tasks, 'tasks');
    var inbox = drive.folder(drive.root.id, 'inbox', false), done = drive.folder(inbox.id, '_done', false), raw = drive.folder(drive.root.id, '00_受信', false);
    var rows = ledger.rows('minutes'), files = drive.children(inbox.id).filter(function (f) { return f.name.endsWith('.json'); });
    rows.forEach(function (r) { var s = state(r); if (s.jsonId && !s.finished && !s.error && !files.some(function (f) { return f.id === s.jsonId; })) files.push(drive.within(s.jsonId)); });
    files = files.filter(function (f) { return !rows.some(function (r) { var s = state(r); return s.jsonId === f.id && s.error && s.modifiedTime === f.modifiedTime; }); });
    files.sort(function (a, b) { return String(a.createdTime || '').localeCompare(String(b.createdTime || '')) || a.id.localeCompare(b.id); });
    var results = [], started = Date.now();
    files.slice(0, c.INGEST_BATCH).forEach(function (file) {
      if (Date.now() - started > 240000) return;
      var row = null, steps = {}, key = 'invalid:' + file.id;
      function save() { row.step_done_json = JSON.stringify(steps); ledger.save(row); }
      try {
        var parsed = InboxPlan_.judgement(drive.readJSON(file.id)), j = parsed.data; key = j.meeting_key;
        if ((file.appProperties || {}).meeting_key && file.appProperties.meeting_key !== key) throw new Error('JSONファイルの会議マーカーと内容が一致しません。');
        if (key.length > 180) throw new Error('会議キーが長すぎます。');
        var prior = ledger.rows('minutes').find(function (r) { return r.meeting_key === key; });
        if (prior && state(prior).jsonId !== file.id) throw new Error('同じmeeting_keyの別JSONがあります。既存の行は変更しません。');
        row = prior || null; steps = state(row);
        if (steps.hash && steps.hash !== hash(j)) throw new Error('取り込み中に判定JSONが変更されました。');
        if (steps.finished) { results.push({ meeting_key: key, status: '取り込み済み' }); return; }
        var folder = steps.rawFolderId ? drive.within(steps.rawFolderId) : drive.folder(raw.id, key.replace(/:/g, '_'), false);
        var manifests = steps.manifestId ? [drive.within(steps.manifestId)] : drive.children(folder.id).filter(function (f) { return f.name === 'manifest.json'; });
        if (manifests.length !== 1) throw new Error('manifest.jsonを1件に特定できません。');
        var manifest = drive.readJSON(manifests[0].id);
        if (manifest.status !== 'ready' || manifest.meeting_key !== key || manifest.source !== j.source || !Number.isFinite(Date.parse(manifest.start))) throw new Error('manifestの状態・会議キー・日時が不正です。');
        var allowedKinds = ['recording', 'transcript', 'gemini', 'tldv_transcript'], rawFiles = [];
        Object.keys(manifest.files || {}).forEach(function (kind) {
          if (!allowedKinds.includes(kind)) throw new Error('manifestに未定義のファイル種別があります。');
          if (manifest.source === 'tldv' && kind === 'recording') { console.log('tl;dvの録画は管理対象外のため移動しません。'); return; }
          var f = drive.within(manifest.files[kind]);
          if ((f.appProperties || {}).meeting_key && f.appProperties.meeting_key !== key) throw new Error('生データの会議マーカーが違います。');
          if (f.mimeType === 'application/vnd.google-apps.folder' || !(f.parents || []).some(function (p) { return p === folder.id || row && p === row.meeting_folder_id; })) throw new Error('生データが会議の受信・格納フォルダ内にありません。');
          rawFiles.push({ id: f.id, kind: kind });
        });
        var docId = steps.minutesDocId || j.minutes_doc_id, blocks;
        if (docId) {
          var doc = drive.within(docId);
          if ((doc.appProperties || {}).meeting_key && doc.appProperties.meeting_key !== key) throw new Error('議事録Docの会議マーカーが違います。');
          if (doc.mimeType !== 'application/vnd.google-apps.document' || !(doc.parents || []).some(function (p) { return p === inbox.id || row && p === row.meeting_folder_id; })) throw new Error('議事録Docがinbox・格納フォルダ内にありません。');
          blocks = Stage2Content_.read(docId);
        } else if (j.minutes_markdown) blocks = Stage2Content_.blocks(j.minutes_markdown.split('\n').map(function (text) { return { type: 'paragraph', text: text }; }));
        else throw new Error('議事録Docまたはminutes_markdownが必要です。');
        if (!blocks.length) throw new Error('議事録本文が空です。');
        if (steps.contentHash && steps.contentHash !== hash(blocks)) throw new Error('取り込み中に議事録本文が変更されました。');
        var projects = j.related_project_ids.map(function (id) { return env.project(id); }).filter(Boolean);
        var plan = NotionFixturePlan_.plan(j, manifest, masters, minutes, tasks, projects); plan.payload.children = blocks;
        var destination = plan.placement.placement === '00_仕分け待ち' ? drive.folder(drive.root.id, '00_仕分け待ち', false).id : (masters.folders.find(function (f) { return f.placement === plan.placement.placement; }) || {}).drive_folder_id;
        if (!destination) throw new Error('格納先フォルダIDがマスタにありません。');
        if (drive.within(destination).mimeType !== 'application/vnd.google-apps.folder') throw new Error('格納先がフォルダではありません。');
        var registryKey = 'NOTION_PAGE:' + NotionTestEnvironment_.normalize(minutes.databaseId) + ':' + key;
        var fixtureKey = 'NOTION_FIXTURE:' + NotionTestEnvironment_.normalize(minutes.databaseId) + ':' + key;
        var recordText = env.properties.getProperty(registryKey) || env.properties.getProperty(fixtureKey), record = recordText ? JSON.parse(recordText) : null;
        if (record && record.state === 'created' && record.pageId) env.verifyMinutesPage(record.pageId);
        parsed.warnings.concat(plan.warnings).forEach(function (w) { console.log(w); });
        console.log('タスク提案（書き込まない）: ' + JSON.stringify(j.task_proposals));
        if (c.DRY_RUN === 'true') {
          var planned = { meeting_key: key, status: plan.placement.status, display_id: row ? row.display_id : '採番予定', event_start: manifest.start, event_end: manifest.end, source: j.source, confidence: j.confidence, domains_final: JSON.stringify(plan.placement.domains), related_project_ids_final: JSON.stringify(plan.placement.related_project_ids), title: manifest.title, placement_final: plan.placement.placement, minutes_title: j.minutes_title, notion_status: record && record.pageId ? '既存ページ再利用' : '作成予定', reason: j.reason };
          console.log('取り込み予定: ' + JSON.stringify(planned)); console.log('Notion送信予定: ' + JSON.stringify(plan.payload));
          ledger.log('inbox取り込み予定', key, { row: planned, notion: plan.payload });
          var card = InboxPlan_.card(planned, c.WEBAPP_URL); console.log('Chatwork投稿予定: ' + card); ledger.log('Chatwork投稿予定', key, card);
          results.push({ meeting_key: key, status: plan.placement.status, dryRun: true }); return;
        }
        if (!row) {
          row = { meeting_key: key, display_id: ledger.displayId(manifest.start), source: j.source, event_id: manifest.event_id || '', event_start: manifest.start, event_end: manifest.end || '', title: manifest.title,
            organizer_email: manifest.organizer_email || '', attendees_json: JSON.stringify(manifest.attendees || []), scope_auto: plan.placement.rule.scope || '', scope_final: j.scope,
            placement_auto: j.placement, placement_final: plan.placement.placement, domains_auto: JSON.stringify(j.domains), domains_final: JSON.stringify(plan.payload.properties['事業部領域'].multi_select.map(function (v) { return v.name; })),
            related_project_ids_auto: JSON.stringify(j.related_project_ids), related_project_ids_final: JSON.stringify(plan.placement.related_project_ids), minutes_title: j.minutes_title,
            confidence: j.confidence, reason: j.reason, sensitive: j.sensitive, conflict: plan.placement.conflicts.length > 0, status: plan.placement.status,
            notion_status: '未処理', raw_file_ids_json: JSON.stringify(manifest.files || {}), created_at: new Date().toISOString(), last_error: parsed.warnings.concat(plan.warnings).join(' ') };
          steps = { jsonId: file.id, rawFolderId: folder.id, manifestId: manifests[0].id, hash: hash(j), contentHash: hash(blocks), modifiedTime: file.modifiedTime };
          save();
        }
        steps.error = false; row.status = plan.placement.status;
        if (!row.meeting_folder_id) {
          var name = Utilities.formatDate(new Date(manifest.start), 'Asia/Tokyo', 'yyyy-MM-dd_HHmm') + '_' + InboxPlan_.safeName(manifest.title);
          var meetingFolder = drive.folder(destination, name, true, key); row.meeting_folder_id = meetingFolder.id; row.folder_id_final = destination; save();
        }
        if (!docId) {
          var existingDocs = drive.children(inbox.id).filter(function (f) { return f.mimeType === 'application/vnd.google-apps.document' && (f.appProperties || {}).meeting_key === key && f.appProperties.kind === 'minutes'; });
          if (existingDocs.length > 1) throw new Error('作成途中の議事録Docが複数あります。');
          docId = existingDocs.length ? existingDocs[0].id : drive.createFile(inbox.id, key.replace(/:/g, '_') + '_議事録', Stage2Content_.html(j.minutes_markdown), 'application/vnd.google-apps.document', 'minutes', key).id;
        }
        steps.minutesDocId = docId; row.minutes_doc_id = docId; save();
        if (!steps.moved) {
          rawFiles.forEach(function (f) { drive.move(f.id, row.meeting_folder_id, f.kind, key); });
          drive.move(docId, row.meeting_folder_id, 'minutes', key); drive.move(manifests[0].id, row.meeting_folder_id, 'manifest', key);
          steps.moved = true; save();
        }
        if (!row.notion_page_id && record && record.state === 'created' && record.pageId) {
          row.notion_page_id = record.pageId; steps.notionComplete = true; steps.reusedPage = true; row.notion_status = '作成済み（再利用）'; save();
        }
        if (!row.notion_page_id) {
          if (record && record.state === 'pending' || steps.notion === 'pending') throw new Error('Notion作成結果が不明です。記録を消さず、実Notionを確認してください。');
          steps.notion = 'pending'; env.properties.setProperty(registryKey, JSON.stringify({ state: 'pending' })); save();
          try {
            var payload = Object.assign({}, plan.payload, { children: blocks.slice(0, 100) }), page = env.createPage(payload);
            if (!page.id) throw new Error('Notion作成結果にページIDがありません。');
            console.log('作成したNotionページ: ' + key + ' / ' + page.id);
            row.notion_page_id = page.id; steps.notion = 'created'; steps.nextBlock = Math.min(100, blocks.length); save();
            env.properties.setProperty(registryKey, JSON.stringify({ state: 'created', pageId: page.id }));
          } catch (e) {
            if (e.httpStatus !== 403) throw e;
            env.properties.setProperty(registryKey, JSON.stringify({ state: 'rejected', httpStatus: 403 }));
            steps.notion = 'rejected'; row.notion_status = 'Notion保留'; row.last_error = e.message; save();
          }
        }
        if (row.notion_page_id && !steps.notionComplete) {
          env.verifyMinutesPage(row.notion_page_id);
          if (steps.appendPending) throw new Error('本文追加の結果が不明です。二重追記しません。');
          while (steps.nextBlock < blocks.length) {
            if (Date.now() - started > 240000) { save(); results.push({ meeting_key: key, status: '本文追加の続き待ち' }); return; }
            steps.appendPending = true; save();
            try { env.appendBlocks(row.notion_page_id, blocks.slice(steps.nextBlock, steps.nextBlock + 100)); }
            catch (e) { if (e.httpStatus === 403) { steps.appendPending = false; row.notion_status = 'Notion保留'; save(); } throw e; }
            steps.nextBlock += Math.min(100, blocks.length - steps.nextBlock); steps.appendPending = false; save();
          }
          steps.notionComplete = true; row.notion_status = '作成済み'; save();
        }
        if (!c.CHATWORK_TOKEN && (!steps.chatwork || steps.chatwork === 'log_only')) {
          var plannedCard = InboxPlan_.card(row, c.WEBAPP_URL);
          if (steps.cardHash !== hash(plannedCard)) { console.log('Chatwork投稿予定（トークン未設定）: ' + plannedCard); ledger.log('Chatwork投稿予定（トークン未設定）', key, plannedCard); steps.cardHash = hash(plannedCard); }
          steps.chatwork = 'log_only'; save();
        } else if (!steps.chatwork) {
          var body = InboxPlan_.card(row, c.WEBAPP_URL);
          if (!c.CHATWORK_TOKEN) {
            console.log('Chatwork投稿予定（トークン未設定）: ' + body); ledger.log('Chatwork投稿予定（トークン未設定）', key, body); steps.chatwork = 'log_only'; save();
          } else {
            steps.chatwork = 'pending'; save();
            var response = UrlFetchApp.fetch('https://api.chatwork.com/v2/rooms/' + c.CHATWORK_ROOM_ID_TEST + '/messages', { method: 'post', headers: { 'X-ChatWorkToken': c.CHATWORK_TOKEN }, payload: { body: body, self_unread: '0' }, muteHttpExceptions: true });
            if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error('Chatwork投稿: HTTP ' + response.getResponseCode());
            var sent = JSON.parse(response.getContentText()); if (!sent.message_id) throw new Error('ChatworkのメッセージIDがありません。');
            row.chatwork_message_id = sent.message_id; steps.chatwork = 'sent'; save();
          }
        } else if (steps.chatwork === 'pending') throw new Error('Chatwork投稿結果が不明です。二重投稿しません。');
        if (!steps.jsonDone) { drive.move(file.id, done.id, 'judgement', key); steps.jsonDone = true; save(); }
        if (!steps.rawDone) {
          if (!drive.children(folder.id).length) {
            var excluded = drive.folder(drive.root.id, '99_対象外', false), empty = drive.folder(excluded.id, '_空', false); drive.move(folder.id, empty.id, '', key);
          } else console.log('受信フォルダに追加ファイルが残るため移動しません: ' + key);
          steps.rawDone = true; save();
        }
        if (!ledger.rows('change_log').some(function (r) { return r.change_id === 'ingest:' + key; })) ledger.append('change_log', { change_id: 'ingest:' + key, at: new Date().toISOString(), meeting_key: key, kind: '取り込み', target: row.meeting_folder_id, after_json: JSON.stringify({ status: row.status, notion_status: row.notion_status }), actor: 'GAS-A（テスト）', result: '完了' });
        steps.finished = !!steps.notionComplete; save(); results.push({ meeting_key: key, status: row.status, notion_status: row.notion_status, pageId: row.notion_page_id || null });
      } catch (e) {
        var message = String(e.message || '不明なエラー');
        [c.NOTION_TOKEN, c.CHATWORK_TOKEN].filter(Boolean).forEach(function (secret) { message = message.split(secret).join('[非表示]'); });
        console.log('取り込みエラー: ' + key + ' / ' + message); ledger.log('取り込みエラー', key, message);
        if (c.DRY_RUN === 'false') {
          if (!row) row = ledger.rows('minutes').find(function (r) { return r.meeting_key === 'invalid:' + file.id; }) || { meeting_key: 'invalid:' + file.id, created_at: new Date().toISOString() };
          steps.error = true; steps.jsonId = file.id; steps.modifiedTime = file.modifiedTime; row.status = '要対応'; row.last_error = message; save();
        }
        results.push({ meeting_key: key, status: '要対応', error: message });
      }
    });
    console.log('inbox取り込み結果: ' + JSON.stringify(results)); return results;
  }
  return { run: run };
})();

function ingestInbox() { return Ledger_.withLock(InboxIngest_.run); }

function retryInboxErrors() {
  return Ledger_.withLock(function () {
    var c = Stage2Drive_.config(), drive = Stage2Drive_.open(c); drive.within(c.LEDGER_SPREADSHEET_ID);
    var ledger = Stage2Ledger_.open(SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID));
    ledger.rows('minutes').forEach(function (r) {
      if (!r.step_done_json) return; var steps = JSON.parse(r.step_done_json);
      if (steps.error) { console.log('再検査予定: ' + r.meeting_key); if (c.DRY_RUN === 'false') { steps.error = false; r.step_done_json = JSON.stringify(steps); ledger.save(r); } }
    });
  });
}


// ledger.js
var Ledger_ = (function () {
  var headers = {
    minutes: 'meeting_key,display_id,source,event_id,event_start,event_end,title,organizer_email,attendees_json,scope_auto,scope_final,placement_auto,placement_final,folder_id_final,domains_auto,domains_final,related_project_ids_auto,related_project_ids_final,minutes_title,minutes_doc_id,raw_file_ids_json,meeting_folder_id,confidence,reason,sensitive,conflict,status,notion_page_id,notion_status,chatwork_message_id,reviewer_email,version,created_at,updated_at,confirmed_by,confirmed_at,step_done_json,last_error',
    task_proposals: 'proposal_id,meeting_key,seq,type,task_db,target_notion_id,title,before_json,after_json,requester_email,assignee_email,evidence,decision,decided_by,decided_at,applied_at,result,applied_page_id,applied_block_ids_json',
    change_log: 'change_id,at,meeting_key,kind,target,before_json,after_json,actor,result,revert_of',
    masters_folders: 'placement,drive_folder_id,notion_domain,rank',
    masters_clients: 'client_name,domains,drive_folder_id,created_by,created_at',
    masters_internal: 'email_or_domain,note',
    masters_people: 'name,google_email,alt_emails,notion_user_id,chatwork_account_id,domains,is_reviewer,is_admin',
    organizers: 'email,registered_at,trigger_id,last_run_at,last_result',
    settings: 'key,value,note', dry_run_log: 'at,action,target,payload_summary'
  };
  function withLock(fn) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new Error('別の処理が実行中です。後でもう一度実行してください。');
    try { return fn(); } finally { lock.releaseLock(); }
  }
  function checkHeaders(sheet, name) {
    var expected = headers[name].split(',');
    if (sheet.getLastRow() > 0) {
      var actual = sheet.getRange(1, 1, 1, Math.max(expected.length, sheet.getLastColumn())).getValues()[0];
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(name + ' の見出しが仕様と異なります。上書きしません。');
    }
    return expected;
  }
  function plan(book) {
    return Object.keys(headers).map(function (name) {
      var sheet = book.getSheetByName(name);
      if (sheet) checkHeaders(sheet, name);
      return { sheet: name, action: !sheet ? 'シート作成' : sheet.getLastRow() === 0 ? '見出し追加' : '変更なし', headers: headers[name].split(',') };
    });
  }
  function dryLog(book, action, target, summary) {
    var sheet = book.getSheetByName('dry_run_log');
    if (sheet) checkHeaders(sheet, 'dry_run_log');
    else sheet = book.insertSheet('dry_run_log');
    if (!sheet.getLastRow()) sheet.appendRow(headers.dry_run_log.split(','));
    sheet.appendRow([Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX"), action, target, summary]);
  }
  return { headers: headers, withLock: withLock, plan: plan, dryLog: dryLog };
})();


// meetingRules.js
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


// notionClient.js
var Notion_ = (function () {
  // 公式SDKのデータソースAPIに合わせ、読み取りだけを実装します。
  function get(path, c) {
    var response = UrlFetchApp.fetch('https://api.notion.com/v1/' + path, {
      method: 'get', headers: { Authorization: 'Bearer ' + c.NOTION_TOKEN, 'Notion-Version': c.NOTION_VERSION },
      muteHttpExceptions: true
    });
    var status = response.getResponseCode();
    // 応答本文は認証情報やデータを含む可能性があるためログに出しません。
    if (status < 200 || status >= 300) throw new Error('Notion の読み取りに失敗しました。HTTP ' + status);
    return JSON.parse(response.getContentText());
  }
  function schema(databaseId, c) {
    var db = get('databases/' + encodeURIComponent(databaseId), c);
    if (db.properties) return { database_id: databaseId, properties: db.properties };
    if (!db.data_sources || db.data_sources.length !== 1) throw new Error('データソースが複数または未設定です。対象を確認してください。');
    var ds = get('data_sources/' + encodeURIComponent(db.data_sources[0].id), c);
    if (!ds.properties) throw new Error('Notion のプロパティを取得できませんでした。');
    return { database_id: databaseId, data_source_id: ds.id, properties: ds.properties };
  }
  return { schema: schema };
})();


// notionFixturePlan.js
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
      if (key === 'tasks' && ['関連プロジェクト（参照元）', 'サブアイテム', '関連プロジェクト'].includes(name)) knownAdditions.push({ name: name, type: properties[name].type });
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
    if (normalize(relation.data_source_id) !== normalize(tasks.sourceId)) throw new Error('関連するプロジェクトがテスト用タスクDBを参照していません。');
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


// notionFixtures.generated.js
// scripts/bundle.cjs でfixturesから生成します。手で変更しないでください。
var NotionFixtures_ = {
  "judgements": [
    {
      "meeting_key": "meet:test001_20261021T020000Z",
      "source": "meet",
      "scope": "社内",
      "placement": "社内/Salesforce・AI",
      "domains": [
        "Salesforce・AI"
      ],
      "related_project_ids": [
        "00000000-0000-0000-0000-000000000001"
      ],
      "minutes_title": "2026-10-21 議事録運用 打ち合わせ",
      "minutes_doc_id": "DOC_ID_TEST_001",
      "minutes_markdown": null,
      "confidence": "高",
      "reason": "参加者が全員社内で、議題が議事録自動化の運用設計だった",
      "sensitive": false,
      "summary": {
        "decisions": [
          "録画は Google Meet を優先し、相手主催の会議だけ tl;dv を使う"
        ],
        "next_actions": [
          {
            "who": "テスト 太郎",
            "what": "共有ドライブ「MTG記録」を作成する",
            "due": "2026-10-23"
          }
        ]
      },
      "task_proposals": [
        {
          "type": "新規",
          "task_db": "プロジェクト",
          "target_id": null,
          "title": "共有ドライブ「MTG記録」を作成する",
          "requester_email": "test.hanako@premiere-mode.co.jp",
          "assignee_email": "test.taro@premiere-mode.co.jp",
          "fields": {
            "ステータス": "未着手",
            "期日": "2026-10-23",
            "備考": "",
            "完了条件": "7部署のフォルダがそろっている",
            "親プロジェクトID": "00000000-0000-0000-0000-000000000001",
            "事業部領域": [
              "Salesforce・AI"
            ]
          },
          "evidence": "テスト太郎さん：今週中にドライブを作ります"
        }
      ],
      "open_questions": []
    },
    {
      "meeting_key": "meet:test002_20261021T050000Z",
      "source": "meet",
      "scope": "社外",
      "placement": "社外/サンプル商事様",
      "domains": [
        "セールス・マーケ"
      ],
      "related_project_ids": [],
      "minutes_title": "2026-10-21 サンプル商事様 定例",
      "minutes_doc_id": "DOC_ID_TEST_002",
      "minutes_markdown": null,
      "confidence": "高",
      "reason": "社外参加者のドメイン sample-shoji.example が顧客一覧のサンプル商事様と一致",
      "sensitive": false,
      "summary": {
        "decisions": [
          "次回は11月第1週に開催する"
        ],
        "next_actions": [
          {
            "who": "テスト 花子",
            "what": "見積書を送付する",
            "due": null
          }
        ]
      },
      "task_proposals": [
        {
          "type": "新規",
          "task_db": "非プロジェクト",
          "target_id": null,
          "title": "サンプル商事様へ見積書を送付する",
          "requester_email": null,
          "assignee_email": "test.hanako@premiere-mode.co.jp",
          "fields": {
            "ステータス": "未着手",
            "期日": null,
            "備考": "期日：要確認",
            "完了条件": "",
            "親プロジェクトID": null,
            "事業部領域": [
              "セールス・マーケ"
            ]
          },
          "evidence": "テスト花子さん：見積を出します"
        }
      ],
      "open_questions": [
        "見積書の送付期日"
      ]
    },
    {
      "meeting_key": "tldv:tldvtest003",
      "source": "tldv",
      "scope": "社外",
      "placement": "社外/未登録株式会社（要確認）",
      "domains": [
        "EC"
      ],
      "related_project_ids": [],
      "minutes_title": "2026-10-21 新規取引の相談",
      "minutes_doc_id": "DOC_ID_TEST_003",
      "minutes_markdown": null,
      "confidence": "低",
      "reason": "社名が文字起こしにしか出ず、顧客一覧に無い",
      "sensitive": false,
      "summary": {
        "decisions": [],
        "next_actions": []
      },
      "task_proposals": [],
      "open_questions": [
        "先方の社名の表記",
        "参加者の氏名"
      ]
    }
  ],
  "masters": {
    "folders": [
      {
        "placement": "社内/事業部全体",
        "notion_domain": null
      },
      {
        "placement": "社内/セールス・マーケ",
        "notion_domain": "セールス・マーケ"
      },
      {
        "placement": "社内/EC",
        "notion_domain": "EC"
      },
      {
        "placement": "社内/生産管理",
        "notion_domain": "生産管理"
      },
      {
        "placement": "社内/経理・バックオフィス",
        "notion_domain": "経理・バックオフィス"
      },
      {
        "placement": "社内/Salesforce・AI",
        "notion_domain": "Salesforce・AI"
      },
      {
        "placement": "社内/経営",
        "notion_domain": "経営"
      }
    ],
    "clients": [
      {
        "client_name": "サンプル商事様",
        "domains": [
          "sample-shoji.example"
        ]
      }
    ],
    "internal": [
      "premiere-mode.co.jp",
      "test.private@gmail.com"
    ],
    "people": [
      {
        "name": "テスト 太郎",
        "google_email": "test.taro@premiere-mode.co.jp",
        "notion_user_id": null,
        "chatwork_account_id": null,
        "is_reviewer": true
      },
      {
        "name": "テスト 花子",
        "google_email": "test.hanako@premiere-mode.co.jp",
        "notion_user_id": null,
        "chatwork_account_id": null,
        "is_reviewer": true
      }
    ]
  },
  "manifests": [
    {
      "meeting_key": "meet:test002_20261021T050000Z",
      "source": "meet",
      "event_id": "test002_20261021T050000Z",
      "title": "サンプル商事様 定例",
      "start": "2026-10-21T14:00:00+09:00",
      "end": "2026-10-21T15:00:00+09:00",
      "organizer_email": "test.hanako@premiere-mode.co.jp",
      "attendees": [
        {
          "email": "test.hanako@premiere-mode.co.jp",
          "name": "テスト 花子"
        },
        {
          "email": "yamada@sample-shoji.example",
          "name": "山田"
        }
      ],
      "meet_url": "https://meet.google.com/aaa-bbbb-ccc",
      "files": {
        "recording": "FILE_REC",
        "transcript": "FILE_TR",
        "gemini": "FILE_GM"
      },
      "missing": [],
      "status": "ready",
      "created_at": "2026-10-21T15:25:00+09:00"
    },
    {
      "meeting_key": "meet:test001_20261021T020000Z",
      "source": "meet",
      "event_id": "test001_20261021T020000Z",
      "title": "議事録運用 打ち合わせ",
      "start": "2026-10-21T11:00:00+09:00",
      "end": "2026-10-21T12:00:00+09:00",
      "organizer_email": "test.taro@premiere-mode.co.jp",
      "attendees": [
        {
          "email": "test.taro@premiere-mode.co.jp",
          "name": "テスト 太郎"
        },
        {
          "email": "test.hanako@premiere-mode.co.jp",
          "name": "テスト 花子"
        }
      ],
      "meet_url": "https://meet.google.com/aaa-bbbb-ccc",
      "files": {},
      "missing": [],
      "status": "ready",
      "created_at": "2026-10-21T12:25:00+09:00"
    },
    {
      "meeting_key": "tldv:tldvtest003",
      "source": "tldv",
      "title": "新規取引の相談",
      "start": "2026-10-21T16:00:00+09:00",
      "end": "2026-10-21T16:40:00+09:00",
      "attendees": [
        {
          "email": "test.taro@premiere-mode.co.jp",
          "name": "テスト 太郎"
        },
        {
          "name": "先方担当"
        }
      ],
      "files": {},
      "status": "ready"
    }
  ]
};


// notionTestEnvironment.js
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
    var verified = {}, allowedPages = new Set(), inboxPatch = null;
    function request(method, path, body, optionalStatuses) {
      if (method !== 'get') {
        var create = method === 'post' && path === 'pages' && verified.minutes && verified.tasks && body.parent && body.parent.type === 'data_source_id' && normalize(body.parent.data_source_id) === normalize(verified.minutes.sourceId);
        var append = /^blocks\/([^/]+)\/children$/.exec(path);
        var appendAllowed = method === 'patch' && append && allowedPages.has(normalize(append[1])) && body.children && body.children.length <= 100;
        var optionAllowed = purpose === 'inbox-options' && inboxPatch && method === 'patch' && path === inboxPatch.path && JSON.stringify(body) === inboxPatch.body;
        if (!writingWorkflow || dryRun !== 'false' || !(create || appendAllowed || optionAllowed)) throw new Error('確認済みテスト対象以外への書き込みは禁止です。');
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
        var error = new Error('Notionテスト接続: HTTP ' + status + ' / ' + String(data.code || '不明')); error.httpStatus = status; throw error;
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
    function verifyMinutesPage(id) {
      var page = request('get', 'pages/' + encodeURIComponent(id));
      if (!verified.minutes || page.archived || page.in_trash || !page.parent || !(page.parent.type === 'data_source_id' && normalize(page.parent.data_source_id) === normalize(verified.minutes.sourceId) || page.parent.type === 'database_id' && normalize(page.parent.database_id) === normalize(ids.minutes))) throw new Error('記録済みページがテスト議事録DBに属していません。');
      allowedPages.add(normalize(page.id)); return page;
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
      ids: { minutes: ids.minutes, tasks: ids.tasks } };
  }
  return { open: open, normalize: normalize };
})();

function checkTestEnvironment() {
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

function addTldvInboxStatusOptions() { return Ledger_.withLock(function () { return NotionTestEnvironment_.open(true, 'inbox-options').addInboxOptions(); }); }


// setup.js
function dumpNotionSchemas() {
  var c = Config_.assertSafe('notion');
  var keys = ['NOTION_DB_MINUTES_TEST', 'NOTION_DB_TASKS_TEST', 'NOTION_DB_TLDV_INBOX'];
  if (c.TASK_DB_MODE === 'dual') keys.push('NOTION_DB_NONPROJECT_TEST');
  var result = keys.map(function (key) {
    var schema = Notion_.schema(c[key], c);
    var properties = Object.keys(schema.properties).map(function (name) { return { name: name, type: schema.properties[name].type }; });
    // 認証情報・本文・参加者は出力せず、設定照合に必要なスキーマだけを返します。
    var expected = key === 'NOTION_DB_MINUTES_TEST' ? {
      '議事録名': ['title'], '日付': ['date'], '参加者': ['people'], 'MTG URL': ['url'],
      '事業部領域': ['multi_select'], '関連するプロジェクト': ['relation']
    } : key === 'NOTION_DB_TLDV_INBOX' ? { '取り込み状態': ['select'], 'meeting_key': ['rich_text'] } : {
      'プロジェクト/タスク名': ['title'], 'ステータス': ['status', 'select'], '期日': ['date'],
      '担当者': ['people'], '備考': ['rich_text'], '完了条件': ['rich_text'],
      '事業部領域': ['multi_select'], '関連するMTG': ['relation'], '親アイテム': ['relation']
    };
    var differences = Object.keys(expected).filter(function (name) {
      return !schema.properties[name] || !expected[name].includes(schema.properties[name].type);
    }).map(function (name) { return { name: name, expected: expected[name], actual: schema.properties[name] ? schema.properties[name].type : '未設定' }; });
    return { config_key: key, data_source_id: schema.data_source_id || null, properties: properties, differences: differences };
  });
  console.log(JSON.stringify(result));
  return result;
}

function initLedger() {
  var c = Config_.assertSafe();
  DriveUtil_.verifyTestRoot(c);
  return Ledger_.withLock(function () {
    var book = SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID);
    var plan = Ledger_.plan(book);
    // DRY_RUN中の例外は仕様で認められた dry_run_log への記録だけです。
    Ledger_.dryLog(book, '台帳初期化の計画', 'テスト用台帳', JSON.stringify(plan));
    console.log('台帳初期化の計画を記録しました。業務用シートは変更していません。');
    return { applied: false, plan: plan };
  });
}

function registerFolders() {
  var c = Config_.assertSafe();
  var root = DriveUtil_.verifyTestRoot(c);
  var internal = DriveUtil_.exact(root.id, '社内', c.SHARED_DRIVE_ID);
  var external = DriveUtil_.exact(root.id, '社外', c.SHARED_DRIVE_ID);
  var rows = [];
  ['事業部全体', 'セールス・マーケ', 'EC', '生産管理', '経理・バックオフィス', 'Salesforce・AI', '経営'].forEach(function (name) {
    var folder = DriveUtil_.exact(internal.id, name, c.SHARED_DRIVE_ID);
    rows.push({ placement: '社内/' + name, drive_folder_id: folder.id, notion_domain: name === '事業部全体' ? '' : name, rank: '' });
  });
  // 顧客は台帳マスタに存在する名前だけに限定し、フォルダは作りません。
  var book = SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID);
  var sheet = book.getSheetByName('masters_clients');
  if (!sheet || !sheet.getLastRow()) throw new Error('顧客マスタが未準備です。テスト用台帳を準備してください。');
  if (JSON.stringify(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]) !== JSON.stringify(Ledger_.headers.masters_clients.split(','))) throw new Error('顧客マスタの見出しを確認してください。');
  var clients = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues() : [];
  clients.forEach(function (r) {
    if (!r[0]) return;
    var f = DriveUtil_.exact(external.id, String(r[0]).replace(/\//g, '・'), c.SHARED_DRIVE_ID);
    rows.push({ placement: '社外/' + r[0], drive_folder_id: f.id, notion_domain: '', rank: '' });
  });
  return Ledger_.withLock(function () {
    Ledger_.dryLog(book, 'フォルダ登録の計画', 'masters_folders', JSON.stringify(rows));
    return { applied: false, rows: rows };
  });
}


// setupTestDatabases.js
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


// stage2Content.js
var Stage2Content_ = (function () {
  function clean(value) { return String(value || '').replace(/https?:\/\/[^\s<>]+/gi, '（URL省略）'); }
  function rich(value) {
    var chars = Array.from(clean(value)), result = [];
    for (var i = 0; i < chars.length; i += 1000) result.push({ type: 'text', text: { content: chars.slice(i, i + 1000).join('') } });
    if (result.length > 100) throw new Error('本文の1段落が長すぎます。');
    return result;
  }
  function blocks(elements) {
    var result = [];
    elements.forEach(function (e) {
      if (e.type === 'table') {
        if (!e.rows.length) return;
        var width = e.rows[0].length;
        if (!width || e.rows.some(function (r) { return r.length !== width; })) throw new Error('表の列数が不正です。');
        for (var i = 0; i < e.rows.length; i += 100) result.push({ object: 'block', type: 'table', table: {
          table_width: width, has_column_header: true, has_row_header: false,
          children: e.rows.slice(i, i + 100).map(function (r) { return { object: 'block', type: 'table_row', table_row: { cells: r.map(rich) } }; })
        } });
      } else {
        var type = ['heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item'].includes(e.type) ? e.type : 'paragraph';
        if (!e.text) return;
        var b = { object: 'block', type: type }; b[type] = { rich_text: rich(e.text) }; result.push(b);
      }
    });
    for (var offset = 0; offset < result.length; offset += 100) {
      if (JSON.stringify(result.slice(offset, offset + 100)).length * 3 > 450000) throw new Error('本文がNotionのリクエスト上限に近いため処理を止めました。');
    }
    return result;
  }
  function read(id) {
    var body = DocumentApp.openById(id).getBody(), elements = [];
    for (var i = 0; i < body.getNumChildren(); i++) {
      var child = body.getChild(i), type = String(child.getType());
      if (type === 'TABLE') {
        var table = child.asTable(), rows = [];
        for (var r = 0; r < table.getNumRows(); r++) {
          var row = table.getRow(r), cells = [];
          for (var c = 0; c < row.getNumCells(); c++) cells.push(row.getCell(c).getText());
          rows.push(cells);
        }
        elements.push({ type: 'table', rows: rows });
      } else if (type === 'PARAGRAPH') {
        var paragraph = child.asParagraph(), heading = String(paragraph.getHeading());
        elements.push({ type: heading === 'HEADING2' || heading === 'HEADING1' ? 'heading_2' : heading === 'HEADING3' ? 'heading_3' : 'paragraph', text: paragraph.getText() });
      } else if (type === 'LIST_ITEM') {
        var item = child.asListItem(); elements.push({ type: /NUMBER|LATIN|ROMAN/.test(String(item.getGlyphType())) ? 'numbered_list_item' : 'bulleted_list_item', text: item.getText() });
      } else throw new Error('未対応の議事録要素があります: ' + type);
    }
    return blocks(elements);
  }
  function html(text) { return '<html><body><p>' + String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '</p><p>') + '</p></body></html>'; }
  return { blocks: blocks, read: read, html: html };
})();

function seedFixtureInbox() {
  return Ledger_.withLock(function () {
    var c = Stage2Drive_.config(), drive = Stage2Drive_.open(c);
    drive.within(c.LEDGER_SPREADSHEET_ID);
    var ledger = Stage2Ledger_.open(SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID));
    if (c.DRY_RUN === 'true') { ledger.log('サンプル準備予定', 'inbox', '判定JSON・manifest・議事録Doc・ダミー文字起こしを3件準備します。'); return; }
    var raw = drive.folder(drive.root.id, '00_受信', false), inbox = drive.folder(drive.root.id, 'inbox', false), done = drive.folder(inbox.id, '_done', false);
    function ensure(parent, name, text, mime, kind, key) {
      var matches = drive.children(parent).filter(function (f) { return f.name === name; });
      if (matches.length > 1) throw new Error('同名サンプルが複数あります: ' + name);
      if (matches.length && (matches[0].appProperties || {}).meeting_key !== key) throw new Error('既存ファイルは上書きしません: ' + name);
      return matches[0] || drive.createFile(parent, name, text, mime, kind, key);
    }
    NotionFixtures_.judgements.forEach(function (original) {
      var j = JSON.parse(JSON.stringify(original)), key = j.meeting_key, folderKey = key.replace(/:/g, '_');
      if (ledger.rows('minutes').some(function (r) { return r.meeting_key === key; }) || drive.children(done.id).some(function (f) { return f.name === folderKey + '.json'; })) { console.log('準備済み・処理済みのサンプルは再投入しません: ' + key); return; }
      var folder = drive.folder(raw.id, folderKey, true), manifest = JSON.parse(JSON.stringify(NotionFixtures_.manifests.find(function (m) { return m.meeting_key === key; })));
      var text = '基本情報\n' + manifest.title + '\n決定事項\n' + j.summary.decisions.join('\n') + '\nネクストアクション\n' + j.summary.next_actions.map(function (a) { return a.who + '／' + a.what + '／' + (a.due || '期日：要確認'); }).join('\n');
      var minutes = ensure(inbox.id, folderKey + '_議事録', Stage2Content_.html(text), 'application/vnd.google-apps.document', 'minutes', key);
      var kind = manifest.source === 'tldv' ? 'tldv_transcript' : 'transcript';
      var transcript = ensure(folder.id, '文字起こし（検証用ダミー）', Stage2Content_.html('これは検証専用のダミー文字起こしです。\n' + text), 'application/vnd.google-apps.document', kind, key);
      manifest.files = {}; manifest.files[kind] = transcript.id; manifest.missing = manifest.source === 'meet' ? ['recording', 'gemini'] : [];
      ensure(folder.id, 'manifest.json', JSON.stringify(manifest), 'application/json', 'manifest', key);
      j.minutes_doc_id = minutes.id;
      ensure(inbox.id, folderKey + '.json', JSON.stringify(j), 'application/json', 'judgement', key);
      console.log('サンプルを準備しました: ' + key);
    });
  });
}


// stage2Drive.js
var Stage2Drive_ = (function () {
  var folderMime = 'application/vnd.google-apps.folder';
  function config() {
    var c = PropertiesService.getScriptProperties().getProperties();
    if (c.ENV !== 'test' || !['true', 'false'].includes(c.DRY_RUN)) throw new Error('ENV=testと明示的なDRY_RUNが必要です。');
    c.INGEST_BATCH = Number(c.INGEST_BATCH || 5);
    if (!Number.isInteger(c.INGEST_BATCH) || c.INGEST_BATCH < 1 || c.INGEST_BATCH > 10) throw new Error('INGEST_BATCHは1〜10です。');
    return c;
  }
  function escape(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
  function meta(id) { return Drive.Files.get(id, { supportsAllDrives: true, fields: 'id,name,mimeType,parents,driveId,trashed,ownedByMe,appProperties,createdTime,modifiedTime' }); }
  function list(parent, c, query) {
    var all = [], token;
    do {
      var args = { q: "'" + escape(parent) + "' in parents and trashed=false" + (query ? ' and ' + query : ''), supportsAllDrives: true, includeItemsFromAllDrives: true, fields: 'nextPageToken,files(id,name,mimeType,parents,createdTime,modifiedTime,appProperties)', pageSize: 100 };
      if (c.SHARED_DRIVE_ID) { args.corpora = 'drive'; args.driveId = c.SHARED_DRIVE_ID; }
      else args.corpora = 'user';
      if (token) args.pageToken = token;
      var page = Drive.Files.list(args); all = all.concat(page.files || []); token = page.nextPageToken;
    } while (token);
    return all;
  }
  function open(c) {
    if (c.ENV !== 'test' || !c.TEST_ENV_KEY || !c.FOLDER_SYSTEM_TEST_ID) throw new Error('setupTestWorkspaceでテスト環境を作成してください。');
    var root = meta(c.FOLDER_SYSTEM_TEST_ID);
    function marker(m, kind) { return m.appProperties && m.appProperties.minutes_test_env === c.TEST_ENV_KEY && (!kind || m.appProperties.kind === kind); }
    if (root.trashed || root.mimeType !== folderMime || root.name !== '_test' || !marker(root, 'test_root')) throw new Error('初期化済みテストルートではありません。');
    if (c.SHARED_DRIVE_ID ? root.driveId !== c.SHARED_DRIVE_ID : root.driveId || !root.ownedByMe) throw new Error('テストDriveの所属が違います。');
    var system = root.parents && root.parents.length === 1 && meta(root.parents[0]);
    if (!system || system.name !== '_system' || !marker(system, 'system')) throw new Error('_system/_testではありません。');
    function within(id) {
      var file = meta(id), cursor = file, visited = new Set();
      for (var depth = 0; depth < 30; depth++) {
        if (cursor.trashed || cursor.mimeType === 'application/vnd.google-apps.shortcut') throw new Error('削除済みファイル・ショートカットは処理できません。');
        if (cursor.id === root.id) return file;
        if (!cursor.parents || cursor.parents.length !== 1 || visited.has(cursor.id)) break;
        visited.add(cursor.id); cursor = cursor.parents[0] === root.id ? root : meta(cursor.parents[0]);
      }
      throw new Error('テストルート外のファイル操作は禁止です。');
    }
    function write() { if (c.DRY_RUN !== 'false') throw new Error('DRY_RUN中のDrive書き込みは禁止です。'); }
    function children(id) { within(id); return list(id, c); }
    function folder(parent, name, create, meetingKey) {
      within(parent);
      var matches = children(parent).filter(function (m) { return m.mimeType === folderMime && (meetingKey ? (m.appProperties || {}).meeting_key === meetingKey : m.name === name); });
      if (matches.length > 1) throw new Error('同名・同キーのフォルダが複数あります: ' + name);
      if (matches.length) return matches[0];
      if (!create) throw new Error('フォルダがありません: ' + name);
      write(); var app = { minutes_test_env: c.TEST_ENV_KEY }; if (meetingKey) app.meeting_key = meetingKey;
      return Drive.Files.create({ name: name, mimeType: folderMime, parents: [parent], appProperties: app }, null, { supportsAllDrives: true, fields: 'id,name,mimeType,parents,appProperties' });
    }
    function move(id, destination, kind, meetingKey) {
      write(); var m = within(id); within(destination);
      var app = Object.assign({}, m.appProperties || {});
      if (app.meeting_key && meetingKey && app.meeting_key !== meetingKey) throw new Error('別会議に属するファイルです。');
      if (kind) app.kind = kind; if (meetingKey) app.meeting_key = meetingKey;
      var args = { supportsAllDrives: true, fields: 'id,name,parents' };
      if (!(m.parents || []).includes(destination)) { args.addParents = destination; args.removeParents = (m.parents || []).join(','); }
      return Drive.Files.update({ appProperties: app }, id, null, args);
    }
    function createFile(parent, name, content, mime, kind, meetingKey) {
      write(); within(parent);
      var app = { minutes_test_env: c.TEST_ENV_KEY, kind: kind }; if (meetingKey) app.meeting_key = meetingKey;
      var body = { name: name, mimeType: mime, parents: [parent], appProperties: app };
      var inputMime = mime === 'application/vnd.google-apps.document' ? 'text/html' : mime;
      return Drive.Files.create(body, Utilities.newBlob(content, inputMime, name), { supportsAllDrives: true, fields: 'id,name,mimeType,parents,appProperties' });
    }
    function readJSON(id) {
      var m = within(id); if (m.mimeType !== 'application/json' && !m.name.endsWith('.json')) throw new Error('JSONファイルではありません。');
      return JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8'));
    }
    return { root: root, within: within, children: children, folder: folder, move: move, createFile: createFile, readJSON: readJSON };
  }
  function setup() {
    var c = config(), properties = PropertiesService.getScriptProperties();
    if (c.SHARED_DRIVE_ID) throw new Error('この準備関数はマイドライブ専用です。SHARED_DRIVE_IDを空にしてください。');
    if (c.DRY_RUN === 'true') { console.log('準備予定：マイドライブに開発専用フォルダ/_system/_test、受信・inbox・格納先・テスト台帳を作成します。'); return; }
    if (!c.TEST_ENV_KEY) { c.TEST_ENV_KEY = Utilities.getUuid(); properties.setProperty('TEST_ENV_KEY', c.TEST_ENV_KEY); }
    function ensure(parent, name, kind) {
      var matches = list(parent, c, "mimeType='" + folderMime + "'").filter(function (f) { return (f.appProperties || {}).minutes_test_env === c.TEST_ENV_KEY && (f.appProperties || {}).kind === kind; });
      if (matches.length > 1) throw new Error('テスト準備の同一マーカーが複数あります。');
      return matches[0] || Drive.Files.create({ name: name, mimeType: folderMime, parents: [parent], appProperties: { minutes_test_env: c.TEST_ENV_KEY, kind: kind } }, null, { supportsAllDrives: true, fields: 'id,name,parents' });
    }
    var top = ensure('root', 'MTG議事録自動化（開発専用）', 'top'), system = ensure(top.id, '_system', 'system'), root = ensure(system.id, '_test', 'test_root');
    if (c.FOLDER_SYSTEM_TEST_ID && c.FOLDER_SYSTEM_TEST_ID !== root.id) throw new Error('既存のFOLDER_SYSTEM_TEST_IDは上書きしません。');
    c.FOLDER_SYSTEM_TEST_ID = root.id; properties.setProperty('FOLDER_SYSTEM_TEST_ID', root.id);
    var drive = open(c), raw = drive.folder(root.id, '00_受信', true), inbox = drive.folder(root.id, 'inbox', true);
    drive.folder(inbox.id, '_done', true); drive.folder(root.id, 'ref', true); drive.folder(root.id, '00_仕分け待ち', true);
    var excluded = drive.folder(root.id, '99_対象外', true); drive.folder(excluded.id, '_空', true);
    var internal = drive.folder(root.id, '社内', true), external = drive.folder(root.id, '社外', true), folderRows = [];
    NotionFixtures_.masters.folders.forEach(function (r) { var name = r.placement.slice(3), f = drive.folder(internal.id, name, true); folderRows.push(Object.assign({}, r, { drive_folder_id: f.id })); });
    var clientRows = NotionFixtures_.masters.clients.map(function (r) { return Object.assign({}, r, { drive_folder_id: drive.folder(external.id, r.client_name.replace(/\//g, '・'), true).id }); });
    var book;
    if (c.LEDGER_SPREADSHEET_ID) { drive.within(c.LEDGER_SPREADSHEET_ID); book = SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID); }
    else {
      var existing = drive.children(root.id).filter(function (f) { return f.mimeType === 'application/vnd.google-apps.spreadsheet' && f.name === 'MTG議事録 台帳（テスト）'; });
      if (existing.length > 1) throw new Error('テスト台帳が複数あります。');
      var file = existing[0] || Drive.Files.create({ name: 'MTG議事録 台帳（テスト）', mimeType: 'application/vnd.google-apps.spreadsheet', parents: [root.id], appProperties: { minutes_test_env: c.TEST_ENV_KEY } }, null, { supportsAllDrives: true, fields: 'id' });
      c.LEDGER_SPREADSHEET_ID = file.id; properties.setProperty('LEDGER_SPREADSHEET_ID', file.id); book = SpreadsheetApp.openById(file.id);
    }
    Stage2Ledger_.initialize(book); var ledger = Stage2Ledger_.open(book);
    function seed(sheet, field, rows) { var known = new Set(ledger.rows(sheet).map(function (r) { return String(r[field]); })); rows.forEach(function (r) { if (!known.has(String(r[field]))) { ledger.append(sheet, r); known.add(String(r[field])); } }); }
    seed('masters_folders', 'placement', folderRows.concat(clientRows.map(function (r) { return { placement: '社外/' + r.client_name, drive_folder_id: r.drive_folder_id }; })));
    seed('masters_clients', 'client_name', clientRows.map(function (r) { return Object.assign({}, r, { domains: JSON.stringify(r.domains) }); }));
    seed('masters_internal', 'email_or_domain', NotionFixtures_.masters.internal.map(function (v) { return { email_or_domain: v }; }));
    seed('masters_people', 'google_email', NotionFixtures_.masters.people);
    console.log('テスト環境を準備しました。FOLDER_SYSTEM_TEST_ID=' + root.id + ' / LEDGER_SPREADSHEET_ID=' + c.LEDGER_SPREADSHEET_ID + '。プロパティに自動登録済みです。');
    return { root: root.id, ledger: c.LEDGER_SPREADSHEET_ID, raw: raw.id, inbox: inbox.id };
  }
  return { config: config, open: open, setup: setup };
})();

function setupTestWorkspace() { return Ledger_.withLock(Stage2Drive_.setup); }


// stage2Ledger.js
var Stage2Ledger_ = (function () {
  function text(value) { var s = String(value === undefined || value === null ? '' : value); return /^[=+@]/.test(s) ? "'" + s : s; }
  function initialize(book) {
    var plan = Ledger_.plan(book); // 全シートの見出しを先に確認し、既存データは上書きしません。
    plan.forEach(function (p) {
      var sheet = book.getSheetByName(p.sheet) || book.insertSheet(p.sheet);
      if (!sheet.getLastRow()) sheet.appendRow(p.headers);
    });
  }
  function open(book) {
    Ledger_.plan(book).forEach(function (p) { if (p.action !== '変更なし') throw new Error('台帳が未初期化です。setupTestWorkspaceを実行してください。'); });
    function rows(name) {
      var sheet = book.getSheetByName(name), headers = Ledger_.headers[name].split(',');
      return sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues().map(function (values, i) {
        var r = { _row: i + 2 }; headers.forEach(function (h, j) { r[h] = values[j]; }); return r;
      });
    }
    function append(name, data) {
      var sheet = book.getSheetByName(name), values = Ledger_.headers[name].split(',').map(function (h) { return text(data[h]); });
      sheet.appendRow(values); data._row = sheet.getLastRow(); return data;
    }
    function save(row) {
      row.version = Number(row.version || 0) + 1; row.updated_at = new Date().toISOString();
      if (!row._row) return append('minutes', row);
      var headers = Ledger_.headers.minutes.split(',');
      book.getSheetByName('minutes').getRange(row._row, 1, 1, headers.length).setValues([headers.map(function (h) { return text(row[h]); })]);
      return row;
    }
    function list(value) {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      try { var a = JSON.parse(value); if (Array.isArray(a)) return a; } catch (e) { /* カンマ形式も受け付けます。 */ }
      return String(value).split(',').map(function (v) { return v.trim(); }).filter(Boolean);
    }
    function masters() {
      return { folders: rows('masters_folders'), clients: rows('masters_clients').map(function (r) { return Object.assign({}, r, { domains: list(r.domains) }); }),
        internal: rows('masters_internal').map(function (r) { return r.email_or_domain; }), people: rows('masters_people') };
    }
    function log(action, target, summary) { Ledger_.dryLog(book, action, target, typeof summary === 'string' ? summary : JSON.stringify(summary)); }
    function displayId(start) {
      var prefix = 'MTG-' + Utilities.formatDate(new Date(start), 'Asia/Tokyo', 'yyMMdd') + '-';
      var next = rows('minutes').filter(function (r) { return String(r.display_id).startsWith(prefix); }).reduce(function (max, r) { return Math.max(max, Number(String(r.display_id).slice(prefix.length)) || 0); }, 0) + 1;
      return prefix + String(next).padStart(2, '0');
    }
    return { rows: rows, append: append, save: save, masters: masters, log: log, displayId: displayId };
  }
  return { initialize: initialize, open: open };
})();


// testDbSchema.js
// 本番スキーマからテスト用の作成リクエストを組み立てる純粋関数です。
var TestDbSchema_ = (function () {
  function id(value) { return String(value || '').replace(/-/g, '').toLowerCase(); }
  function scalarProperties(source) {
    var properties = Object.create(null), skipped = [];
    var simple = ['title', 'rich_text', 'date', 'people', 'files', 'checkbox', 'url', 'email', 'phone_number', 'created_time', 'created_by', 'last_edited_time', 'last_edited_by'];
    Object.keys(source).forEach(function (name) {
      var p = source[name], type = p.type, value = {};
      if (type === 'relation') return; // 全DB作成後に接続します。
      if (simple.includes(type)) value[type] = {};
      else if (type === 'number') value.number = p.number && p.number.format ? { format: p.number.format } : {};
      else if (type === 'select' || type === 'multi_select') {
        value[type] = { options: ((p[type] || {}).options || []).map(function (o) {
          var option = { name: o.name };
          if (o.color) option.color = o.color;
          return option;
        }) };
      } else {
        skipped.push({ name: name, type: type, reason: type === 'status' ? 'API 2025-09-03では独自のステータス選択肢を複製できません。' : '初期化で複製しない型です。' });
        return;
      }
      value.type = type;
      properties[name] = value;
    });
    if (Object.keys(properties).filter(function (n) { return properties[n].type === 'title'; }).length !== 1) throw new Error('タイトル項目が1つ必要です。');
    return { properties: properties, skipped: skipped };
  }
  function targetKey(relation, sources) {
    return Object.keys(sources).find(function (key) {
      return id(relation.data_source_id) && id(relation.data_source_id) === id(sources[key].sourceId) ||
        id(relation.database_id) && id(relation.database_id) === id(sources[key].databaseId);
    });
  }
  function relations(sources) {
    var edges = [], skipped = [], seen = new Set();
    Object.keys(sources).forEach(function (from) {
      var props = sources[from].properties;
      Object.keys(props).forEach(function (name) {
        var p = props[name];
        if (p.type !== 'relation' || seen.has(from + ':' + name)) return;
        var r = p.relation || {}, to = targetKey(r, sources);
        if (!to) { skipped.push({ name: name, type: 'relation', reason: '複製対象外のDBへのリレーションです。', database: from }); return; }
        var reverseName = null;
        if (from === 'minutes' && name === '関連するプロジェクト' && to === 'tasks' &&
            sources.tasks.properties['関連するMTG'] && sources.tasks.properties['関連するMTG'].type === 'relation' &&
            targetKey(sources.tasks.properties['関連するMTG'].relation || {}, sources) === 'minutes') {
          reverseName = '関連するMTG';
        } else if (r.type === 'dual_property') {
          var dual = r.dual_property || {};
          reverseName = Object.keys(sources[to].properties).find(function (n) {
            var other = sources[to].properties[n];
            return other.type === 'relation' && targetKey(other.relation || {}, sources) === from &&
              (n === dual.synced_property_name || other.id && other.id === dual.synced_property_id);
          });
          if (!reverseName) throw new Error('双方向リレーションの相手項目を特定できません: ' + name);
        }
        if (reverseName === name && from === to) throw new Error('自己参照の相手項目が同一です: ' + name);
        edges.push({ from: from, to: to, name: name, reverseName: reverseName });
        seen.add(from + ':' + name);
        if (reverseName) seen.add(to + ':' + reverseName);
      });
    });
    return { edges: edges, skipped: skipped };
  }
  function relationProperty(edge, targets) {
    var relation = { data_source_id: targets[edge.to].sourceId, type: edge.reverseName ? 'dual_property' : 'single_property' };
    if (edge.reverseName) relation.dual_property = { synced_property_name: edge.reverseName };
    else relation.single_property = {};
    return { type: 'relation', relation: relation };
  }
  function assertCompatible(actual, expected) {
    Object.keys(expected).forEach(function (name) {
      var a = actual[name], e = expected[name];
      if (!a || a.type !== e.type) throw new Error('既存テストDBの項目が異なります。上書きしません: ' + name);
      if (e.type === 'select' || e.type === 'multi_select') {
        var options = ((a[e.type] || {}).options || []).map(function (o) { return { name: o.name, color: o.color || 'default' }; });
        var wanted = e[e.type].options.map(function (o) { return { name: o.name, color: o.color || 'default' }; });
        if (JSON.stringify(options) !== JSON.stringify(wanted)) throw new Error('既存テストDBの選択肢が異なります: ' + name);
      }
      if (e.type === 'number' && e.number.format && (!a.number || a.number.format !== e.number.format)) throw new Error('既存テストDBの数値形式が異なります: ' + name);
    });
  }
  return { id: id, scalarProperties: scalarProperties, relations: relations, relationProperty: relationProperty, assertCompatible: assertCompatible };
})();
