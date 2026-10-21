const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const clone = x => JSON.parse(JSON.stringify(x));
function load(ctx, files) { for (const f of files) vm.runInContext(fs.readFileSync('gas-core/src/' + f, 'utf8'), ctx); }
function harness(overrides = {}) {
  const props = { ENV: 'test', DRY_RUN: 'false', INGEST_BATCH: 5, LEDGER_SPREADSHEET_ID: 'book', ...overrides };
  const tables = { minutes: [], change_log: [] }, logs = [], dryLogs = [], writes = [], creates = [], appends = [], propertyWrites = [];
  const files = {}, docs = {}, book = {}, docMime = 'application/vnd.google-apps.document';
  let seq = 0, failMove = false, failNotion = null, failAppend = false;
  function add(id, name, parent, mime, data) { files[id] = { id, name, parents: parent ? [parent] : [], mimeType: mime || 'application/vnd.google-apps.folder', createdTime: id, modifiedTime: 'v1', appProperties: {} }; if (data) files[id].data = data; return files[id]; }
  add('root', '_test'); add('book', '台帳', 'root', 'application/vnd.google-apps.spreadsheet');
  add('raw', '00_受信', 'root'); add('inbox', 'inbox', 'root'); add('done', '_done', 'inbox');
  add('queue', '00_仕分け待ち', 'root'); add('excluded', '99_対象外', 'root'); add('empty', '_空', 'excluded');
  const drive = {
    root: files.root,
    within(id) { const f = files[id]; if (!f) throw new Error('ファイルなし'); let c = f, n = 0; while (c.id !== 'root' && n++ < 30) { c = files[c.parents[0]]; if (!c) throw new Error('ルート外'); } return f; },
    children(id) { this.within(id); return Object.values(files).filter(f => f.parents.includes(id)); },
    folder(parent, name, create, key) { const found = this.children(parent).find(f => f.mimeType === 'application/vnd.google-apps.folder' && (key ? f.appProperties.meeting_key === key : f.name === name)); if (found) return found; if (!create) throw new Error('フォルダなし:' + name); const f = add('folder-' + (++seq), name, parent); if (key) f.appProperties.meeting_key = key; writes.push('folder'); return f; },
    move(id, dest, kind, key) { this.within(id); this.within(dest); files[id].parents = [dest]; if (key) files[id].appProperties.meeting_key = key; if (kind) files[id].appProperties.kind = kind; writes.push('move:' + id); if (failMove) { failMove = false; throw new Error('移動後の通信中断'); } return files[id]; },
    readJSON(id) { return clone(this.within(id).data); },
    createFile(parent, name, data, mime, kind, key) { const f = add('file-' + (++seq), name, parent, mime); f.appProperties = { kind, meeting_key: key }; if (mime === 'application/json') f.data = JSON.parse(data); else docs[f.id] = data; writes.push('file'); return f; }
  };
  const ledger = {
    rows(name) { return clone(tables[name] || []); },
    save(row) { const old = tables.minutes.findIndex(r => r.meeting_key === row.meeting_key); row._row = old < 0 ? tables.minutes.length + 2 : old + 2; row.version = Number(row.version || 0) + 1; if (old < 0) tables.minutes.push(clone(row)); else tables.minutes[old] = clone(row); },
    append(name, row) { (tables[name] ||= []).push(clone(row)); },
    masters() { return clone(masters); }, log(action, target, data) { dryLogs.push({ action, target, data }); }, displayId() { return 'MTG-261021-' + String(tables.minutes.length + 1).padStart(2, '0'); }
  };
  const env = {
    ids: { minutes: 'd9cc47f9-543e-4bcb-8ec8-27bebc0feac5', tasks: 'c908936a-6999-4119-9e9c-df364f5f5d1b' },
    properties: { getProperty: k => props[k], setProperty(k, v) { propertyWrites.push(k); props[k] = v; } },
    schema(id, key) { return { databaseId: id, sourceId: key + '-source', properties: key === 'minutes' ? minuteProperties : {} }; },
    project() { return null; }, verifyMinutesPage(id) { assert.ok(id.startsWith('page-') || id.startsWith('existing-')); return { id }; },
    createPage(payload) { if (failNotion === 403) { failNotion = null; const e = new Error('HTTP 403'); e.httpStatus = 403; throw e; } const page = { id: 'page-' + (creates.length + 1) }; creates.push(clone(payload)); if (failNotion === 'ambiguous') { failNotion = null; throw new Error('通信中断'); } return page; },
    appendBlocks(id, children) { if (failAppend) { failAppend = false; throw new Error('追加結果不明'); } appends.push({ id, children: clone(children) }); }
  };
  const ctx = vm.createContext({ console: { log: x => logs.push(x) }, SpreadsheetApp: { openById: () => book },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, computeDigest: (a, value) => [...crypto.createHash('sha256').update(value).digest()], formatDate: () => '2026-10-21_1400' },
    Ledger_: { withLock: fn => fn() }, Stage2Drive_: { config: () => props, open: () => drive }, Stage2Ledger_: { open: () => ledger },
    NotionTestEnvironment_: { open: () => env, normalize: v => String(v || '').replace(/-/g, '').toLowerCase() },
    UrlFetchApp: { fetch() { throw new Error('外部への実通信は禁止'); } }
  });
  load(ctx, ['meetingRules.js', 'notionFixtures.generated.js', 'inboxSchema.generated.js', 'inboxPlan.js', 'notionFixturePlan.js', 'stage2Content.js', 'ingestInbox.js']);
  ctx.Stage2Content_.read = id => { if (!docs[id]) throw new Error('Docなし'); return clone(docs[id]); };
  const masters = clone(ctx.NotionFixtures_.masters);
  masters.folders.forEach((r, i) => { add('dest-' + i, r.placement, 'root'); r.drive_folder_id = 'dest-' + i; });
  add('client', 'サンプル商事様', 'root'); masters.folders.push({ placement: '社外/サンプル商事様', drive_folder_id: 'client' });
  const minuteProperties = { '議事録名': { type: 'title' }, '日付': { type: 'date' }, '参加者': { type: 'people' }, 'MTG URL': { type: 'url' }, '事業部領域': { type: 'multi_select', multi_select: { options: ['Salesforce・AI', 'セールス・マーケ', 'EC'].map(name => ({ name })) } }, '関連するプロジェクト': { type: 'relation', relation: { data_source_id: 'tasks-source' } } };
  clone(ctx.NotionFixtures_.judgements).forEach((j, i) => {
    const key = j.meeting_key, folderKey = key.replace(/:/g, '_'), rawFolder = add('raw-' + i, folderKey, 'raw');
    const transcript = add('transcript-' + i, '文字起こし', rawFolder.id, docMime); transcript.appProperties.meeting_key = key;
    const manifest = clone(ctx.NotionFixtures_.manifests.find(m => m.meeting_key === key)); manifest.files = { transcript: transcript.id };
    add('manifest-' + i, 'manifest.json', rawFolder.id, 'application/json', manifest);
    const doc = add('doc-' + i, folderKey + '_議事録', 'inbox', docMime); doc.appProperties.meeting_key = key;
    docs[doc.id] = [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: '検証用の本文' } }] } }];
    j.minutes_doc_id = doc.id;
    const json = add('json-' + i, folderKey + '.json', 'inbox', 'application/json', j); json.appProperties.meeting_key = key;
  });
  return { ctx, props, files, docs, tables, logs, dryLogs, writes, creates, appends, propertyWrites, drive, env,
    failMove() { failMove = true; }, failNotion(value) { failNotion = value; }, failAppend() { failAppend = true; } };
}
test('純粋関数: 不足選択肢だけ追加し、既存ID・色・独自選択肢は保持します', () => {
  const h = harness(), original = [{ id: 'x', name: '独自', color: 'red' }, { id: 'y', name: '未処理', color: 'blue' }];
  const plan = h.ctx.InboxPlan_.mergeOptions(original);
  assert.equal(plan.added.length, 3); assert.deepEqual(clone(plan.options.slice(0, 2)), original);
  assert.equal(h.ctx.InboxPlan_.mergeOptions(plan.options).added.length, 0);
});
test('GAS用スキーマと原本は一致し、不正な型・追加キー・重複・必須欠落を拒否します', () => {
  const h = harness(), schema = JSON.parse(fs.readFileSync('schemas/inbox_judgement.schema.json'));
  assert.deepEqual(clone(h.ctx.InboxJudgementSchema_), schema);
  for (const change of [j => delete j.summary, j => j.sensitive = 'false', j => j.extra = 1, j => j.constructor = 'unknown-key', j => j.domains = ['EC', 'EC'], j => j.scope = '不明']) {
    const j = clone(h.ctx.NotionFixtures_.judgements[0]); change(j); assert.throws(() => h.ctx.InboxPlan_.judgement(j), /判定JSON/);
  }
  const j = clone(h.ctx.NotionFixtures_.judgements[0]); j.domains.push('独自');
  assert.equal(h.ctx.InboxPlan_.judgement(j).warnings.length, 1);
});
test('純粋関数: Docの見出し・リスト・表を変換し、リンク・文字数・100行を制御します', () => {
  const h = harness();
  const result = h.ctx.Stage2Content_.blocks([{ type: 'heading_2', text: '見出し' }, { type: 'numbered_list_item', text: '手順 https://drive.google.com/a' }, { type: 'paragraph', text: '😀'.repeat(2200) }, { type: 'table', rows: Array.from({ length: 101 }, () => ['列1', '列2']) }]);
  assert.equal(result[0].type, 'heading_2'); assert.equal(result[1].type, 'numbered_list_item');
  assert.ok(!JSON.stringify(result).includes('https://'));
  assert.equal(result[3].table.children.length, 100); assert.equal(result[4].table.children.length, 1);
  assert.ok(result[2].paragraph.rich_text.every(t => t.text.content.length <= 2000));
  assert.throws(() => h.ctx.Stage2Content_.blocks([{ type: 'table', rows: [['a'], ['b', 'c']] }]), /列数/);
});
test('Chatworkカードは録画・Driveリンクと動的なToタグを含めません', () => {
  const h = harness(), card = h.ctx.InboxPlan_.card({ title: '[To:1] https://drive.google.com/a', reason: 'https://tldv.io/x' });
  assert.ok(!card.includes('[To:')); assert.ok(!card.includes('https://')); assert.ok(card.includes('確認画面はまだ'));
});
test('DRY_RUNは台帳のdry_run_log以外を変更せず、3件の判定と投稿予定を記録します', () => {
  const h = harness({ DRY_RUN: 'true' }), results = h.ctx.ingestInbox();
  assert.deepEqual(clone(results.map(r => r.status)), ['確認待ち', '確認待ち', '仕分け待ち']);
  assert.equal(h.writes.length, 0); assert.equal(h.creates.length, 0); assert.equal(h.tables.minutes.length, 0); assert.equal(h.propertyWrites.length, 0);
  assert.equal(h.dryLogs.filter(r => r.action === 'Chatwork投稿予定').length, 3);
});
test('実取り込みは3行・3フォルダ・Notion3ページを作り、JSONを_doneへ移し、再実行は重複しません', () => {
  const h = harness(), result = h.ctx.ingestInbox();
  assert.deepEqual(clone(result.map(r => r.status)), ['確認待ち', '確認待ち', '仕分け待ち']);
  assert.equal(h.creates.length, 3); assert.equal(h.tables.minutes.length, 3); assert.equal(h.tables.change_log.length, 3);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(h.files['json-' + i].parents, ['done']); assert.deepEqual(h.files['raw-' + i].parents, ['empty']);
    assert.equal(JSON.parse(h.tables.minutes[i].step_done_json).chatwork, 'log_only');
  }
  assert.equal(h.dryLogs.filter(r => r.action === 'Chatwork投稿予定（トークン未設定）').length, 3);
  h.ctx.ingestInbox(); assert.equal(h.creates.length, 3); assert.equal(h.tables.change_log.length, 3);
});
test('前回のNOTION_FIXTURE記録があれば、既存ページを再利用しNotionへ書き込みません', () => {
  const h = harness();
  h.ctx.NotionFixtures_.judgements.forEach((j, i) => h.props['NOTION_FIXTURE:' + h.env.ids.minutes.replace(/-/g, '') + ':' + j.meeting_key] = JSON.stringify({ state: 'created', pageId: 'existing-' + i }));
  h.ctx.ingestInbox(); assert.equal(h.creates.length, 0);
  assert.ok(h.tables.minutes.every(r => r.notion_status === '作成済み（再利用）'));
});
test('移動後の通信失敗は再検査で続行し、フォルダ・Notionを二重作成しません', () => {
  const h = harness(); h.failMove();
  assert.equal(h.ctx.ingestInbox()[0].status, '要対応');
  h.ctx.retryInboxErrors(); h.ctx.ingestInbox();
  assert.equal(h.creates.length, 3); assert.equal(h.tables.minutes.length, 3);
  assert.equal(h.tables.minutes[0].status, '確認待ち');
});
test('Notion403でもDrive・台帳・投稿予定を完了し、権限復旧後の再実行で残りだけ作ります', () => {
  const h = harness(); h.failNotion(403);
  const result = h.ctx.ingestInbox(); assert.equal(result[0].notion_status, 'Notion保留');
  assert.deepEqual(h.files['json-0'].parents, ['done']); assert.equal(h.creates.length, 2);
  h.ctx.ingestInbox(); assert.equal(h.creates.length, 3);
  assert.equal(h.tables.minutes[0].notion_status, '作成済み');
});
test('Notion作成応答が失われてもpendingにより二重作成しません', () => {
  const h = harness(); h.failNotion('ambiguous'); h.ctx.ingestInbox();
  h.ctx.retryInboxErrors(); h.ctx.ingestInbox(); assert.equal(h.creates.length, 3);
  assert.equal(h.tables.minutes[0].status, '要対応');
});
test('100ブロックを超える本文は分割し、追記結果不明の場合は二重追記しません', () => {
  const h = harness(); h.docs['doc-0'] = Array.from({ length: 205 }, () => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [] } }));
  h.ctx.ingestInbox(); assert.equal(h.creates[0].children.length, 100);
  assert.deepEqual(h.appends.map(a => a.children.length), [100, 5]);
  const interrupted = harness(); interrupted.docs['doc-0'] = h.docs['doc-0']; interrupted.failAppend(); interrupted.ctx.ingestInbox();
  interrupted.ctx.retryInboxErrors(); interrupted.ctx.ingestInbox(); assert.equal(interrupted.appends.length, 0);
  assert.equal(interrupted.creates.length, 3);
});
test('不正JSONや別会議のファイルはNotionへ送らず、他の会議は処理します', () => {
  const h = harness(); h.files['json-0'].data.sensitive = 'false'; h.files['transcript-1'].appProperties.meeting_key = 'other';
  const result = h.ctx.ingestInbox(); assert.equal(result.filter(r => r.status === '要対応').length, 2);
  assert.equal(h.creates.length, 1);
});
test('マイドライブ用Driveアダプタはルート外・ショートカット・DRY_RUNの移動を拒否します', () => {
  const meta = { root: { id: 'root', name: '_test', parents: ['system'], ownedByMe: true, mimeType: 'application/vnd.google-apps.folder', appProperties: { minutes_test_env: 'uuid', kind: 'test_root' } }, system: { id: 'system', name: '_system', appProperties: { minutes_test_env: 'uuid', kind: 'system' } }, safe: { id: 'safe', parents: ['root'] }, outside: { id: 'outside', parents: [] }, shortcut: { id: 'shortcut', parents: ['root'], mimeType: 'application/vnd.google-apps.shortcut' } };
  let writes = 0;
  const ctx = vm.createContext({ Drive: { Files: { get: id => meta[id], update() { writes++; } } } });
  load(ctx, ['stage2Drive.js']);
  const config = { ENV: 'test', DRY_RUN: 'true', TEST_ENV_KEY: 'uuid', FOLDER_SYSTEM_TEST_ID: 'root' }, drive = ctx.Stage2Drive_.open(config);
  assert.equal(drive.within('safe').id, 'safe'); assert.throws(() => drive.within('outside'), /ルート外/); assert.throws(() => drive.within('shortcut'), /ショートカット/);
  assert.throws(() => drive.move('safe', 'root'), /DRY_RUN/); assert.equal(writes, 0);
  assert.throws(() => ctx.Stage2Drive_.open({ ...config, ENV: 'prod' }));
});
