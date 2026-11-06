import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { applyCommand, createExpedition, movementRange, type Expedition, type FactionId } from '../src/game/expedition.ts'
import { generateMap } from '../src/game/map.ts'
import { INVITE, isOrder, keys, record, type OnlineOrder, type OnlineReply, type PlayerView } from '../src/network/protocol.ts'

export const ROOM_TTL = 7 * 24 * 60 * 60 * 1000
export const SESSION_TTL = 30 * 24 * 60 * 60 * 1000
export class RequestError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
interface Room { id: string; snapshot: string; revision: number; status: 'waiting' | 'active'; inviteHash: string | null }
interface Member { roomId: string | null; factionId: FactionId | null }
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export function playerView(room: Pick<Room, 'id' | 'revision' | 'status'>, state: Expedition, factionId: FactionId): PlayerView {
  const faction = state.factions.find(faction => faction.id === factionId)!
  const scout = state.scouts.find(unit => unit.factionId === factionId)!
  const visible = Object.keys(faction.fog).map(Number).filter(id => faction.fog[id] === 'visible')
  return {
    protocol: 1, roomId: room.id, revision: room.revision, status: room.status, factionId,
    activeFaction: state.activeFaction, round: state.round, width: 24, height: 24, scout,
    tiles: state.map.tiles.filter(tile => faction.fog[tile.id]),
    visible, opponents: state.scouts.filter(unit => unit.factionId !== factionId && faction.fog[unit.tileId] === 'visible'),
    moves: room.status === 'active' ? [...movementRange(state, scout.id, 'visible')].map(([tileId, cost]) => ({ tileId, cost })) : [],
  }
}

function snapshot(state: Expedition): string {
  return JSON.stringify({ schema: 1, generator: 2, rules: 1,
    seed: state.map.seed, commands: state.commands })
}

function restore(serialized: string): Expedition {
  const data: unknown = JSON.parse(serialized)
  if (!record(data) || !keys(data, ['schema', 'generator', 'rules', 'seed', 'commands']) ||
    data.schema !== 1 || data.generator !== 2 || data.rules !== 1 || typeof data.seed !== 'string' ||
    !Array.isArray(data.commands) || data.commands.length > 5000) throw new Error('Unsupported or corrupt stored room.')
  let state = createExpedition(generateMap({ seed: data.seed, width: 24, height: 24 }), ['meridian', 'lantern'])
  for (const command of data.commands) {
    if (!record(command) || command.factionId !== state.activeFaction || command.sequence !== state.commands.length + 1) {
      throw new Error('Corrupt stored command identity or sequence.')
    }
    if (!keys(command, command.type === 'end-turn' ? ['type', 'factionId', 'sequence']
      : ['type', 'factionId', 'sequence', 'unitId', 'to'])) throw new Error('Corrupt stored command shape.')
    const scout = state.scouts.find(unit => unit.factionId === state.activeFaction)!
    const action = command.type === 'end-turn' ? { type: 'end-turn' } : { type: command.type, to: command.to }
    if (!isOrder({ requestId: '00000000-0000-4000-8000-000000000000', revision: 0, action }) ||
      (command.type === 'move' && command.unitId !== scout.id)) throw new Error('Corrupt stored command.')
    const result = command.type === 'end-turn'
      ? applyCommand(state, { type: 'end-turn', factionId: state.activeFaction, sequence: state.commands.length + 1 }, 'visible')
      : applyCommand(state, { type: 'move', unitId: scout.id, to: Number(command.to),
        factionId: state.activeFaction, sequence: state.commands.length + 1 }, 'visible')
    if (!result.ok) throw new Error(`Stored room failed deterministic replay: ${result.reason}`)
    state = result.state
  }
  return state
}

export class RoomStore {
  private readonly db: DatabaseSync
  private readonly cache = new Map<string, { revision: number; state: Expedition }>()
  private readonly now: () => number

