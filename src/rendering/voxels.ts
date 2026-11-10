import { HEX_RADIUS, HEX_ROW, hexAt, hexCenter, hexOffsets } from '../game/hex'
import { TERRAIN, seedState, type Tile, type WorldMap } from '../game/map'
import { SCREEN_DOWN, SCREEN_RIGHT } from './view'
import type { ResourceKind } from './resources'

// Pure voxel construction: no Babylon objects, so meshing and picking are unit-testable in Node.

/** Fixed-size meshing batches; the fine 32-tile showcase fits in eight by seven chunks. */
export const CHUNK_COLUMNS = 66

const SOURCE = {
  fog: '#263b4a',
  grass: '#a9b946', grassLight: '#b9c34d', grassDark: '#9bac41', sand: '#ffeeb5',
  dirt: '#ad8b59', dirtDark: '#8d714d', soil: '#85877e', soilDark: '#70776f', bedrock: '#5b665f',
  hillGrass: '#aab24b', hillGrassDark: '#969f42', rock: '#b4a8aa', rockDark: '#8d8d8f',
  cliff: '#939087', cliffDark: '#757b76', stone: '#bcb7a9',
  water: '#147da5', shallow: '#66d5d6', shoal: '#26b5d0', shelf: '#178abe',
  waterSurface: '#0a7bba', waterShallow: '#43f0fa', waterShoal: '#19d2e2', waterShelf: '#108fca', waterEdge: '#d2f7e7',
  seabedSand: '#77e4dd', seabedStone: '#219aad', seabedDeep: '#0c709e',
  path: '#beb69b',
  trunk: '#78613b',
  underwaterRock: '#659d9e',
  leafTeal: '#3d7046', leafTealLight: '#5b8b4b', leafGreen: '#54823c', leafGreenLight: '#719543',
  leafDark: '#285b3b', leafDarkLight: '#437544', leafLime: '#859f3f', leafLimeLight: '#a5b84f',
  tuft: '#99b34d', flowerWhite: '#f1eee4', flowerYellow: '#f1cf4b', flowerRed: '#d9554b', flowerViolet: '#9b72cf',
  wall: '#e6d9bb', timber: '#9c7a55', door: '#5b3f2a', window: '#3f4b57',
  roof: '#c46b37', roofRidge: '#9f4f2c', plank: '#a8743f', thatch: '#d9ad4e', thatchRidge: '#bf9238',
  castle: '#b2aea0', castleDark: '#8d8b81', bannerGold: '#f0c873', bannerBlue: '#5a7fe0',
  goldDark: '#b4842f', blueDark: '#3a58ad', skin: '#f0c49a', hair: '#5a3b24', steel: '#c9ced6', leather: '#7a5230',
  depositStone: '#b6b2a7', depositStoneDark: '#8e938c', appleRed: '#d83b28', appleLight: '#ef6840',
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
// Everything after the path is decoration: the shader draws hex overlays on ground voxels only.
const FIRST_DECORATION = VOXEL.path + 1

const LEAVES = [
  [VOXEL.leafTeal, VOXEL.leafTealLight], [VOXEL.leafGreen, VOXEL.leafGreenLight],
  [VOXEL.leafDark, VOXEL.leafDarkLight], [VOXEL.leafLime, VOXEL.leafLimeLight],
] as const
const FLOWERS = [VOXEL.flowerWhite, VOXEL.flowerYellow, VOXEL.flowerRed, VOXEL.flowerViolet] as const
// Ambient occlusion per face corner: 0 = enclosed corner, 3 = open.
export const AO_LIGHT = [0.52, 0.68, 0.84, 1] as const
/** Dedicated shader role per vertex; water opacity belongs to its material. */
export const FACE_FLAG = {
  fog: 0, decoration: 0.5, ground: 1, waterFloor: 1.125, water: 1.5, waterSurface: 2, waterEdge: 2.25,
} as const
const WATER_SURFACES = new Set<number>([
  VOXEL.waterSurface, VOXEL.waterShallow, VOXEL.waterShoal, VOXEL.waterShelf, VOXEL.waterEdge,
])
const isWaterSurface = (kind: number | undefined) => kind !== undefined && WATER_SURFACES.has(kind)

export interface VoxelWorld {
  readonly map: WorldMap
  /** Voxels across one hex, between opposite edges. */
  readonly scale: number
  /** World units per voxel edge. */
  readonly size: number
  /** World x and z of the low corner of voxel column (0, 0). */
  readonly originX: number
  readonly originZ: number
  readonly offsetX: number
  readonly offsetZ: number
  readonly columnsX: number
  readonly columnsZ: number
  /** Tile id of every voxel column (`gz * columnsX + gx`), or -1 outside the map's hexes. */
  readonly columnTile: Int32Array
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
  /** Per-tile settlement codes from `siteCode`; 0 means none. Callers update them and remesh `affectedChunks`. */
  readonly sites: Uint8Array
}

export interface Settlement {
  /** Dwellings around the keep, 1–3. */
  readonly houses: number
  readonly storehouse: boolean
  /** Banner colour: 0 gold, 1 blue. */
  readonly banner: 0 | 1
}

export function siteCode(settlement?: Settlement): number {
  if (!settlement) return 0
  const houses = Math.max(1, Math.min(3, Math.floor(settlement.houses)))
  return 1 | (houses - 1) << 1 | (settlement.storehouse ? 8 : 0) | settlement.banner << 4
}

/**
 * The renderer's territory byte for a tile: the owner (0 none, 1 gold, 2 blue) in the low two bits and, from bit 2 on,
 * one bit per hex direction whose neighbour has another owner or lies off the map, so the shader draws a border there.
 */
export function territoryCode(map: WorldMap, owners: Uint8Array, id: number): number {
  const owner = owners[id]!
  if (!owner) return 0
  const { x, z } = map.tiles[id]!
  let code = owner
  for (const [k, [dx, dz]] of hexOffsets(z).entries()) {
    const nx = x + dx, nz = z + dz
    const inside = nx >= 0 && nz >= 0 && nx < map.width && nz < map.height
    if (!inside || owners[nz * map.width + nx] !== owner) code |= 4 << k
  }
  return code
}

export interface ChunkMesh {
  readonly positions: Float32Array
  readonly normals: Float32Array
  readonly colors: Float32Array
  /** Face flags use their own attribute so they never affect standard-material transparency. */
  readonly faceFlags: Float32Array
  readonly indices: Uint32Array
  /** Transparent water indices follow all opaque indices in the same chunk geometry. */
  readonly waterIndexCount: number
  readonly quads: number
}

interface TreeShape {
  trunk: number; trunkVariance: number; radius: number; radiusVariance: number; layers: number; layerVariance: number
  /** Most trees one hex holds at this scale. */
  spots: number
}

/** Powers of two keep voxel coordinates exact; finer voxels for smaller maps keep the column budget bounded. */
export function voxelScale(width: number, height: number): number {
  const ratio = 512 / Math.max(width, height)
  return ratio >= 16 ? 16 : ratio >= 8 ? 8 : ratio >= 4 ? 4 : 2
}

function treeShape(scale: number): TreeShape {
  if (scale >= 8) {
    const detail = scale / 8
    return { trunk: detail, trunkVariance: 0, radius: 1.05 * detail, radiusVariance: 0.3 * detail,
      layers: 3 * detail, layerVariance: detail, spots: 5 }
  }
  if (scale >= 4) return { trunk: 1, trunkVariance: 0, radius: 0.6, radiusVariance: 0, layers: 1, layerVariance: 0, spots: 2 }
  return { trunk: 0, trunkVariance: 0, radius: 0.6, radiusVariance: 0, layers: 1, layerVariance: 0, spots: 1 }
}

export function waterLevel(scale: number): number { return Math.max(1, Math.round(0.25 * scale)) }
/** Columns of turquoise shoal water around charted land, beyond the shallow rim; none at the coarsest scale. */
function shoalReach(scale: number): number { return scale >= 4 ? scale / 2 : 0 }
function sandbankReach(scale: number): number { return scale >= 4 ? Math.ceil(scale * 0.9) : 0 }
function fogLevel(scale: number): number { return Math.max(1, Math.round(0.65 * scale)) }
function landLevel(scale: number, terrain: 'grassland' | 'hills', elevation: number): number {
  // Coarse grids merge small height steps instead of magnifying them into tall columns.
  return Math.max(Math.round((TERRAIN[terrain].height + (elevation - 1) * 0.125) * scale), waterLevel(scale) + 1)
}

export interface VoxelWindow {
  readonly scale: number
  readonly offsetX: number
  readonly offsetZ: number
  readonly columnsX: number
  readonly columnsZ: number
}

export function voxelGrid(map: WorldMap, scale: number) {
  const pad = Math.ceil(HEX_RADIUS * scale)
  return {
    originX: -0.5, originZ: -pad / scale,
    columnsX: Math.round((map.width + (map.height > 1 ? 0.5 : 0)) * scale),
    columnsZ: Math.ceil(((map.height - 1) * HEX_ROW + HEX_RADIUS) * scale) + pad,
  }
}

export function createVoxelWorld(map: WorldMap, chunkColumns = CHUNK_COLUMNS, window?: VoxelWindow): VoxelWorld {
  const scale = window?.scale ?? voxelScale(map.width, map.height)
  const size = 1 / scale
  const shape = treeShape(scale)
  const base = Math.max(1, Math.round(0.75 * scale))
  // Hexes reach half a tile beyond the outer centres in x and one corner radius in z.
  const grid = voxelGrid(map, scale)
  const offsetX = window?.offsetX ?? 0, offsetZ = window?.offsetZ ?? 0
  const originX = grid.originX + offsetX * size, originZ = grid.originZ + offsetZ * size
  const columnsX = window?.columnsX ?? grid.columnsX, columnsZ = window?.columnsZ ?? grid.columnsZ
  const columnTile = new Int32Array(columnsX * columnsZ)
  for (let gz = 0; gz < columnsZ; gz++) {
    for (let gx = 0; gx < columnsX; gx++) {
      const [x, z] = hexAt(originX + (gx + 0.5) * size, originZ + (gz + 0.5) * size)
      columnTile[gz * columnsX + gx] = x >= 0 && z >= 0 && x < map.width && z < map.height ? z * map.width + x : -1
    }
  }
  const highest = landLevel(scale, 'hills', 4)
  // Smaller trees must not reduce the space reserved for keeps and their banners.
  const detail = Math.max(1, scale / 8)
  const tree = shape.trunk + shape.trunkVariance + shape.layers + shape.layerVariance + (scale >= 4 ? detail : 0)
  const decoration = Math.max(tree, scale >= 8 ? 6 * detail : scale >= 4 ? 3 : 2)
  return {
    map, scale, size, originX, originZ, offsetX, offsetZ, columnsX, columnsZ, columnTile, base,
    layers: base + highest + decoration + 1, chunkColumns,
    chunksX: Math.ceil(columnsX / chunkColumns), chunksZ: Math.ceil(columnsZ / chunkColumns),
    reach: Math.ceil(shape.radius + shape.radiusVariance + CONIFER_FLARE * detail) + 1, seed: seedState(map.seed),
    sites: new Uint8Array(map.width * map.height),
  }
}

/** Height of the pickable tile surface in voxels above y = 0, as the viewer knows it. */
export function tileSurface(world: VoxelWorld, tile: Tile, known: boolean): number {
  if (!known) return fogLevel(world.scale)
  return tile.terrain === 'water' ? waterLevel(world.scale) : landLevel(world.scale, tile.terrain, tile.elevation)
}

/** Tile id of a voxel column, or -1 outside the grid or the map's hexes. */
export function columnTileAt(world: VoxelWorld, gx: number, gz: number): number {
  if (gx < 0 || gz < 0 || gx >= world.columnsX || gz >= world.columnsZ) {
    // Sample the real map beyond a streamed window, including coast influence and chunk aprons.
    const [x, z] = hexAt(world.originX + (gx + 0.5) * world.size, world.originZ + (gz + 0.5) * world.size)
    return x >= 0 && z >= 0 && x < world.map.width && z < world.map.height ? z * world.map.width + x : -1
  }
  return world.columnTile[gz * world.columnsX + gx]!
}

/** The column just east of a tile's centre and the column row containing the centre. */
export function centreColumn(world: VoxelWorld, tile: Tile): [number, number] {
  const [x, z] = hexCenter(tile.x, tile.z)
  return [Math.round((x - world.originX) * world.scale), Math.floor((z - world.originZ) * world.scale)]
}

function hash(seed: number, x: number, y: number, z: number): number {
  let h = seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Seeded presentation occurrences: no map mutation, simulation RNG, yields or movement effects. */
export function resourceAt(world: VoxelWorld, tile: Tile): ResourceKind | undefined {
  if (world.sites[tile.id]) return
  const roll = hash(world.seed, tile.x, 113, tile.z)
  if (tile.terrain === 'water') return roll < 0.035 ? 'fish' : undefined
  if (tile.terrain === 'hills') return roll < 0.14 ? 'stone' : undefined
  if (roll < 0.07) return 'apples'
}

function hasCoastalRocks(world: VoxelWorld, tile: Tile): boolean {
  return world.scale >= 4 && resourceAt(world, tile) !== 'fish' && hash(world.seed, tile.x, 81, tile.z) < 0.22
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

type Column = { top: number; surface: number; tile: Tile; known: boolean } & (
  { body: 'water'; floor: number; floorSurface: number; capSurface: number; rockTop: number }
  | { body: 'fog' | 'dirt' | 'cliff' | 'sand' }
)

const isLand = (tile: Tile) => tile.terrain !== 'water'
const isWater = (tile: Tile) => tile.terrain === 'water'

/** Distance to the charted coast, shared by submerged terraces and land-side sandbanks. */
function chartedCoastDistance(world: VoxelWorld, known: Uint8Array, id: number, gx: number, gz: number, radius: number,
  matches: (tile: Tile) => boolean): number {
  // Reject distant terrain using tile bounds before scanning individual columns.
  const { map, size, originX, originZ } = world
  const x = originX + (gx + 0.5) * size, z = originZ + (gz + 0.5) * size
  const worldRadius = radius * size
  const top = Math.max(0, Math.ceil((z - worldRadius - HEX_RADIUS) / HEX_ROW))
  const bottom = Math.min(map.height - 1, Math.floor((z + worldRadius + HEX_RADIUS) / HEX_ROW))
  let nearCoast = false
  for (let row = top; row <= bottom && !nearCoast; row++) {
    const shift = (row & 1) * 0.5
    const left = Math.max(0, Math.ceil(x - worldRadius - 0.5 - shift))
    const right = Math.min(map.width - 1, Math.floor(x + worldRadius + 0.5 - shift))
    for (let col = left; col <= right; col++) {
      const other = row * map.width + col
      if (known[other] === 1 && matches(map.tiles[other]!)) { nearCoast = true; break }
    }
  }
  if (!nearCoast) return Infinity
  const reach = Math.ceil(radius)
  const radiusSquared = radius * radius
  let nearestSquared = Infinity
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const distanceSquared = dx * dx + dz * dz
      if (distanceSquared > radiusSquared || distanceSquared >= nearestSquared) continue
      const other = columnTileAt(world, gx + dx, gz + dz)
      // Neither sandbanks nor underwater terraces may outline an uncharted neighbour.
      if (other >= 0 && other !== id && known[other] === 1 && matches(world.map.tiles[other]!)) {
        nearestSquared = distanceSquared
      }
    }
  }
  return Math.sqrt(nearestSquared)
}

function sandbankLevel(world: VoxelWorld, known: Uint8Array, id: number, gx: number, gz: number): number | undefined {
  const { scale, seed } = world
  const reach = sandbankReach(scale)
  if (!reach) return
  const broad = noise(seed, 91, gx + world.offsetX, gz + world.offsetZ, scale * 2.5)
  const edge = noise(seed, 92, gx + world.offsetX, gz + world.offsetZ, scale * 0.6)
  const width = Math.min(reach, scale * Math.max(0, (broad - 0.45) * 3.2 + (edge - 0.5) * 0.24))
  if (width < 1) return
  const distance = chartedCoastDistance(world, known, id, gx, gz, reach, isWater)
  if (distance > width) return
  // Broad low beaches and a higher inland shelf cut pockets into the original cliffs.
  return waterLevel(scale) + Math.max(1, Math.round((distance > width * 0.72 ? 2 : 1) * scale / 8))
}

function column(world: VoxelWorld, known: Uint8Array, gx: number, gz: number): Column | undefined {
  const id = columnTileAt(world, gx, gz)
  if (id < 0) return
  const { map, scale, seed } = world
  const nx = gx + world.offsetX, nz = gz + world.offsetZ
  const detail = Math.max(1, scale / 8)
  const tile = map.tiles[id]!
  if (known[id] !== 1) return { top: fogLevel(scale), surface: VOXEL.fog, body: 'fog', tile, known: false }
  if (tile.terrain === 'water') {
    const reach = shoalReach(scale)
    const nearestLand = reach > 0 ? chartedCoastDistance(world, known, id, gx, gz, 2 * reach + 1, isLand) : Infinity
    const coastWarp = reach > 0
      ? (noise(seed, 88, nx, nz, scale * 3) - 0.5) * scale * 0.85
        + (noise(seed, 90, nx, nz, scale) - 0.5) * scale * 0.3
      : 0
    const coastDistance = Number.isFinite(nearestLand) ? Math.max(0, nearestLand + coastWarp) : Infinity
    let surface = VOXEL.water
    if (coastDistance <= 1.5 * detail) surface = VOXEL.shallow
    else if (coastDistance <= reach) surface = VOXEL.shoal
    else if (coastDistance <= 2 * reach) surface = VOXEL.shelf
    const top = waterLevel(scale)
    // Four world-space terraces, not one depth step per fine voxel; coarse grids merge unrepresentable levels.
    const depth = Math.max(1, Math.round((surface === VOXEL.shallow ? 1 : surface === VOXEL.shoal ? 3
      : surface === VOXEL.shelf ? 5 : 7) * scale / 8))
    const floor = Math.max(1 - world.base, top - depth)
    const bottomTexture = noise(seed, 87, nx, nz, scale * 0.75)
    const floorSurface = surface === VOXEL.shallow
      ? VOXEL.seabedSand
      : surface === VOXEL.shoal
        ? bottomTexture > 0.2 ? VOXEL.seabedSand : VOXEL.seabedStone
        : surface === VOXEL.shelf
          ? bottomTexture > 0.86 ? VOXEL.seabedStone : VOXEL.seabedDeep
          : VOXEL.seabedDeep
    const capSurface = surface === VOXEL.shallow && hash(seed, nx, 89, nz) > 0.72
      ? VOXEL.waterEdge : surface === VOXEL.shallow ? VOXEL.waterShallow
        : surface === VOXEL.shoal ? VOXEL.waterShoal : surface === VOXEL.shelf ? VOXEL.waterShelf : VOXEL.waterSurface
    let rockTop = floor
    if (hasCoastalRocks(world, tile) && Number.isFinite(nearestLand)) {
      const [cx, cz] = centreColumn(world, tile)
      const turn = Math.floor(hash(seed, tile.x, 85, tile.z) * 4)
      const dx = gx - cx, dz = gz - cz
      const rx = turn === 0 ? dx : turn === 1 ? -dz : turn === 2 ? -dx : dz
      const rz = turn === 0 ? dz : turn === 1 ? dx : turn === 2 ? -dz : -dx
      const emerged = hash(seed, tile.x, 83, tile.z) < 0.45 && floor >= -detail
      const variation = hash(seed, tile.x, 84, tile.z)
      const peak = emerged ? top + Math.round(scale * (0.125 + 0.125 * variation))
        : Math.min(top - detail, floor + Math.round(scale * (0.25 + 0.125 * variation)))
      for (const [x, z, radius, drop] of [[-0.9, -0.6, 1.25, 0], [0.8, 0.5, 1.1, 1], [-0.2, 1.1, 0.9, 2]] as const) {
        const ax = Math.abs(rx - x * detail), az = Math.abs(rz - z * detail)
        if (Math.max(ax, az) > radius * detail || ax + az > radius * detail * 1.7) continue
        rockTop = Math.max(rockTop, peak - drop * detail)
      }
    }
    return { top, surface, body: 'water', floor, floorSurface, capSurface, rockTop, tile, known: true }
  }
  const level = landLevel(scale, tile.terrain, tile.elevation)
  if (world.sites[id]) {
    // A settlement levels its tile; a lane runs from the keep to the front edge with a branch to the west house.
    const [cx, cz] = centreColumn(world, tile)
    const u = Math.floor((gx - cx) / detail)
    const v = Math.floor((gz - cz) / detail)
    const path = scale >= 8 && ((v >= 0 && (u === -1 || u === 0)) || (v === 1 && u >= -4 && u < 0))
    const hills = tile.terrain === 'hills'
    return { top: level, surface: path ? VOXEL.path : hills ? VOXEL.hillGrass : VOXEL.grass,
      body: hills ? 'cliff' : 'dirt', tile, known: true }
  }
  const bank = resourceAt(world, tile) ? undefined : sandbankLevel(world, known, id, gx, gz)
  if (bank !== undefined) return { top: Math.min(level, bank), surface: VOXEL.sand, body: 'sand', tile, known: true }
  if (tile.terrain === 'grassland') {
    const patch = noise(seed, 1, nx, nz, 5)
    const surface = patch < 0.3 ? VOXEL.grassDark : patch > 0.72 ? VOXEL.grassLight : VOXEL.grass
    return { top: level, surface, body: 'dirt', tile, known: true }
  }
  const surface = noise(seed, 3, nx, nz, scale * 0.7) < 0.35 ? VOXEL.hillGrassDark : VOXEL.hillGrass
  return { top: level, surface, body: 'cliff', tile, known: true }
}

function columnHeight(world: VoxelWorld, known: Uint8Array, gx: number, gz: number): number | undefined {
  const id = columnTileAt(world, gx, gz)
  if (id < 0) return
  const tile = world.map.tiles[id]!
  if (known[id] !== 1) return fogLevel(world.scale) * world.size
  // Most water still needs only the cap; only candidate outcrop tiles require a coastal sample.
  if (isWater(tile) && !hasCoastalRocks(world, tile)) return waterLevel(world.scale) * world.size
  const info = column(world, known, gx, gz)!
  return (info.body === 'water' ? Math.max(info.top, info.rockTop) : info.top) * world.size
}

/** World y of the visible ground, shared by picking, figures, markers and diagnostic projection. */
export function groundHeight(world: VoxelWorld, known: Uint8Array, x: number, z: number): number | undefined {
  return columnHeight(world, known, Math.floor((x - world.originX) * world.scale), Math.floor((z - world.originZ) * world.scale))
}

function layerKind(world: VoxelWorld, layer: number, info: Column): number {
  const { base } = world
  // Uncharted columns stay fog down to the bottom, so the diorama grows out of the unknown as it is charted.
  if (info.body === 'fog') return VOXEL.fog
  if (info.body === 'water') {
    const level = layer - base
    if (level < info.floor) return level === info.floor - 1 || info.floorSurface === VOXEL.seabedDeep
      ? info.floorSurface : VOXEL.seabedStone
    if (level < info.rockTop) return level < info.top ? VOXEL.underwaterRock : VOXEL.stone
    if (level === info.top - 1) return info.capSurface
    return VOXEL.waterSurface
  }
  if (layer < base) {
    const depth = base - 1 - layer
    // The diorama base shows stratified soil like a cut-out terrain sample.
    return layer === 0 && base >= 2 ? VOXEL.bedrock : Math.floor(depth / 2) % 2 ? VOXEL.soilDark : VOXEL.soil
  }
  const level = layer - base
  if (level === info.top - 1) return info.surface
  if (info.body === 'sand') return VOXEL.sand
  const band = Math.floor(level / 2) % 3 === 2
  if (info.body === 'cliff') return band ? VOXEL.cliffDark : VOXEL.cliff
  return band ? VOXEL.dirtDark : VOXEL.dirt
}

// Screen-aligned (right, down) offsets from the hex centre, back row first, so the centre and front stay clear for units.
const TREE_SPOTS = [[-0.24, -0.16], [0.24, -0.2], [0, -0.33], [-0.28, 0.13], [0.28, 0.11]] as const
/** Trees per hex for each forest density. */
const TREE_COUNT = [0, 2, 3, 5] as const
/** Extra radius at the foot of a conifer. */
const CONIFER_FLARE = 0.25
/** West, north-west and north-east: the neighbours drawn behind a hex, whose settlements its back-row trees would hide. */
const BEHIND = [3, 4, 5] as const

function settlementBehind(world: VoxelWorld, known: Uint8Array, tile: Tile): boolean {
  const { width, height } = world.map
  const offsets = hexOffsets(tile.z)
  return BEHIND.some(direction => {
    const [dx, dz] = offsets[direction]!
    const x = tile.x + dx, z = tile.z + dz
    if (x < 0 || z < 0 || x >= width || z >= height) return false
    const id = z * width + x
    return known[id] === 1 && world.sites[id] !== 0
  })
}

/** A voxel grid with one empty voxel of padding on every side, so faces at its border are always emitted. */
export interface Volume { data: Uint8Array; x0: number; z0: number; width: number; depth: number; height: number; strideY: number }

export function createVolume(x0: number, z0: number, width: number, depth: number, height: number): Volume {
  const strideY = (width + 2) * (depth + 2)
  return { data: new Uint8Array(strideY * (height + 2)), x0, z0, width, depth, height, strideY }
}

/** Places a voxel at grid column (gx, gz) unless it lies outside the padded volume or is already filled. */
export function placeVoxel(volume: Volume, gx: number, layer: number, gz: number, kind: number): void {
  const x = gx - volume.x0 + 1
  const z = gz - volume.z0 + 1
  if (x < 0 || z < 0 || x >= volume.width + 2 || z >= volume.depth + 2 || layer < 0) return
  const index = (layer + 1) * volume.strideY + z * (volume.width + 2) + x
  if (index < volume.data.length && volume.data[index] === 0) volume.data[index] = kind
}

function placeBlock(volume: Volume, gx: number, layer: number, gz: number, kind: number, size: number): void {
  for (let y = 0; y < size; y++) for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    placeVoxel(volume, gx + x, layer + y, gz + z, kind)
  }
}

