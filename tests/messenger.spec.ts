import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test'
import { applyCommand, createExpedition, type Expedition } from '../src/game/expedition'
import { hexOffsets } from '../src/game/hex'
import { generateMap, tileAt } from '../src/game/map'
import { exportMatch, MATCH_FACTIONS, stateHash } from '../src/game/match'
import { encodeTurn } from '../src/exchange/turn-code'

const WORLD = { seed: 'polaris', width: 32, height: 32 }
const WORLD_URL = `/?diagnostics=1&seed=${WORLD.seed}&width=${WORLD.width}&height=${WORLD.height}`
const TURN_PREFIX = '#turn='
// Pad labels for east, south-east, south-west, west, north-west and north-east as the camera shows them.
const SCREEN_LABELS = ['down and left', 'down', 'down and right', 'up and right', 'up', 'up and left'] as const

const browserErrors: string[] = []
function watch(page: Page) {
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()) })
}
test.beforeEach(({ page }) => {
  // Software-rendered pages, two of them in the exchange tests, are slow on small runners.
  test.slow()
  browserErrors.length = 0
  watch(page)
})
test.afterEach(() => {
  expect(browserErrors, 'Unexpected browser console/page errors').toEqual([])
})

// Every device is its own browser context, so it has its own storage like a separate phone.
async function openDevice(browser: Browser, testInfo: TestInfo) {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: { width: 1100, height: 760 },
    reducedMotion: 'reduce',
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const page = await context.newPage()
  watch(page)
  return { context, page }
}

const matchOf = (page: Page) => page.evaluate(() => window.polarisDiagnostics!.match())
const expeditionOf = (page: Page) => page.evaluate(() => window.polarisDiagnostics!.expedition())
const endTurnButton = (page: Page) => page.getByRole('button', { name: 'End turn', exact: true })

function newMatch(): Expedition {
  return createExpedition(generateMap(WORLD), MATCH_FACTIONS)
}

// A legal one-hex move for whoever is on turn, together with the screen-direction button that issues it.
function legalStep(state: Expedition) {
  const scout = state.scouts.find(unit => unit.factionId === state.activeFaction)!
  const tile = state.map.tiles[scout.tileId]!
  for (const [index, [dx, dz]] of hexOffsets(tile.z).entries()) {
    const target = tileAt(state.map, tile.x + dx, tile.z + dz)
    if (!target) continue
    const result = applyCommand(state, { type: 'move', factionId: state.activeFaction,
      sequence: state.commands.length + 1, unitId: scout.id, to: target.id })
    if (result.ok) return { direction: SCREEN_LABELS[index]!, state: result.state }
  }
  throw new Error(`${state.activeFaction} has no legal step`)
}

function finishTurn(state: Expedition): Expedition {
  const result = applyCommand(state, { type: 'end-turn', factionId: state.activeFaction, sequence: state.commands.length + 1 })
  if (!result.ok) throw new Error(result.reason)
  return result.state
}

// Plays one step through the real controls, checks it against an independent replay, then ends the turn.
async function playTurn(page: Page, before: Expedition): Promise<Expedition> {
  await page.getByRole('button', { name: 'Select scout', exact: true }).click()
  const step = legalStep(before)
  await page.getByRole('button', { name: `Move unit ${step.direction}`, exact: true }).click()
  expect(await matchOf(page)).toMatchObject({ commandCount: step.state.commands.length, stateHash: stateHash(step.state) })
  await endTurnButton(page).click()
  const after = finishTurn(step.state)
  expect(await matchOf(page)).toMatchObject({ commandCount: after.commands.length, stateHash: stateHash(after) })
  await expect(page.locator('#messenger-link')).toHaveValue(new RegExp(`${TURN_PREFIX}polaris1[zj]\\.`))
  return after
}

const codeOf = (link: string) => new URL(link).hash.slice(TURN_PREFIX.length)
// Both players see this default title, because it comes from the identifier that travels with every turn.
const titleOf = (matchId: string) => `Match ${matchId.slice(0, 4).toUpperCase()}`
const storedMatchKeys = (page: Page) =>
  page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('polaris.matches.v1.')).sort())

