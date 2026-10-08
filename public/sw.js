// Hotpot offline support: the page and sounds are kept on the device so solo games work without a connection.
// Pages load network-first (so updates arrive straight away); sounds and music are served from the cache.
// The two web fonts are kept too. Music is fetched in full the first time a track plays, then served in byte ranges offline.
const V='hotpot-v2';
const SHELL=["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-180.png", "sfx/bowl1.mp3", "sfx/bowl2.mp3", "sfx/bowl3.mp3", "sfx/coin.mp3", "sfx/fan1.mp3", "sfx/ladle1.mp3", "sfx/ladle2.mp3", "sfx/ladle3.mp3", "sfx/page1.mp3", "sfx/page2.mp3", "sfx/page3.mp3", "sfx/place1.mp3", "sfx/place2.mp3", "sfx/place3.mp3", "sfx/place4.mp3", "sfx/shove1.mp3", "sfx/shove2.mp3", "sfx/shove3.mp3", "sfx/shuffle.mp3", "sfx/simmer.mp3", "sfx/slide1.mp3", "sfx/slide2.mp3", "sfx/slide3.mp3", "sfx/slide4.mp3", "sfx/stamp.mp3"];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
async function ranged(req,res){
  const m=/bytes=(\d*)-(\d*)/.exec(req.headers.get('range')||'');const b=await res.blob();
  if(!m)return new Response(b,{status:200,headers:{'Content-Type':'audio/mpeg','Accept-Ranges':'bytes','Content-Length':String(b.size)}});
  const s=+m[1]||0,e=m[2]?Math.min(+m[2],b.size-1):b.size-1;
  return new Response(b.slice(s,e+1),{status:206,headers:{'Content-Type':'audio/mpeg','Accept-Ranges':'bytes','Content-Range':`bytes ${s}-${e}/${b.size}`,'Content-Length':String(e-s+1)}});
}
self.addEventListener('fetch',e=>{
  const req=e.request,url=new URL(req.url);
  const fonts=/^fonts\.(googleapis|gstatic)\.com$/.test(url.host);
  if(req.method!=='GET'||(url.origin!==location.origin&&!fonts)||/^\/(api|ws)\//.test(url.pathname))return;
  if(req.mode==='navigate'){
    e.respondWith(fetch(req).then(r=>{const c=r.clone();caches.open(V).then(k=>k.put('index.html',c));return r}).catch(()=>caches.match('index.html')));
    return;
  }
  if(/\/music\/.+\.mp3$/.test(url.pathname)){
    e.respondWith(caches.open(V).then(async c=>{
      const hit=await c.match(url.pathname.replace(/^.*\/music\//,'music/'))||await c.match(req.url);
      if(hit)return ranged(req,hit);
      e.waitUntil(fetch(req.url).then(r=>r.ok&&c.put(req.url,r)).catch(()=>{}));
      return fetch(req);
    }));
    return;
  }
  e.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{if(r.ok){const c=r.clone();caches.open(V).then(k=>k.put(req,c))}return r})));
});
