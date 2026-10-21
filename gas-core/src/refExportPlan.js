// 参照用に必要な項目だけを取り出します。権限・トークン・自由記述本文は出力しません。
var RefExportPlan_=(function(){
  function text(v){return String(v===undefined||v===null?'':v).trim();}
  function list(v){return Array.from(new Set(ReviewSecurity_.list(v).map(text).filter(Boolean)));}
  function masters(rows,at){
    var omitted=0;
    var people=rows.people.map(function(p){var email=text(p.google_email).toLowerCase();if(!/^[^\s@]+@premiere-mode\.co\.jp$/.test(email)){omitted++;return null;}return {name:text(p.name),google_email:email,notion_user_id:text(p.notion_user_id)||null,domains:list(p.domains)};}).filter(Boolean);
    if(new Set(people.map(function(p){return p.google_email;})).size!==people.length)throw new Error('社員マスタの会社メールが重複しています。');
    var folders=rows.folders.filter(function(f){return text(f.placement);}).map(function(f){return {placement:text(f.placement),notion_domain:text(f.notion_domain)||null};});
    var clients=rows.clients.filter(function(c){return text(c.client_name);}).map(function(c){return {client_name:text(c.client_name),domains:list(c.domains).map(function(d){return d.toLowerCase();})};});
    return {data:{schema_version:1,env:'test',generated_at:at,folders:folders,clients:clients,internal:list(rows.internal).map(function(v){return v.toLowerCase();}),people:people},omittedPeople:omitted};
  }
  function project(page){
    var props=page.properties||{},titles=Object.keys(props).filter(function(k){return props[k].type==='title';});
    if(titles.length!==1)throw new Error('プロジェクト・タスクのタイトルを1つに特定できません。');
    var status=props['ステータス'],domains=props['事業部領域'],parent=props['親アイテム'],due=props['期日'];
    return {id:page.id,title:(props[titles[0]].title||[]).map(function(t){return t.plain_text||t.text&&t.text.content||'';}).join(''),status:status&&['status','select'].includes(status.type)&&status[status.type]?status[status.type].name||null:null,
      domains:domains&&domains.type==='multi_select'?(domains.multi_select||[]).map(function(d){return d.name;}):[],parent_ids:parent&&parent.type==='relation'?(parent.relation||[]).map(function(r){return r.id;}):[],due:due&&due.type==='date'&&due.date?due.date.start:null};
  }
  return {masters:masters,project:project};
})();