interface Roofing { wall: number; roof: number; ridge: number }
const DWELLING: Roofing = { wall: VOXEL.wall, roof: VOXEL.roof, ridge: VOXEL.roofRidge }
const STOREHOUSE: Roofing = { wall: VOXEL.plank, roof: VOXEL.thatch, ridge: VOXEL.thatchRidge }

/** A gabled building; doors (+z) and windows (+x) face the camera. Three-voxel roofs carry a ridge. */
function stampHouse(volume: Volume, gx: number, gz: number, ground: number, sizeX: number, sizeZ: number, walls: number,
  ridge: 'x' | 'z', style: Roofing, detail = 1): void {
  for (let dz = 0; dz < sizeZ; dz++) {
    for (let dx = 0; dx < sizeX; dx++) {
      for (let layer = 0; layer < walls; layer++) {
        let kind = style.wall
        if (sizeX >= 3 && layer === 0 && dz === sizeZ - 1 && dx === 1) kind = VOXEL.door
        else if (sizeZ >= 3 && layer === walls - 1 && dx === sizeX - 1 && dz === 1) kind = VOXEL.window
        placeBlock(volume, gx + dx * detail, ground + layer * detail, gz + dz * detail, kind, detail)
      }
      placeBlock(volume, gx + dx * detail, ground + walls * detail, gz + dz * detail, style.roof, detail)
      const crest = ridge === 'x' ? sizeZ === 3 && dz === 1 : sizeX === 3 && dx === 1
      if (crest) placeBlock(volume, gx + dx * detail, ground + (walls + 1) * detail, gz + dz * detail, style.ridge, detail)
    }
  }
}

