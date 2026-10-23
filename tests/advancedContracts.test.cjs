const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {check,enforce}=require('./helpers/advancedContracts.cjs');
test('拡張サービスの必須引数の順序とオプション位置を検査し、今回の誤形式を必ず拒否',()=>{
 for(const [name,args] of [
  ['Drive.Changes.list',[{pageToken:'token',pageSize:100}]],
  ['Drive.Changes.list',['token',{pageToken:'token'}]],
  ['Drive.Changes.getStartPageToken',['token',{}]],
  ['Drive.Files.list',['id',{}]],
  ['Drive.Files.get',[{fileId:'id'}]],
  ['Drive.Files.update',['id',{},null,{}]],
  ['Calendar.Events.list',[{calendarId:'primary'}]],
  ['Calendar.Events.get',['primary',{eventId:'id'}]],
  ['Docs.Documents.get',[{documentId:'id'}]]
 ])assert.throws(()=>check(name,args),name);
 for(const [name,args] of [
  ['Drive.Changes.list',['opaque-token',{driveId:'shared',supportsAllDrives:true}]],
  ['Drive.Changes.getStartPageToken',[{driveId:'shared',supportsAllDrives:true}]],
  ['Drive.Files.list',[{corpora:'drive'}]],['Drive.Files.get',['id',{}]],
  ['Drive.Files.update',[{},'id',null,{supportsAllDrives:true}]],
  ['Drive.Files.create',[{},null,{}]],['Drive.Files.generateIds',[{count:1}]],
  ['Calendar.Events.list',['primary',{}]],['Calendar.Events.get',['primary','id']],
  ['Docs.Documents.get',['id',{includeTabsContent:true}]]
 ])assert.doesNotThrow(()=>check(name,args),name);
});
test('本人用Drive差分はtokenを第1引数へ移し、callerのargsを変更せず一時障害も同じtokenで再試行',()=>{
 const calls=[],sleeps=[];let fail=true;
 const ctx=vm.createContext({console:{log(){}},Utilities:{sleep:n=>sleeps.push(n)},Drive:{Changes:{
  getStartPageToken(...args){calls.push({name:'start',args});return {startPageToken:'start'};},
  list(...args){calls.push({name:'list',args});if(fail){fail=false;throw Object.assign(new Error('Backend Error'),{code:503});}return {newStartPageToken:'next'};}
 }}});enforce(ctx);
 for(const file of ['shared/googleApi.js','gas-organizer/src/recordDiscovery.js'])vm.runInContext(fs.readFileSync(file,'utf8'),ctx);
 const api=ctx.RecordDiscovery_.nativeApi(),args=Object.freeze({pageToken:'opaque+token/=',pageSize:100,includeRemoved:true,fields:'newStartPageToken'});
 assert.equal(api.changesStart().startPageToken,'start');assert.equal(api.changes(args).newStartPageToken,'next');assert.equal(args.pageToken,'opaque+token/=');assert.deepEqual(sleeps,[500]);
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args)),[{fields:'startPageToken'}]);for(const call of calls.slice(1)){assert.equal(call.args[0],'opaque+token/=');assert.equal(call.args[1].pageSize,100);assert.equal(call.args[1].includeRemoved,true);assert.equal('pageToken' in call.args[1],false);}
});
