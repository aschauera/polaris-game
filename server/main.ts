import process from 'node:process'
import { mkdirSync, chmodSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createApp } from './http.ts'

const port = Number(process.env.PORT ?? 4173)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.')
const production = process.env.NODE_ENV === 'production'
const origin = process.env.PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`
if (production && !origin.startsWith('https://')) throw new Error('Production requires an HTTPS PUBLIC_ORIGIN.')
const database = resolve(process.env.POLARIS_DB ?? '.polaris/matches.sqlite')
mkdirSync(dirname(database), { recursive: true, mode: 0o700 })
const app = createApp({ database, origin, staticRoot: resolve('dist'), secureCookies: production })
if (process.platform !== 'win32') chmodSync(database, 0o600)
app.server.listen(port, process.env.HOST ?? '127.0.0.1', () => {
  console.log(`Polaris listening on port ${port}; public origin ${origin}`)
})
app.server.on('error', error => { console.error('Server failed:', error); process.exitCode = 1; app.store.close() })
let stopping = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    void app.close().catch(error => { console.error('Shutdown failed:', error); process.exitCode = 1 })
  })
}
