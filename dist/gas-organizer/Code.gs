// config.js
function checkOrganizerConfig() {
  var c = PropertiesService.getScriptProperties().getProperties();
  var required = ['SHARED_DRIVE_ID', 'FOLDER_INBOX_RAW_TEST_ID'];
  var missing = required.filter(function (k) { return !c[k] || !c[k].trim(); });
  var errors = [];
  if ((c.ENV || 'test') !== 'test' || (c.DRY_RUN || 'true') !== 'true') errors.push('開発中は ENV=test、DRY_RUN=true が必要です。');
  if (c.FOLDER_INBOX_RAW_ID && c.FOLDER_INBOX_RAW_ID === c.FOLDER_INBOX_RAW_TEST_ID) errors.push('本番用とテスト用の受信フォルダが同じです。');
  var result = { ok: !missing.length && !errors.length, missing: missing, errors: errors };
  console.log(JSON.stringify(result));
  return result;
}
