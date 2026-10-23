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
