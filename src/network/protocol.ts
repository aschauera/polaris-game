import type { FactionId, Scout } from '../game/expedition'
import type { Tile } from '../game/map'

export const PROTOCOL_VERSION = 1
export type OnlineAction = { type: 'move'; to: number } | { type: 'end-turn' }
export interface OnlineOrder { requestId: string; revision: number; action: OnlineAction }
export interface PlayerView {
  protocol: 1
  roomId: string
  revision: number
  status: 'waiting' | 'active'
  factionId: FactionId
  activeFaction: FactionId
  round: number
  width: 24
  height: 24
  scout: Scout
  tiles: readonly Tile[]
  visible: readonly number[]
  opponents: readonly Scout[]
  moves: readonly { tileId: number; cost: number }[]
}
export interface OnlineReply { view: PlayerView | null; message?: string; invite?: string }
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const INVITE = /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{32}$/

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key))
}
export function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
}
function faction(value: unknown): value is FactionId { return value === 'meridian' || value === 'lantern' }
function scout(value: unknown): value is Scout {
  return record(value) && keys(value, ['id', 'factionId', 'tileId', 'movement']) &&
    typeof value.id === 'string' && faction(value.factionId) &&
    value.id === `scout-${value.factionId}` && integer(value.tileId, 0, 575) && integer(value.movement, 0, 4)
}
function tile(value: unknown): value is Tile {
  return record(value) && keys(value, ['id', 'x', 'z', 'terrain', 'elevation', 'trees']) &&
    integer(value.id, 0, 575) && value.x === value.id % 24 && value.z === Math.floor(value.id / 24) &&
    (value.terrain === 'water' ? value.elevation === 0 && value.trees === 0
      : (value.terrain === 'grassland' || value.terrain === 'hills') && integer(value.elevation, 1, 4) && integer(value.trees, 0, 3))
}
export function isOrder(value: unknown): value is OnlineOrder {
  if (!record(value) || !keys(value, ['requestId', 'revision', 'action']) ||
    typeof value.requestId !== 'string' || !UUID.test(value.requestId) ||
    !integer(value.revision, 0, 5001) || !record(value.action)) return false
  return value.action.type === 'end-turn' ? keys(value.action, ['type'])
    : value.action.type === 'move' && keys(value.action, ['type', 'to']) && integer(value.action.to, 0, 575)
}
export function isPlayerView(value: unknown): value is PlayerView {
  if (!record(value) || !keys(value, ['protocol', 'roomId', 'revision', 'status', 'factionId', 'activeFaction',
    'round', 'width', 'height', 'scout', 'tiles', 'visible', 'opponents', 'moves']) ||
    value.protocol !== PROTOCOL_VERSION || typeof value.roomId !== 'string' || !UUID.test(value.roomId) ||
    !integer(value.revision, 0, 5001) || (value.status !== 'waiting' && value.status !== 'active') ||
    !faction(value.factionId) || !faction(value.activeFaction) || !integer(value.round, 1, 5001) ||
    value.width !== 24 || value.height !== 24 || !scout(value.scout) || value.scout.factionId !== value.factionId ||
    !Array.isArray(value.tiles) || value.tiles.length > 576 || !value.tiles.every(tile) ||
    !Array.isArray(value.visible) || value.visible.length > 576 || !value.visible.every(id => integer(id, 0, 575)) ||
    !Array.isArray(value.opponents) || value.opponents.length > 1 || !value.opponents.every(scout) ||
    !Array.isArray(value.moves) || value.moves.length > 576 ||
    !value.moves.every(move => record(move) && integer(move.tileId, 0, 575) && integer(move.cost, 0, 4))) return false
  const known = new Set(value.tiles.map(tile => tile.id))
  const visible = new Set(value.visible)
  return known.size === value.tiles.length && visible.size === value.visible.length &&
    value.visible.every(id => known.has(id)) && known.has(value.scout.tileId) && visible.has(value.scout.tileId) &&
    value.opponents.every(unit => unit.factionId !== value.factionId && visible.has(unit.tileId)) &&
    value.moves.every(move => visible.has(move.tileId))
}
export function isReply(value: unknown): value is OnlineReply {
  return record(value) && Object.keys(value).every(key => ['view', 'message', 'invite'].includes(key)) &&
    (value.view === null || isPlayerView(value.view)) &&
    (value.message === undefined || typeof value.message === 'string') &&
    (value.invite === undefined || (typeof value.invite === 'string' && INVITE.test(value.invite)))
}
