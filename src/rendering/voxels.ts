import { TERRAIN, seedState, type Tile, type WorldMap } from '../game/map'

// Pure voxel construction: no Babylon objects, so meshing and picking are unit-testable in Node.

export const CHUNK_COLUMNS = 64

const SOURCE = {
  fog: '#263b4a',
  grass: '#58b33c', grassLight: '#6cc447', grassDark: '#479c34', sand: '#e2c46c',
  dirt: '#8c5c33', dirtDark: '#744a29', soil: '#5c4630', soilDark: '#4a3925', bedrock: '#382c20',
  hillGrass: '#93a84a', hillGrassDark: '#7d9440', rock: '#a29d90', rockDark: '#857f73',
  cliff: '#9a6a45', cliffDark: '#7d5438', stone: '#bcb7ab',
  water: '#56b7e0', shallow: '#86d3ec',
  trunk: '#6b4a2b',
  leafTeal: '#2f9a7c', leafTealLight: '#43b391', leafGreen: '#3f9b3a', leafGreenLight: '#57b34b',
  leafDark: '#23735f', leafDarkLight: '#2f8a70', leafLime: '#86c94a', leafLimeLight: '#a3dc5f',
  tuft: '#7dd05a', flowerWhite: '#f1eee4', flowerYellow: '#f1cf4b', flowerRed: '#d9554b', flowerViolet: '#9b72cf',
} as const

export type VoxelKind = keyof typeof SOURCE
const KINDS = Object.keys(SOURCE) as VoxelKind[]
export const VOXEL = Object.fromEntries(KINDS.map((kind, index) => [kind, index + 1])) as Record<VoxelKind, number>
export const PALETTE = new Float32Array((KINDS.length + 1) * 3)
for (const [index, kind] of KINDS.entries()) {
  const hex = SOURCE[kind]
  for (let channel = 0; channel < 3; channel++) {
    PALETTE[(index + 1) * 3 + channel] = parseInt(hex.slice(1 + channel * 2, 3 + channel * 2), 16) / 255
  }
}

const LEAVES = [
  [VOXEL.leafTeal, VOXEL.leafTealLight], [VOXEL.leafGreen, VOXEL.leafGreenLight],
  [VOXEL.leafDark, VOXEL.leafDarkLight], [VOXEL.leafLime, VOXEL.leafLimeLight],
] as const
const FLOWERS = [VOXEL.flowerWhite, VOXEL.flowerYellow, VOXEL.flowerRed, VOXEL.flowerViolet] as const
// Ambient occlusion per face corner: 0 = enclosed corner, 3 = open.
export const AO_LIGHT = [0.52, 0.68, 0.84, 1] as const

export interface VoxelWorld {
  readonly map: WorldMap
  /** Voxels along one tile edge. */
  readonly scale: number
  /** World units per voxel edge. */
  readonly size: number
  readonly columnsX: number
  readonly columnsZ: number
  /** Voxel layers below world y = 0 (the diorama base). */
  readonly base: number
  /** Total voxel layers, including the base. */
  readonly layers: number
  readonly chunkColumns: number
  readonly chunksX: number
  readonly chunksZ: number
  /** Columns a tree may extend beyond its own tile. */
  readonly reach: number
  readonly seed: number
}

export interface ChunkMesh {
  readonly positions: Float32Array
  readonly normals: Float32Array
  readonly colors: Float32Array
  readonly indices: Uint32Array
  readonly quads: number
}

interface TreeShape { trunk: number; trunkVariance: number; radius: number; radiusVariance: number; layers: number; layerVariance: number }

/** Powers of two keep voxel coordinates exact; finer voxels for smaller maps keep the column budget bounded. */
export function voxelScale(width: number, height: number): number {
  const ratio = 512 / Math.max(width, height)
  return ratio >= 8 ? 8 : ratio >= 4 ? 4 : 2
}

