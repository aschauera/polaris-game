import { expect, test, type CDPSession, type Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })

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

const camera = (page: Page) => page.evaluate(() => window.polarisDiagnostics!.camera()!)
const fitsScreen = (page: Page) => page.evaluate(() =>
  document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1)

async function settled(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

function touch(input: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd',
  touchPoints: { x: number; y: number }[] = []) {
  return input.send('Input.dispatchTouchEvent', { type, touchPoints })
}

test('portrait phone: map above messenger controls, no page scrolling, touch-sized buttons', async ({ page }, info) => {
  await page.goto('/?diagnostics=1')
  await expect(page.locator('#start-expedition')).toBeEnabled()
  expect(await fitsScreen(page)).toBe(true)
  const canvas = (await page.locator('canvas').boundingBox())!
  const panel = (await page.locator('.panel').boundingBox())!
  expect(canvas.width).toBeGreaterThan(350)
  expect(canvas.height).toBeGreaterThan(240)
  expect(canvas.y + canvas.height).toBeLessThanOrEqual(panel.y + 1)
  await expect(page.locator('#messenger-start')).toBeVisible()
  await page.screenshot({ path: info.outputPath('phone-portrait-atlas.png') })

  const sized = async (id: string) => {
    const box = (await page.locator(`#${id}`).boundingBox())!
    expect(box.height, `#${id} height`).toBeGreaterThanOrEqual(44)
    expect(box.width, `#${id} width`).toBeGreaterThanOrEqual(44)
  }
  await sized('start-expedition')
  await page.locator('#start-expedition').tap()
  await expect(page.locator('#turn-info')).toContainText('Turn 1')
  for (const id of ['zoom-in', 'zoom-out', 'reset', 'select-scout', 'move-scout', 'move-north', 'move-east',
    'move-south', 'move-west', 'end-turn', 'leave-expedition']) await sized(id)
  expect(await fitsScreen(page)).toBe(true)
  const controls = (await page.locator('.panel').boundingBox())!
  for (const id of ['select-scout', 'move-scout', 'move-north', 'end-turn']) {
    const box = (await page.locator(`#${id}`).boundingBox())!
    expect(box.y + box.height, `#${id} reachable without scrolling`).toBeLessThanOrEqual(controls.y + controls.height)
  }
  await page.screenshot({ path: info.outputPath('phone-portrait-expedition.png') })

  await page.locator('#leave-expedition').tap()
  await page.locator('#messenger-start').tap()
  await expect(page.locator('#turn-info')).toContainText('Turn 1')
  await expect(page.locator('#messenger')).toContainText('You play Meridian Union')
  await page.locator('#end-turn').tap()
  await expect(page.locator('#messenger-outbox')).toBeVisible()
  for (const id of ['messenger-copy-link', 'messenger-copy-code', 'messenger-save']) {
    const button = page.locator(`#${id}`)
    await button.scrollIntoViewIfNeeded()
    const box = (await button.boundingBox())!
    expect(box.height, `#${id} height`).toBeGreaterThanOrEqual(44)
    expect(box.width, `#${id} width`).toBeGreaterThanOrEqual(44)
  }
  expect(await fitsScreen(page)).toBe(true)
  await page.screenshot({ path: info.outputPath('phone-portrait-messenger.png') })
})

test.describe('landscape phone', () => {
  test.use({ viewport: { width: 844, height: 390 } })

  test('map and controls share one screen without page scrolling', async ({ page }, info) => {
    await page.goto('/?diagnostics=1')
    await expect(page.locator('#start-expedition')).toBeEnabled()
    expect(await fitsScreen(page)).toBe(true)
    const canvas = (await page.locator('canvas').boundingBox())!
    expect(canvas.width).toBeGreaterThan(500)
    expect(canvas.height).toBeGreaterThan(300)
    await page.screenshot({ path: info.outputPath('phone-landscape-atlas.png') })
  })
})

test('touch: tap selects, one finger pans, two fingers pinch-zoom without selecting', async ({ page, context }) => {
  await page.goto('/?diagnostics=1')
  await page.locator('#start-expedition').tap()
  await expect(page.locator('#turn-info')).toContainText('Turn 1')
  await page.locator('#select-scout').tap()
  await settled(page)

  const { scoutTileId, reachable } = (await page.evaluate(() => window.polarisDiagnostics!.expedition()))!
  const target = reachable.find(id => id !== scoutTileId)!
  const point = (await page.evaluate(id => window.polarisDiagnostics!.projectTile(id), target))!
  await page.touchscreen.tap(point.x, point.y)
  await expect(page.locator('#selection')).toContainText(`Tile ${target}`)

  await page.locator('#zoom-in').tap()
  const zoomedIn = await camera(page)
  await page.locator('#reset').tap()
  const reset = await camera(page)
  expect(reset.halfHeight).toBeGreaterThan(zoomedIn.halfHeight)

  const box = (await page.locator('canvas').boundingBox())!
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  const selection = await page.locator('#selection').textContent()
  const input = await context.newCDPSession(page)
  try {
    await touch(input, 'touchStart', [{ x: cx, y: cy }])
    await touch(input, 'touchMove', [{ x: cx - 60, y: cy }])
    await touch(input, 'touchEnd')
    const panned = await camera(page)
    expect(Math.abs(panned.x - reset.x)).toBeGreaterThan(1)
    expect(Math.abs(panned.z - reset.z)).toBeGreaterThan(1)
    expect(panned.halfHeight).toBe(reset.halfHeight)
    expect(await page.locator('#selection').textContent()).toBe(selection)

    await touch(input, 'touchStart', [{ x: cx - 50, y: cy }, { x: cx + 50, y: cy }])
    await touch(input, 'touchMove', [{ x: cx - 50, y: cy }, { x: cx + 90, y: cy }])
    await touch(input, 'touchEnd')
    const pinched = await camera(page)
    expect(pinched.halfHeight).toBeLessThan(panned.halfHeight)
    expect(pinched.x).toBe(panned.x)
    expect(await page.locator('#selection').textContent()).toBe(selection)
  } finally { await input.detach() }
})
