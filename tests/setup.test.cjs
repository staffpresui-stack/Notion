const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function load(files, globals = {}) {
  const ctx = vm.createContext({ console: { log() {} }, ...globals });
  for (const file of files) vm.runInContext(fs.readFileSync('gas-core/src/' + file, 'utf8'), ctx);
  return ctx;
}
const configured = { LEDGER_SPREADSHEET_ID: 'test-ledger', SHARED_DRIVE_ID: 'drive', NOTION_TOKEN: 'test-only',
  NOTION_DB_TLDV_INBOX: 'test-inbox', CHATWORK_TOKEN: 'test-only', FOLDER_SYSTEM_TEST_ID: 'test-root',
  NOTION_DB_MINUTES_TEST: 'test-minutes', NOTION_DB_TASKS_TEST: 'test-tasks', CHATWORK_ROOM_ID_TEST: 'test-room' };
test('設定検査は不足キーだけを返し、秘密値を出力しません', () => {
  const { Config_ } = load(['config.js']);
  const r = Config_.inspect({ NOTION_TOKEN: 'must-not-log' });
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes('FOLDER_SYSTEM_TEST_ID'));
  assert.ok(!JSON.stringify(r).includes('must-not-log'));
  assert.equal(Config_.inspect(configured).ok, true);
});
test('本番切替・不正な真偽値・本番IDの流用を拒否します', () => {
  const { Config_ } = load(['config.js']);
  for (const overrides of [{ ENV: 'prod' }, { DRY_RUN: 'TRUE' },
    { NOTION_DB_MINUTES: 'test-minutes' }, { FOLDER_SYSTEM_ID: 'test-root' }, { NOTION_DB_TASKS_TEST: 'e321f1cb33654a2c984447f34734a9d7' },
    { GENERATOR_MODE: 'unknown' }, { TASK_DB_MODE: 'dual' }, { GENERATOR_MODE: 'OPENAI_API' }]) {
    assert.equal(Config_.inspect({ ...configured, ...overrides }).ok, false, JSON.stringify(overrides));
  }
  assert.equal(Config_.inspect({ ...configured, DRY_RUN: 'false', SHARED_DRIVE_ID: '', CHATWORK_TOKEN: '', CHATWORK_ROOM_ID_TEST: '' }).ok, true);
});
test('Notion単独確認はChatwork・Drive未設定でも実行でき、安全条件は維持します', () => {
  const { Config_ } = load(['config.js']);
  const c = { NOTION_TOKEN: 'test-only', NOTION_DB_MINUTES_TEST: 'a', NOTION_DB_TASKS_TEST: 'b', NOTION_DB_TLDV_INBOX: 'c' };
  assert.equal(Config_.inspect(c, 'notion').ok, true);
  assert.equal(Config_.inspect(c).ok, false);
  assert.equal(Config_.inspect({ ...c, ENV: 'prod' }, 'notion').ok, false);
});
test('NotionのDBからデータソースをたどり、GETだけを送ります', () => {
  const calls = [];
  const { Notion_ } = load(['notionClient.js'], { UrlFetchApp: { fetch(url, options) {
    calls.push({ url, options });
    const body = calls.length === 1 ? { data_sources: [{ id: 'ds' }] } : { id: 'ds', properties: { '議事録名': { type: 'title' } } };
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
  } } });
  const r = Notion_.schema('db', { NOTION_TOKEN: 'test-only', NOTION_VERSION: '2025-09-03' });
  assert.equal(r.properties['議事録名'].type, 'title');
  assert.ok(calls[1].url.endsWith('/data_sources/ds'));
  assert.ok(calls.every(c => c.options.method === 'get'));
});
test('Notionの複数データソースと403を診断し、応答本文は出力しません', () => {
  let body = { data_sources: [{ id: 'a' }, { id: 'b' }] }, status = 200;
  const { Notion_ } = load(['notionClient.js'], { UrlFetchApp: { fetch() { return {
    getResponseCode: () => status, getContentText: () => JSON.stringify(body)
  }; } } });
  assert.throws(() => Notion_.schema('db', {}), /データソース/);
  status = 403; body = { token: 'must-not-log' };
  assert.throws(() => Notion_.schema('db', {}), e => e.message.includes('403') && !e.message.includes('must-not-log'));
});
test('Driveは共有ドライブを指定して全ページを取得します', () => {
  const calls = [];
  const { DriveUtil_ } = load(['driveUtil.js'], { Drive: { Files: { list(args) {
    calls.push(args); return calls.length === 1 ? { files: [{ name: 'a' }], nextPageToken: 'next' } : { files: [{ name: 'b' }] };
  } } } });
  assert.equal(DriveUtil_.folders('parent', 'drive').length, 2);
  assert.ok(calls.every(c => c.supportsAllDrives && c.includeItemsFromAllDrives && c.driveId === 'drive'));
  assert.equal(calls[1].pageToken, 'next');
});
test('Driveの同名重複を勝手に選択しません', () => {
  const { DriveUtil_ } = load(['driveUtil.js'], { Drive: { Files: { list() { return { files: [{ name: '社内' }, { name: '社内' }] }; } } } });
  assert.throws(() => DriveUtil_.exact('p', '社内', 'd'), /複数/);
});
test('テストルートは共有ドライブの _system 配下だけを許可します', () => {
  let parent = 'wrong';
  const { DriveUtil_ } = load(['driveUtil.js'], { Drive: { Files: { get(id) {
    return id === 'test-root' ? { name: '_test', driveId: 'drive', parents: ['parent'], mimeType: 'application/vnd.google-apps.folder' } : { name: parent, driveId: 'drive' };
  } } } });
  assert.throws(() => DriveUtil_.verifyTestRoot(configured), /_system/);
  parent = '_system'; assert.equal(DriveUtil_.verifyTestRoot(configured).name, '_test');
});
test('台帳の見出し不一致を上書きせずに拒否します', () => {
  const { Ledger_ } = load(['ledger.js']);
  const book = { getSheetByName() { return { getLastRow: () => 1, getLastColumn: () => 1,
    getRange() { return { getValues: () => [['wrong']] }; } }; } };
  assert.throws(() => Ledger_.plan(book), /上書きしません/);
  assert.equal(Ledger_.plan({ getSheetByName: () => null }).length, 10);
});
test('台帳処理に失敗してもロックを解放します', () => {
  let released = false;
  const { Ledger_ } = load(['ledger.js'], { LockService: { getScriptLock() { return {
    tryLock: () => true, releaseLock() { released = true; }
  }; } } });
  assert.throws(() => Ledger_.withLock(() => { throw new Error('test'); }), /test/);
  assert.equal(released, true);
});
test('DRY_RUN初期化は業務シートを作成せず、計画だけを記録します', () => {
  const recorded = [];
  const ctx = load(['setup.js'], {
    Config_: { assertSafe: () => configured }, DriveUtil_: { verifyTestRoot() {} },
    SpreadsheetApp: { openById: () => ({}) },
    Ledger_: { withLock: fn => fn(), plan: () => [{ sheet: 'minutes', action: 'シート作成' }], dryLog: (...args) => recorded.push(args) }
  });
  assert.equal(ctx.initLedger().applied, false);
  assert.equal(recorded.length, 1);
});
