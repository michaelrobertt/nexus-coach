import { icon } from '../icons.js';
import {
  applyTheme, assetUrl, debounce, escapeHtml, isTypingTarget,
  luminance, matchShortcut, setupRangeFill, toast, STAMP_CATEGORIES, TOOL_ICONS, TOOL_LABELS
} from '../ui.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let state = null;
let settings = null;
let ui = null;
let catalog = null;
let champions = [];
let currentPanel = null;
let panelEpoch = 0;
let activeCat = 'champions';
let lastColorsSig = '';
let lastPresetsSig = '';
let widthFill = null;
let opacityFill = null;

const PANEL_ADD = {
  stamps: 430,
  aoe: 390,
  presets: 410,
  colors: 300,
  fade: 285,
  shapes: 270,
  arrows: 350
};

let collapsedHeight = 158;
let orbDrag = null;

function panelTargetHeight(name) {
  return Math.max(320, collapsedHeight + (PANEL_ADD[name] || 350));
}

const PANEL_TITLES = {
  stamps: 'Biblioteca de elementos',
  aoe: 'Zonas de alcance e controle',
  presets: 'Presets de coaching',
  colors: 'Paleta de cores',
  fade: 'Tinta temporária',
  shapes: 'Formas e traços',
  arrows: 'Setas táticas'
};

const PANEL_HINTS = {
  stamps: 'Clique em um campeão ou elemento para carimbar no overlay',
  aoe: 'Escolha uma zona · clique e arraste na tela para dimensionar',
  presets: 'Combinações prontas de ferramenta, cor e estilo',
  colors: 'Clique para aplicar · passe o mouse para remover',
  fade: 'Marcações que desaparecem sozinhas',
  shapes: 'Selecione uma forma e desenhe no overlay',
  arrows: 'Estilos visuais para ofensiva, defesa e previsão'
};

const TAG_PT = {
  Fighter: 'Lutador', Mage: 'Mago', Assassin: 'Assassino', Marksman: 'Atirador',
  Support: 'Suporte', Tank: 'Tanque'
};

const TOOL_GROUPS = [
  ['select', 'pen', 'pencil', 'marker', 'eraser'],
  ['line', 'arrow', 'curve', 'route'],
  ['circle', 'rect'],
  ['text', 'stamp', 'aoe']
];

const EXTRA_TOOLS = ['triangle', 'hexagon', 'cone'];

function patchUI(patch) {
  return window.nexus.patchUI(patch);
}

async function patchUISync(patch) {
  const next = await window.nexus.patchUI(patch);
  applyState(next);
  return next;
}

function hidePanelDom() {
  $('#panel')?.classList.add('hidden');
}

function toolKey(tool) {
  const key = settings?.shortcuts?.tools?.[tool];
  if (!key) return '';
  if (key.length > 3) return '';
  return key.replace('Control+', '⌃').replace('Shift+', '⇧');
}

function setStaticIcons() {
  $('#brandLogo').innerHTML = icon('logo', 27);
  $('#boardBtn').innerHTML = icon('board', 17);
  $('#settingsBtn').innerHTML = icon('settings', 17);
  $('#compactBtn').innerHTML = icon('hide', 17);
  $('#hideBtn').innerHTML = icon('close', 17);
  $('#orbIcon').innerHTML = icon('hide', 22);
  $('#undoBtn').innerHTML = icon('undo', 17);
  $('#redoBtn').innerHTML = icon('redo', 17);
  $('#clearBtn').innerHTML = icon('trash', 16);
  $('#saveBtn').innerHTML = icon('save', 16);
  $('#loadBtn').innerHTML = icon('folder', 16);
  $('#exportBtn').innerHTML = icon('image', 16);
  $('#colorsBtn').innerHTML = icon('palette', 13);
  $('#panelClose').innerHTML = icon('close', 15);
  $('#fadeBtn').innerHTML = icon('droplet', 16);
  $('#eyeBtn').innerHTML = icon('eye', 16);
}

function renderTools() {
  const wrap = $('#toolGroups');
  wrap.innerHTML = TOOL_GROUPS.map((group) => `
    <div class="tool-group">
      ${group.map((tool) => toolButton(tool)).join('')}
      ${group.includes('aoe') ? `
        <button class="tool-btn" data-tool="shapes" data-panel="shapes" data-tip="Mais formas geométricas" aria-label="Mais formas">
          ${icon('grid', 19)}
        </button>` : ''}
    </div>
  `).join('');
}

function toolButton(tool) {
  const label = TOOL_LABELS[tool] || tool;
  const key = toolKey(tool);
  const tip = key ? `${label} · ${key}` : label;
  return `<button class="tool-btn" data-tool="${tool}" data-tip="${escapeHtml(tip)}" aria-label="${escapeHtml(label)}">
    ${icon(TOOL_ICONS[tool] || 'circle', 19)}
    ${key ? `<span class="tool-key">${escapeHtml(key)}</span>` : ''}
  </button>`;
}

function renderHeaderState() {
  const on = !!ui.drawMode;
  const status = $('#modeStatus');
  status.classList.toggle('on', on);
  $('#modeStatusText').textContent = on ? 'Desenho' : 'Interação';
  const btn = $('#drawToggle');
  btn.classList.toggle('on', on);
  btn.innerHTML = on
    ? `${icon('mouse', 15)}<span>Interagir</span>`
    : `${icon('draw', 15)}<span>Ativar desenho</span>`;
  btn.title = on ? 'Desativar o modo desenho e voltar a controlar o computador' : 'Ativar o modo de desenho sobre o jogo';

  $('#eyeBtn').innerHTML = icon(ui.markingsVisible ? 'eye' : 'eyeOff', 16);
  $('#eyeBtn').classList.toggle('off', !ui.markingsVisible);
  $('#eyeBtn').title = ui.markingsVisible ? 'Ocultar marcações (F)' : 'Mostrar marcações (F)';

  const fade = $('#fadeBtn');
  fade.classList.toggle('active', !!ui.fade);
  fade.title = ui.fade ? 'Tinta temporária ativa' : 'Ativar tinta temporária';
  $('#fadeTimeBtn').textContent = `${Number(ui.fadeSeconds) || 4}s`;
}

