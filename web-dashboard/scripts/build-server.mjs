import {build} from 'esbuild';
import {readFile,mkdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
await mkdir(resolve(root,'dist/server'),{recursive:true});

const client=await build({entryPoints:[resolve(root,'client/app.js')],bundle:true,minify:true,write:false,format:'iife',target:'es2022',define:{__GITHUB_PAGES__:'false'}});
const [html,css,boot,manifest,icon]=await Promise.all(['index.html','style.css','boot.js','manifest.webmanifest','icon.svg'].map(name=>readFile(resolve(root,'client',name),'utf8')));
await build({entryPoints:[resolve(root,'worker/index.js')],outfile:resolve(root,'dist/server/index.js'),bundle:true,format:'esm',target:'es2022',define:{__HTML__:JSON.stringify(html),__CSS__:JSON.stringify(css),__APP__:JSON.stringify(client.outputFiles[0].text),__BOOT__:JSON.stringify(boot),__MANIFEST__:JSON.stringify(manifest),__ICON__:JSON.stringify(icon)}});

console.log('Built monitor: dist/server/index.js');
