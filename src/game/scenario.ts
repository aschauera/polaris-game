import { hexDistance } from './hex'
import { neighbors, type FactionId } from './expedition'
import type { WorldMap } from './map'

export const SCENARIO_VERSION = 1
export const PLAYER_SLOTS = Object.freeze(['player-1', 'player-2'] as const)
export const TRIBE_IDS = Object.freeze(['amazons', 'raccoons', 'engineers', 'sorceresses'] as const)
export const TRIBES = Object.freeze({
  amazons: 'Amazons',
  raccoons: 'Raccoons',
  engineers: 'Engineers',
  sorceresses: 'Sorceresses',
} as const)

export type TribeId = keyof typeof TRIBES
export type PlayerSlotId = typeof PLAYER_SLOTS[number]
export type BeaconRole = 'near-meridian' | 'central' | 'near-lantern'

export interface ScenarioPlayer {
  readonly id: PlayerSlotId
  readonly factionId: FactionId
  readonly tribe: TribeId
  readonly startTileId: number
  readonly founderTileId: number
  readonly nearBeaconId: string
}

export interface ScenarioBeacon {
  readonly id: string
  readonly role: BeaconRole
  readonly tileId: number
}

export interface Scenario {
  readonly version: typeof SCENARIO_VERSION
  readonly topology: 'shared-landmass'
  readonly players: readonly [ScenarioPlayer, ScenarioPlayer]
  readonly beacons: readonly [ScenarioBeacon, ScenarioBeacon, ScenarioBeacon]
}

export interface ScenarioSetup {
  readonly version: typeof SCENARIO_VERSION
  readonly tribes: readonly [TribeId, TribeId]
}

interface CandidateMap {
  readonly land: readonly number[]
  readonly beacons: readonly number[]
  readonly starts: readonly number[]
}

interface QueueItem { readonly id: number; readonly cost: number }

function push(heap: QueueItem[], value: QueueItem): void {
  let index = heap.push(value) - 1
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2)
    if (heap[parent]!.cost <= value.cost) break
    heap[index] = heap[parent]!
    index = parent
  }
  heap[index] = value
}

function pop(heap: QueueItem[]): QueueItem | undefined {
  const first = heap[0]
  const last = heap.pop()
  if (!first || !last || heap.length === 0) return first
  let index = 0
  while (true) {
    const left = index * 2 + 1
    if (left >= heap.length) break
    const right = left + 1
    const child = right < heap.length && heap[right]!.cost < heap[left]!.cost ? right : left
    if (heap[child]!.cost >= last.cost) break
    heap[index] = heap[child]!
    index = child
  }
  heap[index] = last
  return first
}

function landComponent(map: WorldMap): number[] {
  const visited = new Uint8Array(map.tiles.length)
  let largest: number[] = []
  for (const tile of map.tiles) {
    if (tile.terrain === 'water' || visited[tile.id]) continue
    const component = [tile.id]
    visited[tile.id] = 1
    for (let index = 0; index < component.length; index++) {
      for (const id of neighbors(map, component[index]!)) {
        if (map.tiles[id]!.terrain !== 'water' && !visited[id]) {
          visited[id] = 1
          component.push(id)
        }
      }
    }
    if (component.length > largest.length) largest = component
  }
  return largest
}

function sample(ids: readonly number[], limit: number): number[] {
  if (ids.length <= limit) return [...ids]
  return Array.from({ length: limit }, (_, index) => ids[Math.floor(index * (ids.length - 1) / (limit - 1))]!)
}

function tileDistance(map: WorldMap, first: number, second: number): number {
  const a = map.tiles[first]!, b = map.tiles[second]!
  return hexDistance(a.x, a.z, b.x, b.z)
}

