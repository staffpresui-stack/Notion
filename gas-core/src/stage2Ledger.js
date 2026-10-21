var Stage2Ledger_ = (function () {
  function text(value) { var s = String(value === undefined || value === null ? '' : value); return /^[=+@]/.test(s) ? "'" + s : s; }
  function initialize(book) {
    var plan = Ledger_.plan(book); // 全シートの見出しを先に確認し、既存データは上書きしません。
    plan.forEach(function (p) {
      var sheet = book.getSheetByName(p.sheet) || book.insertSheet(p.sheet);
      if (!sheet.getLastRow()) sheet.appendRow(p.headers);
    });
  }
  function open(book, fast) {
    var snapshots = {};
    if (!fast) Ledger_.plan(book).forEach(function (p) { if (p.action !== '変更なし') throw new Error('台帳が未初期化です。setupTestWorkspaceを実行してください。'); });
    function rows(name) {
      if (fast && snapshots[name]) return snapshots[name];
      var sheet = book.getSheetByName(name), headers = Ledger_.headers[name].split(',');
      if (!sheet || !sheet.getLastRow()) throw new Error('台帳が未初期化です: ' + name);
      if (fast) {
        var values=sheet.getRange(1,1,sheet.getLastRow(),Math.max(headers.length,sheet.getLastColumn())).getValues();
        if (JSON.stringify(values[0])!==JSON.stringify(headers)) throw new Error(name+' の見出しが仕様と異なります。上書きしません。');
        snapshots[name]=values.slice(1).map(function(values,i){var r={_row:i+2};headers.forEach(function(h,j){r[h]=values[j];});return r;}); return snapshots[name];
      }
      return sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues().map(function (values, i) {
        var r = { _row: i + 2 }; headers.forEach(function (h, j) { r[h] = values[j]; }); return r;
      });
    }
    function append(name, data) {
      if (fast) rows(name);
      var sheet = book.getSheetByName(name), values = Ledger_.headers[name].split(',').map(function (h) { return text(data[h]); });
      sheet.appendRow(values); data._row = sheet.getLastRow(); if (fast && snapshots[name]) snapshots[name].push(data); return data;
    }
    function save(row) {
      row.version = Number(row.version || 0) + 1; row.updated_at = new Date().toISOString();
      if (!row._row) return append('minutes', row);
      if (fast) rows('minutes');
      if (fast) snapshots.minutes = snapshots.minutes.map(function(r){return r._row===row._row ? row : r;});
      var headers = Ledger_.headers.minutes.split(',');
      book.getSheetByName('minutes').getRange(row._row, 1, 1, headers.length).setValues([headers.map(function (h) { return text(row[h]); })]);
      return row;
    }
    function list(value) {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      try { var a = JSON.parse(value); if (Array.isArray(a)) return a; } catch (e) { /* カンマ形式も受け付けます。 */ }
      return String(value).split(',').map(function (v) { return v.trim(); }).filter(Boolean);
    }
    function masters() {
      return { folders: rows('masters_folders'), clients: rows('masters_clients').map(function (r) { return Object.assign({}, r, { domains: list(r.domains) }); }),
        internal: rows('masters_internal').map(function (r) { return r.email_or_domain; }), people: rows('masters_people') };
    }
    function log(action, target, summary) { Ledger_.dryLog(book, action, target, typeof summary === 'string' ? summary : JSON.stringify(summary)); }
    function displayId(start) {
      var prefix = 'MTG-' + Utilities.formatDate(new Date(start), 'Asia/Tokyo', 'yyMMdd') + '-';
      var next = rows('minutes').filter(function (r) { return String(r.display_id).startsWith(prefix); }).reduce(function (max, r) { return Math.max(max, Number(String(r.display_id).slice(prefix.length)) || 0); }, 0) + 1;
      return prefix + String(next).padStart(2, '0');
    }
    return { rows: rows, append: append, save: save, masters: masters, log: log, displayId: displayId };
  }
  return { initialize: initialize, open: open };
})();
