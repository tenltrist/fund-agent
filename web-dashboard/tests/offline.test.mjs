import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('../client/sw.js',import.meta.url),'utf8')).replace('__SHELL_FILES__','[]').replace('__CACHE_NAME__','guanji-test');
function worker(fetcher){
  const events={},stored=new Map(),scope='https://example.com/fund-agent/';
  const cache={match:async key=>stored.get(typeof key==='string'?key:key.url)?.clone(),put:async(key,value)=>stored.set(typeof key==='string'?key:key.url,value.clone()),addAll:async()=>{}};
  vm.runInNewContext(source,{URL,Response,Headers,AbortSignal,fetch:fetcher,caches:{open:async()=>cache},self:{registration:{scope},addEventListener:(name,handler)=>events[name]=handler}});
  return {stored,request:async(url,mode='cors',method='GET')=>{let result;events.fetch({request:{url,mode,method},respondWith:p=>{result=p;}});return result?await result:null;}};
}
test('offline financial JSON retains the source timestamp and explicitly marks fallback',async()=>{
  const w=worker(async()=>{throw Error('offline');});w.stored.set('/fund-agent/data/snapshot.json',new Response('{"fetched_at":"2026-11-18T01:00:00Z"}'));
  const response=await w.request('https://example.com/fund-agent/data/snapshot.json');
  assert.equal(response.headers.get('X-Observatory-Cache'),'offline');assert.equal((await response.json()).fetched_at,'2026-11-18T01:00:00Z');
});
test('a fresh network result replaces cached public data',async()=>{
  const w=worker(async()=>new Response('{"date":"2026-11-19"}'));w.stored.set('/fund-agent/data/snapshot.json',new Response('{"date":"2026-11-18"}'));
  const response=await w.request('https://example.com/fund-agent/data/snapshot.json');assert.equal((await response.json()).date,'2026-11-19');assert.equal((await w.stored.get('/fund-agent/data/snapshot.json').json()).date,'2026-11-19');
});
test('missing offline data is unavailable, never a fabricated successful empty market',async()=>{
  const w=worker(async()=>{throw Error('offline');});assert.equal((await w.request('https://example.com/fund-agent/data/snapshot.json')).status,503);
});
test('project-scoped app shell works offline without intercepting personal or external traffic',async()=>{
  const w=worker(async()=>{throw Error('offline');});w.stored.set('https://example.com/fund-agent/',new Response('<h1>观基</h1>'));
  assert.match(await (await w.request('https://example.com/fund-agent/?v=test','navigate')).text(),/观基/);
  for(const url of ['https://external.com/data/snapshot.json','https://example.com/other-project/data/a.json','https://example.com/fund-agent/bridge.html','https://example.com/fund-agent/api/funds','https://example.com/fund-agent/assets/ocr/model.wasm'])assert.equal(await w.request(url),null);
  assert.equal(await w.request('https://example.com/fund-agent/data/private','cors','POST'),null);
});
