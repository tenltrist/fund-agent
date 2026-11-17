import {INDICES,quotes,minute,daily,flows,sectors,funds,searchFunds,fundHistory,fundDirectory,fundRankings,vix,marketClock,flowBridgeHtml} from './data.js';
const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"};
const response=(body,type='application/json; charset=utf-8',status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{...headers,'Content-Type':type,'Cache-Control':'no-store'}});
export default {async fetch(request) {
  const url=new URL(request.url),path=url.pathname;
  if(request.method!=='GET'&&request.method!=='HEAD')return response({error:'仅支持读取'},undefined,405);
  if(path==='/')return response(__HTML__,'text/html; charset=utf-8');
  if(path==='/assets/app.js')return response(__APP__,'text/javascript; charset=utf-8');
  if(path==='/assets/style.css')return response(__CSS__,'text/css; charset=utf-8');
  if(path==='/api/health')return response({ok:true,clock:marketClock(),personal_data:'持仓和自选保存在浏览器，不上传服务器'});
  try {
    let data;
    if(path==='/bridge/flows'){
      const html=flowBridgeHtml(url.searchParams.get('code')||'market',url.searchParams.get('period')||'intraday',url.searchParams.get('nonce')||'');
      return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline' https://push2.eastmoney.com https://push2his.eastmoney.com; sandbox allow-scripts;"}});
    }
    if(path==='/api/fund-directory')data=await fundDirectory();
    else if(path==='/api/fund-rankings')data=await fundRankings();
    else if(path==='/api/indices')data=await quotes(INDICES);
    else if(path==='/api/quotes')data=await quotes((url.searchParams.get('codes')||'sh600519').split(','));
    else if(path==='/api/minute')data=await minute(url.searchParams.get('code')||'sh000001');
    else if(path==='/api/daily')data=await daily(url.searchParams.get('code')||'sh000001');
    else if(path==='/api/flows')data=await flows(url.searchParams.get('code')||'market',url.searchParams.get('period')==='history'?'history':'intraday');
    else if(path==='/api/sectors')data=await sectors();
    else if(path==='/api/funds')data=await funds((url.searchParams.get('codes')||'').split(',').filter(Boolean));
    else if(path==='/api/search-funds') {const q=(url.searchParams.get('q')||'').trim();if(q.length<2)throw Error('至少输入2个字或数字');data=await searchFunds(q.slice(0,40));}
    else if(path==='/api/fund-history')data=await fundHistory(url.searchParams.get('code')||'');
    else if(path==='/api/vix')data=await vix();
    else return response({error:'未找到页面'},undefined,404);
    return response(data);
  }catch(error){return response({error:error.message||'数据源暂不可用',available:false,fetched_at:new Date().toISOString()},undefined,502);}
}};
