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
