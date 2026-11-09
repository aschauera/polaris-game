import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { generateMap, randomStep, seedState, tileAt } from './map'
import { neighbors } from './expedition'

describe('deterministic domain map', () => {
  it('locks complete generator-v3 fixtures across multiple seeds', () => {
    const fingerprints = ['polaris', 'aurora', '0', 'North_Star-7'].map(seed =>
      createHash('sha256').update(JSON.stringify(generateMap({ seed, width: 8, height: 8 }))).digest('hex'),
    )
    expect(fingerprints).toMatchInlineSnapshot(`
      [
        "ea19e1124e0e03aa930f6cbcf7778bcac0200487521a8418f12023995a2ddbc5",
        "e4887288717872ff50569af8d501b39784e1e8019d0cb27553400769d3d6f268",
        "0c731f5211de690ec8c3aa6e0661869c03e38bffd527c32f2c6539bd89a6608f",
        "5324f518177cb5b6d82cf805609e9801beec7e1baa7caf1bea2cfbc9c449a738",
      ]
    `)
  })
  it.each(['polaris', 'aurora', '0', 'North_Star-7'])('repeats complete data for seed %s', (seed) => {
    const config = { seed, width: 32, height: 32 }
    expect(generateMap(config)).toEqual(generateMap(config))
    expect(new Set(generateMap(config).tiles.map(t => t.terrain)).size).toBe(3)
  })

  it('generates distinct continents and hex-connected stepped terrain', () => {
    for (const seed of ['polaris', 'aurora', '0']) {
      const map = generateMap({ seed, width: 64, height: 48 })
      const visited = new Set<number>()
      const landmassSizes: number[] = []
      for (const tile of map.tiles) {
        if (tile.terrain === 'water' || visited.has(tile.id)) continue
        const frontier = [tile.id]
        visited.add(tile.id)
        let size = 0
        while (frontier.length) {
          const current = frontier.pop()!
          size++
          for (const id of neighbors(map, current)) {
            if (map.tiles[id]!.terrain !== 'water' && !visited.has(id)) {
              visited.add(id)
              frontier.push(id)
            }
          }
        }
        landmassSizes.push(size)
      }
      expect(landmassSizes.filter(size => size >= map.tiles.length * 0.05).length).toBeGreaterThanOrEqual(2)
      expect(Math.max(...map.tiles.map(tile => tile.elevation))).toBe(4)
      expect(map.tiles.every(tile => tile.terrain === 'water'
        ? tile.elevation === 0 && tile.trees === 0
        : tile.elevation >= 1 && tile.elevation <= 4 && tile.trees >= 0 && tile.trees <= 3)).toBe(true)
      expect(map.tiles.some(tile => tile.trees > 0)).toBe(true)
    }
  })

  it('uses canonical row-major coordinates on rectangular maps', () => {
    const map = generateMap({ seed: 'polaris', width: 8, height: 12 })
    expect(map.tiles).toHaveLength(96)
    for (const [id, tile] of map.tiles.entries()) {
      expect(tile).toMatchObject({ id, x: id % 8, z: Math.floor(id / 8) })
      expect(tileAt(map, tile.x, tile.z)).toBe(tile)
    }
    for (const [x, z] of [[-1, 0], [8, 0], [0, 12], [0.5, 1], [NaN, 1]]) {
      expect(tileAt(map, x!, z!)).toBeUndefined()
    }
  })

  it('supports the bounded scalability fixture', () => {
    const map = generateMap({ seed: 'polaris', width: 256, height: 256 })
    expect(map.tiles).toHaveLength(65_536)
    expect(tileAt(map, 255, 255)?.id).toBe(65_535)
  })

  it.each(['', 'spaces here', '<script>', 'a'.repeat(65), 'é'])('rejects invalid seed %s', seed => {
    expect(() => generateMap({ seed, width: 32, height: 32 })).toThrow(/Seed/)
  })

  it.each([0, 7, 257, 32.5, NaN, Infinity])('rejects invalid dimension %s', value => {
    expect(() => generateMap({ seed: 'polaris', width: value, height: 32 })).toThrow(/whole numbers/)
    expect(() => generateMap({ seed: 'polaris', width: 32, height: value })).toThrow(/whole numbers/)
  })

  it('changes maps when seeds change and exposes controlled RNG state', () => {
    expect(generateMap({ seed: 'a', width: 8, height: 8 }))
      .not.toEqual(generateMap({ seed: 'b', width: 8, height: 8 }))
    expect(randomStep(seedState('polaris'))).toEqual(randomStep(seedState('polaris')))
  })
})
