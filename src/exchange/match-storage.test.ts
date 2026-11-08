import { describe, expect, it } from 'vitest'
import { applyCommand, type Expedition } from '../game/expedition'
import { createMatch, exportMatch, stateHash } from '../game/match'
import { clearMatch, restoreMatch, saveMatch } from './match-storage'

const MATCH_ID = 'match-0123456789'
type Store = Parameters<typeof restoreMatch>[0] & Parameters<typeof saveMatch>[0]

function memoryStorage(initial: Record<string, string> = {}): Store & { readonly items: Map<string, string> } {
  const items = new Map(Object.entries(initial))
  return {
    items,
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value) },
    removeItem: key => { items.delete(key) },
  }
}

function match(): Expedition {
  const state = createMatch({ seed: 'polaris', width: 32, height: 24 })
  const result = applyCommand(state, { type: 'end-turn', factionId: 'meridian', sequence: 1 })
  if (!result.ok) throw new Error(result.reason)
  return result.state
}

const KEY = 'polaris.match.v1'

describe('match storage', () => {
  it('resumes exactly the match that was saved', () => {
    const storage = memoryStorage()
    const state = match()
    saveMatch(storage, { faction: 'meridian', match: exportMatch(MATCH_ID, state) })
    const restored = restoreMatch(storage)
    if (!restored?.ok) throw new Error('The saved match was not restored.')
    expect(restored.matchId).toBe(MATCH_ID)
    expect(restored.faction).toBe('meridian')
    expect(stateHash(restored.state)).toBe(stateHash(state))
  })

  it('has nothing to resume without a saved match and after clearing it', () => {
    const storage = memoryStorage()
    expect(restoreMatch(storage)).toBeUndefined()
    saveMatch(storage, { faction: 'lantern', match: exportMatch(MATCH_ID, match()) })
    clearMatch(storage)
    expect(storage.items.size).toBe(0)
    expect(restoreMatch(storage)).toBeUndefined()
  })

  it('discards damaged, edited or incomplete data instead of resuming it', () => {
    const good = { faction: 'meridian', match: exportMatch(MATCH_ID, match()) }
    const cases: [string, RegExp][] = [
      ['{not json', /damaged/],
      ['null', /could not be resumed/],
      [JSON.stringify({ ...good, match: { ...good.match, stateHash: '0'.repeat(14) } }), /could not be resumed.*ended differently/],
      [JSON.stringify({ ...good, match: { ...good.match, rules: 1 } }), /could not be resumed.*game rules/],
      [JSON.stringify({ ...good, faction: 'pirates' }), /did not say which side/],
      [JSON.stringify({ match: good.match }), /did not say which side/],
    ]
    for (const [raw, reason] of cases) {
      const storage = memoryStorage({ [KEY]: raw })
      expect(restoreMatch(storage), raw).toMatchObject({ ok: false, reason: expect.stringMatching(reason) })
      expect(storage.items.has(KEY)).toBe(false)
    }
  })

  it('keeps playing when the browser refuses to store anything', () => {
    const refusing: Store = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('full') },
      removeItem: () => { throw new Error('denied') },
    }
    expect(() => saveMatch(refusing, { faction: 'meridian', match: exportMatch(MATCH_ID, match()) })).not.toThrow()
    expect(() => clearMatch(refusing)).not.toThrow()
    expect(restoreMatch(refusing)).toBeUndefined()
  })
})
