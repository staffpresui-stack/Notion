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
