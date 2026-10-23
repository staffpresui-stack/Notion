// shared/fastBudget.jsから生成します。
// 1分トリガーの実測時間を日次管理します。Workspaceの全プロジェクト合計6時間とは別の保守的な枠です。
var FastBudget_={run:function(c,email,kind,fn){var p=PropertiesService.getScriptProperties(),day=new Date(Date.now()+9*3600000).toISOString().slice(0,10),key='FAST_BUDGET:'+c.ENV+':'+kind+':'+email,raw=p.getProperty(key),v=raw?JSON.parse(raw):{};if(v.day!==day)v={day:day,ms:0,runs:0};if(v.ms>=90*60000)return {status:'短間隔の本日予算に達しました。通常トリガーを継続します。'};var start=Date.now();try{return fn();}finally{v.ms+=Math.max(0,Date.now()-start);v.runs++;if(c.DRY_RUN==='false')p.setProperty(key,JSON.stringify(v));}}};
