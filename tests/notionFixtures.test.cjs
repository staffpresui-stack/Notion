const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const clone = x => JSON.parse(JSON.stringify(x));
const parent = '400ca178-7419-80e8-bb9a-f157874b6105';
const minutesId = 'd9cc47f9-543e-4bcb-8ec8-27bebc0feac5';
const tasksId = 'c908936a-6999-4119-9e9c-df364f5f5d1b';
const inboxId = '400ca178-7419-80dd-a3e0-ef9e2267a64c';
const prop = (type, config = {}) => ({ type, [type]: config });
function schemaProperties() {
  const opts = ['セールス・マーケ', 'EC', '生産管理', '経理・バックオフィス', 'Salesforce・AI', '経営'].map(name => ({ name }));
  return {
    minutes: { '議事録名': prop('title'), '日付': prop('date'), '参加者': prop('people'), 'MTG URL': prop('url'),
      '事業部領域': prop('multi_select', { options: opts }), '関連するプロジェクト': prop('relation', { data_source_id: 'tasks-source' }) },
    tasks: { '依頼者': prop('people'), 'プロジェクト/タスク名': prop('title'), 'ステータス': prop('status', { options: ['未着手', '保留', '進行中', '対応不要', '完了'].map(name => ({ name })) }),
      '期日': prop('date'), '担当者': prop('people'), '備考': prop('rich_text'), '完了条件': prop('rich_text'), '事業部領域': prop('multi_select', { options: opts }), '関連するMTG': prop('relation'), '親アイテム': prop('relation') },
    inbox: { '名前': prop('title'), '取り込み状態': prop('select', { options: ['未処理', '取り込み済み', '対象外（Meet優先）', 'エラー'].map(name => ({ name })) }),
      'meeting_key': prop('rich_text'), '日付': prop('date'), '会議URL': prop('url'), '長さ': prop('number'), '参加者': prop('rich_text'), 'AIメモ': prop('rich_text'), 'トランスクリプト': prop('rich_text') }
  };
}
function harness(settings = {}, customize) {
  const properties = { ENV: 'test', DRY_RUN: 'true', NOTION_TOKEN: 'fake-token-for-tests', NOTION_DB_MINUTES_TEST: minutesId, NOTION_DB_TASKS_TEST: tasksId, NOTION_DB_TLDV_INBOX: inboxId, ...settings };
  const calls = [], logs = [], sets = [], schemas = schemaProperties(), pages = [];
  let release = 0, ambiguous = false, relationPage = null;
  const env = { calls, logs, sets, schemas, pages, properties, release: () => release,
    ambiguousCreate() { ambiguous = true; }, relatedPage(page) { relationPage = page; } };
  const ctx = vm.createContext({ console: { log: x => logs.push(x) }, Utilities: { sleep() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => properties[k], setProperty(k, v) { sets.push(k); properties[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() { release++; } }) },
    UrlFetchApp: { fetch(url, options) {
      const path = url.split('/v1/')[1], body = options.payload && JSON.parse(options.payload);
      const call = { path, method: options.method, body, version: options.headers['Notion-Version'] };
      calls.push(call);
      let response, status = 200;
      if (path.startsWith('databases/')) {
        const id = path.slice(10), key = id === minutesId ? 'minutes' : id === tasksId ? 'tasks' : id === inboxId ? 'inbox' : null;
        assert.ok(key, '本番を含む対象外DBを取得しない');
        response = { id, parent: { type: 'page_id', page_id: parent }, data_sources: [{ id: key + '-source' }] };
      } else if (path.startsWith('data_sources/')) {
        const id = path.slice(13), key = id.replace('-source', '');
        response = { id, parent: { database_id: key === 'minutes' ? minutesId : key === 'tasks' ? tasksId : inboxId }, properties: schemas[key] };
      } else if (path.startsWith('blocks/')) {
        response = path.includes('start_cursor=') ? { results: [{ id: inboxId, type: 'child_database', child_database: { title: 'tl;dv 受信' } }], has_more: false } : { results: [], has_more: true, next_cursor: 'next-page' };
      } else if (path.startsWith('pages/')) {
        response = relationPage || { code: 'object_not_found' }; status = relationPage ? 200 : 404;
      } else if (path === 'pages' && options.method === 'post') {
        assert.equal(body.parent.data_source_id, 'minutes-source');
        pages.push(body); response = { id: 'new-page-' + pages.length };
        if (ambiguous) { ambiguous = false; throw new Error('network error with secret fake-token-for-tests'); }
      } else throw new Error('想定外のリクエスト');
      if (customize) response = customize(call, response) || response;
      return { getResponseCode: () => status, getContentText: () => JSON.stringify(response) };
    } }
  });
  for (const file of ['meetingRules.js', 'notionFixtures.generated.js', 'notionFixturePlan.js', 'notionTestEnvironment.js', 'ingestFixturesToNotionTest.js', 'inboxPlan.js']) {
    vm.runInContext(fs.readFileSync('gas-core/src/' + file, 'utf8'), ctx);
  }
  return { ...env, ctx };
}
test('埋め込んだ判定3件・マスタはfixtures原本と一致します', () => {
  const h = harness(), embedded = clone(h.ctx.NotionFixtures_);
  const read = name => JSON.parse(fs.readFileSync('fixtures/' + name + '.json'));
  assert.deepEqual(embedded.judgements, ['judgement_internal_high', 'judgement_external_high', 'judgement_external_low'].map(read));
  assert.deepEqual(embedded.masters, read('masters_sample'));
  assert.equal(embedded.manifests.length, 3);
});
test('純粋関数: SPECとの差分は欠落・型・選択肢・追加項目を一覧にします', () => {
  const h = harness(), compare = h.ctx.NotionFixturePlan_.compareSchema;
  assert.equal(compare('minutes', h.schemas.minutes).differences.length, 0);
  delete h.schemas.tasks['ステータス']; h.schemas.tasks['期日'] = prop('rich_text');
  h.schemas.tasks['事業部領域'].multi_select.options = [{ name: 'EC' }, { name: '独自' }];
  h.schemas.tasks['依頼者'] = prop('people');
  const differences = clone(compare('tasks', h.schemas.tasks).differences);
  assert.ok(differences.some(d => d.name === 'ステータス' && d.actual === '未設定'));
  assert.ok(differences.some(d => d.name === '期日' && d.actual === 'rich_text'));
  assert.ok(differences.some(d => d.kind === '選択肢' && d.extra.includes('独自')));
  assert.ok(!differences.some(d => d.name === '依頼者'));
  h.schemas.tasks['依頼者'] = prop('rich_text');
  assert.ok(compare('tasks', h.schemas.tasks).differences.some(d => d.name === '依頼者'));
  assert.ok(!compare('tasks', h.schemas.tasks, 'rich_text').differences.some(d => d.name === '依頼者'));
  delete h.schemas.inbox['トランスクリプト'];
  assert.ok(compare('inbox', h.schemas.inbox).differences.some(d => d.kind === '本文での提供可・要確認'));
});
test('既知のタスク追加項目3件は差分にせず、既知の追加項目として返します', () => {
  const h = harness();
  for (const name of ['関連プロジェクト（参照元）', 'サブアイテム', '関連プロジェクト']) h.schemas.tasks[name] = prop('relation');
  const result = h.ctx.NotionFixturePlan_.compareSchema('tasks', h.schemas.tasks);
  assert.equal(result.differences.length, 0); assert.equal(result.knownAdditions.length, 3);
});
test('tl;dv選択肢修復はDRY_RUNで無書き込み、実行時は既存ID・色・名前を保持します', () => {
  for (const dryRun of ['true', 'false']) {
    const h = harness({ DRY_RUN: dryRun });
    h.schemas.inbox['取り込み状態'].select.options = [{ id: 'existing-1', name: '独自の状態', color: 'red' }, { id: 'existing-2', name: '未処理', color: 'blue' }];
    const result = h.ctx.NotionTestEnvironment_.open(true, 'inbox-options').addInboxOptions();
    assert.equal(result.added.length, 3);
    const updates = h.calls.filter(c => c.method === 'patch');
    assert.equal(updates.length, dryRun === 'true' ? 0 : 1);
    if (updates.length) {
      assert.equal(updates[0].path, 'data_sources/inbox-source');
      assert.deepEqual(updates[0].body.properties['取り込み状態'].select.options.slice(0, 2), clone(h.schemas.inbox['取り込み状態'].select.options));
    }
  }
});
test('接続確認は全DBを読み、子DBのページネーションも処理し、設定もNotionも変更しません', () => {
  const h = harness();
  const result = h.ctx.checkTestEnvironment();
  assert.equal(result.databases.length, 3); assert.equal(result.inboxId, inboxId);
  assert.equal(result.differences.length, 0);
  assert.ok(h.calls.every(c => c.method === 'get' && c.version === '2025-09-03'));
  assert.equal(h.sets.length, 0);
  assert.ok(h.logs.some(s => s.includes('NOTION_DB_TLDV_INBOX = ' + inboxId)));
});
test('tl;dv受信DBがない場合、他の2DBの取得結果と発見失敗を返します', () => {
  const h = harness({}, (call, response) => call.path.startsWith('blocks/') ? { results: [], has_more: false } : response);
  const result = h.ctx.checkTestEnvironment();
  assert.equal(result.databases.length, 2);
  assert.ok(result.differences.some(d => d.database === 'inbox' && d.kind === '取得失敗'));
  assert.equal(h.sets.length, 0);
});
test('DRY_RUNは判定3件の予定をログに出し、POST・重複防止記録の書き込みを行いません', () => {
  const h = harness(), result = h.ctx.ingestFixturesToNotionTest();
  assert.deepEqual(clone(result.map(r => r.status)), ['確認待ち', '確認待ち', '仕分け待ち']);
  assert.ok(result.every(r => r.dryRun));
  assert.equal(h.pages.length, 0); assert.equal(h.sets.length, 0);
  assert.ok(h.calls.every(c => c.method === 'get'));
  assert.equal(h.logs.filter(s => s.startsWith('DRY_RUN・送信予定')).length, 3);
  assert.ok(h.logs.some(s => s.includes('送信しない関連PJ')));
  assert.equal(h.release(), 1);
});
test('実書き込みはテスト議事録DBに3ページだけ作り、二度目は同meeting_keyを作りません', () => {
  const h = harness({ DRY_RUN: 'false' });
  const result = h.ctx.ingestFixturesToNotionTest();
  assert.equal(h.pages.length, 3);
  assert.ok(result.every(r => r.pageId));
  assert.equal(h.sets.length, 6);
  for (const body of h.pages) {
    assert.equal(body.parent.data_source_id, 'minutes-source');
    assert.equal(body.properties['参加者'].people.length, 0);
    assert.equal(body.properties['関連するプロジェクト'].relation.length, 0);
    assert.equal(body.properties['MTG URL'].url, null);
    assert.ok(!JSON.stringify(body).includes('task_proposals'));
    assert.ok(!JSON.stringify(body).includes('https://'));
    assert.ok(body.children.length <= 100);
  }
  h.ctx.ingestFixturesToNotionTest();
  assert.equal(h.pages.length, 3);
  assert.ok(!h.logs.join('\n').includes('fake-token-for-tests'));
});
test('作成成功後に応答が失われてもpendingを残し、再実行で二重作成しません', () => {
  const h = harness({ DRY_RUN: 'false' }); h.ambiguousCreate();
  const first = h.ctx.ingestFixturesToNotionTest();
  assert.equal(first[0].status, '要対応');
  const result = h.ctx.ingestFixturesToNotionTest();
  assert.equal(result[0].status, '作成結果未確認・再作成しません');
  assert.equal(h.pages.length, 3);
  assert.ok(!h.logs.join('\n').includes('fake-token-for-tests'));
});
test('本番ID・不明なENVやDRY_RUNでは、外部リクエスト前に停止します', () => {
  for (const settings of [{ ENV: 'prod' }, { DRY_RUN: 'FALSE' }, { DRY_RUN: undefined }, { NOTION_DB_MINUTES_TEST: '4cf02dee-7a11-4319-ace1-e866d6a1a914' }, { NOTION_DB_TASKS_TEST: 'e321f1cb-3365-4a2c-9844-47f34734a9d7' }]) {
    const h = harness(settings);
    assert.throws(() => h.ctx.ingestFixturesToNotionTest());
    assert.equal(h.calls.length, 0);
  }
});
test('関連PJはテストタスク所属だけを送信し、本番・他DB所属ページは除外します', () => {
  const projectId = '00000000-0000-0000-0000-000000000001';
  for (const source of ['tasks-source', 'production-source']) {
    const h = harness({ DRY_RUN: 'false' });
    h.relatedPage({ id: projectId, parent: { type: 'data_source_id', data_source_id: source } });
    h.ctx.ingestFixturesToNotionTest();
    assert.equal(h.pages[0].properties['関連するプロジェクト'].relation.length, source === 'tasks-source' ? 1 : 0);
  }
});
test('純粋関数: DBにない選択肢と6択以外の値を除外し、URL・長い本文を安全に整形します', () => {
  const h = harness(), j = clone(h.ctx.NotionFixtures_.judgements[0]), manifest = clone(h.ctx.NotionFixtures_.manifests.find(m => m.meeting_key === j.meeting_key));
  j.domains = ['EC', '経営', '独自']; j.summary.decisions = ['長文'.repeat(2001) + ' https://drive.google.com/secret'];
  h.schemas.minutes['事業部領域'].multi_select.options = [{ name: 'EC' }];
  const result = h.ctx.NotionFixturePlan_.plan(j, manifest, clone(h.ctx.NotionFixtures_.masters), { sourceId: 'minutes-source', properties: h.schemas.minutes }, { sourceId: 'tasks-source' }, []);
  assert.deepEqual(clone(result.payload.properties['事業部領域'].multi_select), [{ name: 'EC' }]);
  assert.ok(result.warnings.some(w => w.includes('経営') && w.includes('独自')));
  assert.ok(!JSON.stringify(result.payload).includes('https://'));
  for (const b of result.payload.children) for (const t of b[b.type].rich_text) assert.ok(t.text.content.length <= 2000);
});
test('必須項目やリレーションの参照先が違えば、ページを作る前に停止します', () => {
  for (const change of [s => delete s.minutes['日付'], s => s.minutes['関連するプロジェクト'].relation.data_source_id = 'production-source']) {
    const h = harness({ DRY_RUN: 'false' }); change(h.schemas);
    assert.throws(() => h.ctx.ingestFixturesToNotionTest());
    assert.equal(h.pages.length, 0); assert.equal(h.sets.length, 0);
  }
});
test('検証済みDBでも親ページが違えば、書き込み前に停止します', () => {
  const h = harness({ DRY_RUN: 'false' }, (call, response) => {
    if (call.path === 'databases/' + minutesId) response.parent.page_id = 'wrong-parent';
    return response;
  });
  assert.throws(() => h.ctx.ingestFixturesToNotionTest(), /管理用ページ/);
  assert.equal(h.pages.length, 0);
});

