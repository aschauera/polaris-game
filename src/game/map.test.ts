import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { WATER_DEPTH, generateMap, randomStep, seedState, tileAt, type WorldMap } from './map'
import { neighbors } from './expedition'
import { HEX_ROW, hexCenter } from './hex'

function landmasses(map: WorldMap): number[][] {
  const visited = new Set<number>()
  const masses: number[][] = []
  for (const tile of map.tiles) {
    if (tile.terrain === 'water' || visited.has(tile.id)) continue
    const mass = [tile.id]
    visited.add(tile.id)
    for (let index = 0; index < mass.length; index++) {
      for (const id of neighbors(map, mass[index]!)) {
        if (map.tiles[id]!.terrain !== 'water' && !visited.has(id)) {
          visited.add(id)
          mass.push(id)
        }
      }
    }
    masses.push(mass)
  }
  return masses
}

// An ocean-connected, wide water cell deep inside a landmass's convex hull is a real bay, not coast noise or a lake.
function bayDepth(map: WorldMap, mass: number[]): number {
  type Point = readonly [number, number]
  const points = mass.map(id => hexCenter(map.tiles[id]!.x, map.tiles[id]!.z))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const half = (ordered: Point[]) => {
    const hull: Point[] = []
    for (const point of ordered) {
      while (hull.length >= 2 && cross(hull.at(-2)!, hull.at(-1)!, point) <= 0) hull.pop()
      hull.push(point)
    }
    return hull.slice(0, -1)
  }
  const hull = [...half(points), ...half([...points].reverse())]
  const ocean = map.tiles.filter(tile => tile.terrain === 'water'
    && (tile.x === 0 || tile.z === 0 || tile.x === map.width - 1 || tile.z === map.height - 1)).map(tile => tile.id)
  const visited = new Set(ocean)
  for (let index = 0; index < ocean.length; index++) {
    for (const id of neighbors(map, ocean[index]!)) {
      if (map.tiles[id]!.terrain === 'water' && !visited.has(id)) { visited.add(id); ocean.push(id) }
    }
  }
  let deepest = 0
  for (const id of ocean) {
    if (neighbors(map, id).filter(other => map.tiles[other]!.terrain === 'water').length < 4) continue
    const tile = map.tiles[id]!, point = hexCenter(tile.x, tile.z)
    let depth = Infinity
    for (let index = 0; index < hull.length; index++) {
      const a = hull[index]!, b = hull[(index + 1) % hull.length]!
      if (cross(a, b, point) < 0) { depth = 0; break }
      const dx = b[0] - a[0], dz = b[1] - a[1]
      const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (dx * dx + dz * dz)))
      depth = Math.min(depth, Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz))
    }
    deepest = Math.max(deepest, depth)
  }
  return deepest
}

