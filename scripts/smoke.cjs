const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync('gas-core/src/meetingRules.js', 'utf8'), context);
const rules = context.MeetingRules_;
const fixture = name => JSON.parse(fs.readFileSync('fixtures/' + name + '.json', 'utf8'));
const masters = fixture('masters_sample');
const external = fixture('manifest_meet');
// 内部会議・tl;dv会議のmanifestは未提供のため、以下は検証用入力です。
const internal = { ...external, meeting_key: 'meet:test001_20261021T020000Z', attendees: masters.people.map(p => ({ email: p.google_email })) };
const tldv = { ...external, source: 'tldv', meeting_key: 'tldv:tldvtest003', attendees: [{ name: '先方担当' }] };
const cases = [
  ['judgement_internal_high', internal, '確認待ち', [{ id: '00000000-0000-0000-0000-000000000001' }]],
  ['judgement_external_high', external, '確認待ち', []],
  ['judgement_external_low', tldv, '仕分け待ち', []]
];
for (const [name, manifest, expected, projects] of cases) {
  const plan = rules.placementPlan(fixture(name), manifest, masters, projects);
  assert.equal(plan.status, expected);
  console.log(name + '：' + plan.status + ' → ' + plan.placement);
}
const pages = fixture('tldv_inbox_pages');
const duplicate = rules.tldvPlan(pages[0], [external], '2026-10-21T18:00:00+09:00');
const transcript = rules.tldvPlan(pages[1], [external], '2026-10-21T18:00:00+09:00');
assert.equal(duplicate.action, '対象外（Meet優先）');
assert.equal(transcript.action, '文字起こしの取り込み予定');
assert.equal(JSON.stringify(transcript.file_kinds), '["tldv_transcript"]');
console.log('tl;dv重複：' + duplicate.action);
console.log('tl;dv独自会議：' + transcript.action + '（MP4なし）');
console.log('外部への接続・書き込みは行っていません。');
