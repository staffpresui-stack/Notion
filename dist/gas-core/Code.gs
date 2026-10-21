// config.js
var Config_ = (function () {
  var defaults = { ENV: 'test', DRY_RUN: 'true', GENERATOR_MODE: 'CHATGPT',
    NOTION_VERSION: '2025-09-03', TASK_DB_MODE: 'single', NOTION_MTG_URL_SOURCE: 'none' };
  // テスト対象を本番IDで代用しません。不明な値は安全側で拒否します。
  function inspect(values, profile) {
    var c = Object.assign({}, defaults, values), missing = [], errors = [];
    var required = ['LEDGER_SPREADSHEET_ID', 'SHARED_DRIVE_ID', 'NOTION_TOKEN', 'NOTION_DB_TLDV_INBOX', 'CHATWORK_TOKEN'];
    if (!['test', 'prod'].includes(c.ENV)) errors.push('ENV は test または prod を指定してください。');
    if (!['true', 'false'].includes(c.DRY_RUN)) errors.push('DRY_RUN は true または false を指定してください。');
    if (c.ENV !== 'test' || c.DRY_RUN !== 'true') errors.push('開発中は ENV=test、DRY_RUN=true が必要です。');
    if (!['CHATGPT', 'OPENAI_API'].includes(c.GENERATOR_MODE)) errors.push('GENERATOR_MODE が不正です。');
    if (!['single', 'dual'].includes(c.TASK_DB_MODE)) errors.push('TASK_DB_MODE が不正です。');
    if (!['none', 'folder', 'meet'].includes(c.NOTION_MTG_URL_SOURCE)) errors.push('NOTION_MTG_URL_SOURCE が不正です。');
    required = required.concat(['FOLDER_SYSTEM_TEST_ID', 'NOTION_DB_MINUTES_TEST', 'NOTION_DB_TASKS_TEST', 'CHATWORK_ROOM_ID_TEST']);
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
    var root = Drive.Files.get(c.FOLDER_SYSTEM_TEST_ID, { supportsAllDrives: true, fields: 'id,name,parents,driveId,mimeType' });
    if (root.name !== '_test' || root.driveId !== c.SHARED_DRIVE_ID || root.mimeType !== folderMime || !root.parents || root.parents.length !== 1) throw new Error('テスト用フォルダを確認してください。');
    var parent = Drive.Files.get(root.parents[0], { supportsAllDrives: true, fields: 'id,name,driveId' });
    if (parent.name !== '_system' || parent.driveId !== c.SHARED_DRIVE_ID) throw new Error('_system/_test 配下が必要です。');
    return root;
  }
  return { folders: folders, exact: exact, verifyTestRoot: verifyTestRoot };
})();


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
    if (rejectedProjects.length) conflicts.push('関連プロジェクトがマスタに登録されていません。');
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
