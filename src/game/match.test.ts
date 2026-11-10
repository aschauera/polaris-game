import { describe, expect, it } from 'vitest'
import { applyCommand, movementRange, type Expedition, type ProductionItemId } from './expedition'
import { GENERATOR_VERSION } from './map'
import {
  compactCommand, createMatch, exportMatch, mapHash, MATCH_FORMAT, MATCH_LIMITS, matchIdOf, matchProgress, openMatch,
  receiveTurn, stateHash, type LocalMatch, type MatchPackage,
} from './match'

const MATCH_ID = 'match-0123456789'
const WORLD = { seed: 'polaris', width: 32, height: 24 }
const CHECKSUM = /^[0-9a-f]{14}$/

type Order =
  | { readonly type: 'move'; readonly unitId: string; readonly to: number }
  | { readonly type: 'found-city'; readonly founderId: string }
  | { readonly type: 'queue-production'; readonly cityId: string; readonly itemId: ProductionItemId }
  | { readonly type: 'end-turn' }

function issue(state: Expedition, order: Order): Expedition {
  const result = applyCommand(state, { ...order, factionId: state.activeFaction, sequence: state.commands.length + 1 })
  expect(result.ok, result.ok ? '' : result.reason).toBe(true)
  return result.state
}

// The first turn of each faction settles unless told otherwise; every turn moves the scout and ends.
function playTurn(state: Expedition, settle = true): Expedition {
  const faction = state.activeFaction
  let next = state
  if (settle && !next.cities.some(city => city.factionId === faction)) {
    next = issue(next, { type: 'found-city', founderId: `founder-${faction}` })
    next = issue(next, { type: 'queue-production', cityId: next.cities.find(city => city.factionId === faction)!.id, itemId: 'worker' })
  }
  return issue(step(next), { type: 'end-turn' })
}

function step(state: Expedition): Expedition {
  const scout = state.scouts.find(unit => unit.factionId === state.activeFaction)!
  const to = [...movementRange(state, scout.id).keys()].find(id => id !== scout.tileId)!
  return issue(state, { type: 'move', unitId: scout.id, to })
}

function play(turns: number): Expedition {
  let state = createMatch(WORLD)
  for (let turn = 0; turn < turns; turn++) state = playTurn(state)
  return state
}

function localMatch(state: Expedition, faction: LocalMatch['faction'], matchId = MATCH_ID): LocalMatch {
  return { matchId, faction, commands: state.commands.map(compactCommand) }
}

function failure(input: unknown): string {
  const result = openMatch(input)
  if (result.ok) throw new Error('The turn was accepted.')
  return result.reason
}

function reorder<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).reverse()) as T
}

describe('match checksums', () => {
  it('replays founder and produced-unit moves with independent movement budgets', () => {
    let state = createMatch(WORLD)
    const founder = state.founders[0]!
    const to = [...movementRange(state, founder.id).keys()].find(id => id !== founder.tileId)!
    state = issue(state, { type: 'move', unitId: founder.id, to })
    state = issue(state, { type: 'found-city', founderId: founder.id })
    state = issue(state, { type: 'queue-production', cityId: state.cities[0]!.id, itemId: 'worker' })
    for (let turn = 0; turn < 8 && (!state.units.length || state.activeFaction !== 'meridian'); turn++) {
      state = issue(state, { type: 'end-turn' })
    }
    const worker = state.units[0]!
    expect(worker).toBeDefined()
    const target = [...movementRange(state, worker.id).keys()].find(id => id !== worker.tileId)!
    state = issue(state, { type: 'move', unitId: worker.id, to: target })
    const opened = openMatch(exportMatch(MATCH_ID, state))
    expect(opened.ok).toBe(true)
    if (opened.ok) expect(opened.state).toEqual(state)
  })
  it('hashes equal worlds and states identically and any difference differently', () => {
    const state = createMatch(WORLD)
    expect(mapHash(state.map)).toMatch(CHECKSUM)
    expect(stateHash(state)).toMatch(CHECKSUM)
    expect(mapHash(createMatch(WORLD).map)).toBe(mapHash(state.map))
    expect(stateHash(createMatch(WORLD))).toBe(stateHash(state))
    expect(mapHash(createMatch({ ...WORLD, seed: 'aurora' }).map)).not.toBe(mapHash(state.map))
    expect(mapHash(createMatch({ ...WORLD, width: 33 }).map)).not.toBe(mapHash(state.map))
    expect(stateHash(playTurn(state))).not.toBe(stateHash(state))
  })

  it('does not depend on the order in which object properties were created', () => {
    const state = play(3)
    const scrambled: Expedition = {
      ...state,
      scouts: state.scouts.map(reorder),
      cities: state.cities.map(city => reorder({ ...city, production: city.production && reorder(city.production) })),
      factions: state.factions.map(faction => reorder({ ...faction, fog: reorder(faction.fog) })),
    }
    expect(stateHash(scrambled)).toBe(stateHash(state))
  })

  it('notices a single changed tile, unit or counter', () => {
    const state = play(3)
    const scout = state.scouts[0]!
    const moved = { ...state, scouts: [{ ...scout, tileId: scout.tileId + 1 }, ...state.scouts.slice(1)] }
    const tile = state.map.tiles[0]!
    const raised = { ...state.map, tiles: [{ ...tile, elevation: tile.elevation + 1 }, ...state.map.tiles.slice(1)] }
    expect(stateHash(moved)).not.toBe(stateHash(state))
    expect(stateHash({ ...state, round: state.round + 1 })).not.toBe(stateHash(state))
    expect(stateHash({ ...state, nextUnitId: state.nextUnitId + 1 })).not.toBe(stateHash(state))
    expect(mapHash(raised)).not.toBe(mapHash(state.map))
  })
})