/** A stone keep with crenellations and a banner in the owner's colour. */
function stampKeep(volume: Volume, gx: number, gz: number, ground: number, size: number, height: number, banner: number, detail = 1): void {
  const last = size - 1
  for (let dz = 0; dz < size; dz++) {
    for (let dx = 0; dx < size; dx++) {
      for (let layer = 0; layer < height; layer++) {
        let kind = (dx + dz + layer) % 3 === 0 ? VOXEL.castleDark : VOXEL.castle
        if (size >= 3 && layer === 0 && dz === last && dx === 1) kind = VOXEL.door
        else if (size >= 3 && layer === height - 2 && ((dx === last && dz === 1) || (dz === last && dx === 1))) kind = VOXEL.window
        placeBlock(volume, gx + dx * detail, ground + layer * detail, gz + dz * detail, kind, detail)
      }
      if (size >= 3 && (dx === 0 || dx === last) && (dz === 0 || dz === last)) {
        placeBlock(volume, gx + dx * detail, ground + height * detail, gz + dz * detail, VOXEL.castle, detail)
      }
    }
  }
  if (size < 3) {
    placeVoxel(volume, gx, ground + height, gz, banner)
    return
  }
  placeBlock(volume, gx + detail, ground + height * detail, gz + detail, VOXEL.timber, detail)
  placeBlock(volume, gx + detail, ground + (height + 1) * detail, gz + detail, banner, detail)
  placeBlock(volume, gx + 2 * detail, ground + (height + 1) * detail, gz + detail, banner, detail)
}