  constructor(path: string, now: () => number = Date.now) {
    this.now = now
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;')
    const version = this.db.prepare('PRAGMA user_version').get()?.user_version
    if (version !== 0 && version !== 1) { this.db.close(); throw new Error('Unsupported room database schema.') }
    const tables = this.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    if ((version === 0 && tables.length !== 0) || (version === 1 && tables.map(row => row.name).join(',') !== 'receipts,rooms,sessions')) {
      this.db.close()
      throw new Error('Unrecognized or incomplete room database schema.')
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY, snapshot TEXT NOT NULL, revision INTEGER NOT NULL,
        status TEXT NOT NULL, inviteHash TEXT, expires INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS sessions (
        hash TEXT PRIMARY KEY, roomId TEXT REFERENCES rooms(id) ON DELETE CASCADE,
        factionId TEXT, expires INTEGER NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS occupied_seat ON sessions(roomId, factionId);
      CREATE TABLE IF NOT EXISTS receipts (
        roomId TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, factionId TEXT NOT NULL,
        requestId TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(roomId, factionId, requestId)
      ) STRICT;
      PRAGMA user_version=1;
    `)
    this.cleanup()
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = operation(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); this.cache.clear(); throw error }
  }

  private member(token: string): Member {
    const row = this.db.prepare('SELECT roomId, factionId FROM sessions WHERE hash=? AND expires>?').get(hash(token), this.now())
    if (!row) throw new RequestError(401, 'Session expired. Connect again.')
    if ((row.roomId !== null && typeof row.roomId !== 'string') ||
      (row.factionId !== null && row.factionId !== 'meridian' && row.factionId !== 'lantern') ||
      ((row.roomId === null) !== (row.factionId === null))) throw new Error('Corrupt session.')
    return { roomId: row.roomId, factionId: row.factionId }
  }

  private room(id: string): Room {
    const row = this.db.prepare('SELECT id,snapshot,revision,status,inviteHash FROM rooms WHERE id=? AND expires>?').get(id, this.now())
    if (!row) throw new RequestError(410, 'This room expired. Forget this session to start again.')
    if (typeof row.id !== 'string' || typeof row.snapshot !== 'string' || typeof row.revision !== 'number' ||
      (row.status !== 'waiting' && row.status !== 'active') ||
      (row.status === 'waiting' ? typeof row.inviteHash !== 'string' || !/^[0-9a-f]{64}$/.test(row.inviteHash)
        : row.inviteHash !== null)) throw new Error('Corrupt room record.')
    return { id: row.id, snapshot: row.snapshot, revision: row.revision, status: row.status, inviteHash: row.inviteHash }
  }

  private state(room: Room): Expedition {
    const cached = this.cache.get(room.id)
    if (cached?.revision === room.revision) return cached.state
    const state = restore(room.snapshot)
    if (room.revision !== state.commands.length + Number(room.status === 'active') ||
      (room.status === 'waiting' && state.commands.length !== 0)) throw new Error('Stored revision does not match history.')
    this.cache.set(room.id, { revision: room.revision, state })
    return state
  }

  connect(token?: string): { token: string; fresh: boolean } {
    if (token) {
      try { this.member(token); return { token, fresh: false } }
      catch (error) { if (!(error instanceof RequestError) || error.status !== 401) throw error }
    }
    this.cleanup()
    const count = this.db.prepare('SELECT count(*) AS count FROM sessions').get()!.count
    if (Number(count) >= 2048) throw new RequestError(503, 'Session capacity reached. Try later.')
    const next = randomBytes(32).toString('base64url')
    this.db.prepare('INSERT INTO sessions(hash,expires) VALUES (?,?)').run(hash(next), this.now() + SESSION_TTL)
    return { token: next, fresh: true }
  }

  view(token: string): OnlineReply {
    const member = this.member(token)
    if (!member.roomId || !member.factionId) return { view: null }
    const room = this.room(member.roomId)
    return { view: playerView(room, this.state(room), member.factionId) }
  }

  create(token: string): OnlineReply {
    return this.transaction(() => {
      const member = this.member(token)
      if (member.roomId) return this.view(token)
      if (Number(this.db.prepare('SELECT count(*) AS count FROM rooms').get()!.count) >= 128) {
        throw new RequestError(503, 'Room capacity reached. Try later.')
      }
      const state = createExpedition(generateMap({ seed: randomBytes(16).toString('hex'), width: 24, height: 24 }),
        ['meridian', 'lantern'])
      const id = randomUUID(), secret = randomBytes(24).toString('base64url')
      const room: Room = { id, snapshot: snapshot(state), revision: 0, status: 'waiting', inviteHash: hash(secret) }
      this.db.prepare('INSERT INTO rooms VALUES (?,?,?,?,?,?)')
        .run(id, room.snapshot, 0, 'waiting', room.inviteHash, this.now() + ROOM_TTL)
      this.db.prepare('UPDATE sessions SET roomId=?,factionId=? WHERE hash=?').run(id, 'meridian', hash(token))
      this.cache.set(id, { revision: 0, state })
      return { view: playerView(room, state, 'meridian'), invite: `${id}.${secret}` }
    })
  }

  invite(token: string): OnlineReply {
    return this.transaction(() => {
      const member = this.member(token)
      if (!member.roomId || member.factionId !== 'meridian') throw new RequestError(403, 'Only the waiting host can replace an invitation.')
      const room = this.room(member.roomId)
      if (room.status !== 'waiting') throw new RequestError(409, 'Both seats are already occupied.')
      const secret = randomBytes(24).toString('base64url')
      this.db.prepare('UPDATE rooms SET inviteHash=? WHERE id=?').run(hash(secret), room.id)
      return { ...this.view(token), invite: `${room.id}.${secret}` }
    })
  }

  join(token: string, invitation: string): OnlineReply {
    if (!INVITE.test(invitation)) throw new RequestError(400, 'Enter a valid invitation code.')
    return this.transaction(() => {
      const member = this.member(token)
      const [id, secret] = invitation.split('.')
      if (member.roomId) {
        if (member.roomId === id && member.factionId === 'lantern') return this.view(token)
        throw new RequestError(409, 'This browser already has a seat. Use another device or forget its current session.')
      }
      const room = this.room(id!)
      if (!room.inviteHash || room.status !== 'waiting' ||
        !timingSafeEqual(Buffer.from(room.inviteHash, 'hex'), Buffer.from(hash(secret!), 'hex'))) {
        throw new RequestError(403, 'Invitation is invalid, replaced, or already used.')
      }
      this.db.prepare('UPDATE rooms SET status=?,inviteHash=NULL,revision=revision+1,expires=? WHERE id=?')
        .run('active', this.now() + ROOM_TTL, room.id)
      this.db.prepare('UPDATE sessions SET roomId=?,factionId=? WHERE hash=?').run(room.id, 'lantern', hash(token))
      return this.view(token)
    })
  }

  command(token: string, order: OnlineOrder): OnlineReply {
    if (!isOrder(order)) throw new RequestError(400, 'Invalid command payload.')
    return this.transaction(() => {
      const member = this.member(token)
      if (!member.roomId || !member.factionId) throw new RequestError(403, 'Join a room before issuing orders.')
      const room = this.room(member.roomId)
      if (room.status !== 'active') throw new RequestError(409, 'Waiting for the second player.')
      const payload = JSON.stringify({ revision: order.revision, action: order.action.type === 'move'
        ? { type: 'move', to: order.action.to } : { type: 'end-turn' } })
      const receipt = this.db.prepare('SELECT payload FROM receipts WHERE roomId=? AND factionId=? AND requestId=?')
        .get(room.id, member.factionId, order.requestId)
      if (receipt) {
        if (receipt.payload !== payload) throw new RequestError(409, 'Request ID was reused for a different order.')
        return { ...this.view(token), message: 'Order already applied. State synchronized.' }
      }
      if (order.revision !== room.revision) throw new RequestError(409, 'The room changed. Refresh before choosing a new order.')
      const state = this.state(room)
      if (state.commands.length >= 5000) throw new RequestError(409, 'This preview match has reached its 5,000-command limit.')
      const scout = state.scouts.find(unit => unit.factionId === member.factionId)!
      const common = { factionId: member.factionId, sequence: state.commands.length + 1 }
      const result = applyCommand(state, order.action.type === 'end-turn' ? { ...common, type: 'end-turn' }
        : { ...common, type: 'move', unitId: scout.id, to: order.action.to }, 'visible')
      if (!result.ok) throw new RequestError(422, result.reason)
      const updated = this.db.prepare('UPDATE rooms SET snapshot=?,revision=revision+1,expires=? WHERE id=? AND revision=?')
        .run(snapshot(result.state), this.now() + ROOM_TTL, room.id, room.revision)
      if (updated.changes !== 1) throw new RequestError(409, 'The room changed. Refresh and retry.')
      this.db.prepare('INSERT INTO receipts VALUES (?,?,?,?)').run(room.id, member.factionId, order.requestId, payload)
      this.cache.set(room.id, { revision: room.revision + 1, state: result.state })
      return { ...this.view(token), message: result.message }
    })
  }

  forget(token: string): void {
    // Keep an occupied seat reserved: forgetting a cookie must not create another invitation.
    this.db.prepare('UPDATE sessions SET expires=? WHERE hash=?').run(this.now(), hash(token))
  }
  cleanup(): void {
    this.db.prepare('DELETE FROM rooms WHERE expires<=?').run(this.now())
    this.db.prepare('DELETE FROM sessions WHERE roomId IS NULL AND expires<=?').run(this.now())
    this.cache.clear()
  }
  close(): void { this.cache.clear(); this.db.close() }
}