describe('exporting and opening a match', () => {
  it('describes a started match with two factions, Meridian moving first', () => {
    const state = createMatch(WORLD)
    expect(state.factions.map(faction => faction.id)).toEqual(['meridian', 'lantern'])
    expect(state.activeFaction).toBe('meridian')
  })

  it('transports the seed and the ordered history instead of the world', () => {
    const state = play(2)
    const pkg = exportMatch(MATCH_ID, state)
    expect(pkg).toMatchObject({
      format: MATCH_FORMAT, matchId: MATCH_ID, rules: state.rulesVersion, generator: GENERATOR_VERSION, seed: 'polaris', width: 32, height: 24,
      factions: ['meridian', 'lantern'], mapHash: mapHash(state.map), stateHash: stateHash(state),
    })
    expect(pkg.commands).toHaveLength(state.commands.length)
    expect(pkg.commands.map(order => order[0])).toEqual(expect.arrayContaining(['m', 'f', 'q', 'e']))
    expect(Object.isFrozen(pkg)).toBe(true)
    expect(JSON.stringify(pkg).length).toBeLessThan(1000)
  })

  it('encodes every kind of order without its faction or sequence number', () => {
    const base = { factionId: 'meridian', sequence: 7 } as const
    expect(compactCommand({ ...base, type: 'move', unitId: 'scout-meridian', to: 12 })).toEqual(['m', 'scout-meridian', 12])
    expect(compactCommand({ ...base, type: 'found-city', founderId: 'founder-meridian' })).toEqual(['f', 'founder-meridian'])
    expect(compactCommand({ ...base, type: 'queue-production', cityId: 'city-meridian-1', itemId: 'guard' }))
      .toEqual(['q', 'city-meridian-1', 'guard'])
    expect(compactCommand({ ...base, type: 'end-turn' })).toEqual(['e'])
  })

  it('replays a message that went through JSON to exactly the same state', () => {
    const state = play(4)
    const pkg = exportMatch(MATCH_ID, state)
    const opened = openMatch(JSON.parse(JSON.stringify(pkg)))
    if (!opened.ok) throw new Error(opened.reason)
    expect(opened.matchId).toBe(MATCH_ID)
    expect(opened.state).toEqual(state)
    expect(stateHash(opened.state)).toBe(pkg.stateHash)
    expect(opened.commands).toEqual(pkg.commands)
  })

  it('opens a match that has not started yet and a long match alike', () => {
    for (const turns of [0, 150]) {
      const state = play(turns)
      const opened = openMatch(exportMatch(MATCH_ID, state))
      if (!opened.ok) throw new Error(opened.reason)
      expect(stateHash(opened.state)).toBe(stateHash(state))
      expect(opened.state.commands).toHaveLength(state.commands.length)
    }
  })
})

