import {FLOW_GROUPS,mainFlow,flowRows,flowView,windowFlow,historyFlow,flowStreak,flowDivergence,priceOverlay,flowAlertEvent} from './flow-model.js';
import {flowChartOption} from './flow-chart.js';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>typeof v==='number'&&Number.isFinite(v)?(v>0?'+':'')+v.toLocaleString('zh-CN',{minimumFractionDigits:v!==0&&Math.abs(v)<.01?4:2,maximumFractionDigits:v!==0&&Math.abs(v)<.01?4:2}):'—';
const tone=v=>v>0?'positive':v<0?'negative':'muted';
export function mountFlowTerminal({getFlows,api,chart,unavailable,sourceStamp,state,save,toast,today,getPeriod,isTrading,getStocks}){
  let target='market',name='沪深两市',period='intraday',windowSize='all',mode='net',overlay=false,minuteData=null,dailyData=null,market=null,current=null,history=null,generation=0;
  const extraTargets=new Map();
  const panel=$('full-flow-chart').closest('.panel');panel.classList.add('flow-terminal');
  panel.innerHTML=`<div class="flow-terminal-heading"><div><div class="eyebrow">FOUR ORDER-SIZE GROUPS</div><h2 id="flow-target-title">沪深两市资金流向</h2><p>四条线各代表一档订单；主力合计单独看。</p></div><button class="button light" id="flow-export">导出当前资金数据</button></div>
  <div class="flow-tools"><label>监测范围<select id="flow-target" aria-label="资金监测范围"><option value="market">沪深两市合计</option><option value="sh000001">上证市场</option><option value="sz399001">深证市场</option></select></label><div class="segments" id="flow-window"></div><label id="flow-display-label" hidden>显示方式<select id="flow-display" aria-label="历史资金显示方式"><option value="net">每日净额</option><option value="cumulative">区间累计</option></select></label><label class="flow-overlay"><input type="checkbox" id="flow-overlay">叠加价格涨跌（右轴）</label></div>
  <div class="flow-main-stat"><div><span><b id="flow-main-label">主力合计</b> <small>超大单＋大单</small></span><strong id="flow-main-value">—</strong></div><p id="flow-head-meta">读取真实资金数据…</p></div>
  <div class="flow-four-cards" id="flow-four-cards"></div><div class="flow-chart-caption"><span id="flow-measure">当日累计净额 / 亿元</span><span>上方净流入 · 下方净流出 · 点击图例显隐曲线</span></div><div id="full-flow-chart" class="chart terminal-chart" role="img" aria-label="四类订单资金流向图"></div><p id="flow-method" class="data-line"></p>
  <div class="flow-insights" id="flow-insights"></div>
  <div class="flow-analysis-grid"><div><h3>最近一段时间，资金怎样变化？</h3><p class="data-line">区间末累计值减去区间初累计值；午休或数据不足留空。</p><div class="table-scroll"><table><thead><tr><th>窗口</th><th>主力合计</th>${FLOW_GROUPS.map(g=>`<th style="color:${g.color}">${g.label}</th>`).join('')}</tr></thead><tbody id="flow-window-table"></tbody></table></div></div><div><h3>多日主力净额</h3><p class="data-line" id="flow-history-asof">按已公布的每日净额汇总，不能把日内累计再相加。</p><div class="table-scroll"><table><thead><tr><th>交易日区间</th><th>主力合计</th><th>超大单</th><th>大单</th></tr></thead><tbody id="flow-history-table"></tbody></table></div></div></div>
  <details class="flow-rules"><summary>四条线怎样划分，为什么没有“机构账户”一栏？</summary><p>沿用东方财富的订单规模分类。超大单、大单、中单、小单是四个分档；主力净额＝超大单净额＋大单净额。大额订单常用来观察大资金活动，但不等于识别出了机构；小单也可能来自机构拆单。</p><div class="table-scroll"><table><thead><tr><th>资金档位</th><th>公开说明中的股数/金额参考</th></tr></thead><tbody>${FLOW_GROUPS.map(g=>`<tr><td style="color:${g.color}">${g.label}</td><td>${g.reference}</td></tr>`).join('')}</tbody></table></div><p>最终以来源归档为准；不是交易所统一身份标准。净额反映该分类的买卖方向，不是全市场新进现金。</p><p><a href="https://emdesk.eastmoney.com/pc_activity/Pages/VIPTrade/pages/link/gnjs.html" target="_blank" rel="noreferrer">东方财富主力净流入说明 ↗</a> · <a href="https://www.cfrn.com.cn/uploads/master/paper/20240728/66a5e8a1ed0b7.pdf" target="_blank" rel="noreferrer">投资者识别研究与分档示例 ↗</a></p></details>
  <form id="flow-alert-form" class="flow-alert-form"><div><h3>大资金异动提醒</h3><p class="data-line">页面打开、交易时段且数据足够新时，主力窗口净额越过阈值提醒一次，持续超标不重复轰炸。</p></div><label>观察窗口<select id="flow-alert-minutes"><option value="5">5分钟</option><option value="15" selected>15分钟</option><option value="30">30分钟</option></select></label><label>净流入/流出阈值（亿元）<input id="flow-alert-threshold" type="number" min="0.01" step="0.01" placeholder="例如 10"></label><button class="button">保存提醒</button><button type="button" class="button light" id="flow-alert-disable">关闭该范围提醒</button><p id="flow-alert-status" class="data-line"></p></form>`;
  function targetOptions(){const before=$('flow-target').value;const stocks=state.stocks||[],stockNames=getStocks?.()||[];$('flow-target').innerHTML='<option value="market">沪深两市合计</option><option value="sh000001">上证市场</option><option value="sz399001">深证市场</option>'+stocks.filter(c=>!['sh000001','sz399001'].includes(c)).map(c=>`<option value="${esc(c)}">${esc(stockNames.find(r=>r.code===c)?.name||'自选股')} ${esc(c)}</option>`).join('')+[...extraTargets].filter(([code])=>!stocks.includes(code)).map(([code,label])=>`<option value="${esc(code)}">${esc(label)} ${esc(code)}</option>`).join('');if([...$('flow-target').options].some(o=>o.value===before))$('flow-target').value=before;else{$('flow-target').value='market';target='market';}}
  function controls(){
    const next=getPeriod();if(next!==period){period=next;windowSize='all';}
    const choices=period==='intraday'?[['all','全天'],['30','近30分钟'],['60','近60分钟']]:[['all','近30日'],['5','近5日'],['10','近10日'],['20','近20日']];
    $('flow-window').innerHTML=choices.map(([value,label])=>`<button type="button" data-flow-window="${value}" class="${windowSize===value?'active':''}">${label}</button>`).join('');
    $('flow-display-label').hidden=period!=='history';$('flow-overlay').disabled=period==='history';$('flow-overlay').checked=overlay&&period==='intraday';

  }
  function syncRule(){
    const rule=state.flowAlerts?.[target];$('flow-alert-minutes').value=String(rule?.minutes||15);$('flow-alert-threshold').value=rule?.threshold??'';$('flow-alert-status').textContent=rule?`已保存：${rule.minutes}分钟内主力净额绝对值达到 ${rule.threshold} 亿元`:'未设置该范围提醒';
  }
  function renderChart(){
    if(market?.points?.length)chart('overview-flow-chart',flowChartOption(market,{compact:true,width:$('overview-flow-chart').clientWidth}));
    const data=period==='history'?history:current;if(!data?.points?.length)return;
    const price=period==='intraday'&&overlay?priceOverlay(data,minuteData):null;
    chart('full-flow-chart',flowChartOption(data,{period,mode,window:windowSize,width:$('full-flow-chart').clientWidth||800,overlay:price,overlayLabel:target==='market'?'上证指数':name}));
  }
  const cell=value=>`<td class="${tone(value)}">${fmt(value)}</td>`;
  function render(){
    controls();const data=period==='history'?history:current;
    if(market?.points?.length){const last=flowRows(market).at(-1),recent=windowFlow(market,15);$('flow-summary').innerHTML=[['主力合计',mainFlow(last)],['小单净额',last?.small],['近15分钟主力变化',recent?.main]].map(([label,value])=>`<div><span>${label}</span><strong class="${tone(value)}">${fmt(value)}<small>亿</small></strong></div>`).join('');$('flow-overview-meta').textContent=sourceStamp(market,market.as_of);}
    if(!data?.points?.length)return;
    const viewed=flowView(data,{period,mode,window:windowSize}),last=viewed.at(-1);if(!last)return;
    $('flow-target-title').textContent=name+' · 四类资金';$('flow-main-label').textContent=period==='intraday'?'当日主力合计':mode==='cumulative'?`所选${viewed.length}日主力累计`:'末日主力合计';$('flow-main-value').textContent=fmt(mainFlow(last))+' 亿';$('flow-main-value').className=tone(mainFlow(last));$('flow-head-meta').textContent=sourceStamp(data,data.as_of);
    $('flow-four-cards').innerHTML=FLOW_GROUPS.map(g=>`<div class="flow-group-card"><div><i style="background:${g.color}"></i><b>${g.label}</b><small>${g.detail}</small></div><strong style="color:${g.color}">${fmt(last[g.key])}<small>亿</small></strong></div>`).join('');
    $('flow-measure').textContent=period==='intraday'?(windowSize==='all'?'当日累计净额 / 亿元':`近${windowSize}分钟走势 · 数值为当日累计 / 亿元`):mode==='cumulative'?`所选 ${viewed.length} 个交易日累计净额 / 亿元`:'每日净额 / 亿元';
    $('flow-method').textContent=period==='intraday'?(data.observation?'横轴为真实采集时点，未补造此前分钟。':'横轴为来源交易分钟，午休不补数据。')+' 主力合计不作为第五条资金线。':'历史每日净额与区间累计分开显示；累计从当前所选区间起点开始。';
    const recent=current?windowFlow(current,15):null,twenty=history?historyFlow(history,20):null,streak=history?flowStreak(history):null,divergence=history&&dailyData?flowDivergence(history,dailyData):null;
    const fact=(label,value,note)=>`<div><span>${label}</span><strong>${value}</strong><small>${esc(note)}</small></div>`;
    $('flow-insights').innerHTML=fact('近15分钟主力净额',fmt(recent?.main)+' 亿',recent?recent.start+' → '+recent.end:'分钟区间不足，不估填')+fact(twenty?.complete?'近20交易日主力净额':`${twenty?.count||0}个可用交易日主力净额`,fmt(twenty?.main)+' 亿',twenty?.end?'历史截至 '+twenty.end:'历史数据未取得')+fact('最近连续资金方向',streak?.count?`${streak.count===flowRows(history,'history').length?'至少':''}${streak.count}日净${streak.direction>0?'流入':'流出'}`:'暂无连续方向',streak?.as_of?'历史截至 '+streak.as_of:'等待历史净额')+fact(target==='market'?'沪深资金 / 上证价格':'资金 / 价格对照',divergence?divergence.label:'等待同日数据',divergence?divergence.date+' · 价格 '+fmt(divergence.pct)+'%':'只描述已发生的方向，不生成买卖信号');
    $('flow-window-table').innerHTML=[5,15,30].map(minutes=>{const r=current?windowFlow(current,minutes):null;return `<tr><td>${minutes}分钟</td>${cell(r?.main)}${FLOW_GROUPS.map(g=>cell(r?.[g.key])).join('')}</tr>`;}).join('');
    $('flow-history-table').innerHTML=[5,10,20,30].map(count=>{const r=history?historyFlow(history,count):null;return `<tr><td>${count}日${r&&!r.complete?`（仅${r.count}日）`:''}</td>${cell(r?.main)}${cell(r?.super_large)}${cell(r?.large)}</tr>`;}).join('');
    $('flow-history-asof').textContent=history?'每日净额汇总，历史截至 '+history.as_of+'。':'历史来源暂不可用。';renderChart();checkAlert();
  }
  function checkAlert(){
    const rule=state.flowAlerts?.[target];if(!rule||!current)return;const key=target+':'+rule.minutes+':'+rule.threshold;state.flowAlertLatches||={};const result=flowAlertEvent(current,rule,state.flowAlertLatches[key],{today:today(),trading:isTrading()});if(!result)return;const {delta,next}=result,direction=next.direction,stamp=next.as_of;state.flowAlertLatches[key]=next;save();
    if(result.fire){const message=`${name} 最近${rule.minutes}分钟主力净${direction>0?'流入':'流出'} ${Math.abs(delta.main).toFixed(2)}亿元（截至${stamp}）`;state.alerts.unshift({message,time:new Date().toISOString()});state.alerts=state.alerts.slice(0,50);save();toast(message);if('Notification'in window&&Notification.permission==='granted')new Notification('观基 · 大资金异动',{body:message});}
  }
  async function refresh(){
    const token=++generation;controls();targetOptions();if(period==='history'?history:current)render();else{unavailable('full-flow-chart','正在读取所选范围的资金数据…');$('flow-main-value').textContent='—';$('flow-four-cards').innerHTML='';$('flow-insights').innerHTML='';$('flow-window-table').innerHTML='';$('flow-history-table').innerHTML='';}name=target==='market'?'沪深两市':target==='sh000001'?'上证市场':target==='sz399001'?'深证市场':getStocks?.().find(r=>r.code===target)?.name||extraTargets.get(target)||target;$('flow-target-title').textContent=name+' · 四类资金';
    const code=target,priceCode=target==='market'?'sh000001':target;
    const jobs=[getFlows('market','intraday','沪深日内资金'),code==='market'?null:getFlows(code,'intraday','所选日内资金'),getFlows(code,'history','历史资金'),api('/api/minute?code='+priceCode),api('/api/daily?code='+priceCode)];
    const aux=Promise.allSettled(jobs.slice(3)),result=await Promise.allSettled(jobs.slice(0,3).map(p=>p||Promise.resolve(null)));if(token!==generation)return;
    if(result[0].status==='fulfilled')market=result[0].value;else unavailable('overview-flow-chart',result[0].reason.message);
    const intraday=code==='market'?result[0]:result[1];current=intraday.status==='fulfilled'?intraday.value:null;history=result[2].status==='fulfilled'?result[2].value:null;minuteData=dailyData=null;
    if((period==='history'?!history:!current)){unavailable('full-flow-chart','该范围的公开资金数据暂不可用；可切换回沪深两市。');$('flow-head-meta').textContent='来源未返回有效数据，不沿用其他范围的金额';$('flow-four-cards').innerHTML='';$('flow-main-value').textContent='—';$('flow-insights').innerHTML='';$('flow-window-table').innerHTML='';$('flow-history-table').innerHTML='';}else render();
    const prices=await aux;if(token!==generation)return;minuteData=prices[0].status==='fulfilled'?prices[0].value:null;dailyData=prices[1].status==='fulfilled'?prices[1].value:null;if(period==='history'?history:current)render();
  }
  $('flow-target').onchange=()=>{target=$('flow-target').value;current=history=null;$('flow-four-cards').innerHTML='';$('flow-insights').innerHTML='';$('flow-main-value').textContent='—';unavailable('full-flow-chart','正在读取所选范围的数据…');syncRule();refresh();};
  $('flow-window').onclick=event=>{const value=event.target.closest('[data-flow-window]')?.dataset.flowWindow;if(value){windowSize=value;render();}};
  $('flow-display').onchange=()=>{mode=$('flow-display').value;render();};
  $('flow-overlay').onchange=()=>{overlay=$('flow-overlay').checked;if(overlay&&!priceOverlay(current||{},minuteData)){overlay=false;toast('资金与价格未取得同日分钟点，未叠加其他日期。');}render();};
  $('flow-alert-form').onsubmit=event=>{event.preventDefault();const threshold=Number($('flow-alert-threshold').value),minutes=Number($('flow-alert-minutes').value);if(!Number.isFinite(threshold)||threshold<=0||threshold>1000000){toast('请输入有效的正数阈值，单位亿元');return;}state.flowAlerts||={};state.flowAlerts[target]={minutes,threshold};save();syncRule();toast('该范围大资金提醒已保存');};
  $('flow-alert-disable').onclick=()=>{if(state.flowAlerts)delete state.flowAlerts[target];save();syncRule();toast('该范围提醒已关闭');};
  $('flow-export').onclick=()=>{const data=period==='history'?history:current;if(!data)return;const rows=flowView(data,{period,mode,window:windowSize}),body='\ufeff'+[['时间','超大单/亿元','大单/亿元','中单/亿元','小单/亿元','主力合计/亿元'],...rows.map(r=>[r.time,...FLOW_GROUPS.map(g=>r[g.key]??''),mainFlow(r)??''])].map(r=>r.map(v=>typeof v==='number'?String(v):'\"'+String(v).replace(/^[=+@-]/,"'$&").replaceAll('\"','\"\"')+'\"').join(',')).join('\r\n'),blob=new Blob([body],{type:'text/csv;charset=utf-8'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`资金-${target}-${period}-${mode}-${today()}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);};
  controls();syncRule();return {refresh,resize:renderChart,focus:(code,label)=>{extraTargets.set(code,label);targetOptions();target=code;$('flow-target').value=code;current=history=null;syncRule();}};
}
