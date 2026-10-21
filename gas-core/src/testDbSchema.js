// 本番スキーマからテスト用の作成リクエストを組み立てる純粋関数です。
var TestDbSchema_ = (function () {
  function id(value) { return String(value || '').replace(/-/g, '').toLowerCase(); }
  function scalarProperties(source) {
    var properties = Object.create(null), skipped = [];
    var simple = ['title', 'rich_text', 'date', 'people', 'files', 'checkbox', 'url', 'email', 'phone_number', 'created_time', 'created_by', 'last_edited_time', 'last_edited_by'];
    Object.keys(source).forEach(function (name) {
      var p = source[name], type = p.type, value = {};
      if (type === 'relation') return; // 全DB作成後に接続します。
      if (simple.includes(type)) value[type] = {};
      else if (type === 'number') value.number = p.number && p.number.format ? { format: p.number.format } : {};
      else if (type === 'select' || type === 'multi_select') {
        value[type] = { options: ((p[type] || {}).options || []).map(function (o) {
          var option = { name: o.name };
          if (o.color) option.color = o.color;
          return option;
        }) };
      } else {
        skipped.push({ name: name, type: type, reason: type === 'status' ? 'API 2025-09-03では独自のステータス選択肢を複製できません。' : '初期化で複製しない型です。' });
        return;
      }
      value.type = type;
      properties[name] = value;
    });
    if (Object.keys(properties).filter(function (n) { return properties[n].type === 'title'; }).length !== 1) throw new Error('タイトル項目が1つ必要です。');
    return { properties: properties, skipped: skipped };
  }
  function targetKey(relation, sources) {
    return Object.keys(sources).find(function (key) {
      return id(relation.data_source_id) && id(relation.data_source_id) === id(sources[key].sourceId) ||
        id(relation.database_id) && id(relation.database_id) === id(sources[key].databaseId);
    });
  }
  function relations(sources) {
    var edges = [], skipped = [], seen = new Set();
    Object.keys(sources).forEach(function (from) {
      var props = sources[from].properties;
      Object.keys(props).forEach(function (name) {
        var p = props[name];
        if (p.type !== 'relation' || seen.has(from + ':' + name)) return;
        var r = p.relation || {}, to = targetKey(r, sources);
        if (!to) { skipped.push({ name: name, type: 'relation', reason: '複製対象外のDBへのリレーションです。', database: from }); return; }
        var reverseName = null;
        if (from === 'minutes' && name === '関連するプロジェクト' && to === 'tasks' &&
            sources.tasks.properties['関連するMTG'] && sources.tasks.properties['関連するMTG'].type === 'relation' &&
            targetKey(sources.tasks.properties['関連するMTG'].relation || {}, sources) === 'minutes') {
          reverseName = '関連するMTG';
        } else if (r.type === 'dual_property') {
          var dual = r.dual_property || {};
          reverseName = Object.keys(sources[to].properties).find(function (n) {
            var other = sources[to].properties[n];
            return other.type === 'relation' && targetKey(other.relation || {}, sources) === from &&
              (n === dual.synced_property_name || other.id && other.id === dual.synced_property_id);
          });
          if (!reverseName) throw new Error('双方向リレーションの相手項目を特定できません: ' + name);
        }
        if (reverseName === name && from === to) throw new Error('自己参照の相手項目が同一です: ' + name);
        edges.push({ from: from, to: to, name: name, reverseName: reverseName });
        seen.add(from + ':' + name);
        if (reverseName) seen.add(to + ':' + reverseName);
      });
    });
    return { edges: edges, skipped: skipped };
  }
  function relationProperty(edge, targets) {
    var relation = { data_source_id: targets[edge.to].sourceId, type: edge.reverseName ? 'dual_property' : 'single_property' };
    if (edge.reverseName) relation.dual_property = { synced_property_name: edge.reverseName };
    else relation.single_property = {};
    return { type: 'relation', relation: relation };
  }
  function assertCompatible(actual, expected) {
    Object.keys(expected).forEach(function (name) {
      var a = actual[name], e = expected[name];
      if (!a || a.type !== e.type) throw new Error('既存テストDBの項目が異なります。上書きしません: ' + name);
      if (e.type === 'select' || e.type === 'multi_select') {
        var options = ((a[e.type] || {}).options || []).map(function (o) { return { name: o.name, color: o.color || 'default' }; });
        var wanted = e[e.type].options.map(function (o) { return { name: o.name, color: o.color || 'default' }; });
        if (JSON.stringify(options) !== JSON.stringify(wanted)) throw new Error('既存テストDBの選択肢が異なります: ' + name);
      }
      if (e.type === 'number' && e.number.format && (!a.number || a.number.format !== e.number.format)) throw new Error('既存テストDBの数値形式が異なります: ' + name);
    });
  }
  return { id: id, scalarProperties: scalarProperties, relations: relations, relationProperty: relationProperty, assertCompatible: assertCompatible };
})();
