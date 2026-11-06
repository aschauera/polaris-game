import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })

test('phone layout, touch controls and static-only offline shell', async ({ page, context, browserName }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/?diagnostics=1')
  await expect(page.locator('#start-expedition')).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const canvas = await page.locator('canvas').boundingBox(), panel = await page.locator('.panel').boundingBox()
  expect(canvas!.width).toBeGreaterThan(350)
  expect(canvas!.y + canvas!.height).toBeLessThanOrEqual(panel!.y + 1)
  for (const id of ['zoom-in', 'zoom-out', 'reset', 'start-expedition']) {
    expect((await page.locator(`#${id}`).boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  await page.locator('#start-expedition').tap()
  await page.locator('#select-scout').tap()
  const start = await page.evaluate(() => window.polarisDiagnostics!.camera()!)
  await page.locator('#zoom-in').tap()
  expect((await page.evaluate(() => window.polarisDiagnostics!.camera()!)).halfHeight).toBeLessThan(start.halfHeight)
  await page.locator('#reset').tap()
  if (browserName === 'chromium') {
    const before = await page.evaluate(() => window.polarisDiagnostics!.camera()!)
    const selection = await page.locator('#selection').textContent()
    const input = await context.newCDPSession(page)
    await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y: 220 }, { x: 220, y: 220 }] })
    await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 120, y: 220 }, { x: 300, y: 220 }] })
    await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    expect((await page.evaluate(() => window.polarisDiagnostics!.camera()!)).halfHeight).toBeLessThan(before.halfHeight)
    expect(await page.locator('#selection').textContent()).toBe(selection)
    await input.detach()
  }
  await page.locator('#select-scout').tap()
  await page.screenshot({ path: info.outputPath('mobile-expedition.png') })
  const manifest = await (await page.request.get('/manifest.webmanifest')).json()
  expect(manifest.display).toBe('standalone')
  for (const size of [180, 192, 512]) {
    const icon = await page.request.get(`/icon-${size}.png`)
    expect(icon.ok()).toBe(true)
    expect((await icon.body()).readUInt32BE(16)).toBe(size)
  }
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  const cachePaths = await page.evaluate(async () => {
    const keys = await caches.keys()
    const requests = await Promise.all(keys.map(async key => (await caches.open(key)).keys()))
    return requests.flat().map(request => new URL(request.url).pathname)
  })
  expect(cachePaths.some(path => path.startsWith('/assets/') && path.endsWith('.js'))).toBe(true)
  expect(cachePaths.some(path => path.startsWith('/api/'))).toBe(false)
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('#start-expedition')).toBeEnabled()
  await page.locator('#start-expedition').tap()
  await expect(page.locator('#turn-info')).toContainText('Turn 1')
  await context.setOffline(false)
  expect(errors).toEqual([])
})

test('phone players can join, hand off a turn and resume their seat', async ({ browser, page }, info) => {
  const second = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const guest = await second.newPage()
  guest.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto('/?diagnostics=1')
    await page.locator('#network-panel summary').tap()
    await page.locator('#create-room').tap()
    await expect(page.locator('#share-invite')).toHaveValue(/#invite=/)
    await guest.goto((await page.locator('#share-invite').inputValue()).replace('/#', '/?diagnostics=1#'))
    await guest.locator('#join-room').tap()
    await expect(page.locator('#end-turn')).toBeEnabled()
    await expect(guest.locator('#end-turn')).toBeDisabled()
    await page.locator('#select-scout').tap()
    await page.screenshot({ path: info.outputPath('mobile-online.png') })
    await page.locator('#end-turn').tap()
    await expect(guest.locator('#end-turn')).toBeEnabled()
    await guest.locator('#end-turn').tap()
    await expect(page.locator('#turn-info')).toContainText('Turn 2')
    await page.reload()
    await expect(page.locator('#turn-info')).toContainText('Turn 2')
    await expect(page.locator('#end-turn')).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
  } finally { await second.close() }
})
