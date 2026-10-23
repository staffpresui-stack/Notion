var Config_ = (function () {
  var defaults = { ENV: 'test', DRY_RUN: 'true', GENERATOR_MODE: 'GEMINI_NOTES',
    NOTION_VERSION: '2025-09-03', TASK_DB_MODE: 'single', NOTION_MTG_URL_SOURCE: 'none', NOTION_REQUESTER_TYPE: 'people' };
  // テスト対象を本番IDで代用しません。不明な値は安全側で拒否します。
  function inspect(values, profile) {
    var c = Object.assign({}, defaults, values), missing = [], errors = [];
    var required = ['LEDGER_SPREADSHEET_ID', 'NOTION_TOKEN', 'NOTION_DB_TLDV_INBOX'];
    if (c.ENV !== 'test') required.push('SHARED_DRIVE_ID');
    if (!['test', 'prod'].includes(c.ENV)) errors.push('ENV は test または prod を指定してください。');
    if (!['true', 'false'].includes(c.DRY_RUN)) errors.push('DRY_RUN は true または false を指定してください。');
    if(c.ENV==='prod'&&c.GENERATOR_MODE==='GEMINI_NOTES'&&typeof ServiceConfig_!=='undefined'){try{ServiceConfig_.load(c);}catch(e){errors.push(e.message);}return {ok:!errors.length&&!missing.length,missing:missing,errors:errors};}
    if (c.ENV !== 'test') errors.push('本番はGEMINI_NOTES専用です。');
    if (!['people', 'rich_text', 'email'].includes(c.NOTION_REQUESTER_TYPE)) errors.push('NOTION_REQUESTER_TYPE が不正です。');
    if (!['CHATGPT', 'LOCAL_CODEX','GEMINI_NOTES'].includes(c.GENERATOR_MODE)) errors.push('GENERATOR_MODE が不正です。');
    if (!['single', 'dual'].includes(c.TASK_DB_MODE)) errors.push('TASK_DB_MODE が不正です。');
    if (!['none', 'folder', 'meet'].includes(c.NOTION_MTG_URL_SOURCE)) errors.push('NOTION_MTG_URL_SOURCE が不正です。');
    required = required.concat(['FOLDER_SYSTEM_TEST_ID', 'NOTION_DB_MINUTES_TEST', 'NOTION_DB_TASKS_TEST']);
    if (c.CHATWORK_TOKEN) required.push('CHATWORK_ROOM_ID_TEST');
    if (c.TASK_DB_MODE === 'dual') required.push('NOTION_DB_NONPROJECT_TEST');
    // Notionの読み取り確認は、まだ使わないChatworkやDriveの設定で止めません。
    if (profile === 'notion') {
      required = ['NOTION_TOKEN', 'NOTION_DB_MINUTES_TEST', 'NOTION_DB_TASKS_TEST', 'NOTION_DB_TLDV_INBOX'];
      if (c.TASK_DB_MODE === 'dual') required.push('NOTION_DB_NONPROJECT_TEST');
    }
    required.forEach(function (k) { if (typeof c[k] !== 'string' || !c[k].trim()) missing.push(k); });
    ['NOTION_DB_MINUTES', 'NOTION_DB_TASKS', 'NOTION_DB_NONPROJECT', 'CHATWORK_ROOM_ID'].forEach(function (k) {
      if (c[k + '_TEST'] && c[k] === c[k + '_TEST']) errors.push(k + ' の本番用とテスト用が同じです。');
    });
    if (c.FOLDER_SYSTEM_ID && c.FOLDER_SYSTEM_ID === c.FOLDER_SYSTEM_TEST_ID) errors.push('本番用とテスト用のシステムフォルダが同じです。');
    var normalize = function (id) { return String(id || '').replace(/-/g, '').toLowerCase(); };
    ['NOTION_DB_MINUTES_TEST', 'NOTION_DB_TASKS_TEST', 'NOTION_DB_NONPROJECT_TEST', 'NOTION_DB_TLDV_INBOX'].forEach(function (k) {
      if (['4cf02dee7a114319ace1e866d6a1a914', 'e321f1cb33654a2c984447f34734a9d7'].includes(normalize(c[k]))) errors.push(k + ' に仕様書の本番DBは使えません。');
    });
    return { ok: !missing.length && !errors.length, missing: missing, errors: errors };
  }
  function load() { return Object.assign({}, defaults, PropertiesService.getScriptProperties().getProperties()); }
  function assertSafe(profile) {
    var c = load(), result = inspect(c, profile);
    if (!result.ok) throw new Error('設定を確認してください。不足: ' + result.missing.join('、') + '。' + result.errors.join(' '));
    return c;
  }
  return { inspect: inspect, load: load, assertSafe: assertSafe };
})();

function checkConfig() {
  if (typeof assertFinanceOperator_ === 'function') assertFinanceOperator_();
  var result = Config_.inspect(Config_.load());
  console.log(JSON.stringify(result));
  return result;
}

function checkNotionConfig() {
  if (typeof assertFinanceOperator_ === 'function') assertFinanceOperator_();
  var result = Config_.inspect(Config_.load(), 'notion');
  console.log(JSON.stringify(result));
  return result;
}
