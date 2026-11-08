import type { Expedition, FactionId } from '../game/expedition'
import { MATCH_FACTIONS, openMatch, type MatchPackage } from '../game/match'

const KEY = 'polaris.match.v1'

export interface StoredMatch {
  readonly faction: FactionId
  readonly match: MatchPackage
}

export type RestoredMatch =
  | { readonly ok: true; readonly matchId: string; readonly faction: FactionId; readonly state: Expedition }
  | { readonly ok: false; readonly reason: string }

// Storage can be missing or full (private browsing); the match then simply cannot resume after a reload.
export function saveMatch(storage: Pick<Storage, 'setItem'>, stored: StoredMatch): void {
  try {
    storage.setItem(KEY, JSON.stringify(stored))
  } catch {
    // Playing on is more useful than failing an accepted order.
  }
}

export function clearMatch(storage: Pick<Storage, 'removeItem'>): void {
  try {
    storage.removeItem(KEY)
  } catch {
    // Nothing was stored that could be removed.
  }
}

// The stored history is replayed and checked like any received turn, so edited or outdated data is dropped.
export function restoreMatch(storage: Pick<Storage, 'getItem' | 'removeItem'>): RestoredMatch | undefined {
  let raw: string | null
  try {
    raw = storage.getItem(KEY)
  } catch {
    return
  }
  if (raw === null) return
  const discard = (reason: string): RestoredMatch => {
    clearMatch(storage)
    return { ok: false, reason }
  }
  let stored: unknown
  try {
    stored = JSON.parse(raw)
  } catch {
    return discard('The saved match was damaged and has been discarded.')
  }
  const faction = typeof stored === 'object' && stored !== null ? (stored as { faction?: unknown }).faction : undefined
  const match: unknown = typeof stored === 'object' && stored !== null ? (stored as { match?: unknown }).match : undefined
  const opened = openMatch(match)
  if (!opened.ok) return discard(`The saved match could not be resumed and has been discarded. ${opened.reason}`)
  if (typeof faction !== 'string' || !MATCH_FACTIONS.some(id => id === faction)) {
    return discard('The saved match did not say which side you play and has been discarded.')
  }
  return { ok: true, matchId: opened.matchId, faction: faction as FactionId, state: opened.state }
}