function renderPalette() {
  const colors = (settings.colors || []).slice(0, 5);
  $('#quickColors').innerHTML = colors.map((c) => `
    <button class="swatch ${luminance(c) > 0.72 ? 'light' : ''} ${String(ui.color).toLowerCase() === String(c).toLowerCase() ? 'active' : ''}"
      style="background:${escapeHtml(c)}" data-color="${escapeHtml(c)}" title="${escapeHtml(c)}"></button>
  `).join('');
}

function renderFavorites() {
  const block = $('#favoritesBlock');
  const favs = (settings.favorites || [])
    .filter((t) => TOOL_ICONS[t] || t === 'shapes')
    .slice(0, 5);
  block.classList.toggle('hidden', !favs.length);
  $('#favoriteTools').innerHTML = favs.map((t) => {
    const label = t === 'shapes' ? 'Formas' : (TOOL_LABELS[t] || t);
    return `<button class="icon-btn" data-tool="${t}" data-tip="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
      ${icon(t === 'shapes' ? 'grid' : (TOOL_ICONS[t] || 'circle'), 15)}
    </button>`;
  }).join('');
}

function renderStyleButtons() {
  const ls = ui.lineStyle || 'solid';
  const lsName = { solid: 'Sólido', dashed: 'Tracejado', dotted: 'Pontilhado' }[ls] || 'Sólido';
  $('#strokeStyleBtn').innerHTML = `${icon('stroke', 16)}${ls !== 'solid' ? `<span class="line-mode-dot"></span>` : ''}`;
  $('#strokeStyleBtn').title = `Estilo do traço: ${lsName} · clique para alternar`;
  $('#strokeStyleBtn').classList.toggle('active', ls !== 'solid');
  const styles = catalog.arrowStyles || [];
  const current = styles.find((s) => s.id === ui.arrowStyle) || styles[0];
  const dash = current?.dash?.length ? 'arrow-dash' : 'arrow-dot';
  $('#arrowStyleBtn').innerHTML = `<span class="${dash}" style="color:${current?.color || ui.color}"></span><span>${escapeHtml(current?.name || 'Seta')}</span>`;
  $('#arrowStyleBtn').classList.toggle('active', currentPanel === 'arrows');
  $('#aoeBtn').querySelector('.style-ico').innerHTML = icon('aoe', 13);
  $('#stampsBtn').querySelector('.style-ico').innerHTML = icon('stamp', 13);
  $('#presetsBtn').querySelector('.style-ico').innerHTML = icon('sparkles', 13);
  $('#aoeBtn').classList.toggle('active', currentPanel === 'aoe' || ui.tool === 'aoe');
  $('#stampsBtn').classList.toggle('active', currentPanel === 'stamps' || ui.tool === 'stamp');
  $('#presetsBtn').classList.toggle('active', currentPanel === 'presets');
}

function syncControls() {
  const w = $('#widthRange');
  const o = $('#opacityRange');
  if (document.activeElement !== w) w.value = String(ui.width);
  if (document.activeElement !== o) o.value = String(Math.round((ui.opacity ?? 1) * 100));
  $('#widthOut').textContent = String(ui.width);
  $('#opacityOut').textContent = `${Math.round((ui.opacity ?? 1) * 100)}%`;
  widthFill?.();
  opacityFill?.();
}

function renderActiveTools() {
  const active = ui.tool;
  $$('.tool-btn[data-tool], .favorite-tools [data-tool]').forEach((el) => {
    const t = el.dataset.tool;
    if (t === 'shapes') {
      el.classList.toggle('active', currentPanel === 'shapes' || EXTRA_TOOLS.includes(active));
    } else {
      el.classList.toggle('active', t === active);
    }
  });
}

function applyState(next) {
  const previousPanel = currentPanel;
  state = next;
  settings = next.settings;
  ui = next.ui;
  applyTheme(settings);
  const toolbar = settings.toolbar || {};
  document.body.classList.toggle('layout-vertical', toolbar.layout === 'vertical');
  document.body.classList.toggle('layout-horizontal', toolbar.layout !== 'vertical');
  document.body.classList.toggle('size-small', toolbar.size === 'small');
  document.body.classList.toggle('size-medium', !toolbar.size || toolbar.size === 'medium');
  document.body.classList.toggle('size-large', toolbar.size === 'large');
  document.body.classList.toggle('mode-minimal', settings.interface?.displayMode === 'minimal');
  document.body.classList.toggle('compact', !!ui.compact);
  if (!currentPanel && !ui.compact) collapsedHeight = window.innerHeight;
  document.documentElement.style.setProperty('--tool-scale', String(settings.toolbar?.scale || 1));
  renderHeaderState();
  renderPalette();
  renderFavorites();
  renderStyleButtons();
  syncControls();
  renderActiveTools();
  updatePanelButtonStates();
  updateTeamToggle();

  if (ui.compact) {
    if (currentPanel) {
      currentPanel = null;
      hidePanelDom();
    }
    orbDrag = null;
    return;
  }

  const panelFromState = ui.panel || null;
  if (panelFromState !== currentPanel && panelFromState !== previousPanel) {
    panelEpoch++;
    currentPanel = panelFromState;
    syncPanelWindow();
  } else if (currentPanel && panelFromState === null) {
    panelEpoch++;
    currentPanel = null;
    hidePanelDom();
    window.nexus.setToolbarPanel(false, 0);
  }

  const colorsSig = JSON.stringify(settings.colors || []);
  if (currentPanel === 'colors' && colorsSig !== lastColorsSig) {
    lastColorsSig = colorsSig;
    renderPanel();
  }
  const presetsSig = JSON.stringify(state.presets?.custom || []);
  if (currentPanel === 'presets' && presetsSig !== lastPresetsSig) {
    lastPresetsSig = presetsSig;
    renderPanel();
  }
  if (currentPanel === 'fade' && !$('#autoClearSelect')) renderPanel();
}

function updatePanelButtonStates() {
  $('#aoeBtn')?.classList.toggle('active', currentPanel === 'aoe' || ui.tool === 'aoe');
  $('#strokeStyleBtn')?.classList.toggle('active', (ui.lineStyle || 'solid') !== 'solid');
  $('#stampsBtn')?.classList.toggle('active', currentPanel === 'stamps' || ui.tool === 'stamp');
  $('#presetsBtn')?.classList.toggle('active', currentPanel === 'presets');
  $('#arrowStyleBtn')?.classList.toggle('active', currentPanel === 'arrows');
}

function updateTeamToggle() {
  $$('.team-toggle button').forEach((b) => {
    b.classList.toggle('active', (ui.stampTeam || 'ally') === b.dataset.team);
  });
}

