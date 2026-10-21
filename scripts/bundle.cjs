const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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
