import { describe, expect, it } from 'vitest'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { HEX_ROW, hexAt, hexCenter, hexOffsets } from '../game/hex'
import { generateMap, type Tile, type WorldMap } from '../game/map'
import {
  AO_LIGHT, FACE_DIRECTIONS, FACE_FLAG, PALETTE, VOXEL, affectedChunks, centreColumn, columnTileAt, createVoxelWorld, groundHeight,
  meshChunk, pickTile, siteCode, territoryCode, tileSurface, voxelScale, type ChunkMesh, type VoxelWorld,
} from './voxels'

const allKnown = (map: WorldMap) => new Uint8Array(map.tiles.length).fill(1)

function meshAll(world: VoxelWorld, known: Uint8Array): ChunkMesh[] {
  return Array.from({ length: world.chunksX * world.chunksZ }, (_, chunk) => meshChunk(world, known, chunk))
}

function flatMap(width: number, height: number, overrides: Record<number, Partial<Tile>> = {}): WorldMap {
  const tiles = Array.from({ length: width * height }, (_, id): Tile => ({
    id, x: id % width, z: Math.floor(id / width), terrain: 'grassland', elevation: 1, trees: 0, ...overrides[id],
  }))
  return { seed: 'flat', width, height, generatorVersion: 3, rngState: 1, tiles }
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
  && a.positions.every((value, index) => value === b.positions[index])
  && a.colors.every((value, index) => value === b.colors[index])

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

// The camera looks down 42 degrees from a yaw of 60 degrees, so rays travel towards -x and -z.
const PITCH = 42 * Math.PI / 180
const VIEW = [0.5 * Math.cos(PITCH), Math.sin(PITCH), HEX_ROW * Math.cos(PITCH)] as const
const DOWN_VIEW = [-VIEW[0], -VIEW[1], -VIEW[2]] as const

describe('hex voxel terrain', () => {
  it('keeps the column budget bounded with power-of-two voxel scales', () => {
    expect([[32, 32], [64, 64], [64, 48], [100, 100], [128, 128], [200, 200], [256, 256]]
      .map(([w, h]) => voxelScale(w!, h!))).toEqual([8, 8, 8, 4, 4, 2, 2])
    const world = createVoxelWorld(generateMap({ seed: 'polaris', width: 32, height: 32 }))
    expect(world).toMatchObject({ scale: 8, size: 0.125, columnsX: 260, columnsZ: 225, chunksX: 4, chunksZ: 4, base: 6 })
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

  it('keeps every elevation step distinct at every scale', () => {
    for (const size of [32, 128, 256]) {
      const world = createVoxelWorld(flatMap(size, size))
      const tile = (terrain: Tile['terrain'], elevation: number) =>
        tileSurface(world, { id: 0, x: 0, z: 0, terrain, elevation, trees: 0 }, true)
      const levels = [tile('water', 0), tile('grassland', 1), tile('grassland', 2), tile('hills', 3), tile('hills', 4)]
      expect([...levels].sort((a, b) => a - b)).toEqual(levels)
      expect(new Set(levels).size).toBe(5)
    }
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

  it('flags ground, decoration and fog faces for the hex overlay shader', () => {
    const map = flatMap(6, 6, { 14: { trees: 3 } })
    const known = allKnown(map)
    known[0] = 0
    const flags = new Set<number>()
    for (const mesh of meshAll(createVoxelWorld(map), known)) for (let v = 3; v < mesh.colors.length; v += 4) flags.add(mesh.colors[v]!)
    expect([...flags].sort()).toEqual([FACE_FLAG.fog, FACE_FLAG.decoration, FACE_FLAG.ground])
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
    const whole = settle(createVoxelWorld(map, 160))
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
    expect(shows(meshAll(world, known), VOXEL.trunk)).toBe(true)
    expect(shows(meshAll(world, known), VOXEL.roof)).toBe(false)
    world.sites[5] = siteCode({ houses: 1, storehouse: false, banner: 1 })
    const village = meshAll(world, known)
    expect([VOXEL.roof, VOXEL.castle, VOXEL.bannerBlue, VOXEL.path].map(kind => shows(village, kind))).toEqual([true, true, true, true])
    expect([VOXEL.trunk, VOXEL.bannerGold, VOXEL.thatch].map(kind => shows(village, kind))).toEqual([false, false, false])
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
    for (const size of [8, 128, 256]) {
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
    for (const size of [32, 128, 256]) {
      const map = flatMap(size, size)
      const world = createVoxelWorld(map)
      world.sites[0] = siteCode({ houses: 3, storehouse: false, banner: 0 })
      const mesh = [meshChunk(world, allKnown(map), 0)]
      expect(shows(mesh, VOXEL.roof), `${size}`).toBe(true)
      expect(shows(mesh, VOXEL.bannerGold), `${size}`).toBe(world.scale >= 4)
    }
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
      tiles: map.tiles.map(tile => known[tile.id] ? tile : { ...tile, terrain: tile.terrain === 'water' ? 'hills' : 'water',
        elevation: tile.terrain === 'water' ? 4 : 0, trees: tile.terrain === 'water' ? 3 : 0 }),
    }
    expect(meshAll(createVoxelWorld(altered), known)).toEqual(meshAll(createVoxelWorld(map), known))
  })

  it('renders uncharted tiles as flat, unshaded, flagged fog down to the diorama base', () => {
    const map = generateMap({ seed: 'polaris', width: 32, height: 32 })
    const world = createVoxelWorld(map)
    const fog = Array.from(PALETTE.slice(VOXEL.fog * 3, VOXEL.fog * 3 + 3))
    // Chunk 15 holds the map's +x/+z corner, whose base sides face the camera.
    const edge = meshChunk(world, new Uint8Array(map.tiles.length), 15)
    expect(Array.from({ length: edge.normals.length / 3 }, (_, v) => v)
      .some(v => edge.normals[v * 3] === 1 && edge.positions[v * 3 + 1]! < 0)).toBe(true)
    const mesh = meshChunk(world, new Uint8Array(map.tiles.length), 5)
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
    expect([...affectedChunks(world, [12 * 32 + 12])]).toEqual([5])
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

  it('picks the first visible tile column along the camera ray', () => {
    const map = flatMap(6, 6, { 21: { terrain: 'hills', elevation: 4 }, 0: { terrain: 'water', elevation: 0 } })
    const world = createVoxelWorld(map)
    const known = allKnown(map)
    const heights = new Float32Array(map.tiles.map(tile => tileSurface(world, tile, known[tile.id] === 1) * world.size))
    const ray = (x: number, z: number) => {
      const [cx, cz] = hexCenter(x, z)
      const y = heights[z * 6 + x]!
      return pickTile(world, heights, [cx + VIEW[0] * 30, y + VIEW[1] * 30, cz + VIEW[2] * 30], DOWN_VIEW)
    }
    for (const tile of map.tiles) {
      const [cx, cz] = hexCenter(tile.x, tile.z)
      expect(pickTile(world, heights, [cx + 0.05, 20, cz + 0.05], [0, -1, 0])).toBe(tile.id)
    }
    expect(ray(0, 0)).toBe(0)
    expect(ray(5, 5)).toBe(35)
    expect(ray(3, 3)).toBe(21)
    // The hill at (3, 3) hides its north-west neighbour, which lies straight behind it along the view.
    expect(ray(3, 2)).toBe(21)
    expect(ray(1, 4)).toBe(25)
    expect(pickTile(world, heights, [-5, 20, -5], [0, -1, 0])).toBeUndefined()
    expect(pickTile(world, heights, [3, 20, 3], [1, 0.2, 1])).toBeUndefined()
  })

  it('matches a brute-force column intersection for arbitrary oblique rays', () => {
    const map = generateMap({ seed: 'pick', width: 12, height: 9 })
    const world = createVoxelWorld(map)
    const heights = new Float32Array(map.tiles.map(tile => tileSurface(world, tile, true) * world.size))
    const { columnsX, columnsZ, columnTile, originX, originZ, size } = world
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
          if (leave - enter > 1e-7 && origin[1] - leave <= heights[id]! && enter < first) {
            first = enter
            expected = id
          }
        }
      }
      expect(pickTile(world, heights, origin, direction), `sample ${sample}`).toBe(expected)
    }
  }, 60_000)

  it('meshes the scalability fixtures within budget', () => {
    for (const [size, maxVertices] of [[32, 250_000], [64, 900_000], [256, 900_000]] as const) {
      const map = generateMap({ seed: 'polaris', width: size, height: size })
      const world = createVoxelWorld(map)
      const started = performance.now()
      const meshes = meshAll(world, allKnown(map))
      const elapsed = performance.now() - started
      const vertices = meshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0)
      console.info(`${size}x${size}: scale ${world.scale}, ${meshes.length} chunks, ${vertices} vertices, ${elapsed.toFixed(0)} ms`)
      expect(vertices).toBeLessThan(maxVertices)
    }
  }, 60_000)
})
