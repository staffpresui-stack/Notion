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
    if(c.MOVER_DISCOVERY_MODE==='RECORDS'){var fast=ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='recordMoverTick_';});if(enabled&&!fast.length)ScriptApp.newTrigger('recordMoverTick_').timeBased().everyMinutes(1).create();if(!enabled)fast.forEach(function(t){ScriptApp.deleteTrigger(t);});}
    return {message:enabled?'登録しました。主催者本人の権限で定期実行します。':'登録を解除しました。',registered:enabled};
  });}
  return {state:state,save:save,receipt:receipt,triggers:triggers,change:change};
})();
function doGet(){try{Organizer_.actor(false);return HtmlService.createHtmlOutputFromFile('Register').setTitle('議事録の主催者登録');}catch(e){return HtmlService.createHtmlOutput('会社Workspaceアカウント本人としてログインしてください。Webアプリは「アクセスしているユーザーとして実行」でデプロイしてください。');}}
function organizerBootstrap(){var email=Organizer_.actor(false),c=Organizer_.config(),s=OrganizerRegistration_.state(),triggers=OrganizerRegistration_.triggers();return {email:email,registered:!!s.registered,triggerCount:triggers.length,dryRun:c.DRY_RUN==='true',interval:c.MOVER_INTERVAL_MIN,moverMode:c.MOVER_MODE,nonce:Organizer_.nonce(email),lastRun:s.last_run_at||'',lastResult:s.last_result||''};}
function registerOrganizer(nonce){return OrganizerRegistration_.change(nonce,true);}
function unregisterOrganizer(nonce){return OrganizerRegistration_.change(nonce,false);}

function runOrganizerNow(nonce){Organizer_.verify(Organizer_.actor(false),nonce);return moverRun();}
