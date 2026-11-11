import { describe, expect, it } from 'vitest'
import { HEX_RADIUS, HEX_ROW, hexAt, hexCenter, hexDistance, hexOffsets } from './hex'

describe('odd-r pointy-top hex geometry', () => {
  it('places every neighbour exactly one unit away along the six edge normals', () => {
    for (const z of [0, 1, 4, 7]) {
      const [cx, cz] = hexCenter(3, z)
      const angles = hexOffsets(z).map(([dx, dz]) => {
        const [nx, nz] = hexCenter(3 + dx, z + dz)
        expect(Math.hypot(nx - cx, nz - cz)).toBeCloseTo(1, 12)
        expect(hexDistance(3, z, 3 + dx, z + dz)).toBe(1)
        return Math.round(Math.atan2(nz - cz, nx - cx) * 180 / Math.PI)
      })
      expect(angles).toEqual([0, 60, 120, 180, -120, -60])
    }
  })

  it('measures symmetric hex distances that satisfy the triangle inequality', () => {
    const points = Array.from({ length: 40 }, (_, i) => [(i * 7) % 11, (i * 5) % 9] as const)
    for (const [ax, az] of points) {
      for (const [bx, bz] of points) {
        const ab = hexDistance(ax, az, bx, bz)
        expect(ab).toBe(hexDistance(bx, bz, ax, az))
        expect(ab === 0).toBe(ax === bx && az === bz)
        for (const [cx, cz] of points.slice(0, 6)) {
          expect(ab).toBeLessThanOrEqual(hexDistance(ax, az, cx, cz) + hexDistance(cx, cz, bx, bz))
        }
      }
    }
    expect(hexDistance(0, 0, 4, 0)).toBe(4)
    expect(hexDistance(0, 0, 0, 4)).toBe(4)
    expect(hexDistance(0, 0, 2, 4)).toBe(4)
  })

  it('maps world points to the hex whose centre is nearest', () => {
    let state = 11
    const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296
    for (let sample = 0; sample < 5000; sample++) {
      const px = random() * 12 - 1, pz = random() * 10 - 1
      const [x, z] = hexAt(px, pz)
      const [cx, cz] = hexCenter(x, z)
      const own = Math.hypot(px - cx, pz - cz)
      expect(own).toBeLessThanOrEqual(HEX_RADIUS + 1e-9)
      for (const [dx, dz] of hexOffsets(z)) {
        const [nx, nz] = hexCenter(x + dx, z + dz)
        expect(own).toBeLessThanOrEqual(Math.hypot(px - nx, pz - nz) + 1e-9)
      }
    }
    expect(hexAt(...hexCenter(5, 3))).toEqual([5, 3])
    expect(hexAt(0, HEX_ROW * 2)).toEqual([0, 2])
  })
})
