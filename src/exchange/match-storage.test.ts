import { describe, expect, it } from 'vitest'
import { applyCommand, type Expedition } from '../game/expedition'
import { GENERATOR_VERSION } from '../game/map'
import { createMatch, exportMatch, MATCH_LIMITS, stateHash } from '../game/match'
import {
  currentMatchId, forgetMatch, listMatches, MATCH_NAME_LIMIT, migrateLegacyMatch, restoreMatch, saveMatch, setCurrentMatch,
  type MatchStore,
} from './match-storage'

const MATCH_ID = 'match-0123456789'
const OTHER_ID = 'match-abcdefabcd'
const PREFIX = 'polaris.matches.v1.'
const CURRENT = 'polaris.current-match.v1'
const LEGACY = 'polaris.match.v1'

function memoryStorage(initial: Record<string, string> = {}): MatchStore & { readonly items: Map<string, string> } {
  const items = new Map(Object.entries(initial))
  return {
    items,
    get length() { return items.size },
    key: index => [...items.keys()][index] ?? null,
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value) },
    removeItem: key => { items.delete(key) },
  }
}

// A match after the given number of finished turns; nobody has to move for a turn to end.
function match(turns = 1): Expedition {
  let state = createMatch({ seed: 'polaris', width: 32, height: 24 })
  for (let turn = 0; turn < turns; turn++) {
    const result = applyCommand(state, { type: 'end-turn', factionId: state.activeFaction, sequence: state.commands.length + 1 })
    if (!result.ok) throw new Error(result.reason)
    state = result.state
  }
  return state
}

