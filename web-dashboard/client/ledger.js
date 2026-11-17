import {validatePeaks,finiteRate} from './state.js';
// Personal bookkeeping stays in the browser. All trades are user-confirmed
// records, never instructions sent to a broker or inferred from price moves.
export const emptyLedger=()=>({version:1,accounts:[{id:'default',name:'默认账户'}],positions:[],transactions:[],plans:[]});
export function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
const amount=(v,positive=false)=>typeof v==='number'&&Number.isFinite(v)&&(positive?v>0:v>=0);
const id=v=>typeof v==='string'&&/^[\w-]{1,80}$/.test(v);
export function validateLedger(input,today='9999-12-31'){
  const book=structuredClone(input);
  if(book?.version!==1||!Array.isArray(book.accounts)||!book.accounts.length||book.accounts.length>30||!Array.isArray(book.positions)||book.positions.length>200||!Array.isArray(book.transactions)||book.transactions.length>5000||!Array.isArray(book.plans)||book.plans.length>100)throw Error('账本格式或条数无效');
  const unique=list=>{const seen=new Set();for(const row of list){if(!id(row.id)||seen.has(row.id))throw Error('账本标识重复或无效');seen.add(row.id);}return seen;};
  const accounts=unique(book.accounts),positions=unique(book.positions);unique(book.transactions);unique(book.plans);
  for(const a of book.accounts)if(typeof a.name!=='string'||!a.name.trim()||a.name.length>80)throw Error('账户名无效');
  for(const p of book.positions)if(!accounts.has(p.account_id)||!/^\d{6}$/.test(p.code)||typeof p.name!=='string'||!p.name.trim()||p.name.length>150)throw Error('账本持仓无效');
  for(const t of book.transactions){
    if((t.deleted!==undefined&&typeof t.deleted!=='boolean')||!positions.has(t.position_id)||!validDate(t.date)||t.date>today||!['opening','buy','sell','dividend'].includes(t.type)||!amount(t.fee??0))throw Error('交易记录日期、费用或类型无效');
    if(t.type==='opening'&&(t.fee||0)!==0)throw Error('期初成本已包含费用，不能重复填写期初费用');
    if(t.type==='dividend'){if(!amount(t.cash,true)||(t.fee||0)>t.cash)throw Error('现金分红金额或费用无效');}
    else if(!amount(t.shares,true)||(t.type==='opening'?!amount(t.cost,true):!amount(t.nav,true)))throw Error('份额、成本或成交净值无效');
  }
  for(const p of book.plans)if(!accounts.has(p.account_id)||!/^\d{6}$/.test(p.code)||!amount(p.amount,true)||!validDate(p.next_date)||!['weekly','monthly'].includes(p.frequency)||typeof p.active!=='boolean')throw Error('定投计划无效');
  // Validate running balances so a backdated edit cannot create a short position.
  balances(book);return book;
}
export function balances(book,through='9999-12-31'){
  const rows=new Map(book.positions.map(p=>[p.id,{...p,shares:0,cost:0,realized:0,invested:0}]));
  for(const t of book.transactions.filter(t=>!t.deleted&&t.date<=through).map((t,index)=>({...t,index})).sort((a,b)=>a.date.localeCompare(b.date)||a.index-b.index)){
    const p=rows.get(t.position_id);if(!p)throw Error('交易找不到对应持仓');
    if(t.type==='opening'||t.type==='buy'){const cost=t.type==='opening'?t.cost:t.shares*t.nav+(t.fee||0);p.shares+=t.shares;p.cost+=cost;p.invested+=cost;}
    if(t.type==='sell'){
      if(t.shares>p.shares+1e-7)throw Error('卖出份额超过当时持有份额');
      const basis=p.cost*Math.min(1,t.shares/p.shares),proceeds=t.shares*t.nav-(t.fee||0);
      if(proceeds<0)throw Error('卖出费用超过卖出金额');p.realized+=proceeds-basis;p.cost-=basis;p.shares-=t.shares;if(p.shares<1e-7){p.shares=0;p.cost=0;}
    }
    if(t.type==='dividend'){if(p.shares<=0)throw Error('分红日期尚无持仓');p.realized+=t.cash-(t.fee||0);}
    if(![p.shares,p.cost,p.realized,p.invested].every(Number.isFinite))throw Error('交易数值超出可计算范围');
  }
  return [...rows.values()];
}
export function valuedPositions(book,quotes){
  return balances(book).map(p=>{
    const q=quotes.find(q=>q.code===p.code),value=p.shares===0?0:q?.nav>0?p.shares*q.nav:null;
    return {...p,value,profit:value===null?null:value-p.cost,profit_rate:value===null||!p.cost?null:(value-p.cost)/p.cost*100,total_profit:value===null?null:value-p.cost+p.realized,quote:q||null};
  });
}
export function incomeTimeline(book,histories){
  const codes=[...new Set(book.positions.map(p=>p.code))],maps=Object.fromEntries(codes.map(c=>[c,new Map((histories[c]?.points||[]).map(p=>[p.date,p.nav]))]));
  const earliest=book.transactions.filter(t=>!t.deleted).map(t=>t.date).sort()[0];
  const days=earliest?[...new Set(codes.flatMap(c=>(histories[c]?.points||[]).map(p=>p.date)))].filter(d=>d>=earliest).sort():[];
  const output=[];let previous=null;
  for(const date of days){
    const rows=balances(book,date).filter(p=>p.invested>0),missing=rows.filter(p=>p.shares>0&&!maps[p.code]?.has(date)).map(p=>p.code);
    if(!rows.length){previous=null;continue;}
    if(missing.length){output.push({date,profit:null,value:null,missing:[...new Set(missing)],reason:'部分基金当日净值未公布'});previous=null;continue;}
    const value=rows.reduce((s,p)=>s+(p.shares?p.shares*maps[p.code].get(date):0),0);
    let flow=0;
    for(const t of book.transactions.filter(t=>!t.deleted&&t.date<=date&&(!previous||t.date>previous.date))){
      const position=book.positions.find(p=>p.id===t.position_id);
      if(t.type==='opening')flow+=t.shares*maps[position.code].get(date); // opening is a baseline transfer, not a new gain
      if(t.type==='buy')flow+=t.shares*t.nav+(t.fee||0);
      if(t.type==='sell')flow-=t.shares*t.nav-(t.fee||0);
      if(t.type==='dividend')flow-=t.cash-(t.fee||0);
    }
    // A fully sold portfolio still has a valid closing value of zero.
    const profit=previous===null?null:value-previous.value-flow;
    output.push({date,value,profit,missing:[],reason:previous===null?'建立净值基线':''});previous={date,value};
  }
  return output;
}
export function periodReport(timeline,start,end){
  const days=timeline.filter(r=>r.date>=start&&r.date<=end),known=days.filter(r=>r.profit!==null);
  return {start,end,profit:known.length?known.reduce((s,r)=>s+r.profit,0):null,known:known.length,total:days.length,complete:days.length>0&&known.length===days.length};
}
export function nextPlanDate(plan){
  if(plan.frequency==='weekly'){const d=new Date(plan.next_date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+7);return d.toISOString().slice(0,10);}
  const d=new Date(plan.next_date+'T00:00:00Z'),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(plan.month_day||day,last));return d.toISOString().slice(0,10);
}
export function fundMetrics(history){
  const rows=history.points||[];if(rows.length<2)return {points:[],complete:false};
  let value=100,peak=100,drawdown=0,complete=true;const daily=[],points=[{date:rows[0].date,value}];
  for(const r of rows.slice(1)){if(r.pct===null||!Number.isFinite(r.pct)||r.pct<=-100){complete=false;break;}daily.push(r.pct/100);value*=1+r.pct/100;peak=Math.max(peak,value);drawdown=Math.max(drawdown,(peak-value)/peak*100);points.push({date:r.date,value});}
  const avg=daily.reduce((a,b)=>a+b,0)/(daily.length||1),vol=daily.length>=20?Math.sqrt(daily.reduce((s,r)=>s+(r-avg)**2,0)/(daily.length-1))*Math.sqrt(252)*100:null;
  return {points,complete,return_pct:complete?value-100:null,drawdown:complete?drawdown:null,volatility:complete?vol:null,start:points[0]?.date,end:points.at(-1)?.date};
}
export function parseHoldingText(text,directory=[]){
  const clean=String(text).replace(/，/g,',').replace(/[−–]/g,'-'),seen=new Set(),rows=[];
  for(const line of clean.split(/\r?\n/)){
    const explicit=line.match(/(?<!\d)\d{6}(?!\d)/g)||[],normalized=line.replace(/\s/g,'').toLowerCase();
    const matched=directory.filter(f=>f.name.length>=5&&normalized.includes(f.name.replace(/\s/g,'').toLowerCase()));
    for(const code of [...explicit,...matched.map(f=>f.code)])if(!seen.has(code)){seen.add(code);const f=directory.find(f=>f.code===code);rows.push({code,name:f?.name||code,shares:'',cost:'',evidence:line.trim()});}
  }
  return rows.slice(0,100);
}

export const capitalCycle=(book,position)=>position+':'+book.transactions.filter(t=>!t.deleted&&t.position_id===position&&t.type!=='dividend').map(t=>t.id).join('/');
export function validateLedgerPeaks(book,peaks,today){
  if(!peaks||typeof peaks!=='object'||Array.isArray(peaks)||Object.keys(peaks).length>200)throw Error('账本高点格式无效');
  for(const [id,entry] of Object.entries(peaks)){
    if(!book.positions.some(p=>p.id===id))throw Error('高点对应的持仓不存在');
    validatePeaks({'000000':entry});
    if(entry.last_as_of&&(!validDate(entry.last_as_of)||entry.last_as_of>today))throw Error('高点快照日期无效');
    if(entry.cost!==null&&!amount(entry.cost,true))throw Error('高点成本无效');
    if(typeof entry.position_id!=='string'||entry.position_id.length>200000||!(entry.position_id===id||entry.position_id.startsWith(id+':')))throw Error('高点持仓批次无效');
    if(entry.declared!=null&&!finiteRate(entry.declared))throw Error('已知高点无效');
  }
  return peaks;
}
