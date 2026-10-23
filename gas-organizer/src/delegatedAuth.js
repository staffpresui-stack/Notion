// 外部ライブラリ不要のRS256。鍵・JWT・トークン・応答本文はログに出しません。
var DelegatedAuth_=(function(){
  var base='https://www.googleapis.com/auth/';
  var scopes={admin:[base+'admin.directory.user.readonly',base+'apps.licensing'],user:[base+'calendar.readonly',base+'drive'],drive:[base+'drive']};
  function key(){var value;try{value=JSON.parse(PropertiesService.getScriptProperties().getProperty('SA_KEY_JSON')||'{}');}catch(e){throw new Error('SA_KEY_JSONをJSON形式で設定してください。');}
    if(value.type!=='service_account'||!/^.+@.+\.iam\.gserviceaccount\.com$/.test(value.client_email||'')||!/^\d+$/.test(value.client_id||'')||!/^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----\n?$/.test(value.private_key||''))throw new Error('SA_KEY_JSONの形式が不正です。鍵の内容は表示しません。');return value;}
  function b64(value){return Utilities.base64EncodeWebSafe(value).replace(/=+$/,'');}
  function token(subject,kind){
    if(!/^[^@\s]+@premiere-mode\.co\.jp$/.test(subject)||!scopes[kind])throw new Error('委任対象またはスコープが不正です。');
    var k=key(),cache=CacheService.getScriptCache(),cacheKey='DWD_TOKEN:'+Organizer_.hash(k.client_email+':'+(k.private_key_id||Organizer_.hash(k.private_key))+':'+subject+':'+kind),saved=cache.get(cacheKey);if(saved)return saved;
    var now=Math.floor(Date.now()/1000),unsigned=b64(JSON.stringify({alg:'RS256',typ:'JWT'}))+'.'+b64(JSON.stringify({iss:k.client_email,sub:subject,scope:scopes[kind].join(' '),aud:'https://oauth2.googleapis.com/token',iat:now-30,exp:now+3300}));
    var assertion,response;try{assertion=unsigned+'.'+b64(Utilities.computeRsaSha256Signature(unsigned,k.private_key));}catch(e){throw new Error('サービスアカウントの秘密鍵で署名できません。鍵の形式を確認してください。');}
    try{response=UrlFetchApp.fetch('https://oauth2.googleapis.com/token',{method:'post',payload:{grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:assertion},muteHttpExceptions:true,followRedirects:false});}catch(e){throw new Error('委任トークン取得の通信に失敗しました。');}
    var status=response.getResponseCode(),data;try{data=JSON.parse(response.getContentText());}catch(e){data={};}
    if(status!==200||typeof data.access_token!=='string'||!data.access_token||!Number.isFinite(Number(data.expires_in))||Number(data.expires_in)<120){var error=new Error('委任トークンを取得できません（HTTP '+status+'）。委任のクライアントID・スコープ・鍵・対象ユーザーを確認してください。');error.code=status;error.api='委任認証';throw error;}
    cache.put(cacheKey,data.access_token,Math.min(3000,Number(data.expires_in)-60));return data.access_token;
  }
  function query(args){return Object.keys(args||{}).filter(function(k){return args[k]!==undefined&&args[k]!==null;}).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(String(args[k]));}).join('&');}
  function request(subject,kind,url,method,body,media){
    if(!/^https:\/\/(?:www\.googleapis\.com\/(?:drive\/v3\/|calendar\/v3\/)|docs\.googleapis\.com\/v1\/|admin\.googleapis\.com\/admin\/directory\/v1\/|licensing\.googleapis\.com\/apps\/licensing\/v1\/)/.test(url))throw new Error('許可されていない委任APIです。');
    method=method||'get';if(!['get','patch'].includes(method)||method==='patch'&&!url.startsWith('https://www.googleapis.com/drive/v3/files/'))throw new Error('委任APIでは読み取りとDrive移動だけを許可します。');
    // PATCHは同じID・同じ親への操作だけ。作成APIは既存の冪等ラッパーを使用します。
    function execute(){var r,bearer=token(subject,kind);
      try{r=UrlFetchApp.fetch(url,{method:method,headers:{Authorization:'Bearer '+bearer},contentType:'application/json',...(body?{payload:JSON.stringify(body)}:{}),muteHttpExceptions:true,followRedirects:false});}catch(e){throw new Error('委任APIの通信に失敗しました。応答不明のため次回確認します。');}
      var code=r.getResponseCode(),value;try{value=JSON.parse(r.getContentText());}catch(e){value=null;}
      if(code<200||code>=300){var rate=code===429||code===403&&value&&value.error&&(value.error.errors||[]).some(function(v){return ['rateLimitExceeded','userRateLimitExceeded'].includes(v.reason);});var err=new Error('委任API HTTP '+code+(rate?' rateLimitExceeded':''));err.code=code;err.api=url.includes('admin.googleapis.com')?'Directory':url.includes('licensing.googleapis.com')?'ライセンス':url.includes('calendar/v3')?'Calendar':url.includes('docs.googleapis.com')?'Docs':'Drive';throw err;}
      if(media)return r.getContentText();if(!value)throw new Error('委任APIからJSONを取得できません。');return value;
    }
    return method==='patch'?execute():GoogleApi_.call('委任API取得',execute);
  }
  function get(subject,kind,url,args){return request(subject,kind,url+(Object.keys(args||{}).length?'?'+query(args):''));}
  function drive(c,email){
    var url='https://www.googleapis.com/drive/v3/files/';
    return {
      get:function(id,args){return get(email,'user',url+encodeURIComponent(id),args);},
      list:function(args){return get(email,'user',url.slice(0,-1),args);},
      docsGet:function(id,args){return get(email,'user','https://docs.googleapis.com/v1/documents/'+encodeURIComponent(id),args);},
      calendarList:function(args){return get(email,'user','https://www.googleapis.com/calendar/v3/calendars/primary/events',args);},
      changesStart:function(){return get(email,'user','https://www.googleapis.com/drive/v3/changes/startPageToken',{fields:'startPageToken'});},
      changes:function(args){return get(email,'user','https://www.googleapis.com/drive/v3/changes',args);},
      readJSON:function(id){return get(email,'user',url+encodeURIComponent(id),{alt:'media',supportsAllDrives:true});},
      create:GoogleApi_.create,
      update:function(body,id,blob,args){
        if(!args.addParents&&!args.removeParents)return GoogleApi_.update(body,id,blob,args);
        if(c.DRY_RUN!=='false')throw new Error('DRY_RUN中の委任移動は禁止です。');
        return GoogleApi_.call('委任Drive移動',function(){
          var current=get(email,'user',url+encodeURIComponent(id),{supportsAllDrives:true,fields:'id,parents,driveId,properties'}),parents=current.parents||[],options=Object.assign({},args);
          if(current.driveId&&current.driveId!==c.SHARED_DRIVE_ID)throw new Error('別の共有ドライブからは移動しません。');
          if(parents.includes(args.addParents)){delete options.addParents;delete options.removeParents;}else{
            if(parents.length!==1||parents[0]!==args.removeParents)throw new Error('移動中に親が変更されました。自動で追いかけません。');
          }
          return request(email,'user',url+encodeURIComponent(id)+'?'+query(options),'patch',body);
        });
      }
    };
  }
  return {scopes:scopes,key:key,token:token,get:get,request:request,drive:drive};
})();
