/* App shell only. Private ledger lives in localStorage, never in network requests.
 * Financial JSON always tries the network and retains its original source times. */
const CACHE='__CACHE_NAME__';
const SHELL=__SHELL_FILES__;
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('guanji-')&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{if(event.data==='activate-update')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url),scope=new URL(self.registration.scope);
  // Never cache the opaque external-data bridge, API requests or OCR models.
  if(request.method!=='GET'||url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname)||url.pathname.endsWith('/bridge.html')||url.pathname.includes('/ocr/')||url.pathname.includes('/api/'))return;
  const isData=url.pathname.includes('/data/'),isPage=request.mode==='navigate'&&!url.pathname.endsWith('.html');
  if(isData||isPage||url.pathname.endsWith('/index.html')){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      try{
        const response=await fetch(request,{signal:AbortSignal.timeout(isData?5000:3500)});
        if(!response.ok)throw Error('Unavailable');
        await cache.put(isData?url.pathname:new URL('./',scope).href,response.clone()).catch(()=>{});return response;
      }catch{
        const saved=await cache.match(isData?url.pathname:new URL('./',scope).href);
        if(saved){const headers=new Headers(saved.headers);headers.set('X-Observatory-Cache','offline');return new Response(saved.body,{status:saved.status,headers});}
        return new Response(isData?'{}':'暂时离线，请联网后再试。',{status:503,headers:{'Content-Type':isData?'application/json':'text/plain; charset=utf-8'}});
      }
    })());return;
  }
  // Hashed application assets are immutable. Unrelated files use normal fetch.
  if(/\/assets\/(?:app|style)\.[a-f0-9]{12}\.(?:js|css)$/.test(url.pathname)||url.pathname.endsWith('/icon.svg'))event.respondWith((async()=>{
    const cache=await caches.open(CACHE),saved=await cache.match(request);if(saved)return saved;
    const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response;
  })());
});
