// 公式DiscoveryのparameterOrderとApps Scriptの「body→必須→media→optional」規則。
// https://developers.google.com/apps-script/guides/services/advanced
// Drive v3 / Calendar v3 / Docs v1、2026-10-23に公式定義と照合。
const assert=require('node:assert/strict');
const signatures={
 'Drive.Changes.list':{required:['string'],optional:1,noOptional:['pageToken']},
 'Drive.Changes.getStartPageToken':{required:[],optional:1,noOptional:['pageToken']},
 'Drive.Files.list':{required:[],optional:1},
 'Drive.Files.generateIds':{required:[],optional:1},
 'Drive.Files.get':{required:['string'],optional:1},
 'Drive.Files.create':{required:['object'],optional:2,media:true},
 'Drive.Files.update':{required:['object','string'],optional:2,media:true},
 'Calendar.Events.list':{required:['string'],optional:1},
 'Calendar.Events.get':{required:['string','string'],optional:1},
 'Docs.Documents.get':{required:['string'],optional:1}
};
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function check(name,args){const s=signatures[name];if(!s)return;assert.ok(args.length>=s.required.length&&args.length<=s.required.length+s.optional,name+': 引数数');
 s.required.forEach((type,i)=>{assert.ok(type==='object'?object(args[i]):typeof args[i]===type&&args[i].length>0,name+': 必須引数'+(i+1)+'は'+type);});
 const index=s.required.length+(s.media?1:0),options=args[index];
 if(options!==undefined){assert.ok(object(options),name+': optionalArgsはオブジェクト');for(const key of s.noOptional||[])assert.ok(!(key in options),name+': '+key+'は位置引数です');}
 // mediaの位置は省略/nullまたはBlob（モックもオブジェクト）です。
 if(s.media&&args[s.required.length]!=null)assert.ok(object(args[s.required.length]),name+': mediaDataはBlobまたはnull');
}
function enforce(ctx){function proxy(target,path){return new Proxy(target,{get(obj,key){const value=Reflect.get(obj,key);if(typeof key!=='string')return value;const name=path+'.'+key;
 if(typeof value==='function'&&signatures[name])return function(...args){check(name,args);return Reflect.apply(value,obj,args);};
 if(value&&typeof value==='object'&&Object.keys(signatures).some(k=>k.startsWith(name+'.')))return proxy(value,name);return value;
 }});}for(const service of ['Drive','Calendar','Docs'])if(ctx[service])ctx[service]=proxy(ctx[service],service);}
module.exports={check,enforce};
