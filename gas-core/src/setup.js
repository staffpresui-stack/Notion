function dumpNotionSchemas() {
  var c = Config_.assertSafe('notion');
  var keys = ['NOTION_DB_MINUTES_TEST', 'NOTION_DB_TASKS_TEST', 'NOTION_DB_TLDV_INBOX'];
  if (c.TASK_DB_MODE === 'dual') keys.push('NOTION_DB_NONPROJECT_TEST');
  var result = keys.map(function (key) {
    var schema = Notion_.schema(c[key], c);
    var properties = Object.keys(schema.properties).map(function (name) { return { name: name, type: schema.properties[name].type }; });
    // 認証情報・本文・参加者は出力せず、設定照合に必要なスキーマだけを返します。
    var expected = key === 'NOTION_DB_MINUTES_TEST' ? {
      '議事録名': ['title'], '日付': ['date'], '参加者': ['people'], 'MTG URL': ['url'],
      '事業部領域': ['multi_select'], '関連するプロジェクト': ['relation']
    } : key === 'NOTION_DB_TLDV_INBOX' ? { '取り込み状態': ['select'], 'meeting_key': ['rich_text'] } : {
      'プロジェクト/タスク名': ['title'], 'ステータス': ['status', 'select'], '期日': ['date'],
      '担当者': ['people'], '備考': ['rich_text'], '完了条件': ['rich_text'],
      '事業部領域': ['multi_select'], '関連するMTG': ['relation'], '親アイテム': ['relation']
    };
    var differences = Object.keys(expected).filter(function (name) {
      return !schema.properties[name] || !expected[name].includes(schema.properties[name].type);
    }).map(function (name) { return { name: name, expected: expected[name], actual: schema.properties[name] ? schema.properties[name].type : '未設定' }; });
    return { config_key: key, data_source_id: schema.data_source_id || null, properties: properties, differences: differences };
  });
  console.log(JSON.stringify(result));
  return result;
}

function initLedger() {
  var c = Config_.assertSafe();
  DriveUtil_.verifyTestRoot(c);
  return Ledger_.withLock(function () {
    var book = SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID);
    var plan = Ledger_.plan(book);
    // DRY_RUN中の例外は仕様で認められた dry_run_log への記録だけです。
    Ledger_.dryLog(book, '台帳初期化の計画', 'テスト用台帳', JSON.stringify(plan));
    console.log('台帳初期化の計画を記録しました。業務用シートは変更していません。');
    return { applied: false, plan: plan };
  });
}

function registerFolders() {
  var c = Config_.assertSafe();
  var root = DriveUtil_.verifyTestRoot(c);
  var internal = DriveUtil_.exact(root.id, '社内', c.SHARED_DRIVE_ID);
  var external = DriveUtil_.exact(root.id, '社外', c.SHARED_DRIVE_ID);
  var rows = [];
  ['事業部全体', 'セールス・マーケ', 'EC', '生産管理', '経理・バックオフィス', 'Salesforce・AI', '経営'].forEach(function (name) {
    var folder = DriveUtil_.exact(internal.id, name, c.SHARED_DRIVE_ID);
    rows.push({ placement: '社内/' + name, drive_folder_id: folder.id, notion_domain: name === '事業部全体' ? '' : name, rank: '' });
  });
  // 顧客は台帳マスタに存在する名前だけに限定し、フォルダは作りません。
  var book = SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID);
  var sheet = book.getSheetByName('masters_clients');
  if (!sheet || !sheet.getLastRow()) throw new Error('顧客マスタが未準備です。テスト用台帳を準備してください。');
  if (JSON.stringify(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]) !== JSON.stringify(Ledger_.headers.masters_clients.split(','))) throw new Error('顧客マスタの見出しを確認してください。');
  var clients = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues() : [];
  clients.forEach(function (r) {
    if (!r[0]) return;
    var f = DriveUtil_.exact(external.id, String(r[0]).replace(/\//g, '・'), c.SHARED_DRIVE_ID);
    rows.push({ placement: '社外/' + r[0], drive_folder_id: f.id, notion_domain: '', rank: '' });
  });
  return Ledger_.withLock(function () {
    Ledger_.dryLog(book, 'フォルダ登録の計画', 'masters_folders', JSON.stringify(rows));
    return { applied: false, rows: rows };
  });
}
