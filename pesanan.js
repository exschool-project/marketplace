const API_BASE = '/api';

let currentOrder = null;
let currentToken = null;
let pollTimer = null;
let lastMessageCount = 0;

// Sesi login (opsional) — kalau ada, riwayat pesanan otomatis
// ditampilkan tanpa perlu kode+token manual.
let supabaseClient = null;
let session = null;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function rupiah(value) {
  return 'Rp' + Math.round(Number(value) / 1000) + 'rb';
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    return '';
  }
}

// ---------- Sesi login (opsional) ----------
async function initSession() {
  if (!window.supabase) return;
  try {
    const res = await fetch(`${API_BASE}/config`);
    const config = await res.json();
    if (!res.ok) return;
    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    const { data } = await supabaseClient.auth.getSession();
    session = data.session || null;
  } catch (err) {
    // Gagal cek sesi (mis. offline) -> anggap belum login, jalur lookup
    // manual (kode+token) tetap kerja normal seperti biasa.
    session = null;
  }
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

const STATUS_LABEL = {
  menunggu: 'Menunggu Konfirmasi',
  diproses: 'Diproses',
  dikirim: 'Dikirim',
  selesai: 'Selesai',
  dibatalkan: 'Dibatalkan',
};

// ---------- Notifikasi pesan baru dari admin (suara + browser notification) ----------
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
    // audio diblokir browser — tidak fatal
  }
}

