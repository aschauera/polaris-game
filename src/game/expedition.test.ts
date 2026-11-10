import { describe, expect, it } from 'vitest'
import { GENERATOR_VERSION, generateMap, type Terrain, type WorldMap } from './map'
import {
  applyCommand, cityYields, createExpedition, findPath, knownTile, movementRange, neighbors, SCOUT, visibilityAt,
  type Command, type Expedition,
} from './expedition'

function plainMap(width = 8, height = 12, terrain: Record<number, Terrain> = {}): WorldMap {
  return Object.freeze({
    seed: 'fixture', width, height, generatorVersion: GENERATOR_VERSION, rngState: 42,
    tiles: Object.freeze(Array.from({ length: width * height }, (_, id) => Object.freeze({
      id, x: id % width, z: Math.floor(id / width), terrain: terrain[id] ?? 'grassland', elevation: 1, trees: 0,
    }))),
  })
}

function fixture(terrain: Record<number, Terrain> = {}, movement = SCOUT.movement): Expedition {
  const state = createExpedition(plainMap(8, 12, terrain))
  const fog = Object.freeze(Object.fromEntries(state.map.tiles.map(tile => [tile.id, 'visible' as const])))
  return Object.freeze({ ...state,
    scouts: Object.freeze([Object.freeze({ ...state.scouts[0]!, tileId: 27, movement })]),
    founders: Object.freeze([]), units: Object.freeze([]), cities: Object.freeze([]),
    factions: Object.freeze([Object.freeze({ ...state.factions[0]!, fog })]),
  })
}

function found(state: Expedition, founderId = 'founder-meridian'): Command {
  return { type: 'found-city', founderId, factionId: state.activeFaction, sequence: state.commands.length + 1 }
}

function move(state: Expedition, to: number): Command {
  return { type: 'move', unitId: state.scouts[0]!.id, factionId: state.activeFaction, sequence: state.commands.length + 1, to }
}

function accepted(state: Expedition, command: Command): Expedition {
  const result = applyCommand(state, command)
  expect(result.ok, result.ok ? result.message : result.reason).toBe(true)
  return result.state
}

