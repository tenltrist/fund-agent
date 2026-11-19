import {validDate,valuedPositions} from './ledger.js';

// A platform's holding value is meaningful only at the same confirmed NAV date.
export function openingFromValue({value,profit,date,point},today){
  if(!validDate(date)||date>today)throw Error('请选择平台持仓金额对应的确认净值日期');
  if(!point||point.date!==date||!(point.nav>0))throw Error('该日没有公开确认净值，请改用实际份额录入');
  if(!Number.isFinite(value)||value<=0||!Number.isFinite(profit)||value-profit<=0)throw Error('持仓金额应大于0，持有收益应小于持仓金额');
  const shares=value/point.nav,cost=value-profit;
  if(!Number.isFinite(shares)||!Number.isFinite(cost))throw Error('金额超出计算范围');
  return {shares,cost,date,nav:point.nav};
}

export function holdingSummary(book,quotes){
  const positions=valuedPositions(book,quotes).filter(p=>p.shares>0),covered=positions.filter(p=>p.value!==null);
  const complete=positions.length>0&&covered.length===positions.length;
  return {positions,covered:covered.length,total:positions.length,complete,
    value:covered.length?covered.reduce((sum,p)=>sum+p.value,0):null,
    profit:covered.length?covered.reduce((sum,p)=>sum+p.profit,0):null,
    dates:[...new Set(covered.map(p=>p.quote.date))].sort()};
}

export function quoteStatus(data,{today,trading=false,now=Date.now()}={}){
  if(!data)return {label:'等待数据',level:'muted'};
  const date=(data.as_of||data.date||data.items?.[0]?.as_of||'').slice(0,10);
  const age=data.fetched_at?now-Date.parse(data.fetched_at):Infinity;
  const stamp=data.as_of||data.items?.[0]?.as_of||'',localStamp=stamp.replace(' ','T');
  const sourceTime=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(stamp)?Date.parse(localStamp+(localStamp.length===16?':00':'')+'+08:00'):NaN;
  if(!data.points?.length&&!data.items?.length)return {label:'暂无可用数据',level:'warning'};
  if(date&&date<today)return {label:date+' 历史数据',level:'warning'};
  if(data.stale||age>900000||(trading&&Number.isFinite(sourceTime)&&now-sourceTime>900000))return {label:trading?'更新延迟':'较早快照',level:'warning'};
  return {label:trading?'盘中数据':'最近交易数据',level:'muted'};
}

export const unreadAlerts=(alerts,readAt)=>alerts.filter(a=>a.time>(readAt||'')).length;

export function sortFunds(items,mode='default'){
  if(mode==='default')return [...items];
  if(mode==='name')return [...items].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
  const field=mode==='month'?'ret_1m':'pct',direction=mode==='loss'?1:-1;
  return [...items].sort((a,b)=>{
    const av=Number.isFinite(a[field])?a[field]:null,bv=Number.isFinite(b[field])?b[field]:null;
    if(av===null)return bv===null?0:1;if(bv===null)return -1;
    return direction*(av-bv);
  });
}
