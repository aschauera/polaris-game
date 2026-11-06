import { TERRAIN, type MapConfig, type Tile, type WorldMap } from '../game/map'
import type { ConnectionState } from '../network/client'
import type { PlayerView } from '../network/protocol'

export interface ExpeditionSummary {
  faction: string
  round: number
  movement: number
  maxMovement: number
  discovered: number
  total: number
  scoutSelected: boolean
  canOrder: boolean
  canAct?: boolean
  activeFaction?: string
}

export function createHud() {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <header class="masthead">
      <div class="brand"><span class="star" aria-hidden="true">✦</span><h1>POLARIS</h1><span class="edition">WORLD ATLAS / 01</span></div>
      <span class="prototype">EARLY EXPEDITION <span aria-hidden="true">◇</span> EXPLORE THE UNKNOWN</span>
    </header>
    <main>
      <aside class="panel" aria-label="Atlas controls">
        <div class="section-label">EXPEDITION CHART</div>
        <h2>A world of possibility.</h2>
        <p class="intro">Survey the shores. Trace the highlands.<br>An original strategy world takes shape.</p>
        <details id="network-panel">
          <summary>Online multiplayer</summary>
          <p class="help">Private two-player game. Share an invitation with your friend. Your browser keeps your seat.</p>
          <button id="resume-online">Connect / resume</button>
          <button id="create-room">Create private game</button>
          <label for="join-code">Invitation code</label>
          <input id="join-code" autocomplete="off" spellcheck="false" maxlength="69" />
          <button id="join-room">Join game</button>
          <button id="replace-invite" hidden>Replace invitation</button>
          <div id="invite-box" hidden>
            <label for="share-invite">Share this private link</label>
            <input id="share-invite" readonly />
            <button id="copy-invite">Copy invitation</button>
          </div>
          <button id="forget-session">Forget this device's seat</button>
          <p class="help">Forgetting is permanent: there is no account recovery. The abandoned seat stays reserved.</p>
        </details>
        <p id="connection-status" role="status" hidden></p>
        <button id="start-expedition" class="primary" disabled>Start expedition</button>
        <section id="expedition" class="expedition" aria-label="Expedition controls" hidden>
          <div class="section-label">SCOUT EXPEDITION</div>
          <p id="turn-info" aria-live="polite" aria-atomic="true"></p>
          <p id="scout-info"></p>
          <p id="exploration-info"></p>
          <button id="select-scout" aria-pressed="false">Select scout</button>
          <button id="move-scout" disabled>Move scout here</button>
          <div class="direction-tools" aria-label="Cardinal scout movement">
            <button id="move-north" aria-label="Move scout north">N</button>
            <button id="move-east" aria-label="Move scout east">E</button>
            <button id="move-south" aria-label="Move scout south">S</button>
            <button id="move-west" aria-label="Move scout west">W</button>
          </div>
          <p id="order-status" aria-live="polite"></p>
          <button id="end-turn" class="primary">End turn</button>
          <button id="leave-expedition">Return to atlas (discard expedition)</button>
          <p class="help">Select the gold scout, then a charted tile and Move scout here.
            N/E/S/W buttons also move the selected scout. Grassland costs 1, hills 2; water blocks movement.
            Dark tiles are uncharted, dim tiles remembered, bright tiles in sight.
            Pale land is reachable this turn. Online orders use visible tiles only; blue scouts are opponents.
            Regenerating starts a new local expedition.</p>
        </section>
        <form id="map-form" novalidate>
          <label for="seed">World seed</label><input id="seed" maxlength="64" autocomplete="off" spellcheck="false" />
          <div class="dimensions">
            <div><label for="width">Width</label><input id="width" type="number" min="8" max="256" step="1" /></div>
            <span aria-hidden="true">×</span>
            <div><label for="height">Height</label><input id="height" type="number" min="8" max="256" step="1" /></div>
          </div>
          <button class="primary" type="submit">Regenerate atlas <span aria-hidden="true">↗</span></button>
        </form>
        <div class="presets"><button id="showcase">32² showcase</button><button id="fixture">256² fixture</button></div>
        <p id="error" role="alert" hidden></p>
        <section class="tile-card" aria-labelledby="tile-heading">
          <div class="section-label" id="tile-heading">SELECTED TERRITORY</div>
          <div id="selection" role="status" aria-live="polite">No tile selected</div>
          <div id="hover">Hover over the map to survey a tile.</div>
        </section>
        <section class="legend" aria-label="Terrain legend">
          <div><i class="grass"></i> Grassland <small>low plateau</small></div>
          <div><i class="water"></i> Water <small>blue shelf</small></div>
          <div><i class="hills"></i> Hills <small>raised block</small></div>
        </section>
        <p class="scope">PROCEDURAL PLACEHOLDERS<br>Scout exploration is playable. Cities, combat &amp; AI are still planned.</p>
      </aside>
      <section class="atlas" aria-label="Isometric world map">
        <div class="atlas-heading"><span id="world-info">Preparing atlas…</span><span class="north">N ↖</span></div>
        <canvas id="world" tabindex="0" aria-label="Voxel map. Drag to pan, pinch or scroll to zoom, tap to select. Arrow keys pan; plus and minus zoom; R resets."></canvas>
        <div class="camera-tools" aria-label="Camera controls">
          <button id="zoom-in" aria-label="Zoom in">+</button><button id="zoom-out" aria-label="Zoom out">−</button><button id="reset">Reset view</button>
        </div>
        <div class="map-caption"><span id="map-status">Awaiting rendered world</span><span>ORTHOGRAPHIC / ISOMETRIC</span></div>
      </section>
    </main>
    <footer><span>✦ EVERY EXPEDITION BEGINS WITH A STEP.</span><span>DRAG · PAN &nbsp; SCROLL · ZOOM &nbsp; CLICK · INSPECT</span></footer>
  `
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id)! as T
  const inputs = { seed: get<HTMLInputElement>('seed'), width: get<HTMLInputElement>('width'), height: get<HTMLInputElement>('height') }
  const directions = {
    north: get<HTMLButtonElement>('move-north'), east: get<HTMLButtonElement>('move-east'),
    south: get<HTMLButtonElement>('move-south'), west: get<HTMLButtonElement>('move-west'),
  }
  const selection = (tile?: Tile) => {
    get('selection').textContent = tile ? `(${tile.x}, ${tile.z}) · ${TERRAIN[tile.terrain].name} · Tile ${tile.id}` : 'No tile selected'
  }
  const hover = (tile?: Tile) => {
    get('hover').textContent = tile ? `Surveying (${tile.x}, ${tile.z}) · ${TERRAIN[tile.terrain].name}` : 'Hover over the map to survey a tile.'
  }
  return {
    inputs, selection, hover, directions,
    canvas: get<HTMLCanvasElement>('world'), form: get<HTMLFormElement>('map-form'),
    reset: get<HTMLButtonElement>('reset'), zoomIn: get<HTMLButtonElement>('zoom-in'),
    zoomOut: get<HTMLButtonElement>('zoom-out'), fixture: get<HTMLButtonElement>('fixture'),
    showcase: get<HTMLButtonElement>('showcase'),
    startExpedition: get<HTMLButtonElement>('start-expedition'), leaveExpedition: get<HTMLButtonElement>('leave-expedition'),
    selectScout: get<HTMLButtonElement>('select-scout'), moveScout: get<HTMLButtonElement>('move-scout'),
    endTurn: get<HTMLButtonElement>('end-turn'),
    networkPanel: get<HTMLDetailsElement>('network-panel'),
    resumeOnline: get<HTMLButtonElement>('resume-online'), createRoom: get<HTMLButtonElement>('create-room'),
    joinRoom: get<HTMLButtonElement>('join-room'), joinCode: get<HTMLInputElement>('join-code'),
    replaceInvite: get<HTMLButtonElement>('replace-invite'), forgetSession: get<HTMLButtonElement>('forget-session'),
    copyInvite: get<HTMLButtonElement>('copy-invite'), shareInvite: get<HTMLInputElement>('share-invite'),
    connection: (state: ConnectionState) => {
      get('connection-status').hidden = false
      if (get('connection-status').textContent !== state.message) get('connection-status').textContent = state.message
      for (const id of ['create-room', 'join-room', 'resume-online', 'replace-invite']) get<HTMLButtonElement>(id).disabled = state.busy
    },
    online: (view?: PlayerView) => {
      document.body.classList.toggle('online-game', !!view)
      get('replace-invite').hidden = view?.status !== 'waiting' || view.factionId !== 'meridian'
      get('leave-expedition').textContent = view ? 'Return to atlas (keep online seat)' : 'Return to atlas (discard expedition)'
      if (view?.status !== 'waiting') { get('invite-box').hidden = true; get<HTMLInputElement>('share-invite').value = '' }
      if (!view) return
      get('world-info').textContent = `PRIVATE GAME / ${view.width} x ${view.height}`
      get('map-status').textContent = `Revision ${view.revision} / ${view.status === 'waiting' ? 'Waiting for player 2' : `${view.activeFaction} turn`}`
    },
    invitation: (invite: string) => {
      const url = new URL(location.pathname, location.origin)
      url.hash = `invite=${invite}`
      get<HTMLInputElement>('share-invite').value = url.href
      get('invite-box').hidden = false
      get<HTMLDetailsElement>('network-panel').open = true
    },
    expedition: (summary?: ExpeditionSummary) => {
      document.body.classList.toggle('exploring', !!summary)
      get('expedition').hidden = !summary
      get('start-expedition').hidden = !!summary
      if (!summary) return
      get('turn-info').textContent = `Turn ${summary.round} · ${summary.faction}${summary.activeFaction ? ` / ${summary.activeFaction} to play` : ''}`
      get('scout-info').textContent = `Scout · ${summary.movement}/${summary.maxMovement} movement`
      get('exploration-info').textContent = `${summary.discovered}/${summary.total} tiles charted`
      get('select-scout').setAttribute('aria-pressed', String(summary.scoutSelected))
      get<HTMLButtonElement>('move-scout').disabled = !summary.canOrder || summary.canAct === false
      get<HTMLButtonElement>('end-turn').disabled = summary.canAct === false
      for (const button of Object.values(directions)) button.disabled = !summary.scoutSelected || summary.canAct === false
    },
    order: (message: string, rejected = false) => {
      get('order-status').textContent = message
      get('order-status').classList.toggle('rejected', rejected)
    },
    config: (): MapConfig => ({ seed: inputs.seed.value, width: inputs.width.valueAsNumber, height: inputs.height.valueAsNumber }),
    dimensions: (size: number) => { inputs.width.value = String(size); inputs.height.value = String(size) },
    error: (message: string) => {
      get('error').textContent = message
      get('error').hidden = false
      get('map-status').textContent = 'Request failed — no new atlas loaded'
    },
    loaded: (map: WorldMap) => {
      get('error').hidden = true
      get<HTMLButtonElement>('start-expedition').disabled = false
      get('world-info').textContent = `${map.seed} / ${map.width} × ${map.height}`
      get('map-status').textContent = `${map.tiles.length.toLocaleString('en-US')} TILES · GENERATOR ${String(map.generatorVersion).padStart(2, '0')}`
    },
  }
}
