/* Alinkvault — logika aplikasi (vanilla JS, offline-first) */
(() => {
  'use strict';

  const KEY = 'alinkvault.v1';
  const APP_VERSION = '1.0.2';
  const MAX_TAGS = 8;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const bridge = () => (window.AndroidBridge ? window.AndroidBridge : null);

  const state = {
    items: [],
    settings: { theme: 'auto', lite: false },
    view: 'all',
    collection: null,
    query: '',
    sort: 'newest',
    editingId: null,
    justAddedId: null,
    confirmAction: null,
    lastDeleted: null,
    undoTimer: null,
    lastFocus: null,
  };

  /* ---------- Utilitas ---------- */

  const uid = () => {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `l_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  };

  const escapeHtml = (value) =>
    String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const hashString = (value) => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) % 360;
    }
    return hash;
  };

  function normalizeUrl(input) {
    let raw = String(input || '').trim();
    if (!raw) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;
    let url;
    try {
      url = new URL(raw);
    } catch (err) {
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname || !url.hostname.includes('.')) return null;
    return url.href;
  }

  function domainOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (err) {
      return url;
    }
  }

  function originOf(url) {
    try {
      return new URL(url).origin;
    } catch (err) {
      return url;
    }
  }

  function deriveTitle(url) {
    try {
      const parsed = new URL(url);
      const segments = parsed.pathname.split('/').filter(Boolean);
      const last = segments[segments.length - 1];
      if (last) {
        const clean = decodeURIComponent(last)
          .replace(/\.(html?|php|aspx?)$/i, '')
          .replace(/[-_+]+/g, ' ')
          .trim();
        if (clean.length > 2) {
          return clean.charAt(0).toUpperCase() + clean.slice(1).slice(0, 120);
        }
      }
      const host = parsed.hostname.replace(/^www\./, '');
      return host.charAt(0).toUpperCase() + host.slice(1);
    } catch (err) {
      return 'Tautan tanpa judul';
    }
  }

  function parseTags(input) {
    const seen = new Set();
    return String(input || '')
      .split(',')
      .map((tag) => tag.trim().replace(/^#/, '').slice(0, 24))
      .filter((tag) => {
        if (!tag) return false;
        const key = tag.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_TAGS);
  }

  const dateFmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' });
  const dateFmtYear = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

  function formatDate(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '—';
    return date.getFullYear() === new Date().getFullYear()
      ? dateFmt.format(date)
      : dateFmtYear.format(date);
  }

  function sanitizeItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const url = normalizeUrl(raw.url);
    if (!url) return null;
    const createdAt = Number(raw.createdAt) || Date.now();
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : uid(),
      url,
      title: String(raw.title || '').trim().slice(0, 140) || deriveTitle(url),
      description: String(raw.description || '').trim().slice(0, 320),
      collection: String(raw.collection || '').trim().slice(0, 40),
      tags: Array.isArray(raw.tags)
        ? raw.tags.map((tag) => String(tag).trim().slice(0, 24)).filter(Boolean).slice(0, MAX_TAGS)
        : [],
      fav: Boolean(raw.fav),
      createdAt,
      updatedAt: Number(raw.updatedAt) || createdAt,
    };
  }

  /* ---------- Penyimpanan ---------- */

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.items)) {
        state.items = data.items.map(sanitizeItem).filter(Boolean);
      }
      if (data.settings && typeof data.settings === 'object') {
        const theme = data.settings.theme;
        state.settings.theme = ['auto', 'dark', 'light'].includes(theme) ? theme : 'auto';
        state.settings.lite = Boolean(data.settings.lite);
      }
    } catch (err) {
      console.warn('Gagal membaca vault:', err);
    }
  }

  function save() {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ version: 1, items: state.items, settings: state.settings }),
      );
      return true;
    } catch (err) {
      console.warn('Gagal menyimpan vault:', err);
      toast('Penyimpanan penuh. Ekspor cadangan lalu hapus beberapa tautan.', { icon: 'info' });
      return false;
    }
  }

  /* ---------- Tema ---------- */

  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function resolvedTheme() {
    const theme = state.settings.theme;
    if (theme === 'auto') return systemPrefersDark() ? 'dark' : 'light';
    return theme;
  }

  function applyTheme(theme, { persist = true } = {}) {
    state.settings.theme = ['auto', 'dark', 'light'].includes(theme) ? theme : 'auto';
    const resolved = resolvedTheme();
    document.documentElement.dataset.theme = resolved;
    const meta = $('#meta-theme');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#070a16' : '#e9edfa');
    $$('.segmented button').forEach((btn) => {
      const active = btn.dataset.theme === state.settings.theme;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    const native = bridge();
    if (native && typeof native.setTheme === 'function') {
      try { native.setTheme(resolved); } catch (err) { /* abaikan */ }
    }
    if (persist) save();
  }

  /* ---------- Mode ringan ---------- */

  function applyFx(lite, { persist = true } = {}) {
    state.settings.lite = Boolean(lite);
    document.documentElement.dataset.fx = state.settings.lite ? 'lite' : 'full';
    const toggle = $('#fx-lite');
    if (toggle) toggle.checked = state.settings.lite;
    if (persist) save();
  }

  /* ---------- Toast ---------- */

  function toast(message, options = {}) {
    const { icon = 'check', actionLabel = '', onAction = null, duration = 3000 } = options;
    const host = $('#toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `
      <svg class="icon" aria-hidden="true"><use href="#i-${escapeHtml(icon)}"/></svg>
      <span class="toast__msg"></span>
      ${actionLabel ? '<button type="button"></button>' : ''}
    `;
    el.querySelector('.toast__msg').textContent = message;
    if (actionLabel) {
      const action = el.querySelector('button');
      action.textContent = actionLabel;
      action.addEventListener('click', () => {
        if (typeof onAction === 'function') onAction();
        dismiss();
      });
    }
    host.appendChild(el);

    let timer = null;
    const dismiss = () => {
      if (!el.isConnected) return;
      clearTimeout(timer);
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 220);
    };
    timer = setTimeout(dismiss, duration);
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', () => { timer = setTimeout(dismiss, 1400); });
  }

  /* ---------- Filter & tampilan ---------- */

  function collectionsList() {
    const map = new Map();
    state.items.forEach((item) => {
      if (!item.collection) return;
      map.set(item.collection, (map.get(item.collection) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'id'));
  }

  function visibleItems() {
    let list = state.items.slice();

    if (state.view === 'favorites') list = list.filter((item) => item.fav);
    if (state.collection) list = list.filter((item) => item.collection === state.collection);

    const query = state.query.trim().toLowerCase();
    if (query) {
      list = list.filter((item) =>
        [item.title, item.url, item.description, item.collection, ...item.tags]
          .join(' ')
          .toLowerCase()
          .includes(query),
      );
    }

    const sorters = {
      newest: (a, b) => b.createdAt - a.createdAt,
      oldest: (a, b) => a.createdAt - b.createdAt,
      az: (a, b) => a.title.localeCompare(b.title, 'id'),
      favorites: (a, b) => Number(b.fav) - Number(a.fav) || b.createdAt - a.createdAt,
    };
    return list.sort(sorters[state.sort] || sorters.newest);
  }

  function renderStats() {
    const total = state.items.length;
    const favorites = state.items.filter((item) => item.fav).length;
    const collections = collectionsList().length;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const week = state.items.filter((item) => item.createdAt >= weekAgo).length;

    const tiles = [
      { cls: '', icon: 'link', value: total, label: 'Tautan tersimpan' },
      { cls: 'stat--fav', icon: 'star', value: favorites, label: 'Favorit' },
      { cls: 'stat--col', icon: 'folder', value: collections, label: 'Koleksi' },
      { cls: 'stat--week', icon: 'sparkles', value: week, label: 'Ditambah minggu ini' },
    ];

    $('#stats').innerHTML = tiles
      .map(
        (tile) => `
        <div class="stat glass ${tile.cls}">
          <span class="stat__icon"><svg class="icon" aria-hidden="true"><use href="#i-${tile.icon}"/></svg></span>
          <span class="stat__body">
            <span class="stat__value">${tile.value}</span>
            <span class="stat__label">${tile.label}</span>
          </span>
        </div>`,
      )
      .join('');

    $('#count-all').textContent = total;
    $('#count-favorites').textContent = favorites;
    $('#count-collections').textContent = collections;
    $('#vault-count').textContent = total;
  }

  function renderChips() {
    const collections = collectionsList();
    const allActive = !state.collection;
    const parts = [
      `<button class="chip ${allActive ? 'is-active' : ''}" type="button" data-collection="">
        <svg class="icon" aria-hidden="true"><use href="#i-grid"/></svg>Semua <b>${state.items.length}</b>
      </button>`,
    ];
    collections.forEach((col) => {
      parts.push(`
        <button class="chip ${state.collection === col.name ? 'is-active' : ''}" type="button" data-collection="${escapeHtml(col.name)}">
          <svg class="icon" aria-hidden="true"><use href="#i-folder"/></svg>${escapeHtml(col.name)} <b>${col.count}</b>
        </button>`);
    });
    $('#chips').innerHTML = parts.join('');
  }

  function renderRailCollections() {
    const collections = collectionsList();
    const host = $('#rail-collections');
    if (!collections.length) {
      host.innerHTML = '<span class="rail__tag rail__tag--empty">Belum ada koleksi</span>';
      return;
    }
    host.innerHTML = collections
      .slice(0, 10)
      .map(
        (col) => `
        <button class="rail__tag ${state.collection === col.name ? 'is-active' : ''}" type="button" data-collection="${escapeHtml(col.name)}">
          <svg class="icon" style="width:12px;height:12px" aria-hidden="true"><use href="#i-folder"/></svg>
          ${escapeHtml(col.name)} <b>${col.count}</b>
        </button>`,
      )
      .join('');
  }

  function cardHtml(item) {
    const domain = domainOf(item.url);
    const letter = domain.charAt(0) || '?';
    const hue = hashString(domain);
    const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
    const tags = item.tags.slice(0, 3);
    const extra = item.tags.length - tags.length;
    const isNew = item.id === state.justAddedId ? ' is-new' : '';

    const tagHtml = [
      item.collection
        ? `<span class="tag tag--collection"><svg class="icon" aria-hidden="true"><use href="#i-folder"/></svg>${escapeHtml(item.collection)}</span>`
        : '',
      ...tags.map(
        (tag) => `<span class="tag">#${escapeHtml(tag)}</span>`,
      ),
      extra > 0 ? `<span class="tag tag--more">+${extra}</span>` : '',
    ].join('');

    return `
      <article class="card glass${isNew}" data-id="${escapeHtml(item.id)}" tabindex="0" role="link" aria-label="${escapeHtml(item.title)} — buka tautan">
        <div class="card__top">
          <span class="favicon" style="--hue:${hue}">
            <span class="favicon__fallback">${escapeHtml(letter)}</span>
            <img src="${favicon}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="if(!this.dataset.alt){this.dataset.alt='1';this.src='https://icons.duckduckgo.com/ip3/${domain}.ico'}else{this.remove()}">
          </span>
          <span class="card__site">
            <span class="card__domain" title="${escapeHtml(item.url)}">${escapeHtml(domain)}</span>
            <span class="card__meta">
              <span>${item.fav ? 'Favorit' : 'Tersimpan'}</span>
              <span class="dot"></span>
              <span>${formatDate(item.createdAt)}</span>
            </span>
          </span>
          <button class="star ${item.fav ? 'is-on' : ''}" type="button" data-act="fav" aria-pressed="${item.fav}" aria-label="${item.fav ? 'Hapus dari favorit' : 'Tandai favorit'}">
            <svg class="icon" aria-hidden="true"><use href="#i-star"/></svg>
          </button>
        </div>
        <h3 class="card__title">${escapeHtml(item.title)}</h3>
        ${item.description ? `<p class="card__desc">${escapeHtml(item.description)}</p>` : '<p class="card__desc"></p>'}
        <div class="card__tags">${tagHtml}</div>
        <div class="card__foot">
          <span class="card__date">
            <svg class="icon" aria-hidden="true"><use href="#i-clock"/></svg>${formatDate(item.createdAt)}
          </span>
          <div class="card__actions">
            <button class="icon-btn" type="button" data-act="open" aria-label="Buka tautan" title="Buka">
              <svg class="icon" aria-hidden="true"><use href="#i-open"/></svg>
            </button>
            <button class="icon-btn" type="button" data-act="copy" aria-label="Salin tautan" title="Salin">
              <svg class="icon" aria-hidden="true"><use href="#i-copy"/></svg>
            </button>
            <button class="icon-btn" type="button" data-act="edit" aria-label="Edit tautan" title="Edit">
              <svg class="icon" aria-hidden="true"><use href="#i-edit"/></svg>
            </button>
            <button class="icon-btn" type="button" data-act="delete" aria-label="Hapus tautan" title="Hapus">
              <svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg>
            </button>
          </div>
        </div>
      </article>`;
  }

  function collectionsHtml() {
    const collections = collectionsList();
    if (!collections.length) return '';
    return collections
      .map((col) => {
        const items = state.items.filter((item) => item.collection === col.name);
        const domains = Array.from(new Set(items.map((item) => domainOf(item.url)))).slice(0, 3);
        return `
          <button class="collection-card glass" type="button" data-open-collection="${escapeHtml(col.name)}">
            <span class="collection-card__top">
              <span class="collection-card__icon"><svg class="icon" aria-hidden="true"><use href="#i-folder"/></svg></span>
              <span class="collection-card__count">${col.count} tautan</span>
            </span>
            <h3>${escapeHtml(col.name)}</h3>
            <p>${escapeHtml(domains.join(' · ')) || 'Tanpa domain'}</p>
            <span class="collection-card__go">Buka koleksi <svg class="icon" aria-hidden="true"><use href="#i-arrow-right"/></svg></span>
          </button>`;
      })
      .join('');
  }

  /* ---------- Render daftar ---------- */

  const cardCache = new Map();
  let searchTimer = null;

  function cardSignature(item) {
    return [
      item.url,
      item.title,
      item.description,
      item.collection,
      item.tags.join(','),
      item.fav ? 1 : 0,
      item.updatedAt,
      state.justAddedId === item.id ? 1 : 0,
    ].join('\u0000');
  }

  function cardElement(item) {
    const signature = cardSignature(item);
    const cached = cardCache.get(item.id);
    if (cached && cached.signature === signature) return cached.element;

    const template = document.createElement('template');
    template.innerHTML = cardHtml(item).trim();
    const element = template.content.firstElementChild;
    cardCache.set(item.id, { signature, element });
    return element;
  }

  // Pakai ulang elemen kartu yang sudah ada supaya gambar favicon tidak dimuat ulang.
  function paintGrid(items) {
    const grid = $('#grid');
    const fragment = document.createDocumentFragment();
    items.forEach((item) => fragment.appendChild(cardElement(item)));
    grid.replaceChildren(fragment);
  }

  function render({ listOnly = false } = {}) {
    const showCollections = state.view === 'collections' && !state.collection;
    if (listOnly && showCollections) return;

    if (!listOnly) {
      const activeView = state.collection ? 'collections' : state.view;
      $$('.nav__item, .tab').forEach((el) => {
        const active = el.dataset.view === activeView;
        el.classList.toggle('is-active', active);
        if (active) el.setAttribute('aria-current', 'page');
        else el.removeAttribute('aria-current');
      });

      renderStats();
      renderChips();
      renderRailCollections();
    }

    const titles = {
      all: ['Ruang kerja', 'Semua tautan', 'Semua tautan yang kamu simpan, rapi di satu tempat.'],
      favorites: ['Pilihan', 'Favorit', 'Tautan yang paling sering kamu buka dan sayangi.'],
      collections: ['Rak tautan', 'Koleksi', 'Kelompokkan tautan sesuai konteks: kerja, belajar, inspirasi.'],
    };

    let title = titles[state.view] ? titles[state.view][1] : 'Semua tautan';
    let sub = titles[state.view] ? titles[state.view][2] : titles.all[2];
    let eyebrow = titles[state.view] ? titles[state.view][0] : titles.all[0];

    if (state.collection) {
      eyebrow = 'Koleksi';
      title = state.collection;
      sub = `${state.items.filter((item) => item.collection === state.collection).length} tautan dalam koleksi ini.`;
    }

    if (state.query.trim()) {
      sub = `Hasil pencarian untuk “${state.query.trim()}”.`;
    }

    const titleEl = $('#view-title');
    const subEl = $('#view-sub');
    const eyebrowEl = $('#view-eyebrow');
    if (titleEl.textContent !== title) titleEl.textContent = title;
    if (subEl.textContent !== sub) subEl.textContent = sub;
    if (eyebrowEl.textContent !== eyebrow) eyebrowEl.textContent = eyebrow;

    const grid = $('#grid');
    const collectionsView = $('#collections-view');
    const empty = $('#empty');
    const toolbar = $('#toolbar');

    toolbar.hidden = showCollections;
    collectionsView.hidden = !showCollections;
    grid.hidden = showCollections;

    if (showCollections) {
      const html = collectionsHtml();
      if (collectionsView.innerHTML !== html) collectionsView.innerHTML = html;
      if (!html) {
        empty.hidden = false;
        empty.querySelector('#empty-title').textContent = 'Belum ada koleksi';
        empty.querySelector('#empty-sub').textContent =
          'Tambahkan nama koleksi saat menyimpan tautan, lalu semua tautan serupa akan terkumpul di sini.';
        empty.querySelector('#empty-sample').hidden = state.items.length > 0;
      } else {
        empty.hidden = true;
      }
      $('#result-count').textContent = '';
      updateMeta();
      return;
    }

    const items = visibleItems();
    paintGrid(items);
    grid.hidden = items.length === 0;
    empty.hidden = items.length > 0;

    if (!items.length) {
      const hasQuery = Boolean(state.query.trim());
      if (hasQuery) {
        $('#empty-title').textContent = 'Tidak ada yang cocok';
        $('#empty-sub').textContent = `Tidak ada tautan yang cocok dengan “${state.query.trim()}”. Coba kata kunci lain atau hapus pencarian.`;
        $('#empty-sample').hidden = true;
      } else if (state.view === 'favorites') {
        $('#empty-title').textContent = 'Belum ada favorit';
        $('#empty-sub').textContent = 'Tandai tautan dengan bintang, dan tautan penting itu akan muncul di sini.';
        $('#empty-sample').hidden = state.items.length > 0;
      } else if (state.collection) {
        $('#empty-title').textContent = 'Koleksi ini masih kosong';
        $('#empty-sub').textContent = 'Simpan tautan baru dan pilih koleksi ini, atau pindahkan tautan yang sudah ada.';
        $('#empty-sample').hidden = true;
      } else {
        $('#empty-title').textContent = 'Vault-mu masih kosong';
        $('#empty-sub').textContent = 'Simpan tautan pertama, lalu rapikan dengan koleksi dan tag. Semua tersimpan di perangkatmu.';
        $('#empty-sample').hidden = false;
      }
    }

    $('#result-count').textContent = items.length ? `${items.length} tautan` : '';

    if (state.justAddedId) {
      const id = state.justAddedId;
      state.justAddedId = null;
      setTimeout(() => {
        const card = grid.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (card) card.classList.remove('is-new');
      }, 600);
    }

    if (!listOnly) updateMeta();
  }

  let metaSignature = null;

  function updateMeta() {
    const names = collectionsList().map((col) => col.name);
    const signature = names.join('\u0000');
    if (signature === metaSignature) return;
    metaSignature = signature;

    $$('#collection-list option').forEach((option) => option.remove());
    const list = $('#collection-list');
    names.forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      list.appendChild(option);
    });
  }

  /* ---------- Aksi tautan ---------- */

  function openLink(url) {
    const native = bridge();
    if (native && typeof native.openUrl === 'function') {
      try {
        native.openUrl(url);
        return;
      } catch (err) { /* fallback */ }
    }
    window.open(url, '_blank', 'noopener');
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) { /* fallback di bawah */ }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (err) {
      return false;
    }
  }

  async function copyItem(item) {
    const ok = await copyText(item.url);
    toast(ok ? 'Tautan disalin ke clipboard.' : 'Tidak bisa menyalin otomatis.', {
      icon: ok ? 'copy' : 'info',
    });
  }

  function toggleFavorite(id) {
    const item = state.items.find((entry) => entry.id === id);
    if (!item) return;
    item.fav = !item.fav;
    item.updatedAt = Date.now();
    save();
    render();
    toast(item.fav ? 'Ditambahkan ke favorit.' : 'Dihapus dari favorit.', { icon: 'star' });
  }

  function openEditor(id = null) {
    const item = id ? state.items.find((entry) => entry.id === id) : null;
    state.editingId = item ? item.id : null;

    $('#link-modal-eyebrow').textContent = item ? 'Perbarui tautan' : 'Tautan baru';
    $('#link-modal-title').textContent = item ? 'Edit tautan' : 'Simpan tautan';
    $('#link-save').innerHTML =
      '<svg class="icon" aria-hidden="true"><use href="#i-check"/></svg>' +
      (item ? 'Simpan perubahan' : 'Simpan tautan');
    $('#link-form-note').textContent = item
      ? `Ditambahkan ${formatDate(item.createdAt)}.`
      : 'Data hanya tersimpan di perangkat ini.';

    $('#f-url').value = item ? item.url : '';
    $('#f-title').value = item ? item.title : '';
    $('#f-desc').value = item ? item.description : '';
    $('#f-collection').value = item ? item.collection : state.collection || '';
    $('#f-tags').value = item ? item.tags.join(', ') : '';
    $('#f-fav').checked = item ? item.fav : false;
    $('#f-url').classList.remove('is-invalid');
    $('#url-hint').classList.remove('is-error');
    $('#url-hint').innerHTML = 'Alamat akan dilengkapi <code>https://</code> otomatis bila perlu.';

    openModal('link-modal');
    setTimeout(() => {
      (item ? $('#f-title') : $('#f-url')).focus();
      if (!item) $('#f-url').select();
    }, 80);
  }

  function submitEditor(event) {
    event.preventDefault();
    const urlInput = $('#f-url');
    const url = normalizeUrl(urlInput.value);
    const hint = $('#url-hint');

    if (!url) {
      urlInput.classList.add('is-invalid');
      hint.classList.add('is-error');
      hint.textContent = 'Alamat tidak valid. Contoh: https://example.com/halaman';
      urlInput.focus();
      return;
    }

    const duplicate = state.items.find(
      (item) => item.id !== state.editingId && item.url.replace(/\/$/, '') === url.replace(/\/$/, ''),
    );
    if (duplicate) {
      urlInput.classList.add('is-invalid');
      hint.classList.add('is-error');
      hint.textContent = 'Tautan ini sudah ada di vault-mu.';
      toast('Tautan sudah tersimpan sebelumnya.', { icon: 'info' });
      return;
    }

    const title = $('#f-title').value.trim() || deriveTitle(url);
    const tags = parseTags($('#f-tags').value);
    const collection = $('#f-collection').value.trim().slice(0, 40);
    const description = $('#f-desc').value.trim().slice(0, 320);
    const fav = $('#f-fav').checked;

    if (state.editingId) {
      const item = state.items.find((entry) => entry.id === state.editingId);
      if (!item) return;
      Object.assign(item, { url, title, tags, collection, description, fav, updatedAt: Date.now() });
      save();
      closeModal('link-modal');
      render();
      toast('Perubahan tersimpan.', { icon: 'check' });
      return;
    }

    const item = {
      id: uid(),
      url,
      title,
      description,
      collection,
      tags,
      fav,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    state.items.unshift(item);
    state.justAddedId = item.id;
    save();
    closeModal('link-modal');
    render();
    toast('Tautan masuk ke vault.', { icon: 'link' });
  }

  async function pasteFromClipboard() {
    let text = '';
    const native = bridge();
    if (native && typeof native.getClipboard === 'function') {
      try { text = native.getClipboard() || ''; } catch (err) { text = ''; }
    }
    if (!text) {
      try {
        if (navigator.clipboard && window.isSecureContext) text = await navigator.clipboard.readText();
      } catch (err) { text = ''; }
    }
    if (!text) {
      toast('Clipboard kosong atau akses ditolak.', { icon: 'info' });
      return;
    }
    const firstLine = text.split(/\s+/).find((part) => normalizeUrl(part));
    const url = normalizeUrl(firstLine || text);
    if (!url) {
      toast('Clipboard tidak berisi tautan yang valid.', { icon: 'info' });
      return;
    }
    $('#f-url').value = url;
    $('#f-url').classList.remove('is-invalid');
    $('#url-hint').classList.remove('is-error');
    $('#url-hint').innerHTML = `Tautan terdeteksi dari <strong>${escapeHtml(domainOf(url))}</strong>.`;
    if (!$('#f-title').value.trim()) $('#f-title').value = deriveTitle(url);
    $('#f-title').focus();
  }

  function deleteItem(id) {
    const index = state.items.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    const item = state.items[index];
    askConfirm({
      title: 'Hapus tautan?',
      sub: `“${item.title}” akan dihapus dari vault. Kamu masih bisa mengurungkannya sesaat setelah ini.`,
      confirmLabel: 'Hapus',
      onConfirm: () => {
        state.items.splice(index, 1);
        cardCache.delete(item.id);
        state.lastDeleted = { item, index };
        save();
        render();
        toast('Tautan dihapus.', {
          icon: 'trash',
          actionLabel: 'Urungkan',
          duration: 6000,
          onAction: undoDelete,
        });
      },
    });
  }

  function undoDelete() {
    if (!state.lastDeleted) return;
    const { item, index } = state.lastDeleted;
    state.items.splice(Math.min(index, state.items.length), 0, item);
    state.lastDeleted = null;
    save();
    render();
    toast('Tautan dipulihkan.', { icon: 'undo' });
  }

  /* ---------- Modal ---------- */

  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    state.lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('is-locked');
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.hidden = true;
    if (!$$('.modal:not([hidden])').length) {
      document.body.classList.remove('is-locked');
      if (state.lastFocus && state.lastFocus.focus) {
        try { state.lastFocus.focus(); } catch (err) { /* abaikan */ }
      }
    }
    if (id === 'link-modal') state.editingId = null;
  }

  function askConfirm({ title, sub, confirmLabel = 'Hapus', onConfirm }) {
    $('#confirm-title').textContent = title;
    $('#confirm-sub').textContent = sub;
    $('#confirm-ok').textContent = confirmLabel;
    state.confirmAction = onConfirm;
    openModal('confirm-modal');
    setTimeout(() => $('#confirm-cancel').focus(), 60);
  }

  /* ---------- Navigasi ---------- */

  function setView(view) {
    state.collection = null;
    state.view = view;
    if (view === 'collections') {
      state.query = '';
      const searchInput = $('#search');
      if (searchInput) searchInput.value = '';
      const clearButton = $('#search-clear');
      if (clearButton) clearButton.hidden = true;
    }
    const hash =
      view === 'favorites' ? '#/favorit' : view === 'collections' ? '#/koleksi' : '#/semua';
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function filterCollection(name) {
    state.collection = name || null;
    state.view = name ? 'all' : 'all';
    const hash = name ? `#/koleksi/${encodeURIComponent(name)}` : '#/semua';
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function routeFromHash() {
    const hash = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    if (hash.startsWith('koleksi/')) {
      state.collection = hash.slice('koleksi/'.length) || null;
      state.view = 'all';
      return;
    }
    state.collection = null;
    if (hash === 'favorit') state.view = 'favorites';
    else if (hash === 'koleksi') state.view = 'collections';
    else state.view = 'all';
  }

  /* ---------- Ekspor / impor ---------- */

  function exportData() {
    const payload = {
      app: 'Alinkvault',
      version: 1,
      exportedAt: new Date().toISOString(),
      count: state.items.length,
      items: state.items,
    };
    const json = JSON.stringify(payload, null, 2);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `alinkvault-backup-${stamp}.json`;

    const native = bridge();
    if (native && typeof native.downloadFile === 'function') {
      try {
        native.downloadFile(filename, json, 'application/json');
        toast('Pilih lokasi penyimpanan cadangan.', { icon: 'download' });
        return;
      } catch (err) { /* fallback */ }
    }

    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Cadangan JSON diunduh.', { icon: 'download' });
    } catch (err) {
      toast('Gagal membuat berkas cadangan.', { icon: 'info' });
    }
  }

  function importPayload(text) {
    const clean = String(text == null ? '' : text).replace(/^\uFEFF/, '').trim();

    if (!clean) {
      toast('Berkas cadangan kosong.', { icon: 'info' });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (err) {
      toast('Isi berkas bukan JSON yang valid. Pastikan memilih berkas hasil ekspor Alinkvault.', { icon: 'info' });
      return;
    }

    const rawItems = Array.isArray(parsed) ? parsed : parsed && parsed.items;
    if (!Array.isArray(rawItems)) {
      toast('Struktur cadangan tidak dikenali. Gunakan berkas .json hasil ekspor Alinkvault.', { icon: 'info' });
      return;
    }

    if (!rawItems.length) {
      toast('Berkas cadangan tidak berisi tautan.', { icon: 'info' });
      return;
    }

    const existing = new Set(state.items.map((item) => item.url.replace(/\/$/, '')));
    let added = 0;
    let skipped = 0;

    rawItems.forEach((raw) => {
      const item = sanitizeItem(raw);
      if (!item) { skipped += 1; return; }
      const key = item.url.replace(/\/$/, '');
      if (existing.has(key)) { skipped += 1; return; }
      existing.add(key);
      state.items.push(item);
      added += 1;
    });

    if (added) {
      save();
      closeModal('settings-modal');
      render();
    }

    toast(
      added
        ? `${added} tautan diimpor${skipped ? `, ${skipped} dilewati` : ''}.`
        : 'Tidak ada tautan baru untuk diimpor.',
      { icon: added ? 'upload' : 'info' },
    );
  }

  function importFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      importPayload(reader.result);
      $('#import-file').value = '';
    };
    reader.onerror = () => {
      toast('Gagal membaca berkas. Coba impor ulang lewat aplikasi Android.', { icon: 'info' });
      $('#import-file').value = '';
    };
    reader.readAsText(file);
  }

  // Dipanggil dari MainActivity setelah berkas cadangan dibaca native.
  window.__alinkvaultImportText = function alinkvaultImportText(text) {
    importPayload(text);
  };

  /* ---------- Data contoh ---------- */

  function seedSamples() {
    if (state.items.length) {
      closeModal('settings-modal');
      render();
      toast('Vault sudah berisi tautan. Data contoh tidak ditambahkan.', { icon: 'info' });
      return;
    }
    const now = Date.now();
    const samples = [
      {
        url: 'https://dribbble.com/',
        title: 'Dribbble — Temukan desainer kelas dunia',
        description: 'Referensi visual, shot, dan portofolio untuk mencari inspirasi antarmuka.',
        collection: 'Inspirasi',
        tags: ['desain', 'ui'],
        fav: true,
        createdAt: now - 2 * 60 * 60 * 1000,
      },
      {
        url: 'https://github.com/',
        title: 'GitHub — Bangun perangkat lunak bersama',
        description: 'Repositori, rilis, dan otomasi untuk proyek pribadi maupun kolaborasi.',
        collection: 'Kerja',
        tags: ['kode', 'tools'],
        fav: true,
        createdAt: now - 26 * 60 * 60 * 1000,
      },
      {
        url: 'https://developer.mozilla.org/',
        title: 'MDN Web Docs',
        description: 'Dokumentasi HTML, CSS, dan JavaScript yang jadi rujukan utama.',
        collection: 'Belajar',
        tags: ['referensi', 'web'],
        fav: false,
        createdAt: now - 3 * 24 * 60 * 60 * 1000,
      },
      {
        url: 'https://www.are.na/',
        title: 'Are.na — Simpan dan hubungkan ide',
        description: 'Ruang tenang untuk mengoleksi tautan, gambar, dan pemikiran.',
        collection: 'Inspirasi',
        tags: ['ide', 'kurasi'],
        fav: false,
        createdAt: now - 4 * 24 * 60 * 60 * 1000,
      },
      {
        url: 'https://www.awwwards.com/',
        title: 'Awwwards — Penghargaan desain web',
        description: 'Galeri situs terbaik untuk melihat tren dan detail interaksi terbaru.',
        collection: 'Inspirasi',
        tags: ['desain', 'web'],
        fav: false,
        createdAt: now - 5 * 24 * 60 * 60 * 1000,
      },
    ];
    state.items = samples.map((sample) =>
      sanitizeItem({ ...sample, updatedAt: sample.createdAt }),
    );
    cardCache.clear();
    closeModal('settings-modal');
    save();
    setView('all');
    render();
    toast('5 tautan contoh ditambahkan.', { icon: 'sparkles' });
  }

  function clearAll() {
    askConfirm({
      title: 'Kosongkan vault?',
      sub: 'Semua tautan di perangkat ini akan dihapus permanen. Ekspor cadangan dulu bila ragu.',
      confirmLabel: 'Ya, hapus semua',
      onConfirm: () => {
        state.items = [];
        cardCache.clear();
        metaSignature = null;
        state.collection = null;
        save();
        closeModal('settings-modal');
        setView('all');
        render();
        toast('Vault dikosongkan.', { icon: 'trash' });
      },
    });
  }

  /* ---------- Event ---------- */

  function bindEvents() {
    $$('[data-view]').forEach((el) => {
      el.addEventListener('click', () => setView(el.dataset.view));
    });

    $$('[data-close]').forEach((el) => {
      el.addEventListener('click', () => closeModal(el.dataset.close));
    });

    $('#add-link').addEventListener('click', () => openEditor());
    $('#fab').addEventListener('click', () => openEditor());
    $('#empty-add').addEventListener('click', () => openEditor());
    $('#empty-sample').addEventListener('click', () => seedSamples());
    $('#sample-btn').addEventListener('click', () => seedSamples());
    $('#clear-btn').addEventListener('click', () => clearAll());
    $('#export-btn').addEventListener('click', () => exportData());
    $('#import-btn').addEventListener('click', () => {
      const native = bridge();
      if (native && typeof native.importBackup === 'function') {
        try {
          native.importBackup();
          return;
        } catch (err) { /* jatuh ke input berkas biasa */ }
      }
      $('#import-file').click();
    });
    $('#import-file').addEventListener('change', (event) => importFile(event.target.files[0]));

    $('#link-form').addEventListener('submit', submitEditor);
    $('#paste-btn').addEventListener('click', pasteFromClipboard);
    $('#f-url').addEventListener('input', () => {
      $('#f-url').classList.remove('is-invalid');
      $('#url-hint').classList.remove('is-error');
      $('#url-hint').innerHTML = 'Alamat akan dilengkapi <code>https://</code> otomatis bila perlu.';
    });

    $('#search').addEventListener('input', (event) => {
      state.query = event.target.value;
      $('#search-clear').hidden = !state.query;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => render({ listOnly: true }), 80);
    });
    $('#search-clear').addEventListener('click', () => {
      clearTimeout(searchTimer);
      state.query = '';
      $('#search').value = '';
      $('#search-clear').hidden = true;
      render({ listOnly: true });
      $('#search').focus();
    });
    $('#sort').addEventListener('change', (event) => {
      state.sort = event.target.value;
      render({ listOnly: true });
    });

    $('#theme-toggle').addEventListener('click', () => {
      applyTheme(resolvedTheme() === 'dark' ? 'light' : 'dark');
    });

    $$('.segmented button').forEach((btn) => {
      btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
    });

    $('#fx-lite').addEventListener('change', (event) => {
      applyFx(event.target.checked);
      toast(
        event.target.checked
          ? 'Mode ringan aktif. Animasi latar dimatikan.'
          : 'Mode ringan nonaktif. Efek kaca penuh aktif kembali.',
        { icon: event.target.checked ? 'sparkles' : 'info' },
      );
    });

    $('#rail-settings').addEventListener('click', () => openModal('settings-modal'));
    $('#tab-settings').addEventListener('click', () => openModal('settings-modal'));

    $('#grid').addEventListener('click', (event) => {
      const card = event.target.closest('.card');
      if (!card) return;
      const id = card.dataset.id;
      const actionBtn = event.target.closest('[data-act]');
      if (actionBtn) {
        event.stopPropagation();
        const item = state.items.find((entry) => entry.id === id);
        if (!item) return;
        const action = actionBtn.dataset.act;
        if (action === 'fav') toggleFavorite(id);
        else if (action === 'open') openLink(item.url);
        else if (action === 'copy') copyItem(item);
        else if (action === 'edit') openEditor(id);
        else if (action === 'delete') deleteItem(id);
        return;
      }
      const item = state.items.find((entry) => entry.id === id);
      if (item) openLink(item.url);
    });

    $('#grid').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const card = event.target.closest('.card');
      if (!card || event.target.closest('button')) return;
      event.preventDefault();
      const item = state.items.find((entry) => entry.id === card.dataset.id);
      if (item) openLink(item.url);
    });

    $('#chips').addEventListener('click', (event) => {
      const chip = event.target.closest('[data-collection]');
      if (chip) filterCollection(chip.dataset.collection);
    });

    $('#rail-collections').addEventListener('click', (event) => {
      const tag = event.target.closest('[data-collection]');
      if (tag) filterCollection(tag.dataset.collection);
    });

    $('#collections-view').addEventListener('click', (event) => {
      const card = event.target.closest('[data-open-collection]');
      if (card) filterCollection(card.dataset.openCollection);
    });

    $('#confirm-cancel').addEventListener('click', () => closeModal('confirm-modal'));
    $('#confirm-ok').addEventListener('click', () => {
      const action = state.confirmAction;
      state.confirmAction = null;
      closeModal('confirm-modal');
      if (typeof action === 'function') action();
    });

    $('#confirm-modal').querySelector('.modal__backdrop').addEventListener('click', () => {
      state.confirmAction = null;
    });

    document.addEventListener('keydown', (event) => {
      const tag = (event.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      const modalOpen = $$('.modal:not([hidden])').length > 0;

      if (event.key === 'Escape') {
        if (!$('#confirm-modal').hidden) { state.confirmAction = null; closeModal('confirm-modal'); return; }
        if (!$('#settings-modal').hidden) { closeModal('settings-modal'); return; }
        if (!$('#link-modal').hidden) { closeModal('link-modal'); return; }
        return;
      }

      if (typing || modalOpen) return;

      if (event.key === '/') {
        event.preventDefault();
        $('#search').focus();
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        openEditor();
      }
    });

    window.addEventListener('hashchange', () => {
      routeFromHash();
      render();
    });

    if (window.matchMedia) {
      const query = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => {
        if (state.settings.theme === 'auto') applyTheme('auto', { persist: false });
      };
      if (typeof query.addEventListener === 'function') query.addEventListener('change', onChange);
      else if (typeof query.addListener === 'function') query.addListener(onChange);
    }

    // Handler tombol back Android (dipanggil dari MainActivity).
    window.__alinkvaultBack = function alinkvaultBack() {
      if (!$('#confirm-modal').hidden) {
        state.confirmAction = null;
        closeModal('confirm-modal');
        return true;
      }
      if (!$('#settings-modal').hidden) { closeModal('settings-modal'); return true; }
      if (!$('#link-modal').hidden) { closeModal('link-modal'); return true; }
      const hash = location.hash.replace(/^#\/?/, '');
      if (hash && hash !== 'semua') {
        location.hash = '#/semua';
        return true;
      }
      return false;
    };

    // Navigasi eksternal dari tautan di dalam aplikasi tetap aman.
    document.addEventListener('click', (event) => {
      const anchor = event.target.closest('a[href]');
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      if (href.startsWith('#') || href.startsWith('./')) return;
      const url = normalizeUrl(href);
      if (url) {
        event.preventDefault();
        openLink(url);
      }
    });
  }

  /* ---------- Inisialisasi ---------- */

  function init() {
    load();
    applyTheme(state.settings.theme, { persist: false });
    applyFx(state.settings.lite, { persist: false });
    routeFromHash();
    bindEvents();
    render();
    $('#app-version').textContent = APP_VERSION;
    $('#sort').value = state.sort;

    try {
      const params = new URLSearchParams(location.search);
      if (params.get('new') === '1') {
        setTimeout(() => openEditor(), 180);
      }
    } catch (err) { /* abaikan */ }

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => { /* offline opsional */ });
      });
    }
  }

  init();
})();
