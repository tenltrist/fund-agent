import {cached,chinaDate,number,strip} from './data.js';
export function parseFundHoldings(raw,code,currentDate=chinaDate()){
  let html=raw;
  if(!String(raw).trim().startsWith('<')){
    const encoded=String(raw).match(/\bcontent\s*:\s*("(?:[^"\\]|\\.)*")/);
    if(!encoded)throw Error('公开持仓档案缺少明细');html=JSON.parse(encoded[1]);
  }
  const start=html.indexOf('<table'),end=html.indexOf('</table>',start);
  if(start<0||end<0)throw Error('该基金暂无可取得的股票持仓明细');
  const date=html.slice(0,start).match(/截止至[\s\S]*?(\d{4}-\d{2}-\d{2})/)?.[1];
  if(!date||!Number.isFinite(Date.parse(date))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date>currentDate)throw Error('披露持仓日期无效');
  const table=html.slice(start,end),headers=[...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m=>strip(m[1]).replace(/\s/g,''));
  const weightAt=headers.findIndex(s=>s.includes('占净值')),codeAt=headers.findIndex(s=>s.includes('股票代码')),nameAt=headers.findIndex(s=>s.includes('股票名称'));
  if(weightAt<0||codeAt<0||nameAt<0)throw Error('公开持仓列格式发生变化');
  const items=[...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>{
    const cells=[...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c=>c[1]);if(!cells.length)return null;
    const stock_code=strip(cells[codeAt]||''),name=strip(cells[nameAt]||''),weight_pct=number(strip(cells[weightAt]||'').replace('%',''));
    if(!stock_code||!name||weight_pct===null||weight_pct<=0||weight_pct>300)return null;
    const market=(cells[codeAt]||'').match(/(?:unify\/r\/|quote\.eastmoney\.com\/)([01])\.(\d{6})/)?.[1];
    const quote_code=/^\d{6}$/.test(stock_code)&&market!==undefined?(market==='1'?'sh':/^(?:[48]|92)/.test(stock_code)?'bj':'sz')+stock_code:null;
    return {stock_code,quote_code,name,weight_pct};
  }).filter(Boolean);
  const unique=[...new Map(items.map(r=>[r.stock_code,r])).values()];
  if(!unique.length)throw Error('该基金暂无可取得的股票持仓明细');
  return {code,as_of:date,items:unique,disclosed_weight:unique.reduce((s,r)=>s+r.weight_pct,0),source:'天天基金 · 公开季报股票持仓',source_url:'https://fundf10.eastmoney.com/ccmx_'+code+'.html'};
}
export async function fundHoldings(code){
  if(!/^\d{6}$/.test(code))throw Error('无效基金代码');
  return cached('fund-holdings:'+code,86400000,async()=>{
    const year=Number(chinaDate().slice(0,4));let error;
    for(const at of [year,year-1])try{
      const response=await fetch('https://fundf10.eastmoney.com/FundArchivesDatas.aspx?'+new URLSearchParams({type:'jjcc',code,topline:'10',year:String(at),rt:'0.1234567890123456'}),{headers:{'User-Agent':'Mozilla/5.0','Referer':'https://fundf10.eastmoney.com/ccmx_'+code+'.html','X-Requested-With':'XMLHttpRequest','Accept':'*/*'},signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw Error('公开持仓 HTTP '+response.status);return parseFundHoldings(await response.text(),code);
    }catch(e){error=e;if(at===year&&!/暂无可取得的股票持仓明细|缺少明细/.test(e.message))throw e;}
    throw error;
  });
}
export function preferHoldings(old,next){
  if(old?.as_of&&next?.as_of&&next.as_of<old.as_of)return {...old,stale:true,error:'来源返回更早披露，保留已取得的较新持仓权重'};
  return next;
}
