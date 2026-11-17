// Preserve newly introduced routes when a previous deployment has a newer
// collection timestamp but knows nothing about those endpoints yet.
export function mergeSnapshots(local,remote){
  if(remote?.schema!==1||!remote.routes||typeof remote.routes!=='object')return local;
  const routes={...(local.routes||{})};
  for(const [key,value] of Object.entries(remote.routes)){
    const old=routes[key];
    if(key.startsWith('/api/fund-holdings')&&old?.as_of&&value?.as_of<old.as_of)continue;
    if(!old||String(value?.fetched_at||'')>String(old.fetched_at||''))routes[key]=value;
  }
  return {schema:1,generated_at:[local.generated_at,remote.generated_at].filter(Boolean).sort().at(-1),routes};
}
