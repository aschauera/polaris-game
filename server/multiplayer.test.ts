import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test, type TestContext } from 'node:test'
import { once } from 'node:events'
import { RoomStore, RequestError, ROOM_TTL, playerView } from './store.ts'
import { createApp } from './http.ts'
import { isOrder, isReply, isPlayerView, record, type OnlineOrder, type OnlineReply } from '../src/network/protocol.ts'
import { applyCommand, createExpedition, findPath, type Expedition } from '../src/game/expedition.ts'
import type { WorldMap } from '../src/game/map.ts'

function directory(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'polaris-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
function memory(t: TestContext) { const store = new RoomStore(':memory:'); t.after(() => store.close()); return store }
function view(reply: OnlineReply) { assert.ok(isReply(reply)); assert.ok(reply.view); return reply.view }
function order(revision: number): OnlineOrder { return { requestId: randomUUID(), revision, action: { type: 'end-turn' } } }
function rejected(status: number) { return (error: unknown) => error instanceof RequestError && error.status === status }
function players(store: RoomStore) {
  const host = store.connect().token, guest = store.connect().token
  const created = store.create(host)
  assert.ok(created.invite)
  store.join(guest, created.invite)
  return { host, guest, created }
}

test('private admission, invitation replacement, retry and no third seat', t => {
  const store = memory(t), host = store.connect().token, guest = store.connect().token
  const first = store.create(host)
  assert.equal(view(first).status, 'waiting')
  assert.deepEqual(view(store.create(host)), first.view)
  assert.throws(() => store.command(host, order(0)), rejected(409))
  assert.throws(() => store.join(host, first.invite!), rejected(409))
  const replacement = store.invite(host)
  assert.notEqual(replacement.invite, first.invite)
  assert.throws(() => store.join(guest, first.invite!), rejected(403))
  const joined = store.join(guest, replacement.invite!)
  assert.equal(view(joined).factionId, 'lantern')
  assert.equal(view(joined).revision, 1)
  assert.deepEqual(store.join(guest, replacement.invite!), joined)
  assert.throws(() => store.invite(host), rejected(409))
  const third = store.connect().token
  assert.throws(() => store.join(third, replacement.invite!), rejected(403))
  assert.throws(() => store.view('not-a-session'), rejected(401))
})

test('authoritative turns, movement budget, conflicts and canonical idempotency', t => {
  const store = memory(t), { host, guest } = players(store)
  const initial = view(store.view(host))
  assert.equal(initial.activeFaction, 'meridian')
  assert.deepEqual(view(store.view(guest)).moves, [])
  assert.throws(() => store.command(guest, order(1)), rejected(422))
  assert.equal(view(store.view(host)).revision, 1)
  const destination = initial.moves.find(move => move.tileId !== initial.scout.tileId)!
  assert.ok(destination)
  const move: OnlineOrder = { requestId: randomUUID(), revision: 1, action: { type: 'move', to: destination.tileId } }
  const moved = view(store.command(host, move))
  assert.equal(moved.scout.tileId, destination.tileId)
  assert.equal(moved.scout.movement, 4 - destination.cost)
  assert.deepEqual(view(store.command(host, { action: move.action, revision: 1, requestId: move.requestId })), moved)
  assert.throws(() => store.command(host, { ...move, action: { type: 'end-turn' } }), rejected(409))
  assert.throws(() => store.command(host, order(1)), rejected(409))
  assert.equal(view(store.command(host, order(2))).activeFaction, 'lantern')
  assert.throws(() => store.command(host, order(3)), rejected(422))
  const next = view(store.command(guest, order(3)))
  assert.equal(next.round, 2)
  assert.equal(view(store.view(host)).scout.movement, 4)
})

test('command receipts and sessions survive a real SQLite restart; corruption fails closed', t => {
  const file = join(directory(t), 'rooms.sqlite')
  let store = new RoomStore(file)
  const { host, guest } = players(store), accepted = order(1)
  store.command(host, accepted)
  const expected = store.view(host)
  store.close()
  store = new RoomStore(file)
  assert.deepEqual(store.view(host), expected)
  assert.deepEqual(view(store.command(host, accepted)), expected.view)
  assert.equal(view(store.command(guest, order(2))).round, 2)
  store.close()
  const db = new DatabaseSync(file)
  db.prepare('UPDATE rooms SET snapshot=?').run('{"schema":999}')
  db.close()
  store = new RoomStore(file)
  assert.throws(() => store.view(host), /Unsupported or corrupt/)
  store.close()
})

test('expiry and forgetting reserve occupied seats without recovery by invitation', t => {
  let now = 10000
  const store = new RoomStore(':memory:', () => now)
  t.after(() => store.close())
  const { host, guest, created } = players(store)
  store.forget(guest)
  assert.throws(() => store.view(guest), rejected(401))
  assert.throws(() => store.join(store.connect().token, created.invite!), rejected(403))
  now += ROOM_TTL + 1
  assert.throws(() => store.view(host), rejected(410))
  store.cleanup()
  assert.throws(() => store.view(host), rejected(401))
  assert.equal(store.connect(host).fresh, true)
})

test('unknown database schema is rejected without migration/reset', t => {
  const file = join(directory(t), 'future.sqlite')
  const db = new DatabaseSync(file)
  db.exec('PRAGMA user_version=9')
  db.close()
  assert.throws(() => new RoomStore(file), /Unsupported room database schema/)
  const incomplete = join(directory(t), 'incomplete.sqlite')
  const broken = new DatabaseSync(incomplete)
  broken.exec('PRAGMA user_version=1')
  broken.close()
  assert.throws(() => new RoomStore(incomplete), /incomplete room database/)
})

test('session, room and command capacities are enforced without partial admission', t => {
  const store = memory(t)
  for (let i = 0; i < 2048; i++) store.connect()
  assert.throws(() => store.connect(), rejected(503))
  const file = join(directory(t), 'limits.sqlite')
  let durable = new RoomStore(file)
  const { host } = players(durable)
  const roomId = view(durable.view(host)).roomId
  durable.close()
  const db = new DatabaseSync(file)
  const row = db.prepare('SELECT snapshot FROM rooms WHERE id=?').get(roomId)!
  assert.equal(typeof row.snapshot, 'string')
  const envelope: unknown = JSON.parse(String(row.snapshot))
  assert.ok(record(envelope))
  envelope.commands = Array.from({ length: 5000 }, (_, i) => ({
    type: 'end-turn', factionId: i % 2 ? 'lantern' : 'meridian', sequence: i + 1,
  }))
  db.prepare('UPDATE rooms SET snapshot=?,revision=5001 WHERE id=?').run(JSON.stringify(envelope), roomId)
  db.close()
  durable = new RoomStore(file)
  assert.throws(() => durable.command(host, order(5001)), rejected(409))
  assert.equal(view(durable.view(host)).revision, 5001)
  for (let i = 1; i < 128; i++) durable.create(durable.connect().token)
  const excess = durable.connect().token
  assert.throws(() => durable.create(excess), rejected(503))
  assert.equal(durable.view(excess).view, null)
  durable.close()
})

test('public HTTP and a statically exposed database are rejected at startup', () => {
  assert.throws(() => createApp({ database: ':memory:', origin: 'http://example.com' }), /HTTPS outside loopback/)
  assert.throws(() => createApp({ database: 'dist/rooms.sqlite', origin: 'https://example.com', staticRoot: 'dist' }), /outside the static root/)
})

test('visible-only movement cannot probe hidden occupancy; local charted rules remain intact', () => {
  const map: WorldMap = { seed: 'fixture', generatorVersion: 2, width: 24, height: 24, rngState: 42,
    tiles: Array.from({ length: 576 }, (_, id) => ({ id, x: id % 24, z: Math.floor(id / 24),
      terrain: 'grassland', elevation: 1, trees: 0 })) }
  const original = createExpedition(map, ['meridian', 'lantern'])
  const fixture = (enemy: number): Expedition => ({ ...original,
    factions: original.factions.map(faction => faction.id === 'meridian'
      ? { ...faction, fog: { 111: 'visible', 112: 'visible', 113: 'explored' } } : faction),
    scouts: original.scouts.map(scout => ({ ...scout, tileId: scout.factionId === 'meridian' ? 111 : enemy })) })
  const hiddenEnemy = fixture(113), otherEnemy = fixture(400)
  const room = { id: randomUUID(), revision: 1, status: 'active' as const }
  assert.deepEqual(playerView(room, hiddenEnemy, 'meridian'), playerView(room, otherEnemy, 'meridian'))
  assert.ok(findPath(otherEnemy, 'scout-meridian', 113))
  assert.equal(findPath(otherEnemy, 'scout-meridian', 113, 'visible'), undefined)
  const command = { type: 'move' as const, to: 113, unitId: 'scout-meridian', factionId: 'meridian' as const, sequence: 1 }
  const a = applyCommand(hiddenEnemy, command, 'visible'), b = applyCommand(otherEnemy, command, 'visible')
  assert.equal(a.ok, false); assert.equal(b.ok, false)
  if (!a.ok && !b.ok) assert.equal(a.reason, b.reason)
  assert.equal(a.state, hiddenEnemy); assert.equal(b.state, otherEnemy)
  const projected = playerView(room, otherEnemy, 'meridian')
  assert.equal(isPlayerView(projected), true)
  assert.equal(isPlayerView({ ...projected, seed: 'leaked' }), false)
  assert.equal(isPlayerView({ ...projected, visible: [575] }), false)
  assert.equal(isOrder({ ...order(1), factionId: 'lantern' }), false)
})

test('HTTP enforces origins, JSON, bounds, cookies, redaction and static boundaries', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'polaris-test-')), root = join(dir, 'public')
  mkdirSync(root)
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>Polaris</title>')
  writeFileSync(join(dir, 'private.html'), 'private')
  const origin = 'https://polaris.example'
  const app = createApp({ database: join(dir, 'rooms.sqlite'), origin, staticRoot: root })
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }) })
  const address = app.server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const send = (path: string, data = '{}', cookie = '', allowedOrigin = origin, contentType = 'application/json') =>
    fetch(`${base}${path}`, { method: 'POST', headers: { Origin: allowedOrigin, 'Content-Type': contentType, Cookie: cookie }, body: data })
  assert.equal((await send('/api/session', '{}', '', 'https://other.example')).status, 403)
  assert.equal((await send('/api/session', '{}', '', origin, 'text/plain')).status, 415)
  assert.equal((await send('/api/session', '{')).status, 400)
  assert.equal((await send('/api/session', 'x'.repeat(4097))).status, 413)
  assert.equal((await send('/api/session', '{"extra":1}')).status, 400)
  const response = await send('/api/session')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const cookie = response.headers.get('set-cookie')!
  for (const flag of ['HttpOnly', 'SameSite=Strict', 'Path=/api', 'Secure']) assert.ok(cookie.includes(flag))
  const room = await send('/api/rooms', '{}', cookie.split(';')[0]!)
  const value: unknown = await room.json()
  assert.ok(isReply(value))
  const projection = view(value)
  assert.ok(projection.tiles.length < 576)
  assert.equal(projection.opponents.length, 0)
  for (const secret of ['seed', 'rngState', 'commands', 'snapshot', 'inviteHash']) assert.ok(!JSON.stringify(projection).includes(`"${secret}"`))
  assert.equal((await fetch(`${base}/api/session`)).status, 401)
  assert.equal((await fetch(`${base}/`)).status, 200)
  assert.equal((await fetch(`${base}/%2e%2e%2fprivate.html`)).status, 404)
  assert.equal((await fetch(`${base}/rooms.sqlite`)).status, 404)
  assert.equal((await fetch(`${base}/server/store.ts`)).status, 404)
  assert.equal((await fetch(`${base}/manifest.webmanifest`)).status, 404)
  const forbidden = await send('/api/commands', JSON.stringify({ ...order(0), factionId: 'lantern' }), cookie.split(';')[0]!)
  assert.equal(forbidden.status, 400)
  let limited = false
  for (let i = 0; i < 240; i++) {
    const poll = await fetch(`${base}/api/session`, { headers: { Cookie: cookie.split(';')[0]! } })
    await poll.text()
    if (poll.status === 429) { assert.equal(poll.headers.get('retry-after'), '60'); limited = true; break }
  }
  assert.ok(limited, 'The bounded request limiter must reject excess requests.')
})

test('concurrent HTTP orders on one revision accept at most one', async t => {
  const origin = 'http://127.0.0.1', app = createApp({ database: ':memory:', origin })
  const { host } = players(app.store)
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  t.after(() => app.close())
  const address = app.server.address()
  assert.ok(address && typeof address !== 'string')
  const submit = () => fetch(`http://127.0.0.1:${address.port}/api/commands`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: `polaris_session=${host}` },
    body: JSON.stringify(order(1)),
  })
  const results = await Promise.all([submit(), submit()])
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409])
  assert.equal(view(app.store.view(host)).revision, 2)
})
