import { expect, test, type Page } from '@playwright/test'
import type { PlayerView } from '../src/network/protocol'

async function online(page: Page): Promise<PlayerView> {
  const view = await page.evaluate(() => window.polarisDiagnostics?.online())
  expect(view).toBeDefined()
  return view!
}
async function open(page: Page) {
  await page.goto('/?diagnostics=1')
  await page.locator('#network-panel summary').click()
}
async function revision(page: Page, expected: number) {
  await expect.poll(async () => (await page.evaluate(() => window.polarisDiagnostics?.online()))?.revision).toBe(expected)
}

test('two isolated players join, alternate turns, reload and return without leaking hidden state', async ({ browser, page }, info) => {
  const second = await browser.newContext()
  const guest = await second.newPage()
  try {
    await open(page)
    await page.locator('#create-room').click()
    await expect(page.locator('#share-invite')).toHaveValue(/#invite=/)
    await expect(page.locator('#end-turn')).toBeDisabled()
    const invitation = await page.locator('#share-invite').inputValue()
    await guest.goto(invitation.replace('/#', '/?diagnostics=1#'))
    await expect(guest).not.toHaveURL(/#/)
    await guest.locator('#join-room').click()
    await revision(page, 1)
    await revision(guest, 1)
    const initial = await online(page), other = await online(guest)
    expect(initial.factionId).toBe('meridian')
    expect(other.factionId).toBe('lantern')
    expect(initial.tiles.length).toBeLessThan(576)
    expect(initial.opponents).toEqual([])
    expect(other.opponents).toEqual([])
    expect(initial.scout.tileId).not.toBe(other.scout.tileId)
    expect(await page.evaluate(() => window.polarisDiagnostics!.stats().seed)).toBeUndefined()
    await expect(guest.locator('#end-turn')).toBeDisabled()
    await expect(page.locator('#end-turn')).toBeEnabled()
    await page.screenshot({ path: info.outputPath('multiplayer-host.png') })
    const move = initial.moves.find(move => move.tileId !== initial.scout.tileId)!
    await page.locator('#select-scout').click()
    const point = await page.evaluate(id => window.polarisDiagnostics!.projectTile(id), move.tileId)
    expect(point).toBeDefined()
    await page.mouse.click(point!.x, point!.y)
    await page.locator('#move-scout').click()
    await revision(page, 2)
    expect((await online(page)).scout.movement).toBe(4 - move.cost)
    await page.locator('#end-turn').click()
    await revision(guest, 3)
    await expect(page.locator('#end-turn')).toBeDisabled()
    await guest.locator('#end-turn').click()
    await revision(page, 4)
    expect((await online(page)).round).toBe(2)
    const camera = await page.evaluate(() => window.polarisDiagnostics!.camera())
    await page.waitForTimeout(1800)
    expect(await page.evaluate(() => window.polarisDiagnostics!.camera())).toEqual(camera)
    const counts = await page.evaluate(() => window.polarisDiagnostics!.stats())
    await page.waitForTimeout(1800)
    expect((await page.evaluate(() => window.polarisDiagnostics!.stats())).disposedBatches).toBe(counts.disposedBatches)
    await page.reload()
    await revision(page, 4)
    expect((await online(page)).scout.tileId).toBe(move.tileId)
    await page.locator('#leave-expedition').click()
    await expect(page.locator('#start-expedition')).toBeVisible()
    await page.locator('#network-panel summary').click()
    await page.locator('#resume-online').click()
    await revision(page, 4)
    await page.screenshot({ path: info.outputPath('multiplayer-resumed.png') })
  } finally { await second.close() }
})

test('lost command reply is retried once with the same ID after reconnect', async ({ browser, page }) => {
  const second = await browser.newContext()
  try {
    await open(page)
    await page.locator('#create-room').click()
    await expect(page.locator('#share-invite')).toHaveValue(/#invite=/)
    const guest = await second.newPage()
    await guest.goto((await page.locator('#share-invite').inputValue()).replace('/#', '/?diagnostics=1#'))
    await guest.locator('#join-room').click()
    await revision(page, 1)
    const ids: string[] = []
    let dropped = false
    await page.route('**/api/commands', async route => {
      const payload: { requestId: string } = route.request().postDataJSON()
      ids.push(payload.requestId)
      if (!dropped) { dropped = true; await route.fetch(); await route.abort('failed') }
      else await route.continue()
    })
    await page.locator('#end-turn').click()
    await expect.poll(async () => (await online(page)).revision, { timeout: 15_000 }).toBe(2)
    await expect.poll(() => ids.length).toBe(2)
    expect(new Set(ids).size).toBe(1)
    expect(await page.evaluate(() => sessionStorage.getItem('polaris.pending-order.v1'))).toBeNull()
    expect((await online(page)).activeFaction).toBe('lantern')
    await page.context().setOffline(true)
    await expect(page.locator('#connection-status')).toContainText('Offline')
    await expect(page.locator('#end-turn')).toBeDisabled()
    await page.context().setOffline(false)
    await expect(page.locator('#connection-status')).toContainText('synchronized')
    expect((await online(page)).revision).toBe(2)
  } finally { await second.close() }
})
