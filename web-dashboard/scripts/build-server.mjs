import {build} from 'esbuild';
import {readFile,mkdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
await mkdir(resolve(root,'dist/server'),{recursive:true});

const client=await build({entryPoints:[resolve(root,'client/app.js')],bundle:true,minify:true,write:false,format:'iife',target:'es2022',define:{__GITHUB_PAGES__:'false'}});
const [html,css]=await Promise.all([readFile(resolve(root,'client/index.html'),'utf8'),readFile(resolve(root,'client/style.css'),'utf8')]);
await build({entryPoints:[resolve(root,'worker/index.js')],outfile:resolve(root,'dist/server/index.js'),bundle:true,format:'esm',target:'es2022',define:{__HTML__:JSON.stringify(html),__CSS__:JSON.stringify(css),__APP__:JSON.stringify(client.outputFiles[0].text)}});

console.log('Built monitor: dist/server/index.js');