function travelTurnsFrom(map: WorldMap, land: ReadonlySet<number>, start: number): Float64Array {
  const best = new Float64Array(map.tiles.length * 3).fill(Infinity)
  const heap: QueueItem[] = []
  const initial = start * 3 + 2
  best[initial] = 0
  push(heap, { id: initial, cost: 0 })
  while (heap.length) {
    const current = pop(heap)!
    if (current.cost !== best[current.id]) continue
    const tileId = Math.floor(current.id / 3)
    const remaining = current.id % 3
    for (const id of neighbors(map, tileId)) {
      if (!land.has(id)) continue
      const movementCost = map.tiles[id]!.terrain === 'hills' ? 2 : 1
      const turnsElapsed = Math.floor(current.cost / 3) + Number(movementCost > remaining)
      const nextRemaining = (movementCost > remaining ? 2 : remaining) - movementCost
      const nextId = id * 3 + nextRemaining
      const nextCost = turnsElapsed * 3 + (2 - nextRemaining)
      if (nextCost >= best[nextId]!) continue
      best[nextId] = nextCost
      push(heap, { id: nextId, cost: nextCost })
    }
  }
  const result = new Float64Array(map.tiles.length).fill(Infinity)
  result[start] = 0
  for (let id = 0; id < result.length; id++) for (let remaining = 0; remaining <= 2; remaining++) {
    const stateCost = best[id * 3 + remaining]!
    if (Number.isFinite(stateCost)) result[id] = Math.min(result[id]!, Math.floor(stateCost / 3) + 1)
  }
  return result
}

function candidateMap(map: WorldMap): CandidateMap {
  const land = landComponent(map)
  const landSet = new Set(land)
  const hasRoom = (start: number) => {
    for (let first = 0; first < land.length; first++) {
      const a = land[first]!
      if (a === start || tileDistance(map, start, a) < 5) continue
      for (let second = first + 1; second < land.length; second++) {
        const b = land[second]!
        if (b !== start && tileDistance(map, start, b) >= 5 && tileDistance(map, a, b) >= 5) return true
      }
    }
    return false
  }
  const coastal = land.filter(id => neighbors(map, id).some(neighbor => {
    const tile = map.tiles[neighbor]!
    return tile.terrain === 'water' && tile.waterDepth === 'shallow'
  }))
  const starts = sample(coastal, 128).filter(id =>
    hasRoom(id) && neighbors(map, id).some(neighbor => landSet.has(neighbor)))
  const beaconSites = land.filter(id => neighbors(map, id).filter(neighbor => landSet.has(neighbor)).length >= 2)
  return { land, beacons: sample(beaconSites, 512), starts: sample(starts, 16) }
}

function founderTile(map: WorldMap, land: ReadonlySet<number>, start: number, otherStart: number): number | undefined {
  return neighbors(map, start).find(id => land.has(id) && id !== otherStart)
}

function hasTwoCitySites(map: WorldMap, land: readonly number[], start: number, reserved: ReadonlySet<number>): boolean {
  const sites = land.filter(id => !reserved.has(id) && tileDistance(map, start, id) >= 5)
  for (let first = 0; first < sites.length; first++) {
    for (let second = first + 1; second < sites.length; second++) {
      if (tileDistance(map, sites[first]!, sites[second]!) >= 5) return true
    }
  }
  return false
}

function chooseBeacons(
  map: WorldMap,
  land: ReadonlySet<number>,
  startA: number,
  startB: number,
  founderA: number,
  founderB: number,
  beaconSites: readonly number[],
  fromA: Float64Array,
  fromB: Float64Array,
): { nearA: number; center: number; nearB: number; score: number } | undefined {
  const reserved = new Set([startA, startB, founderA, founderB])
  const eligible = beaconSites.filter(id => !reserved.has(id)
    && neighbors(map, id).filter(neighbor => land.has(neighbor) && !reserved.has(neighbor)).length >= 2)
  const nearA = eligible.filter(id => fromA[id]! >= 1 && fromA[id]! <= 5
    && fromB[id]! - fromA[id]! >= 1)
    .sort((left, right) => fromA[left]! - fromA[right]! || left - right).slice(0, 12)
  const nearB = eligible.filter(id => fromB[id]! >= 1 && fromB[id]! <= 5
    && fromA[id]! - fromB[id]! >= 1)
    .sort((left, right) => fromB[left]! - fromB[right]! || left - right).slice(0, 12)
  let best: { nearA: number; center: number; nearB: number; score: number } | undefined
  for (const a of nearA) for (const b of nearB) {
    if (a === b || tileDistance(map, a, b) < 3) continue
    const timeA = fromA[a]!, timeB = fromB[b]!
    if (Math.abs(timeA - timeB) > 1) continue
    for (const center of eligible) {
      if (center === a || center === b || tileDistance(map, center, a) < 3 || tileDistance(map, center, b) < 3) continue
      const centerA = fromA[center]!, centerB = fromB[center]!
      if (Math.abs(centerA - centerB) > 1 || Math.min(centerA, centerB) < Math.max(timeA, timeB) + 1) continue
      const score = Math.abs(timeA - 3) + Math.abs(timeB - 3)
        + Math.abs(centerA - centerB) * 4 - Math.min(centerA, centerB) / 100
      if (!best || score < best.score || (score === best.score && center < best.center)) {
        best = { nearA: a, center, nearB: b, score }
      }
    }
  }
  return best
}

