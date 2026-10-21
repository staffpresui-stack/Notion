var InboxPlan_ = (function () {
  function mergeOptions(existing) {
    var required = ['未処理', '取り込み済み', '対象外（Meet優先）', 'エラー'];
    var names = existing.map(function (o) { return o.name; });
    var added = required.filter(function (n) { return !names.includes(n); });
    return { added: added, options: existing.map(function (o) {
      var result = { name: o.name }; if (o.id) result.id = o.id; if (o.color) result.color = o.color; return result;
    }).concat(added.map(function (name) { return { name: name }; })) };
  }
  // 提供されたJSON Schemaで使うキーワードをGAS内で検証します。外部コードは読み込みません。
  function validate(value, schema, path) {
    path = path || '$'; var errors = [], types = Array.isArray(schema.type) ? schema.type : [schema.type];
    var type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (schema.type && !types.includes(type)) return [path + ': 型が不正です。'];
    if (schema.enum && !schema.enum.includes(value)) errors.push(path + ': 選択肢が不正です。');
    if (typeof value === 'string') {
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(path + ': 形式が不正です。');
      if (schema.maxLength && Array.from(value).length > schema.maxLength) errors.push(path + ': 長すぎます。');
    }
    if (type === 'object') {
      (schema.required || []).forEach(function (key) { if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(path + '.' + key + ': 必須です。'); });
      Object.keys(value).forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(schema.properties || {}, key)) errors = errors.concat(validate(value[key], schema.properties[key], path + '.' + key));
        else if (schema.additionalProperties === false) errors.push(path + '.' + key + ': 未定義の項目です。');
      });
    }
    if (type === 'array') {
      if (schema.uniqueItems && new Set(value.map(function (v) { return JSON.stringify(v); })).size !== value.length) errors.push(path + ': 重複があります。');
      value.forEach(function (v, i) { if (schema.items) errors = errors.concat(validate(v, schema.items, path + '[' + i + ']')); });
    }
    return errors;
  }
  function judgement(input) {
    var data = JSON.parse(JSON.stringify(input)), warnings = [], choices = ['セールス・マーケ', 'EC', '生産管理', '経理・バックオフィス', 'Salesforce・AI', '経営'];
    if (Array.isArray(data.domains)) data.domains = data.domains.filter(function (d) { if (choices.includes(d)) return true; warnings.push('未定義の事業部領域を除外しました。'); return false; });
    var errors = validate(data, InboxJudgementSchema_);
    if (errors.length) throw new Error('判定JSONが不正です: ' + errors.join(' '));
    return { data: data, warnings: warnings };
  }
  function safeName(value) {
    var chars = { '\\': '＼', '/': '／', ':': '：', '*': '＊', '?': '？', '"': '＂', '<': '＜', '>': '＞', '|': '｜' };
    return Array.from(String(value || '会議').replace(/[\\/:*?"<>|]/g, function (c) { return chars[c]; })).slice(0, 40).join('');
  }
  function card(row, reviewUrl) {
    function clean(v) { return String(v || '').replace(/https?:\/\/[^\s<>]+/gi, '（URL省略）').replace(/\[/g, '［').replace(/\]/g, '］'); }
    function date(value, timeOnly) {
      var valueMs = Date.parse(value);
      if (!Number.isFinite(valueMs)) return '日時：要確認';
      var local = new Date(valueMs + 9 * 60 * 60 * 1000), iso = local.toISOString();
      return timeOnly ? iso.slice(11, 16) : Number(iso.slice(5, 7)) + '/' + Number(iso.slice(8, 10)) + '(' + '日月火水木金土'[local.getUTCDay()] + ') ' + iso.slice(11, 16);
    }
    function values(value) { try { var data = JSON.parse(value || '[]'); return Array.isArray(data) ? data : []; } catch (e) { return []; } }
    var body = '[info][title]【' + clean(row.status) + '】議事録の格納先を確認してください（' + clean(row.display_id) + '）[/title]\n' +
      date(row.event_start, false) + '–' + date(row.event_end, true) + '　' + clean(row.title) + '（' + (row.source === 'meet' ? 'Meet' : row.source === 'tldv' ? 'tl;dv' : '記録元：要確認') + '）' +
      '\nDrive：' + clean(row.placement_final).replace('/', ' ＞ ') + '\nNotion：' + clean(row.minutes_title) + '（' + clean(row.notion_status) + '）' +
      '\n事業部領域：' + clean(values(row.domains_final).join('／') || '未設定') + '／関連PJ：' + values(row.related_project_ids_final).length + '件' +
      '\n根拠：' + clean(row.reason) + '（確信度 ' + clean(row.confidence) + '）';
    if (/^https:\/\/script\.google\.com\/(?:a\/macros\/[^/]+\/)?s\/[A-Za-z0-9_-]+\/exec$/.test(reviewUrl || '')) body += '\n確認画面：' + reviewUrl;
    else body += '\n確認画面はまだ公開していません。';
    return body + '[/info]';
  }
  return { mergeOptions: mergeOptions, validate: validate, judgement: judgement, safeName: safeName, card: card };
})();
