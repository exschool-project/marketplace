// ---------------------------------------------------------------------
// Komponen UI panel admin: notifikasi (toast), konfirmasi, modal form,
// dan modal upload foto buatan sendiri (bukan dialog bawaan browser).
// Dimuat SEBELUM admin.js.
// ---------------------------------------------------------------------
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Toast ----------
  function notify(message, type = 'error') {
    let host = document.getElementById('toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toast-host';
      host.className = 'toast-host';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    host.appendChild(el);
    const ttl = type === 'error' ? 6000 : 3000;
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, ttl);
  }

  // ---------- Modal dasar ----------
  function openModal({ title, body, footer, size = 'md', onClose }) {
    const overlay = document.createElement('div');
    overlay.className = 'am-overlay';
    overlay.innerHTML = `
      <div class="am am-${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="am-head"><h3>${esc(title)}</h3>
          <button type="button" class="am-close" aria-label="Tutup">${window.ICONS ? ICONS.close : '×'}</button>
        </div>
        <div class="am-body"></div>
        ${footer === false ? '' : '<div class="am-foot"></div>'}
      </div>`;
    const bodyEl = overlay.querySelector('.am-body');
    const footEl = overlay.querySelector('.am-foot');
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    if (footEl && footer) { if (typeof footer === 'string') footEl.innerHTML = footer; else footEl.appendChild(footer); }

    const prevFocus = document.activeElement;
    const close = (result) => {
      document.removeEventListener('keydown', onKey);
      overlay.classList.add('out');
      document.body.classList.remove('am-lock');
      setTimeout(() => overlay.remove(), 160);
      prevFocus?.focus?.();
      onClose?.(result);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });
    overlay.querySelector('.am-close').addEventListener('click', () => close(null));

    document.body.appendChild(overlay);
    document.body.classList.add('am-lock');
    requestAnimationFrame(() => overlay.classList.add('in'));
    const first = overlay.querySelector('input:not([type=hidden]), textarea, select, button.primary');
    setTimeout(() => first?.focus?.(), 60);
    return { el: overlay, body: bodyEl, foot: footEl, close };
  }

  // ---------- Konfirmasi ----------
  function askConfirm(message, { okText = 'Hapus', danger = true, title = 'Konfirmasi' } = {}) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      const m = openModal({
        title, size: 'sm',
        body: `<p class="am-text">${esc(message)}</p>`,
        footer: `<button type="button" class="btn" data-act="no">Batal</button><button type="button" class="btn ${danger ? 'btn-danger' : 'btn-green'} primary" data-act="yes">${esc(okText)}</button>`,
        onClose: () => done(false),
      });
      m.foot.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (!act) return;
        done(act === 'yes');
        m.close();
      });
    });
  }

  // ---------- Modal form (edit cepat) ----------
  // fields: [{ name, label, type, value, options, required, placeholder, full }]
  function openFormModal({ title, fields, submitText = 'Simpan', onSubmit }) {
    const form = document.createElement('form');
    form.className = 'am-form';
    form.innerHTML = fields.map((f) => {
      const id = `fm-${f.name}`;
      let input;
      if (f.type === 'textarea') input = `<textarea id="${id}" name="${f.name}" rows="4" ${f.required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`;
      else if (f.type === 'select') input = `<select id="${id}" name="${f.name}">${(f.options || []).map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(f.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      else input = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}">`;
      return `<div class="fld ${f.full ? 'full' : ''}"><label for="${id}">${esc(f.label)}</label>${input}</div>`;
    }).join('') + '<p class="am-error hidden"></p>';

    const m = openModal({
      title, body: form,
      footer: `<button type="button" class="btn" data-act="cancel">Batal</button><button type="submit" form="__f" class="btn btn-green primary" data-act="save">${esc(submitText)}</button>`,
    });
    form.id = '__f';
    m.foot.querySelector('[data-act=cancel]').addEventListener('click', () => m.close());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = {};
      fields.forEach((f) => { values[f.name] = form.elements[f.name].value; });
      const btn = m.foot.querySelector('[data-act=save]');
      const errEl = form.querySelector('.am-error');
      btn.disabled = true; errEl.classList.add('hidden');
      try {
        await onSubmit(values);
        m.close();
      } catch (err) {
        errEl.textContent = err.message || 'Gagal menyimpan.';
        errEl.classList.remove('hidden');
        btn.disabled = false;
      }
    });
    return m;
  }

  // ---------- Modal upload foto ----------
  const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

  // Mengembalikan Promise<File[] | null>
  function openUploadModal({ title = 'Unggah foto', multiple = false, accept = 'image/*', maxMB = 10, aspect = '4 / 3', hint = 'JPG, PNG, atau WebP' } = {}) {
    return new Promise((resolve) => {
      let files = [];
      let settled = false;
      const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
      const acceptsVideo = /video/.test(accept);

      const body = document.createElement('div');
      body.innerHTML = `
        <div class="dz" tabindex="0" role="button" aria-label="Pilih atau tarik file ke sini">
          <span class="dz-icon">${ICONS.upload}</span>
          <strong>Tarik ${multiple ? 'foto' : 'foto'} ke sini</strong>
          <span class="dz-sub">atau <u>pilih dari perangkat</u></span>
          <small>${esc(hint)} · maks. ${maxMB} MB${multiple ? ' per file' : ''}</small>
          <input type="file" class="dz-input" accept="${esc(accept)}" ${multiple ? 'multiple' : ''}>
        </div>
        <p class="am-error hidden"></p>
        <div class="up-grid ${multiple ? '' : 'single'}" style="--ar:${aspect}"></div>`;
      const dz = body.querySelector('.dz');
      const input = body.querySelector('.dz-input');
      const grid = body.querySelector('.up-grid');
      const errEl = body.querySelector('.am-error');

      const m = openModal({
        title,
        body,
        footer: `<button type="button" class="btn" data-act="cancel">Batal</button><button type="button" class="btn btn-green primary" data-act="ok" disabled>Gunakan ${multiple ? 'foto' : 'foto'}</button>`,
        size: 'md',
        onClose: (r) => { finish(r === 'ok' ? files : null); files.forEach((f) => f._url && URL.revokeObjectURL(f._url)); },
      });
      const okBtn = m.foot.querySelector('[data-act=ok]');
      m.foot.querySelector('[data-act=cancel]').addEventListener('click', () => m.close());
      okBtn.addEventListener('click', () => m.close('ok'));

      const render = () => {
        grid.innerHTML = files.map((f, i) => `
          <figure class="up-item">
            <div class="up-frame">${f.type.startsWith('video/') ? `<video src="${f._url}" muted preload="metadata"></video>` : `<img src="${f._url}" alt="">`}</div>
            <figcaption><span class="up-name">${esc(f.name)}</span><span class="up-size">${fmtSize(f.size)}</span></figcaption>
            <button type="button" class="up-remove" data-i="${i}" aria-label="Hapus">${ICONS.close}</button>
          </figure>`).join('');
        okBtn.disabled = files.length === 0;
        dz.classList.toggle('compact', files.length > 0);
        const dzTitle = dz.querySelector('strong');
        if (dzTitle) dzTitle.textContent = files.length && !multiple ? 'Ganti foto' : (files.length ? 'Tambah foto lain' : 'Tarik foto ke sini');
      };

      const addFiles = (list) => {
        errEl.classList.add('hidden');
        const problems = [];
        const incoming = [...list].filter((f) => {
          const okType = f.type.startsWith('image/') || (acceptsVideo && f.type.startsWith('video/'));
          if (!okType) { problems.push(`${f.name}: format tidak didukung`); return false; }
          if (!f.type.startsWith('video/') && f.size > maxMB * 1048576) { problems.push(`${f.name}: lebih dari ${maxMB} MB`); return false; }
          return true;
        });
        incoming.forEach((f) => { f._url = URL.createObjectURL(f); });
        if (multiple) files = files.concat(incoming).slice(0, 20);
        else if (incoming.length) { files.forEach((f) => URL.revokeObjectURL(f._url)); files = [incoming[0]]; }
        if (problems.length) { errEl.textContent = problems.join(' · '); errEl.classList.remove('hidden'); }
        render();
      };

      dz.addEventListener('click', () => input.click());
      dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
      input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
      ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
      dz.addEventListener('drop', (e) => addFiles(e.dataTransfer?.files || []));
      grid.addEventListener('click', (e) => {
        const b = e.target.closest('.up-remove');
        if (!b) return;
        const [removed] = files.splice(Number(b.dataset.i), 1);
        if (removed?._url) URL.revokeObjectURL(removed._url);
        render();
      });
    });
  }

  // Ganti <input type="file"> bawaan browser dengan tile + modal sendiri.
  // Input aslinya tetap ada (tersembunyi) supaya logika upload lama tetap jalan.
  function enhanceFileInput(input, opts = {}) {
    if (!input || input._enhanced) return;
    input._enhanced = true;
    const multiple = input.multiple;
    const isVideoOK = /video/.test(input.accept || '');

    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'upload-tile';
    const idle = () => {
      tile.classList.remove('has-file');
      tile.innerHTML = `<span class="ut-icon">${ICONS.image}</span><span class="ut-text"><strong>${esc(opts.label || (multiple ? 'Pilih foto' : 'Pilih foto'))}</strong><small>${esc(opts.hint || 'Klik untuk memilih atau tarik file')}</small></span>`;
    };
    idle();
    input.classList.add('file-hidden');
    input.tabIndex = -1;
    input.insertAdjacentElement('afterend', tile);

    const open = async () => {
      const picked = await openUploadModal({
        title: opts.title || (multiple ? 'Unggah foto' : 'Unggah foto'),
        multiple,
        accept: input.accept || 'image/*',
        maxMB: opts.maxMB || 10,
        aspect: opts.aspect || '4 / 3',
        hint: isVideoOK ? 'Gambar atau video MP4/WebM' : 'JPG, PNG, atau WebP',
      });
      if (!picked || !picked.length) return;
      const dt = new DataTransfer();
      picked.forEach((f) => dt.items.add(f));
      input.files = dt.files;
      const first = picked[0];
      tile.classList.add('has-file');
      tile.innerHTML = `<span class="ut-icon">${ICONS.check}</span><span class="ut-text"><strong>${multiple ? `${picked.length} file dipilih` : esc(first.name)}</strong><small>Klik untuk mengganti</small></span>`;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    tile.addEventListener('click', open);
    input.addEventListener('click', (e) => { e.preventDefault(); open(); });
    input.addEventListener('tile-reset', idle);
    input.form?.addEventListener('reset', () => setTimeout(idle, 0));
    return tile;
  }

  window.notify = notify;
  window.askConfirm = askConfirm;
  window.openModal = openModal;
  window.openFormModal = openFormModal;
  window.openUploadModal = openUploadModal;
  window.enhanceFileInput = enhanceFileInput;
})();
