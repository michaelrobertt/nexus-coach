import { icon } from '../icons.js';
import {
  applyTheme, debounce, escapeHtml, formatShortcut, isTypingTarget, setupRangeFill,
  shortcutFromEvent, toast, TOOL_ICONS, TOOL_LABELS, TOOL_SHORTCUT_LABELS
} from '../ui.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const DEFAULT_SHORTCUTS = {
  drawMode: 'Control+Shift+D',
  hideUI: 'Control+Shift+H',
  board: 'Control+Shift+M',
  clear: 'Control+Shift+X',
  tools: {
    select: 'V', pen: 'P', pencil: 'B', marker: 'H', eraser: 'E', line: 'L', arrow: 'A',
    curve: '', route: 'R', circle: 'C', rect: 'X', triangle: '', hexagon: '', cone: '',
    text: 'T', stamp: 'S', aoe: 'O', fade: 'I', hideMarkings: 'F', board: 'M',
    undo: 'Control+Z', redo: 'Control+Shift+Z', escape: 'Escape'
  }
};

const TOOL_SHORTCUT_ORDER = [
  'select', 'pen', 'pencil', 'marker', 'eraser', 'line', 'arrow', 'curve', 'route',
  'circle', 'rect', 'triangle', 'hexagon', 'cone', 'text', 'stamp', 'aoe',
  'fade', 'hideMarkings', 'board', 'undo', 'redo', 'escape'
];

const GLOBAL_SHORTCUTS = [
  ['drawMode', 'Alternar desenho / interação'],
  ['hideUI', 'Ocultar ou mostrar a interface'],
  ['board', 'Abrir ou fechar o Mini-Quadro'],
  ['clear', 'Limpar todas as marcações']
];

const NAV = [
  { id: 'geral', label: 'Geral', icon: 'settings' },
  { id: 'overlay', label: 'Overlay', icon: 'monitor' },
  { id: 'ferramentas', label: 'Ferramentas', icon: 'palette' },
  { id: 'atalhos', label: 'Atalhos', icon: 'keyboard' },
  { id: 'tinta', label: 'Tinta temporária', icon: 'droplet' },
  { id: 'quadro', label: 'Mini-Quadro', icon: 'board' },
  { id: 'dados', label: 'Dados & presets', icon: 'layers' },
  { id: 'sobre', label: 'Sobre', icon: 'info' }
];

let state = null;
let settings = null;
let catalog = null;
let champions = [];
let active = 'geral';
let lolVersion = '';
let capturing = null;
let captureTimer = null;
const debouncedPatches = new Map();

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = value;
  return obj;
}

