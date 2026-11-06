import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

function chunk(type: string, data: Buffer): Buffer {
  const content = Buffer.concat([Buffer.from(type), data])
  let crc = 0xffffffff
  for (const byte of content) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  const head = Buffer.alloc(4), tail = Buffer.alloc(4)
  head.writeUInt32BE(data.length)
  tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([head, content, tail])
}
for (const size of [180, 192, 512]) {
  const pixels = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const star = Math.pow(Math.abs(x - size / 2) / (size * 0.32), 0.55) +
        Math.pow(Math.abs(y - size / 2) / (size * 0.32), 0.55) <= 1
      pixels.set(star ? [240, 200, 115, 255] : [18, 39, 51, 255], y * (size * 4 + 1) + 1 + x * 4)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4)
  header[8] = 8; header[9] = 6
  await writeFile(join('dist', `icon-${size}.png`), Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
  ]))
}
const files = (await readdir('dist', { recursive: true, withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name !== 'sw.js')
  .map(entry => join(entry.parentPath, entry.name)).sort()
const hash = createHash('sha256')
for (const file of files) { hash.update(file.replaceAll('\\', '/')); hash.update(await readFile(file)) }
const urls = files.map(file => `/${file.replaceAll('\\', '/').replace(/^dist\//, '')}`)
const worker = `
const CACHE = 'polaris-shell-${hash.digest('hex').slice(0, 16)}';
const FILES = ${JSON.stringify(urls)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('polaris-shell-') && key !== CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin ||
      url.pathname.startsWith('/api/') || url.pathname === '/health') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => {
      const shell = await caches.match('/index.html', { cacheName: CACHE });
      return shell || Response.error();
    }));
  } else if (FILES.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async cache =>
      (await cache.match(url.pathname)) || fetch(event.request)));
  }
});
`
await writeFile(join('dist', 'sw.js'), worker)
console.log(`Built offline shell with ${urls.length} static assets.`)