describe('deterministic domain map', () => {
  it('preserves inherited landforms, elevations, trees and RNG progression', () => {
    const fixtures = [
      { seed: 'polaris', width: 32, height: 32 },
      { seed: 'aurora', width: 64, height: 48 },
      { seed: '0', width: 256, height: 256 },
    ].map(config => {
      const map = generateMap(config)
      const inherited = { rng: map.rngState, tiles: map.tiles.map(tile =>
        [tile.id, tile.x, tile.z, tile.terrain, tile.elevation, tile.trees]) }
      return createHash('sha256').update(JSON.stringify(inherited)).digest('hex')
    })
    expect(fixtures).toMatchInlineSnapshot(`
      [
        "66348f95dd04e846de75545e81da71e0d2c325662e8b758a54cc4242cf870a4b",
        "1e699bd8523801aa9c573189212bff2634c01bdf4fa946d70f75025113d727d0",
        "f935ff74723e16ab7a09ae022e030aaae1a55fe0ebefdeeb5b1962d87821b860",
      ]
    `)
  })

  it('locks complete generator-v6 fixtures across multiple seeds', () => {
    const fingerprints = ['polaris', 'aurora', '0', 'North_Star-7'].map(seed =>
      createHash('sha256').update(JSON.stringify(generateMap({ seed, width: 8, height: 8 }))).digest('hex'),
    )
    expect(fingerprints).toMatchInlineSnapshot(`
      [
        "33bc4e7647132b5e6227a102d1000881870ca6d0365f3eb9647fcaaa0360183f",
        "9ebdcb64dc485d9d0991b393023113c1d9c67872a08321f44b25784a7d73fdf2",
        "8e4abca4d2eecf2ed0bec00328a05ddcb5337151814ea908b5bb2fb27fd74ef1",
        "c884125ecd62c47bbcd7ccaa56764e088ce56644000fbaa1338da5c77720f722",
      ]
    `)
  })
  it.each(['polaris', 'aurora', '0', 'North_Star-7'])('repeats complete data for seed %s', (seed) => {
    const config = { seed, width: 32, height: 32 }
    expect(generateMap(config)).toEqual(generateMap(config))
    expect(new Set(generateMap(config).tiles.map(t => t.terrain)).size).toBe(3)
  })

  it('generates a deterministic archipelago topology with all canonical water depths', () => {
    const config = { seed: 'island0', width: 32, height: 32, topology: 'archipelago' as const }
    const map = generateMap(config)
    expect(map).toEqual(generateMap(config))
    expect(map).toMatchObject({ topology: 'archipelago', generatorVersion: 6 })
    expect(map).not.toEqual(generateMap({ ...config, topology: 'shared-landmass' }))
    expect(new Set(map.tiles.filter(tile => tile.terrain === 'water').map(tile => tile.waterDepth)))
      .toEqual(new Set(Object.keys(WATER_DEPTH)))
  })

  it('generates distinct continents and hex-connected stepped terrain', () => {
    for (const seed of ['polaris', 'aurora', '0']) {
      const map = generateMap({ seed, width: 64, height: 48 })
      const landmassSizes = landmasses(map).map(mass => mass.length)
      expect(landmassSizes.filter(size => size >= map.tiles.length * 0.05).length).toBeGreaterThanOrEqual(2)
      expect(Math.max(...map.tiles.map(tile => tile.elevation))).toBe(4)
      expect(map.tiles.every(tile => tile.terrain === 'water'
        ? tile.elevation === 0 && tile.trees === 0
        : tile.elevation >= 1 && tile.elevation <= 4 && tile.trees >= 0 && tile.trees <= 3)).toBe(true)
      expect(map.tiles.some(tile => tile.trees > 0)).toBe(true)
    }
  })

  it('generates broad offshore shallows and variable coastal widths while retaining deep-water gaps', () => {
    for (const seed of ['polaris', 'aurora', '0']) for (const [width, height] of [[32, 32], [64, 48], [128, 128]]) {
      const map = generateMap({ seed, width: width!, height: height! })
      const label = `${seed} ${width}x${height}`
      const water = map.tiles.filter(tile => tile.terrain === 'water')
      expect(new Set(water.map(tile => tile.waterDepth)), label).toEqual(new Set(Object.keys(WATER_DEPTH)))
      expect(map.tiles.every(tile => tile.terrain === 'water'
        ? Object.hasOwn(WATER_DEPTH, tile.waterDepth)
        : tile.waterDepth === undefined), label).toBe(true)
      const distance = new Map<number, number>()
      const coast = map.tiles.filter(tile => tile.terrain !== 'water').map(tile => tile.id)
      for (const id of coast) distance.set(id, 0)
      for (let index = 0; index < coast.length; index++) for (const id of neighbors(map, coast[index]!)) {
        if (distance.has(id)) continue
        distance.set(id, distance.get(coast[index]!)! + 1)
        coast.push(id)
      }
      const shallow = new Set(water.filter(tile => tile.waterDepth === 'shallow' || tile.waterDepth === 'shoal')
        .map(tile => tile.id))
      const connected = [...shallow].filter(id => distance.get(id) === 1)
      const reached = new Set(connected)
      for (let index = 0; index < connected.length; index++) for (const id of neighbors(map, connected[index]!)) {
        if (!shallow.has(id) || reached.has(id)) continue
        reached.add(id)
        connected.push(id)
      }
      expect(connected.filter(id => distance.get(id)! >= 3
        && neighbors(map, id).filter(other => shallow.has(other)).length >= 3).length,
      `${label}: broad connected banks beyond two hexes`).toBeGreaterThanOrEqual(2)
      const byDistance = new Map<number, Set<boolean>>()
      for (const tile of water) {
        const steps = distance.get(tile.id)!
        const classes = byDistance.get(steps) ?? new Set<boolean>()
        classes.add(shallow.has(tile.id))
        byDistance.set(steps, classes)
      }
      expect([...byDistance.values()].some(classes => classes.size === 2),
        `${label}: distance alone must not determine shallow access`).toBe(true)
      const deepShare = water.filter(tile => tile.waterDepth === 'deep').length / water.length
      expect(deepShare, `${label}: retained deep water`).toBeGreaterThan(0.25)
      expect(deepShare, `${label}: useful coastal shelf`).toBeLessThan(0.95)
    }
  })

  it('carves broad ocean-connected bays deeply into irregular continents', () => {
    for (const seed of ['polaris', 'aurora', '0']) for (const [width, height] of [[32, 32], [64, 48], [128, 128]]) {
      const map = generateMap({ seed, width: width!, height: height! })
      const masses = landmasses(map).filter(mass => mass.length >= map.tiles.length * 0.05)
      const depths = masses.map(mass => bayDepth(map, mass) / Math.sqrt(mass.length * HEX_ROW))
      expect(Math.max(...depths), `${seed} ${width}x${height}: bay depth relative to landmass size`).toBeGreaterThan(0.18)
      const landShare = map.tiles.filter(tile => tile.terrain !== 'water').length / map.tiles.length
      expect(landShare, `${seed} ${width}x${height}: retained land share`).toBeGreaterThan(0.07)
      expect(landShare).toBeLessThan(0.5)
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
