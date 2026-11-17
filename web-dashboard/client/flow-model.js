// Four disjoint provider buckets. Identity labels such as institution/retail
// are only proxies; do not manufacture account identities from order size.
export const FLOW_GROUPS=[
  {key:'super_large',label:'超大单',color:'#8956be',detail:'最大档订单',reference:'50万股或100万元及以上'},
  {key:'large',label:'大单',color:'#cf8527',detail:'较大订单',reference:'10–50万股或20–100万元'},
  {key:'middle',label:'中单',color:'#cc5868',detail:'中等订单',reference:'2–10万股或4–20万元'},
  {key:'small',label:'小单',color:'#377fbd',detail:'较小订单',reference:'小于2万股或4万元'},
];
const valid=value=>typeof value==='number'&&Number.isFinite(value);
export const mainFlow=point=>point&&valid(point.super_large)&&valid(point.large)?point.super_large+point.large:null;
export function flowLabel(time,history=false){
  const value=String(time||'');
  if(history&&/^\d{4}-\d{2}-\d{2}$/.test(value))return value.slice(5);
  return value.match(/(?:^|\s)(\d{2}:\d{2})(?::\d{2})?$/)?.[1]||value;
}
export function flowRows(data,period='intraday'){
  const rows=[...new Map((data?.points||[]).filter(p=>p&&typeof p.time==='string').map(p=>[p.time,{...p}])).values()].sort((a,b)=>a.time.localeCompare(b.time));
  if(period==='history')return rows;
  const day=rows.at(-1)?.time.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return day?rows.filter(r=>r.time.startsWith(day)):rows;
}
export function flowView(data,{period='intraday',mode='net',window='all'}={}){
  let rows=flowRows(data,period);
  if(period==='history'&&window!=='all')rows=rows.slice(-Number(window));
  if(period==='history'&&mode==='cumulative'){
    const totals=Object.fromEntries(FLOW_GROUPS.map(g=>[g.key,0]));
    rows=rows.map(row=>{const out={time:row.time};for(const g of FLOW_GROUPS){totals[g.key]=valid(totals[g.key])&&valid(row[g.key])?totals[g.key]+row[g.key]:null;out[g.key]=totals[g.key];}out.main=mainFlow(out);return out;});
  }
  // Provider intraday values are already session-cumulative: never sum again.
  if(period==='intraday'&&window!=='all'){
    const last=minuteOf(rows.at(-1)?.time),from=last-Number(window);
    rows=rows.filter(r=>minuteOf(r.time)>=from);
  }
  return rows;
}
const minuteOf=time=>{const match=String(time||'').match(/(?:^|\s)(\d{2}):(\d{2})(?::\d{2})?$/);return match?Number(match[1])*60+Number(match[2]):NaN;};
export function windowFlow(data,minutes){
  const rows=flowRows(data),last=rows.at(-1),lastTime=minuteOf(last?.time),target=lastTime-minutes;
  const baseline=rows.filter(r=>minuteOf(r.time)<=target).at(-1);
  if(!last||!baseline||!Number.isFinite(lastTime)||target-minuteOf(baseline.time)>0)return null;
  const result={start:baseline.time,end:last.time};
  for(const g of FLOW_GROUPS)result[g.key]=valid(last[g.key])&&valid(baseline[g.key])?last[g.key]-baseline[g.key]:null;
  result.main=mainFlow(result);return result;
}
export function historyFlow(data,count){
  const all=flowRows(data,'history'),rows=all.slice(-count),out={count:rows.length,required:count,complete:rows.length===count,start:rows[0]?.time,end:rows.at(-1)?.time};
  for(const g of FLOW_GROUPS)out[g.key]=rows.length&&rows.every(r=>valid(r[g.key]))?rows.reduce((s,r)=>s+r[g.key],0):null;
  out.main=mainFlow(out);return out;
}
export function flowStreak(data){
  const rows=flowRows(data,'history');let count=0,direction=0;
  for(const row of [...rows].reverse()){
    const value=mainFlow(row);if(value===null||value===0)break;const sign=Math.sign(value);if(direction&&direction!==sign)break;direction=sign;count++;
  }
  return {count,direction,as_of:rows.at(-1)?.time};
}
export function flowDivergence(flowData,priceData){
  const rows=flowRows(flowData,'history'),prices=priceData?.points||[];
  const common=[...rows].reverse().find(r=>prices.some(p=>p.date===r.time));if(!common)return null;
  const at=prices.findIndex(p=>p.date===common.time);if(at<1||!valid(prices[at].close)||!valid(prices[at-1].close)||prices[at-1].close<=0)return null;
  const pct=(prices[at].close/prices[at-1].close-1)*100,main=mainFlow(common);if(main===null)return null;
  return {date:common.time,pct,main,label:pct>0&&main<0?'价格上涨 · 主力净流出':pct<0&&main>0?'价格下跌 · 主力净流入':pct>0&&main>0?'价格与主力净额同向上行':pct<0&&main<0?'价格与主力净额同向下行':'暂未出现方向分歧'};
}
export function priceOverlay(flowData,minuteData){
  const rows=flowRows(flowData),flowDate=rows.at(-1)?.time.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if(dataCodeMismatch(flowData,minuteData)||!flowDate||flowDate!==minuteData?.date||!valid(minuteData.previous_close)||minuteData.previous_close<=0)return null;
  const prices=new Map(minuteData.points.map(p=>[flowLabel(p.time),p.price]));
  return rows.map(r=>{const p=prices.get(flowLabel(r.time));return valid(p)?(p/minuteData.previous_close-1)*100:null;});
}
export function validateFlowAlerts(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>40)throw Error('资金提醒格式无效');
  for(const [key,rule] of Object.entries(value))if(!/^(market|(?:sh|sz|bj)\d{6})$/.test(key)||!rule||![5,15,30].includes(rule.minutes)||!valid(rule.threshold)||rule.threshold<=0||rule.threshold>1000000)throw Error('资金提醒的范围、窗口或阈值无效');
  return structuredClone(value);
}
export function flowAlertEvent(data,rule,prior,{now=Date.now(),today,trading=false}={}){
  if(!data||!rule||!trading||data?.stale||![5,15,30].includes(rule.minutes)||!valid(rule.threshold)||rule.threshold<=0)return null;
  const delta=windowFlow(data,rule.minutes);if(!delta||!valid(delta.main))return null;
  const stamp=delta.end,ms=Date.parse(stamp.replace(' ','T')+'+08:00');
  if(stamp.slice(0,10)!==today||!Number.isFinite(ms)||now-ms>600000||now-ms< -60000||prior?.as_of&&stamp<=prior.as_of)return null;
  const direction=Math.abs(delta.main)>=rule.threshold?Math.sign(delta.main):0;
  return {next:{direction,as_of:stamp},fire:!!direction&&direction!==prior?.direction,delta};
}

const dataCodeMismatch=(flow,minute)=>flow?.code&&flow.code!=='market'&&minute?.code&&flow.code!==minute.code;
