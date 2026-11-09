import { expect, test, type Page } from '@playwright/test'
import { generateMap, type Tile } from '../src/game/map'
import { HEX_ROW, hexCenter } from '../src/game/hex'
import { createVoxelWorld, centreColumn, type VoxelWorld } from '../src/rendering/voxels'

async function settled(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function stats(page: Page) {
  return page.evaluate(() => window.polarisDiagnostics!.stats())
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
  const points: { x: number; y: number }[] = []
  for (let z = -2; z < 3; z++) for (let x = -2; x < 3; x++) {
    for (const fraction of [0.4, 0.6]) {
      const u = world.originX + (gx + x + fraction) * world.size - cx
      const v = world.originZ + (gz + z + fraction) * world.size - cz
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
  return { origin: origin!, samples }
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
  for (let zoom = 0; zoom < 5; zoom++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await settled(page)
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
  expect(rendering).toMatchObject({ webGLVersion: 2, chunks: 16, voxelsPerTile: 8, meshes: 18, materials: 6, geometries: 18 })
  expect(rendering.waterSurfaceQuads).toBeGreaterThan(0)
  expect(rendering.vertices).toBeLessThan(250_000)
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
  const { origin, samples } = await sampleSurface(page, world, tile)
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
  await expect(page.getByRole('status')).toHaveText(`(${tile.x}, ${tile.z}) · Water · Tile ${tile.id}`)
  expect((await stats(page)).waterSurfaceQuads).toBeGreaterThan(0)
})

for (const terrain of ['water', 'grassland'] as const) {
  test(`${terrain} shows voxel-sized material shades anchored to the world`, async ({ page }, testInfo) => {
    const map = generateMap({ seed: 'polaris', width: 32, height: 32 })
    const world = createVoxelWorld(map)
    await page.goto('/?diagnostics=1')
    await expect(page.locator('#map-status')).toContainText('1,024 TILES')
    const initial = await stats(page)
    const tile = map.tiles.filter(tile => tile.terrain === terrain
      && tile.x > 2 && tile.x < 29 && tile.z > 2 && tile.z < 29
      && map.tiles.every(other => Math.hypot(other.x - tile.x, other.z - tile.z) > 1.8
        || (other.terrain === terrain && other.elevation === tile.elevation && other.trees === 0)))
      .sort((a, b) => Math.hypot(a.x - 16, a.z - 16) - Math.hypot(b.x - 16, b.z - 16))[0]
    expect(tile, `Flat, tree-free ${terrain} sample`).toBeDefined()
    await inspectSurface(page, tile!)
    const { samples } = await sampleSurface(page, world, tile!)
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
    const shifted = await sampleSurface(page, world, tile!)
    const differences = samples.map((pixel, i) => Math.abs(pixel[1]! - shifted.samples[i]![1]!))
    expect(Math.max(...differences), `${terrain} shades must move with the world, not the screen`).toBeLessThanOrEqual(3)
    expect(await stats(page)).toMatchObject({
      vertices: initial.vertices, vertexBufferBytes: initial.vertexBufferBytes, remeshedChunks: initial.remeshedChunks,
    })
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
    expect(current).toMatchObject({ chunks: 16, meshes: 18, geometries: 18, materials: 6,
      disposedChunks: i * 16, rngState: initial.rngState, vertexBufferBytes: initial.vertexBufferBytes })
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
  expect(await stats(page)).toMatchObject({ chunks: 16, meshes: 18, geometries: 18 })
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
