var OrganizerDrive_=(function(){
  var folderMime='application/vnd.google-apps.folder';
  function open(c,api){
    api=api||GoogleApi_;
    var cache={};
    function get(id,fresh){if(fresh)delete cache[id];return cache[id]||(cache[id]=api.get(id,{supportsAllDrives:true,fields:'id,name,mimeType,parents,driveId,trashed,ownedByMe,owners(emailAddress),capabilities(canEdit,canAddChildren,canMoveItemOutOfDrive),appProperties,properties'}));}
    var root=get(c.FOLDER_SYSTEM_TEST_ID),system=get(c.FOLDER_SYSTEM_ID),raw=get(c.FOLDER_INBOX_RAW_TEST_ID);
    function folderCheck(f,name,parent){if(f.trashed||f.mimeType!==folderMime||f.name!==name||f.driveId!==c.SHARED_DRIVE_ID||!f.parents||f.parents.length!==1||f.parents[0]!==parent)throw new Error('指定の共有ドライブ配下のフォルダではありません: '+name);}
    folderCheck(system,'_system',c.SHARED_DRIVE_ID);if(c.ENV==='prod'){if(root.id!==system.id)throw new Error('本番ルートが違います。');}else folderCheck(root,'_test',system.id);folderCheck(raw,'00_受信',root.id);
    if(raw.capabilities&&raw.capabilities.canAddChildren===false)throw new Error('受信フォルダへ追加する権限がありません。');
    function write(){if(c.DRY_RUN!=='false')throw new Error('DRY_RUN中のDrive書き込みは禁止です。');}
    function list(parent){var out=[],token;do{var args={q:"'"+parent.replace(/'/g,"\\'")+"' in parents and trashed=false",corpora:'drive',driveId:c.SHARED_DRIVE_ID,includeItemsFromAllDrives:true,supportsAllDrives:true,pageSize:100,fields:'nextPageToken,files(id,name,mimeType,parents,properties,appProperties,driveId,trashed)'};if(token)args.pageToken=token;var r=api.list(args);out=out.concat(r.files||[]);token=r.nextPageToken;}while(token);return out;}
    function child(parent,name,role,meetingKey,create){if(![root.id,raw.id].includes(parent))throw new Error('許可された親フォルダではありません。');var matches=list(parent).filter(function(f){return f.name===name;});if(matches.length>1)throw new Error('同名フォルダが重複しています。');if(matches.length){var f=matches[0];if(f.mimeType!==folderMime || !f.properties || f.properties.minutes_role!==role || meetingKey&&f.properties.meeting_key!==meetingKey)throw new Error('同名の既存フォルダの用途を確認できません。上書きしません。');return f;}if(!create)return null;write();var props={minutes_role:role,minutes_env:c.ENV};if(meetingKey)props.meeting_key=meetingKey;return api.create({name:name,mimeType:folderMime,parents:[parent],properties:props},null,{supportsAllDrives:true,fields:'id,name,mimeType,parents,properties'});}
    function json(parent,name,value,role){write();var p=get(parent,true);if(p.driveId!==c.SHARED_DRIVE_ID||!p.parents||p.parents.length!==1||![root.id,raw.id].includes(p.parents[0]))throw new Error('登録・会議フォルダの所属が不正です。');var matches=list(parent).filter(function(f){return f.name===name;});if(matches.length>1)throw new Error('同名JSONが重複しています。');var props={minutes_role:role,minutes_env:c.ENV},blob=Utilities.newBlob(JSON.stringify(value,null,2),'application/json',name);if(matches.length){var f=matches[0];if(f.mimeType!=='application/json'||!f.properties||f.properties.minutes_role!==role)throw new Error('既存JSONの用途を確認できません。');return api.update({properties:props},f.id,blob,{supportsAllDrives:true,fields:'id'});}return api.create({name:name,mimeType:'application/json',parents:[parent],properties:props},blob,{supportsAllDrives:true,fields:'id'});}
    function validateSource(file,folder,key,email){
      if(file.trashed || file.mimeType==='application/vnd.google-apps.shortcut')throw new Error('削除済み添付・ショートカットは移動しません。');
      var privateMark=(file.appProperties||{}).meeting_key,publicMark=(file.properties||{}).meeting_key;
      if(privateMark&&publicMark&&privateMark!==publicMark)throw new Error('添付の会議目印が矛盾しています。');
      var mark=publicMark||privateMark;if(mark&&mark!==key)throw new Error('添付が別の会議に登録済みです。');
      if(file.driveId){if(file.driveId!==c.SHARED_DRIVE_ID||!folder||!file.parents||file.parents.length!==1||file.parents[0]!==folder.id||mark!==key)throw new Error('自分のマイドライブまたは今回の受信フォルダ以外にある添付は移動しません。');return;}
      if(!file.ownedByMe || (file.owners||[]).length && !file.owners.some(function(o){return String(o.emailAddress||'').toLowerCase()===email;}) || !file.parents || file.parents.length!==1 || file.capabilities&& (file.capabilities.canEdit===false || file.capabilities.canMoveItemOutOfDrive===false))throw new Error('添付の所有者・共有ドライブへの移動権限を確認してください。');
    }
    function move(file,folder,key,kind,email){write();file=get(file.id,true);if(MoverPlan_.kind(file)!==kind)throw new Error('実行直前に添付の種類が変わりました。');validateSource(file,folder,key,email);if(file.driveId)return;api.update({appProperties:Object.assign({},file.appProperties||{},{meeting_key:key,kind:kind}),properties:Object.assign({},file.properties||{},{meeting_key:key,kind:kind,minutes_env:c.ENV})},file.id,null,{addParents:folder.id,removeParents:file.parents[0],supportsAllDrives:true,fields:'id,parents,driveId'});delete cache[file.id];}
    return {root:root,raw:raw,get:get,list:list,child:child,json:json,validateSource:validateSource,move:move,docsGet:api.docsGet};
  }
  return {open:open};
})();
