// config.js
var Organizer_ = (function () {
  var finance='finance@premiere-mode.co.jp';
  var ids={SHARED_DRIVE_ID:'0ALo4SlMVSpXdUk9PVA',FOLDER_SYSTEM_ID:'1UbflVH7ITQBN6INYyAQyn7fy77CWl4wH',FOLDER_SYSTEM_TEST_ID:'1pKWcGDuRCBf3VG0AfKBaKghE0nD3kYwW',FOLDER_INBOX_RAW_TEST_ID:'1Hip4qiyC3sUsPhqCj8JGAFKj8zLaUHaC'};
  function actor(trigger) {
    var active=String(Session.getActiveUser().getEmail()||'').toLowerCase(), effective=String(Session.getEffectiveUser().getEmail()||'').toLowerCase();
    var email=trigger?effective:active;
    if(!email || !/^[^@\s]+@premiere-mode\.co\.jp$/.test(email) || !effective || effective!==email || active && active!==effective) throw new Error('会社Workspaceアカウント本人として実行してください。所有者として代理実行するWebアプリでは使えません。');
    return email;
  }
  function config() {
    var c=PropertiesService.getScriptProperties().getProperties();
    if(!['test','prod'].includes(c.ENV) || !['true','false'].includes(c.DRY_RUN)) throw new Error('ENV=test/prodと明示的なDRY_RUNが必要です。');
    var expected=Object.assign({},ids);if(c.ENV==='prod'){expected.FOLDER_SYSTEM_TEST_ID=ids.FOLDER_SYSTEM_ID;expected.FOLDER_INBOX_RAW_TEST_ID='1jNifZBBUN0QNMWdA_hI2J5YY2PbqtxoB';if(c.FOLDER_INBOX_RAW_ID!==expected.FOLDER_INBOX_RAW_TEST_ID||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(c.PRODUCTION_START_AT||'')||!Number.isFinite(Date.parse(c.PRODUCTION_START_AT)))throw new Error('本番受信IDとPRODUCTION_START_ATが必要です。');c.FOLDER_SYSTEM_TEST_ID=c.FOLDER_SYSTEM_ID;c.FOLDER_INBOX_RAW_TEST_ID=c.FOLDER_INBOX_RAW_ID;}
    Object.keys(expected).forEach(function(k){if(c[k]!==expected[k])throw new Error(k+'がENVに対応する共有ドライブ・受信領域と一致しません。');});
    c.MOVER_MODE=c.MOVER_MODE||'TEST_EVENT';
    if(!['TEST_EVENT','AUTO'].includes(c.MOVER_MODE))throw new Error('MOVER_MODEはTEST_EVENTまたはAUTOです。');
    c.MOVER_MEMO_WAIT_MIN=Number(c.MOVER_MEMO_WAIT_MIN||120);
    if(!Number.isInteger(c.MOVER_MEMO_WAIT_MIN)||c.MOVER_MEMO_WAIT_MIN<20||c.MOVER_MEMO_WAIT_MIN>2880)throw new Error('MOVER_MEMO_WAIT_MINは20〜2880です。');
    c.MOVER_INTERVAL_MIN=Number(c.MOVER_INTERVAL_MIN||15);c.MOVER_WAIT_MIN=Number(c.MOVER_WAIT_MIN||20);
    if(![1,5,10,15,30].includes(c.MOVER_INTERVAL_MIN))throw new Error('MOVER_INTERVAL_MINは1・5・10・15・30です。');
    if(!Number.isInteger(c.MOVER_WAIT_MIN)||c.MOVER_WAIT_MIN<0||c.MOVER_WAIT_MIN>1440)throw new Error('MOVER_WAIT_MINは0〜1440です。');
    return c;
  }
  function lock(fn) {var l=LockService.getScriptLock();if(!l.tryLock(1000))throw new Error('別の処理が実行中です。後でもう一度実行してください。');try{return fn();}finally{l.releaseLock();}}
  function hash(v){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,v,Utilities.Charset.UTF_8).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
  function nonce(email){var n=Utilities.getUuid();CacheService.getUserCache().put('organizer:'+n,email,1800);return n;}
  function verify(email,n){if(typeof n!=='string'||n.length>100||CacheService.getUserCache().get('organizer:'+n)!==email)throw new Error('画面の期限が切れました。読み直してください。');}
  return {actor:actor,config:config,lock:lock,hash:hash,nonce:nonce,verify:verify};
})();
function checkOrganizerConfig(){var email=Organizer_.actor(false),c=Organizer_.config();var drive=OrganizerDrive_.open(c);console.log('GAS-B設定を確認しました。利用者：'+email+'、移動先：'+drive.raw.id+'、DRY_RUN='+c.DRY_RUN);return {ok:true,email:email,dryRun:c.DRY_RUN==='true',rawId:drive.raw.id};}


