const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const clone=x=>JSON.parse(JSON.stringify(x));
const error=(message,code,details)=>Object.assign(new Error(message),code?{code}:{},details?{details}:{});
function harness(){
 const props={},files={},sleeps=[],logs=[],creates=[],updates=[];let idSeq=0;
 const ctx=vm.createContext({console:{log:s=>logs.push(s)},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(a,s)=>[...crypto.createHash(a).update(s).digest()],sleep:n=>sleeps.push(n)},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k],setProperty:(k,v)=>props[k]=v,deleteProperty:k=>delete props[k]})},Drive:{Files:{
  generateIds:()=>({ids:['reserved-'+(++idSeq)]}),
  get(id,args){assert.equal(args.supportsAllDrives,true);if(id==='parent')return {id,driveId:'shared'};if(!files[id])throw error('File not found',404);return clone(files[id]);},
  list(args){assert.equal(args.supportsAllDrives,true);assert.equal(args.corpora,'drive');assert.equal(args.driveId,'shared');return {files:Object.values(files).map(clone)};},
  create(body,blob,args){assert.equal(args.supportsAllDrives,true);creates.push(clone(body));const f={...clone(body),id:body.id||'native-'+(++idSeq)};files[f.id]=f;return clone(f);},
  update(body,id,blob,args){updates.push({body:clone(body),id,blob,args:clone(args)});return {id};}
 }},Docs:{Documents:{get:()=>({documentId:'doc'})}}});
 vm.runInContext(fs.readFileSync('shared/googleApi.js','utf8'),ctx);return {ctx,api:ctx.GoogleApi_,props,files,sleeps,logs,creates,updates};
}
test('再試行対象は5xx・Internal/Backend Error・rate limitのみ。権限・不在・不正値は即停止',()=>{
 const h=harness();for(const e of [error('Internal Error'),error('Backend Error'),error('bad',503),error('HTTP 502'),error('bad',null,{error:{code:500}}),error('too many requests',429),error('rateLimitExceeded',403),error('User rate limit exceeded')])assert.notEqual(h.api.classify(e),'permanent',e.message);
 for(const e of [error('Permission denied',403),error('File not found',404),error('Internal Error',400),error('dailyLimitExceeded',403),error('Invalid argument'),error('quota RESOURCE_EXHAUSTED')])assert.equal(h.api.classify(e),'permanent',e.message);
});
test('get/list/Docsは0.5→1→2→4秒の最大4回再試行。引数を保持し秘密値をログに出さない',()=>{
 for(const method of ['get','list','docsGet']){const h=harness();let calls=0;const operation=(...args)=>{calls++;if(calls<=4)throw error('Internal Error private-meeting');return {ok:true,args};};if(method==='docsGet')h.ctx.Docs.Documents.get=operation;else h.ctx.Drive.Files[method]=operation;const args=method==='list'?[{supportsAllDrives:true,corpora:'drive',driveId:'test'}]:['secret-id',{supportsAllDrives:true,includeTabsContent:true}];const r=h.api[method](...args);assert.equal(calls,5);assert.deepEqual(h.sleeps,[500,1000,2000,4000]);assert.deepEqual(clone(r.args),args);assert.ok(h.logs.every(s=>!s.includes('private-meeting')&&!s.includes('secret-id')));}
 const h=harness();let calls=0;h.ctx.Drive.Files.get=()=>{calls++;throw error('Internal Error');};assert.throws(()=>h.api.get('id',{}),/Internal/);assert.equal(calls,5);
 for(const code of [400,401,403,404]){const h=harness();let calls=0;h.ctx.Drive.Files.get=()=>{calls++;throw error('denied',code);};assert.throws(()=>h.api.get('id',{}));assert.equal(calls,1);assert.equal(h.sleeps.length,0);}
});
test('updateの応答失敗後は現在の親を読み直し、完了済みのadd/removeを繰り返さない',()=>{
 const h=harness();h.files.file={id:'file',parents:['old']};let count=0;h.ctx.Drive.Files.update=(body,id,blob,args)=>{h.updates.push(clone(args));if(!count++){h.files.file.parents=['new'];throw error('Backend Error');}return {id};};h.api.update({appProperties:{kind:'minutes'}},'file',null,{supportsAllDrives:true,addParents:'new',removeParents:'old'});assert.equal(h.updates.length,2);assert.equal(h.updates[1].addParents,undefined);assert.equal(h.updates[1].removeParents,undefined);assert.deepEqual(h.sleeps,[500]);
});
const body=mime=>({name:'会議資料',mimeType:mime,parents:['parent'],appProperties:{meeting_key:'meet:test'}}),args={supportsAllDrives:true,fields:'id'};
test('通常ファイルは事前IDを固定し、作成成功・応答失敗を照合して二重作成しない',()=>{
 const h=harness(),native=h.ctx.Drive.Files.create;h.ctx.Drive.Files.create=(...a)=>{native(...a);throw error('Internal Error');};const f=h.api.create(body('text/plain'),null,args);assert.equal(f.id,'reserved-1');assert.equal(h.creates.length,1);assert.equal(Object.keys(h.props).length,0);assert.deepEqual(h.sleeps,[500]);
});
test('作成前の5xxは同じ予約IDで再送。再実行でも前回IDを維持する',()=>{
 const h=harness(),native=h.ctx.Drive.Files.create,ids=[];let count=0;h.ctx.Drive.Files.create=(b,...a)=>{ids.push(b.id);if(count++<5)throw error('Backend Error');return native(b,...a);};assert.throws(()=>h.api.create(body('application/json'),null,args),/保留/);assert.equal(h.sleeps.length,4);assert.equal(Object.keys(h.props).length,1);h.api.create(body('application/json'),null,args);assert.ok(ids.every(id=>id==='reserved-1'));assert.equal(h.creates.length,1);assert.equal(Object.keys(h.props).length,0);
});
test('ID非対応Docも作成成功の応答失敗を目印で復旧し、一覧は共有ドライブ指定',()=>{
 const h=harness(),native=h.ctx.Drive.Files.create;h.ctx.Drive.Files.create=(...a)=>{native(...a);throw error('Internal Error');};const f=h.api.create(body('application/vnd.google-apps.document'),null,args);assert.equal(f.id,'native-1');assert.equal(h.creates.length,1);assert.equal(h.creates[0].id,undefined);assert.equal(Object.keys(h.props).length,0);
});
test('ID非対応Docで結果不明・一覧未反映なら4回照合だけ。次回も重複作成しない',()=>{
 const h=harness();let count=0;h.ctx.Drive.Files.create=()=>{count++;throw error('Backend Error');};assert.throws(()=>h.api.create(body('application/vnd.google-apps.document'),null,args),/保留/);assert.equal(count,1);assert.deepEqual(h.sleeps,[500,1000,2000,4000]);assert.throws(()=>h.api.create(body('application/vnd.google-apps.document'),null,args),/保留/);assert.equal(count,1);
});
test('Docの明示的rate limit拒否は再送可、403権限は再送せず、createにも上限を適用',()=>{
 const h=harness(),native=h.ctx.Drive.Files.create;let calls=0;h.ctx.Drive.Files.create=(...a)=>{if(!calls++)throw error('rateLimitExceeded',403);return native(...a);};h.api.create(body('application/vnd.google-apps.document'),null,args);assert.equal(calls,2);assert.deepEqual(h.sleeps,[500]);
 const p=harness();let count=0;p.ctx.Drive.Files.create=()=>{count++;throw error('Permission denied',403);};assert.throws(()=>p.api.create(body('text/plain'),null,args));assert.equal(count,1);assert.equal(p.sleeps.length,0);assert.equal(Object.keys(p.props).length,0);
});
test('作成済みの用途・所属が不一致、重複なら保留記録を残して停止',()=>{
 const h=harness(),native=h.ctx.Drive.Files.create;h.ctx.Drive.Files.create=(...a)=>{const f=native(...a);h.files[f.id].parents=['outside'];throw error('Internal Error');};assert.throws(()=>h.api.create(body('text/plain'),null,args),/所属/);assert.equal(h.creates.length,1);assert.equal(Object.keys(h.props).length,1);
});
test('両GASの生成コードは同じ共通実装を含み、呼出し側にAdvanced Serviceの直呼びが残らない',()=>{
 for(const root of ['gas-core','gas-organizer']){assert.equal(fs.readFileSync(root+'/src/googleApi.generated.js','utf8'),'// shared/googleApi.jsから生成します。\n'+fs.readFileSync('shared/googleApi.js','utf8'));for(const f of fs.readdirSync(root+'/src').filter(f=>f.endsWith('.js')&&f!=='googleApi.generated.js'))assert.doesNotMatch(fs.readFileSync(root+'/src/'+f,'utf8'),/Drive\.Files\.(get|list|create|update)\(|Docs\.Documents\.get\(/,root+'/'+f);}
});

test('結果不明のまま本文だけが変わった再試行は、別ファイルを作らず停止',()=>{
 const h=harness();let calls=0;h.ctx.Drive.Files.create=()=>{calls++;throw error('Backend Error');};
 assert.throws(()=>h.api.create(body('text/plain'),{getDataAsString:()=> '元の本文'},args),/保留/);
 assert.throws(()=>h.api.create(body('text/plain'),{getDataAsString:()=> '変更後'},args),/本文が変わり/);assert.equal(calls,5);
});