// The messenger panel sits below the fold of the sidebar, so bring it into view before capturing evidence.
async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.locator('#messenger').scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`) })
}

test('two devices exchange turns through a link and a pasted code and stay in sync', async ({ browser }, testInfo) => {
  const host = await openDevice(browser, testInfo)
  const guest = await openDevice(browser, testInfo)
  try {
    await host.page.goto(WORLD_URL)
    await host.page.getByRole('button', { name: 'Start messenger match' }).click()
    await expect(host.page.locator('#turn-info')).toContainText('Turn 1 · Meridian Union · your turn')
    await expect(host.page.locator('#messenger-status')).toContainText('You play Meridian Union')
    await expect(host.page.locator('#seed')).toBeDisabled()
    await expect(host.page.getByRole('button', { name: 'Return to atlas (discard expedition)', exact: true })).toBeHidden()

    let truth = await playTurn(host.page, newMatch())
    await expect(host.page.locator('#turn-info')).toContainText('Turn 1 · Lantern Compact · opponent\'s turn')
    await expect(endTurnButton(host.page)).toBeDisabled()
    for (const direction of SCREEN_LABELS) {
      await expect(host.page.getByRole('button', { name: `Move unit ${direction}`, exact: true })).toBeDisabled()
    }
    expect((await expeditionOf(host.page))!.reachable).toEqual([])
    await expect(host.page.locator('.unit-target.available, .city-plate.available')).toHaveCount(0)
    const waiting = await matchOf(host.page)
    await host.page.locator('.unit-target[data-unit-id="founder-meridian"]').click()
    expect(await matchOf(host.page)).toEqual(waiting)
    expect((await expeditionOf(host.page))!.selectedReachable).toEqual([])

    const hostLink = await host.page.locator('#messenger-link').inputValue()
    await host.page.getByRole('button', { name: 'Copy link' }).click()
    await expect(host.page.locator('#messenger-notice')).toContainText('Link copied')
    expect(await host.page.evaluate(() => navigator.clipboard.readText())).toBe(hostLink)
    await capture(host.page, testInfo, 'messenger-host-outbox')

    // The guest has never seen this match: the link alone carries seed, orders and checksums.
    await guest.page.goto(`/?diagnostics=1${new URL(hostLink).hash}`)
    await expect(guest.page.locator('#turn-info')).toContainText('Turn 1 · Lantern Compact · your turn')
    await expect(guest.page.locator('#messenger-notice')).toContainText('Joined as Lantern Compact')
    await expect(guest.page).toHaveURL(/\/\?diagnostics=1$/)
    await capture(guest.page, testInfo, 'messenger-guest-joined')
    await expect(guest.page.locator('#seed')).toBeDisabled()
    expect(await matchOf(guest.page)).toMatchObject({ faction: 'lantern', active: 'lantern',
      commandCount: truth.commands.length, stateHash: stateHash(truth) })
    expect((await matchOf(guest.page))!.id).toBe((await matchOf(host.page))!.id)

    truth = await playTurn(guest.page, truth)
    await expect(guest.page.locator('#turn-info')).toContainText('Turn 2 · Meridian Union · opponent\'s turn')
    const guestCode = codeOf(await guest.page.locator('#messenger-link').inputValue())

    await host.page.locator('#messenger-inbox').fill(guestCode)
    await host.page.getByRole('button', { name: 'Open turn' }).click()
    await expect(host.page.locator('#turn-info')).toContainText('Turn 2 · Meridian Union · your turn')
    await expect(host.page.locator('#messenger-notice')).toContainText('Received Lantern Compact\'s turn')
    await expect(host.page.locator('#messenger-inbox')).toHaveValue('')
    expect(await matchOf(host.page)).toMatchObject({ commandCount: truth.commands.length, stateHash: stateHash(truth) })
    expect(await matchOf(guest.page)).toMatchObject({ stateHash: stateHash(truth) })
    expect((await expeditionOf(host.page))!.reachable.length).toBeGreaterThan(0)
    await expect(endTurnButton(host.page)).toBeEnabled()

    await host.page.reload()
    await expect(host.page.locator('#turn-info')).toContainText('Turn 2 · Meridian Union · your turn')
    expect(await matchOf(host.page)).toMatchObject({ commandCount: truth.commands.length, stateHash: stateHash(truth) })
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test('a turn saved as a file opens on the other device', async ({ browser }, testInfo) => {
  const host = await openDevice(browser, testInfo)
  const guest = await openDevice(browser, testInfo)
  try {
    await host.page.goto(WORLD_URL)
    await host.page.getByRole('button', { name: 'Start messenger match' }).click()
    const truth = await playTurn(host.page, newMatch())
    const [download] = await Promise.all([
      host.page.waitForEvent('download'),
      host.page.getByRole('button', { name: 'Save file' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('polaris-turn-1.txt')
    const file = await download.path()

    await guest.page.goto(WORLD_URL)
    await guest.page.locator('summary', { hasText: 'Open a received turn' }).click()
    const [chooser] = await Promise.all([
      guest.page.waitForEvent('filechooser'),
      guest.page.getByRole('button', { name: 'Open file…' }).click(),
    ])
    await chooser.setFiles(file)
    await expect(guest.page.locator('#turn-info')).toContainText('Turn 1 · Lantern Compact · your turn')
    expect(await matchOf(guest.page)).toMatchObject({ faction: 'lantern', stateHash: stateHash(truth) })
  } finally {
    await host.context.close()
    await guest.context.close()
  }
})

test('a running match survives a reload and is forgotten when the player leaves', async ({ page }) => {
  await page.goto(WORLD_URL)
  await page.getByRole('button', { name: 'Start messenger match' }).click()
  await playTurn(page, newMatch())
  const link = await page.locator('#messenger-link').inputValue()
  const before = await matchOf(page)

  await page.reload()
  await expect(page.locator('#turn-info')).toContainText('Turn 1 · Lantern Compact · opponent\'s turn')
  expect(await matchOf(page)).toEqual(before)
  // The outbox is derived from the match, so it is identical after a reload.
  await expect(page.locator('#messenger-link')).toHaveValue(link)
  await expect(page.locator('#seed')).toBeDisabled()
  await expect(page.locator('#world-lock')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Regenerate atlas' })).toBeDisabled()

  await page.locator('#messenger-leave').click()
  await expect(page.locator('#messenger-confirm')).toBeVisible()
  await page.locator('#messenger-leave-no').click()
  await expect(page.locator('#messenger-confirm')).toBeHidden()
  expect(await matchOf(page)).toEqual(before)

  await page.locator('#messenger-leave').click()
  await page.locator('#messenger-leave-yes').click()
  await expect(page.locator('#messenger-notice')).toContainText('You left the match')
  expect(await matchOf(page)).toBeUndefined()
  expect(await expeditionOf(page)).toBeUndefined()
  expect(await storedMatchKeys(page)).toEqual([])
  await expect(page.locator('#messenger-saved')).toBeHidden()
  await expect(page.locator('#seed')).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Regenerate atlas' })).toBeEnabled()

  await page.reload()
  await expect(page.getByRole('button', { name: 'Start messenger match' })).toBeEnabled()
  expect(await expeditionOf(page)).toBeUndefined()
})

test('keeps a generator-v3 saved match and explains incompatibility without rebuilding or deleting it', async ({ page }) => {
  const id = 'older-world-03'
  const key = `polaris.matches.v1.${id}`
  const raw = JSON.stringify({ faction: 'meridian', name: 'Earlier world',
    match: { ...exportMatch(id, newMatch()), generator: 3 } })
  await page.addInitScript(({ id, key, raw }) => {
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, raw)
      localStorage.setItem('polaris.current-match.v1', id)
    }
  }, { id, key, raw })
  await page.goto(WORLD_URL)
  await expect(page.locator('#messenger-notice')).toContainText('The saved match has been kept')
  await expect(page.locator('#messenger-notice')).toContainText('world generator 3, but your copy uses 4')
  expect(await matchOf(page)).toBeUndefined()
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw)
  expect(await page.evaluate(() => localStorage.getItem('polaris.current-match.v1'))).toBeNull()
  await page.reload()
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw)
  await expect(page.locator('#messenger-saved-list')).toContainText('Earlier world')
  await page.getByRole('button', { name: 'Start messenger match' }).click()
  expect(await storedMatchKeys(page)).toHaveLength(2)
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw)
  expect(await matchOf(page)).toBeDefined()
})

test('rejects damaged, unfinished, tampered and repeated turns, and opens a foreign turn as its own match', async ({ page }) => {
  await page.goto(WORLD_URL)
  const inbox = page.locator('#messenger-inbox')
  const notice = page.locator('#messenger-notice')
  const open = async (text: string) => {
    await inbox.fill(text)
    await page.getByRole('button', { name: 'Open turn' }).click()
  }
  await page.locator('summary', { hasText: 'Open a received turn' }).click()

  const unfinished = exportMatch('testmatch01', legalStep(newMatch()).state)
  const finished = exportMatch('testmatch01', finishTurn(newMatch()))
  const rejections: readonly (readonly [string, string])[] = [
    ['this is not a turn', 'Polaris'],
    [await encodeTurn(unfinished), 'finished turn'],
    [await encodeTurn({ ...finished, stateHash: '0'.repeat(14) }), 'ended differently'],
    [await encodeTurn({ ...finished, mapHash: '0'.repeat(14) }), 'different world'],
    [await encodeTurn({ ...finished, generator: 3 }), 'world generator 3, but your copy uses 4'],
  ]
  for (const [text, reason] of rejections) {
    await open(text)
    await expect(notice).toContainText(reason)
    await expect(notice).toHaveClass(/rejected/)
    await expect(inbox).not.toHaveValue('')
    expect(await matchOf(page)).toBeUndefined()
    expect(await expeditionOf(page)).toBeUndefined()
  }

  await page.getByRole('button', { name: 'Start messenger match' }).click()
  await endTurnButton(page).click()
  await expect(page.locator('#messenger-link')).toHaveValue(/#turn=/)
  const link = await page.locator('#messenger-link').inputValue()
  const before = await matchOf(page)

  // A turn of another match opens that match; the first one stays saved and its own link brings it back.
  await open(await encodeTurn(exportMatch('othermatch1', finishTurn(newMatch()))))
  await expect(notice).toContainText('Joined as Lantern Compact')
  await expect(notice).toContainText(`${titleOf(before!.id)} stays saved under All matches`)
  await expect(notice).not.toHaveClass(/rejected/)
  expect(await matchOf(page)).toMatchObject({ id: 'othermatch1', faction: 'lantern' })

  // On your own turn the inbox is folded away.
  await page.locator('summary', { hasText: 'Open a received turn' }).click()
  await open(link)
  await expect(notice).toContainText('You already have this turn')
  await expect(notice).not.toHaveClass(/rejected/)
  expect(await matchOf(page)).toEqual(before)
  expect(await storedMatchKeys(page)).toHaveLength(2)
})

test('keeps several matches on one device and routes each received turn to its own match', async ({ page }, testInfo) => {
  await page.goto(WORLD_URL)
  await page.getByRole('button', { name: 'Start messenger match' }).click()
  const name = page.locator('#messenger-name')
  await name.fill('  Andreas  ')
  await name.press('Enter')
  await expect(page.locator('#messenger-status')).toContainText('Andreas · You play Meridian Union')
  await expect(name).toHaveValue('Andreas')
  const truthA = await playTurn(page, newMatch())
  const linkA = await page.locator('#messenger-link').inputValue()
  const matchA = (await matchOf(page))!
  expect(matchA.name).toBe('Andreas')

  const notice = page.locator('#messenger-notice')
  const entries = page.locator('#messenger-saved-list > li')
  await page.getByRole('button', { name: 'All matches' }).click()
  await expect(notice).toContainText('The match is saved')
  expect(await matchOf(page)).toBeUndefined()
  await expect(page.locator('#seed')).toBeEnabled()
  await expect(entries).toHaveCount(1)
  await expect(entries.first()).toContainText('Andreas')
  await expect(entries.first()).toContainText('Waiting for Lantern Compact · turn 1 · you play Meridian Union')

  await page.getByRole('button', { name: 'Start messenger match' }).click()
  await expect(name).toHaveValue('')
  const truthB = await playTurn(page, newMatch())
  const matchB = (await matchOf(page))!
  expect(matchB.id).not.toBe(matchA.id)

  // The opponent in match A answers while match B is on screen.
  const replyA = finishTurn(legalStep(truthA).state)
  await page.locator('#messenger-inbox').fill(await encodeTurn(exportMatch(matchA.id, replyA)))
  await page.getByRole('button', { name: 'Open turn' }).click()
  await expect(notice).toContainText('Opened Andreas and received Lantern Compact\'s turn (2 orders).')
  await expect(notice).toContainText(`${titleOf(matchB.id)} stays saved under All matches`)
  await expect(page.locator('#turn-info')).toContainText('Turn 2 · Meridian Union · your turn')
  expect(await matchOf(page)).toMatchObject({ id: matchA.id, name: 'Andreas',
    commandCount: replyA.commands.length, stateHash: stateHash(replyA) })

  // The match that received the latest turn is the one that reopens.
  await page.reload()
  await expect(page.locator('#turn-info')).toContainText('Turn 2 · Meridian Union · your turn')
  expect(await matchOf(page)).toMatchObject({ id: matchA.id, stateHash: stateHash(replyA) })

  await page.getByRole('button', { name: 'All matches' }).click()
  await expect(entries).toHaveCount(2)
  await expect(entries.nth(0)).toContainText('Andreas')
  await expect(entries.nth(0)).toContainText('Your turn · turn 2')
  await expect(entries.nth(0)).toHaveClass(/your-turn/)
  await expect(entries.nth(1)).toContainText(titleOf(matchB.id))
  await expect(entries.nth(1)).toContainText('Waiting for Lantern Compact')
  await expect(entries.nth(1)).not.toHaveClass(/your-turn/)
  await capture(page, testInfo, 'messenger-match-list')

  await page.getByRole('button', { name: `Continue ${titleOf(matchB.id)}` }).click()
  await expect(page.locator('#turn-info')).toContainText('Turn 1 · Lantern Compact · opponent\'s turn')
  expect(await matchOf(page)).toMatchObject({ id: matchB.id, name: '', stateHash: stateHash(truthB) })
  await expect(page.locator('#messenger-link')).toHaveValue(new RegExp(`${TURN_PREFIX}polaris1[zj]\\.`))

  // An old message of match A brings that match back without changing it, and a pending leave of B is dropped.
  await page.locator('#messenger-leave').click()
  await expect(page.locator('#messenger-confirm')).toBeVisible()
  await page.locator('#messenger-inbox').fill(linkA)
  await page.getByRole('button', { name: 'Open turn' }).click()
  await expect(notice).toContainText('older turn')
  expect(await matchOf(page)).toMatchObject({ id: matchA.id, stateHash: stateHash(replyA) })
  await expect(page.locator('#messenger-confirm')).toBeHidden()
  await expect(page.locator('#messenger-leave')).toBeVisible()
  await expect(name).toHaveValue('Andreas')
  expect(await storedMatchKeys(page)).toHaveLength(2)

  // Leaving one match forgets only that one.
  await page.locator('#messenger-leave').click()
  await page.locator('#messenger-leave-yes').click()
  await expect(entries).toHaveCount(1)
  await expect(entries.first()).toContainText(titleOf(matchB.id))
  expect(await storedMatchKeys(page)).toEqual([`polaris.matches.v1.${matchB.id}`])
})

test('without storage, a turn of another match does not replace the open match', async ({ page }) => {
  // Some private modes refuse storage; merely reading the property throws there.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true, get() { throw new DOMException('Storage is blocked.', 'SecurityError') },
    })
  })
  await page.goto(WORLD_URL)
  await page.getByRole('button', { name: 'Start messenger match' }).click()
  const truth = await playTurn(page, newMatch())
  const before = await matchOf(page)

  const notice = page.locator('#messenger-notice')
  const foreign = await encodeTurn(exportMatch('othermatch1', finishTurn(newMatch())))
  await page.locator('#messenger-inbox').fill(foreign)
  await page.getByRole('button', { name: 'Open turn' }).click()
  await expect(notice).toContainText('cannot keep matches')
  await expect(notice).toHaveClass(/rejected/)
  await expect(page.locator('#messenger-inbox')).toHaveValue(foreign)
  expect(await matchOf(page)).toEqual(before)
  expect(before).toMatchObject({ stateHash: stateHash(truth) })

  await page.getByRole('button', { name: 'All matches' }).click()
  await expect(notice).toContainText('cannot keep matches')
  await expect(page.locator('#messenger-saved')).toBeHidden()
  await page.locator('summary', { hasText: 'Open a received turn' }).click()
  await page.locator('#messenger-inbox').fill(foreign)
  await page.getByRole('button', { name: 'Open turn' }).click()
  await expect(notice).toContainText('Joined as Lantern Compact')
  expect(await matchOf(page)).toMatchObject({ id: 'othermatch1', faction: 'lantern' })
})

test('the messenger panel is offered on the atlas and stays out of the way during a solo expedition', async ({ page }, testInfo) => {
  await page.goto(WORLD_URL)
  await expect(page.locator('#messenger')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start messenger match' })).toBeEnabled()
  await expect(page.locator('#messenger-inbox')).toBeHidden()
  await capture(page, testInfo, 'messenger-idle')

  await page.getByRole('button', { name: 'Start expedition' }).click()
  await expect(page.locator('#turn-info')).toContainText('Turn 1')
  await expect(page.locator('#messenger')).toBeHidden()
  expect(await matchOf(page)).toBeUndefined()
  await expect(page.locator('#turn-info')).not.toContainText('your turn')

  await page.getByRole('button', { name: 'Return to atlas (discard expedition)', exact: true }).click()
  await expect(page.locator('#messenger')).toBeVisible()
})
