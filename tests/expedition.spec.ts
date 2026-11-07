import { expect, test, type Page } from '@playwright/test'
import { applyCommand, createExpedition, findPath, movementRange, neighbors, type Expedition } from '../src/game/expedition'
import { generateMap } from '../src/game/map'

async function settled(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function snapshot(page: Page) {
  return page.evaluate(() => window.polarisDiagnostics!.expedition())
}

async function clickTile(page: Page, id: number) {
  await settled(page)
  const point = await page.evaluate(id => window.polarisDiagnostics!.projectTile(id), id)
  expect(point).toBeDefined()
  await page.mouse.click(point!.x, point!.y)
}

async function start(page: Page, seed = 'polaris', width = 32, height = width) {
  await page.goto(`/?diagnostics=1&seed=${seed}&width=${width}&height=${height}`)
  await page.getByRole('button', { name: 'Start expedition' }).click()
  await expect(page.locator('#turn-info')).toContainText('Turn 1')
  return createExpedition(generateMap({ seed, width, height }))
}

function step(state: Expedition, to: number) {
  const result = applyCommand(state, { type: 'move', unitId: state.scouts[0]!.id,
    factionId: state.activeFaction, sequence: state.commands.length + 1, to })
  expect(result.ok).toBe(true)
  return result.state
}

const browserErrors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => {
  const errors: string[] = []
  browserErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
})
test.afterEach(({ page }) => {
  expect(browserErrors.get(page), 'Unexpected browser console/page errors').toEqual([])
})

test('selects a scout, spends movement, explores, rejects orders and restores movement at end-turn', async ({ page }, testInfo) => {
  let state = await start(page)
  const initialFog = { ...state.factions[0]!.fog }
  await clickTile(page, state.scouts[0]!.tileId)
  await expect(page.getByRole('button', { name: 'Select scout', exact: true })).toHaveAttribute('aria-pressed', 'true')

  // Follow the same legal commands through the real UI and an independent domain snapshot.
  for (let moves = 0; moves < SCOUT_MOVEMENT_LIMIT; moves++) {
    const scout = state.scouts[0]!
    const destinations = [...movementRange(state, scout.id)].filter(([id]) => id !== scout.tileId)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    if (!destinations.length) break
    const [to, cost] = destinations[0]!
    await clickTile(page, to)
    await expect(page.locator('#order-status')).toContainText(`Route: ${cost} movement`)
    await page.getByRole('button', { name: 'Move scout here' }).click()
    state = step(state, to)
    expect(await snapshot(page)).toMatchObject({ scoutTileId: to, movement: state.scouts[0]!.movement,
      commandCount: state.commands.length, fog: state.factions[0]!.fog })
  }
  expect(state.scouts[0]!.movement).toBe(0)
  expect(Object.keys(state.factions[0]!.fog).length).toBeGreaterThan(Object.keys(initialFog).length)
  expect(Object.values(state.factions[0]!.fog)).toContain('explored')
  const before = await snapshot(page)
  const target = neighbors(state.map, state.scouts[0]!.tileId).find(id => state.map.tiles[id]!.terrain !== 'water')!
  await clickTile(page, target)
  await page.getByRole('button', { name: 'Move scout here' }).click()
  await expect(page.locator('#order-status')).toHaveClass('rejected')
  expect(await snapshot(page)).toEqual(before)
  await page.getByRole('button', { name: 'End turn', exact: true }).click()
  await expect(page.locator('#turn-info')).toContainText('Turn 2')
  await expect(page.locator('#scout-info')).toContainText('4/4 movement')
  expect((await snapshot(page))!.fog).toEqual(before!.fog)
  await settled(page)
  const markerPixels = await page.evaluate(id => {
    const point = window.polarisDiagnostics!.projectTile(id)!
    const canvas = document.querySelector('canvas')!
    const rect = canvas.getBoundingClientRect()
    const gl = canvas.getContext('webgl2')!
    const x = Math.floor((point.x - rect.left) * gl.drawingBufferWidth / rect.width) - 25
    const y = gl.drawingBufferHeight - Math.floor((point.y - rect.top) * gl.drawingBufferHeight / rect.height)
    const pixels = new Uint8Array(50 * 65 * 4)
    gl.readPixels(x, y, 50, 65, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    let gold = 0
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i]! > 180 && pixels[i + 1]! > 130 && pixels[i + 2]! < 170) gold++
    }
    return gold
  }, state.scouts[0]!.tileId)
  expect(markerPixels, 'The own scout must remain readable among trees').toBeGreaterThan(150)
  await page.screenshot({ path: testInfo.outputPath('expedition-explored.png') })
})

const SCOUT_MOVEMENT_LIMIT = 4