function syncPanelWindow() {
  if (ui?.compact) return;
  if (currentPanel) {
    renderPanel();
    window.nexus.setToolbarPanel(true, panelTargetHeight(currentPanel));
  } else {
    hidePanelDom();
    window.nexus.setToolbarPanel(false, 0);
  }
}

/* ------------------------------------------------------------------ */
/* Panel                                                              */
/* ------------------------------------------------------------------ */

async function openPanel(name) {
  if (currentPanel === name) {
    await closePanel();
    return;
  }
  const epoch = ++panelEpoch;
  currentPanel = name;
  renderPanel();
  await patchUI({ panel: name });
  if (epoch !== panelEpoch || currentPanel !== name) return;
  window.nexus.setToolbarPanel(true, panelTargetHeight(name));
  $('#panel')?.classList.remove('hidden');
  if (name === 'stamps') {
    requestAnimationFrame(() => $('#stampSearch')?.focus());
  }
}

async function closePanel(focus = true) {
  if (!currentPanel) return;
  const epoch = ++panelEpoch;
  currentPanel = null;
  await patchUI({ panel: null });
  if (epoch !== panelEpoch) return;
  window.nexus.setToolbarPanel(false, 0);
  $('#panel')?.classList.add('hidden');
  if (focus && ui?.drawMode) window.nexus.focusOverlay();
}

function renderPanel() {
  const panel = $('#panel');
  const body = $('#panelBody');
  if (!currentPanel) {
    panel.classList.add('hidden');
    body.innerHTML = '';
    return;
  }
  panel.classList.remove('hidden');
  $('#panelTitle').textContent = PANEL_TITLES[currentPanel] || currentPanel;
  $('#panelHint').textContent = PANEL_HINTS[currentPanel] || '';
  if (currentPanel === 'stamps') body.innerHTML = stampPanelHTML();
  else if (currentPanel === 'aoe') body.innerHTML = aoePanelHTML();
  else if (currentPanel === 'presets') body.innerHTML = presetsPanelHTML();
  else if (currentPanel === 'colors') body.innerHTML = colorsPanelHTML();
  else if (currentPanel === 'fade') body.innerHTML = fadePanelHTML();
  else if (currentPanel === 'shapes') body.innerHTML = shapesPanelHTML();
  else if (currentPanel === 'arrows') body.innerHTML = arrowsPanelHTML();
  lastColorsSig = JSON.stringify(settings.colors || []);
  lastPresetsSig = JSON.stringify(state.presets?.custom || []);
  updatePanelButtonStates();
  updateTeamToggle();
}

function stampPanelHTML() {
  const cats = Object.keys(STAMP_CATEGORIES);
  const counts = Object.fromEntries(cats.map((c) => [c, c === 'champions' ? champions.length : (catalog.stamps || []).filter((s) => s.cat === c).length]));
  const tabs = cats.map((cat) => `
    <button class="cat-tab ${activeCat === cat ? 'active' : ''}" data-cat="${cat}">
      ${icon(STAMP_CATEGORIES[cat].icon, 13)}
      ${STAMP_CATEGORIES[cat].label}
      <span class="cat-count">${counts[cat]}</span>
    </button>
  `).join('');
  const content = activeCat === 'champions' ? championGridHTML() : stampGridHTML(activeCat);
  return `
    <div class="cat-tabs">${tabs}</div>
    <div class="library-toolbar">
      <div class="search-field">
        ${icon('search', 14)}
        <input id="stampSearch" data-search-input placeholder="Buscar ${activeCat === 'champions' ? 'campeão' : 'elemento'}…" autocomplete="off" spellcheck="false" />
      </div>
      <div class="team-toggle">
        <button data-team="ally" class="${ui.stampTeam !== 'enemy' ? 'active' : ''}"><span class="dot"></span>Aliado</button>
        <button data-team="enemy" class="${ui.stampTeam === 'enemy' ? 'active' : ''}"><span class="dot"></span>Inimigo</button>
      </div>
    </div>
    <div class="library-grid ${activeCat === 'champions' ? 'champ-grid' : ''}" id="stampGrid">${content}</div>
    <div class="empty-state hidden" id="stampEmpty">
      ${icon('search', 30)}
      <b>Nenhum resultado</b>
      <p>Tente outro termo de busca.</p>
    </div>
    <div class="panel-note">${icon('info', 14)}<span>Os elementos são carimbos editáveis: clique para posicionar, depois use <b>Selecionar</b> para arrastar, redimensionar e rotacionar. Campeões recebem o anel azul (aliado) ou vermelho (inimigo).</span></div>
  `;
}

function championGridHTML() {
  return champions.map((c) => {
    const search = `${c.name} ${c.id} ${(c.tags || []).join(' ')}`.toLowerCase();
    return `
      <button class="stamp-tile champ" data-champ="${escapeHtml(c.id)}" data-search="${escapeHtml(search)}" title="${escapeHtml(c.name)} · ${escapeHtml(c.title || '')}">
        <img class="champ-art" loading="lazy" src="${assetUrl(`champions/${c.image}`)}" alt="${escapeHtml(c.name)}" />
        <span class="stamp-name">${escapeHtml(c.name)}</span>
        <span class="tag-list">${(c.tags || []).slice(0, 2).map((t) => `<span class="tag">${escapeHtml(TAG_PT[t] || t)}</span>`).join('')}</span>
      </button>
    `;
  }).join('');
}

function stampGridHTML(cat) {
  const stamps = (catalog.stamps || []).filter((s) => s.cat === cat);
  if (!stamps.length) return `<div class="empty-state">${icon('layers', 30)}<b>Sem elementos nesta categoria</b></div>`;
  return stamps.map((s) => {
    const search = `${s.name} ${s.id}`.toLowerCase();
    return `
      <button class="stamp-tile ${ui.stampId === s.id ? 'active' : ''}" data-stamp="${escapeHtml(s.id)}" data-search="${escapeHtml(search)}" title="${escapeHtml(s.name)}">
        ${stampPreviewHTML(s)}
        <span class="stamp-name">${escapeHtml(s.name)}</span>
      </button>
    `;
  }).join('');
}

