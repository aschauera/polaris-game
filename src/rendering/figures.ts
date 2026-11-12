import { VOXEL, createVolume, meshVolume, placeVoxel, type ChunkMesh, type Volume } from './voxels'

export type FigureKind = 'scout' | 'founder' | 'guard' | 'worker'

/** Figures use finer voxels than the terrain, so units read as characters standing on a tile. */
export const FIGURE_VOXEL = 1 / 24
const WIDTH = 7
const DEPTH = 5
/** Figures without the star keep their original volume; the scout's pennant, the tallest accessory, ends at layer 15. */
const BODY_HEIGHT = 17
/** The availability star's arms reach this many voxels from its centre along each cube axis. */
const STAR_ARM = 3
/** Centre layer of the availability star, whose lowest arm floats one voxel above the tallest accessory. */
const STAR_CENTRE = 16 + 1 + STAR_ARM
const HEIGHT = STAR_CENTRE + STAR_ARM + 1

interface Team { cloth: number; trim: number }
const TEAMS: readonly Team[] = [
  { cloth: VOXEL.bannerGold, trim: VOXEL.goldDark },
  { cloth: VOXEL.bannerBlue, trim: VOXEL.blueDark },
]

// The volume is a column of 7 x 5 voxels; the figure faces +z and shows its +x side to the camera.
function box(volume: Volume, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, kind: number): void {
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) placeVoxel(volume, x, y, z, kind)
}

/** A blocky character; accessories go first because voxels never overwrite earlier ones. */
function stampFigure(volume: Volume, kind: FigureKind, team: Team): void {
  const { cloth, trim } = team
  // Eyes and accessories.
  box(volume, 2, 2, 10, 10, 3, 3, VOXEL.window)
  box(volume, 4, 4, 10, 10, 3, 3, VOXEL.window)
  if (kind === 'scout') {
    // Hood, short bow and a pennant on the back.
    box(volume, 2, 4, 12, 12, 1, 3, cloth)
    box(volume, 2, 4, 9, 11, 1, 1, cloth)
    box(volume, 6, 6, 5, 9, 2, 2, VOXEL.plank)
    box(volume, 6, 6, 4, 4, 1, 1, VOXEL.plank)
    box(volume, 6, 6, 10, 10, 1, 1, VOXEL.plank)
    box(volume, 1, 1, 4, 15, 0, 0, VOXEL.timber)
    box(volume, 2, 3, 13, 15, 0, 0, cloth)
  } else if (kind === 'founder') {
    // Wide hat, backpack and a walking staff.
    box(volume, 2, 4, 13, 13, 1, 3, VOXEL.thatch)
    box(volume, 1, 5, 12, 12, 0, 4, VOXEL.thatchRidge)
    box(volume, 2, 4, 5, 9, 0, 0, VOXEL.leather)
    box(volume, 6, 6, 0, 12, 3, 3, VOXEL.timber)
  } else if (kind === 'guard') {
    // Helmet with plume, shield on the visible side and a raised sword.
    box(volume, 3, 3, 13, 14, 1, 2, cloth)
    box(volume, 2, 4, 11, 12, 1, 3, VOXEL.steel)
    box(volume, 6, 6, 6, 6, 2, 2, trim)
    box(volume, 6, 6, 4, 8, 1, 3, cloth)
    box(volume, 1, 1, 5, 11, 4, 4, VOXEL.steel)
    box(volume, 2, 4, 5, 8, 3, 3, cloth)
    box(volume, 2, 4, 4, 8, 1, 2, VOXEL.steel)
  } else {
    // Cap and a pickaxe over the shoulder.
    box(volume, 2, 4, 12, 12, 1, 3, cloth)
    box(volume, 2, 4, 12, 12, 4, 4, trim)
    box(volume, 6, 6, 3, 10, 3, 3, VOXEL.timber)
    box(volume, 5, 6, 11, 11, 2, 4, VOXEL.steel)
  }
  // Head, hair, torso with belt, arms and legs.
  box(volume, 2, 4, 9, 11, 1, 3, VOXEL.skin)
  box(volume, 2, 4, 12, 12, 1, 3, VOXEL.hair)
  box(volume, 2, 4, 4, 4, 1, 3, VOXEL.leather)
  box(volume, 2, 4, 5, 8, 1, 3, cloth)
  box(volume, 1, 1, 5, 5, 2, 2, VOXEL.skin)
  box(volume, 5, 5, 5, 5, 2, 2, VOXEL.skin)
  box(volume, 1, 1, 6, 8, 2, 2, trim)
  box(volume, 5, 5, 6, 8, 2, 2, trim)
  box(volume, 2, 2, 0, 1, 1, 2, VOXEL.hair)
  box(volume, 4, 4, 0, 1, 1, 2, VOXEL.hair)
  box(volume, 2, 2, 2, 3, 1, 2, VOXEL.leather)
  box(volume, 4, 4, 2, 3, 1, 2, VOXEL.leather)
}

/**
 * A gold Polaris star above a unit that can still move. Its arms follow the three cube axes, which the isometric
 * camera projects 60 degrees apart, so it reads as an even six-pointed star with a pale heart. Being part of the
 * figure's own voxel mesh, it needs no extra mesh, material or animation.
 */
function stampStar(volume: Volume): void {
  const [cx, cz] = [(WIDTH - 1) / 2, (DEPTH - 1) / 2]
  placeVoxel(volume, cx, STAR_CENTRE, cz, VOXEL.beaconGoldCore)
  for (const [ax, ay, az] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
    for (let step = 1; step <= STAR_ARM; step++) {
      placeVoxel(volume, cx + ax * step, STAR_CENTRE + ay * step, cz + az * step,
        step === 1 ? VOXEL.beaconGoldCore : VOXEL.beaconGold)
    }
  }
}

const cache = new Map<string, ChunkMesh>()

/** Mesh of a figure whose feet are centred on the local origin; available units carry the star above the head. */
export function figureMesh(kind: FigureKind, banner: 0 | 1, available = false): ChunkMesh {
  const key = `${kind}:${banner}:${available}`
  let mesh = cache.get(key)
  if (!mesh) {
    // The star's depth arms reach past the body, so available figures get extra columns in front and behind.
    const pad = available ? Math.max(0, STAR_ARM - (DEPTH - 1) / 2) : 0
    const volume = createVolume(0, -pad, WIDTH, DEPTH + 2 * pad, available ? HEIGHT : BODY_HEIGHT)
    stampFigure(volume, kind, TEAMS[banner]!)
    if (available) stampStar(volume)
    mesh = meshVolume(volume, FIGURE_VOXEL, [-WIDTH / 2 * FIGURE_VOXEL, 0, -(DEPTH / 2 + pad) * FIGURE_VOXEL])
    cache.set(key, mesh)
  }
  return mesh
}