/** Tiles whose hexes, widened by `margin` columns, may overlap the padded volume. */
function tilesNear(world: VoxelWorld, volume: Volume, margin: number): Tile[] {
  const { map, size, originX, originZ } = world
  const xMin = originX + (volume.x0 - 1 - margin) * size
  const xMax = originX + (volume.x0 + volume.width + 1 + margin) * size
  const zMin = originZ + (volume.z0 - 1 - margin) * size
  const zMax = originZ + (volume.z0 + volume.depth + 1 + margin) * size
  const top = Math.max(0, Math.floor((zMin - HEX_RADIUS) / HEX_ROW))
  const bottom = Math.min(map.height - 1, Math.ceil((zMax + HEX_RADIUS) / HEX_ROW))
  const left = Math.max(0, Math.floor(xMin - 1))
  const right = Math.min(map.width - 1, Math.ceil(xMax + 1))
  const tiles: Tile[] = []
  for (let z = top; z <= bottom; z++) for (let x = left; x <= right; x++) tiles.push(map.tiles[z * map.width + x]!)
  return tiles
}

function stampSettlements(world: VoxelWorld, known: Uint8Array, volume: Volume): void {
  const { scale, base, sites } = world
  const detail = Math.max(1, scale / 8)
  for (const tile of tilesNear(world, volume, 0)) {
    const code = sites[tile.id]!
    if (!code || known[tile.id] !== 1 || tile.terrain === 'water') continue
    const ground = base + landLevel(scale, tile.terrain, tile.elevation)
    const [x, z] = centreColumn(world, tile)
    const banner = code & 16 ? VOXEL.bannerBlue : VOXEL.bannerGold
    const houses = ((code >> 1) & 3) + 1
    // Every stamp stays inside the columns each hex owns for any row phase: at scale 8 rows -2..2 span
    // columns -4..3 around the centre and rows ±3 span -2..1; at scale 4 row 0 spans -2..1 and rows ±1 span -1..0.
    if (scale >= 8) {
      stampKeep(volume, x - detail, z - 3 * detail, ground, 3, 4, banner, detail)
      stampHouse(volume, x - 4 * detail, z - 2 * detail, ground, 3, 3, 2, 'z', DWELLING, detail)
      if (houses >= 2) stampHouse(volume, x + detail, z - detail + 1, ground, 3, 3, 2, 'x', DWELLING, detail)
      if (code & 8) stampHouse(volume, x + 2 * detail, z - 2 * detail, ground, 2, 2, 2, 'x', STOREHOUSE, detail)
      else if (houses >= 3) stampHouse(volume, x + 2 * detail, z - 2 * detail, ground, 2, 2, 2, 'x', DWELLING, detail)
    } else if (scale >= 4) {
      stampHouse(volume, x - 1, z, ground, 2, 2, 1, 'x', DWELLING)
      stampKeep(volume, x + 1, z, ground, 1, 2, banner)
    } else stampHouse(volume, x - 1, z, ground, 2, 1, 1, 'x', DWELLING)
  }
}

