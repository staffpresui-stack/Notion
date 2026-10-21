var InboxIngest_ = (function () {
  function hash(value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(value), Utilities.Charset.UTF_8).map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join(''); }
  function state(row) { return row && row.step_done_json ? JSON.parse(row.step_done_json) : {}; }
  function run(onlyMeetingKey) {
    var c = Stage2Drive_.config(), drive = Stage2Drive_.open(c);
    drive.within(c.LEDGER_SPREADSHEET_ID);
    if (c.CHATWORK_TOKEN && (!/^\d+$/.test(c.CHATWORK_ROOM_ID_TEST || '') || c.CHATWORK_ROOM_ID_TEST === c.CHATWORK_ROOM_ID)) throw new Error('Chatworkのテスト専用ルームIDが必要です。');
    var ledger = Stage2Ledger_.open(SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID)), masters = ledger.masters();
    var env = NotionTestEnvironment_.open(true), minutes = env.schema(env.ids.minutes, 'minutes'), tasks = env.schema(env.ids.tasks, 'tasks');
    var inbox = drive.folder(drive.root.id, 'inbox', false), done = drive.folder(inbox.id, '_done', false), raw = drive.folder(drive.root.id, '00_受信', false);
    var rows = ledger.rows('minutes'), children = drive.children(inbox.id), files = children.filter(function (f) {
      if (!f.name.endsWith('.json')) return false;
      return !f.name.startsWith('local_') || LocalInboxReady_.check(drive, f, children);
    });
    rows.forEach(function (r) { var s = state(r); if (s.jsonId && !s.finished && !s.error && !files.some(function (f) { return f.id === s.jsonId; })) files.push(drive.within(s.jsonId)); });
    files = files.filter(function (f) { return !rows.some(function (r) { var s = state(r); return s.jsonId === f.id && s.error && s.modifiedTime === f.modifiedTime; }); });
    if (onlyMeetingKey) { var target = rows.find(function (r) { return r.meeting_key === onlyMeetingKey; }); var targetId = state(target).jsonId; files = files.filter(function (f) { return f.id === targetId; }); }
    files.sort(function (a, b) { return String(a.createdTime || '').localeCompare(String(b.createdTime || '')) || a.id.localeCompare(b.id); });
    var results = [], started = Date.now();
    files.slice(0, c.INGEST_BATCH).forEach(function (file) {
      if (Date.now() - started > 240000) return;
      var row = null, steps = {}, key = 'invalid:' + file.id;
      function save() { row.step_done_json = JSON.stringify(steps); ledger.save(row); }
      try {
        if (file.name.startsWith('local_') && !LocalInboxReady_.check(drive, file, drive.children(inbox.id).concat(drive.children(done.id)))) return;
        var parsed = InboxPlan_.judgement(drive.readJSON(file.id)), j = parsed.data; key = j.meeting_key;
        if ((file.appProperties || {}).meeting_key && file.appProperties.meeting_key !== key) throw new Error('JSONファイルの会議マーカーと内容が一致しません。');
        if (key.length > 180) throw new Error('会議キーが長すぎます。');
        var prior = ledger.rows('minutes').find(function (r) { return r.meeting_key === key; });
        if (prior && state(prior).jsonId !== file.id) throw new Error('同じmeeting_keyの別JSONがあります。既存の行は変更しません。');
        row = prior || null; steps = state(row);
        if (steps.hash && steps.hash !== hash(j)) throw new Error('取り込み中に判定JSONが変更されました。');
        if (steps.finished) { results.push({ meeting_key: key, status: '取り込み済み' }); return; }
        var folder = steps.rawFolderId ? drive.within(steps.rawFolderId) : drive.folder(raw.id, key.replace(/:/g, '_'), false);
        var manifests = steps.manifestId ? [drive.within(steps.manifestId)] : drive.children(folder.id).filter(function (f) { return f.name === 'manifest.json'; });
        if (manifests.length !== 1) throw new Error('manifest.jsonを1件に特定できません。');
        var manifest = drive.readJSON(manifests[0].id);
        if (manifest.status !== 'ready' || manifest.meeting_key !== key || manifest.source !== j.source || !Number.isFinite(Date.parse(manifest.start))) throw new Error('manifestの状態・会議キー・日時が不正です。');
        var allowedKinds = ['recording', 'transcript', 'gemini', 'tldv_transcript'], rawFiles = [];
        Object.keys(manifest.files || {}).forEach(function (kind) {
          if (!allowedKinds.includes(kind)) throw new Error('manifestに未定義のファイル種別があります。');
          if (manifest.source === 'tldv' && kind === 'recording') { console.log('tl;dvの録画は管理対象外のため移動しません。'); return; }
          var f = drive.within(manifest.files[kind]);
          if ((f.appProperties || {}).meeting_key && f.appProperties.meeting_key !== key) throw new Error('生データの会議マーカーが違います。');
          if (f.mimeType === 'application/vnd.google-apps.folder' || !(f.parents || []).some(function (p) { return p === folder.id || row && p === row.meeting_folder_id; })) throw new Error('生データが会議の受信・格納フォルダ内にありません。');
          rawFiles.push({ id: f.id, kind: kind });
        });
        if (manifest.transcript_text) {
          var exported = drive.within(manifest.transcript_text.file_id);
          if (exported.mimeType !== 'text/plain' || exported.name !== 'transcript.txt' || !(exported.parents || []).some(function(p){return p === folder.id || row && p === row.meeting_folder_id;})) throw new Error('書き出した文字起こしが会議フォルダ内にありません。');
          if (!rawFiles.some(function(f){return f.id === exported.id;})) rawFiles.push({id:exported.id,kind:'transcript_text'});
        }
        var docId = steps.minutesDocId || j.minutes_doc_id, blocks;
        if (docId) {
          var doc = drive.within(docId);
          if ((doc.appProperties || {}).meeting_key && doc.appProperties.meeting_key !== key) throw new Error('議事録Docの会議マーカーが違います。');
          if (doc.mimeType !== 'application/vnd.google-apps.document' || !(doc.parents || []).some(function (p) { return p === inbox.id || row && p === row.meeting_folder_id; })) throw new Error('議事録Docがinbox・格納フォルダ内にありません。');
          blocks = Stage2Content_.read(docId);
        } else if (j.minutes_markdown) blocks = Stage2Content_.blocks(Stage2Content_.markdown(j.minutes_markdown));
        else throw new Error('議事録Docまたはminutes_markdownが必要です。');
        if (!blocks.length) throw new Error('議事録本文が空です。');
        if (steps.contentHash && steps.contentHash !== hash(blocks)) throw new Error('取り込み中に議事録本文が変更されました。');
        var projects = j.related_project_ids.map(function (id) { return env.project(id); }).filter(Boolean);
        var plan = NotionFixturePlan_.plan(j, manifest, masters, minutes, tasks, projects); plan.payload.children = blocks;
        var destination = plan.placement.placement === '00_仕分け待ち' ? drive.folder(drive.root.id, '00_仕分け待ち', false).id : (masters.folders.find(function (f) { return f.placement === plan.placement.placement; }) || {}).drive_folder_id;
        if (!destination) throw new Error('格納先フォルダIDがマスタにありません。');
        if (drive.within(destination).mimeType !== 'application/vnd.google-apps.folder') throw new Error('格納先がフォルダではありません。');
        var registryKey = 'NOTION_PAGE:' + NotionTestEnvironment_.normalize(minutes.databaseId) + ':' + key;
        var fixtureKey = 'NOTION_FIXTURE:' + NotionTestEnvironment_.normalize(minutes.databaseId) + ':' + key;
        var recordText = env.properties.getProperty(registryKey) || env.properties.getProperty(fixtureKey), record = recordText ? JSON.parse(recordText) : null;
        if (record && record.state === 'created' && record.pageId) env.verifyMinutesPage(record.pageId);
        parsed.warnings.concat(plan.warnings).forEach(function (w) { console.log(w); });
        console.log('タスク提案（書き込まない）: ' + JSON.stringify(j.task_proposals));
        if (c.DRY_RUN === 'true') {
          var planned = { meeting_key: key, status: plan.placement.status, display_id: row ? row.display_id : '採番予定', event_start: manifest.start, event_end: manifest.end, source: j.source, confidence: j.confidence, domains_final: JSON.stringify(plan.placement.domains), related_project_ids_final: JSON.stringify(plan.placement.related_project_ids), title: manifest.title, placement_final: plan.placement.placement, minutes_title: j.minutes_title, notion_status: record && record.pageId ? '既存ページ再利用' : '作成予定', reason: j.reason };
          console.log('取り込み予定: ' + JSON.stringify(planned)); console.log('Notion送信予定: ' + JSON.stringify(plan.payload));
          ledger.log('inbox取り込み予定', key, { row: planned, notion: plan.payload });
          var card = InboxPlan_.card(planned, c.WEBAPP_URL); console.log('Chatwork投稿予定: ' + card); ledger.log('Chatwork投稿予定', key, card);
          results.push({ meeting_key: key, status: plan.placement.status, dryRun: true }); return;
        }
        if (!row) {
          row = { meeting_key: key, display_id: ledger.displayId(manifest.start), source: j.source, event_id: manifest.event_id || '', event_start: manifest.start, event_end: manifest.end || '', title: manifest.title,
            organizer_email: manifest.organizer_email || '', attendees_json: JSON.stringify(manifest.attendees || []), scope_auto: plan.placement.rule.scope || '', scope_final: j.scope,
            placement_auto: j.placement, placement_final: plan.placement.placement, domains_auto: JSON.stringify(j.domains), domains_final: JSON.stringify(plan.payload.properties['事業部領域'].multi_select.map(function (v) { return v.name; })),
            related_project_ids_auto: JSON.stringify(j.related_project_ids), related_project_ids_final: JSON.stringify(plan.placement.related_project_ids), minutes_title: j.minutes_title,
            confidence: j.confidence, reason: j.reason, sensitive: j.sensitive, conflict: plan.placement.conflicts.length > 0, status: plan.placement.status,
            notion_status: '未処理', raw_file_ids_json: JSON.stringify(manifest.files || {}), created_at: new Date().toISOString(), last_error: parsed.warnings.concat(plan.warnings).join(' ') };
          steps = { jsonId: file.id, rawFolderId: folder.id, manifestId: manifests[0].id, hash: hash(j), contentHash: hash(blocks), modifiedTime: file.modifiedTime };
          save();
        }
        var display={jsonId:steps.jsonId,hash:steps.hash,summary:j.summary||{},taskCount:(j.task_proposals||[]).length};
        if(JSON.stringify(display).length<12000) steps.reviewDisplay=display; else delete steps.reviewDisplay;
        steps.error = false; row.status = plan.placement.status;
        if (!row.meeting_folder_id) {
          var name = Utilities.formatDate(new Date(manifest.start), 'Asia/Tokyo', 'yyyy-MM-dd_HHmm') + '_' + InboxPlan_.safeName(manifest.title);
          var meetingFolder = drive.folder(destination, name, true, key); row.meeting_folder_id = meetingFolder.id; row.folder_id_final = destination; save();
        }
        if (!docId) {
          var existingDocs = drive.children(inbox.id).filter(function (f) { return f.mimeType === 'application/vnd.google-apps.document' && (f.appProperties || {}).meeting_key === key && f.appProperties.kind === 'minutes'; });
          if (existingDocs.length > 1) throw new Error('作成途中の議事録Docが複数あります。');
          docId = existingDocs.length ? existingDocs[0].id : drive.createFile(inbox.id, key.replace(/:/g, '_') + '_議事録', Stage2Content_.html(j.minutes_markdown), 'application/vnd.google-apps.document', 'minutes', key).id;
        }
        steps.minutesDocId = docId; row.minutes_doc_id = docId; save();
        if (!steps.moved) {
          rawFiles.forEach(function (f) { drive.move(f.id, row.meeting_folder_id, f.kind, key); });
          drive.move(docId, row.meeting_folder_id, 'minutes', key); drive.move(manifests[0].id, row.meeting_folder_id, 'manifest', key);
          steps.moved = true; save();
        }
        if (!row.notion_page_id && record && record.state === 'created' && record.pageId) {
          row.notion_page_id = record.pageId; steps.notionComplete = true; steps.reusedPage = true; row.notion_status = '作成済み（再利用）'; save();
        }
        if (!row.notion_page_id) {
          if (record && record.state === 'pending' || steps.notion === 'pending') throw new Error('Notion作成結果が不明です。記録を消さず、実Notionを確認してください。');
          steps.notion = 'pending'; env.properties.setProperty(registryKey, JSON.stringify({ state: 'pending' })); save();
          try {
            var payload = Object.assign({}, plan.payload, { children: blocks.slice(0, 100) }), page = env.createPage(payload);
            if (!page.id) throw new Error('Notion作成結果にページIDがありません。');
            console.log('作成したNotionページ: ' + key + ' / ' + page.id);
            row.notion_page_id = page.id; steps.notion = 'created'; steps.nextBlock = Math.min(100, blocks.length); save();
            env.properties.setProperty(registryKey, JSON.stringify({ state: 'created', pageId: page.id }));
          } catch (e) {
            if (e.httpStatus !== 403) throw e;
            env.properties.setProperty(registryKey, JSON.stringify({ state: 'rejected', httpStatus: 403 }));
            steps.notion = 'rejected'; row.notion_status = 'Notion保留'; row.last_error = e.message; save();
          }
        }
        if (row.notion_page_id && !steps.notionComplete) {
          env.verifyMinutesPage(row.notion_page_id);
          if (steps.appendPending) throw new Error('本文追加の結果が不明です。二重追記しません。');
          while (steps.nextBlock < blocks.length) {
            if (Date.now() - started > 240000) { save(); results.push({ meeting_key: key, status: '本文追加の続き待ち' }); return; }
            steps.appendPending = true; save();
            try { env.appendBlocks(row.notion_page_id, blocks.slice(steps.nextBlock, steps.nextBlock + 100)); }
            catch (e) { if (e.httpStatus === 403) { steps.appendPending = false; row.notion_status = 'Notion保留'; save(); } throw e; }
            steps.nextBlock += Math.min(100, blocks.length - steps.nextBlock); steps.appendPending = false; save();
          }
          steps.notionComplete = true; row.notion_status = '作成済み'; save();
        }
        if (!c.CHATWORK_TOKEN && (!steps.chatwork || steps.chatwork === 'log_only')) {
          var plannedCard = InboxPlan_.card(row, c.WEBAPP_URL);
          if (steps.cardHash !== hash(plannedCard)) { console.log('Chatwork投稿予定（トークン未設定）: ' + plannedCard); ledger.log('Chatwork投稿予定（トークン未設定）', key, plannedCard); steps.cardHash = hash(plannedCard); }
          steps.chatwork = 'log_only'; save();
        } else if (!steps.chatwork) {
          var body = InboxPlan_.card(row, c.WEBAPP_URL);
          if (!c.CHATWORK_TOKEN) {
            console.log('Chatwork投稿予定（トークン未設定）: ' + body); ledger.log('Chatwork投稿予定（トークン未設定）', key, body); steps.chatwork = 'log_only'; save();
          } else {
            steps.chatwork = 'pending'; save();
            var response = UrlFetchApp.fetch('https://api.chatwork.com/v2/rooms/' + c.CHATWORK_ROOM_ID_TEST + '/messages', { method: 'post', headers: { 'X-ChatWorkToken': c.CHATWORK_TOKEN }, payload: { body: body, self_unread: '0' }, muteHttpExceptions: true });
            if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error('Chatwork投稿: HTTP ' + response.getResponseCode());
            var sent = JSON.parse(response.getContentText()); if (!sent.message_id) throw new Error('ChatworkのメッセージIDがありません。');
            row.chatwork_message_id = sent.message_id; steps.chatwork = 'sent'; save();
          }
        } else if (steps.chatwork === 'pending') throw new Error('Chatwork投稿結果が不明です。二重投稿しません。');
        if (file.name.startsWith('local_')) {
          var localMarkers = drive.children(inbox.id).concat(drive.children(done.id));
          if (!LocalInboxReady_.check(drive, file, localMarkers)) throw new Error('ローカルJSONの同期完了を確認できません。');
          var marker = localMarkers.filter(function(f){return f.name === file.name+'.ready.txt';})[0];
          drive.move(marker.id, done.id, 'local_ready', key);
        }
        if (!steps.jsonDone) { drive.move(file.id, done.id, 'judgement', key); steps.jsonDone = true; save(); }
        if (!steps.rawDone) {
          if (!drive.children(folder.id).length) {
            var excluded = drive.folder(drive.root.id, '99_対象外', false), empty = drive.folder(excluded.id, '_空', false); drive.move(folder.id, empty.id, '', key);
          } else console.log('受信フォルダに追加ファイルが残るため移動しません: ' + key);
          steps.rawDone = true; save();
        }
        if (!ledger.rows('change_log').some(function (r) { return r.change_id === 'ingest:' + key; })) ledger.append('change_log', { change_id: 'ingest:' + key, at: new Date().toISOString(), meeting_key: key, kind: '取り込み', target: row.meeting_folder_id, after_json: JSON.stringify({ status: row.status, notion_status: row.notion_status }), actor: 'GAS-A（テスト）', result: '完了' });
        steps.finished = !!steps.notionComplete; save(); results.push({ meeting_key: key, status: row.status, notion_status: row.notion_status, pageId: row.notion_page_id || null });
      } catch (e) {
        var message = String(e.message || '不明なエラー');
        [c.NOTION_TOKEN, c.CHATWORK_TOKEN].filter(Boolean).forEach(function (secret) { message = message.split(secret).join('[非表示]'); });
        console.log('取り込みエラー: ' + key + ' / ' + message); ledger.log('取り込みエラー', key, message);
        if (c.DRY_RUN === 'false') {
          if (!row) row = ledger.rows('minutes').find(function (r) { return r.meeting_key === 'invalid:' + file.id; }) || { meeting_key: 'invalid:' + file.id, created_at: new Date().toISOString() };
          steps.error = true; steps.jsonId = file.id; steps.modifiedTime = file.modifiedTime; row.status = '要対応'; row.last_error = message; save();
        }
        results.push({ meeting_key: key, status: '要対応', error: message });
      }
    });
    console.log('inbox取り込み結果: ' + JSON.stringify(results)); return results;
  }
  return { run: run };
})();

function ingestInbox() {
  if (typeof assertFinanceOperator_ === 'function') assertFinanceOperator_(); return Ledger_.withLock(InboxIngest_.run); }

function retryInboxErrors() {
  if (typeof assertFinanceOperator_ === 'function') assertFinanceOperator_();
  return Ledger_.withLock(function () {
    var c = Stage2Drive_.config(), drive = Stage2Drive_.open(c); drive.within(c.LEDGER_SPREADSHEET_ID);
    var ledger = Stage2Ledger_.open(SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID));
    ledger.rows('minutes').forEach(function (r) {
      if (!r.step_done_json) return; var steps = JSON.parse(r.step_done_json);
      if (steps.error) { console.log('再検査予定: ' + r.meeting_key); if (c.DRY_RUN === 'false') { steps.error = false; r.step_done_json = JSON.stringify(steps); ledger.save(r); } }
    });
  });
}