function treeShape(scale: number): TreeShape {
  if (scale >= 8) return { trunk: 2, trunkVariance: 1, radius: 2.25, radiusVariance: 0.6, layers: 5, layerVariance: 1 }
  if (scale >= 4) return { trunk: 1, trunkVariance: 0, radius: 1.25, radiusVariance: 0.4, layers: 3, layerVariance: 0 }
  return { trunk: 0, trunkVariance: 0, radius: 0.6, radiusVariance: 0, layers: 2, layerVariance: 0 }
}

function waterLevel(scale: number): number { return Math.max(1, Math.round(0.25 * scale)) }
function fogLevel(scale: number): number { return Math.max(1, Math.round(0.65 * scale)) }
function bumpLimit(scale: number): number { return scale >= 8 ? 2 : scale >= 4 ? 1 : 0 }

function landLevel(scale: number, terrain: 'grassland' | 'hills', elevation: number): number {
  // At coarse scales every elevation step still needs at least one voxel.
  return Math.max(Math.round((TERRAIN[terrain].height + (elevation - 1) * 0.24) * scale), waterLevel(scale) + elevation)
}

export function createVoxelWorld(map: WorldMap, chunkColumns = CHUNK_COLUMNS): VoxelWorld {
  const scale = voxelScale(map.width, map.height)
  const shape = treeShape(scale)
  const base = Math.max(1, Math.round(0.75 * scale))
  const columnsX = map.width * scale
  const columnsZ = map.height * scale
  const highest = landLevel(scale, 'hills', 4) + bumpLimit(scale)
  const tree = shape.trunk + shape.trunkVariance + shape.layers + shape.layerVariance
  return {
    map, scale, size: 1 / scale, columnsX, columnsZ, base, layers: base + highest + tree + 1, chunkColumns,
    chunksX: Math.ceil(columnsX / chunkColumns), chunksZ: Math.ceil(columnsZ / chunkColumns),
    reach: Math.ceil(shape.radius + shape.radiusVariance) + 1, seed: seedState(map.seed),
  }
}

/** Height of the pickable tile surface in voxels above y = 0, as the viewer knows it. */
export function tileSurface(world: VoxelWorld, tile: Tile, known: boolean): number {
  if (!known) return fogLevel(world.scale)
  return tile.terrain === 'water' ? waterLevel(world.scale) : landLevel(world.scale, tile.terrain, tile.elevation)
}

function hash(seed: number, x: number, y: number, z: number): number {
  let h = seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function noise(seed: number, salt: number, x: number, z: number, cell: number): number {
  const fx = x / cell
  const fz = z / cell
  const ix = Math.floor(fx)
  const iz = Math.floor(fz)
  const tx = (fx - ix) * (fx - ix) * (3 - 2 * (fx - ix))
  const tz = (fz - iz) * (fz - iz) * (3 - 2 * (fz - iz))
  const top = hash(seed, ix, salt, iz) * (1 - tx) + hash(seed, ix + 1, salt, iz) * tx
  const bottom = hash(seed, ix, salt, iz + 1) * (1 - tx) + hash(seed, ix + 1, salt, iz + 1) * tx
  return top * (1 - tz) + bottom * tz
}

interface Column { top: number; surface: number; body: 'fog' | 'water' | 'dirt' | 'cliff'; tile: Tile; known: boolean }

function neighborAcross(world: VoxelWorld, known: Uint8Array, tile: Tile, gx: number, gz: number,
  matches: (neighbor: Tile) => boolean): boolean {
  const { map, scale } = world
  const lx = gx - tile.x * scale
  const lz = gz - tile.z * scale
  const check = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= map.width || z >= map.height) return false
    const neighbor = map.tiles[z * map.width + x]!
    // Only charted neighbors may shape this tile, or its rim would reveal hidden terrain.
    return known[neighbor.id] === 1 && matches(neighbor)
  }
  return (lx === 0 && check(tile.x - 1, tile.z)) || (lx === scale - 1 && check(tile.x + 1, tile.z))
    || (lz === 0 && check(tile.x, tile.z - 1)) || (lz === scale - 1 && check(tile.x, tile.z + 1))
}

