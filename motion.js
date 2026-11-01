// ---------------------------------------------------------------------
// Motion: animasi masuk yang halus untuk semua elemen yang muncul di halaman
// (produk, testimoni, bagian-bagian halaman, daftar admin, kartu ringkasan).
//
// Cara kerja: elemen yang cocok dengan ITEM otomatis ditandai (juga yang
// dirender belakangan lewat JS), disembunyikan sedikit di bawah posisinya,
// lalu muncul bergelombang begitu masuk layar. Hanya opacity dan transform
// yang dianimasikan supaya tetap ringan. Setelah selesai, tanda dilepas
// sehingga hover & efek lain berjalan normal.
// Tidak aktif kalau pengguna memilih "kurangi gerakan" di perangkatnya.
// ---------------------------------------------------------------------
(function () {
  'use strict';

  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window) || !('MutationObserver' in window)) return;
  root.classList.add('js-motion');

  var ITEM = [
    '.pcard', '.testi-card', '.trust-item', '.section-head', '.shop-head h1',
    '.pd-top', '.pd-section', '.pd-cat-head', '.pd-showcase-item', '.buy-card',
    '.stat-card', '.quick-card', '.admin-row', '.page-head'
  ].join(',');

  var STEP = 70;      // jeda antar elemen dalam satu gelombang (ms)
  var MAX_STEPS = 9;  // batas jeda supaya tidak terasa lambat
  var seen = new WeakSet();
  var pendingLists = new Set();

  var io = new IntersectionObserver(function (entries) {
    var visible = entries.filter(function (e) { return e.isIntersecting; });
    if (!visible.length) return;
    // urutkan per baris lalu per kolom supaya gelombangnya rapi
    visible.sort(function (a, b) {
      var ra = Math.round(a.boundingClientRect.top / 40);
      var rb = Math.round(b.boundingClientRect.top / 40);
      return ra - rb || a.boundingClientRect.left - b.boundingClientRect.left;
    });
    visible.forEach(function (entry, i) {
      var el = entry.target;
      io.unobserve(el);
      var delay = Math.min(i, MAX_STEPS) * STEP;
      el.style.transitionDelay = delay + 'ms';
      // dua frame supaya keadaan awal (tersembunyi) sempat tergambar dulu
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { el.classList.add('in-view'); });
      });
      setTimeout(function () {
        el.classList.remove('motion-item', 'in-view');
        el.style.transitionDelay = '';
      }, delay + 1100);
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -5% 0px' });

  function register(el) {
    if (seen.has(el)) return;
    // Daftar admin: animasikan hanya saat pertama tampil, bukan tiap data dimuat ulang
    var list = el.closest && el.closest('.admin-list');
    if (list) {
      if (list.dataset.motionDone === '1') return;
      pendingLists.add(list);
    }
    seen.add(el);
    el.classList.add('motion-item');
    io.observe(el);
  }

  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.matches && node.matches(ITEM)) register(node);
    if (node.querySelectorAll) node.querySelectorAll(ITEM).forEach(register);
  }

  var mo = new MutationObserver(function (muts) {
    muts.forEach(function (m) { m.addedNodes.forEach(scan); });
    pendingLists.forEach(function (l) { l.dataset.motionDone = '1'; });
    pendingLists.clear();
  });
  mo.observe(root, { childList: true, subtree: true });

  // ---------- hitung naik untuk angka ringkasan admin ----------
  function countUp(el) {
    var n = parseInt(el.textContent, 10);
    if (!isFinite(n) || el.dataset.animating === '1') return;
    var from = parseInt(el.dataset.shown || '0', 10) || 0;
    if (n === parseInt(el.dataset.shown, 10)) return;
    el.dataset.animating = '1';
    var t0 = performance.now();
    var dur = 800;
    (function tick(now) {
      var p = Math.min(1, (now - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      if (p < 1) {
        el.textContent = Math.round(from + (n - from) * eased);
        requestAnimationFrame(tick);
      } else {
        el.dataset.shown = String(n);
        el.dataset.animating = '0';
        el.textContent = String(n);
      }
    })(t0);
  }

  function watchStats() {
    var statMO = new MutationObserver(function (muts) {
      muts.forEach(function (m) { if (m.target.dataset.animating !== '1') countUp(m.target); });
    });
    document.querySelectorAll('.stat-num').forEach(function (el) {
      statMO.observe(el, { childList: true });
    });
  }

  function init() { scan(document.body); watchStats(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
