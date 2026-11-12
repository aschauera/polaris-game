import { HEX_ROW, hexCenter, hexOffsets } from './hex'

export const TERRAIN = {
  grassland: { name: 'Grassland', height: 0.65 },
  water: { name: 'Water', height: 0.25 },
  hills: { name: 'Hills', height: 0.65 },
} as const

export type Terrain = keyof typeof TERRAIN
export const WATER_DEPTH = {
  shallow: { name: 'Shallows' },
  shoal: { name: 'Shoal' },
  shelf: { name: 'Shelf' },
  deep: { name: 'Deep water' },
} as const
export type WaterDepth = keyof typeof WATER_DEPTH
export interface MapConfig { seed: string; width: number; height: number }
interface TerrainTile {
  readonly id: number
  readonly x: number
  readonly z: number
  readonly terrain: Terrain
  readonly elevation: number
  readonly trees: number
}
export type Tile = TerrainTile & (
  { readonly terrain: 'water'; readonly waterDepth: WaterDepth }
  | { readonly terrain: 'grassland' | 'hills'; readonly waterDepth?: never }
)
export const GENERATOR_VERSION = 5
export interface WorldMap extends MapConfig {
  readonly generatorVersion: typeof GENERATOR_VERSION
  readonly rngState: number
  readonly tiles: readonly Tile[]
}

interface Landform {
  x: number; z: number; radiusX: number; radiusZ: number; angle: number
  bay?: { angle: number; width: number; bend: number }
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

function hash(seed: number, x: number, z: number): number {
  let value = seed ^ Math.imul(x, 0x1f123bb5) ^ Math.imul(z, 0x5f356495)
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d)
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b)
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296
}

function smooth(value: number): number { return value * value * (3 - 2 * value) }

function noise(seed: number, x: number, z: number, spacing: number): number {
  const gx = x / spacing, gz = z / spacing
  const x0 = Math.floor(gx), z0 = Math.floor(gz)
  const tx = smooth(gx - x0), tz = smooth(gz - z0)
  const top = hash(seed, x0, z0) * (1 - tx) + hash(seed, x0 + 1, z0) * tx
  const bottom = hash(seed, x0, z0 + 1) * (1 - tx) + hash(seed, x0 + 1, z0 + 1) * tx
  return top * (1 - tz) + bottom * tz
}

function localPoint(form: Landform, x: number, z: number): [number, number] {
  const dx = x - form.x, dz = z - form.z
  const cos = Math.cos(form.angle), sin = Math.sin(form.angle)
  const rotatedX = dx * cos - dz * sin
  const rotatedZ = dx * sin + dz * cos
  return [rotatedX / form.radiusX, rotatedZ / form.radiusZ]
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function addBathymetry(config: MapConfig, tiles: readonly TerrainTile[], seed: number): readonly Tile[] {
  const { width, height } = config
  const distance = new Uint16Array(tiles.length).fill(0xffff)
  const queue = new Uint32Array(tiles.length)
  let end = 0
  for (const tile of tiles) if (tile.terrain !== 'water') {
    distance[tile.id] = 0
    queue[end++] = tile.id
  }
  for (let next = 0; next < end; next++) {
    const tile = tiles[queue[next]!]!
    for (const [dx, dz] of hexOffsets(tile.z)) {
      const x = tile.x + dx, z = tile.z + dz
      if (x < 0 || z < 0 || x >= width || z >= height) continue
      const id = z * width + x
      if (distance[id] !== 0xffff) continue
      distance[id] = distance[tile.id]! + 1
      queue[end++] = id
    }
  }
  const scale = clamp(Math.min(width, height) / 64, 1, 3)
  const angle = hash(seed ^ 0x517cc1b7, 0, 0) * Math.PI
  const cos = Math.cos(angle), sin = Math.sin(angle)
  return Object.freeze(tiles.map((tile): Tile => {
    if (tile.terrain !== 'water') return Object.freeze({ ...tile, terrain: tile.terrain })
    const [x, z] = hexCenter(tile.x, tile.z)
    const shelfWidth = (0.55 + noise(seed ^ 0x6da73b41, x, z, 4 * scale) * 1.1) * scale
    // Broad elongated lobes extend the seabed offshore; no paths are repaired or RNG steps consumed.
    const bank = Math.max(0, noise(seed ^ 0x3e91c67b, (x * cos + z * sin) * 0.4,
      z * cos - x * sin, 3 * scale) - 0.5) * 6 * scale
    const ripple = (noise(seed ^ 0x71a532d9, x, z, 1.8 * scale) - 0.5) * 0.8 * scale
    const depth = (distance[tile.id]! + ripple - bank) / shelfWidth
    const waterDepth: WaterDepth = depth <= 0.9 ? 'shallow' : depth <= 2 ? 'shoal' : depth <= 3.5 ? 'shelf' : 'deep'
    return Object.freeze({ ...tile, terrain: tile.terrain, waterDepth })
  }))
}

export function tileAt(map: WorldMap, x: number, z: number): Tile | undefined {
  if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || z < 0 || x >= map.width || z >= map.height) return
  return map.tiles[z * map.width + x]
}

