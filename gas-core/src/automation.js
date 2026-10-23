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
