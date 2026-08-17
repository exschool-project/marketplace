// CodeMirror 6 wrapper for UPGit. No bundler — every import below is a
// full URL to esm.sh, loaded directly by the browser. Base editor pieces
// (state/view/commands/language/search) load eagerly since every file
// needs them; language grammars (lang-*) load lazily via dynamic
// import() only when a file of that type is actually opened, and stay
// cached by the browser/module cache after that.

import { EditorState, Compartment } from 'https://esm.sh/@codemirror/state@6';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightActiveLine,
  drawSelection,
  dropCursor,
} from 'https://esm.sh/@codemirror/view@6';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from 'https://esm.sh/@codemirror/commands@6';
import {
  indentOnInput,
  bracketMatching,
  syntaxHighlighting,
  HighlightStyle,
} from 'https://esm.sh/@codemirror/language@6';
import { searchKeymap, highlightSelectionMatches, openSearchPanel, closeSearchPanel } from 'https://esm.sh/@codemirror/search@6';
import { tags } from 'https://esm.sh/@lezer/highlight@1';

// ---------------- Theme ----------------
// Built by hand (not an imported theme package) so it stays in lockstep
// with the app's own CSS variables instead of shipping a second palette.

const darkTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--bg)',
      color: 'var(--text)',
      height: '100%',
      fontSize: '12.5px',
    },
    '.cm-content': {
      fontFamily: 'var(--mono)',
      caretColor: 'var(--accent)',
      padding: '14px 0',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgba(244,81,30,0.25)',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-gutters': {
      backgroundColor: 'var(--panel)',
      color: 'var(--muted)',
      border: 'none',
      borderRight: '1px solid var(--border)',
    },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.04)', color: 'var(--text)' },
    '.cm-matchingBracket, .cm-nonmatchingBracket': {
      backgroundColor: 'rgba(244,81,30,0.28)',
      outline: 'none',
    },
    '.cm-searchMatch': { backgroundColor: 'rgba(255,255,255,0.15)' },
    '.cm-searchMatch-selected': { backgroundColor: 'rgba(244,81,30,0.35)' },
    '.cm-panels': { backgroundColor: 'var(--panel-2)', color: 'var(--text)', borderTop: '1px solid var(--border)' },
    '.cm-panel input, .cm-panel button, .cm-panel label': { fontFamily: 'var(--sans)', fontSize: '12px' },
    '.cm-panel button': {
      background: 'var(--panel)',
      color: 'var(--text)',
      border: '1px solid var(--border)',
      borderRadius: '3px',
      padding: '3px 8px',
      cursor: 'pointer',
    },
    '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--mono)' },
    '.cm-tooltip': { backgroundColor: 'var(--panel-2)', border: '1px solid var(--border)', color: 'var(--text)' },
  },
  { dark: true }
);

const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword], color: '#ff8a5c', fontWeight: '600' },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: 'var(--text)' },
  { tag: [tags.propertyName], color: '#79c0ff' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: '#d2a8ff' },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: '#79c0ff' },
  { tag: [tags.definition(tags.name)], color: 'var(--text)' },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace],
    color: '#79c0ff' },
  { tag: [tags.operator], color: '#ff8a5c' },
  { tag: [tags.url, tags.escape, tags.regexp, tags.link], color: '#a5d6ff' },
  { tag: tags.string, color: '#7ee787' },
  { tag: tags.comment, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: tags.meta, color: 'var(--muted)' },
  { tag: tags.invalid, color: 'var(--danger)' },
  { tag: tags.bool, color: '#79c0ff' },
  { tag: tags.heading, color: '#ff8a5c', fontWeight: '700' },
]);

// ---------------- Lazy language loading ----------------
// Only the grammar for the file actually being opened is fetched. Each
// entry is a small function so nothing imports until it's called.

