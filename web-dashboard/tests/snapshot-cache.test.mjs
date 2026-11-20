import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeSnapshots,mergeFundSnapshots} from '../scripts/snapshot-cache.mjs';
test('new routes survive a newer snapshot produced by an older deployment',()=>{const local={schema:1,generated_at:'2026-11-17T00:00:00Z',routes:{'/api/fund-holdings?code=000001':{as_of:'2026-09-30',fetched_at:'2026-11-17T00:00:00Z'},'/api/indices':{fetched_at:'2026-11-17T00:00:00Z'}}},remote={schema:1,generated_at:'2026-11-17T01:00:00Z',routes:{'/api/indices':{fetched_at:'2026-11-17T01:00:00Z',items:[1]}}};const r=mergeSnapshots(local,remote);assert.equal(r.routes['/api/fund-holdings?code=000001'].as_of,'2026-09-30');assert.deepEqual(r.routes['/api/indices'].items,[1]);});
test('a later fetch does not replace a newer disclosure or rewrite its timestamp',()=>{const key='/api/fund-holdings?code=000001',local={routes:{[key]:{as_of:'2026-09-30',fetched_at:'2026-11-16T00:00:00Z'}}},remote={schema:1,routes:{[key]:{as_of:'2025-12-31',fetched_at:'2026-11-17T00:00:00Z'}}};assert.equal(mergeSnapshots(local,remote).routes[key].fetched_at,'2026-11-16T00:00:00Z');});

const oldFunds={fetched_at:'2026-11-19T08:00:00Z',items:[
  {code:'000001',date:'2026-11-18',nav:1.1,pct:0,source:'已公布净值'},
  {code:'000002',date:'2026-11-18',nav:2.2,pct:-1,source:'已公布净值'}
]};
const partialFunds={fetched_at:'2026-11-20T08:00:00Z',items:[{code:'000001',date:'2026-11-19',nav:1.2,pct:1}],missing:['000002'],warnings:[]};

test('a partial fund response retains the omitted code, date and original fetch time',()=>{
  const merged=mergeFundSnapshots(oldFunds,partialFunds,['000001','000002'],'2026-11-20');
  assert.deepEqual(merged.items[0],partialFunds.items[0]);
  assert.deepEqual(merged.items[1],{...oldFunds.items[1],stale:true,fetched_at:oldFunds.fetched_at});
  assert.deepEqual(merged.missing,[]);assert.deepEqual(merged.fallback_codes,['000002']);
  assert.equal(merged.stale,true);assert.match(merged.warnings[0],/000002/);
  assert.equal(oldFunds.items[1].stale,undefined);
});
test('repeated failures preserve the original timestamp and recovery clears fallback',()=>{
  const first=mergeFundSnapshots(oldFunds,partialFunds,['000001','000002'],'2026-11-20');
  const second=mergeFundSnapshots(first,{...partialFunds,fetched_at:'2026-11-20T09:00:00Z'},['000001','000002'],'2026-11-20');
  assert.equal(second.items[1].fetched_at,oldFunds.fetched_at);
  const fresh={...partialFunds,items:[...partialFunds.items,{code:'000002',date:'2026-11-19',nav:2.3,pct:0}]};
  const recovered=mergeFundSnapshots(second,fresh,['000001','000002'],'2026-11-20');
  assert.deepEqual(recovered.items,fresh.items);assert.equal(recovered.stale,false);
  assert.deepEqual(recovered.fallback_codes,[]);assert.deepEqual(recovered.warnings,[]);
});
test('fund date regression, zero NAV and future dates cannot overwrite valid cached values',()=>{
  for(const replacement of [{date:'2026-11-17',nav:9},{date:'2026-11-19',nav:0},{date:'2026-11-21',nav:9}]){
    const merged=mergeFundSnapshots(oldFunds,{items:[{code:'000002',pct:0,...replacement}]},['000002'],'2026-11-20');
    assert.equal(merged.items[0].nav,2.2);assert.equal(merged.items[0].date,'2026-11-18');
  }
});
test('cold start leaves unknown codes missing rather than fabricating coverage',()=>{
  const merged=mergeFundSnapshots(undefined,partialFunds,['000001','000002'],'2026-11-20');
  assert.deepEqual(merged.items,partialFunds.items);assert.deepEqual(merged.missing,['000002']);
  assert.deepEqual(merged.fallback_codes,[]);
});
test('merging a newer partial deployment preserves per-fund coverage in either direction',()=>{
  const old={schema:1,routes:{'/api/funds':oldFunds}},fresh={schema:1,routes:{'/api/funds':partialFunds}};
  for(const merged of [mergeSnapshots(old,fresh),mergeSnapshots(fresh,old)]){
    const funds=merged.routes['/api/funds'];
    assert.equal(funds.items.length,2);assert.equal(funds.items[0].nav,1.2);assert.equal(funds.items[1].nav,2.2);
    assert.equal(funds.items[1].fetched_at,oldFunds.fetched_at);assert.equal(funds.stale,true);
  }
});
