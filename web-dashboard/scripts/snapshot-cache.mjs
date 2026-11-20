import {chinaDate} from '../worker/data.js';

// A successful request can still omit individual funds. Keep dated public
// values for those codes rather than replacing a complete snapshot with a gap.
export function mergeFundSnapshots(previous,fresh,codes,currentDate=chinaDate()){
  const valid=row=>row&&/^\d{6}$/.test(row.code)&&Number.isFinite(row.nav)&&row.nav>0&&/^\d{4}-\d{2}-\d{2}$/.test(row.date)&&row.date<=currentDate;
  const wanted=codes||[...new Set([...(previous?.items||[]),...(fresh?.items||[])].map(row=>row.code).concat(previous?.missing||[],fresh?.missing||[]))];
  const fallback=[],items=[];
  for(const code of wanted){
    const old=previous?.items?.find(row=>row.code===code&&valid(row));
    const next=fresh?.items?.find(row=>row.code===code&&valid(row));
    if(old&&(!next||old.date>next.date)){
      fallback.push(code);
      items.push({...old,stale:true,fetched_at:old.fetched_at||previous.fetched_at});
    }else if(next)items.push(next);
  }
  return {...fresh,items,missing:wanted.filter(code=>!items.some(row=>row.code===code)),fallback_codes:fallback,
    warnings:[...(fresh?.warnings||[]),...(fallback.length?['部分基金本次缺失或日期回退，保留原日期缓存：'+fallback.join('、')]:[])],
    stale:!!fresh?.stale||fallback.length>0};
}

// Preserve newly introduced routes when a previous deployment has a newer
// collection timestamp but knows nothing about those endpoints yet.
export function mergeSnapshots(local,remote){
  if(remote?.schema!==1||!remote.routes||typeof remote.routes!=='object')return local;
  const routes={...(local.routes||{})};
  for(const [key,value] of Object.entries(remote.routes)){
    const old=routes[key];
    if(key.startsWith('/api/fund-holdings')&&old?.as_of&&value?.as_of<old.as_of)continue;
    if(key==='/api/funds'){
      routes[key]=!old||String(value?.fetched_at||'')>String(old.fetched_at||'')?mergeFundSnapshots(old,value):mergeFundSnapshots(value,old);
      continue;
    }
    if(!old||String(value?.fetched_at||'')>String(old.fetched_at||''))routes[key]=value;
  }
  return {schema:1,generated_at:[local.generated_at,remote.generated_at].filter(Boolean).sort().at(-1),routes};
}
