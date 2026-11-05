import type { RenderStats } from './rendering/world'

declare global {
  interface Window {
    polarisDiagnostics?: {
      stats(): Partial<RenderStats> & {
        generationMs: number; renderSetupMs: number; seed?: string; width?: number; height?: number; rngState?: number
      }
      projectTile(id: number): { x: number; y: number } | undefined
      camera(): { mode: number; x: number; z: number; halfHeight: number } | undefined
    }
  }
}
