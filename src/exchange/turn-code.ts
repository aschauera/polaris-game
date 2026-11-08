import type { MatchPackage } from '../game/match'

const PREFIX = 'polaris1'
const CODE = /polaris1([zj])\.([A-Za-z0-9_-]+)/
const LINK_KEY = '#turn='
// A full match of 10 000 orders is far below these caps; they only stop pasted junk and decompression bombs.
const MAX_JSON_BYTES = 1_000_000
const MAX_TEXT_CHARS = 1_500_000

export type DecodeResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string }

const fail = (reason: string): DecodeResult => ({ ok: false, reason })
const DAMAGED = 'This turn is damaged or incomplete. Open the whole link again, or copy the complete message.'
const TOO_LONG = 'This text is too long to be a Polaris turn.'

function compressionAvailable(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function'
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const standard = text.replaceAll('-', '+').replaceAll('_', '/')
  return Uint8Array.from(atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, '=')), character => character.charCodeAt(0))
}

async function transform(
  bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream, limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    size += part.value.length
    if (size > limit) {
      await reader.cancel()
      throw new RangeError(TOO_LONG)
    }
    chunks.push(part.value)
  }
  const joined = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.length
  }
  return joined
}

function parseJson(bytes: Uint8Array<ArrayBuffer>): DecodeResult {
  if (bytes.length > MAX_JSON_BYTES) return fail(TOO_LONG)
  try {
    return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown }
  } catch {
    return fail(DAMAGED)
  }
}

// Messengers carry plain text, so the turn becomes one unbroken URL-safe word that survives copy and paste.
export async function encodeTurn(pkg: MatchPackage): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(pkg))
  if (compressionAvailable()) {
    try {
      return `${PREFIX}z.${toBase64Url(await transform(json, new CompressionStream('deflate-raw'), MAX_JSON_BYTES))}`
    } catch {
      // The plain form below is larger but works everywhere.
    }
  }
  return `${PREFIX}j.${toBase64Url(json)}`
}

// Accepts a bare code, a link, a whole chat message around either of them, or the JSON text of a saved file.
export async function decodeTurn(text: string): Promise<DecodeResult> {
  if (text.length > MAX_TEXT_CHARS) return fail(TOO_LONG)
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) return parseJson(new TextEncoder().encode(trimmed))
  const found = CODE.exec(trimmed)
  if (!found) return fail('Paste a Polaris turn link or code first.')
  try {
    const bytes = fromBase64Url(found[2]!)
    if (found[1] === 'j') return parseJson(bytes)
    if (!compressionAvailable()) return fail('This browser is too old to unpack compressed turns. Please update it.')
    return parseJson(await transform(bytes, new DecompressionStream('deflate-raw'), MAX_JSON_BYTES))
  } catch (error) {
    return fail(error instanceof RangeError ? error.message : DAMAGED)
  }
}

export function turnLink(code: string, page: Pick<Location, 'origin' | 'pathname'>): string {
  return `${page.origin}${page.pathname}${LINK_KEY}${code}`
}

export function linkedTurn(hash: string): string | undefined {
  return hash.startsWith(LINK_KEY) ? hash.slice(LINK_KEY.length) : undefined
}