export function generateMap(config: MapConfig): WorldMap {
  validateConfig(config)
  let state = seedState(config.seed)
  const random = (): number => {
    const step = randomStep(state)
    state = step.state
    return step.value
  }
  // Landforms and noise live in world space, where hex rows are HEX_ROW apart. Landform sizes follow
  // the tile count so a hex world keeps the land share of the earlier square worlds.
  const extentX = config.width, extentZ = config.height * HEX_ROW
  const minDimension = Math.min(extentX, extentZ)
  const landScale = Math.min(config.width, config.height)
  const count = Math.max(2, Math.min(5, Math.round(Math.sqrt(config.width * config.height) / 16)))
  const continents: Landform[] = []
  for (let index = 0; index < count; index++) {
    let x = 0, z = 0, separated = false
    for (let attempt = 0; attempt < 48; attempt++) {
      x = extentX * (0.12 + random() * 0.76)
      z = extentZ * (0.12 + random() * 0.76)
      if (continents.every(form => Math.hypot(form.x - x, form.z - z) > minDimension * 0.69)) {
        separated = true
        break
      }
    }
    if (!separated && continents.length) continue
    const radius = landScale * (0.156 + random() * 0.052)
    continents.push({
      x, z, radiusX: radius * (0.78 + random() * 0.54), radiusZ: radius * (0.78 + random() * 0.54),
      angle: random() * Math.PI,
    })
  }
  const islands = Array.from({ length: 1 + Math.floor(random() * 3) }, () => {
    const radius = landScale * (0.035 + random() * 0.045)
    return {
      x: extentX * (0.08 + random() * 0.84), z: extentZ * (0.08 + random() * 0.84),
      radiusX: radius * (0.7 + random() * 0.6), radiusZ: radius * (0.7 + random() * 0.6),
      angle: random() * Math.PI,
    }
  })
  const landforms: Landform[] = [...continents, ...islands]
  const inlandSea = random() < 0.28
    ? { x: extentX * (0.2 + random() * 0.6), z: extentZ * (0.2 + random() * 0.6),
      radius: landScale * (0.045 + random() * 0.04) }
    : undefined
  const tiles: TerrainTile[] = []
  const broadScale = minDimension * 0.19
  const detailScale = Math.max(2, minDimension * 0.07)
  for (const [index, form] of continents.entries()) {
    if (Math.min(form.radiusX, form.radiusZ) < 2) continue
    form.bay = {
      angle: hash(state ^ 0x518cc1b7, index, 0) * Math.PI * 2,
      width: 0.3 + hash(state ^ 0x421f0a3d, index, 1) * 0.12,
      bend: (hash(state ^ 0x76da8279, index, 2) - 0.5) * 0.5,
    }
  }
  for (let z = 0; z < config.height; z++) {
    for (let x = 0; x < config.width; x++) {
      const [px, pz] = hexCenter(x, z)
      const warpedX = px + (noise(state ^ 0x4ab17c93, px, pz, broadScale) - 0.5) * landScale * 0.09
      const warpedZ = pz + (noise(state ^ 0x792edb61, px, pz, broadScale) - 0.5) * landScale * 0.09
      const coastWarp = (noise(state ^ 0x68bc21eb, px, pz, broadScale) - 0.5) * 0.3
        + (noise(state ^ 0x02e5be93, px, pz, detailScale) - 0.5) * 0.16
      let landScore = -Infinity
      let nearestRadius = Infinity
      for (const form of landforms) {
        const [u, v] = localPoint(form, warpedX, warpedZ)
        const radius = Math.hypot(u, v)
        let score = 1 - radius + coastWarp
        if (form.bay) {
          const cos = Math.cos(form.bay.angle), sin = Math.sin(form.bay.angle)
          const along = u * cos + v * sin, across = v * cos - u * sin
          const bend = form.bay.bend * Math.max(0, 1.1 - along) ** 2
          // The rounded inlet head reaches inland; its far end extends beyond the shore into open sea.
          const inlet = Math.hypot((along - 1.1) / 1.1, (across - bend) / form.bay.width)
          score = Math.min(score, inlet - 1)
        }
        if (score > landScore) {
          landScore = score
          nearestRadius = radius
        }
      }
      if (inlandSea && landScore > 0.1 &&
        Math.hypot((px - inlandSea.x) / inlandSea.radius, (pz - inlandSea.z) / inlandSea.radius) < 1) {
        landScore = -1
      }
      const isLand = landScore >= 0
      const regionalVariation = (noise(state ^ 0x9e3779b9, px, pz, broadScale * 0.72) - 0.5) * 0.22
      const heightScore = clamp(1 - nearestRadius + regionalVariation, 0, 1)
      const elevation = isLand ? 1 + Number(heightScore > 0.24) + Number(heightScore > 0.49) + Number(heightScore > 0.76) : 0
      const vegetation = noise(state ^ 0x85ebca6b, px, pz, Math.max(2, minDimension * 0.16))
      const treeChance = hash(state ^ 0xc2b2ae35, x, z)
      const trees = isLand && elevation <= 3 && vegetation > 0.57 && treeChance > 0.38
        ? 1 + Math.floor(hash(state ^ 0x27d4eb2f, x, z) * 3)
        : 0
      const terrain: Terrain = !isLand ? 'water' : elevation >= 3 ? 'hills' : 'grassland'
      tiles.push({ id: z * config.width + x, x, z, terrain, elevation, trees })
    }
  }
  return Object.freeze({ ...config, generatorVersion: GENERATOR_VERSION, rngState: state, tiles: addBathymetry(config, tiles, state) })
}
