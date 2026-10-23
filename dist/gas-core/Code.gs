// automation.js
// ENV=testの統合定期処理。公開準備関数以外はfinance@のトリガーだけで実行します。
var Automation_=(function(){
  function limits(c){var n=Number(c.GENERATOR_TIMEOUT_MIN||120),f=Number(c.LOCAL_FAILURE_ALERT_COUNT||3);if(!Number.isInteger(n)||n<15||n>1440||!Number.isInteger(f)||f<1||f>20)throw new Error('監視設定はGENERATOR_TIMEOUT_MIN=15〜1440、LOCAL_FAILURE_ALERT_COUNT=1〜20です。');return {timeout:n*60000,failures:f};}
  function monitor(errors){
    var c=Stage2Drive_.config(),limit=limits(c),drive=Stage2Drive_.open(c);drive.within(c.LEDGER_SPREADSHEET_ID);
    var ledger=Stage2Ledger_.open(SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID),true),raw=drive.folder(drive.root.id,'00_受信',false),inbox=drive.folder(drive.root.id,'inbox',false),now=Date.now(),alerts=[];
    var rows=ledger.rows('minutes'),pending=drive.children(inbox.id);
    drive.children(raw.id).filter(function(f){return f.mimeType==='application/vnd.google-apps.folder';}).forEach(function(folder){
      try{var manifests=drive.children(folder.id).filter(function(f){return f.name==='manifest.json';});if(manifests.length!==1)return;
      var m=drive.readJSON(manifests[0].id);if(!m.transcript_text)return;
      if(rows.some(function(r){return r.meeting_key===m.meeting_key&&r.notion_page_id&&String(r.notion_status||'').indexOf('作成済み')===0;}))return;
      var age=now-Date.parse(m.transcript_text.exported_at),name='local_'+folder.name+'.json',json=pending.find(function(f){return f.name===name;}),ready=json&&LocalInboxReady_.check(drive,json,pending);
      if(Number.isFinite(age)&&age>=limit.timeout){var reason=ready?'JSONは届きましたが取り込みが完了していません。':'TXT出力後に有効なJSONが届いていません。Mac・Codex認証・同期を確認してください。';alerts.push({key:m.meeting_key,kind:'生成・取り込み遅延',message:reason});}
      }catch(e){alerts.push({key:folder.name,kind:'受信データ要確認',message:'manifest・完了印・Driveの読み取りを確認してください。'});}
    });
    rows.forEach(function(r){try{var steps=r.step_done_json?JSON.parse(r.step_done_json):{};if(steps.error||r.notion_status==='Notion保留'||!steps.finished&&(steps.notion==='pending'||steps.appendPending||steps.chatwork==='pending'))alerts.push({key:r.meeting_key,kind:'取り込み要対応',message:'台帳が要対応・保留です。実行履歴と接続先を確認してください。結果不明の作成は再送しません。'});}catch(e){alerts.push({key:r.meeting_key,kind:'台帳要確認',message:'処理記録の形式を確認してください。既存データは修正していません。'});}});
    var runtimes=drive.children(drive.root.id).filter(function(f){return f.name==='_local_codex'&&f.mimeType==='application/vnd.google-apps.folder';});
    if(runtimes.length>1)throw new Error('ローカル監視フォルダが重複しています。');
    if(runtimes.length){var statuses=[];drive.children(runtimes[0].id).filter(function(f){return /^status_.*\.json$/.test(f.name);}).filter(function(f){return !f.createdTime||now-Date.parse(f.createdTime)<4*3600000;}).forEach(function(f){try{var s=drive.readJSON(f.id);if(s.env==='test'&&typeof s.ok==='boolean'&&Number.isFinite(Date.parse(s.at))&&now-Date.parse(s.at)>=0&&now-Date.parse(s.at)<4*3600000)statuses.push(s);}catch(ignore){/* 同期途中は次回確認します。 */}});
      statuses.sort(function(a,b){return Date.parse(b.at)-Date.parse(a.at);});var failures=0;for(var i=0;i<statuses.length&&!statuses[i].ok;i++)failures++;
      if(failures>=limit.failures)alerts.push({key:'local_codex',kind:'ローカル連続失敗',message:'直近4時間で'+failures+'回連続失敗しました。Macのログ・Codexログイン・Drive同期を確認してください。'});
    }
    (errors||[]).forEach(function(e){alerts.push({key:e.folder||e.stage||'pipeline',kind:'自動処理要確認',message:e.error||'GASの実行履歴を確認してください。'});});
    var props=PropertiesService.getScriptProperties(),active={};
    alerts.forEach(function(a){var key='AUTOMATION_ALERT:'+TranscriptText_.hash(a.kind+':'+a.key);active[key]=true;var old=props.getProperty(key);old=old?JSON.parse(old):{};if(old.active)return;
      var body='【議事録自動化・要確認】'+a.kind+'／'+a.key+'\n'+a.message;console.log(body);ledger.log('Chatwork通知予定（自動化監視・テスト）',a.key,body);
      if(c.DRY_RUN==='false'){ledger.append('change_log',{change_id:Utilities.getUuid(),at:new Date().toISOString(),meeting_key:a.key,kind:'停止検知',target:a.kind,after_json:JSON.stringify({message:a.message}),actor:'GAS-A（テスト監視）',result:'要確認・Chatwork予定ログ'});props.setProperty(key,JSON.stringify({active:true,at:new Date().toISOString(),target:a.key}));}
    });
    if(c.DRY_RUN==='false'){var all=props.getProperties();Object.keys(all).filter(function(k){return k.startsWith('AUTOMATION_ALERT:')&&!active[k];}).forEach(function(k){var old=JSON.parse(all[k]);if(old.active){ledger.append('change_log',{change_id:Utilities.getUuid(),at:new Date().toISOString(),meeting_key:old.target,kind:'停止検知解除',actor:'GAS-A（テスト監視）',result:'回復'});props.setProperty(k,JSON.stringify({active:false,target:old.target}));}});}
    return alerts;
  }
  function tick(){var started=Date.now(),errors=[],exported,ingested;
    try{exported=TranscriptText_.run(true);errors=exported.results.filter(function(r){return r.status==='要確認';});}catch(e){errors.push({stage:'TXT出力',error:'TXT出力に失敗しました。GASの実行履歴とDriveを確認してください。'});console.log('TXT出力段階で停止しました。');}
    try{ingested=InboxIngest_.run(null,started+240000,true);}catch(e){errors.push({stage:'取り込み',error:'取り込みに失敗しました。GASの実行履歴と接続設定を確認してください。'});console.log('取り込み段階で停止しました。');}
    var alerts=monitor(errors);return {exported:exported,ingested:ingested,alerts:alerts};
  }
  return {tick:tick,monitor:monitor,limits:limits};
})();
function automationTick_(){if(String(Session.getEffectiveUser().getEmail()||'').toLowerCase()!=='finance@premiere-mode.co.jp')throw new Error('統合トリガーはfinance@専用です。');if(typeof ServiceConfig_!=='undefined'&&ServiceConfig_.isNotes())return Ledger_.withLock(NotesPipeline_.run);Stage2Drive_.config();return Ledger_.withLock(Automation_.tick);}
function setupAutomationTrigger(){assertFinanceOperator_();return Ledger_.withLock(function(){var notes=typeof ServiceConfig_!=='undefined'&&ServiceConfig_.isNotes(),c=notes?ServiceConfig_.load():Stage2Drive_.config();if(notes)NotesPipeline_.context();else{Automation_.limits(c);Stage2Drive_.open(c);}var own=ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='automationTick_';});if(own.length>1)throw new Error('統合トリガーが重複しています。');if(c.DRY_RUN==='true'){console.log('15分ごとの統合トリガーを1個作り、旧TXT単独トリガーを解除する予定です。');return {dryRun:true};}
 var trigger=own[0]||ScriptApp.newTrigger('automationTick_').timeBased().everyMinutes(15).create();ScriptApp.getProjectTriggers().filter(function(t){return (notes?['transcriptExportTick_','refExportTick_','organizerSyncTick_']:['transcriptExportTick_']).includes(t.getHandlerFunction());}).forEach(function(t){ScriptApp.deleteTrigger(t);});console.log(notes?'GEMINI_NOTES：Meet/tl;dv→議事録→Notion/Chatworkの統合トリガーを設定しました。':'TXT出力→取り込み→監視の統合トリガーを設定しました。');return {triggerId:String(trigger.getUniqueId())};});}
function removeAutomationTrigger(){assertFinanceOperator_();return Ledger_.withLock(function(){var c=typeof ServiceConfig_!=='undefined'&&ServiceConfig_.isNotes()?ServiceConfig_.load():Stage2Drive_.config();if(c.DRY_RUN==='true'){console.log('自分の統合トリガーだけを解除する予定です。');return;}ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='automationTick_';}).forEach(function(t){ScriptApp.deleteTrigger(t);});console.log('統合トリガーを解除しました。');});}


// config.js
var Config_ = (function () {
  var defaults = { ENV: 'test', DRY_RUN: 'true', GENERATOR_MODE: 'GEMINI_NOTES',
    NOTION_VERSION: '2025-09-03', TASK_DB_MODE: 'single', NOTION_MTG_URL_SOURCE: 'none', NOTION_REQUESTER_TYPE: 'people' };
  // テスト対象を本番IDで代用しません。不明な値は安全側で拒否します。
  function inspect(values, profile) {
    var c = Object.assign({}, defaults, values), missing = [], errors = [];
    var required = ['LEDGER_SPREADSHEET_ID', 'NOTION_TOKEN', 'NOTION_DB_TLDV_INBOX'];
    if (c.ENV !== 'test') required.push('SHARED_DRIVE_ID');
    if (!['test', 'prod'].includes(c.ENV)) errors.push('ENV は test または prod を指定してください。');
    if (!['true', 'false'].includes(c.DRY_RUN)) errors.push('DRY_RUN は true または false を指定してください。');
    if(c.ENV==='prod'&&c.GENERATOR_MODE==='GEMINI_NOTES'&&typeof ServiceConfig_!=='undefined'){try{ServiceConfig_.load(c);}catch(e){errors.push(e.message);}return {ok:!errors.length&&!missing.length,missing:missing,errors:errors};}
    if (c.ENV !== 'test') errors.push('本番はGEMINI_NOTES専用です。');
    if (!['people', 'rich_text', 'email'].includes(c.NOTION_REQUESTER_TYPE)) errors.push('NOTION_REQUESTER_TYPE が不正です。');
    if (!['CHATGPT', 'LOCAL_CODEX','GEMINI_NOTES'].includes(c.GENERATOR_MODE)) errors.push('GENERATOR_MODE が不正です。');
    if (!['single', 'dual'].includes(c.TASK_DB_MODE)) errors.push('TASK_DB_MODE が不正です。');
    if (!['none', 'folder', 'meet'].includes(c.NOTION_MTG_URL_SOURCE)) errors.push('NOTION_MTG_URL_SOURCE が不正です。');
    required = required.concat(['FOLDER_SYSTEM_TEST_ID', 'NOTION_DB_MINUTES_TEST', 'NOTION_DB_TASKS_TEST']);
    if (c.CHATWORK_TOKEN) required.push('CHATWORK_ROOM_ID_TEST');
    if (c.TASK_DB_MODE === 'dual') required.push('NOTION_DB_NONPROJECT_TEST');
    // Notionの読み取り確認は、まだ使わないChatworkやDriveの設定で止めません。
    if (profile === 'notion') {
      required = ['NOTION_TOKEN', 'NOTION_DB_MINUTES_TEST', 'NOTION_DB_TASKS_TEST', 'NOTION_DB_TLDV_INBOX'];
      if (c.TASK_DB_MODE === 'dual') required.push('NOTION_DB_NONPROJECT_TEST');
    }
    required.forEach(function (k) { if (typeof c[k] !== 'string' || !c[k].trim()) missing.push(k); });
    ['NOTION_DB_MINUTES', 'NOTION_DB_TASKS', 'NOTION_DB_NONPROJECT', 'CHATWORK_ROOM_ID'].forEach(function (k) {
      if (c[k + '_TEST'] && c[k] === c[k + '_TEST']) errors.push(k + ' の本番用とテスト用が同じです。');
    });
    if (c.FOLDER_SYSTEM_ID && c.FOLDER_SYSTEM_ID === c.FOLDER_SYSTEM_TEST_ID) errors.push('本番用とテスト用のシステムフォルダが同じです。');
    var normalize = function (id) { return String(id || '').replace(/-/g, '').toLowerCase(); };
    ['NOTION_DB_MINUTES_TEST', 'NOTION_DB_TASKS_TEST', 'NOTION_DB_NONPROJECT_TEST', 'NOTION_DB_TLDV_INBOX'].forEach(function (k) {
      if (['4cf02dee7a114319ace1e866d6a1a914', 'e321f1cb33654a2c984447f34734a9d7'].includes(normalize(c[k]))) errors.push(k + ' に仕様書の本番DBは使えません。');
    });
    return { ok: !missing.length && !errors.length, missing: missing, errors: errors };
  }
  function load() { return Object.assign({}, defaults, PropertiesService.getScriptProperties().getProperties()); }
  function assertSafe(profile) {
    var c = load(), result = inspect(c, profile);
    if (!result.ok) throw new Error('設定を確認してください。不足: ' + result.missing.join('、') + '。' + result.errors.join(' '));
    return c;
  }
  return { inspect: inspect, load: load, assertSafe: assertSafe };
})();

function checkConfig() {
  if (typeof assertFinanceOperator_ === 'function') assertFinanceOperator_();
  var result = Config_.inspect(Config_.load());
  console.log(JSON.stringify(result));
  return result;
}

function checkNotionConfig() {
  if (typeof assertFinanceOperator_ === 'function') assertFinanceOperator_();
  var result = Config_.inspect(Config_.load(), 'notion');
  console.log(JSON.stringify(result));
  return result;
}


// driveUtil.js
var DriveUtil_ = (function () {
  var folderMime = 'application/vnd.google-apps.folder';
  function escape(value) { return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
  function folders(parent, driveId) {
    var all = [], token;
    do {
      var r = GoogleApi_.list({ q: "'" + escape(parent) + "' in parents and trashed = false and mimeType = '" + folderMime + "'",
        corpora: 'drive', driveId: driveId, supportsAllDrives: true, includeItemsFromAllDrives: true,
        pageSize: 100, pageToken: token, fields: 'nextPageToken,files(id,name,parents,driveId,mimeType)' });
      all = all.concat(r.files || []); token = r.nextPageToken;
    } while (token);
    return all;
  }
  function exact(parent, name, driveId) {
    var matches = folders(parent, driveId).filter(function (f) { return f.name === name; });
    if (matches.length !== 1) throw new Error('フォルダ「' + name + '」が見つからないか、同名が複数あります。');
    return matches[0];
  }
  function verifyTestRoot(c) {
    if (!c.SHARED_DRIVE_ID) return Stage2Drive_.open(c).root;
    var root = GoogleApi_.get(c.FOLDER_SYSTEM_TEST_ID, { supportsAllDrives: true, fields: 'id,name,parents,driveId,mimeType' });
    if (root.name !== '_test' || root.driveId !== c.SHARED_DRIVE_ID || root.mimeType !== folderMime || !root.parents || root.parents.length !== 1) throw new Error('テスト用フォルダを確認してください。');
    var parent = GoogleApi_.get(root.parents[0], { supportsAllDrives: true, fields: 'id,name,driveId' });
    if (parent.name !== '_system' || parent.driveId !== c.SHARED_DRIVE_ID) throw new Error('_system/_test 配下が必要です。');
    return root;
  }
  return { folders: folders, exact: exact, verifyTestRoot: verifyTestRoot };
})();


// exportRef.js
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


// inboxPlan.js
var InboxPlan_ = (function () {
  function mergeOptions(existing) {
    var required = ['未処理', '取り込み済み', '対象外（Meet優先）', 'エラー'];
    var names = existing.map(function (o) { return o.name; });
    var added = required.filter(function (n) { return !names.includes(n); });
    return { added: added, options: existing.map(function (o) {
      var result = { name: o.name }; if (o.id) result.id = o.id; if (o.color) result.color = o.color; return result;
    }).concat(added.map(function (name) { return { name: name }; })) };
  }
  // 提供されたJSON Schemaで使うキーワードをGAS内で検証します。外部コードは読み込みません。
  function validate(value, schema, path) {
    path = path || '$'; var errors = [], types = Array.isArray(schema.type) ? schema.type : [schema.type];
    var type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (schema.type && !types.includes(type)) return [path + ': 型が不正です。'];
    if (schema.enum && !schema.enum.includes(value)) errors.push(path + ': 選択肢が不正です。');
    if (typeof value === 'string') {
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(path + ': 形式が不正です。');
      if (schema.maxLength && Array.from(value).length > schema.maxLength) errors.push(path + ': 長すぎます。');
    }
    if (type === 'object') {
      (schema.required || []).forEach(function (key) { if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(path + '.' + key + ': 必須です。'); });
      Object.keys(value).forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(schema.properties || {}, key)) errors = errors.concat(validate(value[key], schema.properties[key], path + '.' + key));
        else if (schema.additionalProperties === false) errors.push(path + '.' + key + ': 未定義の項目です。');
      });
    }
    if (type === 'array') {
      if (schema.uniqueItems && new Set(value.map(function (v) { return JSON.stringify(v); })).size !== value.length) errors.push(path + ': 重複があります。');
      value.forEach(function (v, i) { if (schema.items) errors = errors.concat(validate(v, schema.items, path + '[' + i + ']')); });
    }
    return errors;
  }
  function judgement(input) {
    var data = JSON.parse(JSON.stringify(input)), warnings = [], choices = ['セールス・マーケ', 'EC', '生産管理', '経理・バックオフィス', 'Salesforce・AI', '経営'];
    if (Array.isArray(data.domains)) data.domains = data.domains.filter(function (d) { if (choices.includes(d)) return true; warnings.push('未定義の事業部領域を除外しました。'); return false; });
    var errors = validate(data, InboxJudgementSchema_);
    if (errors.length) throw new Error('判定JSONが不正です: ' + errors.join(' '));
    return { data: data, warnings: warnings };
  }
  function safeName(value) {
    var chars = { '\\': '＼', '/': '／', ':': '：', '*': '＊', '?': '？', '"': '＂', '<': '＜', '>': '＞', '|': '｜' };
    return Array.from(String(value || '会議').replace(/[\\/:*?"<>|]/g, function (c) { return chars[c]; })).slice(0, 40).join('');
  }
  function card(row, reviewUrl) {
    function clean(v) { return String(v || '').replace(/https?:\/\/[^\s<>]+/gi, '（URL省略）').replace(/\[/g, '［').replace(/\]/g, '］'); }
    function date(value, timeOnly) {
      var valueMs = Date.parse(value);
      if (!Number.isFinite(valueMs)) return '日時：要確認';
      var local = new Date(valueMs + 9 * 60 * 60 * 1000), iso = local.toISOString();
      return timeOnly ? iso.slice(11, 16) : Number(iso.slice(5, 7)) + '/' + Number(iso.slice(8, 10)) + '(' + '日月火水木金土'[local.getUTCDay()] + ') ' + iso.slice(11, 16);
    }
    function values(value) { try { var data = JSON.parse(value || '[]'); return Array.isArray(data) ? data : []; } catch (e) { return []; } }
    var body = '[info][title]【' + clean(row.status) + '】議事録の格納先を確認してください（' + clean(row.display_id) + '）[/title]\n' +
      date(row.event_start, false) + '–' + date(row.event_end, true) + '　' + clean(row.title) + '（' + (row.source === 'meet' ? 'Meet' : row.source === 'tldv' ? 'tl;dv' : '記録元：要確認') + '）' +
      '\nDrive：' + clean(row.placement_final).replace('/', ' ＞ ') + '\nNotion：' + clean(row.minutes_title) + '（' + clean(row.notion_status) + '）' +
      '\n事業部領域：' + clean(values(row.domains_final).join('／') || '未設定') + '／関連PJ：' + values(row.related_project_ids_final).length + '件' +
      '\n根拠：' + clean(row.reason) + '（確信度 ' + clean(row.confidence) + '）';
    if (/^https:\/\/script\.google\.com\/(?:a\/macros\/[^/]+\/)?s\/[A-Za-z0-9_-]+\/exec$/.test(reviewUrl || '')) body += '\n確認画面：' + reviewUrl;
    else body += '\n確認画面はまだ公開していません。';
    return body + '[/info]';
  }
  return { mergeOptions: mergeOptions, validate: validate, judgement: judgement, safeName: safeName, card: card };
})();


// inboxSchema.generated.js
// schemas/inbox_judgement.schema.jsonから生成します。
var InboxJudgementSchema_ = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "inbox_judgement.schema.json",
  "title": "議事録の判定JSON（_system/inbox/{folder_key}.json）",
  "type": "object",
  "additionalProperties": false,
  "required": ["meeting_key", "source", "scope", "placement", "domains", "related_project_ids", "minutes_title", "confidence", "reason", "sensitive", "summary", "task_proposals", "open_questions"],
  "properties": {
    "meeting_key": { "type": "string", "pattern": "^(meet|tldv):.+$", "description": "manifest.json の meeting_key をそのまま入れる" },
    "source": { "type": "string", "enum": ["meet", "tldv"] },
    "scope": { "type": "string", "enum": ["社内", "社外"] },
    "placement": {
      "type": "string",
      "description": "格納先。社内は 社内/{部署}（部署は8つから）。社外は 社外/{顧客名}。顧客名が ref/masters.json の clients に無いときは末尾に（要確認）を付ける",
      "pattern": "^(社内/(事業部全体|セールス・マーケ|EC|生産管理|経理・バックオフィス|Salesforce・AI|経営)|社外/.+)$"
    },
    "domains": {
      "type": "array",
      "description": "Notion の事業部領域。6つの選択肢の完全一致名だけ",
      "items": { "type": "string", "enum": ["セールス・マーケ", "EC", "生産管理", "経理・バックオフィス", "Salesforce・AI", "経営"] },
      "uniqueItems": true
    },
    "related_project_ids": {
      "type": "array",
      "description": "ref/projects.json にある Notion ページ ID だけ",
      "items": { "type": "string" },
      "uniqueItems": true
    },
    "minutes_title": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2} .+$" },
    "minutes_doc_id": { "type": ["string", "null"], "description": "現在のLOCAL_CODEX／手動CHATGPT方式ではnull。本文はminutes_markdownへ入れGAS-AがDocを作成します。既存のinbox内Doc IDは互換用に読み取り可能。" },
    "minutes_markdown": { "type": ["string", "null"], "description": "LOCAL_CODEX／手動CHATGPT共通の議事録全文。##見出し・###小見出し・箇条書き・番号付き・Markdown表を使用し、GAS-AがinboxにGoogle Docを作成します。JSON内の改行は\\n。minutes_doc_idがnullの場合は空でない本文が必要。" },
    "confidence": { "type": "string", "enum": ["高", "中", "低"] },
    "reason": { "type": "string", "maxLength": 200, "description": "判定の根拠を1文で" },
    "sensitive": { "type": "boolean", "description": "経営・人事・評価・健康など個人に関わる話題を含むか" },
    "summary": {
      "type": "object",
      "additionalProperties": false,
      "required": ["decisions", "next_actions"],
      "properties": {
        "decisions": { "type": "array", "items": { "type": "string" } },
        "next_actions": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["who", "what", "due"],
            "properties": {
              "who": { "type": "string" },
              "what": { "type": "string" },
              "due": { "type": ["string", "null"], "description": "YYYY-MM-DD。不明は null" }
            }
          }
        }
      }
    },
    "task_proposals": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["type", "task_db", "target_id", "title", "requester_email", "assignee_email", "fields", "evidence"],
        "properties": {
          "type": { "type": "string", "enum": ["新規", "更新", "リンク"] },
          "task_db": { "type": "string", "enum": ["プロジェクト", "非プロジェクト"] },
          "target_id": { "type": ["string", "null"], "description": "更新・リンクのときは ref/projects.json のページ ID。新規は null" },
          "title": { "type": "string" },
          "requester_email": { "type": ["string", "null"] },
          "assignee_email": { "type": ["string", "null"] },
          "fields": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "ステータス": { "type": "string", "enum": ["未着手", "保留", "進行中", "対応不要", "完了"] },
              "期日": { "type": ["string", "null"] },
              "備考": { "type": "string" },
              "完了条件": { "type": "string" },
              "親プロジェクトID": { "type": ["string", "null"] },
              "事業部領域": { "type": "array", "items": { "type": "string", "enum": ["セールス・マーケ", "EC", "生産管理", "経理・バックオフィス", "Salesforce・AI", "経営"] } }
            }
          },
          "evidence": { "type": "string", "description": "根拠となる発言の要約" }
        }
      }
    },
    "open_questions": { "type": "array", "items": { "type": "string" }, "description": "聞き取れない箇所・不確かな固有名詞や数字。テスト中に参照ファイルがない／読めず空扱いした場合はその旨も記載。" }
  }
};


// ingestFixturesToNotionTest.js
function ingestFixturesToNotionTest() {
  if (typeof assertFinanceOperator_ === 'function') assertFinanceOperator_();
  var env = NotionTestEnvironment_.open(true), lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('別のサンプル取り込みが実行中です。');
  try {
    var minutes = env.schema(env.ids.minutes, 'minutes'), tasks = env.schema(env.ids.tasks, 'tasks');
    var results = [], verifiedProjects = [], requested = new Set();
    NotionFixtures_.judgements.forEach(function (j) { j.related_project_ids.forEach(function (id) { requested.add(id); }); });
    requested.forEach(function (id) { var found = env.project(id); if (found) verifiedProjects.push(found); });
    // 作成前に3件すべてのペイロードを検査します。
    var plans = NotionFixtures_.judgements.map(function (j) {
      var manifest = NotionFixtures_.manifests.find(function (m) { return m.meeting_key === j.meeting_key; });
      if (!manifest) throw new Error('サンプルのmanifestがありません: ' + j.meeting_key);
      return { meetingKey: j.meeting_key, plan: NotionFixturePlan_.plan(j, manifest, NotionFixtures_.masters, minutes, tasks, verifiedProjects) };
    });
    plans.forEach(function (item) {
      var key = 'NOTION_FIXTURE:' + NotionTestEnvironment_.normalize(minutes.databaseId) + ':' + item.meetingKey;
      var saved = env.properties.getProperty(key) || env.properties.getProperty('NOTION_PAGE:' + NotionTestEnvironment_.normalize(minutes.databaseId) + ':' + item.meetingKey), plan = item.plan;
      console.log('判定: ' + item.meetingKey + ' / ' + JSON.stringify(plan.placement));
      plan.warnings.forEach(function (w) { console.log(w); });
      console.log('タスク提案（書き込まない）: ' + JSON.stringify(plan.taskProposals));
      if (saved) {
        var record;
        try { record = JSON.parse(saved); } catch (e) { throw new Error('重複防止記録が不正です。削除せず確認してください: ' + key); }
        var status = record.state === 'created' && record.pageId ? '作成済み・スキップ' : '作成結果未確認・再作成しません';
        console.log(status + ': ' + item.meetingKey + ' / ' + (record.pageId || '実Notionを確認してください。'));
        results.push({ meeting_key: item.meetingKey, status: status, pageId: record.pageId || null });
        return;
      }
      if (env.dryRun) {
        console.log('DRY_RUN・送信予定: ' + JSON.stringify(plan.payload));
        results.push({ meeting_key: item.meetingKey, status: plan.placement.status, dryRun: true });
        return;
      }
      // POST直前に予約を保存。通信中断やID保存失敗後も自動で二重作成しません。
      env.properties.setProperty(key, JSON.stringify({ state: 'pending' }));
      try {
        var page = env.createPage(plan.payload);
        if (!page.id) throw new Error('作成結果にページIDがありません。');
        console.log('作成したページID: ' + item.meetingKey + ' / ' + page.id);
        env.properties.setProperty(key, JSON.stringify({ state: 'created', pageId: page.id }));
        results.push({ meeting_key: item.meetingKey, status: plan.placement.status, pageId: page.id });
      } catch (e) {
        console.log('作成結果を確認してください。自動再作成しません: ' + item.meetingKey + ' / ' + e.message);
        results.push({ meeting_key: item.meetingKey, status: '要対応', error: e.message });
      }
    });
    console.log('サンプル取り込み結果: ' + JSON.stringify(results));
    return results;
  } finally { lock.releaseLock(); }
}