function notifyNewMessage(title, body) {
  playPing();
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  try {
    const n = new Notification(title, { body });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (err) {
    // tidak fatal
  }
}

function initNotifyButton() {
  const btn = document.getElementById('notif-btn');
  if (!btn || typeof Notification === 'undefined') {
    btn?.remove();
    return;
  }
  const sync = () => {
    if (Notification.permission === 'granted') {
      btn.innerHTML = `${ICONS.bell} Notifikasi Aktif`;
      btn.disabled = true;
    } else {
      btn.innerHTML = `${ICONS.bell} Aktifkan Notifikasi`;
      btn.disabled = false;
    }
  };
  sync();
  btn.addEventListener('click', async () => {
    await Notification.requestPermission();
    sync();
  });
}

// ---------- View switching ----------
function showMyOrders() {
  document.getElementById('my-orders-view').classList.remove('hidden');
  document.getElementById('lookup-view').classList.add('hidden');
  document.getElementById('order-view').classList.add('hidden');
  if (pollTimer) clearInterval(pollTimer);
  loadMyOrders();
}

function showLookup() {
  document.getElementById('my-orders-view').classList.add('hidden');
  document.getElementById('lookup-view').classList.remove('hidden');
  document.getElementById('order-view').classList.add('hidden');
  if (pollTimer) clearInterval(pollTimer);
  renderRecentOrders();

  // Kalau ternyata lagi login, ganti ajakan "masuk dulu" jadi link balik
  // ke riwayat pesanan otomatis (biar gak ngajak login yang udah login).
  const hint = document.getElementById('lookup-login-hint');
  if (session) {
    hint.innerHTML = '<a href="#" id="back-to-my-orders">← Kembali ke riwayat pesanan kamu</a>';
    document.getElementById('back-to-my-orders').addEventListener('click', (e) => {
      e.preventDefault();
      showMyOrders();
    });
  }
}

function showOrder() {
  document.getElementById('my-orders-view').classList.add('hidden');
  document.getElementById('lookup-view').classList.add('hidden');
  document.getElementById('order-view').classList.remove('hidden');
}

// ---------- Pesanan terakhir (localStorage, diisi dari index.html) ----------
function getRecentOrders() {
  try {
    return JSON.parse(localStorage.getItem('exschool_orders') || '[]');
  } catch (err) {
    return [];
  }
}

function renderRecentOrders() {
  const list = getRecentOrders();
  const wrap = document.getElementById('recent-orders');
  const listEl = document.getElementById('recent-orders-list');
  if (!list.length) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  listEl.innerHTML = list.map((o) => `
    <button type="button" class="mini-btn recent-order-btn" data-code="${escapeHtml(o.code)}" data-token="${escapeHtml(o.token)}" style="text-align:left; width:100%;">
      <strong>${escapeHtml(o.code)}</strong> — ${escapeHtml(o.product_name)}
    </button>
  `).join('');
}

document.getElementById('recent-orders-list').addEventListener('click', (e) => {
  const btn = e.target.closest('.recent-order-btn');
  if (!btn) return;
  openOrder(btn.dataset.code, btn.dataset.token);
});

// ---------- Riwayat pesanan otomatis (user login) ----------
async function loadMyOrders() {
  const subEl = document.getElementById('my-orders-sub');
  const listEl = document.getElementById('my-orders-list');
  subEl.textContent = 'Memuat riwayat pesanan...';
  listEl.innerHTML = '';

  try {
    const body = await authedFetch(`${API_BASE}/orders?mine=1`);
    const orders = body.data || [];

    if (!orders.length) {
      subEl.textContent = 'Belum ada pesanan yang dibuat sambil login. Pesanan baru yang kamu buat dalam keadaan login bakal otomatis muncul di sini.';
      return;
    }

    subEl.textContent = `${orders.length} pesanan ditemukan di akun kamu.`;
    listEl.innerHTML = orders.map((o) => `
      <button type="button" class="mini-btn my-order-btn" data-code="${escapeHtml(o.order_code)}" data-token="${escapeHtml(o.access_token)}" style="text-align:left; width:100%; display:flex; flex-direction:column; gap:3px;">
        <span style="display:flex; justify-content:space-between; gap:8px; width:100%;">
          <strong>${escapeHtml(o.order_code)}</strong>
          <span class="order-status-badge order-status-${o.status}" style="font-size:.68rem;">${STATUS_LABEL[o.status] || o.status}</span>
        </span>
        <span style="font-size:.8rem; color:#3E6B85;">${escapeHtml(o.product_name)} · ${rupiah(o.product_price)}</span>
      </button>
    `).join('');
  } catch (err) {
    subEl.textContent = `Gagal memuat riwayat pesanan: ${err.message}`;
  }
}

document.getElementById('my-orders-list').addEventListener('click', (e) => {
  const btn = e.target.closest('.my-order-btn');
  if (!btn) return;
  openOrder(btn.dataset.code, btn.dataset.token);
});

document.getElementById('lookup-other-btn').addEventListener('click', () => {
  showLookup();
});

// ---------- Muat & render pesanan + chat ----------
async function openOrder(code, token) {
  const errEl = document.getElementById('lookup-error');
  errEl.classList.add('hidden');

  try {
    const res = await fetch(`${API_BASE}/orders?code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Pesanan tidak ditemukan.');

    currentOrder = body.data;
    currentToken = token;
    lastMessageCount = 0;

    renderOrderSummary(currentOrder);
    showOrder();
    await loadMessages();

    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      await refreshOrderStatus();
      await loadMessages();
    }, 4000);

    // update URL biar bisa di-bookmark/refresh tanpa isi ulang form
    const url = new URL(window.location.href);
    url.searchParams.set('code', code);
    url.searchParams.set('token', token);
    window.history.replaceState({}, '', url);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

function renderOrderSummary(order) {
  document.getElementById('ov-code').textContent = order.order_code;
  document.getElementById('ov-product').textContent = order.product_name;
  document.getElementById('ov-price').textContent = rupiah(order.product_price);
  document.getElementById('ov-buyer').textContent = `${order.buyer_name} · ${order.buyer_phone}`;

  const statusEl = document.getElementById('ov-status');
  statusEl.textContent = STATUS_LABEL[order.status] || order.status;
  statusEl.className = `order-status-badge order-status-${order.status}`;

  const closed = order.status === 'selesai' || order.status === 'dibatalkan';
  document.getElementById('chat-closed-banner').classList.toggle('hidden', !closed);
  document.getElementById('chat-form').classList.toggle('is-closed', closed);
}

async function refreshOrderStatus() {
  if (!currentOrder) return;
  try {
    const res = await fetch(`${API_BASE}/orders?code=${encodeURIComponent(currentOrder.order_code)}&token=${encodeURIComponent(currentToken)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return;
    currentOrder = body.data;
    renderOrderSummary(currentOrder);
  } catch (err) {
    // diam-diam gagal, coba lagi di polling berikutnya
  }
}

async function loadMessages() {
  if (!currentOrder) return;
  try {
    const res = await fetch(`${API_BASE}/orders?resource=messages&order_id=${currentOrder.id}&code=${encodeURIComponent(currentOrder.order_code)}&token=${encodeURIComponent(currentToken)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return;

    const messages = body.data || [];
    if (messages.length === lastMessageCount) return; // tidak ada pesan baru, skip render

    // Notifikasi kalau pesan baru itu dari admin (bukan dari diri sendiri,
    // dan bukan pemuatan pertama kali).
    if (lastMessageCount > 0 && messages.length > lastMessageCount) {
      const newOnes = messages.slice(lastMessageCount);
      const fromAdmin = newOnes.filter((m) => m.sender_type === 'admin');
      if (fromAdmin.length) {
        const last = fromAdmin[fromAdmin.length - 1];
        const preview = last.message.length > 80 ? last.message.slice(0, 80) + '…' : last.message;
        notifyNewMessage(`Balasan admin — ${currentOrder.order_code}`, preview);
      }
    }

    lastMessageCount = messages.length;
    renderMessages(messages);
  } catch (err) {
    // diam-diam gagal, coba lagi di polling berikutnya
  }
}

function renderMessages(messages) {
  const thread = document.getElementById('chat-thread');
  if (!messages.length) {
    thread.innerHTML = '<p class="chat-empty">Belum ada percakapan.</p>';
    return;
  }
  const wasNearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;

  thread.innerHTML = messages.map((m) => `
    <div class="chat-bubble from-${m.sender_type}">
      <span class="chat-meta">${escapeHtml(m.sender_name)} · ${formatTime(m.created_at)}</span>
      ${escapeHtml(m.message)}
    </div>
  `).join('');

  if (wasNearBottom) thread.scrollTop = thread.scrollHeight;
}

// ---------- Form lookup manual ----------
document.getElementById('lookup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = document.getElementById('lookup-code').value.trim().toUpperCase();
  const token = document.getElementById('lookup-token').value.trim();
  if (!code || !token) return;
  await openOrder(code, token);
});

document.getElementById('switch-order-btn').addEventListener('click', () => {
  currentOrder = null;
  currentToken = null;
  if (session) showMyOrders();
  else showLookup();
});

// ---------- Kirim pesan ----------
document.getElementById('chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message || !currentOrder) return;
  if (!document.getElementById('chat-closed-banner').classList.contains('hidden')) return; // chat ditutup

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  input.value = '';

  try {
    const res = await fetch(`${API_BASE}/orders?resource=messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: currentOrder.id,
        code: currentOrder.order_code,
        token: currentToken,
        message,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Gagal mengirim pesan.');
    await loadMessages();
  } catch (err) {
    alert(err.message);
    input.value = message;
  } finally {
    submitBtn.disabled = false;
    input.focus();
  }
});

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', async () => {
  initNotifyButton();
  await initSession();

  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const token = params.get('token');

  if (code && token) {
    // Link langsung (mis. dari halaman sukses checkout) -> buka pesanan
    // itu langsung, apapun status login-nya.
    document.getElementById('lookup-code').value = code;
    document.getElementById('lookup-token').value = token;
    openOrder(code, token);
  } else if (session) {
    showMyOrders();
  } else {
    showLookup();
  }
});
