var MoverPlan_=(function(){
  var kinds=['recording','transcript','gemini'];
  function event(event,email,now,wait){
    if(!event || event.status==='cancelled' || !event.organizer || event.organizer.self!==true || String(event.organizer.email||'').toLowerCase()!==email)return null;
    var start=event.start&&event.start.dateTime,end=event.end&&event.end.dateTime;
    if(!start||!end||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(end)<=Date.parse(start)||Date.parse(end)>now-wait*60000)return null;
    var conference=event.conferenceData;
    if(!conference||!conference.conferenceSolution||!conference.conferenceSolution.key||conference.conferenceSolution.key.type!=='hangoutsMeet')return null;
    var entry=(conference.entryPoints||[]).find(function(p){return p.entryPointType==='video'&&/^https:\/\/meet\.google\.com\/[a-z0-9-]+(?:\?.*)?$/i.test(p.uri||'');});
    if(!entry)return null;
    var stamp=new Date(start).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
    if(!/^[A-Za-z0-9_-]+$/.test(event.id||''))throw new Error('予定IDが不正です。');
    var eventKey=event.id.endsWith('_'+stamp)?event.id:event.id+'_'+stamp,key='meet:'+eventKey;
    if(key.length>100)throw new Error('会議キーが長すぎます。個別確認が必要です。');
    var attendees=(event.attendees||[]).filter(function(a){return a.email;}).map(function(a){return {email:a.email,name:a.displayName||a.email};});
    if(!attendees.some(function(a){return a.email.toLowerCase()===email;}))attendees.push({email:email,name:email});
    return {key:key,folderKey:key.replace(/:/g,'_'),expired:now-Date.parse(end)>=48*3600000,manifest:{meeting_key:key,source:'meet',event_id:event.id,title:event.summary||'会議',start:start,end:end,organizer_email:email,attendees:attendees,meet_url:entry.uri,files:{},missing:[],status:'ready',created_at:new Date(now).toISOString()}};
  }
  function kind(file){var mime=file.mimeType||'',name=file.name||'';if(mime.startsWith('video/'))return 'recording';if(mime!=='application/vnd.google-apps.document')return null;var transcript=/文字起こし|transcript/i.test(name),gemini=/gemini|メモ|meeting notes|notes by/i.test(name);if(transcript&&gemini)throw new Error('文字起こしとメモの判定が重複しています: '+name);return transcript?'transcript':gemini?'gemini':null;}
  function files(attachments,metadata){var found={},ignored=[];var seen=new Set();(attachments||[]).forEach(function(a){if(!a.fileId||seen.has(a.fileId))return;seen.add(a.fileId);var f=metadata[a.fileId];if(!f)throw new Error('添付のメタデータを取得できません。');var k=kind(f);if(!k){ignored.push({id:f.id,name:f.name});return;}if(found[k])throw new Error('同じ種類の添付が複数あります。自動選択せず停止します: '+k);found[k]=f;});return {found:found,ignored:ignored,missing:kinds.filter(function(k){return !found[k];})};}
  return {event:event,files:files,kind:kind,kinds:kinds};
})();
