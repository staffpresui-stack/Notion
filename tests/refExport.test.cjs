const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const clone=x=>JSON.parse(JSON.stringify(x));
const tasks='c908936a-6999-4119-9e9c-df364f5f5d1b',minutes='d9cc47f9-543e-4bcb-8ec8-27bebc0feac5',parent='400ca178-7419-80e8-bb9a-f157874b6105';
function harness(){
 const calls=[],props={ENV:'test',DRY_RUN:'false',NOTION_TOKEN:'test-only',NOTION_DB_TASKS_TEST:tasks,NOTION_DB_MINUTES_TEST:minutes};
 const page=(id,statusType='status')=>({id,parent:{type:'data_source_id',data_source_id:'test-source'},properties:{'プロジェクト/タスク名':{type:'title',title:[{plain_text:'テスト'+id}]},'ステータス':{type:statusType,[statusType]:{name:'進行中'}},'事業部領域':{type:'multi_select',multi_select:[{name:'EC'}]},'親アイテム':{type:'relation',relation:[{id:'two'},{id:'outside-test'}]},'期日':{type:'date',date:{start:'2026-10-31'}},'備考':{type:'rich_text',rich_text:[{plain_text:'出力しない秘密の本文'}]}}});
 let responses=[{results:[page('one')],has_more:true,next_cursor:'next'},{results:[page('two','select'),{...page('archived'),archived:true}],has_more:false}];
 const ctx=vm.createContext({Utilities:{sleep(){}},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]})},UrlFetchApp:{fetch(url,options){const path=url.split('/v1/')[1],body=options.payload&&JSON.parse(options.payload);calls.push({path,method:options.method,body});let data;
 if(path.startsWith('databases/'))data={id:tasks,parent:{type:'page_id',page_id:parent},data_sources:[{id:'test-source'}]};else if(options.method==='get')data={id:'test-source',parent:{database_id:tasks},properties:{'プロジェクト/タスク名':{type:'title'}}};else data=responses.shift();return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(data)}}}});
 for(const name of ['reviewSecurity','refExportPlan','notionTestEnvironment'])vm.runInContext(fs.readFileSync('gas-core/src/'+name+'.js','utf8'),ctx);
 function query(){const env=ctx.NotionTestEnvironment_.open(false,'ref-export');env.schema(tasks,'tasks');return env.referenceProjects()}
 return {ctx,calls,props,page,query,setResponses:v=>responses=v};
}
test('Notion参照はデータソースを読み取りページングし、最小項目だけ出力。削除済み・本番親IDは除外',()=>{
 const h=harness(),rows=clone(h.query());assert.equal(rows.length,2);assert.deepEqual(rows[0],{id:'one',title:'テストone',status:'進行中',domains:['EC'],parent_ids:['two'],due:'2026-10-31'});assert.equal(rows[1].status,'進行中');assert.ok(h.calls.every(c=>c.method==='get'||c.method==='post'&&c.path==='data_sources/test-source/query'));assert.equal(h.calls.at(-1).body.start_cursor,'next');assert.equal(JSON.stringify(rows).includes('秘密の本文'),false);
});
test('不正なページ送り・別DBページ・重複・本番DBの設定は参照出力を止める',()=>{
 for(const responses of [[{results:[],has_more:true,next_cursor:null}],[{results:[],has_more:true,next_cursor:'same'},{results:[],has_more:true,next_cursor:'same'}],[{results:[{id:'prod',parent:{type:'database_id',database_id:'production'}}],has_more:false}],[{results:[],has_more:false},null]]){
  const h=harness();if(responses[1]===null)h.props.NOTION_DB_TASKS_TEST='production';else h.setResponses(responses);assert.throws(()=>h.query());assert.ok(h.calls.every(c=>c.method!=='patch'));
 }
 const h=harness();h.setResponses([{results:[h.page('one'),h.page('one')],has_more:false}]);assert.throws(()=>h.query(),/重複/);
});
test('社員出力は会社メール・氏名・Notion ID・領域だけ。列の権限値・Chatwork・個人別名は含めない',()=>{
 const h=harness();const r=clone(h.ctx.RefExportPlan_.masters({people:[{name:'社員',google_email:' USER@premiere-mode.co.jp ',notion_user_id:'notion-user-id',domains:'["EC"]',alt_emails:'private@example.com',is_admin:true,chatwork_account_id:'123'},{name:'個人',google_email:'private@example.com'}],clients:[{client_name:'顧客',domains:'EXAMPLE.COM',drive_folder_id:'not-exported'}],folders:[{placement:'社内/EC',notion_domain:'EC',rank:'secret-rank',drive_folder_id:'not-exported'}],internal:['premiere-mode.co.jp']},'now'));
 assert.deepEqual(r.data.people,[{name:'社員',google_email:'user@premiere-mode.co.jp',notion_user_id:'notion-user-id',domains:['EC']}]);assert.equal(r.omittedPeople,1);assert.equal(r.data.clients[0].domains[0],'example.com');assert.equal(JSON.stringify(r.data).includes('not-exported'),false);assert.equal(JSON.stringify(r.data).includes('private@example.com'),false);
});