test('確認画面専用PATCHは検証済みテストページだけ、DRY_RUN時は拒否', () => {
  // 実クライアントの検証は専用の最小HTTP環境で行います。
  const props = { ENV:'test', DRY_RUN:'false', NOTION_TOKEN:'fake-token-for-tests', NOTION_DB_MINUTES_TEST:minutesId, NOTION_DB_TASKS_TEST:tasksId };
  const calls=[];
  const ctx=vm.createContext({Utilities:{sleep(){}},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]})},UrlFetchApp:{fetch(url,o){const path=url.split('/v1/')[1];calls.push({path,method:o.method,body:o.payload&&JSON.parse(o.payload)});let data;if(path.startsWith('databases/')){const id=path.split('/')[1];data={id,parent:{type:'page_id',page_id:parent},data_sources:[{id:id+'-source'}]}}else if(path.startsWith('data_sources/')&&o.method==='get'){const id=path.split('/')[1];data={id,parent:{database_id:id.replace(/-source$/,'')},properties:{}}}else if(path.endsWith('/query'))data={results:[],has_more:false};else data={id:'test-page',archived:props.archived===true,parent:{type:'data_source_id',data_source_id:props.badParent?'production-source':minutesId+'-source'}};return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(data)}}}});
  vm.runInContext(fs.readFileSync('gas-core/src/notionTestEnvironment.js','utf8'),ctx);
  function open(){const e=ctx.NotionTestEnvironment_.open(true,'review');e.schema(minutesId,'minutes');e.schema(tasksId,'tasks');return e}
  let e=open();e.updateReviewPage('test-page',{'議事録名':{title:[]}},false);assert.equal(calls.at(-1).method,'patch');
  props.archived=true;e.updateReviewPage('test-page',null,true);assert.equal(calls.at(-1).body.archived,true);
  props.badParent=true;assert.throws(()=>e.updateReviewPage('test-page',null,true),/テスト議事録DB/);
  props.badParent=false;props.archived=false;props.DRY_RUN='true';e=open();assert.deepEqual(clone(e.projects()),[]);const n=calls.filter(c=>c.method==='patch').length;assert.throws(()=>e.updateReviewPage('test-page',{},false),/書き込みは禁止/);assert.equal(calls.filter(c=>c.method==='patch').length,n);
});