function stampTrees(world: VoxelWorld, known: Uint8Array, volume: Volume): void {
  const { scale, seed, base, reach, originX, originZ } = world
  const shape = treeShape(scale)
  const detail = Math.max(1, scale / 8)
  for (const tile of tilesNear(world, volume, reach)) {
    if (known[tile.id] !== 1 || world.sites[tile.id]) continue
    const resource = resourceAt(world, tile)
    if (resource === 'stone' || (!tile.trees && resource !== 'apples')) continue
    const orchard = resource === 'apples'
    const [hx, hz] = hexCenter(tile.x, tile.z)
    const count = Math.min(orchard ? 3 : TREE_COUNT[tile.trees] ?? 0, shape.spots)
    const clearing = settlementBehind(world, known, tile)
    const jitter = scale >= 8 ? detail : 0
    for (let index = 0; index < count; index++) {
      const [right, down] = scale >= 4 ? TREE_SPOTS[index]! : [0, 0]
      if (clearing && down < 0) continue
      const fx = right * SCREEN_RIGHT[0] + down * SCREEN_DOWN[0]
      const fz = right * SCREEN_RIGHT[1] + down * SCREEN_DOWN[1]
      const cx = Math.floor((hx + fx - originX) * scale) + Math.round((hash(seed, tile.id, 10 + index, 0) * 2 - 1) * jitter)
      const cz = Math.floor((hz + fz - originZ) * scale) + Math.round((hash(seed, tile.id, 20 + index, 0) * 2 - 1) * jitter)
      if (columnTileAt(world, cx, cz) !== tile.id) continue
      const footing = column(world, known, cx, cz)!
      const rootX = cx - Math.floor(detail / 2), rootZ = cz - Math.floor(detail / 2)
      let supported = true
      // The whole trunk must stay on its charted tile, not over sand cuts or the map edge.
      for (let z = 0; z < detail && supported; z++) for (let x = 0; x < detail; x++) {
        const support = column(world, known, rootX + x, rootZ + z)
        if (!support?.known || support.tile.id !== tile.id || support.body === 'sand') supported = false
      }
      if (!supported) continue
      const trunk = shape.trunk + Math.floor(hash(seed, tile.id, 30 + index, 0) * (shape.trunkVariance + 1))
      const radius = shape.radius + hash(seed, tile.id, 40 + index, 0) * shape.radiusVariance
      const layers = shape.layers + Math.floor(hash(seed, tile.id, 50 + index, 0) * (shape.layerVariance + 1))
      const species = hash(seed, tile.id, 60 + index, 0)
      const conifer = !orchard && species < 0.5
      const leaves = LEAVES[orchard ? 1 : conifer ? (species < 0.3 ? 2 : 0) : (species < 0.8 ? 1 : 3)]!
      const ground = base + footing.top
      for (let layer = 0; layer < trunk; layer++) for (let z = 0; z < detail; z++) for (let x = 0; x < detail; x++) {
        placeVoxel(volume, rootX + x, ground + layer, rootZ + z, VOXEL.trunk)
      }
      const crown = conifer && scale >= 4 ? layers + detail : layers
      const span = Math.ceil(radius + CONIFER_FLARE * detail)
      for (let layer = 0; layer < crown; layer++) {
        const rise = layer / Math.max(1, crown - 1)
        // Conifers taper in staggered tiers; round crowns are ellipsoids.
        const tier = (radius + CONIFER_FLARE * detail) * (1 - rise * 0.85) * (Math.floor(layer / detail) % 2 === 1 ? 0.8 : 1)
        const dy = (layer - (crown - 1) / 2) / (crown / 2)
        for (let dz = -span; dz <= span; dz++) {
          for (let dx = -span; dx <= span; dx++) {
            const extent = conifer
              ? (dx * dx + dz * dz) / Math.max(0.25, tier * tier)
              : (dx * dx + dz * dz) / (radius * radius) + dy * dy
            if (extent > 1) continue
            const gx = cx + dx
            const gz = cz + dz
            const gy = ground + trunk + layer
            const grain = hash(seed, gx + world.offsetX, gy, gz + world.offsetZ)
            // Nibble the outer shell so canopies read as organic voxel clusters, not spheres.
            if (scale >= 8 && !conifer && extent > 0.62 && grain < 0.22) continue
            const light = grain < 0.2 + 0.4 * rise
            const fruit = orchard && scale >= 8 && extent > 0.4 && layer >= detail
              && hash(seed, gx + world.offsetX, gy + 131, gz + world.offsetZ) > 0.85
            placeVoxel(volume, gx, gy, gz, fruit ? light ? VOXEL.appleLight : VOXEL.appleRed : light ? leaves[1] : leaves[0])
          }
        }
      }
    }
  }
}

