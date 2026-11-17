export const DEFAULT_FUNDS=['024663','020464','023739','000690','025490','026477','008986','002610','025208','539002','024619','008528','290008'];
export const DEFAULT_THRESHOLDS={'024663':8,'020464':10,'025208':12,'008528':8};
export const finiteRate=value=>typeof value!=='boolean'&&value!==null&&value!==''&&Number.isFinite(Number(value))&&Number(value)>-100;
export function validatePortfolio(value,today) {
  if(!value||!Array.isArray(value.holdings)||!value.holdings.length||value.holdings.length>200)throw Error('持仓文件需要1–200条 holdings');
  if(value.as_of&&(!/^\d{4}-\d{2}-\d{2}$/.test(value.as_of)||new Date(value.as_of+'T00:00:00Z').toISOString().slice(0,10)!==value.as_of||value.as_of>today))throw Error('快照日期无效或晚于今天');
  const codes=new Set();
  for(const h of value.holdings){
    if(!h||typeof h!=='object'||typeof h.name!=='string'||!h.name||typeof h.amount==='boolean'||!Number.isFinite(Number(h.amount))||Number(h.amount)<=0)throw Error('每条持仓需要名称和有效正数金额');
    h.amount=Number(h.amount);
    for(const field of ['profit_rate','peak_rate'])if(h[field]!=null&&!finiteRate(h[field]))throw Error(field+' 必须是大于 -100% 的有效数值');
    if(h.cost_basis!=null&&(typeof h.cost_basis==='boolean'||!Number.isFinite(Number(h.cost_basis))||Number(h.cost_basis)<=0))throw Error('cost_basis 必须为正数');
    if(h.profit!=null&&(typeof h.profit==='boolean'||!Number.isFinite(Number(h.profit))))throw Error('profit 必须为有效数值');
    for(const field of ['profit','profit_rate','peak_rate','cost_basis'])if(h[field]!=null)h[field]=Number(h[field]);
    h.code=String(h.code||'').padStart(6,'0');
    if(!/^\d{6}$/.test(h.code)||codes.has(h.code))throw Error('基金代码必须为6位且不重复');codes.add(h.code);
    if(typeof h.name!=='string'||!h.name.trim()||!Number.isFinite(h.amount)||h.amount<=0)throw Error('基金名称或持仓金额无效');
    if(h.profit_rate!==undefined&&h.profit_rate!==null&&!finiteRate(h.profit_rate))throw Error('累计收益率无效');
    if(h.peak_rate!==undefined&&h.peak_rate!==null&&!finiteRate(h.peak_rate))throw Error('历史最高收益率无效');
  }
  return value;
}
export function validatePeaks(peaks) {
  if(!peaks||typeof peaks!=='object'||Array.isArray(peaks)||Object.keys(peaks).length>200)throw Error('峰值备份格式无效');
  for(const[code,entry]of Object.entries(peaks))if(!/^\d{6}$/.test(code)||!entry||!finiteRate(entry.peak)||!finiteRate(entry.last)||Number(entry.peak)<Number(entry.last)||!Number.isInteger(entry.samples)||entry.samples<1||typeof entry.provided!=='boolean'||typeof entry.active!=='boolean')throw Error('峰值备份含缺失或无效历史，不予覆盖');
  return peaks;
}
export function observePortfolio(portfolio,prior={}) {
  const peaks=structuredClone(prior),rows=[];const date=portfolio.as_of||null;
  for(const h of portfolio.holdings){
    const key=h.code,previous=peaks[key],row={...h,drawdown:null,pending:null};rows.push(row);
    if(!finiteRate(h.profit_rate)){row.pending='缺少累计收益率';continue;}
    const current=Number(h.profit_rate),declared=finiteRate(h.peak_rate)?Number(h.peak_rate):null;
    const cost=h.cost_basis??(Number.isFinite(h.profit)?h.amount-h.profit:null);
    if(cost!==null&&(!Number.isFinite(cost)||cost<=0)){row.pending='成本无效';continue;}
    if(previous?.last_as_of&&(!date||date<previous.last_as_of)){row.pending='快照日期早于记录或缺失';continue;}
    const reset=previous&&(!previous.active||previous.position_id!==(h.position_id||'')||((previous.cost===null)!==(cost===null))||(cost!==null&&previous.cost!==null&&Math.abs(cost-previous.cost)>Math.max(.05,Math.abs(cost)*.0001)));
    let entry;
    if(!previous||reset){
      const provided=declared!==null&&(!reset||declared!==previous.declared);
      entry={active:true,cost,position_id:h.position_id||'',peak:provided?Math.max(current,declared):current,last:current,last_as_of:date,samples:1,provided,declared};
      if(!provided)row.pending=reset?'成本/批次变化，重新建立基线':'首次记录，待补历史';
    }else{
      entry={...previous};if(current!==entry.last||date!==entry.last_as_of)entry.samples++;
      entry.peak=Math.max(entry.peak,current);entry.last=current;entry.last_as_of=date;entry.active=true;
      if(declared!==null&&declared!==entry.declared){entry.peak=Math.max(entry.peak,declared);entry.provided=true;}
      entry.declared=declared;
      if(entry.samples===1&&!entry.provided)row.pending='仅有同一份快照，待补历史';
    }
    peaks[key]=entry;row.peak=entry.peak;
    if(!row.pending)row.drawdown=(entry.peak-current)/(100+entry.peak)*100;
  }
  const active=new Set(portfolio.holdings.map(h=>h.code));
  for(const [key,entry]of Object.entries(peaks))if(!active.has(key)&&(!entry.last_as_of||(date&&date>=entry.last_as_of)))entry.active=false;
  return {peaks,rows};
}
