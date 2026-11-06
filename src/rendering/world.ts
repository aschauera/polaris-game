import {
  AbstractMesh, Camera, Color3, Color4, Engine, FreeCamera, HemisphericLight, Matrix,
  Mesh, MeshBuilder, Scene, SceneInstrumentation, StandardMaterial, Vector3, Viewport,
} from '@babylonjs/core'
import { TERRAIN, type Terrain, type Tile } from '../game/map'
import type { Visibility } from '../game/expedition'

export const CHUNK_SIZE = 16
const COLORS: Record<Terrain, string> = { grassland: '#609b83', water: '#387c9b', hills: '#bdab86' }

interface Batch { mesh: Mesh; ids: number[]; matrices: Float32Array; colors: Float32Array }
interface TreeInstance { mesh: Mesh; index: number; matrix: Matrix; color: Color3 }
export interface RenderMap { readonly width: number; readonly height: number; readonly tiles: readonly Tile[] }
export interface ExplorationView {
  readonly fog: Readonly<Record<number, Exclude<Visibility, 'unseen'>>>
  readonly scoutTileId: number
  readonly reachable: readonly number[]
  readonly opponents?: readonly number[]
}

function surfaceHeight(tile: Tile): number {
  return TERRAIN[tile.terrain].height + (tile.terrain === 'water' ? 0 : (tile.elevation - 1) * 0.24)
}

export interface RenderStats {
  meshes: number
  materials: number
  geometries: number
  batches: number
  instances: number
  instanceBufferBytes: number
  disposedBatches: number
  drawCalls: number
  frameMs: number
  webGLVersion: number
  fogUpdates: number
}

