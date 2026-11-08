export interface MessengerHandlers {
  start(): void
  open(text: string): void
  openFile(file: File): void
  leave(): void
}

export interface Outbox {
  readonly code: string
  readonly link: string
  readonly fileName: string
}

export interface MatchView {
  readonly status: string
  // While the opponent is on turn, this device holds a finished turn to send and waits for the answer.
  readonly waiting: boolean
  // Unset while the finished turn is still being packed.
  readonly outbox?: Outbox
}

const LONG_LINK = 3500
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

// The async clipboard needs a secure context; selecting a temporary field still works on plain http.
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fall through to the selection-based copy below.
  }
  const field = document.createElement('textarea')
  field.value = text
  field.readOnly = true
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.append(field)
  field.select()
  field.setSelectionRange(0, text.length)
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
  }
}

export function createMessengerPanel(root: HTMLElement, handlers: MessengerHandlers) {
  root.innerHTML = `
    <div class="section-label">PLAY BY MESSENGER</div>
    <p id="messenger-status" class="messenger-status" aria-live="polite" hidden></p>
    <div id="messenger-intro">
      <p>Two players, no server: finish your turn, send it through any messenger, and your opponent answers the same way.</p>
      <button id="messenger-start" type="button" disabled>Start messenger match</button>
    </div>
    <div id="messenger-outbox" hidden>
      <p id="messenger-outbox-text"></p>
      <div class="messenger-actions">
        <button id="messenger-share" type="button" hidden>Share…</button>
        <button id="messenger-copy-link" type="button">Copy link</button>
        <button id="messenger-copy-code" type="button">Copy code</button>
        <button id="messenger-save" type="button">Save file</button>
      </div>
      <label for="messenger-link">Turn link</label>
      <textarea id="messenger-link" rows="3" readonly spellcheck="false"></textarea>
      <p id="messenger-hint" class="messenger-hint" hidden></p>
    </div>
    <details id="messenger-inbox-group">
      <summary>Open a received turn</summary>
      <label for="messenger-inbox">Link or code from your messenger</label>
      <textarea id="messenger-inbox" rows="3" spellcheck="false" autocomplete="off" autocapitalize="off"
        placeholder="Paste it here"></textarea>
      <div class="messenger-actions">
        <button id="messenger-open" type="button">Open turn</button>
        <button id="messenger-open-file" type="button">Open file…</button>
      </div>
      <input id="messenger-file" type="file" accept=".txt,.polaris,text/plain" hidden />
    </details>
    <p id="messenger-notice" class="messenger-notice" aria-live="polite" aria-atomic="true" hidden></p>
    <div id="messenger-leave-group" hidden>
      <button id="messenger-leave" type="button">Leave match</button>
      <div id="messenger-confirm" hidden>
        <p>Leave this match? This device forgets it; your opponent keeps their copy.</p>
        <div class="messenger-actions">
          <button id="messenger-leave-yes" type="button">Leave match</button>
          <button id="messenger-leave-no" type="button">Keep playing</button>
        </div>
      </div>
    </div>
  `
  const get = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!
  const status = get('messenger-status')
  const intro = get('messenger-intro')
  const start = get<HTMLButtonElement>('messenger-start')
  const outboxGroup = get('messenger-outbox')
  const outboxText = get('messenger-outbox-text')
  const share = get<HTMLButtonElement>('messenger-share')
  const copyLink = get<HTMLButtonElement>('messenger-copy-link')
  const copyCode = get<HTMLButtonElement>('messenger-copy-code')
  const save = get<HTMLButtonElement>('messenger-save')
  const link = get<HTMLTextAreaElement>('messenger-link')
  const hint = get('messenger-hint')
  const inboxGroup = get<HTMLDetailsElement>('messenger-inbox-group')
  const inbox = get<HTMLTextAreaElement>('messenger-inbox')
  const file = get<HTMLInputElement>('messenger-file')
  const noticeLine = get('messenger-notice')
  const leaveGroup = get('messenger-leave-group')
  const leave = get<HTMLButtonElement>('messenger-leave')
  const confirm = get('messenger-confirm')
  let outbox: Outbox | undefined

  const notice = (text: string, rejected = false) => {
    noticeLine.textContent = text
    noticeLine.hidden = !text
    noticeLine.classList.toggle('rejected', rejected)
  }
  const resetConfirm = () => { confirm.hidden = true; leave.hidden = false }

  share.hidden = typeof navigator.share !== 'function'
  start.addEventListener('click', () => handlers.start())
  get('messenger-open').addEventListener('click', () => handlers.open(inbox.value))
  get('messenger-open-file').addEventListener('click', () => file.click())
  file.addEventListener('change', () => {
    const picked = file.files?.[0]
    // Clearing the input lets the same file be chosen again after a failed attempt.
    file.value = ''
    if (picked) handlers.openFile(picked)
  })
  link.addEventListener('focus', () => link.select())
  copyLink.addEventListener('click', async () => {
    if (!outbox) return
    if (await copyText(outbox.link)) notice('Link copied. Paste it into your messenger.')
    else notice('Copying is not possible here. Select the link and copy it by hand.', true)
  })
  copyCode.addEventListener('click', async () => {
    if (!outbox) return
    if (await copyText(outbox.code)) notice('Code copied. Your opponent can paste it under “Open a received turn”.')
    else notice('Copying is not possible here. Copy the link above or save the file instead.', true)
  })
  share.addEventListener('click', async () => {
    if (!outbox) return
    try {
      await navigator.share({ title: 'Polaris turn', text: `My Polaris turn. Open the link to play yours:\n${outbox.link}` })
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        notice('Sharing is not available here. Copy the link instead.', true)
      }
    }
  })
  save.addEventListener('click', () => {
    if (!outbox) return
    const text = 'Polaris turn\nOpen Polaris, choose “Open file…” and select this file, or paste the code below into the box.\n\n' +
      `${outbox.code}\n`
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = outbox.fileName
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    notice('Turn saved as a file. Attach it in your messenger.')
  })
  leave.addEventListener('click', () => { leave.hidden = true; confirm.hidden = false })
  get('messenger-leave-no').addEventListener('click', () => { resetConfirm(); leave.focus() })
  get('messenger-leave-yes').addEventListener('click', () => { resetConfirm(); handlers.leave() })

  return {
    hide() { root.hidden = true },
    // No match running: offer to start one, or to open a turn received from someone else.
    idle(canStart: boolean) {
      root.hidden = false
      intro.hidden = false
      start.disabled = !canStart
      status.hidden = true
      outboxGroup.hidden = true
      inboxGroup.hidden = false
      leaveGroup.hidden = true
      outbox = undefined
      resetConfirm()
    },
    match(view: MatchView) {
      root.hidden = false
      intro.hidden = true
      status.textContent = view.status
      status.hidden = false
      outboxGroup.hidden = !view.waiting
      inboxGroup.hidden = !view.waiting
      if (view.waiting) inboxGroup.open = true
      leaveGroup.hidden = false
      outbox = view.outbox
      for (const button of [share, copyLink, copyCode, save]) button.disabled = !outbox
      outboxText.textContent = outbox
        ? 'Your turn is ready. Send it to your opponent: they open the link, play their turn and send theirs back.'
        : 'Packing your turn…'
      link.value = outbox?.link ?? ''
      const hints: string[] = []
      if (outbox && LOOPBACK_HOSTS.has(location.hostname)) {
        hints.push('This link only opens on this computer. Send the code instead, or open the game from an address both of you can reach.')
      }
      if (outbox && outbox.link.length > LONG_LINK) {
        hints.push('This turn is long and some messengers cut long messages. If it does not arrive complete, send the file.')
      }
      hint.textContent = hints.join(' ')
      hint.hidden = !hints.length
    },
    notice,
    // Text stays visible for correction after a failed attempt; clearing folds the box away again.
    fill(text: string) { inbox.value = text; inboxGroup.open = text !== '' },
    // After ending a turn the share buttons may sit above the visible part of the panel.
    reveal() { root.scrollIntoView({ block: 'start' }) },
  }
}
