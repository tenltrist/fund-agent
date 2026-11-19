import test from 'node:test';
import assert from 'node:assert/strict';
import {openingFromValue,holdingSummary,quoteStatus,unreadAlerts} from '../client/product-model.js';
import {validateBackup,loadState,STORE} from '../client/store.js';
import {emptyLedger,valuedPositions} from '../client/ledger.js';
import {stockCode} from '../worker/data.js';
const today='2026-11-19';
const fixture=()=>({...emptyLedger(),positions:[{id:'p',account_id:'default',code:'000001',name:'虚构测试'}],transactions:[{id:'t',position_id:'p',type:'opening',date:today,shares:100,cost:100}]});
const backup=()=>({version:1,funds:['000001'],stocks:[],ledger:fixture()});
test('same-date confirmed value and P&L produce auditable opening balance',()=>{
  const result=openingFromValue({value:120,profit:20,date:today,point:{date:today,nav:1.2}},today);
  assert.equal(result.shares,100);assert.equal(result.cost,100);
});
test('amount conversion rejects missing, mismatched, future or impossible inputs',()=>{
  const input={value:120,profit:-20,date:today,point:{date:today,nav:1.2}};
  assert.equal(openingFromValue(input,today).cost,140);
  for(const override of [{point:null},{point:{date:'2026-11-18',nav:1.2}},{value:0},{profit:120},{profit:NaN},{date:'2026-11-20'},{date:'2026-02-30'}])assert.throws(()=>openingFromValue({...input,...override},today));
});
test('latest shares are not valued against a NAV before their capital date',()=>{
  const b=fixture();
  const [p]=valuedPositions(b,[{code:'000001',nav:1.2,date:'2026-11-18'}]);
  assert.equal(p.value,null);assert.equal(p.profit,null);assert.equal(p.valuation_pending,true);
  assert.equal(valuedPositions(b,[{code:'000001',nav:1.2}])[0].value,null);
  assert.equal(valuedPositions(b,[{code:'000001',nav:1.2,date:today}])[0].value,120);
});
test('summary exposes partial position coverage without counting it as a complete total',()=>{
  const b=fixture();b.positions.push({id:'p2',account_id:'default',code:'000002',name:'缺失测试'});b.transactions.push({id:'t2',position_id:'p2',type:'opening',date:today,shares:20,cost:20});
  const s=holdingSummary(b,[{code:'000001',nav:1.2,date:today}]);
  assert.equal(s.total,2);assert.equal(s.covered,1);assert.equal(s.value,120);assert.equal(s.complete,false);
});
test('backup accepts existing v1 and round trips ledger with normalization',()=>{
  const restored=validateBackup(backup(),today);assert.equal(restored.ledger.transactions.length,1);assert.equal(restored.interval,30);
  assert.deepEqual(validateBackup({version:1,...restored},today),restored);
});
test('untrusted backups are fully validated before they can replace current records',()=>{
  for(const override of [{version:2},{funds:'000001'},{funds:['<script>']},{stocks:['920001']},{sent:{}},{alerts:[{message:'x',time:'bad'}]},{thresholds:{x:'9'}},{ledger:{version:1}},{ledgerThresholds:{p:101}}])assert.throws(()=>validateBackup({...backup(),...override},today));
});
test('damaged local state is retained verbatim for recovery before loading defaults',()=>{
  const raw='{"ledger":broken',map=new Map([[STORE,raw]]),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};
  const loaded=loadState(storage,today);assert(loaded.issue);assert.equal(map.get(STORE+'-recovery'),raw);assert.equal(map.get(STORE),raw);assert(loaded.state.funds.length);
});
test('legacy stored data is migrated without losing holdings or alerts',()=>{
  const v=backup();delete v.version;v.alerts=[{message:'测试',time:today+'T01:00:00Z'}];
  const loaded=loadState({getItem:()=>JSON.stringify(v)},today);assert.equal(loaded.issue,null);assert.equal(loaded.state.ledger.positions.length,1);assert.equal(loaded.state.alerts.length,1);
});
test('market status preserves old data dates instead of calling them live',()=>{
  const data={items:[{as_of:'2026-11-18 15:00:00'}],fetched_at:today+'T01:00:00Z'};
  assert.equal(quoteStatus(data,{today,trading:true}).level,'warning');
  assert.match(quoteStatus(data,{today,trading:true}).label,/2026-11-18/);
  data.items[0].as_of=today+' 09:00:00';assert.match(quoteStatus(data,{today,trading:true,now:Date.parse(today+'T03:00:00Z')}).label,/延迟/);
});
test('unread alerts are stable after marking read and accept subsequent events',()=>{
  const events=[{time:today+'T01:00:00Z'},{time:today+'T02:00:00Z'}];
  assert.equal(unreadAlerts(events,''),2);assert.equal(unreadAlerts(events,today+'T01:30:00Z'),1);
});
test('Beijing 920 codes do not route to Shanghai',()=>{assert.equal(stockCode('920001'),'bj920001');assert.equal(stockCode('600519'),'sh600519');});

test('fund sorting is stable, numeric and leaves unavailable values at the end',async()=>{
 const {sortFunds}=await import('../client/product-model.js');const rows=[{name:'甲',pct:null},{name:'乙',pct:-3},{name:'丙',pct:2},{name:'丁',pct:0}];
 assert.deepEqual(sortFunds(rows,'gain').map(r=>r.pct),[2,0,-3,null]);assert.deepEqual(sortFunds(rows,'loss').map(r=>r.pct),[-3,0,2,null]);assert.equal(rows[0].pct,null);
});
test('a successful fetch cannot make a delayed source quote look current',()=>{
 const data={items:[{as_of:today+' 10:00:00'}],fetched_at:today+'T03:00:00Z'};
 assert.match(quoteStatus(data,{today,trading:true,now:Date.parse(today+'T03:00:00Z')}).label,/延迟/);
});

test('failed persistence never leaves a new financial ledger pretending to be saved',async()=>{
 const {persistLedger}=await import('../client/store.js');const original=emptyLedger(),state={ledger:original},next=fixture();
 assert.throws(()=>persistLedger(state,next,today,()=>false),/未保存/);assert.equal(state.ledger,original);
 assert.throws(()=>persistLedger(state,next,today,()=>{throw Error('quota');}),/quota/);assert.equal(state.ledger,original);
 persistLedger(state,next,today,()=>true);assert.equal(state.ledger.positions.length,1);
});
