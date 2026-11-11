import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { generateMap } from '../game/map'
import { hexCenter } from '../game/hex'
import { chunkKey, detailWindow } from './detail'
import { CHUNK_COLUMNS, affectedChunks, createVoxelWorld, groundHeight, meshChunk, pickTile, siteCode,
  type VoxelWindow } from './voxels'

describe('viewport detail', () => {
  it.each([[64, 64], [128, 128], [256, 256], [256, 8], [8, 256]])(
    'restores showcase density on %sx%s without allocating the full fine grid', (width, height) => {
      const map = generateMap({ seed: 'polaris', width, height })
      const initial = createVoxelWorld(map)
      for (const aspect of [0.4, 1, 2.5]) {
        let previous: VoxelWindow = initial
        for (const halfHeight of [200, 20, 9, 3]) {
          for (const [x, z] of [[0, 0], [width / 2, height * 0.433], [width - 0.5, (height - 1) * 0.866]]) {
            const next = detailWindow(map, x!, z!, halfHeight, aspect, previous)
            expect(next.columnsX * next.columnsZ).toBeLessThan((512 + 4 * CHUNK_COLUMNS) ** 2)
            expect(Math.ceil(next.columnsX / CHUNK_COLUMNS) * Math.ceil(next.columnsZ / CHUNK_COLUMNS)).toBeLessThanOrEqual(144)
            expect(next.offsetX % CHUNK_COLUMNS).toBe(0)
            expect(next.offsetZ % CHUNK_COLUMNS).toBe(0)
            previous = next
          }
        }
        expect(previous.scale).toBe(16)
        const reset = detailWindow(map, width / 2, height * 0.433, 200, aspect, previous)
        expect(reset).toMatchObject({ scale: initial.scale, columnsX: initial.columnsX, columnsZ: initial.columnsZ })
      }
    })

  it('reuses the padded window for small pans and has hysteresis at zoom boundaries', () => {
    const map = generateMap({ seed: 'polaris', width: 256, height: 256 })
    const window = detailWindow(map, 120, 110, 3, 1.4)
    expect(detailWindow(map, 120.05, 110.05, 3, 1.4, window)).toBe(window)
    const coarse = { ...window, scale: 8 }
    let transition = 3
    while (detailWindow(map, 120, 110, transition, 1.4, window).scale === 16) transition += 0.05
    expect(detailWindow(map, 120, 110, transition - 0.05, 1.4, coarse).scale).toBe(8)
  })

  it('keeps cropped geometry, coast sampling, fog, settlements and picking identical to the global lattice', () => {
    const map = generateMap({ seed: 'polaris', width: 32, height: 32 })
    const full = createVoxelWorld(map)
    const crop = createVoxelWorld(map, CHUNK_COLUMNS,
      { scale: 16, offsetX: 132, offsetZ: 132, columnsX: 132, columnsZ: 132 })
    const known = new Uint8Array(map.tiles.length).fill(1)
    for (const id of [330, 361, 395]) {
      known[id] = 0
      full.sites[id + 1] = crop.sites[id + 1] = siteCode({ houses: 3, storehouse: true, banner: 1 })
    }
    for (let index = 0; index < 4; index++) {
      const original = (2 + Math.floor(index / 2)) * full.chunksX + 2 + index % 2
      expect(chunkKey(crop, index)).toBe(chunkKey(full, original))
      const signature = (world: typeof full, id: number) => {
        const mesh = meshChunk(world, known, id)
        const digest = createHash('sha256')
        for (const data of [mesh.positions, mesh.normals, mesh.colors, mesh.faceFlags, mesh.indices]) digest.update(data)
        return { hash: digest.digest('hex'), quads: mesh.quads, water: mesh.waterIndexCount }
      }
      expect(signature(crop, index)).toEqual(signature(full, original))
    }
    for (const tile of map.tiles.filter(t => t.x >= 9 && t.x < 15 && t.z >= 11 && t.z < 17)) {
      const [x, z] = hexCenter(tile.x, tile.z)
      expect(groundHeight(crop, known, x, z)).toBe(groundHeight(full, known, x, z))
      const origin = [x, 20, z] as const, direction = [0, -1, 0] as const
      expect(pickTile(crop, known, origin, direction)).toBe(pickTile(full, known, origin, direction))
    }
    expect(affectedChunks(crop, [0]).size).toBe(0)
    expect(affectedChunks(crop, [12 * 32 + 12]).size).toBeGreaterThan(0)
  })
})
