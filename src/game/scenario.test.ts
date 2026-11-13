import { describe, expect, it } from 'vitest'
import { hexDistance } from './hex'
import { applyCommand, createExpedition, neighbors, type Expedition } from './expedition'
import { generateMap } from './map'
import { createScenario } from './scenario'

function travelTurns(map: ReturnType<typeof generateMap>, start: number, target: number): number {
  const pending = [{ id: start, turns: 0, remaining: 2 }]
  const best = new Map([[`${start}:2`, 0]])
  while (pending.length) {
    pending.sort((a, b) => a.turns - b.turns || b.remaining - a.remaining || a.id - b.id)
    const current = pending.shift()!
    if (best.get(`${current.id}:${current.remaining}`) !== current.turns) continue
    if (current.id === target) return current.turns + 1
    for (const id of neighbors(map, current.id)) {
      const tile = map.tiles[id]!
      if (tile.terrain === 'water') continue
      const cost = tile.terrain === 'hills' ? 2 : 1
      const turns = current.turns + Number(cost > current.remaining)
      const remaining = (cost > current.remaining ? 2 : current.remaining) - cost
      const key = `${id}:${remaining}`
      if (turns >= (best.get(key) ?? Infinity)) continue
      best.set(key, turns)
      pending.push({ id, turns, remaining })
    }
  }
  return Infinity
}

function reachableByShallows(map: ReturnType<typeof generateMap>, start: number, target: number): boolean {
  const visited = new Set([start])
  const pending = [start]
  for (let index = 0; index < pending.length; index++) {
    const tileId = pending[index]!
    if (tileId === target) return true
    for (const id of neighbors(map, tileId)) {
      const tile = map.tiles[id]!
      if (tile.terrain === 'water' && tile.waterDepth !== 'shallow' && tile.waterDepth !== 'shoal') continue
      if (visited.has(id)) continue
      visited.add(id)
      pending.push(id)
    }
  }
  return false
}

function landComponent(map: ReturnType<typeof generateMap>, start: number): Set<number> {
  const component = new Set([start])
  const pending = [start]
  for (let index = 0; index < pending.length; index++) {
    for (const id of neighbors(map, pending[index]!)) {
      if (map.tiles[id]!.terrain === 'water' || component.has(id)) continue
      component.add(id)
      pending.push(id)
    }
  }
  return component
}

interface RouteItem { readonly id: number; readonly time: number }

function routePush(heap: RouteItem[], item: RouteItem): void {
  let index = heap.push(item) - 1
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2)
    if (heap[parent]!.time <= item.time) break
    heap[index] = heap[parent]!
    index = parent
  }
  heap[index] = item
}

function routePop(heap: RouteItem[]): RouteItem | undefined {
  const first = heap[0]
  const last = heap.pop()
  if (!first || !last || heap.length === 0) return first
  let index = 0
  while (true) {
    const left = index * 2 + 1
    if (left >= heap.length) break
    const right = left + 1
    const child = right < heap.length && heap[right]!.time < heap[left]!.time ? right : left
    if (heap[child]!.time >= last.time) break
    heap[index] = heap[child]!
    index = child
  }
  heap[index] = last
  return first
}

function routeTurns(map: ReturnType<typeof generateMap>, start: number, target: number): number {
  const best = new Float64Array(map.tiles.length * 12).fill(Infinity)
  const heap: RouteItem[] = []
  const stateId = (tile: number, water: boolean, phase: number) => tile * 12 + Number(water) * 6 + phase
  const offer = (tile: number, water: boolean, time: number) => {
    const id = stateId(tile, water, time % 6)
    if (time >= best[id]!) return
    best[id] = time
    routePush(heap, { id, time })
  }
  const initial = stateId(start, false, 0)
  best[initial] = 0
  routePush(heap, { id: initial, time: 0 })
  while (heap.length) {
    const current = routePop(heap)!
    if (current.time !== best[current.id]) continue
    const tileId = Math.floor(current.id / 12)
    const water = Math.floor(current.id / 6) % 2 === 1
    const phase = current.id % 6
    const move = (points: number, ticksPerPoint: number) => {
      const ticks = points * ticksPerPoint
      return phase + ticks <= 6 ? current.time + ticks : current.time - phase + 6 + ticks
    }
    for (const id of neighbors(map, tileId)) {
      const next = map.tiles[id]!
      const navigable = next.terrain === 'water' && (next.waterDepth === 'shallow' || next.waterDepth === 'shoal')
      if (water) {
        if (navigable) offer(id, true, move(1, 2))
        else if (next.terrain !== 'water') offer(id, false, current.time - phase + 6)
      } else if (next.terrain !== 'water') {
        offer(id, false, move(next.terrain === 'hills' ? 2 : 1, 3))
      } else if (navigable) {
        offer(id, true, current.time - phase + 6)
      }
    }
  }
  const landTurns = travelTurns(map, start, target)
  const seaTicks = Math.min(...Array.from({ length: 6 }, (_, phase) => best[stateId(target, false, phase)]!))
  const seaTurns = Number.isFinite(seaTicks) ? Math.ceil(seaTicks / 6) + 1 : Infinity
  return Math.min(landTurns, seaTurns)
}

