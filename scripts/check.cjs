const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
for (const root of ['gas-core', 'gas-organizer']) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8'));
  if (manifest.runtimeVersion !== 'V8') throw new Error('V8 が必要です。');
  for (const file of fs.readdirSync(path.join(root, 'src'))) {
    if (file.endsWith('.js')) new vm.Script(fs.readFileSync(path.join(root, 'src', file), 'utf8'), { filename: file });
  }
}
for (const root of ['gas-core','gas-organizer']) for (const file of fs.readdirSync(root+'/src/ui').filter(f => f.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(root,'src/ui',file),'utf8');
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1],{filename:file});
}
const delegated = JSON.parse(fs.readFileSync('gas-organizer/appsscript.delegated.json','utf8'));
const standard = JSON.parse(fs.readFileSync('gas-organizer/appsscript.json','utf8'));
if (delegated.webapp.executeAs !== 'USER_ACCESSING' || delegated.webapp.access !== 'DOMAIN' || delegated.runtimeVersion !== 'V8') throw new Error('委任版も本人実行・組織内公開を維持してください。');
if (JSON.stringify(delegated.oauthScopes) !== JSON.stringify([...standard.oauthScopes,'https://www.googleapis.com/auth/script.external_request'])) throw new Error('委任版の追加GASスコープはexternal_requestだけです。');
const Ajv = require('ajv/dist/2020');
const validate = new Ajv({ strict: true }).compile(JSON.parse(fs.readFileSync('schemas/inbox_judgement.schema.json')));
for (const file of fs.readdirSync('fixtures').filter(f => f.startsWith('judgement_'))) {
  if (!validate(JSON.parse(fs.readFileSync(path.join('fixtures', file))))) throw new Error(file + ': ' + JSON.stringify(validate.errors));
}
console.log('GAS構文・マニフェスト・判定サンプル3件を確認しました。');
