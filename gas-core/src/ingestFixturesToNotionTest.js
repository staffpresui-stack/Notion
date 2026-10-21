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
      var saved = env.properties.getProperty(key), plan = item.plan;
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
