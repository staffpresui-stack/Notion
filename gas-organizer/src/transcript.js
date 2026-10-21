// Docsは読み取りだけです。物理ファイルは増やさず、タブの所在をmanifestに残します。
var OrganizerTranscript_=(function(){
  function findTab(document){
    var matches=[];
    function visit(tabs){(tabs||[]).forEach(function(tab){
      var p=tab.tabProperties||{},title=String(p.title||'').normalize('NFKC').trim().toLowerCase();
      if(['文字起こし','transcript'].includes(title)){
        if(typeof p.tabId!=='string'||!p.tabId)throw new Error('文字起こしタブのIDを確認できません。');
        matches.push({tab_id:p.tabId,tab_title:p.title});
      }
      visit(tab.childTabs);
    });}
    visit(document.tabs);
    if(matches.length>1)throw new Error('文字起こしタブが複数あります。自動選択せず停止します。');
    return matches[0]||null;
  }
  function resolve(files){
    if(files.found.transcript)return {type:'file',file_id:files.found.transcript.id};
    if(!files.found.gemini)return null;
    var id=files.found.gemini.id,document;
    try{document=GoogleApi_.docsGet(id,{includeTabsContent:true,fields:'documentId,tabs(tabProperties(tabId,title),childTabs)'});}
    catch(e){throw new Error('Geminiメモのタブを読み取れません。Docs API・読み取り権限を確認してください：'+String(e.message||'取得失敗').slice(0,220));}
    if(!document||document.documentId!==id)throw new Error('取得したGeminiメモのドキュメントIDが一致しません。');
    var tab=findTab(document);
    return tab?{type:'document_tab',file_id:id,tab_id:tab.tab_id,tab_title:tab.tab_title}:null;
  }
  return {findTab:findTab,resolve:resolve};
})();
