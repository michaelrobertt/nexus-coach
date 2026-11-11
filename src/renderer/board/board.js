import { SceneEngine } from '../engine.js';
import { icon } from '../icons.js';
import {
  applyTheme, assetUrl, debounce, escapeHtml, formatShortcut, hexToRgba, isTypingTarget,
  luminance, matchShortcut, setupRangeFill, toast, uid, STAMP_CATEGORIES, TOOL_ICONS, TOOL_LABELS
} from '../ui.js';

const MAP_W = 2600;
const MAP_H = 2212;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let state = null;
let settings = null;
let catalog = null;
let champions = [];
let engine = null;
let lolVersion = '';
let bgMode = 'hd';
let activeTab = 'champions';
let elementCat = 'objectives';
let wavePlacement = null;
let textPlacement = null;
let saveBadgeTimer = null;
let widthFill = null;
let opacityFill = null;
let customColorInput = null;

const style = {
  tool: 'select', color: '#C8AA6E', width: 4, opacity: 1,
  arrowStyle: 'attack', aoeId: 'range', stampId: null, stampLabel: null,
  stampTeam: 'ally', stampSize: 72, textSize: 46, fade: false, fadeSeconds: 4, lineStyle: 'solid'
};

const TABS = [
  { id: 'champions', label: 'Campeões', icon: 'swords' },
  { id: 'elements', label: 'Elementos', icon: 'map' },
  { id: 'tactics', label: 'Tático', icon: 'aoe' },
  { id: 'scenarios', label: 'Cenários', icon: 'sparkles' }
];

const ROLE_TAGS = { Fighter: 'Lutador', Mage: 'Mago', Assassin: 'Assassino', Marksman: 'Atirador', Support: 'Suporte', Tank: 'Tanque' };

const P = {
  baron: { x: 1035, y: 710 },
  dragon: { x: 1800, y: 1528 },
  blueBase: { x: 480, y: 1950 },
  redBase: { x: 2180, y: 380 },
  mid: { x: 1310, y: 1120 },
  blueBlue: { x: 835, y: 1104 },
  blueRed: { x: 1480, y: 1527 },
  redBlue: { x: 1922, y: 982 },
  redRed: { x: 1478, y: 799 },
  topBlueOuter: { x: 470, y: 1615 },
  topBlueInhib: { x: 438, y: 1290 },
  botRedOuter: { x: 2130, y: 335 },
  midBlueOuter: { x: 980, y: 1420 },
  midRedOuter: { x: 1640, y: 800 }
};

/* ------------------------------------------------------------------ */
/* Boot / state                                                       */
/* ------------------------------------------------------------------ */

function setStaticIcons() {
  $('#brandLogo').innerHTML = icon('logo', 23);
  $('#minBtn').innerHTML = icon('minimize', 14);
  $('#maxBtn').innerHTML = icon('maximize', 14);
  $('#closeBtn').innerHTML = icon('close', 14);
  $('#undoBtn').innerHTML = icon('undo', 16);
  $('#redoBtn').innerHTML = icon('redo', 16);
  $('#deleteBtn').innerHTML = icon('trash', 16);
  $('#clearBtn').innerHTML = icon('trash', 16);
  $('#fitBtn').innerHTML = `${icon('fit', 14)}<span>Ajustar</span>`;
  $('#saveBtn').innerHTML = `${icon('save', 14)}<span>Salvar</span>`;
  $('#loadBtn').innerHTML = `${icon('folder', 14)}<span>Abrir</span>`;
  $('#exportBtn').innerHTML = icon('download', 14) + '<span>Exportar</span>';
  $('#fadeBtn').innerHTML = icon('droplet', 14);
  $('#lineStyleBtn').innerHTML = icon('stroke', 15);
  $('#fitMap').innerHTML = icon('fit', 14);
  document.querySelectorAll('.icon-btn').forEach((b) => { if (!b.innerHTML.trim()) b.innerHTML = icon('circle', 15); });
}

function renderTabs() {
  $('#sideTabs').innerHTML = TABS.map((t) => `
    <button class="side-tab ${activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">
      ${icon(t.icon, 14)}
      <span>${t.label}</span>
    </button>
  `).join('');
}

function renderRail() {
  const groups = [
    ['select', 'pen', 'pencil', 'marker', 'eraser'],
    ['line', 'arrow', 'curve', 'route'],
    ['circle', 'rect', 'triangle', 'hexagon', 'cone'],
    ['text', 'stamp', 'aoe']
  ];
  $('#railTools').innerHTML = groups.map((g, i) => `
    ${i ? '<span class="rail-sep"></span>' : ''}
    ${g.map((t) => `<button class="tool-btn" data-tool="${t}" data-tip="${escapeHtml(TOOL_LABELS[t] || t)}" aria-label="${escapeHtml(TOOL_LABELS[t] || t)}">${icon(TOOL_ICONS[t] || 'circle', 19)}</button>`).join('')}
  `).join('');
}

function renderColors() {
  const colors = (settings?.colors || []).slice(0, 7);
  $('#boardColors').innerHTML = colors.map((c) => `
    <button class="swatch ${luminance(c) > 0.72 ? 'light' : ''} ${String(style.color).toLowerCase() === c.toLowerCase() ? 'active' : ''}"
      style="background:${escapeHtml(c)}" data-color="${escapeHtml(c)}" title="${escapeHtml(c)}"></button>
  `).join('');
}

function renderArrowOptions() {
  const sel = $('#arrowStyleSelect');
  const prev = sel.value;
  sel.innerHTML = (catalog?.arrowStyles || []).map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  if (prev && (catalog?.arrowStyles || []).some((s) => s.id === prev)) sel.value = prev;
  else sel.value = style.arrowStyle;
}

