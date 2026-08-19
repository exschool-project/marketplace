const API_BASE = '/api';

let supabaseClient = null;
let session = null;
let currentRole = null;

let allOrders = [];
let currentStatusFilter = '';
let currentSearch = '';
let activeOrderId = null;

let listPollTimer = null;
let chatPollTimer = null;
let chatLastCount = 0;

const ROLE_LEVEL = { member: 1, cs: 2, admin: 3, owner: 4 };
const STATUS_LABEL = {
  menunggu: 'Menunggu Konfirmasi',
  diproses: 'Diproses',
  dikirim: 'Dikirim',
  selesai: 'Selesai',
  dibatalkan: 'Dibatalkan',
};

function clientRoleLevel(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return ROLE_LEVEL[normalized] || 0;
}

// ---------- Util ----------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function rupiah(value) {
  return 'Rp' + Math.round(Number(value) / 1000) + 'rb';
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    return '';
  }
}

function timeAgo(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins}m lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}j lalu`;
  return `${Math.floor(hours / 24)}h lalu`;
}

// ---------- Notifikasi pesan baru (suara + browser notification) ----------
function playPing() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.16, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (err) {
    // audio diblokir browser (belum ada interaksi user dsb) — tidak fatal
  }
}

function notifyNewMessage(title, body) {
  playPing();
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return; // sudah kelihatan di layar
  try {
    const n = new Notification(title, { body });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (err) {
    // beberapa browser/OS bisa nolak diam-diam — tidak fatal
  }
}

function initNotifyButton() {
  const btn = document.getElementById('notif-btn');
  if (!btn) return;
  if (typeof Notification === 'undefined') {
    btn.remove();
    return;
  }
  const sync = () => {
    if (Notification.permission === 'granted') {
      btn.textContent = '🔔 Notifikasi Aktif';
      btn.disabled = true;
    } else {
      btn.textContent = '🔔 Aktifkan Notifikasi';
      btn.disabled = false;
    }
  };
  sync();
  btn.addEventListener('click', async () => {
    await Notification.requestPermission();
    sync();
  });
}

// Peta order_id -> { last_message_at, last_sender_type } dari poll
// sebelumnya, buat deteksi "ada pesan baru dari pembeli" tiap silent-poll.
let lastMessageSnapshot = new Map();
let snapshotReady = false;

function detectAndNotifyNewMessages(orders) {
  const nextSnapshot = new Map();
  const newItems = [];

  orders.forEach((o) => {
    nextSnapshot.set(o.id, { at: o.last_message_at, sender: o.last_sender_type });
    if (!snapshotReady) return; // load pertama kali: jangan notif semua histori lama

    const prev = lastMessageSnapshot.get(o.id);
    const changed = o.last_message_at && (!prev || prev.at !== o.last_message_at);
    if (changed && o.last_sender_type && o.last_sender_type !== 'admin') {
      newItems.push(o);
    }
  });

  lastMessageSnapshot = nextSnapshot;
  snapshotReady = true;

  newItems.forEach((o) => {
    const preview = o.last_message && o.last_message.length > 80 ? o.last_message.slice(0, 80) + '…' : (o.last_message || '');
    notifyNewMessage(`Pesan baru — ${o.order_code}`, `${o.buyer_name}: ${preview}`);
  });
}

async function authedFetch(url, options = {}) {
  const token = session?.access_token;
  const headers = Object.assign(
    { 'Content-Type': 'application/json' },
    options.headers,
    token ? { Authorization: `Bearer ${token}` } : {}
  );
  const res = await fetch(url, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || 'Terjadi kesalahan.');
    err.status = res.status;
    throw err;
  }
  return body;
}

// ---------- View switching ----------
function showLogin(message = '') {
  document.getElementById('login-view').classList.remove('hidden');
  document.getElementById('dashboard-view').classList.add('hidden');
  const errEl = document.getElementById('login-error');
  errEl.textContent = message;
  errEl.style.display = message ? 'block' : 'none';
  if (listPollTimer) clearInterval(listPollTimer);
  if (chatPollTimer) clearInterval(chatPollTimer);
}

function showDashboard(profile) {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('dashboard-view').classList.remove('hidden');
  document.getElementById('admin-name').textContent = profile.full_name || profile.email;

  const normalizedRole = String(profile.role || '').trim().toLowerCase();
  currentRole = normalizedRole;
  const badge = document.getElementById('role-badge');
  badge.textContent = normalizedRole.toUpperCase();
  badge.className = `role-badge role-${normalizedRole}`;

  // Role "cs" murni gak punya akses ke admin.html — sembunyikan link-nya
  // biar gak nyasar ke halaman yang bakal nolak dia masuk.
  document.getElementById('admin-panel-link')?.classList.toggle('hidden', normalizedRole === 'cs');
}

// ---------- Init Supabase ----------
async function initSupabase() {
  const res = await fetch(`${API_BASE}/config`);
  const config = await res.json();
  if (!res.ok) throw new Error(config.error || 'Gagal memuat konfigurasi.');
  supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
}

async function fetchProfileAndEnforceRole() {
  const profile = await authedFetch(`${API_BASE}/auth/profile`);
  if (clientRoleLevel(profile.role) < ROLE_LEVEL.cs) {
    const err = new Error('Akun ini tidak memiliki akses yang cukup.');
    err.status = 403;
    throw err;
  }
  return profile;
}

// ---------- Login / logout ----------
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Memproses...';

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    session = data.session;

    const me = await fetchProfileAndEnforceRole();
    showDashboard(me);
  } catch (err) {
    let msg = err.message;
    if (err.status === 403) {
      await supabaseClient.auth.signOut();
      session = null;
      msg = 'Login berhasil, tapi akun ini bukan CS, admin, atau owner.';
    } else if (err.status === 401) {
      await supabaseClient.auth.signOut();
      session = null;
    } else if (err.status >= 500) {
      msg = `${err.message} (Sesi kamu masih tersimpan, coba tekan Masuk lagi setelah diperbaiki.)`;
    } else if (err.status === undefined) {
      msg = 'Gagal menghubungi server. Cek koneksi internet, lalu coba lagi.';
    }
    showLogin(msg);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Masuk';
    return;
  }

  submitBtn.disabled = false;
  submitBtn.textContent = 'Masuk';
  await startCsDashboard();
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
  session = null;
  showLogin();
}

async function checkExistingSession() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data.session) {
    showLogin();
    return;
  }
  session = data.session;
  try {
    const me = await fetchProfileAndEnforceRole();
    showDashboard(me);
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      await supabaseClient.auth.signOut();
      session = null;
      showLogin(err.status === 403 ? 'Akun ini bukan CS, admin, atau owner.' : '');
      return;
    }
    showLogin(err.message || 'Gagal menghubungi server. Muat ulang halaman untuk coba lagi.');
    return;
  }
  await startCsDashboard();
}

// ---------- Daftar percakapan (sidebar) ----------
async function loadOrderList({ silent = false } = {}) {
  try {
    // Selalu ambil versi TANPA filter dulu buat deteksi notifikasi — biar
    // pesan baru dari status yang lagi di-filter-keluar tetap ke-notif.
    const { data: allData } = await authedFetch(`${API_BASE}/orders`);
    detectAndNotifyNewMessages(allData);

    if (currentStatusFilter) {
      const { data: filteredData } = await authedFetch(`${API_BASE}/orders?status=${encodeURIComponent(currentStatusFilter)}`);
      allOrders = filteredData;
    } else {
      allOrders = allData;
    }
    renderOrderList();
  } catch (err) {
    if (!silent) {
      document.getElementById('cs-order-list').innerHTML = `<p class="empty-msg" style="padding:16px;">Gagal memuat: ${escapeHtml(err.message)}</p>`;
    }
  }
}

function orderNeedsReply(o) {
  return o.status !== 'selesai' && o.status !== 'dibatalkan' && o.last_sender_type && o.last_sender_type !== 'admin';
}

function renderOrderList() {
  const wrap = document.getElementById('cs-order-list');
  const q = currentSearch.trim().toLowerCase();

  let filtered = allOrders;
  if (q) {
    filtered = filtered.filter((o) =>
      o.order_code.toLowerCase().includes(q) ||
      o.buyer_name.toLowerCase().includes(q) ||
      o.product_name.toLowerCase().includes(q)
    );
  }

  if (!filtered.length) {
    wrap.innerHTML = '<p class="empty-msg" style="padding:16px;">Tidak ada percakapan.</p>';
    return;
  }

  wrap.innerHTML = filtered.map((o) => `
    <button type="button" class="cs-order-row ${o.id === activeOrderId ? 'active' : ''} ${orderNeedsReply(o) ? 'needs-reply' : ''}" data-id="${o.id}">
      <div class="cs-order-row-top">
        <span class="cs-order-row-code mono">${escapeHtml(o.order_code)}</span>
        <span class="order-status-badge order-status-${o.status}" style="font-size:.62rem; padding:2px 7px;">${STATUS_LABEL[o.status] || o.status}</span>
      </div>
      <div class="cs-order-row-name">${escapeHtml(o.buyer_name)} · ${escapeHtml(o.product_name)}</div>
      <div class="cs-order-row-preview">
        ${o.last_message ? escapeHtml(o.last_message.length > 46 ? o.last_message.slice(0, 46) + '…' : o.last_message) : '<em>Belum ada pesan</em>'}
        <span class="cs-order-row-time">${timeAgo(o.last_message_at || o.created_at)}</span>
      </div>
    </button>
  `).join('');

  const statEl = document.querySelector('title');
  const needReplyCount = allOrders.filter(orderNeedsReply).length;
  document.title = needReplyCount > 0 ? `(${needReplyCount}) CS — EX-SCHOOL` : 'CS — EX-SCHOOL';
}

document.getElementById('cs-order-list').addEventListener('click', (e) => {
  const row = e.target.closest('.cs-order-row');
  if (!row) return;
  openChat(row.dataset.id);
});

document.getElementById('cs-filter-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  document.querySelectorAll('#cs-filter-chips .chip').forEach((c) => c.classList.remove('active'));
  chip.classList.add('active');
  currentStatusFilter = chip.dataset.status;
  loadOrderList();
});

document.getElementById('cs-search').addEventListener('input', (e) => {
  currentSearch = e.target.value;
  renderOrderList();
});

// ---------- Chat aktif ----------
function findOrder(id) {
  return allOrders.find((o) => o.id === id);
}

function openChat(orderId) {
  activeOrderId = orderId;
  chatLastCount = 0;

  document.getElementById('cs-empty-state').classList.add('hidden');
  document.getElementById('cs-active-chat').classList.remove('hidden');
  document.getElementById('cs-sidebar').classList.add('cs-sidebar-hidden-mobile');

  renderActiveOrderHeader();
  renderOrderList(); // biar highlight "active" ke-update

  document.getElementById('cs-thread').innerHTML = '<p class="chat-empty">Memuat percakapan...</p>';
  loadActiveMessages();

  if (chatPollTimer) clearInterval(chatPollTimer);
  chatPollTimer = setInterval(loadActiveMessages, 3500);
}

function closeChatMobile() {
  document.getElementById('cs-sidebar').classList.remove('cs-sidebar-hidden-mobile');
}

document.getElementById('cs-back-btn').addEventListener('click', closeChatMobile);

function renderActiveOrderHeader() {
  const o = findOrder(activeOrderId);
  if (!o) return;
  document.getElementById('cs-h-code').textContent = o.order_code;
  document.getElementById('cs-h-product').textContent = `${o.product_name} · ${rupiah(o.product_price)}`;
  document.getElementById('cs-h-buyer').textContent = `${o.buyer_name} · ${o.buyer_phone}${o.buyer_note ? ' · ' + o.buyer_note : ''}`;

  const statusSelect = document.getElementById('cs-h-status');
  statusSelect.innerHTML = Object.entries(STATUS_LABEL)
    .map(([val, label]) => `<option value="${val}" ${o.status === val ? 'selected' : ''}>${label}</option>`)
    .join('');

  const closed = o.status === 'selesai' || o.status === 'dibatalkan';
  document.getElementById('cs-closed-banner').classList.toggle('hidden', !closed);
  document.getElementById('cs-chat-form').classList.toggle('is-closed', closed);
}

document.getElementById('cs-h-status').addEventListener('change', async (e) => {
  if (!activeOrderId) return;
  const newStatus = e.target.value;
  try {
    await authedFetch(`${API_BASE}/orders?id=${activeOrderId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: newStatus }),
    });
    await loadOrderList({ silent: true });
    renderActiveOrderHeader();
    await loadActiveMessages();
  } catch (err) {
    alert(err.message);
  }
});