describe('expedition movement and commands', () => {
  it('chooses a reproducible start on the largest connected landmass without consuming RNG', () => {
    for (const seed of ['polaris', 'aurora', 'North_Star-7']) {
      const map = generateMap({ seed, width: 32, height: 24 })
      const state = createExpedition(map)
      expect(state).toEqual(createExpedition(map))
      expect(state.rngState).toBe(map.rngState)
      expect(map.tiles[state.scouts[0]!.tileId]!.terrain).not.toBe('water')
      expect(Object.isFrozen(state)).toBe(true)
      expect(Object.isFrozen(state.scouts[0])).toBe(true)
      expect(Object.isFrozen(state.factions[0]!.fog)).toBe(true)
    }
    const terrain = Object.fromEntries(Array.from({ length: 96 }, (_, id) => [id, 'water' as const]))
    const map = plainMap(8, 12, { ...terrain, 0: 'grassland', 80: 'grassland', 81: 'hills', 82: 'grassland' })
    expect([80, 81, 82]).toContain(createExpedition(map).scouts[0]!.tileId)
    expect(() => createExpedition(plainMap(8, 12, terrain))).toThrow(/too little connected land/)
    expect(() => createExpedition(map, [])).toThrow(/unique supported factions/)
    expect(() => createExpedition(map, ['meridian', 'meridian'])).toThrow(/unique supported factions/)
  })

  it('uses six hex neighbors in a fixed order without wrapping rectangular map edges', () => {
    const map = plainMap()
    // Tile 27 is (3, 3) on an odd, half-shifted row; tile 20 is (4, 2) on an even row. Order: E, SE, SW, W, NW, NE.
    expect(neighbors(map, 27)).toEqual([28, 36, 35, 26, 19, 20])
    expect(neighbors(map, 20)).toEqual([21, 28, 27, 19, 11, 12])
    expect(neighbors(map, 0)).toEqual([1, 8])
    expect(neighbors(map, 7)).toEqual([15, 14, 6])
    expect(neighbors(map, 95)).toEqual([94, 87])
    expect(neighbors(map, -1)).toEqual([])
    for (const tile of map.tiles) {
      for (const id of neighbors(map, tile.id)) expect(neighbors(map, id)).toContain(tile.id)
    }
  })

  it('resolves equal-cost A* paths by stable insertion order', () => {
    const state = fixture()
    for (let i = 0; i < 10; i++) {
      expect(findPath(state, state.scouts[0]!.id, 21)).toEqual({ path: [27, 28, 21], cost: 2 })
      expect(findPath(state, state.scouts[0]!.id, 34)).toEqual({ path: [27, 35, 34], cost: 2 })
    }
  })

  it('uses integer entry costs and finds an affordable detour around water and hills', () => {
    const state = fixture({ 28: 'water', 20: 'water', 36: 'hills' })
    expect(findPath(state, state.scouts[0]!.id, 29)).toEqual({ path: [27, 36, 37, 29], cost: 4 })
    expect(findPath(state, state.scouts[0]!.id, 36)?.cost).toBe(2)
    const range = movementRange(state, state.scouts[0]!.id)
    expect(range.get(29)).toBe(4)
    expect(range.has(28)).toBe(false)
    expect(range.has(30)).toBe(false)
    expect([...range.values()].every(cost => Number.isInteger(cost) && cost <= 4)).toBe(true)
  })

  it('agrees with an independent shortest-path oracle for every destination', () => {
    const state = fixture({ 19: 'water', 28: 'hills', 34: 'water', 36: 'hills', 43: 'water' })
    const costs = new Map<number, number>([[27, 0]])
    for (let step = 0; step < SCOUT.movement; step++) {
      for (const [id, cost] of [...costs]) {
        for (const next of neighbors(state.map, id)) {
          const terrain = state.map.tiles[next]!.terrain
          const candidate = cost + (terrain === 'water' ? Infinity : terrain === 'hills' ? 2 : 1)
          if (candidate <= 4 && candidate < (costs.get(next) ?? Infinity)) costs.set(next, candidate)
        }
      }
    }
    expect(movementRange(state, state.scouts[0]!.id)).toEqual(costs)
    for (const tile of state.map.tiles) expect(findPath(state, state.scouts[0]!.id, tile.id)?.cost).toBe(costs.get(tile.id))
  })

  it('blocks occupied destinations and intermediate tiles', () => {
    const initial = fixture({ 19: 'water', 20: 'water', 26: 'water', 35: 'water', 36: 'water' })
    const state = Object.freeze({ ...initial, scouts: Object.freeze([...initial.scouts,
      Object.freeze({ id: 'other-scout', factionId: 'meridian' as const, tileId: 28, movement: 4 })]) })
    expect(findPath(state, state.scouts[0]!.id, 29)).toBeUndefined()
    expect([...movementRange(state, state.scouts[0]!.id).keys()]).toEqual([27])
    expect(applyCommand(state, move(state, 28))).toMatchObject({ ok: false, reason: 'The destination is occupied.' })
  })

  it.each([-1, 96, 27.5, NaN, Infinity])('rejects invalid destination %s without mutation or RNG consumption', to => {
    const state = fixture()
    const before = JSON.stringify(state)
    const result = applyCommand(state, move(state, to))
    expect(result).toMatchObject({ ok: false, state, reason: 'Choose a tile inside the map.' })
    expect(result.state).toBe(state)
    expect(JSON.stringify(state)).toBe(before)
  })

  it('rejects foreign, missing, stale, unaffordable, unknown and impassable orders explicitly', () => {
    const state = fixture({ 28: 'water' })
    const commands: Command[] = [
      { ...move(state, 19), factionId: 'lantern' },
      { type: 'move', factionId: 'meridian', sequence: 1, unitId: 'missing', to: 19 },
      { ...move(state, 19), sequence: 0 }, move(state, 95), move(state, 27), move(state, 28),
    ]
    for (const command of commands) {
      const result = applyCommand(state, command)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason.length).toBeGreaterThan(10)
      expect(result.state).toBe(state)
      expect(result.state.rngState).toBe(42)
      expect(result.state.commands).toHaveLength(0)
    }
    const unknown = createExpedition(plainMap())
    expect(applyCommand(unknown, move(unknown, 0))).toMatchObject({ ok: false, reason: expect.stringMatching(/uncharted/) })
    expect(findPath(unknown, unknown.scouts[0]!.id, 0)).toBeUndefined()
  })

  it('exhausts movement, resets it at end-turn and repeats complete command sequences', () => {
    function play() {
      let state = fixture()
      state = accepted(state, move(state, 31))
      expect(state.scouts[0]!.movement).toBe(0)
      expect([...movementRange(state, state.scouts[0]!.id).keys()]).toEqual([31])
      expect(applyCommand(state, move(state, 30)).ok).toBe(false)
      state = accepted(state, { type: 'end-turn', factionId: 'meridian', sequence: 2 })
      expect(state.round).toBe(2)
      expect(state.scouts[0]!.movement).toBe(SCOUT.movement)
      return accepted(state, move(state, 30))
    }
    expect(play()).toEqual(play())
    expect(play().rngState).toBe(42)
    expect(play().commands.map(command => command.sequence)).toEqual([1, 2, 3])
  })

  it('rotates factions stably and resets only the incoming faction', () => {
    let state = createExpedition(plainMap(), ['meridian', 'lantern'])
    const lanternFog = state.factions[1]!.fog
    const to = [...movementRange(state, state.scouts[0]!.id).keys()].find(id => id !== state.scouts[0]!.tileId)!
    state = accepted(state, move(state, to))
    expect(state.factions[1]!.fog).toBe(lanternFog)
    expect(movementRange(state, state.scouts[1]!.id).size).toBe(0)
    state = accepted(state, { type: 'end-turn', factionId: 'meridian', sequence: 2 })
    expect(state.activeFaction).toBe('lantern')
    expect(state.round).toBe(1)
    expect(state.scouts[0]!.movement).toBe(3)
    expect(applyCommand(state, { ...move(state, to), factionId: 'meridian' }).ok).toBe(false)
    state = accepted(state, { type: 'end-turn', factionId: 'lantern', sequence: 3 })
    expect(state.round).toBe(2)
    expect(state.scouts[0]!.movement).toBe(4)
  })
})

