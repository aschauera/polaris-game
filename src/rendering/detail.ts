import type { WorldMap } from '../game/map'
import { CAMERA_PITCH, SCREEN_DOWN, SCREEN_RIGHT } from './view'
import { CHUNK_COLUMNS, voxelGrid, voxelScale, type VoxelWindow } from './voxels'

/** Covers the viewport at every terrain/decoration height, plus a margin for shadows and panning. */
export function detailWindow(map: WorldMap, x: number, z: number, halfHeight: number, aspect: number,
  previous?: VoxelWindow): VoxelWindow {
  const halfWidth = halfHeight * aspect
  const down = (halfHeight + 3 * Math.cos(CAMERA_PITCH)) / Math.sin(CAMERA_PITCH)
  const ex = Math.abs(SCREEN_RIGHT[0]) * halfWidth + Math.abs(SCREEN_DOWN[0]) * down + 2
  const ez = Math.abs(SCREEN_RIGHT[1]) * halfWidth + Math.abs(SCREEN_DOWN[1]) * down + 2
  const base = voxelScale(map.width, map.height)
  const span = Math.max(2 * ex, 2 * ez)
  let scale = Math.max(base, voxelScale(span, span))
  // Upgrades require spare capacity; small zoom oscillations must not repeatedly rebuild the scene.
  if (previous && scale > previous.scale && span * scale > 460) scale = previous.scale
  const grid = voxelGrid(map, scale)
  if (scale === base) return { scale, offsetX: 0, offsetZ: 0, columnsX: grid.columnsX, columnsZ: grid.columnsZ }
  const minX = Math.max(0, Math.floor((x - ex - grid.originX) * scale))
  const minZ = Math.max(0, Math.floor((z - ez - grid.originZ) * scale))
  const maxX = Math.min(grid.columnsX, Math.ceil((x + ex - grid.originX) * scale))
  const maxZ = Math.min(grid.columnsZ, Math.ceil((z + ez - grid.originZ) * scale))
  if (previous?.scale === scale && minX >= previous.offsetX && minZ >= previous.offsetZ
    && maxX <= previous.offsetX + previous.columnsX && maxZ <= previous.offsetZ + previous.columnsZ) return previous
  const c = CHUNK_COLUMNS
  const offsetX = Math.max(0, (Math.floor(minX / c) - 1) * c)
  const offsetZ = Math.max(0, (Math.floor(minZ / c) - 1) * c)
  return {
    scale, offsetX, offsetZ,
    columnsX: Math.min(grid.columnsX, (Math.ceil(maxX / c) + 1) * c) - offsetX,
    columnsZ: Math.min(grid.columnsZ, (Math.ceil(maxZ / c) + 1) * c) - offsetZ,
  }
}

export function chunkKey(world: VoxelWindow, index: number, columns = CHUNK_COLUMNS): string {
  const chunksX = Math.ceil(world.columnsX / columns)
  const x = index % chunksX * columns, z = Math.floor(index / chunksX) * columns
  return `${world.scale}:${world.offsetX + x}:${world.offsetZ + z}:${Math.min(columns, world.columnsX - x)}:${Math.min(columns, world.columnsZ - z)}`
}
