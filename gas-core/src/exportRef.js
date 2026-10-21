function exportRef(){assertFinanceOperator_();return exportRef_();}
function refExportTick_(){
  if(String(Session.getEffectiveUser().getEmail()||'').toLowerCase()!=='finance@premiere-mode.co.jp')throw new Error('参照更新トリガーはfinance@が作成してください。');
  return exportRef_();
}
function exportRef_(){return Ledger_.withLock(function(){
  var c=Stage2Drive_.config(),drive=Stage2Drive_.open(c);drive.within(c.LEDGER_SPREADSHEET_ID);
  var ref=drive.folder(drive.root.id,'ref',false),existing=drive.children(ref.id),ledger=Stage2Ledger_.open(SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID),true);
  var at=new Date().toISOString(),masters=RefExportPlan_.masters(ledger.masters(),at);
  var env=NotionTestEnvironment_.open(false,'ref-export');env.schema(env.ids.tasks,'tasks');
  var projects=env.referenceProjects(),projectData={schema_version:1,env:'test',generated_at:at,database_id:env.ids.tasks,projects:projects};
  var props=PropertiesService.getScriptProperties();
  // 両方の取得・重複・所属をすべて確認してから更新します。
  var plans=[{name:'masters.json',data:masters.data},{name:'projects.json',data:projectData}].map(function(p){
    var matches=existing.filter(function(f){return f.name===p.name;});if(matches.length>1)throw new Error(p.name+'が重複しています。削除せず停止します。');
    p.file=matches[0]||null;p.pendingKey='REF_EXPORT_PENDING:'+drive.root.id+':'+p.name;
    if(p.file){var f=drive.within(p.file.id);if(!['application/json','text/plain','application/octet-stream'].includes(f.mimeType)||!f.parents||f.parents.length!==1||f.parents[0]!==ref.id)throw new Error(p.name+'の型・所属を確認してください。');}
    else if(props.getProperty(p.pendingKey))throw new Error(p.name+'の前回作成結果が不明です。Driveの同名ファイルを確認してください。二重作成しません。');
    return p;
  });
  var counts={folders:masters.data.folders.length,clients:masters.data.clients.length,internal:masters.data.internal.length,people:masters.data.people.length,projects:projects.length,omittedPeople:masters.omittedPeople};
  console.log('参照ファイルの件数：'+JSON.stringify(counts));
  if(c.DRY_RUN==='true'){plans.forEach(function(p){console.log(p.name+'を'+(p.file?'同じIDで更新':'新規作成')+'する予定です。');});return {dryRun:true,counts:counts};}
  var ids={};
  plans.forEach(function(p){
    var destination=GoogleApi_.get(ref.id,{supportsAllDrives:true,fields:'id,name,parents,mimeType,driveId,trashed'});
    if(destination.trashed||destination.name!=='ref'||destination.mimeType!=='application/vnd.google-apps.folder'||!destination.parents||destination.parents.length!==1||destination.parents[0]!==drive.root.id||c.SHARED_DRIVE_ID&&destination.driveId!==c.SHARED_DRIVE_ID)throw new Error('書き込み直前にrefフォルダの所属が変わりました。');
    var blob=Utilities.newBlob(JSON.stringify(p.data,null,2),'application/json',p.name),saved;
    // 実行直前も既存ファイルの所属を確認し、移動・名前変更はしません。
    if(p.file){var f=GoogleApi_.get(p.file.id,{supportsAllDrives:true,fields:'id,name,parents,mimeType,trashed,driveId'});
      if(f.trashed||f.name!==p.name||!f.parents||f.parents.length!==1||f.parents[0]!==ref.id||c.SHARED_DRIVE_ID&&f.driveId!==c.SHARED_DRIVE_ID||!['application/json','text/plain','application/octet-stream'].includes(f.mimeType))throw new Error('更新直前に参照ファイルの状態が変わりました。');
      saved=GoogleApi_.update({},p.file.id,blob,{supportsAllDrives:true,fields:'id'});
    }else{props.setProperty(p.pendingKey,at);saved=drive.createFile(ref.id,p.name,JSON.stringify(p.data,null,2),'application/json','reference');}
    if(!saved||!saved.id)throw new Error('参照ファイルの保存結果を確認できません。');
    props.deleteProperty(p.pendingKey);ids[p.name]=saved.id;console.log(p.name+'を書き出しました。ID：'+saved.id);
  });
  ['admin','reviewer'].forEach(function(role){ReviewCache_.remove('projects:'+drive.root.id+':'+c.NOTION_DB_TASKS_TEST+':'+role);});
  return {dryRun:false,counts:counts,files:ids};
});}
function setupRefExportTrigger(){assertFinanceOperator_();return Ledger_.withLock(function(){
  var c=Stage2Drive_.config(),drive=Stage2Drive_.open(c);drive.within(c.LEDGER_SPREADSHEET_ID);drive.folder(drive.root.id,'ref',false);
  if(c.DRY_RUN==='true'){console.log('日本時間の毎朝6時台に参照ファイルを更新するトリガーを1つ作成する予定です。');return {dryRun:true};}
  var own=ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='refExportTick_';});if(own.length>1)throw new Error('参照更新トリガーが重複しています。');
  var trigger=own[0]||ScriptApp.newTrigger('refExportTick_').timeBased().atHour(6).everyDays(1).inTimezone('Asia/Tokyo').create();
  console.log('毎朝6時台の参照更新トリガーを確認しました。');return {dryRun:false,triggerId:String(trigger.getUniqueId())};
});}
function removeRefExportTrigger(){assertFinanceOperator_();return Ledger_.withLock(function(){var c=Stage2Drive_.config();if(c.DRY_RUN==='true'){console.log('自分の参照更新トリガーだけを解除する予定です。');return;}ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='refExportTick_';}).forEach(function(t){ScriptApp.deleteTrigger(t);});console.log('自分の参照更新トリガーを解除しました。');});}
