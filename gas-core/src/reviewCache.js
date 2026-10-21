// 権限・version・更新対象の所属はキャッシュしません。表示データだけ短時間再利用します。
var ReviewCache_ = (function () {
  function get(key) { try { var value=CacheService.getScriptCache().get('rv2:'+key); return value ? JSON.parse(value) : null; } catch(e) { return null; } }
  function put(key,value,seconds) { try { var text=JSON.stringify(value); if(text.length<24000) CacheService.getScriptCache().put('rv2:'+key,text,seconds||120); } catch(e) {} return value; }
  function remove(key) { try { CacheService.getScriptCache().remove('rv2:'+key); } catch(e) {} }
  return {get:get,put:put,remove:remove};
})();