describe('city founding, economy and production', () => {
  function foundingFixture(terrain: Record<number, Terrain> = {}): Expedition {
    const initial = fixture(terrain)
    return Object.freeze({ ...initial,
      founders: Object.freeze([Object.freeze({ id: 'founder-meridian', factionId: 'meridian' as const, tileId: 28 })]),
    })
  }

  it('founds a city, consumes its founder and claims only nearby land with typed yields', () => {
    const state = foundingFixture()
    const result = applyCommand(state, found(state))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const city = result.state.cities[0]!
    expect(city).toMatchObject({
      id: 'city-meridian-1', name: 'Sonnenfurt', factionId: 'meridian', tileId: 28, population: 1,
      food: 0, materials: 0, production: undefined, storehouse: false,
      claimTileIds: [20, 21, 27, 28, 29, 36, 37],
    })
    expect(result.message).toBe('Meridian Union founded Sonnenfurt at (4, 3).')
    expect(cityYields(result.state, city)).toEqual({ food: 14, materials: 7 })
    expect(result.state.founders).toEqual([])
    expect(result.state.nextCityId).toBe(2)
    expect(result.state.rngState).toBe(state.rngState)
    expect(Object.isFrozen(city.claimTileIds)).toBe(true)
    expect(applyCommand(result.state, found(result.state)).ok).toBe(false)

    const uncharted = Object.freeze({ ...state,
      factions: Object.freeze([Object.freeze({ ...state.factions[0]!, fog: Object.freeze({ 27: 'visible' as const }) })]),
    })
    expect(applyCommand(uncharted, found(uncharted)))
      .toMatchObject({ ok: false, reason: 'The founder cannot settle uncharted territory.' })
  })

  it('rejects water, too-close, claimed, foreign and over-limit city sites without mutation', () => {
    const state = foundingFixture({ 28: 'water' })
    expect(applyCommand(state, found(state))).toMatchObject({ ok: false, reason: 'Cities can only be founded on land.' })

    const firstState = foundingFixture()
    const first = applyCommand(firstState, found(firstState))
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const nearby = Object.freeze({ ...first.state,
      founders: Object.freeze([Object.freeze({ id: 'founder-next', factionId: 'meridian' as const, tileId: 31 })]),
    })
    const tooClose = applyCommand(nearby, found(nearby, 'founder-next'))
    expect(tooClose).toMatchObject({ ok: false, reason: expect.stringMatching(/at least 5 tiles apart/) })
    expect(tooClose.state).toBe(nearby)

    const claimed = Object.freeze({ ...first.state,
      cities: Object.freeze([Object.freeze({ ...first.state.cities[0]!, claimTileIds: Object.freeze([76]) })]),
      founders: Object.freeze([Object.freeze({ id: 'founder-claimed', factionId: 'meridian' as const, tileId: 76 })]),
    })
    expect(applyCommand(claimed, found(claimed, 'founder-claimed')))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/claim territory/) })

    const foreign = Object.freeze({ ...foundingFixture(),
      founders: Object.freeze([Object.freeze({ id: 'founder-lantern', factionId: 'lantern' as const, tileId: 28 })]),
    })
    expect(applyCommand(foreign, found(foreign, 'founder-lantern')))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/belonging to the active faction/) })

    const overLimit = Object.freeze({ ...first.state,
      cities: Object.freeze([...first.state.cities, Object.freeze({ ...first.state.cities[0]!, id: 'city-meridian-2', tileId: 40 })]),
      founders: Object.freeze([Object.freeze({ id: 'founder-next', factionId: 'meridian' as const, tileId: 52 })]),
    })
    expect(applyCommand(overLimit, found(overLimit, 'founder-next')))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/at most 2 cities/) })
  })

  it('resolves food before growth and leaves population unchanged when food is insufficient', () => {
    const initial = foundingFixture()
    const founded = applyCommand(initial, found(initial))
    expect(founded.ok).toBe(true)
    if (!founded.ok) return
    const city = founded.state.cities[0]!
    const ready = Object.freeze({ ...founded.state,
      cities: Object.freeze([Object.freeze({ ...city, food: 12 })]),
    })
    const result = applyCommand(ready, { type: 'end-turn', factionId: 'meridian', sequence: 2 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.cities[0]).toMatchObject({ population: 2, food: 12, materials: 7 })

    const starving = Object.freeze({ ...founded.state,
      cities: Object.freeze([Object.freeze({ ...city, population: 6, food: 0, claimTileIds: [28] })]),
    })
    const noFood = applyCommand(starving, { type: 'end-turn', factionId: 'meridian', sequence: 2 })
    expect(noFood.ok).toBe(true)
    if (noFood.ok) expect(noFood.state.cities[0]).toMatchObject({ population: 6, food: 0 })
  })

  it('queues one item, completes it once on a legal tile and preserves typed IDs', () => {
    const initial = foundingFixture()
    const founded = applyCommand(initial, found(initial))
    expect(founded.ok).toBe(true)
    if (!founded.ok) return
    const city = founded.state.cities[0]!
    const queued = applyCommand(founded.state, { type: 'queue-production', cityId: city.id,
      itemId: 'guard', factionId: 'meridian', sequence: 2 })
    expect(queued.ok).toBe(true)
    if (!queued.ok) return
    expect(applyCommand(queued.state, { type: 'queue-production', cityId: city.id,
      itemId: 'worker', factionId: 'meridian', sequence: 3 }))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/already has an item/) })

    let state = queued.state
    state = accepted(state, { type: 'end-turn', factionId: 'meridian', sequence: 3 })
    expect(state.cities[0]!.production).toEqual({ itemId: 'guard', progress: 7 })
    expect(state.units).toEqual([])
    state = accepted(state, { type: 'end-turn', factionId: 'meridian', sequence: 4 })
    expect(state.cities[0]!.production).toBeUndefined()
    expect(state.units).toEqual([{
      id: 'unit-meridian-1', factionId: 'meridian', type: 'guard', tileId: 29,
    }])
    expect(neighbors(state.map, state.cities[0]!.tileId)).toContain(state.units[0]!.tileId)
    expect(state.map.tiles[state.units[0]!.tileId]!.terrain).not.toBe('water')
    expect(state.units[0]!.tileId).not.toBe(state.scouts[0]!.tileId)
    expect(state.nextUnitId).toBe(2)
    state = accepted(state, { type: 'end-turn', factionId: 'meridian', sequence: 5 })
    expect(state.units).toHaveLength(1)
  })

  it('keeps a completed unit queued when every legal spawn tile is occupied', () => {
    const initial = foundingFixture()
    const founded = applyCommand(initial, found(initial))
    expect(founded.ok).toBe(true)
    if (!founded.ok) return
    const city = founded.state.cities[0]!
    const blocked = Object.freeze({ ...founded.state,
      cities: Object.freeze([Object.freeze({ ...city, production: Object.freeze({ itemId: 'guard' as const, progress: 8 }) })]),
      units: Object.freeze([20, 21, 29, 36, 37].map((tileId, index) => Object.freeze({
        id: `blocker-${index}`, factionId: 'meridian' as const, type: 'worker' as const, tileId,
      }))),
    })
    const result = applyCommand(blocked, { type: 'end-turn', factionId: 'meridian', sequence: 2 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.units).toHaveLength(5)
      expect(result.state.nextUnitId).toBe(1)
      expect(result.state.cities[0]!.production).toEqual({ itemId: 'guard', progress: 8 })
    }
  })

  it('completes a storehouse once and applies its material bonus on following turns', () => {
    const initial = foundingFixture()
    const founded = applyCommand(initial, found(initial))
    expect(founded.ok).toBe(true)
    if (!founded.ok) return
    let state = accepted(founded.state, { type: 'queue-production', cityId: founded.state.cities[0]!.id,
      itemId: 'storehouse', factionId: 'meridian', sequence: 2 })
    for (let sequence = 3; sequence <= 5; sequence++) {
      state = accepted(state, { type: 'end-turn', factionId: 'meridian', sequence })
    }
    expect(state.cities[0]).toMatchObject({ storehouse: true, production: undefined })
    expect(cityYields(state, state.cities[0]!)).toEqual({ food: 14, materials: 8 })
    expect(applyCommand(state, { type: 'queue-production', cityId: state.cities[0]!.id,
      itemId: 'storehouse', factionId: 'meridian', sequence: 6 }))
      .toMatchObject({ ok: false, state, reason: 'This city already has a storehouse.' })
    state = accepted(state, { type: 'end-turn', factionId: 'meridian', sequence: 6 })
    expect(state.cities[0]!.materials).toBe(18)
  })
})

