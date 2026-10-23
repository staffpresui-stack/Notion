const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {harness,ids,clone}=require('./helpers/organizer.cjs');
function scene(dry='false'){
 const h=harness(dry);let now=Date.now(),seq=0;const http=[],folderMime='application/vnd.google-apps.folder',start=new Date(now-3600000),jst=new Date(start.getTime()+9*3600000),stamp=jst.toISOString().slice(0,16).replace(/-/g,' ').replace('T',' '),code='szo-aepv-eqp';
 h.ctx.Date=class extends Date{static now(){return now;}};
 h.props.MOVER_DISCOVERY_MODE='RECORDS';h.props.MOVER_MODE='AUTO';
 h.files.meetRoot={id:'meetRoot',name:'Google Meet',mimeType:folderMime,parents:['myRoot'],ownedByMe:true};
 h.files.meeting={id:'meeting',name:code+' - '+stamp+' JST',mimeType:folderMime,parents:['meetRoot'],ownedByMe:true};
 for(const id of ['gemini','transcript','rec'])h.files[id].parents=['meeting'];
 h.files.gemini.name=stamp+' JST に開始した会議 - Gemini によるメモ';
 const notes='まとめ\n顧客の要望を確認しました。次回に見積もりを提示します。\n参加者：finance@premiere-mode.co.jp、社員例',transcript='finance: 本日の議題と次回の進め方を確認します。ここから議事録を作成するための原文です。';let contents={notes,transcript};
 let events=[],changes=[];
 const oldGet=h.ctx.Drive.Files.get;
 const api={
 get:(id,args)=>oldGet(id,args),
 list:args=>{http.push({op:'list',args});if(args.corpora==='drive')return h.ctx.GoogleApi_.list(args);const parent=args.q.match(/^'([^']+)' in parents/);return {files:Object.values(h.files).filter(f=>!f.trashed&&!f.driveId&&(parent?(f.parents||[]).includes(parent[1]):f.ownedByMe&&['application/vnd.google-apps.document','video/mp4'].includes(f.mimeType))).map(clone)};},
 create:h.ctx.GoogleApi_.create,update:h.ctx.GoogleApi_.update,
 docsGet:(id,args)=>{http.push({op:'docs',id});return {documentId:id,tabs:id==='transcript'?[{tabProperties:{title:'文字起こし',tabId:'t'},documentTab:{body:{content:[{paragraph:{elements:[{textRun:{content:contents.transcript}}]}}]}}}]:[{tabProperties:{title:'メモ',tabId:'n'},documentTab:{body:{content:[{paragraph:{elements:[{textRun:{content:contents.notes}}]}}]}}},{tabProperties:{title:'文字起こし',tabId:'t'},documentTab:{body:{content:[{paragraph:{elements:[{textRun:{content:contents.transcript}}]}}]}}}]};},
 calendarList:args=>{http.push({op:'calendar'});return {items:events};},
 changesStart:()=>{http.push({op:'start'});return {startPageToken:'start-token'};},
 changes:args=>{http.push({op:'changes',args});const result={newStartPageToken:'next-'+(++seq),changes:changes.map(file=>({file:clone(file)}))};changes=[];return result;}
 };
 for(const name of ['recordDiscovery','recordTriggers','fastBudget.generated'])vm.runInContext(fs.readFileSync('gas-organizer/src/'+name+'.js','utf8'),h.ctx);
 h.ctx.RecordDiscovery_.nativeApi=()=>api;
 return {...h,api,http,code,start:new Date(start.getTime()-start.getSeconds()*1000-start.getMilliseconds()),advance:s=>now+=s*1000,setBody:(v)=>contents=v,setEvents:v=>events=v,change:f=>changes.push(f),run:(only)=>h.ctx.RecordDiscovery_.run(h.ctx.Organizer_.config(),'finance@premiere-mode.co.jp',api,now+45000,only),now:()=>now};
}
test('予定なしMeetをGoogle Meet配下から発見し、安定確認後に同じIDでready。終了時刻・未確認参加者は補完しない',()=>{
 const h=scene();h.files.transcript.trashed=true;h.files.rec.trashed=true;const first=h.run();assert.equal(first.results[0].status,'本文の安定確認待ち');h.advance(61);const result=h.run();assert.equal(result.results[0].status,'ready');const manifest=JSON.parse(Object.values(h.files).find(f=>f.name==='manifest.json').content);assert.match(manifest.meeting_key,/^meet:instant_szoaepveqp_/);assert.equal(manifest.end,'');assert.equal(manifest.end_unknown,true);assert.equal(manifest.participants_incomplete,true);assert.equal(manifest.transcript_source.type,'document_tab');assert.ok(manifest.attendees.some(a=>a.name==='社員例'));assert.equal(manifest.files.gemini,'gemini');assert.equal(h.files.gemini.driveId,ids.SHARED_DRIVE_ID);assert.ok(h.files.meeting);
 h.http.length=0;assert.equal(h.run().results.length,0);assert.equal(h.http.filter(v=>v.op==='changes').length,1);assert.equal(h.http.filter(v=>v.op==='docs'||v.op==='calendar').length,0);
});
test('カレンダー予定は旧キー・タイトル・参加者を維持し、予定終了の未来・20分待ちでは止めない',()=>{
 const h=scene();h.files.transcript.trashed=true;h.files.rec.trashed=true;const event={...clone(h.event),start:{dateTime:h.start.toISOString()},end:{dateTime:new Date(h.now()+3600000).toISOString()},summary:'既存の予定名',hangoutLink:'https://meet.google.com/'+h.code};event.conferenceData.entryPoints[0].uri=event.hangoutLink;h.setEvents([event]);h.run();h.advance(61);const r=h.run().results[0];assert.equal(r.status,'ready');const m=JSON.parse(Object.values(h.files).find(f=>f.name==='manifest.json').content);assert.match(m.meeting_key,/^meet:testevent_/);assert.equal(m.title,event.summary);assert.equal(m.scheduled_end,event.end.dateTime);assert.equal(m.end_unknown,true);
});
test('非公開・記録なし・他人主催・複数予定を即時Meetと誤認せず移動しない',()=>{
 for(const kind of ['private','optout','other','ambiguous']){const h=scene();const e={...clone(h.event),start:{dateTime:h.start.toISOString()},hangoutLink:'https://meet.google.com/'+h.code};e.conferenceData.entryPoints[0].uri=e.hangoutLink;if(kind==='private')e.visibility='private';if(kind==='optout')e.summary='【記録なし】';if(kind==='other')e.organizer.email='other@example.com';h.setEvents(kind==='ambiguous'?[e,{...e,id:'different'}]:[e]);h.run();h.advance(61);h.run();assert.equal(h.writes.filter(w=>w.args?.addParents).length,0);assert.equal(Object.values(h.files).filter(f=>f.name==='manifest.json').length,0);}
});
test('メモだけは3分の本文安定を確認、生成中は待機。本文変更で安定時間をリセット',()=>{
 const h=scene();h.files.transcript.trashed=true;h.files.rec.trashed=true;h.setBody({notes:'メモを作成しています。しばらくお待ちください。',transcript:''});assert.equal(h.run().results[0].status,'本文の生成待ち');h.setBody({notes:'会議の決定事項と次のステップをまとめました。担当者が詳細を確認します。',transcript:''});h.run();h.advance(181);h.setBody({notes:'会議の決定事項と次のステップをまとめました。担当者が見積もりを確認します。',transcript:''});assert.equal(h.run().results[0].status,'本文の安定確認待ち');h.advance(181);const r=h.run().results[0];assert.equal(r.status,'ready');const m=JSON.parse(Object.values(h.files).find(f=>f.name==='manifest.json').content);assert.equal(m.input_quality,'notes_only');
});
test('録画だけは要確認、一般Drive文書・他人所有・別共有ドライブを拾わない',()=>{
 const h=scene();h.files.gemini.trashed=true;h.files.transcript.trashed=true;assert.equal(h.run().results[0].status,'要確認・録画のみ');assert.equal(h.writes.length,0);
 for(const change of [h=>h.files.meetRoot.name='一般文書',h=>h.files.gemini.ownedByMe=false,h=>h.files.gemini.driveId='another']){const x=scene();x.files.rec.trashed=true;x.files.transcript.trashed=true;change(x);assert.equal(x.run().results.length,0);assert.equal(x.writes.length,0);}
});
test('DRY_RUNは候補のみで差分token・安定状態・共通記録・Driveを更新しない。1件指定は別会議を動かさない',()=>{
 const h=scene('true'),before=clone(h.props);const r=h.run();assert.match(r.results[0].status,/移動候補/);assert.deepEqual(h.props,before);assert.equal(h.writes.length,0);
 const x=scene();assert.equal(x.run('aaa-bbbb-ccc').results.length,0);assert.equal(x.writes.length,0);
});
test('成果物が後から増えても同じ会議キーの追加受け渡しだけ。新規の議事録manifestを増やさない',()=>{
 const h=scene();h.files.transcript.trashed=true;h.files.rec.trashed=true;h.run();h.advance(61);const first=h.run().results[0];h.files.rec.trashed=false;h.change(h.files.rec);const next=h.run().results[0];assert.equal(next.status,'後着ファイルを受け渡しました');assert.equal(next.key,first.key);const manifests=Object.values(h.files).filter(f=>f.name==='manifest.json').map(f=>JSON.parse(f.content));assert.equal(manifests.filter(m=>!m.artifact_update).length,1);assert.equal(manifests.filter(m=>m.artifact_update).length,1);assert.deepEqual(manifests.find(m=>m.artifact_update).files,{recording:'rec'});assert.equal(h.files.rec.driveId,ids.SHARED_DRIVE_ID);
});
test('cutoffより前は除外し、本番出力にtestの処理済み記録を流用しない',()=>{
 const h=scene();h.props.ENV='prod';h.props.FOLDER_INBOX_RAW_ID='1jNifZBBUN0QNMWdA_hI2J5YY2PbqtxoB';h.props.PRODUCTION_START_AT=new Date(h.now()-1000).toISOString();assert.equal(h.run().results.length,0);assert.equal(h.writes.length,0);
});
test('本文抽出は表・子タブを読み、文字起こしタブをメモから分離する',()=>{const h=scene(),text=h.ctx.RecordPlan_.text({tabs:[{tabProperties:{title:'メモ'},documentTab:{body:{content:[{table:{tableRows:[{tableCells:[{content:[{paragraph:{elements:[{textRun:{content:'表の内容'}}]}}]}]}]}}]}},childTabs:[{tabProperties:{title:'Ｔｒａｎｓｃｒｉｐｔ'},documentTab:{body:{content:[{paragraph:{elements:[{textRun:{content:'文字起こし原文'}}]}}]}}}]}]});assert.equal(text.notes,'表の内容');assert.equal(text.transcript,'文字起こし原文');});
test('社員の登録で差分1分タイマーも1個作り、解除時は本人の両方だけ止める',()=>{
 const h=scene();h.register();h.register();assert.equal(h.triggers.filter(t=>t.getHandlerFunction()==='moverRun').length,1);assert.equal(h.triggers.filter(t=>t.getHandlerFunction()==='recordMoverTick_').length,1);h.ctx.unregisterOrganizer(h.nonce);assert.equal(h.triggers.length,0);
});
test('予定ありの「会議名 - 日時 JST」フォルダも添付IDで照合し、既存AUTOの対象を落とさない',()=>{
 const h=scene();h.files.meeting.name=h.files.meeting.name.replace(h.code,'EC 定例');h.files.transcript.trashed=true;h.files.rec.trashed=true;h.setEvents([{...clone(h.event),summary:'EC 定例',start:{dateTime:h.start.toISOString()}}]);h.run();h.advance(61);const r=h.run().results[0];assert.equal(r.status,'ready');const m=JSON.parse(Object.values(h.files).find(f=>f.name==='manifest.json').content);assert.match(m.meeting_key,/^meet:testevent_/);assert.equal(m.title,'EC 定例');
});
test('同じ検出ロジックは委任アダプターでも実行でき、別ユーザーの差分状態を混在させない',()=>{
 const h=scene();h.files.transcript.trashed=true;h.files.rec.trashed=true;const email='employee@premiere-mode.co.jp';h.files.gemini.owners=[{emailAddress:email}];const run=()=>h.ctx.RecordDiscovery_.run(h.ctx.Organizer_.config(),email,h.api,h.now()+45000);run();h.advance(61);assert.equal(run().results[0].status,'ready');const m=JSON.parse(Object.values(h.files).find(f=>f.name==='manifest.json').content);assert.equal(m.organizer_email,email);assert.ok(Object.keys(h.props).some(k=>k.startsWith(h.ctx.RecordDiscovery_.prefix(h.ctx.Organizer_.config(),email))));assert.ok(!Object.keys(h.props).some(k=>k.startsWith(h.ctx.RecordDiscovery_.prefix(h.ctx.Organizer_.config(),'finance@premiere-mode.co.jp'))));
});
test('初回実機用の1件限定フラグは定期実行にも効き、別Meetのファイルを動かさない',()=>{const h=scene();h.props.RECORD_TEST_ONLY='true';h.props.RECORD_TEST_MEET_CODE='aaa-bbbb-ccc';h.run();h.advance(181);h.run();assert.equal(h.writes.length,0);});
test('実際の本人トリガー経路もDrive差分を使い、通常マニフェストのまま予定なしMeetを取り込む',()=>{const h=scene();h.files.transcript.trashed=true;h.files.rec.trashed=true;const original=h.ctx.Drive.Files.list;h.ctx.Drive.Files.list=args=>args.corpora==='user'?h.api.list(args):original(args);h.ctx.Drive.Changes={getStartPageToken:h.api.changesStart,list:h.api.changes};h.ctx.Docs.Documents.get=h.api.docsGet;h.ctx.Calendar.Events.list=(cal,args)=>h.api.calendarList(args);h.register();assert.equal(h.ctx.recordMoverTick_().results[0].status,'本文の安定確認待ち');h.advance(61);assert.equal(h.ctx.moverRun()[0].status,'ready');assert.equal(h.ctx.recordMoverTick_().results.length,0);});
test('後着ファイルの移動が失敗しても同じステージから再開し、追加manifestを重複作成しない',()=>{const h=scene();h.files.transcript.trashed=true;h.files.rec.trashed=true;h.run();h.advance(61);h.run();h.files.rec.trashed=false;h.change(h.files.rec);h.failAt(2);assert.equal(h.run().results[0].status,'要確認');h.failAt(0);assert.equal(h.run().results[0].status,'後着ファイルを受け渡しました');assert.equal(Object.values(h.files).filter(f=>f.name==='manifest.json'&&JSON.parse(f.content).artifact_update).length,1);assert.equal(h.writes.filter(w=>w.id==='rec'&&w.args?.addParents).length,1);});
test('旧カレンダー経路で作成済みの会議にも後着録画を旧キーで追加し、議事録を再作成しない',()=>{const h=scene();h.props.MOVER_DISCOVERY_MODE='CALENDAR';h.props.MOVER_SHARED_REGISTRY='true';h.files.rec.trashed=true;h.event.attachments=h.event.attachments.filter(a=>a.fileId!=='rec');h.event.conferenceData.entryPoints[0].uri='https://meet.google.com/'+h.code;h.ctx.Calendar.Events.list=()=>({items:[clone(h.event)]});h.register();const original=h.ctx.moverRun()[0];assert.equal(original.status,'ready');h.props.MOVER_DISCOVERY_MODE='RECORDS';h.setEvents([clone(h.event)]);h.files.rec.trashed=false;h.change(h.files.rec);const r=h.run().results[0];assert.equal(r.status,'後着ファイルを受け渡しました');assert.equal(r.key,original.meeting_key);assert.equal(Object.values(h.files).filter(f=>f.name==='manifest.json'&&!JSON.parse(f.content).artifact_update).length,1);});
test('明示除外は短間隔にも効き、7日を超えた記録リンクは整理しDRY_RUNでは残す',()=>{const h=scene();h.props.MOVER_SHARED_REGISTRY='true';h.props.DWD_EXCLUDE_EMAILS='finance@premiere-mode.co.jp';assert.equal(h.run().results.length,0);assert.equal(h.http.length,0);delete h.props.DWD_EXCLUDE_EMAILS;const base=h.ctx.RecordDiscovery_.prefix(h.ctx.Organizer_.config(),'finance@premiere-mode.co.jp');h.props[base+'link:old']=JSON.stringify({at:h.now()-8*86400000,key:'old'});h.run();assert.ok(!h.props[base+'link:old']);});