function column(world: VoxelWorld, known: Uint8Array, gx: number, gz: number): Column {
  const { map, scale, seed } = world
  const tile = map.tiles[Math.floor(gz / scale) * map.width + Math.floor(gx / scale)]!
  if (known[tile.id] !== 1) return { top: fogLevel(scale), surface: VOXEL.fog, body: 'fog', tile, known: false }
  if (tile.terrain === 'water') {
    const shore = scale >= 4 && neighborAcross(world, known, tile, gx, gz, neighbor => neighbor.terrain !== 'water')
    return { top: waterLevel(scale), surface: shore ? VOXEL.shallow : VOXEL.water, body: 'water', tile, known: true }
  }
  const level = landLevel(scale, tile.terrain, tile.elevation)
  if (tile.terrain === 'grassland') {
    const beach = scale >= 4 && tile.elevation === 1 && noise(seed, 6, gx, gz, 3) > 0.42
      && neighborAcross(world, known, tile, gx, gz, neighbor => neighbor.terrain === 'water')
    const patch = noise(seed, 1, gx, gz, 5)
    const surface = beach ? VOXEL.sand : patch < 0.3 ? VOXEL.grassDark : patch > 0.72 ? VOXEL.grassLight : VOXEL.grass
    return { top: level, surface, body: 'dirt', tile, known: true }
  }
  const lx = gx - tile.x * scale
  const lz = gz - tile.z * scale
  const inner = lx > 0 && lz > 0 && lx < scale - 1 && lz < scale - 1
  const limit = bumpLimit(scale)
  // Each hill tile rises as a terraced mound; low-frequency noise keeps the terraces irregular but calm.
  const centre = (scale - 1) / 2
  const dome = 1 - Math.max(Math.abs(lx - centre), Math.abs(lz - centre)) / (scale / 2)
  const bump = inner ? Math.max(0, Math.min(limit, Math.floor(dome * (limit + 1) + (noise(seed, 2, gx, gz, 6) - 0.5) * 0.9))) : 0
  const rocky = (limit > 0 && bump === limit && noise(seed, 7, gx, gz, 3) > 0.5) || noise(seed, 3, gx, gz, 6) > 0.8
  const surface = rocky ? (hash(seed, gx, 4, gz) < 0.5 ? VOXEL.rock : VOXEL.rockDark)
    : hash(seed, gx, 5, gz) < 0.35 ? VOXEL.hillGrassDark : VOXEL.hillGrass
  return { top: level + bump, surface, body: 'cliff', tile, known: true }
}

function layerKind(world: VoxelWorld, layer: number, info: Column): number {
  const { base } = world
  if (layer < base) {
    const depth = base - 1 - layer
    // The diorama base shows stratified soil like a cut-out terrain sample.
    return layer === 0 && base >= 2 ? VOXEL.bedrock : Math.floor(depth / 2) % 2 ? VOXEL.soilDark : VOXEL.soil
  }
  const level = layer - base
  if (level === info.top - 1) return info.surface
  if (info.body === 'fog') return VOXEL.fog
  if (info.body === 'water') return VOXEL.water
  const band = Math.floor(level / 2) % 3 === 2
  if (info.body === 'cliff') return band ? VOXEL.cliffDark : VOXEL.cliff
  return band ? VOXEL.dirtDark : VOXEL.dirt
}

const TREE_SPOTS: readonly (readonly [number, number])[][] = [
  [], [[0.5, 0.5]], [[0.3, 0.5], [0.7, 0.5]], [[0.3, 0.35], [0.7, 0.35], [0.5, 0.7]],
]

interface Volume { data: Uint8Array; x0: number; z0: number; width: number; depth: number; strideY: number }

