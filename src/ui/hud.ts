import { TERRAIN, type MapConfig, type Tile, type WorldMap } from '../game/map'

export function createHud() {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <header class="masthead">
      <div class="brand"><span class="star" aria-hidden="true">✦</span><h1>POLARIS</h1><span class="edition">WORLD ATLAS / 01</span></div>
      <span class="prototype">MAP FOUNDATION <span aria-hidden="true">◇</span> NO GAMEPLAY YET</span>
    </header>
    <main>
      <aside class="panel" aria-label="Atlas controls">
        <div class="section-label">EXPEDITION CHART</div>
        <h2>A world of possibility.</h2>
        <p class="intro">Survey the shores. Trace the highlands.<br>An original strategy world takes shape.</p>
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
        <p class="scope">PROCEDURAL PLACEHOLDERS<br>Exploration, cities &amp; factions are planned next.</p>
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
    <footer><span>✦ AN ATLAS, NOT YET AN EMPIRE.</span><span>DRAG · PAN &nbsp; SCROLL · ZOOM &nbsp; CLICK · INSPECT</span></footer>
  `
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id)! as T
  const inputs = { seed: get<HTMLInputElement>('seed'), width: get<HTMLInputElement>('width'), height: get<HTMLInputElement>('height') }
  const selection = (tile?: Tile) => {
    get('selection').textContent = tile ? `(${tile.x}, ${tile.z}) · ${TERRAIN[tile.terrain].name} · Tile ${tile.id}` : 'No tile selected'
  }
  const hover = (tile?: Tile) => {
    get('hover').textContent = tile ? `Surveying (${tile.x}, ${tile.z}) · ${TERRAIN[tile.terrain].name}` : 'Hover over the map to survey a tile.'
  }
  return {
    inputs, selection, hover,
    canvas: get<HTMLCanvasElement>('world'), form: get<HTMLFormElement>('map-form'),
    reset: get<HTMLButtonElement>('reset'), zoomIn: get<HTMLButtonElement>('zoom-in'),
    zoomOut: get<HTMLButtonElement>('zoom-out'), fixture: get<HTMLButtonElement>('fixture'),
    showcase: get<HTMLButtonElement>('showcase'),
    config: (): MapConfig => ({ seed: inputs.seed.value, width: inputs.width.valueAsNumber, height: inputs.height.valueAsNumber }),
    dimensions: (size: number) => { inputs.width.value = String(size); inputs.height.value = String(size) },
    error: (message: string) => {
      get('error').textContent = message
      get('error').hidden = false
      get('map-status').textContent = 'Request failed — no new atlas loaded'
    },
    loaded: (map: WorldMap) => {
      get('error').hidden = true
      get('world-info').textContent = `${map.seed} / ${map.width} × ${map.height}`
      get('map-status').textContent = `${map.tiles.length.toLocaleString('en-US')} TILES · GENERATOR ${String(map.generatorVersion).padStart(2, '0')}`
    },
  }
}
