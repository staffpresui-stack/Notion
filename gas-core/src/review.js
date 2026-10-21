var Review_ = (function () {
  function context() {
    var email = ReviewSecurity_.active(), props = PropertiesService.getScriptProperties();
    if (props.getProperty('REVIEW_MASTER_ACCESS') !== 'true' && email !== ReviewSecurity_.finance) throw new Error('テスト中の利用者はfinance@だけです。');
    var c = Stage2Drive_.config(), drive = Stage2Drive_.open(c); drive.within(c.LEDGER_SPREADSHEET_ID);
    var ledger = Stage2Ledger_.open(SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID)), masters = ledger.masters();
    var user = ReviewSecurity_.actor(email, masters.people, ledger.rows('settings'), props.getProperty('REVIEW_MASTER_ACCESS'));
    return { c: c, drive: drive, ledger: ledger, masters: masters, user: user, props: props };
  }
  function row(c, key) {
    var rows = c.ledger.rows('minutes').filter(function (r) { return r.meeting_key === key; });
    if (rows.length !== 1 || !ReviewSecurity_.canView(c.user, rows[0], c.masters)) throw new Error('この議事録を閲覧・操作できません。');
    return rows[0];
  }
  function json(value, fallback) { return value ? JSON.parse(value) : fallback; }
  function safe(r) {
    var out = {}; ['meeting_key','display_id','event_start','event_end','title','source','status','placement_final','scope_final','domains_final','related_project_ids_final','minutes_title','confidence','reason','organizer_email','reviewer_email','notion_status','last_error','scope_auto','placement_auto','domains_auto','related_project_ids_auto'].forEach(function (k) { out[k] = String(r[k] || ''); }); out.version = Number(r.version); return out;
  }
  function list(c, filters) {
    filters = filters || {};
    var rows = c.ledger.rows('minutes').filter(function (r) {
      return ReviewSecurity_.canView(c.user, r, c.masters) && (!filters.status || r.status === filters.status) && (!filters.domain || ReviewSecurity_.list(r.domains_final).includes(filters.domain)) && (!filters.mine || c.user.identities.includes(ReviewSecurity_.email(r.reviewer_email || r.organizer_email))) && (!filters.date || localDate(r.event_start) === filters.date);
    });
    var offset = Math.max(0, Math.floor(Number(filters.offset) || 0));
    return { total: rows.length, rows: rows.slice(offset, offset + 50).map(function (r) { var o = safe(r); o.taskCount = proposals(c, r); return o; }), offset: offset };
  }
  function localDate(value) { var ms=Date.parse(value); return Number.isFinite(ms) ? new Date(ms+9*3600000).toISOString().slice(0,10) : ''; }
  function source(c, r) { var steps = json(r.step_done_json, {}); try { return steps.jsonId ? c.drive.readJSON(steps.jsonId) : {}; } catch(e) { return {summary:{error:'元の判定JSONを読み取れません。再実行前に管理者が確認してください。'}}; } }
  function proposals(c, r) { var j = source(c, r); return (j.task_proposals || []).length; }
  function notion() { var env = NotionTestEnvironment_.open(true, 'review'); env.minutesSchema = env.schema(env.ids.minutes, 'minutes'); env.schema(env.ids.tasks, 'tasks'); return env; }
  function detail(c, key) {
    var r = row(c, key), out = safe(r), j = source(c, r), steps = json(r.step_done_json, {});
    out.attendees = json(r.attendees_json, []).map(function (a) { var address = typeof a === 'string' ? a : a.email; return { email: address, internal: MeetingRules_.classify([{email:address}], c.masters).scope === '社内' }; });
    out.summary = j.summary || {}; out.taskCount = (j.task_proposals || []).length; out.links = [];
    var raw=json(r.raw_file_ids_json,{}), fileLinks=[['会議フォルダ',r.meeting_folder_id],['議事録',r.minutes_doc_id]];
    [['recording','録画'],['transcript','文字起こし'],['gemini','Geminiメモ']].forEach(function(pair){if (raw[pair[0]]) fileLinks.push([pair[1],raw[pair[0]]]);});
    out.fileStatus={recording:raw.recording?'あり':'なし',transcript:raw.transcript?'あり':'なし',gemini:raw.gemini?'あり':'なし'};
    fileLinks.forEach(function (pair) { if (pair[1]) { c.drive.within(pair[1]); out.links.push({ title: pair[0], url: 'https://drive.google.com/open?id=' + encodeURIComponent(pair[1]) }); } });
    if (r.notion_page_id) { notion().verifyMinutesPage(r.notion_page_id, r.status === '対象外' || !!(steps.review && steps.review.plan.archive)); out.links.push({ title: 'Notion', url: 'https://www.notion.so/' + r.notion_page_id.replace(/-/g,'') }); }
    out.history = c.ledger.rows('change_log').filter(function (h) { return h.meeting_key === key; }).slice(-30).map(function (h) { return { at: String(h.at), actor: h.actor, action: h.kind, before: h.before_json, after: h.after_json, result: h.result }; });
    out.pending = steps.review ? { state: steps.review.state, action: steps.review.plan.action, drive: !!steps.review.drive, notion: !!steps.review.notion, chatwork: !!steps.review.chatwork } : null;
    return out;
  }
  function choices(c) {
    var folders = c.masters.folders.filter(function (f) { return c.user.admin || (!f.rank || c.user.ranks.includes(String(f.rank))); }).map(function (f) { return f.placement; });
    // プロジェクト候補も所属確認を行います。非管理者には領域の確認できない候補を公開しません。
    var projects = [];
    {
      var ref = c.drive.folder(c.drive.root.id, 'ref', false), files = c.drive.children(ref.id).filter(function (f) { return f.name === 'projects.json'; });
      if (files.length > 1) throw new Error('projects.jsonが重複しています。');
      var env = notion();
      if (files.length && c.user.admin) { var data = c.drive.readJSON(files[0].id); var candidates = Array.isArray(data) ? data : data.projects || []; candidates.slice(0,500).forEach(function (p) { if (p.id && env.project(p.id)) projects.push({ id: p.id, domains: ReviewSecurity_.list(p.domains), title: String(p.title || p.name || p.id) }); }); }
      else projects = env.projects();
    }
    projects = projects.filter(function (p) { return projectVisible(c,p); }).map(function (p) { return {id:p.id,title:p.title}; });
    return { folders: folders, projects: projects };
  }
  function projectVisible(c,p) {
    if (c.user.admin) return true;
    return p.domains && p.domains.length > 0 && p.domains.every(function(d) {
      var f=c.masters.folders.find(function(v){return v.notion_domain===d || v.placement==='社内/'+d;});
      return f && (!f.rank || c.user.ranks.includes(String(f.rank))) && (!c.user.domains.length || c.user.domains.includes(d));
    });
  }
  function destination(c, r, plan, create) {
    if (plan.archive) return c.drive.folder(c.drive.root.id, '99_対象外', false).id;
    if (!plan.updateProperties) return r.folder_id_final;
    if (plan.newClient) {
      if (!c.user.admin) throw new Error('新規顧客の再実行も管理者専用です。');
      var client = plan.newClient, parent = c.drive.folder(c.drive.root.id, '社外', false);
      if (!create) return '新規顧客/' + client.name;
      var folder = c.drive.folder(parent.id, InboxPlan_.safeName(client.name), true);
      if (!c.ledger.rows('masters_clients').some(function (m) { return m.client_name === client.name; })) c.ledger.append('masters_clients', { client_name: client.name, domains: JSON.stringify(client.domains), drive_folder_id: folder.id, created_by: c.user.email, created_at: new Date().toISOString() });
      if (!c.ledger.rows('masters_folders').some(function (m) { return m.placement === plan.desired.placement_final; })) c.ledger.append('masters_folders', { placement: plan.desired.placement_final, drive_folder_id: folder.id });
      return folder.id;
    }
    var matches = c.masters.folders.filter(function (f) { return f.placement === plan.desired.placement_final; });
    if (matches.length !== 1) throw new Error('格納先を1件に特定できません。');
    if (!c.user.admin && matches[0].rank && !c.user.ranks.includes(String(matches[0].rank))) throw new Error('移動先の閲覧権限がありません。');
    if (!c.user.admin && c.user.domains.length && ReviewSecurity_.list(plan.desired.domains_final).some(function (d) { return !c.user.domains.includes(d); })) throw new Error('事業部領域の操作権限がありません。');
    c.drive.within(matches[0].drive_folder_id); return matches[0].drive_folder_id;
  }
  function log(c, action, r, body) { console.log(action + ': ' + body); c.ledger.log(action, r.meeting_key, body); }
  function chat(c, r, journal, save, preview) {
    var body = InboxPlan_.card(Object.assign({},r,journal.plan.desired), c.c.WEBAPP_URL), reply = ReviewPlan_.reply(journal.plan).replace(/https?:\/\/\S+/g,'（URL省略）').replace(/\[/g,'［').replace(/\]/g,'］');
    if (preview || !c.c.CHATWORK_TOKEN || !r.chatwork_message_id) {
      log(c, 'Chatwork PUT予定（送信なし）', r, body);
      if (journal.plan.reconfirmed) log(c, 'Chatwork [rp]返信予定（送信なし）', r, reply);
      return;
    }
    var room = c.c.CHATWORK_ROOM_ID_TEST, id = String(r.chatwork_message_id);
    if (!/^\d+$/.test(room || '') || room === c.c.CHATWORK_ROOM_ID || !/^\d+$/.test(id)) throw new Error('テスト用Chatworkルーム・メッセージIDが不正です。');
    function request(method, path, payload) {
      var res = UrlFetchApp.fetch('https://api.chatwork.com/v2/' + path, { method: method, headers: { 'X-ChatWorkToken': c.c.CHATWORK_TOKEN }, payload: payload, muteHttpExceptions: true });
      if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) throw new Error('Chatwork反映失敗: HTTP ' + res.getResponseCode());
      return JSON.parse(res.getContentText());
    }
    var me = request('get','me'), message = request('get','rooms/'+room+'/messages/'+id);
    if (String(me.account_id) !== String(message.account.account_id)) throw new Error('投稿者が一致しないためChatworkを更新しません。');
    if (!journal.put) { request('put','rooms/'+room+'/messages/'+id,{body:body}); journal.put = true; save(); }
    if (journal.plan.reconfirmed && !journal.reply) {
      if (journal.replyPending) throw new Error('返信結果が不明です。Chatworkを確認してください。二重送信しません。');
      journal.replyPending = true; save();
      request('post','rooms/'+room+'/messages',{body:'[rp aid='+me.account_id+' to='+room+'-'+id+']\n'+reply,self_unread:'0'});
      journal.reply = true; save();
    }
  }
  function submit(request) {
    return Ledger_.withLock(function () {
      var c = context(); ReviewSecurity_.verifyNonce(c.user, request.nonce);
      var r = row(c, request.meetingKey);
      if (!Number.isInteger(request.version) || Number(r.version) !== request.version) throw new Error('先に更新されました。画面を読み込み直してください。');
      var steps = json(r.step_done_json, {}), journal = steps.review, retry = request.action === 'retry';
      if (retry && r.status !== '要対応') throw new Error('再実行は要対応のときだけです。');
      if (retry && !journal) {
        if (!c.user.admin) throw new Error('取り込みの再実行は管理者専用です。');
        if (c.c.DRY_RUN === 'true') { log(c,'取り込み再実行予定',r,r.meeting_key); return {message:'再実行予定を記録しました。'}; }
        delete steps.error; r.step_done_json=JSON.stringify(steps); c.ledger.save(r); InboxIngest_.run(r.meeting_key); return {message:'取り込みを再実行しました。'};
      }
      if (!retry && journal && journal.state !== 'done') throw new Error('未完了の処理を再実行してください。');
      if (!retry) journal = { id: Utilities.getUuid(), actor: c.user.email, plan: ReviewPlan_.plan(r,request,c.masters,c.user,new Date().toISOString()), state:'running' };
      var env = notion(), plan = journal.plan, desired = Object.assign({},r,plan.desired), verified = [];
      env.verifyMinutesPage(r.notion_page_id, plan.archive);
      ReviewSecurity_.list(desired.related_project_ids_final).forEach(function (id) { var found = env.project(id); if (found) verified.push(id); });
      if (!c.user.admin) { var visible=choices(c).projects.map(function(p){return p.id;}); if (ReviewSecurity_.list(desired.related_project_ids_final).some(function(id){return !visible.includes(id);})) throw new Error('関連プロジェクトの閲覧・操作権限を確認できません。'); }
      var payload = plan.updateProperties ? ReviewPlan_.notionProperties(desired, env.minutesSchema, verified) : null;
      var dest = destination(c,r,plan,false); var meetingFolder = c.drive.within(r.meeting_folder_id);
      if (journal.drive && (plan.archive || plan.updateProperties) && !(meetingFolder.parents || []).includes(plan.desired.folder_id_final)) throw new Error('処理記録と現在の格納先が異なります。管理者が確認してください。');
      if (c.c.DRY_RUN === 'true') { log(c,'確認画面の反映予定',r,JSON.stringify({plan:plan,destination:dest,properties:payload})); chat(c,r,journal,function(){},true); return { message:'予定をdry_run_logに記録しました。議事録は変更していません。' }; }
      function save() { steps.review=journal; r.step_done_json=JSON.stringify(steps); c.ledger.save(r); }
      function fail(step) { if (c.user.email === ReviewSecurity_.finance && c.props.getProperty('REVIEW_TEST_FAIL_STEP') === step) { c.props.deleteProperty('REVIEW_TEST_FAIL_STEP'); throw new Error('再実行確認用に停止しました（'+step+'）。'); } }
      journal.state='running'; save();
      try {
        if (!journal.drive) {
          dest=destination(c,r,plan,true);
          if (plan.updateProperties || plan.archive) { var file=c.drive.within(r.meeting_folder_id); if (!(file.parents || []).includes(dest)) c.drive.move(r.meeting_folder_id,dest,'meeting_folder',r.meeting_key); plan.desired.folder_id_final=dest; if (plan.archive) plan.desired.placement_final='99_対象外'; }
          journal.drive=true; save(); fail('after_drive');
        }
        if (!journal.notion) { if (plan.archive || plan.updateProperties) env.updateReviewPage(r.notion_page_id,payload,plan.archive); journal.notion=true; save(); fail('after_notion'); }
        if (!journal.chatwork) { chat(c,r,journal,save,false); journal.chatwork=true; save(); fail('after_chatwork'); }
        var changeId='review:'+journal.id;
        if (!c.ledger.rows('change_log').some(function(h){return h.change_id===changeId;})) c.ledger.append('change_log',{change_id:changeId,at:new Date().toISOString(),meeting_key:r.meeting_key,kind:plan.action,target:'議事録',before_json:JSON.stringify(plan.before),after_json:JSON.stringify(plan.desired),actor:journal.actor,result:'成功'});
        Object.assign(r,plan.desired); if (plan.archive) r.notion_status='アーカイブ済み'; r.last_error=''; journal.state='done'; save();
        return {message:'反映しました。',version:Number(r.version)};
      } catch(e) { journal.state='failed'; r.status='要対応'; var error=String(e.message || '不明なエラー'); [c.c.NOTION_TOKEN,c.c.CHATWORK_TOKEN].filter(Boolean).forEach(function(secret){error=error.split(secret).join('[非表示]');}); r.last_error=error; save(); return {message:'処理を停止しました。'+error+' 「再実行」で続きから再開できます。',failed:true}; }
    });
  }
  return {context:context,list:list,detail:detail,choices:choices,submit:submit};
})();
function doGet() {
  try { Review_.context(); return HtmlService.createTemplateFromFile('Index').evaluate().setTitle('議事録の確認'); }
  catch(e) { return HtmlService.createHtmlOutput('この確認画面を開く権限がないか、設定が未完了です。finance@でログインし、管理者に確認してください。'); }
}
function includeReview_(name) { if (!['Styles','Scripts'].includes(name)) throw new Error('不正な画面部品です。'); return HtmlService.createHtmlOutputFromFile(name).getContent(); }
function reviewBootstrap() { var c=Review_.context(); return {actor:c.user.email,admin:c.user.admin,dryRun:c.c.DRY_RUN==='true',nonce:ReviewSecurity_.nonce(c.user),choices:Review_.choices(c),list:Review_.list(c,{})}; }
function reviewList(filters) { var c=Review_.context(); return Review_.list(c,filters); }
function reviewDetail(key) { var c=Review_.context(); return Review_.detail(c,key); }
function reviewSubmit(request) { return Review_.submit(request); }