describe('shared-landmass scenarios', () => {
  it.each([
    ['polaris', 24, 24],
    ['polaris', 32, 24],
    ['aurora', 32, 32],
  ])('builds a reproducible, fair scenario for %s (%ix%i)', (seed, width, height) => {
    const map = generateMap({ seed, width, height })
    const scenario = createScenario(map)
    if (width <= 64) expect(createScenario(map)).toEqual(scenario)
    expect(Object.isFrozen(scenario)).toBe(true)
    expect(scenario.players.map(player => player.tribe)).toEqual(['amazons', 'raccoons'])
    expect(scenario.beacons.map(beacon => beacon.role)).toEqual(['near-meridian', 'central', 'near-lantern'])

    const [first, second] = scenario.players
    const startTiles = scenario.players.flatMap(player => [player.startTileId, player.founderTileId])
    const beaconTiles = scenario.beacons.map(beacon => beacon.tileId)
    const reservedTiles = new Set([...startTiles, ...beaconTiles])
    expect(new Set([...startTiles, ...beaconTiles]).size).toBe(7)
    for (const id of [...startTiles, ...beaconTiles]) expect(map.tiles[id]!.terrain).not.toBe('water')

    for (const player of scenario.players) {
      const extraSites = map.tiles.filter(tile => tile.terrain !== 'water' && !reservedTiles.has(tile.id)
        && hexDistance(tile.x, tile.z, map.tiles[player.startTileId]!.x, map.tiles[player.startTileId]!.z) >= 5)
      expect(extraSites.some((first, index) => extraSites.slice(index + 1)
        .some(second => hexDistance(first.x, first.z, second.x, second.z) >= 5))).toBe(true)
      for (const beacon of scenario.beacons) {
        expect(Number.isFinite(travelTurns(map, player.startTileId, beacon.tileId))).toBe(true)
      }
    }
    for (const beacon of scenario.beacons) {
      expect(neighbors(map, beacon.tileId).filter(id => map.tiles[id]!.terrain !== 'water'
        && !startTiles.includes(id) && !beaconTiles.includes(id)).length).toBeGreaterThanOrEqual(2)
    }

    const nearA = scenario.beacons[0]!.tileId
    const central = scenario.beacons[1]!.tileId
    const nearB = scenario.beacons[2]!.tileId
    expect(Math.abs(travelTurns(map, first.startTileId, nearA) - travelTurns(map, second.startTileId, nearB))).toBeLessThanOrEqual(1)
    expect(Math.abs(travelTurns(map, first.startTileId, central) - travelTurns(map, second.startTileId, central))).toBeLessThanOrEqual(1)
    expect(travelTurns(map, first.startTileId, nearA)).toBeLessThan(travelTurns(map, first.startTileId, central))
    expect(travelTurns(map, second.startTileId, nearB)).toBeLessThan(travelTurns(map, second.startTileId, central))
    expect(Math.abs(travelTurns(map, first.startTileId, second.startTileId)
      - travelTurns(map, second.startTileId, first.startTileId))).toBeLessThanOrEqual(1)
  })

  it('allows independent mirrored tribe choices and rejects unsupported tribes', () => {
    const map = generateMap({ seed: 'polaris', width: 24, height: 24 })
    expect(createScenario(map, ['engineers', 'engineers']).players.map(player => player.tribe))
      .toEqual(['engineers', 'engineers'])
    expect(() => createScenario(map, ['engineers', 'unknown' as never])).toThrow(/supported tribe/)
  })

  it('reserves public beacon tiles from city founding', () => {
    const map = generateMap({ seed: 'polaris', width: 24, height: 24 })
    const scenario = createScenario(map)
    const state = createExpedition(map, ['meridian', 'lantern'], scenario)
    const beacon = scenario.beacons[0]!
    const founder = state.founders[0]!
    const faction = state.factions[0]!
    const visibleState: Expedition = {
      ...state,
      founders: Object.freeze([{ ...founder, tileId: beacon.tileId }]),
      factions: Object.freeze([
        { ...faction, fog: { ...faction.fog, [beacon.tileId]: 'visible' as const } }, state.factions[1]!,
      ]),
    }
    const result = applyCommand(visibleState, {
      type: 'found-city', factionId: 'meridian', sequence: 1, founderId: founder.id,
    })
    expect(result).toMatchObject({ ok: false, reason: 'A city cannot be founded on a reserved public beacon.' })
  })

  it('rejects a map without a valid coastal start instead of repairing it', () => {
    const map = generateMap({ seed: 'polaris', width: 8, height: 8 })
    expect(() => createScenario(map)).toThrow(/fair shared-landmass scenario/)
  })
})

