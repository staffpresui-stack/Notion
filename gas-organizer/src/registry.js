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
