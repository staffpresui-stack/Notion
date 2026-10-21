var ReviewSecurity_ = (function () {
  var finance = 'finance@premiere-mode.co.jp';
  function email(value) { return String(value || '').trim().toLowerCase(); }
  function list(value) { if (Array.isArray(value)) return value; try { var a = JSON.parse(value || '[]'); if (Array.isArray(a)) return a; } catch (e) {} return String(value || '').split(',').map(function (v) { return v.trim(); }).filter(Boolean); }
  function yes(value) { return String(value).trim().toLowerCase() === 'true' || value === 1 || value === '1'; }
  function active() {
    var value = email(Session.getActiveUser().getEmail());
    if (!value || !value.endsWith('@premiere-mode.co.jp')) throw new Error('ログイン中の会社アカウントを確認できません。操作を拒否しました。');
    return value;
  }
  function actor(value, people, settings, enabled) {
    value = email(value);
    if (enabled !== 'true' && value !== finance) throw new Error('テスト中の利用者はfinance@だけです。');
    var matches = people.filter(function (p) { return [email(p.google_email)].concat(list(p.alt_emails).map(email)).includes(value); });
    if (matches.length !== 1 || !(yes(matches[0].is_admin) || yes(matches[0].is_reviewer))) throw new Error('閲覧・操作の権限がありません。管理者に確認してください。');
    var person = matches[0], rank = settings.find(function (s) { return s.key === 'review_rank_allow:' + email(person.google_email); });
    return { email: value, identities: [value, email(person.google_email)].concat(list(person.alt_emails).map(email)), admin: yes(person.is_admin), reviewer: yes(person.is_reviewer), domains: list(person.domains), ranks: rank ? list(rank.value) : [] };
  }
  function canView(user, row, masters) {
    if (user.admin) return true;
    if (!user.reviewer || row.status === '仕分け待ち') return false;
    var assigned = email(row.reviewer_email || row.organizer_email);
    if (!assigned || !user.identities.includes(assigned)) return false;
    var folder = masters.folders.find(function (f) { return f.placement === row.placement_final; });
    if (!folder) return false;
    if (folder.rank && !user.ranks.includes(String(folder.rank))) return false;
    var domains = list(row.domains_final);
    return !user.domains.length || domains.length > 0 && domains.every(function (d) { return user.domains.includes(d); });
  }
  function nonce(user) { var value = Utilities.getUuid() + Utilities.getUuid(); CacheService.getScriptCache().put('review:' + value, user.email, 1800); return value; }
  function verifyNonce(user, value) {
    if (typeof value !== 'string' || value.length > 100 || CacheService.getScriptCache().get('review:' + value) !== user.email) throw new Error('画面の有効期限が切れました。読み込み直してください。');
  }
  return { finance: finance, email: email, list: list, yes: yes, active: active, actor: actor, canView: canView, nonce: nonce, verifyNonce: verifyNonce };
})();

// google.script.runから既存の管理用関数を直接呼んでも、finance@以外は実行できません。
function assertFinanceOperator_() {
  if (ReviewSecurity_.active() !== ReviewSecurity_.finance) throw new Error('この管理用操作はfinance@専用です。');
}

function setupReviewAccess() {
  assertFinanceOperator_();
  return Ledger_.withLock(function () {
    var c = Stage2Drive_.config(), drive = Stage2Drive_.open(c); drive.within(c.LEDGER_SPREADSHEET_ID);
    var ledger = Stage2Ledger_.open(SpreadsheetApp.openById(c.LEDGER_SPREADSHEET_ID));
    var existing = ledger.rows('masters_people').filter(function (r) { return ReviewSecurity_.email(r.google_email) === ReviewSecurity_.finance; });
    if (existing.length > 1) throw new Error('finance@の対応表が重複しています。');
    if (c.DRY_RUN === 'true') { console.log('finance@をmasters_peopleの管理者へ追加する予定です。既存行は上書きしません。'); return; }
    if (!existing.length) ledger.append('masters_people', { name: '確認管理者', google_email: ReviewSecurity_.finance, is_reviewer: true, is_admin: true });
    var properties = PropertiesService.getScriptProperties();
    if (!properties.getProperty('REVIEW_MASTER_ACCESS')) properties.setProperty('REVIEW_MASTER_ACCESS', 'false');
    console.log('確認画面のマスタを準備しました。既存の役割・メール対応は上書きしていません。');
  });
}
