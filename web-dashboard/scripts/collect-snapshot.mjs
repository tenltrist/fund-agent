// Public-market data only. Never read portfolio.json, peak_state or browser exports.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {INDICES,quotes,minute,daily,flows,sectors,funds,fundHistory,vix,fundDirectory,fundRankings} from '../worker/data.js';
const root=fileURLToPath(new URL('..',import.meta.url));
const directory=resolve(root,'public/data');await mkdir(directory,{recursive:true});
const watch=JSON.parse(await readFile(resolve(root,'market-watchlist.json'),'utf8'));
let previous={routes:{}};try{previous=JSON.parse(await readFile(resolve(directory,'snapshot.json'),'utf8'));}catch{}
const base=process.env.PAGES_BASE_URL||'https://tenltrist.github.io/fund-agent/';
try{const r=await fetch(new URL('data/snapshot.json',base),{signal:AbortSignal.timeout(8000)});if(r.ok){const j=await r.json();if(j.schema===1&&j.generated_at>previous.generated_at)previous=j;}}catch{}
const routes={...previous.routes},errors=[];
const jobs=[['/api/indices',()=>quotes(INDICES)],['/api/sectors',sectors],['/api/flows?code=market&period=intraday',()=>flows('market','intraday')],['/api/flows?code=market&period=history',()=>flows('market','history')],['/api/vix',vix],['/api/funds',()=>funds(watch.funds)],['/api/quotes',()=>quotes(watch.stocks)]];
for(const code of [...new Set([...INDICES,...watch.stocks])]){
  jobs.push(['/api/minute?code='+code,()=>minute(code)]);
  jobs.push(['/api/daily?code='+code,()=>daily(code)]);
  if(!INDICES.includes(code))jobs.push(['/api/flows?code='+code+'&period=history',()=>flows(code,'history')]);
}
for(const code of watch.funds)jobs.push(['/api/fund-history?code='+code,()=>fundHistory(code),1800000]);
let cursor=0;
await Promise.all(Array.from({length:4},async()=>{while(cursor<jobs.length){const[key,load,ttl]=jobs[cursor++];const old=routes[key];if(ttl&&old?.history_scope==='all'&&old?.managers&&old?.fetched_at&&Date.now()-Date.parse(old.fetched_at)<ttl)continue;try{routes[key]=await load();}catch(error){errors.push({route:key,error:error.message});if(old)routes[key]={...old,stale:true,error:'快照更新失败，保留上次数据：'+error.message};}}}));
const snapshot={schema:1,generated_at:new Date().toISOString(),routes,errors};
if(!routes['/api/indices']?.items?.length)throw Error('没有可发布的指数数据；不覆盖现有站点');
await writeFile(resolve(directory,'snapshot.json'),JSON.stringify(snapshot));
for(const[name,load]of [['fund-directory',fundDirectory],['fund-navs',fundRankings]]){
  try{await writeFile(resolve(directory,name+'.json'),JSON.stringify(await load()));}
  catch(error){errors.push({route:name,error:error.message});try{const r=await fetch(new URL('data/'+name+'.json',base),{signal:AbortSignal.timeout(8000)});if(r.ok)await writeFile(resolve(directory,name+'.json'),await r.text());}catch{}}
}
await writeFile(resolve(directory,'snapshot.json'),JSON.stringify(snapshot));
console.log(JSON.stringify({generated_at:snapshot.generated_at,routes:Object.keys(routes).length,fund_coverage:routes['/api/funds']?.items?.length,sector_count:routes['/api/sectors']?.items?.length,errors},null,2));