describe('rejecting turns that cannot be trusted', () => {
  const pkg = exportMatch(MATCH_ID, play(3))
  const edit = (changes: Partial<Record<keyof MatchPackage, unknown>>) => ({ ...pkg, ...changes })

  it('rejects input that is not a Polaris turn', () => {
    for (const input of [undefined, null, 42, 'text', [], {}, edit({ format: MATCH_FORMAT + 1 })]) {
      expect(failure(input)).toMatch(/not a Polaris turn/)
    }
  })

  it('rejects another version of the rules or of the world generator', () => {
    expect(failure(edit({ rules: pkg.rules - 1 }))).toMatch(/game rules .* same version/)
    expect(failure(edit({ generator: pkg.generator + 1 }))).toMatch(/world generator .* same version/)
    expect(failure(edit({ generator: 3 }))).toMatch(/world generator 3, but your copy uses 4/)
  })

  it('rejects a world this device does not generate identically', () => {
    expect(failure(edit({ mapHash: '0'.repeat(14) }))).toMatch(/different world/)
    expect(failure(edit({ seed: 'aurora' }))).toMatch(/different world/)
    expect(failure(edit({ width: 33 }))).toMatch(/different world/)
  })

  it('rejects world settings the game would never create', () => {
    expect(failure(edit({ width: 4 }))).toMatch(/whole numbers from 8 to 256/)
    expect(failure(edit({ height: 1.5 }))).toMatch(/whole numbers from 8 to 256/)
    expect(failure(edit({ seed: 'two words' }))).toMatch(/Seed must contain/)
    expect(failure(edit({ seed: 7, mapHash: pkg.mapHash }))).toMatch(/does not describe a world/)
  })

  it('rejects missing or malformed identifiers, checksums and factions', () => {
    for (const matchId of [undefined, 'short', 'has spaces in it', 'x'.repeat(65)]) {
      expect(failure(edit({ matchId }))).toMatch(/match identifier/)
    }
    for (const checksum of [undefined, 'abc', 'G'.repeat(14), '0'.repeat(15)]) {
      expect(failure(edit({ stateHash: checksum }))).toMatch(/checksums/)
      expect(failure(edit({ mapHash: checksum }))).toMatch(/checksums/)
    }
    for (const factions of [undefined, [], ['meridian'], ['lantern', 'meridian'], ['meridian', 'meridian'], ['meridian', 'pirates']]) {
      expect(failure(edit({ factions }))).toMatch(/factions/)
    }
  })

  it('rejects results that differ from what this device replays', () => {
    expect(failure(edit({ stateHash: '0'.repeat(14) }))).toMatch(/ended differently/)
    const dropped = pkg.commands.filter(order => order[0] !== 'q')
    expect(failure(edit({ commands: dropped }))).toMatch(/rejected|ended differently/)
  })

  it('rejects altered orders', () => {
    const index = pkg.commands.findIndex(order => order[0] === 'm')
    const altered = pkg.commands.map((order, position) => position === index && order[0] === 'm' ? ['m', order[1], 0] : order)
    expect(openMatch(edit({ commands: altered })).ok).toBe(false)
    expect(failure(edit({ commands: [...pkg.commands.slice(0, -1)] }))).toMatch(/ended differently/)
  })

  it('rejects orders for units of the faction that is not moving', () => {
    const forged = edit({ commands: [['m', 'scout-lantern', 1]] })
    expect(failure(forged)).toMatch(/Order 1 was rejected: Choose a unit belonging to the active faction/)
  })

  it('rejects malformed orders by position', () => {
    const malformed: unknown[] = [
      ['x'], 'e', [], ['e', 1], ['f'], ['f', ''], ['f', 'x'.repeat(MATCH_LIMITS.text + 1)], ['f', 3],
      ['m', 'scout-meridian'], ['m', 'scout-meridian', '5'], ['m', 'scout-meridian', 1.5], ['m', 'scout-meridian', 1, 2],
      ['q', 'city-meridian-1'], ['q', 'city-meridian-1', 'sword'], ['q', 'city-meridian-1', '__proto__'],
    ]
    for (const order of malformed) {
      expect(failure(edit({ commands: [['e'], order] }))).toMatch(/^Order 2 is not a Polaris order/)
    }
  })

  it('rejects an oversized history before replaying any of it', () => {
    const history = Array.from({ length: MATCH_LIMITS.commands + 1 }, () => ['e'])
    expect(failure(edit({ commands: history }))).toMatch(/longer than/)
    expect(failure(edit({ commands: 'e' }))).toMatch(/longer than/)
  })
})