function place(volume: Volume, gx: number, layer: number, gz: number, kind: number): void {
  const x = gx - volume.x0 + 1
  const z = gz - volume.z0 + 1
  if (x < 0 || z < 0 || x >= volume.width + 2 || z >= volume.depth + 2 || layer < 0) return
  const index = (layer + 1) * volume.strideY + z * (volume.width + 2) + x
  if (index < volume.data.length && volume.data[index] === 0) volume.data[index] = kind
}

function stampTrees(world: VoxelWorld, known: Uint8Array, volume: Volume): void {
  const { map, scale, seed, base, reach } = world
  const shape = treeShape(scale)
  const left = Math.max(0, Math.floor((volume.x0 - 1 - reach) / scale))
  const right = Math.min(map.width - 1, Math.floor((volume.x0 + volume.width + reach) / scale))
  const top = Math.max(0, Math.floor((volume.z0 - 1 - reach) / scale))
  const bottom = Math.min(map.height - 1, Math.floor((volume.z0 + volume.depth + reach) / scale))
  for (let tz = top; tz <= bottom; tz++) {
    for (let tx = left; tx <= right; tx++) {
      const tile = map.tiles[tz * map.width + tx]!
      if (!tile.trees || known[tile.id] !== 1) continue
      for (const [index, [fx, fz]] of TREE_SPOTS[tile.trees]!.entries()) {
        const jitter = scale >= 8 ? 1 : 0
        const cx = tx * scale + Math.floor(fx * scale) + Math.round((hash(seed, tile.id, 10 + index, 0) * 2 - 1) * jitter)
        const cz = tz * scale + Math.floor(fz * scale) + Math.round((hash(seed, tile.id, 20 + index, 0) * 2 - 1) * jitter)
        const roll = hash(seed, tile.id, 30 + index, 0)
        const trunk = shape.trunk + Math.floor(roll * (shape.trunkVariance + 1))
        const radius = shape.radius + hash(seed, tile.id, 40 + index, 0) * shape.radiusVariance
        const layers = shape.layers + Math.floor(hash(seed, tile.id, 50 + index, 0) * (shape.layerVariance + 1))
        const species = hash(seed, tile.id, 60 + index, 0)
        const leaves = LEAVES[species < 0.42 ? 0 : species < 0.72 ? 1 : species < 0.9 ? 2 : 3]!
        const ground = base + column(world, known, cx, cz).top
        for (let layer = 0; layer < trunk; layer++) place(volume, cx, ground + layer, cz, VOXEL.trunk)
        const centre = (layers - 1) / 2
        const span = Math.ceil(radius)
        for (let layer = 0; layer < layers; layer++) {
          const dy = (layer - centre) / (layers / 2)
          for (let dz = -span; dz <= span; dz++) {
            for (let dx = -span; dx <= span; dx++) {
              const extent = (dx * dx + dz * dz) / (radius * radius) + dy * dy
              if (extent > 1) continue
              const gx = cx + dx
              const gz = cz + dz
              const gy = ground + trunk + layer
              const grain = hash(seed, gx, gy, gz)
              // Nibble the outer shell so canopies read as organic voxel clusters, not spheres.
              if (scale >= 8 && extent > 0.62 && grain < 0.22) continue
              const light = grain < 0.2 + 0.4 * (layer / Math.max(1, layers - 1))
              place(volume, gx, gy, gz, light ? leaves[1] : leaves[0])
            }
          }
        }
      }
    }
  }
}

