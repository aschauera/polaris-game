import { HEX_RADIUS, HEX_ROW, hexAt, hexCenter, hexOffsets } from '../game/hex'
import { TERRAIN, seedState, type Tile, type WorldMap } from '../game/map'

// Pure voxel construction: no Babylon objects, so meshing and picking are unit-testable in Node.

/** 66 columns fit a 32-tile hex map (32.5 tiles of 8 voxels) into four chunks per axis. */
export const CHUNK_COLUMNS = 66

const SOURCE = {
  fog: '#263b4a',
  grass: '#5fb13f', grassLight: '#68ba46', grassDark: '#57a63b', sand: '#e6cf86',
  dirt: '#8c5c33', dirtDark: '#744a29', soil: '#5c4630', soilDark: '#4a3925', bedrock: '#382c20',
  hillGrass: '#8fa64c', hillGrassDark: '#7f9744', rock: '#a29d90', rockDark: '#857f73',
  cliff: '#9a6a45', cliffDark: '#7d5438', stone: '#bcb7ab',
  water: '#4fb3df', shallow: '#86d5ea', shoal: '#64c5ea',
  path: '#cfb07a',
  trunk: '#6b4a2b',
  leafTeal: '#2f9a7c', leafTealLight: '#43b391', leafGreen: '#3f9b3a', leafGreenLight: '#57b34b',
  leafDark: '#23735f', leafDarkLight: '#2f8a70', leafLime: '#86c94a', leafLimeLight: '#a3dc5f',
  tuft: '#76c457', flowerWhite: '#f1eee4', flowerYellow: '#f1cf4b', flowerRed: '#d9554b', flowerViolet: '#9b72cf',
  wall: '#efe4cc', timber: '#9c7a55', door: '#5b3f2a', window: '#3f4b57',
  roof: '#c8473b', roofRidge: '#a5372e', plank: '#a8743f', thatch: '#d9ad4e', thatchRidge: '#bf9238',
  castle: '#aeaca5', castleDark: '#8f8d86', bannerGold: '#f0c873', bannerBlue: '#5a7fe0',
  goldDark: '#b4842f', blueDark: '#3a58ad', skin: '#f0c49a', hair: '#5a3b24', steel: '#c9ced6', leather: '#7a5230',
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
/** Vertex colour alpha tells the shader what a face shows. */
export const FACE_FLAG = { fog: 0, decoration: 0.5, ground: 1 } as const

export interface VoxelWorld {
  readonly map: WorldMap
  /** Voxels across one hex, between opposite edges. */
  readonly scale: number
  /** World units per voxel edge. */
  readonly size: number
  /** World x and z of the low corner of voxel column (0, 0). */
  readonly originX: number
  readonly originZ: number
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
  readonly indices: Uint32Array
  readonly quads: number
}

interface TreeShape {
  trunk: number; trunkVariance: number; radius: number; radiusVariance: number; layers: number; layerVariance: number
  /** Most trees one hex holds at this scale. */
  spots: number
}

/** Ground directions of screen-right and screen-down for the renderer's camera, which looks along the south-east axis. */
export const SCREEN_RIGHT = [-Math.sqrt(3) / 2, 0.5] as const
export const SCREEN_DOWN = [0.5, Math.sqrt(3) / 2] as const

/** Powers of two keep voxel coordinates exact; finer voxels for smaller maps keep the column budget bounded. */
export function voxelScale(width: number, height: number): number {
  const ratio = 512 / Math.max(width, height)
  return ratio >= 8 ? 8 : ratio >= 4 ? 4 : 2
}

function treeShape(scale: number): TreeShape {
  if (scale >= 8) return { trunk: 1, trunkVariance: 1, radius: 1.35, radiusVariance: 0.45, layers: 4, layerVariance: 2, spots: 5 }
  if (scale >= 4) return { trunk: 1, trunkVariance: 0, radius: 1, radiusVariance: 0, layers: 2, layerVariance: 1, spots: 2 }
  return { trunk: 0, trunkVariance: 0, radius: 0.6, radiusVariance: 0, layers: 2, layerVariance: 0, spots: 1 }
}

export function waterLevel(scale: number): number { return Math.max(1, Math.round(0.25 * scale)) }
/** Columns of turquoise shoal water around charted land, beyond the shallow rim; none at the coarsest scale. */
function shoalReach(scale: number): number { return scale >= 8 ? 4 : scale >= 4 ? 2 : 0 }
function fogLevel(scale: number): number { return Math.max(1, Math.round(0.65 * scale)) }
function bumpLimit(scale: number): number { return scale >= 8 ? 2 : scale >= 4 ? 1 : 0 }

function landLevel(scale: number, terrain: 'grassland' | 'hills', elevation: number): number {
  // At coarse scales every elevation step still needs at least one voxel.
  return Math.max(Math.round((TERRAIN[terrain].height + (elevation - 1) * 0.24) * scale), waterLevel(scale) + elevation)
}

export function createVoxelWorld(map: WorldMap, chunkColumns = CHUNK_COLUMNS): VoxelWorld {
  const scale = voxelScale(map.width, map.height)
  const size = 1 / scale
  const shape = treeShape(scale)
  const base = Math.max(1, Math.round(0.75 * scale))
  // Hexes reach half a tile beyond the outer centres in x and one corner radius in z.
  const pad = Math.ceil(HEX_RADIUS * scale)
  const originX = -0.5
  const originZ = -pad * size
  const columnsX = Math.round((map.width + (map.height > 1 ? 0.5 : 0)) * scale)
  const columnsZ = Math.ceil(((map.height - 1) * HEX_ROW + HEX_RADIUS) * scale) + pad
  const columnTile = new Int32Array(columnsX * columnsZ)
  for (let gz = 0; gz < columnsZ; gz++) {
    for (let gx = 0; gx < columnsX; gx++) {
      const [x, z] = hexAt(originX + (gx + 0.5) * size, originZ + (gz + 0.5) * size)
      columnTile[gz * columnsX + gx] = x >= 0 && z >= 0 && x < map.width && z < map.height ? z * map.width + x : -1
    }
  }
  const highest = landLevel(scale, 'hills', 4) + bumpLimit(scale)
  // Conifers grow one layer taller than round crowns.
  const tree = shape.trunk + shape.trunkVariance + shape.layers + shape.layerVariance + 1
  return {
    map, scale, size, originX, originZ, columnsX, columnsZ, columnTile, base, layers: base + highest + tree + 1, chunkColumns,
    chunksX: Math.ceil(columnsX / chunkColumns), chunksZ: Math.ceil(columnsZ / chunkColumns),
    reach: Math.ceil(shape.radius + shape.radiusVariance + CONIFER_FLARE) + 1, seed: seedState(map.seed),
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
  if (gx < 0 || gz < 0 || gx >= world.columnsX || gz >= world.columnsZ) return -1
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

const AXES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

/** Whether a charted tile other than the column's own lies `steps` columns away along a grid axis and matches. */
function borders(world: VoxelWorld, known: Uint8Array, id: number, gx: number, gz: number, steps: number,
  matches: (neighbor: Tile) => boolean): boolean {
  for (const [dx, dz] of AXES) {
    const other = columnTileAt(world, gx + dx * steps, gz + dz * steps)
    // Only charted neighbors may shape this tile, or its rim would reveal hidden terrain.
    if (other >= 0 && other !== id && known[other] === 1 && matches(world.map.tiles[other]!)) return true
  }
  return false
}

const isLand = (tile: Tile) => tile.terrain !== 'water'
const isWater = (tile: Tile) => tile.terrain === 'water'

/** Whether a column of charted land lies within a jittered disc of `radius` columns, so shoals follow the coast's shape. */
function nearChartedLand(world: VoxelWorld, known: Uint8Array, gx: number, gz: number, radius: number): boolean {
  const reach = Math.ceil(radius)
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (dx * dx + dz * dz > radius * radius) continue
      const other = columnTileAt(world, gx + dx, gz + dz)
      // Uncharted land must not shape visible water, or the shoal would outline hidden coasts.
      if (other >= 0 && known[other] === 1 && isLand(world.map.tiles[other]!)) return true
    }
  }
  return false
}

function column(world: VoxelWorld, known: Uint8Array, gx: number, gz: number): Column | undefined {
  const id = columnTileAt(world, gx, gz)
  if (id < 0) return
  const { map, scale, seed } = world
  const tile = map.tiles[id]!
  if (known[id] !== 1) return { top: fogLevel(scale), surface: VOXEL.fog, body: 'fog', tile, known: false }
  // Coasts read as soft two-voxel rims at the finest scale.
  const rim = (matches: (neighbor: Tile) => boolean, salt: number) => scale >= 4
    && (borders(world, known, id, gx, gz, 1, matches)
      || (scale >= 8 && noise(seed, salt, gx, gz, 3) > 0.45 && borders(world, known, id, gx, gz, 2, matches)))
  if (tile.terrain === 'water') {
    const reach = shoalReach(scale)
    const shoal = reach > 0 && nearChartedLand(world, known, gx, gz, reach - 0.5 + noise(seed, 10, gx, gz, 4))
    const surface = rim(isLand, 8) ? VOXEL.shallow : shoal ? VOXEL.shoal : VOXEL.water
    return { top: waterLevel(scale), surface, body: 'water', tile, known: true }
  }
  const level = landLevel(scale, tile.terrain, tile.elevation)
  if (world.sites[id]) {
    // A settlement levels its tile; a lane runs from the keep to the front edge with a branch to the west house.
    const [cx, cz] = centreColumn(world, tile)
    const u = gx - cx
    const v = gz - cz
    const path = scale >= 8 && ((v >= 0 && (u === -1 || u === 0)) || (v === 1 && u >= -4 && u < 0))
    const hills = tile.terrain === 'hills'
    return { top: level, surface: path ? VOXEL.path : hills ? VOXEL.hillGrass : VOXEL.grass,
      body: hills ? 'cliff' : 'dirt', tile, known: true }
  }
  if (tile.terrain === 'grassland') {
    const beach = tile.elevation === 1 && noise(seed, 6, gx, gz, 3) > 0.42 && rim(isWater, 9)
    const patch = noise(seed, 1, gx, gz, 5)
    const surface = beach ? VOXEL.sand : patch < 0.3 ? VOXEL.grassDark : patch > 0.72 ? VOXEL.grassLight : VOXEL.grass
    return { top: level, surface, body: 'dirt', tile, known: true }
  }
  const inner = AXES.every(([dx, dz]) => columnTileAt(world, gx + dx, gz + dz) === id)
  const limit = bumpLimit(scale)
  // Each hill tile rises as a terraced hex mound; low-frequency noise keeps the terraces irregular but calm.
  const [hx, hz] = hexCenter(tile.x, tile.z)
  const px = world.originX + (gx + 0.5) * world.size - hx
  const pz = world.originZ + (gz + 0.5) * world.size - hz
  const dome = 1 - Math.max(Math.abs(px), Math.abs(0.5 * px + HEX_ROW * pz), Math.abs(-0.5 * px + HEX_ROW * pz)) / 0.5
  const bump = inner ? Math.max(0, Math.min(limit, Math.floor(dome * (limit + 1) + (noise(seed, 2, gx, gz, 6) - 0.5) * 0.9))) : 0
  const rocky = (limit > 0 && bump === limit && noise(seed, 7, gx, gz, 3) > 0.5) || noise(seed, 3, gx, gz, 6) > 0.8
  const surface = rocky ? (hash(seed, gx, 4, gz) < 0.5 ? VOXEL.rock : VOXEL.rockDark)
    : hash(seed, gx, 5, gz) < 0.35 ? VOXEL.hillGrassDark : VOXEL.hillGrass
  return { top: level + bump, surface, body: 'cliff', tile, known: true }
}

/** World y of the visible ground at a world point, for standing figures on hill mounds. */
export function groundHeight(world: VoxelWorld, known: Uint8Array, x: number, z: number): number | undefined {
  const top = column(world, known, Math.floor((x - world.originX) * world.scale), Math.floor((z - world.originZ) * world.scale))?.top
  return top === undefined ? undefined : top * world.size
}

function layerKind(world: VoxelWorld, layer: number, info: Column): number {
  const { base } = world
  // Uncharted columns stay fog down to the bottom, so the diorama grows out of the unknown as it is charted.
  if (info.body === 'fog') return VOXEL.fog
  if (layer < base) {
    const depth = base - 1 - layer
    // The diorama base shows stratified soil like a cut-out terrain sample.
    return layer === 0 && base >= 2 ? VOXEL.bedrock : Math.floor(depth / 2) % 2 ? VOXEL.soilDark : VOXEL.soil
  }
  const level = layer - base
  if (level === info.top - 1) return info.surface
  if (info.body === 'water') return VOXEL.water
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

interface Roofing { wall: number; roof: number; ridge: number }
const DWELLING: Roofing = { wall: VOXEL.wall, roof: VOXEL.roof, ridge: VOXEL.roofRidge }
const STOREHOUSE: Roofing = { wall: VOXEL.plank, roof: VOXEL.thatch, ridge: VOXEL.thatchRidge }

/** A gabled building; doors (+z) and windows (+x) face the camera. Three-voxel roofs carry a ridge. */
function stampHouse(volume: Volume, gx: number, gz: number, ground: number, sizeX: number, sizeZ: number, walls: number,
  ridge: 'x' | 'z', style: Roofing): void {
  for (let dz = 0; dz < sizeZ; dz++) {
    for (let dx = 0; dx < sizeX; dx++) {
      for (let layer = 0; layer < walls; layer++) {
        let kind = style.wall
        if (sizeX >= 3 && layer === 0 && dz === sizeZ - 1 && dx === 1) kind = VOXEL.door
        else if (sizeZ >= 3 && layer === walls - 1 && dx === sizeX - 1 && dz === 1) kind = VOXEL.window
        placeVoxel(volume, gx + dx, ground + layer, gz + dz, kind)
      }
      placeVoxel(volume, gx + dx, ground + walls, gz + dz, style.roof)
      const crest = ridge === 'x' ? sizeZ === 3 && dz === 1 : sizeX === 3 && dx === 1
      if (crest) placeVoxel(volume, gx + dx, ground + walls + 1, gz + dz, style.ridge)
    }
  }
}

/** A stone keep with crenellations and a banner in the owner's colour. */
function stampKeep(volume: Volume, gx: number, gz: number, ground: number, size: number, height: number, banner: number): void {
  const last = size - 1
  for (let dz = 0; dz < size; dz++) {
    for (let dx = 0; dx < size; dx++) {
      for (let layer = 0; layer < height; layer++) {
        let kind = (dx + dz + layer) % 3 === 0 ? VOXEL.castleDark : VOXEL.castle
        if (size >= 3 && layer === 0 && dz === last && dx === 1) kind = VOXEL.door
        else if (size >= 3 && layer === height - 2 && ((dx === last && dz === 1) || (dz === last && dx === 1))) kind = VOXEL.window
        placeVoxel(volume, gx + dx, ground + layer, gz + dz, kind)
      }
      if (size >= 3 && (dx === 0 || dx === last) && (dz === 0 || dz === last)) placeVoxel(volume, gx + dx, ground + height, gz + dz, VOXEL.castle)
    }
  }
  if (size < 3) {
    placeVoxel(volume, gx, ground + height, gz, banner)
    return
  }
  placeVoxel(volume, gx + 1, ground + height, gz + 1, VOXEL.timber)
  placeVoxel(volume, gx + 1, ground + height + 1, gz + 1, banner)
  placeVoxel(volume, gx + 2, ground + height + 1, gz + 1, banner)
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
      stampKeep(volume, x - 1, z - 3, ground, 3, 4, banner)
      stampHouse(volume, x - 4, z - 2, ground, 3, 3, 2, 'z', DWELLING)
      if (houses >= 2) stampHouse(volume, x + 1, z, ground, 3, 3, 2, 'x', DWELLING)
      if (code & 8) stampHouse(volume, x + 2, z - 2, ground, 2, 2, 2, 'x', STOREHOUSE)
      else if (houses >= 3) stampHouse(volume, x + 2, z - 2, ground, 2, 2, 2, 'x', DWELLING)
    } else if (scale >= 4) {
      stampHouse(volume, x - 1, z, ground, 2, 2, 1, 'x', DWELLING)
      stampKeep(volume, x + 1, z, ground, 1, 2, banner)
    } else stampHouse(volume, x - 1, z, ground, 2, 1, 1, 'x', DWELLING)
  }
}