function stampDeposits(world: VoxelWorld, known: Uint8Array, volume: Volume): void {
  const { scale, base, seed } = world
  const detail = Math.max(1, scale / 8)
  for (const tile of tilesNear(world, volume, 0)) {
    if (known[tile.id] !== 1 || resourceAt(world, tile) !== 'stone') continue
    const [cx, cz] = centreColumn(world, tile)
    const mirror = hash(seed, tile.x, 121, tile.z) < 0.5 ? -1 : 1
    const dominant = Math.floor(hash(seed, tile.id, 128, 0) * 2)
    const lobes = [[-0.22, -0.24, 0.24, 0.22, 0.32], [0.18, -0.21, 0.23, 0.23, 0.32],
      [-0.3, 0.09, 0.15, 0.13, 0.2], [0.28, 0.16, 0.11, 0.13, 0.12]] as const
    for (const [index, [right, down, radiusX, radiusZ, height]] of lobes.entries()) {
      if (index === 3 && hash(seed, tile.id, 125, 0) < 0.5) continue
      const shift = (hash(seed, tile.id, 123, index) - 0.5) * 0.08
      const x = Math.round(cx + ((mirror * right + shift) * SCREEN_RIGHT[0] + down * SCREEN_DOWN[0]) * scale)
      const z = Math.round(cz + ((mirror * right + shift) * SCREEN_RIGHT[1] + down * SCREEN_DOWN[1]) * scale)
      const spread = 0.9 + hash(seed, tile.id, 126, index) * 0.2
      const spanX = Math.floor(radiusX * scale * spread)
      const spanZ = Math.floor(radiusZ * scale * spread)
      const peak = Math.max(1, Math.round((index === dominant ? 0.5 : height) * scale
        * (0.7 + hash(seed, tile.id, 122, index) * 0.5)))
      const corner = Math.floor(hash(seed, tile.id, 127, index) * 4)
      for (let dz = -spanZ; dz <= spanZ; dz++) for (let dx = -spanX; dx <= spanX; dx++) {
        if (columnTileAt(world, x + dx, z + dz) !== tile.id) continue
        if (scale >= 4 && Math.hypot(x + dx - cx, z + dz - cz) < scale * 0.16) continue
        if (spanX > 0 && spanZ > 0 && Math.abs(dx) + Math.abs(dz) > spanX + spanZ - Math.ceil(detail * 0.7)) continue
        const ground = column(world, known, x + dx, z + dz)!.top
        // Broad flat blocks with a chipped shoulder, not another stack of concentric hill terraces.
        const shoulder = dx * (corner & 1 ? -1 : 1) > spanX * 0.25 && dz * (corner & 2 ? -1 : 1) > spanZ * 0.25 ? detail : 0
        const top = Math.max(1, peak - shoulder)
        for (let y = 0; y < top; y++) placeVoxel(volume, x + dx, base + ground + y, z + dz,
          hash(seed, Math.floor((x + dx) / detail), 124 + Math.floor(y / detail), Math.floor((z + dz) / detail)) < 0.22
            ? VOXEL.depositStoneDark : VOXEL.depositStone)
      }
    }
  }
}

