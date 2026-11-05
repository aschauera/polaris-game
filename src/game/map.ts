export const TERRAIN = {
  grassland: { name: 'Grassland', height: 0.65 },
  water: { name: 'Water', height: 0.25 },
  hills: { name: 'Hills', height: 1.35 },
} as const

export type Terrain = keyof typeof TERRAIN
export interface MapConfig { seed: string; width: number; height: number }
export interface Tile {
  readonly id: number
  readonly x: number
  readonly z: number
  readonly terrain: Terrain
  readonly elevation: number
  readonly trees: number
}
export interface WorldMap extends MapConfig {
  readonly generatorVersion: 2
  readonly rngState: number
  readonly tiles: readonly Tile[]
}

interface Landform { x: number; z: number; radiusX: number; radiusZ: number; angle: number }

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

function distanceTo(form: Landform, x: number, z: number): number {
  const dx = x - form.x, dz = z - form.z
  const cos = Math.cos(form.angle), sin = Math.sin(form.angle)
  const rotatedX = dx * cos - dz * sin
  const rotatedZ = dx * sin + dz * cos
  return Math.sqrt((rotatedX / form.radiusX) ** 2 + (rotatedZ / form.radiusZ) ** 2)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
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
  const minDimension = Math.min(config.width, config.height)
  const count = Math.max(2, Math.min(5, Math.round(Math.sqrt(config.width * config.height) / 16)))
  const continents: Landform[] = []
  for (let index = 0; index < count; index++) {
    let x = 0, z = 0, separated = false
    for (let attempt = 0; attempt < 48; attempt++) {
      x = config.width * (0.12 + random() * 0.76)
      z = config.height * (0.12 + random() * 0.76)
      if (continents.every(form => Math.hypot(form.x - x, form.z - z) > minDimension * 0.69)) {
        separated = true
        break
      }
    }
    if (!separated && continents.length) continue
    const radius = minDimension * (0.15 + random() * 0.05)
    continents.push({
      x, z, radiusX: radius * (0.78 + random() * 0.54), radiusZ: radius * (0.78 + random() * 0.54),
      angle: random() * Math.PI,
    })
  }
  const islands = Array.from({ length: 1 + Math.floor(random() * 3) }, () => {
    const radius = minDimension * (0.035 + random() * 0.045)
    return {
      x: config.width * (0.08 + random() * 0.84), z: config.height * (0.08 + random() * 0.84),
      radiusX: radius * (0.7 + random() * 0.6), radiusZ: radius * (0.7 + random() * 0.6),
      angle: random() * Math.PI,
    }
  })
  const landforms = [...continents, ...islands]
  const inlandSea = random() < 0.28
    ? { x: config.width * (0.2 + random() * 0.6), z: config.height * (0.2 + random() * 0.6),
      radius: minDimension * (0.045 + random() * 0.04) }
    : undefined
  const tiles: Tile[] = []
  const broadScale = minDimension * 0.19
  const detailScale = Math.max(2, minDimension * 0.07)
  for (let z = 0; z < config.height; z++) {
    for (let x = 0; x < config.width; x++) {
      let landScore = -Infinity
      let nearestRadius = Infinity
      for (const form of landforms) {
        const radius = distanceTo(form, x, z)
        const coastWarp = (noise(state ^ 0x68bc21eb, x, z, broadScale) - 0.5) * 0.58
          + (noise(state ^ 0x02e5be93, x, z, detailScale) - 0.5) * 0.2
        const score = 1 - radius + coastWarp
        if (score > landScore) {
          landScore = score
          nearestRadius = radius
        }
      }
      if (inlandSea && landScore > 0.1 &&
        Math.hypot((x - inlandSea.x) / inlandSea.radius, (z - inlandSea.z) / inlandSea.radius) < 1) {
        landScore = -1
      }
      const isLand = landScore >= 0
      const regionalVariation = (noise(state ^ 0x9e3779b9, x, z, broadScale * 0.72) - 0.5) * 0.22
      const heightScore = clamp(1 - nearestRadius + regionalVariation, 0, 1)
      const elevation = isLand ? 1 + Number(heightScore > 0.24) + Number(heightScore > 0.49) + Number(heightScore > 0.76) : 0
      const vegetation = noise(state ^ 0x85ebca6b, x, z, Math.max(2, minDimension * 0.16))
      const treeChance = hash(state ^ 0xc2b2ae35, x, z)
      const trees = isLand && elevation <= 3 && vegetation > 0.57 && treeChance > 0.38
        ? 1 + Math.floor(hash(state ^ 0x27d4eb2f, x, z) * 3)
        : 0
      const terrain: Terrain = !isLand ? 'water' : elevation >= 3 ? 'hills' : 'grassland'
      tiles.push(Object.freeze({ id: z * config.width + x, x, z, terrain, elevation, trees }))
    }
  }
  return Object.freeze({ ...config, generatorVersion: 2, rngState: state, tiles: Object.freeze(tiles) })
}
