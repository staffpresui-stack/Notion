// GAS-BからのHTTP受信口は作りません。ログインした本人のDrive最終更新者情報を照合します。
function syncOrganizerRegistrations(){ assertFinanceOperator_(); return syncOrganizerRegistrations_(); }
function organizerSyncTick_(){
  if(String(Session.getEffectiveUser().getEmail()||'').toLowerCase()!=='finance@premiere-mode.co.jp')throw new Error('同期トリガーはfinance@が作成してください。');
  return syncOrganizerRegistrations_();
}
function syncOrganizerRegistrations_(){
  return Ledger_.withLock(function(){
    var c=Stage2Drive_.config(),drive=Stage2Drive_.open(c);drive.within(c.LEDGER_SPREADSHEET_ID);
    var book=SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID),ledger=Stage2Ledger_.open(book,true),current=ledger.rows('organizers');
    var folders=drive.children(drive.root.id).filter(function(f){return f.name==='_organizers';});
    if(folders.length!==1)throw new Error('GAS-Bで先に登録してください。_organizersフォルダを1つに特定できません。');
    var folder=Drive.Files.get(folders[0].id,{supportsAllDrives:true,fields:'id,properties'});
    if(!folder.properties||folder.properties.minutes_role!=='organizers'||folder.properties.minutes_env!=='test')throw new Error('登録用フォルダの目印が不正です。');
    var seen=new Set(),plans=[];
    drive.children(folder.id).filter(function(f){return /^organizer_[a-f0-9]{64}\.json$/.test(f.name);}).forEach(function(f){
      drive.within(f.id);var meta=Drive.Files.get(f.id,{supportsAllDrives:true,fields:'id,mimeType,size,properties,lastModifyingUser(emailAddress)'});
      if(meta.mimeType!=='application/json'||Number(meta.size)>16384||!meta.properties||meta.properties.minutes_role!=='organizer_registration'||meta.properties.minutes_env!=='test')throw new Error('登録ファイルの用途・サイズが不正です。');
      var value=JSON.parse(DriveApp.getFileById(f.id).getBlob().getDataAsString('UTF-8')),email=String(value.email||'').toLowerCase();
      // 社員への拡大前のテストではfinance@だけを受け入れます。
      if(email!=='finance@premiere-mode.co.jp'||!meta.lastModifyingUser||String(meta.lastModifyingUser.emailAddress||'').toLowerCase()!==email)throw new Error('登録メール本人によるDrive更新を確認できません。');
      var hash=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,email,Utilities.Charset.UTF_8).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
      if(f.name!=='organizer_'+hash+'.json'||seen.has(email))throw new Error('登録名が不正または重複しています。');seen.add(email);
      if(value.schema_version!==1||typeof value.registered!=='boolean'||![1,5,10,15,30].includes(value.interval_min)||value.registered&&(!/^\d+$/.test(value.trigger_id||'')||!Number.isFinite(Date.parse(value.registered_at)))||value.last_run_at&&!Number.isFinite(Date.parse(value.last_run_at))||typeof value.last_result!=='string'||value.last_result.length>300)throw new Error('登録内容の形式が不正です。');
      var matches=current.filter(function(r){return r.email===email;});if(matches.length>1)throw new Error('台帳の登録メールが重複しています。');
      plans.push({existing:matches[0],data:{email:email,registered_at:value.registered?value.registered_at:'',trigger_id:value.registered?value.trigger_id:'',last_run_at:value.last_run_at||'',last_result:value.registered?value.last_result:'登録解除'}});
    });
    plans.forEach(function(p){if(c.DRY_RUN==='true'){console.log('主催者登録の同期予定：'+p.data.email+'／'+p.data.last_result);ledger.log('主催者登録の同期予定',p.data.email,p.data);return;}
      if(!p.existing)ledger.append('organizers',p.data);else{var headers=Ledger_.headers.organizers.split(',');book.getSheetByName('organizers').getRange(p.existing._row,1,1,headers.length).setValues([headers.map(function(k){var s=String(p.data[k]||'');return /^[=+@]/.test(s)?"'"+s:s;})]);}
      console.log('主催者登録を同期しました：'+p.data.email+'／'+p.data.last_result);
    });
    return {dryRun:c.DRY_RUN==='true',count:plans.length};
  });
}
function setupOrganizerSyncTrigger(){
  assertFinanceOperator_();
  return Ledger_.withLock(function(){var c=Stage2Drive_.config(),drive=Stage2Drive_.open(c);drive.within(c.LEDGER_SPREADSHEET_ID);
    if(c.DRY_RUN==='true'){console.log('15分ごとに主催者登録を同期するトリガーを1つ作成する予定です。');return {dryRun:true};}
    var own=ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='organizerSyncTick_';});
    if(own.length>1)throw new Error('同期トリガーが重複しています。GASのトリガー画面で確認してください。');
    var trigger=own[0]||ScriptApp.newTrigger('organizerSyncTick_').timeBased().everyMinutes(15).create();console.log('主催者登録の同期トリガーを確認しました。');return {dryRun:false,triggerId:String(trigger.getUniqueId())};
  });
}
function removeOrganizerSyncTrigger(){assertFinanceOperator_();return Ledger_.withLock(function(){var c=Stage2Drive_.config();if(c.DRY_RUN==='true'){console.log('自分の主催者登録同期トリガーだけを解除する予定です。');return;}ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='organizerSyncTick_';}).forEach(function(t){ScriptApp.deleteTrigger(t);});});}
