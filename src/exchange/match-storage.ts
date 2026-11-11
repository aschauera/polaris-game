import { RULES_VERSION, type Expedition, type FactionId } from '../game/expedition'
import { GENERATOR_VERSION } from '../game/map'
import { MATCH_FACTIONS, MATCH_LIMITS, matchIdOf, matchProgress, openMatch, parseStoredMatch, type MatchPackage } from '../game/match'

// Every match has its own entry, so saving one never rewrites the others and damage costs only that match.
const PREFIX = 'polaris.matches.v1.'
const CURRENT = 'polaris.current-match.v1'
// Before several matches were kept, the one running match was stored under this key.
const LEGACY = 'polaris.match.v1'
export const MATCH_NAME_LIMIT = 40

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type MatchStore = Store & Pick<Storage, 'key' | 'length'>

export interface StoredMatch {
  readonly faction: FactionId
  readonly match: MatchPackage
  // A label only this device knows, such as the opponent's name.
  readonly name?: string
}

export interface MatchSummary {
  readonly matchId: string
  readonly faction: FactionId
  readonly name: string
  readonly savedAt: number
  readonly round: number
  readonly active: FactionId
  readonly seed: string
  readonly width: number
  readonly height: number
}

export type RestoredMatch =
  | { readonly ok: true; readonly matchId: string; readonly faction: FactionId; readonly name: string; readonly state: Expedition }
  | { readonly ok: false; readonly reason: string; readonly kept: boolean }

export type StorageResult = { readonly ok: true } | { readonly ok: false; readonly reason: string }

type Entry = { readonly faction?: unknown; readonly match?: unknown; readonly name?: unknown; readonly savedAt?: unknown }

// Reading unavailable storage or malformed JSON is handled by the caller.
function attempt<T>(action: () => T): T | undefined {
  try {
    return action()
  } catch {
    return undefined
  }
}

function changeStorage(action: () => void, reason: string): StorageResult {
  try {
    action()
    return { ok: true }
  } catch {
    return { ok: false, reason }
  }
}

const isFaction = (value: unknown): value is FactionId => typeof value === 'string' && MATCH_FACTIONS.some(id => id === value)
const nameOf = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, MATCH_NAME_LIMIT) : ''
const read = (storage: Pick<Storage, 'getItem'>, key: string) => attempt(() => storage.getItem(key)) ?? undefined

function readEntry(raw: string): Entry | undefined {
  const value: unknown = attempt(() => JSON.parse(raw))
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Entry : undefined
}

export function saveMatch(storage: Pick<Storage, 'setItem'>, stored: StoredMatch, savedAt = Date.now()): StorageResult {
  return changeStorage(
    () => storage.setItem(PREFIX + stored.match.matchId, JSON.stringify({ ...stored, name: nameOf(stored.name), savedAt })),
    'The match could not be saved. Browser storage may be full or blocked.',
  )
}

// The current match reopens after a reload; without one the player starts at the atlas and the match list.
export function currentMatchId(storage: Pick<Storage, 'getItem'>): string | undefined {
  return read(storage, CURRENT)
}

export function setCurrentMatch(storage: Pick<Storage, 'setItem' | 'removeItem'>, matchId?: string): StorageResult {
  return changeStorage(
    () => matchId ? storage.setItem(CURRENT, matchId) : storage.removeItem(CURRENT),
    'The browser could not update which match reopens after a reload.',
  )
}

export function forgetMatch(storage: Store, matchId: string): StorageResult {
  if (currentMatchId(storage) === matchId) {
    const cleared = setCurrentMatch(storage)
    if (!cleared.ok) return cleared
  }
  return changeStorage(() => storage.removeItem(PREFIX + matchId),
    'The browser could not remove this saved match.')
}

