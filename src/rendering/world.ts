import {
  Camera, Color3, Color4, Constants, DirectionalLight, Engine, FreeCamera, HemisphericLight, MaterialPluginBase, Matrix,
  Mesh, MeshBuilder, RawTexture, RenderTargetTexture, Scene, SceneInstrumentation, ShaderLanguage, ShadowGenerator,
  StandardMaterial, Texture, Vector3, VertexData, Viewport,
  type Material, type MaterialDefines, type UniformBuffer,
} from '@babylonjs/core'
import type { Tile, WorldMap } from '../game/map'
import type { Visibility } from '../game/expedition'
import { PALETTE, VOXEL, affectedChunks, createVoxelWorld, meshChunk, pickTile, tileSurface, type VoxelWorld } from './voxels'

export interface ExplorationView {
  readonly fog: Readonly<Record<number, Exclude<Visibility, 'unseen'>>>
  readonly scoutTileId: number
  readonly reachable: readonly number[]
}

export interface RenderStats {
  meshes: number
  materials: number
  geometries: number
  chunks: number
  voxelsPerTile: number
  vertices: number
  quads: number
  vertexBufferBytes: number
  disposedChunks: number
  remeshedChunks: number
  drawCalls: number
  frameMs: number
  webGLVersion: number
  fogUpdates: number
}

interface Chunk { mesh: Mesh; quads: number; bytes: number }

// Key light travel direction: lit from the upper left of the screen, shadows fall to the right.
const SUN = new Vector3(-0.35, -1, 0.55).normalize()
const SHADOW_MAP_SIZE = 1024

/**
 * Per-voxel grain, explored dimming and reachable highlight on top of baked vertex colours and ambient occlusion.
 * Tile state lives in a tiny texture so fog-of-war shading changes never require remeshing.
 */
class VoxelMaterialPlugin extends MaterialPluginBase {
  tileState?: RawTexture
  voxelSize = 1
  mapWidth = 1
  mapHeight = 1
  readonly fogColor = new Color3(PALETTE[VOXEL.fog * 3], PALETTE[VOXEL.fog * 3 + 1], PALETTE[VOXEL.fog * 3 + 2])

  constructor(material: Material) {
    super(material, 'PolarisVoxel', 200, { POLARIS_VOXEL: false }, true, true)
  }

  override getClassName(): string { return 'PolarisVoxelMaterialPlugin' }
  override isCompatible(shaderLanguage: ShaderLanguage): boolean { return shaderLanguage === ShaderLanguage.GLSL }
  override prepareDefines(defines: MaterialDefines): void { defines['POLARIS_VOXEL'] = true }
  override getSamplers(samplers: string[]): void { samplers.push('polarisTileState') }
  override isReadyForSubMesh(): boolean { return this.tileState?.isReady() ?? false }

