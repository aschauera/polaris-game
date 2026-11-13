import type { RenderStats } from './rendering/world'
import type { City, FactionId, Founder, ProducedUnit, Scout, Visibility } from './game/expedition'
import type { Scenario } from './game/scenario'

declare global {
  interface Window {
    polarisDiagnostics?: {
      stats(): Partial<RenderStats> & {
        generationMs: number; renderSetupMs: number; seed?: string; width?: number; height?: number; rngState?: number
      }
      projectTile(id: number): { x: number; y: number } | undefined
      camera(): { mode: number; x: number; z: number; halfHeight: number } | undefined
      /** Shows holders on the open scenario's lighthouses (null = neutral) without touching the match; false without one. */
      previewBeaconHolders(holders: readonly (FactionId | null)[]): boolean
      expedition(): {
        round: number; movement: number; scoutTileId: number; commandCount: number
        scouts: readonly Scout[]; founders: readonly Founder[]; cities: readonly City[]; units: readonly ProducedUnit[]
        selectedUnitId?: string; selectedCityId?: string; selectedReachable: readonly number[]
        fog: Readonly<Record<number, Exclude<Visibility, 'unseen'>>>
        reachable: readonly number[]
      } | undefined
      match(): {
        id: string; faction: FactionId; name: string; active: FactionId; commandCount: number; stateHash: string
        scenario?: Scenario
      } | undefined
    }
  }
}