const LANG_LOADERS = {
  js: () => import('https://esm.sh/@codemirror/lang-javascript@6').then((m) => m.javascript()),
  mjs: () => import('https://esm.sh/@codemirror/lang-javascript@6').then((m) => m.javascript()),
  cjs: () => import('https://esm.sh/@codemirror/lang-javascript@6').then((m) => m.javascript()),
  jsx: () => import('https://esm.sh/@codemirror/lang-javascript@6').then((m) => m.javascript({ jsx: true })),
  ts: () => import('https://esm.sh/@codemirror/lang-javascript@6').then((m) => m.javascript({ typescript: true })),
  tsx: () =>
    import('https://esm.sh/@codemirror/lang-javascript@6').then((m) => m.javascript({ jsx: true, typescript: true })),
  html: () => import('https://esm.sh/@codemirror/lang-html@6').then((m) => m.html()),
  htm: () => import('https://esm.sh/@codemirror/lang-html@6').then((m) => m.html()),
  css: () => import('https://esm.sh/@codemirror/lang-css@6').then((m) => m.css()),
  json: () => import('https://esm.sh/@codemirror/lang-json@6').then((m) => m.json()),
  md: () => import('https://esm.sh/@codemirror/lang-markdown@6').then((m) => m.markdown()),
  markdown: () => import('https://esm.sh/@codemirror/lang-markdown@6').then((m) => m.markdown()),
  py: () => import('https://esm.sh/@codemirror/lang-python@6').then((m) => m.python()),
  php: () => import('https://esm.sh/@codemirror/lang-php@6').then((m) => m.php()),
  java: () => import('https://esm.sh/@codemirror/lang-java@6').then((m) => m.java()),
  sql: () => import('https://esm.sh/@codemirror/lang-sql@6').then((m) => m.sql()),
  yml: () => import('https://esm.sh/@codemirror/lang-yaml@6').then((m) => m.yaml()),
  yaml: () => import('https://esm.sh/@codemirror/lang-yaml@6').then((m) => m.yaml()),
  xml: () => import('https://esm.sh/@codemirror/lang-xml@6').then((m) => m.xml()),
  c: () => import('https://esm.sh/@codemirror/lang-cpp@6').then((m) => m.cpp()),
  h: () => import('https://esm.sh/@codemirror/lang-cpp@6').then((m) => m.cpp()),
  cpp: () => import('https://esm.sh/@codemirror/lang-cpp@6').then((m) => m.cpp()),
  hpp: () => import('https://esm.sh/@codemirror/lang-cpp@6').then((m) => m.cpp()),
  rs: () => import('https://esm.sh/@codemirror/lang-rust@6').then((m) => m.rust()),
};

const langCache = new Map(); // extension -> resolved language extension (avoid re-awaiting the same import twice)

export async function loadLanguageForPath(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (langCache.has(ext)) return langCache.get(ext);

  const loader = LANG_LOADERS[ext];
  if (!loader) return null; // unsupported extension — editor still works, just no highlighting

  try {
    const lang = await loader();
    langCache.set(ext, lang);
    return lang;
  } catch (err) {
    console.warn(`[editor] failed to load syntax highlighting for .${ext}:`, err.message);
    return null; // fail open — plain text editing still works
  }
}

// ---------------- Editor instance ----------------

let view = null;
let currentOnChange = null;
const languageCompartment = new Compartment();
const readOnlyCompartment = new Compartment();

function baseExtensions() {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(highlightStyle, { fallback: true }),
    bracketMatching(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    EditorView.lineWrapping, // avoids horizontal-scroll hell on mobile
    darkTheme,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && currentOnChange) currentOnChange(update.state.doc.toString());
    }),
  ];
}

/**
 * Mounts a fresh editor for one file. Recreated (not reconfigured) per
 * file on purpose — undo history shouldn't carry over between different
 * files, and each file is a small enough doc that recreation is cheap.
 */
export async function mountEditor(container, { doc = '', path = '', readOnly = false, onChange } = {}) {
  destroyEditor();
  currentOnChange = onChange || null;

  const lang = readOnly ? null : await loadLanguageForPath(path);

  const state = EditorState.create({
    doc,
    extensions: [
      ...baseExtensions(),
      languageCompartment.of(lang || []),
      readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
    ],
  });

  view = new EditorView({ state, parent: container });
  return view;
}

export function getEditorContent() {
  return view ? view.state.doc.toString() : '';
}

export function destroyEditor() {
  if (view) {
    view.destroy();
    view = null;
  }
  currentOnChange = null;
}

export function focusEditor() {
  view?.focus();
}

export function triggerSearch() {
  if (view) openSearchPanel(view);
}

export function closeSearch() {
  if (view) closeSearchPanel(view);
}

export function triggerUndo() {
  if (view) undo(view);
}

export function triggerRedo() {
  if (view) redo(view);
}
