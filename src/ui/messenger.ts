import { TRIBES, TRIBE_IDS, type TribeId } from '../game/scenario'

export interface MessengerHandlers {
  start(tribes: readonly [TribeId, TribeId]): void
  open(text: string): void
  openFile(file: File): void
  resume(matchId: string): void
  rename(name: string): void
  // Back to the match list; the match stays saved on this device.
  shelve(): void
  leave(): void
}

export interface SavedMatchEntry {
  readonly matchId: string
  readonly title: string
  readonly detail: string
  readonly yourTurn: boolean
}

export interface Outbox {
  readonly code: string
  readonly link: string
  readonly fileName: string
}

export interface MatchView {
  readonly matchId: string
  readonly status: string
  readonly name: string
  readonly nameLimit: number
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
      <p>Two players, no server: finish your turn, send it through any messenger, and your opponent answers the same way.
        Run as many matches as you like; each one is kept on this device.</p>
      <label for="messenger-player-one-tribe">Player 1 tribe</label>
      <select id="messenger-player-one-tribe"></select>
      <label for="messenger-player-two-tribe">Player 2 tribe</label>
      <select id="messenger-player-two-tribe"></select>
      <p>Each player starts with one free scout and founder; there is no starting army or global stockpile.
        Tribes are presentation-only. Choose independently; mirror matches are allowed.</p>
      <p id="messenger-topology-note" aria-live="polite" hidden></p>
      <button id="messenger-start" type="button" disabled>Start messenger match</button>
    </div>
    <div id="messenger-saved" hidden>
      <p class="messenger-subhead">Your matches</p>
      <ul id="messenger-saved-list" class="saved-matches"></ul>
    </div>
    <div id="messenger-name-group" hidden>
      <label for="messenger-name">Match name, only on this device</label>
      <input id="messenger-name" type="text" autocomplete="off" spellcheck="false" placeholder="For example your opponent's name" />
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
    <p id="messenger-storage-status" class="messenger-notice rejected" aria-live="polite" aria-atomic="true" hidden></p>
    <p id="messenger-notice" class="messenger-notice" aria-live="polite" aria-atomic="true" hidden></p>
    <div id="messenger-leave-group" hidden>
      <div id="messenger-exit" class="messenger-actions">
        <button id="messenger-shelve" type="button">All matches</button>
        <button id="messenger-leave" type="button">Leave match</button>
      </div>
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
  const topologyNote = get('messenger-topology-note')
  const tribeChoices = [
    get<HTMLSelectElement>('messenger-player-one-tribe'),
    get<HTMLSelectElement>('messenger-player-two-tribe'),
  ] as const
  for (const choice of tribeChoices) {
    choice.replaceChildren(...TRIBE_IDS.map(id => {
      const option = document.createElement('option')
      option.value = id
      option.textContent = TRIBES[id]
      return option
    }))
  }
  tribeChoices[1].value = 'raccoons'
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
  const exitActions = get('messenger-exit')
  const leave = get<HTMLButtonElement>('messenger-leave')
  const confirm = get('messenger-confirm')
  const savedGroup = get('messenger-saved')
  const savedList = get<HTMLUListElement>('messenger-saved-list')
  const nameGroup = get('messenger-name-group')
  const nameField = get<HTMLInputElement>('messenger-name')
  let outbox: Outbox | undefined
  let shownMatchId: string | undefined

  const notice = (text: string, rejected = false) => {
    noticeLine.textContent = text
    noticeLine.hidden = !text
    noticeLine.classList.toggle('rejected', rejected)
  }
  const resetConfirm = () => { confirm.hidden = true; exitActions.hidden = false }
  // Names are typed by the player, so entries are built as text nodes and never parsed as markup.
  const savedEntry = (entry: SavedMatchEntry) => {
    const item = document.createElement('li')
    item.className = entry.yourTurn ? 'saved-match your-turn' : 'saved-match'
    const title = document.createElement('strong')
    title.textContent = entry.title
    const detail = document.createElement('span')
    detail.textContent = entry.detail
    const text = document.createElement('div')
    text.append(title, detail)
    const resume = document.createElement('button')
    resume.type = 'button'
    resume.textContent = 'Continue'
    resume.setAttribute('aria-label', `Continue ${entry.title}`)
    resume.addEventListener('click', () => handlers.resume(entry.matchId))
    item.append(text, resume)
    return item
  }

  share.hidden = typeof navigator.share !== 'function'
  start.addEventListener('click', () => {
    const first = TRIBE_IDS.find(id => id === tribeChoices[0].value)
    const second = TRIBE_IDS.find(id => id === tribeChoices[1].value)
    if (first && second) handlers.start([first, second])
  })
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
  leave.addEventListener('click', () => { exitActions.hidden = true; confirm.hidden = false })
  get('messenger-leave-no').addEventListener('click', () => { resetConfirm(); leave.focus() })
  get('messenger-leave-yes').addEventListener('click', () => { resetConfirm(); handlers.leave() })
  get('messenger-shelve').addEventListener('click', () => handlers.shelve())
  nameField.addEventListener('change', () => {
    nameField.value = nameField.value.trim()
    handlers.rename(nameField.value)
  })

  return {
    hide() { root.hidden = true },
    // No match open: offer to start one, continue a saved one, or open a turn received from someone else.
    idle(canStart: boolean, saved: readonly SavedMatchEntry[] = [], startReason = '') {
      root.hidden = false
      intro.hidden = false
      start.disabled = !canStart
      topologyNote.textContent = startReason
      topologyNote.hidden = !startReason
      status.hidden = true
      savedGroup.hidden = !saved.length
      savedList.replaceChildren(...saved.map(savedEntry))
      nameGroup.hidden = true
      outboxGroup.hidden = true
      inboxGroup.hidden = false
      leaveGroup.hidden = true
      outbox = undefined
      shownMatchId = undefined
      resetConfirm()
    },
    match(view: MatchView) {
      // A received turn can switch matches; a pending leave or a half-typed name belongs to the previous one.
      const switched = view.matchId !== shownMatchId
      shownMatchId = view.matchId
      if (switched) resetConfirm()
      root.hidden = false
      intro.hidden = true
      savedGroup.hidden = true
      status.textContent = view.status
      status.hidden = false
      nameGroup.hidden = false
      nameField.maxLength = view.nameLimit
      // Re-rendering the same match while the player types would throw their edit away.
      if (switched || document.activeElement !== nameField) nameField.value = view.name
      outboxGroup.hidden = !view.waiting
      // A turn for another match can arrive at any time, so the inbox stays available, folded on your turn.
      inboxGroup.hidden = false
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
    storage(text: string) {
      const line = get('messenger-storage-status')
      line.textContent = text
      line.hidden = !text
    },
    notice,
    // Text stays visible for correction after a failed attempt; clearing folds the box away again.
    fill(text: string) { inbox.value = text; inboxGroup.open = text !== '' },
    // After ending a turn the share buttons may sit above the visible part of the panel.
    reveal() { root.scrollIntoView({ block: 'start' }) },
  }
}