export class WorldRenderer {
  private readonly engine: Engine
  private readonly scene: Scene
  private readonly camera: FreeCamera
  private readonly instrumentation: SceneInstrumentation
  private readonly materials = new Map<Terrain, StandardMaterial>()
  private readonly treeMaterials: StandardMaterial[] = []
  private readonly hover: Mesh
  private readonly selection: Mesh
  private batches: Batch[] = []
  private treeMeshes: Mesh[] = []
  private readonly tileInstances = new Map<number, { batch: Batch; index: number }>()
  private readonly treeInstances = new Map<number, TreeInstance[]>()
  private exploration?: ExplorationView
  private scout?: Mesh
  private opponent?: Mesh
  private fogUpdates = 0
  private batchIds = new Map<AbstractMesh, number[]>()
  private map?: RenderMap
  private target = Vector3.Zero()
  private halfHeight = 20
  private maxHalfHeight = 100
  private disposedBatches = 0
  private bufferBytes = 0
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
    this.scene.clearColor = Color4.FromHexString('#122733ff')
    this.scene.skipPointerMovePicking = true
    this.scene.skipPointerDownPicking = true
    this.scene.skipPointerUpPicking = true
    const light = new HemisphericLight('atlas-light', new Vector3(-0.4, 1, -0.2), this.scene)
    light.intensity = 1.05
    light.groundColor = Color3.FromHexString('#37454d')
    this.camera = new FreeCamera('isometric', Vector3.Zero(), this.scene)
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA
    this.camera.minZ = 0.1
    this.camera.maxZ = 2000
    // Babylon camera inputs are deliberately not attached; only canvas listeners below can move it.
    for (const terrain of Object.keys(TERRAIN) as Terrain[]) {
      const material = new StandardMaterial(terrain, this.scene)
      material.diffuseColor = Color3.White()
      material.specularColor = Color3.Black()
      material.freeze()
      this.materials.set(terrain, material)
    }
    for (let index = 0; index < 2; index++) {
      const material = new StandardMaterial(`tree-${this.treeMaterials.length}`, this.scene)
      material.diffuseColor = Color3.White()
      material.specularColor = Color3.Black()
      material.freeze()
      this.treeMaterials.push(material)
    }
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
    this.engine.runRenderLoop(() => this.scene.render())
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
    mesh.setEnabled(false)
    return mesh
  }

  setMap(map: RenderMap, preserveCamera = false): void {
    this.exploration = undefined
    this.scout?.dispose(false, true)
    this.scout = undefined
    this.opponent?.dispose(false, true)
    this.opponent = undefined
    this.pointer = undefined
    this.touches.clear()
    this.pinched = false
    this.pinchDistance = undefined
    this.showHover()
    this.showSelection()
    for (const batch of this.batches) {
      batch.mesh.dispose()
      if (batch.mesh.isDisposed()) this.disposedBatches++
    }
    for (const mesh of this.treeMeshes) mesh.dispose()
    this.batches = []
    this.treeMeshes = []
    this.batchIds.clear()
    this.tileInstances.clear()
    this.treeInstances.clear()
    this.bufferBytes = 0
    this.map = map
    for (let cz = 0; cz < map.height; cz += CHUNK_SIZE) {
      for (let cx = 0; cx < map.width; cx += CHUNK_SIZE) {
        const groups = new Map<Terrain, Tile[]>()
        for (let z = cz; z < Math.min(cz + CHUNK_SIZE, map.height); z++) {
          for (let x = cx; x < Math.min(cx + CHUNK_SIZE, map.width); x++) {
            const tile = map.tiles[z * map.width + x]!
            const group = groups.get(tile.terrain) ?? []
            group.push(tile)
            groups.set(tile.terrain, group)
          }
        }
        for (const [terrain, tiles] of groups) {
          const name = `chunk-${cx}-${cz}-${terrain}`
          // Thin-instance matrix attributes belong to the geometry: share within a batch, not across batches.
          const mesh = MeshBuilder.CreateBox(name, { size: 1 }, this.scene)
          mesh.material = this.materials.get(terrain)!
          const matrices = new Float32Array(tiles.length * 16)
          const colors = new Float32Array(tiles.length * 4)
          for (const [index, tile] of tiles.entries()) {
            const height = surfaceHeight(tile)
            Matrix.Scaling(0.96, height, 0.96).multiply(Matrix.Translation(tile.x, height / 2, tile.z))
              .copyToArray(matrices, index * 16)
            const color = Color3.FromHexString(COLORS[terrain])
            colors.set([color.r, color.g, color.b, 1], index * 4)
          }
          mesh.thinInstanceSetBuffer('matrix', matrices, 16, false)
          mesh.thinInstanceSetBuffer('color', colors, 4, false)
          mesh.thinInstanceEnablePicking = true
          mesh.freezeWorldMatrix()
          const ids = tiles.map(tile => tile.id)
          this.batchIds.set(mesh, ids)
          const batch = { mesh, ids, matrices, colors }
          this.batches.push(batch)
          ids.forEach((id, index) => this.tileInstances.set(id, { batch, index }))
          this.bufferBytes += matrices.byteLength
        }
      }
    }
    this.addTrees(map)
    if (preserveCamera) { this.fitBounds(); this.updateCamera() }
    else this.reset()
  }

  private addTrees(map: RenderMap): void {
    const trees = map.tiles.flatMap(tile => {
      if (!tile.trees) return []
      const offsets: [number, number][] = tile.trees === 1 ? [[0, 0]]
        : tile.trees === 2 ? [[-0.2, 0], [0.2, 0]]
          : [[-0.2, -0.15], [0.2, -0.15], [0, 0.2]]
      return offsets.map(([x, z]) => ({ tile, x: tile.x + x, z: tile.z + z }))
    })
    const definitions = [
      { name: 'tree-trunks', height: 0.38, width: 0.13, offset: 0.19, material: this.treeMaterials[0]! },
      { name: 'tree-canopies', height: 0.82, width: 0.78, offset: 0.59, material: this.treeMaterials[1]! },
    ]
    for (const definition of definitions) {
      const mesh = MeshBuilder.CreateCylinder(definition.name, {
        height: definition.height, diameterTop: 0.04, diameterBottom: definition.width, tessellation: 5,
      }, this.scene)
      mesh.material = definition.material
      mesh.isPickable = false
      const matrices = new Float32Array(trees.length * 16)
      const colors = new Float32Array(trees.length * 4)
      const color = Color3.FromHexString(definition.name === 'tree-trunks' ? '#725943' : '#315d53')
      for (const [index, tree] of trees.entries()) {
        const height = surfaceHeight(tree.tile) + definition.offset
        const matrix = Matrix.Translation(tree.x, height, tree.z)
        matrix.copyToArray(matrices, index * 16)
        colors.set([color.r, color.g, color.b, 1], index * 4)
        const instances = this.treeInstances.get(tree.tile.id) ?? []
        instances.push({ mesh, index, matrix, color })
        this.treeInstances.set(tree.tile.id, instances)
      }
      mesh.thinInstanceSetBuffer('matrix', matrices, 16, false)
      mesh.thinInstanceSetBuffer('color', colors, 4, false)
      mesh.setEnabled(trees.length > 0)
      mesh.freezeWorldMatrix()
      this.treeMeshes.push(mesh)
    }
  }

  setExploration(view?: ExplorationView, dirtyTiles?: readonly number[]): void {
    if (!this.map) return
    const previous = this.exploration
    this.exploration = view
    const ids = dirtyTiles && previous && view
      ? new Set([...dirtyTiles, ...previous.reachable, ...view.reachable])
      : new Set(this.map.tiles.map(tile => tile.id))
    const reachable = new Set(view?.reachable)
    const changed = new Set<Mesh>()
    for (const id of ids) {
      const tile = this.map.tiles[id]!
      const { batch, index } = this.tileInstances.get(id)!
      const visibility = view ? view.fog[id] ?? 'unseen' : 'visible'
      const height = visibility === 'unseen' ? 0.65 : surfaceHeight(tile)
      const matrix = Matrix.Scaling(0.96, height, 0.96).multiply(Matrix.Translation(tile.x, height / 2, tile.z))
      // Update Babylon's CPU picking cache as well as the affected GPU buffer slice.
      batch.mesh.thinInstanceSetMatrixAt(index, matrix, false)
      batch.mesh.thinInstancePartialBufferUpdate('matrix', batch.matrices.subarray(index * 16, index * 16 + 16), index * 16)
      let color = visibility === 'unseen' ? Color3.FromHexString('#263b4a') : Color3.FromHexString(COLORS[tile.terrain])
      if (visibility === 'explored') color = color.scale(0.4)
      if (reachable.has(id)) color = Color3.Lerp(color, Color3.FromHexString('#b9dda1'), 0.35)
      batch.colors.set([color.r, color.g, color.b, 1], index * 4)
      batch.mesh.thinInstancePartialBufferUpdate('color', batch.colors.subarray(index * 4, index * 4 + 4), index * 4)
      changed.add(batch.mesh)
      for (const tree of this.treeInstances.get(id) ?? []) {
        const transform = visibility === 'unseen' ? Matrix.Scaling(0, 0, 0) : tree.matrix
        tree.mesh.thinInstanceSetMatrixAt(tree.index, transform, false)
        tree.mesh.thinInstancePartialBufferUpdate('matrix', Float32Array.from(transform.asArray()), tree.index * 16)
        const tint = tree.color.scale(visibility === 'explored' ? 0.4 : 1)
        tree.mesh.thinInstancePartialBufferUpdate('color', new Float32Array([tint.r, tint.g, tint.b, 1]), tree.index * 4)
      }
    }
    for (const mesh of changed) mesh.thinInstanceRefreshBoundingInfo()
    this.fogUpdates += ids.size
    if (view) {
      if (!this.scout) {
        this.scout = MeshBuilder.CreateCylinder('scout', { height: 0.8, diameterTop: 0.2, diameterBottom: 0.5, tessellation: 4 }, this.scene)
        const material = new StandardMaterial('scout-material', this.scene)
        material.diffuseColor = Color3.FromHexString('#f0c873')
        material.emissiveColor = Color3.FromHexString('#856124')
        this.scout.material = material
        this.scout.isPickable = false
        // The own-unit indicator must remain legible above decorative trees.
        this.scout.renderingGroupId = 1
      }
      const tile = this.map.tiles[view.scoutTileId]!
      this.scout.position.set(tile.x, surfaceHeight(tile) + 0.45, tile.z)
    } else {
      this.scout?.dispose(false, true)
      this.scout = undefined
    }
    const enemyTile = view?.opponents?.[0]
    if (enemyTile !== undefined) {
      if (!this.opponent) {
        this.opponent = MeshBuilder.CreateCylinder('opponent', { height: 0.8, diameterTop: 0.2, diameterBottom: 0.5, tessellation: 4 }, this.scene)
        const material = new StandardMaterial('opponent-material', this.scene)
        material.diffuseColor = Color3.FromHexString('#95c9f0')
        material.emissiveColor = Color3.FromHexString('#35658a')
        this.opponent.material = material
        this.opponent.isPickable = false
        this.opponent.renderingGroupId = 1
      }
      const tile = this.map.tiles[enemyTile]!
      this.opponent.position.set(tile.x, surfaceHeight(tile) + 0.45, tile.z)
    } else { this.opponent?.dispose(false, true); this.opponent = undefined }
    this.showHover()
    if (!previous || !view) this.showSelection()
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
    const rect = this.canvas.getBoundingClientRect()
    const x = (clientX - rect.left) * this.engine.getRenderWidth() / rect.width
    const y = (clientY - rect.top) * this.engine.getRenderHeight() / rect.height
    const result = this.scene.pick(x, y, mesh => this.batchIds.has(mesh), false, this.camera)
    if (!result?.hit || !result.pickedMesh || result.thinInstanceIndex < 0) return
    const id = this.batchIds.get(result.pickedMesh)?.[result.thinInstanceIndex]
    return id === undefined || (this.exploration && !this.exploration.fog[id]) ? undefined : this.map?.tiles[id]
  }

  private placeMarker(marker: Mesh, tile?: Tile): void {
    marker.setEnabled(!!tile)
    if (tile) marker.position.set(tile.x, surfaceHeight(tile) + 0.035, tile.z)
  }

  private showHover(tile?: Tile): void { this.placeMarker(this.hover, tile); this.onHover(tile) }
  private showSelection(tile?: Tile): void { this.placeMarker(this.selection, tile); this.onSelect(tile) }

  stats(): RenderStats {
    return {
      meshes: this.scene.meshes.length, materials: this.scene.materials.length, geometries: this.scene.geometries.length,
      batches: this.batches.length, instances: this.map?.tiles.length ?? 0,
      instanceBufferBytes: this.bufferBytes, disposedBatches: this.disposedBatches,
      drawCalls: this.engine._drawCalls.current,
      frameMs: this.instrumentation.frameTimeCounter.current, webGLVersion: this.engine.webGLVersion,
      fogUpdates: this.fogUpdates,
    }
  }

  // Projection is a read-only diagnostic adapter, also used to verify picking against canonical IDs.
  projectTile(id: number): { x: number; y: number } | undefined {
    const tile = this.map?.tiles[id]
    if (!tile) return
    const height = this.exploration && !this.exploration.fog[id] ? 0.65 : surfaceHeight(tile)
    const projected = Vector3.Project(new Vector3(tile.x, height, tile.z),
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
    this.batches = []
    this.batchIds.clear()
    this.materials.clear()
    this.treeMaterials.length = 0
    this.treeMeshes = []
    this.tileInstances.clear()
    this.treeInstances.clear()
  }
}
