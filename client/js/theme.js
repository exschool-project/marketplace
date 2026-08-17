// Theme switching — fully client-side, nothing here touches the backend.
// Three fixed palettes (biru / putih / hitam) live as CSS blocks in
// style.css; "neo" is generated at runtime from a random hue so it's
// different each reroll while staying legible (dark background, light
// text, a mid-lightness accent that always has enough contrast against
// white icon/text on top of it).
//
// The very first paint's theme is already applied by the inline <script>
// in index.html's <head> (this file loads as a deferred module, which
// would otherwise run too late and cause a flash of the wrong palette).
// This file's job is: wire up the picker buttons, and keep localStorage
// in sync so the next reload's inline script picks up the same theme.

const STORAGE_KEY = 'upgit_theme';
const HUE_KEY = 'upgit_neo_hue';
const NEO_VARS = ['--bg', '--panel', '--panel-2', '--text', '--muted', '--primary', '--accent', '--on-primary', '--border'];

// Static swatch shown in the topbar dropdown trigger + label. Kept in
// plain Indonesian names on purpose — same convention the Settings
// swatches already use (theme names aren't translated, only UI copy is).
const THEME_META = {
  biru: { label: 'Biru', dot: '#1565FF' },
  putih: { label: 'Putih', dot: '#1550DE' },
  hitam: { label: 'Hitam', dot: '#FFD400' },
  gradasi: { label: 'Gradasi', dot: '#EC4899' },
  neo: { label: 'Neo', dot: 'conic-gradient(#FF3B82,#3BFFC4,#FFD43B,#FF3B82)' },
  clay: { label: 'Clay', dot: '#5B6EF2' },
  glass: { label: 'Glass', dot: 'linear-gradient(135deg,#5B8CFF,#7C4DFF)' },
  'catppuccin-mocha': { label: 'Catppuccin Mocha', dot: '#89B4FA' },
  'catppuccin-latte': { label: 'Catppuccin Latte', dot: '#1E66F5' },
  dracula: { label: 'Dracula', dot: '#BD93F9' },
  alucard: { label: 'Alucard (Dracula Light)', dot: '#644AC9' },
  forest: { label: 'Forest', dot: '#22C55E' },
  emerald: { label: 'Emerald', dot: '#059669' },
  monokai: { label: 'Monokai Pro', dot: '#A9DC76' },
  'monokai-light': { label: 'Monokai Pro Light', dot: '#6C8C33' },
  'one-dark': { label: 'One Dark Pro', dot: '#61AFEF' },
  'one-light': { label: 'One Light', dot: '#4078F2' },
  'gruvbox-dark': { label: 'Gruvbox Dark', dot: '#FE8019' },
  'gruvbox-light': { label: 'Gruvbox Light', dot: '#AF3A03' },
};

// Themes that read as "light" — used only to decide which icon the quick
// dark/light toggle shows, and which way it flips (see initQuickMode).
const LIGHT_THEMES = [
  'putih', 'gradasi', 'clay',
  'catppuccin-latte', 'alucard', 'emerald', 'monokai-light', 'one-light', 'gruvbox-light',
];

function applyNeoHue(hue) {
  const root = document.documentElement.style;
  root.setProperty('--bg', `hsl(${hue}, 32%, 8%)`);
  root.setProperty('--panel', `hsl(${hue}, 30%, 12%)`);
  root.setProperty('--panel-2', `hsl(${hue}, 28%, 16%)`);
  root.setProperty('--text', `hsl(${hue}, 15%, 95%)`);
  root.setProperty('--muted', `hsl(${hue}, 12%, 65%)`);
  root.setProperty('--primary', `hsl(${(hue + 30) % 360}, 80%, 52%)`);
  root.setProperty('--accent', `hsl(${(hue + 150) % 360}, 85%, 60%)`);
  root.setProperty('--on-primary', '#FFFFFF');
  root.setProperty('--border', '#000000');
}

function clearInlineOverrides() {
  const root = document.documentElement.style;
  NEO_VARS.forEach((name) => root.removeProperty(name));
}

function markActiveSwatch(name) {
  document.querySelectorAll('[data-theme-option]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.themeOption === name);
  });

  const meta = THEME_META[name] || THEME_META.biru;
  const label = document.getElementById('topbarThemeLabel');
  const dot = document.getElementById('topbarThemeDot');
  if (label) label.textContent = meta.label;
  if (dot) dot.style.background = meta.dot;

  const isLight = LIGHT_THEMES.includes(name);
  document.querySelectorAll('.mode-icon-moon').forEach((el) => { el.style.display = isLight ? 'none' : 'block'; });
  document.querySelectorAll('.mode-icon-sun').forEach((el) => { el.style.display = isLight ? 'block' : 'none'; });
}

export function applyTheme(name, { reroll = false } = {}) {
  document.documentElement.dataset.theme = name;

  if (name === 'neo') {
    let hue = Number(localStorage.getItem(HUE_KEY));
    if (reroll || !Number.isFinite(hue)) {
      hue = Math.floor(Math.random() * 360);
      localStorage.setItem(HUE_KEY, String(hue));
    }
    applyNeoHue(hue);
  } else {
    clearInlineOverrides();
  }

  localStorage.setItem(STORAGE_KEY, name);
  markActiveSwatch(name);
}

function initTheme() {
  const current = document.documentElement.dataset.theme || 'biru';
  markActiveSwatch(current);

  document.querySelectorAll('[data-theme-option]').forEach((btn) => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.themeOption));
  });

  // Any element with this class rerolls Neo's random hue — the Settings
  // page button and the one inside the topbar dropdown both use it.
  document.querySelectorAll('.theme-reroll-btn').forEach((btn) => {
    btn.addEventListener('click', () => applyTheme('neo', { reroll: true }));
  });

  initTopbarThemeMenu();
  initQuickMode();
}

// Topbar theme dropdown: click the trigger to open/close, click outside
// or pick an option to close. Picking an option is already handled by
// the [data-theme-option] listener above (it just also lives inside
// this menu), so this only owns the open/closed visual state.
function initTopbarThemeMenu() {
  const trigger = document.getElementById('topbarThemeBtn');
  const menu = document.getElementById('topbarThemeMenu');
  if (!trigger || !menu) return;

  const close = () => {
    menu.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = !menu.classList.contains('is-open');
    menu.classList.toggle('is-open', willOpen);
    trigger.setAttribute('aria-expanded', String(willOpen));
  });

  menu.addEventListener('click', (e) => {
    if (e.target.closest('[data-theme-option]')) close();
  });

  document.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

// Quick dark/light button — a shortcut between the two most contrastive
// built-in themes (biru = dark default, putih = light), rather than a
// second independent axis on top of all seven palettes. Clicking always
// resolves to "the opposite mode of whatever's active now": from any
// light-reading theme it drops to biru, from any dark-reading theme it
// jumps to putih.
function initQuickMode() {
  document.querySelectorAll('.quick-mode-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const current = document.documentElement.dataset.theme || 'biru';
      applyTheme(LIGHT_THEMES.includes(current) ? 'biru' : 'putih');
    });
  });
}

initTheme();