function stampPreviewHTML(s) {
  if (s.img) return `<img class="stamp-img" loading="lazy" src="${assetUrl(s.img)}" alt="" />`;
  if (s.vector === 'ping') {
    const colors = { danger: '#FF4D5E', missing: '#FFD166', assist: '#28E0A0', omw: '#3FC7FF', vision: '#A78BFA', push: '#FF8A3D' };
    const glyph = { danger: '!', missing: '?', assist: '+', omw: '»', vision: '◉', push: '⇈' }[s.ping] || '!';
    return `<span class="ping-prev" style="color:${colors[s.ping] || '#FFD166'}">${glyph}</span>`;
  }
  if (s.vector === 'role') return `<span class="role-badge">${escapeHtml(s.role)}</span>`;
  if (s.vector === 'camp') return `<span class="role-badge">${escapeHtml(s.glyph || 'C')}</span>`;
  if (s.vector === 'eye') return `<span class="stamp-img" style="color:#0AC8B9;display:grid;place-items:center">${icon('eye', 28)}</span>`;
  if (s.vector === 'scuttle') return `<span class="stamp-img" style="color:#C8AA6E;display:grid;place-items:center">${icon('target', 28)}</span>`;
  if (s.vector === 'minion' || s.vector === 'wave') {
    return `<span class="minion-prev" style="color:${s.team === 'red' ? '#FF4D5E' : '#3FC7FF'}">${icon('wave', 30)}</span>`;
  }
  return `<span class="stamp-img" style="display:grid;place-items:center">${icon('layers', 24)}</span>`;
}

function aoePanelHTML() {
  const cards = (catalog.aoePresets || []).map((p) => `
    <button class="aoe-card ${ui.aoeId === p.id ? 'active' : ''}" data-aoe="${escapeHtml(p.id)}">
      <span class="aoe-visual ${p.kind === 'cone' ? 'cone' : ''}" style="color:${p.color}">
        ${p.kind === 'cone' ? `<span class="cone-shape" style="color:${p.color}"></span>` : `<span class="ring" style="background:${p.color}"></span>`}
      </span>
      <span class="aoe-info"><b>${escapeHtml(p.name)}</b><small>${p.kind === 'cone' ? `Cone de ${p.angle || 70}°` : 'Círculo ajustável'} · ${p.dash?.length ? 'tracejado' : 'contínuo'}</small></span>
      <span class="aoe-color" style="background:${p.color}"></span>
    </button>
  `).join('');
  return `
    <div class="aoe-grid">${cards}</div>
    <div class="panel-note">${icon('info', 14)}<span>Clique em uma zona para ativá-la e depois clique sobre o overlay. Arraste para definir o tamanho. Use o <b>Selecionar</b> para mover, redimensionar ou rotacionar depois de posicionar.</span></div>
    <div class="panel-actions">
      <button class="btn sm" data-action="fade-panel">${icon('droplet', 14)} Tinta temporária</button>
      <button class="btn sm" data-action="clear-temp">${icon('eraser', 14)} Limpar temporárias</button>
    </div>
  `;
}

function presetsPanelHTML() {
  const custom = state.presets?.custom || [];
  const builtins = catalog.coachPresets || [];
  const card = (p, isCustom) => {
    const st = p.style || {};
    const tool = st.tool || 'pen';
    return `
      <div class="preset-card" data-preset="${isCustom ? 'custom' : 'builtin'}" data-id="${escapeHtml(p.id)}">
        <span class="preset-dot" style="color:${st.color || ui.color}">${icon(TOOL_ICONS[tool] || 'sparkles', 14)}</span>
        <span class="preset-info"><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.desc || toolDescription(st))}</small></span>
        ${isCustom ? `<button class="preset-remove" data-remove-preset="${escapeHtml(p.id)}" title="Excluir preset">${icon('close', 12)}</button>` : `<span class="badge gold">Nexus</span>`}
      </div>
    `;
  };
  return `
    <div class="preset-section">
      <div class="preset-section-head"><span class="section-label">Meus presets</span><span class="hex-line"></span><span class="muted" style="font-size:9.5px">${custom.length}</span></div>
      ${custom.length ? `<div class="preset-list">${custom.map((p) => card(p, true)).join('')}</div>` : `<div class="empty-state" style="padding:22px 10px">${icon('star', 26)}<b>Nenhum preset salvo</b><p>Configure ferramenta, cor e estilo abaixo e salve sua combinação.</p></div>`}
      <div class="preset-save-row">
        <input id="presetName" placeholder="Nome do novo preset (ex.: Gank bot vermelho)" maxlength="48" />
        <button class="btn primary sm" data-action="save-preset">${icon('plus', 14)} Salvar estilo atual</button>
      </div>
    </div>
    <div class="preset-section">
      <div class="preset-section-head"><span class="section-label">Biblioteca Nexus</span><span class="hex-line"></span><span class="muted" style="font-size:9.5px">${builtins.length}</span></div>
      <div class="preset-list">${builtins.map((p) => card(p, false)).join('')}</div>
    </div>
    <div class="panel-actions">
      <button class="btn sm" data-action="open-settings">${icon('settings', 14)} Gerenciar favoritos</button>
      <button class="btn sm danger" data-action="reset-presets">${icon('reset', 14)} Restaurar presets padrão</button>
    </div>
    <div class="panel-note">${icon('info', 14)}<span>Presets guardam ferramenta, cor, espessura, opacidade, estilo de seta e duração da tinta temporária. Aplique com um clique e continue o desenho.</span></div>
  `;
}

function toolDescription(st) {
  const parts = [];
  if (st.tool) parts.push(TOOL_LABELS[st.tool] || st.tool);
  if (st.arrowStyle) parts.push((catalog.arrowStyles || []).find((s) => s.id === st.arrowStyle)?.name || st.arrowStyle);
  else if (st.aoeId) parts.push((catalog.aoePresets || []).find((s) => s.id === st.aoeId)?.name || st.aoeId);
  if (st.color) parts.push(st.color);
  return parts.join(' · ');
}