describe('archipelago preview scenarios', () => {
  it.each([
    ['polaris', 24, 24],
    ['island3', 24, 24],
    ['island14', 24, 24],
    ['island0', 32, 32],
    ['island0', 64, 64],
    ['island0', 128, 128],
    ['island0', 256, 256],
  ])('builds a fair, navigable preview for %s (%ix%i)', (seed, width, height) => {
    const map = generateMap({ seed, width, height, topology: 'archipelago' })
    const scenario = createScenario(map)
    expect(scenario.topology).toBe('archipelago')
    if (width <= 64) expect(createScenario(map)).toEqual(scenario)
    expect(() => createExpedition(map, ['meridian', 'lantern'], scenario)).toThrow(/preview.*water crossing/)
    const starts = scenario.players.map(player => player.startTileId)
    const homes = scenario.players.map(player => landComponent(map, player.startTileId))
    const beaconLand = landComponent(map, scenario.beacons[1]!.tileId)
    const reserved = new Set([
      ...scenario.players.flatMap(player => [player.startTileId, player.founderTileId]),
      ...scenario.beacons.map(beacon => beacon.tileId),
    ])
    expect(reserved.size).toBe(7)
    expect(homes[0]!.has(starts[1]!)).toBe(false)
    expect(homes[1]!.has(starts[0]!)).toBe(false)
    expect(beaconLand.has(starts[0]!)).toBe(false)
    expect(beaconLand.has(starts[1]!)).toBe(false)
    for (const [index, player] of scenario.players.entries()) {
      const home = homes[index]!
      const start = map.tiles[player.startTileId]!
      expect([...home].some(id => !reserved.has(id)
        && hexDistance(start.x, start.z, map.tiles[id]!.x, map.tiles[id]!.z) >= 5
        && neighbors(map, id).some(neighbor => map.tiles[neighbor]!.terrain === 'water'
          && (map.tiles[neighbor]!.waterDepth === 'shallow' || map.tiles[neighbor]!.waterDepth === 'shoal')))).toBe(true)
      for (const beacon of scenario.beacons) {
        expect(reachableByShallows(map, player.startTileId, beacon.tileId)).toBe(true)
      }
    }
    for (const beacon of scenario.beacons) {
      expect(neighbors(map, beacon.tileId).filter(id =>
        map.tiles[id]!.terrain !== 'water' && !reserved.has(id)).length).toBeGreaterThanOrEqual(2)
    }
    expect(reachableByShallows(map, starts[0]!, starts[1]!)).toBe(true)
  })

  it('rejects layouts below the supported island-scenario size', () => {
    const map = generateMap({ seed: 'polaris', width: 23, height: 24, topology: 'archipelago' })
    expect(() => createScenario(map)).toThrow(/at least 24/)
  })

  it.each([
    ['polaris', 24, 24],
    ['island0', 32, 32],
    ['island0', 64, 64],
  ])('keeps mirrored travel turns fair when the starting sides are swapped on %s (%ix%i)', (seed, width, height) => {
    const map = generateMap({ seed, width, height, topology: 'archipelago' })
    const scenario = createScenario(map)
    const [first, second] = scenario.players
    const [nearFirst, central, nearSecond] = scenario.beacons
    expect(Math.abs(routeTurns(map, first.startTileId, second.startTileId)
      - routeTurns(map, second.startTileId, first.startTileId))).toBeLessThanOrEqual(1)
    expect(Math.abs(routeTurns(map, first.startTileId, central.tileId)
      - routeTurns(map, second.startTileId, central.tileId))).toBeLessThanOrEqual(1)
    expect(Math.abs(routeTurns(map, first.startTileId, nearFirst.tileId)
      - routeTurns(map, second.startTileId, nearSecond.tileId))).toBeLessThanOrEqual(1)
    expect(Number.isFinite(routeTurns(map, first.startTileId, nearSecond.tileId))).toBe(true)
    expect(Number.isFinite(routeTurns(map, second.startTileId, nearFirst.tileId))).toBe(true)
  })
})
