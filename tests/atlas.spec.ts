import { expect, test, type Page } from '@playwright/test'
import { WATER_DEPTH, generateMap, type Tile } from '../src/game/map'
import { applyCommand, createExpedition, movementRange, neighbors } from '../src/game/expedition'
import { HEX_ROW, hexCenter, hexDistance } from '../src/game/hex'
import { createVoxelWorld, centreColumn, groundHeight, pickTile, resourceAt, tileSurface, type VoxelWorld } from '../src/rendering/voxels'
import { RESOURCES } from '../src/rendering/resources'

async function settled(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function stats(page: Page) {
  return page.evaluate(() => window.polarisDiagnostics!.stats())
}

test('water glints animate sparse cap pixels with bounded frames and respect reduced motion', async ({ page }, info) => {
  test.slow()
  await page.goto('/?diagnostics=1')
  const world = createVoxelWorld(generateMap({ seed: 'polaris', width: 32, height: 32 }))
  await inspectSurface(page, flatSurfaceTile(world, 'water'))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect.poll(async () => (await stats(page)).waterGlint).toBeGreaterThan(0)
  const before = await stats(page)
  const change = await page.locator('canvas').evaluate(async canvas => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2')!
    const read = () => {
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      return pixels
    }
    const started = performance.now()
    const initialFrames = window.polarisDiagnostics!.stats().renderedFrames!
    const first = read()
    await new Promise(resolve => setTimeout(resolve, 1100))
    const second = read()
    const elapsedMs = performance.now() - started
    const renderedFrames = window.polarisDiagnostics!.stats().renderedFrames! - initialFrames
    let changed = 0, peakChannelChange = 0
    for (let i = 0; i < first.length; i += 4) {
      const red = Math.abs(first[i]! - second[i]!)
      const green = Math.abs(first[i + 1]! - second[i + 1]!)
      const blue = Math.abs(first[i + 2]! - second[i + 2]!)
      peakChannelChange = Math.max(peakChannelChange, red, green, blue)
      if (red + green + blue > 10) changed++
    }
    return { changed, pixels: first.length / 4, peakChannelChange, elapsedMs, renderedFrames }
  })
  const after = await stats(page)
  await info.attach('water-glint-contrast', { body: JSON.stringify(change), contentType: 'application/json' })
  expect(change.changed).toBeGreaterThan(5)
  expect(change.changed / change.pixels).toBeLessThan(0.04)
  expect(change.peakChannelChange, 'glints should shimmer rather than flash white').toBeLessThanOrEqual(80)
  expect(change.renderedFrames).toBeGreaterThan(0)
  expect(change.renderedFrames).toBeLessThanOrEqual(Math.ceil(change.elapsedMs / 80) + 1)
  expect(after).toMatchObject({ vertices: before.vertices, geometries: before.geometries, meshes: before.meshes,
    materials: before.materials, rngState: before.rngState })
  await page.screenshot({ path: info.outputPath('water-glints.png') })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(async () => (await stats(page)).waterGlint).toBe(0)
  await settled(page)
  const stopped = await stats(page)
  await page.waitForTimeout(300)
  expect((await stats(page)).renderedFrames).toBe(stopped.renderedFrames)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.locator('#fixture').click()
  await expect.poll(async () => (await stats(page)).waterGlint).toBe(0)
})

function flatSurfaceTile(world: VoxelWorld, terrain: Tile['terrain']) {
  const { map } = world
  const tile = map.tiles.filter(tile => tile.terrain === terrain
    && (tile.terrain !== 'water' || tile.waterDepth === 'deep')
    && tile.x > 2 && tile.x < 29 && tile.z > 2 && tile.z < 29
    && map.tiles.every(other => {
      const [x, z] = hexCenter(tile.x, tile.z), [ox, oz] = hexCenter(other.x, other.z)
      return Math.hypot(ox - x, oz - z) > 1.8
        || (other.terrain === terrain && other.elevation === tile.elevation && other.waterDepth === tile.waterDepth
          && other.trees === 0 && !resourceAt(world, other))
    }))
    .sort((a, b) => Math.hypot(a.x - 16, a.z - 16) - Math.hypot(b.x - 16, b.z - 16))[0]
  if (!tile) throw new Error(`No flat, tree-free ${terrain} sample`)
  return tile
}

async function sampleSurface(page: Page, world: VoxelWorld, tile: Tile) {
  const [origin, east, south] = await page.evaluate(ids => ids.map(id => window.polarisDiagnostics!.projectTile(id)),
    [tile.id, tile.id + 1, tile.id + world.map.width])
  expect(origin && east && south).toBeTruthy()
  const dx = { x: east!.x - origin!.x, y: east!.y - origin!.y }
  const rowShift = tile.z % 2 ? -0.5 : 0.5
  const dz = { x: (south!.x - origin!.x - rowShift * dx.x) / HEX_ROW,
    y: (south!.y - origin!.y - rowShift * dx.y) / HEX_ROW }
  const [cx, cz] = hexCenter(tile.x, tile.z)
  const [gx, gz] = centreColumn(world, tile)
  const stride = Math.max(1, world.scale / 8)
  const points: { x: number; y: number }[] = []
  for (let z = -2; z < 3; z++) for (let x = -2; x < 3; x++) {
    for (const fraction of [0.4, 0.6]) {
      const u = world.originX + (gx + x * stride + fraction) * world.size - cx
      const v = world.originZ + (gz + z * stride + fraction) * world.size - cz
      points.push({ x: origin!.x + u * dx.x + v * dz.x, y: origin!.y + u * dx.y + v * dz.y })
    }
  }
  const samples = await page.locator('canvas').evaluate((canvas, points) => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2')!
    const rect = canvas.getBoundingClientRect()
    return points.map(point => {
      const x = Math.floor((point.x - rect.left) * gl.drawingBufferWidth / rect.width)
      const y = gl.drawingBufferHeight - 1 - Math.floor((point.y - rect.top) * gl.drawingBufferHeight / rect.height)
      if (x < 0 || y < 0 || x >= gl.drawingBufferWidth || y >= gl.drawingBufferHeight) throw new Error('Surface sample is off-screen')
      const pixel = new Uint8Array(4)
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
      return [...pixel]
    })
  }, points)
  return { origin: origin!, dx, dz, samples }
}

