import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
async function walk(dir) {
  const files = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory()) files.push(...(await walk(path)));
    else if (e.name !== "sw.js") files.push(path);
  }
  return files;
}
const files = (await walk("dist")).sort();
const hash = createHash("sha256");
for (const f of files) hash.update(await readFile(f));
const cache = `eclats-${hash.digest("hex").slice(0, 16)}`;
await writeFile(
  "dist/sw.js",
  `const CACHE=${JSON.stringify(cache)};
const FILES=${JSON.stringify(files.map((f) => "./" + f.slice(5)))};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))));
self.addEventListener('message', event => { if(event.data?.type === 'ACTIVATE') self.skipWaiting(); });
self.addEventListener('activate', event => event.waitUntil((async () => { for(const key of await caches.keys()) if(key.startsWith('eclats-') && key !== CACHE) await caches.delete(key); await self.clients.claim(); })()));
self.addEventListener('fetch', event => {
 const url = new URL(event.request.url);
 if(event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
 event.respondWith((async () => {
 const cache = await caches.open(CACHE);
 // Serve one coherent edition, including its story JSON, until explicit activation.
 const path = url.pathname.endsWith('/') ? new URL('index.html', self.registration.scope).href : url.href;
 const cached = await cache.match(path);
 if(cached) return cached;
 try { return await fetch(event.request); } catch(error) { if(event.request.mode === 'navigate') return await cache.match(new URL('index.html', self.registration.scope)); throw error; }
 })());
});
`,
);
console.log(`Offline edition: ${cache}, ${files.length} files`);
