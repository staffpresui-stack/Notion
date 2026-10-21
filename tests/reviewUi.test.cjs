const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
 const {window}=parseHTML(fs.readFileSync('gas-core/src/ui/Index.html','utf8'));
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return [...this.options].find(o=>o.hasAttribute('selected'))?.value||this.options[0]?.value||''},set(v){for(const o of this.options){if(o.value===v)o.setAttribute('selected','');else o.removeAttribute('selected')}}});
 const document=window.document;for(const el of document.querySelectorAll('input'))if(el.type!=='checkbox')el.value='';
 let row={meeting_key:'k',display_id:'MTG-261021-01',title:'<img src=x onerror=alert(1)>',event_start:'2026-10-21T02:00:00Z',event_end:'2026-10-21T03:00:00Z',source:'meet',status:'確認待ち',placement_final:'社内/EC',scope_final:'社内',domains_final:'["EC"]',related_project_ids_final:'[]',taskCount:1,confidence:.9,minutes_title:'議事録',version:1,attendees:[],links:[],fileStatus:{recording:'あり',transcript:'あり',gemini:'なし'},summary:{decisions:['保存先を決定'],next_actions:[{who:'担当者',what:'共有する',due:'2026-10-23'}]},history:[{at:'2026-10-21T02:00:00Z',actor:'finance@premiere-mode.co.jp',action:'confirm',result:'成功',before:'{"status":"確認待ち","minutes_title":"同じ名前"}',after:'{"status":"確定","minutes_title":"同じ名前"}'}]};
 const boot={actor:'finance@premiere-mode.co.jp',admin:true,dryRun:true,nonce:'test',choices:{folders:['社内/EC'],projects:[]},list:{total:1,offset:0,rows:[row]}};
 const calls=[];let stale=false;
 function runner(success,failure){return new Proxy({},{get(t,k){if(k==='withSuccessHandler')return fn=>runner(fn,failure);if(k==='withFailureHandler')return fn=>runner(success,fn);return arg=>{calls.push({name:k,arg});try{if(k==='reviewSubmit'&&stale){stale=false;row={...row,version:2,minutes_title:'先に更新された名前'};throw Error('先に更新されました。画面を読み込み直してください。')}const value=k==='reviewBootstrap'?boot:k==='reviewList'?boot.list:k==='reviewDetail'?row:k==='reviewSubmit'?{message:'反映しました。',row:{...row,status:arg.action==='exclude'?'対象外':'確定',version:2},dryRun:false}:null;success(value)}catch(e){failure(e)}}}})}
 const ctx=vm.createContext({document,window:{confirm:()=>{throw Error('window.confirmは禁止です')}},google:{script:{run:runner()}},console});
 vm.runInContext(fs.readFileSync('gas-core/src/ui/Scripts.html','utf8').replace(/^<script>\s*/,'').replace(/<\/script>\s*$/,''),ctx);
 return {document,calls,stale:()=>stale=true,async open(){await tick();await document.querySelector('#rows button').onclick()}};
}
test('社員向け表示: 箇条書き・差分だけの日本語履歴・日本時間・ファイル状態を表示し文字列を安全に扱う',async()=>{
 const h=harness();await h.open();const d=h.document;
 assert.equal(d.querySelector('#rows img'),null);assert.match(d.querySelector('#rows').textContent,/<img/);
 assert.equal(d.querySelectorAll('#summary ul li').length,2);assert.match(d.querySelector('#summary').textContent,/担当者：共有する：期限：2026-10-23/);
 assert.match(d.querySelector('#history').textContent,/確定（成功）/);assert.match(d.querySelector('#history').textContent,/状態：確認待ち → 確定/);assert.doesNotMatch(d.querySelector('#history').textContent,/同じ名前|confirm|minutes_title/);
 assert.match(d.querySelector('#history').textContent,/11:00:00（日本時間）/);assert.match(d.querySelector('#facts').textContent,/録画：あり ／ 文字起こし：あり ／ Geminiメモ：なし/);
 assert.doesNotMatch(d.querySelector('#facts').textContent,/"recording"/);
});
test('対象外の画面内確認: キャンセルはRPCなし、承認だけが送信する',async()=>{
 const h=harness();await h.open();const d=h.document,n=h.calls.length;
 await d.querySelector('[data-action="exclude"]').onclick();assert.equal(d.querySelector('#excludeConfirm').hidden,false);assert.equal(h.calls.length,n);
 d.querySelector('#excludeCancel').onclick();assert.equal(d.querySelector('#excludeConfirm').hidden,true);assert.equal(h.calls.length,n);
 await d.querySelector('[data-action="exclude"]').onclick();await d.querySelector('#excludeApprove').onclick();assert.equal(h.calls.at(-1).name,'reviewSubmit');assert.equal(h.calls.at(-1).arg.action,'exclude');assert.match(d.querySelector('#facts').textContent,/状態：対象外/);
});
test('成功後は返却された該当行だけ更新し、一覧・詳細・bootstrapの追加通信をしない',async()=>{
 const h=harness();await h.open();h.calls.length=0;await h.document.querySelector('[data-action="confirm"]').onclick();assert.deepEqual(h.calls.map(c=>c.name),['reviewSubmit']);assert.match(h.document.querySelector('#rows').textContent,/確定/);
});
test('同時編集拒否時は詳細を自動再取得し、新しいversionでのみ次の操作を送信',async()=>{
 const h=harness();await h.open();h.stale();h.calls.length=0;await h.document.querySelector('[data-action="confirm"]').onclick();assert.deepEqual(h.calls.map(c=>c.name),['reviewSubmit','reviewDetail']);assert.equal(h.document.querySelector('#minutesTitle').value,'先に更新された名前');assert.match(h.document.querySelector('#message').textContent,/最新の詳細を読み直しました/);await h.document.querySelector('[data-action="hold"]').onclick();assert.equal(h.calls.at(-1).arg.version,2);
});
