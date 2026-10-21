var Stage2Content_ = (function () {
  function clean(value) { return String(value || '').replace(/https?:\/\/[^\s<>]+/gi, '（URL省略）'); }
  function rich(value) {
    var chars = Array.from(clean(value)), result = [];
    for (var i = 0; i < chars.length; i += 1000) result.push({ type: 'text', text: { content: chars.slice(i, i + 1000).join('') } });
    if (result.length > 100) throw new Error('本文の1段落が長すぎます。');
    return result;
  }
  function blocks(elements) {
    var result = [];
    elements.forEach(function (e) {
      if (e.type === 'table') {
        if (!e.rows.length) return;
        var width = e.rows[0].length;
        if (!width || e.rows.some(function (r) { return r.length !== width; })) throw new Error('表の列数が不正です。');
        for (var i = 0; i < e.rows.length; i += 100) result.push({ object: 'block', type: 'table', table: {
          table_width: width, has_column_header: true, has_row_header: false,
          children: e.rows.slice(i, i + 100).map(function (r) { return { object: 'block', type: 'table_row', table_row: { cells: r.map(rich) } }; })
        } });
      } else {
        var type = ['heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item'].includes(e.type) ? e.type : 'paragraph';
        if (!e.text) return;
        var b = { object: 'block', type: type }; b[type] = { rich_text: rich(e.text) }; result.push(b);
      }
    });
    for (var offset = 0; offset < result.length; offset += 100) {
      if (JSON.stringify(result.slice(offset, offset + 100)).length * 3 > 450000) throw new Error('本文がNotionのリクエスト上限に近いため処理を止めました。');
    }
    return result;
  }
  function read(id) {
    var body = DocumentApp.openById(id).getBody(), elements = [];
    for (var i = 0; i < body.getNumChildren(); i++) {
      var child = body.getChild(i), type = String(child.getType());
      if (type === 'TABLE') {
        var table = child.asTable(), rows = [];
        for (var r = 0; r < table.getNumRows(); r++) {
          var row = table.getRow(r), cells = [];
          for (var c = 0; c < row.getNumCells(); c++) cells.push(row.getCell(c).getText());
          rows.push(cells);
        }
        elements.push({ type: 'table', rows: rows });
      } else if (type === 'PARAGRAPH') {
        var paragraph = child.asParagraph(), heading = String(paragraph.getHeading());
        elements.push({ type: heading === 'HEADING2' || heading === 'HEADING1' ? 'heading_2' : heading === 'HEADING3' ? 'heading_3' : 'paragraph', text: paragraph.getText() });
      } else if (type === 'LIST_ITEM') {
        var item = child.asListItem(); elements.push({ type: /NUMBER|LATIN|ROMAN/.test(String(item.getGlyphType())) ? 'numbered_list_item' : 'bulleted_list_item', text: item.getText() });
      } else throw new Error('未対応の議事録要素があります: ' + type);
    }
    return blocks(elements);
  }
  function inline(value) {
    return clean(String(value||'').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
  }
  function cells(line) {
    var result=[],cell='',escaped=false;
    Array.from(line.trim()).forEach(function(c){
      if(escaped){cell+=(c==='|'||c==='\\')?c:'\\'+c;escaped=false;}
      else if(c==='\\')escaped=true;
      else if(c==='|'){result.push(cell.trim());cell='';}
      else cell+=c;
    });
    if(escaped)cell+='\\';result.push(cell.trim());
    if(line.trim().startsWith('|'))result.shift();
    if(result.length&&result[result.length-1]===''&&line.trim().endsWith('|'))result.pop();
    return result;
  }
  function markdown(text) {
    var lines=String(text||'').replace(/\r\n?/g,'\n').split('\n'),out=[],fenced=false;
    for(var i=0;i<lines.length;i++){
      var line=lines[i].trim(),match;
      if(/^```/.test(line)){fenced=!fenced;continue;}
      if(!line)continue;
      if(fenced){out.push({type:'paragraph',text:line});continue;}
      if(line.includes('|')&&i+1<lines.length){
        var divider=cells(lines[i+1]);
        if(divider.length&&divider.every(function(v){return /^:?-{3,}:?$/.test(v);})){
          var header=cells(line),rows=[header];if(header.length!==divider.length)throw new Error('Markdown表の列数が一致しません。');i+=2;
          for(;i<lines.length&&lines[i].trim()&&lines[i].includes('|');i++){var row=cells(lines[i]);if(row.length!==header.length)throw new Error('Markdown表の列数が一致しません。セル内の縦棒は\\|で記載してください。');rows.push(row);}i--;
          out.push({type:'table',rows:rows.map(function(r){return r.map(inline);})});continue;
        }
      }
      if((match=/^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)))out.push({type:match[1].length<=2?'heading_2':'heading_3',text:inline(match[2])});
      else if((match=/^[-*+]\s+(.+)$/.exec(line)))out.push({type:'bulleted_list_item',text:inline(match[1])});
      else if((match=/^\d+[.)]\s+(.+)$/.exec(line)))out.push({type:'numbered_list_item',text:inline(match[1])});
      else out.push({type:'paragraph',text:inline(line)});
    }
    if(fenced)throw new Error('Markdownのコード囲みが閉じていません。');
    return out;
  }
  function html(text) {
    function escape(v){return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
    var parts=['<!doctype html><html><head><meta charset="UTF-8"></head><body>'],list=null;
    markdown(text).forEach(function(e){
      var tag=e.type==='bulleted_list_item'?'ul':e.type==='numbered_list_item'?'ol':null;
      if(list!==tag){if(list)parts.push('</'+list+'>');if(tag)parts.push('<'+tag+'>');list=tag;}
      if(tag)parts.push('<li>'+escape(e.text)+'</li>');
      else if(e.type==='table'){
        parts.push('<table border="1"><thead><tr>'+e.rows[0].map(function(v){return '<th>'+escape(v)+'</th>';}).join('')+'</tr></thead><tbody>');
        e.rows.slice(1).forEach(function(row){parts.push('<tr>'+row.map(function(v){return '<td>'+escape(v)+'</td>';}).join('')+'</tr>');});parts.push('</tbody></table>');
      }else{var heading=e.type==='heading_2'?'h2':e.type==='heading_3'?'h3':'p';parts.push('<'+heading+'>'+escape(e.text)+'</'+heading+'>');}
    });
    if(list)parts.push('</'+list+'>');return parts.join('')+'</body></html>';
  }
  return { blocks: blocks, read: read, html: html, markdown: markdown };
})();

function seedFixtureInbox() {
  if (typeof assertFinanceOperator_ === 'function') assertFinanceOperator_();
  return Ledger_.withLock(function () {
    var c = Stage2Drive_.config(), drive = Stage2Drive_.open(c);
    drive.within(c.LEDGER_SPREADSHEET_ID);
    var ledger = Stage2Ledger_.open(SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID));
    if (c.DRY_RUN === 'true') { ledger.log('サンプル準備予定', 'inbox', '判定JSON・manifest・議事録Doc・ダミー文字起こしを3件準備します。'); return; }
    var raw = drive.folder(drive.root.id, '00_受信', false), inbox = drive.folder(drive.root.id, 'inbox', false), done = drive.folder(inbox.id, '_done', false);
    function ensure(parent, name, text, mime, kind, key) {
      var matches = drive.children(parent).filter(function (f) { return f.name === name; });
      if (matches.length > 1) throw new Error('同名サンプルが複数あります: ' + name);
      if (matches.length && (matches[0].appProperties || {}).meeting_key !== key) throw new Error('既存ファイルは上書きしません: ' + name);
      return matches[0] || drive.createFile(parent, name, text, mime, kind, key);
    }
    NotionFixtures_.judgements.forEach(function (original) {
      var j = JSON.parse(JSON.stringify(original)), key = j.meeting_key, folderKey = key.replace(/:/g, '_');
      if (ledger.rows('minutes').some(function (r) { return r.meeting_key === key; }) || drive.children(done.id).some(function (f) { return f.name === folderKey + '.json'; })) { console.log('準備済み・処理済みのサンプルは再投入しません: ' + key); return; }
      var folder = drive.folder(raw.id, folderKey, true), manifest = JSON.parse(JSON.stringify(NotionFixtures_.manifests.find(function (m) { return m.meeting_key === key; })));
      var text = '基本情報\n' + manifest.title + '\n決定事項\n' + j.summary.decisions.join('\n') + '\nネクストアクション\n' + j.summary.next_actions.map(function (a) { return a.who + '／' + a.what + '／' + (a.due || '期日：要確認'); }).join('\n');
      var minutes = ensure(inbox.id, folderKey + '_議事録', Stage2Content_.html(text), 'application/vnd.google-apps.document', 'minutes', key);
      var kind = manifest.source === 'tldv' ? 'tldv_transcript' : 'transcript';
      var transcript = ensure(folder.id, '文字起こし（検証用ダミー）', Stage2Content_.html('これは検証専用のダミー文字起こしです。\n' + text), 'application/vnd.google-apps.document', kind, key);
      manifest.files = {}; manifest.files[kind] = transcript.id; manifest.missing = manifest.source === 'meet' ? ['recording', 'gemini'] : [];
      ensure(folder.id, 'manifest.json', JSON.stringify(manifest), 'application/json', 'manifest', key);
      j.minutes_doc_id = minutes.id;
      ensure(inbox.id, folderKey + '.json', JSON.stringify(j), 'application/json', 'judgement', key);
      console.log('サンプルを準備しました: ' + key);
    });
  });
}
