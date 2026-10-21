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
