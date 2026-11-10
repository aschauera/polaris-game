import {
  Camera, Color3, Color4, Constants, DirectionalLight, Engine, FreeCamera, HemisphericLight, MaterialPluginBase, Matrix,
  Mesh, MultiMaterial, RawTexture, RenderTargetTexture, Scene, SceneInstrumentation, ShaderLanguage, ShadowGenerator,
  StandardMaterial, SubMesh, Texture, Vector3, VertexBuffer, VertexData, Viewport,
  type Material, type MaterialDefines, type UniformBuffer,
} from '@babylonjs/core'
import { HEX_RADIUS, HEX_ROW, hexCenter } from '../game/hex'
import type { Tile, WorldMap } from '../game/map'
import type { Visibility } from '../game/expedition'
import { figureMesh, type FigureKind } from './figures'
import { CAMERA_PITCH as PITCH, CAMERA_YAW as YAW, SCREEN_DOWN as DOWN, SCREEN_RIGHT as RIGHT } from './view'
import {
  PALETTE, VOXEL, affectedChunks, createVoxelWorld, groundHeight, meshChunk, pickTile, siteCode, territoryCode,
  waterLevel,
  type ChunkMesh, type Settlement, type VoxelWorld,
} from './voxels'

export interface SettlementView extends Settlement {
  readonly tileId: number
  readonly name: string
  readonly population: number
  /** Tiles the city claims; their hexes take the owner's tint and a border where the territory ends. */
  readonly claimTileIds: readonly number[]
}

export interface UnitView {
  readonly tileId: number
  readonly kind: FigureKind
  /** Team colour: 0 gold, 1 blue. */
  readonly banner: 0 | 1
  /** Rival units stand on a dashed red ring. */
  readonly rival: boolean
}

export interface ExplorationView {
  readonly fog: Readonly<Record<number, Exclude<Visibility, 'unseen'>>>
  readonly scoutTileId: number
  readonly reachable: readonly number[]
  /** Cities the viewer may see; tiles that are not charted never show one. */
  readonly settlements?: readonly SettlementView[]
  /** Units the viewer may see; defaults to the viewer's gold scout. */
  readonly units?: readonly UnitView[]
}

export interface RenderStats {
  meshes: number
  materials: number
  geometries: number
  chunks: number
  voxelsPerTile: number
  vertices: number
  quads: number
  waterSurfaceQuads: number
  vertexBufferBytes: number
  disposedChunks: number
  remeshedChunks: number
  settlements: number
  drawCalls: number
  frameMs: number
  webGLVersion: number
  fogUpdates: number
}

interface Chunk { mesh: Mesh; quads: number; waterQuads: number; bytes: number }

