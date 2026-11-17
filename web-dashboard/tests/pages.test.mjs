import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotValue,subset,parseMinute,parseFundArchive} from '../client/pages-api.js';
test('snapshot fallback retains source timestamp and never masquerades as current live data',()=>{
  const old={fetched_at:'2026-11-16T01:00:00Z',as_of:'2026-11-16',items:[{code:'000001',price:1}]};
  const result=snapshotValue(old,Date.parse('2026-11-17T01:00:00Z'));
  assert.equal(result.fetched_at,old.fetched_at);assert.equal(result.as_of,old.as_of);assert.equal(result.delivery,'github-snapshot');assert.equal(result.stale,true);
});
test('unknown stocks never receive an unrelated default quote',()=>{
  assert.equal(subset({items:[{code:'sh600519'}]},['sz000001']),null);
  assert.deepEqual(subset({items:[{code:'sh600519'}]},['sh600519','sz000001']).missing,['sz000001']);
});
test('minute protocol keeps actual date and missing values',()=>{
  const value=parseMinute({data:{sh000001:{data:{date:'20261117',data:['0930 4000 1 --']},qt:{sh000001:['','','','',3999]}}}},'sh000001');
  assert.equal(value.date,'2026-11-17');assert.equal(value.points[0].time,'09:30');assert.equal(value.points[0].turnover_yuan,null);assert.equal(value.previous_close,3999);
});
test('fund archive uses Shanghai date and provider dividend-aware return',()=>{
  const value=parseFundArchive({name:'Test',trend:[{x:Date.parse('2026-11-16T16:00:00Z'),y:1.2,equityReturn:.5}],holdings:['1.600519','0.300750']},'000001');
  assert.equal(value.points[0].date,'2026-11-17');assert.equal(value.points[0].pct,.5);assert.deepEqual(value.holdings,['sh600519','sz300750']);
});