function stampDetails(world: VoxelWorld, volume: Volume, columns: (Column | undefined)[]): void {
  const { scale, seed, base } = world
  if (scale < 8) return
  for (let z = 0; z < volume.depth + 2; z++) {
    for (let x = 0; x < volume.width + 2; x++) {
      const info = columns[z * (volume.width + 2) + x]
      if (!info?.known) continue
      const gx = volume.x0 + x - 1
      const gz = volume.z0 + z - 1
      const roll = hash(seed, gx, 70, gz)
      if (info.tile.terrain === 'grassland' && info.surface !== VOXEL.sand && roll < 0.045) {
        const pick = hash(seed, gx, 71, gz)
        place(volume, gx, base + info.top, gz, pick < 0.72 ? VOXEL.tuft : FLOWERS[Math.floor((pick - 0.72) / 0.28 * 4)]!)
      } else if (info.tile.terrain === 'hills' && roll < 0.012) place(volume, gx, base + info.top, gz, VOXEL.stone)
    }
  }
}

function fillVolume(world: VoxelWorld, known: Uint8Array, chunk: number): Volume {
  const { chunkColumns, chunksX, columnsX, columnsZ, layers, base } = world
  const x0 = (chunk % chunksX) * chunkColumns
  const z0 = Math.floor(chunk / chunksX) * chunkColumns
  const width = Math.min(chunkColumns, columnsX - x0)
  const depth = Math.min(chunkColumns, columnsZ - z0)
  const strideY = (width + 2) * (depth + 2)
  const volume: Volume = { data: new Uint8Array(strideY * (layers + 2)), x0, z0, width, depth, strideY }
  const columns: (Column | undefined)[] = new Array(strideY)
  for (let z = 0; z < depth + 2; z++) {
    for (let x = 0; x < width + 2; x++) {
      const gx = x0 + x - 1
      const gz = z0 + z - 1
      if (gx < 0 || gz < 0 || gx >= columnsX || gz >= columnsZ) continue
      const info = column(world, known, gx, gz)
      columns[z * (width + 2) + x] = info
      for (let layer = 0; layer < base + info.top; layer++) {
        volume.data[(layer + 1) * strideY + z * (width + 2) + x] = layerKind(world, layer, info)
      }
    }
  }
  stampTrees(world, known, volume)
  stampDetails(world, volume, columns)
  return volume
}

class Buffer {
  values: Float32Array
  length = 0
  constructor(capacity: number) { this.values = new Float32Array(capacity) }
  push4(a: number, b: number, c: number, d: number): void {
    if (this.length + 4 > this.values.length) {
      const grown = new Float32Array(this.values.length * 2)
      grown.set(this.values)
      this.values = grown
    }
    this.values[this.length++] = a
    this.values[this.length++] = b
    this.values[this.length++] = c
    this.values[this.length++] = d
  }
  push3(a: number, b: number, c: number): void {
    if (this.length + 3 > this.values.length) {
      const grown = new Float32Array(this.values.length * 2)
      grown.set(this.values)
      this.values = grown
    }
    this.values[this.length++] = a
    this.values[this.length++] = b
    this.values[this.length++] = c
  }
}

/**
 * Faces never seen from the fixed camera direction (-1,-1,-1) and facing away from the light are skipped:
 * +y, +x and +z are visible; -z faces the key light and closes the shadow-caster shell.
 */
export const FACE_DIRECTIONS: readonly (readonly [axis: number, sign: 1 | -1])[] = [[1, 1], [0, 1], [2, 1], [2, -1]]
const NO_MERGE = 1 << 16
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const