export function createScenario(
  map: WorldMap,
  tribes: readonly [TribeId, TribeId] = ['amazons', 'raccoons'],
): Scenario {
  if (tribes.length !== 2 || tribes.some(tribe => !Object.hasOwn(TRIBES, tribe))) {
    throw new Error('Choose a supported tribe for each player.')
  }
  const candidates = candidateMap(map)
  const land = new Set(candidates.land)
  const pairs: { a: number; b: number; founderA: number; founderB: number; distance: number }[] = []
  for (const [index, a] of candidates.starts.entries()) for (const b of candidates.starts.slice(index + 1)) {
    if (tileDistance(map, a, b) < 7) continue
    const founderA = founderTile(map, land, a, b)
    const founderB = founderTile(map, land, b, a)
    if (founderA === undefined || founderB === undefined || founderA === founderB) continue
    pairs.push({ a, b, founderA, founderB, distance: tileDistance(map, a, b) })
  }
  pairs.sort((left, right) => right.distance - left.distance || left.a - right.a || left.b - right.b)
  let selected: (typeof pairs)[number] & { beacons: NonNullable<ReturnType<typeof chooseBeacons>> } | undefined
  for (const pair of pairs) {
    const fromA = travelTurnsFrom(map, land, pair.a)
    const fromB = travelTurnsFrom(map, land, pair.b)
    if (Math.abs(fromA[pair.b]! - fromB[pair.a]!) > 1) continue
    const beacons = chooseBeacons(map, land, pair.a, pair.b, pair.founderA, pair.founderB,
      candidates.beacons, fromA, fromB)
    if (!beacons) continue
    const reserved = new Set([pair.a, pair.b, pair.founderA, pair.founderB,
      beacons.nearA, beacons.center, beacons.nearB])
    if (!hasTwoCitySites(map, candidates.land, pair.a, reserved)
      || !hasTwoCitySites(map, candidates.land, pair.b, reserved)) continue
    selected = { ...pair, beacons }
    break
  }
  if (!selected) {
    throw new Error('This world cannot form a fair shared-landmass scenario. Regenerate the map or choose another seed.')
  }

  const beacons = Object.freeze([
    Object.freeze({ id: 'beacon-meridian', role: 'near-meridian' as const, tileId: selected.beacons.nearA }),
    Object.freeze({ id: 'beacon-central', role: 'central' as const, tileId: selected.beacons.center }),
    Object.freeze({ id: 'beacon-lantern', role: 'near-lantern' as const, tileId: selected.beacons.nearB }),
  ]) as Scenario['beacons']
  const players = Object.freeze([
    Object.freeze({ id: PLAYER_SLOTS[0], factionId: 'meridian', tribe: tribes[0], startTileId: selected.a,
      founderTileId: selected.founderA, nearBeaconId: beacons[0].id }),
    Object.freeze({ id: PLAYER_SLOTS[1], factionId: 'lantern', tribe: tribes[1], startTileId: selected.b,
      founderTileId: selected.founderB, nearBeaconId: beacons[2].id }),
  ]) as Scenario['players']
  return Object.freeze({ version: SCENARIO_VERSION, topology: 'shared-landmass', players, beacons })
}