async function inspectSurface(page: Page, tile: Tile) {
  await page.getByRole('button', { name: 'Reset view' }).click()
  const point = await page.evaluate(id => window.polarisDiagnostics!.projectTile(id)!, tile.id)
  const rect = (await page.locator('canvas').boundingBox())!
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(2 * x - point.x, 2 * y - point.y, { steps: 4 })
  await page.mouse.up()
  for (let zoom = 0; zoom < 8; zoom++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await settled(page)
}

function pickableTile(world: VoxelWorld, tiles: Tile[]): Tile {
  const known = new Uint8Array(world.map.tiles.length).fill(1)
  const tile = tiles.sort((a, b) => Math.hypot(a.x - 16, a.z - 16) - Math.hypot(b.x - 16, b.z - 16)).find(tile => {
    const [x, z] = hexCenter(tile.x, tile.z), y = groundHeight(world, known, x, z)!
    return pickTile(world, known, [x + 4, y + 4, z + 4], [-1, -1, -1]) === tile.id
  })
  if (!tile) throw new Error('No unobstructed tile centre in the visual fixture')
  return tile
}

function waterSelection(tile: Tile): string {
  if (tile.terrain !== 'water') throw new Error('Expected a water fixture')
  return `(${tile.x}, ${tile.z}) · Water · ${WATER_DEPTH[tile.waterDepth].name} · Tile ${tile.id}`
}

async function selectTile(page: Page, width = 32, height = width) {
  const map = generateMap({ seed: 'polaris', width, height })
  const tile = map.tiles.filter(tile => tile.terrain === 'hills')
    .sort((a, b) => Math.hypot(a.x - width / 2, a.z - height / 2) - Math.hypot(b.x - width / 2, b.z - height / 2))[0]!
  await settled(page)
  const point = await page.evaluate(id => window.polarisDiagnostics!.projectTile(id), tile.id)
  expect(point).toBeDefined()
  await page.mouse.move(point!.x, point!.y)
  await expect(page.locator('#hover')).toContainText(`(${tile.x}, ${tile.z}) · Hills`)
  await page.mouse.click(point!.x, point!.y)
  await expect(page.getByRole('status')).toHaveText(`(${tile.x}, ${tile.z}) · Hills · Tile ${tile.id}`)
  return { tile, point: point! }
}

const browserErrors = new WeakMap<Page, string[]>()
test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  browserErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
})

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page), 'Unexpected browser console/page errors').toEqual([])
})

