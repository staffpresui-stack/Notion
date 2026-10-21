// 既存テスト3件にも状態を反映します。本番DB・ゴミ箱・ページ本文は変更しません。
function setupReviewNotionStatus() {
  assertFinanceOperator_();
  return Ledger_.withLock(function () {
    var c=Review_.context(), env=NotionTestEnvironment_.open(true,'review-setup');
    var schema=env.schema(env.ids.minutes,'minutes'), statePlan=ReviewPlan_.statusSchema(schema.properties['確認状態']);
    var plannedSchema={properties:Object.assign({},schema.properties,{'確認状態':{type:'select',select:{options:statePlan.options}}})};
    var rows=c.ledger.rows('minutes').filter(function(r){return !!r.notion_page_id;}), seen=new Set();
    // 全件を先に検証し、本番ページや未復元ページが混じっていたら準備を開始しません。
    rows.forEach(function(r){
      var pageKey=NotionTestEnvironment_.normalize(r.notion_page_id);
      if(seen.has(pageKey)) throw new Error('NotionページIDが台帳で重複しています。先に確認してください。');
      seen.add(pageKey); ReviewPlan_.statusProperties(r.status,plannedSchema);
      env.verifyMinutesPage(r.notion_page_id);
    });
    env.prepareReviewStatus();
    rows.forEach(function(r){
      var props=ReviewPlan_.statusProperties(r.status,plannedSchema);
      console.log(r.display_id+'：確認状態を「'+r.status+'」にする予定です。');
      c.ledger.log('Notion確認状態の準備予定',r.meeting_key,JSON.stringify(props));
      if(c.c.DRY_RUN==='true') return;
      // ページ更新は同じ状態への上書きです。途中失敗しても再実行できます。
      env.updateReviewPage(r.notion_page_id,props);
      var steps=r.step_done_json ? JSON.parse(r.step_done_json) : {};
      steps.review=ReviewPlan_.migrateJournal(steps.review);
      if(!steps.review) delete steps.review;
      var display=Review_.source(c,r);
      var snapshot={jsonId:steps.jsonId,hash:steps.hash,summary:display.summary,taskCount:display.taskCount||0};
      if(!display.summary.error && JSON.stringify(snapshot).length<12000) steps.reviewDisplay=snapshot;
      r.step_done_json=JSON.stringify(steps);r.notion_status='反映済み（'+r.status+'）';c.ledger.save(r);
    });
    ReviewCache_.remove('schema:'+NotionTestEnvironment_.normalize(env.ids.minutes));
    console.log(c.c.DRY_RUN==='true'?'予定確認のみです。次はDRY_RUN=falseで同じ関数を実行してください。':'確認状態と既存ページを準備しました。DRY_RUN=trueへ戻してください。');
    return {dryRun:c.c.DRY_RUN==='true',pages:rows.length,added:statePlan.added};
  });
}