// delegated.js
// 管理者収集は既存のGAS-Bに追加します。別プロジェクトだとScriptLockを共有できません。
var Delegated_=(function(){
  var finance='finance@premiere-mode.co.jp';
  function actor(trigger){var a=String(Session.getActiveUser().getEmail()||'').toLowerCase(),e=String(Session.getEffectiveUser().getEmail()||'').toLowerCase();if(e!==finance||a&&a!==finance||!trigger&&!a)throw new Error('管理者収集はfinance@本人だけが実行できます。');}
  function list(value){return String(value||'').split(/[\n,]/).map(function(v){return v.trim().toLowerCase();}).filter(Boolean);}
  function config(){var c=Organizer_.config();if(c.MOVER_SHARED_REGISTRY!=='true')throw new Error('同じGAS-BでMOVER_SHARED_REGISTRY=trueを設定してください。');if(!/^C[a-z0-9]+$/i.test(c.DWD_CUSTOMER_ID||''))throw new Error('DWD_CUSTOMER_IDに管理コンソールのお客様IDを設定してください。');
    if(c.DWD_REGISTRY_SCRIPT_ID&&c.DWD_REGISTRY_SCRIPT_ID!==ScriptApp.getScriptId())throw new Error('共有記録を作成したGAS-Bと別のプロジェクトです。同じGAS-Bを使用してください。');
    c.MOVER_MODE='AUTO';c.DWD_BUDGET_SEC=Number(c.DWD_BUDGET_SEC||210);c.DWD_EVENTS_PER_USER=Number(c.DWD_EVENTS_PER_USER||20);
    if(!Number.isInteger(c.DWD_BUDGET_SEC)||c.DWD_BUDGET_SEC<30||c.DWD_BUDGET_SEC>240||!Number.isInteger(c.DWD_EVENTS_PER_USER)||c.DWD_EVENTS_PER_USER<1||c.DWD_EVENTS_PER_USER>50)throw new Error('実行時間は30〜240秒、1ユーザーの走査数は1〜50です。');DelegatedAuth_.key();return c;}
  function excluded(u,c){var email=String(u.primaryEmail||'').toLowerCase(),ou=String(u.orgUnitPath||'').toLowerCase();return list(c.DWD_EXCLUDE_EMAILS).includes(email)||list(c.DWD_EXCLUDE_ORG_UNITS).some(function(path){return path==='/'||ou===path||ou.startsWith(path.replace(/\/$/,'')+'/');})||(u.organizations||[]).some(function(o){return list(c.DWD_EXCLUDE_DEPARTMENTS).includes(String(o.department||'').toLowerCase());});}
  function eligible(users,licenses,c){var assigned={},skus=list(c.DWD_ALLOWED_SKUS);
    (licenses||[]).forEach(function(l){if(l.productId==='Google-Apps'&&(!skus.length||skus.includes(String(l.skuId).toLowerCase())))assigned[String(l.userId||'').toLowerCase()]=true;});
    return (users||[]).filter(function(u){var email=String(u.primaryEmail||'').toLowerCase();return /^[^@\s]+@premiere-mode\.co\.jp$/.test(email)&&!u.suspended&&!u.archived&&assigned[email]&&!excluded(u,c);}).map(function(u){return {email:String(u.primaryEmail).toLowerCase(),orgUnitPath:u.orgUnitPath||'/'};}).sort(function(a,b){return a.email.localeCompare(b.email);});
  }
  function roster(c,deadline){var users=[],licenses=[],token,pages=0;
    do{if(Date.now()>deadline||++pages>100)throw new Error('ユーザー一覧取得が制限時間に達しました。収集せず停止します。');var args={customer:c.DWD_CUSTOMER_ID,maxResults:500,projection:'full',fields:'nextPageToken,users(primaryEmail,suspended,archived,orgUnitPath,organizations(department))'};if(token)args.pageToken=token;var r=DelegatedAuth_.get(finance,'admin','https://admin.googleapis.com/admin/directory/v1/users',args);users=users.concat(r.users||[]);token=r.nextPageToken;}while(token);
    token=null;pages=0;do{if(Date.now()>deadline||++pages>100)throw new Error('ライセンス取得が制限時間に達しました。未確認の人を処理しません。');var a={customerId:c.DWD_CUSTOMER_ID,maxResults:1000};if(token)a.pageToken=token;var l=DelegatedAuth_.get(finance,'admin','https://licensing.googleapis.com/apps/licensing/v1/product/Google-Apps/users',a);licenses=licenses.concat(l.items||[]);token=l.nextPageToken;}while(token);
    if(c.DRY_RUN==='false'){var props=PropertiesService.getScriptProperties();users.forEach(function(u){var key='DWD_EXCLUDED:'+c.ENV+':'+Organizer_.hash(String(u.primaryEmail||'').toLowerCase());if(excluded(u,c))props.setProperty(key,'true');else props.deleteProperty(key);});}
    var selected=eligible(users,licenses,c);if(c.DRY_RUN==='false'){var p=PropertiesService.getScriptProperties(),keep={};selected.forEach(function(u){keep['DWD_COVERED:'+c.ENV+':'+Organizer_.hash(u.email)]=true;});Object.keys(p.getProperties()).filter(function(k){return k.startsWith('DWD_COVERED:'+c.ENV+':')&&!keep[k];}).forEach(function(k){p.deleteProperty(k);});}console.log('管理者収集：一覧'+users.length+'人、ライセンス・除外判定後の対象'+selected.length+'人。');return selected;
  }
  function cursorKey(c,email){return 'DWD_CURSOR:'+c.ENV+':'+Organizer_.hash(email);}
  function scan(c,email,deadline,preview){
    var props=PropertiesService.getScriptProperties(),key=cursorKey(c,email),saved=preview?null:props.getProperty(key),now=Date.now(),cursor=saved?JSON.parse(saved):null,results=[];
    if(!cursor||Date.parse(cursor.max)<now-72*3600000)cursor={min:new Date(now-72*3600000).toISOString(),max:new Date(now).toISOString(),offset:0};
    var args={timeMin:cursor.min,timeMax:cursor.max,singleEvents:true,showDeleted:false,orderBy:'startTime',maxResults:50};if(cursor.pageToken)args.pageToken=cursor.pageToken;
    var page=DelegatedAuth_.get(email,'user','https://www.googleapis.com/calendar/v3/calendars/primary/events',args),events=page.items||[],drive=null,scanned=0;
    // このstoreはUserPropertiesを使いません。共通記録とDriveの同じフォルダで再開します。
    var store={getProperty:function(){return null;},setProperty:function(){}};
    for(var i=cursor.offset||0;i<events.length;i++){
      if(Date.now()>deadline||scanned>=c.DWD_EVENTS_PER_USER)break;
      var event=events[i];scanned++;
      try{if(event.end&&Date.parse(event.end.dateTime)>=now-72*3600000){
        var plan=MoverPlan_.event(event,email,now,c.MOVER_WAIT_MIN,'AUTO');
        if(plan&&(c.ENV!=='prod'||Date.parse(plan.manifest.start)>=Date.parse(c.PRODUCTION_START_AT))){
          var known=OrganizerRegistry_.get(c,plan.key);
          if(known&&known.ready)results.push({meeting_key:plan.key,status:'処理済み'});
          else if((event.attachments||[]).length){drive=drive||OrganizerDrive_.open(c,DelegatedAuth_.drive(c,email));var r=OrganizerMover_.one(event,email,c,drive,store,now);if(r)results.push(r);}
        }
      }}catch(e){console.log('管理者収集：'+email+'の会議を保留しました。権限・共有ドライブ所属・移行済み記録を確認してください。');results.push({eventId:event.id,status:'要確認',api:e.api||'添付・Drive権限',code:Number(e.code)||0});}
      cursor.offset=i+1;if(!preview)props.setProperty(key,JSON.stringify(cursor));
    }
    if((cursor.offset||0)>=events.length){cursor.offset=0;if(page.nextPageToken)cursor.pageToken=page.nextPageToken;else cursor=null;}
    if(!preview){if(cursor)props.setProperty(key,JSON.stringify(cursor));else props.deleteProperty(key);}
    return {email:email,scanned:scanned,continued:!!cursor,results:results};
  }
  function run(preview,single,trigger){actor(trigger);return Organizer_.lock(function(){var c=config();if(preview)c.DRY_RUN='true';preview=c.DRY_RUN==='true';if(!preview&&!single&&c.DWD_ENABLED!=='true')throw new Error('DWD_ENABLED=trueになるまで一括移動しません。');
    if(!preview&&!PropertiesService.getScriptProperties().getProperty('MOVER_REGISTRY_MIGRATED:'+c.ENV))throw new Error('先にmigrateMoverProcessedRecordsをDRY_RUN確認後falseで実行してください。');
    var started=Date.now(),deadline=started+c.DWD_BUDGET_SEC*1000,users=roster(c,Math.min(deadline,started+90000)),p=PropertiesService.getScriptProperties(),nextKey='DWD_NEXT:'+c.ENV,checkpoint=p.getProperty(nextKey),outputs=[];
    if(single){var email=String(c.DWD_TEST_USER_EMAIL||'').toLowerCase();if(!users.some(function(u){return u.email===email;}))throw new Error('DWD_TEST_USER_EMAILは有効・ライセンスあり・除外外の対象ユーザーにしてください。');users=users.filter(function(u){return u.email===email;});}
    if(!preview)OrganizerRegistry_.prune(c);
    var start=checkpoint&&!single?users.findIndex(function(u){return u.email>=checkpoint;}):0;if(start<0)start=0;users=users.slice(start).concat(users.slice(0,start));
    for(var i=0;i<users.length&&Date.now()<deadline;i++){var email=users[i].email;
      try{var r=scan(c,email,deadline,preview);outputs.push(r);if(!preview&&!r.continued&&!r.results.some(function(v){return v.status==='要確認';}))p.setProperty('DWD_COVERED:'+c.ENV+':'+Organizer_.hash(email),String(Date.now()));console.log('管理者収集：'+email+'／予定走査'+r.scanned+'件／'+JSON.stringify(r.results));}
      catch(e){outputs.push({email:email,status:'ユーザーの取得失敗',api:e.api||'Calendar・委任設定',code:Number(e.code)||0});console.log('管理者収集：'+email+'の取得に失敗しました。委任・Calendarの有効化を確認してください。');}
      if(!preview&&!single)p.setProperty(nextKey,users[(i+1)%users.length].email);
    }
    if(!preview)OrganizerRegistry_.prune(c);
    var summary={dryRun:c.DRY_RUN==='true',eligibleUsers:users.length,visitedUsers:outputs.length,users:outputs};
    if(!preview)p.setProperty('DWD_LAST_RUN:'+c.ENV,JSON.stringify({at:new Date().toISOString(),eligible:users.length,visited:outputs.length,errors:outputs.filter(function(r){return r.status||(r.results||[]).some(function(v){return v.status==='要確認';});}).length}));
    console.log('管理者収集を'+(c.DRY_RUN==='true'?'読み取り確認':'実行')+'しました。対象'+users.length+'人、今回'+outputs.length+'人。');return summary;
  });}
  return {actor:actor,config:config,excluded:excluded,eligible:eligible,roster:roster,run:run,scan:scan};
})();
function previewDelegatedMeetings(){return Delegated_.run(true,false,false);}
function runDelegatedSingleUser(){return Delegated_.run(false,true,false);}
function delegatedMoverTick_(){return Delegated_.run(false,false,true);}
function setupDelegatedMoverTrigger(){Delegated_.actor(false);return Organizer_.lock(function(){var c=Delegated_.config();if(c.DWD_ENABLED!=='true')throw new Error('DWD_ENABLED=trueで有効化してください。');if(c.DRY_RUN==='false'&&!PropertiesService.getScriptProperties().getProperty('MOVER_REGISTRY_MIGRATED:'+c.ENV))throw new Error('先に処理済み記録を移行してください。');var mine=ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='delegatedMoverTick_';});if(c.DRY_RUN==='true'){console.log('管理者収集の15分トリガーを1個にする予定です。');return {dryRun:true};}while(mine.length>1)ScriptApp.deleteTrigger(mine.pop());if(!mine.length)ScriptApp.newTrigger('delegatedMoverTick_').timeBased().everyMinutes(15).create();console.log('管理者収集の15分トリガーを設定しました。各自登録のトリガーは変更しません。');});}
function removeDelegatedMoverTrigger(){Delegated_.actor(false);return Organizer_.lock(function(){var c=Organizer_.config();if(c.DRY_RUN==='true'){console.log('管理者収集トリガーの解除予定です。');return;}PropertiesService.getScriptProperties().setProperty('DWD_ENABLED','false');ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='delegatedMoverTick_';}).forEach(function(t){ScriptApp.deleteTrigger(t);});});}
// 既存のmanifestはAが移動した後も同じ共有ドライブ内にあり、公開propertiesで列挙できます。
function moverRegistryMigration_(preview){Delegated_.actor(false);return Organizer_.lock(function(){var c=Delegated_.config(),token,count=0,started=Date.now();if(preview)c.DRY_RUN='true';do{if(Date.now()-started>180000)throw new Error('移行が時間制限に達しました。一括収集は有効にせず再実行してください。');var args={q:"trashed=false and mimeType='application/json' and name='manifest.json' and properties has { key='minutes_role' and value='manifest' } and properties has { key='minutes_env' and value='"+c.ENV+"' }",corpora:'drive',driveId:c.SHARED_DRIVE_ID,includeItemsFromAllDrives:true,supportsAllDrives:true,pageSize:100,fields:'nextPageToken,files(id,parents,properties)'};if(token)args.pageToken=token;var page=GoogleApi_.list(args);(page.files||[]).forEach(function(f){var text=DelegatedAuth_.get('finance@premiere-mode.co.jp','drive','https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(f.id),{alt:'media',supportsAllDrives:true}),m=typeof text==='string'?JSON.parse(text):text;
    if(m.status!=='ready'||!/^meet:/.test(m.meeting_key||'')||!Number.isFinite(Date.parse(m.start))||!Number.isFinite(Date.parse(m.end))||Date.parse(m.end)<Date.now()-7*86400000)return;
    if(c.ENV==='prod'&&Date.parse(m.start)<Date.parse(c.PRODUCTION_START_AT))return;
    // test/prodはファイルの実親をたどり、プロパティだけを信用しません。
    var parent=f.parents&&f.parents[0],seen={};while(parent&&parent!==c.FOLDER_SYSTEM_TEST_ID&&parent!==c.SHARED_DRIVE_ID){if(seen[parent])throw new Error('既存manifestの親が循環しています。');seen[parent]=true;var meta=GoogleApi_.get(parent,{supportsAllDrives:true,fields:'id,parents,trashed,driveId'});if(meta.driveId!==c.SHARED_DRIVE_ID)throw new Error('既存manifestの共有ドライブが一致しません。');if(meta.trashed||c.ENV==='prod'&&parent==='1pKWcGDuRCBf3VG0AfKBaKghE0nD3kYwW')return;parent=meta.parents&&meta.parents[0];}
    if(c.ENV==='test'&&parent!==c.FOLDER_SYSTEM_TEST_ID||c.ENV==='prod'&&![c.FOLDER_SYSTEM_ID,c.SHARED_DRIVE_ID].includes(parent))return;
    OrganizerRegistry_.save(c,m.meeting_key,{ready:true,folderId:f.parents[0],manifestId:f.id,transcriptSource:m.transcript_source});count++;
  });token=page.nextPageToken;}while(token);if(c.DRY_RUN==='false'){var props=PropertiesService.getScriptProperties();props.setProperty('DWD_REGISTRY_SCRIPT_ID',ScriptApp.getScriptId());props.setProperty('MOVER_REGISTRY_MIGRATED:'+c.ENV,new Date().toISOString());}console.log('既存の処理済み記録：'+count+'件'+(c.DRY_RUN==='true'?'を共有する予定です。':'を共有しました。'));return {dryRun:c.DRY_RUN==='true',count:count};});}

function checkDelegatedStatus(){Delegated_.actor(false);var c=Delegated_.config(),p=PropertiesService.getScriptProperties(),last=p.getProperty('DWD_LAST_RUN:'+c.ENV),next=p.getProperty('DWD_NEXT:'+c.ENV);var value={env:c.ENV,enabled:c.DWD_ENABLED==='true',migrated:!!p.getProperty('MOVER_REGISTRY_MIGRATED:'+c.ENV),lastRun:last?JSON.parse(last):null,nextUser:next||null};console.log('管理者収集の稼働状況：'+JSON.stringify(value));return value;}

function previewMoverProcessedRecords(){return moverRegistryMigration_(true);}
function migrateMoverProcessedRecords(){return moverRegistryMigration_(false);}
function previewDelegatedSingleUser(){return Delegated_.run(true,true,false);}


// delegatedAuth.js
// 外部ライブラリ不要のRS256。鍵・JWT・トークン・応答本文はログに出しません。
var DelegatedAuth_=(function(){
  var base='https://www.googleapis.com/auth/';
  var scopes={admin:[base+'admin.directory.user.readonly',base+'apps.licensing'],user:[base+'calendar.readonly',base+'drive'],drive:[base+'drive']};
  function key(){var value;try{value=JSON.parse(PropertiesService.getScriptProperties().getProperty('SA_KEY_JSON')||'{}');}catch(e){throw new Error('SA_KEY_JSONをJSON形式で設定してください。');}
    if(value.type!=='service_account'||!/^.+@.+\.iam\.gserviceaccount\.com$/.test(value.client_email||'')||!/^\d+$/.test(value.client_id||'')||!/^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----\n?$/.test(value.private_key||''))throw new Error('SA_KEY_JSONの形式が不正です。鍵の内容は表示しません。');return value;}
  function b64(value){return Utilities.base64EncodeWebSafe(value).replace(/=+$/,'');}
  function token(subject,kind){
    if(!/^[^@\s]+@premiere-mode\.co\.jp$/.test(subject)||!scopes[kind])throw new Error('委任対象またはスコープが不正です。');
    var k=key(),cache=CacheService.getScriptCache(),cacheKey='DWD_TOKEN:'+Organizer_.hash(k.client_email+':'+(k.private_key_id||Organizer_.hash(k.private_key))+':'+subject+':'+kind),saved=cache.get(cacheKey);if(saved)return saved;
    var now=Math.floor(Date.now()/1000),unsigned=b64(JSON.stringify({alg:'RS256',typ:'JWT'}))+'.'+b64(JSON.stringify({iss:k.client_email,sub:subject,scope:scopes[kind].join(' '),aud:'https://oauth2.googleapis.com/token',iat:now-30,exp:now+3300}));
    var assertion,response;try{assertion=unsigned+'.'+b64(Utilities.computeRsaSha256Signature(unsigned,k.private_key));}catch(e){throw new Error('サービスアカウントの秘密鍵で署名できません。鍵の形式を確認してください。');}
    try{response=UrlFetchApp.fetch('https://oauth2.googleapis.com/token',{method:'post',payload:{grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:assertion},muteHttpExceptions:true,followRedirects:false});}catch(e){throw new Error('委任トークン取得の通信に失敗しました。');}
    var status=response.getResponseCode(),data;try{data=JSON.parse(response.getContentText());}catch(e){data={};}
    if(status!==200||typeof data.access_token!=='string'||!data.access_token||!Number.isFinite(Number(data.expires_in))||Number(data.expires_in)<120){var error=new Error('委任トークンを取得できません（HTTP '+status+'）。委任のクライアントID・スコープ・鍵・対象ユーザーを確認してください。');error.code=status;error.api='委任認証';throw error;}
    cache.put(cacheKey,data.access_token,Math.min(3000,Number(data.expires_in)-60));return data.access_token;
  }
  function query(args){return Object.keys(args||{}).filter(function(k){return args[k]!==undefined&&args[k]!==null;}).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(String(args[k]));}).join('&');}
  function request(subject,kind,url,method,body,media){
    if(!/^https:\/\/(?:www\.googleapis\.com\/(?:drive\/v3\/|calendar\/v3\/)|docs\.googleapis\.com\/v1\/|admin\.googleapis\.com\/admin\/directory\/v1\/|licensing\.googleapis\.com\/apps\/licensing\/v1\/)/.test(url))throw new Error('許可されていない委任APIです。');
    method=method||'get';if(!['get','patch'].includes(method)||method==='patch'&&!url.startsWith('https://www.googleapis.com/drive/v3/files/'))throw new Error('委任APIでは読み取りとDrive移動だけを許可します。');
    // PATCHは同じID・同じ親への操作だけ。作成APIは既存の冪等ラッパーを使用します。
    function execute(){var r,bearer=token(subject,kind);
      try{r=UrlFetchApp.fetch(url,{method:method,headers:{Authorization:'Bearer '+bearer},contentType:'application/json',...(body?{payload:JSON.stringify(body)}:{}),muteHttpExceptions:true,followRedirects:false});}catch(e){throw new Error('委任APIの通信に失敗しました。応答不明のため次回確認します。');}
      var code=r.getResponseCode(),value;try{value=JSON.parse(r.getContentText());}catch(e){value=null;}
      if(code<200||code>=300){var rate=code===429||code===403&&value&&value.error&&(value.error.errors||[]).some(function(v){return ['rateLimitExceeded','userRateLimitExceeded'].includes(v.reason);});var err=new Error('委任API HTTP '+code+(rate?' rateLimitExceeded':''));err.code=code;err.api=url.includes('admin.googleapis.com')?'Directory':url.includes('licensing.googleapis.com')?'ライセンス':url.includes('calendar/v3')?'Calendar':url.includes('docs.googleapis.com')?'Docs':'Drive';throw err;}
      if(media)return r.getContentText();if(!value)throw new Error('委任APIからJSONを取得できません。');return value;
    }
    return method==='patch'?execute():GoogleApi_.call('委任API取得',execute);
  }
  function get(subject,kind,url,args){return request(subject,kind,url+(Object.keys(args||{}).length?'?'+query(args):''));}
  function drive(c,email){
    var url='https://www.googleapis.com/drive/v3/files/';
    return {
      get:function(id,args){return get(email,'user',url+encodeURIComponent(id),args);},
      list:function(args){return get(email,'user',url.slice(0,-1),args);},
      docsGet:function(id,args){return get(email,'user','https://docs.googleapis.com/v1/documents/'+encodeURIComponent(id),args);},
      create:GoogleApi_.create,
      update:function(body,id,blob,args){
        if(!args.addParents&&!args.removeParents)return GoogleApi_.update(body,id,blob,args);
        if(c.DRY_RUN!=='false')throw new Error('DRY_RUN中の委任移動は禁止です。');
        return GoogleApi_.call('委任Drive移動',function(){
          var current=get(email,'user',url+encodeURIComponent(id),{supportsAllDrives:true,fields:'id,parents,driveId,properties'}),parents=current.parents||[],options=Object.assign({},args);
          if(current.driveId&&current.driveId!==c.SHARED_DRIVE_ID)throw new Error('別の共有ドライブからは移動しません。');
          if(parents.includes(args.addParents)){delete options.addParents;delete options.removeParents;}else{
            if(parents.length!==1||parents[0]!==args.removeParents)throw new Error('移動中に親が変更されました。自動で追いかけません。');
          }
          return request(email,'user',url+encodeURIComponent(id)+'?'+query(options),'patch',body);
        });
      }
    };
  }
  return {scopes:scopes,key:key,token:token,get:get,request:request,drive:drive};
})();


