import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
const root=new URL('../dist/public/',import.meta.url);
const html=await readFile(new URL('index.html',root),'utf8');
assert(html.includes('./assets/app.js')&&html.includes('./assets/style.css'),'Project-relative assets required');
assert(!/chatgpt\.site|\.openai|src="\/assets/.test(html),'Pages must not depend on the previous host');
for(const file of ['assets/app.js','assets/bridge.js','bridge.html','assets/style.css'])assert((await readFile(new URL(file,root))).length>100);
const snapshot=JSON.parse(await readFile(new URL('data/snapshot.json',root),'utf8'));
assert.equal(snapshot.schema,1);assert(snapshot.routes['/api/indices'].items.length>=5);
assert(snapshot.routes['/api/funds'].items.length>=13,'Default fund coverage must be complete');
const privateKey=/"(?:holding_amount|profit_amount|profit_rate|peak_rate|position_id|thresholds|portfolio)"\s*:/;
for(const file of await readdir(new URL('data/',root))){const raw=await readFile(new URL('data/'+file,root),'utf8');assert(!privateKey.test(raw),'Private portfolio field in '+file);JSON.parse(raw);}
console.log('Pages artifact valid; relative assets, public data only, 13 funds covered');