function stampDetails(world: VoxelWorld, volume: Volume, columns: (Column | undefined)[]): void {
  const { scale, seed, base } = world
  if (scale < 8) return
  const density = (8 / scale) ** 2
  for (let z = 0; z < volume.depth + 2; z++) {
    for (let x = 0; x < volume.width + 2; x++) {
      const info = columns[z * (volume.width + 2) + x]
      if (!info?.known || world.sites[info.tile.id]) continue
      const gx = volume.x0 + x - 1
      const gz = volume.z0 + z - 1
      const roll = hash(seed, gx + world.offsetX, 70, gz + world.offsetZ)
      // Sparse tufts keep open ground calm, so hex lines, borders and units stay readable.
      if (info.tile.terrain === 'grassland' && info.surface !== VOXEL.sand && roll < 0.02 * density) {
        const pick = hash(seed, gx + world.offsetX, 71, gz + world.offsetZ)
        placeVoxel(volume, gx, base + info.top, gz, pick < 0.8 ? VOXEL.tuft : FLOWERS[Math.floor((pick - 0.8) / 0.2 * 4)]!)
      } else if ((info.tile.terrain === 'hills' || info.body === 'sand') && roll < 0.012 * density) {
        placeVoxel(volume, gx, base + info.top, gz, VOXEL.stone)
      }
    }
  }
}

function fillVolume(world: VoxelWorld, known: Uint8Array, chunk: number): Volume {
  const { chunkColumns, chunksX, columnsX, columnsZ, layers, base } = world
  const x0 = (chunk % chunksX) * chunkColumns
  const z0 = Math.floor(chunk / chunksX) * chunkColumns
  const volume = createVolume(x0, z0, Math.min(chunkColumns, columnsX - x0), Math.min(chunkColumns, columnsZ - z0), layers)
  const { width, depth, strideY } = volume
  const columns: (Column | undefined)[] = new Array(strideY)
  for (let z = 0; z < depth + 2; z++) {
    for (let x = 0; x < width + 2; x++) {
      const info = column(world, known, x0 + x - 1, z0 + z - 1)
      if (!info) continue
      columns[z * (width + 2) + x] = info
      const top = info.body === 'water' ? Math.max(info.top, info.rockTop) : info.top
      for (let layer = 0; layer < base + top; layer++) {
        volume.data[(layer + 1) * strideY + z * (width + 2) + x] = layerKind(world, layer, info)
      }
    }
  }
  stampSettlements(world, known, volume)
  stampDeposits(world, known, volume)
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
  push1(a: number): void {
    if (this.length + 1 > this.values.length) {
      const grown = new Float32Array(this.values.length * 2)
      grown.set(this.values)
      this.values = grown
    }
    this.values[this.length++] = a
  }
}

/**
 * Faces never seen from the fixed camera, which looks down from +x/+z, and facing away from the light are skipped:
 * +y, +x and +z are visible; -z faces the key light and closes the shadow-caster shell.
 */
export const FACE_DIRECTIONS: readonly (readonly [axis: number, sign: 1 | -1])[] = [[1, 1], [0, 1], [2, 1], [2, -1]]
const NO_MERGE = 1 << 16
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const

/** Builds one chunk mesh from the viewer's knowledge (`known[tileId] === 1`); unknown tiles become fog blocks. */
export function meshChunk(world: VoxelWorld, known: Uint8Array, chunk: number): ChunkMesh {
  const volume = fillVolume(world, known, chunk)
  return meshVolume(volume, world.size,
    [world.originX + volume.x0 * world.size, -world.base * world.size, world.originZ + volume.z0 * world.size])
}