function syncToolbar() {
  $('#widthRange').value = String(style.width);
  $('#opacityRange').value = String(Math.round(style.opacity * 100));
  $('#widthOut').textContent = String(style.width);
  $('#opacityOut').textContent = `${Math.round(style.opacity * 100)}%`;
  widthFill?.();
  opacityFill?.();
  $('#fadeDuration').value = String(style.fadeSeconds);
  $('#fadeBtn').classList.toggle('active', !!style.fade);
  $('#arrowStyleSelect').value = style.arrowStyle;
  $$('#teamToggle [data-team]').forEach((b) => b.classList.toggle('active', b.dataset.team === style.stampTeam));
  const ls = style.lineStyle || 'solid';
  if ($('#lineStyleBtn')) {
    $('#lineStyleBtn').title = `Traço: ${ { solid: 'sólido', dashed: 'tracejado', dotted: 'pontilhado' }[ls] }`;
    $('#lineStyleBtn').classList.toggle('active', ls !== 'solid');
  }
  $$('#railTools [data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === style.tool));
  $$('.champ-mini').forEach((b) => b.classList.toggle('active', style.stampId === `champ:${b.dataset.champ}`));
  $$('.map-mini').forEach((b) => b.classList.toggle('active', style.stampId === b.dataset.stamp));
  const label = style.tool === 'select' ? 'Selecionar' : (TOOL_LABELS[style.tool] || style.tool);
  $('#activeToolPill').textContent = label + (style.tool === 'stamp' && style.stampLabel ? ` · ${style.stampLabel}` : '');
}

function applyBoardStyle() {
  if (!engine) return;
  engine.setStyle({
    ...style,
    textSize: Number(settings?.drawing?.textSize) || 46,
    showLabels: settings?.board?.showLabels !== false,
    showCursor: true
  });
}

function applyState(next) {
  state = next;
  settings = next.settings;
  applyTheme(settings);
  if (next.catalog) catalog = next.catalog;
  if (settings.board?.background && settings.board.background !== bgMode) {
    bgMode = settings.board.background;
  }
  renderColors();
  renderArrowOptions();
  syncToolbar();
  applyBackground();
}

/* ------------------------------------------------------------------ */
/* Background                                                         */
/* ------------------------------------------------------------------ */

function applyBackground() {
  if (!engine || !settings) return;
  const mode = bgMode;
  const src = mode === 'minimap' ? assetUrl('map/minimap-1024.png') : assetUrl('map/summoners-rift.webp');
  engine.setBackground({
    src,
    mode,
    brightness: settings.board?.brightness ?? 1,
    grid: !!settings.board?.grid,
    mapW: MAP_W,
    mapH: MAP_H
  });
  engine.style.showLabels = settings.board?.showLabels !== false;
  $('#sideStatus').textContent = mode === 'minimap' ? 'Minimapa · 1024px' : mode === 'dark' ? 'Modo escuro · Grade tática' : 'Summoner\'s Rift · Mapa HD';
}

async function setBgMode(mode) {
  bgMode = mode;
  await window.nexus.patchState({ settings: { board: { background: mode } } });
  applyBackground();
  window.nexus.autosaveScene('board', engine.serialize());
  renderSidePanel();
}

async function updateBoardSetting(patch) {
  await window.nexus.patchState({ settings: { board: patch } });
  applyBackground();
}

/* ------------------------------------------------------------------ */
/* Side panel                                                         */
/* ------------------------------------------------------------------ */

function renderSidePanel() {
  renderTabs();
  if (!settings) return;
  if (activeTab === 'champions') $('#sideContent').innerHTML = championsHTML();
  else if (activeTab === 'elements') $('#sideContent').innerHTML = elementsHTML();
  else if (activeTab === 'tactics') $('#sideContent').innerHTML = tacticsHTML();
  else $('#sideContent').innerHTML = scenariosHTML();
  syncToolbar();
}

function championsHTML() {
  return `
    <div class="champ-toolbar">
      <div class="bp-search" style="flex:1;margin:0">
        ${icon('search', 13)}
        <input data-search-champ placeholder="Buscar campeão…" autocomplete="off" spellcheck="false" />
      </div>
      <div class="team-toggle">
        <button data-team="ally" class="${style.stampTeam !== 'enemy' ? 'active' : ''}"><span class="dot"></span>Aliado</button>
        <button data-team="enemy" class="${style.stampTeam === 'enemy' ? 'active' : ''}"><span class="dot"></span>Inimigo</button>
      </div>
    </div>
    <div class="bp-section" style="margin-top:10px">
      <div class="bp-title">Campeões <span class="muted" style="font-size:9px">${champions.length}</span></div>
      <div class="champ-lib">
        ${champions.map((c) => `
          <button class="champ-mini ${style.stampId === `champ:${c.id}` ? 'active' : ''}" data-champ="${escapeHtml(c.id)}" data-search="${escapeHtml((c.name + ' ' + c.id + ' ' + (c.tags || []).join(' ')).toLowerCase())}" title="${escapeHtml(c.name)} · ${escapeHtml((c.tags || []).map((t) => ROLE_TAGS[t] || t).join(', '))}">
            <img loading="lazy" src="${assetUrl(`champions/${c.image}`)}" alt="${escapeHtml(c.name)}" />
            <span>${escapeHtml(c.name)}</span>
          </button>
        `).join('')}
      </div>
      <div class="empty-mini hidden" id="champEmpty">Nenhum campeão encontrado.</div>
    </div>
    <div class="note">${icon('info', 13)}<span>Selecione um campeão e clique no mapa para posicionar. O anel indica o time; arraste com <b>Selecionar</b> para mover e use as alças para redimensionar e rotacionar.</span></div>
  `;
}

function elementsHTML() {
  const cats = ['objectives', 'vision', 'structures', 'jungle', 'pings', 'roles', 'minions'];
  const chips = cats.map((c) => `<button class="cat-chip ${elementCat === c ? 'active' : ''}" data-elcat="${c}">${STAMP_CATEGORIES[c].label}</button>`).join('');
  const stamps = (catalog.stamps || []).filter((s) => s.cat === elementCat);
  return `
    <div class="bp-section">
      <div class="bp-title">Fundo do mapa</div>
      <div class="bg-options">
        <button class="bg-option ${bgMode === 'hd' ? 'active' : ''}" data-bgmode="hd">${icon('map', 18)}<span>Mapa HD</span></button>
        <button class="bg-option ${bgMode === 'minimap' ? 'active' : ''}" data-bgmode="minimap">${icon('layers', 18)}<span>Minimapa</span></button>
        <button class="bg-option ${bgMode === 'dark' ? 'active' : ''}" data-bgmode="dark">${icon('grid', 18)}<span>Escuro</span></button>
      </div>
      <div class="option-row">
        <span>Brilho do mapa</span>
        <input type="range" data-brightness min="40" max="140" value="${Math.round((settings.board?.brightness ?? 1) * 100)}" />
      </div>
      <div class="option-row">
        <span>Grade tática</span>
        <button class="switch ${settings.board?.grid ? 'on' : ''}" data-toggle-board="grid"></button>
      </div>
      <div class="option-row">
        <span>Nomes dos elementos</span>
        <button class="switch ${settings.board?.showLabels !== false ? 'on' : ''}" data-toggle-board="labels"></button>
      </div>
    </div>
    <div class="bp-section">
      <div class="bp-title">Elementos do mapa</div>
      <div class="cat-chips">${chips}</div>
      <div class="bp-search">
        ${icon('search', 13)}
        <input data-search-stamp placeholder="Buscar elemento…" autocomplete="off" spellcheck="false" />
      </div>
      <div class="map-lib">
        ${stamps.map((s) => `
          <button class="map-mini ${style.stampId === s.id ? 'active' : ''}" data-stamp="${escapeHtml(s.id)}" data-search="${escapeHtml((s.name + ' ' + s.id).toLowerCase())}" title="${escapeHtml(s.name)}">
            ${stampPreview(s)}
            <span>${escapeHtml(s.name)}</span>
          </button>
        `).join('')}
      </div>
      <div class="empty-mini hidden" id="stampEmpty">Nenhum elemento encontrado.</div>
    </div>
    <div class="note">${icon('info', 13)}<span>Sentinelas, torres, objetivos e acampamentos podem ser posicionados livremente. Use o time Aliado/Inimigo na barra superior para colorir os anéis.</span></div>
  `;
}

function stampPreview(s) {
  if (s.img) return `<img loading="lazy" src="${assetUrl(s.img)}" alt="" />`;
  if (s.vector === 'ping') {
    const colors = { danger: '#FF4D5E', missing: '#FFD166', assist: '#28E0A0', omw: '#3FC7FF', vision: '#A78BFA', push: '#FF8A3D' };
    const glyph = { danger: '!', missing: '?', assist: '+', omw: '»', vision: '◉', push: '⇈' }[s.ping] || '!';
    return `<span class="ping-prev" style="width:28px;height:28px;border-radius:50%;border:2px solid ${colors[s.ping]};color:${colors[s.ping]};display:grid;place-items:center;font-weight:800">${glyph}</span>`;
  }
  if (s.vector === 'role') return `<span class="role-badge">${escapeHtml(s.role)}</span>`;
  if (s.vector === 'camp') return `<span class="role-badge">${escapeHtml(s.glyph || 'C')}</span>`;
  if (s.vector === 'eye' || s.vector === 'scuttle') return `<span style="color:#C8AA6E;display:grid;place-items:center">${icon(s.vector === 'eye' ? 'eye' : 'target', 26)}</span>`;
  if (s.vector === 'minion' || s.vector === 'wave') return `<span style="color:${s.team === 'red' ? '#FF4D5E' : '#3FC7FF'};display:grid;place-items:center">${icon('wave', 27)}</span>`;
  return `<span style="display:grid;place-items:center">${icon('layers', 22)}</span>`;
}

function tacticsHTML() {
  const zones = (catalog.aoePresets || []).map((p) => `
    <button class="tactic-item ${style.tool === 'aoe' && style.aoeId === p.id ? 'active' : ''}" data-aoe="${p.id}">
      <span class="ti-icon" style="color:${p.color}">${icon(p.kind === 'cone' ? 'cone' : 'aoe', 16)}</span>
      <span><b>${escapeHtml(p.name)}</b><small>${p.kind === 'cone' ? 'Cone ajustável' : 'Área circular'} · clique e arraste no mapa</small></span>
    </button>
  `).join('');
  const waves = (catalog.wavePresets || []).map((w) => `
    <button class="tactic-item" data-wave="${w.id}">
      <span class="ti-icon" style="color:#3FC7FF">${icon('wave', 16)}</span>
      <span><b>${escapeHtml(w.name)}</b><small>${escapeHtml(w.desc)}</small></span>
    </button>
  `).join('');
  const texts = ['FREEZE', 'SLOW PUSH', 'FAST PUSH', 'ENGAGE', 'DISENGAGE', 'VISÃO', 'OBJETIVO'];
  return `
    <div class="bp-section">
      <div class="bp-title">Zonas de alcance e controle</div>
      <div class="tactic-list">${zones}</div>
    </div>
    <div class="bp-section">
      <div class="bp-title">Gerenciamento de ondas</div>
      <div class="tactic-list">${waves}</div>
      <div class="note">${icon('info', 13)}<span>Escolha um tipo de onda e clique no mapa para posicionar. A onda é criada com o time selecionado (Aliado/Inimigo) e pode ser movida e redimensionada depois.</span></div>
    </div>
    <div class="bp-section">
      <div class="bp-title">Rótulos rápidos</div>
      <div class="cat-chips">${texts.map((t) => `<button class="cat-chip" data-textpreset="${t}">${t}</button>`).join('')}</div>
      <div class="note">${icon('text', 13)}<span>Clique em um rótulo e depois no mapa para posicionar o texto já preenchido.</span></div>
    </div>
    <div class="bp-section">
      <div class="bp-title">Limpeza</div>
      <div class="scenario-actions">
        <button data-action="clear-temp">Limpar tintas temporárias</button>
        <button data-action="clear-all">Limpar quadro</button>
      </div>
    </div>
  `;
}

function scenariosHTML() {
  return `
    <div class="bp-section">
      <div class="bp-title">Cenários táticos</div>
      <div class="champ-toolbar">
        <span class="muted" style="font-size:9px">Adicione à sessão atual ou substitua o quadro.</span>
      </div>
      ${SCENARIOS.map((s) => `
        <div class="scenario-card">
          <div class="scenario-head">
            <span class="si">${icon(s.icon || 'sparkles', 14)}</span>
            <b>${escapeHtml(s.title)}</b>
          </div>
          <p>${escapeHtml(s.desc)}</p>
          <div class="scenario-actions">
            <button data-scenario="${s.id}" data-mode="add">Adicionar</button>
            <button data-scenario="${s.id}" data-mode="replace">Substituir quadro</button>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="bp-section">
      <div class="bp-title">Sessão</div>
      <div class="scenario-actions">
        <button data-action="new-board">Novo quadro</button>
        <button data-action="save-board">Salvar cenário</button>
        <button data-action="load-board">Abrir cenário</button>
        <button data-action="export-board">Exportar PNG</button>
      </div>
    </div>
    <div class="note">${icon('info', 13)}<span>Os cenários são pontos de partida editáveis. Use Ctrl+Z para desfazer qualquer aplicação.</span></div>
  `;
}

/* ------------------------------------------------------------------ */
/* Preview helpers                                                    */
/* ------------------------------------------------------------------ */

function stampData(id) {
  if (id?.startsWith('champ:')) {
    const c = champions.find((x) => x.id === id.slice(6));
    return { type: 'champion', img: `champions/${c?.image || id.slice(6) + '.png'}`, label: c?.name || id.slice(6) };
  }
  const s = (catalog.stamps || []).find((x) => x.id === id);
  if (!s) return null;
  return {
    type: s.vector || (s.img ? 'image' : 'icon'),
    img: s.img, vector: s.vector, ping: s.ping, role: s.role, glyph: s.glyph,
    team: s.team, label: s.name, cat: s.cat, preset: s.id?.startsWith('wave') ? 'freeze' : null
  };
}

function makeStamp(id, x, y, opts = {}) {
  const stamp = stampData(id);
  if (!stamp) return null;
  const isWave = stamp.type === 'wave';
  return {
    id: uid('b'), type: isWave ? 'wave' : 'stamp',
    x, y,
    size: opts.size || (isWave ? 62 : style.stampSize || 72),
    rotation: 0,
    team: opts.team || stamp.team || style.stampTeam || 'ally',
    preset: opts.preset || stamp.preset || 'freeze',
    stamp,
    label: opts.label === false ? null : (stamp.label || null),
    color: style.color,
    opacity: 1,
    width: 2,
    ttl: null,
    bornAt: null
  };
}

function makeZone(id, x, y, opts = {}) {
  const p = (catalog.aoePresets || []).find((z) => z.id === id) || catalog.aoePresets?.[0];
  if (!p) return null;
  const cone = p.kind === 'cone';
  const size = opts.size || p.size;
  return {
    id: uid('b'), type: 'zone',
    kind: cone ? 'cone' : 'circle',
    x, y,
    w: cone ? size * 2 : size,
    h: size,
    angle: p.angle || 70,
    dir: opts.dir ?? -Math.PI / 2,
    rotation: opts.rotation || 0,
    color: opts.color || p.color,
    width: 3,
    opacity: 0.95,
    fill: opts.fill ?? p.fill,
    dash: p.dash || [],
    label: opts.label || null,
    ttl: null, bornAt: null
  };
}

function makeArrow(styleId, points, opts = {}) {
  const s = (catalog.arrowStyles || []).find((a) => a.id === styleId) || catalog.arrowStyles?.[0];
  return {
    id: uid('b'), type: 'arrow', points, curve: !!opts.curve,
    color: opts.color || s?.color || '#C8AA6E', width: opts.width || 6,
    opacity: 0.95, arrowStyle: styleId, ttl: null, bornAt: null
  };
}

function makeRoute(styleId, points, opts = {}) {
  const s = (catalog.arrowStyles || []).find((a) => a.id === styleId) || catalog.arrowStyles?.[0];
  return {
    id: uid('b'), type: 'route', points,
    color: opts.color || s?.color || '#C8AA6E', width: opts.width || 7,
    opacity: 0.95, arrowStyle: styleId, ttl: null, bornAt: null
  };
}

function makeText(text, x, y, opts = {}) {
  return {
    id: uid('b'), type: 'text', x, y, text,
    size: opts.size || 46, color: opts.color || style.color, opacity: 0.98,
    weight: 650, rotation: 0, ttl: null, bornAt: null
  };
}

function makeWave(preset, x, y, opts = {}) {
  return {
    id: uid('b'), type: 'wave', x, y, size: opts.size || 62,
    team: opts.team || style.stampTeam || 'ally',
    preset: preset || 'freeze',
    rotation: 0, color: style.color, opacity: 1, width: 2,
    ttl: null, bornAt: null
  };
}

/* ------------------------------------------------------------------ */
/* Scenarios                                                          */
/* ------------------------------------------------------------------ */

const SCENARIOS = [
  {
    id: 'baron-fight', title: 'Teamfight no Barão', icon: 'swords',
    desc: 'Posicionamento aliado, aproximação inimiga, visão e ângulos de engage no rio superior.',
    build: () => {
      const it = [];
      const ally = [['role-top', 880, 790], ['role-jg', 1000, 870], ['role-mid', 1110, 790], ['role-adc', 950, 640], ['role-sup', 1000, 740]];
      const enemy = [['role-top', 1190, 600], ['role-jg', 1200, 900], ['role-mid', 1290, 750], ['role-adc', 1140, 520], ['role-sup', 1240, 620]];
      ally.forEach(([id, x, y]) => it.push(makeStamp(id, x, y, { size: 62, team: 'ally', label: false })));
      enemy.forEach(([id, x, y]) => it.push(makeStamp(id, x, y, { size: 62, team: 'enemy', label: false })));
      it.push(makeZone('ward', P.baron.x + 40, P.baron.y + 40, { size: 460, color: '#3FC7FF', label: null }));
      it.push(makeZone('teamfight', 1140, 760, { size: 340, label: null }));
      it.push(makeZone('threat', 1260, 690, { size: 300, label: null }));
      it.push(makeArrow('attack', [{ x: 980, y: 860 }, { x: 1120, y: 770 }], { color: '#FF4D5E' }));
      it.push(makeArrow('escape', [{ x: 1220, y: 690 }, { x: 1350, y: 570 }], {}));
      it.push(makeStamp('ward-green', 960, 630, { size: 52, label: false }));
      it.push(makeStamp('ward-pink-enemy', 1160, 660, { size: 52, label: false }));
      it.push(makeText('TEAMFIGHT · BARÃO', 830, 470, { size: 34, color: '#F0DCA6' }));
      return it;
    }
  },
  {
    id: 'gank-bot', title: 'Gank na bot lane', icon: 'route',
    desc: 'Rota de aproximação pela jungle, sentinelas e leitura do posicionamento inimigo.',
    build: () => {
      const it = [];
      it.push(makeRoute('gank', [{ x: 1340, y: 1490 }, { x: 1470, y: 1580 }, { x: 1620, y: 1650 }, { x: 1780, y: 1740 }, { x: 1890, y: 1790 }], { width: 8 }));
      it.push(makeStamp('role-jg', 1340, 1490, { size: 58, label: false }));
      it.push(makeStamp('role-mid', 1230, 1390, { size: 58, label: false }));
      it.push(makeStamp('role-adc', 1960, 1820, { size: 58, team: 'enemy', label: false }));
      it.push(makeStamp('role-sup', 1870, 1870, { size: 58, team: 'enemy', label: false }));
      it.push(makeStamp('ward-pink-enemy', 1710, 1700, { size: 50, label: false }));
      it.push(makeStamp('ward-green', 1930, 1720, { size: 50, label: false }));
      it.push(makeZone('threat', 1930, 1830, { size: 260, color: '#FF4D5E', label: null }));
      it.push(makeArrow('attack', [{ x: 1880, y: 1810 }, { x: 1970, y: 1840 }], {}));
      it.push(makeText('GANK BOT', 1580, 1540, { size: 34, color: '#FF8A3D' }));
      return it;
    }
  },
  {
    id: 'dragon-control', title: 'Controle de Dragão', icon: 'target',
    desc: 'Visão do pit, zonas de engage/disengage e posicionamento das duas equipes.',
    build: () => {
      const it = [];
      const ally = [['role-jg', 1620, 1430], ['role-mid', 1560, 1320], ['role-adc', 1810, 1680], ['role-sup', 1730, 1620], ['role-top', 1690, 1250]];
      const enemy = [['role-jg', 1960, 1440], ['role-mid', 2010, 1330], ['role-adc', 1990, 1610], ['role-sup', 1930, 1690], ['role-top', 1900, 1230]];
      ally.forEach(([id, x, y]) => it.push(makeStamp(id, x, y, { size: 58, label: false })));
      enemy.forEach(([id, x, y]) => it.push(makeStamp(id, x, y, { size: 58, team: 'enemy', label: false })));
      it.push(makeStamp('dragon', P.dragon.x, P.dragon.y, { size: 66, label: false }));
      it.push(makeStamp('ward-pink-enemy', 1810, 1600, { size: 48, label: false }));
      it.push(makeStamp('ward-green', 1660, 1390, { size: 48, label: false }));
      it.push(makeStamp('ward-green', 1930, 1610, { size: 48, label: false }));
      it.push(makeZone('ward', P.dragon.x, P.dragon.y, { size: 500, color: '#3FC7FF', label: null }));
      it.push(makeZone('engage', 1600, 1430, { size: 330, dir: -0.5, label: null }));
      it.push(makeZone('disengage', 1980, 1570, { size: 300, dir: 2.6, label: null }));
      it.push(makeArrow('vision', [{ x: 1470, y: 1300 }, { x: 1700, y: 1400 }], {}));
      it.push(makeText('CONTROLE DE DRAGÃO', 1580, 1170, { size: 34, color: '#C8AA6E' }));
      return it;
    }
  },
  {
    id: 'invade-red', title: 'Invasão da jungle vermelha', icon: 'bolt',
    desc: 'Entrada pela jungle, caminho até o buff, visão inimiga e rota de fuga.',
    build: () => {
      const it = [];
      it.push(makeRoute('gank', [{ x: 1420, y: 1160 }, { x: 1560, y: 1100 }, { x: 1710, y: 1030 }, { x: 1840, y: 990 }, { x: 1920, y: 982 }], { width: 8 }));
      it.push(makeRoute('escape', [{ x: 1900, y: 990 }, { x: 1760, y: 1080 }, { x: 1610, y: 1150 }], { width: 5, color: '#A78BFA' }));
      it.push(makeStamp('blue-buff', P.redBlue.x, P.redBlue.y, { size: 54, label: false }));
      it.push(makeStamp('camp', 1780, 1020, { size: 46, team: 'enemy', label: false }));
      it.push(makeStamp('role-jg', 1420, 1160, { size: 58, label: false }));
      it.push(makeStamp('role-mid', 1280, 1260, { size: 58, label: false }));
      it.push(makeStamp('ward-pink-enemy', 1810, 880, { size: 48, label: false }));
      it.push(makeStamp('ward-enemy', 1960, 1160, { size: 48, label: false }));
      it.push(makeZone('threat', 1880, 900, { size: 280, color: '#FF4D5E', label: null }));
      it.push(makeText('INVASÃO · BUFF AZUL', 1520, 920, { size: 34, color: '#FF8A3D' }));
      return it;
    }
  },
  {
    id: 'wave-freeze', title: 'Freeze na top lane', icon: 'shield',
    desc: 'Segurar a onda próxima à torre aliada e negar recursos ao adversário.',
    build: () => {
      const it = [];
      it.push(makeStamp('tower', 440, 1610, { size: 56, team: 'ally', label: false }));
      it.push(makeWave('freeze', 610, 1510, { team: 'ally', size: 66 }));
      it.push(makeWave('slowpush', 760, 1450, { team: 'enemy', size: 60 }));
      it.push(makeStamp('role-top', 600, 1580, { size: 56, label: false }));
      it.push(makeText('FREEZE', 585, 1360, { size: 36, color: '#3FC7FF' }));
      it.push(makeArrow('defense', [{ x: 580, y: 1460 }, { x: 700, y: 1510 }], {}));
      it.push(makeText('Segurar fora do alcance da torre', 430, 1725, { size: 24, color: '#9AA7B8' }));
      return it;
    }
  },
  {
    id: 'wave-slowpush', title: 'Slow push no mid', icon: 'wave',
    desc: 'Acumular duas ondas para criar pressão e forçar rotação inimiga.',
    build: () => {
      const it = [];
      it.push(makeWave('slowpush', 930, 1510, { team: 'ally', size: 62 }));
      it.push(makeWave('slowpush', 1080, 1420, { team: 'ally', size: 56 }));
      it.push(makeArrow('execute', [{ x: 1080, y: 1370 }, { x: 1300, y: 1220 }], {}));
      it.push(makeStamp('tower', 1550, 900, { size: 52, team: 'enemy', label: false }));
      it.push(makeStamp('role-mid', 1150, 1330, { size: 56, label: false }));
      it.push(makeText('SLOW PUSH · MID', 900, 1280, { size: 34, color: '#28E0A0' }));
      return it;
    }
  },
  {
    id: 'wave-fastpush', title: 'Fast push na bot', icon: 'bolt',
    desc: 'Limpar a onda rapidamente e converter a pressão em dano na torre.',
    build: () => {
      const it = [];
      it.push(makeWave('fastpush', 1840, 1760, { team: 'ally', size: 62 }));
      it.push(makeWave('fastpush', 1950, 1800, { team: 'ally', size: 56 }));
      it.push(makeStamp('tower', 2070, 1760, { size: 56, team: 'enemy', label: false }));
      it.push(makeArrow('attack', [{ x: 1960, y: 1770 }, { x: 2040, y: 1770 }], {}));
      it.push(makeStamp('role-adc', 1900, 1840, { size: 56, label: false }));
      it.push(makeText('FAST PUSH · BOT', 1700, 1635, { size: 32, color: '#FF8A3D' }));
      return it;
    }
  },
  {
    id: 'vision-river', title: 'Controle de visão do rio', icon: 'eye',
    desc: 'Linhas de visão, sentinelas de controle e zonas de ameaça no rio.',
    build: () => {
      const it = [];
      it.push(makeStamp('ward-green', 1230, 900, { size: 50, label: false }));
      it.push(makeStamp('ward-pink-enemy', 1420, 1080, { size: 50, label: false }));
      it.push(makeStamp('ward-green', 1600, 1260, { size: 50, label: false }));
      it.push(makeStamp('ward-pink', 1750, 1380, { size: 50, label: false }));
      it.push(makeZone('ward', 1550, 1200, { size: 400, color: '#3FC7FF', label: null }));
      it.push(makeZone('threat', 1700, 1350, { size: 300, color: '#FF4D5E', label: null }));
      it.push(makeArrow('vision', [{ x: 1120, y: 850 }, { x: 1450, y: 1070 }], {}));
      it.push(makeArrow('vision', [{ x: 1500, y: 1120 }, { x: 1760, y: 1380 }], {}));
      it.push(makeText('VISÃO DO RIO', 1260, 750, { size: 32, color: '#3FC7FF' }));
      return it;
    }
  }
];

/* ------------------------------------------------------------------ */
/* Scenario / scene actions                                           */
/* ------------------------------------------------------------------ */

function itemBoundsAll(items) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const it of items) {
    const b = engine?.itemBounds(it);
    if (!b) continue;
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function applyScenario(id, mode) {
  const sc = SCENARIOS.find((s) => s.id === id);
  if (!sc) return;
  const items = sc.build().filter(Boolean);
  if (!items.length) return;
  if (mode === 'replace') engine.items = [];
  engine.items.push(...items);
  engine.selection = new Set();
  engine.emitSelection();
  engine.commit();
  const b = itemBoundsAll(items);
  if (b) engine.zoomToRect(b, 1.45);
  setSavePending();
  toast(`Cenário aplicado: ${sc.title}`, 'success');
}

function newBoard() {
  if (!engine.items.length) return;
  engine.clear();
  toast('Novo quadro · Ctrl+Z para restaurar', 'info');
}

async function saveBoard() {
  const res = await window.nexus.saveScene({
    which: 'board',
    data: engine.serialize(),
    defaultName: `nexus-quadro-${stampName()}.json`
  });
  if (res.ok) toast('Cenário salvo', 'success');
  else if (res.error) toast(res.error, 'error');
}

async function loadBoard() {
  const res = await window.nexus.openScene();
  if (!res.ok) { if (res.error) toast(res.error, 'error'); return; }
  if (!engine.loadScene(res.data)) { toast('Arquivo inválido', 'error'); return; }
  if (res.data.background && ['hd', 'minimap', 'dark'].includes(res.data.background)) {
    bgMode = res.data.background;
    applyBackground();
  }
  window.nexus.autosaveScene('board', engine.serialize());
  toast('Cenário carregado', 'success');
}

async function exportBoard() {
  const dataUrl = await engine.exportBoardPNG();
  const res = await window.nexus.exportImage({ dataUrl, defaultName: `nexus-quadro-${stampName()}.png` });
  if (res.ok) toast('Imagem exportada', 'success');
  else if (res.error) toast(res.error, 'error');
}

function stampName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function setSavePending() {
  const badge = $('#saveBadge');
  if (!badge) return;
  badge.classList.add('saving');
  badge.innerHTML = '<span class="pulse"></span>Salvando…';
  clearTimeout(saveBadgeTimer);
  saveBadgeTimer = setTimeout(() => {
    badge.classList.remove('saving');
    badge.innerHTML = '<span class="pulse"></span>Salvo';
  }, 700);
}

/* ------------------------------------------------------------------ */
/* Selection / placement                                              */
/* ------------------------------------------------------------------ */

function setTool(tool) {
  style.tool = tool;
  wavePlacement = null;
  textPlacement = null;
  applyBoardStyle();
  syncToolbar();
  if (tool === 'stamp' && !style.stampId) {
    activeTab = 'champions';
    renderSidePanel();
  } else if (tool === 'aoe') {
    activeTab = 'tactics';
    renderSidePanel();
  }
  if (tool === 'text') updateStageHint('Clique no mapa para digitar · Enter confirma · Shift+Enter quebra linha');
  else if (tool === 'route') updateStageHint('Clique para adicionar pontos · duplo clique ou Enter finaliza · Esc cancela');
  else if (tool === 'select') updateStageHint('Arraste para selecionar · Shift adiciona à seleção · duplo clique edita texto');
  else updateStageHint('Arraste com o botão do meio ou <kbd>Espaço</kbd> para mover · roda do mouse para zoom');
}

function updateStageHint(html) {
  $('#stageHint').innerHTML = html;
}

function chooseChampion(c) {
  style.stampId = `champ:${c.id}`;
  style.stampLabel = c.name;
  style.tool = 'stamp';
  style.stampSize = style.stampSize || 72;
  wavePlacement = null;
  textPlacement = null;
  applyBoardStyle();
  syncToolbar();
  toast(`${c.name} pronto · clique no mapa para posicionar`, 'info', 1600);
}

function chooseStamp(s) {
  style.stampId = s.id;
  style.stampLabel = s.name;
  style.tool = 'stamp';
  wavePlacement = null;
  textPlacement = null;
  applyBoardStyle();
  syncToolbar();
  toast(`${s.name} pronto · clique no mapa`, 'info', 1600);
}

function selectAoe(p) {
  style.tool = 'aoe';
  style.aoeId = p.id;
  style.color = p.color;
  wavePlacement = null;
  textPlacement = null;
  applyBoardStyle();
  syncToolbar();
  toast(`${p.name} · clique e arraste no mapa`, 'info');
}

/* ------------------------------------------------------------------ */
/* Canvas placement modes                                             */
/* ------------------------------------------------------------------ */

function handleCanvasCapture(e) {
  if (!wavePlacement && !textPlacement) return;
  if (e.button !== 0) return;
  e.stopImmediatePropagation();
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  const world = engine.screenToWorld(screen);
  if (textPlacement) {
    const it = makeText(textPlacement, world.x, world.y, { color: style.color });
    engine.items.push(it);
    engine.selection = new Set([it.id]);
    engine.emitSelection();
    engine.commit();
    textPlacement = null;
    style.tool = 'select';
    applyBoardStyle();
    syncToolbar();
    toast('Rótulo posicionado', 'success');
    return;
  }
  const it = makeWave(wavePlacement, world.x, world.y, { team: style.stampTeam });
  engine.items.push(it);
  engine.selection = new Set([it.id]);
  engine.emitSelection();
  engine.commit();
  wavePlacement = null;
  style.tool = 'select';
  applyBoardStyle();
  syncToolbar();
  updateStageHint('Onda posicionada · use Selecionar para ajustar · Ctrl+Z para desfazer');
}

/* ------------------------------------------------------------------ */
/* Events                                                             */
/* ------------------------------------------------------------------ */

function bindEvents() {
  window.nexus.onState((next) => applyState(next));
  window.nexus.onToast(({ message, type }) => toast(message, type || 'info'));
  window.nexus.onCommand((cmd) => {
    if (cmd.type === 'clear-temp') engine.clearTemporary();
    else if (cmd.type === 'reset-scene') engine.clear();
    else if (cmd.type === 'sync-style') applyBoardStyle();
    else if (cmd.type === 'undo') engine.undo();
    else if (cmd.type === 'redo') engine.redo();
    else if (cmd.type === 'clear') engine.clear();
    else if (cmd.type === 'export') exportBoard();
    else if (cmd.type === 'save') saveBoard();
    else if (cmd.type === 'load') loadBoard();
  });

  $('#minBtn').addEventListener('click', () => window.nexus.windowAction('minimize'));
  $('#maxBtn').addEventListener('click', () => window.nexus.windowAction('maximize'));
  $('#closeBtn').addEventListener('click', () => window.nexus.windowAction('close'));

  $('#undoBtn').addEventListener('click', () => engine.undo());
  $('#redoBtn').addEventListener('click', () => engine.redo());
  $('#deleteBtn').addEventListener('click', () => engine.deleteSelected());
  $('#clearBtn').addEventListener('click', () => { engine.clear(); toast('Quadro limpo · Ctrl+Z para desfazer', 'info'); });
  $('#fitBtn').addEventListener('click', () => engine.fitView());
  $('#saveBtn').addEventListener('click', saveBoard);
  $('#loadBtn').addEventListener('click', loadBoard);
  $('#exportBtn').addEventListener('click', exportBoard);
  $('#fitMap').addEventListener('click', () => engine.fitView());
  $('#zoomIn').addEventListener('click', () => engine.zoomAt(engine.w / 2, engine.h / 2, 1.18));
  $('#zoomOut').addEventListener('click', () => engine.zoomAt(engine.w / 2, engine.h / 2, 1 / 1.18));

  $('#railTools').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tool]');
    if (btn) setTool(btn.dataset.tool);
  });

  $('#sideTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (!tab) return;
    activeTab = tab.dataset.tab;
    renderSidePanel();
  });

  $('#sideContent').addEventListener('click', onSideClick);
  $('#sideContent').addEventListener('input', onSideInput);
  $('#sideContent').addEventListener('change', onSideChange);

  $$('#teamToggle [data-team]').forEach((b) => b.addEventListener('click', () => {
    style.stampTeam = b.dataset.team;
    syncToolbar();
    if (activeTab === 'champions') renderSidePanel();
  }));

  $('#boardColors').addEventListener('click', (e) => {
    const sw = e.target.closest('[data-color]');
    if (sw) {
      style.color = sw.dataset.color;
      applyBoardStyle();
      if (engine.selection.size) engine.applyStyleToSelection({ color: style.color });
      renderColors();
    }
  });
  customColorInput = document.createElement('input');
  customColorInput.type = 'color';
  customColorInput.value = style.color;
  customColorInput.style.cssText = 'position:fixed;left:-100px;top:-100px;width:1px;height:1px;opacity:0';
  document.body.appendChild(customColorInput);
  $('#customColorBtn').addEventListener('click', () => customColorInput.click());
  customColorInput.addEventListener('input', () => {
    style.color = customColorInput.value.toUpperCase();
    applyBoardStyle();
    if (engine.selection.size) engine.applyStyleToSelection({ color: style.color });
    renderColors();
  });

  $('#arrowStyleSelect').addEventListener('change', (e) => {
    const s = (catalog.arrowStyles || []).find((a) => a.id === e.target.value);
    style.arrowStyle = e.target.value;
    if (s) style.color = s.color;
    applyBoardStyle();
    if (engine.selection.size) engine.applyStyleToSelection({ arrowStyle: style.arrowStyle, color: style.color });
    renderColors();
    syncToolbar();
  });

  const widthInput = $('#widthRange');
  const opacityInput = $('#opacityRange');
  widthFill = setupRangeFill(widthInput);
  opacityFill = setupRangeFill(opacityInput);
  widthInput.addEventListener('input', () => {
    style.width = Number(widthInput.value);
    $('#widthOut').textContent = String(style.width);
    widthFill();
    applyBoardStyle();
    if (engine.selection.size) engine.applyStyleToSelection({ width: style.width });
  });
  opacityInput.addEventListener('input', () => {
    style.opacity = Number(opacityInput.value) / 100;
    $('#opacityOut').textContent = `${opacityInput.value}%`;
    opacityFill();
    applyBoardStyle();
    if (engine.selection.size) engine.applyStyleToSelection({ opacity: style.opacity });
  });

  $('#lineStyleBtn').addEventListener('click', () => {
    const names = { solid: 'sólido', dashed: 'tracejado', dotted: 'pontilhado' };
    const cur = style.lineStyle || 'solid';
    const order = ['solid', 'dashed', 'dotted'];
    const next = order[(order.indexOf(cur) + 1) % order.length];
    style.lineStyle = next;
    applyBoardStyle();
    if (engine.selection.size) engine.applyStyleToSelection({ lineStyle: next });
    syncToolbar();
    toast('Traço: ' + names[next], 'info');
  });
  $('#fadeBtn').addEventListener('click', () => {
    style.fade = !style.fade;
    applyBoardStyle();
    syncToolbar();
    toast(style.fade ? `Tinta temporária ativa (${style.fadeSeconds}s)` : 'Tinta temporária desativada', 'info');
  });
  $('#fadeDuration').addEventListener('change', (e) => {
    style.fadeSeconds = Number(e.target.value);
    applyBoardStyle();
    toast(`Duração da tinta: ${style.fadeSeconds}s`, 'info');
  });

  const canvas = $('#boardCanvas');
  canvas.addEventListener('pointerdown', handleCanvasCapture, true);
  canvas.addEventListener('pointermove', (e) => {
    if (!engine) return;
    const rect = canvas.getBoundingClientRect();
    const p = engine.screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    $('#coordBadge').textContent = `${Math.round(p.x)}, ${Math.round(p.y)}`;
  });
  canvas.addEventListener('pointerleave', () => { $('#coordBadge').textContent = '0, 0'; });
  canvas.addEventListener('wheel', () => {
    setTimeout(updateZoomBadges, 20);
  }, { passive: true });

  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', () => {
    updateZoomBadges();
    if (engine) engine.resize();
  });
}

function onSideClick(e) {
  const team = e.target.closest('.team-toggle [data-team]');
  if (team) {
    style.stampTeam = team.dataset.team;
    syncToolbar();
    renderSidePanel();
    return;
  }
  const champ = e.target.closest('[data-champ]');
  if (champ) {
    const c = champions.find((x) => x.id === champ.dataset.champ);
    if (c) chooseChampion(c);
    return;
  }
  const stamp = e.target.closest('[data-stamp]');
  if (stamp) {
    const s = (catalog.stamps || []).find((x) => x.id === stamp.dataset.stamp);
    if (s) chooseStamp(s);
    return;
  }
  const aoe = e.target.closest('[data-aoe]');
  if (aoe) {
    const p = (catalog.aoePresets || []).find((x) => x.id === aoe.dataset.aoe);
    if (p) { selectAoe(p); renderSidePanel(); }
    return;
  }
  const bg = e.target.closest('[data-bgmode]');
  if (bg) { setBgMode(bg.dataset.bgmode); return; }

  const elcat = e.target.closest('[data-elcat]');
  if (elcat) { elementCat = elcat.dataset.elcat; renderSidePanel(); return; }

  const toggle = e.target.closest('[data-toggle-board]');
  if (toggle) {
    const key = toggle.dataset.toggleBoard;
    if (key === 'grid') updateBoardSetting({ grid: !settings.board?.grid });
    else updateBoardSetting({ showLabels: settings.board?.showLabels === false });
    renderSidePanel();
    return;
  }

  const wave = e.target.closest('[data-wave]');
  if (wave) {
    wavePlacement = wave.dataset.wave;
    textPlacement = null;
    style.tool = 'select';
    applyBoardStyle();
    syncToolbar();
    updateStageHint(`Posicionar onda "${wave.dataset.wave}" · clique no mapa · Esc cancela`);
    toast('Clique no mapa para posicionar a onda', 'info');
    return;
  }

  const textPreset = e.target.closest('[data-textpreset]');
  if (textPreset) {
    textPlacement = textPreset.dataset.textpreset;
    wavePlacement = null;
    style.tool = 'select';
    applyBoardStyle();
    syncToolbar();
    updateStageHint(`Posicionar rótulo "${textPreset.dataset.textpreset}" · clique no mapa`);
    toast('Clique no mapa para posicionar o rótulo', 'info');
    return;
  }

  const scenario = e.target.closest('[data-scenario]');
  if (scenario) { applyScenario(scenario.dataset.scenario, scenario.dataset.mode); return; }

  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'clear-temp') { engine.clearTemporary(); toast('Tintas temporárias limpas', 'info'); }
  else if (action === 'clear-all') { engine.clear(); toast('Quadro limpo', 'info'); }
  else if (action === 'new-board') newBoard();
  else if (action === 'save-board') saveBoard();
  else if (action === 'load-board') loadBoard();
  else if (action === 'export-board') exportBoard();
}

function onSideInput(e) {
  if (e.target.matches('[data-search-champ]')) {
    const q = e.target.value.trim().toLowerCase();
    let n = 0;
    $$('.champ-mini').forEach((el) => {
      const show = !q || el.dataset.search.includes(q);
      el.classList.toggle('hidden', !show);
      if (show) n++;
    });
    $('#champEmpty')?.classList.toggle('hidden', n > 0);
  } else if (e.target.matches('[data-search-stamp]')) {
    const q = e.target.value.trim().toLowerCase();
    let n = 0;
    $$('.map-mini').forEach((el) => {
      const show = !q || el.dataset.search.includes(q);
      el.classList.toggle('hidden', !show);
      if (show) n++;
    });
    $('#stampEmpty')?.classList.toggle('hidden', n > 0);
  } else if (e.target.matches('[data-brightness]')) {
    const v = Number(e.target.value) / 100;
    settings.board.brightness = v;
    updateBoardSetting({ brightness: v });
  }
}

function onSideChange(e) {
  if (e.target.matches('[data-brightness]')) {
    updateBoardSetting({ brightness: Number(e.target.value) / 100 });
  }
}

async function onKeyDown(e) {
  if (isTypingTarget()) return;
  if (!state || !engine) return;
  const tools = settings.shortcuts?.tools || {};
  if (e.key === 'Escape') {
    e.preventDefault();
    if (wavePlacement) { wavePlacement = null; updateStageHint('Posicionamento cancelado'); return; }
    if (textPlacement) { textPlacement = null; updateStageHint('Posicionamento cancelado'); return; }
    if (engine.route) { engine.finishRoute(false); return; }
    if (engine._editing) { engine.cancelTextEdit(); return; }
    if (engine.selection.size) { engine.setSelection([]); return; }
    if (style.tool !== 'select') setTool('select');
    return;
  }
  if (matchShortcut(e, tools.undo) || (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); engine.undo(); return; }
  if (matchShortcut(e, tools.redo) || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); engine.redo(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); engine.deleteSelected(); return; }
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); engine.copySelection(); return; }
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'v') { e.preventDefault(); engine.paste(); return; }
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); engine.duplicateSelected(); return; }
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); engine.selectAll(); return; }
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveBoard(); return; }
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); loadBoard(); return; }
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); exportBoard(); return; }
  if (e.key === '+' || e.key === '=') { e.preventDefault(); engine.zoomAt(engine.w / 2, engine.h / 2, 1.2); return; }
  if (e.key === '-') { e.preventDefault(); engine.zoomAt(engine.w / 2, engine.h / 2, 1 / 1.2); return; }
  if (e.key === '0') { e.preventDefault(); engine.fitView(); return; }
  if (e.key.startsWith('Arrow') && engine.selection.size) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    for (const it of engine.selectedItems()) {
      if (it.points) it.points = it.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      if (typeof it.x === 'number') it.x += dx;
      if (typeof it.y === 'number') it.y += dy;
    }
    engine.commit();
    return;
  }
  if (matchShortcut(e, tools.fade)) { e.preventDefault(); $('#fadeBtn').click(); return; }
  const order = ['select', 'pen', 'pencil', 'marker', 'eraser', 'line', 'arrow', 'curve', 'route', 'circle', 'rect', 'triangle', 'hexagon', 'cone', 'text', 'stamp', 'aoe'];
  for (const t of order) {
    if (matchShortcut(e, tools[t])) { e.preventDefault(); setTool(t); return; }
  }
}

/* ------------------------------------------------------------------ */
/* Engine callbacks / init                                            */
/* ------------------------------------------------------------------ */

function onEngineChange(scene) {
  window.nexus.autosaveScene('board', scene);
  setSavePending();
}

function onHistory(h) {
  $('#undoBtn').disabled = !h.canUndo;
  $('#redoBtn').disabled = !h.canRedo;
  $('#deleteBtn').disabled = !h.selectedCount;
  $('#itemCount').textContent = `${h.itemCount} elemento${h.itemCount === 1 ? '' : 's'}`;
  const sel = h.selectedCount || 0;
  $('#selectionPill').textContent = sel ? `${sel} selecionado${sel === 1 ? '' : 's'}` : 'Nenhum item selecionado';
}

function updateZoomBadges() {
  if (!engine) return;
  const pct = Math.round(engine.view.scale * 100);
  $('#zoomBadge').textContent = `${pct}%`;
  $('#zoomLabel').textContent = `${pct}%`;
}

async function boot() {
  setStaticIcons();
  renderRail();
  renderTabs();
  const data = await window.nexus.bootstrap();
  catalog = data.catalog;
  champions = data.champions || [];
  lolVersion = data.lolVersion || '';
  state = data.state;
  settings = state.settings;
  applyTheme(settings);
  $('#patchLabel').textContent = lolVersion ? `Patch ${lolVersion}` : 'Mapa atual';
  Object.assign(style, {
    color: settings.drawing?.color || '#C8AA6E',
    width: settings.drawing?.width || 4,
    opacity: settings.drawing?.opacity ?? 1,
    arrowStyle: settings.drawing?.arrowStyle || 'attack',
    aoeId: settings.drawing?.aoeId || 'range',
    lineStyle: settings.drawing?.lineStyle || 'solid',
    fade: !!settings.drawing?.fade,
    fadeSeconds: settings.drawing?.fadeSeconds || 4
  });

  const canvas = $('#boardCanvas');
  const autosaveView = debounce(() => {
    if (engine) window.nexus.autosaveScene('board', engine.serialize());
  }, 550);
  engine = new SceneEngine(canvas, {
    mode: 'board',
    catalog,
    zoomable: true,
    panEnabled: true,
    mapW: MAP_W,
    mapH: MAP_H,
    showSelection: true,
    onHistory,
    onChange: onEngineChange,
    onViewChange: () => { updateZoomBadges(); autosaveView(); },
    onSelection: () => {}
  });

  window.__nexusEngine = engine;
  const saved = data.scenes?.board;
  bgMode = saved?.background || settings.board?.background || 'hd';
  engine.setStyle({ ...style, showLabels: settings.board?.showLabels !== false });
  applyBackground();
  engine.getImage(assetUrl(bgMode === 'minimap' ? 'map/minimap-1024.png' : 'map/summoners-rift.webp'), () => {
    $('#stageLoading').classList.add('hidden');
  });
  if (saved && Array.isArray(saved.items)) {
    engine.loadScene(saved);
  } else {
    engine.fitView();
  }
  setTimeout(() => {
    $('#stageLoading').classList.add('hidden');
    if (!engine._viewInitialized) engine.fitView();
    updateZoomBadges();
  }, 1200);

  renderSidePanel();
  renderColors();
  renderArrowOptions();
  syncToolbar();
  updateZoomBadges();
  onHistory({ canUndo: false, canRedo: false, selectedCount: 0, itemCount: engine.items.length });

  bindEvents();

  window.addEventListener('beforeunload', () => {
    if (engine) window.nexus.autosaveScene('board', engine.serialize());
  });
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:#ff8f9a;padding:20px;font:12px monospace">Falha ao iniciar o mini-quadro:\n${String(err?.stack || err)}</pre>`;
});
