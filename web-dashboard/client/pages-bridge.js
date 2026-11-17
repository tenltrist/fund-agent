// This document runs in a sandboxed iframe without same-origin access.
// External quote scripts cannot read parent holdings or localStorage.
const payload=JSON.parse(decodeURIComponent(location.hash.slice(1)));
const {kind,nonce}=payload;
if(!/^[a-f0-9-]{20,50}$/.test(nonce))throw Error('Invalid request');
const send=(value,error)=>parent.postMessage({kind:'public-market',nonce,value,error},'*');
const stock=value=>{if(!/^(sh|sz|bj)\d{6}$/.test(value))throw Error('Invalid stock');return value;};
const fund=value=>{if(!/^\d{6}$/.test(value))throw Error('Invalid fund');return value;};
const load=(url,after,charset)=>{const s=document.createElement('script');s.src=url;if(charset)s.charset=charset;s.onload=()=>{try{if(after)send(after());}catch(error){send(null,error.message);}};s.onerror=()=>send(null,'公开来源暂不可用');document.head.append(s);};
const UT='bd1d9ddb04089700cf9c27f6f7426281';
window.publicMarketCallback=value=>send(value);
window.jsonpgz=value=>send(value);
try{
  if(kind==='quotes'){
    const codes=payload.codes.map(stock).slice(0,40);
    load('https://qt.gtimg.cn/q='+codes.join(','),()=>codes.map(code=>'v_'+code+'="'+(window['v_'+code]||'')+'";').join('\n'),'gb18030');
  }else if(kind==='minute'||kind==='daily'){
    const code=stock(payload.code);window.publicTencent=undefined;
    const url=kind==='minute'?'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code='+code+'&_var=publicTencent':'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param='+code+',day,,,100,qfq&_var=publicTencent';
    load(url,()=>window.publicTencent);
  }else if(kind==='flow'){
    const market=payload.code==='market',code=market?'sh000001':stock(payload.code),history=payload.period==='history';
    const params={secid:(code.startsWith('sh')?'1.':'0.')+code.slice(2),fields1:'f1,f2,f3,f7',fields2:'f51,f52,f53,f54,f55,f56',lmt:'0',klt:history?'101':'1',ut:UT,cb:'publicMarketCallback'};
    if(market)params.secid2='0.399001';
    load('https://'+(history?'push2his':'push2')+'.eastmoney.com/api/qt/stock/fflow/'+(history?'daykline':'kline')+'/get?'+new URLSearchParams(params));
  }else if(kind==='sector'){
    const page=Number(payload.page);if(!Number.isInteger(page)||page<1||page>8)throw Error('Invalid page');
    load('https://push2.eastmoney.com/api/qt/clist/get?'+new URLSearchParams({pn:String(page),pz:'100',fid:'f62',fs:'m:90+t:2',fields:'f12,f14,f2,f3,f62,f6',fltt:'2',np:'1',ut:UT,cb:'publicMarketCallback'}));
  }else if(kind==='fund-estimate'){
    load('https://fundgz.1234567.com.cn/js/'+fund(payload.code)+'.js');
  }else if(kind==='fund-holdings'){
    const year=Number(payload.year);if(!Number.isInteger(year)||year<1990||year>2100)throw Error('Invalid year');
    load('https://fundf10.eastmoney.com/FundArchivesDatas.aspx?'+new URLSearchParams({type:'jjcc',code:fund(payload.code),topline:'10',year:String(year),rt:'0.1234567890123456'}),()=>window.apidata?.content);
  }else if(kind==='fund-history'){
    load('https://fund.eastmoney.com/pingzhongdata/'+fund(payload.code)+'.js',()=>({name:window.fS_name,trend:window.Data_netWorthTrend,holdings:window.stockCodesNew,managers:window.Data_currentFundManager,allocation:window.Data_assetAllocation,scale:window.Data_fluctuationScale,fees:{original:window.fund_sourceRate,reference:window.fund_Rate,minimum:window.fund_minsg}}));
  }else if(kind==='fund-directory'){
    load('https://fund.eastmoney.com/js/fundcode_search.js',()=>window.r);
  }else throw Error('Unsupported data source');
}catch(error){send(null,error.message);}
