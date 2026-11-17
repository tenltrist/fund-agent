import './build-server.mjs';
import http from 'node:http';
import {stat} from 'node:fs/promises';
const entry=new URL('../dist/server/index.js',import.meta.url);
let version=0,worker;
const server=http.createServer(async(req,res)=>{
  try {
    const stamp=(await stat(entry)).mtimeMs;
    if(stamp!==version){worker=(await import(entry.href+'?v='+stamp)).default;version=stamp;}
    const result=await worker.fetch(new Request('http://localhost'+req.url,{method:req.method,headers:req.headers}));
    res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
  }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
});
const port=Number(process.env.PORT||8765);
server.listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}`));
