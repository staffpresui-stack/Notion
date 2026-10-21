const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const clone=x=>JSON.parse(JSON.stringify(x));
const minutes='d9cc47f9-543e-4bcb-8ec8-27bebc0feac5',tasks='c908936a-6999-4119-9e9c-df364f5f5d1b',parent='400ca178-7419-80e8-bb9a-f157874b6105';
function harness(dry='false'){
 const props={ENV:'test',DRY_RUN:dry,NOTION_TOKEN:'test-only',NOTION_DB_MINUTES_TEST:minutes,NOTION_DB_TASKS_TEST:tasks};
 const schema={},calls=[],cache=new Map();let badParent=false,archived=false;
 const ctx=vm.createContext({console:{log(){}},Utilities:{sleep(){}},CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)})},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]})},UrlFetchApp:{fetch(url,o){const path=url.split('/v1/')[1],body=o.payload&&JSON.parse(o.payload);calls.push({path,method:o.method,body});let data={};if(path.startsWith('databases/')){const id=path.split('/')[1];data={id,parent:{type:'page_id',page_id:parent},data_sources:[{id:id+'-source'}]}}else if(path.startsWith('data_sources/')){const id=path.split('/')[1];if(o.method==='patch')Object.assign(schema,body.properties);data={id,parent:{database_id:id.replace(/-source$/,'')},properties:clone(schema)}}else{data={id:path.split('/')[1],archived,parent:{type:'data_source_id',data_source_id:(badParent?'production':minutes)+'-source'}}}return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(data)}}}});
 for(const name of ['reviewCache','reviewSecurity','reviewPlan','notionTestEnvironment'])vm.runInContext(fs.readFileSync('gas-core/src/'+name+'.js','utf8'),ctx);
 function open(purpose='review-setup'){const e=ctx.NotionTestEnvironment_.open(true,purpose);e.schema(minutes,'minutes');return e}
 return {ctx,props,schema,calls,open,bad:()=>badParent=true,archived:()=>archived=true};
}
test('確認状態の準備はテストDSだけに不足分を追加し、既存選択肢ID・色・独自項目を保持、再実行は追加なし',()=>{
 const h=harness();h.schema['確認状態']={type:'select',select:{options:[{id:'old',name:'確定',color:'green'},{id:'custom',name:'独自',color:'blue'}]}};
 let e=h.open();e.prepareReviewStatus();const patch=h.calls.find(c=>c.method==='patch');assert.equal(patch.path,'data_sources/'+minutes+'-source');assert.deepEqual(patch.body.properties['確認状態'].select.options.slice(0,2),[{id:'old',name:'確定',color:'green'},{id:'custom',name:'独自',color:'blue'}]);assert.ok(patch.body.properties['確認状態'].select.options.some(o=>o.name==='対象外'));const n=h.calls.filter(c=>c.method==='patch').length;e=h.open();e.prepareReviewStatus();assert.equal(h.calls.filter(c=>c.method==='patch').length,n);
});
test('準備DRY_RUNと型違い・本番IDはスキーマもページも変更しない',()=>{
 const h=harness('true');h.open().prepareReviewStatus();assert.equal(h.calls.filter(c=>c.method==='patch').length,0);h.props.DRY_RUN='false';h.schema['確認状態']={type:'status',status:{}};assert.throws(()=>h.open().prepareReviewStatus(),/select型/);assert.equal(h.calls.filter(c=>c.method==='patch').length,0);h.props.NOTION_DB_MINUTES_TEST='4cf02dee-7a11-4319-ace1-e866d6a1a914';assert.throws(()=>h.open(),/確認済みテストDB/);
});
test('対象外の送信内容は確認状態だけ。ゴミ箱引数・未復元ページ・本番所属ページは拒否',()=>{
 const h=harness(),e=h.open('review');e.updateReviewPage('page',{'確認状態':{select:{name:'対象外'}}});assert.deepEqual(h.calls.at(-1).body,{properties:{'確認状態':{select:{name:'対象外'}}}});assert.throws(()=>e.updateReviewPage('page',{},true),/ゴミ箱/);assert.throws(()=>e.updateReviewPage('page',{in_trash:true}),/ゴミ箱/);h.archived();assert.throws(()=>h.open('review').updateReviewPage('other',{}),/テスト議事録DB/);const x=harness();x.bad();assert.throws(()=>x.open().updateReviewPage('prod',{}),/テスト議事録DB/);assert.ok(x.calls.every(c=>c.method==='get'));
});
test('表示用schemaキャッシュがあっても更新用schemaは必ず実APIで再確認',()=>{
 const h=harness();let e=h.ctx.NotionTestEnvironment_.open(true,'review');e.schema(minutes,'minutes',true);const n=h.calls.length;e=h.ctx.NotionTestEnvironment_.open(true,'review');e.schema(minutes,'minutes',true);assert.equal(h.calls.length,n);e.schema(minutes,'minutes');assert.equal(h.calls.length,n+2);
});
test('旧archiveジャーナルの再開は状態更新に変換し、旧完了履歴は保持する',()=>{
 const h=harness();const journal={state:'failed',notion:true,drive:true,plan:{archive:true,action:'exclude'}};h.ctx.ReviewPlan_.migrateJournal(journal);assert.equal(journal.plan.exclude,true);assert.equal(journal.notion,false);assert.equal(journal.drive,true);assert.equal('archive' in journal.plan,false);const done={state:'done',notion:true,plan:{archive:true}};h.ctx.ReviewPlan_.migrateJournal(done);assert.equal(done.notion,true);
});
test('追加準備関数は復元済みの既存3ページを状態同期し、DRY_RUNではページも台帳も変えない',()=>{
 for(const dry of ['true','false']){
  const h=harness(dry),rows=['確定・修正あり','保留','対象外'].map((status,i)=>({meeting_key:'k'+i,display_id:'MTG-'+i,notion_page_id:'page'+i,status,version:7,step_done_json:JSON.stringify({jsonId:'json'+i,hash:'hash',review:{state:'done',notion:true,plan:{archive:status==='対象外'}}})}));let saves=0;
  h.ctx.Session={getActiveUser:()=>({getEmail:()=> 'finance@premiere-mode.co.jp'})};h.ctx.Ledger_={withLock:fn=>fn()};h.ctx.Review_={context:()=>({c:{DRY_RUN:dry},ledger:{rows:()=>rows,save:r=>{saves++;r.version++},log(){} }}),source:()=>({summary:{decisions:['決定事項']},taskCount:1})};
  vm.runInContext(fs.readFileSync('gas-core/src/reviewSetup.js','utf8'),h.ctx);const result=h.ctx.setupReviewNotionStatus();assert.equal(result.pages,3);const writes=h.calls.filter(c=>c.method==='patch');assert.equal(writes.length,dry==='true'?0:4);assert.equal(saves,dry==='true'?0:3);for(const c of writes)assert.equal(Object.hasOwn(c.body,'archived')||Object.hasOwn(c.body,'in_trash'),false);
  if(dry==='false'){assert.deepEqual(writes.slice(1).map(c=>c.body.properties['確認状態'].select.name),['確定・修正あり','保留','対象外']);assert.equal(rows[2].notion_status,'反映済み（対象外）');assert.equal(JSON.parse(rows[2].step_done_json).reviewDisplay.taskCount,1)}
 }
});
