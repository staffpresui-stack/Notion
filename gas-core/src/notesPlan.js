// 既存サービスのAIメモを整形するだけです。外部AIによる推論・新しい要約は行いません。
var NotesPlan_=(function(){
  var domains=['セールス・マーケ','EC','生産管理','経理・バックオフィス','Salesforce・AI','経営'];
  function list(v){if(Array.isArray(v))return v;if(!v)return [];try{var a=JSON.parse(v);if(Array.isArray(a))return a;}catch(ignore){}return String(v).split(/[,、\n]/).map(function(s){return s.trim();}).filter(Boolean);}
  function participantText(value,people){var raw=String(value||''),out=[],seen={};function add(email,name){email=String(email||'').toLowerCase();var key=email||name;if(!seen[key]){seen[key]=true;out.push({email:email,name:name||email});}}
    (raw.match(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)||[]).forEach(function(e){add(e,e);});
    raw.split(/[,、;\n]/).map(function(s){return s.trim();}).filter(Boolean).forEach(function(name){if(name.includes('@'))return;var matched=(people||[]).filter(function(p){return p.name===name;});if(matched.length===1)add(matched[0].google_email,name);else add('',name);});return out;
  }
  function masters(input){var result=Object.assign({},input),internal=list(input.internal).map(function(v){return v.toLowerCase();});if(internal.some(function(v){return ['gmail.com','yahoo.co.jp','outlook.com','icloud.com'].includes(v);}))throw new Error('フリーメール全体を社内にせず、社員メールを完全一致で登録してください。');(input.people||[]).forEach(function(p){[p.google_email].concat(list(p.alt_emails)).forEach(function(e){e=String(e||'').trim().toLowerCase();if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))internal.push(e);});});result.internal=Array.from(new Set(internal));return result;}
  function section(text,name){var lines=String(text||'').split('\n'),found=false,out=[];lines.forEach(function(line){if(/^\s*#{1,6}\s/.test(line)){var heading=line.replace(/^\s*#+\s*/,'').trim();if(found)found=false;if(name.test(heading))found=true;return;}if(found&&line.trim())out.push(line.replace(/^\s*[-*•]\s*/,''));});return out;}
  function plan(m,notes,transcript,input,projects,rules){
    if(!m||!/^(meet|tldv):[A-Za-z0-9_-]+$/.test(m.meeting_key||'')||!Number.isFinite(Date.parse(m.start)))throw new Error('会議キー・日時を確認してください。');
    notes=String(notes||'').trim();transcript=String(transcript||'').trim();if(!notes&&!transcript)throw new Error('AIメモも文字起こしもありません。リンクだけのページは処理できません。');if(notes.length+transcript.length>200000)throw new Error('本文が上限を超えました。省略せず停止します。');
    var master=masters(input),rule=MeetingRules_.classify(m.attendees,master),questions=[],scope=rule.scope||'社外',matches=[];
    if(m.end_unknown)questions.push('実際の終了時刻は不明です。Driveの本文安定を確認して作成しました（終了の確定ではありません）。');if(m.participants_incomplete)questions.push('予定なしMeetの参加者はメモに明記された範囲です。参加者全員を確認してください。');
    if(m.time_unknown)questions.push('会議の時刻が不明です。日付だけを転記しています。');if(m.source==='tldv'&&!m.end)questions.push('会議の終了時刻/長さを確認してください。');
    if(rule.incomplete)questions.push('参加者メールが不足しています。社内/社外と確認者を確認してください。');
    var keywordRules=rules||domains.map(function(d){return {domain:d,terms:[d]};});
    keywordRules.forEach(function(r){if(!domains.includes(r.domain)||!Array.isArray(r.terms)||r.terms.some(function(t){return typeof t!=='string'||t.length<2;}))throw new Error('CLASSIFICATION_RULES_JSONの部署・キーワードが不正です。');if(r.terms.some(function(term){var needle=term.normalize('NFKC').toLowerCase(),hay=String(m.title||'').normalize('NFKC').toLowerCase();if(/^[a-z0-9]+$/i.test(needle))return new RegExp('(^|[^a-z0-9])'+needle+'([^a-z0-9]|$)','i').test(hay);return hay.includes(needle);}))matches.push(r.domain);});
    if(!matches.length){var emails=(m.attendees||[]).map(function(p){return String(p.email||'').toLowerCase();});(master.people||[]).filter(function(p){return [p.google_email].concat(list(p.alt_emails)).some(function(e){return emails.includes(String(e||'').toLowerCase());});}).forEach(function(p){matches=matches.concat(list(p.domains).filter(function(d){return domains.includes(d);}));});}
    matches=Array.from(new Set(matches));if(matches.length!==1){matches=[];questions.push('事業部領域を一意に決められません。');}
    if(scope==='社外'&&!rule.client)questions.push(rule.ambiguous_client?'顧客が複数候補です。':'顧客がマスタで特定できません。');
    var placement=scope==='社内'?(matches.length?'社内/'+matches[0]:'社内/事業部全体'):'社外/'+(rule.client||'顧客未特定（要確認）');
    var related=(projects||[]).filter(function(p){return p.title&&p.title.length>=4&&String(m.title||'').includes(p.title);}).map(function(p){return p.id;});
    if(!related.length)questions.push('関連プロジェクトはタイトル完全一致の根拠がなく未設定です。');
    var notesOnly=!transcript;if(notesOnly)questions.push('文字起こしなし・メモから作成');if(!notes)questions.push('AIメモがありません。新たな要約は行わず文字起こしを転記します。');
    var sensitive=/人事|評価|健康|給与|採用|経営|機密/.test(String(m.title||'')+'\n'+notes),confidence=m.end_unknown||m.participants_incomplete||m.time_unknown||m.source==='tldv'&&!m.end||rule.incomplete||!matches.length||scope==='社外'&&!rule.client||notesOnly||!notes?'低':'高';
    var date=new Date(Date.parse(m.start)+9*3600000).toISOString().slice(0,10),title=date+' '+String(m.title||'会議'),decisions=section(notes,/^決定事項$/),actions=section(notes,/^(推奨される次のステップ|次のステップ|ネクストアクション|Next steps|Action items)$/i);
    var markdown='## 基本情報\n- 日時：'+m.start+(m.time_unknown?'（日付のみ・時刻要確認）':'')+'\n- 記録元：'+(m.source==='meet'?'Meet / Gemini':'tl;dv')+'\n- 参加者：'+(m.attendees||[]).map(function(p){return p.name||p.email||'要確認';}).join('、')+'\n- 作成方式：既存AIメモの転記・ルール判定（追加のAI要約なし）\n'+(notesOnly?'- 文字起こしなし・メモから作成\n':'')+'\n## AIメモ（提供元の内容）\n'+(notes||'AIメモはありません。')+'\n\n## 決定事項\n'+(decisions.length?decisions.map(function(s){return '- '+s;}).join('\n'):'- 提供元メモで決定事項を明示できません。要確認。')+'\n\n## ネクストアクション\n'+(actions.length?actions.map(function(s){return '- '+s;}).join('\n'):'- 提供元メモを確認してください。担当・期日は補完していません。')+'\n\n## 要確認\n'+(questions.length?questions.map(function(q){return '- '+q;}).join('\n'):'- 内容の確認をお願いします。')+(transcript?'\n\n## 文字起こし（提供元の原文）\n'+transcript:'');
    return {meeting_key:m.meeting_key,source:m.source,scope:scope,placement:placement,domains:matches,related_project_ids:related,minutes_title:title,minutes_doc_id:null,minutes_markdown:markdown,confidence:confidence,reason:(confidence==='高'?'登録マスタ・会議名の明示キーワードで判定しました。':'一意に決められない項目があり、仕分け待ちで確認が必要です。')+(notesOnly?'文字起こしなし・メモから作成。':''),sensitive:sensitive,summary:{decisions:decisions,next_actions:actions.map(function(s){return {who:'要確認',what:s,due:null};})},task_proposals:[],open_questions:questions};
  }
  return {plan:plan,masters:masters,participantText:participantText,list:list,section:section};
})();
