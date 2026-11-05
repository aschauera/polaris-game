import { expect, test, type Page } from '@playwright/test'
import { generateMap } from '../src/game/map'

async function settled(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function stats(page: Page) {
  return page.evaluate(() => window.polarisDiagnostics!.stats())
}

async function selectTile(page: Page, width = 32, height = width) {
  const map = generateMap({ seed: 'polaris', width, height })
  const tile = map.tiles.find(tile => tile.terrain === 'hills' &&
    Math.abs(tile.x - width / 2) < 3 && Math.abs(tile.z - height / 2) < 3)!
  await settled(page)
  const point = await page.evaluate(id => window.polarisDiagnostics!.projectTile(id), tile.id)
  expect(point).toBeDefined()
  await page.mouse.move(point!.x, point!.y)
  await expect(page.locator('#hover')).toContainText(`(${tile.x}, ${tile.z}) · Hills`)
  await page.mouse.click(point!.x, point!.y)
  await expect(page.getByRole('status')).toHaveText(`(${tile.x}, ${tile.z}) · Hills · Tile ${tile.id}`)
  return { tile, point: point! }
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  // This assertion also runs on failures: rendering errors are never filtered out.
  page.on('close', () => expect(errors).toEqual([]))
})

test('renders real terrain, maps picks through camera changes, and isolates HUD input', async ({ page }) => {
  await page.goto('/?diagnostics=1')
  await expect(page.locator('#map-status')).toContainText('1,024 TILES')
  await expect(page.getByRole('alert')).toBeHidden()
  await selectTile(page)
  const initial = await page.evaluate(() => window.polarisDiagnostics!.camera())
  expect(initial?.mode).toBe(1) // Babylon ORTHOGRAPHIC_CAMERA, not perspective.
  const rendering = await stats(page)
  expect(rendering).toMatchObject({ webGLVersion: 2, batches: 12, meshes: 14, materials: 5, geometries: 14 })
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
  expect(reset).toMatchObject({ x: 15.5, z: 15.5, mode: 1 })
  await page.locator('canvas').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('+')
  await selectTile(page)
  await page.keyboard.press('r')
})

test('regenerates repeatably and releases old chunk resources three times', async ({ page }) => {
  await page.goto('/?diagnostics=1')
  const { tile } = await selectTile(page)
  const initial = await stats(page)
  for (let i = 1; i <= 3; i++) {
    await page.getByRole('button', { name: 'Regenerate atlas' }).click()
    await expect(page.getByRole('status')).toHaveText('No tile selected')
    const current = await stats(page)
    expect(current).toMatchObject({ batches: 12, meshes: 14, geometries: 14, materials: 5,
      disposedBatches: i * 12, rngState: initial.rngState, instanceBufferBytes: 65_536 })
    expect((await selectTile(page)).tile).toEqual(tile)
  }
})

test('fixture stays chunk-bounded and supports pan, zoom, picking, regeneration', async ({ page }) => {
  await page.goto('/?diagnostics=1&width=256&height=256')
  await expect(page.locator('#map-status')).toContainText('65,536 TILES')
  await selectTile(page, 256)
  expect(await stats(page)).toMatchObject({
    batches: 768, meshes: 770, geometries: 770, materials: 5, instances: 65_536, instanceBufferBytes: 4_194_304,
  })
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await page.locator('canvas').focus()
  await page.keyboard.press('ArrowRight')
  await selectTile(page, 256)
  for (let i = 1; i <= 3; i++) {
    await page.getByRole('button', { name: 'Regenerate atlas' }).click()
    expect(await stats(page)).toMatchObject({ batches: 768, meshes: 770, geometries: 770, materials: 5, disposedBatches: 768 * i })
  }
  await page.getByRole('button', { name: '32² showcase' }).click()
  expect(await stats(page)).toMatchObject({ batches: 12, meshes: 14, geometries: 14 })
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