function colorsPanelHTML() {
  const colors = settings.colors || [];
  return `
    <div class="color-grid">
      ${colors.map((c) => `
        <button class="color-card ${String(ui.color).toLowerCase() === String(c).toLowerCase() ? 'active' : ''}" data-color="${escapeHtml(c)}" style="background:${escapeHtml(c)}" title="${escapeHtml(c)}">
          <span class="remove" data-remove-color="${escapeHtml(c)}" title="Remover cor">×</span>
        </button>
      `).join('')}
    </div>
    <div class="color-add-row">
      <input type="color" id="newColor" value="${escapeHtml(ui.color)}" title="Escolher cor" />
      <input class="input" id="newColorHex" value="${escapeHtml(ui.color)}" maxlength="7" spellcheck="false" />
      <button class="btn sm primary" data-action="add-color">${icon('plus', 14)} Adicionar à paleta</button>
      <button class="btn sm ghost" data-action="reset-colors">${icon('reset', 14)} Padrão</button>
    </div>
    <div class="panel-note">${icon('info', 14)}<span>A paleta é usada nos atalhos rápidos da barra e nos presets. Cores personalizadas ficam salvas entre sessões.</span></div>
  `;
}

function fadePanelHTML() {
  const durations = [2, 3, 4, 6, 10, 15, 30];
  const auto = settings.overlay?.autoClear || 0;
  return `
    <div class="fade-hero">
      <span class="fade-orb">${icon('droplet', 20)}</span>
      <div><b>Tinta temporária (fading ink)</b><p>Novas marcações desaparecem suavemente após o tempo escolhido. Ideal para explicações rápidas sobre replays.</p></div>
      <button class="switch ${ui.fade ? 'on' : ''}" data-action="toggle-fade" style="margin-left:auto"></button>
    </div>
    <div class="option-row">
      <div><span class="opt-label">Duração das marcações</span><span class="opt-sub">Tempo até o traço sumir por completo</span></div>
      <div class="duration-chips">
        ${durations.map((d) => `<button data-duration="${d}" class="${Number(ui.fadeSeconds) === d ? 'active' : ''}">${d}s</button>`).join('')}
      </div>
    </div>
    <div class="option-row">
      <div><span class="opt-label">Limpeza automática do overlay</span><span class="opt-sub">Remove todas as marcações após um intervalo</span></div>
      <select class="select" id="autoClearSelect" data-autoclear style="width:150px;height:32px">
        <option value="0" ${auto === 0 ? 'selected' : ''}>Desativada</option>
        <option value="30" ${auto === 30 ? 'selected' : ''}>30 segundos</option>
        <option value="60" ${auto === 60 ? 'selected' : ''}>1 minuto</option>
        <option value="120" ${auto === 120 ? 'selected' : ''}>2 minutos</option>
        <option value="300" ${auto === 300 ? 'selected' : ''}>5 minutos</option>
        <option value="600" ${auto === 600 ? 'selected' : ''}>10 minutos</option>
      </select>
    </div>
    <div class="panel-actions">
      <button class="btn primary" data-action="toggle-fade">${icon('droplet', 14)} ${ui.fade ? 'Desativar tinta temporária' : 'Ativar tinta temporária'}</button>
      <button class="btn sm" data-action="clear-temp">${icon('eraser', 14)} Limpar marcações temporárias</button>
    </div>
    <div class="panel-note">${icon('info', 14)}<span>Ao ativar, um indicador azul aparece na barra. Você pode alternar com o atalho <kbd>F</kbd> (configurável). O intervalo padrão fica salvo nas configurações.</span></div>
  `;
}

function shapesPanelHTML() {
  const tools = [
    ['line', 'Linha reta'], ['arrow', 'Seta'], ['curve', 'Seta curva'], ['route', 'Rota tática'],
    ['circle', 'Elipse'], ['rect', 'Retângulo'], ['triangle', 'Triângulo'], ['hexagon', 'Hexágono'],
    ['cone', 'Cone'], ['text', 'Texto'], ['stamp', 'Elemento'], ['aoe', 'Zona AoE']
  ];
  return `
    <div class="shape-grid">
      ${tools.map(([t, label]) => `
        <button class="shape-card ${ui.tool === t ? 'active' : ''}" data-tool="${t}">
          ${icon(TOOL_ICONS[t] || 'circle', 24)}
          <span>${label}</span>
        </button>
      `).join('')}
    </div>
    <div class="panel-note">${icon('info', 14)}<span>Shift mantém proporções e ângulos precisos. Para rotacionar, selecione um item e arraste a alça circular acima da caixa de seleção.</span></div>
  `;
}

function arrowsPanelHTML() {
  return `
    <div class="arrow-style-list">
      ${(catalog.arrowStyles || []).map((s) => arrowStyleCard(s)).join('')}
    </div>
    <div class="panel-note">${icon('info', 14)}<span>Cada estilo combina cor, tracejado e ponta de seta. Aplique e desenhe rotas, ganks, flancos ou linhas de visão com leitura imediata.</span></div>
  `;
}

function arrowStyleCard(s) {
  const dash = s.dash?.length ? `stroke-dasharray="${s.dash.join(' ')}"` : '';
  const head = s.head === 'open'
    ? `<path d="M84 14 96 20 84 26" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linecap="round"/>`
    : s.head === 'double'
      ? `<path d="M74 14 86 20 74 26" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linecap="round"/><path d="M84 14 96 20 84 26" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linecap="round"/>`
      : `<path d="M84 12 98 20 84 28Z" fill="${s.color}"/>`;
  const dot = s.head === 'dot' ? `<circle cx="96" cy="20" r="5" fill="${s.color}"/>` : '';
  return `
    <button class="arrow-style-card ${ui.arrowStyle === s.id ? 'active' : ''}" data-arrow="${s.id}">
      <span class="arrow-preview">
        <svg viewBox="0 0 100 40">
          <path d="M4 32 C 26 32, 44 8, 66 14 S 84 22, 94 20" fill="none" stroke="${s.color}" stroke-width="3" ${dash} stroke-linecap="round" opacity="${s.glow ? '1' : '.9'}"/>
          ${head}${dot}
        </svg>
      </span>
      <span class="preset-info"><b>${escapeHtml(s.name)}</b><small>${escapeHtml(s.desc || '')}</small></span>
      <span class="style-color" style="background:${s.color}"></span>
    </button>
  `;
}

/* ------------------------------------------------------------------ */
/* Actions                                                            */
/* ------------------------------------------------------------------ */