function stampTrees(world: VoxelWorld, known: Uint8Array, volume: Volume): void {
  const { scale, seed, base, reach, originX, originZ } = world
  const shape = treeShape(scale)
  for (const tile of tilesNear(world, volume, reach)) {
    if (!tile.trees || known[tile.id] !== 1 || world.sites[tile.id]) continue
    const [hx, hz] = hexCenter(tile.x, tile.z)
    const count = Math.min(TREE_COUNT[tile.trees] ?? 0, shape.spots)
    const clearing = settlementBehind(world, known, tile)
    const jitter = scale >= 8 ? 1 : 0
    for (let index = 0; index < count; index++) {
      const [right, down] = TREE_SPOTS[index]!
      if (clearing && down < 0) continue
      const fx = right * SCREEN_RIGHT[0] + down * SCREEN_DOWN[0]
      const fz = right * SCREEN_RIGHT[1] + down * SCREEN_DOWN[1]
      const cx = Math.floor((hx + fx - originX) * scale) + Math.round((hash(seed, tile.id, 10 + index, 0) * 2 - 1) * jitter)
      const cz = Math.floor((hz + fz - originZ) * scale) + Math.round((hash(seed, tile.id, 20 + index, 0) * 2 - 1) * jitter)
      if (columnTileAt(world, cx, cz) !== tile.id) continue
      const trunk = shape.trunk + Math.floor(hash(seed, tile.id, 30 + index, 0) * (shape.trunkVariance + 1))
      const radius = shape.radius + hash(seed, tile.id, 40 + index, 0) * shape.radiusVariance
      const layers = shape.layers + Math.floor(hash(seed, tile.id, 50 + index, 0) * (shape.layerVariance + 1))
      const species = hash(seed, tile.id, 60 + index, 0)
      const conifer = species < 0.5
      const leaves = LEAVES[conifer ? (species < 0.3 ? 2 : 0) : (species < 0.8 ? 1 : 3)]!
      const ground = base + column(world, known, cx, cz)!.top
      for (let layer = 0; layer < trunk; layer++) placeVoxel(volume, cx, ground + layer, cz, VOXEL.trunk)
      const crown = conifer ? layers + 1 : layers
      const span = Math.ceil(radius + CONIFER_FLARE)
      for (let layer = 0; layer < crown; layer++) {
        const rise = layer / Math.max(1, crown - 1)
        // Conifers taper in staggered tiers; round crowns are ellipsoids.
        const tier = (radius + CONIFER_FLARE) * (1 - rise * 0.85) * (layer % 2 === 1 ? 0.8 : 1)
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
            const grain = hash(seed, gx, gy, gz)
            // Nibble the outer shell so canopies read as organic voxel clusters, not spheres.
            if (scale >= 8 && !conifer && extent > 0.62 && grain < 0.22) continue
            const light = grain < 0.2 + 0.4 * rise
            placeVoxel(volume, gx, gy, gz, light ? leaves[1] : leaves[0])
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
      if (!info?.known || world.sites[info.tile.id]) continue
      const gx = volume.x0 + x - 1
      const gz = volume.z0 + z - 1
      const roll = hash(seed, gx, 70, gz)
      // Sparse tufts keep open ground calm, so hex lines, borders and units stay readable.
      if (info.tile.terrain === 'grassland' && info.surface !== VOXEL.sand && roll < 0.02) {
        const pick = hash(seed, gx, 71, gz)
        placeVoxel(volume, gx, base + info.top, gz, pick < 0.8 ? VOXEL.tuft : FLOWERS[Math.floor((pick - 0.8) / 0.2 * 4)]!)
      } else if (info.tile.terrain === 'hills' && roll < 0.012) placeVoxel(volume, gx, base + info.top, gz, VOXEL.stone)
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
      for (let layer = 0; layer < base + info.top; layer++) {
        volume.data[(layer + 1) * strideY + z * (width + 2) + x] = layerKind(world, layer, info)
      }
    }
  }
  stampSettlements(world, known, volume)
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
  let indices = new Uint32Array(1 << 13)
  let indexCount = 0
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
          const flag = fog ? FACE_FLAG.fog : kind >= FIRST_DECORATION ? FACE_FLAG.decoration : FACE_FLAG.ground
          for (let k = 0; k < 4; k++) {
            point[a] = plane
            point[u] = lo[u]! + ju + (k === 1 || k === 2 ? w : 0)
            point[v] = lo[v]! + jv + (k >= 2 ? h : 0)
            positions.push3(offset[0]! + point[0]! * size, offset[1]! + point[1]! * size, offset[2]! + point[2]! * size)
            normals.push3(a === 0 ? sign : 0, a === 1 ? sign : 0, a === 2 ? sign : 0)
            const light = fog ? 1 : AO_LIGHT[(ao >> (k * 2)) & 3]!
            colors.push4(PALETTE[kind * 3]! * light, PALETTE[kind * 3 + 1]! * light, PALETTE[kind * 3 + 2]! * light, flag)
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

/** Chunks whose voxels can change when the given tiles change between fog and charted terrain or gain a settlement. */
export function affectedChunks(world: VoxelWorld, tileIds: Iterable<number>): Set<number> {
  const { map, scale, reach, chunkColumns, chunksX, chunksZ } = world
  const chunks = new Set<number>()
  // A changed tile moves its own columns, its trees, shallow rims and shoals next to it and adjacent ambient occlusion.
  // A settlement also clears back-row trees of the hexes east, south-east and south-west of it, half a hex further in x.
  const margin = Math.max(reach + 3, shoalReach(scale) + 2)
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
 * Deterministic tile picking on the visible tile heightfield: march the ray through voxel columns (2D DDA) and
 * return the tile of the first column whose surface it passes below. Decorations never intercept tile picks.
 */
export function pickTile(world: VoxelWorld, heights: Float32Array,
  origin: readonly [number, number, number], direction: readonly [number, number, number]): number | undefined {
  const { columnsX, columnsZ, columnTile, size, originX, originZ } = world
  const [ox, oy, oz] = origin
  const [dx, dy, dz] = direction
  let top = 0
  for (const height of heights) top = Math.max(top, height)
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
    if (id >= 0 && oy + dy * leave <= heights[id]! + epsilon) return id
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
