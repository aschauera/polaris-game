import type { Expedition, FactionId } from '../game/expedition'
import { MATCH_FACTIONS, matchIdOf, matchProgress, openMatch, parseMatch, type MatchPackage } from '../game/match'

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
  | { readonly ok: false; readonly reason: string }

type Entry = { readonly faction?: unknown; readonly match?: unknown; readonly name?: unknown; readonly savedAt?: unknown }

// Storage can be missing, full or blocked (private browsing); playing on beats failing an accepted order.
function attempt<T>(action: () => T): T | undefined {
  try {
    return action()
  } catch {
    return undefined
  }
}

const isFaction = (value: unknown): value is FactionId => typeof value === 'string' && MATCH_FACTIONS.some(id => id === value)
const nameOf = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, MATCH_NAME_LIMIT) : ''
const read = (storage: Pick<Storage, 'getItem'>, key: string) => attempt(() => storage.getItem(key)) ?? undefined

function readEntry(raw: string): Entry | undefined {
  const value: unknown = attempt(() => JSON.parse(raw))
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Entry : undefined
}

export function saveMatch(storage: Pick<Storage, 'setItem'>, stored: StoredMatch, savedAt = Date.now()): void {
  attempt(() => storage.setItem(PREFIX + stored.match.matchId, JSON.stringify({ ...stored, name: nameOf(stored.name), savedAt })))
}

// The current match reopens after a reload; without one the player starts at the atlas and the match list.
export function currentMatchId(storage: Pick<Storage, 'getItem'>): string | undefined {
  return read(storage, CURRENT)
}

export function setCurrentMatch(storage: Pick<Storage, 'setItem' | 'removeItem'>, matchId?: string): void {
  attempt(() => matchId ? storage.setItem(CURRENT, matchId) : storage.removeItem(CURRENT))
}

export function forgetMatch(storage: Store, matchId: string): void {
  attempt(() => storage.removeItem(PREFIX + matchId))
  if (currentMatchId(storage) === matchId) setCurrentMatch(storage)
}

// The stored history is replayed and checked like any received turn, so edited or outdated data is dropped.
export function restoreMatch(storage: Store, matchId: string): RestoredMatch | undefined {
  const raw = read(storage, PREFIX + matchId)
  if (raw === undefined) return
  const discard = (reason: string): RestoredMatch => {
    forgetMatch(storage, matchId)
    return { ok: false, reason }
  }
  const entry = readEntry(raw)
  if (!entry) return discard('The saved match was damaged and has been discarded.')
  const opened = openMatch(entry.match)
  if (!opened.ok) return discard(`The saved match could not be resumed and has been discarded. ${opened.reason}`)
  if (opened.matchId !== matchId) return discard('The saved match was damaged and has been discarded.')
  if (!isFaction(entry.faction)) return discard('The saved match did not say which side you play and has been discarded.')
  return { ok: true, matchId, faction: entry.faction, name: nameOf(entry.name), state: opened.state }
}

function summarize(matchId: string, raw: string): MatchSummary | string {
  const entry = readEntry(raw)
  if (!entry) return 'It was damaged.'
  const parsed = parseMatch(entry.match)
  if (!parsed.ok) return parsed.reason
  if (parsed.value.matchId !== matchId) return 'It was damaged.'
  if (!isFaction(entry.faction)) return 'It did not say which side you play.'
  const { seed, width, height } = parsed.value
  const savedAt = typeof entry.savedAt === 'number' && Number.isFinite(entry.savedAt) ? entry.savedAt : 0
  return { matchId, faction: entry.faction, name: nameOf(entry.name), savedAt, ...matchProgress(parsed.value), seed, width, height }
}

// Lists without replaying, so many matches list quickly; each one is fully verified when it is resumed.
// Entries that cannot even be read are discarded, and their reasons returned so the player is told.
export function listMatches(storage: MatchStore): { readonly matches: readonly MatchSummary[]; readonly discarded: readonly string[] } {
  const ids: string[] = []
  attempt(() => {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index)
      if (key?.startsWith(PREFIX)) ids.push(key.slice(PREFIX.length))
    }
  })
  const matches: MatchSummary[] = []
  const discarded: string[] = []
  for (const matchId of ids) {
    const raw = read(storage, PREFIX + matchId)
    if (raw === undefined) continue
    const summary = summarize(matchId, raw)
    if (typeof summary !== 'string') { matches.push(summary); continue }
    forgetMatch(storage, matchId)
    discarded.push(summary)
  }
  matches.sort((left, right) => right.savedAt - left.savedAt || left.matchId.localeCompare(right.matchId))
  return { matches, discarded }
}

// Moves the single match of earlier versions into the list and keeps it as the current match.
export function migrateLegacyMatch(storage: Store): void {
  const raw = read(storage, LEGACY)
  if (raw === undefined) return
  const matchId = matchIdOf(readEntry(raw)?.match)
  if (matchId && read(storage, PREFIX + matchId) === undefined) {
    if (!attempt(() => { storage.setItem(PREFIX + matchId, raw); return true })) return
    setCurrentMatch(storage, matchId)
  }
  attempt(() => storage.removeItem(LEGACY))
}