function patchFor(path, value) {
  const parts = path.split('.');
  const root = {};
  let o = root;
  for (let i = 0; i < parts.length - 1; i++) {
    o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = value;
  return { settings: root };
}

function updateSetting(path, value, opts = {}) {
  setPath(settings, path, value);
  if (path === 'theme' || path === 'accent') applyTheme(settings);
  const patch = patchFor(path, value);
  const send = debouncedPatches.get(path) || debounce((p) => window.nexus.patchState(p).catch(() => {}), opts.debounce || 40);
  debouncedPatches.set(path, send);
  send(patch);
  if (opts.rerender) renderSection();
  if (opts.toast) toast(opts.toast, 'info');
}

async function flushSetting(path, value) {
  const fn = debouncedPatches.get(path);
  if (fn) { /* debounce já agendado */ }
  await window.nexus.patchState(patchFor(path, value));
}

function usd(v) { return Number(v).toLocaleString('pt-BR'); }

/* ------------------------------------------------------------------ */
/* UI builders                                                        */
/* ------------------------------------------------------------------ */

function switchEl(path, on, label = '') {
  return `<button class="switch ${on ? 'on' : ''}" data-toggle="${path}" aria-pressed="${on ? 'true' : 'false'}" aria-label="${escapeHtml(label)}"></button>`;
}

function rangeRow(path, value, min, max, step, opts = {}) {
  const scale = opts.divide || 1;
  const out = opts.format ? opts.format(value) : `${Math.round(value / scale)}${opts.suffix || ''}`;
  return `
    <div class="range-wrap">
      <input type="range" data-range="${path}" data-divide="${scale}" data-suffix="${opts.suffix || ''}" min="${min}" max="${max}" step="${step}" value="${value}" />
      <output data-out="${path}" data-divide="${scale}" data-suffix="${opts.suffix || ''}">${out}</output>
    </div>`;
}

function selectEl(path, value, options, type = 'string') {
  return `<select class="select" data-select="${path}" data-type="${type}">
    ${options.map(([v, label]) => `<option value="${escapeHtml(v)}" ${String(v) === String(value) ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
  </select>`;
}

function card(title, desc, ico, body) {
  return `
    <section class="settings-card">
      <div class="settings-card-head">
        <h3>${icon(ico, 15)}${escapeHtml(title)}</h3>
        ${desc ? `<p>${escapeHtml(desc)}</p>` : ''}
      </div>
      <div class="settings-card-body">${body}</div>
    </section>`;
}

function pageHead(title, sub) {
  return `<div class="page-head"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(sub)}</p></div>`;
}

/* ------------------------------------------------------------------ */
/* Sections                                                           */
/* ------------------------------------------------------------------ */

function renderSection() {
  const content = $('#content');
  const builders = {
    geral: geralHTML,
    overlay: overlayHTML,
    ferramentas: ferramentasHTML,
    atalhos: atalhosHTML,
    tinta: tintaHTML,
    quadro: quadroHTML,
    dados: dadosHTML,
    sobre: sobreHTML
  };
  content.innerHTML = `<div class="content-inner">${(builders[active] || geralHTML)()}</div>`;
  renderNav();
  $$('input[type="range"]', content).forEach((r) => setupRangeFill(r));
}

function geralHTML() {
  const theme = settings.theme || 'hextech';
  const accent = settings.accent || 'gold';
  return pageHead('Geral', 'Aparência, idioma e comportamento de inicialização do Nexus Coach.') +
    card('Aparência', 'O tema é aplicado imediatamente em todas as janelas.', 'palette', `
      <div class="setting-row" style="align-items:flex-start">
        <div class="sr-info"><span class="sr-label">Tema visual</span><span class="sr-desc">Estética gamer competitiva com base escura.</span></div>
        <div class="theme-options">
          <button class="theme-card ${theme === 'hextech' ? 'active' : ''}" data-theme-choice="hextech">
            <span class="theme-swatches"><span style="background:#0a0e15"></span><span style="background:#141d29"></span><span style="background:#c8aa6e"></span></span>
            <b>Hextech</b><small>Azul-noite e ouro</small>
          </button>
          <button class="theme-card ${theme === 'nocturne' ? 'active' : ''}" data-theme-choice="nocturne">
            <span class="theme-swatches"><span style="background:#020305"></span><span style="background:#0f151e"></span><span style="background:#3fc7ff"></span></span>
            <b>Nocturne</b><small>Preto profundo</small>
          </button>
        </div>
      </div>
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Cor de destaque</span><span class="sr-desc">Botões ativos, seleções e realces da interface.</span></div>
        <div class="accent-options">
          ${[['gold', '#C8AA6E'], ['teal', '#0AC8B9'], ['violet', '#A78BFA'], ['blue', '#3FC7FF']].map(([id, c]) => `
            <button class="accent-swatch ${accent === id ? 'active' : ''}" data-accent-choice="${id}" title="${id}"><span style="background:${c}"></span></button>
          `).join('')}
        </div>
      </div>
    `) +
    card('Idioma', 'O português brasileiro é o idioma padrão desta versão.', 'globe', `
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Idioma da interface</span><span class="sr-desc">Novos idiomas serão adicionados em versões futuras.</span></div>
        <select class="select">
          <option>Português (Brasil)</option>
          <option disabled>English — em breve</option>
        </select>
      </div>
    `) +
    card('Inicialização', 'Preferências aplicadas ao abrir o Windows.', 'power', `
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Iniciar com o Windows</span><span class="sr-desc">Abre o Nexus Coach junto com o sistema.</span></div>
        ${switchEl('startup.launchAtLogin', !!settings.startup.launchAtLogin)}
      </div>
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Iniciar minimizado</span><span class="sr-desc">A barra começa oculta; use o atalho ou a bandeja para restaurar.</span></div>
        ${switchEl('startup.minimized', !!settings.startup.minimized)}
      </div>
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Iniciar em modo desenho</span><span class="sr-desc">O overlay começa capturando o mouse em vez de interagir com o sistema.</span></div>
        ${switchEl('overlay.startInDrawMode', !!settings.overlay.startInDrawMode)}
      </div>
    `);
}

function overlayHTML() {
  const displays = state?.displays || [];
  const displayOpts = [
    ['primary', 'Monitor principal'],
    ['all', 'Todos os monitores (estender)'],
    ...displays.filter((d) => !d.primary).map((d) => [d.id, d.label])
  ];
  return pageHead('Overlay', 'Controle onde o overlay aparece, transparência e comportamento do mouse.') +
    card('Monitor e posição', 'O overlay se adapta à resolução e à escala do Windows.', 'monitor', `
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Monitor do overlay</span><span class="sr-desc">Use "todos" para desenhar por vários monitores.</span></div>
        ${selectEl('overlay.display', settings.overlay.display, displayOpts)}
      </div>
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Barra de ferramentas</span><span class="sr-desc">Reposiciona a barra no topo central do monitor principal.</span></div>
        <div class="sr-control"><button class="btn sm" data-action="reset-toolbar">${icon('fit', 14)} Centralizar barra</button></div>
      </div>
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Tamanho dos ícones</span><span class="sr-desc">Escala visual das ferramentas na barra flutuante.</span></div>
        ${rangeRow('toolbar.scale', Math.round((settings.toolbar?.scale || 1) * 100), 85, 115, 1, { divide: 100, suffix: '%', format: (v) => `${Math.round(v)}%` })}
      </div>
    `) +
    card('Aparência do overlay', 'As marcações ficam acima do jogo sem alterar a janela do League of Legends.', 'layers', `
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Opacidade das marcações</span><span class="sr-desc">Transparência global aplicada ao desenho.</span></div>
        ${rangeRow('overlay.markingsOpacity', Math.round((settings.overlay.markingsOpacity ?? 1) * 100), 20, 100, 1, { divide: 100, suffix: '%', format: (v) => `${Math.round(v)}%` })}
      </div>
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Mostrar cursor durante o desenho</span><span class="sr-desc">Desative para uma apresentação mais limpa.</span></div>
        ${switchEl('overlay.showCursor', settings.overlay.showCursor !== false)}
      </div>
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Manter sempre no topo</span><span class="sr-desc">Necessário para o overlay aparecer sobre o jogo.</span></div>
        ${switchEl('overlay.alwaysOnTop', !!settings.overlay.alwaysOnTop)}
      </div>
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Iniciar em modo desenho</span><span class="sr-desc">Aplicado na próxima inicialização.</span></div>
        ${switchEl('overlay.startInDrawMode', !!settings.overlay.startInDrawMode)}
      </div>
    `) +
    card('Click-Through e limpeza', 'Alternância rápida entre desenhar e controlar o computador.', 'mouse', `
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Limpeza automática do overlay</span><span class="sr-desc">Remove todas as marcações após o intervalo.</span></div>
        ${selectEl('overlay.autoClear', settings.overlay.autoClear || 0, [[0, 'Desativada'], [30, '30 segundos'], [60, '1 minuto'], [120, '2 minutos'], [300, '5 minutos'], [600, '10 minutos']], 'number')}
      </div>
      <div class="setting-row" style="align-items:flex-start">
        <div class="sr-info"><span class="sr-label">Como alternar</span><span class="sr-desc">O atalho global mais seguro é <b>${formatShortcut(settings.shortcuts.drawMode)}</b>. Ao ativar uma ferramenta na barra, o modo desenho liga automaticamente.</span></div>
        <div class="sr-control"><span class="badge gold">Click-Through</span></div>
      </div>
      <div class="warning-box">${icon('warning', 14)}<span>Para o overlay aparecer sobre o League of Legends, use o modo de vídeo <b>Sem bordas</b> (Borderless). O modo "Tela cheia exclusiva" do jogo pode esconder overlays do Windows.</span></div>
    `);
}

function ferramentasHTML() {
  const favs = settings.favorites || [];
  const available = Object.entries(TOOL_LABELS).filter(([t]) => !favs.includes(t));
  const colors = settings.colors || [];
  return pageHead('Ferramentas', 'Paleta, favoritos e valores padrão de desenho.') +
    card('Paleta de cores', 'Clique em uma cor para defini-la como padrão. Passe o mouse para remover.', 'palette', `
      <div class="palette-editor">
        ${colors.map((c) => `<button class="color-card ${String(settings.drawing.color).toLowerCase() === c.toLowerCase() ? 'active' : ''}" data-palette-color="${escapeHtml(c)}" style="background:${escapeHtml(c)}" title="${escapeHtml(c)}"><span class="remove" data-remove-color="${escapeHtml(c)}">×</span></button>`).join('')}
      </div>
      <div class="inline-add">
        <input type="color" id="newColorPick" value="${escapeHtml(settings.drawing.color)}" />
        <input class="input" id="newColorHex" value="${escapeHtml(settings.drawing.color)}" maxlength="7" spellcheck="false" />
        <button class="btn sm primary" data-action="add-color">${icon('plus', 14)} Adicionar cor</button>
        <button class="btn sm ghost" data-action="reset-colors">${icon('reset', 14)} Restaurar paleta</button>
      </div>
      <div class="setting-row" style="margin-top:6px">
        <div class="sr-info"><span class="sr-label">Cor padrão do desenho</span><span class="sr-desc">Usada ao abrir novas sessões e ao criar itens.</span></div>
        <div class="sr-control"><input type="color" id="defaultColor" value="${escapeHtml(settings.drawing.color)}" style="width:42px;height:32px;padding:2px;border-radius:6px;border:1px solid var(--line);background:var(--bg-1)" /></div>
      </div>
    `) +
    card('Ferramentas favoritas', 'Organize até 8 atalhos exibidos na barra flutuante.', 'star', `
      <div class="fav-manager">
        ${favs.length ? favs.map((t, i) => `
          <div class="fav-row">
            <span class="fav-ico">${icon(TOOL_ICONS[t] || 'circle', 14)}</span>
            <span class="fav-name">${escapeHtml(TOOL_LABELS[t] || t)}</span>
            <div class="fav-actions">
              <button class="icon-btn" data-fav-up="${i}" title="Mover para cima" ${i === 0 ? 'disabled' : ''}>${icon('chevronUp', 12)}</button>
              <button class="icon-btn" data-fav-down="${i}" title="Mover para baixo" ${i === favs.length - 1 ? 'disabled' : ''}>${icon('chevronDown', 12)}</button>
              <button class="icon-btn danger" data-fav-remove="${i}" title="Remover">${icon('close', 12)}</button>
            </div>
          </div>
        `).join('') : `<div class="empty-mini" style="padding:14px">Nenhuma ferramenta favorita.</div>`}
      </div>
      <div class="fav-add">
        <select class="select" id="favoriteSelect">
          ${available.map(([t, label]) => `<option value="${t}">${escapeHtml(label)}</option>`).join('')}
        </select>
        <button class="btn sm" data-action="add-favorite" ${!available.length || favs.length >= 8 ? 'disabled' : ''}>${icon('plus', 14)} Adicionar</button>
      </div>
    `) +
    card('Padrões de desenho', 'Valores iniciais aplicados a novas marcações.', 'sliders', `
      <div class="setting-grid">
        <div class="field"><label>Espessura</label>${rangeRow('drawing.width', settings.drawing.width, 1, 40, 1)}</div>
        <div class="field"><label>Opacidade</label>${rangeRow('drawing.opacity', Math.round(settings.drawing.opacity * 100), 5, 100, 1, { divide: 100, suffix: '%', format: (v) => `${Math.round(v)}%` })}</div>
        <div class="field"><label>Tamanho de campeões / elementos</label>${rangeRow('drawing.stampSize', settings.drawing.stampSize || 64, 30, 140, 1, { suffix: 'px' })}</div>
        <div class="field"><label>Tamanho do texto</label>${rangeRow('drawing.textSize', settings.drawing.textSize || 38, 16, 96, 1, { suffix: 'px' })}</div>
        <div class="field"><label>Estilo de seta padrão</label>${selectEl('drawing.arrowStyle', settings.drawing.arrowStyle, (catalog?.arrowStyles || []).map((s) => [s.id, s.name]))}</div>
        <div class="field"><label>Zona padrão</label>${selectEl('drawing.aoeId', settings.drawing.aoeId, (catalog?.aoePresets || []).map((s) => [s.id, s.name]))}</div>
        <div class="field"><label>Estilo de traço padrão</label>${selectEl('drawing.lineStyle', settings.drawing.lineStyle || 'solid', [['solid', 'Sólido'], ['dashed', 'Tracejado'], ['dotted', 'Pontilhado']])}</div>
      </div>
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Restaurar apenas os padrões de desenho</span><span class="sr-desc">Mantém tema, atalhos e demais preferências.</span></div>
        <button class="btn sm" data-action="reset-drawing">${icon('reset', 14)} Restaurar desenho</button>
      </div>
    `);
}

function allShortcutEntries() {
  const entries = GLOBAL_SHORTCUTS.map(([key, label]) => ({
    kind: 'global', key, label, value: settings.shortcuts[key] || '', def: DEFAULT_SHORTCUTS[key]
  }));
  for (const key of TOOL_SHORTCUT_ORDER) {
    entries.push({
      kind: 'tool', key,
      label: TOOL_SHORTCUT_LABELS[key] || key,
      value: settings.shortcuts.tools?.[key] || '',
      def: DEFAULT_SHORTCUTS.tools[key]
    });
  }
  return entries;
}

function shortcutRow(entry, duplicates) {
  const dup = duplicates.has(String(entry.value || '').toLowerCase()) && entry.value;
  const status = [];
  if (dup) status.push('<span class="sc-status dup">Duplicado</span>');
  if (entry.kind === 'global') {
    const ok = state?.shortcutStatus?.[entry.key];
    if (ok === false) status.push('<span class="sc-status bad">Em uso</span>');
    else if (ok === true && !dup) status.push('<span class="sc-status ok">Ativo</span>');
  } else if (!dup) {
    status.push('<span class="sc-status local">Contextual</span>');
  }
  return `
    <div class="sc-row" data-sc-row="${entry.kind}:${entry.key}">
      <span class="sc-name">${escapeHtml(entry.label)}</span>
      ${status.join('')}
      <button class="sc-capture" data-capture-kind="${entry.kind}" data-capture-key="${entry.key}">${entry.value ? escapeHtml(formatShortcut(entry.value)) : 'Definir'}</button>
      <button class="sc-reset" data-reset-sc="${entry.kind}:${entry.key}" title="Restaurar padrão">${icon('reset', 12)}</button>
    </div>`;
}

function atalhosHTML() {
  const entries = allShortcutEntries();
  const counts = new Map();
  for (const e of entries) {
    if (!e.value) continue;
    const k = String(e.value).toLowerCase();
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const duplicates = new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  const globals = entries.filter((e) => e.kind === 'global');
  const tools = entries.filter((e) => e.kind === 'tool');
  return pageHead('Atalhos', 'Personalize cada comando. Atalhos globais funcionam com o jogo em foco; os demais funcionam no modo desenho.') +
    card('Atalhos globais', 'Funcionam mesmo com o League of Legends em primeiro plano. Use combinações com Ctrl, Alt ou Shift.', 'keyboard', `
      <div class="shortcut-group">
        ${globals.map((e) => shortcutRow(e, duplicates)).join('')}
      </div>
      <div class="panel-actions" style="display:flex;gap:7px;margin-top:10px">
        <button class="btn sm" data-action="apply-shortcuts">${icon('check', 14)} Reaplicar atalhos globais</button>
      </div>
      <div class="warning-box">${icon('warning', 14)}<span>Evite teclas usadas pelo League of Legends (Q, W, E, R, D, F, B, etc.). Prefira combinações com <b>Ctrl + Shift</b>. Se um atalho global estiver "Em uso", outro programa o reservou.</span></div>
    `) +
    card('Ferramentas no modo desenho', 'Atalhos contextuais: só respondem quando o overlay está em modo de desenho.', 'sliders', `
      <div class="shortcut-group">
        ${tools.map((e) => shortcutRow(e, duplicates)).join('')}
      </div>
      <div class="panel-actions" style="display:flex;gap:7px;margin-top:10px">
        <button class="btn sm" data-action="reset-shortcuts">${icon('reset', 14)} Restaurar atalhos padrão</button>
      </div>
      <div class="note" style="margin-top:10px">${icon('info', 13)}<span>Para capturar uma combinação, clique no botão do atalho e pressione as teclas. <b>Esc</b> cancela. Atalhos globais exigem modificador; atalhos contextuais aceitam uma tecla.</span></div>
    `);
}

function tintaHTML() {
  const d = settings.drawing;
  return pageHead('Tinta temporária', 'Marcações que desaparecem sozinhas para explicações dinâmicas e análise de replay.') +
    card('Comportamento', 'A tinta temporária é aplicada às novas marcações enquanto estiver ativa.', 'droplet', `
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Ativar por padrão</span><span class="sr-desc">Novas marcações nascem temporárias.</span></div>
        ${switchEl('drawing.fade', !!d.fade)}
      </div>
      <div class="setting-row" style="align-items:flex-start">
        <div class="sr-info"><span class="sr-label">Duração</span><span class="sr-desc">Tempo até a marcação desaparecer.</span></div>
        <div class="duration-chips" style="display:flex;gap:4px;flex-wrap:wrap">
          ${[2, 3, 4, 6, 10, 15, 30].map((s) => `<button class="btn sm ${Number(d.fadeSeconds) === s ? 'primary' : 'ghost'}" data-fade-duration="${s}">${s}s</button>`).join('')}
        </div>
      </div>
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Limpeza automática</span><span class="sr-desc">Remove todas as marcações do overlay após o intervalo.</span></div>
        ${selectEl('overlay.autoClear', settings.overlay.autoClear || 0, [[0, 'Desativada'], [30, '30 segundos'], [60, '1 minuto'], [120, '2 minutos'], [300, '5 minutos'], [600, '10 minutos']], 'number')}
      </div>
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Ação imediata</span><span class="sr-desc">Remove agora as marcações temporárias ativas.</span></div>
        <button class="btn sm" data-action="clear-temp">${icon('eraser', 14)} Limpar temporárias</button>
      </div>
      <div class="note">${icon('info', 13)}<span>Use o atalho <b>${formatShortcut(settings.shortcuts.tools.fade) || 'I'}</b> para alternar a tinta temporária durante a aula. Ao escolher uma ferramenta e desenhar, o tempo começa a contar no momento da criação.</span></div>
    `);
}

function quadroHTML() {
  return pageHead('Mini-Quadro', 'Preferências do quadro branco tático com Summoner\'s Rift.') +
    card('Quadro tático', 'O mini-quadro é uma janela independente com salvamento automático.', 'board', `
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Abrir mini-quadro</span><span class="sr-desc">Também disponível pelo atalho ${formatShortcut(settings.shortcuts.board)}.</span></div>
        <button class="btn sm primary" data-action="open-board">${icon('external', 14)} Abrir Mini-Quadro</button>
      </div>
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Fundo padrão</span><span class="sr-desc">Mapa HD, minimapa ampliado ou grade tática escura.</span></div>
        <div class="segmented">
          ${[['hd', 'Mapa HD'], ['minimap', 'Minimapa'], ['dark', 'Escuro']].map(([id, label]) => `<button class="${settings.board?.background === id ? 'active' : ''}" data-bg-choice="${id}">${label}</button>`).join('')}
        </div>
      </div>
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Brilho do mapa</span><span class="sr-desc">Ajusta a intensidade da arte de fundo.</span></div>
        ${rangeRow('board.brightness', Math.round((settings.board?.brightness ?? 1) * 100), 40, 140, 1, { divide: 100, suffix: '%', format: (v) => `${Math.round(v)}%` })}
      </div>
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Grade tática</span><span class="sr-desc">Linhas de referência para posicionamento.</span></div>
        ${switchEl('board.grid', !!settings.board?.grid)}
      </div>
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Nomes dos elementos</span><span class="sr-desc">Exibe o nome abaixo de campeões e objetivos.</span></div>
        ${switchEl('board.showLabels', settings.board?.showLabels !== false)}
      </div>
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Manter mini-quadro no topo</span><span class="sr-desc">Útil em configurações com dois monitores.</span></div>
        ${switchEl('board.alwaysOnTop', !!settings.board?.alwaysOnTop)}
      </div>
    `) +
    card('Biblioteca', 'O quadro inclui o mapa completo, campeões, objetivos, sentinelas, estruturas e acampamentos.', 'layers', `
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Versão dos dados</span><span class="sr-desc">Ícones e nomes de campeões sincronizados com o Data Dragon.</span></div>
        <span class="badge gold">${escapeHtml(lolVersion || 'Atual')}</span>
      </div>
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Cenários salvos</span><span class="sr-desc">O quadro salva automaticamente e permite exportar cenários em JSON.</span></div>
        <span class="badge live"><span class="pulse"></span>Autosave</span>
      </div>
    `);
}

function dadosHTML() {
  return pageHead('Dados & presets', 'Gerencie configurações, atalhos, presets e desenhos salvos.') +
    card('Restaurar', 'Estas ações não podem ser desfeitas.', 'reset', `
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Restaurar todas as configurações</span><span class="sr-desc">Volta ao tema, atalhos, paleta e preferências de fábrica.</span></div>
        <button class="btn sm danger" data-action="reset-all">Restaurar padrões</button>
      </div>
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Restaurar atalhos</span><span class="sr-desc">Retorna os atalhos globais e contextuais ao padrão.</span></div>
        <button class="btn sm" data-action="reset-shortcuts">Restaurar atalhos</button>
      </div>
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Restaurar presets</span><span class="sr-desc">Remove presets personalizados e mantém a biblioteca Nexus.</span></div>
        <button class="btn sm" data-action="reset-presets">Restaurar presets</button>
      </div>
    `) +
    card('Desenhos salvos', 'O Nexus guarda automaticamente o estado do overlay e do mini-quadro entre sessões.', 'save', `
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Limpar desenhos salvos</span><span class="sr-desc">Apaga o autosave do overlay e do mini-quadro.</span></div>
        <button class="btn sm danger" data-action="clear-scenes">Limpar desenhos salvos</button>
      </div>
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Presets personalizados</span><span class="sr-desc">${(state?.presets?.custom || []).length} preset(s) salvos.</span></div>
        <span class="badge">${(state?.presets?.custom || []).length}</span>
      </div>
    `) +
    card('Sessão', 'Feche ou recarregue o aplicativo quando necessário.', 'power', `
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Reiniciar Nexus Coach</span><span class="sr-desc">Salva o estado atual e abre novamente.</span></div>
        <button class="btn sm" data-action="relaunch">Reiniciar</button>
      </div>
      <div class="setting-row">
        <div class="sr-info"><span class="sr-label">Encerrar aplicativo</span><span class="sr-desc">Fecha o overlay e remove o ícone da bandeja.</span></div>
        <button class="btn sm danger" data-action="quit">Sair</button>
      </div>
    `);
}

function sobreHTML() {
  return `
    <div class="content-inner">
      <div class="page-head"><h1>Sobre</h1><p>Uma ferramenta de desenho e demonstração tática feita para coaches de League of Legends.</p></div>
      <div class="about-hero">
        <span class="about-logo">${icon('logo', 58)}</span>
        <div>
          <h2>NEXUS <span>COACH</span></h2>
          <p>Overlay de desenho, biblioteca de elementos e mini-quadro tático para análises de replay, aulas e revisões de estratégia.</p>
          <div class="about-meta">
            <span class="badge gold">v${escapeHtml(state?.version || '1.0.0')}</span>
            <span class="badge">League of Legends ${escapeHtml(lolVersion || '')}</span>
            <span class="badge">Windows 10 / 11</span>
            <span class="badge live"><span class="pulse"></span>Electron</span>
          </div>
        </div>
      </div>
      ${card('Recursos', 'Tudo o que está na interface executa uma função real.', 'sparkles', `
        <div class="setting-grid" style="grid-template-columns:1fr 1fr">
          <div>
            <div class="bp-title" style="font-family:var(--display);font-size:10px;letter-spacing:1px;color:var(--muted);margin-bottom:7px">DESENHO</div>
            <div class="tag-list" style="display:flex;flex-wrap:wrap;gap:4px">
              ${['Caneta', 'Lápis', 'Marca-texto', 'Borracha', 'Linhas', 'Setas curvas', 'Rotas', 'Formas', 'Texto', 'Seleção', 'Desfazer', 'Copiar/colar', 'Exportar PNG'].map((x) => `<span class="tag">${x}</span>`).join('')}
            </div>
          </div>
          <div>
            <div class="bp-title" style="font-family:var(--display);font-size:10px;letter-spacing:1px;color:var(--muted);margin-bottom:7px">TÁTICO</div>
            <div class="tag-list" style="display:flex;flex-wrap:wrap;gap:4px">
              ${['173 campeões', 'Sentinelas', 'Objetivos', 'Estruturas', 'Pings', 'Zonas AoE', 'Cone', 'Tinta temporária', 'Click-Through', 'Mini-Quadro', 'Cenários', 'Ondas', 'Presets'].map((x) => `<span class="tag">${x}</span>`).join('')}
            </div>
          </div>
        </div>
      `)}
      ${card('Compatibilidade', 'Requisitos e modo recomendado.', 'monitor', `
        <div class="setting-row">
          <div class="sr-info"><span class="sr-label">Modo de vídeo do jogo</span><span class="sr-desc">Use <b>Sem bordas</b> para o overlay ficar visível sobre o League of Legends. O modo tela cheia exclusiva pode ocultar overlays.</span></div>
          <span class="badge gold">Borderless</span>
        </div>
        <div class="setting-row">
          <div class="sr-info"><span class="sr-label">Multimonitor</span><span class="sr-desc">Escolha um monitor ou estenda o overlay por todos em Configurações → Overlay.</span></div>
          <span class="badge">Multi-monitor</span>
        </div>
        <div class="setting-row">
          <div class="sr-info"><span class="sr-label">Privacidade</span><span class="sr-desc">Nenhum dado é enviado. Desenhos e configurações ficam apenas no seu computador.</span></div>
          <span class="badge live">Offline</span>
        </div>
      `)}
      <div class="panel-note" style="margin-top:4px">${icon('info', 14)}<span>Nexus Coach é uma ferramenta independente de coaching e não é afiliada à Riot Games. League of Legends e todos os ativos relacionados são propriedade da Riot Games, Inc.</span></div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Navigation                                                         */
/* ------------------------------------------------------------------ */

function renderNav() {
  $('#navList').innerHTML = NAV.map((n) => `
    <button class="nav-item ${active === n.id ? 'active' : ''}" data-nav="${n.id}">
      ${icon(n.icon, 15)}<span>${n.label}</span>
      ${n.id === 'atalhos' ? `<span class="nav-badge">${GLOBAL_SHORTCUTS.length + TOOL_SHORTCUT_ORDER.length}</span>` : ''}
    </button>
  `).join('');
}

/* ------------------------------------------------------------------ */
/* Actions                                                            */
/* ------------------------------------------------------------------ */

async function addColor() {
  const hex = ($('#newColorHex')?.value || '').trim();
  if (!/^#?[0-9a-f]{6}$/i.test(hex)) { toast('Cor hexadecimal inválida', 'error'); return; }
  const color = hex.startsWith('#') ? hex.toUpperCase() : `#${hex.toUpperCase()}`;
  const colors = [...new Set([...(settings.colors || []), color])];
  setPath(settings, 'colors', colors);
  await window.nexus.patchState({ settings: { colors } });
  toast('Cor adicionada', 'success');
  renderSection();
}

async function removeColor(color) {
  const colors = (settings.colors || []).filter((c) => c.toLowerCase() !== String(color).toLowerCase());
  if (colors.length < 2) { toast('Mantenha ao menos duas cores', 'error'); return; }
  setPath(settings, 'colors', colors);
  await window.nexus.patchState({ settings: { colors } });
  renderSection();
}

async function addFavorite() {
  const sel = $('#favoriteSelect');
  if (!sel?.value) return;
  const favs = [...(settings.favorites || [])];
  if (favs.length >= 8) { toast('Máximo de 8 favoritos', 'error'); return; }
  favs.push(sel.value);
  settings.favorites = favs;
  await window.nexus.patchState({ settings: { favorites: favs } });
  renderSection();
}

async function moveFavorite(index, dir) {
  const favs = [...(settings.favorites || [])];
  const j = index + dir;
  if (j < 0 || j >= favs.length) return;
  [favs[index], favs[j]] = [favs[j], favs[index]];
  settings.favorites = favs;
  await window.nexus.patchState({ settings: { favorites: favs } });
  renderSection();
}

async function removeFavorite(index) {
  const favs = [...(settings.favorites || [])];
  favs.splice(index, 1);
  settings.favorites = favs;
  await window.nexus.patchState({ settings: { favorites: favs } });
  renderSection();
}

async function resetDrawing() {
  const d = {
    color: '#C8AA6E', width: 4, opacity: 1, arrowStyle: 'attack', aoeId: 'range',
    stampSize: 64, textSize: 38, fade: false, fadeSeconds: 4, lineStyle: 'solid'
  };
  settings.drawing = { ...settings.drawing, ...d };
  await window.nexus.patchState({ settings: { drawing: d } });
  await window.nexus.patchUI({ color: d.color, width: d.width, opacity: d.opacity, arrowStyle: d.arrowStyle, aoeId: d.aoeId, fade: d.fade, fadeSeconds: d.fadeSeconds, lineStyle: d.lineStyle });
  toast('Padrões de desenho restaurados', 'info');
  applyTheme(settings);
  renderSection();
}

async function resetAll() {
  const ok = await confirmModal('Restaurar configurações?', 'Tema, atalhos, paleta, favoritos, presets e preferências de overlay voltarão ao padrão. Seus desenhos salvos serão mantidos.', 'Restaurar', true);
  if (!ok) return;
  await window.nexus.suspendShortcuts(false);
  const next = await window.nexus.resetSettings();
  settings = next.settings;
  state = next;
  applyTheme(settings);
  renderSection();
  toast('Configurações restauradas', 'success');
}

async function resetShortcuts() {
  const ok = await confirmModal('Restaurar atalhos?', 'Todos os atalhos globais e contextuais voltarão aos valores padrão.', 'Restaurar', true);
  if (!ok) return;
  await window.nexus.patchState({ settings: { shortcuts: JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS)) } });
  settings.shortcuts = JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS));
  renderSection();
  toast('Atalhos restaurados', 'success');
}

