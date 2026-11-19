import {emptyLedger,validateLedger} from './ledger.js';
import {holdingSummary,openingFromValue,quoteStatus,unreadAlerts} from './product-model.js';
import {STORE,persistLedger} from './store.js';
import {marketClock} from '../worker/data.js';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>v==null?'—':v.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const signed=v=>v==null?'—':(v>0?'+':'')+money(v);
const tone=v=>v>0?'positive':v<0?'negative':'muted';
const dateTime=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚未取得';
const routes=[['home','今日看板','◒'],['funds','基金自选','▤'],['ledger','我的持仓','◈'],['reports','收益日历','▦'],['market','基金市场','▥'],['overview','市场行情','◫'],['flows','资金流向','⇄'],['stocks','个股雷达','⌖']];
const tools=[['alerts','提醒中心','♧'],['import','导入数据','⌗'],['portfolio','历史快照','▧'],['sources','数据与设置','◎']];

export function mountProduct({state,save,api,go,toast,line,features,download,getData,issue}){
  let current='home',observed=new Map(),frame,searchGeneration=0,searchTimer,openingHistory,openingCode='',openingGeneration=0,installPrompt;
  const book=()=>validateLedger(state.ledger||emptyLedger());
  const nav=document.querySelector('[aria-label="主导航"]');
  // Reuse existing buttons/listeners and keep old hash routes valid.
  const buttons=new Map([...nav.querySelectorAll('[data-page]')].map(b=>[b.dataset.page,b]));nav.replaceChildren();
  for(const [id,label,icon] of routes){const b=buttons.get(id)||document.createElement('button');b.dataset.page=id;b.setAttribute('aria-label',label);b.innerHTML=`<span>${icon}</span>${label}${id==='funds'?'<b id="fund-nav-count">'+state.funds.length+'</b>':''}`;nav.append(b);}
  const more=document.createElement('details');more.className='nav-more';more.innerHTML='<summary>管理与工具 <span>⌄</span></summary>';
  for(const [id,label,icon] of tools){const b=buttons.get(id)||document.createElement('button');b.dataset.page=id;b.setAttribute('aria-label',label);b.innerHTML=`<span>${icon}</span>${label}`;more.append(b);}nav.append(more);
  document.querySelector('.brand').href='#home';document.querySelector('.brand').onclick=e=>{e.preventDefault();go('home');};
  document.querySelector('.brand small').textContent='你的基金观察与记账工具';
  const top=document.querySelector('.topbar');
  top.insertAdjacentHTML('afterbegin','<button id="menu-toggle" class="icon-button menu-toggle" aria-label="展开导航" aria-expanded="false">☰</button>');
  document.querySelector('.top-actions').insertAdjacentHTML('afterbegin','<button id="global-search-open" class="search-trigger" aria-label="搜索基金">⌕ <span>搜索基金 / 代码</span><kbd>⌘ K</kbd></button><button class="icon-button notification-button" data-page="alerts" aria-label="提醒中心">♧<b id="unread-count" hidden></b></button>');
  top.insertAdjacentHTML('afterend','<div id="data-banner" class="data-banner" role="status"><span>正在检查数据时间…</span><button class="text-button" data-page="sources">数据详情 ↗</button></div>');
  document.querySelector('main').insertAdjacentHTML('afterbegin',`
    <section class="page" id="page-home" hidden>
      <div class="page-heading home-heading"><div><div class="eyebrow">GUANJI / DAILY DESK</div><h1>今日看板<span class="heading-dot">.</span></h1><p>从你的自选和持仓出发，掌握今天的变化。</p></div><div class="home-actions"><button class="button light" id="hide-amounts" aria-label="隐藏资产金额">◉ 金额可见</button><button class="button" data-new-holding>＋ 记持仓</button></div></div>
      <div id="welcome-card" class="welcome-card"><div><span class="eyebrow">开始使用观基</span><h2>先关注，再记持仓，最后看收益。</h2><p>不用注册。你的账户和金额只保存在当前浏览器，换设备前记得导出备份。</p></div><div class="welcome-steps"><button id="welcome-search"><b>01</b><span>找到你的基金<small>名称、代码或拼音搜索</small></span>↗</button><button data-new-holding><b>02</b><span>录入实际持仓<small>支持份额，也支持金额换算</small></span>↗</button><button data-page="sources"><b>03</b><span>设置提醒与备份<small>守住记录，掌握数据时间</small></span>↗</button></div><button class="text-button" id="welcome-dismiss">收起引导</button></div>
      <div id="home-summary" class="summary-row home-summary"></div>
      <div class="home-grid"><article class="panel home-watch-panel"><div class="panel-heading"><div><h2>我的基金自选 <span id="home-watch-count" class="muted"></span></h2><p>每只基金保留自己的净值日期</p></div><button class="text-button" data-page="funds">全部自选 ↗</button></div><div id="home-watch" class="home-watch"></div><button class="watch-add" id="home-search">＋ 查找并关注基金</button></article>
      <div class="home-right"><article class="panel market-pulse"><div class="panel-heading"><div><h2>市场脉搏</h2><p id="home-market-meta">等待最近交易数据</p></div><button class="text-button" data-page="overview">行情 ↗</button></div><div id="home-indices" class="home-indices"></div><div id="home-index-chart" class="chart home-chart" aria-label="上证指数分时"></div><div class="pulse-actions"><button data-page="flows">⇄ 看资金四线</button><button data-page="market">▥ 发现基金</button></div></article><article class="panel"><div class="panel-heading"><h2>待办与提醒</h2><button class="text-button" data-page="alerts">提醒中心 ↗</button></div><div id="home-tasks"></div></article></div></div>
      <div class="local-note">◈ 个人记录保存在本机 · <button class="text-button" id="home-backup">导出备份</button> · <span id="home-backup-date">还没有导出记录</span></div>
    </section>
    <section class="page" id="page-alerts" hidden><div class="page-heading"><div><div class="eyebrow">YOUR NOTIFICATIONS</div><h1>提醒中心<span class="heading-dot">.</span></h1><p>净值更新、涨跌异动、资金阈值和定投待办集中查看。</p></div><button class="button light" id="alerts-read">全部标为已读</button></div><div class="notice">提醒在页面打开且有有效数据时产生。关闭网页后不会继续监测或推送。</div><div id="notification-list" class="panel notification-list"></div></section>`);
  document.body.insertAdjacentHTML('beforeend',`
    <div class="nav-scrim" id="nav-scrim" hidden></div><nav class="mobile-nav" aria-label="快捷导航">${[['home','看板','◒'],['funds','自选','▤'],['ledger','持仓','◈'],['flows','资金','⇄']].map(([id,label,icon])=>`<button data-page="${id}" aria-label="${label}"><span>${icon}</span>${label}</button>`).join('')}<button id="mobile-more" aria-label="更多功能"><span>☰</span>更多</button></nav>
    <dialog id="search-dialog" class="search-dialog" aria-labelledby="search-title"><div class="dialog-header"><h2 id="search-title">搜索基金</h2><button class="icon-button" data-close="search-dialog" aria-label="关闭搜索">×</button></div><input id="global-query" class="global-query" placeholder="基金名称、6位代码或拼音" aria-label="搜索基金名称代码拼音" autocomplete="off"><p id="global-search-status" class="data-line">输入关键词，从公开基金目录查找。</p><div id="global-results" class="global-results"></div></dialog>
    <dialog id="holding-dialog" class="holding-dialog" aria-labelledby="holding-title"><div class="dialog-header"><div><div class="eyebrow">YOUR POSITIONS</div><h2 id="holding-title">记一笔持仓</h2></div><button class="icon-button" data-close="holding-dialog" aria-label="关闭持仓录入">×</button></div><p class="data-line">把平台上已确认的持仓记在这里。只记录，不下单。</p><form id="quick-holding-form" class="feature-form"><label>基金代码<input id="quick-code" pattern="[0-9]{6}" inputmode="numeric" maxlength="6" required placeholder="例如 000001"></label><label>所属账户<select id="quick-account"></select></label><label id="quick-new-account-wrap" hidden>新账户名称<input id="quick-new-account" maxlength="80" placeholder="例如 支付宝"></label><p id="quick-fund-name" class="form-wide data-line">输入代码后获取公开基金档案</p><label class="form-wide">录入方式<select id="quick-mode"><option value="shares">实际份额 + 剩余成本（推荐）</option><option value="value">持仓金额 + 持有收益（按确认净值换算）</option></select></label><label id="quick-shares-wrap">实际持有份额<input id="quick-shares" type="number" min="0.000001" step="any" required></label><label id="quick-cost-wrap">剩余成本（元）<input id="quick-cost" type="number" min="0.01" step="any" required></label><label id="quick-value-wrap" hidden>平台持仓金额（元）<input id="quick-value" type="number" min="0.01" step="any"></label><label id="quick-profit-wrap" hidden>平台持有收益（元，可为负）<input id="quick-profit" type="number" step="any"></label><label class="form-wide">持仓确认日期<input id="quick-date" type="date" required></label><p id="quick-preview" class="form-wide notice">填写平台已确认的份额与剩余成本。</p><label class="form-wide review-check" id="quick-review-wrap" hidden><input id="quick-reviewed" type="checkbox">我已核对：金额和收益均对应所选日期的已确认净值，未包含在途份额</label><p id="quick-error" class="form-wide inline-error" role="alert" hidden></p><button class="button form-wide" id="quick-save">核对并保存持仓</button></form></dialog>`);
  // Put ordinary actions where people look for them, keeping the advanced forms.
  $('page-ledger').querySelector('h1').innerHTML='我的持仓<span class="heading-dot">.</span>';
  $('page-ledger').querySelector('.page-heading').insertAdjacentHTML('beforeend','<button class="button" data-new-holding>＋ 记持仓</button>');
  $('page-ledger').querySelector('.page-heading p').textContent='资产、收益、交易记录与回撤提醒，按账户放在一起。';
  const ledgerPage=$('page-ledger'),positionPanel=$('ledger-positions').closest('article'),advancedPanel=$('opening-form').closest('article'),tradePanel=$('transaction-form').closest('article'),recordPanel=$('transaction-table').closest('article'),planPanel=$('plan-list').closest('article'),oldSplit=advancedPanel.parentElement;
  const ledgerTabs=document.createElement('div');ledgerTabs.className='ledger-tabs';ledgerTabs.setAttribute('aria-label','持仓内容');ledgerTabs.innerHTML=[['positions','持仓概览'],['trades','交易记录'],['plans','定投计划']].map(([key,label])=>`<button data-ledger-tab="${key}" class="${key==='positions'?'active':''}" aria-pressed="${key==='positions'}">${label}</button>`).join('');
  $('ledger-status').after(ledgerTabs);
  const advanced=document.createElement('details');advanced.className='advanced-book';advanced.innerHTML='<summary>管理账户与高级份额录入</summary>';advanced.append(advancedPanel);positionPanel.after(advanced);
  const tradePane=document.createElement('div');tradePane.id='book-trades';tradePane.hidden=true;tradePane.append(tradePanel,recordPanel);ledgerPage.append(tradePane);
  const planPane=document.createElement('div');planPane.id='book-plans';planPane.hidden=true;planPane.append(planPanel);ledgerPage.append(planPane);oldSplit.remove();
  function ledgerTab(key){positionPanel.hidden=key!=='positions';advanced.hidden=key!=='positions';tradePane.hidden=key!=='trades';planPane.hidden=key!=='plans';ledgerTabs.querySelectorAll('button').forEach(b=>{b.classList.toggle('active',b.dataset.ledgerTab===key);b.setAttribute('aria-pressed',String(b.dataset.ledgerTab===key));});}
  $('fund-dialog').querySelector('.dialog-header').insertAdjacentHTML('afterend','<div id="fund-detail-actions" class="detail-actions"><button class="button light" id="detail-watch">加入自选</button><button class="button" id="detail-holding">＋ 记持仓</button><button class="button light" id="detail-compare">加入对比</button></div>');
  $('fund-detail-actions').insertAdjacentHTML('afterend','<div id="detail-facts" class="detail-facts"></div><p id="detail-quote-meta" class="data-line"></p>');
  $('page-funds').querySelector('.panel-heading').insertAdjacentHTML('beforeend','<label class="watch-sort-label">排序 <select id="watch-sort" aria-label="自选基金排序"><option value="default">添加顺序</option><option value="gain">涨幅优先</option><option value="loss">跌幅优先</option><option value="month">近月收益</option><option value="name">基金名称</option></select></label>');
  $('watch-sort').value=state.watchSort;$('watch-sort').onchange=()=>{state.watchSort=$('watch-sort').value;save();document.dispatchEvent(new CustomEvent('observatory:watch'));};
  $('page-sources').insertAdjacentHTML('beforeend','<article class="panel feature-section"><h2>本地数据与恢复</h2><p class="data-line">恢复备份之前，会自动保留当前记录。恢复文件仅存在本机。</p><div class="feature-controls"><button class="button light" id="restore-previous">恢复上次导入前的记录</button><button class="button light" id="export-recovery">导出保留的恢复文件</button><button class="button light" id="install-app">添加到桌面</button></div><p id="storage-status" class="data-line"></p></article><article class="panel"><h2>公开数据发布健康</h2><p id="publication-status" class="data-line">正在检查 GitHub 公共快照…</p><details><summary>查看本次未更新的数据</summary><div id="publication-errors" class="data-line"></div></details></article>');
  let detailCode;
  function showError(message){$('quick-error').textContent=message;$('quick-error').hidden=false;}
  function openSearch(){if($('holding-dialog').open){toast('请先保存或关闭当前持仓录入');return;}if($('fund-dialog').open)$('fund-dialog').close();if(!$('search-dialog').open)$('search-dialog').showModal();$('global-query').focus();}
  async function search(){
    const token=++searchGeneration,q=$('global-query').value.trim();
    if(!q){$('global-results').replaceChildren();$('global-search-status').textContent='输入关键词，从公开基金目录查找。';return;}
    $('global-search-status').textContent='查找中…';
    try{const data=await api('/api/search-funds?q='+encodeURIComponent(q));if(token!==searchGeneration)return;
      $('global-search-status').textContent=data.items.length?'找到 '+data.items.length+' 个结果 · 点击名称看详情':'没有匹配结果，试试6位基金代码';
      $('global-results').innerHTML=data.items.map(r=>`<div class="search-result"><button class="fund-name" data-search-fund="${r.code}">${esc(r.name)}<small>${r.code} · ${esc(r.type||'基金')}</small></button><button class="watch-toggle ${state.funds.includes(r.code)?'watched':''}" data-toggle-watch="${r.code}" aria-label="${state.funds.includes(r.code)?'取消关注':'关注'}${esc(r.name)}">${state.funds.includes(r.code)?'★':'☆'}</button></div>`).join('');
    }catch(e){if(token===searchGeneration)$('global-search-status').textContent=e.message+'；请重试。';}
  }
  async function loadOpening(){
    const code=$('quick-code').value,token=++openingGeneration;openingHistory=null;openingCode=code;$('quick-reviewed').checked=false;
    if(!/^\d{6}$/.test(code)){$('quick-fund-name').textContent='请输入6位基金代码';return;}
    $('quick-fund-name').textContent='读取基金档案…';
    try{const h=await api('/api/fund-history?code='+code);if(token!==openingGeneration)return;openingHistory=h;$('quick-fund-name').textContent=h.name+' · 最近确认净值 '+h.as_of;
      if(!$('quick-date').dataset.edited)$('quick-date').value=h.as_of;previewOpening();
    }catch(e){if(token===openingGeneration)$('quick-fund-name').textContent=e.message+'；可以按实际份额记账，保存时会校验基金代码。';}
  }
  function previewOpening(){
    const byValue=$('quick-mode').value==='value';
    for(const key of ['shares','cost','value','profit']){const enabled=byValue?['value','profit'].includes(key):['shares','cost'].includes(key);$('quick-'+key+'-wrap').hidden=!enabled;$('quick-'+key).required=enabled;}
    $('quick-review-wrap').hidden=!byValue;
    if(!byValue){$('quick-preview').textContent='按平台实际份额与剩余成本保存为期初基线。历史交易和高点从这次记录开始。';return;}
    try{const converted=openingFromValue({value:Number($('quick-value').value),profit:$('quick-profit').value===''?NaN:Number($('quick-profit').value),date:$('quick-date').value,point:openingHistory?.points.find(p=>p.date===$('quick-date').value)},getData().today);
      $('quick-preview').textContent=`确认净值 ${converted.nav.toFixed(4)} · 换算份额 ${converted.shares.toFixed(4)} · 剩余成本 ¥${money(converted.cost)}。平台金额可能经过四舍五入；知道实际份额时请优先使用份额录入。`;
    }catch(e){$('quick-preview').textContent=e.message;}
  }
  function openHolding(code=''){
    if($('fund-dialog').open)$('fund-dialog').close();if($('search-dialog').open)$('search-dialog').close();
    $('quick-holding-form').reset();$('quick-date').value=getData().today;delete $('quick-date').dataset.edited;
    $('quick-account').innerHTML=book().accounts.map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')+'<option value="__new">＋ 新建账户</option>';
    $('quick-new-account-wrap').hidden=true;$('quick-error').hidden=true;$('quick-code').value=code;openingHistory=null;previewOpening();$('holding-dialog').showModal();
    if(code)loadOpening();else{$('quick-fund-name').textContent='输入代码后获取公开基金档案';$('quick-code').focus();}
  }
  $('quick-holding-form').onsubmit=async event=>{
    event.preventDefault();$('quick-error').hidden=true;$('quick-save').disabled=true;
    try{
      const code=$('quick-code').value,date=$('quick-date').value,b=book(),original=JSON.stringify(state.ledger||emptyLedger());let account=$('quick-account').value;
      if(account==='__new'){const name=$('quick-new-account').value.trim();if(!name)throw Error('请填写账户名称');account=b.accounts.find(a=>a.name===name)?.id||crypto.randomUUID();if(!b.accounts.some(a=>a.id===account))b.accounts.push({id:account,name});}
      if(b.positions.some(p=>p.code===code&&p.account_id===account))throw Error('该账户已有这只基金。请在我的持仓中记录加仓或减仓。');
      let shares=Number($('quick-shares').value),cost=Number($('quick-cost').value);
      if($('quick-mode').value==='value'){
        if(!openingHistory||openingCode!==code)throw Error('请等待对应基金的确认净值加载完成');
        if(!$('quick-reviewed').checked)throw Error('请先核对日期、金额和在途份额，并勾选确认');
        ({shares,cost}=openingFromValue({value:Number($('quick-value').value),profit:$('quick-profit').value===''?NaN:Number($('quick-profit').value),date,point:openingHistory.points.find(p=>p.date===date)},getData().today));
      }
      const q=(await api('/api/funds?codes='+code)).items.find(q=>q.code===code);if(!q)throw Error('该基金代码暂无有效公开记录');
      if(original!==JSON.stringify(state.ledger||emptyLedger()))throw Error('账本已在其他窗口变更，请重新核对后保存');
      const id=crypto.randomUUID();b.positions.push({id,account_id:account,code,name:q.name});b.transactions.push({id:crypto.randomUUID(),position_id:id,type:'opening',date,shares,cost,fee:0});
      persistLedger(state,b,getData().today,save);state.onboarded=true;save();$('holding-dialog').close();go('ledger');toast('持仓已保存在本浏览器，可继续记录交易和查看收益');
    }catch(e){showError(e.message);}finally{$('quick-save').disabled=false;}
  };
  $('quick-account').onchange=()=>{$('quick-new-account-wrap').hidden=$('quick-account').value!=='__new';};
  $('quick-code').oninput=()=>{clearTimeout(searchTimer);openingHistory=null;openingGeneration++;if($('quick-code').value.length===6)searchTimer=setTimeout(loadOpening,250);};
  $('quick-date').onchange=()=>{$('quick-date').dataset.edited='1';$('quick-reviewed').checked=false;previewOpening();};
  for(const id of ['quick-mode','quick-value','quick-profit'])$(id).oninput=()=>{$('quick-reviewed').checked=false;previewOpening();};
  $('global-query').oninput=()=>{searchGeneration++;clearTimeout(searchTimer);searchTimer=setTimeout(search,220);};
  $('global-query').onkeydown=e=>{if(e.key==='ArrowDown'){$('global-results').querySelector('button')?.focus();e.preventDefault();}};
  $('global-results').onkeydown=e=>{const list=[...$('global-results').querySelectorAll('button')],at=list.indexOf(document.activeElement);if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();list[(at+(e.key==='ArrowDown'?1:-1)+list.length)%list.length]?.focus();}};
  for(const id of ['global-search-open','home-search','welcome-search'])$(id).onclick=openSearch;
  document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openSearch();}if(e.key==='Escape')closeMenu();});
  const sidebar=document.querySelector('.sidebar'),mobile=matchMedia('(max-width:760px)');
  function syncNavigation(){sidebar.inert=mobile.matches&&!document.body.classList.contains('nav-open');}
  function closeMenu(){document.body.classList.remove('nav-open');$('nav-scrim').hidden=true;$('menu-toggle').setAttribute('aria-expanded','false');syncNavigation();}
  function toggleMenu(){const open=!document.body.classList.contains('nav-open');document.body.classList.toggle('nav-open',open);$('nav-scrim').hidden=!open;$('menu-toggle').setAttribute('aria-expanded',String(open));syncNavigation();if(open)sidebar.querySelector('[aria-current="page"]')?.focus();}
  mobile.addEventListener('change',()=>{closeMenu();});syncNavigation();
  $('menu-toggle').onclick=toggleMenu;$('mobile-more').onclick=toggleMenu;$('nav-scrim').onclick=closeMenu;
  $('welcome-dismiss').onclick=()=>{state.onboarded=true;save();};
  $('hide-amounts').onclick=()=>{state.hideAmounts=!state.hideAmounts;save();};
  $('home-backup').onclick=download;
  $('alerts-read').onclick=()=>{state.alertReadAt=new Date().toISOString();save();toast('已全部标为已读');};
  $('restore-previous').onclick=()=>{try{const raw=localStorage.getItem(STORE+'-before-restore');if(!raw)throw Error('还没有导入前的记录');restore(raw);}catch(e){toast(e.message);}};
  $('export-recovery').onclick=()=>{const raw=localStorage.getItem(STORE+'-recovery')||localStorage.getItem(STORE+'-before-restore');if(!raw){toast('没有需要恢复的文件');return;}const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([raw],{type:'application/json'}));a.download='观基-本地恢复文件.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  function restore(raw){document.dispatchEvent(new CustomEvent('observatory:restore',{detail:raw}));}
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});
  $('install-app').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;}else toast('使用浏览器菜单中的“安装应用”或“添加到主屏幕”；Safari 请从分享菜单添加。');};
  document.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-new-holding'))openHolding(b.dataset.newHolding||'');
    if(b.dataset.ledgerTab)ledgerTab(b.dataset.ledgerTab);
    if(b.dataset.bookTrade){ledgerTab('trades');$('transaction-position').value=b.dataset.bookTrade;$('transaction-form').scrollIntoView({behavior:'smooth',block:'center'});}
    if(b.dataset.close)$(b.dataset.close).close();
    if(b.dataset.searchFund){$('search-dialog').close();document.dispatchEvent(new CustomEvent('observatory:fund',{detail:b.dataset.searchFund}));}
    if(b.dataset.toggleWatch){const code=b.dataset.toggleWatch;const watched=state.funds.includes(code);if(!watched&&state.funds.length>=60){toast('基金自选最多60只');return;}state.funds=watched?state.funds.filter(c=>c!==code):[...state.funds,code];save();search();document.dispatchEvent(new CustomEvent('observatory:watch'));toast(watched?'已取消关注':'已加入基金自选');}
  });
  for(const id of ['search-dialog','holding-dialog'])$(id).addEventListener('click',e=>{if(e.target===$(id))$(id).close();});
  $('detail-watch').onclick=()=>{if(!detailCode)return;const code=detailCode;if(!state.funds.includes(code)&&state.funds.length>=60){toast('基金自选最多60只');return;}state.funds=state.funds.includes(code)?state.funds.filter(c=>c!==code):[...state.funds,code];save();detail(detailCode);document.dispatchEvent(new CustomEvent('observatory:watch'));};
  $('detail-holding').onclick=()=>openHolding(detailCode);
  $('detail-compare').onclick=()=>{const codes=[...new Set([...$('compare-codes').value.split(',').filter(Boolean),detailCode])];if(codes.length>4){toast('最多对比4只，请先在基金市场调整');return;}$('compare-codes').value=codes.join(',');$('fund-dialog').close();go('market');$('compare-form').scrollIntoView({behavior:'smooth',block:'center'});toast('已加入对比，点击“开始对比”查看共同区间表现');};
  async function detail(code){
    detailCode=code;$('detail-watch').textContent=state.funds.includes(code)?'★ 已关注 · 取消':'☆ 加入自选';
    $('detail-facts').textContent='正在读取净值…';$('detail-quote-meta').textContent='';
    try{const result=await api('/api/funds?codes='+code),q=result.items.find(q=>q.code===code);if(detailCode!==code||!q)return;
      $('detail-facts').innerHTML=[['最新可用净值',Number(q.nav).toFixed(4),null],['该净值日涨跌',signed(q.pct)+'%',q.pct],['近1月',q.ret_1m==null?'—':signed(q.ret_1m)+'%',q.ret_1m],['近1年',q.ret_1y==null?'—':signed(q.ret_1y)+'%',q.ret_1y]].map(([label,value,pct])=>`<div><span>${label}</span><strong class="${tone(pct)}">${value}</strong></div>`).join('');
      $('detail-quote-meta').textContent=q.date+' · '+q.source+(result.stale?' · 较早快照，请核对日期':'')+' · 估算与最终确认净值可能不同';
    }catch(e){if(detailCode===code){$('detail-facts').textContent='最新净值暂未取得';$('detail-quote-meta').textContent=e.message;}}
  }
  function render(){
    frame=null;const data=getData(),b=book(),quotes=features.getQuotes(),summary=holdingSummary(b,quotes),hide=state.hideAmounts;
    const amount=v=>hide?'••••':money(v),unread=unreadAlerts(state.alerts,state.alertReadAt);
    $('welcome-card').hidden=state.onboarded||summary.total>0;
    $('hide-amounts').textContent=hide?'◉ 金额已隐藏':'◉ 金额可见';$('hide-amounts').setAttribute('aria-label',hide?'显示资产金额':'隐藏资产金额');
    document.body.classList.toggle('amounts-hidden',hide);
    const card=(label,value,note,cls='')=>`<div class="summary-card"><span>${label}</span><strong class="${cls}">${value}</strong><small>${note}</small></div>`;
    $('home-summary').innerHTML=card('持仓参考资产',summary.total?'¥'+amount(summary.value):'尚未记持仓',summary.total?`${summary.covered}/${summary.total} 个持仓可计算${summary.complete?'':' · 部分数据'} · ${summary.dates.join(' / ')||'等待净值'}`:'录入实际持仓后，查看资产与收益')+card('持有收益',summary.total?'¥'+(hide?'••••':signed(summary.profit)):'—','按剩余成本计算 · 使用逐基金最新净值',hide?'':tone(summary.profit))+card('基金自选',state.funds.length+' 只','关注走势，也可从详情直接记持仓')+card('未读提醒',String(unread),'净值更新、异动和定投计划');
    const items=data.funds?.items||[];$('home-watch-count').textContent=state.funds.length+'只';
    const rows=state.funds.slice(0,8).map(code=>{const q=items.find(q=>q.code===code);return `<div class="home-fund-row"><button class="fund-name" data-fund="${code}">${esc(q?.name||code)}<small>${code} · ${esc(q?.date||'等待净值')} · ${esc(q?.source||'未取得')}</small></button><div class="watch-quote"><strong class="${tone(q?.pct)}">${q?.pct==null?'—':signed(q.pct)+'%'}</strong><small>净值 ${q?Number(q.nav).toFixed(4):'—'}</small></div><button class="icon-button" data-new-holding="${code}" aria-label="记录${esc(q?.name||code)}持仓">＋</button></div>`;});
    $('home-watch').innerHTML=rows.join('')||'<div class="compact-empty">还没有自选基金。搜索一只基金开始关注。</div>';
    const indices=data.indices?.items||[];$('home-indices').innerHTML=indices.slice(0,3).map(q=>`<button data-page="overview"><span>${esc(q.name)}</span><strong class="${tone(q.pct)}">${signed(q.pct)}%</strong><small>${money(q.price)}</small></button>`).join('')||'<p class="data-line">正在连接公开行情…</p>';
    const status=quoteStatus(data.indices,{today:data.today,trading:marketClock().trading});$('home-market-meta').textContent=status.label+' · '+(indices[0]?.as_of||'时间待取得');
    const minute=observed.get('/api/minute?code=sh000001');if(minute?.points?.length&&current==='home')line('home-index-chart',minute.points,'time','price',{name:'上证指数',color:'#668d80'});
    const plans=b.plans.filter(p=>p.active&&p.next_date<=data.today);
    $('home-tasks').innerHTML=(plans.length?`<button class="task-row" data-page="ledger"><span class="task-dot"></span>${plans.length} 项定投已到期<span>查看 ↗</span></button>`:'')+(!state.lastBackupAt&&b.positions.length?'<button class="task-row" data-page="sources"><span class="task-dot"></span>记得备份你的持仓记录<span>去备份 ↗</span></button>':'')+state.alerts.slice(0,3).map(a=>`<button class="home-alert" data-page="alerts">${esc(a.message)}<small>${esc(dateTime(a.time))}</small></button>`).join('')+(!plans.length&&!state.alerts.length?'<p class="compact-empty">目前没有新提醒。公开数据更新或达到已设置阈值时，会在这里出现。</p>':'');
    $('home-backup-date').textContent=state.lastBackupAt?'上次导出 '+dateTime(state.lastBackupAt):'还没有导出记录';
    $('unread-count').hidden=!unread;$('unread-count').textContent=unread>99?'99+':unread;
    $('notification-list').innerHTML=state.alerts.length?state.alerts.map(a=>`<div class="notification-item ${a.time>state.alertReadAt?'unread':''}"><span class="task-dot"></span><div>${esc(a.message)}<small>${esc(dateTime(a.time))}</small></div></div>`).join(''):'<div class="compact-empty">暂无提醒记录。可在数据与设置中调整涨跌幅阈值，在资金页和持仓页设置各自的回撤或资金提醒。</div>';
    $('storage-status').textContent=issue||('本地存储可用 · '+b.positions.length+' 个持仓 · '+b.transactions.length+' 条交易 · '+(state.lastBackupAt?'最近导出 '+dateTime(state.lastBackupAt):'尚未导出备份'));
    const online=navigator.onLine&&!data.indices?.offline_cached,stale=status.level==='warning';$('data-banner').classList.toggle('is-warning',!online||stale);
    $('data-banner').firstElementChild.textContent=!online?'当前离线 · 显示已保存数据，时间见各项记录':indices.length?'行情时间 '+indices[0].as_of+' · '+status.label+' · '+(data.indices.delivery==='github-snapshot'?'公开快照':'公开直连'):'正在连接公开数据；持仓记录可在本机查看';
  }
  function requestRender(){if(!frame)frame=requestAnimationFrame(render);}
  window.addEventListener('observatory:state',requestRender);window.addEventListener('online',requestRender);window.addEventListener('offline',requestRender);
  async function publication(){try{const s=await api('/api/status');$('publication-status').textContent=s.mode==='local'?'当前为本机服务，直接读取公开数据；未经过GitHub定时发布。':'最近发布 '+dateTime(s.generated_at)+' · '+s.route_count+' 项公开数据 · '+s.errors.length+' 项本次未更新（保留各项原时间）。GitHub 定时任务可能延迟，页面刷新不等于源数据刷新。';$('publication-errors').innerHTML=s.errors.slice(0,30).map(e=>'<div>'+esc(e.route)+' · '+esc(e.error)+'</div>').join('')||'本次采集没有记录失败。';}catch(e){$('publication-status').textContent='无法检查发布状态：'+e.message;}}
  render();publication();
  return {render:requestRender,detail,observe:(path,data)=>{observed.set(path,data);requestRender();},onPage:next=>{current=next;closeMenu();document.querySelectorAll('.mobile-nav [data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===next));if(tools.some(r=>r[0]===next))more.open=true;if(next==='home')features.refreshBook();if(next==='sources')publication();requestRender();}};
}