test('unknown land and water have identical opaque surfaces, no trees or inspection leaks', async ({ page }, testInfo) => {
  const state = await start(page)
  await page.getByRole('button', { name: 'Reset view' }).click()
  await settled(page)
  const hidden = state.map.tiles.filter(tile => !state.factions[0]!.fog[tile.id])
  const land = hidden.find(tile => tile.trees > 0 && tile.x > 0 && tile.z > 0)!
  const water = hidden.find(tile => tile.terrain === 'water' && tile.x > 0 && tile.z > 0)!
  expect(land).toBeDefined()
  expect(water).toBeDefined()
  const pixels: number[][] = []
  for (const tile of [land, water]) {
    await clickTile(page, tile.id)
    await expect(page.locator('#selection')).toHaveText('No tile selected')
    await expect(page.locator('#hover')).not.toContainText(`(${tile.x}, ${tile.z})`)
    const pixel = await page.evaluate(id => {
      const point = window.polarisDiagnostics!.projectTile(id)!
      const canvas = document.querySelector('canvas')!
      const rect = canvas.getBoundingClientRect()
      const gl = canvas.getContext('webgl2')!
      const rgba = new Uint8Array(4)
      gl.readPixels(Math.floor((point.x - rect.left) * gl.drawingBufferWidth / rect.width),
        gl.drawingBufferHeight - 1 - Math.floor((point.y - rect.top) * gl.drawingBufferHeight / rect.height),
        1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
      return [...rgba]
    }, tile.id)
    pixels.push(pixel)
  }
  expect(pixels[0]).toEqual(pixels[1])
  expect(pixels[0]![3]).toBe(255)
  const background = await page.locator('canvas').evaluate(canvas => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2')!
    const pixel = new Uint8Array(4)
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    return [...pixel]
  })
  expect(pixels[0], 'Fog pixels must be rendered geometry, not an empty canvas').not.toEqual(background)
  await page.getByRole('button', { name: 'Select scout', exact: true }).click()
  await settled(page)
  await page.screenshot({ path: testInfo.outputPath('expedition.png') })
})

test('only affected fog buffers update; camera and HUD controls do not advance simulation', async ({ page }) => {
  const state = await start(page)
  await page.getByRole('button', { name: 'Select scout', exact: true }).click()
  const before = await snapshot(page)
  const updates = await page.evaluate(() => window.polarisDiagnostics!.stats().fogUpdates!)
  await page.locator('canvas').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('+')
  await page.getByLabel('World seed').click()
  await page.keyboard.press('ArrowLeft')
  expect(await snapshot(page)).toEqual(before)
  expect(await page.evaluate(() => window.polarisDiagnostics!.stats().fogUpdates)).toBe(updates)
  // Keyboard-accessible cardinal buttons issue real orders, without intercepting camera arrows.
  const scout = state.scouts[0]!
  const to = neighbors(state.map, scout.tileId).find(id => findPath(state, scout.id, id))!
  const delta = to - scout.tileId
  const direction = delta === -state.map.width ? 'north' : delta === 1 ? 'east' : delta === state.map.width ? 'south' : 'west'
  await page.getByRole('button', { name: `Move scout ${direction}`, exact: true }).focus()
  await page.keyboard.press('Enter')
  expect((await snapshot(page))!.scoutTileId).toBe(to)
  const changed = await page.evaluate(() => window.polarisDiagnostics!.stats().fogUpdates!)
  expect(changed - updates).toBeGreaterThan(0)
  expect(changed - updates).toBeLessThan(100)
})

test('regeneration restarts exploration and leaving releases the scout without resource growth', async ({ page }) => {
  await page.goto('/?diagnostics=1')
  const initial = await page.evaluate(() => window.polarisDiagnostics!.stats())
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Start expedition' }).click()
    const expedition = await snapshot(page)
    await page.getByRole('button', { name: 'End turn', exact: true }).click()
    await page.getByRole('button', { name: 'Regenerate atlas' }).click()
    expect(await snapshot(page)).toEqual(expedition)
    const playing = await page.evaluate(() => window.polarisDiagnostics!.stats())
    expect(playing).toMatchObject({ meshes: initial.meshes! + 1, materials: initial.materials! + 1,
      geometries: initial.geometries! + 1 })
    await page.getByRole('button', { name: 'Return to atlas (discard expedition)', exact: true }).click()
    expect(await snapshot(page)).toBeUndefined()
    const restored = await page.evaluate(() => window.polarisDiagnostics!.stats())
    expect(restored).toMatchObject({ meshes: initial.meshes, materials: initial.materials, geometries: initial.geometries })
    await clickTile(page, 0)
    await expect(page.locator('#selection')).toContainText('Tile 0')
  }
})

test('tree-free rectangular maps, invalid regeneration and pointer cancellation retain a valid expedition', async ({ page }) => {
  await start(page, 'aurora', 8, 8)
  const before = await snapshot(page)
  await page.getByRole('button', { name: 'Select scout', exact: true }).click()
  await page.getByLabel('World seed').fill('bad seed')
  await page.getByRole('button', { name: 'Regenerate atlas' }).click()
  await expect(page.getByRole('alert')).toContainText('Seed must')
  expect(await snapshot(page)).toEqual(before)
  const canvas = (await page.locator('canvas').boundingBox())!
  const camera = await page.evaluate(() => window.polarisDiagnostics!.camera())
  await page.mouse.move(canvas.x + 40, canvas.y + 70)
  await page.mouse.down()
  await page.locator('canvas').dispatchEvent('pointercancel', { pointerId: 1 })
  await page.mouse.move(canvas.x + 100, canvas.y + 90)
  await page.mouse.up()
  expect(await page.evaluate(() => window.polarisDiagnostics!.camera())).toEqual(camera)
  expect(await snapshot(page)).toEqual(before)
  await page.getByLabel('World seed').fill('polaris')
  await page.getByLabel('Height', { exact: true }).fill('12')
  await page.getByRole('button', { name: 'Regenerate atlas' }).click()
  await expect(page.getByRole('alert')).toBeHidden()
  await expect(page.locator('#world-info')).toContainText('8 × 12')
  expect((await snapshot(page))!.round).toBe(1)
  await page.getByRole('button', { name: 'Select scout', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Select scout', exact: true })).toHaveAttribute('aria-pressed', 'true')
})
