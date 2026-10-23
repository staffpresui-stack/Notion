var Organizer_ = (function () {
  var finance='finance@premiere-mode.co.jp';
  var ids={SHARED_DRIVE_ID:'0ALo4SlMVSpXdUk9PVA',FOLDER_SYSTEM_ID:'1UbflVH7ITQBN6INYyAQyn7fy77CWl4wH',FOLDER_SYSTEM_TEST_ID:'1pKWcGDuRCBf3VG0AfKBaKghE0nD3kYwW',FOLDER_INBOX_RAW_TEST_ID:'1Hip4qiyC3sUsPhqCj8JGAFKj8zLaUHaC'};
  function actor(trigger) {
    var active=String(Session.getActiveUser().getEmail()||'').toLowerCase(), effective=String(Session.getEffectiveUser().getEmail()||'').toLowerCase();
    var email=trigger?effective:active;
    if(!email || !/^[^@\s]+@premiere-mode\.co\.jp$/.test(email) || !effective || effective!==email || active && active!==effective) throw new Error('会社Workspaceアカウント本人として実行してください。所有者として代理実行するWebアプリでは使えません。');
    return email;
  }
  function config() {
    var c=PropertiesService.getScriptProperties().getProperties();
    if(!['test','prod'].includes(c.ENV) || !['true','false'].includes(c.DRY_RUN)) throw new Error('ENV=test/prodと明示的なDRY_RUNが必要です。');
    var expected=Object.assign({},ids);if(c.ENV==='prod'){expected.FOLDER_SYSTEM_TEST_ID=ids.FOLDER_SYSTEM_ID;expected.FOLDER_INBOX_RAW_TEST_ID='1jNifZBBUN0QNMWdA_hI2J5YY2PbqtxoB';if(c.FOLDER_INBOX_RAW_ID!==expected.FOLDER_INBOX_RAW_TEST_ID||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(c.PRODUCTION_START_AT||'')||!Number.isFinite(Date.parse(c.PRODUCTION_START_AT)))throw new Error('本番受信IDとPRODUCTION_START_ATが必要です。');c.FOLDER_SYSTEM_TEST_ID=c.FOLDER_SYSTEM_ID;c.FOLDER_INBOX_RAW_TEST_ID=c.FOLDER_INBOX_RAW_ID;}
    Object.keys(expected).forEach(function(k){if(c[k]!==expected[k])throw new Error(k+'がENVに対応する共有ドライブ・受信領域と一致しません。');});
    c.MOVER_MODE=c.MOVER_MODE||'TEST_EVENT';
    if(!['TEST_EVENT','AUTO'].includes(c.MOVER_MODE))throw new Error('MOVER_MODEはTEST_EVENTまたはAUTOです。');
    c.MOVER_MEMO_WAIT_MIN=Number(c.MOVER_MEMO_WAIT_MIN||120);
    if(!Number.isInteger(c.MOVER_MEMO_WAIT_MIN)||c.MOVER_MEMO_WAIT_MIN<20||c.MOVER_MEMO_WAIT_MIN>2880)throw new Error('MOVER_MEMO_WAIT_MINは20〜2880です。');
    c.MOVER_INTERVAL_MIN=Number(c.MOVER_INTERVAL_MIN||15);c.MOVER_WAIT_MIN=Number(c.MOVER_WAIT_MIN||20);
    if(![1,5,10,15,30].includes(c.MOVER_INTERVAL_MIN))throw new Error('MOVER_INTERVAL_MINは1・5・10・15・30です。');
    if(!Number.isInteger(c.MOVER_WAIT_MIN)||c.MOVER_WAIT_MIN<0||c.MOVER_WAIT_MIN>1440)throw new Error('MOVER_WAIT_MINは0〜1440です。');
    return c;
  }
  function lock(fn) {var l=LockService.getScriptLock();if(!l.tryLock(1000))throw new Error('別の処理が実行中です。後でもう一度実行してください。');try{return fn();}finally{l.releaseLock();}}
  function hash(v){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,v,Utilities.Charset.UTF_8).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
  function nonce(email){var n=Utilities.getUuid();CacheService.getUserCache().put('organizer:'+n,email,1800);return n;}
  function verify(email,n){if(typeof n!=='string'||n.length>100||CacheService.getUserCache().get('organizer:'+n)!==email)throw new Error('画面の期限が切れました。読み直してください。');}
  return {actor:actor,config:config,lock:lock,hash:hash,nonce:nonce,verify:verify};
})();
function checkOrganizerConfig(){var email=Organizer_.actor(false),c=Organizer_.config();var drive=OrganizerDrive_.open(c);console.log('GAS-B設定を確認しました。利用者：'+email+'、移動先：'+drive.raw.id+'、DRY_RUN='+c.DRY_RUN);return {ok:true,email:email,dryRun:c.DRY_RUN==='true',rawId:drive.raw.id};}