describe('faction exploration', () => {
  it.each([[8, 256], [256, 8], [256, 256]])('bounds exploration on a %sx%s world', (width, height) => {
    let state = createExpedition(generateMap({ seed: 'polaris', width, height }))
    const rngState = state.rngState
    for (let i = 0; i < 16; i++) {
      const scout = state.scouts[0]!
      const ids = [...movementRange(state, scout.id).keys()].filter(id => id !== scout.tileId)
      const to = ids[(i * 13) % ids.length]
      const command: Command = to === undefined
        ? { type: 'end-turn', factionId: state.activeFaction, sequence: state.commands.length + 1 } : move(state, to)
      const result = applyCommand(state, command)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.dirtyTiles.length).toBeLessThan(60)
      expect(result.state.rngState).toBe(rngState)
      expect(result.state.scouts[0]!.movement).toBeGreaterThanOrEqual(0)
      expect(result.state.map.tiles[result.state.scouts[0]!.tileId]).toBeDefined()
      state = result.state
    }
  })

  it('hides unknown tiles and reveals only the traveled sight regions', () => {
    const state = createExpedition(plainMap())
    const start = state.scouts[0]!.tileId
    // The founder stands on the eastern neighbour, so the scout steps west and leaves the far east behind.
    const to = start - 1
    expect(knownTile(state, 'meridian', 0)).toBeUndefined()
    const result = applyCommand(state, move(state, to))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(visibilityAt(result.state, 'meridian', start + 2)).toBe('explored')
    expect(visibilityAt(result.state, 'meridian', to)).toBe('visible')
    expect(visibilityAt(result.state, 'meridian', 0)).toBe('unseen')
    const changed = state.map.tiles.filter(tile =>
      visibilityAt(state, 'meridian', tile.id) !== visibilityAt(result.state, 'meridian', tile.id)).map(tile => tile.id)
    expect(result.dirtyTiles).toEqual(changed)
    expect(changed.length).toBeLessThan(30)
    expect(knownTile(result.state, 'meridian', start + 2)).toBe(state.map.tiles[start + 2])
    const end = applyCommand(result.state, { type: 'end-turn', factionId: 'meridian', sequence: 2 })
    expect(end.ok).toBe(true)
    if (end.ok) expect(end.dirtyTiles).toEqual([])
    expect(end.state.factions).toBe(result.state.factions)
  })

  it('does not expose unseen terrain through range/pathfinding or recompute another faction fog', () => {
    const state = createExpedition(plainMap(), ['meridian', 'lantern'])
    for (const id of movementRange(state, state.scouts[0]!.id).keys()) {
      expect(visibilityAt(state, 'meridian', id)).not.toBe('unseen')
    }
    expect(visibilityAt(state, 'lantern', state.scouts[0]!.tileId)).toBe('unseen')
    expect(findPath(state, state.scouts[0]!.id, state.scouts[1]!.tileId)).toBeUndefined()
  })
})
