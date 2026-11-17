// Public quote/data adapters. Request contracts referenced from AKShare and
// z8-ui/stock-tracker (MIT); see THIRD_PARTY_NOTICES.md. No simulated quotes.
export const UT = 'bd1d9ddb04089700cf9c27f6f7426281'; // public Eastmoney client parameter
export const INDICES = ['sh000001','sz399001','sz399006','sh000300','sh000688'];
const memo = new Map();
const inflight = new Map();
export const number = value => value === null || value === undefined || value === '' || typeof value === 'boolean' || ['-','--','None'].includes(value) ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
const required = value => { const n = number(value); if (n === null) throw Error('来源缺少有效数值'); return n; };
export const strip = text => String(text).replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').trim();
export const chinaDate = (value=Date.now()) => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export function marketClock() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
  const minutes=Number(parts.hour)*60+Number(parts.minute), weekday=!['Sat','Sun'].includes(parts.weekday);
  const trading=weekday&&((minutes>=570&&minutes<690)||(minutes>=780&&minutes<900));
  return {trading,label:trading?'A股交易时段':weekday&&minutes>=690&&minutes<780?'A股午间休市':'A股非交易时段',timezone:'Asia/Shanghai',calendar_note:'按常规交易时段判断；节假日与停牌以来源行情日期为准'};
}
export async function cached(key,ttl,load) {
  const hit=memo.get(key);
  if(hit&&Date.now()-hit.saved<ttl) return {...hit.value,cached:true};
  if(inflight.has(key)) return inflight.get(key);
  const work=(async()=>{
    try { const value={...await load(),fetched_at:new Date().toISOString(),stale:false}; if(memo.size>160)memo.delete(memo.keys().next().value); memo.set(key,{saved:Date.now(),value}); return value; }
    catch(error) { if(hit&&Date.now()-hit.saved<86400000) return {...hit.value,stale:true,cached:true,error:'本次更新失败，保留原数据：'+error.message}; throw error; }
    finally { inflight.delete(key); }
  })();
  inflight.set(key,work); return work;
}
export async function text(url,{encoding,timeout=9000}={}) {
  const referer=url.includes('fund.eastmoney.com')?'https://fund.eastmoney.com/fundguzhi.html':url.includes('eastmoney.com')?'https://quote.eastmoney.com/':new URL(url).origin+'/';
  const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36','Referer':referer},signal:AbortSignal.timeout(timeout)});
  if(!response.ok) throw Error(`数据源 HTTP ${response.status}`);
  const bytes=await response.arrayBuffer();
  return new TextDecoder(encoding||'utf-8').decode(bytes);
}
const json=async url=>JSON.parse(await text(url));
const east=(path,params,host='push2.eastmoney.com')=>'https://'+host+'/api/qt/'+path+'?'+new URLSearchParams({...params,ut:UT});
export function stockCode(input) {
  let code=String(input||'').toLowerCase().trim();
  if(/^\d{6}$/.test(code)) code=(/^[569]/.test(code)?'sh':/^[48]/.test(code)?'bj':'sz')+code;
  if(!/^(sh|sz|bj)\d{6}$/.test(code)) throw Error('请输入6位A股/场内ETF代码，或 sh000001 等指数代码');
  return code;
}
const secid=code=>(code.startsWith('sh')?'1.':code.startsWith('bj')?'0.':'0.')+code.slice(2);
export function parseQuotes(raw) {
  const out=[];
  for(const match of raw.matchAll(/v_((?:sh|sz|bj)\d{6})="([^"]*)"/g)) {
    const a=match[2].split('~');
    if(a.length<38||number(a[3])===null||Number(a[3])<=0) continue;
    const t=/^\d{14}$/.test(a[30])?a[30]:null;
    out.push({code:match[1],name:a[1],price:number(a[3]),previous_close:number(a[4]),open:number(a[5]),change:number(a[31]),pct:number(a[32]),high:number(a[33]),low:number(a[34]),turnover_yuan:number(a[37])===null?null:Number(a[37])*10000,volume_lots:number(a[36]),pe:number(a[39]),pb:number(a[46]),as_of:t?`${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)} ${t.slice(8,10)}:${t.slice(10,12)}:${t.slice(12,14)}`:null});
  }
  return out;
}
export async function quotes(codes) {
  const clean=[...new Set(codes.map(stockCode))].slice(0,40);
  return cached('quotes:'+clean.join(),20000,async()=>{
    const items=parseQuotes(await text('https://qt.gtimg.cn/q='+clean.join(','),{encoding:'gb18030'}));
    if(!items.length) throw Error('腾讯行情未返回有效报价');
    return {items,missing:clean.filter(c=>!items.some(r=>r.code===c)),source:'腾讯财经',source_url:'https://gu.qq.com/',clock:marketClock()};
  });
}
export async function minute(input) {
  const code=stockCode(input);
  return cached('minute:'+code,30000,async()=>{
    const payload=await json('https://web.ifzq.gtimg.cn/appstock/app/minute/query?code='+code);
    const block=payload.data?.[code], rows=block?.data?.data;
    if(!Array.isArray(rows)||!rows.length) throw Error('暂无分时数据');
    const quote=block.qt?.[code];
    const points=rows.map(row=>{const a=row.split(' ');return {time:a[0].slice(0,2)+':'+a[0].slice(2),price:number(a[1]),volume:number(a[2]),turnover_yuan:number(a[3])};}).filter(r=>r.price!==null);
    const rawDate=String(block.data.date||'');
    const date=/^\d{8}$/.test(rawDate)?rawDate.slice(0,4)+'-'+rawDate.slice(4,6)+'-'+rawDate.slice(6):rawDate||null;
    return {code,points,date,previous_close:quote?number(quote[4]):null,source:'腾讯财经 · 实际分时点',source_url:'https://gu.qq.com/'};
  });
}
export async function daily(input) {
  const code=stockCode(input);
  return cached('daily:'+code,300000,async()=>{
    const payload=await json('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param='+code+',day,,,100,qfq');
    const block=payload.data?.[code],rows=block?.qfqday||block?.day;
    if(!Array.isArray(rows)||!rows.length) throw Error('暂无日线数据');
    return {code,points:rows.map(a=>({date:a[0],open:number(a[1]),close:number(a[2]),high:number(a[3]),low:number(a[4]),volume:number(a[5])})),source:'腾讯财经 · 前复权日线',source_url:'https://gu.qq.com/'};
  });
}
export function parseFlows(rows) {
  return (rows||[]).map(row=>{
    const a=row.split(',');
    if(a.length<6||a.slice(1,6).some(v=>number(v)===null)) return null;
    return {time:a[0],main:Number(a[1])/1e8,small:Number(a[2])/1e8,middle:Number(a[3])/1e8,large:Number(a[4])/1e8,super_large:Number(a[5])/1e8};
  }).filter(Boolean);
}
export async function flows(input='market',period='intraday') {
  const market=input==='market', code=market?'sh000001':stockCode(input), history=period==='history';
  return cached('flow:'+input+':'+period,history?300000:30000,async()=>{
    try {
      const payload=await json(flowUrl(input,period));
      const points=parseFlows(payload.data?.klines).slice(history?-30:-300);
      if(!points.length) throw Error('东方财富暂未提供该标的资金曲线');
      return {code:market?'market':code,points,as_of:points.at(-1).time,unit:'亿元',source:'东方财富 · '+(market?'沪深两市':'个股')+'资金流',source_url:'https://data.eastmoney.com/zjlx/',method:'按数据源的买卖方向与订单规模划分；主力=超大单+大单。净流入是交易分类统计，并非市场新增现金。'};
    } catch(error) {
      if(!market||history)throw error;
      const payload=await json(east('ulist.np/get',{fltt:'2',secids:'1.000001,0.399001',fields:'f12,f14,f62,f66,f72,f78,f84'}));
      const rows=diffRows(payload);
      if(rows.length!==2)throw Error('沪深两市资金快照不完整');
      const point={main:0,super_large:0,large:0,middle:0,small:0};
      for(const row of rows)for(const[key,field]of Object.entries({main:'f62',super_large:'f66',large:'f72',middle:'f78',small:'f84'}))point[key]+=required(row[field])/1e8;
      return {code:'market',observation:true,snapshot:point,points:[],as_of:null,unit:'亿元',source:'东方财富 · 沪深两市资金快照',source_url:'https://data.eastmoney.com/zjlx/',method:'全天曲线接口暂不可用，改为从启用监测后逐次采集的快照曲线，没有回填此前历史。来源未提供行情时间戳；横轴为采集时间。'};
    }
  });
}
export function flowUrl(input='market',period='intraday') {
  const market=input==='market',code=market?'sh000001':stockCode(input),history=period==='history';
  const params={secid:secid(code),fields1:'f1,f2,f3,f7',fields2:'f51,f52,f53,f54,f55,f56',lmt:'0',klt:history?'101':'1'};
  if(market)params.secid2='0.399001';
  return east('stock/fflow/'+(history?'daykline':'kline')+'/get',params,history?'push2his.eastmoney.com':'push2.eastmoney.com');
}
export function flowBridgeHtml(input,period,nonce) {
  if(!/^[a-f0-9-]{20,50}$/.test(nonce))throw Error('无效桥接请求');
  const url=flowUrl(input,period)+'&cb=__flowCallback';
  return '<!doctype html><meta charset="utf-8"><script>function __flowCallback(payload){parent.postMessage({kind:"public-flow",nonce:'+JSON.stringify(nonce)+',payload},"*")}</script><script src='+JSON.stringify(url)+'></script>';
}
function diffRows(payload) { const diff=payload.data?.diff;return Array.isArray(diff)?diff:diff?Object.values(diff):[]; }
export async function sectors() {
  return cached('sectors',120000,async()=>{
    try {
      const params={pn:'1',pz:'100',fid:'f62',fs:'m:90+t:2',fields:'f12,f14,f2,f3,f62,f6,f104,f105',fltt:'2',np:'1'};
      const first=await json(east('clist/get',params));
      const total=first.data?.total||0;
      if(!diffRows(first).length) throw Error('板块返回空数据');
      const pages=Math.min(Math.ceil(total/100),8),failed=[];
      const more=await Promise.all(Array.from({length:Math.max(0,pages-1)},(_,i)=>i+2).map(async pn=>{
        try{return diffRows(await json(east('clist/get',{...params,pn:String(pn)})));}catch{failed.push(pn);return [];}
      }));
      const unique=[...new Map([...diffRows(first),...more.flat()].map(r=>[r.f12,r])).values()];
      const items=unique.map(r=>({code:r.f12,name:r.f14,pct:number(r.f3),net_flow:number(r.f62)===null?null:Number(r.f62)/1e8,turnover_yi:number(r.f6)===null?null:Number(r.f6)/1e8,up:number(r.f104),down:number(r.f105)}));
      return {items,total,complete:items.length===total&&!failed.length,missing_pages:failed,as_of:null,source:'东方财富行业板块（含不同层级分类）',source_url:'https://quote.eastmoney.com/center/boardlist.html#industry_board',note:'来源未提供板块行情时间戳；抓取时间不等于数据时间。不同层级行业可能重叠，不累加为全市场资金。'};
    } catch(primary) {
      const pages=await Promise.all([1,2].map(page=>text('https://q.10jqka.com.cn/thshy/index/field/199112/order/desc/page/'+page+'/ajax/1/',{encoding:'gb18030'})));
      const items=pages.flatMap(html=>[...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(match=>{
        const cells=[...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c=>strip(c[1]));
        return cells.length>=10?{code:match[1].match(/detail\/code\/(\d+)/)?.[1]||cells[1],name:cells[1],pct:number(cells[2]),turnover_yi:number(cells[4]),net_flow:number(cells[5]),up:number(cells[6]),down:number(cells[7])}:null;
      }).filter(Boolean));
      if(!items.length) throw primary;
      return {items:[...new Map(items.map(r=>[r.code,r])).values()],total:items.length,complete:false,as_of:null,source:'同花顺行业一览（备用来源）',source_url:'https://q.10jqka.com.cn/thshy/',note:'主来源不可用，改用同花顺；分类与主来源不同。抓取时间不是行情时间。'};
    }
  });
}
export function assignedArray(raw,name) {
  const start=raw.indexOf('=',raw.indexOf('var '+name));
  if(start<0||!raw.includes('var '+name)) throw Error('数据源缺少 '+name);
  const from=raw.indexOf('[',start); let depth=0,quoted=false,escaped=false;
  for(let i=from;i<raw.length;i++) {
    const c=raw[i];if(escaped){escaped=false;continue;}if(c==='\\'&&quoted){escaped=true;continue;}if(c==='"'){quoted=!quoted;continue;}if(quoted)continue;
    if(c==='[')depth++;if(c===']'&&--depth===0)return JSON.parse(raw.slice(from,i+1));
  }
  throw Error('数据数组不完整');
}
export async function fundRankings() {
  return cached('fund-rankings',300000,async()=>{
    const year=Number(chinaDate().slice(0,4))-1;
    const params={op:'ph',dt:'kf',ft:'all',rs:'',gs:'0',sc:'1nzf',st:'desc',sd:year+chinaDate().slice(4),ed:chinaDate(),qdii:'',tabSubtype:',,,,,',pi:'1',pn:'30000',dx:'1',v:'0.1591891419018292'};
    const raw=await text('https://fund.eastmoney.com/data/rankhandler.aspx?'+new URLSearchParams(params));
    const match=raw.match(/["']?datas["']?\s*:\s*(\[[\s\S]*?\])/);
    if(!match) throw Error(raw.includes('无访问权限')?'净值榜接口拒绝本次公开请求':'基金净值榜格式变化');
    const items=JSON.parse(match[1]).map(row=>{const a=row.split(',');return {code:a[0],name:a[1],date:a[3],nav:number(a[4]),pct:number(a[6]),ret_1w:number(a[7]),ret_1m:number(a[8]),ret_3m:number(a[9]),source:'已公布净值'};});
    return {items,source:'天天基金 · 已公布净值'};
  });
}
async function fundEstimates() {
  return cached('fund-estimates',60000,async()=>{
    const pages=await Promise.all([1,2].map(p=>text('https://fund.eastmoney.com/lof_fundguzhi'+p+'.html',{encoding:'gb18030',timeout:7000})));
    const items=pages.flatMap(html=>parseEstimates(html));
    return {items,source:'天天基金 · 公开估算（前两页，其他基金回退已公布净值）'};
  });
}
export function parseEstimates(html,currentDate=chinaDate()) {
  const day=html.match(/id=["']gsdata["'][^>]*>[\s\S]*?(\d{4}-\d{2}-\d{2})/)?.[1];
  if(!day)return [];
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(match=>{
    const cells=[...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
    if(cells.length<10)return null;
    const value=i=>cells[i][0].match(/data-gz\s*=\s*["']([^"']*)/)?.[1]||strip(cells[i][1]);
    return {code:strip(cells[2][1]),name:strip(cells[3][1]).replace(/估算图|估值图|基金吧|档案/g,''),date:day,nav:number(value(4)),pct:number(String(value(5)).replace('%','')),source:'盘中估算'};
  }).filter(r=>r&&/^\d{6}$/.test(r.code)&&r.nav>0&&r.pct!==null&&r.date===currentDate);
}
export async function funds(codes) {
  if(codes.some(c=>!/^\d{6}$/.test(c))||codes.length>60)throw Error('最多查询60只六位基金代码');
  const [ranks,estimates]=await Promise.allSettled([fundRankings(),fundEstimates()]);
  const rank=ranks.status==='fulfilled'?ranks.value:null, est=estimates.status==='fulfilled'?estimates.value:null;
  let items=codes.map(code=>{
    const confirmed=rank?.items.find(r=>r.code===code),estimate=est?.items.find(r=>r.code===code);
    return estimate?{...confirmed,...estimate,name:confirmed?.name||estimate.name,confirmed_nav:confirmed?.nav,confirmed_date:confirmed?.date}:confirmed;
  }).filter(r=>r&&r.nav>0&&r.pct!==null);
  const missing=codes.filter(c=>!items.some(r=>r.code===c));
  if(missing.length){
    const archives=await Promise.allSettled(missing.map(code=>fundHistory(code)));
    for(let i=0;i<archives.length;i++)if(archives[i].status==='fulfilled'){
      const history=archives[i].value,last=history.points.at(-1);
      if(last?.nav>0)items.push({code:missing[i],name:history.name||missing[i],date:last.date,nav:last.nav,pct:last.pct,source:'已公布净值 · 基金档案'});
    }
  }
  items=codes.map(code=>items.find(r=>r.code===code)).filter(Boolean);
  if(!items.length)throw Error('基金公开来源暂未取得有效数据');
  return {items,missing:codes.filter(c=>!items.some(r=>r.code===c)),warnings:[ranks.status==='rejected'?'已公布净值暂不可用：'+ranks.reason.message:null,estimates.status==='rejected'?'盘中估算暂不可用，展示已公布净值：'+estimates.reason.message:null].filter(Boolean),fetched_at:new Date().toISOString(),source:'天天基金 / 东方财富',source_url:'https://fund.eastmoney.com/',stale:!!(rank?.stale||est?.stale)};
}
export async function fundDirectory() {
  return cached('fund-directory',86400000,async()=>{
    const raw=await text('https://fund.eastmoney.com/js/fundcode_search.js');
    return {items:assignedArray(raw,'r').map(r=>({code:r[0],name:r[2],pinyin:r[1]})),source:'天天基金公开基金名单'};
  });
}
export async function searchFunds(query) {
  const directory=await fundDirectory();
  return {items:directory.items.filter(r=>r.code.includes(query)||r.name.toLowerCase().includes(query.toLowerCase())||r.pinyin?.toLowerCase().includes(query.toLowerCase())).slice(0,20),source:directory.source};
}
export async function fundHistory(code) {
  if(!/^\d{6}$/.test(code))throw Error('无效基金代码');
  return cached('fund-history:'+code,1800000,async()=>{
    const raw=await text('https://fund.eastmoney.com/pingzhongdata/'+code+'.js');
    const points=assignedArray(raw,'Data_netWorthTrend').map(r=>({date:chinaDate(r.x),nav:number(r.y),pct:number(r.equityReturn)})).filter(r=>r.nav>0).slice(-180);
    if(!points.length)throw Error('暂无基金历史净值');
    let holdings=[];try{holdings=assignedArray(raw,'stockCodesNew').map(c=>c.startsWith('1.')?'sh'+c.slice(2):c.startsWith('0.')?'sz'+c.slice(2):null).filter(Boolean);}catch{}
    return {code,name:raw.match(/var\s+fS_name\s*=\s*"([^"]*)"/)?.[1],points,holdings,holdings_note:'公开披露的重仓股名单，不代表当前完整持仓；用于跟踪股票走势，不能据此还原基金全部实时净值。',as_of:points.at(-1).date,source:'天天基金 · 历史单位净值 / 披露重仓股',source_url:'https://fundf10.eastmoney.com/'+code+'.html'};
  });
}
export async function vix() {
  return cached('vix',3600000,async()=>{
    const raw=await text('https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv');
    const points=raw.trim().split(/\r?\n/).slice(1).map(row=>{
      const a=row.split(','),d=a[0].split('/');return {date:`${d[2]}-${d[0].padStart(2,'0')}-${d[1].padStart(2,'0')}`,close:number(a[4])};
    }).filter(r=>r.close!==null).slice(-90);
    if(points.length<2)throw Error('VIX日终文件暂无有效数据');
    const last=points.at(-1),prev=points.at(-2);
    return {points,value:last.close,change:last.close-prev.close,as_of:last.date,frequency:'日终',source:'Cboe 官方 VIX 日终公开文件',source_url:'https://www.cboe.com/tradable_products/vix/vix_historical_data',method:'VIX衡量美国标普500期权隐含波动率；不是A股恐慌指数，也不是实时逐笔行情。'};
  });
}