// Replay stored history like a received turn; keep incompatible worlds rather than deleting valid older matches.
export function restoreMatch(storage: Store, matchId: string): RestoredMatch | undefined {
  const raw = read(storage, PREFIX + matchId)
  if (raw === undefined) return
  const discard = (reason: string): RestoredMatch => {
    const removed = forgetMatch(storage, matchId)
    return { ok: false, kept: !removed.ok, reason: `${reason} ${removed.ok ? 'It has been discarded.' : removed.reason}` }
  }
  const entry = readEntry(raw)
  if (!entry) return discard('The saved match was damaged.')
  const opened = openMatch(entry.match)
  if (!opened.ok) {
    const parsed = parseStoredMatch(entry.match)
    if (parsed.ok && parsed.value.matchId === matchId && isFaction(entry.faction)
      && (parsed.value.generator !== GENERATOR_VERSION || parsed.value.rules !== RULES_VERSION
        || parsed.value.commands.length > MATCH_LIMITS.commands)) {
      const cleared = currentMatchId(storage) === matchId ? setCurrentMatch(storage) : { ok: true } as const
      return { ok: false, kept: true,
        reason: `The saved match has been kept, but cannot be resumed in this version. ${opened.reason}` +
          (cleared.ok ? '' : ` ${cleared.reason}`) }
    }
    return discard(`The saved match could not be resumed. ${opened.reason}`)
  }
  if (opened.matchId !== matchId) return discard('The saved match was damaged.')
  if (!isFaction(entry.faction)) return discard('The saved match did not say which side you play.')
  return { ok: true, matchId, faction: entry.faction, name: nameOf(entry.name), state: opened.state }
}

function summarize(matchId: string, raw: string): MatchSummary | string {
  const entry = readEntry(raw)
  if (!entry) return 'It was damaged.'
  const parsed = parseStoredMatch(entry.match)
  if (!parsed.ok) return parsed.reason
  if (parsed.value.matchId !== matchId) return 'It was damaged.'
  if (!isFaction(entry.faction)) return 'It did not say which side you play.'
  const { seed, width, height } = parsed.value
  const savedAt = typeof entry.savedAt === 'number' && Number.isFinite(entry.savedAt) ? entry.savedAt : 0
  return { matchId, faction: entry.faction, name: nameOf(entry.name), savedAt, ...matchProgress(parsed.value), seed, width, height }
}

// Lists without replaying, so many matches list quickly; each one is fully verified when it is resumed.
// Entries that cannot even be read are discarded, and their reasons returned so the player is told.
export function listMatches(storage: MatchStore): {
  readonly matches: readonly MatchSummary[]; readonly discarded: readonly string[]; readonly errors: readonly string[]
} {
  const ids: string[] = []
  attempt(() => {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index)
      if (key?.startsWith(PREFIX)) ids.push(key.slice(PREFIX.length))
    }
  })
  const matches: MatchSummary[] = []
  const discarded: string[] = []
  const errors: string[] = []
  for (const matchId of ids) {
    const raw = read(storage, PREFIX + matchId)
    if (raw === undefined) continue
    const summary = summarize(matchId, raw)
    if (typeof summary !== 'string') { matches.push(summary); continue }
    const removed = forgetMatch(storage, matchId)
    if (removed.ok) discarded.push(summary)
    else errors.push(removed.reason)
  }
  matches.sort((left, right) => right.savedAt - left.savedAt || left.matchId.localeCompare(right.matchId))
  return { matches, discarded, errors }
}

// Moves the single match of earlier versions into the list and keeps it as the current match.
export function migrateLegacyMatch(storage: Store): StorageResult {
  const raw = read(storage, LEGACY)
  if (raw === undefined) return { ok: true }
  const matchId = matchIdOf(readEntry(raw)?.match)
  if (matchId && read(storage, PREFIX + matchId) === undefined) {
    const copied = changeStorage(() => storage.setItem(PREFIX + matchId, raw),
      'The previous save could not be moved to Your matches. Its original record has been kept.')
    if (!copied.ok) return copied
    const current = setCurrentMatch(storage, matchId)
    if (!current.ok) return current
  }
  return changeStorage(() => storage.removeItem(LEGACY), 'The browser could not remove the previous save after migration.')
}
