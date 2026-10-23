const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {harness,ids,clone}=require('./helpers/organizer.cjs');
const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),privateKey=pair.privateKey.export({type:'pkcs8',format:'pem'});
const finance='finance@premiere-mode.co.jp',employee='staff@premiere-mode.co.jp';
function delegated(dry='false'){
 const h=harness(dry),http=[],tokens=new Map(),cache=new Map(),sleeps=[];let count=0;
 const key={type:'service_account',client_email:'collector@unit-test.iam.gserviceaccount.com',client_id:'123456789',private_key_id:'unit-key',private_key:privateKey};
 Object.assign(h.props,{SA_KEY_JSON:JSON.stringify(key),DWD_CUSTOMER_ID:'C123456',MOVER_SHARED_REGISTRY:'true',MOVER_MODE:'AUTO',DWD_TEST_USER_EMAIL:finance,'MOVER_REGISTRY_MIGRATED:test':new Date().toISOString()});
 h.ctx.CacheService.getScriptCache=()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)});
 h.ctx.Utilities.base64EncodeWebSafe=x=>Buffer.from(x).toString('base64url');
 h.ctx.Utilities.computeRsaSha256Signature=(text,key)=>crypto.sign('RSA-SHA256',Buffer.from(text),key);
 h.ctx.Utilities.sleep=n=>sleeps.push(n);
 h.ctx.Calendar.Events.list=()=>({items:[clone(h.event)]});
 const state={users:[{primaryEmail:finance}],licenses:[{userId:finance,productId:'Google-Apps',skuId:'1010020028'}],events:{[finance]:[clone(h.event)]},fail:null};
 const nativeList=h.ctx.Drive.Files.list;h.ctx.Drive.Files.list=args=>args.q.startsWith('trashed=')?{files:Object.values(h.files).filter(f=>f.name==='manifest.json'&&f.properties?.minutes_role==='manifest'&&f.properties?.minutes_env===h.props.ENV&&!f.trashed).map(clone)}:nativeList(args);
 const response=(code,body)=>({getResponseCode:()=>code,getContentText:()=>typeof body==='string'?body:JSON.stringify(body)});
 h.ctx.UrlFetchApp={fetch:(url,args)=>{
  const u=new URL(url);http.push({url,args:clone(args)});
  if(u.hostname==='oauth2.googleapis.com'){
   const jwt=args.payload.assertion,[header,payload,sig]=jwt.split('.');assert.ok(crypto.verify('RSA-SHA256',Buffer.from(header+'.'+payload),pair.publicKey,Buffer.from(sig,'base64url')));
   const claims=JSON.parse(Buffer.from(payload,'base64url'));assert.equal(claims.aud,'https://oauth2.googleapis.com/token');assert.equal(claims.iss,key.client_email);assert.ok(claims.exp-claims.iat<=3600);assert.ok(claims.iat<=Date.now()/1000);
   const t='unit-token-'+(++count);tokens.set(t,claims);return response(200,{access_token:t,expires_in:3600});
  }
  const claims=tokens.get(args.headers.Authorization.replace('Bearer ',''));assert.ok(claims);const email=claims.sub;
  if(state.fail){const failure=state.fail(u,args);if(failure)return response(failure.code,{error:{errors:[{reason:failure.reason||'forbidden'}]},...failure.body});}
  if(u.hostname==='admin.googleapis.com')return response(200,{users:state.users});
  if(u.hostname==='licensing.googleapis.com'){assert.equal(u.searchParams.get('customerId'),'C123456');return response(200,{items:state.licenses});}
  if(u.pathname.includes('/calendars/primary/events')){assert.ok(!u.searchParams.has('supportsAttachments'));assert.equal(u.searchParams.get('orderBy'),'startTime');return response(200,{items:state.events[email]||[]});}
  if(u.hostname==='docs.googleapis.com')return response(200,{documentId:u.pathname.split('/').pop(),tabs:[]});
  if(u.pathname==='/drive/v3/files'){assert.equal(u.searchParams.get('supportsAllDrives'),'true');assert.equal(u.searchParams.get('corpora'),'drive');const parent=u.searchParams.get('q').match(/^'([^']+)'/)[1];return response(200,{files:Object.values(h.files).filter(f=>(f.parents||[]).includes(parent)&&!f.trashed).map(clone)});}
  if(u.pathname.startsWith('/drive/v3/files/')){
   assert.equal(u.searchParams.get('supportsAllDrives'),'true');const id=decodeURIComponent(u.pathname.split('/').pop()),file=h.files[id];if(!file)return response(404,{error:{}});
   if(args.method==='patch'){
    const body=JSON.parse(args.payload),add=u.searchParams.get('addParents'),remove=u.searchParams.get('removeParents');if(remove)assert.ok(file.parents.includes(remove));if(add){file.parents=[add];file.driveId=ids.SHARED_DRIVE_ID;}Object.assign(file,body);h.writes.push({op:'delegated-move',id,body,args:clone(args)});
    return response(200,file);
   }
   if(u.searchParams.get('alt')==='media')return response(200,file.content);
   return response(200,{...clone(file),ownedByMe:!file.driveId&&(file.owners||[]).some(o=>o.emailAddress===email)});
  }
  throw Error('unexpected API '+url);
 }};
 for(const name of ['delegatedAuth','delegated'])vm.runInContext(fs.readFileSync('gas-organizer/src/'+name+'.js','utf8'),h.ctx);
 return {...h,http,tokens,cache,state,sleeps,key};
}
test('委任JWTはRS256署名・対象本人・最小スコープ・短い有効期限。鍵とトークンをログへ出さない',()=>{
 const h=delegated();const t=h.ctx.DelegatedAuth_.token(employee,'user');assert.equal(h.tokens.get(t).sub,employee);assert.deepEqual(h.tokens.get(t).scope.split(' '),['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/drive']);assert.equal(h.ctx.DelegatedAuth_.token(employee,'user'),t);assert.equal(h.http.length,1);
 h.ctx.DelegatedAuth_.token(finance,'admin');assert.match([...h.tokens.values()][1].scope,/admin.directory.user.readonly/);assert.match([...h.tokens.values()][1].scope,/apps.licensing/);
 h.ctx.DelegatedAuth_.token(finance,'drive');assert.equal([...h.tokens.values()][2].scope,'https://www.googleapis.com/auth/drive');assert.ok(!h.logs.join('').includes('unit-token'));assert.ok(!h.logs.join('').includes('PRIVATE KEY'));
 h.key.private_key_id='rotated';h.props.SA_KEY_JSON=JSON.stringify(h.key);h.ctx.DelegatedAuth_.token(employee,'user');assert.equal(h.http.length,4);
});
test('Gmail・偽スコープ・偽URL・Directory書き込みを委任APIで拒否、認証エラー本文を漏らさない',()=>{
 const h=delegated();assert.throws(()=>h.ctx.DelegatedAuth_.token('personal@gmail.com','user'));assert.throws(()=>h.ctx.DelegatedAuth_.token(finance,'unknown'));assert.throws(()=>h.ctx.DelegatedAuth_.request(finance,'admin','https://attacker.example/x'));assert.throws(()=>h.ctx.DelegatedAuth_.request(finance,'admin','https://admin.googleapis.com/admin/directory/v1/users','patch',{}));
 h.ctx.UrlFetchApp.fetch=()=>({getResponseCode:()=>400,getContentText:()=>JSON.stringify({error:'private secret must never appear'})});h.cache.clear();assert.throws(()=>h.ctx.DelegatedAuth_.token(finance,'user'),e=>e.message.includes('HTTP 400')&&!e.message.includes('private secret'));assert.equal(h.logs.length,0);
 h.props.SA_KEY_JSON='bad json';assert.throws(()=>h.ctx.DelegatedAuth_.key(),/JSON形式/);
});
test('DirectoryとLicenseを照合し停止・アーカイブ・未ライセンス・Gmail・除外メール/部署/下位OUを除外',()=>{
 const h=delegated('true'),names=['ok','suspended','archived','unlicensed','excluded','ou','child','department'];const users=names.map(n=>({primaryEmail:n+'@premiere-mode.co.jp'}));users[1].suspended=true;users[2].archived=true;users[5].orgUnitPath='/NoRecord';users[6].orgUnitPath='/NoRecord/Child';users[7].organizations=[{department:'秘密部署'}];users.push({primaryEmail:'person@gmail.com'});
 const licenses=users.filter(u=>!u.primaryEmail.startsWith('unlicensed')).map(u=>({userId:u.primaryEmail,productId:'Google-Apps',skuId:'1010020028'}));
 const c={DWD_EXCLUDE_EMAILS:'excluded@premiere-mode.co.jp',DWD_EXCLUDE_ORG_UNITS:'/NoRecord',DWD_EXCLUDE_DEPARTMENTS:'秘密部署'};
 assert.deepEqual(clone(h.ctx.Delegated_.eligible(users,licenses,c)).map(u=>u.email),['ok@premiere-mode.co.jp']);assert.equal(h.ctx.Delegated_.eligible(users,licenses,{DWD_ALLOWED_SKUS:'different'}).length,0);
});
test('社員は管理者関数を呼べず、ActiveUser空のfinance時間トリガーだけは許可',()=>{
 const h=delegated();h.setActive(employee);h.setEffective(employee);for(const fn of ['previewDelegatedMeetings','runDelegatedSingleUser','setupDelegatedMoverTrigger','removeDelegatedMoverTrigger','migrateMoverProcessedRecords','checkDelegatedStatus'])assert.throws(()=>h.ctx[fn](),/finance/);
 h.setActive('');h.setEffective(finance);assert.throws(()=>h.ctx.previewDelegatedMeetings(),/finance/);h.props.DWD_ENABLED='true';assert.equal(h.ctx.delegatedMoverTick_().eligibleUsers,1);
});
test('読み取りDRY_RUNは対象と移動予定だけ。Drive・共通記録・カーソル・トリガーを更新しない',()=>{
 const h=delegated();const before=clone(h.props),r=h.ctx.previewDelegatedMeetings();assert.equal(r.dryRun,true);assert.equal(r.eligibleUsers,1);assert.equal(r.users[0].results[0].status,'移動予定');assert.equal(h.writes.length,0);assert.deepEqual(h.props,before);assert.ok(h.http.every(r=>r.args.method!=='patch'));assert.equal(h.triggers.length,0);
 h.props.DRY_RUN='true';const p=clone(h.props);assert.equal(h.ctx.runDelegatedSingleUser().dryRun,true);assert.deepEqual(h.props,p);
});
test('単一社員の本番試験は登録不要で本人の添付だけを本番へ移動、cutoff前と非公開は除外',()=>{
 const h=delegated();h.props.ENV='prod';h.props.FOLDER_INBOX_RAW_ID='1jNifZBBUN0QNMWdA_hI2J5YY2PbqtxoB';h.props.PRODUCTION_START_AT=new Date(Date.now()-7200000).toISOString();h.props.DWD_TEST_USER_EMAIL=employee;h.props['MOVER_REGISTRY_MIGRATED:prod']='yes';
 h.files[h.props.FOLDER_INBOX_RAW_ID]={...clone(h.files[ids.FOLDER_INBOX_RAW_TEST_ID]),id:h.props.FOLDER_INBOX_RAW_ID,parents:[ids.FOLDER_SYSTEM_ID]};h.state.users=[{primaryEmail:employee}];h.state.licenses=[{userId:employee,productId:'Google-Apps',skuId:'1010020028'}];
 for(const id of ['rec','transcript','gemini'])h.files[id].owners=[{emailAddress:employee}];const base={...clone(h.event),organizer:{self:true,email:employee}};
 h.state.events[employee]=[base,{...base,id:'private',visibility:'private'},{...base,id:'norecord',summary:'【記録なし】相談'},{...base,id:'earlier',start:{dateTime:new Date(Date.now()-10800000).toISOString()}},{...base,id:'empty',attachments:[]}];
 const r=h.ctx.runDelegatedSingleUser();assert.equal(r.users[0].results.length,1);assert.equal(r.users[0].results[0].status,'ready');const folder=h.files[r.users[0].results[0].folderId];assert.equal(folder.parents[0],h.props.FOLDER_INBOX_RAW_ID);assert.equal(h.writes.filter(w=>w.op==='delegated-move').length,3);assert.ok(Object.keys(h.props).some(k=>k.startsWith('MOVER_SHARED:prod:')));assert.ok(!Object.keys(h.props).some(k=>k.startsWith('MOVER_SHARED:test:')));
 const manifest=JSON.parse(h.files[r.users[0].results[0].manifestId].content);assert.equal(manifest.organizer_email,employee);assert.equal(h.files.rec.properties.meeting_key,manifest.meeting_key);
});
test('管理者→本人、本人→管理者の両順で二重移動・二重manifestなし。Aが移動後も共通記録を優先',()=>{
 for(const adminFirst of [true,false]){const h=delegated();h.register();if(adminFirst)h.ctx.runDelegatedSingleUser();else h.ctx.moverRun();const moves=h.writes.filter(w=>w.op==='delegated-move'||w.args?.addParents).length;
 for(const f of Object.values(h.files))if(f.driveId&&f.properties?.meeting_key)f.parents=['finished-business-folder'];
 if(adminFirst)assert.equal(h.ctx.moverRun()[0].status,'処理済み');else assert.equal(h.ctx.runDelegatedSingleUser().users[0].results[0].status,'処理済み');
 assert.equal(h.writes.filter(w=>w.op==='delegated-move'||w.args?.addParents).length,moves);assert.equal(Object.values(h.files).filter(f=>f.name==='manifest.json').length,1);}
});
test('未移行の既存記録は実行前に停止。旧manifestを共有記録へ取り込めば二重処理しない',()=>{
 const h=delegated();h.props.MOVER_SHARED_REGISTRY='false';h.register();const old=h.ctx.moverRun()[0];h.props.MOVER_SHARED_REGISTRY='true';delete h.props['MOVER_REGISTRY_MIGRATED:test'];assert.throws(()=>h.ctx.runDelegatedSingleUser(),/migrateMoverProcessedRecords/);
 h.props.DRY_RUN='true';const before=clone(h.props);assert.equal(h.ctx.migrateMoverProcessedRecords().count,1);assert.deepEqual(h.props,before);
 h.props.DRY_RUN='false';assert.equal(h.ctx.migrateMoverProcessedRecords().count,1);assert.equal(h.ctx.runDelegatedSingleUser().users[0].results[0].status,'処理済み');assert.equal(Object.values(h.files).filter(f=>f.name==='manifest.json').length,1);assert.ok(h.files[old.manifestId]);
});
test('途中移動の再実行は同じフォルダ・元ファイルIDから再開する',()=>{
 const h=delegated();let failed=false;h.state.fail=(u,args)=>{if(args.method==='patch'&&u.pathname.endsWith('/transcript')&&!failed){failed=true;return {code:403};}};
 assert.equal(h.ctx.runDelegatedSingleUser().users[0].results[0].status,'要確認');assert.equal(h.files.rec.driveId,ids.SHARED_DRIVE_ID);assert.equal(Object.values(h.files).filter(f=>f.name==='manifest.json').length,0);
 // 同じ固定ウィンドウの走査は再開後に次の周回で再試行されます。
 assert.equal(h.ctx.runDelegatedSingleUser().users[0].results[0].status,'ready');assert.equal(h.writes.filter(w=>w.op==='delegated-move'&&w.id==='rec').length,1);assert.equal(Object.values(h.files).filter(f=>f.name==='manifest.json').length,1);
});
test('403/404は再試行せず、500/429だけ再試行。エラー本文中の秘密値は出力しない',()=>{
 for(const code of [403,404,500,429]){const h=delegated('true');let failures=0;h.state.fail=(u,args)=>u.hostname==='admin.googleapis.com'&&++failures===1?{code,body:{sensitive:'secret-token'}}:null;
 if(code<500&&code!==429)assert.throws(()=>h.ctx.previewDelegatedMeetings(),e=>e.code===code&&!e.message.includes('secret-token'));else assert.equal(h.ctx.previewDelegatedMeetings().eligibleUsers,1);
 assert.equal(h.sleeps.length,[500,429].includes(code)?1:0);assert.ok(!h.logs.join('').includes('secret-token'));}
});
test('分割走査のoffsetをユーザー別に保存し、次回は続きから進む。ページングも保持',()=>{
 const h=delegated();h.props.DWD_ENABLED='true';h.props.DWD_EVENTS_PER_USER='1';h.state.users=[{primaryEmail:finance},{primaryEmail:employee}];h.state.licenses.push({userId:employee,productId:'Google-Apps',skuId:'1010020028'});
 for(const email of [finance,employee])h.state.events[email]=[0,1].map(i=>({...clone(h.event),id:'event'+i,attachments:[],organizer:{self:true,email}}));
 const r=h.ctx.delegatedMoverTick_();assert.equal(r.visitedUsers,2);assert.ok(r.users.every(u=>u.scanned===1&&u.continued));const cursors=Object.keys(h.props).filter(k=>k.startsWith('DWD_CURSOR:test:'));assert.equal(cursors.length,2);assert.ok(cursors.every(k=>JSON.parse(h.props[k]).offset===1));
 const next=h.ctx.delegatedMoverTick_();assert.ok(next.users.every(u=>u.scanned===1&&!u.continued));assert.ok(cursors.every(k=>!h.props[k]));assert.ok(h.props['DWD_LAST_RUN:test']);
});
test('個別の会議で失敗しても次のユーザーへ。ライセンスAPI失敗時は誰も処理しない',()=>{
 const h=delegated();h.props.DWD_ENABLED='true';h.state.users.push({primaryEmail:employee});h.state.licenses.push({userId:employee,productId:'Google-Apps',skuId:'1010020028'});h.state.fail=u=>u.pathname.includes('/calendars/')&&[...h.tokens.values()].at(-1)?.sub===employee?{code:403}:null;
 const result=h.ctx.delegatedMoverTick_();assert.equal(result.visitedUsers,2);assert.equal(result.users.find(u=>u.email===finance).results[0].status,'ready');assert.equal(result.users.find(u=>u.email===employee).status,'ユーザーの取得失敗');
 const x=delegated();x.state.fail=u=>u.hostname==='licensing.googleapis.com'?{code:403}:null;assert.throws(()=>x.ctx.runDelegatedSingleUser());assert.equal(x.writes.length,0);
});
test('管理者トリガーはfinanceの1個だけ。個別登録やAのトリガーを削除しない',()=>{
 const h=delegated();h.register();assert.throws(()=>h.ctx.setupDelegatedMoverTrigger(),/DWD_ENABLED/);h.props.DWD_ENABLED='true';h.props.DRY_RUN='true';h.ctx.setupDelegatedMoverTrigger();assert.equal(h.triggers.length,1);h.props.DRY_RUN='false';h.ctx.setupDelegatedMoverTrigger();h.ctx.setupDelegatedMoverTrigger();assert.equal(h.triggers.length,2);h.ctx.removeDelegatedMoverTrigger();assert.equal(h.triggers.length,1);assert.equal(h.triggers[0].getHandlerFunction(),'moverRun');
});
test('管理者の正常な全走査後だけ、個別タイマーが本人操作なしで自分のトリガーを停止',()=>{
 const h=delegated();h.register();const triggerUid=h.triggers[0].getUniqueId();h.props.DWD_ENABLED='true';h.props.MOVER_RETIRE_PERSONAL_TRIGGERS='true';h.ctx.delegatedMoverTick_();h.ctx.setupDelegatedMoverTrigger();assert.equal(h.ctx.moverRun({triggerUid})[0].status,'管理者収集へ移行済み');assert.equal(h.triggers.length,1);assert.equal(h.triggers[0].getHandlerFunction(),'delegatedMoverTick_');assert.equal(h.ctx.OrganizerRegistration_.state().registered,false);
});
test('共通記録はENV別で7日を超えたものだけ整理、DRY_RUNでは残す',()=>{
 const h=delegated(),c=h.ctx.Delegated_.config();h.ctx.OrganizerRegistry_.save(c,'meet:old',{ready:true});const key=Object.keys(h.props).find(k=>k.startsWith('MOVER_SHARED:test:'));const old=JSON.parse(h.props[key]);old.at=Date.now()-8*86400000;h.props[key]=JSON.stringify(old);h.props['MOVER_SHARED:prod:other']=JSON.stringify(old);h.ctx.OrganizerRegistry_.prune({...c,DRY_RUN:'true'});assert.ok(h.props[key]);h.ctx.OrganizerRegistry_.prune(c);assert.ok(!h.props[key]);assert.ok(h.props['MOVER_SHARED:prod:other']);
});
test('Directory・ライセンスのページを最後まで読み、Calendarの次ページを次tickへ保存する',()=>{
 const h=delegated();let userPages=0,licensePages=0,calendarPages=0;const original=h.ctx.DelegatedAuth_.get;
 h.ctx.DelegatedAuth_.get=(subject,kind,url,args)=>{
  if(url.includes('/directory/')){userPages++;return args.pageToken?{users:[{primaryEmail:employee}]}:{users:[{primaryEmail:finance}],nextPageToken:'users-next'};}
  if(url.includes('licensing.')){licensePages++;return args.pageToken?{items:[{userId:employee,productId:'Google-Apps'}]}:{items:[{userId:finance,productId:'Google-Apps'}],nextPageToken:'licenses-next'};}
  if(url.includes('/calendars/')){calendarPages++;return args.pageToken?{items:[{...clone(h.event),id:'second',attachments:[]}]}:{items:[{...clone(h.event),attachments:[]}],nextPageToken:'calendar-next'};}
  return original(subject,kind,url,args);
 };
 const r=h.ctx.runDelegatedSingleUser();assert.equal(r.users[0].continued,true);const cursor=Object.keys(h.props).find(k=>k.startsWith('DWD_CURSOR:test:'));assert.equal(JSON.parse(h.props[cursor]).pageToken,'calendar-next');assert.equal(h.ctx.runDelegatedSingleUser().users[0].continued,false);assert.equal(userPages,4);assert.equal(licensePages,4);assert.equal(calendarPages,2);
});
test('PATCH成功後に応答だけ500でも実親を読み直し、同じファイルを重複移動しない',()=>{
 const h=delegated();let failed=false;h.state.fail=(u,args)=>{if(args.method==='patch'&&u.pathname.endsWith('/rec')&&!failed){failed=true;h.files.rec.parents=[u.searchParams.get('addParents')];h.files.rec.driveId=ids.SHARED_DRIVE_ID;return {code:500};}};
 const r=h.ctx.runDelegatedSingleUser();assert.equal(r.users[0].results[0].status,'ready');const patches=h.http.filter(r=>r.args.method==='patch'&&r.url.includes('/rec?'));assert.equal(patches.length,2);assert.equal(new URL(patches[1].url).searchParams.has('removeParents'),false);assert.equal(new URL(patches[1].url).searchParams.has('addParents'),false);assert.deepEqual(h.sleeps,[500]);assert.equal(Object.values(h.files).filter(f=>f.name==='manifest.json').length,1);
});
test('共有ロックが取れなければAPIも呼ばず、別プロジェクトにコピーした管理者収集も拒否',()=>{
 const h=delegated();h.ctx.LockService.getScriptLock=()=>({tryLock:()=>false});assert.throws(()=>h.ctx.previewDelegatedMeetings(),/別の処理/);assert.equal(h.http.length,0);
 const x=delegated();x.props.DWD_REGISTRY_SCRIPT_ID='different-project';assert.throws(()=>x.ctx.previewDelegatedMeetings(),/別のプロジェクト/);assert.equal(x.http.length,0);
});
test('時間予算を超えたら次ユーザーの位置を保持して終了し、次tickがその人から再開する',()=>{
 const h=delegated();h.props.DWD_ENABLED='true';h.props.DWD_BUDGET_SEC='30';let now=Date.now();h.ctx.Date=class extends Date{static now(){return now;}};
 h.state.users.push({primaryEmail:employee});h.state.licenses.push({userId:employee,productId:'Google-Apps'});h.state.events[employee]=[];
 const original=h.ctx.Delegated_.scan;
 // 時計を最初のユーザーのCalendar応答後に進め、読み取り途中の再開位置も保存します。
 const get=h.ctx.DelegatedAuth_.get;let advance=true;
 h.ctx.DelegatedAuth_.get=(subject,kind,url,args)=>{const r=get(subject,kind,url,args);if(advance&&subject===finance&&url.includes('/calendars/')){now+=31000;advance=false;}return r;};
 const first=h.ctx.delegatedMoverTick_();assert.equal(first.visitedUsers,1);assert.equal(h.props['DWD_NEXT:test'],employee);const second=h.ctx.delegatedMoverTick_();assert.equal(second.users[0].email,employee);
});
test('Geminiタブとメモのみのフォールバックは管理者収集でも同じmanifest形式',()=>{
 for(const tabs of [true,false]){const h=delegated();h.state.events[finance][0].attachments=[{fileId:'gemini'}];h.props.MOVER_MEMO_WAIT_MIN='20';const fetch=h.ctx.UrlFetchApp.fetch;
 h.ctx.UrlFetchApp.fetch=(url,args)=>url.includes('docs.googleapis.com')?{getResponseCode:()=>200,getContentText:()=>JSON.stringify({documentId:'gemini',tabs:tabs?[{tabProperties:{tabId:'text',title:'文字起こし'}}]:[]})}:fetch(url,args);
 const r=h.ctx.runDelegatedSingleUser().users[0].results[0];assert.equal(r.status,'ready');const m=JSON.parse(h.files[r.manifestId].content);assert.equal(m.transcript_source.type,tabs?'document_tab':'gemini_notes');assert.equal(m.input_quality,tabs?undefined:'notes_only');assert.deepEqual(m.files,{gemini:'gemini'});}
});
test('受信への権限がない、他人所有、別共有ドライブの添付を移動しない',()=>{
 for(const change of [h=>h.files[ids.FOLDER_INBOX_RAW_TEST_ID].capabilities.canAddChildren=false,h=>h.files.rec.owners=[{emailAddress:employee}],h=>h.files.rec.driveId='another-shared-drive']){const h=delegated();change(h);const r=h.ctx.runDelegatedSingleUser();assert.equal(r.users[0].results[0].status,'要確認');assert.equal(h.writes.length,0);}
});
test('人・部署の明示除外は個別登録の経路にも反映し、トリガー自動停止は既定で無効',()=>{
 const h=delegated();h.register();h.props.DWD_EXCLUDE_EMAILS=finance;assert.equal(h.ctx.moverRun().length,0);assert.equal(h.triggers.length,1);
 const x=delegated();x.register();x.props.DWD_EXCLUDE_ORG_UNITS='/Private';x.state.users[0].orgUnitPath='/Private/Child';x.props.DWD_ENABLED='true';assert.equal(x.ctx.delegatedMoverTick_().eligibleUsers,0);assert.equal(x.ctx.moverRun().length,0);assert.equal(x.triggers.length,1);
});
test('本番への旧記録移行は_test配下と古い記録を取り込まない',()=>{
 const h=delegated();h.props.MOVER_SHARED_REGISTRY='false';h.register();h.ctx.moverRun();h.props.MOVER_SHARED_REGISTRY='true';h.props.ENV='prod';h.props.FOLDER_INBOX_RAW_ID='1jNifZBBUN0QNMWdA_hI2J5YY2PbqtxoB';h.props.PRODUCTION_START_AT=new Date(Date.now()-7200000).toISOString();
 const manifest=Object.values(h.files).find(f=>f.name==='manifest.json');manifest.properties.minutes_env='prod';assert.equal(h.ctx.migrateMoverProcessedRecords().count,0);assert.ok(!Object.keys(h.props).some(k=>k.startsWith('MOVER_SHARED:prod:')));
});
test('プレビュー移行関数は本番DRY_RUN=falseのままでも書き込まず、失効ライセンスのcoverageは消す',()=>{
 const h=delegated();h.props.MOVER_SHARED_REGISTRY='false';h.register();h.ctx.moverRun();h.props.MOVER_SHARED_REGISTRY='true';const before=clone(h.props),writes=h.writes.length;assert.equal(h.ctx.previewMoverProcessedRecords().dryRun,true);assert.deepEqual(h.props,before);assert.equal(h.writes.length,writes);
 h.props['DWD_COVERED:test:'+h.ctx.Organizer_.hash(employee)]=String(Date.now());h.ctx.runDelegatedSingleUser();assert.ok(!h.props['DWD_COVERED:test:'+h.ctx.Organizer_.hash(employee)]);
});
