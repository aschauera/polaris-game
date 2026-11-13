import { describe, expect, it } from 'vitest'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { HEX_ROW, hexAt, hexCenter, hexDistance, hexOffsets } from '../game/hex'
import { GENERATOR_VERSION, generateMap, type Tile, type WorldMap } from '../game/map'
import { CAMERA_PITCH, CAMERA_YAW } from './view'
import { BEACON_HEIGHT, BEACON_VOXEL, beaconMeshes } from './beacon'
import {
  AO_LIGHT, BEACON_SITE, FACE_DIRECTIONS, FACE_FLAG, PALETTE, VOXEL, affectedChunks, beaconFoot, centreColumn, columnTileAt,
  createVoxelWorld, groundHeight, meshChunk, pickTile, resourceAt, siteCode, territoryCode, tileSurface, voxelScale,
  type ChunkMesh, type VoxelWorld,
} from './voxels'

const allKnown = (map: WorldMap) => new Uint8Array(map.tiles.length).fill(1)

function meshAll(world: VoxelWorld, known: Uint8Array): ChunkMesh[] {
  return Array.from({ length: world.chunksX * world.chunksZ }, (_, chunk) => meshChunk(world, known, chunk))
}

function flatMap(width: number, height: number, overrides: Record<number, Partial<Tile>> = {}): WorldMap {
  const tiles = Array.from({ length: width * height }, (_, id): Tile => {
    const { terrain = 'grassland', waterDepth, ...rest } = overrides[id] ?? {}
    const fields = { id, x: id % width, z: Math.floor(id / width), elevation: 1, trees: 0, ...rest }
    return terrain === 'water' ? { ...fields, terrain, waterDepth: waterDepth ?? 'deep' } : { ...fields, terrain }
  })
  return { seed: 'flat', width, height, generatorVersion: GENERATOR_VERSION, rngState: 1, tiles }
}

function terraceMap(width: number, height: number): WorldMap {
  return flatMap(width, height, Object.fromEntries(Array.from({ length: width * height }, (_, id) => {
    const distance = hexDistance(id % width, Math.floor(id / width), 4, 4)
    return [id, distance === 0 ? {} : { terrain: 'water', elevation: 0,
      waterDepth: distance === 1 ? 'shallow' : distance === 2 ? 'shoal' : distance === 3 ? 'shelf' : 'deep' }]
  })))
}

/** Visible surface per direction and exact vertex colour set, independent of how faces were merged. */
function surfaceSignature(meshes: ChunkMesh[]): Map<string, number> {
  const area = new Map<string, number>()
  for (const mesh of meshes) {
    for (let quad = 0; quad < mesh.quads; quad++) {
      const v = quad * 4
      const p = (k: number, axis: number) => mesh.positions[(v + k) * 3 + axis]!
      const edges = [0, 1, 2].map(axis => [Math.abs(p(1, axis) - p(0, axis)), Math.abs(p(3, axis) - p(0, axis))])
      const size = Math.max(...edges.map(e => e[0]!)) * Math.max(...edges.map(e => e[1]!))
      const normal = [0, 1, 2].map(axis => mesh.normals[v * 3 + axis]).join(',')
      const colors = Array.from(mesh.colors.slice(v * 4, v * 4 + 16), c => c.toFixed(4)).join(',')
      const key = `${normal}|${colors}`
      area.set(key, (area.get(key) ?? 0) + size)
    }
  }
  for (const [key, value] of area) area.set(key, Math.round(value * 1e6) / 1e6)
  return area
}

/** Whether any face shows the palette colour of `kind`, at any ambient-occlusion level. */
function shows(meshes: ChunkMesh[], kind: number): boolean {
  return meshes.some(mesh => {
    for (let v = 0; v < mesh.colors.length / 4; v++) {
      if (AO_LIGHT.some(light => [0, 1, 2].every(c =>
        Math.abs(mesh.colors[v * 4 + c]! - PALETTE[kind * 3 + c]! * light) < 1e-6))) return true
    }
    return false
  })
}

/** The palette kind a vertex shows, at any ambient-occlusion level. */
function kindAt(mesh: ChunkMesh, vertex: number): number {
  for (let kind = 1; kind < PALETTE.length / 3; kind++) {
    if (AO_LIGHT.some(light => [0, 1, 2].every(c =>
      Math.abs(mesh.colors[vertex * 4 + c]! - PALETTE[kind * 3 + c]! * light) < 1e-6))) return kind
  }
  return 0
}

const sameMesh = (a: ChunkMesh, b: ChunkMesh) => a.quads === b.quads
  && a.waterIndexCount === b.waterIndexCount
  && a.positions.every((value, index) => value === b.positions[index])
  && a.colors.every((value, index) => value === b.colors[index])
  && a.faceFlags.every((value, index) => value === b.faceFlags[index])
  && a.normals.every((value, index) => value === b.normals[index])
  && a.indices.every((value, index) => value === b.indices[index])

