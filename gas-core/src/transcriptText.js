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
