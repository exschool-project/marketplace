const API_BASE = '/api';

let currentOrder = null;
let currentToken = null;
let pollTimer = null;
let lastMessageCount = 0;

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

const STATUS_LABEL = {
  menunggu: 'Menunggu Konfirmasi',
  diproses: 'Diproses',
  dikirim: 'Dikirim',
  selesai: 'Selesai',
  dibatalkan: 'Dibatalkan',
};

// ---------- View switching ----------
function showLookup() {
  document.getElementById('lookup-view').classList.remove('hidden');
  document.getElementById('order-view').classList.add('hidden');
  if (pollTimer) clearInterval(pollTimer);
  renderRecentOrders();
}

function showOrder() {
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
  showLookup();
});

// ---------- Kirim pesan ----------
document.getElementById('chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message || !currentOrder) return;

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
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const token = params.get('token');

  if (code && token) {
    document.getElementById('lookup-code').value = code;
    document.getElementById('lookup-token').value = token;
    openOrder(code, token);
  } else {
    showLookup();
  }
});