async function chooseTool(tool, opts = {}) {
  if (!tool) return;
  if (EXTRA_TOOLS.includes(tool) && !opts.keepPanel) {
    // Permanece no painel de formas apenas se o usuário clicar repetidamente.
  }
  const patch = { tool, drawMode: true, panel: null };
  if (tool === 'stamp' && !ui.stampId) {
    const epoch = ++panelEpoch;
    currentPanel = 'stamps';
    patch.panel = 'stamps';
    await patchUI(patch);
    if (epoch !== panelEpoch || currentPanel !== 'stamps') return;
    renderPanel();
    window.nexus.setToolbarPanel(true, panelTargetHeight('stamps'));
    requestAnimationFrame(() => $('#stampSearch')?.focus());
    return;
  }
  if (tool === 'aoe') {
    const epoch = ++panelEpoch;
    currentPanel = 'aoe';
    patch.panel = 'aoe';
    await patchUI(patch);
    if (epoch !== panelEpoch || currentPanel !== 'aoe') return;
    renderPanel();
    window.nexus.setToolbarPanel(true, panelTargetHeight('aoe'));
    return;
  }
  currentPanel = null;
  panelEpoch++;
  hidePanelDom();
  await patchUI(patch);
  window.nexus.setToolbarPanel(false, 0);
  window.nexus.focusOverlay();
}

async function applyStyleAndClose(stylePatch, message) {
  currentPanel = null;
  panelEpoch++;
  hidePanelDom();
  await patchUI({ ...stylePatch, panel: null, drawMode: true });
  window.nexus.setToolbarPanel(false, 0);
  window.nexus.focusOverlay();
  if (message) toast(message, 'success');
}

async function selectColor(color) {
  await patchUI({ color });
}

async function toggleFavorite(tool) {
  if (tool === 'shapes') return;
  const favs = [...(settings.favorites || [])];
  const idx = favs.indexOf(tool);
  if (idx >= 0) favs.splice(idx, 1);
  else {
    if (favs.length >= 8) favs.shift();
    favs.push(tool);
  }
  await window.nexus.patchState({ settings: { favorites: favs } });
  toast(idx >= 0 ? 'Removido dos favoritos' : 'Adicionado aos favoritos · organize em Configurações', 'info');
}

async function savePresetFromPanel() {
  const input = $('#presetName');
  const name = (input?.value || '').trim();
  if (name.length < 2) { toast('Dê um nome ao preset', 'error'); input?.focus(); return; }
  const style = {
    tool: ui.tool,
    color: ui.color,
    width: ui.width,
    opacity: ui.opacity,
    arrowStyle: ui.arrowStyle,
    aoeId: ui.aoeId,
    fade: ui.fade,
    fadeSeconds: ui.fadeSeconds
  };
  if (ui.tool === 'stamp') {
    style.stampId = ui.stampId;
    style.stampLabel = ui.stampLabel;
    style.stampTeam = ui.stampTeam;
  }
  const preset = {
    id: `custom_${Date.now().toString(36)}`,
    name,
    desc: toolDescription(style),
    style,
    custom: true
  };
  const custom = [...(state.presets?.custom || []), preset];
  await window.nexus.patchState({ presets: { custom } });
  toast('Preset salvo', 'success');
  renderPanel();
}

async function addColorFromPanel() {
  const hex = ($('#newColorHex')?.value || '').trim();
  if (!/^#?[0-9a-f]{6}$/i.test(hex)) { toast('Cor hexadecimal inválida', 'error'); return; }
  const color = hex.startsWith('#') ? hex.toUpperCase() : `#${hex.toUpperCase()}`;
  const colors = [...new Set([...(settings.colors || []), color])];
  await window.nexus.patchState({ settings: { colors } });
  await patchUI({ color });
  toast('Cor adicionada à paleta', 'success');
  renderPanel();
}

async function removeColor(color) {
  const colors = (settings.colors || []).filter((c) => c.toLowerCase() !== String(color).toLowerCase());
  if (colors.length < 2) { toast('Mantenha ao menos duas cores na paleta', 'error'); return; }
  await window.nexus.patchState({ settings: { colors } });
  renderPanel();
}

async function onPanelClick(e) {
  const favoriteRemove = e.target.closest('[data-remove-color]');
  if (favoriteRemove) {
    e.stopPropagation();
    await removeColor(favoriteRemove.dataset.removeColor);
    return;
  }
  const removePreset = e.target.closest('[data-remove-preset]');
  if (removePreset) {
    e.stopPropagation();
    const custom = (state.presets?.custom || []).filter((p) => p.id !== removePreset.dataset.removePreset);
    await window.nexus.patchState({ presets: { custom } });
    toast('Preset removido', 'info');
    renderPanel();
    return;
  }
  const cat = e.target.closest('[data-cat]');
  if (cat) { activeCat = cat.dataset.cat; renderPanel(); requestAnimationFrame(() => $('#stampSearch')?.focus()); return; }

  const team = e.target.closest('.team-toggle [data-team]');
  if (team) {
    await patchUISync({ stampTeam: team.dataset.team });
    updateTeamToggle();
    return;
  }

  const champ = e.target.closest('[data-champ]');
  if (champ) {
    const id = champ.dataset.champ;
    const c = champions.find((x) => x.id === id);
    await applyStyleAndClose({
      tool: 'stamp',
      stampId: `champ:${id}`,
      stampLabel: c?.name || id,
      stampTeam: ui.stampTeam || 'ally'
    }, `${c?.name || id} selecionado · clique para posicionar`);
    return;
  }

  const stamp = e.target.closest('[data-stamp]');
  if (stamp) {
    const s = (catalog.stamps || []).find((x) => x.id === stamp.dataset.stamp);
    await applyStyleAndClose({
      tool: 'stamp',
      stampId: s.id,
      stampLabel: s.name,
      stampTeam: ui.stampTeam || 'ally'
    }, `${s.name} · clique para posicionar`);
    return;
  }

  const aoe = e.target.closest('[data-aoe]');
  if (aoe) {
    const p = (catalog.aoePresets || []).find((x) => x.id === aoe.dataset.aoe);
    await applyStyleAndClose({ tool: 'aoe', aoeId: p.id, color: p.color, width: 3 }, `${p.name} · clique e arraste`);
    return;
  }

  const arrow = e.target.closest('[data-arrow]');
  if (arrow) {
    const s = (catalog.arrowStyles || []).find((x) => x.id === arrow.dataset.arrow);
    const tool = ['arrow', 'curve', 'route'].includes(ui.tool) ? ui.tool : 'arrow';
    await applyStyleAndClose({ tool, arrowStyle: s.id, color: s.color, width: Math.max(ui.width, 5) }, `Seta ${s.name} ativa`);
    return;
  }

  const shape = e.target.closest('[data-tool]');
  if (shape) {
    await chooseTool(shape.dataset.tool);
    return;
  }

  const presetEl = e.target.closest('[data-preset]');
  if (presetEl) {
    const id = presetEl.dataset.id;
    const p = presetEl.dataset.preset === 'custom'
      ? (state.presets?.custom || []).find((x) => x.id === id)
      : (catalog.coachPresets || []).find((x) => x.id === id);
    if (!p) return;
    const st = p.style || {};
    await applyStyleAndClose({
      tool: st.tool || 'pen',
      color: st.color || ui.color,
      width: st.width || ui.width,
      opacity: st.opacity ?? ui.opacity,
      arrowStyle: st.arrowStyle || ui.arrowStyle,
      aoeId: st.aoeId || ui.aoeId,
      fade: !!st.fade,
      fadeSeconds: st.fadeSeconds || ui.fadeSeconds,
      ...(st.stampId ? { stampId: st.stampId, stampLabel: st.stampLabel, stampTeam: st.stampTeam } : {})
    }, `Preset aplicado: ${p.name}`);
    return;
  }

  const duration = e.target.closest('[data-duration]');
  if (duration) {
    await patchUISync({ fadeSeconds: Number(duration.dataset.duration), fade: true });
    renderPanel();
    return;
  }

  const colorCard = e.target.closest('[data-color]');
  if (colorCard) {
    await patchUISync({ color: colorCard.dataset.color });
    $$('.color-card').forEach((c) => c.classList.toggle('active', c.dataset.color?.toLowerCase() === String(ui.color).toLowerCase()));
    return;
  }

  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'toggle-fade') {
    await patchUISync({ fade: !ui.fade });
    renderPanel();
    toast(ui.fade ? 'Tinta temporária ativa' : 'Tinta temporária desativada', 'info');
  } else if (action === 'clear-temp') {
    window.nexus.command({ type: 'clear-temp' });
    toast('Marcações temporárias limpas', 'info');
  } else if (action === 'fade-panel') {
    openPanel('fade');
  } else if (action === 'save-preset') {
    await savePresetFromPanel();
  } else if (action === 'reset-presets') {
    await window.nexus.resetPresets();
    toast('Presets restaurados', 'info');
    renderPanel();
  } else if (action === 'open-settings') {
    await closePanel(false);
    window.nexus.command({ type: 'open-settings' });
  } else if (action === 'add-color') {
    await addColorFromPanel();
  } else if (action === 'reset-colors') {
    const colors = (catalog.palette || []).map((p) => p.color);
    await window.nexus.patchState({ settings: { colors } });
    toast('Paleta restaurada', 'info');
    renderPanel();
  }
}