test('renders real terrain, maps picks through camera changes, and isolates HUD input', async ({ page }) => {
  await page.goto('/?diagnostics=1')
  await expect(page.locator('#map-status')).toContainText('1,024 TILES')
  await expect(page.getByRole('alert')).toBeHidden()
  await selectTile(page)
  const initial = await page.evaluate(() => window.polarisDiagnostics!.camera())
  expect(initial?.mode).toBe(1) // Babylon ORTHOGRAPHIC_CAMERA, not perspective.
  const rendering = await stats(page)
  expect(rendering).toMatchObject({ webGLVersion: 2, chunks: 56, voxelsPerTile: 16, meshes: 58, materials: 6, geometries: 58 })
  expect(rendering.waterSurfaceQuads).toBeGreaterThan(0)
  expect(rendering.vertices).toBeLessThan(900_000)
  expect(rendering.drawCalls).toBeGreaterThan(0)
  // Check real framebuffer colors, not just meshes/canvas existence.
  const colors = await page.locator('canvas').evaluate(canvas => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2')!
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    const unique = new Set<string>()
    for (let i = 0; i < pixels.length; i += 4) unique.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`)
    return unique.size
  })
  expect(colors).toBeGreaterThan(10)

  await page.getByLabel('World seed').click()
  await page.keyboard.press('ArrowLeft')
  await page.getByLabel('World seed').hover()
  await page.mouse.wheel(0, 150)
  expect(await page.evaluate(() => window.polarisDiagnostics!.camera())).toEqual(initial)
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await selectTile(page)
  expect((await page.evaluate(() => window.polarisDiagnostics!.camera()))!.halfHeight).toBeLessThan(initial!.halfHeight)
  const beforeDrag = await page.getByRole('status').textContent()
  const canvas = (await page.locator('canvas').boundingBox())!
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
  await page.mouse.down()
  await page.mouse.move(canvas.x + canvas.width / 2 + 60, canvas.y + canvas.height / 2 + 20, { steps: 6 })
  await page.mouse.up()
  expect(await page.getByRole('status').textContent()).toBe(beforeDrag)
  expect(await page.evaluate(() => window.polarisDiagnostics!.camera())).not.toEqual(initial)
  await selectTile(page)
  await page.setViewportSize({ width: 1100, height: 760 })
  await selectTile(page)
  await page.getByRole('button', { name: 'Reset view' }).click()
  await selectTile(page)
  const reset = await page.evaluate(() => window.polarisDiagnostics!.camera())
  // The hex grid's centre: odd rows reach half a tile further east, rows sit sqrt(3)/2 apart.
  expect(reset).toMatchObject({ mode: 1 })
  expect(reset!.x).toBeCloseTo(15.75)
  expect(reset!.z).toBeCloseTo(31 * Math.sqrt(3) / 4)
  await page.locator('canvas').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('+')
  await selectTile(page)
  await page.keyboard.press('r')
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })))
  await selectTile(page)
})

test('renders submerged water detail while picking the unchanged level surface', async ({ page }) => {
  const map = generateMap({ seed: 'polaris', width: 32, height: 32 })
  const world = createVoxelWorld(map)
  const tile = map.tiles.filter(tile => tile.terrain === 'water'
    && tile.x > 2 && tile.x < 29 && tile.z > 2 && tile.z < 29
    && map.tiles.every(other => Math.hypot(other.x - tile.x, other.z - tile.z) > 2.5 || other.terrain === 'water'))
    .sort((a, b) => Math.hypot(a.x - 16, a.z - 16) - Math.hypot(b.x - 16, b.z - 16))[0]!
  expect(tile).toBeDefined()
  await page.goto('/?diagnostics=1')
  await expect(page.locator('#map-status')).toContainText('1,024 TILES')
  await page.locator('canvas').focus()
  for (let zoom = 0; zoom < 5; zoom++) await page.keyboard.press('+')
  await settled(page)
  const { origin, dx, dz, samples } = await sampleSurface(page, world, tile)
  // Measure the actual projected plane: equal axis lengths and symmetric 30-degree cube edges.
  expect(Math.hypot(dx.x, dx.y) / Math.hypot(dz.x, dz.y)).toBeCloseTo(1, 4)
  expect(Math.abs(dx.y / dx.x)).toBeCloseTo(Math.tan(Math.PI / 6), 4)
  expect(Math.abs(dz.y / dz.x)).toBeCloseTo(Math.tan(Math.PI / 6), 4)
  const tones: number[] = []
  let totalRed = 0
  let totalGreen = 0
  for (let i = 0; i < samples.length; i += 2) {
    const first = samples[i]!
    const second = samples[i + 1]!
    expect(first[3]).toBe(255)
    tones.push(first[2]!, second[2]!)
    totalRed += first[0]! + second[0]!
    totalGreen += first[1]! + second[1]!
  }
  expect(Math.max(...tones) - Math.min(...tones)).toBeGreaterThan(3)
  expect(totalGreen).toBeGreaterThan(totalRed)
  await page.mouse.click(origin!.x, origin!.y)
  await expect(page.getByRole('status')).toHaveText(waterSelection(tile))
  expect((await stats(page)).waterSurfaceQuads).toBeGreaterThan(0)
})

test('inspects all canonical water depths, including a submerged shoal beyond two coastal hexes', async ({ page }, testInfo) => {
  test.slow()
  const map = generateMap({ seed: 'polaris', width: 32, height: 32 }), world = createVoxelWorld(map)
  const bank = pickableTile(world, map.tiles.filter(tile => tile.terrain === 'water' && tile.waterDepth === 'shoal'
    && map.tiles.every(other => other.terrain === 'water' || hexDistance(tile.x, tile.z, other.x, other.z) >= 3)))
  await page.goto('/?diagnostics=1')
  await expect(page.locator('#map-status')).toContainText('GENERATOR 05')
  for (const depth of ['shallow', 'shelf', 'deep', 'shoal'] as const) {
    const tile = depth === 'shoal' ? bank : pickableTile(world,
      map.tiles.filter(tile => tile.terrain === 'water' && tile.waterDepth === depth))
    await inspectSurface(page, tile)
    const point = await page.evaluate(id => window.polarisDiagnostics!.projectTile(id)!, tile.id)
    await page.mouse.move(point.x, point.y)
    await expect(page.locator('#hover')).toContainText(`Water · ${WATER_DEPTH[depth].name}`)
    await page.mouse.click(point.x, point.y)
    await expect(page.locator('#selection')).toHaveText(waterSelection(tile))
  }
  await page.screenshot({ path: testInfo.outputPath('canonical-shoal.png') })
  await page.getByRole('button', { name: 'Reset view' }).click()
  const point = await page.evaluate(id => window.polarisDiagnostics!.projectTile(id)!, bank.id)
  await page.mouse.click(point.x, point.y)
  await expect(page.locator('#selection')).toHaveText(waterSelection(bank))
  await page.screenshot({ path: testInfo.outputPath('canonical-bathymetry.png') })
})

test('shows an incised bay as real selectable water, not a painted gap on land', async ({ page }, testInfo) => {
  const map = generateMap({ seed: 'polaris', width: 32, height: 32 }), world = createVoxelWorld(map)
  // The main island's bay head, 2.77 world units inside its convex hull; map tests also verify its ocean connection.
  const tile = pickableTile(world, [map.tiles[27 * map.width + 16]!])
  expect(tile.terrain).toBe('water')
  expect(neighbors(map, tile.id).filter(id => map.tiles[id]!.terrain === 'water').length).toBeGreaterThanOrEqual(4)
  await page.goto('/?diagnostics=1')
  await expect(page.locator('#map-status')).toContainText('GENERATOR 05')
  await inspectSurface(page, tile)
  const point = await page.evaluate(id => window.polarisDiagnostics!.projectTile(id)!, tile.id)
  await page.mouse.click(point.x, point.y)
  await expect(page.locator('#selection')).toHaveText(waterSelection(tile))
  await settled(page)
  const colour = await page.locator('canvas').evaluate((canvas, point) => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2')!, rect = canvas.getBoundingClientRect()
    const pixel = new Uint8Array(4)
    gl.readPixels(Math.floor((point.x - rect.left) * gl.drawingBufferWidth / rect.width),
      gl.drawingBufferHeight - 1 - Math.floor((point.y - rect.top) * gl.drawingBufferHeight / rect.height), 1, 1,
      gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    return [...pixel]
  }, point)
  expect(colour[2]!).toBeGreaterThan(colour[0]! * 1.5)
  expect(colour[1]!).toBeGreaterThan(colour[0]! * 1.5)
  await page.locator('canvas').screenshot({ path: testInfo.outputPath('organic-bay.png') })
})

test('renders low highlands with grey rock clusters instead of repeated grassy pillars', async ({ page }, testInfo) => {
  const map = generateMap({ seed: 'polaris', width: 32, height: 32 }), world = createVoxelWorld(map)
  const tile = pickableTile(world, map.tiles.filter(tile => resourceAt(world, tile) === 'stone'))
  expect(tileSurface(world, tile, true) * world.size).toBeLessThanOrEqual(1)
  await page.goto('/?diagnostics=1')
  await inspectSurface(page, tile)
  const point = await page.evaluate(id => window.polarisDiagnostics!.projectTile(id)!, tile.id)
  await page.mouse.click(point.x, point.y)
  await expect(page.locator('#resource-info')).toContainText('Stone deposit')
  const grey = await page.locator('canvas').evaluate((canvas, point) => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2')!, rect = canvas.getBoundingClientRect()
    const width = 100, height = 90, pixels = new Uint8Array(width * height * 4)
    gl.readPixels(Math.floor((point.x - rect.left) * gl.drawingBufferWidth / rect.width) - width / 2,
      gl.drawingBufferHeight - 1 - Math.floor((point.y - rect.top) * gl.drawingBufferHeight / rect.height),
      width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    let count = 0
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]!, g = pixels[i + 1]!, b = pixels[i + 2]!
      if (r > 65 && Math.abs(r - g) < 16 && r >= b && Math.abs(r - b) < 30) count++
    }
    return count
  }, point)
  expect(grey, 'Real grey geometry in the WebGL framebuffer, not the DOM resource glyph').toBeGreaterThan(250)
  await page.locator('canvas').screenshot({ path: testInfo.outputPath('low-stone-outcrops.png') })
})

test('renders a broad lowered sandbank and picks its original land tile', async ({ page }, testInfo) => {
  const map = generateMap({ seed: 'polaris', width: 32, height: 32 })
  const world = createVoxelWorld(map)
  const known = new Uint8Array(map.tiles.length).fill(1)
  const tile = map.tiles.filter(tile => tile.terrain === 'grassland' && tile.trees === 0
    && groundHeight(world, known, ...hexCenter(tile.x, tile.z)) === 0.375)
    .sort((a, b) => Math.hypot(a.x - 16, a.z - 16) - Math.hypot(b.x - 16, b.z - 16))[0]
  expect(tile, 'A low sandy pocket occupying the centre of an existing land hex').toBeDefined()
  expect(tileSurface(world, tile!, true) * world.size).toBeGreaterThan(0.375)
  await page.goto('/?diagnostics=1')
  await expect(page.locator('#map-status')).toContainText('1,024 TILES')
  await inspectSurface(page, tile!)
  const initial = await stats(page)
  const point = await page.evaluate(id => window.polarisDiagnostics!.projectTile(id)!, tile!.id)
  await page.mouse.click(point.x, point.y)
  await expect(page.getByRole('status')).toHaveText(`(${tile!.x}, ${tile!.z}) · Grassland · Tile ${tile!.id}`)
  await page.mouse.move(20, 20)
  await settled(page)
  const sandPixels = await page.locator('canvas').evaluate((canvas, point) => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2')!
    const rect = canvas.getBoundingClientRect()
    let sand = 0
    for (let dy = -6; dy <= 6; dy += 3) for (let dx = -6; dx <= 6; dx += 3) {
      const pixel = new Uint8Array(4)
      gl.readPixels(Math.floor((point.x - rect.left + dx) * gl.drawingBufferWidth / rect.width),
        gl.drawingBufferHeight - 1 - Math.floor((point.y - rect.top + dy) * gl.drawingBufferHeight / rect.height),
        1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
      const r = pixel[0]!, g = pixel[1]!, b = pixel[2]!, a = pixel[3]!
      if (r >= g * 0.96 && r > b * 1.3 && g > 160 && b > 115 && a === 255) sand++
    }
    return sand
  }, point)
  expect(sandPixels, 'Actual pale sand covers an area around the lowered centre, not just a border').toBeGreaterThanOrEqual(20)
  expect(await stats(page)).toMatchObject({ vertices: initial.vertices, remeshedChunks: initial.remeshedChunks, rngState: initial.rngState })
  await page.locator('canvas').screenshot({ path: testInfo.outputPath('sandbank-selection.png') })
})

test('emerged coastal rocks are opaque above the cap and still select their water hex', async ({ page }, testInfo) => {
  const map = generateMap({ seed: 'polaris', width: 32, height: 32 })
  const world = createVoxelWorld(map), known = new Uint8Array(map.tiles.length).fill(1)
  const tile = pickableTile(world, map.tiles.filter(tile => tile.terrain === 'water'
    && groundHeight(world, known, ...hexCenter(tile.x, tile.z))! > tileSurface(world, tile, true) * world.size))
  await page.goto('/?diagnostics=1')
  await expect(page.locator('#map-status')).toContainText('1,024 TILES')
  await inspectSurface(page, tile)
  const point = await page.evaluate(id => window.polarisDiagnostics!.projectTile(id)!, tile.id)
  const rockPixels = await page.locator('canvas').evaluate((canvas, point) => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2')!, rect = canvas.getBoundingClientRect()
    const pixels = new Uint8Array(17 * 17 * 4)
    gl.readPixels(Math.floor((point.x - rect.left) * gl.drawingBufferWidth / rect.width) - 8,
      gl.drawingBufferHeight - 1 - Math.floor((point.y - rect.top) * gl.drawingBufferHeight / rect.height) - 8,
      17, 17, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    let grey = 0
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]!, g = pixels[i + 1]!, b = pixels[i + 2]!
      if (r > 70 && Math.abs(r - g) < 15 && r > b * 1.03 && Math.abs(r - b) < 35) grey++
    }
    return grey
  }, point)
  expect(rockPixels, 'An actual grey rock, not just blue underwater relief').toBeGreaterThan(20)
  await page.mouse.click(point.x, point.y)
  await expect(page.locator('#selection')).toHaveText(waterSelection(tile))
  await expect(page.locator('#resource-info')).toBeHidden()
  await page.locator('canvas').screenshot({ path: testInfo.outputPath('coastal-rock-selection.png') })
})

test('resource markers and inspection share real occurrences, follow the world and release their nodes', async ({ page }, testInfo) => {
  const map = generateMap({ seed: 'polaris', width: 32, height: 32 }), world = createVoxelWorld(map)
  await page.goto('/?diagnostics=1')
  await expect(page.locator('#map-status')).toContainText('1,024 TILES')
  const initial = await stats(page)
  await expect(page.locator('.resource-marker')).toHaveCount(0)
  for (const kind of ['apples', 'stone', 'fish'] as const) {
    const tile = pickableTile(world, map.tiles.filter(tile => resourceAt(world, tile) === kind))
    await inspectSurface(page, tile)
    const marker = page.locator(`.resource-marker[data-tile-id="${tile.id}"]`)
    await expect(marker).toBeVisible()
    await expect(marker).toHaveAttribute('data-resource', kind)
    await expect(marker.locator('svg')).toHaveCount(1)
    const before = (await marker.boundingBox())!
    const point = await page.evaluate(id => window.polarisDiagnostics!.projectTile(id)!, tile.id)
    expect(Math.abs(before.x + before.width / 2 - point.x)).toBeLessThan(1)
    expect(point.y - before.y - before.height).toBeGreaterThan(8)
    await page.mouse.move(point.x, point.y)
    await expect(page.locator('#hover')).toContainText(RESOURCES[kind].name)
    await page.mouse.click(point.x, point.y)
    await expect(page.locator('#selection')).toContainText(`Tile ${tile.id}`)
    await expect(page.locator('#resource-info')).toHaveText(`${RESOURCES[kind].name} · Visual occurrence; harvesting is not available yet.`)
    await page.locator('canvas').focus()
    await page.keyboard.press('ArrowRight')
    await settled(page)
    const moved = (await marker.boundingBox())!
    const shifted = await page.evaluate(id => window.polarisDiagnostics!.projectTile(id)!, tile.id)
    expect(Math.abs(moved.x - before.x - (shifted.x - point.x))).toBeLessThan(1)
    expect(Math.abs(moved.y - before.y - (shifted.y - point.y))).toBeLessThan(1)
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await settled(page)
    const zoomed = (await marker.boundingBox())!
    const zoomPoint = await page.evaluate(id => window.polarisDiagnostics!.projectTile(id)!, tile.id)
    expect(Math.abs(zoomed.x + zoomed.width / 2 - zoomPoint.x)).toBeLessThan(1)
    expect((zoomPoint.y - zoomed.y - zoomed.height) / (shifted.y - moved.y - moved.height)).toBeCloseTo(1 / 0.85, 1)
    const count = await page.locator('.resource-marker').count()
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThanOrEqual(128)
    expect(await stats(page)).toMatchObject({ resourceMarkers: count, meshes: initial.meshes, geometries: initial.geometries,
      materials: initial.materials, rngState: initial.rngState, vertices: initial.vertices, remeshedChunks: initial.remeshedChunks })
    await page.mouse.move(20, 20)
    await page.locator('canvas').screenshot({ path: testInfo.outputPath(`resource-${kind}.png`) })
  }
  const oldMarker = await page.locator('.resource-marker').first().elementHandle()
  await page.getByRole('button', { name: 'Regenerate atlas' }).click()
  await expect(page.locator('.resource-marker')).toHaveCount(0)
  expect(await oldMarker!.evaluate(element => element.isConnected)).toBe(false)
  await oldMarker!.dispose()
  await expect(page.locator('#resource-info')).toBeHidden()
  expect(await stats(page)).toMatchObject({ resourceMarkers: 0, meshes: initial.meshes, geometries: initial.geometries,
    materials: initial.materials, rngState: initial.rngState, vertices: initial.vertices })
})

test.describe('wide-view resource budget', () => {
  // A wide CSS viewport stresses annotation count without a needlessly large framebuffer.
  test.use({ viewport: { width: 3200, height: 1800 }, deviceScaleFactor: 0.5 })
  test('caps a dense large-map view at 128 markers and clears them in the overview', async ({ page }) => {
    const map = generateMap({ seed: 'polaris', width: 256, height: 256 })
    const tile = map.tiles.filter(tile => tile.terrain === 'hills')
      .sort((a, b) => Math.hypot(a.x - 128, a.z - 128) - Math.hypot(b.x - 128, b.z - 128))[0]!
    await page.goto('/?diagnostics=1&width=256&height=256')
    await expect(page.locator('#map-status')).toContainText('65,536 TILES')
    const initial = await stats(page)
    await inspectSurface(page, tile)
    const markers = page.locator('.resource-marker')
    for (let zoom = 0; zoom < 16 && await markers.count() === 0; zoom++) {
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    }
    await expect(markers).toHaveCount(128)
    const first = await markers.evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.tileId))
    await page.locator('canvas').focus()
    await page.keyboard.press('ArrowRight')
    await settled(page)
    await expect(markers).toHaveCount(128)
    const shifted = await markers.evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.tileId))
    expect(shifted).not.toEqual(first)
    const detail = await stats(page)
    expect(detail).toMatchObject({ resourceMarkers: 128, materials: initial.materials, rngState: initial.rngState })
    expect(detail.voxelsPerTile).toBeGreaterThan(initial.voxelsPerTile!)
    expect(detail.chunks).toBeLessThanOrEqual(144)
    expect(detail.meshes).toBe(detail.chunks! + 2)
    expect(detail.geometries).toBe(detail.meshes)
    await page.getByRole('button', { name: 'Reset view' }).click()
    await expect(markers).toHaveCount(0)
    expect((await stats(page)).resourceMarkers).toBe(0)
  })

})

test.describe('adaptive terrain detail', () => {
  for (const size of [64, 128, 256]) test(`keeps fog, figures and cities aligned while detailing a ${size}-square expedition`, async ({ page }) => {
    test.slow()
    await page.goto(`/?diagnostics=1&width=${size}&height=${size}`)
    await expect(page.locator('#map-status')).toContainText((size * size).toLocaleString('en-US'))
    await page.getByRole('button', { name: 'Start expedition' }).click()
    await page.getByRole('button', { name: 'Select scout', exact: true }).click()
    for (let zoom = 0; zoom < 6; zoom++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await settled(page)
    expect((await stats(page)).voxelsPerTile).toBe(16)
    const state = (await page.evaluate(() => window.polarisDiagnostics!.expedition()))!
    const point = await page.evaluate(id => window.polarisDiagnostics!.projectTile(id)!, state.scoutTileId)
    await page.mouse.click(point.x, point.y)
    await expect(page.locator('#selection')).toContainText(`Tile ${state.scoutTileId}`)
    const markers = await page.locator('.resource-marker').evaluateAll(elements => elements.map(element => Number((element as HTMLElement).dataset.tileId)))
    for (const id of markers) expect(state.fog[id]).toBeTruthy()
    await page.getByRole('button', { name: /^Found city at/ }).click()
    expect((await stats(page)).settlements).toBe(1)
    await expect(page.locator('.city-plate')).toBeVisible()
    await page.getByRole('button', { name: 'Reset view' }).click()
    await page.getByRole('button', { name: 'Select scout', exact: true }).click()
    expect((await stats(page)).settlements).toBe(1)
    await expect(page.locator('.city-plate')).toBeVisible()
    const after = (await page.evaluate(() => window.polarisDiagnostics!.expedition()))!
    expect(after.cities).toHaveLength(1)
    expect(after.commandCount).toBe(state.commandCount + 1)
  })

  test('streams full detail on a 256-square map and releases it after pan, reset and regeneration', async ({ page }) => {
    test.slow()
    await page.goto('/?diagnostics=1&width=256&height=256')
    await expect(page.locator('#map-status')).toContainText('65,536 TILES')
    const initial = await stats(page)
    const map = generateMap({ seed: 'polaris', width: 256, height: 256 })
    const tile = map.tiles.filter(tile => tile.terrain === 'hills')
      .sort((a, b) => Math.hypot(a.x - 128, a.z - 128) - Math.hypot(b.x - 128, b.z - 128))[0]!
    await inspectSurface(page, tile)
    const scales = new Set<number>([initial.voxelsPerTile!])
    for (let zoom = 0; zoom < 30; zoom++) {
      const current = await stats(page)
      scales.add(current.voxelsPerTile!)
      if ((await page.evaluate(() => window.polarisDiagnostics!.camera()!.halfHeight)) <= 3) break
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    }
    await settled(page)
    expect([...scales]).toEqual(expect.arrayContaining([2, 4, 8, 16]))
    const close = await stats(page)
    expect(close.voxelsPerTile).toBe(16)
    expect(close.residentColumns).toBeLessThan(602_176)
    expect(close.vertices).toBeLessThan(2_000_000)
    expect(close.rngState).toBe(initial.rngState)
    await page.locator('canvas').screenshot({ path: 'test-results/adaptive-256-close.png' })
    await page.locator('canvas').focus()
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
      await page.locator('canvas').evaluate((canvas, key) => {
        for (let step = 0; step < 30; step++) canvas.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      }, key)
      await settled(page)
      const moved = await stats(page)
      expect(moved.voxelsPerTile).toBe(16)
      expect(moved.chunks).toBeLessThanOrEqual(144)
      expect(moved.meshes).toBe(moved.chunks! + 2)
      expect(moved.geometries).toBe(moved.meshes)
      expect(moved.materials).toBe(initial.materials)
    }
    const point = await page.evaluate(id => window.polarisDiagnostics!.projectTile(id)!, tile.id)
    await page.mouse.click(point.x, point.y)
    await expect(page.getByRole('status')).toContainText(`Tile ${tile.id}`)
    const streamed = await stats(page)
    expect(streamed.streamedChunks).toBeGreaterThan(close.streamedChunks!)
    await page.getByRole('button', { name: 'Reset view' }).click()
    await settled(page)
    const reset = await stats(page)
    expect(reset).toMatchObject({ voxelsPerTile: 2, chunks: initial.chunks, meshes: initial.meshes,
      geometries: initial.geometries, vertices: initial.vertices, residentColumns: initial.residentColumns })
    await page.locator('canvas').screenshot({ path: 'test-results/adaptive-256-overview.png' })
    await page.getByRole('button', { name: '32² showcase' }).click()
    await expect(page.locator('#map-status')).toContainText('1,024 TILES')
    expect(await stats(page)).toMatchObject({ voxelsPerTile: 16, meshes: 58, geometries: 58, materials: 6 })
  })
})

test('resource annotations respect uncharted and remembered fog and disappear when a city is founded', async ({ page }) => {
  const map = generateMap({ seed: 'resources-47', width: 32, height: 32 }), world = createVoxelWorld(map)
  let state = createExpedition(map)
  const founder = map.tiles[state.founders[0]!.tileId]!
  expect(resourceAt(world, founder)).toBe('apples')
  await page.goto('/?diagnostics=1&seed=resources-47')
  await page.getByRole('button', { name: 'Start expedition' }).click()
  await inspectSurface(page, founder)
  const marker = page.locator(`.resource-marker[data-tile-id="${founder.id}"]`)
  await expect(marker).toBeVisible()
  await expect(marker).toHaveCSS('opacity', '1')
  for (let turn = 0; turn < 2; turn++) {
    if (turn) {
      await page.getByRole('button', { name: 'End turn', exact: true }).click()
      const ended = applyCommand(state, { type: 'end-turn', factionId: state.activeFaction, sequence: state.commands.length + 1 })
      expect(ended.ok).toBe(true)
      state = ended.state
    }
    const scout = state.scouts[0]!
    const [to] = [...movementRange(state, scout.id)].filter(([id]) => id !== scout.tileId)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]!
    await page.getByRole('button', { name: 'Reset view' }).click()
    await page.getByRole('button', { name: 'Select scout', exact: true }).click()
    const point = await page.evaluate(id => window.polarisDiagnostics!.projectTile(id)!, to)
    await page.mouse.click(point.x, point.y)
    await expect(page.locator('#selection')).toContainText(`Tile ${to}`)
    const moved = applyCommand(state, { type: 'move', unitId: scout.id, factionId: state.activeFaction,
      sequence: state.commands.length + 1, to })
    expect(moved.ok).toBe(true)
    state = moved.state
    expect((await page.evaluate(() => window.polarisDiagnostics!.expedition()))!.scoutTileId).toBe(to)
  }
  expect(state.factions[0]!.fog[founder.id]).toBe('visible')
  const remembered = map.tiles.find(tile => resourceAt(world, tile) && state.factions[0]!.fog[tile.id] === 'explored')
  expect(remembered, 'A resource outside all current unit sight must remain dimmed').toBeDefined()
  await inspectSurface(page, remembered!)
  await expect(page.locator(`.resource-marker[data-tile-id="${remembered!.id}"]`)).toHaveCSS('opacity', '0.58')
  await inspectSurface(page, founder)
  await expect(marker).toHaveCSS('opacity', '1')
  const point = await page.evaluate(id => window.polarisDiagnostics!.projectTile(id)!, founder.id)
  await page.mouse.click(point.x, point.y)
  await expect(page.locator('#selection')).toContainText(`Tile ${founder.id}`)
  await expect(page.locator('#resource-info')).toContainText('Apple grove')
  await page.getByRole('button', { name: /^Found city at/ }).click()
  await expect(page.locator('#selection')).toContainText(`Tile ${founder.id}`)
  const city = await page.evaluate(id => window.polarisDiagnostics!.projectTile(id)!, founder.id)
  await page.mouse.click(city.x, city.y)
  await expect(page.locator('#selection')).toContainText(`Tile ${founder.id}`)
  await expect(page.locator('#resource-info')).toBeHidden()
  await expect(marker).toHaveCount(0)
  const founded = applyCommand(state, { type: 'found-city', founderId: state.founders[0]!.id,
    factionId: state.activeFaction, sequence: state.commands.length + 1 })
  expect(founded.ok).toBe(true)
  const actual = await page.evaluate(() => window.polarisDiagnostics!.expedition())
  expect(actual!.cities).toEqual(founded.state.cities)

  const hidden = map.tiles.find(tile => resourceAt(world, tile) && !founded.state.factions[0]!.fog[tile.id])!
  expect(hidden).toBeDefined()
  await inspectSurface(page, hidden)
  const hiddenMarker = page.locator(`.resource-marker[data-tile-id="${hidden.id}"]`)
  await expect(hiddenMarker).toHaveCount(0)
  const concealed = await page.evaluate(id => window.polarisDiagnostics!.projectTile(id)!, hidden.id)
  await page.mouse.click(concealed.x, concealed.y)
  await expect(page.locator('#selection')).toHaveText('No tile selected')
  await expect(page.locator('#resource-info')).toBeHidden()
  const ids = await page.locator('.resource-marker').evaluateAll(elements => elements.map(element => Number((element as HTMLElement).dataset.tileId)))
  for (const id of ids) expect(founded.state.factions[0]!.fog[id]).toBeTruthy()
  await page.getByRole('button', { name: 'Return to atlas (discard expedition)', exact: true }).click()
  await inspectSurface(page, hidden)
  await expect(hiddenMarker).toBeVisible()
})

for (const terrain of ['water', 'grassland'] as const) {
  test(`${terrain} shows voxel-sized material shades anchored to the world`, async ({ page }, testInfo) => {
    const map = generateMap({ seed: 'polaris', width: 32, height: 32 })
    const world = createVoxelWorld(map)
    await page.goto('/?diagnostics=1')
    await expect(page.locator('#map-status')).toContainText('1,024 TILES')
    const initial = await stats(page)
    const tile = flatSurfaceTile(world, terrain)
    await inspectSurface(page, tile)
    const { samples } = await sampleSurface(page, world, tile)
    const target = terrain === 'water' ? [11, 117, 170] : [151, 171, 60]
    for (const channel of [0, 1, 2]) {
      const sorted = samples.filter((_, i) => i % 2 === 0).map(pixel => pixel[channel]!).sort((a, b) => a - b)
      expect(Math.abs(sorted[Math.floor(sorted.length / 2)]! - target[channel]!),
        `${terrain} rendered RGB channel ${channel} matches the concept median`).toBeLessThanOrEqual(8)
    }
    const green = samples.filter((_, i) => i % 2 === 0).map(pixel => pixel[1]!)
    expect(Math.max(...green) - Math.min(...green), `${terrain} tonal range`).toBeGreaterThan(18)
    expect(new Set(green.map(value => Math.round(value / 4))).size, `${terrain} tone bands`).toBeGreaterThanOrEqual(4)
    if (terrain === 'grassland') {
      // Isolated tufts/stones must not stand in for variation across the ground itself.
      const sorted = [...green].sort((a, b) => a - b)
      const middleRange = sorted[Math.floor(sorted.length * 0.75)]! - sorted[Math.floor(sorted.length * 0.25)]!
      expect(middleRange, 'Grass shading spans the surface, not just a few outliers').toBeGreaterThan(12)
    }
    let withinCell = 0
    for (let i = 0; i < samples.length; i += 2) {
      withinCell += Math.abs(samples[i]![1]! - samples[i + 1]![1]!)
      expect(samples[i]![3]).toBe(255)
    }
    expect(withinCell / (samples.length / 2), `${terrain} is flat inside each voxel`).toBeLessThan(3)
    await page.locator('canvas').screenshot({ path: testInfo.outputPath(`surface-${terrain}.png`) })

    await page.locator('canvas').focus()
    await page.keyboard.press('ArrowRight')
    await settled(page)
    const shifted = await sampleSurface(page, world, tile)
    const differences = samples.map((pixel, i) => Math.abs(pixel[1]! - shifted.samples[i]![1]!))
    expect(Math.max(...differences), `${terrain} shades must move with the world, not the screen`).toBeLessThanOrEqual(3)
    expect(await stats(page)).toMatchObject({
      vertices: initial.vertices, vertexBufferBytes: initial.vertexBufferBytes, remeshedChunks: initial.remeshedChunks,
    })
  })
}

for (const terrain of ['grassland', 'water'] as const) {
  test(`${terrain} hex grid stays a sharp hairline in every edge direction at different zoom levels`, async ({ page }) => {
    const map = generateMap({ seed: 'polaris', width: 32, height: 32 })
    const world = createVoxelWorld(map)
    const tile = flatSurfaceTile(world, terrain)
    await page.goto('/?diagnostics=1')
    await expect(page.locator('#map-status')).toContainText('1,024 TILES')
    await inspectSurface(page, tile)
    const widths: number[] = []
    for (let zoom = 0; zoom < 2; zoom++) {
      const { origin, dx, dz } = await sampleSurface(page, world, tile)
      const profiles = await page.locator('canvas').evaluate((canvas, { origin, dx, dz }) => {
        const gl = (canvas as HTMLCanvasElement).getContext('webgl2')!
        const rect = canvas.getBoundingClientRect()
        const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
        return ([[1, 0], [0.5, Math.sqrt(3) / 2], [-0.5, Math.sqrt(3) / 2]] as const).map(([nx, nz]) => {
          const tx = -nz, tz = nx
          const tangent = { x: dx.x * tx + dz.x * tz, y: dx.y * tx + dz.y * tz }
          const length = Math.hypot(tangent.x, tangent.y)
          const normal = { x: -tangent.y / length, y: tangent.x / length }
          const profile: number[] = []
          for (let offset = -4; offset <= 4; offset += 0.25) {
            let total = 0
            for (let i = 0; i < 80; i++) {
              const along = -0.2 + i * 0.4 / 79
              const u = nx * 0.5 + tx * along, v = nz * 0.5 + tz * along
              const x = Math.floor((origin.x + u * dx.x + v * dz.x - rect.left) * gl.drawingBufferWidth / rect.width + normal.x * offset)
              const y = gl.drawingBufferHeight - 1 - Math.floor(
                (origin.y + u * dx.y + v * dz.y - rect.top) * gl.drawingBufferHeight / rect.height + normal.y * offset)
              if (x < 0 || y < 0 || x >= gl.drawingBufferWidth || y >= gl.drawingBufferHeight) throw new Error('Grid sample is off-screen')
              const index = (y * gl.drawingBufferWidth + x) * 4
              total += 0.2126 * pixels[index]! + 0.7152 * pixels[index + 1]! + 0.0722 * pixels[index + 2]!
            }
            profile.push(total / 80)
          }
          // Average along the edge; interpolate the background across it to remove material-patch gradients.
          const left = profile.slice(0, 5).reduce((a, b) => a + b) / 5
          const right = profile.slice(-5).reduce((a, b) => a + b) / 5
          const darkness = profile.map((v, i) => left + (right - left) * i / (profile.length - 1) - v)
          const peak = Math.max(...darkness.slice(14, 19))
          return { peak, width: darkness.filter(v => v > peak / 2).length * 0.25,
            tail: Math.max(...darkness.slice(0, 9), ...darkness.slice(24)) }
        })
      }, { origin, dx, dz })
      for (const profile of profiles) {
        expect(profile.peak, 'Grid remains visible').toBeGreaterThan(terrain === 'water' ? 8 : 12)
        expect(profile.width, 'Rendered full width at half maximum, in framebuffer pixels').toBeGreaterThanOrEqual(0.75)
        expect(profile.width).toBeLessThanOrEqual(1.5)
        expect(profile.tail, 'No broad blurred halo beyond two pixels').toBeLessThan(profile.peak * 0.3)
        widths.push(profile.width)
      }
      for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
      await settled(page)
    }
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(0.5)
  })
}

test('regenerates repeatably and releases old chunk resources three times', async ({ page }) => {
  await page.goto('/?diagnostics=1')
  const { tile } = await selectTile(page)
  const initial = await stats(page)
  for (let i = 1; i <= 3; i++) {
    await page.getByRole('button', { name: 'Regenerate atlas' }).click()
    await expect(page.getByRole('status')).toHaveText('No tile selected')
    const current = await stats(page)
    expect(current).toMatchObject({ chunks: 56, meshes: 58, geometries: 58, materials: 6,
      disposedChunks: i * 56, rngState: initial.rngState, vertexBufferBytes: initial.vertexBufferBytes })
    expect((await selectTile(page)).tile).toEqual(tile)
  }
})

test('fixture stays chunk-bounded and supports pan, zoom, picking, regeneration', async ({ page }) => {
  await page.goto('/?diagnostics=1&width=256&height=256')
  await expect(page.locator('#map-status')).toContainText('65,536 TILES')
  await selectTile(page, 256)
  const initial = await stats(page)
  expect(initial).toMatchObject({ chunks: 56, voxelsPerTile: 2, meshes: 58, geometries: 58, materials: 6 })
  expect(initial.vertices).toBeLessThan(900_000)
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await page.locator('canvas').focus()
  await page.keyboard.press('ArrowRight')
  await selectTile(page, 256)
  for (let i = 1; i <= 3; i++) {
    await page.getByRole('button', { name: 'Regenerate atlas' }).click()
    expect(await stats(page)).toMatchObject({ chunks: initial.chunks, meshes: initial.meshes,
      geometries: initial.geometries, materials: 6, disposedChunks: initial.chunks! * i })
  }
  await page.getByRole('button', { name: '32² showcase' }).click()
  expect(await stats(page)).toMatchObject({ chunks: 56, meshes: 58, geometries: 58 })
  await selectTile(page)
})

test('rejects invalid input visibly and can recover without replacing the old valid map', async ({ page }) => {
  await page.goto('/?diagnostics=1')
  await page.getByLabel('World seed').fill('bad seed')
  await page.getByRole('button', { name: 'Regenerate atlas' }).click()
  await expect(page.getByRole('alert')).toContainText('Seed must')
  expect((await stats(page)).seed).toBe('polaris')
  await page.getByLabel('World seed').fill('polaris')
  await page.getByLabel('Width', { exact: true }).fill('257')
  await page.getByRole('button', { name: 'Regenerate atlas' }).click()
  await expect(page.getByRole('alert')).toContainText('whole numbers')
  await page.getByRole('button', { name: '32² showcase' }).click()
  await expect(page.getByRole('alert')).toBeHidden()
  await selectTile(page)
})

test('invalid URL config and unsupported WebGL2 never pretend to load a scene', async ({ page }) => {
  await page.goto('/?seed=&width=32&height=32')
  await expect(page.getByRole('alert')).toContainText('Seed must')
  await expect(page.locator('#map-status')).toContainText('Request failed')
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (args[0] === 'webgl2') return null
      return original.apply(this, args)
    } as typeof original
  })
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('WebGL 2 is unavailable')
  await expect(page.locator('#map-status')).not.toContainText('1,024 TILES')
})