// drive.js
var OrganizerDrive_=(function(){
  var folderMime='application/vnd.google-apps.folder';
  function open(c,api){
    api=api||GoogleApi_;
    var cache={};
    function get(id,fresh){if(fresh)delete cache[id];return cache[id]||(cache[id]=api.get(id,{supportsAllDrives:true,fields:'id,name,mimeType,parents,driveId,trashed,ownedByMe,owners(emailAddress),capabilities(canEdit,canAddChildren,canMoveItemOutOfDrive),appProperties,properties'}));}
    var root=get(c.FOLDER_SYSTEM_TEST_ID),system=get(c.FOLDER_SYSTEM_ID),raw=get(c.FOLDER_INBOX_RAW_TEST_ID);
    function folderCheck(f,name,parent){if(f.trashed||f.mimeType!==folderMime||f.name!==name||f.driveId!==c.SHARED_DRIVE_ID||!f.parents||f.parents.length!==1||f.parents[0]!==parent)throw new Error('指定の共有ドライブ配下のフォルダではありません: '+name);}
    folderCheck(system,'_system',c.SHARED_DRIVE_ID);if(c.ENV==='prod'){if(root.id!==system.id)throw new Error('本番ルートが違います。');}else folderCheck(root,'_test',system.id);folderCheck(raw,'00_受信',root.id);
    if(raw.capabilities&&raw.capabilities.canAddChildren===false)throw new Error('受信フォルダへ追加する権限がありません。');
    function write(){if(c.DRY_RUN!=='false')throw new Error('DRY_RUN中のDrive書き込みは禁止です。');}
    function list(parent){var out=[],token;do{var args={q:"'"+parent.replace(/'/g,"\\'")+"' in parents and trashed=false",corpora:'drive',driveId:c.SHARED_DRIVE_ID,includeItemsFromAllDrives:true,supportsAllDrives:true,pageSize:100,fields:'nextPageToken,files(id,name,mimeType,parents,properties,appProperties,driveId,trashed)'};if(token)args.pageToken=token;var r=api.list(args);out=out.concat(r.files||[]);token=r.nextPageToken;}while(token);return out;}
    function child(parent,name,role,meetingKey,create){if(![root.id,raw.id].includes(parent))throw new Error('許可された親フォルダではありません。');var matches=list(parent).filter(function(f){return f.name===name;});if(matches.length>1)throw new Error('同名フォルダが重複しています。');if(matches.length){var f=matches[0];if(f.mimeType!==folderMime || !f.properties || f.properties.minutes_role!==role || meetingKey&&f.properties.meeting_key!==meetingKey)throw new Error('同名の既存フォルダの用途を確認できません。上書きしません。');return f;}if(!create)return null;write();var props={minutes_role:role,minutes_env:c.ENV};if(meetingKey)props.meeting_key=meetingKey;return api.create({name:name,mimeType:folderMime,parents:[parent],properties:props},null,{supportsAllDrives:true,fields:'id,name,mimeType,parents,properties'});}
    function json(parent,name,value,role){write();var p=get(parent,true);if(p.driveId!==c.SHARED_DRIVE_ID||!p.parents||p.parents.length!==1||![root.id,raw.id].includes(p.parents[0]))throw new Error('登録・会議フォルダの所属が不正です。');var matches=list(parent).filter(function(f){return f.name===name;});if(matches.length>1)throw new Error('同名JSONが重複しています。');var props={minutes_role:role,minutes_env:c.ENV},blob=Utilities.newBlob(JSON.stringify(value,null,2),'application/json',name);if(matches.length){var f=matches[0];if(f.mimeType!=='application/json'||!f.properties||f.properties.minutes_role!==role)throw new Error('既存JSONの用途を確認できません。');return api.update({properties:props},f.id,blob,{supportsAllDrives:true,fields:'id'});}return api.create({name:name,mimeType:'application/json',parents:[parent],properties:props},blob,{supportsAllDrives:true,fields:'id'});}
    function validateSource(file,folder,key,email){
      if(file.trashed || file.mimeType==='application/vnd.google-apps.shortcut')throw new Error('削除済み添付・ショートカットは移動しません。');
      var privateMark=(file.appProperties||{}).meeting_key,publicMark=(file.properties||{}).meeting_key;
      if(privateMark&&publicMark&&privateMark!==publicMark)throw new Error('添付の会議目印が矛盾しています。');
      var mark=publicMark||privateMark;if(mark&&mark!==key)throw new Error('添付が別の会議に登録済みです。');
      if(file.driveId){if(file.driveId!==c.SHARED_DRIVE_ID||!folder||!file.parents||file.parents.length!==1||file.parents[0]!==folder.id||mark!==key)throw new Error('自分のマイドライブまたは今回の受信フォルダ以外にある添付は移動しません。');return;}
      if(!file.ownedByMe || (file.owners||[]).length && !file.owners.some(function(o){return String(o.emailAddress||'').toLowerCase()===email;}) || !file.parents || file.parents.length!==1 || file.capabilities&& (file.capabilities.canEdit===false || file.capabilities.canMoveItemOutOfDrive===false))throw new Error('添付の所有者・共有ドライブへの移動権限を確認してください。');
    }
    function move(file,folder,key,kind,email){write();file=get(file.id,true);if(MoverPlan_.kind(file)!==kind)throw new Error('実行直前に添付の種類が変わりました。');validateSource(file,folder,key,email);if(file.driveId)return;api.update({appProperties:Object.assign({},file.appProperties||{},{meeting_key:key,kind:kind}),properties:Object.assign({},file.properties||{},{meeting_key:key,kind:kind,minutes_env:c.ENV})},file.id,null,{addParents:folder.id,removeParents:file.parents[0],supportsAllDrives:true,fields:'id,parents,driveId'});delete cache[file.id];}
    return {root:root,raw:raw,get:get,list:list,child:child,json:json,validateSource:validateSource,move:move,docsGet:api.docsGet};
  }
  return {open:open};
})();


// googleApi.generated.js
// shared/googleApi.jsから生成します。
// Advanced Servicesの一時障害だけを再試行します。本文・ID・エラー原文はログに出しません。
var GoogleApi_=(function(){
  var waits=[500,1000,2000,4000];
  function status(error){
    var details=error&&error.details||{},nested=error&&error.error||details.error||{},message=String(error&&error.message||error||'')+' '+JSON.stringify(details);
    var codes=[error&&error.code,error&&error.statusCode,error&&error.responseCode,details.code,nested.code].map(Number).filter(function(n){return n>=400&&n<=599;});
    if(codes.length)return codes[0];
    var match=message.match(/(?:HTTP\s*|status(?:\s*code)?[\s:=]*|error\s*[:=]\s*|["']?code["']?\s*[:=]\s*)([45]\d\d)\b/i);return match?Number(match[1]):0;
  }
  function classify(error){
    var details=error&&error.details||{},message=String(error&&error.message||error||''),code=status(error);
    var info=message+' '+JSON.stringify(details);
    var rate=/\b(?:userRateLimitExceeded|rateLimitExceeded|RATE_LIMIT_EXCEEDED)\b|rate[ _-]*limit(?:[ _-]*exceeded)?|too many requests/i.test(info);
    if(code>=400&&code<500)return code===429||code===403&&rate?'rate':'permanent';
    if(code>=500&&code<=599)return 'transient';
    if(rate)return 'rate';
    return /internal[ _-]*error|backend[ _-]*error|\bINTERNAL\b|\bUNAVAILABLE\b|service unavailable|bad gateway|gateway timeout/i.test(info)?'transient':'permanent';
  }
  function pause(label,index){console.log(label+'：一時エラーのため'+waits[index]+'ミリ秒後に再試行します（'+(index+1)+'/4）。');Utilities.sleep(waits[index]);}
  function call(label,fn){for(var i=0;;i++){try{return fn(i);}catch(e){if(classify(e)==='permanent'||i===waits.length)throw e;pause(label,i);}}}
  function get(id,args){return call('Drive取得',function(){return Drive.Files.get(id,args);});}
  function list(args){return call('Drive一覧取得',function(){return Drive.Files.list(args);});}
  function docsGet(id,args){return call('Docs取得',function(){return Docs.Documents.get(id,args);});}
  function update(body,id,blob,args){return call('Drive更新',function(attempt){
    var options=Object.assign({},args);
    // 移動済みの応答だけ失敗した場合、現在の親に合わせて差分を作り直します。
    if(attempt&&(options.addParents||options.removeParents)){
      var current=get(id,{supportsAllDrives:true,fields:'id,parents'}),parents=current.parents||[];
      if(options.addParents){var add=options.addParents.split(',').filter(function(p){return !parents.includes(p);});if(add.length)options.addParents=add.join(',');else delete options.addParents;}
      if(options.removeParents){var remove=options.removeParents.split(',').filter(function(p){return parents.includes(p);});if(remove.length)options.removeParents=remove.join(',');else delete options.removeParents;}
    }
    return Drive.Files.update(body,id,blob,options);
  });}
  function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object'){var o={};Object.keys(value).sort().forEach(function(k){o[k]=stable(value[k]);});return o;}return value;}
  function hash(value){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(stable(value)),Utilities.Charset.UTF_8).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
  function create(body,blob,args){
    var metadata=JSON.parse(JSON.stringify(body)),token=hash(metadata),key='GOOGLE_CREATE_PENDING:'+token,props=PropertiesService.getScriptProperties();
    var record=props.getProperty(key);record=record?JSON.parse(record):null;
    var contentHash=hash(blob?blob.getDataAsString('UTF-8'):null);
    if(record&&record.contentHash!==contentHash)throw new Error('前回作成結果が不明なまま本文が変わりました。二重作成せず停止します。');
    var first=!record;
    if(!record){
      record={token:token,contentHash:contentHash};
      // Docs/Sheets等は事前IDに非対応。フォルダ・通常ファイルは同じIDで安全に再送できます。
      if((!/^application\/vnd\.google-apps\./.test(metadata.mimeType||'')||metadata.mimeType==='application/vnd.google-apps.folder')&&typeof Drive.Files.generateIds==='function'){
        var ids=call('Drive作成ID取得',function(){return Drive.Files.generateIds({count:1,space:'drive',fields:'ids'});});
        if(!ids.ids||ids.ids.length!==1)throw new Error('Driveの作成IDを取得できません。');record.id=ids.ids[0];
      }
      props.setProperty(key,JSON.stringify(record));
    }
    metadata.appProperties=Object.assign({},metadata.appProperties||{},{minutes_create_key:record.token});
    if(record.id)metadata.id=record.id;
    function verify(file){
      if(!file||file.trashed||file.name!==metadata.name||file.mimeType!==metadata.mimeType||JSON.stringify((file.parents||[]).slice().sort())!==JSON.stringify((metadata.parents||[]).slice().sort())||(file.appProperties||{}).minutes_create_key!==record.token)throw new Error('作成済みファイルの所属・用途が一致しません。二重作成せず停止します。');
      return file;
    }
    function recover(){
      if(record.id){try{return verify(get(record.id,{supportsAllDrives:true,fields:'id,name,mimeType,parents,appProperties,properties,driveId,trashed'}));}catch(e){if(status(e)===404||!status(e)&&/file not found|not found|見つかりません/i.test(String(e.message||'')))return null;throw e;}}
      if(!metadata.parents||metadata.parents.length!==1)throw new Error('作成結果を確認する親フォルダがありません。');
      var parent=get(metadata.parents[0],{supportsAllDrives:true,fields:'id,driveId'}),options={q:"'"+metadata.parents[0].replace(/'/g,"\\'")+"' in parents and trashed=false and appProperties has { key='minutes_create_key' and value='"+record.token+"' }",supportsAllDrives:true,includeItemsFromAllDrives:true,pageSize:100,fields:'nextPageToken,files(id,name,mimeType,parents,appProperties,properties,driveId,trashed)'};
      if(parent.driveId){options.corpora='drive';options.driveId=parent.driveId;}else options.corpora='user';
      var found=[],page;do{page=list(options);found=found.concat((page.files||[]).filter(function(f){return (f.appProperties||{}).minutes_create_key===record.token;}));options.pageToken=page.nextPageToken;}while(options.pageToken);
      if(found.length>1)throw new Error('作成結果が重複しています。既存ファイルを確認してください。');return found.length?verify(found[0]):null;
    }
    for(var i=0;i<=waits.length;i++){
      if(!first||i){var existing=recover();if(existing){props.deleteProperty(key);return existing;}}
      // ID非対応の作成が曖昧に失敗した場合、一覧の反映を待つだけで再送しません。
      if(first||record.id||record.rejected){
        record.rejected=false;props.setProperty(key,JSON.stringify(record));
        try{var result=Drive.Files.create(metadata,blob,args);if(!result||!result.id||record.id&&result.id!==record.id)throw new Error('Internal Error: Drive作成結果が不明です。');props.deleteProperty(key);return result;}
        catch(e){var type=classify(e);if(type==='permanent'){if(status(e)===409&&record.id){var conflict=recover();if(conflict){props.deleteProperty(key);return conflict;}}if(i===0&&first&&[400,401,403,404,405,422].includes(status(e)))props.deleteProperty(key);throw e;}record.rejected=type==='rate'&&[403,429].includes(status(e));props.setProperty(key,JSON.stringify(record));}
      }
      first=false;if(i<waits.length)pause('Drive作成結果確認',i);
    }
    throw new Error('Drive作成結果を確認できません。二重作成を避けるため保留しました。GOOGLE_CREATE_PENDINGの記録を消さず、作成先を確認してください。');
  }
  return {classify:classify,call:call,get:get,list:list,update:update,create:create,docsGet:docsGet};
})();


// mover.js
function moverRun(e){return Organizer_.lock(function(){
  var email=Organizer_.actor(true),c=Organizer_.config(),registration=OrganizerRegistration_.state();
  if(c.DRY_RUN==='false'&&!registration.registered)throw new Error('実際の移動は先に登録画面から登録してください。');
  if(e&&e.triggerUid&&String(e.triggerUid)!==registration.trigger_id)throw new Error('登録されているトリガーと一致しません。');
  if(c.MOVER_MODE==='TEST_EVENT'&&!/^[A-Za-z0-9_-]+$/.test(c.MOVER_TEST_EVENT_ID||''))throw new Error('MOVER_TEST_EVENT_IDに実機テスト用予定のIDを設定してください。他の会議は処理しません。');
  if(OrganizerRegistry_.excluded(c,email)){console.log('管理者の除外設定により、この主催者は収集しません。');return [];}
  var drive=OrganizerDrive_.open(c),user=PropertiesService.getUserProperties(),now=Date.now(),results=[],events=[],token,started=now;
  if(e&&e.triggerUid&&OrganizerRegistry_.retire(c,email,registration,drive))return [{status:'管理者収集へ移行済み'}];
  try{do{var args={timeMin:new Date(now-72*3600000).toISOString(),timeMax:new Date(now).toISOString(),singleEvents:true,showDeleted:false,maxResults:250};if(token)args.pageToken=token;var page=Calendar.Events.list('primary',args);events=events.concat(page.items||[]);token=page.nextPageToken;}while(token&&Date.now()-started<120000);
  if(c.MOVER_MODE==='TEST_EVENT'){events=events.filter(function(ev){return ev.id===c.MOVER_TEST_EVENT_ID;});
  if(!events.length)events=[Calendar.Events.get('primary',c.MOVER_TEST_EVENT_ID)];}
  else events=events.filter(function(ev){return ev.end&&Date.parse(ev.end.dateTime)>=now-72*3600000;});
  events.forEach(function(event){
    if(Date.now()-started>240000)return;
    try{var result=OrganizerMover_.one(event,email,c,drive,user,now);if(result)results.push(result);
    }catch(eventError){if(c.MOVER_MODE!=='AUTO')throw eventError;results.push({eventId:event.id,status:'要確認・会議の取り込みに失敗しました'});console.log('自動取り込み要確認：GAS-Bの添付・権限を確認してください。');}
  });
    if(c.DRY_RUN==='false'){registration.last_run_at=new Date().toISOString();registration.last_result=results.map(function(r){return r.status;}).join('／');OrganizerRegistration_.save(registration);OrganizerRegistration_.receipt(c,drive,email,registration);}
  }catch(err){console.log('GAS-B処理を停止しました: '+err.message);if(c.DRY_RUN==='false'){registration.last_run_at=new Date().toISOString();registration.last_result='エラー：'+String(err.message).slice(0,160);OrganizerRegistration_.save(registration);try{OrganizerRegistration_.receipt(c,drive,email,registration);}catch(ignore){console.log('登録状況の更新も失敗しました。GASの実行履歴を確認してください。');}}throw err;}
  console.log('主催者用処理の結果: '+JSON.stringify(results));return results;
});}
// テスト予定のCalendar API IDを取得するための読み取り専用一覧です。
function listOrganizerTestEvents(){var email=Organizer_.actor(false);Organizer_.config();var now=Date.now(),all=[],token;do{var args={timeMin:new Date(now-72*3600000).toISOString(),timeMax:new Date(now+24*3600000).toISOString(),singleEvents:true,showDeleted:false,maxResults:250};if(token)args.pageToken=token;var page=Calendar.Events.list('primary',args);(page.items||[]).forEach(function(e){if(e.organizer&&e.organizer.self&&String(e.organizer.email||'').toLowerCase()===email&&e.conferenceData&&e.conferenceData.conferenceSolution&&e.conferenceData.conferenceSolution.key&&e.conferenceData.conferenceSolution.key.type==='hangoutsMeet'){var r={id:e.id,title:e.summary||'会議',start:e.start&&e.start.dateTime,attachments:(e.attachments||[]).length};all.push(r);console.log('テスト予定候補：'+r.title+'／'+r.start+'／MOVER_TEST_EVENT_ID='+r.id+'／添付'+r.attachments+'件');}});token=page.nextPageToken;}while(token);return all;}

// 個別登録と管理者収集は必ず同じGAS-BのScriptLock内から呼びます。
var OrganizerMover_={one:function(event,email,c,drive,user,now){
var plan=MoverPlan_.event(event,email,now,c.MOVER_WAIT_MIN,c.MOVER_MODE);if(!plan){if(c.MOVER_MODE==='AUTO')return null;return {eventId:event.id,status:'対象外・終了待ち',message:'自分主催のMeet付き予定、終了待ち時間を確認してください。'};}
    if(c.ENV==='prod'&&Date.parse(plan.manifest.start)<Date.parse(c.PRODUCTION_START_AT))return;
    var shared=OrganizerRegistry_.get(c,plan.key);if(shared&&shared.ready)return Object.assign({meeting_key:plan.key,status:'処理済み'},shared);
    var stateKey=(c.ENV==='prod'?'mover:prod:':'mover:')+Organizer_.hash(plan.key),saved=user.getProperty(stateKey),state=saved?JSON.parse(saved):{};
    if(state.ready){OrganizerRegistry_.save(c,plan.key,state);return {meeting_key:plan.key,status:'処理済み',folderId:state.folderId,manifestId:state.manifestId,transcript_source:state.transcriptSource||null};}
    var folder=drive.child(drive.raw.id,plan.folderKey,'meeting_raw',plan.key,false),meta={};
    (event.attachments||[]).forEach(function(a){if(a.fileId&&!meta[a.fileId])meta[a.fileId]=drive.get(a.fileId);});
    var files=MoverPlan_.files(event.attachments,meta);
    var items=Object.keys(files.found);
    if(c.MOVER_MODE==='AUTO'&&!items.length)return;files.ignored.forEach(function(f){console.log('判定できない添付は移動しません: '+f.name);});
    items.forEach(function(k){drive.validateSource(files.found[k],folder,plan.key,email);});
    var transcriptSource=OrganizerTranscript_.resolve(files,drive.docsGet);
    if(transcriptSource)files.missing=files.missing.filter(function(k){return k!=='transcript';});
    if(!transcriptSource&&files.found.gemini&&now-Date.parse(plan.manifest.end)>=c.MOVER_MEMO_WAIT_MIN*60000){transcriptSource={type:'gemini_notes',file_id:files.found.gemini.id};plan.manifest.input_quality='notes_only';}
    plan.manifest.transcript_source=transcriptSource;
    if(c.MOVER_MODE==='AUTO'&&!transcriptSource&&now-Date.parse(plan.manifest.end)>=c.MOVER_MEMO_WAIT_MIN*60000){return {meeting_key:plan.key,status:'要確認・文字起こしもメモもありません',missing:files.missing};}
    if(files.missing.length&&!plan.expired&&!(transcriptSource&&(c.MOVER_MODE==='AUTO'||transcriptSource.type==='gemini_notes'))){return {meeting_key:plan.key,status:'添付待ち',missing:files.missing};}
    if(c.MOVER_MODE==='AUTO'&&!transcriptSource){return {meeting_key:plan.key,status:'要確認・文字起こしもメモもありません',missing:files.missing};}
    var planned={meeting_key:plan.key,status:c.DRY_RUN==='true'?'移動予定':'移動中',folderName:plan.folderKey,files:items.map(function(k){var f=files.found[k];return {kind:k,id:f.id,name:f.name,from:f.parents[0],to:folder?folder.id:c.FOLDER_INBOX_RAW_TEST_ID+'/'+plan.folderKey};}),missing:files.missing,transcript_source:transcriptSource};console.log(JSON.stringify(planned));
    if(c.DRY_RUN==='true')return planned;
    folder=folder||drive.child(drive.raw.id,plan.folderKey,'meeting_raw',plan.key,true);state.folderId=folder.id;state.ready=false;user.setProperty(stateKey,JSON.stringify(state));
    items.forEach(function(k){drive.move(files.found[k],folder,plan.key,k,email);plan.manifest.files[k]=files.found[k].id;});
    plan.manifest.missing=files.missing;
    var manifest=drive.json(folder.id,'manifest.json',plan.manifest,'manifest');
    state.ready=true;state.manifestId=manifest.id;state.transcriptSource=transcriptSource;OrganizerRegistry_.save(c,plan.key,state);user.setProperty(stateKey,JSON.stringify(state));
    return {meeting_key:plan.key,status:'ready',folderId:folder.id,manifestId:manifest.id,missing:files.missing,transcript_source:transcriptSource};

}};


// plan.js
var MoverPlan_=(function(){
  var kinds=['recording','transcript','gemini'];
  function event(event,email,now,wait,mode){
    if(mode==='AUTO'&&event&&(event.visibility==='private'||String(event.summary||'').includes('【記録なし】')))return null;
    if(!event || event.status==='cancelled' || !event.organizer || event.organizer.self!==true || String(event.organizer.email||'').toLowerCase()!==email)return null;
    var start=event.start&&event.start.dateTime,end=event.end&&event.end.dateTime;
    if(!start||!end||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(end)<=Date.parse(start)||Date.parse(end)>now-wait*60000)return null;
    var conference=event.conferenceData;
    if(!conference||!conference.conferenceSolution||!conference.conferenceSolution.key||conference.conferenceSolution.key.type!=='hangoutsMeet')return null;
    var entry=(conference.entryPoints||[]).find(function(p){return p.entryPointType==='video'&&/^https:\/\/meet\.google\.com\/[a-z0-9-]+(?:\?.*)?$/i.test(p.uri||'');});
    if(!entry)return null;
    var stamp=new Date(start).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
    if(!/^[A-Za-z0-9_-]+$/.test(event.id||''))throw new Error('予定IDが不正です。');
    var eventKey=event.id.endsWith('_'+stamp)?event.id:event.id+'_'+stamp,key='meet:'+eventKey;
    if(key.length>100)throw new Error('会議キーが長すぎます。個別確認が必要です。');
    var attendees=(event.attendees||[]).filter(function(a){return a.email;}).map(function(a){return {email:a.email,name:a.displayName||a.email};});
    if(!attendees.some(function(a){return a.email.toLowerCase()===email;}))attendees.push({email:email,name:email});
    return {key:key,folderKey:key.replace(/:/g,'_'),expired:now-Date.parse(end)>=48*3600000,manifest:{meeting_key:key,source:'meet',event_id:event.id,title:event.summary||'会議',start:start,end:end,organizer_email:email,attendees:attendees,meet_url:entry.uri,files:{},missing:[],status:'ready',created_at:new Date(now).toISOString()}};
  }
  function kind(file){var mime=file.mimeType||'',name=file.name||'';if(mime.startsWith('video/'))return 'recording';if(mime!=='application/vnd.google-apps.document')return null;if(/(?:gemini\s*によるメモ|notes\s+by\s+gemini)\s*$/i.test(name))return 'gemini';var transcript=/文字起こし|transcript/i.test(name),gemini=/gemini|メモ|meeting notes|notes by/i.test(name);if(transcript&&gemini)throw new Error('文字起こしとメモの判定が重複しています: '+name);return transcript?'transcript':gemini?'gemini':null;}
  function files(attachments,metadata){var found={},ignored=[];var seen=new Set();(attachments||[]).forEach(function(a){if(!a.fileId||seen.has(a.fileId))return;seen.add(a.fileId);var f=metadata[a.fileId];if(!f)throw new Error('添付のメタデータを取得できません。');var k=kind(f);if(!k){ignored.push({id:f.id,name:f.name});return;}if(found[k])throw new Error('同じ種類の添付が複数あります。自動選択せず停止します: '+k);found[k]=f;});return {found:found,ignored:ignored,missing:kinds.filter(function(k){return !found[k];})};}
  return {event:event,files:files,kind:kind,kinds:kinds};
})();


// register.js
var OrganizerRegistration_=(function(){
  function state(){var text=PropertiesService.getUserProperties().getProperty('organizer_registration');return text?JSON.parse(text):{registered:false};}
  function save(s){PropertiesService.getUserProperties().setProperty('organizer_registration',JSON.stringify(s));}
  function triggers(){return ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='moverRun';});}
  function receipt(c,drive,email,s){
    var folder=drive.child(drive.root.id,'_organizers','organizers',null,true);
    var value={schema_version:1,email:email,registered:!!s.registered,registered_at:s.registered_at||'',trigger_id:s.trigger_id||'',interval_min:c.MOVER_INTERVAL_MIN,last_run_at:s.last_run_at||'',last_result:s.last_result||'',updated_at:new Date().toISOString()};
    drive.json(folder.id,'organizer_'+Organizer_.hash(email)+'.json',value,'organizer_registration');
  }
  function change(nonce,enabled){return Organizer_.lock(function(){var email=Organizer_.actor(false);Organizer_.verify(email,nonce);var c=Organizer_.config(),drive=OrganizerDrive_.open(c),s=state();if(c.DRY_RUN==='true')return {message:enabled?'登録予定です。DRY_RUN中はトリガーも登録ファイルも作りません。':'解除予定です。DRY_RUN中は登録を変更しません。',registered:!!s.registered};
    var own=triggers();
    if(enabled){
      if(own.length>1)throw new Error('同じ利用者のmoverRunトリガーが複数あります。GASのトリガー画面で確認してください。');
      if(own.length && s.interval_min && s.interval_min!==c.MOVER_INTERVAL_MIN)throw new Error('間隔の変更は一度登録を解除してから再登録してください。');
      var trigger=own[0]||ScriptApp.newTrigger('moverRun').timeBased().everyMinutes(c.MOVER_INTERVAL_MIN).create();
      s={registered:true,registered_at:s.registered_at||new Date().toISOString(),trigger_id:String(trigger.getUniqueId()),interval_min:c.MOVER_INTERVAL_MIN,last_result:'登録済み'};save(s);
      // 受け渡し失敗時はトリガーを停止します。再登録で同じファイルを更新できます。
      try{receipt(c,drive,email,s);}catch(e){s.registered=false;save(s);if(!own.length)ScriptApp.deleteTrigger(trigger);throw new Error('登録ファイルを保存できませんでした。登録は停止しています。権限を確認して再登録してください。');}
    }else{
      s.registered=false;s.trigger_id='';s.registered_at='';s.last_result='登録解除';save(s);own.forEach(function(t){ScriptApp.deleteTrigger(t);});receipt(c,drive,email,s);
    }
    return {message:enabled?'登録しました。主催者本人の権限で定期実行します。':'登録を解除しました。',registered:enabled};
  });}
  return {state:state,save:save,receipt:receipt,triggers:triggers,change:change};
})();
function doGet(){try{Organizer_.actor(false);return HtmlService.createHtmlOutputFromFile('Register').setTitle('議事録の主催者登録');}catch(e){return HtmlService.createHtmlOutput('会社Workspaceアカウント本人としてログインしてください。Webアプリは「アクセスしているユーザーとして実行」でデプロイしてください。');}}
function organizerBootstrap(){var email=Organizer_.actor(false),c=Organizer_.config(),s=OrganizerRegistration_.state(),triggers=OrganizerRegistration_.triggers();return {email:email,registered:!!s.registered,triggerCount:triggers.length,dryRun:c.DRY_RUN==='true',interval:c.MOVER_INTERVAL_MIN,moverMode:c.MOVER_MODE,nonce:Organizer_.nonce(email),lastRun:s.last_run_at||'',lastResult:s.last_result||''};}
function registerOrganizer(nonce){return OrganizerRegistration_.change(nonce,true);}
function unregisterOrganizer(nonce){return OrganizerRegistration_.change(nonce,false);}

function runOrganizerNow(nonce){Organizer_.verify(Organizer_.actor(false),nonce);return moverRun();}


// registry.js
// 同じGAS-BのScriptLockが正本です。別GASプロジェクトでの実行は禁止します。
// AUTOの検索範囲72時間より長い7日間保持し、容量を際限なく増やしません。
var OrganizerRegistry_=(function(){
  function prefix(c){return 'MOVER_SHARED:'+c.ENV+':';}
  function key(c,meeting){return prefix(c)+Organizer_.hash(meeting);}
  function get(c,meeting){if(c.MOVER_SHARED_REGISTRY!=='true')return null;var raw=PropertiesService.getScriptProperties().getProperty(key(c,meeting));return raw?JSON.parse(raw):null;}
  function save(c,meeting,state){if(c.MOVER_SHARED_REGISTRY!=='true'||c.DRY_RUN!=='false')return;var r={ready:!!state.ready,folderId:state.folderId,manifestId:state.manifestId,transcriptSource:state.transcriptSource||null,at:Date.now()};PropertiesService.getScriptProperties().setProperty(key(c,meeting),JSON.stringify(r));}
  function prune(c){if(c.DRY_RUN!=='false')return;var p=PropertiesService.getScriptProperties(),all=p.getProperties();Object.keys(all).filter(function(k){return k.startsWith(prefix(c));}).forEach(function(k){var r=JSON.parse(all[k]);if(r.at<Date.now()-7*86400000)p.deleteProperty(k);});}
  function excluded(c,email){return c.MOVER_SHARED_REGISTRY==='true'&&(String(c.DWD_EXCLUDE_EMAILS||'').split(/[\n,]/).map(function(v){return v.trim().toLowerCase();}).includes(email)||PropertiesService.getScriptProperties().getProperty('DWD_EXCLUDED:'+c.ENV+':'+Organizer_.hash(email))==='true');}
  function retire(c,email,registration,drive){
    if(c.DRY_RUN!=='false'||c.DWD_ENABLED!=='true'||c.MOVER_RETIRE_PERSONAL_TRIGGERS!=='true'||c.MOVER_SHARED_REGISTRY!=='true')return false;
    var p=PropertiesService.getScriptProperties(),covered=Number(p.getProperty('DWD_COVERED:'+c.ENV+':'+Organizer_.hash(email))||0),last=p.getProperty('DWD_LAST_RUN:'+c.ENV);last=last?JSON.parse(last):null;
    if(covered<Date.now()-48*3600000||!last||Date.parse(last.at)<Date.now()-3600000||last.errors)return false;
    registration.registered=false;registration.trigger_id='';registration.last_result='管理者収集へ移行済み';OrganizerRegistration_.save(registration);OrganizerRegistration_.triggers().forEach(function(t){ScriptApp.deleteTrigger(t);});
    try{OrganizerRegistration_.receipt(c,drive,email,registration);}catch(e){console.log('個別トリガーは停止しました。登録状況の同期は要確認です。');}
    console.log('管理者収集の正常走査を確認し、本人の個別トリガーを停止しました。');return true;
  }
  return {get:get,save:save,prune:prune,retire:retire,excluded:excluded};
})();


// transcript.js
// Docsは読み取りだけです。物理ファイルは増やさず、タブの所在をmanifestに残します。
var OrganizerTranscript_=(function(){
  function findTab(document){
    var matches=[];
    function visit(tabs){(tabs||[]).forEach(function(tab){
      var p=tab.tabProperties||{},title=String(p.title||'').normalize('NFKC').trim().toLowerCase();
      if(['文字起こし','transcript'].includes(title)){
        if(typeof p.tabId!=='string'||!p.tabId)throw new Error('文字起こしタブのIDを確認できません。');
        matches.push({tab_id:p.tabId,tab_title:p.title});
      }
      visit(tab.childTabs);
    });}
    visit(document.tabs);
    if(matches.length>1)throw new Error('文字起こしタブが複数あります。自動選択せず停止します。');
    return matches[0]||null;
  }
  function resolve(files,docsGet){
    if(files.found.transcript)return {type:'file',file_id:files.found.transcript.id};
    if(!files.found.gemini)return null;
    var id=files.found.gemini.id,document;
    try{document=(docsGet||GoogleApi_.docsGet)(id,{includeTabsContent:true,fields:'documentId,tabs(tabProperties(tabId,title),childTabs)'});}
    catch(e){throw new Error('Geminiメモのタブを読み取れません。Docs API・読み取り権限を確認してください：'+String(e.message||'取得失敗').slice(0,220));}
    if(!document||document.documentId!==id)throw new Error('取得したGeminiメモのドキュメントIDが一致しません。');
    var tab=findTab(document);
    return tab?{type:'document_tab',file_id:id,tab_id:tab.tab_id,tab_title:tab.tab_title}:null;
  }
  return {findTab:findTab,resolve:resolve};
})();