/** Builds one chunk mesh from the viewer's knowledge (`known[tileId] === 1`); unknown tiles become fog blocks. */
export function meshChunk(world: VoxelWorld, known: Uint8Array, chunk: number): ChunkMesh {
  const volume = fillVolume(world, known, chunk)
  const { data, width, depth, strideY } = volume
  const lo = [1, 1, 1]
  const hi = [1 + width, 1 + world.layers, 1 + depth]
  const strides = [1, strideY, width + 2]
  const offset = [-0.5 + volume.x0 * world.size - world.size, -(world.base + 1) * world.size, -0.5 + volume.z0 * world.size - world.size]
  const positions = new Buffer(1 << 14)
  const normals = new Buffer(1 << 14)
  const colors = new Buffer(1 << 14)
  let indices = new Uint32Array(1 << 13)
  let indexCount = 0
  let quads = 0
  const corner = [0, 0, 0]
  for (const [a, sign] of FACE_DIRECTIONS) {
    const u = (a + 1) % 3
    const v = (a + 2) % 3
    const nu = hi[u]! - lo[u]!
    const nv = hi[v]! - lo[v]!
    const mask = new Int32Array(nu * nv)
    const sa = strides[a]! * sign
    const su = strides[u]!
    const sv = strides[v]!
    for (let i = lo[a]!; i < hi[a]!; i++) {
      let cell = 0
      for (let jv = lo[v]!; jv < hi[v]!; jv++) {
        for (let ju = lo[u]!; ju < hi[u]!; ju++) {
          const index = i * strides[a]! + ju * su + jv * sv
          const kind = data[index]!
          if (!kind || data[index + sa]) { mask[cell++] = 0; continue }
          if (kind === VOXEL.fog) { mask[cell++] = kind | (0xff << 8); continue }
          const q = index + sa
          let ao = 0
          let uniform = true
          let first = -1
          for (let k = 0; k < 4; k++) {
            const [du, dv] = CORNERS[k]!
            const side1 = data[q + du * su] ? 1 : 0
            const side2 = data[q + dv * sv] ? 1 : 0
            const diagonal = data[q + du * su + dv * sv] ? 1 : 0
            const level = side1 && side2 ? 0 : 3 - side1 - side2 - diagonal
            if (first < 0) first = level
            else if (level !== first) uniform = false
            ao |= level << (k * 2)
          }
          mask[cell++] = kind | (ao << 8) | (uniform ? 0 : NO_MERGE)
        }
      }
      for (let jv = 0, n = 0; jv < nv; jv++) {
        for (let ju = 0; ju < nu; ju++, n++) {
          const key = mask[n]!
          if (!key) continue
          let w = 1
          let h = 1
          if (!(key & NO_MERGE)) {
            while (ju + w < nu && mask[n + w] === key) w++
            grow: while (jv + h < nv) {
              for (let k = 0; k < w; k++) if (mask[n + h * nu + k] !== key) break grow
              h++
            }
          }
          for (let dy = 0; dy < h; dy++) mask.fill(0, n + dy * nu, n + dy * nu + w)
          const kind = key & 0xff
          const ao = (key >> 8) & 0xff
          const base = positions.length / 3
          const plane = i + (sign > 0 ? 1 : 0)
          const fog = kind === VOXEL.fog
          for (let k = 0; k < 4; k++) {
            corner[a] = plane
            corner[u] = lo[u]! + ju + (k === 1 || k === 2 ? w : 0)
            corner[v] = lo[v]! + jv + (k >= 2 ? h : 0)
            positions.push3(offset[0]! + corner[0]! * world.size, offset[1]! + corner[1]! * world.size,
              offset[2]! + corner[2]! * world.size)
            normals.push3(a === 0 ? sign : 0, a === 1 ? sign : 0, a === 2 ? sign : 0)
            const light = fog ? 1 : AO_LIGHT[(ao >> (k * 2)) & 3]!
            colors.push4(PALETTE[kind * 3]! * light, PALETTE[kind * 3 + 1]! * light, PALETTE[kind * 3 + 2]! * light, fog ? 0 : 1)
          }
          if (indexCount + 6 > indices.length) {
            const grown = new Uint32Array(indices.length * 2)
            grown.set(indices)
            indices = grown
          }
          const ao0 = ao & 3
          const ao1 = (ao >> 2) & 3
          const ao2 = (ao >> 4) & 3
          const ao3 = (ao >> 6) & 3
          // Split along the brighter diagonal; Babylon's front faces satisfy (c - a) x (b - a) = normal.
          const order = ao0 + ao2 >= ao1 + ao3
            ? sign > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]
            : sign > 0 ? [1, 3, 2, 1, 0, 3] : [1, 2, 3, 1, 3, 0]
          for (const vertex of order) indices[indexCount++] = base + vertex
          quads++
        }
      }
    }
  }
  return {
    positions: positions.values.slice(0, positions.length), normals: normals.values.slice(0, normals.length),
    colors: colors.values.slice(0, colors.length), indices: indices.slice(0, indexCount), quads,
  }
}

