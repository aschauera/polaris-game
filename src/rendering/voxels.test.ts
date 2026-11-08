import { describe, expect, it } from 'vitest'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { generateMap, type Tile, type WorldMap } from '../game/map'
import {
  FACE_DIRECTIONS, PALETTE, VOXEL, affectedChunks, createVoxelWorld, meshChunk, pickTile, tileSurface, voxelScale,
  type ChunkMesh, type VoxelWorld,
} from './voxels'

const allKnown = (map: WorldMap) => new Uint8Array(map.tiles.length).fill(1)

function meshAll(world: VoxelWorld, known: Uint8Array): ChunkMesh[] {
  return Array.from({ length: world.chunksX * world.chunksZ }, (_, chunk) => meshChunk(world, known, chunk))
}

function flatMap(width: number, height: number, overrides: Record<number, Partial<Tile>> = {}): WorldMap {
  const tiles = Array.from({ length: width * height }, (_, id): Tile => ({
    id, x: id % width, z: Math.floor(id / width), terrain: 'grassland', elevation: 1, trees: 0, ...overrides[id],
  }))
  return { seed: 'flat', width, height, generatorVersion: 2, rngState: 1, tiles }
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

describe('voxel terrain mesher', () => {
  it('keeps the column budget bounded with power-of-two voxel scales', () => {
    expect([[32, 32], [64, 64], [64, 48], [100, 100], [128, 128], [200, 200], [256, 256]]
      .map(([w, h]) => voxelScale(w!, h!))).toEqual([8, 8, 8, 4, 4, 2, 2])
    const world = createVoxelWorld(generateMap({ seed: 'polaris', width: 32, height: 32 }))
    expect(world).toMatchObject({ scale: 8, size: 0.125, columnsX: 256, chunksX: 4, chunksZ: 4, base: 6 })
    expect(createVoxelWorld(generateMap({ seed: 'polaris', width: 256, height: 256 }))).toMatchObject({ scale: 2, chunksX: 8 })
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

  it('only emits faces the fixed isometric camera or the key light can see', () => {
    const map = generateMap({ seed: 'polaris', width: 32, height: 32 })
    const mesh = meshChunk(createVoxelWorld(map), allKnown(map), 9)
    const seen = new Set<string>()
    for (let v = 0; v < mesh.normals.length; v += 3) seen.add(Array.from(mesh.normals.slice(v, v + 3)).join(','))
    expect([...seen].sort()).toEqual(FACE_DIRECTIONS.map(([axis, sign]) =>
      [0, 1, 2].map(component => component === axis ? sign : 0).join(',')).sort())
  })

  it('produces identical surfaces regardless of chunk borders', () => {
    const map = generateMap({ seed: 'North_Star-7', width: 16, height: 16 })
    const known = new Uint8Array(map.tiles.length)
    for (const tile of map.tiles) known[tile.id] = (tile.x * 7 + tile.z * 3) % 5 === 0 ? 0 : 1
    const whole = surfaceSignature(meshAll(createVoxelWorld(map, 128), known))
    for (const chunkColumns of [32, 48]) {
      const world = createVoxelWorld(map, chunkColumns)
      expect(world.chunksX * world.chunksZ).toBeGreaterThan(1)
      expect(surfaceSignature(meshAll(world, known))).toEqual(whole)
    }
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

  it('renders uncharted tiles as flat, unshaded, flagged fog', () => {
    const map = generateMap({ seed: 'polaris', width: 32, height: 32 })
    const world = createVoxelWorld(map)
    const mesh = meshChunk(world, new Uint8Array(map.tiles.length), 5)
    const fog = Array.from(PALETTE.slice(VOXEL.fog * 3, VOXEL.fog * 3 + 3))
    for (let v = 0; v < mesh.colors.length / 4; v++) {
      expect(Array.from(mesh.colors.slice(v * 4, v * 4 + 3))).toEqual(fog)
      expect(mesh.colors[v * 4 + 3]).toBe(0)
    }
    const tops = new Set<number>()
    for (let v = 0; v < mesh.normals.length / 3; v++) if (mesh.normals[v * 3 + 1] === 1) tops.add(mesh.positions[v * 3 + 1]!)
    expect([...tops]).toEqual([tileSurface(world, map.tiles[0]!, false) * world.size])
    // Fog tops merge into a few large quads instead of one quad per voxel.
    expect(mesh.quads).toBeLessThan(40)
  })

  it('remeshes only chunks near a changed tile', () => {
    const world = createVoxelWorld(generateMap({ seed: 'polaris', width: 32, height: 32 }))
    expect([...affectedChunks(world, [9 * 32 + 12])]).toEqual([5])
    expect([...affectedChunks(world, [0])]).toEqual([0])
    expect([...affectedChunks(world, [7 * 32 + 7])].sort()).toEqual([0, 1, 4, 5])
  })

  it('picks the first visible tile column along the camera ray', () => {
    const map = flatMap(6, 6, { 21: { terrain: 'hills', elevation: 4 }, 0: { terrain: 'water', elevation: 0 } })
    const world = createVoxelWorld(map)
    const known = allKnown(map)
    const heights = new Float32Array(map.tiles.map(tile => tileSurface(world, tile, known[tile.id] === 1) * world.size))
    const ray = (x: number, z: number) => {
      const y = heights[z * 6 + x]!
      return pickTile(world, heights, [x + 50, y + 50, z + 50], [-1, -1, -1])
    }
    expect(pickTile(world, heights, [2, 20, 4], [0, -1, 0])).toBe(26)
    expect(ray(0, 0)).toBe(0)
    expect(ray(5, 5)).toBe(35)
    expect(ray(3, 3)).toBe(21)
    // The hill at (3, 3) hides the low tile diagonally behind it.
    expect(ray(2, 2)).toBe(21)
    expect(ray(1, 4)).toBe(25)
    expect(pickTile(world, heights, [-5, 20, -5], [0, -1, 0])).toBeUndefined()
    expect(pickTile(world, heights, [3, 20, 3], [1, 0.2, 1])).toBeUndefined()
  })

  it('matches a brute-force column intersection for arbitrary oblique rays', () => {
    const map = generateMap({ seed: 'pick', width: 12, height: 9 })
    const world = createVoxelWorld(map)
    const heights = new Float32Array(map.tiles.map(tile => tileSurface(world, tile, true) * world.size))
    let state = 7
    const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296
    for (let sample = 0; sample < 2000; sample++) {
      const direction = [(random() * 2 - 1) * 1.6, -1, (random() * 2 - 1) * 1.6] as const
      const target = [random() * 12 - 0.5, random() * 1.2, random() * 9 - 0.5]
      const origin = [target[0]! - direction[0] * 40, target[1]! + 40, target[2]! - direction[2] * 40] as const
      let expected: number | undefined
      let first = Infinity
      for (const tile of map.tiles) {
        const slabs = [[tile.x, origin[0], direction[0]], [tile.z, origin[2], direction[2]]] as const
        let enter = -Infinity
        let leave = Infinity
        for (const [centre, o, d] of slabs) {
          const a = (centre - 0.5 - o) / d
          const b = (centre + 0.5 - o) / d
          enter = Math.max(enter, Math.min(a, b))
          leave = Math.min(leave, Math.max(a, b))
        }
        if (leave - enter > 1e-7 && origin[1] - leave <= heights[tile.id]! && enter < first) {
          first = enter
          expected = tile.id
        }
      }
      expect(pickTile(world, heights, origin, direction), `sample ${sample}`).toBe(expected)
    }
  })

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
