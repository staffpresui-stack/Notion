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
    if(c.MOVER_DISCOVERY_MODE==='RECORDS'){var r=RecordDiscovery_.run(c,email,DelegatedAuth_.drive(c,email),deadline);return {email:email,scanned:r.results.length,continued:r.pending>0,results:r.results};}
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
    if(m.artifact_update||m.status!=='ready'||!/^meet:/.test(m.meeting_key||'')||!Number.isFinite(Date.parse(m.start))||!Number.isFinite(Date.parse(m.end_unknown?m.start:m.end))||Date.parse(m.end_unknown?m.start:m.end)<Date.now()-7*86400000)return;
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
