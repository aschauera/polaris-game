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
/** Banner index of the faction holding a beacon, as for figures and keeps: 0 gold Meridian, 1 blue Lantern. */
export type BeaconOwner = 0 | 1
const NEUTRAL = { glow: VOXEL.beaconGlow, core: VOXEL.beaconCore, band: VOXEL.roof } as const
const OWNERS = [
  { glow: VOXEL.beaconGold, core: VOXEL.beaconGoldCore, band: VOXEL.bannerGold, cloth: VOXEL.bannerGold, hem: VOXEL.goldDark, tails: [-1, 1] },
  { glow: VOXEL.beaconBlue, core: VOXEL.beaconBlueCore, band: VOXEL.bannerBlue, cloth: VOXEL.bannerBlue, hem: VOXEL.blueDark, tails: [0] },
] as const
const GLOW = new Set<number>([NEUTRAL, ...OWNERS].flatMap(look => [look.glow, look.core]))

/** One layer of an octagon: a square of `half` columns around the centre with corners cut beyond `cut`. */
function slab(volume: Volume, y: number, half: number, cut: number, paint: (dx: number, dz: number) => number): void {
  for (let dz = -half; dz <= half; dz++) {
    for (let dx = -half; dx <= half; dx++) {
      if (Math.abs(dx) + Math.abs(dz) <= cut) placeVoxel(volume, CENTRE + dx, y, CENTRE + dz, paint(dx, dz))
    }
  }
}

/**
 * A stone lighthouse; details go first because voxels never overwrite earlier ones. A held one hangs its owner's
 * banners from the gallery, whose tails differ by faction (swallowtail or point), so ownership never relies on colour.
 */
function stampLighthouse(volume: Volume, owner?: BeaconOwner): void {
  const look = owner === undefined ? NEUTRAL : OWNERS[owner]
  if (owner !== undefined) {
    const { cloth, hem, tails } = OWNERS[owner]
    for (let along = -1; along <= 1; along++) {
      for (let y = 7; y <= 11; y++) {
        if (y === 7 && !(tails as readonly number[]).includes(along)) continue
        const kind = y === 11 ? hem : cloth
        // The camera sees the +x and +z sides, so the banners hang there.
        placeVoxel(volume, CENTRE + along, y, CENTRE + 3, kind)
        placeVoxel(volume, CENTRE + 3, y, CENTRE + along, kind)
      }
    }
  }
  // The door and windows face the camera, which sees the +x and +z sides.
  placeVoxel(volume, CENTRE, 2, CENTRE + 2, VOXEL.door)
  placeVoxel(volume, CENTRE, 3, CENTRE + 2, VOXEL.door)
  placeVoxel(volume, CENTRE + 2, 7, CENTRE, VOXEL.window)
  placeVoxel(volume, CENTRE, 7, CENTRE + 2, VOXEL.window)
  // Lantern: a glowing core between four corner posts under a verdigris dome.
  for (let y = 13; y <= 15; y++) {
    slab(volume, y, 1, 2, () => y === 14 ? look.core : look.glow)
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
  // Ivory shaft with two bands, terracotta while neutral or in the owner's colour, and sparse weathering.
  for (let y = 2; y <= 11; y++) {
    slab(volume, y, 2, 3, (dx, dz) => y === 5 || y === 9 ? look.band
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

const cached = new Map<BeaconOwner | undefined, BeaconMeshes>()

/** Meshes of a neutral or held lighthouse whose foot is centred on the local origin. */
export function beaconMeshes(owner?: BeaconOwner): BeaconMeshes {
  const known = cached.get(owner)
  if (known) return known
  const volume = createVolume(0, 0, SIZE, SIZE, LAYERS)
  stampLighthouse(volume, owner)
  const corner = [-SIZE / 2 * BEACON_VOXEL, 0, -SIZE / 2 * BEACON_VOXEL] as const
  const part = (glow: boolean): ChunkMesh =>
    meshVolume({ ...volume, data: volume.data.map(kind => GLOW.has(kind) === glow ? kind : 0) }, BEACON_VOXEL, corner)
  const meshes = { body: part(false), light: part(true) }
  cached.set(owner, meshes)
  return meshes
}
