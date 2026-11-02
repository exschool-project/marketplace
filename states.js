// ---------------------------------------------------------------------
// states.js — satu komponen untuk SEMUA kondisi non-normal di situs:
// 404 / tidak ditemukan, error, offline, kosong, akses ditolak, sukses,
// loading, toast, dan banner koneksi. Semuanya beranimasi (lihat states.css).
//
// Pakai:
//   ExState.mount(el, { type:'notfound', actions:[{label, href, primary}] })
//   ExState.mount(el, ExState.fromError(err, { onRetry: fn }))
//   el.innerHTML = ExState.loading('Memuat produk…')
//   ExState.toast('Gagal menyimpan', { type:'error' })
// Dimuat SEBELUM script lain di tiap halaman.
// ---------------------------------------------------------------------
(function () {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lang = () => {
    let l = 'id';
    try { if (typeof currentLang !== 'undefined' && currentLang) l = currentLang; } catch (e) { /* noop */ }
    if (!l || l === 'id') l = (document.documentElement.lang || 'id');
    return String(l).slice(0, 2) === 'en' ? 'en' : 'id';
  };

  const TXT = {
    id: {
      notfound: ['Halaman tidak ditemukan', 'Link yang kamu buka mungkin salah, atau produknya sudah tidak tersedia.'],
      error: ['Ups, ada yang error', 'Servernya lagi bermasalah. Coba lagi sebentar ya.'],
      offline: ['Kamu sedang offline', 'Cek koneksi internetmu. Begitu nyambung, halaman ini bisa dimuat ulang.'],
      empty: ['Belum ada isinya', 'Belum ada yang bisa ditampilkan di sini.'],
      locked: ['Akses ditolak', 'Kamu tidak punya izin untuk membuka ini. Coba masuk dengan akun yang sesuai.'],
      success: ['Berhasil!', ''],
      retry: 'Coba lagi', home: 'Ke beranda', shop: 'Lihat produk', back: 'Kembali', login: 'Masuk',
      detail: 'Detail teknis', loading: 'Memuat…',
      netOff: 'Kamu offline — koneksi terputus', netOn: 'Kembali online',
    },
    en: {
      notfound: ['Page not found', 'The link may be wrong, or the product is no longer available.'],
      error: ['Oops, something broke', 'The server is having trouble. Please try again in a moment.'],
      offline: ['You are offline', 'Check your internet connection. Once connected, reload this page.'],
      empty: ['Nothing here yet', 'There is nothing to show here yet.'],
      locked: ['Access denied', 'You do not have permission to open this. Try signing in with the right account.'],
      success: ['Success!', ''],
      retry: 'Try again', home: 'Home', shop: 'Browse products', back: 'Back', login: 'Sign in',
      detail: 'Technical details', loading: 'Loading…',
      netOff: 'You are offline — connection lost', netOn: 'Back online',
    },
  };
  const t = () => TXT[lang()];

  // ---------- ilustrasi (SVG inline, dianimasikan lewat states.css) ----------
  const ART = {
    notfound: '', // 404 memakai kode angka + radar, bukan SVG
    error: `<svg viewBox="0 0 200 110" aria-hidden="true">
      <g class="xs-plug-l">
        <path d="M0 55 H22" stroke="#0B2A54" stroke-width="7" stroke-linecap="round" fill="none"/>
        <rect x="20" y="38" width="52" height="34" rx="9" fill="#0B2A54"/>
        <rect x="72" y="44" width="20" height="6" rx="3" fill="#3D6E96"/><rect x="72" y="60" width="20" height="6" rx="3" fill="#3D6E96"/>
      </g>
      <g class="xs-plug-r">
        <path d="M200 55 H178" stroke="#0B2A54" stroke-width="7" stroke-linecap="round" fill="none"/>
        <rect x="128" y="38" width="52" height="34" rx="9" fill="#16283D"/>
        <rect x="120" y="44" width="12" height="6" rx="3" fill="#071D3B"/><rect x="120" y="60" width="12" height="6" rx="3" fill="#071D3B"/>
      </g>
      <path class="xs-spark" d="M101 30 L92 55 L100 55 L94 82 L112 49 L103 49 Z" fill="#B08A2E"/>
      <path class="xs-spark b" d="M80 40 l-6 -8 M122 38 l7 -8 M84 76 l-8 7 M118 76 l8 7" stroke="#B08A2E" stroke-width="4" stroke-linecap="round"/>
    </svg>`,
    offline: `<svg class="xs-wifi" viewBox="0 0 200 140" aria-hidden="true">
      <path class="arc a3" d="M30 62 Q100 4 170 62"/>
      <path class="arc a2" d="M54 86 Q100 46 146 86"/>
      <path class="arc a1" d="M78 108 Q100 90 122 108"/>
      <circle class="dot" cx="100" cy="124" r="8"/>
      <path class="slash" d="M40 20 L160 128"/>
    </svg>`,
    empty: `<svg class="xs-box" viewBox="0 0 200 140" aria-hidden="true">
      <ellipse cx="100" cy="126" rx="62" ry="7" fill="#16283D" opacity=".08"/>
      <path class="fl" d="M92 70 l4 8 8 1 -6 6 2 9 -8 -4 -8 4 2 -9 -6 -6 8 -1z" fill="#B08A2E"/>
      <circle class="fl f2" cx="114" cy="74" r="6" fill="#3D6E96"/>
      <rect class="fl f3" x="78" y="72" width="11" height="11" rx="3" fill="#0B2A54"/>
      <rect x="54" y="62" width="92" height="58" rx="8" fill="#0B2A54"/>
      <rect x="54" y="62" width="92" height="12" fill="#071D3B"/>
      <rect x="84" y="86" width="32" height="7" rx="3.5" fill="#3D6E96"/>
      <path class="lid-l" d="M62 62 L24 60 L34 40 L62 52Z" fill="#3D6E96"/>
      <path class="lid-r" d="M138 62 L176 60 L166 40 L138 52Z" fill="#2A5478"/>
    </svg>`,
    locked: `<svg class="xs-lock" viewBox="0 0 200 140" aria-hidden="true">
      <ellipse cx="100" cy="128" rx="46" ry="6" fill="#16283D" opacity=".08"/>
      <g class="whole">
        <path class="shackle" d="M78 62 V46 a22 22 0 0 1 44 0 V62" fill="none" stroke="#B08A2E" stroke-width="10" stroke-linecap="round"/>
        <rect x="62" y="60" width="76" height="62" rx="12" fill="#0B2A54"/>
        <circle cx="100" cy="86" r="8" fill="#B08A2E"/><rect x="97" y="90" width="6" height="16" rx="3" fill="#B08A2E"/>
      </g>
    </svg>`,
    success: (() => {
      const pts = [[-70, -56, '#B08A2E'], [66, -60, '#3D6E96'], [-84, 6, '#1F8A5B'], [86, 10, '#B08A2E'], [-46, 62, '#3D6E96'], [50, 64, '#0B2A54'], [0, -76, '#1F8A5B']];
      const cf = pts.map((p) => `<rect class="cf" x="97" y="67" width="7" height="7" rx="2" fill="${p[2]}" style="--dx:${p[0]}px;--dy:${p[1]}px"/>`).join('');
      return `<svg class="xs-ok" viewBox="0 0 200 140" aria-hidden="true">
        <circle class="fill" cx="100" cy="70" r="46"/>
        <circle class="ring" cx="100" cy="70" r="46"/>
        <path class="tick" d="M78 72 l16 16 28 -32"/>${cf}</svg>`;
    })(),
  };

  // ---------- HTML ----------
  function html(o) {
    o = o || {};
    const type = ART[o.type] !== undefined ? o.type : 'error';
    const d = t()[type] || t().error;
    const title = o.title ?? d[0];
    const msg = o.message ?? d[1];
    let top = '';
    if (type === 'notfound') {
      const code = String(o.code || '404');
      const left = code.slice(0, 1);
      const right = code.slice(2) || code.slice(0, 1);
      top = `<div class="xs-stars" aria-hidden="true">${'<i></i>'.repeat(8)}</div>
        <p class="xs-code" aria-label="${esc(code)}"><span class="d">${esc(left)}</span><span class="xs-radar" aria-hidden="true"><i></i><i></i></span><span class="d">${esc(right)}</span></p>`;
    } else {
      top = `<div class="xs-art">${ART[type]}</div>`;
    }
    const acts = (o.actions || []).map((a, i) => {
      const cls = `btn btn-lg ${a.primary ? 'btn-green' : ''}`.trim();
      return a.href
        ? `<a class="${cls}" href="${esc(a.href)}">${esc(a.label)}</a>`
        : `<button type="button" class="${cls}" data-xs-act="${i}">${esc(a.label)}</button>`;
    }).join('');
    const detail = o.detail
      ? `<details class="xs-detail"><summary>${esc(t().detail)}</summary><code>${esc(o.detail)}</code></details>` : '';
    return `<div class="xs xs-${type}${o.compact ? ' xs-compact' : ''}${o.wide ? ' xs-wide' : ''}" role="${type === 'success' ? 'status' : 'alert'}">
      ${top}
      <h2 class="xs-title">${esc(title)}</h2>
      ${msg ? `<p class="xs-msg">${esc(msg)}</p>` : ''}
      ${acts ? `<div class="xs-actions">${acts}</div>` : ''}
      ${detail}
    </div>`;
  }

  function mount(el, o) {
    if (!el) return;
    el.innerHTML = html(o);
    (o && o.actions || []).forEach((a, i) => {
      const b = el.querySelector(`[data-xs-act="${i}"]`);
      if (b && typeof a.onClick === 'function') b.addEventListener('click', a.onClick);
    });
  }

  function loading(text) {
    return `<div class="xs xs-load xs-wide" role="status" aria-live="polite">
      <div class="xs-orbit" aria-hidden="true"><i></i><i></i><i></i></div>
      <p class="xs-msg">${esc(text || t().loading)}</p></div>`;
  }

  // ---------- klasifikasi error ----------
  function isNetworkError(err) {
    if (!err) return false;
    if (err.network) return true;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    return err instanceof TypeError && /failed to fetch|network|load failed|fetch/i.test(String(err.message));
  }

  // Ubah error (dari fetchJSON dll.) jadi opsi tampilan yang pas.
  function fromError(err, opts) {
    opts = opts || {};
    const msg = String((err && err.message) || err || '');
    const status = err && err.status;
    const retry = opts.onRetry ? [{ label: t().retry, primary: true, onClick: opts.onRetry }] : [];
    const extra = opts.actions || [];
    if (isNetworkError(err)) return { type: 'offline', compact: opts.compact, wide: opts.wide, actions: retry.concat(extra) };
    if (status === 404 || /tidak ditemukan|not found/i.test(msg)) {
      return { type: 'notfound', code: opts.code || '404', message: opts.notFoundMessage, compact: opts.compact, wide: opts.wide,
        actions: extra.length ? extra : [{ label: t().shop, href: 'belanja', primary: true }, { label: t().home, href: './' }] };
    }
    if (status === 401 || status === 403) {
      return { type: 'locked', compact: opts.compact, wide: opts.wide, actions: extra.length ? extra : [{ label: t().login, href: 'akun', primary: true }] };
    }
    return { type: 'error', message: opts.message, detail: msg, compact: opts.compact, wide: opts.wide,
      actions: retry.concat(extra.length ? extra : [{ label: t().home, href: './' }]) };
  }

  // ---------- HERO: tampilan layar penuh (modern & profesional) ----------
  const CODES = {
    id: {
      400: ['Permintaan tidak valid', 'Permintaan tidak bisa diproses. Periksa kembali data yang dikirim lalu coba lagi.'],
      401: ['Perlu masuk akun', 'Sesi kamu berakhir atau kamu belum masuk. Silakan masuk untuk melanjutkan.'],
      403: ['Akses ditolak', 'Akun kamu tidak memiliki izin untuk membuka halaman ini.'],
      404: ['Halaman tidak ditemukan', 'Alamat yang kamu tuju tidak tersedia atau sudah dipindahkan. Periksa kembali tautannya, atau lanjutkan dari beranda.'],
      408: ['Waktu permintaan habis', 'Koneksi terlalu lama merespons. Muat ulang halaman untuk mencoba lagi.'],
      429: ['Terlalu banyak permintaan', 'Kamu terlalu sering mengirim permintaan. Tunggu sebentar lalu coba lagi.'],
      500: ['Terjadi gangguan di server', 'Ini bukan kesalahanmu. Ada kendala teknis di sisi kami. Coba lagi dalam beberapa saat.'],
      502: ['Server tidak merespons dengan benar', 'Layanan sedang sibuk atau baru dimulai ulang. Coba lagi sebentar lagi.'],
      503: ['Layanan sedang tidak tersedia', 'Kami sedang melakukan pemeliharaan atau menerima lonjakan trafik. Silakan kembali beberapa saat lagi.'],
      504: ['Server terlalu lama merespons', 'Permintaan butuh waktu lebih lama dari biasanya. Coba lagi sebentar lagi.'],
    },
    en: {
      400: ['Invalid request', 'The request could not be processed. Check the data you sent and try again.'],
      401: ['Sign in required', 'Your session has ended or you are not signed in. Please sign in to continue.'],
      403: ['Access denied', 'Your account does not have permission to open this page.'],
      404: ['Page not found', 'The address you are looking for is unavailable or has moved. Check the link, or continue from the home page.'],
      408: ['Request timed out', 'The connection took too long to respond. Reload the page to try again.'],
      429: ['Too many requests', 'You are sending requests too quickly. Wait a moment, then try again.'],
      500: ['Something went wrong on our side', 'This is not your fault. We hit a technical problem. Please try again shortly.'],
      502: ['Bad gateway', 'The service is busy or restarting. Please try again shortly.'],
      503: ['Service unavailable', 'We are under maintenance or handling a traffic spike. Please come back in a moment.'],
      504: ['Gateway timeout', 'The request took longer than usual. Please try again shortly.'],
    },
  };
  const PILL = { id: { offline: 'Offline', error: 'Terjadi kesalahan', locked: 'Akses dibatasi', code: 'Error' }, en: { offline: 'Offline', error: 'Error', locked: 'Restricted', code: 'Error' } };

  const rand = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('').toUpperCase();
  const stamp = () => {
    try { return new Date().toLocaleString(lang() === 'en' ? 'en-GB' : 'id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  };

  function ringHTML(kind) {
    return `<span class="xh-ring" aria-hidden="true"><span class="orbit"></span>${kind === 'notfound' ? '<span class="sweep"></span>' : ''}<span class="core"></span></span>`;
  }

  // opts: { code:'404' | type:'offline'|'locked'|'error', title, message, pill, actions:[], embed, meta, retry:detik, onRetry }
  function hero(o) {
    o = o || {};
    const code = o.code ? String(o.code) : '';
    const L = lang();
    const known = code && CODES[L][code];
    const kind = o.kind || (code ? (code === '404' ? 'notfound' : Number(code) >= 500 ? 'error' : 'warn') : (o.type || 'error'));
    const d = known || (code ? CODES[L][500] : (t()[o.type || 'error'] || t().error));
    const title = o.title ?? d[0];
    const msg = o.message ?? d[1];
    const pill = o.pill ?? (code ? `${PILL[L].code} ${code}` : (PILL[L][o.type] || PILL[L].error));
    const top = code
      ? `<div class="xh-code" role="img" aria-label="${esc(code)}">${code.split('').map((ch) => (ch === '0' ? ringHTML(kind) : `<span class="xh-d">${esc(ch)}</span>`)).join('')}</div>`
      : `<div class="xh-art">${ART[o.type] || ART.error}</div>`;
    const acts = (o.actions || []).map((a, i) => {
      const cls = `btn btn-lg ${a.primary ? 'btn-green' : ''}`.trim();
      if (a.href) return `<a class="${cls}" href="${esc(a.href)}">${esc(a.label)}</a>`;
      const retry = o.retry && a.retry
        ? `<svg viewBox="0 0 20 20" aria-hidden="true"><circle class="tr" cx="10" cy="10" r="8"/><circle class="pg" cx="10" cy="10" r="8" style="--d:${o.retry}s"/></svg>` : '';
      return `<button type="button" class="${cls}${retry ? ' xh-retry' : ''}" data-xh-act="${i}">${retry}<span>${esc(a.label)}</span></button>`;
    }).join('');
    const ref = o.ref || rand(8);
    const path = (typeof location !== 'undefined') ? location.pathname + location.search : '';
    const meta = (o.meta !== false && code)
      ? `<div class="xh-meta" data-xh-meta="${esc(`REF ${ref} | ${path} | ${stamp()}`)}"><span>REF ${esc(ref)} · ${esc(path.length > 34 ? path.slice(0, 34) + '…' : path)}</span><button type="button" data-xh-copy>${L === 'en' ? 'Copy' : 'Salin'}</button></div>` : '';
    return `<section class="xh xh-${kind}${o.embed ? ' xh-embed' : ''}" role="${kind === 'success' ? 'status' : 'alert'}">
      <div class="xh-bg" aria-hidden="true"><div class="xh-grid"></div><div class="xh-orb a"></div><div class="xh-orb b"></div></div>
      <span class="xh-pill"><i></i>${esc(pill)}</span>
      ${top}
      <h1 class="xh-title">${esc(title)}</h1>
      ${msg ? `<p class="xh-msg">${esc(msg)}</p>` : ''}
      ${acts ? `<div class="xh-actions">${acts}</div>` : ''}
      ${meta}
    </section>`;
  }

  function mountHero(el, o) {
    if (!el) return;
    o = o || {};
    el.innerHTML = hero(o);
    const acts = o.actions || [];
    acts.forEach((a, i) => {
      const b = el.querySelector(`[data-xh-act="${i}"]`);
      if (b && typeof a.onClick === 'function') b.addEventListener('click', () => { clearInterval(timer); a.onClick(); });
    });
    const meta = el.querySelector('[data-xh-meta]');
    if (meta) {
      meta.querySelector('[data-xh-copy]').addEventListener('click', (e) => {
        const btn = e.currentTarget; const txt = meta.getAttribute('data-xh-meta');
        const done = () => { const old = btn.textContent; btn.textContent = lang() === 'en' ? 'Copied ✓' : 'Tersalin ✓'; setTimeout(() => { btn.textContent = old; }, 1600); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, done); else done();
      });
    }
    // hitung mundur coba-lagi otomatis (untuk error server) & otomatis lanjut saat internet kembali
    let timer = null;
    const retryAct = acts.find((a) => a.retry);
    const fire = () => { clearInterval(timer); (retryAct.onClick || (() => location.reload()))(); };
    if (o.retry && retryAct) {
      let left = o.retry;
      const label = el.querySelector('.xh-retry span');
      const base = retryAct.label;
      timer = setInterval(() => {
        if (!el.isConnected) { clearInterval(timer); return; }
        left -= 1;
        if (label) label.textContent = `${base} (${Math.max(left, 0)})`;
        if (left <= 0) fire();
      }, 1000);
      if (label) label.textContent = `${base} (${left})`;
    }
    if (o.type === 'offline' && retryAct) {
      const once = () => { window.removeEventListener('online', once); if (el.isConnected) fire(); };
      window.addEventListener('online', once);
    }
  }

  // Error -> opsi hero yang pas (dipakai halaman produk, beli, dll.)
  function heroFromError(err, opts) {
    opts = opts || {};
    const msg = String((err && err.message) || err || '');
    const status = Number(err && err.status) || 0;
    const L = t();
    const retry = opts.onRetry ? { label: L.retry, primary: true, retry: true, onClick: opts.onRetry } : null;
    const extra = opts.actions || [];
    const base = { embed: opts.embed, meta: opts.meta };
    if (isNetworkError(err)) return Object.assign(base, { type: 'offline', actions: (retry ? [retry] : []).concat(extra) });
    if (status === 404 || /tidak ditemukan|not found/i.test(msg)) {
      return Object.assign(base, { code: 404, title: opts.title, message: opts.notFoundMessage, actions: extra.length ? extra : [{ label: L.shop, href: 'belanja', primary: true }, { label: L.home, href: './' }] });
    }
    if (status === 401 || status === 403) {
      return Object.assign(base, { code: status, actions: extra.length ? extra : [{ label: L.login, href: 'akun', primary: true }] });
    }
    const code = status >= 500 && CODES.id[status] ? status : 500;
    return Object.assign(base, { code, retry: retry ? (opts.autoRetry === false ? 0 : 12) : 0, actions: (retry ? [retry] : []).concat(extra.length ? extra : [{ label: L.home, href: './' }]) });
  }

  // ---------- toast ----------
  function toast(message, o) {
    o = o || {};
    const type = o.type || 'info';
    let host = document.getElementById('xs-toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'xs-toasts';
      host.className = 'xs-toasts';
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    const ttl = o.ttl || (type === 'error' ? 5500 : 3200);
    const el = document.createElement('div');
    el.className = `xs-toast xs-toast-${type}`;
    el.innerHTML = `<span class="ic">${type === 'error' ? '!' : type === 'success' ? '✓' : 'i'}</span><span>${esc(message)}</span><span class="bar" style="animation-duration:${ttl}ms"></span>`;
    host.appendChild(el);
    while (host.children.length > 3) host.firstChild.remove();
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
    el.addEventListener('click', close);
    setTimeout(close, ttl);
  }

  // ---------- banner koneksi (offline / kembali online) ----------
  let netEl = null; let netTimer = null;
  function netBanner(online) {
    if (!document.body) return;
    if (!netEl) {
      netEl = document.createElement('div');
      netEl.className = 'xs-net';
      netEl.setAttribute('role', 'status');
      document.body.appendChild(netEl);
    }
    clearTimeout(netTimer);
    netEl.className = `xs-net ${online ? 'ok' : ''}`;
    netEl.innerHTML = `<span class="pulse"></span><span>${esc(online ? t().netOn : t().netOff)}</span>`;
    requestAnimationFrame(() => requestAnimationFrame(() => netEl.classList.add('show')));
    if (online) netTimer = setTimeout(() => netEl.classList.remove('show'), 2400);
  }
  window.addEventListener('offline', () => netBanner(false));
  window.addEventListener('online', () => netBanner(true));
  document.addEventListener('DOMContentLoaded', () => { if (navigator.onLine === false) netBanner(false); });

  // Promise yang gagal karena jaringan & tak ada yang menangkap -> kasih tahu pengguna.
  let lastNetToast = 0;
  window.addEventListener('unhandledrejection', (e) => {
    if (!isNetworkError(e.reason)) return;
    if (Date.now() - lastNetToast < 6000) return;
    lastNetToast = Date.now();
    toast(t().offline[1], { type: 'error' });
  });

  window.ExState = { art: (k) => ART[k] || '', hero, mountHero, heroFromError, html, mount, loading, fromError, toast, isNetworkError, t };
})();
