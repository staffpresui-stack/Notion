const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fixture = name => JSON.parse(fs.readFileSync(path.join('fixtures', name + '.json'), 'utf8'));
const embedded = {
  judgements: ['judgement_internal_high', 'judgement_external_high', 'judgement_external_low'].map(fixture),
  masters: fixture('masters_sample'),
  manifests: [fixture('manifest_meet'), ...fixture('notion_test_manifests').manifests]
};
fs.writeFileSync('gas-core/src/notionFixtures.generated.js',
  '// scripts/bundle.cjs でfixturesから生成します。手で変更しないでください。\nvar NotionFixtures_ = ' + JSON.stringify(embedded, null, 2) + ';\n');
fs.writeFileSync('gas-core/src/inboxSchema.generated.js', '// schemas/inbox_judgement.schema.jsonから生成します。\nvar InboxJudgementSchema_ = ' + fs.readFileSync('schemas/inbox_judgement.schema.json', 'utf8').trim() + ';\n');
for (const root of ['gas-core', 'gas-organizer']) {
  const source = fs.readdirSync(path.join(root, 'src')).filter(f => f.endsWith('.js')).sort()
    .map(file => '// ' + file + '\n' + fs.readFileSync(path.join(root, 'src', file), 'utf8')).join('\n\n');
  new vm.Script(source, { filename: root + '/Code.gs' });
  const out = path.join('dist', root);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'Code.gs'), source.trimEnd() + '\n');
  fs.copyFileSync(path.join(root, 'appsscript.json'), path.join(out, 'appsscript.json'));
  console.log(out + ' に貼り付け用コードとマニフェストを出力しました。');
}
