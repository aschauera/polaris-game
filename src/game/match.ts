import { generateMap, type MapConfig, type WorldMap } from './map'
import {
  applyCommand, createExpedition, FACTIONS, PRODUCTION_ITEMS, RULES_VERSION,
  type Command, type Expedition, type FactionId, type ProductionItemId,
} from './expedition'

export const MATCH_FORMAT = 1
export const MATCH_FACTIONS: readonly FactionId[] = Object.freeze(['meridian', 'lantern'])
export const MATCH_LIMITS = Object.freeze({ commands: 10_000, text: 64 })

// Sequence numbers and factions are implied by the replay, so the transport form keeps only the order itself.
export type CompactCommand =
  | readonly ['m', string, number]
  | readonly ['f', string]
  | readonly ['q', string, ProductionItemId]
  | readonly ['e']

export interface MatchPackage {
  readonly format: typeof MATCH_FORMAT
  readonly matchId: string
  readonly rules: number
  readonly generator: number
  readonly seed: string
  readonly width: number
  readonly height: number
  readonly factions: readonly FactionId[]
  readonly commands: readonly CompactCommand[]
  readonly mapHash: string
  readonly stateHash: string
}

type Failure = { readonly ok: false; readonly reason: string }
export type OpenResult =
  | { readonly ok: true; readonly state: Expedition; readonly matchId: string; readonly commands: readonly CompactCommand[] }
  | Failure
export interface LocalMatch {
  readonly matchId: string
  readonly faction: FactionId
  readonly commands: readonly CompactCommand[]
}
export type ReceiveResult =
  | { readonly ok: true; readonly state: Expedition; readonly matchId: string; readonly faction: FactionId; readonly newOrders: number }
  | { readonly ok: false; readonly kind: 'invalid' | 'known' | 'other-match'; readonly reason: string }

const MATCH_ID = /^[A-Za-z0-9_-]{8,64}$/
const CHECKSUM = /^[0-9a-f]{14}$/

// Non-cryptographic 53-bit checksum (cyrb53 family) built from integer operations only. It detects
// accidental divergence between devices; it is not a security boundary.
function checksum(text: string): string {
  let a = 0xdeadbeef
  let b = 0x41c6ce57
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    a = Math.imul(a ^ code, 2654435761)
    b = Math.imul(b ^ code, 1597334677)
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507)
  a ^= Math.imul(b ^ (b >>> 13), 3266489909)
  b = Math.imul(b ^ (b >>> 16), 2246822507)
  b ^= Math.imul(a ^ (a >>> 13), 3266489909)
  return ((b & 0x1fffff) * 4294967296 + (a >>> 0)).toString(16).padStart(14, '0')
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).filter(key => record[key] !== undefined).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

const mapHashes = new WeakMap<WorldMap, string>()

export function mapHash(map: WorldMap): string {
  const known = mapHashes.get(map)
  if (known) return known
  let text = `${map.generatorVersion}:${map.seed}:${map.width}x${map.height}:${map.rngState}|`
  for (const tile of map.tiles) text += `${tile.terrain[0]}${tile.elevation}${tile.trees},`
  const hash = checksum(text)
  mapHashes.set(map, hash)
  return hash
}

export function stateHash(state: Expedition): string {
  return checksum(canonical({
    rules: state.rulesVersion, rng: state.rngState, round: state.round, active: state.activeFaction,
    factions: state.factions, scouts: state.scouts, founders: state.founders, units: state.units,
    cities: state.cities, nextCityId: state.nextCityId, nextUnitId: state.nextUnitId,
    commands: state.commands.length,
  }))
}

export function compactCommand(command: Command): CompactCommand {
  switch (command.type) {
    case 'move': return ['m', command.unitId, command.to]
    case 'found-city': return ['f', command.founderId]
    case 'queue-production': return ['q', command.cityId, command.itemId]
    case 'end-turn': return ['e']
  }
}

function toCommand(compact: CompactCommand, state: Expedition): Command {
  const order = { factionId: state.activeFaction, sequence: state.commands.length + 1 }
  switch (compact[0]) {
    case 'm': return { ...order, type: 'move', unitId: compact[1], to: compact[2] }
    case 'f': return { ...order, type: 'found-city', founderId: compact[1] }
    case 'q': return { ...order, type: 'queue-production', cityId: compact[1], itemId: compact[2] }
    case 'e': return { ...order, type: 'end-turn' }
  }
}