describe('match storage', () => {
  it('resumes exactly the match that was saved, under its own identifier', () => {
    const storage = memoryStorage()
    const state = match()
    saveMatch(storage, { faction: 'meridian', match: exportMatch(MATCH_ID, state), name: '  Andreas ' })
    const restored = restoreMatch(storage, MATCH_ID)
    if (!restored?.ok) throw new Error('The saved match was not restored.')
    expect(restored).toMatchObject({ matchId: MATCH_ID, faction: 'meridian', name: 'Andreas' })
    expect(stateHash(restored.state)).toBe(stateHash(state))
    expect(restoreMatch(storage, OTHER_ID)).toBeUndefined()
  })

  it('keeps several matches side by side, most recent activity first, and tells whose turn it is', () => {
    const storage = memoryStorage({ unrelated: 'keep me' })
    saveMatch(storage, { faction: 'meridian', match: exportMatch(MATCH_ID, match(1)), name: 'Andreas' }, 1000)
    saveMatch(storage, { faction: 'lantern', match: exportMatch(OTHER_ID, match(4)) }, 2000)
    const world = { seed: 'polaris', width: 32, height: 24 }
    expect(listMatches(storage)).toEqual({
      matches: [
        { matchId: OTHER_ID, faction: 'lantern', name: '', savedAt: 2000, round: 3, active: 'meridian', ...world },
        { matchId: MATCH_ID, faction: 'meridian', name: 'Andreas', savedAt: 1000, round: 1, active: 'lantern', ...world },
      ],
      discarded: [], errors: [],
    })
    saveMatch(storage, { faction: 'meridian', match: exportMatch(MATCH_ID, match(2)), name: 'Andreas' }, 3000)
    expect(listMatches(storage).matches.map(item => [item.matchId, item.round, item.active]))
      .toEqual([[MATCH_ID, 2, 'meridian'], [OTHER_ID, 3, 'meridian']])
    expect(storage.items.get('unrelated')).toBe('keep me')
  })

  it('remembers which match is open and forgets one match without touching the others', () => {
    const storage = memoryStorage()
    saveMatch(storage, { faction: 'meridian', match: exportMatch(MATCH_ID, match()) })
    saveMatch(storage, { faction: 'lantern', match: exportMatch(OTHER_ID, match()) })
    expect(currentMatchId(storage)).toBeUndefined()
    setCurrentMatch(storage, OTHER_ID)
    expect(currentMatchId(storage)).toBe(OTHER_ID)
    forgetMatch(storage, MATCH_ID)
    expect(currentMatchId(storage)).toBe(OTHER_ID)
    expect(listMatches(storage).matches.map(item => item.matchId)).toEqual([OTHER_ID])
    setCurrentMatch(storage)
    expect(currentMatchId(storage)).toBeUndefined()
    expect(restoreMatch(storage, OTHER_ID)).toMatchObject({ ok: true })
    setCurrentMatch(storage, OTHER_ID)
    forgetMatch(storage, OTHER_ID)
    expect(storage.items.size).toBe(0)
  })

  it('keeps only a short local name', () => {
    const storage = memoryStorage()
    saveMatch(storage, { faction: 'meridian', match: exportMatch(MATCH_ID, match()), name: 'x'.repeat(100) })
    expect(listMatches(storage).matches[0]!.name).toBe('x'.repeat(MATCH_NAME_LIMIT))
  })

  it('discards damaged, edited or incomplete data instead of resuming it', () => {
    const good = { faction: 'meridian', match: exportMatch(MATCH_ID, match()) }
    const cases: [string, RegExp][] = [
      ['{not json', /damaged/],
      ['null', /damaged/],
      [JSON.stringify({ ...good, match: exportMatch(OTHER_ID, match()) }), /damaged/],
      [JSON.stringify({ ...good, match: { ...good.match, stateHash: '0'.repeat(14) } }), /could not be resumed.*ended differently/],
      [JSON.stringify({ ...good, faction: 'pirates' }), /did not say which side/],
      [JSON.stringify({ match: good.match }), /did not say which side/],
    ]
    for (const [raw, reason] of cases) {
      const storage = memoryStorage({ [PREFIX + MATCH_ID]: raw, [CURRENT]: MATCH_ID })
      expect(restoreMatch(storage, MATCH_ID), raw).toMatchObject({ ok: false, reason: expect.stringMatching(reason) })
      expect(storage.items.size, raw).toBe(0)
    }
  })

  it.each([3, 4, 5])('keeps generator-v%s saves unchanged and stops auto-resuming them rather than rebuilding or deleting them', generator => {
    const old = { faction: 'meridian', name: 'Earlier world', match: { ...exportMatch(MATCH_ID, match()), generator } }
    const raw = JSON.stringify(old)
    const storage = memoryStorage({ [PREFIX + MATCH_ID]: raw, [CURRENT]: MATCH_ID })
    expect(restoreMatch(storage, MATCH_ID)).toMatchObject({
      ok: false, reason: expect.stringMatching(new RegExp(`has been kept.*world generator ${generator}, but your copy uses ${GENERATOR_VERSION}`)),
    })

    expect(storage.items.get(PREFIX + MATCH_ID)).toBe(raw)
    expect(currentMatchId(storage)).toBeUndefined()
    expect(listMatches(storage).discarded).toEqual([])
    expect(listMatches(storage).matches.map(match => match.matchId)).toEqual([MATCH_ID])
    setCurrentMatch(storage, OTHER_ID)
    expect(restoreMatch(storage, MATCH_ID)).toMatchObject({ ok: false })
    expect(storage.items.get(PREFIX + MATCH_ID)).toBe(raw)
    expect(currentMatchId(storage)).toBe(OTHER_ID)
  })

  it('keeps a readable scenario-v1 turn unchanged rather than interpreting it as scenario v2', () => {
    const current = exportMatch(MATCH_ID, match())
    const old = {
      ...current,
      generator: 5,
      scenario: { version: 1, tribes: current.scenario!.tribes },
    }
    const raw = JSON.stringify({ faction: 'meridian', name: 'Earlier scenario', match: old })
    const storage = memoryStorage({ [PREFIX + MATCH_ID]: raw, [CURRENT]: MATCH_ID })
    expect(restoreMatch(storage, MATCH_ID)).toMatchObject({
      ok: false, kept: true, reason: expect.stringMatching(/world generator 5, but your copy uses 6/),
    })
    expect(storage.items.get(PREFIX + MATCH_ID)).toBe(raw)
    expect(currentMatchId(storage)).toBeUndefined()
    expect(listMatches(storage).matches.map(item => item.matchId)).toEqual([MATCH_ID])
  })

  it.each([3, 4])('keeps rules-v%s saves unchanged and listed without replaying them under new rules', rules => {
    const raw = JSON.stringify({ faction: 'meridian',
      match: { ...exportMatch(MATCH_ID, match()), rules, scenario: undefined } })
    const storage = memoryStorage({ [PREFIX + MATCH_ID]: raw, [CURRENT]: MATCH_ID })
    expect(restoreMatch(storage, MATCH_ID)).toMatchObject({
      ok: false, reason: expect.stringMatching(new RegExp(`has been kept.*game rules ${rules}.*uses 5`)),
    })
    expect(storage.items.get(PREFIX + MATCH_ID)).toBe(raw)
    expect(currentMatchId(storage)).toBeUndefined()
    expect(listMatches(storage).matches.map(match => match.matchId)).toEqual([MATCH_ID])
    expect(listMatches(storage).discarded).toEqual([])
    setCurrentMatch(storage, OTHER_ID)
    expect(restoreMatch(storage, MATCH_ID)).toMatchObject({ ok: false })
    expect(currentMatchId(storage)).toBe(OTHER_ID)
  })

  it('keeps a readable over-limit archive byte-for-byte, listed but not replayed', () => {
    const pkg = { ...exportMatch(MATCH_ID, match()),
      commands: Array.from({ length: MATCH_LIMITS.commands + 1 }, () => ['e'] as const) }
    const raw = JSON.stringify({ faction: 'meridian', match: pkg })
    const storage = memoryStorage({ [PREFIX + MATCH_ID]: raw, [CURRENT]: MATCH_ID })
    expect(listMatches(storage).matches.map(item => item.matchId)).toEqual([MATCH_ID])
    expect(restoreMatch(storage, MATCH_ID)).toMatchObject({
      ok: false, kept: true, reason: expect.stringMatching(/has been kept.*longer than 10000/),
    })
    expect(storage.items.get(PREFIX + MATCH_ID)).toBe(raw)
    expect(currentMatchId(storage)).toBeUndefined()
    setCurrentMatch(storage, OTHER_ID)
    expect(restoreMatch(storage, MATCH_ID)).toMatchObject({ ok: false, kept: true })
    expect(currentMatchId(storage)).toBe(OTHER_ID)
    expect(listMatches(storage).discarded).toEqual([])
  })

  it('reports refused writes and removals without claiming the previous save was changed', () => {
    const storage = memoryStorage()
    saveMatch(storage, { faction: 'meridian', match: exportMatch(MATCH_ID, match()) })
    setCurrentMatch(storage, MATCH_ID)
    const original = storage.items.get(PREFIX + MATCH_ID)
    storage.setItem = () => { throw new DOMException('Full', 'QuotaExceededError') }
    expect(saveMatch(storage, { faction: 'meridian', match: exportMatch(MATCH_ID, match(2)) }))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/could not be saved/) })
    expect(setCurrentMatch(storage, OTHER_ID)).toMatchObject({ ok: false })
    expect(storage.items.get(PREFIX + MATCH_ID)).toBe(original)
    expect(currentMatchId(storage)).toBe(MATCH_ID)
    const removeItem = storage.removeItem
    storage.removeItem = key => {
      if (key === CURRENT) throw new DOMException('Blocked', 'SecurityError')
      removeItem(key)
    }
    expect(forgetMatch(storage, MATCH_ID)).toMatchObject({ ok: false, reason: expect.stringMatching(/could not update/) })
    expect(storage.items.get(PREFIX + MATCH_ID)).toBe(original)
    expect(currentMatchId(storage)).toBe(MATCH_ID)
  })

  it('does not report a damaged record as discarded when removal fails', () => {
    const storage = memoryStorage({ [PREFIX + MATCH_ID]: '{bad json' })
    storage.removeItem = () => { throw new Error('blocked') }
    expect(listMatches(storage)).toEqual({
      matches: [], discarded: [], errors: [expect.stringMatching(/could not remove/)],
    })
    expect(restoreMatch(storage, MATCH_ID)).toMatchObject({
      ok: false, kept: true, reason: expect.not.stringMatching(/has been discarded/),
    })
    expect(storage.items.get(PREFIX + MATCH_ID)).toBe('{bad json')
  })

  it('drops unreadable entries from the list and says why, keeping the readable ones', () => {
    const good = { faction: 'meridian', match: exportMatch(MATCH_ID, match()) }
    const cases: [string, RegExp][] = [
      ['{not json', /damaged/],
      [JSON.stringify({ ...good, match: exportMatch(OTHER_ID, match()) }), /damaged/],
      [JSON.stringify({ ...good, faction: 'pirates' }), /which side/],
    ]
    for (const [raw, reason] of cases) {
      const storage = memoryStorage({ [PREFIX + MATCH_ID]: raw })
      saveMatch(storage, { faction: 'lantern', match: exportMatch(OTHER_ID, match()) })
      const listed = listMatches(storage)
      expect(listed.matches.map(item => item.matchId), raw).toEqual([OTHER_ID])
      expect(listed.discarded, raw).toEqual([expect.stringMatching(reason)])
      expect(storage.items.has(PREFIX + MATCH_ID), raw).toBe(false)
    }
  })

  it('moves the single match of earlier versions into the list and keeps it open', () => {
    const legacy = JSON.stringify({ faction: 'lantern', match: exportMatch(MATCH_ID, match()) })
    const storage = memoryStorage({ [LEGACY]: legacy })
    migrateLegacyMatch(storage)
    expect(storage.items.has(LEGACY)).toBe(false)
    expect(currentMatchId(storage)).toBe(MATCH_ID)
    expect(restoreMatch(storage, MATCH_ID)).toMatchObject({ ok: true, faction: 'lantern', name: '' })
    migrateLegacyMatch(storage)
    expect(listMatches(storage).matches).toHaveLength(1)

    const unreadable = memoryStorage({ [LEGACY]: '{not json' })
    migrateLegacyMatch(unreadable)
    expect(unreadable.items.size).toBe(0)

    // A full storage keeps the old entry until it can be moved.
    const full = memoryStorage({ [LEGACY]: legacy })
    full.setItem = () => { throw new Error('full') }
    expect(migrateLegacyMatch(full)).toMatchObject({ ok: false, reason: expect.stringMatching(/original record has been kept/) })
    expect(full.items.get(LEGACY)).toBe(legacy)

    const pointerBlocked = memoryStorage({ [LEGACY]: legacy })
    const setItem = pointerBlocked.setItem
    pointerBlocked.setItem = (key, value) => {
      if (key === CURRENT) throw new Error('blocked')
      setItem(key, value)
    }
    expect(migrateLegacyMatch(pointerBlocked)).toMatchObject({ ok: false })
    expect(pointerBlocked.items.get(LEGACY)).toBe(legacy)
    expect(pointerBlocked.items.get(PREFIX + MATCH_ID)).toBe(legacy)
  })

  it('keeps playing when the browser refuses to store anything', () => {
    const refuse = (): never => { throw new Error('denied') }
    const refusing: MatchStore = {
      get length(): number { return refuse() },
      key: refuse, getItem: refuse, setItem: refuse, removeItem: refuse,
    }
    expect(saveMatch(refusing, { faction: 'meridian', match: exportMatch(MATCH_ID, match()) })).toMatchObject({ ok: false })
    expect(setCurrentMatch(refusing, MATCH_ID)).toMatchObject({ ok: false })
    expect(forgetMatch(refusing, MATCH_ID)).toMatchObject({ ok: false })
    expect(() => migrateLegacyMatch(refusing)).not.toThrow()
    expect(currentMatchId(refusing)).toBeUndefined()
    expect(restoreMatch(refusing, MATCH_ID)).toBeUndefined()
    expect(listMatches(refusing)).toEqual({ matches: [], discarded: [], errors: [] })
  })
})