/** Greedy-meshes a volume with baked ambient occlusion; `corner` is the world position of voxel (x0, 0, z0). */
export function meshVolume(volume: Volume, size: number, corner: readonly [number, number, number]): ChunkMesh {
  const { data, width, depth, height, strideY } = volume
  const lo = [1, 1, 1]
  const hi = [1 + width, 1 + height, 1 + depth]
  const strides = [1, strideY, width + 2]
  const offset = [corner[0] - size, corner[1] - size, corner[2] - size]
  const positions = new Buffer(1 << 14)
  const normals = new Buffer(1 << 14)
  const colors = new Buffer(1 << 14)
  const faceFlags = new Buffer(1 << 12)
  let indices = new Uint32Array(1 << 13)
  let indexCount = 0
  const waterIndices: number[] = []
  const opaque = (index: number) => !!data[index] && !isWaterSurface(data[index])
  let quads = 0
  const point = [0, 0, 0]
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
          const neighbor = data[index + sa]
          if (!kind || (neighbor && (isWaterSurface(kind) || !isWaterSurface(neighbor)))) {
            mask[cell++] = 0
            continue
          }
          if (kind === VOXEL.fog || isWaterSurface(kind)) { mask[cell++] = kind | (0xff << 8); continue }
          const q = index + sa
          let ao = 0
          let uniform = true
          let first = -1
          for (let k = 0; k < 4; k++) {
            const [du, dv] = CORNERS[k]!
            const side1 = opaque(q + du * su) ? 1 : 0
            const side2 = opaque(q + dv * sv) ? 1 : 0
            const diagonal = opaque(q + du * su + dv * sv) ? 1 : 0
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
          const waterSurface = isWaterSurface(key & 0xff) && a === 1
          // The diorama cut edge is a blue volume wall, not a transparent view through the map.
          const kind = isWaterSurface(key & 0xff) && !waterSurface ? VOXEL.water : key & 0xff
          const ao = (key >> 8) & 0xff
          const base = positions.length / 3
          const plane = i + (sign > 0 ? 1 : 0)
          const fog = kind === VOXEL.fog
          const seabed = kind === VOXEL.seabedSand || kind === VOXEL.seabedStone || kind === VOXEL.seabedDeep
          const water = kind === VOXEL.water || kind === VOXEL.shallow || kind === VOXEL.shoal
            || kind === VOXEL.shelf || kind === VOXEL.underwaterRock
          const flag = fog ? FACE_FLAG.fog : seabed ? FACE_FLAG.waterFloor : kind === VOXEL.waterEdge ? FACE_FLAG.waterEdge
            : waterSurface ? FACE_FLAG.waterSurface : water ? FACE_FLAG.water
            : kind >= FIRST_DECORATION ? FACE_FLAG.decoration : FACE_FLAG.ground
          for (let k = 0; k < 4; k++) {
            point[a] = plane
            point[u] = lo[u]! + ju + (k === 1 || k === 2 ? w : 0)
            point[v] = lo[v]! + jv + (k >= 2 ? h : 0)
            positions.push3(offset[0]! + point[0]! * size, offset[1]! + point[1]! * size, offset[2]! + point[2]! * size)
            normals.push3(a === 0 ? sign : 0, a === 1 ? sign : 0, a === 2 ? sign : 0)
            const light = fog ? 1 : AO_LIGHT[(ao >> (k * 2)) & 3]!
            colors.push4(PALETTE[kind * 3]! * light, PALETTE[kind * 3 + 1]! * light, PALETTE[kind * 3 + 2]! * light, flag)
            faceFlags.push1(flag)
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
          if (waterSurface) for (const vertex of order) waterIndices.push(base + vertex)
          else for (const vertex of order) indices[indexCount++] = base + vertex
          quads++
        }
      }
    }
  }
  const combinedIndices = new Uint32Array(indexCount + waterIndices.length)
  combinedIndices.set(indices.subarray(0, indexCount))
  combinedIndices.set(waterIndices, indexCount)
  return {
    positions: positions.values.slice(0, positions.length), normals: normals.values.slice(0, normals.length),
    colors: colors.values.slice(0, colors.length), faceFlags: faceFlags.values.slice(0, faceFlags.length),
    indices: combinedIndices, waterIndexCount: waterIndices.length, quads,
  }
}

/** Chunks whose voxels can change when the given tiles change between fog and charted terrain or gain a settlement. */
export function affectedChunks(world: VoxelWorld, tileIds: Iterable<number>): Set<number> {
  const { map, scale, reach, chunkColumns, chunksX, chunksZ } = world
  const chunks = new Set<number>()
  // A changed tile moves its own columns, its trees, coastal bands next to it and adjacent ambient occlusion.
  // A settlement also clears back-row trees of the hexes east, south-east and south-west of it, half a hex further in x.
  const margin = Math.max(reach + 3, 2 * shoalReach(scale) + 2, sandbankReach(scale) + reach + 1)
  const halfX = scale / 2 + Math.ceil(scale / 2)
  const halfZ = Math.ceil(HEX_RADIUS * scale)
  for (const id of tileIds) {
    const [gx, gz] = centreColumn(world, map.tiles[id]!)
    const left = Math.max(0, Math.floor((gx - halfX - margin) / chunkColumns))
    const right = Math.min(chunksX - 1, Math.floor((gx + halfX + margin) / chunkColumns))
    const top = Math.max(0, Math.floor((gz - halfZ - margin) / chunkColumns))
    const bottom = Math.min(chunksZ - 1, Math.floor((gz + halfZ + margin) / chunkColumns))
    for (let cz = top; cz <= bottom; cz++) for (let cx = left; cx <= right; cx++) chunks.add(cz * chunksX + cx)
  }
  return chunks
}

/**
 * Deterministic tile picking on the actual terrain heightfield: march the ray through voxel columns (2D DDA) and
 * return the tile of the first column whose surface it passes below. Decorations never intercept tile picks.
 */
export function pickTile(world: VoxelWorld, known: Uint8Array,
  origin: readonly [number, number, number], direction: readonly [number, number, number]): number | undefined {
  const { columnsX, columnsZ, columnTile, size, originX, originZ } = world
  const [ox, oy, oz] = origin
  const [dx, dy, dz] = direction
  const top = (world.layers - world.base) * size
  const bounds = [[originX, originX + columnsX * size, ox, dx], [-world.base * size, top + 1e-6, oy, dy],
    [originZ, originZ + columnsZ * size, oz, dz]] as const
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
  let x = Math.min(columnsX - 1, Math.max(0, Math.floor((ox + dx * (enter + epsilon) - originX) / size)))
  let z = Math.min(columnsZ - 1, Math.max(0, Math.floor((oz + dz * (enter + epsilon) - originZ) / size)))
  const stepX = Math.sign(dx)
  const stepZ = Math.sign(dz)
  const nextX = (cell: number) => stepX ? (originX + (cell + (stepX > 0 ? 1 : 0)) * size - ox) / dx : Infinity
  const nextZ = (cell: number) => stepZ ? (originZ + (cell + (stepZ > 0 ? 1 : 0)) * size - oz) / dz : Infinity
  let tx = nextX(x)
  let tz = nextZ(z)
  for (;;) {
    const leave = Math.min(tx, tz, exit)
    const id = columnTile[z * columnsX + x]!
    if (id >= 0 && oy + dy * leave <= columnHeight(world, known, x, z)! + epsilon) return id
    if (leave >= exit) return
    // A ray through an exact column corner passes diagonally; it does not touch the two edge neighbours.
    const both = Math.abs(tx - tz) < epsilon
    const advanceX = both || tx < tz
    const advanceZ = both || tz < tx
    if (advanceX) { x += stepX; tx = nextX(x) }
    if (advanceZ) { z += stepZ; tz = nextZ(z) }
    if (x < 0 || z < 0 || x >= columnsX || z >= columnsZ) return
  }
}
