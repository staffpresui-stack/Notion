const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const clone=x=>JSON.parse(JSON.stringify(x));
function scene(dry='false'){
 const props={},writes=[],calls=[],triggers=[],logs=[],c={ENV:'prod',DRY_RUN:dry,SHARED_DRIVE_ID:'drive',raw:'raw',root:'system'},files={meeting:{id:'meeting',parents:['raw'],driveId:'drive'},manifest:{id:'manifest',name:'manifest.json',parents:['meeting'],properties:{minutes_role:'manifest',minutes_env:'prod'}}};let changes=[],now=Date.now(),fail=false;
 const store={getProperty:k=>props[k]||null,setProperty:(k,v)=>{props[k]=v;writes.push(k);},deleteProperty:k=>delete props[k]},ctx=vm.createContext({Date:class extends Date{static now(){return now;}},console:{log:v=>logs.push(v)},PropertiesService:{getScriptProperties:()=>store},ServiceConfig_:{load:()=>clone(c)},Session:{getEffectiveUser:()=>({getEmail:()=> 'finance@premiere-mode.co.jp'})},assertFinanceOperator_:()=>{},Ledger_:{withLock:fn=>fn()},GoogleApi_:{call:(name,fn)=>fn(),get:(id,args)=>{calls.push('get');assert.equal(args.supportsAllDrives,true);assert.ok(files[id],id);return clone(files[id]);},list:args=>{calls.push('list');assert.equal(args.corpora,'drive');assert.equal(args.driveId,'drive');return {files:Object.values(files).filter(f=>f.name==='manifest.json').map(clone)};}},Drive:{Changes:{getStartPageToken:args=>{calls.push('start');return {startPageToken:'begin'};},list:(pageToken,args)=>{assert.equal(typeof pageToken,'string');assert.ok(pageToken);assert.equal('pageToken' in args,false);calls.push('changes');assert.equal(args.driveId,'drive');assert.equal(args.supportsAllDrives,true);const page={newStartPageToken:'next',changes:clone(changes)};changes=[];return page;}}},NotesPipeline_:{run:()=>{calls.push('heavy');if(fail)throw Error('Notion failure');files.meeting.parents=['empty'];files.manifest.parents=['finished'];files.finished={id:'finished',parents:['business'],driveId:'drive'};return [{status:'作成済み'}];}},ScriptApp:{getProjectTriggers:()=>triggers.slice(),deleteTrigger:t=>triggers.splice(triggers.indexOf(t),1),newTrigger:name=>({timeBased(){return this},everyMinutes(n){assert.equal(n,1);return this},create(){const t={getHandlerFunction:()=>name};triggers.push(t);return t;}})}});
 require('./helpers/advancedContracts.cjs').enforce(ctx);
 for(const f of ['fastBudget.generated','fastIngest'])vm.runInContext(fs.readFileSync('gas-core/src/'+f+'.js','utf8'),ctx);
 return {ctx,props,writes,calls,files,c,triggers,logs,advance:s=>now+=s*1000,fail:v=>fail=v,change:f=>changes.push({file:f})};
}
test('A初回は受信を読み戻し、待機中は差分API1回だけでNotion・台帳・案件を読まない',()=>{
 const h=scene();delete h.files.manifest;assert.equal(h.ctx.FastIngest_.run().status,'新しい受信なし');h.calls.length=0;h.ctx.FastIngest_.run();assert.deepEqual(h.calls,['changes']);
});
test('Aへ新しいmanifestが届けば15分を待たず重い処理を1回だけ呼び、完了後は軽い待機へ戻る',()=>{
 const h=scene();const r=h.ctx.FastIngest_.run();assert.equal(r[0].status,'作成済み');assert.equal(h.calls.filter(v=>v==='heavy').length,1);assert.equal(JSON.parse(h.props['FAST_INGEST:prod:queue']).length,0);h.calls.length=0;h.ctx.FastIngest_.run();assert.deepEqual(h.calls,['changes']);
});
test('AプレビューはDRY_RUN=falseを変更せず、Drive・カーソル・キュー・重い処理を更新しない',()=>{
 const h=scene();const r=h.ctx.previewFastNotes();assert.equal(r.dryRun,true);assert.equal(r.pending,1);assert.deepEqual(h.props,{});assert.ok(!h.calls.includes('heavy'));assert.equal(h.ctx.ServiceConfig_.load().DRY_RUN,'false');
});
test('別環境・別親・通常文書の変更を新規会議と誤認しない',()=>{
 const h=scene();delete h.files.manifest;h.ctx.FastIngest_.run();const cases=[{id:'test',name:'manifest.json',parents:['meeting'],properties:{minutes_role:'manifest',minutes_env:'test'}},{id:'doc',name:'議事録',parents:['meeting']},{id:'outside',name:'manifest.json',parents:['other'],properties:{minutes_role:'manifest',minutes_env:'prod'}}];h.files.other={id:'other',parents:['elsewhere'],driveId:'drive'};for(const f of cases)h.change(f);h.ctx.FastIngest_.run();assert.ok(!h.calls.includes('heavy'));
});
test('取り込み失敗でもキューを残し、5分の再試行待ちで1分ごとの重い連続照会を避ける',()=>{
 const h=scene();h.fail(true);assert.throws(()=>h.ctx.FastIngest_.run());assert.deepEqual(JSON.parse(h.props['FAST_INGEST:prod:queue']),['manifest']);h.ctx.FastIngest_.run();assert.equal(h.calls.filter(v=>v==='heavy').length,1);h.advance(301);h.fail(false);h.ctx.FastIngest_.run();assert.equal(h.calls.filter(v=>v==='heavy').length,2);assert.equal(JSON.parse(h.props['FAST_INGEST:prod:queue']).length,0);
});
test('1分タイマーの作成は冪等で通常15分トリガーを残し、DRY_RUNは作成しない',()=>{
 const h=scene();h.triggers.push({getHandlerFunction:()=> 'automationTick_'});h.ctx.setupFastNotesTrigger();h.ctx.setupFastNotesTrigger();assert.equal(h.triggers.length,2);h.ctx.removeFastNotesTrigger();assert.equal(h.triggers.length,1);assert.equal(h.triggers[0].getHandlerFunction(),'automationTick_');h.c.DRY_RUN='true';h.ctx.setupFastNotesTrigger();assert.equal(h.triggers.length,1);
});
test('短間隔実行の実測をJST日次で集計、90分到達で通常経路に戻し、翌日は再開',()=>{
 const h=scene(),key='FAST_BUDGET:prod:A:finance@premiere-mode.co.jp';let count=0;h.ctx.FastBudget_.run(h.c,'finance@premiere-mode.co.jp','A',()=>{h.advance(3);count++;});let r=JSON.parse(h.props[key]);assert.equal(r.runs,1);assert.equal(r.ms,3000);r.ms=90*60000;h.props[key]=JSON.stringify(r);h.ctx.FastBudget_.run(h.c,'finance@premiere-mode.co.jp','A',()=>count++);assert.equal(count,1);h.advance(86401);h.ctx.FastBudget_.run(h.c,'finance@premiere-mode.co.jp','A',()=>count++);assert.equal(count,2);
});
