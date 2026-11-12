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

describe('shared-landmass scenarios', () => {
  it.each([
    ['polaris', 24, 24],
    ['polaris', 32, 24],
    ['aurora', 32, 32],
  ])('builds a reproducible, fair scenario for %s (%ix%i)', (seed, width, height) => {
    const map = generateMap({ seed, width, height })
    const scenario = createScenario(map)
    expect(createScenario(map)).toEqual(scenario)
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
