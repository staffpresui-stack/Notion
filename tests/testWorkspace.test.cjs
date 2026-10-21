const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const clone = x => JSON.parse(JSON.stringify(x));
function harness(dryRun = 'false') {
  const props = { ENV: 'test', DRY_RUN: dryRun }, files = {}, books = {}, writes = [];
  let seq = 0;
  function sheet() {
    const data = [];
    return { data, getLastRow: () => data.length, getLastColumn: () => Math.max(0, ...data.map(r => r.length)),
      appendRow(values) { data.push(clone(values)); }, getRange(row, col, count, width) { return {
        getValues: () => Array.from({ length: count }, (_, i) => Array.from({ length: width }, (_, j) => (data[row - 1 + i] || [])[col - 1 + j] ?? '')),
        setValues(values) { values.forEach((r, i) => { data[row - 1 + i] ||= []; r.forEach((v, j) => data[row - 1 + i][col - 1 + j] = v); }); }
      }; }
    };
  }
  function book() {
    const sheets = {};
    return { sheets, getSheetByName: n => sheets[n] || null, insertSheet(n) { assert.ok(!sheets[n]); return sheets[n] = sheet(); } };
  }
  const ctx = vm.createContext({ console: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({ ...props }), getProperty: k => props[k], setProperty(k, v) { writes.push('property'); props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { getUuid: () => 'test-env-uuid', newBlob: (content, mime, name) => ({ content, mime, name }), formatDate: () => '2026-10-21' },
    SpreadsheetApp: { openById: id => { assert.ok(books[id]); return books[id]; } },
    Drive: { Files: {
      get(id, options) { assert.equal(options.supportsAllDrives, true); assert.ok(files[id]); return clone(files[id]); },
      list(options) {
        assert.equal(options.corpora, 'user'); assert.equal(options.driveId, undefined); assert.equal(options.supportsAllDrives, true);
        const parent = /^'([^']+)' in parents/.exec(options.q)[1];
        const foldersOnly = options.q.includes("mimeType='application/vnd.google-apps.folder'");
        return { files: Object.values(files).filter(f => f.parents.includes(parent) && (!foldersOnly || f.mimeType === 'application/vnd.google-apps.folder')).map(clone) };
      },
      create(body, media, options) {
        assert.equal(options.supportsAllDrives, true); const id = 'f' + (++seq);
        files[id] = { ...clone(body), id, ownedByMe: true, createdTime: id, modifiedTime: id };
        if (media) files[id].content = media.content;
        if (body.mimeType === 'application/vnd.google-apps.spreadsheet') books[id] = book();
        writes.push('create'); return clone(files[id]);
      }
    } }
  });
  for (const file of ['ledger.js', 'stage2Ledger.js', 'stage2Drive.js', 'notionFixtures.generated.js', 'stage2Content.js']) vm.runInContext(fs.readFileSync('gas-core/src/' + file, 'utf8'), ctx);
  return { ctx, props, files, books, writes };
}
test('マイドライブ準備は専用ルート・10シート・サンプルマスタを作り、再実行で増やしません', () => {
  const h = harness(), first = h.ctx.setupTestWorkspace();
  assert.equal(h.props.FOLDER_SYSTEM_TEST_ID, first.root); assert.equal(h.props.LEDGER_SPREADSHEET_ID, first.ledger);
  assert.equal(h.files[first.root].name, '_test'); assert.equal(h.files[first.root].appProperties.kind, 'test_root');
  const book = h.books[first.ledger]; assert.equal(Object.keys(book.sheets).length, 10);
  assert.equal(book.sheets.masters_internal.data.length, 3);
  assert.equal(book.sheets.masters_folders.data.length, 9);
  const count = Object.keys(h.files).length;
  h.ctx.setupTestWorkspace(); assert.equal(Object.keys(h.files).length, count);
  assert.equal(book.sheets.masters_internal.data.length, 3);
  book.sheets.masters_people.data[1][0] = '手動修正した名前';
  h.ctx.setupTestWorkspace(); assert.equal(book.sheets.masters_people.data[1][0], '手動修正した名前');
});
test('準備関数のDRY_RUNはフォルダ・台帳・プロパティを作成しません', () => {
  const h = harness('true'); h.ctx.setupTestWorkspace(); assert.equal(h.writes.length, 0);
});
test('共有ドライブやENV=prodでマイドライブの準備を実行しません', () => {
  for (const patch of [{ SHARED_DRIVE_ID: 'shared' }, { ENV: 'prod' }]) {
    const h = harness(); Object.assign(h.props, patch); assert.throws(() => h.ctx.setupTestWorkspace()); assert.equal(h.writes.length, 0);
  }
});
test('既存の台帳の見出しが違う場合は上書きしません', () => {
  const h = harness(), first = h.ctx.setupTestWorkspace(), book = h.books[first.ledger];
  book.sheets.minutes.data[0][0] = '変更済み';
  assert.throws(() => h.ctx.setupTestWorkspace(), /上書きしません/); assert.equal(book.sheets.minutes.data[0][0], '変更済み');
});
test('実際の準備アダプタでfixture投入は再実行しても3件を二重作成しません', () => {
  const h = harness(); h.ctx.setupTestWorkspace(); h.ctx.seedFixtureInbox();
  const count = Object.keys(h.files).length;
  assert.equal(Object.values(h.files).filter(f => f.appProperties.kind === 'judgement').length, 3);
  assert.equal(Object.values(h.files).filter(f => f.appProperties.kind === 'minutes').length, 3);
  h.ctx.seedFixtureInbox(); assert.equal(Object.keys(h.files).length, count);
});
