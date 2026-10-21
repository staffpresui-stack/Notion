var Notion_ = (function () {
  // 公式SDKのデータソースAPIに合わせ、読み取りだけを実装します。
  function get(path, c) {
    var response = UrlFetchApp.fetch('https://api.notion.com/v1/' + path, {
      method: 'get', headers: { Authorization: 'Bearer ' + c.NOTION_TOKEN, 'Notion-Version': c.NOTION_VERSION },
      muteHttpExceptions: true
    });
    var status = response.getResponseCode();
    // 応答本文は認証情報やデータを含む可能性があるためログに出しません。
    if (status < 200 || status >= 300) throw new Error('Notion の読み取りに失敗しました。HTTP ' + status);
    return JSON.parse(response.getContentText());
  }
  function schema(databaseId, c) {
    var db = get('databases/' + encodeURIComponent(databaseId), c);
    if (db.properties) return { database_id: databaseId, properties: db.properties };
    if (!db.data_sources || db.data_sources.length !== 1) throw new Error('データソースが複数または未設定です。対象を確認してください。');
    var ds = get('data_sources/' + encodeURIComponent(db.data_sources[0].id), c);
    if (!ds.properties) throw new Error('Notion のプロパティを取得できませんでした。');
    return { database_id: databaseId, data_source_id: ds.id, properties: ds.properties };
  }
  return { schema: schema };
})();
