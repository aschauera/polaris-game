/**
 * Pointy-top hexagons in "odd-r" offset layout: odd rows are shifted half a tile east.
 * Tile centres are one unit apart, so every neighbour lies at distance 1 from the centre.
 */
export const HEX_ROW = Math.sqrt(3) / 2
export const HEX_RADIUS = 1 / Math.sqrt(3)

/** Neighbour offsets ordered east, south-east, south-west, west, north-west, north-east. */
const EVEN_ROW = [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]] as const
const ODD_ROW = [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]] as const
export const HEX_DIRECTIONS = ['east', 'south-east', 'south-west', 'west', 'north-west', 'north-east'] as const
export type HexDirection = typeof HEX_DIRECTIONS[number]

export function hexOffsets(z: number): readonly (readonly [number, number])[] {
  return z & 1 ? ODD_ROW : EVEN_ROW
}

export function hexCenter(x: number, z: number): [number, number] {
  return [x + 0.5 * (z & 1), z * HEX_ROW]
}

export function toAxial(x: number, z: number): [number, number] {
  return [x - (z - (z & 1)) / 2, z]
}

export function hexDistance(ax: number, az: number, bx: number, bz: number): number {
  const [aq, ar] = toAxial(ax, az)
  const [bq, br] = toAxial(bx, bz)
  const dq = aq - bq, dr = ar - br
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
}

/** The offset coordinates of the hex containing the world point (px, pz). */
export function hexAt(px: number, pz: number): [number, number] {
  const r = pz / HEX_ROW, q = px - r / 2, s = -q - r
  let rq = Math.round(q), rr = Math.round(r)
  const rs = Math.round(s)
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s)
  if (dq > dr && dq > ds) rq = -rr - rs
  else if (dr > ds) rr = -rq - rs
  return [rq + (rr - (rr & 1)) / 2, rr]
}