describe('receiving the opponent turn', () => {
  const host = play(1)
  const guest = playTurn(host)
  const first = exportMatch(MATCH_ID, host)
  const reply = exportMatch(MATCH_ID, guest)

  it('lets a device without a match join as the faction whose turn it is', () => {
    const received = receiveTurn(first)
    if (!received.ok) throw new Error(received.reason)
    expect(received.faction).toBe('lantern')
    expect(received.newOrders).toBe(host.commands.length)
    expect(received.matchId).toBe(MATCH_ID)
    expect(received.state).toEqual(host)
  })

  it('continues a running match and counts only the new orders', () => {
    const received = receiveTurn(reply, localMatch(host, 'meridian'))
    if (!received.ok) throw new Error(received.reason)
    expect(received.faction).toBe('meridian')
    expect(received.newOrders).toBe(guest.commands.length - host.commands.length)
    expect(received.state).toEqual(guest)
    expect(stateHash(received.state)).toBe(reply.stateHash)
  })

  it('also lets the player who lost the local match resume from the latest message', () => {
    const received = receiveTurn(reply)
    if (!received.ok) throw new Error(received.reason)
    expect(received.faction).toBe('meridian')
    expect(received.newOrders).toBe(guest.commands.length)
  })

  it('treats a repeated or older turn as harmless and already known', () => {
    for (const [pkg, local, text] of [
      [reply, localMatch(guest, 'lantern'), /already have this turn/],
      [first, localMatch(host, 'meridian'), /already have this turn/],
      [first, localMatch(guest, 'lantern'), /older turn/],
    ] as const) {
      expect(receiveTurn(pkg, local)).toMatchObject({ ok: false, kind: 'known', reason: expect.stringMatching(text) })
    }
  })

  it('keeps a running match apart from a turn that belongs to another match', () => {
    expect(receiveTurn(reply, localMatch(host, 'meridian', 'another-match-id')))
      .toMatchObject({ ok: false, kind: 'other-match', reason: expect.stringMatching(/different match/) })
  })

  it('refuses a turn whose earlier orders differ from the local history', () => {
    const elsewhere = localMatch(playTurn(createMatch(WORLD), false), 'meridian')
    expect(receiveTurn(reply, elsewhere))
      .toMatchObject({ ok: false, kind: 'invalid', reason: expect.stringMatching(/earlier orders differ/) })
  })

  it('refuses a turn that gives orders for the receiving faction', () => {
    expect(receiveTurn(first, localMatch(createMatch(WORLD), 'meridian')))
      .toMatchObject({ ok: false, kind: 'invalid', reason: expect.stringMatching(/only you may give/) })
  })

  it('refuses a turn that is not finished', () => {
    const unfinished = exportMatch(MATCH_ID, step(createMatch(WORLD)))
    for (const pkg of [unfinished, exportMatch(MATCH_ID, createMatch(WORLD))]) {
      expect(receiveTurn(pkg)).toMatchObject({ ok: false, kind: 'invalid', reason: expect.stringMatching(/finished turn/) })
    }
  })

  it('reports damaged turns as invalid instead of throwing', () => {
    expect(receiveTurn({ format: 9 })).toMatchObject({ ok: false, kind: 'invalid' })
    expect(receiveTurn({ ...first, stateHash: '0'.repeat(14) }, localMatch(host, 'meridian')))
      .toMatchObject({ ok: false, kind: 'invalid', reason: expect.stringMatching(/ended differently/) })
  })
})

describe('reading a package without replaying it', () => {
  it('tells the round and the side on turn exactly as the replay does', () => {
    for (const turns of [0, 1, 2, 3, 8]) {
      const state = play(turns)
      expect(matchProgress(exportMatch(MATCH_ID, state)), `${turns} turns`).toEqual({ round: state.round, active: state.activeFaction })
    }
    const moving = step(play(3))
    expect(matchProgress(exportMatch(MATCH_ID, moving))).toEqual({ round: moving.round, active: moving.activeFaction })
  })

  it('reads the match identifier only from a well-formed package', () => {
    expect(matchIdOf(exportMatch(MATCH_ID, createMatch(WORLD)))).toBe(MATCH_ID)
    for (const input of [undefined, null, 'text', [], {}, { matchId: 42 }, { matchId: 'short' }, { matchId: 'has spaces in it' }]) {
      expect(matchIdOf(input)).toBeUndefined()
    }
  })
})
