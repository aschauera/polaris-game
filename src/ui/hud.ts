import { PRODUCTION_ITEMS } from '../game/expedition'
import { TERRAIN, type MapConfig, type Tile, type WorldMap } from '../game/map'

/** Direction-pad buttons, named by where the neighbouring hex appears on screen. */
export const SCREEN_DIRECTIONS = ['up-left', 'up', 'up-right', 'down-left', 'down', 'down-right'] as const
export type ScreenDirection = typeof SCREEN_DIRECTIONS[number]

export interface ExpeditionSummary {
  faction: string
  round: number
  movement: number
  maxMovement: number
  discovered: number
  total: number
  scoutSelected: boolean
  unitSelected: boolean
  unitName?: string
  canOrder: boolean
  // Messenger matches lock the controls while the opponent is on turn; a solo expedition always may act.
  canAct?: boolean
  inMatch?: boolean
  status?: string
}

export interface CitySummary {
  id: string
  name: string
  x: number
  z: number
  population: number
  food: number
  foodYield: number
  foodConsumption: number
  materials: number
  materialYield: number
  production?: { name: string; progress: number; cost: number }
  storehouse: boolean
  claimCount: number
  units: readonly string[]
}

export interface FounderSummary { x: number; z: number }

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
        <button id="start-expedition" class="primary" disabled>Start expedition</button>
        <section id="messenger" class="messenger" aria-label="Play by messenger" hidden></section>
        <section id="expedition" class="expedition" aria-label="Expedition controls" hidden>
          <div class="section-label">EXPEDITION</div>
          <p id="turn-info" aria-live="polite" aria-atomic="true"></p>
          <p id="scout-info"></p>
          <p id="exploration-info"></p>
          <button id="select-scout" aria-pressed="false">Select scout</button>
          <button id="move-scout" disabled>Move unit here</button>
          <button id="found-city" disabled>Found city</button>
          <section id="city-controls" aria-label="City economy" hidden>
            <label for="city-choice">City</label><select id="city-choice"></select>
            <p id="city-info" aria-live="polite"></p>
            <label for="production-choice">Production</label>
            <select id="production-choice"></select>
            <button id="queue-production">Queue production</button>
          </section>
          <div class="direction-tools" aria-label="Hex unit movement">
            <button id="move-up-left" aria-label="Move unit up and left">↖</button>
            <button id="move-up" aria-label="Move unit up">↑</button>
            <button id="move-up-right" aria-label="Move unit up and right">↗</button>
            <button id="move-down-left" aria-label="Move unit down and left">↙</button>
            <button id="move-down" aria-label="Move unit down">↓</button>
            <button id="move-down-right" aria-label="Move unit down and right">↘</button>
          </div>
          <p id="order-status" aria-live="polite"></p>
          <button id="end-turn" class="primary">End turn</button>
          <button id="leave-expedition">Return to atlas (discard expedition)</button>
          <p class="help">Tap or click a unit, then a highlighted hex to move immediately.
            Glowing units can still move; glowing cities need production. Tap a city or its name to choose production.
            The six arrows step the selected unit to a neighbouring hex. Grassland costs 1, hills 2; water blocks movement.
            Dark hexes are uncharted, dim hexes remembered, bright hexes in sight.
            Outlined hexes are reachable this turn; coloured borders mark city territory.<span id="help-regenerate"> Regenerating starts a new expedition.</span></p>
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
        <p id="world-lock" class="lock-note" hidden>The world is fixed while a messenger match is running.</p>
        <p id="error" role="alert" hidden></p>
        <section class="tile-card" aria-labelledby="tile-heading">
          <div class="section-label" id="tile-heading">SELECTED TERRITORY</div>
          <div id="selection" role="status" aria-live="polite">No tile selected</div>
          <div id="resource-info" aria-live="polite" hidden></div>
          <div id="hover">Hover over the map to survey a tile.</div>
        </section>
        <section class="legend" aria-label="Terrain legend">
          <div><i class="grass"></i> Grassland <small>low plateau</small></div>
          <div><i class="water"></i> Water <small>blue shelf</small></div>
          <div><i class="hills"></i> Hills <small>low upland</small></div>
        </section>
        <p class="scope">PROCEDURAL PLACEHOLDERS<br>Scout exploration and the first city economy are playable. Combat &amp; AI remain planned.</p>
      </aside>
      <section class="atlas" aria-label="Isometric world map">
        <div class="atlas-heading"><span id="world-info">Preparing atlas…</span><span class="north">N ↖</span></div>
        <canvas id="world" tabindex="0" aria-label="Voxel map. Drag to pan, scroll to zoom, click to select. Arrow keys pan; plus and minus zoom; R resets."></canvas>
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
  const productionChoice = get<HTMLSelectElement>('production-choice')
  productionChoice.replaceChildren(...Object.entries(PRODUCTION_ITEMS).map(([id, item]) => {
    const option = document.createElement('option')
    option.value = id
    option.textContent = `${item.name} · ${item.cost} materials`
    return option
  }))
  const directions = Object.fromEntries(SCREEN_DIRECTIONS.map(direction =>
    [direction, get<HTMLButtonElement>(`move-${direction}`)])) as Record<ScreenDirection, HTMLButtonElement>
  const selection = (tile?: Tile, resource?: string) => {
    get('selection').textContent = tile ? `(${tile.x}, ${tile.z}) · ${TERRAIN[tile.terrain].name} · Tile ${tile.id}` : 'No tile selected'
    get('resource-info').hidden = !tile || !resource
    get('resource-info').textContent = tile && resource ? `${resource} · Visual occurrence; harvesting is not available yet.` : ''
  }
  const hover = (tile?: Tile, resource?: string) => {
    get('hover').textContent = tile ? `Surveying (${tile.x}, ${tile.z}) · ${TERRAIN[tile.terrain].name}${resource ? ` · ${resource}` : ''}`
      : 'Hover over the map to survey a tile.'
  }
  return {
    inputs, selection, hover, directions,
    messenger: get('messenger'),
    canvas: get<HTMLCanvasElement>('world'), form: get<HTMLFormElement>('map-form'),
    reset: get<HTMLButtonElement>('reset'), zoomIn: get<HTMLButtonElement>('zoom-in'),
    zoomOut: get<HTMLButtonElement>('zoom-out'), fixture: get<HTMLButtonElement>('fixture'),
    showcase: get<HTMLButtonElement>('showcase'),
    startExpedition: get<HTMLButtonElement>('start-expedition'), leaveExpedition: get<HTMLButtonElement>('leave-expedition'),
    selectScout: get<HTMLButtonElement>('select-scout'), moveScout: get<HTMLButtonElement>('move-scout'),
    endTurn: get<HTMLButtonElement>('end-turn'), foundCity: get<HTMLButtonElement>('found-city'),
    cityChoice: get<HTMLSelectElement>('city-choice'), productionChoice,
    queueProduction: get<HTMLButtonElement>('queue-production'),
    selectedCityId: () => get<HTMLSelectElement>('city-choice').value,
    revealCity: () => get('city-controls').scrollIntoView({ block: 'nearest' }),
    cities: (cities: readonly CitySummary[], founder?: FounderSummary, canAct = true, selectedCityId?: string) => {
      const founderButton = get<HTMLButtonElement>('found-city')
      founderButton.disabled = !founder || !canAct
      founderButton.textContent = founder ? `Found city at (${founder.x}, ${founder.z})` : 'Found city'
      const controls = get('city-controls')
      controls.hidden = !cities.length
      const cityChoice = get<HTMLSelectElement>('city-choice')
      const previous = selectedCityId ?? cityChoice.value
      cityChoice.replaceChildren(...cities.map(city => {
        const option = document.createElement('option')
        option.value = city.id
        option.textContent = `${city.name} (${city.x}, ${city.z})`
        return option
      }))
      if (cities.some(city => city.id === previous)) cityChoice.value = previous
      const city = cities.find(item => item.id === cityChoice.value)
      const info = get('city-info')
      if (!city) { info.textContent = ''; return }
      const foodStatus = city.food + city.foodYield >= city.foodConsumption ? 'fed' : 'not fully fed'
      const production = city.production
        ? `Queue: ${city.production.name} · ${city.production.progress}/${city.production.cost} materials`
        : 'No production queued'
      info.textContent = `Population ${city.population} · Food ${city.food} (+${city.foodYield}/turn; ${city.foodConsumption} consumed, ${foodStatus}) · ` +
        `Materials ${city.materials} (+${city.materialYield}/turn) · ${city.claimCount} claimed tiles · ` +
        `${city.storehouse ? 'Storehouse built' : 'No storehouse'} · ${production} · ` +
        `Units: ${city.units.length ? city.units.join(', ') : 'none'}`
      const choice = get<HTMLSelectElement>('production-choice')
      choice.disabled = !canAct || !!city.production
      const duplicateStorehouse = choice.value === 'storehouse' && city.storehouse
      get<HTMLButtonElement>('queue-production').disabled = !canAct || !!city.production || duplicateStorehouse
    },
    expedition: (summary?: ExpeditionSummary) => {
      document.body.classList.toggle('exploring', !!summary)
      get('expedition').hidden = !summary
      get('start-expedition').hidden = !!summary
      if (!summary) {
        get('city-controls').hidden = true
        get<HTMLButtonElement>('found-city').disabled = true
        return
      }
      const canAct = summary.canAct !== false
      get('turn-info').textContent = `Turn ${summary.round} · ${summary.faction}${summary.status ? ` · ${summary.status}` : ''}`
      const name = summary.unitName && summary.unitName[0]!.toUpperCase() + summary.unitName.slice(1)
      get('scout-info').textContent = name ? `${name} · ${summary.movement}/${summary.maxMovement} movement` : 'No unit selected'
      get('exploration-info').textContent = `${summary.discovered}/${summary.total} tiles charted`
      get('select-scout').setAttribute('aria-pressed', String(summary.scoutSelected))
      get<HTMLButtonElement>('move-scout').disabled = !summary.canOrder
      for (const button of Object.values(directions)) button.disabled = !summary.unitSelected || !canAct
      get<HTMLButtonElement>('end-turn').disabled = !canAct
      get('leave-expedition').hidden = !!summary.inMatch
      get('help-regenerate').hidden = !!summary.inMatch
    },
    order: (message: string, rejected = false) => {
      get('order-status').textContent = message
      get('order-status').classList.toggle('rejected', rejected)
    },
    config: (): MapConfig => ({ seed: inputs.seed.value, width: inputs.width.valueAsNumber, height: inputs.height.valueAsNumber }),
    dimensions: (size: number) => { inputs.width.value = String(size); inputs.height.value = String(size) },
    // The seed and size belong to the match once it started, so the world form must not change them.
    worldLocked: (locked: boolean) => {
      for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('#map-form input, #map-form button, .presets button')) {
        control.disabled = locked
      }
      get('world-lock').hidden = !locked
    },
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
