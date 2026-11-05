import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { generateMap, randomStep, seedState, tileAt } from './map'

describe('deterministic domain map', () => {
  it('locks complete generator-v1 fixtures across multiple seeds', () => {
    const fingerprints = ['polaris', 'aurora', '0', 'North_Star-7'].map(seed =>
      createHash('sha256').update(JSON.stringify(generateMap({ seed, width: 8, height: 8 }))).digest('hex'),
    )
    expect(fingerprints).toMatchInlineSnapshot(`
      [
        "e732bf6b9090638a17c43c71f8bcc7c11993ada3dcd9b6c960464768f16d9fde",
        "e1ec26b3c5a6bc5413aab84dbd48412c772218abcd9f96f3cfdd5d885dcd75ea",
        "8d71847cd2fb587932ce99fd6e13f752104df3eedc9f0faa8bf3d62ba4d8443f",
        "4cc95e4d0314c9e12752c7408c48b1109137d76e4cdd7ec8a6d4a4572d448c3b",
      ]
    `)
  })
  it.each(['polaris', 'aurora', '0', 'North_Star-7'])('repeats complete data for seed %s', (seed) => {
    const config = { seed, width: 32, height: 32 }
    expect(generateMap(config)).toEqual(generateMap(config))
    expect(new Set(generateMap(config).tiles.map(t => t.terrain)).size).toBe(3)
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