function onPanelInput(e) {
  const search = e.target.closest('[data-search-input]');
  if (search) {
    const q = search.value.trim().toLowerCase();
    let visible = 0;
    $$('#stampGrid [data-search]').forEach((el) => {
      const match = !q || el.dataset.search.includes(q);
      el.classList.toggle('hidden', !match);
      if (match) visible++;
    });
    $('#stampEmpty')?.classList.toggle('hidden', visible > 0);
    return;
  }
  if (e.target.id === 'newColor') {
    const hex = $('#newColorHex');
    if (hex) hex.value = e.target.value;
  }
  if (e.target.id === 'newColorHex') {
    const val = e.target.value;
    if (/^#[0-9a-f]{6}$/i.test(val)) {
      const picker = $('#newColor');
      if (picker) picker.value = val;
    }
  }
}

async function onPanelChange(e) {
  if (e.target.matches('[data-autoclear]')) {
    const seconds = Number(e.target.value);
    await window.nexus.patchState({ settings: { overlay: { autoClear: seconds } } });
    toast(seconds ? `Limpeza automática a cada ${seconds}s` : 'Limpeza automática desativada', 'info');
  }
}

/* ------------------------------------------------------------------ */
/* Toolbar events                                                     */
/* ------------------------------------------------------------------ */

