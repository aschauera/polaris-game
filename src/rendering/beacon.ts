import { VOXEL, createVolume, meshVolume, placeVoxel, type ChunkMesh, type Volume } from './voxels'

/** Lighthouses use the finest terrain voxel, so they match the board's cubes at full detail. */
export const BEACON_VOXEL = 1 / 16
const SIZE = 9
const CENTRE = 4
const LAYERS = 19
/** World height from the foot of a lighthouse to its finial. */
export const BEACON_HEIGHT = LAYERS * BEACON_VOXEL
/** World height of the lantern's middle, where the glow sits. */
export const BEACON_LANTERN = 14.5 * BEACON_VOXEL
const GLOW = new Set<number>([VOXEL.beaconGlow, VOXEL.beaconCore])

/** One layer of an octagon: a square of `half` columns around the centre with corners cut beyond `cut`. */
function slab(volume: Volume, y: number, half: number, cut: number, paint: (dx: number, dz: number) => number): void {
  for (let dz = -half; dz <= half; dz++) {
    for (let dx = -half; dx <= half; dx++) {
      if (Math.abs(dx) + Math.abs(dz) <= cut) placeVoxel(volume, CENTRE + dx, y, CENTRE + dz, paint(dx, dz))
    }
  }
}

/** A neutral stone lighthouse; details go first because voxels never overwrite earlier ones. */
function stampLighthouse(volume: Volume): void {
  // The door and windows face the camera, which sees the +x and +z sides.
  placeVoxel(volume, CENTRE, 2, CENTRE + 2, VOXEL.door)
  placeVoxel(volume, CENTRE, 3, CENTRE + 2, VOXEL.door)
  placeVoxel(volume, CENTRE + 2, 7, CENTRE, VOXEL.window)
  placeVoxel(volume, CENTRE, 7, CENTRE + 2, VOXEL.window)
  // Lantern: a glowing core between four corner posts under a verdigris dome.
  for (let y = 13; y <= 15; y++) {
    slab(volume, y, 1, 2, () => y === 14 ? VOXEL.beaconCore : VOXEL.beaconGlow)
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) {
      placeVoxel(volume, CENTRE + dx, y, CENTRE + dz, VOXEL.castleDark)
    }
  }
  slab(volume, 18, 0, 0, () => VOXEL.patinaDark)
  slab(volume, 17, 1, 2, () => VOXEL.patina)
  slab(volume, 16, 2, 3, (dx, dz) => Math.abs(dx) + Math.abs(dz) === 3 ? VOXEL.patinaDark : VOXEL.patina)
  // Gallery with parapet posts on every other rim cell.
  for (let dz = -3; dz <= 3; dz++) {
    for (let dx = -3; dx <= 3; dx++) {
      const rim = Math.abs(dx) + Math.abs(dz) === 4 || (Math.abs(dx) === 3 || Math.abs(dz) === 3) && Math.abs(dx) + Math.abs(dz) < 4
      if (rim && (dx + dz) % 2 === 0) placeVoxel(volume, CENTRE + dx, 13, CENTRE + dz, VOXEL.castle)
    }
  }
  slab(volume, 12, 3, 4, () => VOXEL.castleDark)
  // Ivory shaft with two terracotta bands and sparse weathering.
  for (let y = 2; y <= 11; y++) {
    slab(volume, y, 2, 3, (dx, dz) => y === 5 || y === 9 ? VOXEL.roof
      : (dx * 7 + dz * 3 + y * 5 + 77) % 11 === 0 ? VOXEL.castle : VOXEL.wall)
  }
  slab(volume, 1, 3, 4, () => VOXEL.stone)
  slab(volume, 0, 4, 6, (dx, dz) => (dx * 3 + dz * 5 + 70) % 7 === 0 ? VOXEL.stone : VOXEL.castleDark)
}

export interface BeaconMeshes {
  /** Lit stone, shaft, gallery and dome. */
  readonly body: ChunkMesh
  /** Lantern voxels only, drawn unlit so they glow without animation. */
  readonly light: ChunkMesh
}

let cached: BeaconMeshes | undefined

/** Meshes of a lighthouse whose foot is centred on the local origin. */
export function beaconMeshes(): BeaconMeshes {
  if (cached) return cached
  const volume = createVolume(0, 0, SIZE, SIZE, LAYERS)
  stampLighthouse(volume)
  const corner = [-SIZE / 2 * BEACON_VOXEL, 0, -SIZE / 2 * BEACON_VOXEL] as const
  const part = (glow: boolean): ChunkMesh =>
    meshVolume({ ...volume, data: volume.data.map(kind => GLOW.has(kind) === glow ? kind : 0) }, BEACON_VOXEL, corner)
  cached = { body: part(false), light: part(true) }
  return cached
}