async function resetPresets() {
  const ok = await confirmModal('Restaurar presets?', 'Os presets personalizados serão removidos. A biblioteca Nexus permanece disponível.', 'Restaurar', true);
  if (!ok) return;
  await window.nexus.resetPresets();
  renderSection();
  toast('Presets restaurados', 'success');
}

async function clearScenes() {
  const ok = await confirmModal('Limpar desenhos salvos?', 'O overlay e o mini-quadro serão limpos. Esta ação não pode ser desfeita.', 'Limpar', true);
  if (!ok) return;
  await window.nexus.clearScenes();
  toast('Desenhos salvos removidos', 'info');
}

/* ------------------------------------------------------------------ */
/* Shortcut capture                                                   */
/* ------------------------------------------------------------------ */

function cleanupCapture(save) {
  if (!capturing) return;
  clearTimeout(captureTimer);
  document.removeEventListener('keydown', capturing.handler, true);
  const btn = capturing.btn;
  if (btn?.isConnected) {
    btn.classList.remove('listening');
    btn.textContent = capturing.entry.value ? formatShortcut(capturing.entry.value) : 'Definir';
  }
  window.nexus.suspendShortcuts(false).catch(() => {});
  capturing = null;
}

function beginCapture(kind, key, btn) {
  if (capturing) cleanupCapture(false);
  const entry = allShortcutEntries().find((e) => e.kind === kind && e.key === key);
  if (!entry) return;
  const handler = async (e) => {
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
      e.preventDefault(); e.stopPropagation();
      cleanupCapture(false);
      toast('Captura cancelada', 'info');
      return;
    }
    if (['Control', 'Shift', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const combo = shortcutFromEvent(e);
    if (!combo) return;
    if (kind === 'global' && !/(Control|Shift|Alt|Meta)\+/.test(combo)) {
      toast('Atalhos globais precisam de Ctrl, Alt, Shift ou Win', 'error');
      return;
    }
    const others = allShortcutEntries().filter((x) => !(x.kind === kind && x.key === key));
    if (others.some((x) => String(x.value).toLowerCase() === combo.toLowerCase())) {
      toast('Esta combinação já está em uso', 'error');
      return;
    }
    const value = combo;
    if (kind === 'global') settings.shortcuts[key] = value;
    else settings.shortcuts.tools = { ...(settings.shortcuts.tools || {}), [key]: value };
    cleanupCapture(true);
    if (kind === 'global') await window.nexus.patchState({ settings: { shortcuts: { [key]: value } } });
    else await window.nexus.patchState({ settings: { shortcuts: { tools: { [key]: value } } } });
    renderSection();
    toast('Atalho atualizado', 'success');
  };
  capturing = { kind, key, entry, btn, handler };
  btn.textContent = 'Pressione as teclas…';
  btn.classList.add('listening');
  document.addEventListener('keydown', handler, true);
  window.nexus.suspendShortcuts(true).catch(() => {});
  captureTimer = setTimeout(() => {
    if (capturing) {
      cleanupCapture(false);
      toast('Captura cancelada', 'info');
    }
  }, 9000);
}

function resetSingleShortcut(kind, key) {
  const def = kind === 'global' ? DEFAULT_SHORTCUTS[key] : DEFAULT_SHORTCUTS.tools[key];
  if (kind === 'global') settings.shortcuts[key] = def;
  else settings.shortcuts.tools = { ...(settings.shortcuts.tools || {}), [key]: def };
  const patch = kind === 'global' ? { shortcuts: { [key]: def } } : { shortcuts: { tools: { [key]: def } } };
  window.nexus.patchState({ settings: patch }).then(() => renderSection());
}

/* ------------------------------------------------------------------ */
/* Modal                                                              */
/* ------------------------------------------------------------------ */

function confirmModal(title, message, confirmLabel = 'Confirmar', danger = false) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `
      <div class="modal-card">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button class="btn ghost" data-modal="cancel">Cancelar</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-modal="ok">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    const done = (val) => { back.remove(); resolve(val); };
    back.addEventListener('click', (e) => {
      if (e.target === back) done(false);
      const b = e.target.closest('[data-modal]');
      if (b) done(b.dataset.modal === 'ok');
    });
    setTimeout(() => back.querySelector('[data-modal="ok"]')?.focus(), 30);
  });
}

/* ------------------------------------------------------------------ */
/* Events                                                             */
/* ------------------------------------------------------------------ */

function bindEvents() {
  $('#navList').addEventListener('click', (e) => {
    const item = e.target.closest('[data-nav]');
    if (!item) return;
    active = item.dataset.nav;
    renderSection();
    $('#content').scrollTop = 0;
  });

  $('#content').addEventListener('click', async (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { active = nav.dataset.nav; renderSection(); return; }

    const theme = e.target.closest('[data-theme-choice]');
    if (theme) {
      settings.theme = theme.dataset.themeChoice;
      applyTheme(settings);
      await window.nexus.patchState(patchFor('theme', settings.theme));
      renderSection();
      return;
    }
    const accent = e.target.closest('[data-accent-choice]');
    if (accent) {
      settings.accent = accent.dataset.accentChoice;
      applyTheme(settings);
      await window.nexus.patchState(patchFor('accent', settings.accent));
      renderSection();
      return;
    }
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      const path = toggle.dataset.toggle;
      const value = !getPath(settings, path);
      setPath(settings, path, value);
      toggle.classList.toggle('on', value);
      toggle.setAttribute('aria-pressed', value ? 'true' : 'false');
      await window.nexus.patchState(patchFor(path, value));
      if (path === 'drawing.fade') await window.nexus.patchUI({ fade: value });
      if (path === 'board.background' || path === 'board.grid' || path === 'board.showLabels' || path === 'board.brightness') {
        // main broadcasts; board applies.
      }
      return;
    }
    const remove = e.target.closest('[data-remove-color]');
    if (remove) { e.stopPropagation(); await removeColor(remove.dataset.removeColor); return; }
    const paletteColor = e.target.closest('[data-palette-color]');
    if (paletteColor) {
      const color = paletteColor.dataset.paletteColor;
      settings.drawing.color = color;
      await window.nexus.patchState({ settings: { drawing: { color } } });
      await window.nexus.patchUI({ color });
      renderSection();
      return;
    }
    const favUp = e.target.closest('[data-fav-up]');
    if (favUp) { await moveFavorite(Number(favUp.dataset.favUp), -1); return; }
    const favDown = e.target.closest('[data-fav-down]');
    if (favDown) { await moveFavorite(Number(favDown.dataset.favDown), 1); return; }
    const favRemove = e.target.closest('[data-fav-remove]');
    if (favRemove) { await removeFavorite(Number(favRemove.dataset.favRemove)); return; }
    const bgChoice = e.target.closest('[data-bg-choice]');
    if (bgChoice) {
      settings.board.background = bgChoice.dataset.bgChoice;
      await window.nexus.patchState({ settings: { board: { background: settings.board.background } } });
      renderSection();
      return;
    }
    const dur = e.target.closest('[data-fade-duration]');
    if (dur) {
      const seconds = Number(dur.dataset.fadeDuration);
      settings.drawing.fadeSeconds = seconds;
      await window.nexus.patchState({ settings: { drawing: { fadeSeconds: seconds } } });
      await window.nexus.patchUI({ fadeSeconds: seconds, fade: true });
      renderSection();
      return;
    }
    const capture = e.target.closest('[data-capture-kind]');
    if (capture) {
      beginCapture(capture.dataset.captureKind, capture.dataset.captureKey, capture);
      return;
    }
    const resetSc = e.target.closest('[data-reset-sc]');
    if (resetSc) {
      const [kind, key] = resetSc.dataset.resetSc.split(':');
      resetSingleShortcut(kind, key);
      return;
    }

    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'reset-toolbar') { await window.nexus.resetToolbarPosition(); toast('Barra reposicionada', 'success'); }
    else if (action === 'open-board') { window.nexus.command({ type: 'open-board' }); }
    else if (action === 'reset-drawing') { await resetDrawing(); }
    else if (action === 'add-color') { await addColor(); }
    else if (action === 'reset-colors') {
      const colors = (catalog?.palette || []).map((p) => p.color);
      await window.nexus.patchState({ settings: { colors } });
      settings.colors = colors;
      renderSection();
      toast('Paleta restaurada', 'info');
    }
    else if (action === 'add-favorite') { await addFavorite(); }
    else if (action === 'apply-shortcuts') {
      await window.nexus.patchState({ settings: { shortcuts: JSON.parse(JSON.stringify(settings.shortcuts)) } });
      toast('Atalhos reaplicados', 'success');
    }
    else if (action === 'reset-shortcuts') { await resetShortcuts(); }
    else if (action === 'reset-presets') { await resetPresets(); }
    else if (action === 'reset-all') { await resetAll(); }
    else if (action === 'clear-scenes') { await clearScenes(); }
    else if (action === 'clear-temp') { window.nexus.command({ type: 'clear-temp' }); toast('Marcações temporárias limpas', 'info'); }
    else if (action === 'relaunch') { await window.nexus.relaunch(); }
    else if (action === 'quit') { await window.nexus.quit(); }
  });

  $('#content').addEventListener('input', (e) => {
    if (e.target.matches('[data-range]')) {
      const path = e.target.dataset.range;
      const divide = Number(e.target.dataset.divide) || 1;
      const raw = Number(e.target.value);
      const value = divide === 1 ? raw : raw / divide;
      const out = $(`[data-out="${path}"]`);
      if (out) out.textContent = `${Math.round(raw)}${e.target.dataset.suffix || ''}`;
      e.target.style.setProperty('--fill', `${((raw - Number(e.target.min)) / (Number(e.target.max) - Number(e.target.min))) * 100}%`);
      setPath(settings, path, value);
      if (path === 'overlay.markingsOpacity' || path === 'toolbar.scale' || path.startsWith('drawing.')) applyTheme(settings);
      window.nexus.patchState(patchFor(path, value)).catch(() => {});
      return;
    }
    if (e.target.id === 'newColorPick') {
      const hex = $('#newColorHex');
      if (hex) hex.value = e.target.value.toUpperCase();
      return;
    }
    if (e.target.id === 'newColorHex') {
      if (/^#[0-9a-f]{6}$/i.test(e.target.value)) {
        const pick = $('#newColorPick');
        if (pick) pick.value = e.target.value;
      }
      return;
    }
    if (e.target.id === 'defaultColor') {
      settings.drawing.color = e.target.value.toUpperCase();
      window.nexus.patchState({ settings: { drawing: { color: settings.drawing.color } } }).catch(() => {});
      window.nexus.patchUI({ color: settings.drawing.color }).catch(() => {});
    }
  });

  $('#content').addEventListener('change', (e) => {
    if (e.target.matches('[data-select]')) {
      const path = e.target.dataset.select;
      const type = e.target.dataset.type || 'string';
      let value = e.target.value;
      if (type === 'number') value = Number(value);
      else if (type === 'boolean') value = value === 'true';
      setPath(settings, path, value);
      if (path === 'drawing.fadeSeconds') window.nexus.patchUI({ fadeSeconds: value }).catch(() => {});
      window.nexus.patchState(patchFor(path, value)).catch(() => {});
      if (path === 'overlay.display' || path === 'theme') renderSection();
    }
  });

  $('#minBtn').addEventListener('click', () => window.nexus.windowAction('minimize'));
  $('#maxBtn').addEventListener('click', () => window.nexus.windowAction('maximize'));
  $('#closeBtn').addEventListener('click', () => window.nexus.windowAction('close'));
  $('#doneBtn').addEventListener('click', () => window.nexus.windowAction('close'));
  $('#resetBtn').addEventListener('click', resetAll);
  document.addEventListener('keydown', (e) => {
    if (capturing) return;
    if (e.key === 'Escape' && !isTypingTarget()) window.nexus.windowAction('close');
  });
  window.addEventListener('beforeunload', () => { if (capturing) window.nexus.suspendShortcuts(false); });
}

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */

async function boot() {
  $('#brandLogo').innerHTML = icon('logo', 23);
  $('#minBtn').innerHTML = icon('minimize', 14);
  $('#maxBtn').innerHTML = icon('maximize', 14);
  $('#closeBtn').innerHTML = icon('close', 14);
  $('#footerIcon').innerHTML = icon('check', 10);
  const data = await window.nexus.bootstrap();
  state = data.state;
  settings = state.settings;
  catalog = data.catalog;
  champions = data.champions || [];
  lolVersion = data.lolVersion || '';
  $('#versionLabel').textContent = `v${state.version}`;
  applyTheme(settings);
  renderNav();
  renderSection();
  bindEvents();
  window.nexus.onState((next) => {
    state = next;
    settings = next.settings;
    applyTheme(settings);
    if (active === 'atalhos') updateShortcutStatuses();
  });
  window.nexus.onShortcutStatus((status) => {
    if (state) state.shortcutStatus = status;
    updateShortcutStatuses();
  });
  window.nexus.onToast(({ message, type }) => toast(message, type || 'info'));
}

function updateShortcutStatuses() {
  if (active !== 'atalhos') return;
  const entries = allShortcutEntries();
  const counts = new Map();
  for (const e of entries) {
    if (!e.value) continue;
    const k = String(e.value).toLowerCase();
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  $$('.sc-row').forEach((row) => {
    const [kind, key] = row.dataset.scRow.split(':');
    const entry = entries.find((e) => e.kind === kind && e.key === key);
    if (!entry) return;
    const dup = entry.value && counts.get(String(entry.value).toLowerCase()) > 1;
    const oldStatus = $$('.sc-status', row);
    oldStatus.forEach((s) => s.remove());
    const name = $('.sc-name', row);
    const html = [];
    if (dup) html.push('<span class="sc-status dup">Duplicado</span>');
    if (kind === 'global') {
      const ok = state?.shortcutStatus?.[key];
      if (ok === false) html.push('<span class="sc-status bad">Em uso</span>');
      else if (ok === true && !dup) html.push('<span class="sc-status ok">Ativo</span>');
    } else if (!dup) html.push('<span class="sc-status local">Contextual</span>');
    if (html.length) name.insertAdjacentHTML('afterend', html.join(''));
  });
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:#ff8f9a;padding:20px;font:12px monospace">Falha ao abrir configurações:\n${String(err?.stack || err)}</pre>`;
});
