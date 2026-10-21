function checkNotionConnection() {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('ENV') !== 'test' || p.getProperty('DRY_RUN') !== 'true') {
    throw new Error('ENV=test、DRY_RUN=true を設定してください。');
  }
  const token = p.getProperty('NOTION_TOKEN');
  const id = p.getProperty('NOTION_DB_MINUTES_TEST');
  if (!token || !id) throw new Error('NotionのトークンとテストDBのIDを設定してください。');
  const blocked = ['4cf02dee7a114319ace1e866d6a1a914', 'e321f1cb33654a2c984447f34734a9d7'];
  if (blocked.includes(id.replace(/-/g, '').toLowerCase())) throw new Error('テスト用DBを指定してください。');
  function get(path) {
    const r = UrlFetchApp.fetch('https://api.notion.com/v1/' + path, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token, 'Notion-Version': '2025-09-03' },
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) throw new Error('Notion接続: HTTP ' + r.getResponseCode());
    return JSON.parse(r.getContentText());
  }
  let data = get('databases/' + encodeURIComponent(id));
  if (!data.properties) {
    if (!data.data_sources || data.data_sources.length !== 1) {
      throw new Error('データソースを1つに特定できません。');
    }
    data = get('data_sources/' + encodeURIComponent(data.data_sources[0].id));
  }
  if (!data.properties) throw new Error('プロパティを取得できませんでした。');
  Object.keys(data.properties).forEach(function (name) {
    console.log(name + ': ' + data.properties[name].type);
  });
}
// コードはここまでです。
