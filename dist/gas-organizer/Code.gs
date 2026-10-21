// config.js
var Organizer_ = (function () {
  var finance='finance@premiere-mode.co.jp';
  var ids={SHARED_DRIVE_ID:'0ALo4SlMVSpXdUk9PVA',FOLDER_SYSTEM_ID:'1UbflVH7ITQBN6INYyAQyn7fy77CWl4wH',FOLDER_SYSTEM_TEST_ID:'1pKWcGDuRCBf3VG0AfKBaKghE0nD3kYwW',FOLDER_INBOX_RAW_TEST_ID:'1Hip4qiyC3sUsPhqCj8JGAFKj8zLaUHaC'};
  function actor(trigger) {
    var active=String(Session.getActiveUser().getEmail()||'').toLowerCase(), effective=String(Session.getEffectiveUser().getEmail()||'').toLowerCase();
    var email=trigger?effective:active;
    if(!email || email!==finance || !effective || effective!==email || active && active!==effective) throw new Error('初回テストはfinance@本人として実行してください。所有者として代理実行するWebアプリでは使えません。');
    return email;
  }
  function config() {
    var c=PropertiesService.getScriptProperties().getProperties();
    if(c.ENV!=='test' || !['true','false'].includes(c.DRY_RUN)) throw new Error('ENV=testと明示的なDRY_RUNが必要です。');
    Object.keys(ids).forEach(function(k){if(c[k]!==ids[k])throw new Error(k+'が指定の共有ドライブ・テスト領域と一致しません。');});
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


// drive.js
var OrganizerDrive_=(function(){
  var folderMime='application/vnd.google-apps.folder';
  function open(c){
    var cache={};
    function get(id,fresh){if(fresh)delete cache[id];return cache[id]||(cache[id]=Drive.Files.get(id,{supportsAllDrives:true,fields:'id,name,mimeType,parents,driveId,trashed,ownedByMe,owners(emailAddress),capabilities(canEdit,canAddChildren,canMoveItemOutOfDrive),appProperties,properties'}));}
    var root=get(c.FOLDER_SYSTEM_TEST_ID),system=get(c.FOLDER_SYSTEM_ID),raw=get(c.FOLDER_INBOX_RAW_TEST_ID);
    function folderCheck(f,name,parent){if(f.trashed||f.mimeType!==folderMime||f.name!==name||f.driveId!==c.SHARED_DRIVE_ID||!f.parents||f.parents.length!==1||f.parents[0]!==parent)throw new Error('指定の共有ドライブ配下のフォルダではありません: '+name);}
    folderCheck(system,'_system',c.SHARED_DRIVE_ID);folderCheck(root,'_test',system.id);folderCheck(raw,'00_受信',root.id);
    if(raw.capabilities&&raw.capabilities.canAddChildren===false)throw new Error('テスト受信フォルダへ追加する権限がありません。');
    function write(){if(c.DRY_RUN!=='false')throw new Error('DRY_RUN中のDrive書き込みは禁止です。');}
    function list(parent){var out=[],token;do{var args={q:"'"+parent.replace(/'/g,"\\'")+"' in parents and trashed=false",corpora:'drive',driveId:c.SHARED_DRIVE_ID,includeItemsFromAllDrives:true,supportsAllDrives:true,pageSize:100,fields:'nextPageToken,files(id,name,mimeType,parents,properties,appProperties,driveId,trashed)'};if(token)args.pageToken=token;var r=Drive.Files.list(args);out=out.concat(r.files||[]);token=r.nextPageToken;}while(token);return out;}
    function child(parent,name,role,meetingKey,create){if(![root.id,raw.id].includes(parent))throw new Error('許可された親フォルダではありません。');var matches=list(parent).filter(function(f){return f.name===name;});if(matches.length>1)throw new Error('同名フォルダが重複しています。');if(matches.length){var f=matches[0];if(f.mimeType!==folderMime || !f.properties || f.properties.minutes_role!==role || meetingKey&&f.properties.meeting_key!==meetingKey)throw new Error('同名の既存フォルダの用途を確認できません。上書きしません。');return f;}if(!create)return null;write();var props={minutes_role:role,minutes_env:'test'};if(meetingKey)props.meeting_key=meetingKey;return Drive.Files.create({name:name,mimeType:folderMime,parents:[parent],properties:props},null,{supportsAllDrives:true,fields:'id,name,mimeType,parents,properties'});}
    function json(parent,name,value,role){write();var p=get(parent,true);if(p.driveId!==c.SHARED_DRIVE_ID||!p.parents||p.parents.length!==1||![root.id,raw.id].includes(p.parents[0]))throw new Error('登録・会議フォルダの所属が不正です。');var matches=list(parent).filter(function(f){return f.name===name;});if(matches.length>1)throw new Error('同名JSONが重複しています。');var props={minutes_role:role,minutes_env:'test'},blob=Utilities.newBlob(JSON.stringify(value,null,2),'application/json',name);if(matches.length){var f=matches[0];if(f.mimeType!=='application/json'||!f.properties||f.properties.minutes_role!==role)throw new Error('既存JSONの用途を確認できません。');return Drive.Files.update({properties:props},f.id,blob,{supportsAllDrives:true,fields:'id'});}return Drive.Files.create({name:name,mimeType:'application/json',parents:[parent],properties:props},blob,{supportsAllDrives:true,fields:'id'});}
    function validateSource(file,folder,key,email){
      if(file.trashed || file.mimeType==='application/vnd.google-apps.shortcut')throw new Error('削除済み添付・ショートカットは移動しません。');
      var mark=(file.appProperties||{}).meeting_key;if(mark&&mark!==key)throw new Error('添付が別の会議に登録済みです。');
      if(file.driveId){if(file.driveId!==c.SHARED_DRIVE_ID||!folder||!file.parents||file.parents.length!==1||file.parents[0]!==folder.id||mark!==key)throw new Error('自分のマイドライブまたは今回の受信フォルダ以外にある添付は移動しません。');return;}
      if(!file.ownedByMe || (file.owners||[]).length && !file.owners.some(function(o){return String(o.emailAddress||'').toLowerCase()===email;}) || !file.parents || file.parents.length!==1 || file.capabilities&& (file.capabilities.canEdit===false || file.capabilities.canMoveItemOutOfDrive===false))throw new Error('添付の所有者・共有ドライブへの移動権限を確認してください。');
    }
    function move(file,folder,key,kind,email){write();file=get(file.id,true);if(MoverPlan_.kind(file)!==kind)throw new Error('実行直前に添付の種類が変わりました。');validateSource(file,folder,key,email);if(file.driveId)return;Drive.Files.update({appProperties:Object.assign({},file.appProperties||{},{meeting_key:key,kind:kind})},file.id,null,{addParents:folder.id,removeParents:file.parents[0],supportsAllDrives:true,fields:'id,parents,driveId'});delete cache[file.id];}
    return {root:root,raw:raw,get:get,list:list,child:child,json:json,validateSource:validateSource,move:move};
  }
  return {open:open};
})();


// mover.js
function moverRun(e){return Organizer_.lock(function(){
  var email=Organizer_.actor(true),c=Organizer_.config(),registration=OrganizerRegistration_.state();
  if(c.DRY_RUN==='false'&&!registration.registered)throw new Error('実際の移動は先に登録画面から登録してください。');
  if(e&&e.triggerUid&&String(e.triggerUid)!==registration.trigger_id)throw new Error('登録されているトリガーと一致しません。');
  if(!/^[A-Za-z0-9_-]+$/.test(c.MOVER_TEST_EVENT_ID||''))throw new Error('MOVER_TEST_EVENT_IDに実機テスト用予定のIDを設定してください。他の会議は処理しません。');
  var drive=OrganizerDrive_.open(c),user=PropertiesService.getUserProperties(),now=Date.now(),results=[],events=[],token,started=now;
  try{do{var args={timeMin:new Date(now-72*3600000).toISOString(),timeMax:new Date(now).toISOString(),singleEvents:true,showDeleted:false,maxResults:250};if(token)args.pageToken=token;var page=Calendar.Events.list('primary',args);events=events.concat(page.items||[]);token=page.nextPageToken;}while(token);
  events=events.filter(function(ev){return ev.id===c.MOVER_TEST_EVENT_ID;});
  if(!events.length)events=[Calendar.Events.get('primary',c.MOVER_TEST_EVENT_ID)];
  events.forEach(function(event){
    if(Date.now()-started>240000)return;
    var plan=MoverPlan_.event(event,email,now,c.MOVER_WAIT_MIN);if(!plan){results.push({eventId:event.id,status:'対象外・終了待ち',message:'自分主催のMeet付き予定、終了待ち時間を確認してください。'});return;}
    var stateKey='mover:'+Organizer_.hash(plan.key),saved=user.getProperty(stateKey),state=saved?JSON.parse(saved):{};
    if(state.ready){results.push({meeting_key:plan.key,status:'処理済み',folderId:state.folderId,manifestId:state.manifestId});return;}
    var folder=drive.child(drive.raw.id,plan.folderKey,'meeting_raw',plan.key,false),meta={};
    (event.attachments||[]).forEach(function(a){if(a.fileId&&!meta[a.fileId])meta[a.fileId]=drive.get(a.fileId);});
    var files=MoverPlan_.files(event.attachments,meta);files.ignored.forEach(function(f){console.log('判定できない添付は移動しません: '+f.name);});
    var items=Object.keys(files.found);
    items.forEach(function(k){drive.validateSource(files.found[k],folder,plan.key,email);});
    if(files.missing.length&&!plan.expired){results.push({meeting_key:plan.key,status:'添付待ち',missing:files.missing});return;}
    var planned={meeting_key:plan.key,status:c.DRY_RUN==='true'?'移動予定':'移動中',folderName:plan.folderKey,files:items.map(function(k){var f=files.found[k];return {kind:k,id:f.id,name:f.name,from:f.parents[0],to:folder?folder.id:c.FOLDER_INBOX_RAW_TEST_ID+'/'+plan.folderKey};}),missing:files.missing};console.log(JSON.stringify(planned));
    if(c.DRY_RUN==='true'){results.push(planned);return;}
    folder=folder||drive.child(drive.raw.id,plan.folderKey,'meeting_raw',plan.key,true);state.folderId=folder.id;state.ready=false;user.setProperty(stateKey,JSON.stringify(state));
    items.forEach(function(k){drive.move(files.found[k],folder,plan.key,k,email);plan.manifest.files[k]=files.found[k].id;});
    plan.manifest.missing=files.missing;
    var manifest=drive.json(folder.id,'manifest.json',plan.manifest,'manifest');
    state.ready=true;state.manifestId=manifest.id;user.setProperty(stateKey,JSON.stringify(state));
    results.push({meeting_key:plan.key,status:'ready',folderId:folder.id,manifestId:manifest.id,missing:files.missing});
  });
    if(c.DRY_RUN==='false'){registration.last_run_at=new Date().toISOString();registration.last_result=results.map(function(r){return r.status;}).join('／');OrganizerRegistration_.save(registration);OrganizerRegistration_.receipt(c,drive,email,registration);}
  }catch(err){console.log('GAS-B処理を停止しました: '+err.message);if(c.DRY_RUN==='false'){registration.last_run_at=new Date().toISOString();registration.last_result='エラー：'+String(err.message).slice(0,160);OrganizerRegistration_.save(registration);try{OrganizerRegistration_.receipt(c,drive,email,registration);}catch(ignore){console.log('登録状況の更新も失敗しました。GASの実行履歴を確認してください。');}}throw err;}
  console.log('主催者用処理の結果: '+JSON.stringify(results));return results;
});}
// テスト予定のCalendar API IDを取得するための読み取り専用一覧です。
function listOrganizerTestEvents(){var email=Organizer_.actor(false);Organizer_.config();var now=Date.now(),all=[],token;do{var args={timeMin:new Date(now-72*3600000).toISOString(),timeMax:new Date(now+24*3600000).toISOString(),singleEvents:true,showDeleted:false,maxResults:250};if(token)args.pageToken=token;var page=Calendar.Events.list('primary',args);(page.items||[]).forEach(function(e){if(e.organizer&&e.organizer.self&&String(e.organizer.email||'').toLowerCase()===email&&e.conferenceData&&e.conferenceData.conferenceSolution&&e.conferenceData.conferenceSolution.key&&e.conferenceData.conferenceSolution.key.type==='hangoutsMeet'){var r={id:e.id,title:e.summary||'会議',start:e.start&&e.start.dateTime,attachments:(e.attachments||[]).length};all.push(r);console.log('テスト予定候補：'+r.title+'／'+r.start+'／MOVER_TEST_EVENT_ID='+r.id+'／添付'+r.attachments+'件');}});token=page.nextPageToken;}while(token);return all;}


// plan.js
var MoverPlan_=(function(){
  var kinds=['recording','transcript','gemini'];
  function event(event,email,now,wait){
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
  function kind(file){var mime=file.mimeType||'',name=file.name||'';if(mime.startsWith('video/'))return 'recording';if(mime!=='application/vnd.google-apps.document')return null;var transcript=/文字起こし|transcript/i.test(name),gemini=/gemini|メモ|meeting notes|notes by/i.test(name);if(transcript&&gemini)throw new Error('文字起こしとメモの判定が重複しています: '+name);return transcript?'transcript':gemini?'gemini':null;}
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
function doGet(){try{Organizer_.actor(false);return HtmlService.createHtmlOutputFromFile('Register').setTitle('議事録の主催者登録');}catch(e){return HtmlService.createHtmlOutput('finance@本人としてログインしてください。Webアプリは「アクセスしているユーザーとして実行」でデプロイしてください。');}}
function organizerBootstrap(){var email=Organizer_.actor(false),c=Organizer_.config(),s=OrganizerRegistration_.state(),triggers=OrganizerRegistration_.triggers();return {email:email,registered:!!s.registered,triggerCount:triggers.length,dryRun:c.DRY_RUN==='true',interval:c.MOVER_INTERVAL_MIN,nonce:Organizer_.nonce(email),lastRun:s.last_run_at||'',lastResult:s.last_result||''};}
function registerOrganizer(nonce){return OrganizerRegistration_.change(nonce,true);}
function unregisterOrganizer(nonce){return OrganizerRegistration_.change(nonce,false);}

function runOrganizerNow(nonce){Organizer_.verify(Organizer_.actor(false),nonce);return moverRun();}
