export const TERRAIN = {
  grassland: { name: 'Grassland', height: 0.65 },
  water: { name: 'Water', height: 0.25 },
  hills: { name: 'Hills', height: 1.35 },
} as const

export type Terrain = keyof typeof TERRAIN
export interface MapConfig { seed: string; width: number; height: number }
export interface Tile { readonly id: number; readonly x: number; readonly z: number; readonly terrain: Terrain }
export interface WorldMap extends MapConfig {
  readonly generatorVersion: 1
  readonly rngState: number
  readonly tiles: readonly Tile[]
}

export function validateConfig(config: MapConfig): void {
  if (typeof config.seed !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(config.seed)) {
    throw new Error('Seed must contain 1–64 letters, digits, underscores or hyphens.')
  }
  for (const value of [config.width, config.height]) {
    if (!Number.isInteger(value) || value < 8 || value > 256) {
      throw new Error('Width and height must be whole numbers from 8 to 256.')
    }
  }
}

// FNV-1a seed hash and Mulberry32 transitions use explicit unsigned 32-bit arithmetic.
export function seedState(seed: string): number {
  let state = 2166136261
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619) >>> 0
  return state
}

export function randomStep(state: number): { state: number; value: number } {
  const next = (state + 0x6d2b79f5) >>> 0
  let value = Math.imul(next ^ (next >>> 15), next | 1)
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
  return { state: next, value: ((value ^ (value >>> 14)) >>> 0) / 4294967296 }
}

export function tileAt(map: WorldMap, x: number, z: number): Tile | undefined {
  if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || z < 0 || x >= map.width || z >= map.height) return
  return map.tiles[z * map.width + x]
}

export function generateMap(config: MapConfig): WorldMap {
  validateConfig(config)
  let state = seedState(config.seed)
  const tiles: Tile[] = []
  for (let z = 0; z < config.height; z++) {
    for (let x = 0; x < config.width; x++) {
      const step = randomStep(state)
      state = step.state
      // Broad deterministic bands give the atlas readable coasts without a climate simulation.
      const coast = ((Math.floor(x / 4) + Math.floor(z / 6)) % 4 - 1.5) * 0.06
      const terrain: Terrain = step.value < 0.24 + coast ? 'water' : step.value > 0.79 ? 'hills' : 'grassland'
      tiles.push(Object.freeze({ id: z * config.width + x, x, z, terrain }))
    }
  }
  return Object.freeze({ ...config, generatorVersion: 1, rngState: state, tiles: Object.freeze(tiles) })
}
