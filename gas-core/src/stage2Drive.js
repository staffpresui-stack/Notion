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
  function meta(id) { return Drive.Files.get(id, { supportsAllDrives: true, fields: 'id,name,mimeType,parents,driveId,trashed,ownedByMe,appProperties,createdTime,modifiedTime,capabilities(canEdit,canAddChildren)' }); }
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
    if (c.ENV !== 'test' || !c.TEST_ENV_KEY || !c.FOLDER_SYSTEM_TEST_ID) throw new Error('共有ドライブはsetupSharedTestWorkspace、マイドライブはsetupTestWorkspaceで準備してください。');
    var root = meta(c.FOLDER_SYSTEM_TEST_ID);
    function marker(m, kind) { return m.appProperties && m.appProperties.minutes_test_env === c.TEST_ENV_KEY && (!kind || m.appProperties.kind === kind); }
    if (root.trashed || root.mimeType !== folderMime || root.name !== '_test' || !marker(root, 'test_root')) throw new Error('初期化済みテストルートではありません。');
    if (c.SHARED_DRIVE_ID ? root.driveId !== c.SHARED_DRIVE_ID : root.driveId || !root.ownedByMe) throw new Error('テストDriveの所属が違います。');
    var system = root.parents && root.parents.length === 1 && meta(root.parents[0]);
    if (!system || system.name !== '_system' || system.trashed || system.mimeType && system.mimeType !== folderMime) throw new Error('_system/_testではありません。');
    if (c.SHARED_DRIVE_ID) {
      // _systemは本番領域でもあるため目印を要求・追加せず、所属だけを検証します。
      if (system.driveId !== c.SHARED_DRIVE_ID || !system.parents || system.parents.length !== 1 || system.parents[0] !== c.SHARED_DRIVE_ID || c.FOLDER_SYSTEM_ID && system.id !== c.FOLDER_SYSTEM_ID) throw new Error('_systemが指定共有ドライブ直下にありません。');
    } else if (!marker(system, 'system')) throw new Error('マイドライブの_systemマーカーが不正です。');
    function within(id) {
      var file = meta(id), cursor = file, visited = new Set();
      for (var depth = 0; depth < 30; depth++) {
        if (cursor.trashed || cursor.mimeType === 'application/vnd.google-apps.shortcut') throw new Error('削除済みファイル・ショートカットは処理できません。');
        if (c.SHARED_DRIVE_ID && cursor.driveId !== c.SHARED_DRIVE_ID) throw new Error('指定共有ドライブ外のファイルです。');
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
  function populate(c, drive, book) {
    var root = drive.root;
    var raw = drive.folder(root.id, '00_受信', true), inbox = drive.folder(root.id, 'inbox', true);
    drive.folder(inbox.id, '_done', true); drive.folder(root.id, 'ref', true); drive.folder(root.id, '00_仕分け待ち', true);
    var excluded = drive.folder(root.id, '99_対象外', true); drive.folder(excluded.id, '_空', true);
    var internal = drive.folder(root.id, '社内', true), external = drive.folder(root.id, '社外', true), folderRows = [];
    NotionFixtures_.masters.folders.forEach(function (r) { var name = r.placement.slice(3), f = drive.folder(internal.id, name, true); folderRows.push(Object.assign({}, r, { drive_folder_id: f.id })); });
    var clientRows = NotionFixtures_.masters.clients.map(function (r) { return Object.assign({}, r, { drive_folder_id: drive.folder(external.id, r.client_name.replace(/\//g, '・'), true).id }); });
    Stage2Ledger_.initialize(book); var ledger = Stage2Ledger_.open(book);
    ledger.rows('masters_folders').concat(ledger.rows('masters_clients')).forEach(function (r) { if (r.drive_folder_id) drive.within(r.drive_folder_id); });
    function seed(sheet, field, rows) { var known = new Set(ledger.rows(sheet).map(function (r) { return String(r[field]); })); rows.forEach(function (r) { if (!known.has(String(r[field]))) { ledger.append(sheet, r); known.add(String(r[field])); } }); }
    seed('masters_folders', 'placement', folderRows.concat(clientRows.map(function (r) { return { placement: '社外/' + r.client_name, drive_folder_id: r.drive_folder_id }; })));
    seed('masters_clients', 'client_name', clientRows.map(function (r) { return Object.assign({}, r, { domains: JSON.stringify(r.domains) }); }));
    seed('masters_internal', 'email_or_domain', NotionFixtures_.masters.internal.map(function (v) { return { email_or_domain: v }; }));
    seed('masters_people', 'google_email', NotionFixtures_.masters.people);
    return { raw: raw.id, inbox: inbox.id };
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
    var drive = open(c);
    var book;
    if (c.LEDGER_SPREADSHEET_ID) { drive.within(c.LEDGER_SPREADSHEET_ID); book = SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID); }
    else {
      var existing = drive.children(root.id).filter(function (f) { return f.mimeType === 'application/vnd.google-apps.spreadsheet' && f.name === 'MTG議事録 台帳（テスト）'; });
      if (existing.length > 1) throw new Error('テスト台帳が複数あります。');
      var file = existing[0] || Drive.Files.create({ name: 'MTG議事録 台帳（テスト）', mimeType: 'application/vnd.google-apps.spreadsheet', parents: [root.id], appProperties: { minutes_test_env: c.TEST_ENV_KEY } }, null, { supportsAllDrives: true, fields: 'id' });
      c.LEDGER_SPREADSHEET_ID = file.id; properties.setProperty('LEDGER_SPREADSHEET_ID', file.id); book = SpreadsheetApp.openById(file.id);
    }
    var workspace = populate(c, drive, book);
    console.log('テスト環境を準備しました。FOLDER_SYSTEM_TEST_ID=' + root.id + ' / LEDGER_SPREADSHEET_ID=' + c.LEDGER_SPREADSHEET_ID + '。プロパティに自動登録済みです。');
    return { root: root.id, ledger: c.LEDGER_SPREADSHEET_ID, raw: workspace.raw, inbox: workspace.inbox };
  }
  function setupShared(sharedDriveId, testRootId, testLedgerId) {
    var c = config(), properties = PropertiesService.getScriptProperties();
    if (sharedDriveId || testRootId || testLedgerId) {
      if (![sharedDriveId, testRootId, testLedgerId].every(function (v) { return typeof v === 'string' && v; })) throw new Error('共有ドライブ・テストルート・テスト台帳の3つのIDが必要です。');
      c.SHARED_DRIVE_ID = sharedDriveId; c.FOLDER_SYSTEM_TEST_ID = testRootId; c.LEDGER_SPREADSHEET_ID = testLedgerId;
    }
    if (!c.SHARED_DRIVE_ID || !c.FOLDER_SYSTEM_TEST_ID || !c.LEDGER_SPREADSHEET_ID) throw new Error('SHARED_DRIVE_ID、FOLDER_SYSTEM_TEST_ID、LEDGER_SPREADSHEET_IDが必要です。');
    if (c.LEDGER_SPREADSHEET_ID === '137IuSH4nGulMcsB5-IKqvIXkw8SiQrFBjFNSAeXNt0c') throw new Error('本番台帳は初期化できません。');
    var root = meta(c.FOLDER_SYSTEM_TEST_ID);
    if (root.name !== '_test' || root.mimeType !== folderMime || root.trashed || root.driveId !== c.SHARED_DRIVE_ID || !root.parents || root.parents.length !== 1) throw new Error('共有ドライブの_testフォルダではありません。');
    var system = meta(root.parents[0]);
    if (system.name !== '_system' || system.mimeType !== folderMime || system.trashed || system.driveId !== c.SHARED_DRIVE_ID || !system.parents || system.parents.length !== 1 || system.parents[0] !== c.SHARED_DRIVE_ID || c.FOLDER_SYSTEM_ID && c.FOLDER_SYSTEM_ID !== system.id) throw new Error('_systemが指定共有ドライブ直下にありません。');
    var app = root.appProperties || {};
    if (app.kind && app.kind !== 'test_root' || app.minutes_test_env && c.TEST_ENV_KEY && app.minutes_test_env !== c.TEST_ENV_KEY) throw new Error('既存のテストマーカーと設定が違います。上書きしません。');
    if ((root.capabilities || {}).canEdit === false || (root.capabilities || {}).canAddChildren === false) throw new Error('テストフォルダの編集・作成権限がありません。');
    function contained(id) {
      var file = meta(id), cursor = file, visited = new Set();
      for (var i = 0; i < 30; i++) {
        if (cursor.trashed || cursor.mimeType === 'application/vnd.google-apps.shortcut' || cursor.driveId !== c.SHARED_DRIVE_ID) break;
        if (cursor.id === root.id) return file;
        if (!cursor.parents || cursor.parents.length !== 1 || visited.has(cursor.id)) break;
        visited.add(cursor.id); cursor = cursor.parents[0] === root.id ? root : meta(cursor.parents[0]);
      }
      throw new Error('対象が_test配下にありません。移動・初期化は行いません。');
    }
    var ledgerFile = contained(c.LEDGER_SPREADSHEET_ID);
    if (ledgerFile.mimeType !== 'application/vnd.google-apps.spreadsheet' || (ledgerFile.capabilities || {}).canEdit === false) throw new Error('編集可能なテスト台帳が必要です。');
    var book = SpreadsheetApp.openById(ledgerFile.id), ledgerPlan = Ledger_.plan(book);
    [['masters_folders', 2], ['masters_clients', 3]].forEach(function (entry) {
      var sheet = book.getSheetByName(entry[0]);
      if (sheet && sheet.getLastRow() > 1) sheet.getRange(2, entry[1], sheet.getLastRow() - 1, 1).getValues().forEach(function (r) { if (r[0]) contained(String(r[0])); });
    });
    var cache = {}, missing = [];
    function inspectPath(path) {
      var parentId = root.id, pathName = '';
      path.forEach(function (name) {
        pathName += (pathName ? '/' : '') + name;
        if (!parentId) { if (!missing.includes(pathName)) missing.push(pathName); return; }
        if (!cache[parentId]) cache[parentId] = list(parentId, c);
        var matches = cache[parentId].filter(function (f) { return f.name === name; });
        if (matches.length > 1 || matches.length && matches[0].mimeType !== folderMime) throw new Error('同名フォルダが複数、または同名の非フォルダがあります: ' + pathName);
        if (!matches.length) { if (!missing.includes(pathName)) missing.push(pathName); parentId = null; }
        else parentId = matches[0].id;
      });
    }
    ['社内', '社外', '00_仕分け待ち', '99_対象外', '00_受信', 'inbox', 'ref'].forEach(function (name) { inspectPath([name]); });
    inspectPath(['inbox', '_done']); inspectPath(['99_対象外', '_空']);
    NotionFixtures_.masters.folders.forEach(function (r) { inspectPath(['社内', r.placement.slice(3)]); });
    NotionFixtures_.masters.clients.forEach(function (r) { inspectPath(['社外', r.client_name.replace(/\//g, '・')]); });
    if (c.FOLDER_INBOX_RAW_TEST_ID) {
      var raw = contained(c.FOLDER_INBOX_RAW_TEST_ID);
      if (raw.name !== '00_受信' || raw.mimeType !== folderMime || raw.parents.length !== 1 || raw.parents[0] !== root.id) throw new Error('FOLDER_INBOX_RAW_TEST_IDが_test直下の00_受信ではありません。');
    }
    c.TEST_ENV_KEY = c.TEST_ENV_KEY || app.minutes_test_env;
    console.log('共有ドライブの所属・テスト台帳の配置・見出しを確認しました。_systemは読み取りのみです。');
    console.log('不足フォルダ: ' + JSON.stringify(missing) + ' / 台帳初期化予定: ' + JSON.stringify(ledgerPlan.filter(function (p) { return p.action !== '変更なし'; }).map(function (p) { return { sheet: p.sheet, action: p.action }; })));
    if (c.DRY_RUN === 'true') { console.log('準備予定：_testだけに目印を付け、不足フォルダ・台帳シート・サンプルマスタを追加します。設定やDriveには書き込みません。'); return { dryRun: true, root: root.id, ledger: ledgerFile.id }; }
    c.TEST_ENV_KEY = c.TEST_ENV_KEY || Utilities.getUuid();
    // ここからのDrive書き込み先は_test自身とその子だけです。
    if (app.minutes_test_env !== c.TEST_ENV_KEY || app.kind !== 'test_root') Drive.Files.update({ appProperties: Object.assign({}, app, { minutes_test_env: c.TEST_ENV_KEY, kind: 'test_root' }) }, root.id, null, { supportsAllDrives: true, fields: 'id' });
    ['SHARED_DRIVE_ID', 'FOLDER_SYSTEM_TEST_ID', 'LEDGER_SPREADSHEET_ID', 'TEST_ENV_KEY'].forEach(function (k) { properties.setProperty(k, c[k]); });
    properties.setProperty('FOLDER_SYSTEM_ID', system.id); c.FOLDER_SYSTEM_ID = system.id;
    var drive = open(c), workspace = populate(c, drive, book);
    properties.setProperty('FOLDER_INBOX_RAW_TEST_ID', workspace.raw);
    console.log('共有ドライブのテスト領域を準備しました。既存フォルダの移動・改名・削除は行っていません。');
    return { root: root.id, ledger: ledgerFile.id, raw: workspace.raw, inbox: workspace.inbox };
  }
  return { config: config, open: open, setup: setup, setupShared: setupShared };
})();

function setupTestWorkspace() { return Ledger_.withLock(Stage2Drive_.setup); }

function setupSharedTestWorkspace(sharedDriveId, testRootId, testLedgerId) {
  return Ledger_.withLock(function () { return Stage2Drive_.setupShared(sharedDriveId, testRootId, testLedgerId); });
}