// ingestInbox.js
var InboxIngest_ = (function () {
  function hash(value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(value), Utilities.Charset.UTF_8).map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join(''); }
  function state(row) { return row && row.step_done_json ? JSON.parse(row.step_done_json) : {}; }
  function run(onlyMeetingKey, deadline, automatic) {
    var c = Stage2Drive_.config(), drive = Stage2Drive_.open(c);
    drive.within(c.LEDGER_SPREADSHEET_ID);
    if (c.CHATWORK_TOKEN && (!/^\d+$/.test(c.CHATWORK_ROOM_ID_TEST || '') || c.CHATWORK_ROOM_ID_TEST === c.CHATWORK_ROOM_ID)) throw new Error('Chatworkのテスト専用ルームIDが必要です。');
    var ledger = Stage2Ledger_.open(SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID)), masters = ledger.masters();
    var env = NotionTestEnvironment_.open(true), minutes = env.schema(env.ids.minutes, 'minutes'), tasks = env.schema(env.ids.tasks, 'tasks');
    var inbox = drive.folder(drive.root.id, 'inbox', false), done = drive.folder(inbox.id, '_done', false), raw = drive.folder(drive.root.id, '00_受信', false);
    if(automatic&&c.DRY_RUN==='false')ledger.rows('minutes').forEach(function(r){var s=state(r);if(s.error&&s.notion!=='pending'&&!s.appendPending&&s.chatwork!=='pending'&&(!s.automation_retry_at||Date.now()-Date.parse(s.automation_retry_at)>=15*60000)){s.error=false;s.automation_retry=true;s.automation_retry_at=new Date().toISOString();r.step_done_json=JSON.stringify(s);ledger.save(r);}});
    var rows = ledger.rows('minutes'), children = drive.children(inbox.id), files = children.filter(function (f) {
      if (!f.name.endsWith('.json')) return false;
      return !f.name.startsWith('local_') || LocalInboxReady_.check(drive, f, children);
    });
    rows.forEach(function (r) { var s = state(r); if (s.jsonId && !s.finished && !s.error && !files.some(function (f) { return f.id === s.jsonId; })) files.push(drive.within(s.jsonId)); });
    files = files.filter(function (f) { return !rows.some(function (r) { var s = state(r); return s.jsonId === f.id && s.error && s.modifiedTime === f.modifiedTime; }); });
    if (onlyMeetingKey) { var target = rows.find(function (r) { return r.meeting_key === onlyMeetingKey; }); var targetId = state(target).jsonId; files = files.filter(function (f) { return f.id === targetId; }); }
    files.sort(function (a, b) { var ar=rows.find(function(r){return state(r).jsonId===a.id;}),br=rows.find(function(r){return state(r).jsonId===b.id;});var priority=Number(!!state(ar).automation_retry)-Number(!!state(br).automation_retry);return priority||String(a.createdTime || '').localeCompare(String(b.createdTime || '')) || a.id.localeCompare(b.id); });
    var results = [], started = Date.now();
    files.slice(0, c.INGEST_BATCH).forEach(function (file) {
      if (Date.now() - started > 240000 || deadline && Date.now() > deadline) return;
      var row = null, steps = {}, key = 'invalid:' + file.id;
      function save() { row.step_done_json = JSON.stringify(steps); ledger.save(row); }
      try {
        if (file.name.startsWith('local_') && !LocalInboxReady_.check(drive, file, drive.children(inbox.id).concat(drive.children(done.id)))) return;
        var parsed = InboxPlan_.judgement(drive.readJSON(file.id)), j = parsed.data; key = j.meeting_key;
        if ((file.appProperties || {}).meeting_key && file.appProperties.meeting_key !== key) throw new Error('JSONファイルの会議マーカーと内容が一致しません。');
        if (key.length > 180) throw new Error('会議キーが長すぎます。');
        var prior = ledger.rows('minutes').find(function (r) { return r.meeting_key === key; });
        if (prior && state(prior).jsonId !== file.id) throw new Error('同じmeeting_keyの別JSONがあります。既存の行は変更しません。');
        row = prior || null; steps = state(row);
        var folder = steps.rawFolderId ? drive.within(steps.rawFolderId) : drive.folder(raw.id, key.replace(/:/g, '_'), false);
        var manifests = steps.manifestId ? [drive.within(steps.manifestId)] : drive.children(folder.id).filter(function (f) { return f.name === 'manifest.json'; });
        if (manifests.length !== 1) throw new Error('manifest.jsonを1件に特定できません。');
        var manifest = drive.readJSON(manifests[0].id);
        if (manifest.status !== 'ready' || manifest.meeting_key !== key || manifest.source !== j.source || !Number.isFinite(Date.parse(manifest.start))) throw new Error('manifestの状態・会議キー・日時が不正です。');
        var notesOnly=manifest.input_quality==='notes_only'||manifest.transcript_source&&manifest.transcript_source.type==='gemini_notes';
        if(notesOnly){
          if(!j.minutes_markdown||j.minutes_doc_id)throw new Error('要確認：メモから作成する議事録はMarkdown本文が必要です。');
          var notice='文字起こしなし・メモから作成';
          if(!j.minutes_markdown.includes(notice))j.minutes_markdown='## 要確認\n- '+notice+'。原文との照合はできません。\n\n'+j.minutes_markdown;
          if(!j.open_questions.includes(notice))j.open_questions.push(notice);
          j.confidence='低';if(!j.reason.includes(notice))j.reason=(notice+'。'+j.reason).slice(0,200);
        }
        if (steps.hash && steps.hash !== hash(j)) throw new Error('取り込み中に判定JSONが変更されました。');
        if (steps.finished) { results.push({ meeting_key: key, status: '取り込み済み' }); return; }
        var allowedKinds = ['recording', 'transcript', 'gemini', 'tldv_transcript'], rawFiles = [];
        Object.keys(manifest.files || {}).forEach(function (kind) {
          if (!allowedKinds.includes(kind)) throw new Error('manifestに未定義のファイル種別があります。');
          if (manifest.source === 'tldv' && kind === 'recording') { console.log('tl;dvの録画は管理対象外のため移動しません。'); return; }
          var f = drive.within(manifest.files[kind]);
          if ((f.appProperties || {}).meeting_key && f.appProperties.meeting_key !== key) throw new Error('生データの会議マーカーが違います。');
          if (f.mimeType === 'application/vnd.google-apps.folder' || !(f.parents || []).some(function (p) { return p === folder.id || row && p === row.meeting_folder_id; })) throw new Error('生データが会議の受信・格納フォルダ内にありません。');
          rawFiles.push({ id: f.id, kind: kind });
        });
        if (manifest.transcript_text) {
          var exported = drive.within(manifest.transcript_text.file_id);
          if (exported.mimeType !== 'text/plain' || exported.name !== 'transcript.txt' || !(exported.parents || []).some(function(p){return p === folder.id || row && p === row.meeting_folder_id;})) throw new Error('書き出した文字起こしが会議フォルダ内にありません。');
          if (!rawFiles.some(function(f){return f.id === exported.id;})) rawFiles.push({id:exported.id,kind:'transcript_text'});
        }
        var docId = steps.minutesDocId || j.minutes_doc_id, blocks;
        if (docId) {
          var doc = drive.within(docId);
          if ((doc.appProperties || {}).meeting_key && doc.appProperties.meeting_key !== key) throw new Error('議事録Docの会議マーカーが違います。');
          if (doc.mimeType !== 'application/vnd.google-apps.document' || !(doc.parents || []).some(function (p) { return p === inbox.id || row && p === row.meeting_folder_id; })) throw new Error('議事録Docがinbox・格納フォルダ内にありません。');
          blocks = Stage2Content_.read(docId);
        } else if (j.minutes_markdown) blocks = Stage2Content_.blocks(Stage2Content_.markdown(j.minutes_markdown));
        else throw new Error('議事録Docまたはminutes_markdownが必要です。');
        if (!blocks.length) throw new Error('議事録本文が空です。');
        if (steps.contentHash && steps.contentHash !== hash(blocks)) throw new Error('取り込み中に議事録本文が変更されました。');
        var projects = j.related_project_ids.map(function (id) { return env.project(id); }).filter(Boolean);
        var plan = NotionFixturePlan_.plan(j, manifest, masters, minutes, tasks, projects); plan.payload.children = blocks;
        var destination = plan.placement.placement === '00_仕分け待ち' ? drive.folder(drive.root.id, '00_仕分け待ち', false).id : (masters.folders.find(function (f) { return f.placement === plan.placement.placement; }) || {}).drive_folder_id;
        if (!destination) throw new Error('格納先フォルダIDがマスタにありません。');
        if (drive.within(destination).mimeType !== 'application/vnd.google-apps.folder') throw new Error('格納先がフォルダではありません。');
        var registryKey = 'NOTION_PAGE:' + NotionTestEnvironment_.normalize(minutes.databaseId) + ':' + key;
        var fixtureKey = 'NOTION_FIXTURE:' + NotionTestEnvironment_.normalize(minutes.databaseId) + ':' + key;
        var recordText = env.properties.getProperty(registryKey) || env.properties.getProperty(fixtureKey), record = recordText ? JSON.parse(recordText) : null;
        if (record && record.state === 'created' && record.pageId) env.verifyMinutesPage(record.pageId);
        parsed.warnings.concat(plan.warnings).forEach(function (w) { console.log(w); });
        console.log('タスク提案（書き込まない）: ' + JSON.stringify(j.task_proposals));
        if (c.DRY_RUN === 'true') {
          var planned = { meeting_key: key, status: plan.placement.status, display_id: row ? row.display_id : '採番予定', event_start: manifest.start, event_end: manifest.end, source: j.source, confidence: j.confidence, domains_final: JSON.stringify(plan.placement.domains), related_project_ids_final: JSON.stringify(plan.placement.related_project_ids), title: manifest.title, placement_final: plan.placement.placement, minutes_title: j.minutes_title, notion_status: record && record.pageId ? '既存ページ再利用' : '作成予定', reason: j.reason };
          console.log('取り込み予定: ' + JSON.stringify(planned)); console.log('Notion送信予定: ' + JSON.stringify(plan.payload));
          ledger.log('inbox取り込み予定', key, { row: planned, notion: plan.payload });
          var card = InboxPlan_.card(planned, c.WEBAPP_URL); console.log('Chatwork投稿予定: ' + card); ledger.log('Chatwork投稿予定', key, card);
          results.push({ meeting_key: key, status: plan.placement.status, dryRun: true }); return;
        }
        if (!row) {
          row = { meeting_key: key, display_id: ledger.displayId(manifest.start), source: j.source, event_id: manifest.event_id || '', event_start: manifest.start, event_end: manifest.end || '', title: manifest.title,
            organizer_email: manifest.organizer_email || '', attendees_json: JSON.stringify(manifest.attendees || []), scope_auto: plan.placement.rule.scope || '', scope_final: j.scope,
            placement_auto: j.placement, placement_final: plan.placement.placement, domains_auto: JSON.stringify(j.domains), domains_final: JSON.stringify(plan.payload.properties['事業部領域'].multi_select.map(function (v) { return v.name; })),
            related_project_ids_auto: JSON.stringify(j.related_project_ids), related_project_ids_final: JSON.stringify(plan.placement.related_project_ids), minutes_title: j.minutes_title,
            confidence: j.confidence, reason: j.reason, sensitive: j.sensitive, conflict: plan.placement.conflicts.length > 0, status: plan.placement.status,
            notion_status: '未処理', raw_file_ids_json: JSON.stringify(manifest.files || {}), created_at: new Date().toISOString(), last_error: parsed.warnings.concat(plan.warnings,notesOnly?['文字起こしなし・メモから作成']:[]).join(' ') };
          steps = { jsonId: file.id, rawFolderId: folder.id, manifestId: manifests[0].id, hash: hash(j), contentHash: hash(blocks), modifiedTime: file.modifiedTime };
          save();
        }
        var display={jsonId:steps.jsonId,hash:steps.hash,summary:j.summary||{},taskCount:(j.task_proposals||[]).length};
        if(JSON.stringify(display).length<12000) steps.reviewDisplay=display; else delete steps.reviewDisplay;
        if(notesOnly){steps.input_quality='notes_only';row.last_error='文字起こしなし・メモから作成';}
        steps.error = false; row.status = plan.placement.status;
        if (!row.meeting_folder_id) {
          var name = Utilities.formatDate(new Date(manifest.start), 'Asia/Tokyo', 'yyyy-MM-dd_HHmm') + '_' + InboxPlan_.safeName(manifest.title);
          var meetingFolder = drive.folder(destination, name, true, key); row.meeting_folder_id = meetingFolder.id; row.folder_id_final = destination; save();
        }
        if (!docId) {
          var existingDocs = drive.children(inbox.id).filter(function (f) { return f.mimeType === 'application/vnd.google-apps.document' && (f.appProperties || {}).meeting_key === key && f.appProperties.kind === 'minutes'; });
          if (existingDocs.length > 1) throw new Error('作成途中の議事録Docが複数あります。');
          docId = existingDocs.length ? existingDocs[0].id : drive.createFile(inbox.id, key.replace(/:/g, '_') + '_議事録', Stage2Content_.html(j.minutes_markdown), 'application/vnd.google-apps.document', 'minutes', key).id;
        }
        steps.minutesDocId = docId; row.minutes_doc_id = docId; save();
        if (!steps.moved) {
          rawFiles.forEach(function (f) { drive.move(f.id, row.meeting_folder_id, f.kind, key); });
          drive.move(docId, row.meeting_folder_id, 'minutes', key); drive.move(manifests[0].id, row.meeting_folder_id, 'manifest', key);
          steps.moved = true; save();
        }
        if (!row.notion_page_id && record && record.state === 'created' && record.pageId) {
          row.notion_page_id = record.pageId; steps.notionComplete = true; steps.reusedPage = true; row.notion_status = '作成済み（再利用）'; save();
        }
        if (!row.notion_page_id) {
          if (record && record.state === 'pending' || steps.notion === 'pending') throw new Error('Notion作成結果が不明です。記録を消さず、実Notionを確認してください。');
          steps.notion = 'pending'; env.properties.setProperty(registryKey, JSON.stringify({ state: 'pending' })); save();
          try {
            var payload = Object.assign({}, plan.payload, { children: blocks.slice(0, 100) }), page = env.createPage(payload);
            if (!page.id) throw new Error('Notion作成結果にページIDがありません。');
            console.log('作成したNotionページ: ' + key + ' / ' + page.id);
            row.notion_page_id = page.id; steps.notion = 'created'; steps.nextBlock = Math.min(100, blocks.length); save();
            env.properties.setProperty(registryKey, JSON.stringify({ state: 'created', pageId: page.id }));
          } catch (e) {
            if (e.httpStatus !== 403) throw e;
            env.properties.setProperty(registryKey, JSON.stringify({ state: 'rejected', httpStatus: 403 }));
            steps.notion = 'rejected'; row.notion_status = 'Notion保留'; row.last_error = e.message; save();
          }
        }
        if (row.notion_page_id && !steps.notionComplete) {
          env.verifyMinutesPage(row.notion_page_id);
          if (steps.appendPending) throw new Error('本文追加の結果が不明です。二重追記しません。');
          while (steps.nextBlock < blocks.length) {
            if (Date.now() - started > 240000 || deadline && Date.now() > deadline) { save(); results.push({ meeting_key: key, status: '本文追加の続き待ち' }); return; }
            steps.appendPending = true; save();
            try { env.appendBlocks(row.notion_page_id, blocks.slice(steps.nextBlock, steps.nextBlock + 100)); }
            catch (e) { if (e.httpStatus === 403) { steps.appendPending = false; row.notion_status = 'Notion保留'; save(); } throw e; }
            steps.nextBlock += Math.min(100, blocks.length - steps.nextBlock); steps.appendPending = false; save();
          }
          steps.notionComplete = true; row.notion_status = '作成済み'; save();
        }
        if (!c.CHATWORK_TOKEN && (!steps.chatwork || steps.chatwork === 'log_only')) {
          var plannedCard = InboxPlan_.card(row, c.WEBAPP_URL);
          if (steps.cardHash !== hash(plannedCard)) { console.log('Chatwork投稿予定（トークン未設定）: ' + plannedCard); ledger.log('Chatwork投稿予定（トークン未設定）', key, plannedCard); steps.cardHash = hash(plannedCard); }
          steps.chatwork = 'log_only'; save();
        } else if (!steps.chatwork) {
          var body = InboxPlan_.card(row, c.WEBAPP_URL);
          if (!c.CHATWORK_TOKEN) {
            console.log('Chatwork投稿予定（トークン未設定）: ' + body); ledger.log('Chatwork投稿予定（トークン未設定）', key, body); steps.chatwork = 'log_only'; save();
          } else {
            steps.chatwork = 'pending'; save();
            var response = UrlFetchApp.fetch('https://api.chatwork.com/v2/rooms/' + c.CHATWORK_ROOM_ID_TEST + '/messages', { method: 'post', headers: { 'X-ChatWorkToken': c.CHATWORK_TOKEN }, payload: { body: body, self_unread: '0' }, muteHttpExceptions: true });
            if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error('Chatwork投稿: HTTP ' + response.getResponseCode());
            var sent = JSON.parse(response.getContentText()); if (!sent.message_id) throw new Error('ChatworkのメッセージIDがありません。');
            row.chatwork_message_id = sent.message_id; steps.chatwork = 'sent'; save();
          }
        } else if (steps.chatwork === 'pending') throw new Error('Chatwork投稿結果が不明です。二重投稿しません。');
        if (file.name.startsWith('local_')) {
          var localMarkers = drive.children(inbox.id).concat(drive.children(done.id));
          if (!LocalInboxReady_.check(drive, file, localMarkers)) throw new Error('ローカルJSONの同期完了を確認できません。');
          var marker = localMarkers.filter(function(f){return f.name === file.name+'.ready.txt';})[0];
          drive.move(marker.id, done.id, 'local_ready', key);
        }
        if (!steps.jsonDone) { drive.move(file.id, done.id, 'judgement', key); steps.jsonDone = true; save(); }
        if (!steps.rawDone) {
          if (!drive.children(folder.id).length) {
            var excluded = drive.folder(drive.root.id, '99_対象外', false), empty = drive.folder(excluded.id, '_空', false); drive.move(folder.id, empty.id, '', key);
          } else console.log('受信フォルダに追加ファイルが残るため移動しません: ' + key);
          steps.rawDone = true; save();
        }
        if (!ledger.rows('change_log').some(function (r) { return r.change_id === 'ingest:' + key; })) ledger.append('change_log', { change_id: 'ingest:' + key, at: new Date().toISOString(), meeting_key: key, kind: '取り込み', target: row.meeting_folder_id, after_json: JSON.stringify({ status: row.status, notion_status: row.notion_status }), actor: 'GAS-A（テスト）', result: '完了' });
        steps.finished = !!steps.notionComplete; save(); results.push({ meeting_key: key, status: row.status, notion_status: row.notion_status, pageId: row.notion_page_id || null });
      } catch (e) {
        var message = String(e.message || '不明なエラー');
        [c.NOTION_TOKEN, c.CHATWORK_TOKEN].filter(Boolean).forEach(function (secret) { message = message.split(secret).join('[非表示]'); });
        console.log('取り込みエラー: ' + key + ' / ' + message); ledger.log('取り込みエラー', key, message);
        if (c.DRY_RUN === 'false') {
          if (!row) row = ledger.rows('minutes').find(function (r) { return r.meeting_key === 'invalid:' + file.id; }) || { meeting_key: 'invalid:' + file.id, created_at: new Date().toISOString() };
          steps.error = true; steps.jsonId = file.id; steps.modifiedTime = file.modifiedTime; row.status = '要対応'; row.last_error = message; save();
        }
        results.push({ meeting_key: key, status: '要対応', error: message });
      }
    });
    console.log('inbox取り込み結果: ' + JSON.stringify(results)); return results;
  }
  return { run: run };
})();

function ingestInbox() {
  if (typeof assertFinanceOperator_ === 'function') assertFinanceOperator_();if(typeof ServiceConfig_!=='undefined'&&ServiceConfig_.isNotes())return Ledger_.withLock(NotesPipeline_.run);return Ledger_.withLock(InboxIngest_.run); }

function retryInboxErrors() {
  if (typeof assertFinanceOperator_ === 'function') assertFinanceOperator_();
  return Ledger_.withLock(function () {
    var c = Stage2Drive_.config(), drive = Stage2Drive_.open(c); drive.within(c.LEDGER_SPREADSHEET_ID);
    var ledger = Stage2Ledger_.open(SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID));
    ledger.rows('minutes').forEach(function (r) {
      if (!r.step_done_json) return; var steps = JSON.parse(r.step_done_json);
      if (steps.error) { console.log('再検査予定: ' + r.meeting_key); if (c.DRY_RUN === 'false') { steps.error = false; r.step_done_json = JSON.stringify(steps); ledger.save(r); } }
    });
  });
}