async function loadActiveMessages() {
  if (!activeOrderId) return;
  try {
    const { data } = await authedFetch(`${API_BASE}/orders?resource=messages&order_id=${activeOrderId}`);
    if (data.length !== chatLastCount) {
      chatLastCount = data.length;
      renderThread(data);
    }
  } catch (err) {
    // diam-diam gagal, dicoba lagi di polling berikutnya
  }
}

function renderThread(messages) {
  const thread = document.getElementById('cs-thread');
  if (!messages.length) {
    thread.innerHTML = '<p class="chat-empty">Belum ada percakapan.</p>';
    return;
  }
  const wasNearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;

  thread.innerHTML = messages.map((m) => {
    // Dari sudut pandang CS: pesan admin = "milik sendiri" (kanan/hijau),
    // pesan buyer = "lawan bicara" (kiri/biru), system di tengah.
    const side = m.sender_type === 'admin' ? 'buyer' : (m.sender_type === 'buyer' ? 'admin' : 'system');
    return `
      <div class="chat-bubble from-${side}">
        <span class="chat-meta">${escapeHtml(m.sender_name)} · ${formatTime(m.created_at)}</span>
        ${escapeHtml(m.message)}
      </div>
    `;
  }).join('');

  if (wasNearBottom) thread.scrollTop = thread.scrollHeight;
}

document.getElementById('cs-chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeOrderId) return;
  if (!document.getElementById('cs-closed-banner').classList.contains('hidden')) return; // chat ditutup
  const input = document.getElementById('cs-chat-input');
  const message = input.value.trim();
  if (!message) return;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  input.value = '';

  try {
    await authedFetch(`${API_BASE}/orders?resource=messages`, {
      method: 'POST',
      body: JSON.stringify({ order_id: activeOrderId, message }),
    });
    await loadActiveMessages();
    await loadOrderList({ silent: true });
  } catch (err) {
    alert(err.message);
    input.value = message;
  } finally {
    submitBtn.disabled = false;
    input.focus();
  }
});

// ---------- Start dashboard ----------
async function startCsDashboard() {
  await loadOrderList();
  if (listPollTimer) clearInterval(listPollTimer);
  listPollTimer = setInterval(() => loadOrderList({ silent: true }), 6000);
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initSupabase();
  } catch (err) {
    showLogin(err.message);
    return;
  }

  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  initNotifyButton();

  await checkExistingSession();

  window.addEventListener('pageshow', (e) => {
    if (e.persisted) checkExistingSession();
  });
});
