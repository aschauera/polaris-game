import type { RenderStats } from './rendering/world'
import type { Visibility } from './game/expedition'

declare global {
  interface Window {
    polarisDiagnostics?: {
      stats(): Partial<RenderStats> & {
        generationMs: number; renderSetupMs: number; seed?: string; width?: number; height?: number; rngState?: number
      }
      projectTile(id: number): { x: number; y: number } | undefined
      camera(): { mode: number; x: number; z: number; halfHeight: number } | undefined
      expedition(): {
        round: number; movement: number; scoutTileId: number; commandCount: number
        fog: Readonly<Record<number, Exclude<Visibility, 'unseen'>>>
        reachable: readonly number[]
      } | undefined
    }
  }
}
