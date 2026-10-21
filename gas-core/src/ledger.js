var Ledger_ = (function () {
  var headers = {
    minutes: 'meeting_key,display_id,source,event_id,event_start,event_end,title,organizer_email,attendees_json,scope_auto,scope_final,placement_auto,placement_final,folder_id_final,domains_auto,domains_final,related_project_ids_auto,related_project_ids_final,minutes_title,minutes_doc_id,raw_file_ids_json,meeting_folder_id,confidence,reason,sensitive,conflict,status,notion_page_id,notion_status,chatwork_message_id,reviewer_email,version,created_at,updated_at,confirmed_by,confirmed_at,step_done_json,last_error',
    task_proposals: 'proposal_id,meeting_key,seq,type,task_db,target_notion_id,title,before_json,after_json,requester_email,assignee_email,evidence,decision,decided_by,decided_at,applied_at,result,applied_page_id,applied_block_ids_json',
    change_log: 'change_id,at,meeting_key,kind,target,before_json,after_json,actor,result,revert_of',
    masters_folders: 'placement,drive_folder_id,notion_domain,rank',
    masters_clients: 'client_name,domains,drive_folder_id,created_by,created_at',
    masters_internal: 'email_or_domain,note',
    masters_people: 'name,google_email,alt_emails,notion_user_id,chatwork_account_id,domains,is_reviewer,is_admin',
    organizers: 'email,registered_at,trigger_id,last_run_at,last_result',
    settings: 'key,value,note', dry_run_log: 'at,action,target,payload_summary'
  };
  function withLock(fn) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new Error('別の処理が実行中です。後でもう一度実行してください。');
    try { return fn(); } finally { lock.releaseLock(); }
  }
  function checkHeaders(sheet, name) {
    var expected = headers[name].split(',');
    if (sheet.getLastRow() > 0) {
      var actual = sheet.getRange(1, 1, 1, Math.max(expected.length, sheet.getLastColumn())).getValues()[0];
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(name + ' の見出しが仕様と異なります。上書きしません。');
    }
    return expected;
  }
  function plan(book) {
    return Object.keys(headers).map(function (name) {
      var sheet = book.getSheetByName(name);
      if (sheet) checkHeaders(sheet, name);
      return { sheet: name, action: !sheet ? 'シート作成' : sheet.getLastRow() === 0 ? '見出し追加' : '変更なし', headers: headers[name].split(',') };
    });
  }
  function dryLog(book, action, target, summary) {
    var sheet = book.getSheetByName('dry_run_log');
    if (sheet) checkHeaders(sheet, 'dry_run_log');
    else sheet = book.insertSheet('dry_run_log');
    if (!sheet.getLastRow()) sheet.appendRow(headers.dry_run_log.split(','));
    sheet.appendRow([Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX"), action, target, summary]);
  }
  return { headers: headers, withLock: withLock, plan: plan, dryLog: dryLog };
})();
