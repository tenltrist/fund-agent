import {holdingsReference} from './holdings-reference.js';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,d=2)=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(d):'—',signed=(v,d=2)=>typeof v==='number'&&Number.isFinite(v)?(v>0?'+':'')+v.toFixed(d):'—',tone=v=>v>0?'positive':v<0?'negative':'muted';
export function mountFundLookthrough({api,today,onFlow}){
  const panel=document.createElement('section');panel.id='fund-reference-panel';panel.className='fund-reference-panel';$('fund-dialog').querySelector('.dialog-header').after(panel);
  panel.innerHTML='<h3>盘中持仓透视</h3><p class="data-line">按最近披露权重与最新股票行情计算已覆盖部分的涨跌贡献。权重日期和行情日期分开显示，未覆盖仓位不外推。</p><div id="fund-reference-summary" class="fund-reference-summary"></div><p id="fund-reference-meta" class="data-line"></p>';
  const parent=$('fund-dialog');parent.addEventListener('click',event=>{const b=event.target.closest('[data-holding-flow]');if(b)onFlow(b.dataset.holdingFlow,b.dataset.holdingName);});
  const action=h=>h.quote_code?`<button class="text-button" data-holding-flow="${esc(h.quote_code)}" data-holding-name="${esc(h.name)}">看资金 ↗</button>`:'—';
  async function show(code,isCurrent,fallbackCodes=[]){
    $('fund-reference-summary').innerHTML='';$('fund-reference-meta').textContent='正在取得公开持仓权重…';$('fund-holdings').textContent='正在读取股票行情…';
    try{
      const holdings=await api('/api/fund-holdings?code='+code,'公开持仓权重');if(!isCurrent())return;
      const codes=[...new Set(holdings.items.map(h=>h.quote_code).filter(Boolean))];if(!codes.length)throw Error('公开股票明细暂无可匹配的A股行情');
      const quotes=await api('/api/quotes?codes='+codes.join(','),'持仓股票行情');if(!isCurrent())return;
      const dates=quotes.items.map(q=>q.as_of?.slice(0,10)).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d<=today()).sort(),date=dates.at(-1)||today();
      const reference=holdingsReference(holdings,quotes.items,date);
      $('fund-reference-summary').innerHTML=`<div><span>已覆盖持仓参考贡献</span><strong class="${tone(reference.contribution_pp)}">${signed(reference.contribution_pp)}<small>个百分点</small></strong></div><div><span>按披露权重计算的行情覆盖</span><strong>${fmt(reference.quoted_weight)}<small>%</small></strong></div>`;
      $('fund-reference-meta').textContent=`持仓截止 ${holdings.as_of} · 股票行情截至 ${reference.quote_as_of||'未取得同日有效行情'} · 已披露股票合计权重 ${fmt(reference.disclosed_weight)}%。`+(reference.quoted_weight<=100?` 其余约 ${fmt(100-reference.quoted_weight)}% 净值权重未计算；这不是整只基金的实时净值。`:' 以来源披露权重为准，未外推整只基金净值。');
      if(reference.old_holdings)$('fund-reference-meta').textContent+=' 持仓披露超过183天或日期无效，本工具停止计算盘中贡献，仅展示股票行情。';
      $('fund-reference-meta').insertAdjacentHTML('beforeend',` <a href="https://fundf10.eastmoney.com/ccmx_${code}.html" target="_blank" rel="noreferrer">查看公开季报来源 ↗</a>`);
      $('fund-holdings').innerHTML='<div class="table-scroll"><table><thead><tr><th>披露股票</th><th>占净值权重</th><th>行情涨跌</th><th>参考贡献/百分点</th><th>报价时间</th><th>透视</th></tr></thead><tbody>'+reference.items.map(h=>`<tr><td>${esc(h.name)}<small>${esc(h.stock_code)}</small></td><td>${fmt(h.weight_pct)}%</td><td class="${tone(h.pct)}">${signed(h.pct)}%</td><td class="${tone(h.contribution_pp)}">${signed(h.contribution_pp,3)}</td><td>${esc(h.quote_as_of||'未取得同日有效行情')}</td><td>${action(h)}</td></tr>`).join('')+'</tbody></table></div>';
    }catch(error){
      if(!isCurrent())return;$('fund-reference-meta').textContent='暂未取得可计算的公开权重：'+error.message+'。未用行业走势代替基金估值。';$('fund-holdings').textContent='暂无可用持仓权重。';
      if(fallbackCodes.length)try{const data=await api('/api/quotes?codes='+fallbackCodes.slice(0,15).join(','));if(!isCurrent())return;$('fund-holdings').innerHTML='<p class="data-line">下面仅为公开档案中的股票名单及报价，尚无权重，不计算贡献。</p><div class="table-scroll"><table><thead><tr><th>股票</th><th>最新价</th><th>涨跌</th><th>报价时间</th><th>透视</th></tr></thead><tbody>'+data.items.map(q=>`<tr><td>${esc(q.name)}</td><td>${fmt(q.price)}</td><td>${signed(q.pct)}%</td><td>${esc(q.as_of||'未提供')}</td><td>${action({quote_code:q.code,name:q.name})}</td></tr>`).join('')+'</tbody></table></div>';}catch(e){if(isCurrent())$('fund-holdings').textContent='公开持仓及股票行情暂不可用：'+e.message;}
    }
  }
  return {show};
}