/** Chunks whose voxels can change when the given tiles change between fog and charted terrain. */
export function affectedChunks(world: VoxelWorld, tileIds: Iterable<number>): Set<number> {
  const { map, scale, reach, chunkColumns, chunksX, chunksZ } = world
  const chunks = new Set<number>()
  // A changed tile moves its own columns, its trees, neighboring shore rims and adjacent ambient occlusion.
  const margin = reach + 1
  for (const id of tileIds) {
    const x = id % map.width
    const z = Math.floor(id / map.width)
    const left = Math.max(0, Math.floor((x * scale - margin) / chunkColumns))
    const right = Math.min(chunksX - 1, Math.floor(((x + 1) * scale - 1 + margin) / chunkColumns))
    const top = Math.max(0, Math.floor((z * scale - margin) / chunkColumns))
    const bottom = Math.min(chunksZ - 1, Math.floor(((z + 1) * scale - 1 + margin) / chunkColumns))
    for (let cz = top; cz <= bottom; cz++) for (let cx = left; cx <= right; cx++) chunks.add(cz * chunksX + cx)
  }
  return chunks
}

/**
 * Deterministic tile picking on the visible tile heightfield: march the ray through tile cells (2D DDA) and
 * return the first cell whose column top it passes below. Decorative trees never intercept tile picks.
 */
export function pickTile(world: VoxelWorld, heights: Float32Array,
  origin: readonly [number, number, number], direction: readonly [number, number, number]): number | undefined {
  const { map } = world
  const [ox, oy, oz] = origin
  const [dx, dy, dz] = direction
  let top = 0
  for (const height of heights) top = Math.max(top, height)
  const bounds = [[-0.5, map.width - 0.5, ox, dx], [-world.base * world.size, top + 1e-6, oy, dy],
    [-0.5, map.height - 0.5, oz, dz]] as const
  let enter = 0
  let exit = Infinity
  for (const [min, max, o, d] of bounds) {
    if (Math.abs(d) < 1e-12) {
      if (o < min || o > max) return
      continue
    }
    const t0 = (min - o) / d
    const t1 = (max - o) / d
    enter = Math.max(enter, Math.min(t0, t1))
    exit = Math.min(exit, Math.max(t0, t1))
  }
  if (enter > exit) return
  const epsilon = 1e-9
  let x = Math.min(map.width - 1, Math.max(0, Math.floor(ox + dx * (enter + epsilon) + 0.5)))
  let z = Math.min(map.height - 1, Math.max(0, Math.floor(oz + dz * (enter + epsilon) + 0.5)))
  const stepX = Math.sign(dx)
  const stepZ = Math.sign(dz)
  const nextX = (cell: number) => stepX ? (cell + 0.5 * stepX - ox) / dx : Infinity
  const nextZ = (cell: number) => stepZ ? (cell + 0.5 * stepZ - oz) / dz : Infinity
  let tx = nextX(x)
  let tz = nextZ(z)
  for (;;) {
    const leave = Math.min(tx, tz, exit)
    const id = z * map.width + x
    if (oy + dy * leave <= heights[id]! + epsilon) return id
    if (leave >= exit) return
    // A ray through an exact cell corner passes diagonally; it does not touch the two edge neighbours.
    const both = Math.abs(tx - tz) < epsilon
    const advanceX = both || tx < tz
    const advanceZ = both || tz < tx
    if (advanceX) { x += stepX; tx = nextX(x) }
    if (advanceZ) { z += stepZ; tz = nextZ(z) }
    if (x < 0 || z < 0 || x >= map.width || z >= map.height) return
  }
}
