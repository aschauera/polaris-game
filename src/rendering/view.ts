// Symmetric 30-degree cube edges, calibrated to the approved voxel concept.
export const CAMERA_YAW = Math.PI / 4
export const CAMERA_PITCH = Math.atan(1 / Math.sqrt(2))
export const SCREEN_RIGHT = [-Math.sin(CAMERA_YAW), Math.cos(CAMERA_YAW)] as const
export const SCREEN_DOWN = [Math.cos(CAMERA_YAW), Math.sin(CAMERA_YAW)] as const
