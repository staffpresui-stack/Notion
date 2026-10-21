const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const clone = x => JSON.parse(JSON.stringify(x));
function harness(dryRun = 'false', shared = false) {
  const props = { ENV: 'test', DRY_RUN: dryRun }, files = {}, books = {}, writes = [], calls = [];
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
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({ ...props }), getProperty: k => props[k], setProperty(k, v) { writes.push('property'); props[k] = v; }, deleteProperty(k) { writes.push('property-delete'); delete props[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { getUuid: () => 'test-env-uuid', newBlob: (content, mime, name) => ({ content, mime, name }), formatDate: (d, zone, format) => format === 'yyMMdd' ? '261021' : '2026-10-21', DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, computeDigest: (a, value) => [...crypto.createHash('sha256').update(value).digest()] },
    SpreadsheetApp: { openById: id => { assert.ok(books[id]); return books[id]; } },
    Drive: { Files: {
      get(id, options) { calls.push({ method: 'get', id, options }); assert.equal(options.supportsAllDrives, true); assert.ok(files[id]); return clone(files[id]); },
      list(options) {
        calls.push({ method: 'list', options });
        assert.equal(options.corpora, shared ? 'drive' : 'user'); assert.equal(options.driveId, shared ? 'shared-drive' : undefined); assert.equal(options.supportsAllDrives, true);
        const parent = /^'([^']+)' in parents/.exec(options.q)[1];
        const foldersOnly = options.q.includes("mimeType='application/vnd.google-apps.folder'");
        return { files: Object.values(files).filter(f => f.parents.includes(parent) && (!foldersOnly || f.mimeType === 'application/vnd.google-apps.folder')).map(clone) };
      },
      create(body, media, options) {
        assert.equal(options.supportsAllDrives, true); const id = 'f' + (++seq);
        calls.push({ method: 'create', body: clone(body), options });
        if (shared) assertInside(body.parents[0]);
        files[id] = { ...clone(body), id, ownedByMe: !shared, createdTime: new Date(1700000000000 + seq).toISOString(), modifiedTime: id };
        if (shared) files[id].driveId = 'shared-drive';
        if (media) files[id].content = media.content;
        if (body.mimeType === 'application/vnd.google-apps.spreadsheet') books[id] = book();
        writes.push('create'); return clone(files[id]);
      },
      update(body, id, media, options) {
        calls.push({ method: 'update', id, body: clone(body), options });
        assert.equal(options.supportsAllDrives, true);
        if (shared) { assertInside(id); if (options.addParents) assertInside(options.addParents); assert.equal(body.name, undefined); }
        Object.assign(files[id], clone(body));
        if(media) files[id].content=media.content;
        if (options.removeParents) files[id].parents = files[id].parents.filter(p => !options.removeParents.split(',').includes(p));
        if (options.addParents && !files[id].parents.includes(options.addParents)) files[id].parents.push(options.addParents);
        writes.push('update'); return clone(files[id]);
      }
    } }
  });
  function assertInside(id) {
    let cursor = files[id];
    for (let n = 0; n < 30; n++) { assert.ok(cursor); if (cursor.id === 'shared-test') return; cursor = files[cursor.parents[0]]; }
    assert.fail('共有ドライブの_test外への書き込みは禁止');
  }
  ctx.DriveApp = { getFileById: id => ({ getBlob: () => ({ getDataAsString: () => files[id].content }) }) };
  ctx.DocumentApp = { openById: id => ({ getBody() {
    const paragraphs = String(files[id].content || '').split('</p>').map(p => p.replace(/<[^>]+>/g, '')).filter(Boolean);
    return { getNumChildren: () => paragraphs.length, getChild: i => ({ getType: () => 'PARAGRAPH', asParagraph: () => ({ getHeading: () => 'NORMAL', getText: () => paragraphs[i] }) }) };
  } }) };
  if (shared) {
    Object.assign(props, { SHARED_DRIVE_ID: 'shared-drive', FOLDER_SYSTEM_ID: 'shared-system', FOLDER_SYSTEM_TEST_ID: 'shared-test', LEDGER_SPREADSHEET_ID: 'shared-book' });
    const add = (id, name, parent, mime) => files[id] = { id, name, parents: [parent], mimeType: mime || 'application/vnd.google-apps.folder', driveId: 'shared-drive', ownedByMe: false, appProperties: {} };
    add('shared-system', '_system', 'shared-drive');
    add('shared-test', '_test', 'shared-system'); files['shared-test'].appProperties.keep = 'existing';
    add('shared-book', '台帳（テスト）', 'shared-test', 'application/vnd.google-apps.spreadsheet'); books['shared-book'] = book();
    add('production-book', '台帳（本番）', 'shared-system', 'application/vnd.google-apps.spreadsheet');
    add('production-raw', '00_受信', 'shared-system');
    for (const name of ['社内', '社外', '00_仕分け待ち', '99_対象外', '00_受信', 'inbox', 'ref']) add('existing-' + name, name, 'shared-test');
    add('existing-done', '_done', 'existing-inbox');
    for (const name of ['事業部全体', 'セールス・マーケ', 'EC', '生産管理', '経理・バックオフィス', 'Salesforce・AI', '経営']) add('existing-' + name, name, 'existing-社内');
    props.FOLDER_INBOX_RAW_TEST_ID = 'existing-00_受信';
  }
  for (const file of ['ledger.js', 'stage2Ledger.js', 'stage2Drive.js', 'notionFixtures.generated.js', 'stage2Content.js']) vm.runInContext(fs.readFileSync('gas-core/src/' + file, 'utf8'), ctx);
  return { ctx, props, files, books, writes, calls };
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
test('共有ドライブ準備は既存構成を採用し、_system・本番台帳を一切変更しません', () => {
  const h = harness('false', true), original = clone(h.files), prepared = h.ctx.setupSharedTestWorkspace();
  assert.equal(prepared.root, 'shared-test'); assert.equal(prepared.ledger, 'shared-book');
  assert.equal(h.files['shared-test'].appProperties.keep, 'existing');
  assert.equal(h.files['shared-test'].appProperties.kind, 'test_root');
  for (const id of Object.keys(original).filter(id => id !== 'shared-test')) assert.deepEqual(h.files[id], original[id]);
  assert.equal(h.books['shared-book'].sheets.masters_folders.data.length, 9);
  const created = h.calls.filter(c => c.method === 'create');
  assert.deepEqual(created.map(c => c.body.name).sort(), ['_空', 'サンプル商事様'].sort());
  assert.equal(h.calls.filter(c => c.method === 'update').length, 1);
  const count = Object.keys(h.files).length, beforeWrites = h.calls.filter(c => ['create', 'update'].includes(c.method)).length;
  h.ctx.setupSharedTestWorkspace(); assert.equal(Object.keys(h.files).length, count);
  assert.equal(h.calls.filter(c => ['create', 'update'].includes(c.method)).length, beforeWrites);
});
test('共有ドライブのDRY_RUNは所属・台帳だけを読み、目印・フォルダ・プロパティを変更しません', () => {
  const h = harness('true', true), original = clone(h.files), props = clone(h.props);
  h.ctx.setupSharedTestWorkspace(); assert.deepEqual(h.files, original); assert.deepEqual(h.props, props); assert.equal(h.writes.length, 0);
});
test('別ドライブ・別の_system・_test外の台帳・本番台帳・権限不足・異なる目印を無書き込みで拒否します', () => {
  const changes = [h => h.files['shared-test'].driveId = 'other-drive', h => h.files['shared-system'].parents = ['other-drive'], h => h.files['shared-system'].name = 'system', h => h.files['shared-book'].parents = ['shared-system'], h => h.files['shared-test'].capabilities = { canEdit: false }, h => { h.props.TEST_ENV_KEY = 'different'; h.files['shared-test'].appProperties.minutes_test_env = 'original'; }];
  for (const change of changes) { const h = harness('false', true); change(h); assert.throws(() => h.ctx.setupSharedTestWorkspace()); assert.equal(h.writes.length, 0); }
  const h = harness('false', true); h.props.LEDGER_SPREADSHEET_ID = '137IuSH4nGulMcsB5-IKqvIXkw8SiQrFBjFNSAeXNt0c';
  assert.throws(() => h.ctx.setupSharedTestWorkspace(), /本番台帳/); assert.equal(h.writes.length, 0);
});
test('共有ドライブ準備は3つのID引数を受け取り、不完全な引数は拒否します', () => {
  const h = harness('false', true);
  delete h.props.SHARED_DRIVE_ID; delete h.props.FOLDER_SYSTEM_TEST_ID; delete h.props.LEDGER_SPREADSHEET_ID;
  assert.throws(() => h.ctx.setupSharedTestWorkspace('shared-drive'), /3つのID/);
  assert.equal(h.writes.length, 0);
  const result = h.ctx.setupSharedTestWorkspace('shared-drive', 'shared-test', 'shared-book'); assert.equal(result.ledger, 'shared-book');
});
test('共有ドライブ上のseedFixtureInboxとingestInboxは実Driveアダプタで動き、corpora=driveとsupportsAllDrivesを維持します', () => {
  const h = harness('false', true), ctx = h.ctx; h.ctx.setupSharedTestWorkspace();
  const propertyService = ctx.PropertiesService.getScriptProperties(); let creates = 0;
  const known = { minutes: 'notion-test-minutes', tasks: 'notion-test-tasks' };
  const minutesSchema = { databaseId: known.minutes, sourceId: 'minutes-source', properties: {
    '議事録名': { type: 'title' }, '日付': { type: 'date' }, '参加者': { type: 'people' }, 'MTG URL': { type: 'url' },
    '事業部領域': { type: 'multi_select', multi_select: { options: ['Salesforce・AI', 'EC', 'セールス・マーケ'].map(name => ({ name })) } },
    '関連するプロジェクト': { type: 'relation', relation: { data_source_id: 'tasks-source' } }
  } };
  ctx.NotionTestEnvironment_ = { normalize: v => String(v).replace(/-/g, ''), open: () => ({ ids: known, properties: propertyService, schema: (id, key) => key === 'minutes' ? minutesSchema : { databaseId: id, sourceId: 'tasks-source' }, project: () => null, createPage: () => ({ id: 'notion-page-' + (++creates) }), verifyMinutesPage: id => ({ id }), appendBlocks() {} }) };
  ctx.UrlFetchApp = { fetch() { assert.fail('Chatworkトークン無しで外部通信してはならない'); } };
  for (const file of ['inboxSchema.generated.js', 'inboxPlan.js', 'meetingRules.js', 'notionFixturePlan.js', 'ingestInbox.js']) vm.runInContext(fs.readFileSync('gas-core/src/' + file, 'utf8'), ctx);
  h.ctx.seedFixtureInbox(); const initialFiles = Object.keys(h.files).length;
  h.ctx.seedFixtureInbox(); assert.equal(Object.keys(h.files).length, initialFiles);
  h.props.DRY_RUN = 'true'; const before = h.calls.filter(c => ['create', 'update'].includes(c.method)).length;
  assert.deepEqual(clone(ctx.ingestInbox().map(r => r.status)), ['確認待ち', '確認待ち', '仕分け待ち']);
  assert.equal(h.calls.filter(c => ['create', 'update'].includes(c.method)).length, before); assert.equal(creates, 0);
  h.props.DRY_RUN = 'false'; const result = ctx.ingestInbox();
  assert.deepEqual(clone(result.map(r => r.status)), ['確認待ち', '確認待ち', '仕分け待ち']); assert.equal(creates, 3);
  assert.equal(h.books['shared-book'].sheets.minutes.data.length, 4);
  const jsons = Object.values(h.files).filter(f => (f.appProperties || {}).kind === 'judgement');
  assert.equal(jsons.length, 3); assert.ok(jsons.every(f => f.parents[0] === 'existing-done'));
  const lists = h.calls.filter(c => c.method === 'list'); assert.ok(lists.length > 0);
  assert.ok(lists.every(c => c.options.corpora === 'drive' && c.options.driveId === 'shared-drive' && c.options.supportsAllDrives));
  ctx.ingestInbox(); assert.equal(creates, 3);
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
test('Drive所属確認は同一リクエスト内で共有祖先を再取得せず、移動後は対象を再取得する',()=>{
 const h=harness('false',true);h.ctx.setupSharedTestWorkspace();h.ctx.seedFixtureInbox();h.calls.length=0;const drive=h.ctx.Stage2Drive_.open(h.ctx.Stage2Drive_.config());const raw=drive.folder(drive.root.id,'00_受信',false),file=drive.children(raw.id)[0];drive.within(file.id);const count=h.calls.filter(c=>c.method==='get').length;drive.within(file.id);assert.equal(h.calls.filter(c=>c.method==='get').length,count);const dest=drive.folder(drive.root.id,'99_対象外',false);drive.move(file.id,dest.id);const n=h.calls.filter(c=>c.method==='get').length;assert.equal(drive.within(file.id).parents[0],dest.id);assert.equal(h.calls.filter(c=>c.method==='get').length,n+1);
});
test('高速台帳は使用シートを1回ずつまとめて取得し、更新後も同一要求内で最新値を返す',()=>{
 const h=harness();const setup=h.ctx.setupTestWorkspace(),book=h.books[setup.ledger];let reads=0;for(const sheet of Object.values(book.sheets)){const range=sheet.getRange;sheet.getRange=(...args)=>{const r=range(...args),get=r.getValues;return {...r,getValues:()=>{reads++;return get()}}}};
 const ledger=h.ctx.Stage2Ledger_.open(book,true);ledger.rows('masters_people');ledger.rows('masters_people');assert.equal(reads,1);const r={meeting_key:'test',status:'確認待ち'};ledger.save(r);assert.equal(reads,2);r.status='確定';ledger.save(r);assert.equal(ledger.rows('minutes')[0].status,'確定');assert.equal(reads,2);
 const fresh=h.ctx.Stage2Ledger_.open(book,true);assert.equal(fresh.rows('minutes')[0].status,'確定');assert.equal(reads,3);
});

function referenceHarness() {
  const h=harness('false',true);h.ctx.setupSharedTestWorkspace();
  h.ctx.Session={getActiveUser:()=>({getEmail:()=> 'finance@premiere-mode.co.jp'}),getEffectiveUser:()=>({getEmail:()=> 'finance@premiere-mode.co.jp'})};
  h.props.NOTION_DB_TASKS_TEST='c908936a-6999-4119-9e9c-df364f5f5d1b';
  const projects=[{id:'project1',title:'テストPJ',status:'進行中',domains:['EC'],parent_ids:[],due:null}];
  h.ctx.NotionTestEnvironment_={open:(writing,purpose)=>{assert.equal(writing,false);assert.equal(purpose,'ref-export');return {ids:{tasks:h.props.NOTION_DB_TASKS_TEST},schema(){},referenceProjects:()=>clone(projects)}}};
  for(const name of ['reviewSecurity','reviewCache','refExportPlan','exportRef'])vm.runInContext(fs.readFileSync('gas-core/src/'+name+'.js','utf8'),h.ctx);
  h.writes.length=0;h.calls.length=0;return {...h,projects};
}
test('共有ドライブの参照ファイル2件を作成し、2回目は同じIDで内容だけ更新する',()=>{
  const h=referenceHarness(),first=h.ctx.exportRef();assert.equal(Object.keys(first.files).length,2);const id=first.files['projects.json'];assert.equal(JSON.parse(h.files[id].content).projects[0].title,'テストPJ');
  const masters=JSON.parse(h.files[first.files['masters.json']].content);assert.ok(masters.people[0].google_email);assert.equal('chatwork_account_id' in masters.people[0],false);assert.equal('drive_folder_id' in masters.folders[0],false);
  h.projects[0].title='変更後';h.writes.length=0;const second=h.ctx.exportRef();assert.deepEqual(clone(second.files),clone(first.files));assert.equal(JSON.parse(h.files[id].content).projects[0].title,'変更後');assert.equal(h.writes.filter(w=>w==='create').length,0);assert.equal(Object.values(h.files).filter(f=>f.name==='projects.json').length,1);
  assert.ok(h.calls.filter(c=>c.method==='update').every(c=>!c.options.addParents&&!c.options.removeParents&&!c.body.name));
});
test('参照DRY_RUNは件数と予定だけでDrive・台帳・スクリプトプロパティを変更しない',()=>{
  const h=referenceHarness();h.props.DRY_RUN='true';const before=clone(h.files),props=clone(h.props);const r=h.ctx.exportRef();assert.equal(r.dryRun,true);assert.equal(r.counts.projects,1);assert.equal(h.writes.length,0);assert.deepEqual(h.files,before);assert.deepEqual(h.props,props);assert.equal(h.books['shared-book'].sheets.dry_run_log.getLastRow(),1);
});
test('重複・不正MIME・ref外への移動・Notion取得失敗・ENV本番は既存ファイルを更新しない',()=>{
 for(const change of [h=>{h.files.copy={...h.files[h.ids['projects.json']],id:'copy'}},h=>{h.files[h.ids['projects.json']].mimeType='application/vnd.google-apps.document'},h=>{h.files['existing-ref'].parents=['shared-system']},h=>{h.ctx.NotionTestEnvironment_.open=()=>{throw Error('Notion HTTP 403')}},h=>h.props.ENV='prod']){
  const h=referenceHarness();h.ids=h.ctx.exportRef().files;h.writes.length=0;change(h);assert.throws(()=>h.ctx.exportRef());assert.equal(h.writes.length,0);
 }
});
test('作成応答が不明でも次回は既存IDを再利用し、見つからなければ二重作成せず停止する',()=>{
 const h=referenceHarness(),create=h.ctx.Drive.Files.create;let once=true;h.ctx.Drive.Files.create=(...args)=>{const f=create(...args);if(once){once=false;throw Error('応答不明')}return f};assert.throws(()=>h.ctx.exportRef(),/応答不明/);const first=Object.values(h.files).find(f=>f.name==='masters.json');const r=h.ctx.exportRef();assert.equal(r.files['masters.json'],first.id);
 const x=referenceHarness();x.props['REF_EXPORT_PENDING:shared-test:masters.json']='作成結果不明';assert.throws(()=>x.ctx.exportRef(),/二重作成/);assert.equal(x.writes.length,0);
});
test('参照更新トリガーは毎朝日本時間6時台に1個だけ、DRY_RUN・解除は他トリガーを触らない',()=>{
 const h=referenceHarness(),triggers=[{getHandlerFunction:()=> 'other'}];let hour,zone,days;
 h.ctx.ScriptApp={getProjectTriggers:()=>triggers.slice(),newTrigger:name=>({timeBased(){return this},atHour(v){hour=v;return this},everyDays(v){days=v;return this},inTimezone(v){zone=v;return this},create(){const t={getHandlerFunction:()=>name,getUniqueId:()=> '123'};triggers.push(t);return t}}),deleteTrigger:t=>triggers.splice(triggers.indexOf(t),1)};
 h.props.DRY_RUN='true';h.ctx.setupRefExportTrigger();assert.equal(triggers.length,1);h.props.DRY_RUN='false';h.ctx.setupRefExportTrigger();h.ctx.setupRefExportTrigger();assert.equal(triggers.length,2);assert.equal(hour,6);assert.equal(days,1);assert.equal(zone,'Asia/Tokyo');h.ctx.removeRefExportTrigger();assert.equal(triggers.length,1);assert.equal(triggers[0].getHandlerFunction(),'other');
});
test('Notion取得後にrefが_test外へ移動しても、実更新直前に検知して停止する',()=>{
 const h=referenceHarness();h.ctx.exportRef();h.writes.length=0;const open=h.ctx.NotionTestEnvironment_.open;
 h.ctx.NotionTestEnvironment_.open=(...args)=>({...open(...args),referenceProjects:()=>{h.files['existing-ref'].parents=['shared-system'];return clone(h.projects)}});
 assert.throws(()=>h.ctx.exportRef(),/refフォルダの所属/);assert.equal(h.writes.length,0);
});