function bindEvents() {
  document.addEventListener('click', async (e) => {
    const panelBtn = e.target.closest('[data-panel]');
    if (panelBtn) {
      e.preventDefault();
      openPanel(panelBtn.dataset.panel);
      return;
    }
    const toolBtn = e.target.closest('[data-tool]');
    if (toolBtn && !e.target.closest('.tb-panel')) {
      e.preventDefault();
      await chooseTool(toolBtn.dataset.tool);
      return;
    }
    const colorBtn = e.target.closest('[data-color]');
    if (colorBtn && !e.target.closest('.tb-panel')) {
      await selectColor(colorBtn.dataset.color);
      return;
    }
  });

  document.addEventListener('contextmenu', async (e) => {
    const toolBtn = e.target.closest('[data-tool]');
    if (toolBtn && !e.target.closest('.tb-panel')) {
      e.preventDefault();
      await toggleFavorite(toolBtn.dataset.tool);
      return;
    }
    e.preventDefault();
  });

  $('#modeStatus').addEventListener('click', () => window.nexus.command({ type: 'toggle-draw' }));
  $('#drawToggle').addEventListener('click', async () => {
    await closePanel(false);
    window.nexus.command({ type: 'toggle-draw' });
  });
  $('#boardBtn').addEventListener('click', () => window.nexus.command({ type: 'toggle-board' }));
  $('#settingsBtn').addEventListener('click', async () => {
    await closePanel(false);
    await patchUI({ drawMode: false, panel: null });
    window.nexus.command({ type: 'open-settings' });
  });
  $('#compactBtn').addEventListener('click', async () => {
    await closePanel(false);
    window.nexus.compactApp();
  });
  $('#hideBtn').addEventListener('click', async () => {
    await closePanel(false);
    window.nexus.command({ type: 'hide-ui' });
  });

  const orb = $('#compactOrb');
  orb.addEventListener('pointerdown', (e) => {
    if (!ui?.compact) return;
    e.preventDefault();
    orbDrag = {
      startX: e.screenX,
      startY: e.screenY,
      winX: window.screenX,
      winY: window.screenY,
      moved: false
    };
    orb.classList.add('dragging');
    try { orb.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  orb.addEventListener('pointermove', (e) => {
    if (!orbDrag) return;
    const dx = e.screenX - orbDrag.startX;
    const dy = e.screenY - orbDrag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) orbDrag.moved = true;
    window.nexus.moveCompact(orbDrag.winX + dx, orbDrag.winY + dy).catch(() => {});
  });
  const endOrbDrag = async (e, restore) => {
    if (!orbDrag) return;
    const moved = orbDrag.moved;
    orbDrag = null;
    orb.classList.remove('dragging');
    try { orb.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (restore && !moved) await window.nexus.restoreCompact();
  };
  orb.addEventListener('pointerup', (e) => endOrbDrag(e, true));
  orb.addEventListener('pointercancel', (e) => endOrbDrag(e, false));
  orb.addEventListener('click', (e) => e.preventDefault());
  orb.addEventListener('dblclick', () => window.nexus.restoreCompact());
  orb.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      window.nexus.restoreCompact();
    }
  });
  $('#undoBtn').addEventListener('click', () => window.nexus.command({ type: 'undo' }));
  $('#redoBtn').addEventListener('click', () => window.nexus.command({ type: 'redo' }));
  $('#clearBtn').addEventListener('click', () => {
    window.nexus.command({ type: 'clear' });
    toast('Marcações limpas · Ctrl+Z para desfazer', 'info');
  });
  $('#eyeBtn').addEventListener('click', () => window.nexus.command({ type: 'toggle-markings' }));
  $('#saveBtn').addEventListener('click', () => window.nexus.command({ type: 'save' }));
  $('#loadBtn').addEventListener('click', () => window.nexus.command({ type: 'load' }));
  $('#exportBtn').addEventListener('click', (e) => {
    if (e.shiftKey) window.nexus.command({ type: 'export-markings' });
    else window.nexus.command({ type: 'export' });
  });
  $('#exportBtn').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.nexus.command({ type: 'export-markings' });
  });
  $('#fadeBtn').addEventListener('click', async () => {
    await patchUI({ fade: !ui.fade });
    toast(ui.fade ? 'Tinta temporária ativa' : 'Tinta temporária desativada', 'info');
  });
  $('#fadeTimeBtn').addEventListener('click', () => openPanel('fade'));
  $('#colorsBtn').addEventListener('click', () => openPanel('colors'));
  $('#strokeStyleBtn').addEventListener('click', async () => {
    const order = ['solid', 'dashed', 'dotted'];
    const cur = ui.lineStyle || 'solid';
    const next = order[(order.indexOf(cur) + 1) % order.length];
    await patchUI({ lineStyle: next });
    toast(`Traço: ${ { solid: 'sólido', dashed: 'tracejado', dotted: 'pontilhado' }[next] }`, 'info');
  });
  $('#arrowStyleBtn').addEventListener('click', () => openPanel('arrows'));
  $('#aoeBtn').addEventListener('click', () => openPanel('aoe'));
  $('#stampsBtn').addEventListener('click', () => openPanel('stamps'));
  $('#presetsBtn').addEventListener('click', () => openPanel('presets'));
  $('#panelClose').addEventListener('click', () => closePanel());
  $('#panelBody').addEventListener('click', onPanelClick);
  $('#panelBody').addEventListener('input', onPanelInput);
  $('#panelBody').addEventListener('change', onPanelChange);

  const widthInput = $('#widthRange');
  widthFill = setupRangeFill(widthInput);
  const opacityInput = $('#opacityRange');
  opacityFill = setupRangeFill(opacityInput);
  const pushWidth = debounce((v) => patchUI({ width: v }), 80);
  const pushOpacity = debounce((v) => patchUI({ opacity: v }), 80);
  widthInput.addEventListener('input', () => {
    const v = Number(widthInput.value);
    $('#widthOut').textContent = String(v);
    widthFill();
    pushWidth(v);
  });
  opacityInput.addEventListener('input', () => {
    const v = Number(opacityInput.value) / 100;
    $('#opacityOut').textContent = `${opacityInput.value}%`;
    opacityFill();
    pushOpacity(v);
  });

  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', () => {
    if (currentPanel && !ui?.compact) {
      window.nexus.setToolbarPanel(true, panelTargetHeight(currentPanel));
    } else if (!currentPanel && !ui?.compact) {
      collapsedHeight = window.innerHeight;
    }
  });
}

async function onKeyDown(e) {
  if (isTypingTarget() || ui?.compact) return;
  if (e.key === 'Escape') {
    if (currentPanel) { e.preventDefault(); await closePanel(); }
    else if (ui?.tool && ui.tool !== 'select') { e.preventDefault(); await patchUI({ tool: 'select' }); }
    return;
  }
  if (!settings || !state) return;
  const tools = settings.shortcuts?.tools || {};
  if (matchShortcut(e, tools.undo)) { e.preventDefault(); window.nexus.command({ type: 'undo' }); return; }
  if (matchShortcut(e, tools.redo)) { e.preventDefault(); window.nexus.command({ type: 'redo' }); return; }
  if (matchShortcut(e, tools.fade)) { e.preventDefault(); await patchUI({ fade: !ui.fade }); return; }
  if (matchShortcut(e, tools.hideMarkings)) { e.preventDefault(); window.nexus.command({ type: 'toggle-markings' }); return; }
  if (matchShortcut(e, tools.board)) { e.preventDefault(); window.nexus.command({ type: 'toggle-board' }); return; }
  const order = ['select', 'pen', 'pencil', 'marker', 'eraser', 'line', 'arrow', 'curve', 'route', 'circle', 'rect', 'triangle', 'hexagon', 'cone', 'text', 'stamp', 'aoe'];
  for (const t of order) {
    if (matchShortcut(e, tools[t])) {
      e.preventDefault();
      await chooseTool(t);
      return;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */

async function boot() {
  setStaticIcons();
  renderTools();
  bindEvents();
  const data = await window.nexus.bootstrap();
  catalog = data.catalog;
  champions = data.champions || [];
  state = data.state;
  settings = state.settings;
  ui = state.ui;
  applyState(state);
  widthFill?.();
  opacityFill?.();
  $('#panel').classList.add('hidden');
  window.nexus.onState((next) => applyState(next));
  window.nexus.onToast(({ message, type }) => toast(message, type || 'info'));
  window.nexus.onShortcutStatus((status) => {
    // A tela de configurações exibe os conflitos; aqui apenas evitamos atalhos quebrados.
    state.shortcutStatus = status;
  });
  // Atualiza a paleta rápida ao voltar de Configurações.
  window.nexus.onSettingsApplied(() => {
    applyState(state);
  });
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:#ff8f9a;padding:16px;font:12px monospace">Falha ao iniciar a barra:\n${String(err?.stack || err)}</pre>`;
});