// ledger.js
var Ledger_ = (function () {
  var headers = {
    minutes: 'meeting_key,display_id,source,event_id,event_start,event_end,title,organizer_email,attendees_json,scope_auto,scope_final,placement_auto,placement_final,folder_id_final,domains_auto,domains_final,related_project_ids_auto,related_project_ids_final,minutes_title,minutes_doc_id,raw_file_ids_json,meeting_folder_id,confidence,reason,sensitive,conflict,status,notion_page_id,notion_status,chatwork_message_id,reviewer_email,version,created_at,updated_at,confirmed_by,confirmed_at,step_done_json,last_error',
    task_proposals: 'proposal_id,meeting_key,seq,type,task_db,target_notion_id,title,before_json,after_json,requester_email,assignee_email,evidence,decision,decided_by,decided_at,applied_at,result,applied_page_id,applied_block_ids_json',
    change_log: 'change_id,at,meeting_key,kind,target,before_json,after_json,actor,result,revert_of',
    masters_folders: 'placement,drive_folder_id,notion_domain,rank',
    masters_clients: 'client_name,domains,drive_folder_id,created_by,created_at',
    masters_internal: 'email_or_domain,note',
    masters_people: 'name,google_email,alt_emails,notion_user_id,chatwork_account_id,domains,is_reviewer,is_admin',
    organizers: 'email,registered_at,trigger_id,last_run_at,last_result',
    settings: 'key,value,note', dry_run_log: 'at,action,target,payload_summary'
  };
  function withLock(fn) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new Error('別の処理が実行中です。後でもう一度実行してください。');
    try { return fn(); } finally { lock.releaseLock(); }
  }
  function checkHeaders(sheet, name) {
    var expected = headers[name].split(',');
    if (sheet.getLastRow() > 0) {
      var actual = sheet.getRange(1, 1, 1, Math.max(expected.length, sheet.getLastColumn())).getValues()[0];
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(name + ' の見出しが仕様と異なります。上書きしません。');
    }
    return expected;
  }
  function plan(book) {
    return Object.keys(headers).map(function (name) {
      var sheet = book.getSheetByName(name);
      if (sheet) checkHeaders(sheet, name);
      return { sheet: name, action: !sheet ? 'シート作成' : sheet.getLastRow() === 0 ? '見出し追加' : '変更なし', headers: headers[name].split(',') };
    });
  }
  function dryLog(book, action, target, summary) {
    var sheet = book.getSheetByName('dry_run_log');
    if (sheet) checkHeaders(sheet, 'dry_run_log');
    else sheet = book.insertSheet('dry_run_log');
    if (!sheet.getLastRow()) sheet.appendRow(headers.dry_run_log.split(','));
    sheet.appendRow([Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX"), action, target, summary]);
  }
  return { headers: headers, withLock: withLock, plan: plan, dryLog: dryLog };
})();


// localInboxReady.js
// Drive Desktopのアップロード順に依存せず、完全なJSONだけを取り込みます。
var LocalInboxReady_=(function(){
  function check(drive,file,children){
    var matches=children.filter(function(f){return f.name===file.name+'.ready.txt';});
    if(matches.length!==1){console.log('ローカルJSONの同期完了待ちです。');return false;}
    var marker=drive.within(matches[0].id),json=drive.within(file.id);
    if(marker.mimeType!=='text/plain'||json.mimeType==='application/vnd.google-apps.document')throw new Error('ローカルJSON・完了印の型が違います。');
    var expected=DriveApp.getFileById(marker.id).getBlob().getDataAsString('UTF-8').trim();
    var text=DriveApp.getFileById(json.id).getBlob().getDataAsString('UTF-8');
    if(!/^[a-f0-9]{64}$/.test(expected)||TranscriptText_.hash(text)!==expected){console.log('ローカルJSONのハッシュ一致待ちです。');return false;}
    return true;
  }
  return {check:check};
})();


// meetingRules.js
// GAS・外部APIに依存しない照合と仕分けです。実際の移動・投稿は行いません。
var MeetingRules_ = (function () {
  var domains = ['セールス・マーケ', 'EC', '生産管理', '経理・バックオフィス', 'Salesforce・AI', '経営'];
  function email(value) { return String(value || '').trim().toLowerCase(); }
  function emailDomain(value) {
    var e = email(value);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e.split('@')[1] : null;
  }
  function title(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu, ''); }
  function sameMeeting(a, b, windowMinutes) {
    var window = windowMinutes === undefined ? 15 : Number(windowMinutes);
    var aTime = Date.parse(a.start), bTime = Date.parse(b.start);
    if (!Number.isFinite(aTime) || !Number.isFinite(bTime) || !Number.isFinite(window) || window < 0 || Math.abs(aTime - bTime) > window * 60000) return false;
    var at = title(a.title), bt = title(b.title);
    if (at && bt) return at === bt;
    var aEmails = new Set((a.attendees || []).map(function (p) { return email(p.email); }).filter(emailDomain));
    var shared = new Set((b.attendees || []).map(function (p) { return email(p.email); }).filter(function (e) { return emailDomain(e) && aEmails.has(e); }));
    return shared.size >= 2;
  }
  function classify(attendees, masters, freeMailDomains) {
    var internal = new Set((masters.internal || []).map(email));
    var free = new Set((freeMailDomains || ['gmail.com', 'yahoo.co.jp', 'outlook.jp', 'outlook.com', 'icloud.com', 'hotmail.com']).map(email));
    var external = [], incomplete = !(attendees || []).length;
    (attendees || []).forEach(function (p) {
      var e = email(p.email), d = emailDomain(e);
      if (!d) { incomplete = true; return; }
      if (!internal.has(e) && !internal.has(d)) external.push(d);
    });
    var clients = (masters.clients || []).filter(function (c) {
      var accepted = (c.domains || []).map(email);
      return external.some(function (d) { return !free.has(d) && accepted.includes(d); });
    }).map(function (c) { return c.client_name; });
    clients = Array.from(new Set(clients));
    return { scope: external.length ? '社外' : incomplete ? null : '社内', incomplete: incomplete,
      client: clients.length === 1 ? clients[0] : null, ambiguous_client: clients.length > 1 };
  }
  function placementPlan(judgement, manifest, masters, projects) {
    if (judgement.meeting_key !== manifest.meeting_key || judgement.source !== manifest.source) throw new Error('会議キーまたは記録元が一致しません。');
    var rule = classify(manifest.attendees, masters), conflicts = [];
    if (rule.incomplete) conflicts.push('参加者のメール情報が不足しています。');
    if (rule.scope && rule.scope !== judgement.scope) conflicts.push('社内・社外の判定が一致しません。');
    if (!judgement.placement.startsWith(judgement.scope + '/')) conflicts.push('格納先と社内・社外の区分が一致しません。');
    var placements = (masters.folders || []).map(function (f) { return f.placement; }).concat((masters.clients || []).map(function (c) { return '社外/' + c.client_name; }));
    if (!placements.includes(judgement.placement)) conflicts.push('格納先がマスタに登録されていません。');
    if (rule.client && judgement.placement !== '社外/' + rule.client) conflicts.push('顧客ドメインと格納先が一致しません。');
    if (rule.ambiguous_client) conflicts.push('複数の顧客候補があります。');
    var rejectedDomains = judgement.domains.filter(function (d) { return !domains.includes(d); });
    var projectIds = new Set((projects || []).map(function (p) { return p.id; }));
    var rejectedProjects = judgement.related_project_ids.filter(function (id) { return !projectIds.has(id); });
    // 未登録PJは除外して記録します。SPEC 8章の格納先の食い違いとは区別します。
    var automatic = judgement.confidence === '高' && judgement.sensitive === false && conflicts.length === 0;
    return { meeting_key: manifest.meeting_key, status: automatic ? '確認待ち' : '仕分け待ち',
      placement: automatic ? judgement.placement : '00_仕分け待ち', rule: rule, conflicts: conflicts,
      domains: judgement.domains.filter(function (d) { return domains.includes(d); }), rejected_domains: rejectedDomains,
      related_project_ids: judgement.related_project_ids.filter(function (id) { return projectIds.has(id); }), rejected_project_ids: rejectedProjects };
  }
  function tldvPlan(page, meetManifests, now, settings) {
    settings = settings || {};
    if (page['取り込み状態'] && page['取り込み状態'] !== '未処理') return { action: '処理済み' };
    var duration = /^(\d+(?:\.\d+)?)分$/.exec(String(page['長さ'] || '').trim());
    var start = Date.parse(page['日付']), clock = Date.parse(now);
    var wait = settings.waitMinutes === undefined ? 60 : Number(settings.waitMinutes);
    if (!duration || !Number.isFinite(start) || !Number.isFinite(clock) || !Number.isFinite(wait) || wait < 0) return { action: '要確認', reason: '日時または会議の長さを確認してください。' };
    if (clock < start + (Number(duration[1]) + wait) * 60000) return { action: '待機' };
    var candidate = { title: page['名前'], start: page['日付'], attendees: page.attendees || [] };
    var duplicate = (meetManifests || []).find(function (m) { return m.source === 'meet' && sameMeeting(candidate, m, settings.matchWindowMinutes); });
    if (duplicate) return { action: '対象外（Meet優先）', matched_meeting_key: duplicate.meeting_key };
    var match = /^https:\/\/(?:www\.)?tldv\.io\/app\/meetings\/([A-Za-z0-9_-]+)(?:[/?#]|$)/.exec(String(page['会議URL'] || ''));
    var key = match ? 'tldv:' + match[1] : page.id ? 'tldv:notion-' + page.id : null;
    if (!key) return { action: '要確認', reason: '会議URLまたは受信ページIDを確認してください。' };
    if (!String(page['トランスクリプト'] || '').trim()) return { action: '要確認', reason: '文字起こしがありません。' };
    return { action: '文字起こしの取り込み予定', meeting_key: key, folder_key: key.replace(/:/g, '_'),
      // tl;dv無料プランの経路では録画のダウンロード・保存を計画しません。
      file_kinds: ['tldv_transcript'] };
  }
  return { normalizeTitle: title, sameMeeting: sameMeeting, classify: classify, placementPlan: placementPlan, tldvPlan: tldvPlan };
})();


// notesPipeline.js
var NotesPipeline_=(function(){
  function context(){var c=ServiceConfig_.load(),drive=ServiceDrive_.open(c);drive.within(c.LEDGER_SPREADSHEET_ID);var ledger=Stage2Ledger_.open(SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID),true),notion=ServiceNotion_.open(c),minutes=notion.schema(c.minutes),tasks=notion.schema(c.tasks),inboxSchema=notion.schema(c.NOTION_DB_TLDV_INBOX);
    var differences=NotionFixturePlan_.compareSchema('minutes',minutes.properties).differences.filter(function(d){return d.kind==='項目名・型';});if(differences.length)throw new Error('本番/テスト議事録DBの項目名・型を確認してください：'+differences.map(function(d){return d.name;}).join('、'));
    var relation=minutes.properties['関連するプロジェクト'].relation||{},normalize=function(id){return String(id||'').replace(/-/g,'');};if(normalize(relation.data_source_id)!==normalize(tasks.sourceId)&&!(relation.database_id&&normalize(relation.database_id)===normalize(tasks.databaseId)))throw new Error('議事録の関連プロジェクトが別環境の案件DBを参照しています。');
    var p=minutes.properties['確認状態'];if(!p||p.type!=='select'||!['確認待ち','仕分け待ち','対象外'].every(function(n){return p.select.options.some(function(o){return o.name===n;});}))throw new Error('確認状態の準備が必要です。setupProductionNotionStatusを実行してください。');
    var status=inboxSchema.properties['取り込み状態'];if(!status||status.type!=='select'||!['未処理','取り込み済み','対象外（Meet優先）'].every(function(n){return status.select.options.some(function(o){return o.name===n;});}))throw new Error('tl;dv受信の取り込み状態と選択肢を確認してください。');
    if(c.prod&&c.DRY_RUN==='false'&&!c.CHATWORK_TOKEN)throw new Error('本番の通知にはCHATWORK_TOKENが必要です。');
    return {c:c,drive:drive,ledger:ledger,notion:notion,minutes:minutes,tasks:tasks,inbox:drive.folder(drive.root.id,'inbox',false),raw:drive.within(c.raw),masters:NotesPlan_.masters(ledger.masters()),projects:notion.query(c.tasks).map(RefExportPlan_.project)};
  }
  function chunk(blocks,start){var out=[];for(var i=start;i<blocks.length&&out.length<100;i++){var next=out.concat([blocks[i]]);if(JSON.stringify(next).length>120000){if(!out.length)throw new Error('1ブロックが大きすぎます。省略せず停止します。');break;}out=next;}return out;}
  function steps(row){return row&&row.step_done_json?JSON.parse(row.step_done_json):{};}
  function notifyError(x,key,message){var id=ServiceConfig_.key(x.c,'alert:'+key),props=PropertiesService.getScriptProperties(),record=props.getProperty(id);if(record)return;var text='【議事録自動化・要確認】'+ServiceChatwork_.clean(key)+'\n'+message;
    x.ledger.log('停止検知',key,text);if(x.c.DRY_RUN==='true'){ServiceChatwork_.send(x.c,text,x.ledger,key);return;}
    x.ledger.append('change_log',{change_id:Utilities.getUuid(),at:new Date().toISOString(),meeting_key:key,kind:'停止検知',after_json:JSON.stringify({message:message}),actor:'GAS-A（'+x.c.ENV+'）',result:'要確認'});
    props.setProperty(id,JSON.stringify({state:'pending',at:new Date().toISOString()}));try{var result=ServiceChatwork_.send(x.c,text,x.ledger,key);props.setProperty(id,JSON.stringify({state:'sent',result:result,at:new Date().toISOString()}));}catch(e){console.log('監視通知も送信できませんでした。GASの実行履歴を確認してください。');}
  }
  function resolveAlert(x,key){if(x.c.DRY_RUN==='true')return;var id=ServiceConfig_.key(x.c,'alert:'+key),props=PropertiesService.getScriptProperties();if(props.getProperty(id)){x.ledger.append('change_log',{change_id:Utilities.getUuid(),at:new Date().toISOString(),meeting_key:key,kind:'停止検知解除',actor:'GAS-A（'+x.c.ENV+'）',result:'回復'});props.deleteProperty(id);}}
  function ingest(x,source,deadline){var c=x.c,drive=x.drive,ledger=x.ledger,m=source.manifest,key=m.meeting_key,row=ledger.rows('minutes').find(function(r){return r.meeting_key===key;}),s=steps(row);
    if(ServiceConfig_.beforeStart(c,m,source.receivedAt))return {status:'対象開始前'};
    if(row&&s.workflow!=='GEMINI_NOTES'){if(row.notion_page_id)return {status:'旧経路で作成済み・再作成しません'};throw new Error('旧経路の処理中記録があります。二重処理せず確認してください。');}
    if(s.env&&s.env!==c.ENV)throw new Error('別環境の処理記録は利用しません。');
    if(s.finished){if(source.pageId&&c.prod&&!s.sourceDone){x.notion.status(source.pageId,'取り込み済み',c.NOTION_DB_TLDV_INBOX);s.sourceDone=true;save();}return {status:'作成済み'};}
    var rules=c.CLASSIFICATION_RULES_JSON?JSON.parse(c.CLASSIFICATION_RULES_JSON):undefined,j=NotesPlan_.plan(m,source.notes,source.transcript,x.masters,x.projects,rules);InboxPlan_.judgement(j);
    if(s.jsonId)j=drive.readJSON(s.jsonId);
    var metadata=Object.assign({},j,{summary:{decisions:[],next_actions:[]}}),plan=NotionFixturePlan_.plan(metadata,m,x.masters,x.minutes,x.tasks,x.projects.map(function(p){return p.id;})),blocks=Stage2Content_.blocks(Stage2Content_.markdown(j.minutes_markdown)),hash=TranscriptText_.hash(JSON.stringify(j));
    if(s.hash&&s.hash!==hash)throw new Error('処理途中で元メモ・マスタが変わりました。本文を自動で上書きせず確認します。');
    if(c.DRY_RUN==='true'){console.log('議事録作成予定：'+JSON.stringify({env:c.ENV,key:key,title:j.minutes_title,status:plan.placement.status,db:c.minutes,questions:j.open_questions}));ledger.log('GEMINI_NOTES作成予定',key,{judgement:j,notion:plan.payload});ServiceChatwork_.send(c,'【議事録作成予定】'+ServiceChatwork_.clean(j.minutes_title)+'／要確認：'+(j.open_questions.length?'あり':'なし'),ledger,key);return {dryRun:true,key:key};}
    function save(){row.step_done_json=JSON.stringify(s);ledger.save(row);}
    if(m.source==='meet'){ledger.rows('minutes').filter(function(r){return r.source==='tldv'&&r.status!=='対象外'&&r.notion_page_id&&MeetingRules_.sameMeeting(m,{title:r.title,start:r.event_start,attendees:JSON.parse(r.attendees_json||'[]')},15);}).forEach(function(r){x.notion.status(r.notion_page_id,'対象外',c.minutes);r.status='対象外';r.last_error='Meet優先により対象外（ページは保持）';ledger.save(r);});}
    if(!row){var attendeeEmails=(m.attendees||[]).map(function(a){return String(a.email||'').toLowerCase();});plan.payload.properties['参加者']={people:Array.from(new Set(x.masters.people.filter(function(p){return p.notion_user_id&&[p.google_email].concat(NotesPlan_.list(p.alt_emails)).some(function(e){return attendeeEmails.includes(String(e||'').toLowerCase());});}).map(function(p){return p.notion_user_id;}))).map(function(id){return {object:'user',id:id};})};row={meeting_key:key,display_id:ledger.displayId(m.start),source:m.source,event_id:m.event_id||'',event_start:m.start,event_end:m.end||'',title:m.title,organizer_email:m.organizer_email||'',attendees_json:JSON.stringify(m.attendees||[]),scope_auto:j.scope,scope_final:j.scope,placement_auto:j.placement,placement_final:plan.placement.placement,domains_auto:JSON.stringify(j.domains),domains_final:JSON.stringify(plan.placement.domains),related_project_ids_auto:JSON.stringify(j.related_project_ids),related_project_ids_final:JSON.stringify(plan.placement.related_project_ids),minutes_title:j.minutes_title,confidence:j.confidence,reason:j.reason,sensitive:j.sensitive,status:plan.placement.status,notion_status:'未作成',last_error:j.open_questions.join(' '),created_at:new Date().toISOString(),raw_file_ids_json:JSON.stringify(m.files||{})};s={workflow:'GEMINI_NOTES',env:c.ENV,hash:hash,sourcePageId:source.pageId||'',rawFolderId:source.folder&&source.folder.id||'',input_quality:source.transcript?'transcript':'notes_only',nextBlock:0,notionProperties:plan.payload.properties};save();}
    if(!row.meeting_folder_id){var destination;if(plan.placement.placement==='00_仕分け待ち')destination=drive.folder(c.prod?c.SHARED_DRIVE_ID:drive.root.id,'00_仕分け待ち',false).id;else{var mapping=x.masters.folders.find(function(f){return f.placement===plan.placement.placement;})||x.masters.clients.find(function(f){return '社外/'+f.client_name===plan.placement.placement;});if(!mapping||!mapping.drive_folder_id)throw new Error('格納先マスタにDriveフォルダIDがありません。');destination=drive.within(mapping.drive_folder_id).id;}
      row.meeting_folder_id=drive.folder(destination,Utilities.formatDate(new Date(m.start),'Asia/Tokyo','yyyy-MM-dd_HHmm')+'_'+InboxPlan_.safeName(m.title),true,key).id;row.folder_id_final=destination;save();}
    if(!s.sourceId){s.sourceId=drive.createFile(row.meeting_folder_id,'source_snapshot.json',JSON.stringify(source),'application/json','source_snapshot',key).id;save();}
    if(!s.jsonId){var candidates=drive.children(x.inbox.id).filter(function(f){return f.name==='notes_'+key.replace(/:/g,'_')+'.json';});if(candidates.length>1)throw new Error('判定JSONが重複しています。');if(candidates.length&&JSON.stringify(drive.readJSON(candidates[0].id))!==JSON.stringify(j))throw new Error('既存の判定JSONと内容が違います。');s.jsonId=(candidates[0]||drive.createFile(x.inbox.id,'notes_'+key.replace(/:/g,'_')+'.json',JSON.stringify(j,null,2),'application/json','judgement',key)).id;save();}
    if(!row.minutes_doc_id){var existing=drive.children(row.meeting_folder_id).filter(function(f){return f.mimeType==='application/vnd.google-apps.document'&&(f.appProperties||{}).kind==='minutes'&&(f.appProperties||{}).meeting_key===key;});if(existing.length>1)throw new Error('議事録Docが重複しています。');row.minutes_doc_id=(existing[0]||drive.createFile(row.meeting_folder_id,j.minutes_title,Stage2Content_.html(j.minutes_markdown),'application/vnd.google-apps.document','minutes',key)).id;save();}
    if(!row.notion_page_id){if(s.notion==='pending')throw new Error('Notion作成結果が不明です。実ページを確認するまで再作成しません。');s.notion='pending';save();try{var firstBlocks=chunk(blocks,0),payload=Object.assign({},plan.payload,{properties:s.notionProperties||plan.payload.properties,children:firstBlocks}),page=x.notion.create(payload);if(!page.id)throw new Error('ページIDがありません。');row.notion_page_id=page.id;s.notion='created';s.nextBlock=firstBlocks.length;save();}catch(e){if(e.httpStatus>=400&&e.httpStatus<500&&e.httpStatus!==408){s.notion='rejected';save();}throw e;}}
    x.notion.page(row.notion_page_id,c.minutes);if(s.appendPending)throw new Error('Notion本文追加の結果が不明です。再追記しません。');while(s.nextBlock<blocks.length){if(Date.now()>deadline)return {status:'次周期に本文の続き'};s.appendPending=true;save();var nextBlocks=chunk(blocks,s.nextBlock);x.notion.append(row.notion_page_id,nextBlocks);s.nextBlock+=nextBlocks.length;s.appendPending=false;save();}row.notion_status='作成済み';save();
    if(source.folder&&!s.filesMoved){Object.keys(m.files||{}).forEach(function(kind){var f=drive.within(m.files[kind]);if(!f.parents.some(function(p){return p===source.folder.id||p===row.meeting_folder_id;}))throw new Error('会議の生データが別のフォルダにあります。');drive.move(f.id,row.meeting_folder_id,kind,key);});
      if(m.transcript_text&&m.transcript_text.file_id){var txt=drive.within(m.transcript_text.file_id);if(!txt.parents.some(function(p){return p===source.folder.id||p===row.meeting_folder_id;}))throw new Error('TXTの所在が違います。');drive.move(txt.id,row.meeting_folder_id,'transcript_text',key);}
      var manifests=drive.children(source.folder.id).filter(function(f){return f.name==='manifest.json';});if(manifests.length===1){s.manifestId=manifests[0].id;save();drive.move(manifests[0].id,row.meeting_folder_id,'manifest',key);}s.filesMoved=true;save();}
    if(source.folder&&!s.rawDone&&drive.children(source.folder.id).length===0){var excluded=drive.folder(c.prod?c.SHARED_DRIVE_ID:drive.root.id,'99_対象外',false),empty=drive.folder(excluded.id,'_空',false);drive.move(source.folder.id,empty.id,'empty',key);s.rawDone=true;save();}
    if(!s.chatwork||s.chatwork==='rejected'){s.chatwork='pending';save();try{var sent=ServiceChatwork_.send(c,ServiceChatwork_.body(row),ledger,key);row.chatwork_message_id=sent.message_id||'';s.chatwork=sent.planned?'planned':'sent';save();}catch(e){if(e.rejected){s.chatwork='rejected';save();}throw e;}}else if(s.chatwork==='pending')throw new Error('Chatwork送信結果が不明です。実ルームを確認してください。');
    if(!s.jsonDone){drive.move(s.jsonId,drive.folder(x.inbox.id,'_done',false).id,'judgement',key);s.jsonDone=true;save();}
    if(source.pageId&&c.prod&&!s.sourceDone){x.notion.status(source.pageId,'取り込み済み',c.NOTION_DB_TLDV_INBOX);s.sourceDone=true;save();}
    if(!s.finished){ledger.append('change_log',{change_id:Utilities.getUuid(),at:new Date().toISOString(),meeting_key:key,kind:'議事録作成',target:row.notion_page_id,after_json:JSON.stringify({env:c.ENV,source:m.source,status:row.status}),actor:'GAS-A（'+c.ENV+'）',result:'完了'});s.finished=true;save();}resolveAlert(x,key);return {key:key,status:'作成済み',pageId:row.notion_page_id};
  }
  function run(){var started=Date.now(),deadline=started+240000,x,c,result=[],count=0,meetings=[],seen={};
    try{x=context();c=x.c;}catch(preflightError){try{var config=ServiceConfig_.load(),scopedDrive=ServiceDrive_.open(config);scopedDrive.within(config.LEDGER_SPREADSHEET_ID);var book=Stage2Ledger_.open(SpreadsheetApp.openById(config.LEDGER_SPREADSHEET_ID),true);notifyError({c:config,ledger:book},'pipeline-preflight','GASの接続確認が失敗しました。Notion・権限・項目構成・実行履歴を確認してください。');}catch(ignore){console.log('接続監視の記録/通知も失敗しました。finance@のトリガー失敗メールを確認してください。');}throw preflightError;}
    resolveAlert(x,'pipeline-preflight');
    function process(source){if(Date.now()>deadline||count>=c.INGEST_BATCH)return;var key=source.manifest.meeting_key;if(seen[key])return;seen[key]=true;var prior=x.ledger.rows('minutes').find(function(r){return r.meeting_key===key;}),priorSteps=steps(prior);if(priorSteps.finished||prior&&priorSteps.workflow!=='GEMINI_NOTES'&&prior.notion_page_id)return;if(priorSteps.notion==='pending'||priorSteps.appendPending||priorSteps.chatwork==='pending'){notifyError(x,key,'書き込み結果が不明です。Notion/Chatworkの実データを確認するまで再送しません。');return;}try{if(priorSteps.sourceId)source=x.drive.readJSON(priorSteps.sourceId);result.push(ingest(x,source,deadline));count++;}catch(e){notifyError(x,key,'取り込みに失敗しました。接続・項目構成・本文変更・作成結果不明をGASの実行履歴で確認してください。');console.log('GEMINI_NOTES処理エラー：'+key+'／'+String(e.message).split(c.NOTION_TOKEN).join('[非表示]'));result.push({key:key,status:'要対応'});count++;}}
    x.drive.children(x.raw.id).filter(function(f){return f.mimeType==='application/vnd.google-apps.folder';}).forEach(function(folder){if(Date.now()>deadline||count>=c.INGEST_BATCH)return;try{var files=x.drive.children(folder.id).filter(function(f){return f.name==='manifest.json';});if(files.length!==1)return;var m=x.drive.readJSON(files[0].id);if(m.status!=='ready'||m.source!=='meet'||c.prod&&Date.parse(m.start)<Date.parse(c.PRODUCTION_START_AT))return;meetings.push(m);var known=x.ledger.rows('minutes').find(function(r){return r.meeting_key===m.meeting_key;}),state=steps(known);if(state.finished)return;var src=state.sourceId?x.drive.readJSON(state.sourceId):NotesSources_.meet(m,folder,x.drive);resolveAlert(x,folder.name);process(src);}catch(e){notifyError(x,folder.name,'Meetのメモ・文字起こし・manifestを読み取れません。');}});
    x.ledger.rows('minutes').filter(function(r){var s=steps(r);return s.workflow==='GEMINI_NOTES'&&s.env===c.ENV&&!s.finished&&s.sourceId;}).forEach(function(r){if(Date.now()>deadline||count>=c.INGEST_BATCH)return;var snapshot=x.drive.readJSON(steps(r).sourceId);if(snapshot.manifest.meeting_key!==r.meeting_key)throw new Error('保存した会議のキーが違います。');process(snapshot);});
    x.ledger.rows('minutes').filter(function(r){return r.source==='meet'&&r.status!=='対象外';}).forEach(function(r){meetings.push({source:'meet',title:r.title,start:r.event_start,attendees:JSON.parse(r.attendees_json||'[]'),meeting_key:r.meeting_key});});
    var filter={or:[{property:'取り込み状態',select:{equals:'未処理'}},{property:'取り込み状態',select:{is_empty:true}}]};if(c.prod)filter={and:[filter,{property:'日付',date:{on_or_after:c.PRODUCTION_START_AT.slice(0,10)}}]};
    if(count<c.INGEST_BATCH&&Date.now()<deadline)x.notion.query(c.NOTION_DB_TLDV_INBOX,filter,5000).forEach(function(page){if(count>=c.INGEST_BATCH||Date.now()>deadline)return;try{if(x.ledger.rows('minutes').some(function(r){var s=steps(r);return s.workflow==='GEMINI_NOTES'&&s.env===c.ENV&&s.finished&&s.sourcePageId===page.id;}))return;var source=NotesSources_.tldv(page,x.notion,x.masters.people),m=source.manifest;if(String(m.title||'').includes('【記録なし】')){x.ledger.log('tl;dv記録なし対象外',m.meeting_key,'タイトルの除外指定に従い本文を転記しません。');return;}if(ServiceConfig_.beforeStart(c,m,source.receivedAt))return;var wait=Number(c.TLDV_WAIT_MIN||60);var readiness=m.end?Date.parse(m.end):Date.parse(source.receivedAt);if(!Number.isFinite(readiness)){notifyError(x,m.meeting_key,'tl;dvの終了時刻と受信日時を確認できません。');return;}if(!Number.isFinite(wait)||wait<0||wait>1440)throw new Error('TLDV_WAIT_MINが不正です。');if(Date.now()<readiness+wait*60000)return;resolveAlert(x,'tldv:'+page.id);
      var duplicate=!m.time_unknown&&meetings.find(function(meet){return /[T ]\d{2}:\d{2}/.test(meet.start)&&MeetingRules_.sameMeeting(m,meet,15);});if(duplicate){if(c.DRY_RUN==='false'&&c.prod)x.notion.status(page.id,'対象外（Meet優先）',c.NOTION_DB_TLDV_INBOX);x.ledger.log('tl;dv対象外（Meet優先）',m.meeting_key,duplicate.meeting_key);return;}process(source);
    }catch(e){console.log('tl;dv受信エラー：'+String(e.message).split(c.NOTION_TOKEN).join('[非表示]'));notifyError(x,'tldv:'+page.id,'tl;dv受信の日時・長さ・参加者・本文・Notion権限を確認してください。');}});
    // PC/JSON到着の監視は実行しません。新経路の要対応だけを監視します。
    x.ledger.rows('minutes').filter(function(r){var s=steps(r);return s.workflow==='GEMINI_NOTES'&&s.env===c.ENV&&!s.finished&&Date.now()-Date.parse(r.created_at)>2*3600000;}).forEach(function(r){notifyError(x,r.meeting_key,'GAS内の議事録処理が2時間以上完了していません。実行履歴とNotion/Chatworkの状態を確認してください。');});
    TldvHealth_.check(x,deadline,function(key,message){notifyError(x,key,message);},function(key){resolveAlert(x,key);});
    console.log('GEMINI_NOTES処理結果：'+JSON.stringify(result));return result;
  }
  return {run:run,context:context,ingest:ingest,steps:steps};
})();
function runNotesPipeline(){assertFinanceOperator_();return Ledger_.withLock(NotesPipeline_.run);}
function setupProductionNotionStatus(){assertFinanceOperator_();return Ledger_.withLock(function(){var c=ServiceConfig_.load();if(!c.prod)throw new Error('本番の確認状態追加にはENV=prodが必要です。');return ServiceNotion_.open(c).setupStatus();});}
function setupNotesNotionStatus(){assertFinanceOperator_();return Ledger_.withLock(function(){return ServiceNotion_.open(ServiceConfig_.load()).setupStatus();});}


// notesPlan.js
// 既存サービスのAIメモを整形するだけです。外部AIによる推論・新しい要約は行いません。
var NotesPlan_=(function(){
  var domains=['セールス・マーケ','EC','生産管理','経理・バックオフィス','Salesforce・AI','経営'];
  function list(v){if(Array.isArray(v))return v;if(!v)return [];try{var a=JSON.parse(v);if(Array.isArray(a))return a;}catch(ignore){}return String(v).split(/[,、\n]/).map(function(s){return s.trim();}).filter(Boolean);}
  function participantText(value,people){var raw=String(value||''),out=[],seen={};function add(email,name){email=String(email||'').toLowerCase();var key=email||name;if(!seen[key]){seen[key]=true;out.push({email:email,name:name||email});}}
    (raw.match(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)||[]).forEach(function(e){add(e,e);});
    raw.split(/[,、;\n]/).map(function(s){return s.trim();}).filter(Boolean).forEach(function(name){if(name.includes('@'))return;var matched=(people||[]).filter(function(p){return p.name===name;});if(matched.length===1)add(matched[0].google_email,name);else add('',name);});return out;
  }
  function masters(input){var result=Object.assign({},input),internal=list(input.internal).map(function(v){return v.toLowerCase();});if(internal.some(function(v){return ['gmail.com','yahoo.co.jp','outlook.com','icloud.com'].includes(v);}))throw new Error('フリーメール全体を社内にせず、社員メールを完全一致で登録してください。');(input.people||[]).forEach(function(p){[p.google_email].concat(list(p.alt_emails)).forEach(function(e){e=String(e||'').trim().toLowerCase();if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))internal.push(e);});});result.internal=Array.from(new Set(internal));return result;}
  function section(text,name){var lines=String(text||'').split('\n'),found=false,out=[];lines.forEach(function(line){if(/^\s*#{1,6}\s/.test(line)){var heading=line.replace(/^\s*#+\s*/,'').trim();if(found)found=false;if(name.test(heading))found=true;return;}if(found&&line.trim())out.push(line.replace(/^\s*[-*•]\s*/,''));});return out;}
  function plan(m,notes,transcript,input,projects,rules){
    if(!m||!/^(meet|tldv):[A-Za-z0-9_-]+$/.test(m.meeting_key||'')||!Number.isFinite(Date.parse(m.start)))throw new Error('会議キー・日時を確認してください。');
    notes=String(notes||'').trim();transcript=String(transcript||'').trim();if(!notes&&!transcript)throw new Error('AIメモも文字起こしもありません。リンクだけのページは処理できません。');if(notes.length+transcript.length>200000)throw new Error('本文が上限を超えました。省略せず停止します。');
    var master=masters(input),rule=MeetingRules_.classify(m.attendees,master),questions=[],scope=rule.scope||'社外',matches=[];
    if(m.time_unknown)questions.push('会議の時刻が不明です。日付だけを転記しています。');if(m.source==='tldv'&&!m.end)questions.push('会議の終了時刻/長さを確認してください。');
    if(rule.incomplete)questions.push('参加者メールが不足しています。社内/社外と確認者を確認してください。');
    var keywordRules=rules||domains.map(function(d){return {domain:d,terms:[d]};});
    keywordRules.forEach(function(r){if(!domains.includes(r.domain)||!Array.isArray(r.terms)||r.terms.some(function(t){return typeof t!=='string'||t.length<2;}))throw new Error('CLASSIFICATION_RULES_JSONの部署・キーワードが不正です。');if(r.terms.some(function(term){var needle=term.normalize('NFKC').toLowerCase(),hay=String(m.title||'').normalize('NFKC').toLowerCase();if(/^[a-z0-9]+$/i.test(needle))return new RegExp('(^|[^a-z0-9])'+needle+'([^a-z0-9]|$)','i').test(hay);return hay.includes(needle);}))matches.push(r.domain);});
    if(!matches.length){var emails=(m.attendees||[]).map(function(p){return String(p.email||'').toLowerCase();});(master.people||[]).filter(function(p){return [p.google_email].concat(list(p.alt_emails)).some(function(e){return emails.includes(String(e||'').toLowerCase());});}).forEach(function(p){matches=matches.concat(list(p.domains).filter(function(d){return domains.includes(d);}));});}
    matches=Array.from(new Set(matches));if(matches.length!==1){matches=[];questions.push('事業部領域を一意に決められません。');}
    if(scope==='社外'&&!rule.client)questions.push(rule.ambiguous_client?'顧客が複数候補です。':'顧客がマスタで特定できません。');
    var placement=scope==='社内'?(matches.length?'社内/'+matches[0]:'社内/事業部全体'):'社外/'+(rule.client||'顧客未特定（要確認）');
    var related=(projects||[]).filter(function(p){return p.title&&p.title.length>=4&&String(m.title||'').includes(p.title);}).map(function(p){return p.id;});
    if(!related.length)questions.push('関連プロジェクトはタイトル完全一致の根拠がなく未設定です。');
    var notesOnly=!transcript;if(notesOnly)questions.push('文字起こしなし・メモから作成');if(!notes)questions.push('AIメモがありません。新たな要約は行わず文字起こしを転記します。');
    var sensitive=/人事|評価|健康|給与|採用|経営|機密/.test(String(m.title||'')+'\n'+notes),confidence=m.time_unknown||m.source==='tldv'&&!m.end||rule.incomplete||!matches.length||scope==='社外'&&!rule.client||notesOnly||!notes?'低':'高';
    var date=new Date(Date.parse(m.start)+9*3600000).toISOString().slice(0,10),title=date+' '+String(m.title||'会議'),decisions=section(notes,/^決定事項$/),actions=section(notes,/^(推奨される次のステップ|次のステップ|ネクストアクション|Next steps|Action items)$/i);
    var markdown='## 基本情報\n- 日時：'+m.start+(m.time_unknown?'（日付のみ・時刻要確認）':'')+'\n- 記録元：'+(m.source==='meet'?'Meet / Gemini':'tl;dv')+'\n- 参加者：'+(m.attendees||[]).map(function(p){return p.name||p.email||'要確認';}).join('、')+'\n- 作成方式：既存AIメモの転記・ルール判定（追加のAI要約なし）\n'+(notesOnly?'- 文字起こしなし・メモから作成\n':'')+'\n## AIメモ（提供元の内容）\n'+(notes||'AIメモはありません。')+'\n\n## 決定事項\n'+(decisions.length?decisions.map(function(s){return '- '+s;}).join('\n'):'- 提供元メモで決定事項を明示できません。要確認。')+'\n\n## ネクストアクション\n'+(actions.length?actions.map(function(s){return '- '+s;}).join('\n'):'- 提供元メモを確認してください。担当・期日は補完していません。')+'\n\n## 要確認\n'+(questions.length?questions.map(function(q){return '- '+q;}).join('\n'):'- 内容の確認をお願いします。')+(transcript?'\n\n## 文字起こし（提供元の原文）\n'+transcript:'');
    return {meeting_key:m.meeting_key,source:m.source,scope:scope,placement:placement,domains:matches,related_project_ids:related,minutes_title:title,minutes_doc_id:null,minutes_markdown:markdown,confidence:confidence,reason:(confidence==='高'?'登録マスタ・会議名の明示キーワードで判定しました。':'一意に決められない項目があり、仕分け待ちで確認が必要です。')+(notesOnly?'文字起こしなし・メモから作成。':''),sensitive:sensitive,summary:{decisions:decisions,next_actions:actions.map(function(s){return {who:'要確認',what:s,due:null};})},task_proposals:[],open_questions:questions};
  }
  return {plan:plan,masters:masters,participantText:participantText,list:list,section:section};
})();


// notesSetup.js
function setupNotesWorkspace(){assertFinanceOperator_();return Ledger_.withLock(function(){
 var c=ServiceConfig_.load(),drive=ServiceDrive_.open(c),book=SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID),plan=Ledger_.plan(book);drive.within(c.LEDGER_SPREADSHEET_ID);
 var base=c.prod?c.SHARED_DRIVE_ID:drive.root.id,folders=[];
 ['社内','社外','00_仕分け待ち','99_対象外'].forEach(function(name){var matches=drive.children(base).filter(function(f){return f.name===name;});if(matches.length!==1||matches[0].mimeType!=='application/vnd.google-apps.folder')throw new Error('既存の格納用フォルダを確認してください：'+name);folders.push(matches[0]);});
 var internal=folders.find(function(f){return f.name==='社内';}),departments=['事業部全体','セールス・マーケ','EC','生産管理','経理・バックオフィス','Salesforce・AI','経営'],mapping=departments.map(function(name){var f=drive.folder(internal.id,name,false);return {placement:'社内/'+name,drive_folder_id:f.id,notion_domain:name==='事業部全体'?'':name};});
 console.log('台帳初期化予定：'+JSON.stringify(plan.filter(function(p){return p.action!=='変更なし';})));console.log('既存格納先マスタ登録予定：'+JSON.stringify(mapping));
 ['inbox'].forEach(function(name){var matches=drive.children(drive.root.id).filter(function(f){return f.name===name;});if(matches.length>1||matches.length&&matches[0].mimeType!=='application/vnd.google-apps.folder')throw new Error('inboxが重複または型不正です。');});
 if(c.DRY_RUN==='true'){console.log('不足inbox/_done・99_対象外/_空、台帳シート・既存部署フォルダのマスタだけを準備します。既存ファイルを移動・改名・削除しません。');return {dryRun:true};}
 var inbox=drive.folder(drive.root.id,'inbox',true);drive.folder(inbox.id,'_done',true);drive.folder(folders.find(function(f){return f.name==='99_対象外';}).id,'_空',true);Stage2Ledger_.initialize(book);var ledger=Stage2Ledger_.open(book,true);
 mapping.forEach(function(r){var known=ledger.rows('masters_folders').filter(function(f){return f.placement===r.placement;});if(known.length>1||known.length&&known[0].drive_folder_id!==r.drive_folder_id)throw new Error('既存の部署フォルダマスタと違います。上書きしません。');if(!known.length)ledger.append('masters_folders',r);});
 if(!ledger.rows('masters_internal').some(function(r){return r.email_or_domain==='premiere-mode.co.jp';}))ledger.append('masters_internal',{email_or_domain:'premiere-mode.co.jp',note:'Workspaceの会社ドメイン'});
 if(!ledger.rows('masters_people').some(function(r){return r.google_email==='finance@premiere-mode.co.jp';}))ledger.append('masters_people',{name:'議事録管理者',google_email:'finance@premiere-mode.co.jp',is_admin:true,is_reviewer:true});
 console.log('準備しました。社員の個人GmailとNotionユーザー、顧客ドメインは人が本環境のマスタへ入力してください。テストマスタはコピーしていません。');return {env:c.ENV};
});}
function checkNotesEnvironment(){assertFinanceOperator_();return Ledger_.withLock(function(){var c=ServiceConfig_.load(),x=NotesPipeline_.context();var result={env:c.ENV,mode:c.GENERATOR_MODE,minutes:c.minutes,tasks:c.tasks,raw:c.raw,ledger:c.LEDGER_SPREADSHEET_ID,chatwork:c.room||'予定ログのみ',people:x.masters.people.length,projects:x.projects.length,dryRun:c.DRY_RUN};console.log(JSON.stringify(result));return result;});}

function sendNotesConnectionNotice(){assertFinanceOperator_();return Ledger_.withLock(function(){var c=ServiceConfig_.load(),drive=ServiceDrive_.open(c);drive.within(c.LEDGER_SPREADSHEET_ID);var ledger=Stage2Ledger_.open(SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID),true);return ServiceChatwork_.send(c,'【議事録自動化】接続確認です。新しい議事録と停止時の通知をこのルームへ送ります。',ledger,'接続確認');});}


// notesSources.js
var NotesSources_=(function(){
  function documentText(id,type,tabId){var d=GoogleApi_.docsGet(id,{includeTabsContent:true});if(d.documentId!==id)throw new Error('DocのIDが一致しません。');return TranscriptText_.extract(d,{file_id:id,type:type,tab_id:tabId});}
  function formatNotes(text){return String(text||'').split('\n').map(function(line){return /^(まとめ|要約|詳細|決定事項|推奨される次のステップ|次のステップ|ネクストアクション|Summary|Details|Next steps|Action items)$/i.test(line.trim())?'## '+line.trim():line;}).join('\n');}
  function meet(m,folder,drive){var notes='',transcript='',files=m.files||{};if(files.gemini){var f=drive.within(files.gemini);if(!f.parents.includes(folder.id))throw new Error('Geminiメモの親が違います。');notes=documentText(f.id,'gemini_notes');}
    var source=m.transcript_source;if(source&&source.type==='document_tab'&&(source.file_id!==files.gemini))throw new Error('文字起こしタブがGeminiメモと一致しません。');if(source&&source.type==='document_tab')transcript=documentText(source.file_id,'document_tab',source.tab_id);else{var id=files.transcript||files.tldv_transcript;if(id){var f=drive.within(id);if(!f.parents.includes(folder.id))throw new Error('文字起こしの親が違います。');transcript=f.mimeType==='text/plain'?DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8'):documentText(id,'file');}}
    return {manifest:m,notes:formatNotes(notes),transcript:transcript,folder:folder};
  }
  function tldv(page,notion,people){var p=page.properties||{},value=function(name){return notion.propertyText?notion.propertyText(page,name):ServiceNotion_.text(p[name]);},name=Object.keys(p).find(function(k){return p[k].type==='title';}),title=ServiceNotion_.text(p[name]),start=value('日付');if(!Number.isFinite(Date.parse(start)))throw new Error('tl;dvの日付がありません。作成日時では代用しません。');
    var attendees=NotesPlan_.participantText(value('参加者'),people),url=value('会議URL'),match=/^https:\/\/(?:www\.)?tldv\.io\/app\/meetings\/([A-Za-z0-9_-]+)(?:[/?#]|$)/.exec(url),key='tldv:'+(match?match[1]:'notion-'+page.id),notes=value('AIメモ'),transcript=value('トランスクリプト');
    var body=notion.body(page.id);if(body){var lines=body.split('\n'),inTranscript=false,other=[],tr=[];lines.forEach(function(line){if(/^##\s*/.test(line)){inTranscript=/^##\s*(文字起こし|トランスクリプト|transcript)\s*$/i.test(line);if(inTranscript)return;}if(inTranscript)tr.push(line);else other.push(line);});if(!notes)notes=other.join('\n').trim();if(!transcript)transcript=tr.join('\n').trim();}
    if(!notes&&!transcript)throw new Error('tl;dv受信にAIノートも文字起こし本文もありません。');var durationText=value('長さ').trim(),clock=/^(\d+):(\d{2}):(\d{2})$/.exec(durationText),duration=clock?Number(clock[1])*60+Number(clock[2])+Number(clock[3])/60:Number(durationText.replace(/分$/,''));
    return {manifest:{meeting_key:key,source:'tldv',title:title||'tl;dv会議',start:start,time_unknown:!/[T ]\d{2}:\d{2}/.test(start),end:/[T ]\d{2}:\d{2}/.test(start)&&Number.isFinite(duration)&&duration>0?new Date(Date.parse(start)+duration*60000).toISOString():'',attendees:attendees,organizer_email:'',files:{},status:'ready'},notes:formatNotes(notes),transcript:transcript,pageId:page.id,receivedAt:page.created_time||'',durationKnown:Number.isFinite(duration)&&duration>0};
  }
  return {meet:meet,tldv:tldv};
})();


// notionClient.js
var Notion_ = (function () {
  // 公式SDKのデータソースAPIに合わせ、読み取りだけを実装します。
  function get(path, c) {
    var response = UrlFetchApp.fetch('https://api.notion.com/v1/' + path, {
      method: 'get', headers: { Authorization: 'Bearer ' + c.NOTION_TOKEN, 'Notion-Version': c.NOTION_VERSION },
      muteHttpExceptions: true
    });
    var status = response.getResponseCode();
    // 応答本文は認証情報やデータを含む可能性があるためログに出しません。
    if (status < 200 || status >= 300) throw new Error('Notion の読み取りに失敗しました。HTTP ' + status);
    return JSON.parse(response.getContentText());
  }
  function schema(databaseId, c) {
    var db = get('databases/' + encodeURIComponent(databaseId), c);
    if (db.properties) return { database_id: databaseId, properties: db.properties };
    if (!db.data_sources || db.data_sources.length !== 1) throw new Error('データソースが複数または未設定です。対象を確認してください。');
    var ds = get('data_sources/' + encodeURIComponent(db.data_sources[0].id), c);
    if (!ds.properties) throw new Error('Notion のプロパティを取得できませんでした。');
    return { database_id: databaseId, data_source_id: ds.id, properties: ds.properties };
  }
  return { schema: schema };
})();


// notionFixturePlan.js
var NotionFixturePlan_ = (function () {
  function normalize(value) { return String(value || '').replace(/-/g, '').toLowerCase(); }
  var domains = ['セールス・マーケ', 'EC', '生産管理', '経理・バックオフィス', 'Salesforce・AI', '経営'];
  var expected = {
    minutes: { '議事録名': ['title'], '日付': ['date'], '参加者': ['people'], 'MTG URL': ['url'], '事業部領域': ['multi_select'], '関連するプロジェクト': ['relation'] },
    tasks: { 'プロジェクト/タスク名': ['title'], 'ステータス': ['status', 'select'], '期日': ['date'], '担当者': ['people'], '備考': ['rich_text'], '完了条件': ['rich_text'], '事業部領域': ['multi_select'], '関連するMTG': ['relation'], '親アイテム': ['relation'] },
    // タイトル名や参加者形式は実機確認対象です。本文の文字起こしも許容します。
    inbox: { '取り込み状態': ['select'], 'meeting_key': ['rich_text'], '日付': ['date'], '会議URL': ['url'], '長さ': ['number', 'rich_text'], '参加者': ['rich_text', 'people', 'multi_select'], 'AIメモ': ['rich_text'], 'トランスクリプト': ['rich_text'] }
  };
  function compareSchema(key, properties, requesterType) {
    requesterType = requesterType || 'people';
    if (!['people', 'rich_text', 'email'].includes(requesterType)) throw new Error('NOTION_REQUESTER_TYPE が不正です。');
    var differences = [], knownAdditions = [], wanted = Object.assign({}, expected[key]);
    if (key === 'tasks') wanted['依頼者'] = [requesterType];
    Object.keys(wanted).forEach(function (name) {
      var p = properties[name], optionalBody = key === 'inbox' && ['AIメモ', 'トランスクリプト'].includes(name);
      if (!p || !wanted[name].includes(p.type)) differences.push({ kind: optionalBody ? '本文での提供可・要確認' : '項目名・型', name: name, expected: wanted[name], actual: p ? p.type : '未設定' });
    });
    Object.keys(properties).filter(function (name) { return !wanted[name] && !(key === 'inbox' && properties[name].type === 'title'); }).forEach(function (name) {
      if (key === 'minutes' && name==='確認状態') knownAdditions.push({name:name,type:properties[name].type});
      else if (key === 'tasks' && ['関連プロジェクト（参照元）', 'サブアイテム', '関連プロジェクト'].includes(name)) knownAdditions.push({ name: name, type: properties[name].type });
      else differences.push({ kind: '追加項目', name: name, actual: properties[name].type });
    });
    if (key === 'inbox' && !Object.keys(properties).some(function (n) { return properties[n].type === 'title'; })) differences.push({ kind: '項目名・型', name: 'タイトル', expected: ['title'], actual: '未設定' });
    function options(name, values) {
      var p = properties[name];
      if (!p || !['select', 'multi_select', 'status'].includes(p.type)) return;
      var actual = ((p[p.type] || {}).options || []).map(function (o) { return o.name; });
      var missing = values.filter(function (v) { return !actual.includes(v); });
      var extra = actual.filter(function (v) { return !values.includes(v); });
      if (missing.length || extra.length) differences.push({ kind: '選択肢', name: name, missing: missing, extra: extra });
    }
    if (key !== 'inbox') options('事業部領域', domains);
    if (key === 'tasks') options('ステータス', ['未着手', '保留', '進行中', '対応不要', '完了']);
    if (key === 'inbox') options('取り込み状態', ['未処理', '取り込み済み', '対象外（Meet優先）', 'エラー']);
    return { properties: Object.keys(properties).map(function (n) { return { name: n, type: properties[n].type }; }), differences: differences, knownAdditions: knownAdditions };
  }
  function clean(value) { return String(value || '').replace(/https?:\/\/[^\s<>]+/gi, '（URL省略）'); }
  function richText(value) {
    var chars = Array.from(clean(value)), result = [];
    for (var i = 0; i < chars.length; i += 1000) result.push({ type: 'text', text: { content: chars.slice(i, i + 1000).join('') } });
    if (result.length > 100) throw new Error('テスト本文が長すぎます。');
    return result;
  }
  function block(type, value) { var b = { object: 'block', type: type }; b[type] = { rich_text: richText(value) }; return b; }
  function plan(judgement, manifest, masters, minutes, tasks, projectIds) {
    var comparison = compareSchema('minutes', minutes.properties);
    if (comparison.differences.some(function (d) { return d.kind === '項目名・型'; })) throw new Error('議事録DBの項目名・型がSPECと異なります。checkTestEnvironmentで確認してください。');
    var relation = minutes.properties['関連するプロジェクト'].relation || {};
    if (normalize(relation.data_source_id) !== normalize(tasks.sourceId) && !(relation.database_id && tasks.databaseId && normalize(relation.database_id) === normalize(tasks.databaseId))) throw new Error('関連するプロジェクトがテスト用タスクDBを参照していません。');
    if (!Number.isFinite(Date.parse(manifest.start))) throw new Error('会議の開始日時が不正です。');
    if (judgement.minutes_title.length > 2000) throw new Error('議事録名が長すぎます。');
    var projects = projectIds.map(function (id) { return { id: id }; });
    var placement = MeetingRules_.placementPlan(judgement, manifest, masters, projects);
    var warnings = [], choices = (minutes.properties['事業部領域'].multi_select.options || []).map(function (o) { return o.name; });
    var selected = placement.domains.filter(function (d) { return choices.includes(d); });
    var rejected = placement.domains.filter(function (d) { return !choices.includes(d); }).concat(placement.rejected_domains);
    if (rejected.length) warnings.push('送信しない事業部領域: ' + rejected.join('、'));
    if (placement.rejected_project_ids.length) warnings.push('テストDBに存在しない、または参照不可のため送信しない関連PJ: ' + placement.rejected_project_ids.join('、'));
    var participants = manifest.attendees || [];
    var people = (masters.people || []).filter(function (person) {
      return person.notion_user_id && participants.some(function (a) { return a.email && a.email.toLowerCase() === String(person.google_email || '').toLowerCase(); });
    }).map(function (person) { return { object: 'user', id: person.notion_user_id }; });
    var properties = {
      '議事録名': { title: richText(judgement.minutes_title) }, '日付': { date: { start: manifest.start } },
      '参加者': { people: people }, 'MTG URL': { url: null },
      '事業部領域': { multi_select: selected.map(function (name) { return { name: name }; }) },
      '関連するプロジェクト': { relation: placement.related_project_ids.map(function (id) { return { id: id }; }) }
    };
    var state=minutes.properties['確認状態'];
    if(state && state.type==='select' && (state.select.options||[]).some(function(o){return o.name===placement.status;})) properties['確認状態']={select:{name:placement.status}};
    var children = [block('heading_2', '基本情報'), block('paragraph', '日時：' + manifest.start),
      block('paragraph', '参加者：' + participants.map(function (a) { return a.name || a.email || '要確認'; }).join('、')),
      block('paragraph', '記録元：' + (manifest.source === 'meet' ? 'Meet' : 'tl;dv')),
      block('heading_2', '決定事項')];
    judgement.summary.decisions.forEach(function (text) { children.push(block('bulleted_list_item', text)); });
    if (!judgement.summary.decisions.length) children.push(block('paragraph', '決定事項はありません。'));
    children.push(block('heading_2', 'ネクストアクション'));
    judgement.summary.next_actions.forEach(function (a) { children.push(block('bulleted_list_item', a.who + '／' + a.what + '／期日：' + (a.due || '要確認'))); });
    if (!judgement.summary.next_actions.length) children.push(block('paragraph', 'ネクストアクションはありません。'));
    if (children.length > 100) throw new Error('本文が100ブロックを超えます。');
    return { placement: placement, warnings: warnings, payload: { parent: { type: 'data_source_id', data_source_id: minutes.sourceId }, properties: properties, children: children }, taskProposals: judgement.task_proposals };
  }
  return { compareSchema: compareSchema, plan: plan };
})();


// notionFixtures.generated.js
// scripts/bundle.cjs でfixturesから生成します。手で変更しないでください。
var NotionFixtures_ = {
  "judgements": [
    {
      "meeting_key": "meet:test001_20261021T020000Z",
      "source": "meet",
      "scope": "社内",
      "placement": "社内/Salesforce・AI",
      "domains": [
        "Salesforce・AI"
      ],
      "related_project_ids": [
        "00000000-0000-0000-0000-000000000001"
      ],
      "minutes_title": "2026-10-21 議事録運用 打ち合わせ",
      "minutes_doc_id": "DOC_ID_TEST_001",
      "minutes_markdown": null,
      "confidence": "高",
      "reason": "参加者が全員社内で、議題が議事録自動化の運用設計だった",
      "sensitive": false,
      "summary": {
        "decisions": [
          "録画は Google Meet を優先し、相手主催の会議だけ tl;dv を使う"
        ],
        "next_actions": [
          {
            "who": "テスト 太郎",
            "what": "共有ドライブ「MTG記録」を作成する",
            "due": "2026-10-23"
          }
        ]
      },
      "task_proposals": [
        {
          "type": "新規",
          "task_db": "プロジェクト",
          "target_id": null,
          "title": "共有ドライブ「MTG記録」を作成する",
          "requester_email": "test.hanako@premiere-mode.co.jp",
          "assignee_email": "test.taro@premiere-mode.co.jp",
          "fields": {
            "ステータス": "未着手",
            "期日": "2026-10-23",
            "備考": "",
            "完了条件": "7部署のフォルダがそろっている",
            "親プロジェクトID": "00000000-0000-0000-0000-000000000001",
            "事業部領域": [
              "Salesforce・AI"
            ]
          },
          "evidence": "テスト太郎さん：今週中にドライブを作ります"
        }
      ],
      "open_questions": []
    },
    {
      "meeting_key": "meet:test002_20261021T050000Z",
      "source": "meet",
      "scope": "社外",
      "placement": "社外/サンプル商事様",
      "domains": [
        "セールス・マーケ"
      ],
      "related_project_ids": [],
      "minutes_title": "2026-10-21 サンプル商事様 定例",
      "minutes_doc_id": "DOC_ID_TEST_002",
      "minutes_markdown": null,
      "confidence": "高",
      "reason": "社外参加者のドメイン sample-shoji.example が顧客一覧のサンプル商事様と一致",
      "sensitive": false,
      "summary": {
        "decisions": [
          "次回は11月第1週に開催する"
        ],
        "next_actions": [
          {
            "who": "テスト 花子",
            "what": "見積書を送付する",
            "due": null
          }
        ]
      },
      "task_proposals": [
        {
          "type": "新規",
          "task_db": "非プロジェクト",
          "target_id": null,
          "title": "サンプル商事様へ見積書を送付する",
          "requester_email": null,
          "assignee_email": "test.hanako@premiere-mode.co.jp",
          "fields": {
            "ステータス": "未着手",
            "期日": null,
            "備考": "期日：要確認",
            "完了条件": "",
            "親プロジェクトID": null,
            "事業部領域": [
              "セールス・マーケ"
            ]
          },
          "evidence": "テスト花子さん：見積を出します"
        }
      ],
      "open_questions": [
        "見積書の送付期日"
      ]
    },
    {
      "meeting_key": "tldv:tldvtest003",
      "source": "tldv",
      "scope": "社外",
      "placement": "社外/未登録株式会社（要確認）",
      "domains": [
        "EC"
      ],
      "related_project_ids": [],
      "minutes_title": "2026-10-21 新規取引の相談",
      "minutes_doc_id": "DOC_ID_TEST_003",
      "minutes_markdown": null,
      "confidence": "低",
      "reason": "社名が文字起こしにしか出ず、顧客一覧に無い",
      "sensitive": false,
      "summary": {
        "decisions": [],
        "next_actions": []
      },
      "task_proposals": [],
      "open_questions": [
        "先方の社名の表記",
        "参加者の氏名"
      ]
    }
  ],
  "masters": {
    "folders": [
      {
        "placement": "社内/事業部全体",
        "notion_domain": null
      },
      {
        "placement": "社内/セールス・マーケ",
        "notion_domain": "セールス・マーケ"
      },
      {
        "placement": "社内/EC",
        "notion_domain": "EC"
      },
      {
        "placement": "社内/生産管理",
        "notion_domain": "生産管理"
      },
      {
        "placement": "社内/経理・バックオフィス",
        "notion_domain": "経理・バックオフィス"
      },
      {
        "placement": "社内/Salesforce・AI",
        "notion_domain": "Salesforce・AI"
      },
      {
        "placement": "社内/経営",
        "notion_domain": "経営"
      }
    ],
    "clients": [
      {
        "client_name": "サンプル商事様",
        "domains": [
          "sample-shoji.example"
        ]
      }
    ],
    "internal": [
      "premiere-mode.co.jp",
      "test.private@gmail.com"
    ],
    "people": [
      {
        "name": "テスト 太郎",
        "google_email": "test.taro@premiere-mode.co.jp",
        "notion_user_id": null,
        "chatwork_account_id": null,
        "is_reviewer": true
      },
      {
        "name": "テスト 花子",
        "google_email": "test.hanako@premiere-mode.co.jp",
        "notion_user_id": null,
        "chatwork_account_id": null,
        "is_reviewer": true
      }
    ]
  },
  "manifests": [
    {
      "meeting_key": "meet:test002_20261021T050000Z",
      "source": "meet",
      "event_id": "test002_20261021T050000Z",
      "title": "サンプル商事様 定例",
      "start": "2026-10-21T14:00:00+09:00",
      "end": "2026-10-21T15:00:00+09:00",
      "organizer_email": "test.hanako@premiere-mode.co.jp",
      "attendees": [
        {
          "email": "test.hanako@premiere-mode.co.jp",
          "name": "テスト 花子"
        },
        {
          "email": "yamada@sample-shoji.example",
          "name": "山田"
        }
      ],
      "meet_url": "https://meet.google.com/aaa-bbbb-ccc",
      "files": {
        "recording": "FILE_REC",
        "transcript": "FILE_TR",
        "gemini": "FILE_GM"
      },
      "missing": [],
      "status": "ready",
      "created_at": "2026-10-21T15:25:00+09:00"
    },
    {
      "meeting_key": "meet:test001_20261021T020000Z",
      "source": "meet",
      "event_id": "test001_20261021T020000Z",
      "title": "議事録運用 打ち合わせ",
      "start": "2026-10-21T11:00:00+09:00",
      "end": "2026-10-21T12:00:00+09:00",
      "organizer_email": "test.taro@premiere-mode.co.jp",
      "attendees": [
        {
          "email": "test.taro@premiere-mode.co.jp",
          "name": "テスト 太郎"
        },
        {
          "email": "test.hanako@premiere-mode.co.jp",
          "name": "テスト 花子"
        }
      ],
      "meet_url": "https://meet.google.com/aaa-bbbb-ccc",
      "files": {},
      "missing": [],
      "status": "ready",
      "created_at": "2026-10-21T12:25:00+09:00"
    },
    {
      "meeting_key": "tldv:tldvtest003",
      "source": "tldv",
      "title": "新規取引の相談",
      "start": "2026-10-21T16:00:00+09:00",
      "end": "2026-10-21T16:40:00+09:00",
      "attendees": [
        {
          "email": "test.taro@premiere-mode.co.jp",
          "name": "テスト 太郎"
        },
        {
          "name": "先方担当"
        }
      ],
      "files": {},
      "status": "ready"
    }
  ]
};


// notionTestEnvironment.js
var NotionTestEnvironment_ = (function () {
  var parent = '400ca178-7419-80e8-bb9a-f157874b6105';
  var ids = { minutes: 'd9cc47f9-543e-4bcb-8ec8-27bebc0feac5', tasks: 'c908936a-6999-4119-9e9c-df364f5f5d1b' };
  function normalize(value) { return String(value || '').replace(/-/g, '').toLowerCase(); }
  function open(writingWorkflow, purpose) {
    var properties = PropertiesService.getScriptProperties();
    if (properties.getProperty('ENV') !== 'test') throw new Error('ENV=test が必要です。');
    var dryRun = properties.getProperty('DRY_RUN');
    if (writingWorkflow && !['true', 'false'].includes(dryRun)) throw new Error('DRY_RUN は true または false を明示してください。');
    var token = String(properties.getProperty('NOTION_TOKEN') || '').trim();
    if (!token) throw new Error('MTG議事録連携（GAS）のNOTION_TOKENが必要です。');
    ['minutes', 'tasks'].forEach(function (k) {
      var name = k === 'minutes' ? 'NOTION_DB_MINUTES_TEST' : 'NOTION_DB_TASKS_TEST';
      if (normalize(properties.getProperty(name)) !== normalize(ids[k])) throw new Error(name + ' が確認済みテストDBのIDと一致しません。');
    });
    var verifiedProjectInfo = {}, verified = {}, allowedPages = new Set(), inboxPatch = null, statusPatch = null, lastRequestAt = 0;
    function request(method, path, body, optionalStatuses) {
      if (method !== 'get') {
        var create = method === 'post' && path === 'pages' && verified.minutes && verified.tasks && body.parent && body.parent.type === 'data_source_id' && normalize(body.parent.data_source_id) === normalize(verified.minutes.sourceId);
        var append = /^blocks\/([^/]+)\/children$/.exec(path);
        var appendAllowed = method === 'patch' && append && allowedPages.has(normalize(append[1])) && body.children && body.children.length <= 100;
        var reviewAllowed = ['review', 'review-setup'].includes(purpose) && method === 'patch' && /^pages\/[^/]+$/.test(path) && allowedPages.has(normalize(path.split('/')[1])) && Object.keys(body).every(function (k) { return k === 'properties'; }) && (!body.properties || Object.keys(body.properties).every(function (k) { return ['議事録名', '事業部領域', '関連するプロジェクト', '確認状態'].includes(k); }));
        var query = method === 'post' && verified.tasks && path === 'data_sources/' + verified.tasks.sourceId + '/query';
        var statusAllowed = purpose === 'review-setup' && statusPatch && method === 'patch' && path === statusPatch.path && JSON.stringify(body) === statusPatch.body;
        var optionAllowed = purpose === 'inbox-options' && inboxPatch && method === 'patch' && path === inboxPatch.path && JSON.stringify(body) === inboxPatch.body;
        if (!query && (!writingWorkflow || dryRun !== 'false' || !(create || appendAllowed || optionAllowed || reviewAllowed || statusAllowed))) throw new Error('確認済みテスト対象以外への書き込みは禁止です。');
      }
      var options = { method: method, headers: { Authorization: 'Bearer ' + token, 'Notion-Version': '2025-09-03' }, muteHttpExceptions: true };
      if (body) { options.contentType = 'application/json'; options.payload = JSON.stringify(body); }
      if (lastRequestAt) { var pause=350-(Date.now()-lastRequestAt); if(pause>0) Utilities.sleep(pause); }
      lastRequestAt=Date.now();
      var response;
      try { response = UrlFetchApp.fetch('https://api.notion.com/v1/' + path, options); }
      catch (e) { throw new Error('Notionとの通信に失敗しました。書き込み結果は実Notionで確認してください。'); }
      var status = response.getResponseCode(), data;
      try { data = JSON.parse(response.getContentText()); } catch (e) { throw new Error('NotionからJSON以外の応答が返りました。HTTP ' + status); }
      if (status < 200 || status >= 300) {
        if ((optionalStatuses || []).includes(status)) return null;
        var error = new Error('Notionテスト接続: HTTP ' + status + ' / ' + String(data.code || '不明')); error.httpStatus = status; throw error;
      }
      return data;
    }
    function schema(databaseId, key, useCache) {
      var cacheKey='schema:'+normalize(databaseId), cached=useCache && purpose==='review' && key && typeof ReviewCache_ !== 'undefined' && ReviewCache_.get(cacheKey);
      if (cached && normalize(cached.databaseId)===normalize(ids[key]) && cached.sourceId && cached.properties) { verified[key]=cached; return cached; }
      var db = request('get', 'databases/' + encodeURIComponent(databaseId));
      if (normalize(db.id) !== normalize(databaseId) || !db.parent || db.parent.type !== 'page_id' || normalize(db.parent.page_id) !== normalize(parent) || db.archived || db.in_trash) throw new Error('管理用ページ下の有効なDBではありません。');
      if (!db.data_sources || db.data_sources.length !== 1) throw new Error('DBのデータソースを1つに特定できません。');
      var ds = request('get', 'data_sources/' + encodeURIComponent(db.data_sources[0].id));
      if (!ds.parent || normalize(ds.parent.database_id) !== normalize(db.id) || normalize(ds.id) !== normalize(db.data_sources[0].id) || !ds.properties || ds.archived || ds.in_trash) throw new Error('データソースの所属・状態を確認できません。');
      var result = { databaseId: db.id, sourceId: ds.id, properties: ds.properties };
      if (key) {
        if (normalize(db.id) !== normalize(ids[key])) throw new Error('本番または未確認のDBです。');
        verified[key] = result;
        if (verified.minutes && verified.tasks && normalize(verified.minutes.sourceId) === normalize(verified.tasks.sourceId)) throw new Error('テスト用2DBのデータソースが同一です。');
      }
      if (purpose==='review' && key && typeof ReviewCache_ !== 'undefined') ReviewCache_.put(cacheKey,result,120);
      return result;
    }
    function discoverInbox() {
      var matches = [], cursor;
      do {
        var page = request('get', 'blocks/' + parent + '/children?page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''));
        (page.results || []).forEach(function (b) {
          if (b.type === 'child_database' && b.child_database.title === 'tl;dv 受信' && !b.archived && !b.in_trash) matches.push(b.id);
        });
        cursor = page.has_more ? page.next_cursor : null;
      } while (cursor);
      if (matches.length !== 1) throw new Error('管理用ページ直下の「tl;dv 受信」DBが' + matches.length + '件あります。1件に特定できません。');
      return schema(matches[0]);
    }
    function project(id) {
      var page = request('get', 'pages/' + encodeURIComponent(id), null, [400, 403, 404]);
      if (!page || page.archived || page.in_trash || !page.parent || !verified.tasks) return null;
      var belongs=page.parent.type === 'data_source_id' && normalize(page.parent.data_source_id) === normalize(verified.tasks.sourceId) || page.parent.type === 'database_id' && normalize(page.parent.database_id) === normalize(ids.tasks);
      if(!belongs) return null;
      verifiedProjectInfo[id]={id:page.id,domains:((((page.properties || {})['事業部領域'] || {}).multi_select) || []).map(function(o){return o.name;})};
      return page.id;
    }
    function verifyMinutesPage(id) {
      var page = request('get', 'pages/' + encodeURIComponent(id));
      if (!verified.minutes || (page.archived || page.in_trash) || !page.parent || !(page.parent.type === 'data_source_id' && normalize(page.parent.data_source_id) === normalize(verified.minutes.sourceId) || page.parent.type === 'database_id' && normalize(page.parent.database_id) === normalize(ids.minutes))) throw new Error('記録済みページがテスト議事録DBに属していません。');
      allowedPages.add(normalize(page.id)); return page;
    }
    function updateReviewPage(id, props) {
      if (!['review','review-setup'].includes(purpose)) throw new Error('確認画面専用です。');
      if (arguments.length>2 || !props || Object.keys(props).some(function(k){return !['議事録名','事業部領域','関連するプロジェクト','確認状態'].includes(k);})) throw new Error('状態を含むプロパティ更新だけを許可します。ゴミ箱は使用できません。');
      if (!allowedPages.has(normalize(id))) verifyMinutesPage(id);
      return request('patch', 'pages/' + id, { properties: props });
    }
    function prepareReviewStatus() {
      if (purpose!=='review-setup' || !verified.minutes) throw new Error('テスト議事録DBの準備専用です。');
      var plan=ReviewPlan_.statusSchema(verified.minutes.properties['確認状態']);
      console.log('確認状態の追加予定: '+JSON.stringify(plan.added));
      if (!plan.changed || dryRun==='true') return plan;
      var body={properties:{'確認状態':{type:'select',select:{options:plan.options}}}};
      statusPatch={path:'data_sources/'+verified.minutes.sourceId,body:JSON.stringify(body)};
      request('patch',statusPatch.path,body);statusPatch=null;
      verified.minutes.properties['確認状態']={type:'select',select:{options:plan.options}};
      if (typeof ReviewCache_ !== 'undefined') ReviewCache_.remove('schema:'+normalize(ids.minutes));
      return plan;
    }
    function projects() {
      if (!verified.tasks) throw new Error('テストDBを確認してください。');
      var out = [], cursor;
      do {
        var body = { page_size: 100 }; if (cursor) body.start_cursor = cursor;
        var data = request('post', 'data_sources/' + verified.tasks.sourceId + '/query', body);
        (data.results || []).forEach(function (p) { if (p.archived || p.in_trash) return; var title = Object.values(p.properties || {}).find(function (v) { return v.type === 'title'; }); out.push({ id: p.id, domains: ((p.properties['事業部領域'] || {}).multi_select || []).map(function (v) { return v.name; }), title: title ? title.title.map(function (t) { return t.plain_text || t.text && t.text.content || ''; }).join('') : p.id }); });
        cursor = data.has_more ? data.next_cursor : null;
        if (out.length >= 500 && cursor) throw new Error('プロジェクト候補が500件を超えました。refを整備してください。');
      } while (cursor);
      return out;
    }
    function referenceProjects() {
      if (!verified.tasks) throw new Error('テスト用タスクDBの確認が必要です。');
      var titles=Object.values(verified.tasks.properties).filter(function(p){return p.type==='title';});
      if(titles.length!==1)throw new Error('テスト用タスクDBのタイトル定義を確認してください。');
      var rows=[],cursor=null,cursors=new Set(),seen=new Set();
      do {
        var body={page_size:100};if(cursor)body.start_cursor=cursor;
        var result=request('post','data_sources/'+verified.tasks.sourceId+'/query',body);
        if(!Array.isArray(result.results))throw new Error('Notionの一覧応答が不正です。既存参照ファイルは更新しません。');
        result.results.forEach(function(page){
          if(page.archived||page.in_trash)return;
          if(!page.id||!page.parent||!(page.parent.type==='data_source_id'&&normalize(page.parent.data_source_id)===normalize(verified.tasks.sourceId)||page.parent.type==='database_id'&&normalize(page.parent.database_id)===normalize(ids.tasks)))throw new Error('参照候補にテスト用タスクDB以外のページが含まれています。');
          if(seen.has(normalize(page.id)))throw new Error('Notionの参照候補が重複しています。再取得してください。');
          seen.add(normalize(page.id));rows.push(RefExportPlan_.project(page));
        });
        cursor=result.has_more?result.next_cursor:null;
        if(result.has_more&&(!cursor||cursors.has(cursor)))throw new Error('Notionのページ送りが不正です。');
        if(cursor)cursors.add(cursor);
        if(rows.length>5000||cursors.size>100)throw new Error('参照候補が上限を超えました。途中の内容で更新しません。');
      }while(cursor);
      rows.forEach(function(p){p.parent_ids=p.parent_ids.filter(function(id){return seen.has(normalize(id));});});
      return rows;
    }
    function createPage(payload) { var page = request('post', 'pages', payload); if (page.id) allowedPages.add(normalize(page.id)); return page; }
    function appendBlocks(id, children) { return request('patch', 'blocks/' + id + '/children', { children: children }); }
    function addInboxOptions() {
      if (purpose !== 'inbox-options') throw new Error('選択肢追加専用の呼び出しではありません。');
      var inbox = discoverInbox();
      if (normalize(inbox.databaseId) !== normalize('400ca178-7419-80dd-a3e0-ef9e2267a64c') || normalize(properties.getProperty('NOTION_DB_TLDV_INBOX')) !== normalize(inbox.databaseId)) throw new Error('確認済みtl;dv受信DBのIDが必要です。');
      var property = inbox.properties['取り込み状態'];
      if (!property || property.type !== 'select') throw new Error('取り込み状態はselect型が必要です。');
      var plan = InboxPlan_.mergeOptions(property.select.options || []);
      console.log('取り込み状態の追加予定: ' + JSON.stringify(plan.added));
      if (dryRun === 'true' || !plan.added.length) return { added: plan.added, dryRun: dryRun === 'true' };
      var body = { properties: { '取り込み状態': { type: 'select', select: { options: plan.options } } } };
      inboxPatch = { path: 'data_sources/' + inbox.sourceId, body: JSON.stringify(body) };
      request('patch', inboxPatch.path, body); inboxPatch = null;
      console.log('不足していた選択肢だけを追加しました。');
      return { added: plan.added, dryRun: false };
    }
    return { properties: properties, dryRun: dryRun === 'true', schema: schema, inbox: discoverInbox, project: project, createPage: createPage,
      verifyMinutesPage: verifyMinutesPage, appendBlocks: appendBlocks, addInboxOptions: addInboxOptions,
      updateReviewPage: updateReviewPage, prepareReviewStatus: prepareReviewStatus, projectDetails:function(id){return verifiedProjectInfo[id] || null;}, projects: projects, referenceProjects:referenceProjects,
      ids: { minutes: ids.minutes, tasks: ids.tasks } };
  }
  return { open: open, normalize: normalize };
})();

function checkTestEnvironment() {
  if (typeof assertFinanceOperator_ === 'function') assertFinanceOperator_();
  var env = NotionTestEnvironment_.open(false), report = { databases: [], differences: [], inboxId: null };
  function inspect(key, schema) {
    var comparison = NotionFixturePlan_.compareSchema(key, schema.properties, env.properties.getProperty('NOTION_REQUESTER_TYPE') || 'people');
    report.databases.push({ name: key, databaseId: schema.databaseId, properties: comparison.properties });
    comparison.differences.forEach(function (d) { report.differences.push(Object.assign({ database: key }, d)); });
    console.log('項目名・型: ' + key + ' / ' + JSON.stringify(comparison.properties));
    if (comparison.knownAdditions.length) console.log('既知の追加項目（書き込みには使いません）: ' + JSON.stringify(comparison.knownAdditions));
  }
  inspect('minutes', env.schema(env.ids.minutes, 'minutes'));
  inspect('tasks', env.schema(env.ids.tasks, 'tasks'));
  try {
    var inbox = env.inbox();
    report.inboxId = inbox.databaseId;
    inspect('inbox', inbox);
    console.log('NOTION_DB_TLDV_INBOX = ' + inbox.databaseId + ' をスクリプトプロパティに登録してください。');
  } catch (e) { report.differences.push({ database: 'inbox', kind: '取得失敗', message: e.message }); }
  console.log('SPECとの差分一覧: ' + JSON.stringify(report.differences));
  console.log('依頼者はNOTION_REQUESTER_TYPE（既定people）で照合します。設定・Notionへの書き込みは行っていません。');
  return report;
}

function addTldvInboxStatusOptions() {
  if (typeof assertFinanceOperator_ === 'function') assertFinanceOperator_(); return Ledger_.withLock(function () { return NotionTestEnvironment_.open(true, 'inbox-options').addInboxOptions(); }); }


// peopleImport.js
// 一時シートpeople_importにCSVをインポート/貼付してから、管理者が一度実行します。
var PeopleImport_=(function(){
 function plan(values,existing){var headers=['name','google_email','alt_emails','notion_user_id','domains','is_reviewer','is_admin'];if(!values.length||JSON.stringify(values[0])!==JSON.stringify(headers))throw new Error('people_importの見出しを指定の7列に揃えてください。');
  var rows=values.slice(1).filter(function(r){return r.some(function(v){return String(v).trim();});}).map(function(r){var person={};headers.forEach(function(h,i){person[h]=String(r[i]===undefined?'':r[i]).trim();});person.google_email=person.google_email.toLowerCase();person.alt_emails=JSON.stringify(NotesPlan_.list(person.alt_emails).map(function(s){return s.toLowerCase();}));person.domains=JSON.stringify(NotesPlan_.list(person.domains));if(!person.name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.google_email)||NotesPlan_.list(person.alt_emails).some(function(e){return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);}))throw new Error('社員名・メールの形式が不正です。');if(person.notion_user_id&&!/^[0-9a-f]{32}$/i.test(person.notion_user_id.replace(/-/g,'')))throw new Error('NotionユーザーIDを確認してください。メールではなくユーザーIDです。');if(NotesPlan_.list(person.domains).some(function(d){return !['セールス・マーケ','EC','生産管理','経理・バックオフィス','Salesforce・AI','経営'].includes(d);}))throw new Error('事業部領域の選択肢が不正です。');['is_admin','is_reviewer'].forEach(function(h){if(!['','true','false','TRUE','FALSE'].includes(person[h]))throw new Error('権限はtrue/falseで指定してください。');person[h]=person[h].toLowerCase()==='true';});return person;});
  if(new Set(rows.map(function(p){return p.google_email;})).size!==rows.length)throw new Error('インポート内の社員メールが重複しています。');
  var all=existing.map(function(p){return Object.assign({},p);}),changes=[];rows.forEach(function(p){var matches=all.filter(function(e){return String(e.google_email).toLowerCase()===p.google_email;});if(matches.length>1)throw new Error('既存社員メールが重複しています。');if(matches.length){var old=matches[0];if(old.name!==p.name||old.notion_user_id&&p.notion_user_id&&old.notion_user_id!==p.notion_user_id)throw new Error('既存社員の氏名/Notion IDが違います。自動で置換しません。');if((String(old.is_admin).toLowerCase()==='true')!==p.is_admin||(String(old.is_reviewer).toLowerCase()==='true')!==p.is_reviewer)throw new Error('既存の権限はインポートで変更しません。台帳で確認してください。');p.notion_user_id=p.notion_user_id||old.notion_user_id;p.alt_emails=JSON.stringify(Array.from(new Set(NotesPlan_.list(old.alt_emails).concat(NotesPlan_.list(p.alt_emails)))));if(!NotesPlan_.list(p.domains).length)p.domains=old.domains;changes.push({action:'更新',row:old._row,person:p});all[all.indexOf(old)]=p;}else{changes.push({action:'追加',person:p});all.push(p);}});
  var identities={};all.forEach(function(p){[String(p.google_email).toLowerCase()].concat(NotesPlan_.list(p.alt_emails).map(function(e){return e.toLowerCase();})).forEach(function(e){if(!e)return;if(identities[e]&&identities[e]!==p.google_email)throw new Error('別社員とメール/別名が重複しています。');identities[e]=p.google_email;});});return changes;
 }
 return {plan:plan};
})();
function importPeopleFromSheet(){assertFinanceOperator_();return Ledger_.withLock(function(){var c=ServiceConfig_.load(),drive=ServiceDrive_.open(c);drive.within(c.LEDGER_SPREADSHEET_ID);var book=SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID),sheet=book.getSheetByName('people_import');if(!sheet)throw new Error('people_importシートにCSVの7列を貼り付けてください。');var ledger=Stage2Ledger_.open(book,true),changes=PeopleImport_.plan(sheet.getDataRange().getValues(),ledger.rows('masters_people'));
 console.log('社員マスタ：追加'+changes.filter(function(c){return c.action==='追加';}).length+'件／更新'+changes.filter(function(c){return c.action==='更新';}).length+'件の予定です。');if(c.DRY_RUN==='true')return {dryRun:true,count:changes.length};
 var columns=Ledger_.headers.masters_people.split(',');changes.forEach(function(change){var p=change.person;if(change.action==='追加'){ledger.append('masters_people',p);return;}var existing=ledger.rows('masters_people').find(function(r){return r._row===change.row;}),merged=Object.assign({},existing,p);book.getSheetByName('masters_people').getRange(change.row,1,1,columns.length).setValues([columns.map(function(k){var v=merged[k]===undefined?'':merged[k];return /^[=+@]/.test(String(v))?"'"+v:v;})]);});console.log('社員マスタを反映しました。インポート用シートは削除していません。');return {count:changes.length};});}


// refExportPlan.js
// 参照用に必要な項目だけを取り出します。権限・トークン・自由記述本文は出力しません。
var RefExportPlan_=(function(){
  function text(v){return String(v===undefined||v===null?'':v).trim();}
  function list(v){return Array.from(new Set(ReviewSecurity_.list(v).map(text).filter(Boolean)));}
  function masters(rows,at){
    var omitted=0;
    var people=rows.people.map(function(p){var email=text(p.google_email).toLowerCase();if(!/^[^\s@]+@premiere-mode\.co\.jp$/.test(email)){omitted++;return null;}return {name:text(p.name),google_email:email,notion_user_id:text(p.notion_user_id)||null,domains:list(p.domains)};}).filter(Boolean);
    if(new Set(people.map(function(p){return p.google_email;})).size!==people.length)throw new Error('社員マスタの会社メールが重複しています。');
    var folders=rows.folders.filter(function(f){return text(f.placement);}).map(function(f){return {placement:text(f.placement),notion_domain:text(f.notion_domain)||null};});
    var clients=rows.clients.filter(function(c){return text(c.client_name);}).map(function(c){return {client_name:text(c.client_name),domains:list(c.domains).map(function(d){return d.toLowerCase();})};});
    return {data:{schema_version:1,env:'test',generated_at:at,folders:folders,clients:clients,internal:list(rows.internal).map(function(v){return v.toLowerCase();}),people:people},omittedPeople:omitted};
  }
  function project(page){
    var props=page.properties||{},titles=Object.keys(props).filter(function(k){return props[k].type==='title';});
    if(titles.length!==1)throw new Error('プロジェクト・タスクのタイトルを1つに特定できません。');
    var status=props['ステータス'],domains=props['事業部領域'],parent=props['親アイテム'],due=props['期日'];
    return {id:page.id,title:(props[titles[0]].title||[]).map(function(t){return t.plain_text||t.text&&t.text.content||'';}).join(''),status:status&&['status','select'].includes(status.type)&&status[status.type]?status[status.type].name||null:null,
      domains:domains&&domains.type==='multi_select'?(domains.multi_select||[]).map(function(d){return d.name;}):[],parent_ids:parent&&parent.type==='relation'?(parent.relation||[]).map(function(r){return r.id;}):[],due:due&&due.type==='date'&&due.date?due.date.start:null};
  }
  return {masters:masters,project:project};
})();


// review.js
var Review_ = (function () {
  function context() {
    var email = ReviewSecurity_.active(), props = PropertiesService.getScriptProperties();
    if (props.getProperty('REVIEW_MASTER_ACCESS') !== 'true' && email !== ReviewSecurity_.finance) throw new Error('テスト中の利用者はfinance@だけです。');
    var c = Stage2Drive_.config(), drive = Stage2Drive_.open(c); drive.within(c.LEDGER_SPREADSHEET_ID);
    var ledger = Stage2Ledger_.open(SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID), true), masters = ledger.masters();
    var user = ReviewSecurity_.actor(email, masters.people, ledger.rows('settings'), props.getProperty('REVIEW_MASTER_ACCESS'));
    return { sources: {}, c: c, drive: drive, ledger: ledger, masters: masters, user: user, props: props };
  }
  function row(c, key) {
    var rows = c.ledger.rows('minutes').filter(function (r) { return r.meeting_key === key; });
    if (rows.length !== 1 || !ReviewSecurity_.canView(c.user, rows[0], c.masters)) throw new Error('この議事録を閲覧・操作できません。');
    return rows[0];
  }
  function json(value, fallback) { return value ? JSON.parse(value) : fallback; }
  function safe(r) {
    var out = {}; ['meeting_key','display_id','event_start','event_end','title','source','status','placement_final','scope_final','domains_final','related_project_ids_final','minutes_title','confidence','reason','organizer_email','reviewer_email','notion_status','last_error','scope_auto','placement_auto','domains_auto','related_project_ids_auto'].forEach(function (k) { out[k] = String(r[k] || ''); }); out.version = Number(r.version); return out;
  }
  function list(c, filters) {
    filters = filters || {};
    var rows = c.ledger.rows('minutes').filter(function (r) {
      return ReviewSecurity_.canView(c.user, r, c.masters) && (!filters.status || r.status === filters.status) && (!filters.domain || ReviewSecurity_.list(r.domains_final).includes(filters.domain)) && (!filters.mine || c.user.identities.includes(ReviewSecurity_.email(r.reviewer_email || r.organizer_email))) && (!filters.date || localDate(r.event_start) === filters.date);
    });
    var offset = Math.max(0, Math.floor(Number(filters.offset) || 0));
    return { total: rows.length, rows: rows.slice(offset, offset + 50).map(function (r) { var o = safe(r); o.taskCount = proposals(c, r); return o; }), offset: offset };
  }
  function localDate(value) { var ms=Date.parse(value); return Number.isFinite(ms) ? new Date(ms+9*3600000).toISOString().slice(0,10) : ''; }
  function source(c, r) {
    var steps=json(r.step_done_json,{}), display=steps.reviewDisplay;
    if (display && display.jsonId===steps.jsonId && display.hash===steps.hash) return display;
    if (c.sources[r.meeting_key]) return c.sources[r.meeting_key];
    var key='json:'+c.c.FOLDER_SYSTEM_TEST_ID+':'+steps.jsonId+':'+(steps.hash||''), cached=ReviewCache_.get(key);
    if (cached) return c.sources[r.meeting_key]=cached;
    try {
      var j=steps.jsonId ? c.drive.readJSON(steps.jsonId) : {}, value={summary:j.summary||{},taskCount:(j.task_proposals||[]).length};
      if(steps.jsonId) ReviewCache_.put(key,value,120);
      return c.sources[r.meeting_key]=value;
    } catch(e) { return {summary:{error:'元の判定JSONを読み取れません。再実行前に管理者が確認してください。'},taskCount:0}; }
  }
  function proposals(c,r) { return source(c,r).taskCount || 0; }
  function notion(readOnly, needTasks) {
    var env=NotionTestEnvironment_.open(true,'review');
    env.minutesSchema=env.schema(env.ids.minutes,'minutes',!!readOnly);
    if(needTasks) env.schema(env.ids.tasks,'tasks',!!readOnly);
    return env;
  }
  function detail(c, key, compact) {
    var r = row(c, key), out = safe(r), j = source(c, r), steps = json(r.step_done_json, {});
    out.attendees = json(r.attendees_json, []).map(function (a) { var address = typeof a === 'string' ? a : a.email; return { email: address, internal: MeetingRules_.classify([{email:address}], c.masters).scope === '社内' }; });
    out.summary = j.summary || {}; out.taskCount = j.taskCount || 0; out.links = [];
    var raw=json(r.raw_file_ids_json,{}), fileLinks=[['会議フォルダ',r.meeting_folder_id],['議事録',r.minutes_doc_id]];
    [['recording','録画'],['transcript','文字起こし'],['gemini','Geminiメモ']].forEach(function(pair){if (raw[pair[0]]) fileLinks.push([pair[1],raw[pair[0]]]);});
    out.fileStatus={recording:raw.recording?'あり':'なし',transcript:raw.transcript?'あり':'なし',gemini:raw.gemini?'あり':'なし'};
    var children=!compact && r.meeting_folder_id ? c.drive.children(r.meeting_folder_id).map(function(f){return f.id;}) : null;
    fileLinks.forEach(function (pair) { if (pair[1]) { if (!compact && pair[1]!==r.meeting_folder_id && children && !children.includes(pair[1])) return; out.links.push({ title: pair[0], url: 'https://drive.google.com/open?id=' + encodeURIComponent(pair[1]) }); } });
    if (r.notion_page_id && /^[0-9a-f-]{32,36}$/i.test(r.notion_page_id)) { out.links.push({ title: 'Notion', url: 'https://www.notion.so/' + r.notion_page_id.replace(/-/g,'') }); }
    out.history = c.ledger.rows('change_log').filter(function (h) { return h.meeting_key === key; }).slice(-30).map(function (h) { return { at: String(h.at), actor: h.actor, action: h.kind, before: h.before_json, after: h.after_json, result: h.result }; });
    out.pending = steps.review ? { state: steps.review.state, action: steps.review.plan.action, drive: !!steps.review.drive, notion: !!steps.review.notion, chatwork: !!steps.review.chatwork } : null;
    return out;
  }
  function choices(c) {
    var folders = c.masters.folders.filter(function (f) { return c.user.admin || (!f.rank || c.user.ranks.includes(String(f.rank))); }).map(function (f) { return f.placement; });
    // プロジェクト候補も所属確認を行います。非管理者には領域の確認できない候補を公開しません。
    var projectKey='projects:'+c.c.FOLDER_SYSTEM_TEST_ID+':'+c.c.NOTION_DB_TASKS_TEST+':'+(c.user.admin?'admin':'reviewer'), cached=ReviewCache_.get(projectKey);
    var projects = cached || [];
    if (!cached) {
      var ref = c.drive.folder(c.drive.root.id, 'ref', false), files = c.drive.children(ref.id).filter(function (f) { return f.name === 'projects.json'; });
      if (files.length > 1) throw new Error('projects.jsonが重複しています。');
      var env=NotionTestEnvironment_.open(true,'review'); env.schema(env.ids.tasks,'tasks',true);
      if (files.length && c.user.admin) { var data = c.drive.readJSON(files[0].id); var candidates = Array.isArray(data) ? data : data.projects || []; candidates.slice(0,500).forEach(function (p) { if (p.id && env.project(p.id)) projects.push({ id: p.id, domains: ReviewSecurity_.list(p.domains), title: String(p.title || p.name || p.id) }); }); }
      else projects = env.projects();
      ReviewCache_.put(projectKey,projects,120);
    }
    projects = projects.filter(function (p) { return projectVisible(c,p); }).map(function (p) { return {id:p.id,title:p.title}; });
    return { folders: folders, projects: projects };
  }
  function projectVisible(c,p) {
    if (c.user.admin) return true;
    return p.domains && p.domains.length > 0 && p.domains.every(function(d) {
      var f=c.masters.folders.find(function(v){return v.notion_domain===d || v.placement==='社内/'+d;});
      return f && (!f.rank || c.user.ranks.includes(String(f.rank))) && (!c.user.domains.length || c.user.domains.includes(d));
    });
  }
  function destination(c, r, plan, create) {
    if (plan.exclude) return c.drive.folder(c.drive.root.id, '99_対象外', false).id;
    if (!plan.updateProperties) return r.folder_id_final;
    if (plan.newClient) {
      if (!c.user.admin) throw new Error('新規顧客の再実行も管理者専用です。');
      var client = plan.newClient, parent = c.drive.folder(c.drive.root.id, '社外', false);
      if (!create) return '新規顧客/' + client.name;
      var folder = c.drive.folder(parent.id, InboxPlan_.safeName(client.name), true);
      if (!c.ledger.rows('masters_clients').some(function (m) { return m.client_name === client.name; })) c.ledger.append('masters_clients', { client_name: client.name, domains: JSON.stringify(client.domains), drive_folder_id: folder.id, created_by: c.user.email, created_at: new Date().toISOString() });
      if (!c.ledger.rows('masters_folders').some(function (m) { return m.placement === plan.desired.placement_final; })) c.ledger.append('masters_folders', { placement: plan.desired.placement_final, drive_folder_id: folder.id });
      return folder.id;
    }
    var matches = c.masters.folders.filter(function (f) { return f.placement === plan.desired.placement_final; });
    if (matches.length !== 1) throw new Error('格納先を1件に特定できません。');
    if (!c.user.admin && matches[0].rank && !c.user.ranks.includes(String(matches[0].rank))) throw new Error('移動先の閲覧権限がありません。');
    if (!c.user.admin && c.user.domains.length && ReviewSecurity_.list(plan.desired.domains_final).some(function (d) { return !c.user.domains.includes(d); })) throw new Error('事業部領域の操作権限がありません。');
    c.drive.within(matches[0].drive_folder_id); return matches[0].drive_folder_id;
  }
  function log(c, action, r, body) { console.log(action + ': ' + body); c.ledger.log(action, r.meeting_key, body); }
  function chat(c, r, journal, save, preview) {
    var body = InboxPlan_.card(Object.assign({},r,journal.plan.desired), c.c.WEBAPP_URL), reply = ReviewPlan_.reply(journal.plan).replace(/https?:\/\/\S+/g,'（URL省略）').replace(/\[/g,'［').replace(/\]/g,'］');
    if (preview || !c.c.CHATWORK_TOKEN || !r.chatwork_message_id) {
      log(c, 'Chatwork PUT予定（送信なし）', r, body);
      if (journal.plan.reconfirmed) log(c, 'Chatwork [rp]返信予定（送信なし）', r, reply);
      return;
    }
    var room = c.c.CHATWORK_ROOM_ID_TEST, id = String(r.chatwork_message_id);
    if (!/^\d+$/.test(room || '') || room === c.c.CHATWORK_ROOM_ID || !/^\d+$/.test(id)) throw new Error('テスト用Chatworkルーム・メッセージIDが不正です。');
    function request(method, path, payload) {
      var res = UrlFetchApp.fetch('https://api.chatwork.com/v2/' + path, { method: method, headers: { 'X-ChatWorkToken': c.c.CHATWORK_TOKEN }, payload: payload, muteHttpExceptions: true });
      if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) throw new Error('Chatwork反映失敗: HTTP ' + res.getResponseCode());
      return JSON.parse(res.getContentText());
    }
    var me = request('get','me'), message = request('get','rooms/'+room+'/messages/'+id);
    if (String(me.account_id) !== String(message.account.account_id)) throw new Error('投稿者が一致しないためChatworkを更新しません。');
    if (!journal.put) { request('put','rooms/'+room+'/messages/'+id,{body:body}); journal.put = true; save(); }
    if (journal.plan.reconfirmed && !journal.reply) {
      if (journal.replyPending) throw new Error('返信結果が不明です。Chatworkを確認してください。二重送信しません。');
      journal.replyPending = true; save();
      request('post','rooms/'+room+'/messages',{body:'[rp aid='+me.account_id+' to='+room+'-'+id+']\n'+reply,self_unread:'0'});
      journal.reply = true; save();
    }
  }
  function submit(request) {
    return Ledger_.withLock(function () {
      var c = context(); ReviewSecurity_.verifyNonce(c.user, request.nonce);
      var r = row(c, request.meetingKey);
      if (!Number.isInteger(request.version) || Number(r.version) !== request.version) throw new Error('先に更新されました。画面を読み込み直してください。');
      var steps = json(r.step_done_json, {}), journal = ReviewPlan_.migrateJournal(steps.review), retry = request.action === 'retry';
      if (retry && r.status !== '要対応') throw new Error('再実行は要対応のときだけです。');
      if (retry && !journal) {
        if (!c.user.admin) throw new Error('取り込みの再実行は管理者専用です。');
        if (c.c.DRY_RUN === 'true') { log(c,'取り込み再実行予定',r,r.meeting_key); return {message:'再実行予定を記録しました。'}; }
        delete steps.error; r.step_done_json=JSON.stringify(steps); c.ledger.save(r); InboxIngest_.run(r.meeting_key); return {message:'取り込みを再実行しました。'};
      }
      if (!retry && journal && journal.state !== 'done') throw new Error('未完了の処理を再実行してください。');
      if (!retry) journal = { id: Utilities.getUuid(), actor: c.user.email, plan: ReviewPlan_.plan(r,request,c.masters,c.user,new Date().toISOString()), state:'running' };
      var plan=journal.plan, desired=Object.assign({},r,plan.desired), projectIds=ReviewSecurity_.list(desired.related_project_ids_final), env=notion(false,plan.updateProperties && projectIds.length>0), verified=[];
      env.verifyMinutesPage(r.notion_page_id);
      (plan.updateProperties ? projectIds : []).forEach(function (id) { var found = env.project(id); if (found) verified.push(id); });
      if (!c.user.admin && plan.updateProperties && projectIds.some(function(id){var info=env.projectDetails(id);return !info || !projectVisible(c,info);})) throw new Error('関連プロジェクトの閲覧・操作権限を確認できません。');
      var payload = plan.updateProperties ? ReviewPlan_.notionProperties(desired, env.minutesSchema, verified) : ReviewPlan_.statusProperties(desired.status,env.minutesSchema);
      var dest = destination(c,r,plan,false); var meetingFolder = c.drive.within(r.meeting_folder_id);
      if (journal.drive && (plan.exclude || plan.updateProperties) && !(meetingFolder.parents || []).includes(plan.desired.folder_id_final)) throw new Error('処理記録と現在の格納先が異なります。管理者が確認してください。');
      if (c.c.DRY_RUN === 'true') { log(c,'確認画面の反映予定',r,JSON.stringify({plan:plan,destination:dest,properties:payload})); chat(c,r,journal,function(){},true); return { message:'予定をdry_run_logに記録しました。議事録は変更していません。',row:detail(c,r.meeting_key,true),dryRun:true }; }
      function result(message,failed) { return {message:message,failed:!!failed,dryRun:c.c.DRY_RUN==='true',version:Number(r.version),removedKey:r.meeting_key,row:ReviewSecurity_.canView(c.user,r,c.masters)?detail(c,r.meeting_key,true):null}; }
      function save() { steps.review=journal; r.step_done_json=JSON.stringify(steps); c.ledger.save(r); }
      function fail(step) { if (c.user.email === ReviewSecurity_.finance && c.props.getProperty('REVIEW_TEST_FAIL_STEP') === step) { c.props.deleteProperty('REVIEW_TEST_FAIL_STEP'); throw new Error('再実行確認用に停止しました（'+step+'）。'); } }
      journal.state='running'; save();
      try {
        if (!journal.drive) {
          dest=destination(c,r,plan,true);
          if (plan.updateProperties || plan.exclude) { var file=c.drive.within(r.meeting_folder_id); if (!(file.parents || []).includes(dest)) c.drive.move(r.meeting_folder_id,dest,'meeting_folder',r.meeting_key); plan.desired.folder_id_final=dest; if (plan.exclude) plan.desired.placement_final='99_対象外'; }
          journal.drive=true; save(); fail('after_drive');
        }
        if (!journal.notion) { env.updateReviewPage(r.notion_page_id,payload); journal.notion=true; save(); fail('after_notion'); }
        if (!journal.chatwork) { chat(c,r,journal,save,false); journal.chatwork=true; save(); fail('after_chatwork'); }
        var changeId='review:'+journal.id;
        if (!c.ledger.rows('change_log').some(function(h){return h.change_id===changeId;})) c.ledger.append('change_log',{change_id:changeId,at:new Date().toISOString(),meeting_key:r.meeting_key,kind:plan.action,target:'議事録',before_json:JSON.stringify(plan.before),after_json:JSON.stringify(plan.desired),actor:journal.actor,result:'成功'});
        Object.assign(r,plan.desired); r.notion_status='反映済み（'+plan.desired.status+'）'; r.last_error=''; journal.state='done'; save();
        return result('反映しました。',false);
      } catch(e) { journal.state='failed'; r.status='要対応'; var error=String(e.message || '不明なエラー'); [c.c.NOTION_TOKEN,c.c.CHATWORK_TOKEN].filter(Boolean).forEach(function(secret){error=error.split(secret).join('[非表示]');}); r.last_error=error; save(); return result('処理を停止しました。'+error+' 「再実行」で続きから再開できます。',true); }
    });
  }
  return {context:context,list:list,detail:detail,source:source,choices:choices,submit:submit};
})();
function doGet() {
  try {
    var email=ReviewSecurity_.active();
    if(PropertiesService.getScriptProperties().getProperty('REVIEW_MASTER_ACCESS')!=='true' && email!==ReviewSecurity_.finance) throw new Error('権限がありません。');
    return HtmlService.createTemplateFromFile('Index').evaluate().setTitle('議事録の確認');
  } catch(e) { return HtmlService.createHtmlOutput('この確認画面を開く権限がないか、設定が未完了です。finance@でログインし、管理者に確認してください。'); }
}
function includeReview_(name) { if (!['Styles','Scripts'].includes(name)) throw new Error('不正な画面部品です。'); return HtmlService.createHtmlOutputFromFile(name).getContent(); }
function reviewTimed_(label,fn) { var start=Date.now();try{return fn();}finally{console.log('確認画面 '+label+'：'+(Date.now()-start)+'ms');} }
function reviewBootstrap() { return reviewTimed_('初期表示',function(){ var c=Review_.context(); return {actor:c.user.email,admin:c.user.admin,dryRun:c.c.DRY_RUN==='true',nonce:ReviewSecurity_.nonce(c.user),choices:Review_.choices(c),list:Review_.list(c,{})}; }); }
function reviewList(filters) { return reviewTimed_('一覧',function(){ var c=Review_.context(); return Review_.list(c,filters); }); }
function reviewDetail(key) { return reviewTimed_('詳細',function(){ var c=Review_.context(); return Review_.detail(c,key); }); }
function reviewSubmit(request) { return reviewTimed_('操作',function(){ return Review_.submit(request); }); }


// reviewCache.js
// 権限・version・更新対象の所属はキャッシュしません。表示データだけ短時間再利用します。
var ReviewCache_ = (function () {
  function get(key) { try { var value=CacheService.getScriptCache().get('rv2:'+key); return value ? JSON.parse(value) : null; } catch(e) { return null; } }
  function put(key,value,seconds) { try { var text=JSON.stringify(value); if(text.length<24000) CacheService.getScriptCache().put('rv2:'+key,text,seconds||120); } catch(e) {} return value; }
  function remove(key) { try { CacheService.getScriptCache().remove('rv2:'+key); } catch(e) {} }
  return {get:get,put:put,remove:remove};
})();


// reviewPlan.js
var ReviewPlan_ = (function () {
  var domains = ['セールス・マーケ', 'EC', '生産管理', '経理・バックオフィス', 'Salesforce・AI', '経営'];
  function arrays(value) { return ReviewSecurity_.list(value); }
  function canonical(value) { return JSON.stringify(Array.isArray(value) ? value.slice().sort() : value); }
  function snapshot(row) { var out = {}; ['status', 'scope_final', 'placement_final', 'domains_final', 'related_project_ids_final', 'minutes_title', 'folder_id_final', 'confirmed_by', 'confirmed_at'].forEach(function (k) { out[k] = row[k] || ''; }); return out; }
  function plan(row, request, masters, user, now) {
    if (!['confirm', 'edit_confirm', 'hold', 'exclude'].includes(request.action)) throw new Error('操作が不正です。');
    if (row.status === '要対応') throw new Error('先に再実行で未完了の処理を再開してください。');
    if (row.status === '対象外' || row.status === '対象外（Meet優先）') throw new Error('対象外の議事録はこの画面から復帰できません。');
    if (!row.meeting_folder_id || !row.notion_page_id) throw new Error('取り込みが未完了です。先に再実行してください。');
    var next = snapshot(row), edits = request.action === 'edit_confirm' ? request.edits || {} : {}, newClient = null;
    var allowed = ['scope', 'placement', 'domains', 'projectIds', 'minutesTitle', 'newClient', 'ackExternal'];
    Object.keys(edits).forEach(function (key) { if (!allowed.includes(key)) throw new Error('未定義の編集項目です。'); });
    if (request.action === 'edit_confirm') {
      if (!['社内', '社外'].includes(edits.scope)) throw new Error('社内・社外を選んでください。');
      if (typeof edits.minutesTitle !== 'string' || !edits.minutesTitle.trim() || edits.minutesTitle.length > 2000) throw new Error('議事録名を1〜2000文字で入力してください。');
      if (!Array.isArray(edits.domains) || edits.domains.some(function (d) { return !domains.includes(d); }) || new Set(edits.domains).size !== edits.domains.length) throw new Error('事業部領域は指定の6択から選んでください。');
      if (!Array.isArray(edits.projectIds) || edits.projectIds.length > 100 || edits.projectIds.some(function (id) { return typeof id !== 'string' || !/^[0-9a-f-]{32,36}$/i.test(id); }) || new Set(edits.projectIds).size !== edits.projectIds.length) throw new Error('関連プロジェクトが不正です。');
      next.scope_final = edits.scope; next.placement_final = edits.placement; next.domains_final = JSON.stringify(edits.domains); next.related_project_ids_final = JSON.stringify(edits.projectIds); next.minutes_title = edits.minutesTitle.trim();
      if (edits.newClient && edits.newClient.name) {
        if (!user.admin || edits.scope !== '社外') throw new Error('新規顧客は管理者が社外の格納先として登録します。');
        var name = String(edits.newClient.name).trim(), clientDomains = arrays(edits.newClient.domains).map(function (d) { return String(d).trim().toLowerCase(); });
        if (!name || name.length > 80 || !clientDomains.length || clientDomains.some(function (d) { return !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(d); })) throw new Error('新規顧客の名前とドメインを入力してください。');
        if (masters.clients.some(function (c) { return InboxPlan_.safeName(c.client_name) === InboxPlan_.safeName(name); })) throw new Error('同名・同じフォルダ名の顧客は既存の候補から選んでください。');
        newClient = { name: name, domains: Array.from(new Set(clientDomains)) }; next.placement_final = '社外/' + name;
      }
    }
    var confirm = ['confirm', 'edit_confirm'].includes(request.action);
    if (confirm) {
      if (typeof next.placement_final !== 'string' || !next.placement_final.startsWith(next.scope_final + '/')) throw new Error('社内・社外と格納先が一致しません。');
      if (!newClient && !masters.folders.some(function (f) { return f.placement === next.placement_final; })) throw new Error('登録済みの格納先を選んでください。');
      var attendees = JSON.parse(row.attendees_json || '[]'), rule = MeetingRules_.classify(attendees, masters);
      if (rule.scope === '社外' && next.scope_final === '社内' && !(request.edits || {}).ackExternal) throw new Error('社外参加者がいる会議です。社内へ配置する確認チェックが必要です。');
    }
    var changed = ['scope_final', 'placement_final', 'minutes_title'].some(function (k) { return next[k] !== row[k]; }) ||
      canonical(arrays(next.domains_final)) !== canonical(arrays(row.domains_final)) || canonical(arrays(next.related_project_ids_final)) !== canonical(arrays(row.related_project_ids_final));
    if (confirm) {
      next.status = changed || row.status === '確定・修正あり' ? '確定・修正あり' : '確定'; next.confirmed_by = user.email; next.confirmed_at = now;
    } else next.status = request.action === 'hold' ? '保留' : '対象外';
    return { action: request.action, before: snapshot(row), desired: next, newClient: newClient, changed: changed,
      reconfirmed: confirm && ['確定', '確定・修正あり'].includes(row.status) && changed, exclude: request.action === 'exclude', updateProperties: confirm };
  }
  var states = ['確認待ち','仕分け待ち','確定','確定・修正あり','保留','対象外','対象外（Meet優先）','要対応'];
  function statusSchema(property) {
    if (property && property.type!=='select') throw new Error('確認状態はselect型にしてください。既存項目は変更しません。');
    var options=property ? property.select.options || [] : [], added=states.filter(function(name){return !options.some(function(o){return o.name===name;});});
    return {changed:!property || added.length>0, added:added, options:options.concat(added.map(function(name){return {name:name};}))};
  }
  function statusProperties(status,schema) {
    var p=schema.properties['確認状態'];
    if (!states.includes(status) || !p || p.type!=='select' || !(p.select.options || []).some(function(o){return o.name===status;})) throw new Error('確認状態が未準備です。setupReviewNotionStatusを実行してください。');
    return {'確認状態':{select:{name:status}}};
  }
  function migrateJournal(journal) {
    if (!journal) return journal;
    var p=journal.plan;
    if (Object.prototype.hasOwnProperty.call(p,'archive')) {
      p.exclude=!!p.archive; delete p.archive;
      // 旧版でゴミ箱処理を完了した記録でも、再開時は状態を改めて反映します。
      if (journal.state!=='done') journal.notion=false;
    }
    return journal;
  }
  function notionProperties(row, schema, projectIds) {
    var p = schema.properties, selected = arrays(row.domains_final), ids = arrays(row.related_project_ids_final);
    if (!p['議事録名'] || p['議事録名'].type !== 'title' || !p['事業部領域'] || p['事業部領域'].type !== 'multi_select' || !p['関連するプロジェクト'] || p['関連するプロジェクト'].type !== 'relation') throw new Error('Notionの編集対象プロパティがSPECと異なります。');
    var options = (p['事業部領域'].multi_select.options || []).map(function (o) { return o.name; });
    if (selected.some(function (name) { return !domains.includes(name) || !options.includes(name); })) throw new Error('Notionに存在しない事業部領域は送信できません。');
    if (ids.some(function (id) { return !projectIds.includes(id); })) throw new Error('テスト用タスクDBに存在しない関連プロジェクトです。');
    return Object.assign(statusProperties(row.status,schema), { '議事録名': { title: [{ type: 'text', text: { content: row.minutes_title } }] }, '事業部領域': { multi_select: selected.map(function (name) { return { name: name }; }) }, '関連するプロジェクト': { relation: ids.map(function (id) { return { id: id }; }) } });
  }
  function reply(plan) {
    return '確定後の修正内容\n' + ['scope_final', 'placement_final', 'domains_final', 'related_project_ids_final', 'minutes_title'].filter(function (k) { return plan.before[k] !== plan.desired[k]; }).map(function (k) {
      var names = { scope_final: '区分', placement_final: '格納先', domains_final: '事業部領域', related_project_ids_final: '関連プロジェクト', minutes_title: '議事録名' };
      return names[k] + '：' + String(plan.before[k] || '未設定') + ' → ' + String(plan.desired[k] || '未設定');
    }).join('\n');
  }
  return { statusSchema:statusSchema,statusProperties:statusProperties,migrateJournal:migrateJournal,plan: plan, snapshot: snapshot, notionProperties: notionProperties, reply: reply };
})();


// reviewSecurity.js
var ReviewSecurity_ = (function () {
  var finance = 'finance@premiere-mode.co.jp';
  function email(value) { return String(value || '').trim().toLowerCase(); }
  function list(value) { if (Array.isArray(value)) return value; try { var a = JSON.parse(value || '[]'); if (Array.isArray(a)) return a; } catch (e) {} return String(value || '').split(',').map(function (v) { return v.trim(); }).filter(Boolean); }
  function yes(value) { return String(value).trim().toLowerCase() === 'true' || value === 1 || value === '1'; }
  function active() {
    var value = email(Session.getActiveUser().getEmail());
    if (!value || !value.endsWith('@premiere-mode.co.jp')) throw new Error('ログイン中の会社アカウントを確認できません。操作を拒否しました。');
    return value;
  }
  function actor(value, people, settings, enabled) {
    value = email(value);
    if (enabled !== 'true' && value !== finance) throw new Error('テスト中の利用者はfinance@だけです。');
    var matches = people.filter(function (p) { return [email(p.google_email)].concat(list(p.alt_emails).map(email)).includes(value); });
    if (matches.length !== 1 || !(yes(matches[0].is_admin) || yes(matches[0].is_reviewer))) throw new Error('閲覧・操作の権限がありません。管理者に確認してください。');
    var person = matches[0], rank = settings.find(function (s) { return s.key === 'review_rank_allow:' + email(person.google_email); });
    return { email: value, identities: [value, email(person.google_email)].concat(list(person.alt_emails).map(email)), admin: yes(person.is_admin), reviewer: yes(person.is_reviewer), domains: list(person.domains), ranks: rank ? list(rank.value) : [] };
  }
  function canView(user, row, masters) {
    if (user.admin) return true;
    if (!user.reviewer || row.status === '仕分け待ち') return false;
    var assigned = email(row.reviewer_email || row.organizer_email);
    if (!assigned || !user.identities.includes(assigned)) return false;
    var folder = masters.folders.find(function (f) { return f.placement === row.placement_final; });
    if (!folder) return false;
    if (folder.rank && !user.ranks.includes(String(folder.rank))) return false;
    var domains = list(row.domains_final);
    return !user.domains.length || domains.length > 0 && domains.every(function (d) { return user.domains.includes(d); });
  }
  function nonce(user) { var value = Utilities.getUuid() + Utilities.getUuid(); CacheService.getScriptCache().put('review:' + value, user.email, 1800); return value; }
  function verifyNonce(user, value) {
    if (typeof value !== 'string' || value.length > 100 || CacheService.getScriptCache().get('review:' + value) !== user.email) throw new Error('画面の有効期限が切れました。読み込み直してください。');
  }
  return { finance: finance, email: email, list: list, yes: yes, active: active, actor: actor, canView: canView, nonce: nonce, verifyNonce: verifyNonce };
})();

// google.script.runから既存の管理用関数を直接呼んでも、finance@以外は実行できません。
function assertFinanceOperator_() {
  if (ReviewSecurity_.active() !== ReviewSecurity_.finance) throw new Error('この管理用操作はfinance@専用です。');
}

function setupReviewAccess() {
  assertFinanceOperator_();
  return Ledger_.withLock(function () {
    var c = Stage2Drive_.config(), drive = Stage2Drive_.open(c); drive.within(c.LEDGER_SPREADSHEET_ID);
    var ledger = Stage2Ledger_.open(SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID));
    var existing = ledger.rows('masters_people').filter(function (r) { return ReviewSecurity_.email(r.google_email) === ReviewSecurity_.finance; });
    if (existing.length > 1) throw new Error('finance@の対応表が重複しています。');
    if (c.DRY_RUN === 'true') { console.log('finance@をmasters_peopleの管理者へ追加する予定です。既存行は上書きしません。'); return; }
    if (!existing.length) ledger.append('masters_people', { name: '確認管理者', google_email: ReviewSecurity_.finance, is_reviewer: true, is_admin: true });
    var properties = PropertiesService.getScriptProperties();
    if (!properties.getProperty('REVIEW_MASTER_ACCESS')) properties.setProperty('REVIEW_MASTER_ACCESS', 'false');
    console.log('確認画面のマスタを準備しました。既存の役割・メール対応は上書きしていません。');
  });
}


// reviewSetup.js
// 既存テスト3件にも状態を反映します。本番DB・ゴミ箱・ページ本文は変更しません。
function setupReviewNotionStatus() {
  assertFinanceOperator_();
  return Ledger_.withLock(function () {
    var c=Review_.context(), env=NotionTestEnvironment_.open(true,'review-setup');
    var schema=env.schema(env.ids.minutes,'minutes'), statePlan=ReviewPlan_.statusSchema(schema.properties['確認状態']);
    var plannedSchema={properties:Object.assign({},schema.properties,{'確認状態':{type:'select',select:{options:statePlan.options}}})};
    var rows=c.ledger.rows('minutes').filter(function(r){return !!r.notion_page_id;}), seen=new Set();
    // 全件を先に検証し、本番ページや未復元ページが混じっていたら準備を開始しません。
    rows.forEach(function(r){
      var pageKey=NotionTestEnvironment_.normalize(r.notion_page_id);
      if(seen.has(pageKey)) throw new Error('NotionページIDが台帳で重複しています。先に確認してください。');
      seen.add(pageKey); ReviewPlan_.statusProperties(r.status,plannedSchema);
      env.verifyMinutesPage(r.notion_page_id);
    });
    env.prepareReviewStatus();
    rows.forEach(function(r){
      var props=ReviewPlan_.statusProperties(r.status,plannedSchema);
      console.log(r.display_id+'：確認状態を「'+r.status+'」にする予定です。');
      c.ledger.log('Notion確認状態の準備予定',r.meeting_key,JSON.stringify(props));
      if(c.c.DRY_RUN==='true') return;
      // ページ更新は同じ状態への上書きです。途中失敗しても再実行できます。
      env.updateReviewPage(r.notion_page_id,props);
      var steps=r.step_done_json ? JSON.parse(r.step_done_json) : {};
      steps.review=ReviewPlan_.migrateJournal(steps.review);
      if(!steps.review) delete steps.review;
      var display=Review_.source(c,r);
      var snapshot={jsonId:steps.jsonId,hash:steps.hash,summary:display.summary,taskCount:display.taskCount||0};
      if(!display.summary.error && JSON.stringify(snapshot).length<12000) steps.reviewDisplay=snapshot;
      r.step_done_json=JSON.stringify(steps);r.notion_status='反映済み（'+r.status+'）';c.ledger.save(r);
    });
    ReviewCache_.remove('schema:'+NotionTestEnvironment_.normalize(env.ids.minutes));
    console.log(c.c.DRY_RUN==='true'?'予定確認のみです。次はDRY_RUN=falseで同じ関数を実行してください。':'確認状態と既存ページを準備しました。DRY_RUN=trueへ戻してください。');
    return {dryRun:c.c.DRY_RUN==='true',pages:rows.length,added:statePlan.added};
  });
}


// serviceChatwork.js
var ServiceChatwork_=(function(){
  function clean(s){return String(s||'').replace(/\[/g,'［').replace(/\]/g,'］').replace(/https?:\/\/\S+/g,'（URL省略）');}
  function body(row){var time=/[T ]\d{2}:\d{2}/.test(row.event_start)?new Date(Date.parse(row.event_start)+9*3600000).toISOString().slice(0,16).replace('T',' '):row.event_start+'（時刻要確認）';return '【議事録の確認】'+clean(row.minutes_title)+'\n会議日時：'+time+'（日本時間）\nNotion：https://www.notion.so/'+String(row.notion_page_id).replace(/[^a-f0-9]/gi,'')+'\n要確認：'+(row.status==='仕分け待ち'||row.last_error?'あり':'内容をご確認ください');}
  function send(c,text,ledger,target){if(c.prod&&c.DRY_RUN==='false'&&!c.CHATWORK_TOKEN)throw new Error('本番投稿にはCHATWORK_TOKENが必要です。');if(c.DRY_RUN==='true'||!c.prod){console.log('Chatwork通知予定：'+text);ledger.log('Chatwork通知予定',target,text);return {planned:true};}if(c.room!=='451196858')throw new Error('送信先が本番確認ルームではありません。');var response;try{response=UrlFetchApp.fetch('https://api.chatwork.com/v2/rooms/451196858/messages',{method:'post',headers:{'X-ChatWorkToken':c.CHATWORK_TOKEN},payload:{body:text,self_unread:'0'},muteHttpExceptions:true});}catch(e){throw new Error('Chatwork送信結果が不明です。自動再送しません。');}var code=response.getResponseCode();if(code<200||code>=300){var error=new Error('Chatwork HTTP '+code);error.rejected=code>=400&&code<500&&code!==408;throw error;}var data=JSON.parse(response.getContentText());if(!data.message_id)throw new Error('Chatwork応答にメッセージIDがありません。');return data;}
  return {body:body,send:send,clean:clean};
})();


// serviceEnvironment.js
// 本番用とテスト用を値の別名で混在させません。新経路の設定・書込境界です。
var ServiceConfig_=(function(){
  var pinned={drive:'0ALo4SlMVSpXdUk9PVA',system:'1UbflVH7ITQBN6INYyAQyn7fy77CWl4wH',raw:'1jNifZBBUN0QNMWdA_hI2J5YY2PbqtxoB',ledger:'137IuSH4nGulMcsB5-IKqvIXkw8SiQrFBjFNSAeXNt0c',minutes:'4cf02dee-7a11-4319-ace1-e866d6a1a914',tasks:'e321f1cb-3365-4a2c-9844-47f34734a9d7',inbox:'400ca178-7419-80dd-a3e0-ef9e2267a64c',testRoot:'1pKWcGDuRCBf3VG0AfKBaKghE0nD3kYwW',testMinutes:'d9cc47f9-543e-4bcb-8ec8-27bebc0feac5',testTasks:'c908936a-6999-4119-9e9c-df364f5f5d1b'};
  function isNotes(){return (PropertiesService.getScriptProperties().getProperty('GENERATOR_MODE')||'GEMINI_NOTES')==='GEMINI_NOTES';}
  function load(values){var p=values||PropertiesService.getScriptProperties().getProperties(),c=Object.assign({},p);if(!['test','prod'].includes(c.ENV)||!['true','false'].includes(c.DRY_RUN))throw new Error('ENV=test/prodとDRY_RUN=true/falseを明示してください。');
    c.GENERATOR_MODE=c.GENERATOR_MODE||'GEMINI_NOTES';if(c.GENERATOR_MODE!=='GEMINI_NOTES')throw new Error('この経路はGEMINI_NOTES専用です。');
    c.prod=c.ENV==='prod';c.root=c.prod?c.FOLDER_SYSTEM_ID:c.FOLDER_SYSTEM_TEST_ID;c.raw=c.prod?c.FOLDER_INBOX_RAW_ID:c.FOLDER_INBOX_RAW_TEST_ID;
    c.minutes=c.prod?c.NOTION_DB_MINUTES:c.NOTION_DB_MINUTES_TEST;c.tasks=c.prod?c.NOTION_DB_TASKS:c.NOTION_DB_TASKS_TEST;c.room=c.prod?'451196858':null;
    c.INGEST_BATCH=Number(c.INGEST_BATCH||5);if(!Number.isInteger(c.INGEST_BATCH)||c.INGEST_BATCH<1||c.INGEST_BATCH>10)throw new Error('INGEST_BATCHは1〜10です。');
    if(!c.NOTION_TOKEN||!c.LEDGER_SPREADSHEET_ID||!c.root||!c.raw)throw new Error('Notionトークン・台帳・受信/ルートIDが必要です。');
    if(c.NOTION_DB_TLDV_INBOX!==pinned.inbox)throw new Error('確認済みtl;dv受信DBを設定してください。');
    if(c.prod){[['SHARED_DRIVE_ID','drive'],['FOLDER_SYSTEM_ID','system'],['FOLDER_INBOX_RAW_ID','raw'],['LEDGER_SPREADSHEET_ID','ledger'],['NOTION_DB_MINUTES','minutes'],['NOTION_DB_TASKS','tasks']].forEach(function(pair){if(c[pair[0]]!==pinned[pair[1]])throw new Error(pair[0]+'が確認済み本番IDと一致しません。');});
      if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(c.PRODUCTION_START_AT||'')||!Number.isFinite(Date.parse(c.PRODUCTION_START_AT)))throw new Error('PRODUCTION_START_ATに本番で取り込み始める会議日時を明示してください。');
      if(c.CHATWORK_ROOM_ID&&c.CHATWORK_ROOM_ID!==c.room)throw new Error('本番Chatworkルームは451196858です。');
    }else{if(c.minutes!==pinned.testMinutes||c.tasks!==pinned.testTasks||c.LEDGER_SPREADSHEET_ID===pinned.ledger)throw new Error('テスト経路に本番DB・本番台帳を設定できません。');}
    return c;
  }
  function beforeStart(c,m,receivedAt){if(!c.prod)return false;if(m.time_unknown)return String(m.start).slice(0,10)<String(c.PRODUCTION_START_AT).slice(0,10)||!Number.isFinite(Date.parse(receivedAt))||Date.parse(receivedAt)<Date.parse(c.PRODUCTION_START_AT);return Date.parse(m.start)<Date.parse(c.PRODUCTION_START_AT);}
  function key(c,key){return 'NOTES_PIPELINE:'+c.ENV+':'+c.minutes+':'+TranscriptText_.hash(key);}
  return {load:load,isNotes:isNotes,beforeStart:beforeStart,pinned:pinned,key:key};
})();
var ServiceDrive_=(function(){
  var folderMime='application/vnd.google-apps.folder';
  function open(c){
    if(!c.prod)return Stage2Drive_.open(c);
    function get(id){return GoogleApi_.get(id,{supportsAllDrives:true,fields:'id,name,mimeType,parents,driveId,trashed,appProperties'});}
    var root=get(c.root);if(root.name!=='_system'||root.mimeType!==folderMime||root.trashed||root.driveId!==c.SHARED_DRIVE_ID||root.parents.length!==1||root.parents[0]!==c.SHARED_DRIVE_ID)throw new Error('本番_systemの所属が違います。');
    function within(id){if(id===c.SHARED_DRIVE_ID)return {id:id,mimeType:folderMime};var file=get(id),cursor=file,seen={};for(var i=0;i<30;i++){if(cursor.id===ServiceConfig_.pinned.testRoot||cursor.name==='_test'||cursor.trashed||cursor.mimeType==='application/vnd.google-apps.shortcut'||cursor.driveId!==c.SHARED_DRIVE_ID)break;if(cursor.id===c.SHARED_DRIVE_ID||cursor.parents&&cursor.parents.length===1&&cursor.parents[0]===c.SHARED_DRIVE_ID)return file;if(!cursor.parents||cursor.parents.length!==1||seen[cursor.id])break;seen[cursor.id]=true;cursor=get(cursor.parents[0]);}throw new Error('本番共有ドライブ内の許可された対象ではありません。テスト領域へは書き込みません。');}
    function children(parent){within(parent);var out=[],token;do{var args={q:"'"+parent.replace(/'/g,"\\'")+"' in parents and trashed=false",corpora:'drive',driveId:c.SHARED_DRIVE_ID,supportsAllDrives:true,includeItemsFromAllDrives:true,pageSize:100,fields:'nextPageToken,files(id,name,mimeType,parents,appProperties,createdTime,modifiedTime)'};if(token)args.pageToken=token;var r=GoogleApi_.list(args);out=out.concat(r.files||[]);token=r.nextPageToken;}while(token);return out;}
    function write(){if(c.DRY_RUN!=='false')throw new Error('DRY_RUN中は書き込みできません。');}
    function createFile(parent,name,text,mime,kind,key){write();within(parent);return GoogleApi_.create({name:name,mimeType:mime,parents:[parent],appProperties:{minutes_environment:'prod',kind:kind,meeting_key:key||''}},text===null?null:Utilities.newBlob(text,mime==='application/vnd.google-apps.document'?'text/html':mime,name),{supportsAllDrives:true,fields:'id,name,mimeType,parents,appProperties'});}
    function folder(parent,name,create,key){var matches=children(parent).filter(function(f){return key?(f.appProperties||{}).meeting_key===key:f.name===name;});if(matches.length>1||matches.length&&matches[0].mimeType!==folderMime)throw new Error('同名・同一会議のフォルダを一意に特定できません。');if(matches.length)return matches[0];if(!create)throw new Error('必要なフォルダがありません：'+name);return createFile(parent,name,null,folderMime,'meeting',key);}
    function move(id,dest,kind,key){write();var file=within(id);within(dest);if((file.appProperties||{}).meeting_key&&(file.appProperties||{}).meeting_key!==key)throw new Error('別の会議ファイルです。');var args={supportsAllDrives:true,fields:'id,parents'};if(!file.parents.includes(dest)){args.addParents=dest;args.removeParents=file.parents.join(',');}return GoogleApi_.update({appProperties:Object.assign({},file.appProperties||{},{minutes_environment:'prod',meeting_key:key,kind:kind})},id,null,args);}
    within(c.LEDGER_SPREADSHEET_ID);var raw=within(c.raw);if(raw.name!=='00_受信'||raw.parents.length!==1||raw.parents[0]!==root.id)throw new Error('本番受信フォルダの所属が違います。');
    return {root:root,within:within,children:children,folder:folder,createFile:createFile,move:move,readJSON:function(id){within(id);return JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8'));}};
  }
  return {open:open};
})();


// serviceNotion.js
var ServiceNotion_=(function(){
  function open(c){var verified={},last=0;
    function request(method,path,body){var wait=350-(Date.now()-last);if(wait>0)Utilities.sleep(wait);last=Date.now();var args={method:method,headers:{Authorization:'Bearer '+c.NOTION_TOKEN,'Notion-Version':'2025-09-03'},muteHttpExceptions:true};if(body){args.contentType='application/json';args.payload=JSON.stringify(body);}var response;try{response=UrlFetchApp.fetch('https://api.notion.com/v1/'+path,args);}catch(e){throw new Error('Notion通信結果が不明です。作成・追記を自動再送しません。');}var code=response.getResponseCode(),data=JSON.parse(response.getContentText());if(code<200||code>=300){var error=new Error('Notion HTTP '+code+' / '+String(data.code||''));error.httpStatus=code;throw error;}return data;}
    function schema(id){if(![c.minutes,c.tasks,c.NOTION_DB_TLDV_INBOX].includes(id))throw new Error('設定外のDBです。');if(verified[id])return verified[id];var db=request('get','databases/'+id);if(!db.id||db.id.replace(/-/g,'')!==id.replace(/-/g,'')||db.archived||db.in_trash||!db.data_sources||db.data_sources.length!==1)throw new Error('DBのID・状態・データソースを確認してください。');var ds=request('get','data_sources/'+db.data_sources[0].id);if(!ds.parent||ds.parent.database_id.replace(/-/g,'')!==id.replace(/-/g,'')||ds.archived||ds.in_trash)throw new Error('データソースの所属が違います。');return verified[id]={databaseId:db.id,sourceId:ds.id,properties:ds.properties};}
    function belongs(page,id){var s=schema(id);return page&&!page.archived&&!page.in_trash&&page.parent&&(page.parent.data_source_id||'').replace(/-/g,'')===s.sourceId.replace(/-/g,'');}
    function query(id,filter,limit){var s=schema(id),out=[],cursor,seen={};do{var body={page_size:100};if(filter)body.filter=filter;if(cursor)body.start_cursor=cursor;var r=request('post','data_sources/'+s.sourceId+'/query',body);if(!Array.isArray(r.results))throw new Error('一覧応答が不正です。');r.results.forEach(function(p){if(!belongs(p,id))throw new Error('別のDBのページが混在しています。');out.push(p);});cursor=r.has_more?r.next_cursor:null;if(cursor&&seen[cursor])throw new Error('一覧のページ送りが循環しています。');if(cursor)seen[cursor]=true;if(out.length>(limit||5000))throw new Error('一覧が上限を超えました。');}while(cursor);return out;}
    function body(id){var count=0,started=Date.now();function walk(blockId,depth){if(Date.now()-started>45000)throw new Error('本文取得が時間上限を超えました。省略せず次回確認します。');if(depth>8)throw new Error('本文の階層が深すぎます。');var text=[],cursor,seen={};do{if(Date.now()-started>45000)throw new Error('本文取得が時間上限を超えました。');var r=request('get','blocks/'+blockId+'/children?page_size=100'+(cursor?'&start_cursor='+encodeURIComponent(cursor):''));(r.results||[]).forEach(function(b){if(++count>1500)throw new Error('本文が上限を超えました。省略せず停止します。');var value=b[b.type]||{},line=(value.rich_text||[]).map(function(t){return t.plain_text||t.text&&t.text.content||'';}).join('');if(/^heading_/.test(b.type))line='\n## '+line;if(line)text.push(line);if(b.has_children)text.push(walk(b.id,depth+1));});cursor=r.has_more?r.next_cursor:null;if(cursor&&seen[cursor])throw new Error('本文のページ送りが循環しています。');if(cursor)seen[cursor]=true;}while(cursor);return text.join('\n');}return walk(id,0);}
    function propertyText(page,name){var p=(page.properties||{})[name];if(!p)return '';if(p.type!=='rich_text'||!p.has_more&&(p.rich_text||[]).length<25)return text(p);var out=[],cursor,seen={};do{var r=request('get','pages/'+page.id+'/properties/'+encodeURIComponent(p.id)+'?page_size=100'+(cursor?'&start_cursor='+encodeURIComponent(cursor):''));(r.results||[]).forEach(function(item){var rich=item.rich_text;out.push(rich&&(rich.plain_text||rich.text&&rich.text.content)||'');});cursor=r.has_more?r.next_cursor:null;if(cursor&&seen[cursor])throw new Error('本文プロパティのページ送りが循環しています。');if(cursor)seen[cursor]=true;}while(cursor);return out.join('');}
    function page(id,database){var p=request('get','pages/'+id);if(!belongs(p,database))throw new Error('ページの書込先DBが違います。');return p;}
    function write(){if(c.DRY_RUN!=='false')throw new Error('DRY_RUN中のNotion書き込みは禁止です。');}
    function create(payload){write();var s=schema(c.minutes);if(payload.parent.type!=='data_source_id'||payload.parent.data_source_id!==s.sourceId||payload.archived||payload.in_trash)throw new Error('議事録DB以外には作成できません。');return request('post','pages',payload);}
    function append(id,blocks){write();page(id,c.minutes);return request('patch','blocks/'+id+'/children',{children:blocks});}
    function status(id,name,database){write();if(![c.minutes,c.NOTION_DB_TLDV_INBOX].includes(database))throw new Error('状態更新先が不正です。');var s=schema(database),field=database===c.minutes?'確認状態':'取り込み状態',p=s.properties[field];if(!p||p.type!=='select'||!p.select.options.some(function(o){return o.name===name;}))throw new Error(field+'の選択肢が不足しています。');page(id,database);var data={properties:{}};data.properties[field]={select:{name:name}};return request('patch','pages/'+id,data);}
    function setupStatus(){var s=schema(c.minutes),p=s.properties['確認状態'];if(p&&p.type!=='select')throw new Error('確認状態はselect型が必要です。既存項目を変更しません。');var existing=p?p.select.options:[],names=['確認待ち','仕分け待ち','確定','保留','対象外'],missing=names.filter(function(n){return !existing.some(function(o){return o.name===n;});});console.log('確認状態の追加予定：'+JSON.stringify(missing));if(c.DRY_RUN==='true'||!missing.length)return missing;write();var opts=existing.map(function(o){return {id:o.id,name:o.name,color:o.color};}).concat(missing.map(function(n){return {name:n};}));return request('patch','data_sources/'+s.sourceId,{properties:{'確認状態':{type:'select',select:{options:opts}}}});}
    return {schema:schema,query:query,body:body,propertyText:propertyText,page:page,create:create,append:append,status:status,setupStatus:setupStatus};
  }
  function text(p){if(!p)return '';if(['title','rich_text'].includes(p.type))return(p[p.type]||[]).map(function(v){return v.plain_text||v.text&&v.text.content||'';}).join('');if(p.type==='date')return p.date&&p.date.start||'';if(p.type==='url')return p.url||'';if(p.type==='select')return p.select&&p.select.name||'';if(p.type==='number')return String(p.number||'');if(p.type==='people')return(p.people||[]).map(function(u){return u.person&&u.person.email||u.name||'';}).join(',');return '';}
  return {open:open,text:text};
})();


// setup.js
function dumpNotionSchemas() {
  if (typeof assertFinanceOperator_ === 'function') assertFinanceOperator_();
  var c = Config_.assertSafe('notion');
  var keys = ['NOTION_DB_MINUTES_TEST', 'NOTION_DB_TASKS_TEST', 'NOTION_DB_TLDV_INBOX'];
  if (c.TASK_DB_MODE === 'dual') keys.push('NOTION_DB_NONPROJECT_TEST');
  var result = keys.map(function (key) {
    var schema = Notion_.schema(c[key], c);
    var properties = Object.keys(schema.properties).map(function (name) { return { name: name, type: schema.properties[name].type }; });
    // 認証情報・本文・参加者は出力せず、設定照合に必要なスキーマだけを返します。
    var expected = key === 'NOTION_DB_MINUTES_TEST' ? {
      '議事録名': ['title'], '日付': ['date'], '参加者': ['people'], 'MTG URL': ['url'],
      '事業部領域': ['multi_select'], '関連するプロジェクト': ['relation']
    } : key === 'NOTION_DB_TLDV_INBOX' ? { '取り込み状態': ['select'], 'meeting_key': ['rich_text'] } : {
      'プロジェクト/タスク名': ['title'], 'ステータス': ['status', 'select'], '期日': ['date'],
      '担当者': ['people'], '備考': ['rich_text'], '完了条件': ['rich_text'],
      '事業部領域': ['multi_select'], '関連するMTG': ['relation'], '親アイテム': ['relation']
    };
    var differences = Object.keys(expected).filter(function (name) {
      return !schema.properties[name] || !expected[name].includes(schema.properties[name].type);
    }).map(function (name) { return { name: name, expected: expected[name], actual: schema.properties[name] ? schema.properties[name].type : '未設定' }; });
    return { config_key: key, data_source_id: schema.data_source_id || null, properties: properties, differences: differences };
  });
  console.log(JSON.stringify(result));
  return result;
}

function initLedger() {
  if (typeof assertFinanceOperator_ === 'function') assertFinanceOperator_();
  var c = Config_.assertSafe();
  DriveUtil_.verifyTestRoot(c);
  return Ledger_.withLock(function () {
    var book = SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID);
    var plan = Ledger_.plan(book);
    // DRY_RUN中の例外は仕様で認められた dry_run_log への記録だけです。
    Ledger_.dryLog(book, '台帳初期化の計画', 'テスト用台帳', JSON.stringify(plan));
    console.log('台帳初期化の計画を記録しました。業務用シートは変更していません。');
    return { applied: false, plan: plan };
  });
}

function registerFolders() {
  if (typeof assertFinanceOperator_ === 'function') assertFinanceOperator_();
  var c = Config_.assertSafe();
  var root = DriveUtil_.verifyTestRoot(c);
  var internal = DriveUtil_.exact(root.id, '社内', c.SHARED_DRIVE_ID);
  var external = DriveUtil_.exact(root.id, '社外', c.SHARED_DRIVE_ID);
  var rows = [];
  ['事業部全体', 'セールス・マーケ', 'EC', '生産管理', '経理・バックオフィス', 'Salesforce・AI', '経営'].forEach(function (name) {
    var folder = DriveUtil_.exact(internal.id, name, c.SHARED_DRIVE_ID);
    rows.push({ placement: '社内/' + name, drive_folder_id: folder.id, notion_domain: name === '事業部全体' ? '' : name, rank: '' });
  });
  // 顧客は台帳マスタに存在する名前だけに限定し、フォルダは作りません。
  var book = SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID);
  var sheet = book.getSheetByName('masters_clients');
  if (!sheet || !sheet.getLastRow()) throw new Error('顧客マスタが未準備です。テスト用台帳を準備してください。');
  if (JSON.stringify(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]) !== JSON.stringify(Ledger_.headers.masters_clients.split(','))) throw new Error('顧客マスタの見出しを確認してください。');
  var clients = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues() : [];
  clients.forEach(function (r) {
    if (!r[0]) return;
    var f = DriveUtil_.exact(external.id, String(r[0]).replace(/\//g, '・'), c.SHARED_DRIVE_ID);
    rows.push({ placement: '社外/' + r[0], drive_folder_id: f.id, notion_domain: '', rank: '' });
  });
  return Ledger_.withLock(function () {
    Ledger_.dryLog(book, 'フォルダ登録の計画', 'masters_folders', JSON.stringify(rows));
    return { applied: false, rows: rows };
  });
}


// setupTestDatabases.js
var TestDbSetup_ = (function () {
  var version = '2025-09-03';
  var parentId = '400ca178-7419-80e8-bb9a-f157874b6105';
  var definitions = {
    minutes: { databaseId: '4cf02dee-7a11-4319-ace1-e866d6a1a914', name: 'MTG議事録（テスト）', property: 'NOTION_DB_MINUTES_TEST' },
    tasks: { databaseId: 'e321f1cb-3365-4a2c-9844-47f34734a9d7', name: 'プロジェクト・タスク（テスト）', property: 'NOTION_DB_TASKS_TEST' }
  };
  function run() {
    var settings = PropertiesService.getScriptProperties();
    if (settings.getProperty('ENV') !== 'test' || settings.getProperty('SETUP_CREATE_TEST_DB') !== 'true') throw new Error('ENV=test、SETUP_CREATE_TEST_DB=true のときだけ実行できます。');
    var token = String(settings.getProperty('NOTION_TOKEN') || '').trim();
    if (!token) throw new Error('MTG議事録連携（GAS）のNOTION_TOKENを設定してください。');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new Error('初期化が実行中です。後でもう一度実行してください。');
    try { return execute(token); } finally { lock.releaseLock(); }
  }
  function execute(token) {
    var keys = ['minutes', 'tasks'], sources = {}, targets = {}, scalar = {};
    var allowed = new Set(), forbidden = new Set(keys.map(function (k) { return TestDbSchema_.id(definitions[k].databaseId); }));
    function guard(method, path, body) {
      if (method === 'get') return;
      // 初期化専用: 管理ページ直下へのDB作成と、検証済みテストDSへのリレーション追加だけを許可します。
      if (method === 'post' && path === 'databases') {
        if (!body.parent || body.parent.type !== 'page_id' || TestDbSchema_.id(body.parent.page_id) !== TestDbSchema_.id(parentId)) throw new Error('管理用ページ以外には作成できません。');
        var props = (body.initial_data_source || {}).properties || {};
        if (Object.keys(props).some(function (n) { return props[n].type === 'relation'; })) throw new Error('作成時のリレーションは禁止です。');
        return;
      }
      var match = /^data_sources\/([A-Za-z0-9-]+)$/.exec(path);
      if (method !== 'patch' || !match || forbidden.has(TestDbSchema_.id(match[1])) || !allowed.has(TestDbSchema_.id(match[1]))) throw new Error('本番または未検証の対象への書き込みは禁止です。');
      if (!body.properties || Object.keys(body).length !== 1) throw new Error('リレーション以外の更新は禁止です。');
      Object.keys(body.properties).forEach(function (name) {
        var p = body.properties[name], r = p.relation || {};
        if (p.type !== 'relation' || r.database_id || !allowed.has(TestDbSchema_.id(r.data_source_id)) || forbidden.has(TestDbSchema_.id(r.data_source_id))) throw new Error('本番または対象外DBへのリレーションは禁止です。');
      });
    }
    function request(method, path, body) {
      guard(method, path, body);
      var options = { method: method, headers: { Authorization: 'Bearer ' + token, 'Notion-Version': version }, muteHttpExceptions: true };
      if (body) { options.contentType = 'application/json'; options.payload = JSON.stringify(body); }
      // Notionの平均3リクエスト/秒を超えないよう、連続呼び出しを間引きます。
      Utilities.sleep(350);
      var response = UrlFetchApp.fetch('https://api.notion.com/v1/' + path, options), status = response.getResponseCode(), data;
      try { data = JSON.parse(response.getContentText()); } catch (e) { throw new Error('NotionからJSON以外の応答が返りました。HTTP ' + status); }
      if (status < 200 || status >= 300) throw new Error('Notion初期化: HTTP ' + status + ' / ' + String(data.code || '不明'));
      return data;
    }
    function schema(databaseId, testKey) {
      var db = request('get', 'databases/' + encodeURIComponent(databaseId));
      if (TestDbSchema_.id(db.id) !== TestDbSchema_.id(databaseId)) throw new Error('DBのIDが応答と一致しません。');
      if (testKey) {
        var title = (db.title || []).map(function (t) { return t.plain_text || (t.text || {}).content || ''; }).join('');
        if (!db.parent || db.parent.type !== 'page_id' || TestDbSchema_.id(db.parent.page_id) !== TestDbSchema_.id(parentId) || title !== definitions[testKey].name || forbidden.has(TestDbSchema_.id(db.id)) || db.archived || db.in_trash) throw new Error('テストDBの親ページ・名前・状態を確認してください。');
      }
      if (!db.data_sources || db.data_sources.length !== 1) throw new Error('DBのデータソースを1つに特定できません。');
      var ds = request('get', 'data_sources/' + encodeURIComponent(db.data_sources[0].id));
      if (!ds.properties || TestDbSchema_.id(ds.id) !== TestDbSchema_.id(db.data_sources[0].id) || !ds.parent || TestDbSchema_.id(ds.parent.database_id) !== TestDbSchema_.id(db.id)) throw new Error('データソースの所属を確認できません。');
      if (testKey && (forbidden.has(TestDbSchema_.id(ds.id)) || ds.archived || ds.in_trash)) throw new Error('本番または無効なデータソースです。');
      return { databaseId: db.id, sourceId: ds.id, properties: ds.properties };
    }
    // 本番はスキーマのGETだけ。本文・会議データは取得しません。
    keys.forEach(function (k) {
      sources[k] = schema(definitions[k].databaseId);
      forbidden.add(TestDbSchema_.id(sources[k].sourceId));
      scalar[k] = TestDbSchema_.scalarProperties(sources[k].properties);
      scalar[k].skipped.forEach(function (s) { console.log('スキップ: ' + definitions[k].name + ' / ' + s.name + ' / ' + s.type + ' / ' + s.reason); });
    });
    var relationPlan = TestDbSchema_.relations(sources);
    relationPlan.skipped.forEach(function (s) { console.log('スキップ: ' + s.database + ' / ' + s.name + ' / ' + s.reason); });
    var children = [], cursor;
    do {
      var page = request('get', 'blocks/' + parentId + '/children?page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''));
      children = children.concat(page.results || []); cursor = page.has_more ? page.next_cursor : null;
    } while (cursor);
    // 既存の同名DBをすべて確認してから、新しいDBを作成します。
    keys.forEach(function (k) {
      var matches = children.filter(function (b) { return b.type === 'child_database' && b.child_database.title === definitions[k].name && !b.archived && !b.in_trash; });
      if (matches.length > 1) throw new Error('管理ページに同名DBが複数あります: ' + definitions[k].name);
      if (matches.length === 1) {
        targets[k] = schema(matches[0].id, k);
        TestDbSchema_.assertCompatible(targets[k].properties, scalar[k].properties);
        console.log('既存DBを使用: ' + definitions[k].name + ' / ' + targets[k].databaseId);
      }
    });
    keys.forEach(function (k) {
      if (!targets[k]) {
        var created = request('post', 'databases', { parent: { type: 'page_id', page_id: parentId },
          title: [{ type: 'text', text: { content: definitions[k].name } }], initial_data_source: { properties: scalar[k].properties } });
        console.log('作成したDB: ' + definitions[k].name + ' / ' + created.id);
        targets[k] = schema(created.id, k);
        TestDbSchema_.assertCompatible(targets[k].properties, scalar[k].properties);
      }
      allowed.add(TestDbSchema_.id(targets[k].sourceId));
    });
    function matchesRelation(property, target, reverseName) {
      return property && property.type === 'relation' && TestDbSchema_.id((property.relation || {}).data_source_id) === TestDbSchema_.id(target.sourceId) &&
        (!reverseName || property.relation.type === 'dual_property' && (property.relation.dual_property || {}).synced_property_name === reverseName);
    }
    function checkEdge(edge) {
      var from = targets[edge.from].properties[edge.name], reverse = edge.reverseName ? targets[edge.to].properties[edge.reverseName] : null;
      if (from && !matchesRelation(from, targets[edge.to], edge.reverseName)) throw new Error('既存リレーションが異なります。上書きしません: ' + edge.name);
      if (edge.reverseName && reverse && !matchesRelation(reverse, targets[edge.from], edge.name)) throw new Error('既存の相手リレーションが異なります: ' + edge.reverseName);
      if (edge.reverseName && Boolean(from) !== Boolean(reverse)) throw new Error('双方向リレーションの片側だけが存在します。上書きしません: ' + edge.name);
      return !!from;
    }
    relationPlan.edges.forEach(checkEdge);
    relationPlan.edges.forEach(function (edge) {
      if (checkEdge(edge)) return;
      var properties = Object.create(null);
      properties[edge.name] = TestDbSchema_.relationProperty(edge, targets);
      request('patch', 'data_sources/' + targets[edge.from].sourceId, { properties: properties });
      // 相手側に自動生成された項目も読み直し、再実行時の重複を防ぎます。
      targets[edge.from] = schema(targets[edge.from].databaseId, edge.from);
      if (edge.from !== edge.to) targets[edge.to] = schema(targets[edge.to].databaseId, edge.to);
      if (!checkEdge(edge)) throw new Error('作成後のリレーションを確認できません: ' + edge.name);
    });
    var result = {};
    keys.forEach(function (k) {
      result[definitions[k].property] = targets[k].databaseId;
      console.log(definitions[k].property + ' = ' + targets[k].databaseId);
    });
    console.log('上のIDをGASのスクリプトプロパティに設定してください。SETUP_CREATE_TEST_DBはfalseに戻してください。');
    return result;
  }
  return { run: run };
})();

function setupTestDatabases() {
  if (typeof assertFinanceOperator_ === 'function') assertFinanceOperator_(); return TestDbSetup_.run(); }


// stage2Content.js
var Stage2Content_ = (function () {
  function clean(value) { return String(value || '').replace(/https?:\/\/[^\s<>]+/gi, '（URL省略）'); }
  function rich(value) {
    var chars = Array.from(clean(value)), result = [];
    for (var i = 0; i < chars.length; i += 1000) result.push({ type: 'text', text: { content: chars.slice(i, i + 1000).join('') } });
    if (result.length > 100) throw new Error('本文の1段落が長すぎます。');
    return result;
  }
  function blocks(elements) {
    var result = [];
    elements.forEach(function (e) {
      if (e.type === 'table') {
        if (!e.rows.length) return;
        var width = e.rows[0].length;
        if (!width || e.rows.some(function (r) { return r.length !== width; })) throw new Error('表の列数が不正です。');
        for (var i = 0; i < e.rows.length; i += 100) result.push({ object: 'block', type: 'table', table: {
          table_width: width, has_column_header: true, has_row_header: false,
          children: e.rows.slice(i, i + 100).map(function (r) { return { object: 'block', type: 'table_row', table_row: { cells: r.map(rich) } }; })
        } });
      } else {
        var type = ['heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item'].includes(e.type) ? e.type : 'paragraph';
        if (!e.text) return;
        var b = { object: 'block', type: type }; b[type] = { rich_text: rich(e.text) }; result.push(b);
      }
    });
    for (var offset = 0; offset < result.length; offset += 100) {
      if (JSON.stringify(result.slice(offset, offset + 100)).length * 3 > 450000) throw new Error('本文がNotionのリクエスト上限に近いため処理を止めました。');
    }
    return result;
  }
  function read(id) {
    var body = DocumentApp.openById(id).getBody(), elements = [];
    for (var i = 0; i < body.getNumChildren(); i++) {
      var child = body.getChild(i), type = String(child.getType());
      if (type === 'TABLE') {
        var table = child.asTable(), rows = [];
        for (var r = 0; r < table.getNumRows(); r++) {
          var row = table.getRow(r), cells = [];
          for (var c = 0; c < row.getNumCells(); c++) cells.push(row.getCell(c).getText());
          rows.push(cells);
        }
        elements.push({ type: 'table', rows: rows });
      } else if (type === 'PARAGRAPH') {
        var paragraph = child.asParagraph(), heading = String(paragraph.getHeading());
        elements.push({ type: heading === 'HEADING2' || heading === 'HEADING1' ? 'heading_2' : heading === 'HEADING3' ? 'heading_3' : 'paragraph', text: paragraph.getText() });
      } else if (type === 'LIST_ITEM') {
        var item = child.asListItem(); elements.push({ type: /NUMBER|LATIN|ROMAN/.test(String(item.getGlyphType())) ? 'numbered_list_item' : 'bulleted_list_item', text: item.getText() });
      } else throw new Error('未対応の議事録要素があります: ' + type);
    }
    return blocks(elements);
  }
  function inline(value) {
    return clean(String(value||'').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
  }
  function cells(line) {
    var result=[],cell='',escaped=false;
    Array.from(line.trim()).forEach(function(c){
      if(escaped){cell+=(c==='|'||c==='\\')?c:'\\'+c;escaped=false;}
      else if(c==='\\')escaped=true;
      else if(c==='|'){result.push(cell.trim());cell='';}
      else cell+=c;
    });
    if(escaped)cell+='\\';result.push(cell.trim());
    if(line.trim().startsWith('|'))result.shift();
    if(result.length&&result[result.length-1]===''&&line.trim().endsWith('|'))result.pop();
    return result;
  }
  function markdown(text) {
    var lines=String(text||'').replace(/\r\n?/g,'\n').split('\n'),out=[],fenced=false;
    for(var i=0;i<lines.length;i++){
      var line=lines[i].trim(),match;
      if(/^```/.test(line)){fenced=!fenced;continue;}
      if(!line)continue;
      if(fenced){out.push({type:'paragraph',text:line});continue;}
      if(line.includes('|')&&i+1<lines.length){
        var divider=cells(lines[i+1]);
        if(divider.length&&divider.every(function(v){return /^:?-{3,}:?$/.test(v);})){
          var header=cells(line),rows=[header];if(header.length!==divider.length)throw new Error('Markdown表の列数が一致しません。');i+=2;
          for(;i<lines.length&&lines[i].trim()&&lines[i].includes('|');i++){var row=cells(lines[i]);if(row.length!==header.length)throw new Error('Markdown表の列数が一致しません。セル内の縦棒は\\|で記載してください。');rows.push(row);}i--;
          out.push({type:'table',rows:rows.map(function(r){return r.map(inline);})});continue;
        }
      }
      if((match=/^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)))out.push({type:match[1].length<=2?'heading_2':'heading_3',text:inline(match[2])});
      else if((match=/^[-*+]\s+(.+)$/.exec(line)))out.push({type:'bulleted_list_item',text:inline(match[1])});
      else if((match=/^\d+[.)]\s+(.+)$/.exec(line)))out.push({type:'numbered_list_item',text:inline(match[1])});
      else out.push({type:'paragraph',text:inline(line)});
    }
    if(fenced)throw new Error('Markdownのコード囲みが閉じていません。');
    return out;
  }
  function html(text) {
    function escape(v){return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
    var parts=['<!doctype html><html><head><meta charset="UTF-8"></head><body>'],list=null;
    markdown(text).forEach(function(e){
      var tag=e.type==='bulleted_list_item'?'ul':e.type==='numbered_list_item'?'ol':null;
      if(list!==tag){if(list)parts.push('</'+list+'>');if(tag)parts.push('<'+tag+'>');list=tag;}
      if(tag)parts.push('<li>'+escape(e.text)+'</li>');
      else if(e.type==='table'){
        parts.push('<table border="1"><thead><tr>'+e.rows[0].map(function(v){return '<th>'+escape(v)+'</th>';}).join('')+'</tr></thead><tbody>');
        e.rows.slice(1).forEach(function(row){parts.push('<tr>'+row.map(function(v){return '<td>'+escape(v)+'</td>';}).join('')+'</tr>');});parts.push('</tbody></table>');
      }else{var heading=e.type==='heading_2'?'h2':e.type==='heading_3'?'h3':'p';parts.push('<'+heading+'>'+escape(e.text)+'</'+heading+'>');}
    });
    if(list)parts.push('</'+list+'>');return parts.join('')+'</body></html>';
  }
  return { blocks: blocks, read: read, html: html, markdown: markdown };
})();

function seedFixtureInbox() {
  if (typeof assertFinanceOperator_ === 'function') assertFinanceOperator_();
  return Ledger_.withLock(function () {
    var c = Stage2Drive_.config(), drive = Stage2Drive_.open(c);
    drive.within(c.LEDGER_SPREADSHEET_ID);
    var ledger = Stage2Ledger_.open(SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID));
    if (c.DRY_RUN === 'true') { ledger.log('サンプル準備予定', 'inbox', '判定JSON・manifest・議事録Doc・ダミー文字起こしを3件準備します。'); return; }
    var raw = drive.folder(drive.root.id, '00_受信', false), inbox = drive.folder(drive.root.id, 'inbox', false), done = drive.folder(inbox.id, '_done', false);
    function ensure(parent, name, text, mime, kind, key) {
      var matches = drive.children(parent).filter(function (f) { return f.name === name; });
      if (matches.length > 1) throw new Error('同名サンプルが複数あります: ' + name);
      if (matches.length && (matches[0].appProperties || {}).meeting_key !== key) throw new Error('既存ファイルは上書きしません: ' + name);
      return matches[0] || drive.createFile(parent, name, text, mime, kind, key);
    }
    NotionFixtures_.judgements.forEach(function (original) {
      var j = JSON.parse(JSON.stringify(original)), key = j.meeting_key, folderKey = key.replace(/:/g, '_');
      if (ledger.rows('minutes').some(function (r) { return r.meeting_key === key; }) || drive.children(done.id).some(function (f) { return f.name === folderKey + '.json'; })) { console.log('準備済み・処理済みのサンプルは再投入しません: ' + key); return; }
      var folder = drive.folder(raw.id, folderKey, true), manifest = JSON.parse(JSON.stringify(NotionFixtures_.manifests.find(function (m) { return m.meeting_key === key; })));
      var text = '基本情報\n' + manifest.title + '\n決定事項\n' + j.summary.decisions.join('\n') + '\nネクストアクション\n' + j.summary.next_actions.map(function (a) { return a.who + '／' + a.what + '／' + (a.due || '期日：要確認'); }).join('\n');
      var minutes = ensure(inbox.id, folderKey + '_議事録', Stage2Content_.html(text), 'application/vnd.google-apps.document', 'minutes', key);
      var kind = manifest.source === 'tldv' ? 'tldv_transcript' : 'transcript';
      var transcript = ensure(folder.id, '文字起こし（検証用ダミー）', Stage2Content_.html('これは検証専用のダミー文字起こしです。\n' + text), 'application/vnd.google-apps.document', kind, key);
      manifest.files = {}; manifest.files[kind] = transcript.id; manifest.missing = manifest.source === 'meet' ? ['recording', 'gemini'] : [];
      ensure(folder.id, 'manifest.json', JSON.stringify(manifest), 'application/json', 'manifest', key);
      j.minutes_doc_id = minutes.id;
      ensure(inbox.id, folderKey + '.json', JSON.stringify(j), 'application/json', 'judgement', key);
      console.log('サンプルを準備しました: ' + key);
    });
  });
}


// stage2Drive.js
var Stage2Drive_ = (function () {
  var folderMime = 'application/vnd.google-apps.folder';
  function config() {
    var c = PropertiesService.getScriptProperties().getProperties();
    if (c.ENV !== 'test' || !['true', 'false'].includes(c.DRY_RUN)) throw new Error('ENV=testと明示的なDRY_RUNが必要です。');
    c.INGEST_BATCH = Number(c.INGEST_BATCH || 5);
    if (!Number.isInteger(c.INGEST_BATCH) || c.INGEST_BATCH < 1 || c.INGEST_BATCH > 10) throw new Error('INGEST_BATCHは1〜10です。');
    return c;
  }
  function escape(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
  function meta(id) { return GoogleApi_.get(id, { supportsAllDrives: true, fields: 'id,name,mimeType,parents,driveId,trashed,ownedByMe,appProperties,createdTime,modifiedTime,capabilities(canEdit,canAddChildren)' }); }
  function list(parent, c, query) {
    var all = [], token;
    do {
      var args = { q: "'" + escape(parent) + "' in parents and trashed=false" + (query ? ' and ' + query : ''), supportsAllDrives: true, includeItemsFromAllDrives: true, fields: 'nextPageToken,files(id,name,mimeType,parents,createdTime,modifiedTime,appProperties)', pageSize: 100 };
      if (c.SHARED_DRIVE_ID) { args.corpora = 'drive'; args.driveId = c.SHARED_DRIVE_ID; }
      else args.corpora = 'user';
      if (token) args.pageToken = token;
      var page = GoogleApi_.list(args); all = all.concat(page.files || []); token = page.nextPageToken;
    } while (token);
    return all;
  }
  function open(c) {
    if (c.ENV !== 'test' || !c.TEST_ENV_KEY || !c.FOLDER_SYSTEM_TEST_ID) throw new Error('共有ドライブはsetupSharedTestWorkspace、マイドライブはsetupTestWorkspaceで準備してください。');
    var metadata = {};
    function readMeta(id) { return metadata[id] || (metadata[id] = meta(id)); }
    var root = readMeta(c.FOLDER_SYSTEM_TEST_ID);
    function marker(m, kind) { return m.appProperties && m.appProperties.minutes_test_env === c.TEST_ENV_KEY && (!kind || m.appProperties.kind === kind); }
    if (root.trashed || root.mimeType !== folderMime || root.name !== '_test' || !marker(root, 'test_root')) throw new Error('初期化済みテストルートではありません。');
    if (c.SHARED_DRIVE_ID ? root.driveId !== c.SHARED_DRIVE_ID : root.driveId || !root.ownedByMe) throw new Error('テストDriveの所属が違います。');
    var system = root.parents && root.parents.length === 1 && readMeta(root.parents[0]);
    if (!system || system.name !== '_system' || system.trashed || system.mimeType && system.mimeType !== folderMime) throw new Error('_system/_testではありません。');
    if (c.SHARED_DRIVE_ID) {
      // _systemは本番領域でもあるため目印を要求・追加せず、所属だけを検証します。
      if (system.driveId !== c.SHARED_DRIVE_ID || !system.parents || system.parents.length !== 1 || system.parents[0] !== c.SHARED_DRIVE_ID || c.FOLDER_SYSTEM_ID && system.id !== c.FOLDER_SYSTEM_ID) throw new Error('_systemが指定共有ドライブ直下にありません。');
    } else if (!marker(system, 'system')) throw new Error('マイドライブの_systemマーカーが不正です。');
    function within(id) {
      var file = readMeta(id), cursor = file, visited = new Set();
      for (var depth = 0; depth < 30; depth++) {
        if (cursor.trashed || cursor.mimeType === 'application/vnd.google-apps.shortcut') throw new Error('削除済みファイル・ショートカットは処理できません。');
        if (c.SHARED_DRIVE_ID && cursor.driveId !== c.SHARED_DRIVE_ID) throw new Error('指定共有ドライブ外のファイルです。');
        if (cursor.id === root.id) return file;
        if (!cursor.parents || cursor.parents.length !== 1 || visited.has(cursor.id)) break;
        visited.add(cursor.id); cursor = cursor.parents[0] === root.id ? root : readMeta(cursor.parents[0]);
      }
      throw new Error('テストルート外のファイル操作は禁止です。');
    }
    function write() { if (c.DRY_RUN !== 'false') throw new Error('DRY_RUN中のDrive書き込みは禁止です。'); }
    function children(id) { within(id); return list(id, c); }
    function folder(parent, name, create, meetingKey) {
      within(parent);
      var matches = children(parent).filter(function (m) { return m.mimeType === folderMime && (meetingKey ? (m.appProperties || {}).meeting_key === meetingKey : m.name === name); });
      if (matches.length > 1) throw new Error('同名・同キーのフォルダが複数あります: ' + name);
      if (matches.length) return matches[0];
      if (!create) throw new Error('フォルダがありません: ' + name);
      write(); var app = { minutes_test_env: c.TEST_ENV_KEY }; if (meetingKey) app.meeting_key = meetingKey;
      return GoogleApi_.create({ name: name, mimeType: folderMime, parents: [parent], appProperties: app }, null, { supportsAllDrives: true, fields: 'id,name,mimeType,parents,appProperties' });
    }
    function move(id, destination, kind, meetingKey) {
      write(); var m = within(id); within(destination);
      var app = Object.assign({}, m.appProperties || {});
      if (app.meeting_key && meetingKey && app.meeting_key !== meetingKey) throw new Error('別会議に属するファイルです。');
      if (kind) app.kind = kind; if (meetingKey) app.meeting_key = meetingKey;
      var args = { supportsAllDrives: true, fields: 'id,name,parents' };
      if (!(m.parents || []).includes(destination)) { args.addParents = destination; args.removeParents = (m.parents || []).join(','); }
      var result=GoogleApi_.update({ appProperties: app }, id, null, args); delete metadata[id]; return result;
    }
    function createFile(parent, name, content, mime, kind, meetingKey) {
      write(); within(parent);
      var app = { minutes_test_env: c.TEST_ENV_KEY, kind: kind }; if (meetingKey) app.meeting_key = meetingKey;
      var body = { name: name, mimeType: mime, parents: [parent], appProperties: app };
      var inputMime = mime === 'application/vnd.google-apps.document' ? 'text/html' : mime;
      return GoogleApi_.create(body, Utilities.newBlob(content, inputMime, name), { supportsAllDrives: true, fields: 'id,name,mimeType,parents,appProperties' });
    }
    function readJSON(id) {
      var m = within(id); if (m.mimeType !== 'application/json' && !m.name.endsWith('.json')) throw new Error('JSONファイルではありません。');
      return JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8'));
    }
    return { root: root, within: within, children: children, folder: folder, move: move, createFile: createFile, readJSON: readJSON };
  }
  function populate(c, drive, book) {
    var root = drive.root;
    var raw = drive.folder(root.id, '00_受信', true), inbox = drive.folder(root.id, 'inbox', true);
    drive.folder(inbox.id, '_done', true); drive.folder(root.id, 'ref', true); drive.folder(root.id, '00_仕分け待ち', true);
    var excluded = drive.folder(root.id, '99_対象外', true); drive.folder(excluded.id, '_空', true);
    var internal = drive.folder(root.id, '社内', true), external = drive.folder(root.id, '社外', true), folderRows = [];
    NotionFixtures_.masters.folders.forEach(function (r) { var name = r.placement.slice(3), f = drive.folder(internal.id, name, true); folderRows.push(Object.assign({}, r, { drive_folder_id: f.id })); });
    var clientRows = NotionFixtures_.masters.clients.map(function (r) { return Object.assign({}, r, { drive_folder_id: drive.folder(external.id, r.client_name.replace(/\//g, '・'), true).id }); });
    Stage2Ledger_.initialize(book); var ledger = Stage2Ledger_.open(book);
    ledger.rows('masters_folders').concat(ledger.rows('masters_clients')).forEach(function (r) { if (r.drive_folder_id) drive.within(r.drive_folder_id); });
    function seed(sheet, field, rows) { var known = new Set(ledger.rows(sheet).map(function (r) { return String(r[field]); })); rows.forEach(function (r) { if (!known.has(String(r[field]))) { ledger.append(sheet, r); known.add(String(r[field])); } }); }
    seed('masters_folders', 'placement', folderRows.concat(clientRows.map(function (r) { return { placement: '社外/' + r.client_name, drive_folder_id: r.drive_folder_id }; })));
    seed('masters_clients', 'client_name', clientRows.map(function (r) { return Object.assign({}, r, { domains: JSON.stringify(r.domains) }); }));
    seed('masters_internal', 'email_or_domain', NotionFixtures_.masters.internal.map(function (v) { return { email_or_domain: v }; }));
    seed('masters_people', 'google_email', NotionFixtures_.masters.people);
    return { raw: raw.id, inbox: inbox.id };
  }
  function setup() {
    var c = config(), properties = PropertiesService.getScriptProperties();
    if (c.SHARED_DRIVE_ID) throw new Error('この準備関数はマイドライブ専用です。SHARED_DRIVE_IDを空にしてください。');
    if (c.DRY_RUN === 'true') { console.log('準備予定：マイドライブに開発専用フォルダ/_system/_test、受信・inbox・格納先・テスト台帳を作成します。'); return; }
    if (!c.TEST_ENV_KEY) { c.TEST_ENV_KEY = Utilities.getUuid(); properties.setProperty('TEST_ENV_KEY', c.TEST_ENV_KEY); }
    function ensure(parent, name, kind) {
      var matches = list(parent, c, "mimeType='" + folderMime + "'").filter(function (f) { return (f.appProperties || {}).minutes_test_env === c.TEST_ENV_KEY && (f.appProperties || {}).kind === kind; });
      if (matches.length > 1) throw new Error('テスト準備の同一マーカーが複数あります。');
      return matches[0] || GoogleApi_.create({ name: name, mimeType: folderMime, parents: [parent], appProperties: { minutes_test_env: c.TEST_ENV_KEY, kind: kind } }, null, { supportsAllDrives: true, fields: 'id,name,parents' });
    }
    var top = ensure('root', 'MTG議事録自動化（開発専用）', 'top'), system = ensure(top.id, '_system', 'system'), root = ensure(system.id, '_test', 'test_root');
    if (c.FOLDER_SYSTEM_TEST_ID && c.FOLDER_SYSTEM_TEST_ID !== root.id) throw new Error('既存のFOLDER_SYSTEM_TEST_IDは上書きしません。');
    c.FOLDER_SYSTEM_TEST_ID = root.id; properties.setProperty('FOLDER_SYSTEM_TEST_ID', root.id);
    var drive = open(c);
    var book;
    if (c.LEDGER_SPREADSHEET_ID) { drive.within(c.LEDGER_SPREADSHEET_ID); book = SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID); }
    else {
      var existing = drive.children(root.id).filter(function (f) { return f.mimeType === 'application/vnd.google-apps.spreadsheet' && f.name === 'MTG議事録 台帳（テスト）'; });
      if (existing.length > 1) throw new Error('テスト台帳が複数あります。');
      var file = existing[0] || GoogleApi_.create({ name: 'MTG議事録 台帳（テスト）', mimeType: 'application/vnd.google-apps.spreadsheet', parents: [root.id], appProperties: { minutes_test_env: c.TEST_ENV_KEY } }, null, { supportsAllDrives: true, fields: 'id' });
      c.LEDGER_SPREADSHEET_ID = file.id; properties.setProperty('LEDGER_SPREADSHEET_ID', file.id); book = SpreadsheetApp.openById(file.id);
    }
    var workspace = populate(c, drive, book);
    console.log('テスト環境を準備しました。FOLDER_SYSTEM_TEST_ID=' + root.id + ' / LEDGER_SPREADSHEET_ID=' + c.LEDGER_SPREADSHEET_ID + '。プロパティに自動登録済みです。');
    return { root: root.id, ledger: c.LEDGER_SPREADSHEET_ID, raw: workspace.raw, inbox: workspace.inbox };
  }
  function setupShared(sharedDriveId, testRootId, testLedgerId) {
    var c = config(), properties = PropertiesService.getScriptProperties();
    if (sharedDriveId || testRootId || testLedgerId) {
      if (![sharedDriveId, testRootId, testLedgerId].every(function (v) { return typeof v === 'string' && v; })) throw new Error('共有ドライブ・テストルート・テスト台帳の3つのIDが必要です。');
      c.SHARED_DRIVE_ID = sharedDriveId; c.FOLDER_SYSTEM_TEST_ID = testRootId; c.LEDGER_SPREADSHEET_ID = testLedgerId;
    }
    if (!c.SHARED_DRIVE_ID || !c.FOLDER_SYSTEM_TEST_ID || !c.LEDGER_SPREADSHEET_ID) throw new Error('SHARED_DRIVE_ID、FOLDER_SYSTEM_TEST_ID、LEDGER_SPREADSHEET_IDが必要です。');
    if (c.LEDGER_SPREADSHEET_ID === '137IuSH4nGulMcsB5-IKqvIXkw8SiQrFBjFNSAeXNt0c') throw new Error('本番台帳は初期化できません。');
    var root = meta(c.FOLDER_SYSTEM_TEST_ID);
    if (root.name !== '_test' || root.mimeType !== folderMime || root.trashed || root.driveId !== c.SHARED_DRIVE_ID || !root.parents || root.parents.length !== 1) throw new Error('共有ドライブの_testフォルダではありません。');
    var system = meta(root.parents[0]);
    if (system.name !== '_system' || system.mimeType !== folderMime || system.trashed || system.driveId !== c.SHARED_DRIVE_ID || !system.parents || system.parents.length !== 1 || system.parents[0] !== c.SHARED_DRIVE_ID || c.FOLDER_SYSTEM_ID && c.FOLDER_SYSTEM_ID !== system.id) throw new Error('_systemが指定共有ドライブ直下にありません。');
    var app = root.appProperties || {};
    if (app.kind && app.kind !== 'test_root' || app.minutes_test_env && c.TEST_ENV_KEY && app.minutes_test_env !== c.TEST_ENV_KEY) throw new Error('既存のテストマーカーと設定が違います。上書きしません。');
    if ((root.capabilities || {}).canEdit === false || (root.capabilities || {}).canAddChildren === false) throw new Error('テストフォルダの編集・作成権限がありません。');
    function contained(id) {
      var file = meta(id), cursor = file, visited = new Set();
      for (var i = 0; i < 30; i++) {
        if (cursor.trashed || cursor.mimeType === 'application/vnd.google-apps.shortcut' || cursor.driveId !== c.SHARED_DRIVE_ID) break;
        if (cursor.id === root.id) return file;
        if (!cursor.parents || cursor.parents.length !== 1 || visited.has(cursor.id)) break;
        visited.add(cursor.id); cursor = cursor.parents[0] === root.id ? root : meta(cursor.parents[0]);
      }
      throw new Error('対象が_test配下にありません。移動・初期化は行いません。');
    }
    var ledgerFile = contained(c.LEDGER_SPREADSHEET_ID);
    if (ledgerFile.mimeType !== 'application/vnd.google-apps.spreadsheet' || (ledgerFile.capabilities || {}).canEdit === false) throw new Error('編集可能なテスト台帳が必要です。');
    var book = SpreadsheetApp.openById(ledgerFile.id), ledgerPlan = Ledger_.plan(book);
    [['masters_folders', 2], ['masters_clients', 3]].forEach(function (entry) {
      var sheet = book.getSheetByName(entry[0]);
      if (sheet && sheet.getLastRow() > 1) sheet.getRange(2, entry[1], sheet.getLastRow() - 1, 1).getValues().forEach(function (r) { if (r[0]) contained(String(r[0])); });
    });
    var cache = {}, missing = [];
    function inspectPath(path) {
      var parentId = root.id, pathName = '';
      path.forEach(function (name) {
        pathName += (pathName ? '/' : '') + name;
        if (!parentId) { if (!missing.includes(pathName)) missing.push(pathName); return; }
        if (!cache[parentId]) cache[parentId] = list(parentId, c);
        var matches = cache[parentId].filter(function (f) { return f.name === name; });
        if (matches.length > 1 || matches.length && matches[0].mimeType !== folderMime) throw new Error('同名フォルダが複数、または同名の非フォルダがあります: ' + pathName);
        if (!matches.length) { if (!missing.includes(pathName)) missing.push(pathName); parentId = null; }
        else parentId = matches[0].id;
      });
    }
    ['社内', '社外', '00_仕分け待ち', '99_対象外', '00_受信', 'inbox', 'ref'].forEach(function (name) { inspectPath([name]); });
    inspectPath(['inbox', '_done']); inspectPath(['99_対象外', '_空']);
    NotionFixtures_.masters.folders.forEach(function (r) { inspectPath(['社内', r.placement.slice(3)]); });
    NotionFixtures_.masters.clients.forEach(function (r) { inspectPath(['社外', r.client_name.replace(/\//g, '・')]); });
    if (c.FOLDER_INBOX_RAW_TEST_ID) {
      var raw = contained(c.FOLDER_INBOX_RAW_TEST_ID);
      if (raw.name !== '00_受信' || raw.mimeType !== folderMime || raw.parents.length !== 1 || raw.parents[0] !== root.id) throw new Error('FOLDER_INBOX_RAW_TEST_IDが_test直下の00_受信ではありません。');
    }
    c.TEST_ENV_KEY = c.TEST_ENV_KEY || app.minutes_test_env;
    console.log('共有ドライブの所属・テスト台帳の配置・見出しを確認しました。_systemは読み取りのみです。');
    console.log('不足フォルダ: ' + JSON.stringify(missing) + ' / 台帳初期化予定: ' + JSON.stringify(ledgerPlan.filter(function (p) { return p.action !== '変更なし'; }).map(function (p) { return { sheet: p.sheet, action: p.action }; })));
    if (c.DRY_RUN === 'true') { console.log('準備予定：_testだけに目印を付け、不足フォルダ・台帳シート・サンプルマスタを追加します。設定やDriveには書き込みません。'); return { dryRun: true, root: root.id, ledger: ledgerFile.id }; }
    c.TEST_ENV_KEY = c.TEST_ENV_KEY || Utilities.getUuid();
    // ここからのDrive書き込み先は_test自身とその子だけです。
    if (app.minutes_test_env !== c.TEST_ENV_KEY || app.kind !== 'test_root') GoogleApi_.update({ appProperties: Object.assign({}, app, { minutes_test_env: c.TEST_ENV_KEY, kind: 'test_root' }) }, root.id, null, { supportsAllDrives: true, fields: 'id' });
    ['SHARED_DRIVE_ID', 'FOLDER_SYSTEM_TEST_ID', 'LEDGER_SPREADSHEET_ID', 'TEST_ENV_KEY'].forEach(function (k) { properties.setProperty(k, c[k]); });
    properties.setProperty('FOLDER_SYSTEM_ID', system.id); c.FOLDER_SYSTEM_ID = system.id;
    var drive = open(c), workspace = populate(c, drive, book);
    properties.setProperty('FOLDER_INBOX_RAW_TEST_ID', workspace.raw);
    console.log('共有ドライブのテスト領域を準備しました。既存フォルダの移動・改名・削除は行っていません。');
    return { root: root.id, ledger: ledgerFile.id, raw: workspace.raw, inbox: workspace.inbox };
  }
  return { config: config, open: open, setup: setup, setupShared: setupShared };
})();

function setupTestWorkspace() {
  if (typeof assertFinanceOperator_ === 'function') assertFinanceOperator_(); return Ledger_.withLock(Stage2Drive_.setup); }

function setupSharedTestWorkspace(sharedDriveId, testRootId, testLedgerId) {
  if (typeof assertFinanceOperator_ === 'function') assertFinanceOperator_();
  return Ledger_.withLock(function () { return Stage2Drive_.setupShared(sharedDriveId, testRootId, testLedgerId); });
}


// stage2Ledger.js
var Stage2Ledger_ = (function () {
  function text(value) { var s = String(value === undefined || value === null ? '' : value); return /^[=+@]/.test(s) ? "'" + s : s; }
  function initialize(book) {
    var plan = Ledger_.plan(book); // 全シートの見出しを先に確認し、既存データは上書きしません。
    plan.forEach(function (p) {
      var sheet = book.getSheetByName(p.sheet) || book.insertSheet(p.sheet);
      if (!sheet.getLastRow()) sheet.appendRow(p.headers);
    });
  }
  function open(book, fast) {
    var snapshots = {};
    if (!fast) Ledger_.plan(book).forEach(function (p) { if (p.action !== '変更なし') throw new Error('台帳が未初期化です。setupTestWorkspaceを実行してください。'); });
    function rows(name) {
      if (fast && snapshots[name]) return snapshots[name];
      var sheet = book.getSheetByName(name), headers = Ledger_.headers[name].split(',');
      if (!sheet || !sheet.getLastRow()) throw new Error('台帳が未初期化です: ' + name);
      if (fast) {
        var values=sheet.getRange(1,1,sheet.getLastRow(),Math.max(headers.length,sheet.getLastColumn())).getValues();
        if (JSON.stringify(values[0])!==JSON.stringify(headers)) throw new Error(name+' の見出しが仕様と異なります。上書きしません。');
        snapshots[name]=values.slice(1).map(function(values,i){var r={_row:i+2};headers.forEach(function(h,j){r[h]=values[j];});return r;}); return snapshots[name];
      }
      return sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues().map(function (values, i) {
        var r = { _row: i + 2 }; headers.forEach(function (h, j) { r[h] = values[j]; }); return r;
      });
    }
    function append(name, data) {
      if (fast) rows(name);
      var sheet = book.getSheetByName(name), values = Ledger_.headers[name].split(',').map(function (h) { return text(data[h]); });
      sheet.appendRow(values); data._row = sheet.getLastRow(); if (fast && snapshots[name]) snapshots[name].push(data); return data;
    }
    function save(row) {
      row.version = Number(row.version || 0) + 1; row.updated_at = new Date().toISOString();
      if (!row._row) return append('minutes', row);
      if (fast) rows('minutes');
      if (fast) snapshots.minutes = snapshots.minutes.map(function(r){return r._row===row._row ? row : r;});
      var headers = Ledger_.headers.minutes.split(',');
      book.getSheetByName('minutes').getRange(row._row, 1, 1, headers.length).setValues([headers.map(function (h) { return text(row[h]); })]);
      return row;
    }
    function list(value) {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      try { var a = JSON.parse(value); if (Array.isArray(a)) return a; } catch (e) { /* カンマ形式も受け付けます。 */ }
      return String(value).split(',').map(function (v) { return v.trim(); }).filter(Boolean);
    }
    function masters() {
      return { folders: rows('masters_folders'), clients: rows('masters_clients').map(function (r) { return Object.assign({}, r, { domains: list(r.domains) }); }),
        internal: rows('masters_internal').map(function (r) { return r.email_or_domain; }), people: rows('masters_people') };
    }
    function log(action, target, summary) { Ledger_.dryLog(book, action, target, typeof summary === 'string' ? summary : JSON.stringify(summary)); }
    function displayId(start) {
      var prefix = 'MTG-' + Utilities.formatDate(new Date(start), 'Asia/Tokyo', 'yyMMdd') + '-';
      var next = rows('minutes').filter(function (r) { return String(r.display_id).startsWith(prefix); }).reduce(function (max, r) { return Math.max(max, Number(String(r.display_id).slice(prefix.length)) || 0); }, 0) + 1;
      return prefix + String(next).padStart(2, '0');
    }
    return { rows: rows, append: append, save: save, masters: masters, log: log, displayId: displayId };
  }
  return { initialize: initialize, open: open };
})();


// syncOrganizers.js
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
    var folder=GoogleApi_.get(folders[0].id,{supportsAllDrives:true,fields:'id,properties'});
    if(!folder.properties||folder.properties.minutes_role!=='organizers'||folder.properties.minutes_env!=='test')throw new Error('登録用フォルダの目印が不正です。');
    var seen=new Set(),plans=[];
    drive.children(folder.id).filter(function(f){return /^organizer_[a-f0-9]{64}\.json$/.test(f.name);}).forEach(function(f){
      drive.within(f.id);var meta=GoogleApi_.get(f.id,{supportsAllDrives:true,fields:'id,mimeType,size,properties,lastModifyingUser(emailAddress)'});
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


// testDbSchema.js
// 本番スキーマからテスト用の作成リクエストを組み立てる純粋関数です。
var TestDbSchema_ = (function () {
  function id(value) { return String(value || '').replace(/-/g, '').toLowerCase(); }
  function scalarProperties(source) {
    var properties = Object.create(null), skipped = [];
    var simple = ['title', 'rich_text', 'date', 'people', 'files', 'checkbox', 'url', 'email', 'phone_number', 'created_time', 'created_by', 'last_edited_time', 'last_edited_by'];
    Object.keys(source).forEach(function (name) {
      var p = source[name], type = p.type, value = {};
      if (type === 'relation') return; // 全DB作成後に接続します。
      if (simple.includes(type)) value[type] = {};
      else if (type === 'number') value.number = p.number && p.number.format ? { format: p.number.format } : {};
      else if (type === 'select' || type === 'multi_select') {
        value[type] = { options: ((p[type] || {}).options || []).map(function (o) {
          var option = { name: o.name };
          if (o.color) option.color = o.color;
          return option;
        }) };
      } else {
        skipped.push({ name: name, type: type, reason: type === 'status' ? 'API 2025-09-03では独自のステータス選択肢を複製できません。' : '初期化で複製しない型です。' });
        return;
      }
      value.type = type;
      properties[name] = value;
    });
    if (Object.keys(properties).filter(function (n) { return properties[n].type === 'title'; }).length !== 1) throw new Error('タイトル項目が1つ必要です。');
    return { properties: properties, skipped: skipped };
  }
  function targetKey(relation, sources) {
    return Object.keys(sources).find(function (key) {
      return id(relation.data_source_id) && id(relation.data_source_id) === id(sources[key].sourceId) ||
        id(relation.database_id) && id(relation.database_id) === id(sources[key].databaseId);
    });
  }
  function relations(sources) {
    var edges = [], skipped = [], seen = new Set();
    Object.keys(sources).forEach(function (from) {
      var props = sources[from].properties;
      Object.keys(props).forEach(function (name) {
        var p = props[name];
        if (p.type !== 'relation' || seen.has(from + ':' + name)) return;
        var r = p.relation || {}, to = targetKey(r, sources);
        if (!to) { skipped.push({ name: name, type: 'relation', reason: '複製対象外のDBへのリレーションです。', database: from }); return; }
        var reverseName = null;
        if (from === 'minutes' && name === '関連するプロジェクト' && to === 'tasks' &&
            sources.tasks.properties['関連するMTG'] && sources.tasks.properties['関連するMTG'].type === 'relation' &&
            targetKey(sources.tasks.properties['関連するMTG'].relation || {}, sources) === 'minutes') {
          reverseName = '関連するMTG';
        } else if (r.type === 'dual_property') {
          var dual = r.dual_property || {};
          reverseName = Object.keys(sources[to].properties).find(function (n) {
            var other = sources[to].properties[n];
            return other.type === 'relation' && targetKey(other.relation || {}, sources) === from &&
              (n === dual.synced_property_name || other.id && other.id === dual.synced_property_id);
          });
          if (!reverseName) throw new Error('双方向リレーションの相手項目を特定できません: ' + name);
        }
        if (reverseName === name && from === to) throw new Error('自己参照の相手項目が同一です: ' + name);
        edges.push({ from: from, to: to, name: name, reverseName: reverseName });
        seen.add(from + ':' + name);
        if (reverseName) seen.add(to + ':' + reverseName);
      });
    });
    return { edges: edges, skipped: skipped };
  }
  function relationProperty(edge, targets) {
    var relation = { data_source_id: targets[edge.to].sourceId, type: edge.reverseName ? 'dual_property' : 'single_property' };
    if (edge.reverseName) relation.dual_property = { synced_property_name: edge.reverseName };
    else relation.single_property = {};
    return { type: 'relation', relation: relation };
  }
  function assertCompatible(actual, expected) {
    Object.keys(expected).forEach(function (name) {
      var a = actual[name], e = expected[name];
      if (!a || a.type !== e.type) throw new Error('既存テストDBの項目が異なります。上書きしません: ' + name);
      if (e.type === 'select' || e.type === 'multi_select') {
        var options = ((a[e.type] || {}).options || []).map(function (o) { return { name: o.name, color: o.color || 'default' }; });
        var wanted = e[e.type].options.map(function (o) { return { name: o.name, color: o.color || 'default' }; });
        if (JSON.stringify(options) !== JSON.stringify(wanted)) throw new Error('既存テストDBの選択肢が異なります: ' + name);
      }
      if (e.type === 'number' && e.number.format && (!a.number || a.number.format !== e.number.format)) throw new Error('既存テストDBの数値形式が異なります: ' + name);
    });
  }
  return { id: id, scalarProperties: scalarProperties, relations: relations, relationProperty: relationProperty, assertCompatible: assertCompatible };
})();


// tldvHealth.js
// 無料プランの正確な残回数をNotionだけから推定しません。登録値と独立した予定一覧で監視します。
var TldvHealth_=(function(){
 function check(x,deadline,notify,resolve){resolve=resolve||function(){};var settings=x.ledger.rows('settings'),c=x.c;
  settings.filter(function(r){return String(r.key).startsWith('tldv_quota:');}).forEach(function(r){var q=JSON.parse(r.value);if(!Number.isInteger(q.remaining)||q.remaining<0||!Number.isFinite(Date.parse(q.checked_at)))throw new Error('tl;dv上限登録のremaining/checked_atを確認してください。');var owner=r.key.slice('tldv_quota:'.length);if(q.remaining>0)resolve('tl;dv上限:'+owner+':exhausted');if(q.remaining>Number(c.TLDV_REMAINING_ALERT||5))resolve('tl;dv上限:'+owner+':low');if(q.remaining<=Number(c.TLDV_REMAINING_ALERT||5))notify('tl;dv上限:'+owner+(q.remaining===0?':exhausted':':low'),q.remaining===0?'登録されたtl;dv連携残回数が0です。管理画面で上限・更新日を確認してください。':'登録されたtl;dv連携残回数が'+q.remaining+'です。これは管理者が確認した時点の値です。自動取得値ではありません。');});
  var calendars=NotesPlan_.list(c.TLDV_CALENDAR_IDS),timeout=Number(c.TLDV_RECEIVE_TIMEOUT_MIN||120);if(!Number.isInteger(timeout)||timeout<15||timeout>1440)throw new Error('TLDV_RECEIVE_TIMEOUT_MINは15〜1440です。');if(!calendars.length){if(c.prod&&!settings.some(function(r){return String(r.key).startsWith('tldv_quota:');}))notify('tl;dv監視未設定','無料連携の残回数登録も業務カレンダー監視も未設定です。上限で止まってもNotion受信だけでは検知できません。監視設定を行ってください。');return;}
  var now=Date.now(),rows=x.ledger.rows('minutes');calendars.forEach(function(id){if(Date.now()>deadline)return;try{var token,seen={};do{var args={timeMin:new Date(now-72*3600000).toISOString(),timeMax:new Date(now).toISOString(),singleEvents:true,showDeleted:false,maxResults:250};if(token)args.pageToken=token;var page=Calendar.Events.list(id,args);(page.items||[]).forEach(function(e){var start=e.start&&e.start.dateTime,end=e.end&&e.end.dateTime;if(e.status==='cancelled'||e.visibility==='private'||String(e.summary||'').includes('【記録なし】')||!start||!end||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(end)>now-timeout*60000||c.prod&&Date.parse(start)<Date.parse(c.PRODUCTION_START_AT))return;var meet=e.hangoutLink||((e.conferenceData||{}).entryPoints||[]).find(function(p){return p.entryPointType==='video'&&/^https:\/\/meet\.google\.com\//.test(p.uri||'');});if(!meet)return;var candidate={title:e.summary||'',start:start,attendees:(e.attendees||[]).map(function(a){return {email:a.email};})};var expectedKey='tl;dv受信未着:'+id+':'+e.id;if(rows.some(function(r){return r.notion_page_id&&r.status!=='対象外'&&MeetingRules_.sameMeeting(candidate,{title:r.title,start:r.event_start,attendees:JSON.parse(r.attendees_json||'[]')},15);})){resolve(expectedKey);return;}notify(expectedKey,'予定「'+ServiceChatwork_.clean(e.summary)+'」終了後も議事録が届いていません。無料連携上限・自動参加・会議の参加許可・Notion接続を確認してください。上限到達と断定はしていません。');});token=page.nextPageToken;if(token&&seen[token])throw new Error('予定一覧が循環しています。');if(token)seen[token]=true;}while(token&&Date.now()<deadline);}catch(e){notify('tl;dv監視カレンダー:'+id,'監視カレンダーを読み取れません。finance@への共有権限・Calendarサービス・認証を確認してください。');}});
 }
 return {check:check};
})();


// transcriptText.js
// 元のDocsは読み取りだけ。新規TXTとmanifestの所在追記だけをテスト受信内で行います。
var TranscriptText_=(function(){
  function extract(document,source){
    if(!document||document.documentId!==source.file_id)throw new Error('文字起こしのドキュメントIDが違います。');
    var tabs=[];
    function visit(items){(items||[]).forEach(function(t){tabs.push(t);visit(t.childTabs);});}visit(document.tabs);
    var body;
    if(source.type==='document_tab'){
      var matches=tabs.filter(function(t){return (t.tabProperties||{}).tabId===source.tab_id;});
      if(matches.length!==1||!['文字起こし','transcript'].includes(String(matches[0].tabProperties.title||'').normalize('NFKC').trim().toLowerCase()))throw new Error('指定の文字起こしタブを確認できません。');
      body=(matches[0].documentTab||{}).body;
    }else if(source.type==='gemini_notes'){
      var notes=tabs.filter(function(t){return !['文字起こし','transcript'].includes(String((t.tabProperties||{}).title||'').normalize('NFKC').trim().toLowerCase());});
      var named=notes.filter(function(t){return /^(メモ|notes|meeting notes|geminiによるメモ)$/i.test(String(t.tabProperties.title||'').trim());});
      if(named.length===1)body=(named[0].documentTab||{}).body;
      else if(notes.length===1)body=(notes[0].documentTab||{}).body;
      else if(!tabs.length)body=document.body;
      else throw new Error('要確認：メモのタブを一意に特定できません。');
    }else if(source.type==='file'){
      // 別ファイルは単一タブのみ自動選択します。複数なら文字起こしタブを一意に特定します。
      var candidates=tabs.filter(function(t){return ['文字起こし','transcript'].includes(String((t.tabProperties||{}).title||'').normalize('NFKC').trim().toLowerCase());});
      if(tabs.length===1)body=(tabs[0].documentTab||{}).body;
      else if(candidates.length===1)body=(candidates[0].documentTab||{}).body;
      else if(!tabs.length)body=document.body;
      else throw new Error('別ファイルの文字起こしタブが一意ではありません。');
    }else throw new Error('文字起こしの所在が不正です。');
    function content(items){return (items||[]).map(function(e){
      if(e.paragraph)return (e.paragraph.elements||[]).map(function(p){return p.textRun?p.textRun.content||'':'';}).join('');
      if(e.table)return (e.table.tableRows||[]).map(function(r){return (r.tableCells||[]).map(function(c){return content(c.content);}).join('\t');}).join('\n');
      if(e.tableOfContents)return content(e.tableOfContents.content);
      return '';
    }).join('');}
    var text=body&&content(body.content);if(!text||!text.trim())throw new Error('文字起こし本文が空です。');return text;
  }
  function hash(text){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
  function run(tolerateErrors){
    var c=Stage2Drive_.config(),drive=Stage2Drive_.open(c),raw=drive.folder(drive.root.id,'00_受信',false),results=[];
    if(!c.FOLDER_INBOX_RAW_TEST_ID||raw.id!==c.FOLDER_INBOX_RAW_TEST_ID)throw new Error('テスト受信IDが一致しません。');
    var memoWait=Number(c.MOVER_MEMO_WAIT_MIN||120);if(!Number.isInteger(memoWait)||memoWait<20||memoWait>2880)throw new Error('MOVER_MEMO_WAIT_MINは20〜2880です。');
    var processed=0,started=Date.now();
    drive.children(raw.id).filter(function(f){return f.mimeType==='application/vnd.google-apps.folder';}).forEach(function(folder){
      if(Date.now()-started>120000)return;
      try{drive.within(folder.id);var children=drive.children(folder.id),manifests=children.filter(function(f){return f.name==='manifest.json';});
      if(!manifests.length)return;if(manifests.length!==1)throw new Error('manifestが重複しています。');
      var m=drive.readJSON(manifests[0].id);if(m.status!=='ready'||m.transcript_text)return;if(processed++>=c.INGEST_BATCH)return;
      if(!/^(meet|tldv):.+$/.test(m.meeting_key||'')||folder.name!==m.meeting_key.replace(/:/g,'_'))throw new Error('会議フォルダ名とキーが違います。');
      var source=m.transcript_source||(m.files&&{type:'file',file_id:m.files.transcript||m.files.tldv_transcript});
      if((!source||!source.file_id)&&m.files&&m.files.gemini&&Date.now()-Date.parse(m.end||m.created_at)>=memoWait*60000)source={type:'gemini_notes',file_id:m.files.gemini};
      if(!source||!source.file_id||!['file','document_tab','gemini_notes'].includes(source.type)||!Object.values(m.files||{}).includes(source.file_id))throw new Error('文字起こしの所在が不正です。');
      var native=drive.within(source.file_id);if(!(native.parents||[]).includes(folder.id))throw new Error('文字起こしが会議フォルダ内にありません。');
      var text;
      if(native.mimeType==='application/vnd.google-apps.document')text=extract(GoogleApi_.docsGet(native.id,{includeTabsContent:true}),source);
      else if(source.type==='file'&&native.mimeType==='text/plain')text=DriveApp.getFileById(native.id).getBlob().getDataAsString('UTF-8');
      else throw new Error('文字起こしのファイル型に対応していません。');
      if(!text.trim())throw new Error('文字起こしが空です。');
      var digest=hash(text),matches=children.filter(function(f){return f.name==='transcript.txt';});
      if(matches.length>1)throw new Error('transcript.txtが重複しています。');
      var existing=matches[0];
      if(existing){var checked=drive.within(existing.id);if(checked.mimeType!=='text/plain'||hash(DriveApp.getFileById(existing.id).getBlob().getDataAsString('UTF-8'))!==digest)throw new Error('既存のtranscript.txtが異なります。上書きせず停止します。');}
      if(m.transcript_text&&(m.transcript_text.sha256!==digest||!existing||m.transcript_text.file_id!==existing.id||m.transcript_text.name!=='transcript.txt'))throw new Error('既存の文字起こし参照と異なります。上書きしません。');
      var plan={meeting_key:m.meeting_key,sha256:digest,characters:text.length,action:existing?'既存TXTを再利用':'TXTを新規作成'};results.push(plan);console.log('文字起こし書き出し'+(c.DRY_RUN==='true'?'予定':'')+'：'+JSON.stringify(plan));
      if(c.DRY_RUN==='true')return;
      // 所属・manifestが読取時から変わっていないことを更新直前にも検査します。
      var fresh=GoogleApi_.get(folder.id,{supportsAllDrives:true,fields:'id,parents,trashed'}),mf=GoogleApi_.get(manifests[0].id,{supportsAllDrives:true,fields:'id,parents,trashed'});
      if(fresh.trashed||!fresh.parents||fresh.parents.length!==1||fresh.parents[0]!==raw.id||mf.trashed||!mf.parents||mf.parents.length!==1||mf.parents[0]!==folder.id||JSON.stringify(drive.readJSON(mf.id))!==JSON.stringify(m))throw new Error('書き出し直前に会議の所属・manifestが変わりました。');
      var saved=existing||drive.createFile(folder.id,'transcript.txt',text,'text/plain','transcript_text',m.meeting_key);
      if(!m.transcript_text){if(source.type==='gemini_notes'){m.transcript_source=source;m.input_quality='notes_only';}m.transcript_text={file_id:saved.id,name:'transcript.txt',sha256:digest,characters:text.length,source:source,exported_at:new Date().toISOString()};GoogleApi_.update({},mf.id,Utilities.newBlob(JSON.stringify(m,null,2),'application/json','manifest.json'),{supportsAllDrives:true,fields:'id'});}
      }catch(e){if(!tolerateErrors)throw e;console.log('TXT書き出し要確認：'+folder.name);results.push({folder:folder.name,status:'要確認',error:'文字起こし・メモの所在、タブ、権限、Google APIを確認してください。'});}
    });return {dryRun:c.DRY_RUN==='true',results:results};
  }
  return {extract:extract,hash:hash,run:run};
})();
function exportTranscriptTexts(){assertFinanceOperator_();return Ledger_.withLock(TranscriptText_.run);}
function transcriptExportTick_(){
  if(String(Session.getEffectiveUser().getEmail()||'').toLowerCase()!=='finance@premiere-mode.co.jp')throw new Error('文字起こし更新トリガーはfinance@が作成してください。');
  return Ledger_.withLock(TranscriptText_.run);
}
function setupTranscriptExportTrigger(){assertFinanceOperator_();return Ledger_.withLock(function(){
  var c=Stage2Drive_.config();Stage2Drive_.open(c);
  if(c.DRY_RUN==='true'){console.log('15分ごとにテスト受信の文字起こしTXTを書き出す予定です。');return {dryRun:true};}
  var own=ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='transcriptExportTick_';});if(own.length>1)throw new Error('文字起こしトリガーが重複しています。');
  var trigger=own[0]||ScriptApp.newTrigger('transcriptExportTick_').timeBased().everyMinutes(15).create();console.log('文字起こしトリガーを確認しました。');return {dryRun:false,triggerId:String(trigger.getUniqueId())};
});}
function removeTranscriptExportTrigger(){assertFinanceOperator_();return Ledger_.withLock(function(){
  var c=Stage2Drive_.config();if(c.DRY_RUN==='true'){console.log('自分の文字起こしトリガーだけを解除する予定です。');return;}
  ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='transcriptExportTick_';}).forEach(function(t){ScriptApp.deleteTrigger(t);});console.log('自分の文字起こしトリガーを解除しました。');
});}
