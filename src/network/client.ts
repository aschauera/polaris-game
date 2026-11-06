import { INVITE, isOrder, isReply, record, UUID, type OnlineAction, type OnlineOrder, type OnlineReply, type PlayerView } from './protocol'

interface PendingOrder { roomId: string; order: OnlineOrder }
export interface ConnectionState { connected: boolean; busy: boolean; message: string }
class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
const PENDING = 'polaris.pending-order.v1'
const RESUME = 'polaris.online.v1'

export class OnlineClient {
  private view: PlayerView | null = null
  private connected = false
  private busy = false
  private enabled = false
  private timer?: ReturnType<typeof setTimeout>
  private pending?: PendingOrder
  private readonly onView: (view: PlayerView | null) => void
  private readonly onStatus: (state: ConnectionState) => void
  private readonly onReply: (reply: OnlineReply) => void
  private readonly wake = () => { if (this.enabled && !document.hidden) void this.refresh() }
  private readonly offline = () => { if (this.enabled) { this.connected = false; this.status('Offline. Online orders are disabled.') } }

  constructor(onView: (view: PlayerView | null) => void, onStatus: (state: ConnectionState) => void,
    onReply: (reply: OnlineReply) => void) {
    this.onView = onView
    this.onStatus = onStatus
    this.onReply = onReply
    window.addEventListener('online', this.wake)
    window.addEventListener('offline', this.offline)
    document.addEventListener('visibilitychange', this.wake)
  }

  private status(message: string): void {
    this.onStatus({ connected: this.connected, busy: this.busy || !!this.pending, message })
  }
  private async request(path: string, method = 'GET', data?: unknown): Promise<OnlineReply> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await fetch(`/api/${path}`, { method, credentials: 'same-origin', cache: 'no-store',
        headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: data === undefined ? undefined : JSON.stringify(data), signal: controller.signal })
      const value: unknown = await response.json()
      if (!response.ok) throw new HttpError(response.status,
        record(value) && typeof value.error === 'string' ? value.error : `Server returned HTTP ${response.status}.`)
      if (!isReply(value)) throw new Error('Unsupported or invalid server response. Reload after updating the app.')
      return value
    } finally { clearTimeout(timeout) }
  }
  private accept(reply: OnlineReply): void {
    if (!this.enabled) return
    this.connected = true
    if (reply.view?.roomId !== this.view?.roomId || reply.view?.revision !== this.view?.revision) {
      this.view = reply.view
      this.onView(reply.view)
    }
    this.onReply(reply)
  }
  private readPending(): void {
    const saved = sessionStorage.getItem(PENDING)
    if (!saved) { this.pending = undefined; return }
    const value: unknown = JSON.parse(saved)
    if (!record(value) || typeof value.roomId !== 'string' || !UUID.test(value.roomId) || !isOrder(value.order)) {
      throw new Error('Invalid saved pending order. Forget this device session before continuing.')
    }
    this.pending = { roomId: value.roomId, order: value.order }
  }
  private clearPending(): void { sessionStorage.removeItem(PENDING); this.pending = undefined }
  private async sendPending(): Promise<void> {
    if (!this.pending) return
    if (this.view?.roomId !== this.pending.roomId) throw new Error('A pending order belongs to another room. Forget this session first.')
    try {
      const reply = await this.request('commands', 'POST', this.pending.order)
      this.clearPending()
      this.accept(reply)
    } catch (error) {
      if (error instanceof HttpError && [400, 403, 409, 422].includes(error.status)) {
        this.clearPending()
        this.accept(await this.request('session'))
      }
      throw error
    }
  }
  private failure(error: unknown): void {
    this.connected = error instanceof HttpError && error.status !== 401 && error.status !== 410 && error.status < 500
    this.status(`${error instanceof Error ? error.message : 'Connection failed.'}${this.pending ? ' Pending order retained for safe retry.' : ''}`)
  }
  private schedule(): void {
    clearTimeout(this.timer)
    if (this.enabled && (this.view || this.pending)) {
      this.timer = setTimeout(() => { void this.refresh() }, this.connected ? 1500 : 5000)
    }
  }
  private async run(operation: () => Promise<void>): Promise<void> {
    if (this.busy) return
    this.busy = true
    this.status('Synchronizing...')
    try { await operation(); this.busy = false; this.status(this.view?.status === 'waiting' ? 'Waiting for the invited player.' : 'Connected. State synchronized.') }
    catch (error) { this.busy = false; this.failure(error) }
    finally { this.schedule() }
  }
  async connect(): Promise<void> {
    this.enabled = true
    await this.run(async () => {
      sessionStorage.setItem(RESUME, '1')
      this.readPending()
      this.accept(await this.request('session', 'POST', {}))
      await this.sendPending()
    })
  }
  async create(): Promise<void> {
    this.enabled = true
    await this.run(async () => {
      sessionStorage.setItem(RESUME, '1')
      this.readPending()
      this.accept(await this.request('session', 'POST', {}))
      if (this.pending) { await this.sendPending(); return }
      this.accept(await this.request('rooms', 'POST', {}))
    })
  }
  async join(invite: string): Promise<void> {
    this.enabled = true
    await this.run(async () => {
      if (!INVITE.test(invite)) throw new Error('Enter the invitation code shared by the host.')
      sessionStorage.setItem(RESUME, '1')
      this.readPending()
      this.accept(await this.request('session', 'POST', {}))
      if (this.pending) throw new Error('Resolve the pending order before joining another room.')
      this.accept(await this.request('join', 'POST', { invite }))
    })
  }
  async replaceInvite(): Promise<void> {
    await this.run(async () => { this.accept(await this.request('invite', 'POST', {})) })
  }
  async command(action: OnlineAction): Promise<void> {
    if (!this.enabled || !this.view || !this.connected || this.pending || !navigator.onLine) {
      this.status('Reconnect and resolve any pending order before sending another.'); return
    }
    await this.run(async () => {
      const pending = { roomId: this.view!.roomId,
        order: { requestId: crypto.randomUUID(), revision: this.view!.revision, action } }
      sessionStorage.setItem(PENDING, JSON.stringify(pending))
      this.pending = pending
      await this.sendPending()
    })
  }
  async refresh(): Promise<void> {
    if (!this.enabled || document.hidden || !navigator.onLine) { this.schedule(); return }
    await this.run(async () => {
      this.accept(await this.request('session'))
      await this.sendPending()
    })
  }
  async forget(): Promise<void> {
    await this.run(async () => {
      this.accept(await this.request('session', 'DELETE'))
      this.clearPending()
      sessionStorage.removeItem(RESUME)
      this.enabled = false
    })
  }
  pause(): void {
    this.enabled = false
    this.view = null
    clearTimeout(this.timer)
    try { sessionStorage.removeItem(RESUME) }
    catch (error) { this.failure(error); return }
    this.status('Local atlas. Your online seat is kept; use Resume to return.')
  }
  shouldResume(): boolean {
    try { return sessionStorage.getItem(RESUME) === '1' }
    catch (error) { this.failure(error); return false }
  }
  dispose(): void {
    this.pause()
    window.removeEventListener('online', this.wake)
    window.removeEventListener('offline', this.offline)
    document.removeEventListener('visibilitychange', this.wake)
  }
}
