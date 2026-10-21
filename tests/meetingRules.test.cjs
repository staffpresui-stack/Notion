const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync('gas-core/src/meetingRules.js', 'utf8'), ctx);
const rules = ctx.MeetingRules_;
const read = name => JSON.parse(fs.readFileSync('fixtures/' + name + '.json', 'utf8'));
const masters = read('masters_sample'), manifest = read('manifest_meet'), judgement = read('judgement_external_high');
test('タイトルの全半角・空白・記号と15分の境界を照合します', () => {
  const a = { title: 'ＡＩ 定例！', start: '2026-10-21T10:00:00+09:00' };
  assert.equal(rules.sameMeeting(a, { title: 'ai定例', start: '2026-10-21T10:15:00+09:00' }), true);
  assert.equal(rules.sameMeeting(a, { title: 'ai定例', start: '2026-10-21T10:15:01+09:00' }), false);
  assert.equal(rules.sameMeeting(a, { title: '別の会議', start: a.start }), false);
  assert.equal(rules.sameMeeting(a, { ...a, start: 'invalid' }), false);
});
test('空タイトルはメール2人の一致が必要で、重複メールは数えません', () => {
  const a = { title: '', start: manifest.start, attendees: [{ email: 'a@example.com' }, { email: 'b@example.com' }] };
  assert.equal(rules.sameMeeting(a, { ...a, attendees: [{ email: 'A@EXAMPLE.COM' }, { email: 'b@example.com' }] }), true);
  assert.equal(rules.sameMeeting(a, { ...a, attendees: [{ email: 'a@example.com' }, { email: 'a@example.com' }] }), false);
});
test('内部ドメインは完全一致で、個人メールの明示登録も使えます', () => {
  assert.equal(rules.classify([{ email: 'test.private@gmail.com' }], masters).scope, '社内');
  assert.equal(rules.classify([{ email: 'attacker@evilpremiere-mode.co.jp' }], masters).scope, '社外');
  assert.equal(rules.classify([], masters).incomplete, true);
});
test('フリーメールは顧客判定に使わず、複数顧客は自動確定しません', () => {
  const m = { ...masters, clients: [...masters.clients, { client_name: 'gmail顧客', domains: ['gmail.com'] }, { client_name: '別顧客', domains: ['other.example'] }] };
  assert.equal(rules.classify([{ email: 'person@gmail.com' }], m).client, null);
  assert.equal(rules.classify([{ email: 'a@sample-shoji.example' }, { email: 'b@other.example' }], m).ambiguous_client, true);
});
test('機密・顧客食い違い・参加者不足・未登録PJを仕分け待ちにします', () => {
  assert.equal(rules.placementPlan(judgement, manifest, masters, []).status, '確認待ち');
  for (const j of [{ ...judgement, sensitive: true }, { ...judgement, scope: '社内', placement: '社内/EC' },
    { ...judgement, related_project_ids: ['unregistered'] }]) {
    assert.equal(rules.placementPlan(j, manifest, masters, []).status, '仕分け待ち');
  }
  assert.equal(rules.placementPlan(judgement, { ...manifest, attendees: [] }, masters, []).status, '仕分け待ち');
  assert.throws(() => rules.placementPlan(judgement, { ...manifest, meeting_key: 'different' }, masters, []), /一致しません/);
});
test('未知の事業部領域は選択肢を増やさず捨てて記録します', () => {
  const plan = rules.placementPlan({ ...judgement, domains: ['EC', '勝手な選択肢'] }, manifest, masters, []);
  assert.equal(JSON.stringify(plan.domains), '["EC"]');
  assert.equal(JSON.stringify(plan.rejected_domains), '["勝手な選択肢"]');
});
test('tl;dvは会議終了から60分待ち、Meetを優先します', () => {
  const page = read('tldv_inbox_pages')[0];
  assert.equal(rules.tldvPlan(page, [manifest], '2026-10-21T15:59:59+09:00').action, '待機');
  assert.equal(rules.tldvPlan(page, [manifest], '2026-10-21T16:00:00+09:00').action, '対象外（Meet優先）');
  assert.equal(rules.tldvPlan({ ...page, '取り込み状態': '取り込み済み' }, [], 'invalid').action, '処理済み');
});
test('tl;dv単独会議は文字起こしだけで、URL不明時はページIDを使います', () => {
  const page = read('tldv_inbox_pages')[1];
  const plan = rules.tldvPlan(page, [], '2026-10-21T18:00:00+09:00');
  assert.equal(plan.meeting_key, 'tldv:tldvtest003');
  assert.equal(JSON.stringify(plan.file_kinds), '["tldv_transcript"]');
  assert.equal(rules.tldvPlan({ ...page, '会議URL': 'https://evil.example/meeting', id: 'page-id' }, [], '2026-10-21T18:00:00+09:00').meeting_key, 'tldv:notion-page-id');
  assert.equal(rules.tldvPlan({ ...page, '長さ': '不明' }, [], '2026-10-21T18:00:00+09:00').action, '要確認');
  assert.equal(rules.tldvPlan({ ...page, 'トランスクリプト': '' }, [], '2026-10-21T18:00:00+09:00').action, '要確認');
});
