// A contribution of the disclosed slice, never a fabricated whole-fund NAV.
export function holdingsReference(holdings,quotes,date){
  const ageDays=(Date.parse(date+'T00:00:00Z')-Date.parse(holdings.as_of+'T00:00:00Z'))/86400000,oldHoldings=!Number.isFinite(ageDays)||ageDays<0||ageDays>183;
  const dated=quotes.filter(q=>q.as_of?.slice(0,10)===date),latest=dated.map(q=>q.as_of).sort().at(-1);
  const latestMs=latest?Date.parse(latest.replace(' ','T')+'+08:00'):NaN;
  let weight=0,contribution=0;
  const items=holdings.items.map(h=>{
    const q=dated.find(q=>q.code===h.quote_code),ms=q?Date.parse(q.as_of.replace(' ','T')+'+08:00'):NaN;
    const usable=typeof h.weight_pct==='number'&&Number.isFinite(h.weight_pct)&&h.weight_pct>0&&q&&typeof q.pct==='number'&&Number.isFinite(q.pct)&&Number.isFinite(ms)&&latestMs-ms<=180000;
    const value=usable&&!oldHoldings?h.weight_pct*q.pct/100:null;
    if(usable){weight+=h.weight_pct;if(value!==null)contribution+=value;}
    return {...h,pct:usable?q.pct:null,contribution_pp:value,quote_as_of:usable?q.as_of:null};
  });
  return {items,quoted_weight:weight,disclosed_weight:holdings.disclosed_weight,contribution_pp:weight&&!oldHoldings?contribution:null,covered_return_pct:weight&&!oldHoldings?contribution/weight*100:null,quote_as_of:latest||null,holdings_as_of:holdings.as_of,old_holdings:oldHoldings,age_days:ageDays};
}