  override getUniforms() {
    return {
      ubo: [{ name: 'polarisVoxel', size: 4, type: 'vec4' }, { name: 'polarisFog', size: 3, type: 'vec3' }],
      fragment: 'uniform vec4 polarisVoxel;\nuniform vec3 polarisFog;',
    }
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat4('polarisVoxel', this.voxelSize, this.mapWidth, this.mapHeight, 0)
    uniformBuffer.updateColor3('polarisFog', this.fogColor)
    if (this.tileState) uniformBuffer.setTexture('polarisTileState', this.tileState)
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: 'varying float vPolarisFlag;',
        // Vertex alpha is disabled for blending, so the fog flag travels in its own varying.
        CUSTOM_VERTEX_MAIN_END: '#ifdef VERTEXCOLOR\nvPolarisFlag = color.a;\n#else\nvPolarisFlag = 1.0;\n#endif',
      }
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: 'varying float vPolarisFlag;\nuniform sampler2D polarisTileState;',
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `
#ifdef POLARIS_VOXEL
vec3 polarisInside = vPositionW - normalW * 0.5 * polarisVoxel.x;
ivec3 polarisCell = ivec3(floor((polarisInside + vec3(0.5, 0.0, 0.5)) / polarisVoxel.x)) + 8192;
uint polarisHash = uint(polarisCell.x) * 73856093u ^ uint(polarisCell.y) * 19349663u ^ uint(polarisCell.z) * 83492791u;
polarisHash = (polarisHash ^ (polarisHash >> 13u)) * 1274126177u;
baseColor.rgb *= 0.95 + 0.1 * float((polarisHash >> 8u) & 255u) / 255.0;
vec2 polarisTile = clamp(floor(polarisInside.xz + 0.5), vec2(0.0), polarisVoxel.yz - 1.0);
vec4 polarisState = texture2D(polarisTileState, (polarisTile + 0.5) / polarisVoxel.yz);
baseColor.rgb *= mix(1.0, 0.4, polarisState.r);
baseColor.rgb = mix(baseColor.rgb, vec3(0.7255, 0.8667, 0.6314), 0.35 * polarisState.g);
#endif
`,
      // Uncharted fog is flat and unlit so no shading, shadow or occlusion can hint at hidden relief.
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
#ifdef POLARIS_VOXEL
if (vPolarisFlag < 0.5) color = vec4(polarisFog * (normalW.y > 0.5 ? 1.0 : 0.72), 1.0);
#endif
`,
    }
  }
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
  private readonly hover: Mesh
  private readonly selection: Mesh
  private chunks: Chunk[] = []
  private world?: VoxelWorld
  private known = new Uint8Array(0)
  private heights = new Float32Array(0)
  private tileStateData = new Uint8Array(0)
  private tileState?: RawTexture
  private exploration?: ExplorationView
  private scout?: Mesh
  private fogUpdates = 0
  private map?: WorldMap
  private target = Vector3.Zero()
  private halfHeight = 20
  private maxHalfHeight = 100
  private disposedChunks = 0
  private remeshedChunks = 0
  private shadowsStale = true
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
    this.hover = this.makeMarker('hover', '#c5e6df')
    this.selection = this.makeMarker('selection', '#f0c873')
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
    this.engine.runRenderLoop(() => {
      // Casters whose shaders are still compiling would be missing from a one-shot shadow map.
      if (this.shadowsStale && this.scene.isReady()) {
        this.shadowsStale = false
        this.shadows.getShadowMap()!.resetRefreshCounter()
      }
      this.scene.render()
    })
  }

  private listen(name: string, listener: EventListener, options?: AddEventListenerOptions): void {
    this.canvas.addEventListener(name, listener, options)
    this.removeListeners.push(() => this.canvas.removeEventListener(name, listener, options))
  }

  private makeMarker(name: string, color: string): Mesh {
    const mesh = MeshBuilder.CreateBox(name, { width: 1.04, depth: 1.04, height: 0.025 }, this.scene)
    const material = new StandardMaterial(`${name}-material`, this.scene)
    material.emissiveColor = Color3.FromHexString(color)
    material.disableLighting = true
    material.wireframe = true
    mesh.material = material
    mesh.isPickable = false
    // Markers stay legible over hill relief and voxel canopies.
    mesh.renderingGroupId = 1
    mesh.setEnabled(false)
    return mesh
  }

  setMap(map: WorldMap): void {
    this.exploration = undefined
    this.removeScout()
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
    this.map = map
    const world = createVoxelWorld(map)
    this.world = world
    this.known = new Uint8Array(map.tiles.length).fill(1)
    this.heights = Float32Array.from(map.tiles, tile => tileSurface(world, tile, true) * world.size)
    this.tileStateData = new Uint8Array(map.tiles.length * 4)
    this.tileState = new RawTexture(this.tileStateData, map.width, map.height, Constants.TEXTUREFORMAT_RGBA, this.scene,
      false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE)
    this.tileState.name = 'voxel-tile-state'
    this.tileState.wrapU = Texture.CLAMP_ADDRESSMODE
    this.tileState.wrapV = Texture.CLAMP_ADDRESSMODE
    Object.assign(this.voxels, { tileState: this.tileState, voxelSize: world.size, mapWidth: map.width, mapHeight: map.height })
    for (let index = 0; index < world.chunksX * world.chunksZ; index++) this.buildChunk(index)
    const centre = new Vector3((map.width - 1) / 2, 0, (map.height - 1) / 2)
    this.sun.position = centre.subtract(SUN.scale(Math.max(map.width, map.height) * 2))
    this.shadowsStale = true
    this.reset()
  }

  private buildChunk(index: number): void {
    const data = meshChunk(this.world!, this.known, index)
    let chunk = this.chunks[index]
    if (!chunk) {
      const mesh = new Mesh(`voxel-chunk-${index}`, this.scene)
      mesh.material = this.terrain
      mesh.isPickable = false
      mesh.receiveShadows = true
      this.shadows.addShadowCaster(mesh, false)
      chunk = { mesh, quads: 0, bytes: 0 }
      this.chunks[index] = chunk
    }
    const vertexData = new VertexData()
    vertexData.positions = data.positions
    vertexData.normals = data.normals
    vertexData.colors = data.colors
    vertexData.indices = data.indices
    vertexData.applyToMesh(chunk.mesh, false)
    // Colour alpha only flags fog for the shader; chunks stay in the opaque pass.
    chunk.mesh.hasVertexAlpha = false
    chunk.mesh.freezeWorldMatrix()
    chunk.quads = data.quads
    chunk.bytes = data.positions.byteLength + data.normals.byteLength + data.colors.byteLength + data.indices.byteLength
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
        this.heights[id] = tileSurface(world, map.tiles[id]!, known === 1) * world.size
        charted.push(id)
      }
      this.tileStateData[id * 4] = visibility === 'explored' ? 255 : 0
      this.tileStateData[id * 4 + 1] = reachable.has(id) ? 255 : 0
    }
    tileState.update(this.tileStateData)
    const remesh = affectedChunks(world, charted)
    for (const chunk of remesh) this.buildChunk(chunk)
    this.remeshedChunks += remesh.size
    this.fogUpdates += ids.size
    if (view) {
      if (!this.scout) {
        this.scout = MeshBuilder.CreateCylinder('scout', { height: 0.8, diameterTop: 0.2, diameterBottom: 0.5, tessellation: 4 }, this.scene)
        const material = new StandardMaterial('scout-material', this.scene)
        material.diffuseColor = Color3.FromHexString('#f0c873')
        material.emissiveColor = Color3.FromHexString('#856124')
        this.scout.material = material
        this.scout.isPickable = false
        // The own-unit indicator must remain legible above voxel canopies.
        this.scout.renderingGroupId = 1
        this.shadows.addShadowCaster(this.scout, false)
      }
      const tile = map.tiles[view.scoutTileId]!
      this.scout.position.set(tile.x, this.heights[tile.id]! + 0.45, tile.z)
    } else this.removeScout()
    this.shadowsStale = true
    this.showHover()
    if (!previous || !view) this.showSelection()
  }

  private removeScout(): void {
    if (!this.scout) return
    this.shadows.removeShadowCaster(this.scout, false)
    this.scout.dispose(false, true)
    this.scout = undefined
  }

  selectTile(id: number): void {
    this.showSelection(this.exploration && !this.exploration.fog[id] ? undefined : this.map?.tiles[id])
  }

  focusTile(id: number): void {
    const tile = this.map?.tiles[id]
    if (!tile) return
    this.target.set(tile.x, 0, tile.z)
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
    const sum = this.map.width + this.map.height
    this.maxHalfHeight = Math.max(sum / (2 * Math.sqrt(6)) + 3, sum / (2 * Math.sqrt(2) * aspect) + 3)
  }

  reset(): void {
    if (!this.map) return
    this.target.set((this.map.width - 1) / 2, 0, (this.map.height - 1) / 2)
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
    // Babylon's left-handed view has screen-right (-x,+z), screen-down (+x,+z).
    this.target.x += (-dx / Math.sqrt(2) + dy * Math.sqrt(1.5)) * scale
    this.target.z += (dx / Math.sqrt(2) + dy * Math.sqrt(1.5)) * scale
    if (this.map) {
      this.target.x = Math.max(0, Math.min(this.map.width - 1, this.target.x))
      this.target.z = Math.max(0, Math.min(this.map.height - 1, this.target.z))
    }
    this.updateCamera()
    this.showHover()
  }

  private updateCamera(): void {
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight)
    this.camera.position.copyFrom(this.target.add(new Vector3(500, 500, 500)))
    this.camera.setTarget(this.target)
    this.camera.orthoTop = this.halfHeight
    this.camera.orthoBottom = -this.halfHeight
    this.camera.orthoLeft = -this.halfHeight * aspect
    this.camera.orthoRight = this.halfHeight * aspect
    this.camera.getViewMatrix(true)
    this.camera.getProjectionMatrix(true)
  }

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
    const id = pickTile(this.world, this.heights, [ray.origin.x, ray.origin.y, ray.origin.z],
      [ray.direction.x, ray.direction.y, ray.direction.z])
    return id === undefined || (this.exploration && !this.exploration.fog[id]) ? undefined : this.map.tiles[id]
  }

  private placeMarker(marker: Mesh, tile?: Tile): void {
    marker.setEnabled(!!tile)
    if (tile) marker.position.set(tile.x, this.heights[tile.id]! + 0.035, tile.z)
  }

  private showHover(tile?: Tile): void { this.placeMarker(this.hover, tile); this.onHover(tile) }
  private showSelection(tile?: Tile): void { this.placeMarker(this.selection, tile); this.onSelect(tile) }

  stats(): RenderStats {
    return {
      meshes: this.scene.meshes.length, materials: this.scene.materials.length, geometries: this.scene.geometries.length,
      chunks: this.chunks.length, voxelsPerTile: this.world?.scale ?? 0,
      vertices: this.chunks.reduce((sum, chunk) => sum + chunk.mesh.getTotalVertices(), 0),
      quads: this.chunks.reduce((sum, chunk) => sum + chunk.quads, 0),
      vertexBufferBytes: this.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
      disposedChunks: this.disposedChunks, remeshedChunks: this.remeshedChunks,
      drawCalls: this.engine._drawCalls.current,
      frameMs: this.instrumentation.frameTimeCounter.current, webGLVersion: this.engine.webGLVersion,
      fogUpdates: this.fogUpdates,
    }
  }

  // Projection is a read-only diagnostic adapter, also used to verify picking against canonical IDs.
  projectTile(id: number): { x: number; y: number } | undefined {
    const tile = this.map?.tiles[id]
    if (!tile) return
    const projected = Vector3.Project(new Vector3(tile.x, this.heights[id]!, tile.z),
      Matrix.Identity(), this.scene.getTransformMatrix(),
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
    this.scene.dispose()
    this.engine.dispose()
    this.chunks = []
    this.tileState = undefined
    this.world = undefined
  }
}