function sameCommand(left: CompactCommand, right: CompactCommand): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function readCommand(value: unknown): CompactCommand | undefined {
  if (!Array.isArray(value)) return
  const [kind, first, second] = value as unknown[]
  const text = (item: unknown): item is string =>
    typeof item === 'string' && item.length >= 1 && item.length <= MATCH_LIMITS.text
  if (kind === 'e' && value.length === 1) return ['e']
  if (kind === 'f' && value.length === 2 && text(first)) return ['f', first]
  if (kind === 'm' && value.length === 3 && text(first) && Number.isInteger(second)) return ['m', first, second as number]
  if (kind === 'q' && value.length === 3 && text(first) && typeof second === 'string' &&
    Object.hasOwn(PRODUCTION_ITEMS, second)) return ['q', first, second as ProductionItemId]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseMatch(input: unknown): { readonly ok: true; readonly value: MatchPackage } | Failure {
  const fail = (reason: string): Failure => ({ ok: false, reason })
  if (!isRecord(input) || input.format !== MATCH_FORMAT) {
    return fail('This is not a Polaris turn, or it was made by a newer version of the game.')
  }
  if (input.rules !== RULES_VERSION) {
    return fail(`This turn uses game rules ${String(input.rules)}, but your copy uses ${RULES_VERSION}. Both players need the same version of Polaris.`)
  }
  const { matchId, seed, width, height, factions, commands, mapHash: world, stateHash: result, generator } = input
  if (typeof matchId !== 'string' || !MATCH_ID.test(matchId)) return fail('The turn has no valid match identifier.')
  if (typeof seed !== 'string' || typeof width !== 'number' || typeof height !== 'number' || typeof generator !== 'number') {
    return fail('The turn does not describe a world.')
  }
  if (!Array.isArray(factions) || factions.length !== MATCH_FACTIONS.length ||
    !MATCH_FACTIONS.every((id, index) => factions[index] === id)) {
    return fail('The turn names factions that this version of Polaris cannot play.')
  }
  if (!Array.isArray(commands) || commands.length > MATCH_LIMITS.commands) {
    return fail(`The turn history is missing or longer than ${MATCH_LIMITS.commands} orders.`)
  }
  const orders: CompactCommand[] = []
  for (const [index, raw] of commands.entries()) {
    const order = readCommand(raw)
    if (!order) return fail(`Order ${index + 1} is not a Polaris order.`)
    orders.push(order)
  }
  if (typeof world !== 'string' || !CHECKSUM.test(world) || typeof result !== 'string' || !CHECKSUM.test(result)) {
    return fail('The turn has no valid checksums.')
  }
  return { ok: true, value: Object.freeze({
    format: MATCH_FORMAT, matchId, rules: RULES_VERSION, generator, seed, width, height,
    factions: MATCH_FACTIONS, commands: Object.freeze(orders), mapHash: world, stateHash: result,
  }) }
}

export function createMatch(config: MapConfig): Expedition {
  return createExpedition(generateMap(config), MATCH_FACTIONS)
}

export function exportMatch(matchId: string, state: Expedition): MatchPackage {
  return Object.freeze({
    format: MATCH_FORMAT, matchId, rules: state.rulesVersion, generator: state.map.generatorVersion,
    seed: state.map.seed, width: state.map.width, height: state.map.height,
    factions: Object.freeze(state.factions.map(faction => faction.id)),
    commands: Object.freeze(state.commands.map(compactCommand)),
    mapHash: mapHash(state.map), stateHash: stateHash(state),
  })
}

// Rebuilds the match from its seed and orders, so nothing but the opponent's orders is ever trusted.
export function openMatch(input: unknown): OpenResult {
  const parsed = parseMatch(input)
  if (!parsed.ok) return parsed
  const pkg = parsed.value
  let state: Expedition
  try {
    const map = generateMap({ seed: pkg.seed, width: pkg.width, height: pkg.height })
    if (map.generatorVersion !== pkg.generator) {
      return { ok: false, reason: `This turn uses world generator ${pkg.generator}, but your copy uses ${map.generatorVersion}. Both players need the same version of Polaris.` }
    }
    if (mapHash(map) !== pkg.mapHash) {
      return { ok: false, reason: 'This device builds a different world from the same seed, so the match cannot stay in sync. Start a new match with another seed.' }
    }
    state = createExpedition(map, pkg.factions)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'This match cannot be set up.' }
  }
  for (const [index, order] of pkg.commands.entries()) {
    const result = applyCommand(state, toCommand(order, state))
    if (!result.ok) return { ok: false, reason: `Order ${index + 1} was rejected: ${result.reason}` }
    state = result.state
  }
  if (stateHash(state) !== pkg.stateHash) {
    return { ok: false, reason: 'Replaying this turn ended differently than on your opponent\'s device. The match cannot stay in sync.' }
  }
  return { ok: true, state, matchId: pkg.matchId, commands: pkg.commands }
}

// A received turn must be a finished one that extends what this device already knows, and must not
// contain orders for the receiving faction: those can only come from the receiver's own device.
export function receiveTurn(input: unknown, local?: LocalMatch): ReceiveResult {
  const invalid = (reason: string): ReceiveResult => ({ ok: false, kind: 'invalid', reason })
  const opened = openMatch(input)
  if (!opened.ok) return invalid(opened.reason)
  const { state, matchId, commands } = opened
  if (state.commands.at(-1)?.type !== 'end-turn') {
    return invalid('This message does not contain a finished turn. Ask your opponent to end their turn before sending.')
  }
  const faction = state.activeFaction
  if (!local) return { ok: true, state, matchId, faction, newOrders: commands.length }
  if (local.matchId !== matchId) {
    return { ok: false, kind: 'other-match', reason: 'This turn belongs to a different match than the one in progress. Leave the current match to open it.' }
  }
  const shared = Math.min(commands.length, local.commands.length)
  for (let index = 0; index < shared; index++) {
    if (!sameCommand(commands[index]!, local.commands[index]!)) {
      return invalid('This turn does not continue your match: the earlier orders differ from yours.')
    }
  }
  if (commands.length <= local.commands.length) {
    return { ok: false, kind: 'known', reason: commands.length === local.commands.length
      ? 'You already have this turn.' : 'This is an older turn than the one you already have.' }
  }
  if (state.commands.slice(local.commands.length).some(order => order.factionId === local.faction)) {
    return invalid(`This turn contains orders for ${FACTIONS[local.faction]}, which only you may give.`)
  }
  return { ok: true, state, matchId, faction, newOrders: commands.length - local.commands.length }
}
