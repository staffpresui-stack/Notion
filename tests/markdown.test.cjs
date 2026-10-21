const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{parseHTML}=require('linkedom');
const clone=x=>JSON.parse(JSON.stringify(x));
function load(){const ctx=vm.createContext({});vm.runInContext(fs.readFileSync('gas-core/src/stage2Content.js','utf8'),ctx);return ctx}
const sample=fs.readFileSync('fixtures/minutes_markdown_sample.md','utf8');
test('議事録7節を見出し・箇条書き・番号付き・タスク提案表としてDoc用HTMLとNotionへ変換',()=>{
 const ctx=load(),content=ctx.Stage2Content_,elements=content.markdown(sample),blocks=content.blocks(elements),{document}=parseHTML(content.html(sample));
 assert.equal(document.querySelectorAll('h2').length,7);assert.equal(document.querySelectorAll('h3').length,1);assert.ok(document.querySelectorAll('ul li').length>3);assert.equal(document.querySelectorAll('ol li').length,2);assert.equal(document.querySelectorAll('table th').length,7);assert.equal(document.querySelectorAll('table tbody tr').length,1);assert.ok(blocks.some(b=>b.type==='table'));assert.ok(blocks.some(b=>b.type==='heading_2'));assert.ok(blocks.some(b=>b.type==='numbered_list_item'));
});
test('HTMLをDocの段落・見出し・リスト・表として読み直してもNotion本文が一致（再開用contentHash）',()=>{
 const ctx=load(),content=ctx.Stage2Content_,{document}=parseHTML(content.html(sample)),children=[];
 const paragraph=(text,heading)=>({getType:()=> 'PARAGRAPH',asParagraph:()=>({getHeading:()=>heading,getText:()=>text})});
 for(const e of document.body.children){
  if(e.tagName==='UL'||e.tagName==='OL')for(const li of e.children)children.push({getType:()=> 'LIST_ITEM',asListItem:()=>({getText:()=>li.textContent,getGlyphType:()=>e.tagName==='OL'?'NUMBER':'BULLET'})});
  else if(e.tagName==='TABLE'){const rows=[...e.querySelectorAll('tr')].map(tr=>[...tr.children].map(td=>td.textContent));children.push({getType:()=> 'TABLE',asTable:()=>({getNumRows:()=>rows.length,getRow:r=>({getNumCells:()=>rows[r].length,getCell:c=>({getText:()=>rows[r][c]})})})});}
  else children.push(paragraph(e.textContent,e.tagName==='H2'?'HEADING2':e.tagName==='H3'?'HEADING3':'NORMAL'));
 }
 ctx.DocumentApp={openById:()=>({getBody:()=>({getNumChildren:()=>children.length,getChild:i=>children[i]})})};
 assert.deepEqual(clone(content.read('created-doc')),clone(content.blocks(content.markdown(sample))));
});
test('表セルのエスケープ縦棒・空セル・不正列数、HTML文字列やURLを安全に扱う',()=>{
 const ctx=load(),c=ctx.Stage2Content_,input='## 表\n| 項目 | 内容 |\n| :--- | ---: |\n| A\\|B | <script>alert(1)</script> |\n| C | |';
 const {document}=parseHTML(c.html(input));assert.equal(document.querySelector('script'),null);assert.equal(document.querySelector('tbody tr td').textContent,'A|B');assert.equal(document.querySelectorAll('tbody tr')[1].children[1].textContent,'');assert.match(document.querySelectorAll('tbody tr')[0].children[1].textContent,/<script>/);assert.throws(()=>c.markdown('| a | b |\n| --- | --- |\n| 一列だけ |'),/列数/);
 const html=c.html('## **決定**\n- [ラベル](https://drive.google.com/file/test)\n1. `確認`');assert.ok(!html.includes('https://'));assert.match(html,/<h2>決定<\/h2>/);assert.match(html,/<li>ラベル<\/li>/);assert.match(html,/<ol><li>確認<\/li><\/ol>/);
});
