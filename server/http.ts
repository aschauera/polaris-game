import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, realpath } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { RoomStore, RequestError, SESSION_TTL } from './store.ts'
import { isOrder, keys, record } from '../src/network/protocol.ts'

interface ServerOptions { database: string; origin: string; staticRoot?: string }
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
}
function token(request: IncomingMessage): string {
  const found = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('polaris_session='))
  const value = found?.slice('polaris_session='.length) ?? ''
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : ''
}
function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(body))
}
async function body(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
    throw new RequestError(415, 'Use application/json.')
  }
  if (Number(request.headers['content-length'] ?? 0) > 4096) throw new RequestError(413, 'Request body is too large.')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > 4096) throw new RequestError(413, 'Request body is too large.')
    chunks.push(bytes)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new RequestError(400, 'Invalid JSON body.') }
}

export function createApp(options: ServerOptions) {
  const parsedOrigin = new URL(options.origin)
  const origin = parsedOrigin.origin
  if (origin !== options.origin) throw new Error('PUBLIC_ORIGIN must be an origin without path or trailing slash.')
  const secureCookies = parsedOrigin.protocol === 'https:'
  if (!secureCookies && (parsedOrigin.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(parsedOrigin.hostname))) {
    throw new Error('PUBLIC_ORIGIN requires HTTPS outside loopback development.')
  }
  if (options.staticRoot && options.database !== ':memory:') {
    const databasePath = relative(resolve(options.staticRoot), resolve(options.database))
    if (databasePath !== '..' && !databasePath.startsWith(`..${sep}`) && !isAbsolute(databasePath)) {
      throw new Error('The database must be outside the static root.')
    }
  }
  const store = new RoomStore(options.database)
  const rates = new Map<string, { count: number; until: number }>()
  const cleanup = setInterval(() => {
    try { store.cleanup() } catch (error) { console.error('Room cleanup failed:', error) }
    for (const [key, value] of rates) if (value.until < Date.now()) rates.delete(key)
  }, 60_000)
  cleanup.unref()

  const server = createServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
    if (secureCookies) response.setHeader('Strict-Transport-Security', 'max-age=31536000')
    void handle(request, response).catch((error: unknown) => {
      if (response.writableEnded || response.destroyed) return
      if (error instanceof RequestError) json(response, error.status, { error: error.message })
      else { console.error('Request failed:', error); json(response, 500, { error: 'Server could not process the request.' }) }
    })
  })
  server.requestTimeout = 10_000
  server.headersTimeout = 10_000
  server.maxRequestsPerSocket = 100

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', origin)
    const path = url.pathname
    if (path === '/health' && request.method === 'GET') { json(response, 200, { status: 'ok' }); return }
    if (!path.startsWith('/api/')) { await serveStatic(path, request, response); return }
    const ip = request.socket.remoteAddress ?? 'unknown'
    let rate = rates.get(ip)
    if (!rate || rate.until <= Date.now()) {
      if (!rate && rates.size >= 1024) throw new RequestError(503, 'Request capacity reached.')
      rate = { count: 0, until: Date.now() + 60_000 }
      rates.set(ip, rate)
    }
    if (++rate.count > 240) { response.setHeader('Retry-After', '60'); throw new RequestError(429, 'Too many requests. Wait a minute.') }
    const credential = token(request)
    if (request.method === 'GET' && path === '/api/session') { json(response, 200, store.view(credential)); return }
    if (request.headers.origin !== origin) throw new RequestError(403, 'Cross-origin orders are not allowed.')
    if (request.method === 'DELETE' && path === '/api/session') {
      store.forget(credential)
      response.setHeader('Set-Cookie', `polaris_session=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secureCookies ? '; Secure' : ''}`)
      json(response, 200, { view: null }); return
    }
    if (request.method !== 'POST') throw new RequestError(405, 'Method not allowed.')
    const data = await body(request)
    if (['/api/session', '/api/rooms', '/api/invite'].includes(path)) {
      if (!record(data) || !keys(data, [])) throw new RequestError(400, 'This endpoint expects an empty object.')
      if (path === '/api/session') {
        const session = store.connect(credential)
        if (session.fresh) response.setHeader('Set-Cookie',
          `polaris_session=${session.token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}${secureCookies ? '; Secure' : ''}`)
        json(response, 200, store.view(session.token)); return
      }
      json(response, 200, path === '/api/rooms' ? store.create(credential) : store.invite(credential)); return
    }
    if (path === '/api/join') {
      if (!record(data) || !keys(data, ['invite']) || typeof data.invite !== 'string') throw new RequestError(400, 'Enter an invitation code.')
      json(response, 200, store.join(credential, data.invite)); return
    }
    if (path === '/api/commands') {
      if (!isOrder(data)) throw new RequestError(400, 'Invalid command payload.')
      json(response, 200, store.command(credential, data)); return
    }
    throw new RequestError(404, 'Unknown endpoint.')
  }

  async function serveStatic(path: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    if ((request.method !== 'GET' && request.method !== 'HEAD') || !options.staticRoot) throw new RequestError(404, 'Not found.')
    let decoded: string
    try { decoded = decodeURIComponent(path) } catch { throw new RequestError(400, 'Invalid path.') }
    const root = resolve(options.staticRoot)
    const file = resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`)
    const within = (value: string) => {
      const rel = relative(root, value)
      return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
    }
    const mime = MIME[extname(file)]
    if (!within(file) || !mime) throw new RequestError(404, 'Not found.')
    let content: Buffer
    try {
      if (!within(await realpath(file))) throw new RequestError(404, 'Not found.')
      content = await readFile(file)
    } catch (error) {
      if (record(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EISDIR')) {
        throw new RequestError(404, 'Not found.')
      }
      throw error
    }
    response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' })
    response.end(request.method === 'HEAD' ? undefined : content)
  }

  return { server, store, close: async () => {
    clearInterval(cleanup)
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    store.close()
  } }
}
