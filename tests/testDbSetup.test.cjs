const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const clone = x => JSON.parse(JSON.stringify(x));
const parent = '400ca178-7419-80e8-bb9a-f157874b6105';
const prodM = '4cf02dee-7a11-4319-ace1-e866d6a1a914';
const prodT = 'e321f1cb-3365-4a2c-9844-47f34734a9d7';
const testM = '11111111-1111-4111-8111-111111111111';
const testT = '22222222-2222-4222-8222-222222222222';
const prop = (type, extra = {}) => ({ type, [type]: extra });
function sourceSchemas() {
  return {
    minutes: { databaseId: prodM, sourceId: 'prod-minutes-source', properties: {
      '議事録名': prop('title'), '日付': prop('date'),
      '事業部領域': prop('multi_select', { options: [{ id: 'prod-option', name: 'EC', color: 'blue' }] }),
      '関連するプロジェクト': prop('relation', { data_source_id: 'prod-tasks-source', type: 'dual_property', dual_property: { synced_property_name: '関連するMTG' } }),
      '計算': prop('formula', { expression: '1' }), '集計': prop('rollup'),
    } },
    tasks: { databaseId: prodT, sourceId: 'prod-tasks-source', properties: {
      'プロジェクト/タスク名': prop('title'),
      'ステータス': prop('status', { options: [{ name: '未着手' }] }),
      '優先度': prop('select', { options: [{ id: 'prod-option', name: '高', color: 'red' }] }),
      '金額': prop('number', { format: 'yen' }),
      '関連するMTG': prop('relation', { data_source_id: 'prod-minutes-source', type: 'dual_property', dual_property: { synced_property_name: '関連するプロジェクト' } }),
      '親アイテム': prop('relation', { data_source_id: 'prod-tasks-source', type: 'single_property', single_property: {} }),
      '外部DB': prop('relation', { database_id: 'outside-db', data_source_id: 'outside-source' })
    } }
  };
}
function harness(settings = {}, mutate) {
  const calls = [], logs = [], sources = sourceSchemas(), dbs = {}, dataSources = {};
  for (const [key, s] of Object.entries(sources)) {
    dbs[s.databaseId] = { id: s.databaseId, parent: { type: 'page_id', page_id: 'production-parent' }, data_sources: [{ id: s.sourceId }] };
    dataSources[s.sourceId] = { id: s.sourceId, parent: { type: 'database_id', database_id: s.databaseId }, properties: clone(s.properties) };
  }
  const props = { ENV: 'test', DRY_RUN: 'true', SETUP_CREATE_TEST_DB: 'true', NOTION_TOKEN: 'fake-token-for-tests', ...settings };
  let released = 0, writes = 0;
  const context = vm.createContext({ console: { log: s => logs.push(s) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => released++ }) },
    Utilities: { sleep() {} },
    UrlFetchApp: { fetch(url, options) {
      const path = url.split('/v1/')[1], method = options.method;
      const body = options.payload && JSON.parse(options.payload);
      calls.push({ method, path, body, version: options.headers['Notion-Version'] });
      let result;
      if (method === 'get' && path.startsWith('blocks/')) {
        const items = Object.values(dbs).filter(d => d.parent.page_id === parent).map(d => ({ id: d.id, type: 'child_database', child_database: { title: d.title[0].text.content } }));
        // 常にページネーションを使い、2ページ目の既存DBも検出させます。
        result = path.includes('start_cursor=') ? { results: items.slice(1), has_more: false } : { results: items.slice(0, 1), has_more: items.length > 1, next_cursor: 'second' };
      } else if (method === 'get' && path.startsWith('databases/')) result = dbs[decodeURIComponent(path.slice(10))];
      else if (method === 'get' && path.startsWith('data_sources/')) result = dataSources[decodeURIComponent(path.slice(13))];
      else if (method === 'post' && path === 'databases') {
        writes++;
        const minutes = body.title[0].text.content === 'MTG議事録（テスト）';
        const id = minutes ? testM : testT, sourceId = minutes ? 'test-minutes-source' : 'test-tasks-source';
        assert.ok(!dbs[id], '同じDBの二重作成は禁止');
        dbs[id] = { id, parent: body.parent, title: body.title, data_sources: [{ id: sourceId }] };
        dataSources[sourceId] = { id: sourceId, parent: { type: 'database_id', database_id: id }, properties: clone(body.initial_data_source.properties) };
        result = dbs[id];
      } else if (method === 'patch' && path.startsWith('data_sources/')) {
        writes++;
        const sourceId = path.slice(13), source = dataSources[sourceId];
        assert.ok(sourceId.startsWith('test-'), '本番DSへの書き込みは禁止');
        for (const [name, property] of Object.entries(body.properties)) {
          const p = clone(property), r = p.relation;
          assert.ok(r.data_source_id.startsWith('test-'), '本番DSへの参照は禁止');
          assert.ok(!source.properties[name], '既存項目を上書きしてはならない');
          source.properties[name] = p;
          if (r.type === 'dual_property') {
            const reverseName = r.dual_property.synced_property_name;
            const other = dataSources[r.data_source_id];
            assert.ok(!other.properties[reverseName], '相手側の二重生成は禁止');
            other.properties[reverseName] = prop('relation', { data_source_id: sourceId, type: 'dual_property', dual_property: { synced_property_name: name } });
          }
        }
        result = source;
      } else throw new Error('想定外のリクエスト: ' + method + ' ' + path);
      if (mutate) result = mutate({ method, path, body, result, dbs, dataSources }) || result;
      if (!result) throw new Error('想定外のID: ' + path);
      const snapshot = JSON.stringify(result);
      return { getResponseCode: () => 200, getContentText: () => snapshot };
    } }
  });
  for (const file of ['testDbSchema.js', 'setupTestDatabases.js']) vm.runInContext(fs.readFileSync('gas-core/src/' + file, 'utf8'), context);
  return { context, calls, logs, dbs, dataSources, sources, props, released: () => released, writes: () => writes };
}
test('純粋関数: 項目名・型・選択肢・数値形式を保持し、本番のoption IDや計算型を送信しません', () => {
  const h = harness(), pure = h.context.TestDbSchema_;
  const before = clone(h.sources);
  const m = pure.scalarProperties(h.sources.minutes.properties), t = pure.scalarProperties(h.sources.tasks.properties);
  assert.equal(m.properties['議事録名'].type, 'title');
  assert.deepEqual(clone(t.properties['優先度']), { type: 'select', select: { options: [{ name: '高', color: 'red' }] } });
  assert.equal(t.properties['金額'].number.format, 'yen');
  assert.deepEqual(clone(m.skipped.map(s => s.type)), ['formula', 'rollup']);
  assert.equal(t.skipped[0].type, 'status');
  assert.ok(!m.properties['関連するプロジェクト']);
  assert.deepEqual(h.sources, before);
  assert.throws(() => pure.scalarProperties({ '本文': prop('rich_text') }), /タイトル/);
});
test('純粋関数: 双方向・親アイテムをテストDSに置換し、対象外リレーションをスキップします', () => {
  const h = harness(), pure = h.context.TestDbSchema_;
  const plan = pure.relations(h.sources);
  assert.equal(plan.edges.length, 2);
  assert.equal(plan.skipped[0].name, '外部DB');
  const targets = { minutes: { sourceId: 'test-m' }, tasks: { sourceId: 'test-t' } };
  assert.deepEqual(clone(pure.relationProperty(plan.edges[0], targets)), { type: 'relation', relation: {
    data_source_id: 'test-t', type: 'dual_property', dual_property: { synced_property_name: '関連するMTG' }
  } });
  assert.equal(pure.relationProperty(plan.edges[1], targets).relation.data_source_id, 'test-t');
});
test('純粋関数: 相手不明の双方向リレーションは不正なDBを作る前に拒否します', () => {
  const h = harness(); delete h.sources.tasks.properties['関連するMTG'];
  assert.throws(() => h.context.TestDbSchema_.relations(h.sources), /相手項目/);
});
test('純粋関数: 親子の双方向自己参照を1組のテスト用リレーションとして計画します', () => {
  const h = harness(), props = h.sources.tasks.properties;
  props['親アイテム'].relation = { data_source_id: 'prod-tasks-source', type: 'dual_property', dual_property: { synced_property_name: '子アイテム' } };
  props['子アイテム'] = prop('relation', { data_source_id: 'prod-tasks-source', type: 'dual_property', dual_property: { synced_property_name: '親アイテム' } });
  const edges = h.context.TestDbSchema_.relations(h.sources).edges;
  const self = edges.filter(e => e.from === 'tasks' && e.to === 'tasks');
  assert.equal(self.length, 1);
  assert.equal(self[0].name, '親アイテム');
  assert.equal(self[0].reverseName, '子アイテム');
});
test('純粋関数: 既存項目の型・選択肢・数値形式を上書きせず検証します', () => {
  const h = harness(), pure = h.context.TestDbSchema_;
  const expected = pure.scalarProperties(h.sources.tasks.properties).properties;
  pure.assertCompatible(h.sources.tasks.properties, expected);
  for (const alteration of [p => p['優先度'].select.options[0].name = '違う', p => p['金額'].number.format = 'dollar', p => p['金額'].type = 'rich_text']) {
    const changed = clone(h.sources.tasks.properties); alteration(changed);
    assert.throws(() => pure.assertCompatible(changed, expected), /異なります/);
  }
});
test('実行条件が欠けると、GETも書き込みも行いません', () => {
  for (const override of [{ ENV: 'prod' }, { SETUP_CREATE_TEST_DB: 'false' }, { SETUP_CREATE_TEST_DB: undefined }, { NOTION_TOKEN: '' }]) {
    const h = harness(override);
    assert.throws(() => h.context.setupTestDatabases());
    assert.equal(h.calls.length, 0);
  }
});
test('初回は管理ページに2DBを作り、双方向・自己参照はテストDSだけに接続します', () => {
  const h = harness(), before = clone(h.dataSources['prod-minutes-source']);
  const result = h.context.setupTestDatabases();
  assert.deepEqual(clone(result), { NOTION_DB_MINUTES_TEST: testM, NOTION_DB_TASKS_TEST: testT });
  const posts = h.calls.filter(c => c.method === 'post');
  assert.equal(posts.length, 2);
  assert.ok(posts.every(c => c.body.parent.page_id === parent && c.body.initial_data_source));
  assert.ok(h.calls.every(c => c.version === '2025-09-03'));
  assert.ok(h.calls.filter(c => c.path.includes(prodM) || c.path.includes(prodT) || c.path.includes('prod-')).every(c => c.method === 'get'));
  assert.deepEqual(h.dataSources['prod-minutes-source'], before);
  assert.equal(h.dataSources['test-minutes-source'].properties['関連するプロジェクト'].relation.data_source_id, 'test-tasks-source');
  assert.equal(h.dataSources['test-tasks-source'].properties['関連するMTG'].relation.data_source_id, 'test-minutes-source');
  assert.equal(h.dataSources['test-tasks-source'].properties['親アイテム'].relation.data_source_id, 'test-tasks-source');
  assert.ok(h.logs.some(s => s.includes('SETUP_CREATE_TEST_DB')));
  assert.ok(!h.logs.join('\n').includes('fake-token-for-tests'));
  assert.equal(h.released(), 1);
});
test('再実行時はページネーションで同名DBを検出し、新規作成も再PATCHもしません', () => {
  const h = harness(); h.context.setupTestDatabases();
  const before = h.writes();
  assert.equal(h.context.setupTestDatabases().NOTION_DB_MINUTES_TEST, testM);
  assert.equal(h.writes(), before);
  assert.ok(h.calls.some(c => c.path.includes('start_cursor=second')));
});
test('同名DBが複数ある場合は、候補を勝手に選ばず書き込み前に停止します', () => {
  const h = harness(); h.context.setupTestDatabases();
  h.dbs['duplicate'] = { ...clone(h.dbs[testM]), id: 'duplicate' };
  const before = h.writes();
  assert.throws(() => h.context.setupTestDatabases(), /同名DBが複数/);
  assert.equal(h.writes(), before);
});
test('一方のDB作成後に中断しても、再実行で残りだけを作ります', () => {
  let fail = true;
  const h = harness({}, ({ method, path, result }) => {
    if (fail && method === 'get' && path === 'databases/' + testM) { fail = false; throw new Error('通信中断'); }
    return result;
  });
  assert.throws(() => h.context.setupTestDatabases(), /通信中断/);
  assert.equal(h.released(), 1);
  h.context.setupTestDatabases();
  assert.equal(h.calls.filter(c => c.method === 'post').length, 2);
});
test('既存リレーションが本番を指している場合は修正・上書きしません', () => {
  const h = harness(); h.context.setupTestDatabases();
  h.dataSources['test-minutes-source'].properties['関連するプロジェクト'].relation.data_source_id = 'prod-tasks-source';
  const before = h.writes();
  assert.throws(() => h.context.setupTestDatabases(), /上書きしません/);
  assert.equal(h.writes(), before);
});
test('作成結果のDSが本番DSの場合は、PATCHを送る前に拒否します', () => {
  const h = harness({}, ({ method, path, result }) => {
    if (method === 'get' && path === 'databases/' + testM) result.data_sources = [{ id: 'prod-minutes-source' }];
    return result;
  });
  assert.throws(() => h.context.setupTestDatabases(), /所属|本番/);
  assert.equal(h.calls.filter(c => c.method === 'patch').length, 0);
});
