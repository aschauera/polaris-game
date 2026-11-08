import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyCommand, type Expedition } from '../game/expedition'
import { createMatch, exportMatch } from '../game/match'
import { decodeTurn, encodeTurn, linkedTurn, turnLink } from './turn-code'

const MATCH_ID = 'match-0123456789'

function idleMatch(turns: number): Expedition {
  let state = createMatch({ seed: 'polaris', width: 32, height: 24 })
  for (let turn = 0; turn < turns; turn++) {
    const result = applyCommand(state, { type: 'end-turn', factionId: state.activeFaction, sequence: state.commands.length + 1 })
    if (!result.ok) throw new Error(result.reason)
    state = result.state
  }
  return state
}

async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

const pkg = exportMatch(MATCH_ID, idleMatch(6))
const roundTripped: unknown = JSON.parse(JSON.stringify(pkg))

afterEach(() => { vi.unstubAllGlobals() })

describe('turn codes', () => {
  it('turn a package into one URL-safe word and back', async () => {
    const code = await encodeTurn(pkg)
    expect(code).toMatch(/^polaris1z\.[A-Za-z0-9_-]+$/)
    expect(await decodeTurn(code)).toEqual({ ok: true, value: roundTripped })
  })

  it('compress long histories well below their plain text size', async () => {
    const code = await encodeTurn(exportMatch(MATCH_ID, idleMatch(400)))
    expect(code.length).toBeLessThan(400)
  })

  it('are found inside links and whole chat messages', async () => {
    const code = await encodeTurn(pkg)
    const link = turnLink(code, { origin: 'https://polaris.example', pathname: '/play/' })
    expect(link).toBe(`https://polaris.example/play/#turn=${code}`)
    expect(linkedTurn(new URL(link).hash)).toBe(code)
    for (const text of [
      code, link, `  ${link}\n`, `Your turn!\n${link}\nHave fun.`, `(${link}).`, `Code: ${code}.`, `"${code}"`,
    ]) {
      expect(await decodeTurn(text)).toEqual({ ok: true, value: roundTripped })
    }
  })

  it('ignore addresses that are not turn links', () => {
    expect(linkedTurn('')).toBeUndefined()
    expect(linkedTurn('#other')).toBeUndefined()
    expect(linkedTurn('#turn=')).toBe('')
  })

  it('open as the JSON text of a saved file', async () => {
    expect(await decodeTurn(JSON.stringify(pkg))).toEqual({ ok: true, value: roundTripped })
    expect(await decodeTurn(`\n${JSON.stringify(pkg, undefined, 2)}\n`)).toEqual({ ok: true, value: roundTripped })
  })

  it('fall back to plain text where streams cannot compress', async () => {
    vi.stubGlobal('CompressionStream', undefined)
    const code = await encodeTurn(pkg)
    expect(code).toMatch(/^polaris1j\.[A-Za-z0-9_-]+$/)
    expect(await decodeTurn(code)).toEqual({ ok: true, value: roundTripped })
    vi.unstubAllGlobals()
    const compressed = await encodeTurn(pkg)
    vi.stubGlobal('DecompressionStream', undefined)
    expect(await decodeTurn(compressed)).toMatchObject({ ok: false, reason: expect.stringMatching(/too old/) })
  })

  it('explain that nothing was found', async () => {
    for (const text of ['', '   ', 'hello', 'https://polaris.example/play/', 'polaris1z.', 'polaris2z.abc']) {
      expect(await decodeTurn(text)).toMatchObject({ ok: false, reason: expect.stringMatching(/Paste a Polaris turn/) })
    }
  })

  it('report cut-off, edited or foreign data as damaged', async () => {
    const code = await encodeTurn(pkg)
    const middle = Math.floor(code.length / 2)
    const damaged = [
      code.slice(0, -12), `${code.slice(0, middle)}AAAA${code.slice(middle + 4)}`,
      'polaris1z.A', 'polaris1z.AAAAAAAA', 'polaris1j.AAAA', 'polaris1j.__8', '{"format":',
      `polaris1z.${base64Url(await deflate(new TextEncoder().encode('not json')))}`,
      `polaris1j.${base64Url(new Uint8Array([0xff, 0xfe, 0xfd]))}`,
    ]
    for (const text of damaged) {
      expect(await decodeTurn(text), text).toMatchObject({ ok: false, reason: expect.stringMatching(/damaged or incomplete/) })
    }
  })

  it('refuse data that unpacks to far more than any match', async () => {
    const bomb = await deflate(new Uint8Array(5_000_000))
    expect(bomb.length).toBeLessThan(10_000)
    expect(await decodeTurn(`polaris1z.${base64Url(bomb)}`)).toMatchObject({ ok: false, reason: expect.stringMatching(/too long/) })
    expect(await decodeTurn('a'.repeat(1_500_001))).toMatchObject({ ok: false, reason: expect.stringMatching(/too long/) })
    expect(await decodeTurn(`{"filler":"${'a'.repeat(1_000_000)}"}`)).toMatchObject({ ok: false, reason: expect.stringMatching(/too long/) })
  })
})