// Key light travel direction: lit from the upper left of the screen, shadows fall to the right.
const SUN = new Vector3(-0.35, -1, 0.55).normalize()
const SHADOW_MAP_SIZE = 1024
const VIEW = new Vector3(Math.cos(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.sin(YAW) * Math.cos(PITCH))
/** World height above a tile surface where a city's name plate floats, over its keep. */
const PLATE_HEIGHT = 0.95
/** Figures face the camera, turned slightly so two sides of each voxel body show. */
const FIGURE_YAW = Math.PI / 2 - YAW - 0.4

/**
 * Voxel-aligned material tones, hex grid lines, territory tint and borders, explored dimming and reachable highlights on top of
 * baked vertex colours and ambient occlusion. Tile state lives in small textures, so fog-of-war, movement and
 * territory changes never require remeshing.
 */
class VoxelMaterialPlugin extends MaterialPluginBase {
  tileState?: RawTexture
  columns?: RawTexture
  voxelSize = 1
  mapWidth = 1
  mapHeight = 1
  originX = 0
  originZ = 0
  columnsX = 1
  columnsZ = 1
  waterTop = 0
  readonly fogColor = new Color3(PALETTE[VOXEL.fog * 3], PALETTE[VOXEL.fog * 3 + 1], PALETTE[VOXEL.fog * 3 + 2])

  constructor(material: Material, private readonly waterPass = false) {
    // The define separates Babylon's cached terrain and water shader variants.
    super(material, 'PolarisVoxel', 200, { POLARIS_VOXEL: false, POLARIS_WATER_PASS: waterPass }, true, true)
  }

  override getClassName(): string { return 'PolarisVoxelMaterialPlugin' }
  override isCompatible(shaderLanguage: ShaderLanguage): boolean { return shaderLanguage === ShaderLanguage.GLSL }
  override getAttributes(attributes: string[]): void { attributes.push('polarisFaceFlag') }
  override prepareDefines(defines: MaterialDefines): void {
    defines['POLARIS_VOXEL'] = true
    defines['POLARIS_WATER_PASS'] = this.waterPass
  }
  override getSamplers(samplers: string[]): void { samplers.push('polarisTileState', 'polarisColumns') }
  override isReadyForSubMesh(): boolean { return (this.tileState?.isReady() ?? false) && (this.columns?.isReady() ?? false) }

  override getUniforms() {
    return {
      ubo: [{ name: 'polarisVoxel', size: 4, type: 'vec4' }, { name: 'polarisGrid', size: 4, type: 'vec4' },
        { name: 'polarisFog', size: 3, type: 'vec3' }],
      fragment: 'uniform vec4 polarisVoxel;\nuniform vec4 polarisGrid;\nuniform vec3 polarisFog;',
    }
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat4('polarisVoxel', this.voxelSize, this.mapWidth, this.mapHeight, this.waterTop)
    uniformBuffer.updateFloat4('polarisGrid', this.originX, this.originZ, this.columnsX, this.columnsZ)
    uniformBuffer.updateColor3('polarisFog', this.fogColor)
    if (this.tileState) uniformBuffer.setTexture('polarisTileState', this.tileState)
    if (this.columns) uniformBuffer.setTexture('polarisColumns', this.columns)
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: 'attribute float polarisFaceFlag;\nvarying float vPolarisFlag;',
        CUSTOM_VERTEX_MAIN_END: 'vPolarisFlag = polarisFaceFlag;',
      }
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `varying float vPolarisFlag;
uniform sampler2D polarisTileState;
uniform sampler2D polarisColumns;
vec3 polarisFaction(int owner) { return owner == 1 ? vec3(1.0, 0.76, 0.2) : vec3(0.22, 0.52, 1.0); }
int polarisByte(float value) { return int(value * 255.0 + 0.5); }
float polarisGrain(ivec3 cell) {
  uvec3 p = uvec3(cell + 8192);
  uint h = p.x * 73856093u ^ p.y * 19349663u ^ p.z * 83492791u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return float((h >> 8u) & 255u) / 255.0;
}
float polarisPatch(vec2 p) {
  ivec2 cell = ivec2(floor(p));
  vec2 t = fract(p);
  t = t * t * (3.0 - 2.0 * t);
  return mix(mix(polarisGrain(ivec3(cell.x, 97, cell.y)), polarisGrain(ivec3(cell.x + 1, 97, cell.y)), t.x),
    mix(polarisGrain(ivec3(cell.x, 97, cell.y + 1)), polarisGrain(ivec3(cell.x + 1, 97, cell.y + 1)), t.x), t.y);
}
float polarisBand(vec3 nearEdges, vec3 farEdges, vec3 pixelSize, float width) {
  vec3 coverage = clamp((vec3(width) - min(nearEdges, farEdges)) / pixelSize + 0.5, 0.0, 1.0);
  return max(max(coverage.x, coverage.y), coverage.z);
}
`,
      // Tile state per texel: R explored, G reachable, A charted. B holds the territory owner in its low two bits
      // (0 none, 1 gold, 2 blue) and, above them, one bit per hex edge where that territory ends.
      // Tints follow the voxel column's tile; lines follow the true hexagon, so outlines stay smooth over voxel steps.
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `
#ifdef POLARIS_VOXEL
vec2 polarisWidth = fwidth(vPositionW.xz);
float polarisAa = max(max(polarisWidth.x, polarisWidth.y), 1e-4);
// Differentiate continuous world coordinates before branching or rounding to a hex.
vec3 polarisEdgeDx = dFdx(vPositionW.x) * vec3(1.0, 0.5, -0.5) + dFdx(vPositionW.z) * vec3(0.0, 0.8660254, 0.8660254);
vec3 polarisEdgeDy = dFdy(vPositionW.x) * vec3(1.0, 0.5, -0.5) + dFdy(vPositionW.z) * vec3(0.0, 0.8660254, 0.8660254);
vec3 polarisEdgePixel = max(sqrt(polarisEdgeDx * polarisEdgeDx + polarisEdgeDy * polarisEdgeDy), vec3(1e-4));
vec3 polarisInside = vPositionW - normalW * 0.5 * polarisVoxel.x;
ivec2 polarisColumn = ivec2(floor((polarisInside.xz - polarisGrid.xy) / polarisVoxel.x));
ivec3 polarisCell = ivec3(polarisColumn.x, int(floor(polarisInside.y / polarisVoxel.x)), polarisColumn.y);
float polarisNoise = polarisGrain(polarisCell);
float polarisWater = step(1.25, vPolarisFlag);
float polarisSurface = step(1.75, vPolarisFlag);
float polarisLand = step(0.75, vPolarisFlag) * (1.0 - step(1.1, vPolarisFlag));
float polarisWaterOverlay = 0.0;
if (polarisSurface < 0.5) baseColor.rgb *= 0.96 + 0.08 * polarisNoise;
// Constant tones within world-space voxel cells form material patches, not painted depth or moving waves.
if (normalW.y > 0.5 && polarisLand + polarisSurface > 0.5) {
  float polarisCellSize = mix(1.0, 2.0, polarisSurface);
  ivec2 polarisMaterialCell = ivec2(floor(vec2(polarisColumn) / polarisCellSize));
  vec2 polarisSample = vec2(polarisMaterialCell) + 0.5;
  float polarisMaterialGrain = polarisGrain(ivec3(polarisMaterialCell.x, polarisCell.y, polarisMaterialCell.y));
  float polarisTone = clamp(0.5 + 0.85 * (polarisPatch(polarisSample / 3.0) - 0.5)
    + 0.3 * (polarisPatch(polarisSample / 11.0) - 0.5)
    + mix(0.25, 0.55, polarisSurface) * (polarisMaterialGrain - 0.5), 0.0, 0.999);
  polarisTone = floor(polarisTone * 5.0) / 4.0;
  float polarisDetail = 1.0 - smoothstep(0.35, 1.5, polarisAa / (polarisVoxel.x * polarisCellSize));
  vec3 polarisDark = mix(vec3(0.8, 0.85, 0.82), vec3(0.62, 0.65, 0.75), polarisSurface);
  vec3 polarisLight = mix(vec3(1.1, 1.08, 0.98), vec3(1.42, 1.38, 1.29), polarisSurface);
  float polarisContrast = polarisDetail * mix(1.0, 0.35, step(2.125, vPolarisFlag));
  baseColor.rgb *= mix(vec3(1.0), mix(polarisDark, polarisLight, polarisTone), polarisContrast);
}
// Relief still comes from the submerged voxel geometry.
if (polarisWater > 0.5 && polarisSurface < 0.5) {
  float polarisDepth = max(0.0, polarisVoxel.w - vPositionW.y);
  baseColor.rgb = mix(baseColor.rgb, vec3(0.06, 0.42, 0.56), min(0.45, polarisDepth * 0.35));
}
if (vPolarisFlag > 0.25) {
  ivec2 polarisSize = ivec2(polarisVoxel.yz);
  // Each column texel holds the state of the tile owning that voxel column, or zero outside the map.
  vec4 polarisState = texelFetch(polarisColumns, clamp(polarisColumn, ivec2(0), ivec2(polarisGrid.zw) - 1), 0);
  int polarisOwner = polarisByte(polarisState.b) & 3;
  // Tints colour the ground only, so buildings and trees keep their own colours.
  float polarisGround = polarisLand + polarisSurface;
  ${this.waterPass ? 'polarisGround = 0.0;' : ''}
  if (polarisOwner > 0) baseColor.rgb = mix(baseColor.rgb, polarisFaction(polarisOwner), 0.14 * polarisGround);
  baseColor.rgb = mix(baseColor.rgb, vec3(0.66, 0.94, 0.46), 0.3 * polarisState.g * polarisGround);
  if (polarisGround > 0.5 && normalW.y > 0.5) {
    float polarisR = vPositionW.z / 0.8660254;
    vec3 polarisCube = vec3(vPositionW.x - polarisR * 0.5, polarisR, polarisR * 0.5 - vPositionW.x - polarisR);
    vec3 polarisRound = floor(polarisCube + 0.5);
    vec3 polarisDiff = abs(polarisRound - polarisCube);
    if (polarisDiff.x > polarisDiff.y && polarisDiff.x > polarisDiff.z) polarisRound.x = -polarisRound.y - polarisRound.z;
    else if (polarisDiff.y > polarisDiff.z) polarisRound.y = -polarisRound.x - polarisRound.z;
    int polarisHz = int(polarisRound.y);
    int polarisHx = int(polarisRound.x) + (polarisHz - (polarisHz & 1)) / 2;
    vec4 polarisHex = vec4(0.0);
    if (polarisHx >= 0 && polarisHz >= 0 && polarisHx < polarisSize.x && polarisHz < polarisSize.y) {
      polarisHex = texelFetch(polarisTileState, ivec2(polarisHx, polarisHz), 0);
    }
    if (polarisHex.a > 0.5) {
      float polarisCentreX = float(polarisHx) + 0.5 * float(polarisHz & 1);
      vec2 polarisP = vPositionW.xz - vec2(polarisCentreX, float(polarisHz) * 0.8660254);
      int polarisHexState = polarisByte(polarisHex.b);
      int polarisHexOwner = polarisHexState & 3;
      // Distances to the six edges, ordered like the domain's directions: east, south-east, south-west in polarisNear,
      // west, north-west, north-east in polarisFar. Every effect fades with distance, so only the nearest edge counts.
      vec3 polarisQ = polarisP.x * vec3(1.0, 0.5, -0.5) + polarisP.y * vec3(0.0, 0.8660254, 0.8660254);
      vec3 polarisNear = 0.5 - polarisQ;
      vec3 polarisFar = 0.5 + polarisQ;
      // Edges without a border bit are pushed out of reach of every border effect.
      vec3 polarisNearMask = vec3((ivec3(polarisHexState) >> ivec3(2, 3, 4)) & 1);
      vec3 polarisFarMask = vec3((ivec3(polarisHexState) >> ivec3(5, 6, 7)) & 1);
      vec3 polarisNearBorder = polarisNear + (1.0 - polarisNearMask);
      vec3 polarisFarBorder = polarisFar + (1.0 - polarisFarMask);
      float polarisBorderD = min(min(min(polarisNearBorder.x, polarisNearBorder.y), polarisNearBorder.z),
        min(min(polarisFarBorder.x, polarisFarBorder.y), polarisFarBorder.z));
      vec3 polarisHairline = clamp(0.9 - min(polarisNear, polarisFar) / polarisEdgePixel, 0.0, 0.8);
      float polarisLines = max(max(polarisHairline.x, polarisHairline.y), polarisHairline.z);
      polarisLines *= 1.0 - polarisWater;
      // The base grid recedes when zoomed out and over open water, so coasts, borders and outlines lead the eye.
      float polarisGridStrength = mix(0.42, 0.0, polarisWater) * mix(1.0, 0.55, smoothstep(0.02, 0.06, polarisAa));
      float polarisOutline = polarisBand(polarisNear, polarisFar, polarisEdgePixel, 0.012) * polarisHex.g;
      float polarisBorder = polarisBand(polarisNearBorder, polarisFarBorder, polarisEdgePixel, 0.032);
      float polarisEdge = polarisBand(polarisNearBorder, polarisFarBorder, polarisEdgePixel, 0.043);
      float polarisGlow = 1.0 - smoothstep(0.032, 0.12, polarisBorderD);
      polarisWaterOverlay = max(0.03 * polarisLines, max(0.85 * polarisOutline, polarisHexOwner > 0 ? 0.95 * polarisBorder : 0.0));
      baseColor.rgb *= 1.0 - polarisGridStrength * polarisLines;
      if (polarisHexOwner > 0) {
        vec3 polarisTeam = polarisFaction(polarisHexOwner);
        baseColor.rgb = mix(baseColor.rgb, polarisTeam, 0.22 * polarisGlow);
        // A thin dark seam inside the band keeps the border crisp against light grass.
        baseColor.rgb *= 1.0 - 0.3 * (polarisEdge - polarisBorder);
        baseColor.rgb = mix(baseColor.rgb, mix(polarisTeam, vec3(1.0), 0.18), polarisBorder);
      }
      baseColor.rgb = mix(baseColor.rgb, vec3(0.9, 1.0, 0.74), 0.85 * polarisOutline);
    }
  }
  baseColor.rgb *= mix(1.0, 0.58, polarisState.r);
}
#endif
`,
      // Uncharted fog is flat and unlit so no shading, shadow or occlusion can hint at hidden relief.
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
#ifdef POLARIS_VOXEL
if (vPolarisFlag < 0.25) color = vec4(polarisFog * (normalW.y > 0.5 ? 1.0 : 0.72), 1.0);
// Scattered light softens submerged shadows without flattening the actual cube faces.
if (vPolarisFlag > 1.25) color.rgb = mix(color.rgb, baseColor.rgb, 0.28);
if (vPolarisFlag > 1.75) color.a = max(color.a, max(polarisWaterOverlay, 0.5 * step(2.125, vPolarisFlag)));
#endif
`,
    }
  }
}

/** A flat hexagonal ring between two fractions of the corner radius; dashed rings keep alternate fifths of each edge. */
function hexRing(name: string, inner: number, outer: number, dashed: boolean, scene: Scene): Mesh {
  const corner = (k: number, radius: number, t: number) => {
    const a = Math.PI / 6 + k * Math.PI / 3
    const b = a + Math.PI / 3
    return [(Math.cos(a) * (1 - t) + Math.cos(b) * t) * radius * HEX_RADIUS,
      (Math.sin(a) * (1 - t) + Math.sin(b) * t) * radius * HEX_RADIUS] as const
  }
  const positions: number[] = []
  const indices: number[] = []
  const pieces = dashed ? 5 : 1
  for (let k = 0; k < 6; k++) {
    for (let piece = 0; piece < pieces; piece += dashed ? 2 : 1) {
      const quad = [corner(k, outer, piece / pieces), corner(k, outer, (piece + 1) / pieces),
        corner(k, inner, (piece + 1) / pieces), corner(k, inner, piece / pieces)]
      const base = positions.length / 3
      for (const [x, z] of quad) positions.push(x, 0, z)
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
  }
  const mesh = new Mesh(name, scene)
  const data = new VertexData()
  data.positions = positions
  data.indices = indices
  data.normals = positions.map((_, index) => index % 3 === 1 ? 1 : 0)
  data.applyToMesh(mesh, false)
  return mesh
}

export class WorldRenderer {
  private readonly engine: Engine
  private readonly scene: Scene
  private readonly camera: FreeCamera
  private readonly instrumentation: SceneInstrumentation
  private readonly sun: DirectionalLight
  private readonly shadows: ShadowGenerator
  private readonly terrain: StandardMaterial
  private readonly voxels: VoxelMaterialPlugin
  private readonly water: StandardMaterial
  private readonly waterVoxels: VoxelMaterialPlugin
  private readonly terrainAndWater: MultiMaterial
  private readonly hover: Mesh
  private readonly selection: Mesh
  private readonly figureMaterial: StandardMaterial
  private readonly rivalMaterial: StandardMaterial
  private readonly plateLayer: HTMLDivElement
  private chunks: Chunk[] = []
  private world?: VoxelWorld
  private known = new Uint8Array(0)
  private selectedTile?: Tile
  private tileStateData = new Uint8Array(0)
  private columnStateData = new Uint8Array(0)
  private tileState?: RawTexture
  private columns?: RawTexture
  private exploration?: ExplorationView
  private figures: Mesh[] = []
  private plates: { element: HTMLElement; tileId: number }[] = []
  private fogUpdates = 0
  private map?: WorldMap
  private target = Vector3.Zero()
  private halfHeight = 20
  private maxHalfHeight = 100
  private disposedChunks = 0
  private remeshedChunks = 0
  private shadowsStale = true
  private dirty = true
  private pointer?: { id: number; x: number; y: number; lastX: number; lastY: number; dragged: boolean }
  private readonly touches = new Map<number, { x: number; y: number }>()
  private pinchDistance?: number
  private pinched = false
  private readonly resizeObserver: ResizeObserver
  private readonly removeListeners: (() => void)[] = []
  private disposed = false

  constructor(private readonly canvas: HTMLCanvasElement, private readonly onSelect: (tile?: Tile) => void,
    private readonly onHover: (tile?: Tile) => void, onError: (message: string) => void) {
    // No WebGL1 or non-rendering fallback: the prototype requires the stated baseline.
    const context = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true })
    if (!context) throw new Error('WebGL 2 is unavailable. Enable hardware acceleration or use current Chromium/Edge.')
    this.engine = new Engine(context, true, { preserveDrawingBuffer: true, stencil: true })
    if (this.engine.webGLVersion !== 2) {
      this.engine.dispose()
      throw new Error('Polaris requires WebGL 2; this renderer is unsupported.')
    }
    this.scene = new Scene(this.engine)
    this.scene.clearColor = Color4.FromHexString('#1d2329ff')
    this.scene.skipPointerMovePicking = true
    this.scene.skipPointerDownPicking = true
    this.scene.skipPointerUpPicking = true
    const sky = new HemisphericLight('sky-light', new Vector3(0.2, 1, -0.3), this.scene)
    sky.intensity = 0.62
    sky.diffuse = Color3.FromHexString('#e8f1ff')
    sky.groundColor = Color3.FromHexString('#4a4f55')
    this.sun = new DirectionalLight('sun-light', SUN.clone(), this.scene)
    this.sun.intensity = 0.78
    this.sun.diffuse = Color3.FromHexString('#fff4e0')
    this.sun.autoCalcShadowZBounds = true
    // PCF samples the depth texture; a single-channel colour target keeps the map at about 6 MiB.
    this.shadows = new ShadowGenerator(SHADOW_MAP_SIZE, this.sun, false, undefined, true)
    this.shadows.usePercentageCloserFiltering = true
    this.shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM
    this.shadows.bias = 0.0015
    this.shadows.normalBias = 0.01
    this.shadows.darkness = 0.15
    // Terrain only changes on regeneration or exploration, so the shadow map is redrawn on demand.
    this.shadows.getShadowMap()!.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE
    this.camera = new FreeCamera('isometric', Vector3.Zero(), this.scene)
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA
    this.camera.minZ = 0.1
    this.camera.maxZ = 2000
    // Babylon camera inputs are deliberately not attached; only canvas listeners below can move it.
    this.terrain = new StandardMaterial('voxel-terrain', this.scene)
    this.terrain.diffuseColor = Color3.White()
    this.terrain.specularColor = Color3.Black()
    this.voxels = new VoxelMaterialPlugin(this.terrain)
    this.water = new StandardMaterial('water-surface', this.scene)
    this.water.diffuseColor = Color3.White()
    this.water.specularColor = Color3.Black()
    this.water.alpha = 0.4
    this.waterVoxels = new VoxelMaterialPlugin(this.water, true)
    this.terrainAndWater = new MultiMaterial('terrain-and-water', this.scene)
    this.terrainAndWater.subMaterials.push(this.terrain, this.water)
    this.hover = this.makeMarker(hexRing('hover', 0.95, 0.98, false, this.scene), '#eef7ee')
    this.selection = this.makeMarker(hexRing('selection', 0.92, 0.98, false, this.scene), '#f6d55c')
    this.figureMaterial = new StandardMaterial('figure-material', this.scene)
    this.figureMaterial.diffuseColor = Color3.White()
    this.figureMaterial.specularColor = Color3.Black()
    this.figureMaterial.emissiveColor = new Color3(0.1, 0.1, 0.1)
    this.rivalMaterial = this.markerMaterial('rival', '#e0483e')
    this.plateLayer = document.createElement('div')
    this.plateLayer.className = 'city-plates'
    this.plateLayer.setAttribute('aria-hidden', 'true')
    // Plates sit directly above the canvas, beneath the map's heading and camera controls.
    canvas.after(this.plateLayer)
    this.instrumentation = new SceneInstrumentation(this.scene)
    this.instrumentation.captureFrameTime = true
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    this.listen('pointerdown', e => this.pointerDown(e as PointerEvent))
    this.listen('pointermove', e => this.pointerMove(e as PointerEvent))
    this.listen('pointerup', e => this.pointerUp(e as PointerEvent))
    this.listen('pointercancel', e => this.cancelPointer(e as PointerEvent))
    this.listen('lostpointercapture', e => this.cancelPointer(e as PointerEvent))
    this.listen('pointerleave', () => { if (!this.pointer) this.showHover() })
    this.listen('wheel', e => {
      const event = e as WheelEvent
      event.preventDefault()
      this.zoom(Math.exp(Math.sign(event.deltaY) * 0.12))
    }, { passive: false })
    this.listen('keydown', e => {
      const event = e as KeyboardEvent
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
      }
      const move = moves[event.key]
      if (move) { event.preventDefault(); this.pan(move[0] * 40, move[1] * 40) }
      else if (event.key === '+' || event.key === '=') this.zoom(0.85)
      else if (event.key === '-') this.zoom(1.15)
      else if (event.key.toLowerCase() === 'r') this.reset()
    })
    this.listen('webglcontextlost', e => {
      e.preventDefault()
      this.engine.stopRenderLoop()
      onError('Rendering context lost. Reload the page to restore the atlas.')
    })
    this.engine.onResizeObservable.add(() => this.invalidate())
    this.engine.runRenderLoop(() => {
      // The map has no animation, so frames are drawn only after a change; idle turns cost no GPU time.
      if (!this.dirty) return
      const ready = this.scene.isReady()
      // Casters whose shaders are still compiling would be missing from a one-shot shadow map.
      if (this.shadowsStale && ready) {
        this.shadowsStale = false
        this.shadows.getShadowMap()!.resetRefreshCounter()
      }
      this.scene.render()
      // Meshes whose shaders are still compiling were skipped, so drawing continues until the scene is complete.
      this.dirty = !ready
    })
  }

  private listen(name: string, listener: EventListener, options?: AddEventListenerOptions): void {
    this.canvas.addEventListener(name, listener, options)
    this.removeListeners.push(() => this.canvas.removeEventListener(name, listener, options))
  }

  private markerMaterial(name: string, color: string): StandardMaterial {
    const material = new StandardMaterial(`${name}-material`, this.scene)
    material.emissiveColor = Color3.FromHexString(color)
    material.disableLighting = true
    material.backFaceCulling = false
    return material
  }

  private makeMarker(mesh: Mesh, color: string): Mesh {
    mesh.material = this.markerMaterial(mesh.name, color)
    mesh.isPickable = false
    // Markers stay legible over hill relief and voxel canopies.
    mesh.renderingGroupId = 1
    mesh.setEnabled(false)
    return mesh
  }

  setMap(map: WorldMap): void {
    this.exploration = undefined
    this.clearFigures()
    this.clearPlates()
    this.pointer = undefined
    this.touches.clear()
    this.pinched = false
    this.pinchDistance = undefined
    this.showHover()
    this.showSelection()
    for (const chunk of this.chunks) {
      this.shadows.removeShadowCaster(chunk.mesh, false)
      chunk.mesh.dispose()
      if (chunk.mesh.isDisposed()) this.disposedChunks++
    }
    this.chunks = []
    this.tileState?.dispose()
    this.columns?.dispose()
    this.map = map
    const world = createVoxelWorld(map)
    this.world = world
    this.known = new Uint8Array(map.tiles.length).fill(1)
    this.tileStateData = new Uint8Array(map.tiles.length * 4)
    for (let id = 0; id < map.tiles.length; id++) this.tileStateData[id * 4 + 3] = 255
    this.tileState = this.dataTexture('voxel-tile-state', this.tileStateData, map.width, map.height)
    // Each texel copies the state of the tile owning a voxel column, so the shader tints exactly the columns the
    // mesher built with a single lookup.
    this.columnStateData = new Uint8Array(world.columnTile.length * 4)
    this.copyColumnState()
    this.columns = this.dataTexture('voxel-columns', this.columnStateData, world.columnsX, world.columnsZ)
    for (const plugin of [this.voxels, this.waterVoxels]) Object.assign(plugin, {
      tileState: this.tileState, columns: this.columns, voxelSize: world.size, mapWidth: map.width, mapHeight: map.height,
      originX: world.originX, originZ: world.originZ, columnsX: world.columnsX, columnsZ: world.columnsZ,
      waterTop: waterLevel(world.scale) * world.size,
    })
    for (let index = 0; index < world.chunksX * world.chunksZ; index++) this.buildChunk(index)
    const centre = new Vector3((map.width - 0.5) / 2, 0, (map.height - 1) * HEX_ROW / 2)
    this.sun.position = centre.subtract(SUN.scale(Math.max(map.width, map.height) * 2))
    this.shadowsStale = true
    this.invalidate()
    this.reset()
  }

  /** Copies every tile's state texel to the voxel columns it owns; columns outside the map stay zero. */
  private copyColumnState(): void {
    const columnTile = this.world?.columnTile
    if (!columnTile) return
    const tiles = new Uint32Array(this.tileStateData.buffer, this.tileStateData.byteOffset, this.tileStateData.length / 4)
    const columns = new Uint32Array(this.columnStateData.buffer, this.columnStateData.byteOffset, columnTile.length)
    for (let index = 0; index < columnTile.length; index++) {
      const id = columnTile[index]!
      if (id >= 0) columns[index] = tiles[id]!
    }
  }

  private dataTexture(name: string, data: Uint8Array, width: number, height: number): RawTexture {
    const texture = new RawTexture(data, width, height, Constants.TEXTUREFORMAT_RGBA, this.scene,
      false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE)
    texture.name = name
    texture.wrapU = Texture.CLAMP_ADDRESSMODE
    texture.wrapV = Texture.CLAMP_ADDRESSMODE
    return texture
  }

  private buildChunk(index: number): void {
    const data = meshChunk(this.world!, this.known, index)
    let chunk = this.chunks[index]
    if (!chunk) {
      const mesh = new Mesh(`voxel-chunk-${index}`, this.scene)
      mesh.material = this.terrainAndWater
      mesh.isPickable = false
      mesh.receiveShadows = true
      this.shadows.addShadowCaster(mesh, false)
      chunk = { mesh, quads: 0, waterQuads: 0, bytes: 0 }
      this.chunks[index] = chunk
    }
    applyMesh(chunk.mesh, data)
    chunk.mesh.releaseSubMeshes()
    const solidCount = data.indices.length - data.waterIndexCount
    const vertices = data.positions.length / 3
    if (solidCount) new SubMesh(0, 0, vertices, 0, solidCount, chunk.mesh)
    if (data.waterIndexCount) new SubMesh(1, 0, vertices, solidCount, data.waterIndexCount, chunk.mesh)
    chunk.mesh.freezeWorldMatrix()
    chunk.quads = data.quads
    chunk.waterQuads = data.waterIndexCount / 6
    chunk.bytes = data.positions.byteLength + data.normals.byteLength + data.colors.byteLength + data.faceFlags.byteLength
      + data.indices.byteLength
  }

  setExploration(view?: ExplorationView, dirtyTiles?: readonly number[]): void {
    const { map, world, tileState } = this
    if (!map || !world || !tileState) return
    const previous = this.exploration
    this.exploration = view
    const ids = dirtyTiles && previous && view
      ? new Set([...dirtyTiles, ...previous.reachable, ...view.reachable])
      : new Set(map.tiles.map(tile => tile.id))
    const reachable = new Set(view?.reachable)
    const charted: number[] = []
    for (const id of ids) {
      const visibility = view ? view.fog[id] ?? 'unseen' : 'visible'
      const known = visibility === 'unseen' ? 0 : 1
      if (this.known[id] !== known) {
        this.known[id] = known
        charted.push(id)
      }
      this.tileStateData[id * 4] = visibility === 'explored' ? 255 : 0
      this.tileStateData[id * 4 + 1] = reachable.has(id) ? 255 : 0
    }
    // Territory can change anywhere when a city is founded or seen, so ownership is rebuilt for every tile.
    const owners = new Uint8Array(map.tiles.length)
    for (const settlement of view?.settlements ?? []) {
      for (const id of [settlement.tileId, ...settlement.claimTileIds]) {
        if (this.known[id]) owners[id] = settlement.banner + 1
      }
    }
    for (let id = 0; id < map.tiles.length; id++) {
      this.tileStateData[id * 4 + 2] = territoryCode(map, owners, id)
      this.tileStateData[id * 4 + 3] = this.known[id] ? 255 : 0
    }
    tileState.update(this.tileStateData)
    this.copyColumnState()
    this.columns?.update(this.columnStateData)
    const sites = new Map<number, number>()
    for (const settlement of view?.settlements ?? []) sites.set(settlement.tileId, siteCode(settlement))
    const settled: number[] = []
    for (let id = 0; id < world.sites.length; id++) {
      const code = sites.get(id) ?? 0
      if (world.sites[id] === code) continue
      world.sites[id] = code
      settled.push(id)
    }
    const remesh = affectedChunks(world, [...charted, ...settled])
    for (const chunk of remesh) this.buildChunk(chunk)
    this.remeshedChunks += remesh.size
    this.fogUpdates += ids.size
    this.buildFigures(view)
    this.buildPlates(view)
    this.shadowsStale = true
    this.invalidate()
    this.showHover()
    if (!previous || !view || (this.selectedTile && !this.known[this.selectedTile.id])) this.showSelection()
    else this.placeMarker(this.selection, this.selectedTile)
  }

  private buildFigures(view?: ExplorationView): void {
    this.clearFigures()
    const { map, world } = this
    if (!view || !map || !world) return
    const units = view.units ?? [{ tileId: view.scoutTileId, kind: 'scout', banner: 0, rival: false }]
    const stacks = new Map<number, number>()
    for (const unit of units) stacks.set(unit.tileId, (stacks.get(unit.tileId) ?? 0) + 1)
    const placed = new Map<number, number>()
    for (const [index, unit] of units.entries()) {
      if (!this.known[unit.tileId]) continue
      const tile = map.tiles[unit.tileId]!
      const [cx, cz] = hexCenter(tile.x, tile.z)
      // Units sharing a hex stand side by side along screen-right.
      const slot = placed.get(unit.tileId) ?? 0
      placed.set(unit.tileId, slot + 1)
      const shift = (slot - (stacks.get(unit.tileId)! - 1) / 2) * 0.3
      const x = cx + RIGHT[0] * shift
      const z = cz + RIGHT[1] * shift
      // Figures stand on the visible voxel under their feet, including hills and lowered sandbanks.
      const ground = groundHeight(world, this.known, x, z) ?? this.tileHeight(tile)
      const figure = new Mesh(`figure-${unit.kind}-${index}`, this.scene)
      applyMesh(figure, figureMesh(unit.kind, unit.banner))
      figure.material = this.figureMaterial
      figure.position.set(x, ground, z)
      figure.rotation.y = FIGURE_YAW
      figure.isPickable = false
      // Units must remain legible above voxel canopies and settlements.
      figure.renderingGroupId = 1
      this.shadows.addShadowCaster(figure, false)
      this.figures.push(figure)
      if (unit.rival) {
        const ring = hexRing(`rival-${index}`, 0.9, 0.97, true, this.scene)
        ring.material = this.rivalMaterial
        ring.position.set(cx, this.tileHeight(tile) + 0.03, cz)
        ring.isPickable = false
        ring.renderingGroupId = 1
        this.figures.push(ring)
      }
    }
  }

  private clearFigures(): void {
    for (const mesh of this.figures) {
      this.shadows.removeShadowCaster(mesh, false)
      mesh.dispose(false, false)
    }
    this.figures = []
  }

  private buildPlates(view?: ExplorationView): void {
    this.clearPlates()
    for (const settlement of view?.settlements ?? []) {
      if (!this.known[settlement.tileId]) continue
      const element = document.createElement('div')
      element.className = `city-plate ${settlement.banner ? 'blue' : 'gold'}`
      const name = document.createElement('span')
      name.textContent = settlement.name
      const population = document.createElement('span')
      population.className = 'city-plate-population'
      population.textContent = `★${settlement.population}`
      element.append(name, population)
      this.plateLayer.append(element)
      this.plates.push({ element, tileId: settlement.tileId })
    }
    this.placePlates()
  }

  private clearPlates(): void {
    for (const plate of this.plates) plate.element.remove()
    this.plates = []
  }

  private placePlates(): void {
    const { map } = this
    if (!map || !this.plates.length) return
    const transform = this.camera.getViewMatrix().multiply(this.camera.getProjectionMatrix())
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    const viewport = new Viewport(0, 0, width, height)
    for (const { element, tileId } of this.plates) {
      const tile = map.tiles[tileId]!
      const [x, z] = hexCenter(tile.x, tile.z)
      const point = Vector3.Project(new Vector3(x, this.tileHeight(tile) + PLATE_HEIGHT, z), Matrix.Identity(), transform, viewport)
      const visible = point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height
      element.hidden = !visible
      element.style.left = `${this.canvas.offsetLeft + point.x}px`
      element.style.top = `${this.canvas.offsetTop + point.y}px`
    }
  }

  selectTile(id: number): void {
    this.showSelection(this.exploration && !this.exploration.fog[id] ? undefined : this.map?.tiles[id])
  }

  focusTile(id: number): void {
    const tile = this.map?.tiles[id]
    if (!tile) return
    const [x, z] = hexCenter(tile.x, tile.z)
    this.target.set(x, 0, z)
    this.halfHeight = Math.min(7, this.maxHalfHeight)
    this.updateCamera()
  }

  private resize(): void {
    if (this.disposed) return
    this.engine.resize()
    const oldMax = this.maxHalfHeight
    this.fitBounds()
    this.halfHeight = Math.max(3, Math.min(this.maxHalfHeight, this.halfHeight * this.maxHalfHeight / oldMax))
    this.updateCamera()
  }

  private fitBounds(): void {
    if (!this.map) return
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight)
    const xs = [-0.5, this.map.width]
    const zs = [-HEX_RADIUS, (this.map.height - 1) * HEX_ROW + HEX_RADIUS]
    const us: number[] = []
    const vs: number[] = []
    for (const x of xs) {
      for (const z of zs) {
        us.push(x * RIGHT[0] + z * RIGHT[1])
        vs.push((x * DOWN[0] + z * DOWN[1]) * Math.sin(PITCH))
      }
    }
    const width = Math.max(...us) - Math.min(...us)
    const height = Math.max(...vs) - Math.min(...vs)
    this.maxHalfHeight = Math.max(height / 2, width / (2 * aspect)) + 2
  }

  reset(): void {
    if (!this.map) return
    this.target.set((this.map.width - 0.5) / 2, 0, (this.map.height - 1) * HEX_ROW / 2)
    this.fitBounds()
    this.halfHeight = this.maxHalfHeight
    this.updateCamera()
    this.showHover()
  }

  zoom(factor: number): void {
    this.halfHeight = Math.max(3, Math.min(this.maxHalfHeight, this.halfHeight * factor))
    this.updateCamera()
    this.showHover()
  }

  private pan(dx: number, dy: number): void {
    const scale = 2 * this.halfHeight / Math.max(1, this.canvas.clientHeight)
    // Screen-down covers more ground than screen-right because the camera looks down at an angle.
    const down = dy / Math.sin(PITCH)
    this.target.x += (RIGHT[0] * dx + DOWN[0] * down) * scale
    this.target.z += (RIGHT[1] * dx + DOWN[1] * down) * scale
    if (this.map) {
      this.target.x = Math.max(0, Math.min(this.map.width - 0.5, this.target.x))
      this.target.z = Math.max(0, Math.min((this.map.height - 1) * HEX_ROW, this.target.z))
    }
    this.updateCamera()
    this.showHover()
  }

  private updateCamera(): void {
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight)
    this.camera.position.copyFrom(this.target.add(VIEW.scale(800)))
    this.camera.setTarget(this.target)
    this.camera.orthoTop = this.halfHeight
    this.camera.orthoBottom = -this.halfHeight
    this.camera.orthoLeft = -this.halfHeight * aspect
    this.camera.orthoRight = this.halfHeight * aspect
    this.camera.getViewMatrix(true)
    this.camera.getProjectionMatrix(true)
    this.placePlates()
    this.invalidate()
  }

  /** Requests a frame; every change to the scene must call this, because unchanged frames are not redrawn. */
  private invalidate(): void { this.dirty = true }

  private pointerDown(event: PointerEvent): void {
    if (event.button !== 0) return
    this.canvas.focus()
    this.canvas.setPointerCapture(event.pointerId)
    if (event.pointerType === 'touch') {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (this.touches.size >= 2 || this.pinched) {
        this.pinched = true
        this.pointer = undefined
        this.pinchDistance = this.touchDistance()
        return
      }
    }
    this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY,
      lastX: event.clientX, lastY: event.clientY, dragged: false }
  }

  private pointerMove(event: PointerEvent): void {
    if (this.touches.has(event.pointerId)) {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (this.pinched) {
        const distance = this.touchDistance()
        if (distance && this.pinchDistance) this.zoom(this.pinchDistance / distance)
        this.pinchDistance = distance
        return
      }
    }
    const pointer = this.pointer
    if (pointer && pointer.id === event.pointerId) {
      pointer.dragged ||= Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5
      if (pointer.dragged) this.pan(pointer.lastX - event.clientX, pointer.lastY - event.clientY)
      pointer.lastX = event.clientX
      pointer.lastY = event.clientY
    } else this.showHover(this.pick(event.clientX, event.clientY))
  }

  private pointerUp(event: PointerEvent): void {
    this.touches.delete(event.pointerId)
    // A finger lifted from a pinch must neither select a tile nor start a pan with the remaining finger.
    if (this.pinched) {
      this.cancelPointer(event)
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId)
      return
    }
    const pointer = this.pointer
    if (!pointer || pointer.id !== event.pointerId) return
    const moved = Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5
    if (!pointer.dragged && !moved) this.showSelection(this.pick(event.clientX, event.clientY))
    this.pointer = undefined
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId)
  }

  private touchDistance(): number | undefined {
    const [a, b] = [...this.touches.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : undefined
  }

  private cancelPointer(event: PointerEvent): void {
    this.touches.delete(event.pointerId)
    if (this.pointer?.id === event.pointerId) this.pointer = undefined
    this.pinchDistance = this.touchDistance()
    if (!this.touches.size) this.pinched = false
  }

  private pick(clientX: number, clientY: number): Tile | undefined {
    if (!this.map || !this.world) return
    const rect = this.canvas.getBoundingClientRect()
    const x = (clientX - rect.left) * this.engine.getRenderWidth() / rect.width
    const y = (clientY - rect.top) * this.engine.getRenderHeight() / rect.height
    const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), this.camera, false)
    const id = pickTile(this.world, this.known, [ray.origin.x, ray.origin.y, ray.origin.z],
      [ray.direction.x, ray.direction.y, ray.direction.z])
    return id === undefined || (this.exploration && !this.exploration.fog[id]) ? undefined : this.map.tiles[id]
  }

  private placeMarker(marker: Mesh, tile?: Tile): void {
    this.invalidate()
    marker.setEnabled(!!tile)
    if (!tile) return
    const [x, z] = hexCenter(tile.x, tile.z)
    marker.position.set(x, this.tileHeight(tile) + 0.03, z)
  }

  private tileHeight(tile: Tile): number {
    const height = groundHeight(this.world!, this.known, ...hexCenter(tile.x, tile.z))
    if (height === undefined) throw new Error(`Missing terrain height at tile ${tile.id}`)
    return height
  }

  private showHover(tile?: Tile): void { this.placeMarker(this.hover, tile); this.onHover(tile) }
  private showSelection(tile?: Tile): void {
    this.selectedTile = tile
    this.placeMarker(this.selection, tile)
    this.onSelect(tile)
  }

  stats(): RenderStats {
    return {
      meshes: this.scene.meshes.length, materials: this.scene.materials.length, geometries: this.scene.geometries.length,
      chunks: this.chunks.length, voxelsPerTile: this.world?.scale ?? 0,
      vertices: this.chunks.reduce((sum, chunk) => sum + chunk.mesh.getTotalVertices(), 0),
      quads: this.chunks.reduce((sum, chunk) => sum + chunk.quads, 0),
      waterSurfaceQuads: this.chunks.reduce((sum, chunk) => sum + chunk.waterQuads, 0),
      vertexBufferBytes: this.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
      disposedChunks: this.disposedChunks, remeshedChunks: this.remeshedChunks,
      settlements: this.world ? this.world.sites.reduce((sum, code) => sum + (code ? 1 : 0), 0) : 0,
      drawCalls: this.engine._drawCalls.current,
      frameMs: this.instrumentation.frameTimeCounter.current, webGLVersion: this.engine.webGLVersion,
      fogUpdates: this.fogUpdates,
    }
  }

  // Projection is a read-only diagnostic adapter, also used to verify picking against canonical IDs.
  projectTile(id: number): { x: number; y: number } | undefined {
    const tile = this.map?.tiles[id]
    if (!tile) return
    const [x, z] = hexCenter(tile.x, tile.z)
    // Camera matrices are current immediately, unlike the scene transform, which only updates when a frame renders.
    const transform = this.camera.getViewMatrix().multiply(this.camera.getProjectionMatrix())
    const projected = Vector3.Project(new Vector3(x, this.tileHeight(tile), z), Matrix.Identity(), transform,
      new Viewport(0, 0, this.engine.getRenderWidth(), this.engine.getRenderHeight()))
    const rect = this.canvas.getBoundingClientRect()
    return { x: rect.left + projected.x * rect.width / this.engine.getRenderWidth(),
      y: rect.top + projected.y * rect.height / this.engine.getRenderHeight() }
  }

  cameraState(): { mode: number; x: number; z: number; halfHeight: number } {
    return { mode: this.camera.mode, x: this.target.x, z: this.target.z, halfHeight: this.halfHeight }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.resizeObserver.disconnect()
    for (const remove of this.removeListeners) remove()
    this.engine.stopRenderLoop()
    this.instrumentation.dispose()
    this.clearPlates()
    this.plateLayer.remove()
    this.figures = []
    this.scene.dispose()
    this.engine.dispose()
    this.chunks = []
    this.tileState = undefined
    this.columns = undefined
    this.world = undefined
  }
}

function applyMesh(mesh: Mesh, data: ChunkMesh): void {
  const vertexData = new VertexData()
  vertexData.positions = data.positions
  vertexData.normals = data.normals
  vertexData.colors = data.colors
  vertexData.indices = data.indices
  vertexData.applyToMesh(mesh, false)
  mesh.setVerticesBuffer(new VertexBuffer(mesh.getScene().getEngine(), data.faceFlags, 'polarisFaceFlag',
    { size: 1, takeBufferOwnership: true }), true)
  // The custom face flag is separate; the water submesh material alone controls transparency.
  mesh.hasVertexAlpha = false
}