/** Visible trunk faces per hex, keyed "x,z". */
function trunksPerHex(meshes: ChunkMesh[], size: number): Map<string, number> {
  const counts = new Map<string, number>()
  for (const mesh of meshes) {
    for (let quad = 0; quad < mesh.quads; quad++) {
      const v = quad * 4
      if (kindAt(mesh, v) !== VOXEL.trunk) continue
      const [x, z] = [0, 2].map(axis => [0, 1, 2, 3].reduce((sum, k) => sum + mesh.positions[(v + k) * 3 + axis]!, 0) / 4
        - mesh.normals[v * 3 + axis]! * size / 2)
      const key = hexAt(x!, z!).join(',')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

const VIEW = [Math.cos(CAMERA_YAW) * Math.cos(CAMERA_PITCH), Math.sin(CAMERA_PITCH),
  Math.sin(CAMERA_YAW) * Math.cos(CAMERA_PITCH)] as const
const DOWN_VIEW = [-VIEW[0], -VIEW[1], -VIEW[2]] as const

describe('hex voxel terrain', () => {
  it('keeps the column budget bounded with power-of-two voxel scales', () => {
    expect([[8, 8], [32, 32], [33, 32], [64, 64], [64, 48], [65, 64], [128, 128], [129, 128], [256, 256]]
      .map(([w, h]) => voxelScale(w!, h!))).toEqual([16, 16, 8, 8, 8, 4, 4, 2, 2])
    const world = createVoxelWorld(generateMap({ seed: 'polaris', width: 32, height: 32 }))
    expect(world).toMatchObject({ scale: 16, size: 0.0625, columnsX: 520, columnsZ: 449, chunksX: 8, chunksZ: 7, base: 12 })
    expect(createVoxelWorld(generateMap({ seed: 'polaris', width: 256, height: 256 })))
      .toMatchObject({ scale: 2, columnsX: 513, columnsZ: 445, chunksX: 8, chunksZ: 7 })
  })

  it('assigns every voxel column to the hex that contains it', () => {
    for (const size of [16, 128]) {
      const map = flatMap(size, size)
      const world = createVoxelWorld(map)
      const area = new Map<number, number>()
      for (const id of world.columnTile) if (id >= 0) area.set(id, (area.get(id) ?? 0) + 1)
      expect(area.size).toBe(map.tiles.length)
      // A hex one unit across covers sqrt(3)/2 square units.
      const ideal = HEX_ROW * world.scale * world.scale
      for (const count of area.values()) expect(Math.abs(count - ideal)).toBeLessThan(world.scale * 0.8)
      for (const tile of map.tiles) {
        const [gx, gz] = centreColumn(world, tile)
        expect([gx - 1, gx].map(x => columnTileAt(world, x, gz))).toEqual([tile.id, tile.id])
      }
    }
  })

  it('keeps highlands low and merges unrepresentable coarse elevation steps instead of making pillars', () => {
    const expected = [[0.25, 0.625, 0.75, 0.875, 1], [0.25, 0.625, 0.75, 0.875, 1],
      [0.25, 0.75, 0.75, 1, 1], [0.5, 1, 1, 1, 1]]
    for (const [index, size] of [32, 64, 128, 256].entries()) {
      const world = createVoxelWorld(flatMap(size, size))
      const tile = (terrain: Tile['terrain'], elevation: number) => {
        const fields = { id: 0, x: 0, z: 0, elevation, trees: 0 }
        return tileSurface(world, terrain === 'water'
          ? { ...fields, terrain, waterDepth: 'deep' } : { ...fields, terrain }, true) * world.size
      }
      const levels = [tile('water', 0), tile('grassland', 1), tile('grassland', 2), tile('hills', 3), tile('hills', 4)]
      expect(levels).toEqual(expected[index])
    }
  })

  it('meshes a connected low highland surface without a separate cone on every hill hex', () => {
    const map = flatMap(8, 8, Object.fromEntries(Array.from({ length: 64 }, (_, id) =>
      [id, { terrain: 'hills', elevation: 3 }])))
    const world = createVoxelWorld(map), known = allKnown(map)
    const meshes = meshAll(world, known)
    let groundFaces = 0
    for (const mesh of meshes) for (let v = 0; v < mesh.positions.length / 3; v++) {
      if (mesh.faceFlags[v] !== FACE_FLAG.ground || mesh.normals[v * 3 + 1] !== 1) continue
      if (![VOXEL.hillGrass, VOXEL.hillGrassDark].includes(kindAt(mesh, v))) continue
      expect(mesh.positions[v * 3 + 1]).toBe(0.875)
      groundFaces++
    }
    expect(groundFaces).toBeGreaterThan(100)
    for (const tile of map.tiles) expect(groundHeight(world, known, ...hexCenter(tile.x, tile.z))).toBe(0.875)
  })

  it('meshes deterministically', () => {
    const map = generateMap({ seed: 'polaris', width: 32, height: 32 })
    const world = createVoxelWorld(map)
    const known = allKnown(map)
    const first = meshChunk(world, known, 5)
    expect(first.quads).toBeGreaterThan(100)
    expect(meshChunk(createVoxelWorld(map), known, 5)).toEqual(first)
  })

  it('winds every face so Babylon treats its declared normal as the front side', () => {
    const box = CreateBoxVertexData({ size: 1 })
    const boxNormals = new Array<number>(box.positions!.length)
    VertexData.ComputeNormals(box.positions!, box.indices!, boxNormals)
    expect(boxNormals.map(v => Math.round(v))).toEqual(Array.from(box.normals!, v => Math.round(v)))

    const map = generateMap({ seed: 'aurora', width: 32, height: 32 })
    const mesh = meshChunk(createVoxelWorld(map), allKnown(map), 6)
    const computed = new Array<number>(mesh.positions.length)
    VertexData.ComputeNormals(mesh.positions, mesh.indices, computed)
    for (let vertex = 0; vertex < mesh.positions.length / 3; vertex++) {
      const dot = [0, 1, 2].reduce((sum, axis) => sum + computed[vertex * 3 + axis]! * mesh.normals[vertex * 3 + axis]!, 0)
      expect(dot).toBeGreaterThan(0.99)
    }
  })

  it('only emits faces the fixed camera or the key light can see', () => {
    const map = generateMap({ seed: 'polaris', width: 32, height: 32 })
    const mesh = meshChunk(createVoxelWorld(map), allKnown(map), 9)
    const seen = new Set<string>()
    for (let v = 0; v < mesh.normals.length; v += 3) seen.add(Array.from(mesh.normals.slice(v, v + 3)).join(','))
    expect([...seen].sort()).toEqual(FACE_DIRECTIONS.map(([axis, sign]) =>
      [0, 1, 2].map(component => component === axis ? sign : 0).join(',')).sort())
  })

  it('flags water separately from ground, decoration and fog for the shader', () => {
    const map = flatMap(6, 6, { 14: { trees: 3 }, 15: { terrain: 'water', elevation: 0, waterDepth: 'shallow' } })
    const known = allKnown(map)
    known[0] = 0
    const flags = new Set<number>()
    for (const mesh of meshAll(createVoxelWorld(map), known)) for (let v = 0; v < mesh.faceFlags.length; v++) {
      expect(mesh.faceFlags[v]).toBe(mesh.colors[v * 4 + 3])
      flags.add(mesh.faceFlags[v]!)
    }
    expect([...flags].sort()).toEqual([FACE_FLAG.fog, FACE_FLAG.decoration, FACE_FLAG.ground, FACE_FLAG.waterFloor,
      FACE_FLAG.waterSurface, FACE_FLAG.waterEdge])
  })

  it('meshes actual submerged steps beneath a separate level water surface', () => {
    const map = terraceMap(9, 9)
    const world = createVoxelWorld(map)
    const meshes = meshAll(world, allKnown(map))
    const waterTop = tileSurface(world, map.tiles[0]!, true) * world.size
    const floorHeights = new Set<number>()
    const capKinds = new Set([VOXEL.waterSurface, VOXEL.waterShallow, VOXEL.waterShoal, VOXEL.waterShelf, VOXEL.waterEdge])
    let verticalFaces = 0, surfaceArea = 0
    for (const mesh of meshes) {
      const solidCount = mesh.indices.length - mesh.waterIndexCount
      expect(mesh.waterIndexCount % 6).toBe(0)
      for (let i = 0; i < mesh.indices.length; i++) {
        const v = mesh.indices[i]!
        if (i < solidCount) expect(mesh.colors[v * 4 + 3]).toBeLessThan(FACE_FLAG.waterSurface)
        else {
          expect(mesh.colors[v * 4 + 3]).toBeGreaterThanOrEqual(FACE_FLAG.waterSurface)
          expect(mesh.normals[v * 3 + 1]).toBe(1)
          expect(mesh.positions[v * 3 + 1]).toBe(waterTop)
        }
      }
      for (let quad = 0; quad < mesh.quads; quad++) {
        const v = quad * 4
        const flag = mesh.colors[v * 4 + 3]!
        if (kindAt(mesh, v) === VOXEL.seabedDeep) expect(flag).toBe(FACE_FLAG.waterFloor)
        if (flag === FACE_FLAG.waterFloor) {
          expect([VOXEL.seabedSand, VOXEL.seabedStone, VOXEL.seabedDeep]).toContain(kindAt(mesh, v))
          if (mesh.normals[v * 3 + 1] === 1) floorHeights.add(mesh.positions[v * 3 + 1]!)
        } else if (flag === FACE_FLAG.water) {
          if (kindAt(mesh, v) === VOXEL.underwaterRock) verticalFaces++
          else if (mesh.positions[v * 3 + 1]! < waterTop) verticalFaces++
        } else if (flag >= FACE_FLAG.waterSurface) {
          expect(capKinds.has(kindAt(mesh, v))).toBe(true)
          const xs = [0, 1, 2, 3].map(k => mesh.positions[(v + k) * 3]!)
          const zs = [0, 1, 2, 3].map(k => mesh.positions[(v + k) * 3 + 2]!)
          surfaceArea += (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs))
        }
      }
    }
    const waterColumns = world.columnTile.filter(id => id >= 0 && map.tiles[id]!.terrain === 'water').length
    expect(surfaceArea).toBeCloseTo(waterColumns * world.size ** 2, 6)
    expect([...floorHeights].sort((a, b) => a - b)).toEqual([-0.625, -0.375, -0.125, 0.125])
    expect(Math.max(...floorHeights)).toBeLessThan(waterTop)
    expect(shows(meshes, VOXEL.seabedSand)).toBe(true)
    expect(shows(meshes, VOXEL.seabedStone)).toBe(true)
    expect(verticalFaces).toBeGreaterThan(20)
  })

  it('builds submerged and emerged coastal rocks with exact water-cap holes and canonical water picks', () => {
    const map = generateMap({ seed: 'polaris', width: 32, height: 32 })
    const world = createVoxelWorld(map)
    const known = allKnown(map)
    const meshes = meshAll(world, known)
    expect(shows(meshes, VOXEL.underwaterRock)).toBe(true)
    const waterTop = tileSurface(world, map.tiles.find(tile => tile.terrain === 'water')!, true) * world.size
    const coverage = new Uint8Array(world.columnTile.length)
    const rockHeights = new Map<number, number>()
    let capColumns = 0, rockColumns = 0
    for (const mesh of meshes) for (let v = 0; v < mesh.positions.length / 3; v += 4) {
      const kind = kindAt(mesh, v)
      if (kind === VOXEL.underwaterRock) {
        const ys = [0, 1, 2, 3].map(k => mesh.positions[(v + k) * 3 + 1]!)
        expect(Math.max(...ys)).toBeLessThanOrEqual(waterTop)
        expect(Math.max(...ys) - Math.min(...ys), 'Compact outcrops, not tall underwater pillars').toBeLessThanOrEqual(0.375)
      }
      if (mesh.normals[v * 3 + 1] !== 1) continue
      const cap = mesh.faceFlags[v]! >= FACE_FLAG.waterSurface
      const rock = kind === VOXEL.underwaterRock || kind === VOXEL.stone
      if (!cap && !rock) continue
      const height = mesh.positions[v * 3 + 1]!
      const xs = [0, 1, 2, 3].map(k => mesh.positions[(v + k) * 3]!)
      const zs = [0, 1, 2, 3].map(k => mesh.positions[(v + k) * 3 + 2]!)
      const left = Math.round((Math.min(...xs) - world.originX) * world.scale)
      const right = Math.round((Math.max(...xs) - world.originX) * world.scale)
      const top = Math.round((Math.min(...zs) - world.originZ) * world.scale)
      const bottom = Math.round((Math.max(...zs) - world.originZ) * world.scale)
      for (let z = top; z < bottom; z++) for (let x = left; x < right; x++) {
        const id = columnTileAt(world, x, z)
        if (id < 0 || map.tiles[id]!.terrain !== 'water') { expect(cap).toBe(false); continue }
        if (rock) rockHeights.set(id, Math.max(height, rockHeights.get(id) ?? -Infinity))
        if (height < waterTop) continue
        coverage[z * world.columnsX + x]!++
        if (cap) { capColumns++; expect(height).toBe(waterTop); continue }
        rockColumns++
        const wx = world.originX + (x + 0.5) * world.size, wz = world.originZ + (z + 0.5) * world.size
        expect(groundHeight(world, known, wx, wz)).toBe(height)
        expect(pickTile(world, known, [wx, height + 1, wz], [0, -1, 0])).toBe(id)
      }
    }
    const waterColumns = world.columnTile.filter(id => id >= 0 && map.tiles[id]!.terrain === 'water').length
    expect(capColumns).toBeGreaterThan(0)
    expect(rockColumns).toBeGreaterThan(0)
    expect(capColumns + rockColumns).toBe(waterColumns)
    expect(coverage.some(value => value > 1), 'Never draw a water cap through an exposed rock').toBe(false)
    expect(coverage.filter(value => value === 1).length).toBe(waterColumns)
    expect([...rockHeights.values()].some(height => height < waterTop), 'Fully submerged groups').toBe(true)
    expect([...rockHeights.values()].some(height => height > waterTop), 'Emerged groups').toBe(true)
    for (const id of rockHeights.keys()) {
      const tile = map.tiles[id]!, [x, z] = hexCenter(tile.x, tile.z)
      expect(map.tiles.some(land => land.terrain !== 'water'
        && Math.hypot(x - hexCenter(land.x, land.z)[0], z - hexCenter(land.x, land.z)[1]) < 1.8)).toBe(true)
      expect(resourceAt(world, tile)).not.toBe('fish')
    }
    known.set(Uint8Array.from(map.tiles, tile => tile.terrain === 'water' ? 1 : 0))
    const hiddenCoast = meshAll(world, known)
    expect(shows(hiddenCoast, VOXEL.underwaterRock)).toBe(false)
    expect(shows(hiddenCoast, VOXEL.stone)).toBe(false)
    known.fill(0)
    const fog = meshAll(world, known)
    expect(shows(fog, VOXEL.underwaterRock)).toBe(false)
    expect(fog.every(mesh => mesh.waterIndexCount === 0)).toBe(true)
  }, 20_000)

  it('keeps four main terraces at both detailed scales and merges only unrepresentable coarse levels', () => {
    for (const [width, levels] of [[32, [-0.625, -0.375, -0.125, 0.125]], [64, [-0.625, -0.375, -0.125, 0.125]],
      [128, [-0.5, -0.25, 0]], [256, [-0.5]]] as const) {
      const map = terraceMap(width, 8)
      const world = createVoxelWorld(map)
      const heights = new Set<number>()
      for (const mesh of meshAll(world, allKnown(map))) for (let v = 0; v < mesh.faceFlags.length; v += 4) {
        if (mesh.faceFlags[v] === FACE_FLAG.waterFloor && mesh.normals[v * 3 + 1] === 1) heights.add(mesh.positions[v * 3 + 1]!)
      }
      expect([...heights].sort((a, b) => a - b), `Scale ${world.scale}`).toEqual(levels)
    }
  })

  it('cuts broad, irregular sandbanks into grassland and cliff faces without changing the domain', () => {
    for (const terrain of ['grassland', 'hills'] as const) {
      const map = flatMap(12, 12, Object.fromEntries(Array.from({ length: 144 }, (_, id) => [id, id % 12 < 5
        ? { terrain: 'water' as const, elevation: 0 } : { terrain, elevation: terrain === 'hills' ? 3 : 1 }])))
      const original = structuredClone(map)
      const world = createVoxelWorld(map)
      const known = allKnown(map)
      const meshes = meshAll(world, known)
      const sand = new Set<number>(), heights = new Set<number>()
      const waterTop = tileSurface(world, map.tiles[0]!, true) * world.size
      for (const mesh of meshes) for (let v = 0; v < mesh.faceFlags.length; v += 4) {
        if (mesh.normals[v * 3 + 1] !== 1 || kindAt(mesh, v) !== VOXEL.sand) continue
        const height = mesh.positions[v * 3 + 1]!
        const xs = [0, 1, 2, 3].map(k => mesh.positions[(v + k) * 3]!)
        const zs = [0, 1, 2, 3].map(k => mesh.positions[(v + k) * 3 + 2]!)
        heights.add(height)
        expect(height).toBeGreaterThan(waterTop)
        const left = Math.round((Math.min(...xs) - world.originX) * world.scale)
        const right = Math.round((Math.max(...xs) - world.originX) * world.scale)
        const top = Math.round((Math.min(...zs) - world.originZ) * world.scale)
        const bottom = Math.round((Math.max(...zs) - world.originZ) * world.scale)
        for (let z = top; z < bottom; z++) for (let x = left; x < right; x++) {
          const id = columnTileAt(world, x, z)
          expect(map.tiles[id]!.terrain).toBe(terrain)
          expect(height).toBeLessThan(tileSurface(world, map.tiles[id]!, true) * world.size)
          expect(groundHeight(world, known, world.originX + (x + 0.5) * world.size,
            world.originZ + (z + 0.5) * world.size)).toBe(height)
          sand.add(z * world.columnsX + x)
        }
      }
      const widths = Array.from({ length: world.columnsZ }, () => 0)
      for (const index of sand) widths[Math.floor(index / world.columnsX)]!++
      expect([...heights].sort((a, b) => a - b)).toEqual([0.375, 0.5])
      expect(sand.size * world.size ** 2, 'Sand occupies areas, not just a painted one-voxel rim').toBeGreaterThan(1)
      expect(Math.max(...widths)).toBeGreaterThan(world.scale / 3)
      expect(new Set(widths).size, 'The coast alternates between wide pockets and intact cliffs').toBeGreaterThan(5)
      expect(shows(meshes, terrain === 'hills' ? VOXEL.cliff : VOXEL.dirt)).toBe(true)
      expect(map).toEqual(original)
    }
  })

  it('never forms sandbanks from unseen water and keeps settled coast tiles level', () => {
    const map = flatMap(12, 12, Object.fromEntries(Array.from({ length: 144 }, (_, id) =>
      [id, id % 12 < 5 ? { terrain: 'water' as const, elevation: 0 } : {}])))
    const world = createVoxelWorld(map)
    const known = Uint8Array.from(map.tiles, tile => tile.terrain === 'water' ? 0 : 1)
    expect(shows(meshAll(world, known), VOXEL.sand)).toBe(false)
    known.fill(1)
    expect(shows(meshAll(world, known), VOXEL.sand)).toBe(true)
    for (const tile of map.tiles) if (tile.terrain !== 'water') world.sites[tile.id] = siteCode({ houses: 1, storehouse: false, banner: 0 })
    expect(shows(meshAll(world, known), VOXEL.sand)).toBe(false)
    for (const tile of map.tiles.filter(tile => tile.terrain !== 'water')) {
      expect(groundHeight(world, known, ...hexCenter(tile.x, tile.z))).toBe(tileSurface(world, tile, true) * world.size)
    }
  })

  it('keeps trees at most three quarters of a hex high, with narrower detailed crowns', () => {
    const leaves = new Set([VOXEL.leafTeal, VOXEL.leafTealLight, VOXEL.leafGreen, VOXEL.leafGreenLight,
      VOXEL.leafDark, VOXEL.leafDarkLight, VOXEL.leafLime, VOXEL.leafLimeLight])
    for (const width of [32, 64, 128, 256]) {
      const map = flatMap(width, 4, Object.fromEntries([1, 2, 3].map(x => [2 * width + x, { trees: 1 }])))
      const world = createVoxelWorld(map)
      const tile = map.tiles.find(tile => tile.trees && !resourceAt(world, tile))!
      const known = new Uint8Array(map.tiles.length)
      known[tile.id] = 1
      const mesh = meshChunk(world, known, 0)
      const ground = tileSurface(world, tile, true) * world.size
      const trunks = new Map<number, { minZ: number; maxZ: number }>()
      const canopy: [number, number, number][] = []
      for (let v = 0; v < mesh.faceFlags.length; v += 4) {
        const kind = kindAt(mesh, v)
        if (leaves.has(kind)) for (let k = 0; k < 4; k++) {
          canopy.push([mesh.positions[(v + k) * 3]!, mesh.positions[(v + k) * 3 + 1]!, mesh.positions[(v + k) * 3 + 2]!])
        }
        if (kind !== VOXEL.trunk || !mesh.normals[v * 3]) continue
        const ys = [0, 1, 2, 3].map(k => mesh.positions[(v + k) * 3 + 1]!)
        if (Math.min(...ys) !== ground) continue
        const x = mesh.positions[v * 3]! - mesh.normals[v * 3]! * Math.max(1, world.scale / 8) * world.size / 2
        const zs = [0, 1, 2, 3].map(k => mesh.positions[(v + k) * 3 + 2]!)
        const previous = trunks.get(x)
        trunks.set(x, { minZ: Math.min(...zs, previous?.minZ ?? Infinity), maxZ: Math.max(...zs, previous?.maxZ ?? -Infinity) })
      }
      expect(canopy.length, `${width}: a charted forest retains its canopy`).toBeGreaterThan(0)
      const height = Math.max(...canopy.map(point => point[1])) - ground
      expect(height).toBeGreaterThanOrEqual(0.5)
      expect(height).toBeLessThanOrEqual(0.75)
      if (world.scale < 8) continue
      expect(trunks.size).toBe(2)
      for (const [x, , z] of canopy) {
        expect(Math.min(...[...trunks].map(([tx, bounds]) => Math.hypot(x - tx, z - (bounds.minZ + bounds.maxZ) / 2)))).toBeLessThan(0.28)
      }
    }
  })

  it('assigns deterministic visual resources without changing map data or the simulation RNG', () => {
    const map = generateMap({ seed: 'polaris', width: 32, height: 32 })
    const original = structuredClone(map)
    const world = createVoxelWorld(map)
    const resources = map.tiles.map(tile => resourceAt(world, tile))
    const otherChunks = createVoxelWorld(map, 32)
    expect(map.tiles.map(tile => resourceAt(otherChunks, tile))).toEqual(resources)
    expect(new Set(resources)).toEqual(new Set([undefined, 'stone', 'apples', 'fish']))
    for (const tile of map.tiles) {
      const kind = resources[tile.id]
      if (!kind) continue
      expect(tile.terrain).toBe(kind === 'fish' ? 'water' : kind === 'stone' ? 'hills' : 'grassland')
      world.sites[tile.id] = siteCode({ houses: 1, storehouse: false, banner: 0 })
      expect(resourceAt(world, tile)).toBeUndefined()
    }
    expect(map).toEqual(original)
  })

  it('meshes real fruit and stone deposits only on charted, unsettled resource tiles', () => {
    const map = flatMap(16, 12, Object.fromEntries(Array.from({ length: 192 }, (_, id) => [id, id % 16 < 5
      ? { terrain: 'water' as const, elevation: 0 } : id % 16 < 11 ? {} : { terrain: 'hills' as const, elevation: 3 }])))
    const world = createVoxelWorld(map)
    const known = allKnown(map)
    const resources = map.tiles.filter(tile => resourceAt(world, tile))
    expect(new Set(resources.map(tile => resourceAt(world, tile)))).toEqual(new Set(['stone', 'apples', 'fish']))
    const kinds = [VOXEL.depositStone, VOXEL.depositStoneDark, VOXEL.appleRed, VOXEL.appleLight]
    const visible = meshAll(world, known)
    expect(kinds.map(kind => shows(visible, kind))).toEqual(kinds.map(() => true))
    for (const tile of resources) known[tile.id] = 0
    const hidden = meshAll(world, known)
    expect(kinds.map(kind => shows(hidden, kind))).toEqual(kinds.map(() => false))
    known.fill(1)
    for (const tile of resources.filter(tile => tile.terrain !== 'water')) {
      world.sites[tile.id] = siteCode({ houses: 1, storehouse: false, banner: 0 })
    }
    const settled = meshAll(world, known)
    expect(kinds.map(kind => shows(settled, kind))).toEqual(kinds.map(() => false))
  })

  it('builds broad, varied stone outcrops on low ground with flat caps and an open tile centre', () => {
    const map = flatMap(12, 12, Object.fromEntries(Array.from({ length: 144 }, (_, id) =>
      [id, { terrain: 'hills', elevation: 3 }])))
    const world = createVoxelWorld(map), known = allKnown(map)
    const deposits = new Map<number, { area: number; caps: Map<number, number>; peak: number }>()
    for (const mesh of meshAll(world, known)) for (let quad = 0; quad < mesh.quads; quad++) {
      const v = quad * 4
      if (mesh.faceFlags[v] !== FACE_FLAG.decoration || mesh.normals[v * 3 + 1] !== 1) continue
      if (![VOXEL.depositStone, VOXEL.depositStoneDark].includes(kindAt(mesh, v))) continue
      const xs = [0, 1, 2, 3].map(k => mesh.positions[(v + k) * 3]!)
      const zs = [0, 1, 2, 3].map(k => mesh.positions[(v + k) * 3 + 2]!)
      const [x, z] = hexAt(xs.reduce((a, b) => a + b) / 4, zs.reduce((a, b) => a + b) / 4)
      const tile = map.tiles[z * map.width + x]!
      expect(resourceAt(world, tile)).toBe('stone')
      const height = mesh.positions[v * 3 + 1]! - tileSurface(world, tile, true) * world.size
      expect(height).toBeGreaterThan(0)
      expect(height).toBeLessThanOrEqual(0.625)
      const [cx, cz] = centreColumn(world, tile)
      const centre = [world.originX + (cx + 0.5) * world.size, world.originZ + (cz + 0.5) * world.size]
      expect(centre[0]! > Math.min(...xs) && centre[0]! < Math.max(...xs)
        && centre[1]! > Math.min(...zs) && centre[1]! < Math.max(...zs)).toBe(false)
      const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs))
      const deposit = deposits.get(tile.id) ?? { area: 0, caps: new Map<number, number>(), peak: 0 }
      deposit.area += area
      deposit.peak = Math.max(deposit.peak, height)
      deposit.caps.set(height, (deposit.caps.get(height) ?? 0) + area)
      deposits.set(tile.id, deposit)
    }
    expect(deposits.size).toBeGreaterThan(5)
    for (const deposit of deposits.values()) {
      expect(deposit.area).toBeGreaterThan(0.15)
      expect(deposit.peak).toBeGreaterThanOrEqual(0.3125)
      expect(deposit.caps.size).toBeGreaterThanOrEqual(3)
      expect(Math.max(...deposit.caps.values())).toBeGreaterThan(0.04)
    }
    expect(new Set([...deposits.values()].map(deposit => `${deposit.area}:${deposit.peak}`)).size).toBeGreaterThan(4)
    expect(new Set([...deposits.values()].map(deposit => deposit.peak)).size).toBeGreaterThanOrEqual(4)
  })

  it('keeps resource ground dry and stable as the surrounding coast is charted', () => {
    const plain = flatMap(12, 12), plainWorld = createVoxelWorld(plain)
    const grove = plain.tiles.find(tile => tile.x > 1 && tile.x < 10 && tile.z > 1 && tile.z < 10
      && resourceAt(plainWorld, tile) === 'apples')!
    expect(grove).toBeDefined()
    const water = Object.fromEntries(hexOffsets(grove.z).map(([dx, dz]) =>
      [(grove.z + dz) * 12 + grove.x + dx, { terrain: 'water' as const, elevation: 0 }]))
    const map = flatMap(12, 12, water), world = createVoxelWorld(map), known = allKnown(map)
    const hidden = Uint8Array.from(map.tiles, tile => tile.terrain === 'water' ? 0 : 1)
    expect(resourceAt(world, map.tiles[grove.id]!)).toBe('apples')
    for (let z = 0; z < world.columnsZ; z++) for (let x = 0; x < world.columnsX; x++) {
      if (columnTileAt(world, x, z) !== grove.id) continue
      const wx = world.originX + (x + 0.5) * world.size, wz = world.originZ + (z + 0.5) * world.size
      const height = groundHeight(world, known, wx, wz)
      expect(height).toBe(tileSurface(world, grove, true) * world.size)
      expect(groundHeight(world, hidden, wx, wz)).toBe(height)
    }
  })

  it('keeps coastal tree roots supported by grass rather than suspended above a lowered bank', () => {
    const map = flatMap(12, 12, Object.fromEntries(Array.from({ length: 144 }, (_, id) => [id, id % 12 < 5
      ? { terrain: 'water' as const, elevation: 0 } : { trees: id % 12 < 8 && id >= 24 && id < 120 ? 3 : 0 }])))
    const world = createVoxelWorld(map)
    const known = allKnown(map)
    const plateau = tileSurface(world, map.tiles[5]!, true) * world.size
    let roots = 0
    for (const mesh of meshAll(world, known)) for (let v = 0; v < mesh.faceFlags.length; v += 4) {
      if (kindAt(mesh, v) !== VOXEL.trunk) continue
      const ys = [0, 1, 2, 3].map(k => mesh.positions[(v + k) * 3 + 1]!)
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(plateau)
      if (Math.min(...ys) !== plateau) continue
      const [x, z] = [0, 2].map(axis => [0, 1, 2, 3].reduce((sum, k) => sum + mesh.positions[(v + k) * 3 + axis]!, 0) / 4
        - mesh.normals[v * 3 + axis]! * world.size / 2)
      expect(groundHeight(world, known, x!, z!), 'Root must have ground directly underneath').toBe(plateau)
      roots++
    }
    expect(roots).toBeGreaterThan(10)
  })

  it('keeps canonical water depths when neighbours are hidden and at coarse scales', () => {
    const map = terraceMap(9, 9)
    const known = allKnown(map)
    const fine = meshAll(createVoxelWorld(map), known)
    expect(shows(fine, VOXEL.waterSurface)).toBe(true)
    const coastCaps = [VOXEL.waterShallow, VOXEL.waterShoal, VOXEL.waterShelf]
    for (const kind of coastCaps) expect(shows(fine, kind), `Coastal cap ${kind}`).toBe(true)
    expect(shows(fine, VOXEL.waterEdge)).toBe(true)
    expect(shows(fine, VOXEL.seabedSand)).toBe(true)
    expect(shows(fine, VOXEL.seabedStone)).toBe(true)
    expect(shows(fine, VOXEL.seabedDeep)).toBe(true)
    expect(shows(fine, VOXEL.water)).toBe(true)
    known[40] = 0
    const hidden = meshAll(createVoxelWorld(map), known)
    for (const kind of coastCaps) expect(shows(hidden, kind), `Known depth beside hidden coast ${kind}`).toBe(true)
    expect(shows(hidden, VOXEL.waterEdge)).toBe(false)
    expect(shows(hidden, VOXEL.seabedSand)).toBe(true)
    expect(shows(hidden, VOXEL.seabedStone)).toBe(true)
    expect(shows(hidden, VOXEL.seabedDeep)).toBe(true)
    const heights = new Set<number>()
    for (const mesh of hidden) for (let v = 0; v < mesh.faceFlags.length; v += 4) {
      if (mesh.faceFlags[v] === FACE_FLAG.waterFloor && mesh.normals[v * 3 + 1] === 1) heights.add(mesh.positions[v * 3 + 1]!)
    }
    expect([...heights].sort((a, b) => a - b)).toEqual([-0.625, -0.375, -0.125, 0.125])
    const large = terraceMap(256, 8)
    const coarse = createVoxelWorld(large)
    expect(coarse.scale).toBe(2)
    const coarseMeshes = meshAll(coarse, allKnown(large))
    for (const kind of coastCaps) expect(shows(coarseMeshes, kind), `Coarse depth cap ${kind}`).toBe(true)
    expect(shows(coarseMeshes, VOXEL.waterEdge)).toBe(false)
    expect(shows(coarseMeshes, VOXEL.seabedSand)).toBe(true)
    expect(shows(coarseMeshes, VOXEL.seabedStone)).toBe(true)
    expect(shows(coarseMeshes, VOXEL.seabedDeep)).toBe(true)
  })

  it('produces identical surfaces regardless of chunk borders', () => {
    const map = generateMap({ seed: 'North_Star-7', width: 16, height: 16 })
    const known = new Uint8Array(map.tiles.length)
    for (const tile of map.tiles) known[tile.id] = (tile.x * 7 + tile.z * 3) % 5 === 0 ? 0 : 1
    const settle = (world: VoxelWorld) => {
      for (const id of [3 * 16 + 3, 3 * 16 + 4, 4 * 16 + 3, 5 * 16 + 11, 12 * 16 + 7]) {
        world.sites[id] = siteCode({ houses: 3, storehouse: id % 2 === 0, banner: 1 })
      }
      return world
    }
    const whole = settle(createVoxelWorld(map, 320))
    expect(whole.chunksX * whole.chunksZ).toBe(1)
    const signature = surfaceSignature(meshAll(whole, known))
    for (const chunkColumns of [32, 48]) {
      const world = settle(createVoxelWorld(map, chunkColumns))
      expect(world.chunksX * world.chunksZ).toBeGreaterThan(1)
      expect(surfaceSignature(meshAll(world, known))).toEqual(signature)
    }
  })

  it('builds a settlement with its keep, banner and storehouse in place of the tile trees', () => {
    const map = flatMap(4, 4, { 5: { trees: 3 }, 10: { terrain: 'hills', elevation: 3 } })
    const known = allKnown(map)
    const world = createVoxelWorld(map)
    const forest = meshAll(world, known)
    expect(trunksPerHex(forest, world.size).get('1,1')).toBeGreaterThan(0)
    expect(shows(forest, VOXEL.roof)).toBe(false)
    world.sites[5] = siteCode({ houses: 1, storehouse: false, banner: 1 })
    const village = meshAll(world, known)
    expect([VOXEL.roof, VOXEL.castle, VOXEL.bannerBlue, VOXEL.path].map(kind => shows(village, kind))).toEqual([true, true, true, true])
    expect(trunksPerHex(village, world.size).has('1,1')).toBe(false)
    expect([VOXEL.bannerGold, VOXEL.thatch].map(kind => shows(village, kind))).toEqual([false, false])
    world.sites[5] = siteCode({ houses: 3, storehouse: true, banner: 0 })
    const town = meshAll(world, known)
    expect([VOXEL.thatch, VOXEL.bannerGold].map(kind => shows(town, kind))).toEqual([true, true])
    expect(town[0]!.quads).toBeGreaterThan(village[0]!.quads)
    // Hill settlements are levelled so buildings stand on the pickable surface.
    world.sites[5] = 0
    world.sites[10] = siteCode({ houses: 2, storehouse: false, banner: 0 })
    const [cx, cz] = hexCenter(2, 2)
    const tops = new Set<number>()
    for (const mesh of meshAll(world, known)) {
      for (let v = 0; v < mesh.positions.length / 3; v++) {
        const [x, y, z] = [mesh.positions[v * 3]!, mesh.positions[v * 3 + 1]!, mesh.positions[v * 3 + 2]!]
        if (mesh.normals[v * 3 + 1] === 1 && Math.abs(x - cx) < 0.3 && Math.abs(z - cz) < 0.3) tops.add(y)
      }
    }
    expect(Math.min(...tops)).toBe(tileSurface(world, map.tiles[10]!, true) * world.size)
  })

  it('clears back-row trees in front of a charted settlement and remeshes their chunks', () => {
    const map = flatMap(8, 8, Object.fromEntries(Array.from({ length: 64 }, (_, id) => [id, { trees: 3 }])))
    const world = createVoxelWorld(map, 8)
    const known = allKnown(map)
    const forest = trunksPerHex(meshAll(world, known), world.size)
    world.sites[3 * 8 + 3] = siteCode({ houses: 3, storehouse: true, banner: 0 })
    const town = trunksPerHex(meshAll(world, known), world.size)
    expect(town.get('3,3')).toBeUndefined()
    // East, south-east and south-west of an odd row: the hexes drawn in front of the town.
    for (const key of ['4,3', '4,4', '3,4']) expect(town.get(key) ?? 0, key).toBeLessThan(forest.get(key)!)
    known[3 * 8 + 3] = 0
    const hidden = meshAll(world, known)
    world.sites[3 * 8 + 3] = 0
    expect(hidden).toEqual(meshAll(world, known))
    known[3 * 8 + 3] = 1
    const before = meshAll(world, known)
    for (let id = 0; id < map.tiles.length; id++) {
      world.sites[id] = siteCode({ houses: 3, storehouse: false, banner: 1 })
      const changed = new Set<number>()
      meshAll(world, known).forEach((mesh, chunk) => { if (!sameMesh(mesh, before[chunk]!)) changed.add(chunk) })
      world.sites[id] = 0
      const allowed = affectedChunks(world, [id])
      expect([...changed].filter(chunk => !allowed.has(chunk)), `site ${id}`).toEqual([])
    }
  }, 60_000)

  it('keeps every settlement inside its own hex at every scale and row parity', () => {
    const building = new Set([VOXEL.path, VOXEL.wall, VOXEL.roof, VOXEL.roofRidge, VOXEL.plank, VOXEL.thatch, VOXEL.thatchRidge,
      VOXEL.castle, VOXEL.castleDark, VOXEL.timber, VOXEL.bannerGold, VOXEL.bannerBlue])
    for (const size of [8, 64, 128, 256]) {
      const map = flatMap(size, size)
      const world = createVoxelWorld(map)
      for (const [x, z] of [[0, 0], [1, 1], [2, 2], [3, 3], [2, 1]] as const) {
        const id = z * size + x
        world.sites.fill(0)
        world.sites[id] = siteCode({ houses: 3, storehouse: x % 2 === 1, banner: 0 })
        const mesh = meshChunk(world, allKnown(map), 0)
        let cells = 0
        for (let quad = 0; quad < mesh.quads; quad++) {
          const v = quad * 4
          if (mesh.normals[v * 3 + 1] !== 1 || !building.has(kindAt(mesh, v))) continue
          const xs = [0, 1, 2, 3].map(k => mesh.positions[(v + k) * 3]!)
          const zs = [0, 1, 2, 3].map(k => mesh.positions[(v + k) * 3 + 2]!)
          for (let cx = Math.min(...xs) + world.size / 2; cx < Math.max(...xs); cx += world.size) {
            for (let cz = Math.min(...zs) + world.size / 2; cz < Math.max(...zs); cz += world.size) {
              cells++
              expect(hexAt(cx, cz).map(value => value + 0), `${size}: (${x}, ${z})`).toEqual([x, z])
            }
          }
        }
        expect(cells, `${size}: (${x}, ${z})`).toBeGreaterThan(1)
      }
    }
  })

  it('fits settlements at every voxel scale', () => {
    for (const size of [32, 64, 128, 256]) {
      const map = flatMap(size, size)
      const world = createVoxelWorld(map)
      world.sites[0] = siteCode({ houses: 3, storehouse: false, banner: 0 })
      const mesh = [meshChunk(world, allKnown(map), 0)]
      expect(shows(mesh, VOXEL.roof), `${size}`).toBe(true)
      expect(shows(mesh, VOXEL.bannerGold), `${size}`).toBe(world.scale >= 4)
    }
  })

  it('quadruples showcase surface density without shrinking its settlements', () => {
    const cells: number[] = []
    for (const width of [32, 64]) {
      const map = flatMap(width, width)
      const tile = map.tiles[2 * width + 2]!
      const world = createVoxelWorld(map)
      cells.push(world.columnTile.filter(id => id >= 0).length / map.tiles.length)
      world.sites[tile.id] = siteCode({ houses: 3, storehouse: true, banner: 0 })
      const mesh = meshChunk(world, allKnown(map), 0)
      let bannerTop = 0
      for (let v = 0; v < mesh.faceFlags.length; v += 4) {
        if (kindAt(mesh, v) !== VOXEL.bannerGold) continue
        for (let k = 0; k < 4; k++) bannerTop = Math.max(bannerTop, mesh.positions[(v + k) * 3 + 1]!)
      }
      expect(bannerTop - tileSurface(world, tile, true) * world.size).toBe(0.75)
    }
    expect(cells[0]! / cells[1]!).toBeCloseTo(4, 1)
  })

  it('never shows a settlement on an uncharted tile', () => {
    const map = flatMap(4, 4)
    const known = allKnown(map)
    known[5] = 0
    const world = createVoxelWorld(map)
    const plain = meshAll(world, known)
    world.sites[5] = siteCode({ houses: 3, storehouse: true, banner: 1 })
    expect(meshAll(world, known)).toEqual(plain)
  })

  it('levels and clears a beacon tile into a plaza without stamping a keep', () => {
    const map = flatMap(4, 4, { 5: { trees: 3 }, 10: { terrain: 'hills', elevation: 3, trees: 2 } })
    const known = allKnown(map)
    const world = createVoxelWorld(map)
    expect(shows(meshAll(world, known), VOXEL.path)).toBe(false)
    world.sites[5] = BEACON_SITE
    world.sites[10] = BEACON_SITE
    const plaza = meshAll(world, known)
    expect(shows(plaza, VOXEL.path)).toBe(true)
    expect([VOXEL.roof, VOXEL.castle, VOXEL.bannerGold, VOXEL.bannerBlue].map(kind => shows(plaza, kind)))
      .toEqual([false, false, false, false])
    expect(['1,1', '2,2'].map(key => trunksPerHex(plaza, world.size).has(key))).toEqual([false, false])
    // The lighthouse foot stands on level ground, also on a hill.
    const [fx, fz] = beaconFoot(map.tiles[10]!)
    const tops = new Set<number>()
    for (const mesh of plaza) {
      for (let v = 0; v < mesh.positions.length / 3; v++) {
        const [x, y, z] = [mesh.positions[v * 3]!, mesh.positions[v * 3 + 1]!, mesh.positions[v * 3 + 2]!]
        if (mesh.normals[v * 3 + 1] === 1 && Math.hypot(x - fx, z - fz) < 0.3) tops.add(y)
      }
    }
    expect([...tops]).toEqual([tileSurface(world, map.tiles[10]!, true) * world.size])
    known[5] = 0
    const hidden = meshAll(world, known)
    world.sites[5] = 0
    expect(meshAll(world, known)).toEqual(hidden)
  })

  it('builds a lighthouse inside its own hex with an unlit lantern as a separate part', () => {
    const { body, light } = beaconMeshes()
    const glow = new Set([VOXEL.beaconGlow, VOXEL.beaconCore])
    const kinds = (mesh: ChunkMesh) => new Set(Array.from({ length: mesh.quads }, (_, quad) => kindAt(mesh, quad * 4)))
    expect([...kinds(light)].every(kind => glow.has(kind))).toBe(true)
    expect([...kinds(body)].some(kind => glow.has(kind))).toBe(false)
    expect(kinds(body)).toContain(VOXEL.patina)
    const heights = [body, light].flatMap(mesh => Array.from({ length: mesh.positions.length / 3 }, (_, v) => mesh.positions[v * 3 + 1]!))
    expect(Math.max(...heights)).toBeCloseTo(BEACON_HEIGHT, 9)
    expect(Math.min(...heights)).toBe(0)
    // Both row parities: the whole footprint, set back from the centre, stays inside the beacon's hex.
    for (const tile of flatMap(4, 4).tiles.filter(tile => tile.id === 5 || tile.id === 9)) {
      const [fx, fz] = beaconFoot(tile)
      for (let v = 0; v < body.positions.length / 3; v++) {
        const x = fx + body.positions[v * 3]!, z = fz + body.positions[v * 3 + 2]!
        expect(hexAt(x, z), `${tile.id}: ${x}, ${z}`).toEqual([tile.x, tile.z])
      }
    }
  })

  it('shows a beacon holder in banners, bands and light, and nothing faction-coloured while neutral', () => {
    const kinds = (mesh: ChunkMesh) => new Set(Array.from({ length: mesh.quads }, (_, quad) => kindAt(mesh, quad * 4)))
    const gold = [VOXEL.bannerGold, VOXEL.goldDark] as const, blue = [VOXEL.bannerBlue, VOXEL.blueDark] as const
    const neutral = beaconMeshes()
    expect([...gold, ...blue].some(kind => kinds(neutral.body).has(kind))).toBe(false)
    expect(kinds(neutral.body)).toContain(VOXEL.roof)
    const extent = (mesh: ChunkMesh) => Math.max(...Array.from(mesh.positions).filter((_, index) => index % 3 !== 1).map(Math.abs))
    // Columns whose cloth reaches the lowest banner row on the camera-facing +z side: a swallowtail for Meridian,
    // a point for Lantern.
    const tails = (mesh: ChunkMesh, cloth: number) => [-1, 0, 1].filter(column => {
      for (let quad = 0; quad < mesh.quads; quad++) {
        const corners = [0, 1, 2, 3].map(k => (quad * 4 + k) * 3)
        if (kindAt(mesh, quad * 4) !== cloth || mesh.normals[corners[0]! + 2] !== 1) continue
        if (Math.abs(mesh.positions[corners[0]! + 2]! - 3.5 * BEACON_VOXEL) > 1e-9) continue
        const xs = corners.map(c => mesh.positions[c]! / BEACON_VOXEL), ys = corners.map(c => mesh.positions[c + 1]! / BEACON_VOXEL)
        if (Math.min(...xs) < column && column < Math.max(...xs) && Math.abs(Math.min(...ys) - 7) < 1e-9) return true
      }
      return false
    })
    for (const [owner, light, mine, theirs, tail] of [
      [0, [VOXEL.beaconGold, VOXEL.beaconGoldCore], gold, blue, [-1, 1]],
      [1, [VOXEL.beaconBlue, VOXEL.beaconBlueCore], blue, gold, [0]],
    ] as const) {
      const held = beaconMeshes(owner)
      expect(kinds(held.light)).toEqual(new Set(light))
      expect(mine.every(kind => kinds(held.body).has(kind))).toBe(true)
      expect(theirs.some(kind => kinds(held.body).has(kind))).toBe(false)
      expect(kinds(held.body).has(VOXEL.roof)).toBe(false)
      expect(tails(held.body, mine[0])).toEqual(tail)
      // Banners hang within the gallery, so a held lighthouse keeps the neutral footprint inside its hex.
      expect(extent(held.body)).toBeLessThanOrEqual(extent(neutral.body))
    }
  })

  it('marks territory borders on exactly the hex edges where ownership ends', () => {
    const map = flatMap(6, 6)
    const owners = new Uint8Array(map.tiles.length)
    const centre = 2 * 6 + 2
    const ring = hexOffsets(2).map(([dx, dz]) => (2 + dz) * 6 + 2 + dx)
    for (const id of [centre, ...ring]) owners[id] = 1
    // A rival hex east of the territory and a lone hex in the map corner.
    owners[2 * 6 + 4] = 2
    owners[0] = 2
    expect(territoryCode(map, owners, centre)).toBe(1)
    for (const [k, id] of ring.entries()) {
      const code = territoryCode(map, owners, id)
      expect(code & 3).toBe(1)
      // The edge facing the centre is inside the territory; the ring's outer edges are borders.
      expect(code >> 2 & 1 << (k + 3) % 6).toBe(0)
      expect(code >> 2 & 1 << k).not.toBe(0)
    }
    // East neighbour of the east ring hex is the rival: both sides draw a border there.
    expect(territoryCode(map, owners, 2 * 6 + 3) >> 2 & 1).toBe(1)
    expect(territoryCode(map, owners, 2 * 6 + 4) >> 2 & 1 << 3).not.toBe(0)
    // Off-map edges count as borders.
    expect(territoryCode(map, owners, 0)).toBe(2 | 63 << 2)
    expect(territoryCode(map, owners, 5 * 6 + 5)).toBe(0)
  })

  it('never lets uncharted terrain influence the mesh', () => {
    const map = generateMap({ seed: 'polaris', width: 32, height: 32 })
    const known = new Uint8Array(map.tiles.length)
    for (const tile of map.tiles) known[tile.id] = tile.x < 14 && tile.z < 18 ? 1 : 0
    const altered: WorldMap = {
      ...map,
      tiles: map.tiles.map(tile => {
        if (known[tile.id]) return tile
        const fields = { id: tile.id, x: tile.x, z: tile.z }
        return tile.terrain === 'water'
          ? { ...fields, terrain: 'hills', elevation: 4, trees: 3 }
          : { ...fields, terrain: 'water', elevation: 0, trees: 0, waterDepth: 'deep' }
      }),
    }
    const original = meshAll(createVoxelWorld(map), known)
    meshAll(createVoxelWorld(altered), known).forEach((mesh, chunk) => {
      expect(sameMesh(mesh, original[chunk]!), `hidden terrain in chunk ${chunk}`).toBe(true)
    })
  })

  it('renders uncharted tiles as flat, unshaded, flagged fog down to the diorama base', () => {
    const map = generateMap({ seed: 'polaris', width: 32, height: 32 })
    const world = createVoxelWorld(map)
    const fog = Array.from(PALETTE.slice(VOXEL.fog * 3, VOXEL.fog * 3 + 3))
    const edge = meshChunk(world, new Uint8Array(map.tiles.length), world.chunksX * world.chunksZ - 1)
    expect(Array.from({ length: edge.normals.length / 3 }, (_, v) => v)
      .some(v => edge.normals[v * 3] === 1 && edge.positions[v * 3 + 1]! < 0)).toBe(true)
    const mesh = meshChunk(world, new Uint8Array(map.tiles.length), world.chunksX + 1)
    for (const chunk of [mesh, edge]) {
      for (let v = 0; v < chunk.colors.length / 4; v++) {
        expect(Array.from(chunk.colors.slice(v * 4, v * 4 + 3))).toEqual(fog)
        expect(chunk.colors[v * 4 + 3]).toBe(FACE_FLAG.fog)
      }
    }
    const tops = new Set<number>()
    for (let v = 0; v < mesh.normals.length / 3; v++) if (mesh.normals[v * 3 + 1] === 1) tops.add(mesh.positions[v * 3 + 1]!)
    expect([...tops]).toEqual([tileSurface(world, map.tiles[0]!, false) * world.size])
    // Fog tops merge into a few large quads instead of one quad per voxel.
    expect(mesh.quads).toBeLessThan(40)
  })

  it('stands figures on the visible ground', () => {
    const map = flatMap(6, 6, { 21: { terrain: 'hills', elevation: 4 }, 0: { terrain: 'water', elevation: 0 } })
    const world = createVoxelWorld(map)
    const known = allKnown(map)
    const at = (x: number, z: number) => groundHeight(world, known, ...hexCenter(x, z))
    expect(at(0, 0)).toBe(tileSurface(world, map.tiles[0]!, true) * world.size)
    expect(at(1, 1)).toBe(tileSurface(world, map.tiles[7]!, true) * world.size)
    expect(at(3, 3)).toBeGreaterThanOrEqual(tileSurface(world, map.tiles[21]!, true) * world.size)
    known[7] = 0
    expect(at(1, 1)).toBe(tileSurface(world, map.tiles[7]!, false) * world.size)
    expect(groundHeight(world, known, -3, -3)).toBeUndefined()
  })

  it('remeshes only chunks near a changed tile', () => {
    const world = createVoxelWorld(generateMap({ seed: 'polaris', width: 32, height: 32 }))
    expect([...affectedChunks(world, [0])]).toEqual([0])
    expect([...affectedChunks(world, [12 * 32 + 12])]).toEqual([18, 19, 26, 27])
    expect(affectedChunks(world, [8 * 32 + 8]).size).toBeGreaterThan(1)
  })

  it('remeshes every chunk a tile can change', () => {
    const map = generateMap({ seed: 'North_Star-7', width: 16, height: 16 })
    const world = createVoxelWorld(map, 16)
    const known = new Uint8Array(map.tiles.length)
    for (const tile of map.tiles) known[tile.id] = (tile.x * 5 + tile.z * 3) % 7 === 0 ? 0 : 1
    for (const id of [2 * 16 + 5, 9 * 16 + 9]) world.sites[id] = siteCode({ houses: 3, storehouse: true, banner: 0 })
    const before = meshAll(world, known)
    const changed = () => {
      const chunks = new Set<number>()
      meshAll(world, known).forEach((mesh, chunk) => { if (!sameMesh(mesh, before[chunk]!)) chunks.add(chunk) })
      return chunks
    }
    const subset = (chunks: Set<number>, allowed: Set<number>) => [...chunks].every(chunk => allowed.has(chunk))
    let touched = 0
    for (let id = 0; id < map.tiles.length; id += 7) {
      known[id] = known[id]! ^ 1
      const moved = changed()
      known[id] = known[id]! ^ 1
      touched += moved.size
      expect(subset(moved, affectedChunks(world, [id])), `known ${id}`).toBe(true)
      if (known[id] && map.tiles[id]!.terrain !== 'water') {
        world.sites[id] = siteCode({ houses: 3, storehouse: true, banner: 1 })
        const settled = changed()
        world.sites[id] = 0
        expect(subset(settled, affectedChunks(world, [id])), `site ${id}`).toBe(true)
      }
    }
    expect(touched).toBeGreaterThan(20)
  }, 60_000)

  it.each([8, 13])('updates charted coastal decoration when an island is revealed across %i-column chunks', chunkColumns => {
    const map = terraceMap(9, 9)
    const world = createVoxelWorld(map, chunkColumns)
    const known = allKnown(map)
    known[40] = 0
    const before = meshAll(world, known)
    expect(shows(before, VOXEL.waterEdge)).toBe(false)
    known[40] = 1
    const after = meshAll(world, known)
    const affected = affectedChunks(world, [40])
    let changed = 0
    after.forEach((mesh, chunk) => {
      if (sameMesh(mesh, before[chunk]!)) return
      changed++
      expect(affected.has(chunk), `changed chunk ${chunk}`).toBe(true)
    })
    expect(changed).toBeGreaterThan(1)
    expect(shows(after, VOXEL.waterEdge)).toBe(true)
  })

  it('picks the first visible tile column along the camera ray', () => {
    const map = flatMap(6, 6, { 21: { terrain: 'hills', elevation: 4 }, 0: { terrain: 'water', elevation: 0 } })
    const world = createVoxelWorld(map)
    const known = allKnown(map)
    const ray = (x: number, z: number) => {
      const [cx, cz] = hexCenter(x, z)
      const y = groundHeight(world, known, cx, cz)!
      return pickTile(world, known, [cx + VIEW[0] * 30, y + VIEW[1] * 30, cz + VIEW[2] * 30], DOWN_VIEW)
    }
    for (const tile of map.tiles) {
      const [cx, cz] = hexCenter(tile.x, tile.z)
      expect(pickTile(world, known, [cx + 0.05, 20, cz + 0.05], [0, -1, 0])).toBe(tile.id)
    }
    // The lowered sandbank exposes water that the former full-height cliff incorrectly intercepted.
    expect(ray(0, 0)).toBe(0)
    world.sites[6] = siteCode({ houses: 1, storehouse: false, banner: 0 })
    expect(ray(0, 0)).toBe(6)
    world.sites[6] = 0
    expect(ray(5, 5)).toBe(35)
    expect(ray(3, 3)).toBe(21)
    // The hill at (3, 3) hides its north-west neighbour along the oblique view.
    expect(ray(3, 2)).toBe(21)
    expect(ray(1, 4)).toBe(25)
    expect(pickTile(world, known, [-5, 20, -5], [0, -1, 0])).toBeUndefined()
    expect(pickTile(world, known, [3, 20, 3], [1, 0.2, 1])).toBeUndefined()
  })

  it('matches a brute-force column intersection for arbitrary oblique rays', () => {
    const map = generateMap({ seed: 'pick', width: 12, height: 9 })
    const world = createVoxelWorld(map)
    const known = allKnown(map)
    const { columnsX, columnsZ, columnTile, originX, originZ, size } = world
    const heights = Float32Array.from(columnTile, (_, index) => groundHeight(world, known,
      originX + (index % columnsX + 0.5) * size, originZ + (Math.floor(index / columnsX) + 0.5) * size) ?? 0)
    let state = 7
    const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296
    for (let sample = 0; sample < 600; sample++) {
      const direction = [(random() * 2 - 1) * 1.6, -1, (random() * 2 - 1) * 1.6] as const
      const target = [random() * 12.5 - 0.5, random() * 1.2, random() * 8 - 0.5]
      const origin = [target[0]! - direction[0] * 40, target[1]! + 40, target[2]! - direction[2] * 40] as const
      let expected: number | undefined
      let first = Infinity
      for (let gz = 0; gz < columnsZ; gz++) {
        for (let gx = 0; gx < columnsX; gx++) {
          const id = columnTile[gz * columnsX + gx]!
          if (id < 0) continue
          const slabs = [[originX + gx * size, origin[0], direction[0]], [originZ + gz * size, origin[2], direction[2]]] as const
          let enter = -Infinity
          let leave = Infinity
          for (const [low, o, d] of slabs) {
            const a = (low - o) / d
            const b = (low + size - o) / d
            enter = Math.max(enter, Math.min(a, b))
            leave = Math.min(leave, Math.max(a, b))
          }
          if (leave - enter > 1e-7 && origin[1] - leave <= heights[gz * columnsX + gx]! && enter < first) {
            first = enter
            expected = id
          }
        }
      }
      expect(pickTile(world, known, origin, direction), `sample ${sample}`).toBe(expected)
    }
  }, 60_000)

  it('meshes the scalability fixtures within budget', () => {
    for (const [size, maxVertices] of [[32, 900_000], [64, 900_000], [256, 900_000]] as const) {
      const map = generateMap({ seed: 'polaris', width: size, height: size })
      const world = createVoxelWorld(map)
      const started = performance.now()
      const meshes = meshAll(world, allKnown(map))
      const elapsed = performance.now() - started
      const vertices = meshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0)
      const bytes = meshes.reduce((sum, mesh) => sum + mesh.positions.byteLength + mesh.normals.byteLength
        + mesh.colors.byteLength + mesh.faceFlags.byteLength + mesh.indices.byteLength, 0)
      console.info(`${size}x${size}: scale ${world.scale}, ${meshes.length} chunks, ${vertices} vertices, ${bytes} bytes, ${elapsed.toFixed(0)} ms`)
      expect(vertices).toBeLessThan(maxVertices)
    }
  }, 60_000)
})
