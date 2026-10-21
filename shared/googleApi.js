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
