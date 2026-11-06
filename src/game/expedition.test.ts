import { describe, expect, it } from 'vitest'
import { generateMap, type Terrain, type WorldMap } from './map'
import {
  applyCommand, createExpedition, findPath, knownTile, movementRange, neighbors, SCOUT, visibilityAt,
  type Command, type Expedition,
} from './expedition'

function plainMap(width = 8, height = 12, terrain: Record<number, Terrain> = {}): WorldMap {
  return Object.freeze({
    seed: 'fixture', width, height, generatorVersion: 2, rngState: 42,
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
    factions: Object.freeze([Object.freeze({ ...state.factions[0]!, fog })]),
  })
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

  it('uses N/E/S/W neighbors without wrapping rectangular map edges', () => {
    const map = plainMap()
    expect(neighbors(map, 27)).toEqual([19, 28, 35, 26])
    expect(neighbors(map, 0)).toEqual([1, 8])
    expect(neighbors(map, 7)).toEqual([15, 6])
    expect(neighbors(map, 95)).toEqual([87, 94])
    expect(neighbors(map, -1)).toEqual([])
  })

  it('resolves equal-cost A* paths by stable insertion order, not diagonal steps', () => {
    const state = fixture()
    for (let i = 0; i < 10; i++) {
      expect(findPath(state, state.scouts[0]!.id, 20)).toEqual({ path: [27, 19, 20], cost: 2 })
      expect(findPath(state, state.scouts[0]!.id, 34)).toEqual({ path: [27, 35, 34], cost: 2 })
    }
  })

  it('uses integer entry costs and finds an affordable detour around water and hills', () => {
    const state = fixture({ 28: 'water', 19: 'hills' })
    expect(findPath(state, state.scouts[0]!.id, 29)).toEqual({ path: [27, 35, 36, 37, 29], cost: 4 })
    expect(findPath(state, state.scouts[0]!.id, 19)?.cost).toBe(2)
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
    const initial = fixture({ 19: 'water', 35: 'water', 26: 'water' })
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
    const to = neighbors(state.map, state.scouts[0]!.tileId)[0]!
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
    const to = start - 16
    expect(knownTile(state, 'meridian', 0)).toBeUndefined()
    const result = applyCommand(state, move(state, to))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(visibilityAt(result.state, 'meridian', start + 16)).toBe('explored')
    expect(visibilityAt(result.state, 'meridian', to)).toBe('visible')
    expect(visibilityAt(result.state, 'meridian', 0)).toBe('unseen')
    const changed = state.map.tiles.filter(tile =>
      visibilityAt(state, 'meridian', tile.id) !== visibilityAt(result.state, 'meridian', tile.id)).map(tile => tile.id)
    expect(result.dirtyTiles).toEqual(changed)
    expect(changed.length).toBeLessThan(30)
    expect(knownTile(result.state, 'meridian', start + 16)).toBe(state.map.tiles[start + 16])
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
