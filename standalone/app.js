let establecimientos = [];
let productosCache = [];
let mapInstance = null;
let infoWindowInstance = null;
let AdvancedMarkerClass = null;
let PinElementClass = null;
let markersByStoreId = new Map();
let previousInteractionId = null;
let isSendingChat = false;

window.gm_authFailure = () => {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
};

const origConsoleError = console.error;
console.error = (...args) => {
  origConsoleError.apply(console, args);
  const msg = args.map((a) => String(a)).join(' ');
  if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
};

window.addEventListener('gmp-quota-exceeded', () => {
  const banner = document.getElementById('quota-banner');
  if (banner) banner.classList.remove('hidden');
});

async function initApp() {
  bindEvents();
  await loadConfigAndMap();
  await checkHealthAndRefresh();
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg = data?.error || data?.details || `Error HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function showAlertBanner(message) {
  const banner = document.getElementById('alert-banner');
  if (!banner) return;
  if (!message) {
    banner.classList.add('hidden');
    banner.textContent = '';
    return;
  }
  banner.textContent = message;
  banner.classList.remove('hidden');
}

function showToast(message, type = 'ok') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast toast-${type}`;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3500);
}

function updateServicePills({ supabaseOk, mapsOk, geminiOk }) {
  const setPill = (id, label, ok) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = `${label}: ${ok ? 'Activo' : 'Pendiente'}`;
    el.className = `status-pill ${ok ? 'status-ok' : 'status-warn'}`;
  };
  setPill('pill-supabase', 'Supabase', supabaseOk);
  setPill('pill-maps', 'Google Maps', mapsOk);
  setPill('pill-gemini', 'Gemini AI', geminiOk);
}

function loadGoogleMapsBootstrap(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps?.importLibrary) {
      resolve();
      return;
    }
    ((g) => {
      let h, a, k;
      const p = 'The Google Maps JavaScript API';
      const c = 'google';
      const l = 'importLibrary';
      const q = '__ib__';
      const m = document;
      let b = window;
      b = b[c] || (b[c] = {});
      const d = b.maps || (b.maps = {});
      const r = new Set();
      const e = new URLSearchParams();
      const u = () =>
        h ||
        (h = new Promise(async (f, n) => {
          a = m.createElement('script');
          e.set('libraries', [...r] + '');
          for (k in g) {
            e.set(k.replace(/[A-Z]/g, (t) => '_' + t[0].toLowerCase()), g[k]);
          }
          e.set('callback', c + '.maps.' + q);
          a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
          d[q] = f;
          a.onerror = () => {
            h = n(Error(p + ' could not load.'));
          };
          a.nonce = m.querySelector('script[nonce]')?.nonce || '';
          m.head.append(a);
        }));
      if (d[l]) {
        resolve();
      } else {
        d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n));
        u().then(resolve).catch(reject);
      }
    })({
      key: apiKey,
      v: 'weekly',
      language: 'es',
      region: 'PY'
    });
  });
}

async function loadConfigAndMap() {
  try {
    const { googleMapsApiKey, status } = await fetchJson('/api/config');
    updateServicePills({
      supabaseOk: Boolean(status?.supabaseConfigured),
      mapsOk: Boolean(status?.mapsConfigured),
      geminiOk: Boolean(status?.geminiConfigured)
    });

    if (!googleMapsApiKey) {
      document.getElementById('map').innerHTML =
        '<p class="map-placeholder">Configura <strong>GOOGLE_MAPS_API_KEY</strong> en tu archivo <code>.env</code> (o en Render) para visualizar el mapa interactivo de Google Maps.</p>';
      return;
    }

    await loadGoogleMapsBootstrap(googleMapsApiKey);
    const { Map: GoogleMap, InfoWindow } = await google.maps.importLibrary('maps');
    const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary('marker');

    AdvancedMarkerClass = AdvancedMarkerElement;
    PinElementClass = PinElement;

    mapInstance = new GoogleMap(document.getElementById('map'), {
      center: { lat: -25.2867, lng: -57.6 },
      zoom: 12,
      mapId: 'DEMO_MAP_ID',
      mapTypeControl: false,
      streetViewControl: false,
      internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio']
    });
    infoWindowInstance = new InfoWindow();

    mapInstance.addListener('click', (event) => {
      if (!event.latLng) return;
      const lat = event.latLng.lat().toFixed(6);
      const lng = event.latLng.lng().toFixed(6);
      document.getElementById('store-lat').value = lat;
      document.getElementById('store-lng').value = lng;
      showToast(`Coordenadas capturadas del mapa: ${lat}, ${lng}`, 'ok');
    });

    await renderMarkers();
  } catch (err) {
    document.getElementById('map').innerHTML =
      `<p class="map-placeholder">No se pudo cargar la configuración del mapa: ${escapeHtml(err.message)}</p>`;
  }
}

async function checkHealthAndRefresh() {
  try {
    const health = await fetchJson('/api/health');
    updateServicePills({
      supabaseOk: Boolean(health?.services?.supabase?.connected),
      mapsOk: Boolean(health?.services?.googleMaps?.configured),
      geminiOk: Boolean(health?.services?.gemini?.configured)
    });
    if (health?.services?.supabase?.configured && !health?.services?.supabase?.connected) {
      showAlertBanner(`Error de conexión con Supabase: ${health.services.supabase.error || 'Verifica tus tablas y claves.'}`);
      return;
    }
  } catch {
    // Continuar con refreshAll para reportar cualquier error específico
  }
  await refreshAll();
}

async function refreshAll() {
  try {
    establecimientos = await fetchJson('/api/establecimientos');
    showAlertBanner('');
  } catch (err) {
    establecimientos = [];
    showAlertBanner(err.message);
  }

  updateIndicators();
  populateStoreSelects();
  populateCategorySelect();
  await renderMarkers();
  renderStoresAdmin();
  await loadFilteredProducts();
}

function updateIndicators() {
  const allProducts = establecimientos.flatMap((e) => e.productos || []);
  const availableCount = allProducts.filter((p) => p.disponible).length;
  const categoriesCount = new Set(allProducts.map((p) => p.categoria).filter(Boolean)).size;

  document.getElementById('kpi-stores').textContent = establecimientos.length;
  const storesNote = document.getElementById('kpi-stores-note');
  if (establecimientos.length >= 5) {
    storesNote.textContent = 'Cumple mínimo (5+ locales)';
    storesNote.className = 'kpi-note ok';
  } else {
    storesNote.textContent = `Faltan ${5 - establecimientos.length} para el mínimo (5)`;
    storesNote.className = 'kpi-note warn';
  }

  document.getElementById('kpi-products').textContent = allProducts.length;
  document.getElementById('kpi-available').textContent = availableCount;
  document.getElementById('kpi-categories').textContent = categoriesCount;
}

async function renderMarkers() {
  if (!mapInstance || !window.google || !AdvancedMarkerClass || !PinElementClass) return;

  markersByStoreId.forEach((m) => {
    m.map = null;
  });
  markersByStoreId.clear();

  if (!establecimientos.length) return;

  const bounds = new google.maps.LatLngBounds();

  establecimientos.forEach((est) => {
    const lat = Number(est.latitud);
    const lng = Number(est.longitud);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const position = { lat, lng };
    const pin = new PinElementClass({
      background: '#1b6b43',
      borderColor: '#ffffff',
      glyphColor: '#ffffff'
    });

    const marker = new AdvancedMarkerClass({
      position,
      map: mapInstance,
      title: est.nombre,
      content: pin
    });

    marker.addListener('click', () => {
      openStoreOnMap(est, marker);
    });

    markersByStoreId.set(est.id, marker);
    bounds.extend(position);
  });

  if (markersByStoreId.size === 1) {
    const only = establecimientos[0];
    mapInstance.setCenter({ lat: Number(only.latitud), lng: Number(only.longitud) });
    mapInstance.setZoom(14);
  } else if (markersByStoreId.size > 1) {
    mapInstance.fitBounds(bounds);
  }
}

function openStoreOnMap(est, markerOverride = null) {
  showMarkerDetail(est);
  const marker = markerOverride || markersByStoreId.get(est.id);
  if (mapInstance && marker && infoWindowInstance) {
    const disponibles = (est.productos || []).filter((p) => p.disponible).length;
    infoWindowInstance.setContent(`
      <div style="font-family: system-ui, sans-serif; max-width: 240px;">
        <strong style="color:#1b6b43; font-size: 14px;">${escapeHtml(est.nombre)}</strong><br/>
        <span style="font-size: 12px;">${escapeHtml(est.direccion)}</span><br/>
        <span style="font-size: 12px;">Tel: ${escapeHtml(est.contacto)}</span><br/>
        <span style="font-size: 12px; color:#166534;"><strong>${disponibles}</strong> producto(s) disponible(s)</span>
      </div>
    `);
    infoWindowInstance.open({ map: mapInstance, anchor: marker });
    if (marker.position) {
      mapInstance.panTo(marker.position);
    }
  }
}

window.focusStoreOnMap = function (storeId) {
  const est = establecimientos.find((e) => Number(e.id) === Number(storeId));
  if (!est) return;
  openStoreOnMap(est);
  document.getElementById('mapa').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function showMarkerDetail(est) {
  const productos = est.productos || [];
  const categorias = [...new Set(productos.map((p) => p.categoria).filter(Boolean))];

  const prodHtml = productos.length
    ? productos
        .map(
          (p) => `
          <li>
            <strong>${escapeHtml(p.nombre)}</strong> — ${Number(p.precio).toLocaleString('es-PY')} Gs.
            (${escapeHtml(p.categoria)})
            <span class="badge ${p.disponible ? 'badge-ok' : 'badge-no'}">
              ${p.disponible ? 'Disponible' : 'Agotado'}
            </span>
          </li>`
        )
        .join('')
    : '<li>Sin productos registrados en este establecimiento.</li>';

  document.getElementById('marker-detail').innerHTML = `
    <h3>${escapeHtml(est.nombre)}</h3>
    <p><strong>Dirección:</strong> ${escapeHtml(est.direccion)}</p>
    <p><strong>Contacto:</strong> ${escapeHtml(est.contacto)}</p>
    <p><strong>Coordenadas:</strong> ${Number(est.latitud).toFixed(5)}, ${Number(est.longitud).toFixed(5)}</p>
    <p><strong>Categorías:</strong> ${categorias.length ? escapeHtml(categorias.join(', ')) : 'Sin categorías'}</p>
    <p><strong>Productos registrados (${productos.length}):</strong></p>
    <ul>${prodHtml}</ul>
  `;
}

function populateCategorySelect() {
  const catSelect = document.getElementById('filter-category');
  const currentCat = catSelect.value;
  const allCats = new Set();
  establecimientos.forEach((e) => (e.productos || []).forEach((p) => {
    if (p.categoria) allCats.add(p.categoria);
  }));

  catSelect.innerHTML = '<option value="">Todas las categorías</option>';
  [...allCats].sort((a, b) => a.localeCompare(b, 'es')).forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    if (c === currentCat) opt.selected = true;
    catSelect.appendChild(opt);
  });
}

function populateStoreSelects() {
  const filterStore = document.getElementById('filter-store');
  const prodStore = document.getElementById('product-store');
  const prevFilter = filterStore.value;
  const prevProd = prodStore.value;

  filterStore.innerHTML = '<option value="">Todos los establecimientos</option>';
  prodStore.innerHTML = '';

  if (!establecimientos.length) {
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = 'Registra primero un establecimiento';
    prodStore.appendChild(emptyOpt);
    return;
  }

  establecimientos.forEach((e) => {
    const o1 = document.createElement('option');
    o1.value = e.id;
    o1.textContent = e.nombre;
    if (String(e.id) === String(prevFilter)) o1.selected = true;
    filterStore.appendChild(o1);

    const o2 = document.createElement('option');
    o2.value = e.id;
    o2.textContent = e.nombre;
    if (String(e.id) === String(prevProd)) o2.selected = true;
    prodStore.appendChild(o2);
  });
}

async function loadFilteredProducts() {
  const q = document.getElementById('search-input').value.trim();
  const categoria = document.getElementById('filter-category').value;
  const establecimientoId = document.getElementById('filter-store').value;
  const disponible = document.getElementById('filter-availability').value;

  const container = document.getElementById('products-list');
  const countEl = document.getElementById('products-count');

  try {
    const params = new URLSearchParams({ q, categoria, establecimientoId, disponible });
    const productos = await fetchJson(`/api/productos?${params.toString()}`);
    productosCache = productos;

    countEl.textContent = `${productos.length} producto${productos.length === 1 ? '' : 's'}`;

    if (!productos.length) {
      container.innerHTML = '<p class="hint">No se encontraron productos con ese filtro.</p>';
      return;
    }

    container.innerHTML = productos
      .map(
        (p) => `
        <article class="item-card">
          <div>
            <span class="badge ${p.disponible ? 'badge-ok' : 'badge-no'}">
              ${p.disponible ? 'Disponible' : 'Agotado'}
            </span>
            <h3>${escapeHtml(p.nombre)}</h3>
            <p><strong>Categoría:</strong> ${escapeHtml(p.categoria)}</p>
            <p><strong>Precio:</strong> ${Number(p.precio).toLocaleString('es-PY')} Gs.</p>
            <p><strong>Local:</strong> ${escapeHtml(p.establecimiento_nombre)}</p>
          </div>
          <div class="form-actions">
            <button type="button" class="btn-map" onclick="focusStoreOnMap(${p.establecimiento_id})">Mapa</button>
            <button type="button" class="btn-edit" onclick="editProduct(${p.id})">Editar</button>
            <button type="button" class="btn-danger" onclick="deleteProduct(${p.id})">Eliminar</button>
          </div>
        </article>
      `
      )
      .join('');
  } catch (err) {
    countEl.textContent = '0 productos';
    container.innerHTML = `<p class="hint">No se pudieron cargar los productos: ${escapeHtml(err.message)}</p>`;
  }
}

function renderStoresAdmin() {
  const list = document.getElementById('stores-admin-list');
  if (!establecimientos.length) {
    list.innerHTML = '<p class="hint">Aún no hay establecimientos cargados en Supabase.</p>';
    return;
  }

  list.innerHTML = establecimientos
    .map(
      (e) => `
      <div class="admin-row">
        <div class="admin-row-info">
          <strong>${escapeHtml(e.nombre)}</strong><br/>
          <span>${escapeHtml(e.direccion)} • ${escapeHtml(e.contacto)}</span>
        </div>
        <div class="form-actions">
          <button type="button" class="btn-map" onclick="focusStoreOnMap(${e.id})">Mapa</button>
          <button type="button" class="btn-edit" onclick="editStore(${e.id})">Editar</button>
          <button type="button" class="btn-danger" onclick="deleteStore(${e.id})">Eliminar</button>
        </div>
      </div>
    `
    )
    .join('');
}

window.editStore = function (id) {
  const est = establecimientos.find((e) => Number(e.id) === Number(id));
  if (!est) return;
  document.getElementById('store-form-title').textContent = 'Editar Establecimiento';
  document.getElementById('store-id').value = est.id;
  document.getElementById('store-name').value = est.nombre;
  document.getElementById('store-address').value = est.direccion;
  document.getElementById('store-contact').value = est.contacto;
  document.getElementById('store-lat').value = est.latitud;
  document.getElementById('store-lng').value = est.longitud;
  document.getElementById('store-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
};

window.deleteStore = async function (id) {
  if (!confirm('¿Eliminar este establecimiento y todos sus productos asociados?')) return;
  try {
    await fetchJson(`/api/establecimientos/${id}`, { method: 'DELETE' });
    showToast('Establecimiento eliminado correctamente.', 'ok');
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.editProduct = function (id) {
  const prod =
    productosCache.find((p) => Number(p.id) === Number(id)) ||
    establecimientos.flatMap((e) => e.productos || []).find((p) => Number(p.id) === Number(id));
  if (!prod) return;

  document.getElementById('product-form-title').textContent = 'Editar Producto Alimenticio';
  document.getElementById('product-id').value = prod.id;
  document.getElementById('product-store').value = prod.establecimiento_id;
  document.getElementById('product-name').value = prod.nombre;
  document.getElementById('product-category').value = prod.categoria;
  document.getElementById('product-price').value = prod.precio;
  document.getElementById('product-available').checked = Boolean(prod.disponible);
  document.getElementById('product-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
};

window.deleteProduct = async function (id) {
  if (!confirm('¿Eliminar este producto del catálogo?')) return;
  try {
    await fetchJson(`/api/productos/${id}`, { method: 'DELETE' });
    showToast('Producto eliminado correctamente.', 'ok');
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

async function sendChatMessage(texto) {
  if (isSendingChat) return;
  const cleanText = String(texto || '').trim();
  if (!cleanText) return;

  const input = document.getElementById('chat-input');
  const submitBtn = document.getElementById('chat-submit');

  isSendingChat = true;
  submitBtn.disabled = true;
  input.value = '';

  appendChatMessage(cleanText, 'user');
  const loadingMsg = appendChatMessage('Consultando registros en Supabase y generando respuesta...', 'ai');

  try {
    const data = await fetchJson('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mensaje: cleanText,
        previousInteractionId
      })
    });

    if (data.interactionId) {
      previousInteractionId = data.interactionId;
    }
    loadingMsg.innerHTML = formatSimpleMarkdown(data.respuesta || 'No se recibió respuesta.');
  } catch (err) {
    loadingMsg.textContent = `Error del asistente: ${err.message}`;
  } finally {
    isSendingChat = false;
    submitBtn.disabled = false;
    const box = document.getElementById('chat-messages');
    box.scrollTop = box.scrollHeight;
  }
}

function bindEvents() {
  document.getElementById('search-input').addEventListener('input', loadFilteredProducts);
  document.getElementById('filter-category').addEventListener('change', loadFilteredProducts);
  document.getElementById('filter-store').addEventListener('change', loadFilteredProducts);
  document.getElementById('filter-availability').addEventListener('change', loadFilteredProducts);

  document.getElementById('btn-clear-filters').addEventListener('click', () => {
    document.getElementById('search-input').value = '';
    document.getElementById('filter-category').value = '';
    document.getElementById('filter-store').value = '';
    document.getElementById('filter-availability').value = '';
    loadFilteredProducts();
  });

  document.getElementById('store-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('store-id').value;
    const payload = {
      nombre: document.getElementById('store-name').value.trim(),
      direccion: document.getElementById('store-address').value.trim(),
      contacto: document.getElementById('store-contact').value.trim(),
      latitud: document.getElementById('store-lat').value,
      longitud: document.getElementById('store-lng').value
    };

    try {
      if (id) {
        await fetchJson(`/api/establecimientos/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        showToast('Establecimiento actualizado en Supabase.', 'ok');
      } else {
        await fetchJson('/api/establecimientos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        showToast('Establecimiento creado en Supabase.', 'ok');
      }
      resetStoreForm();
      await refreshAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-cancel-store').addEventListener('click', resetStoreForm);

  document.getElementById('product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('product-id').value;
    const payload = {
      establecimiento_id: document.getElementById('product-store').value,
      nombre: document.getElementById('product-name').value.trim(),
      categoria: document.getElementById('product-category').value.trim(),
      precio: document.getElementById('product-price').value,
      disponible: document.getElementById('product-available').checked
    };

    try {
      if (id) {
        await fetchJson(`/api/productos/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        showToast('Producto actualizado en Supabase.', 'ok');
      } else {
        await fetchJson('/api/productos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        showToast('Producto guardado en Supabase.', 'ok');
      }
      resetProductForm();
      await refreshAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-cancel-product').addEventListener('click', resetProductForm);

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      sendChatMessage(chip.dataset.prompt);
    });
  });

  document.getElementById('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    sendChatMessage(document.getElementById('chat-input').value);
  });

  document.getElementById('btn-reset-chat').addEventListener('click', () => {
    previousInteractionId = null;
    const box = document.getElementById('chat-messages');
    box.innerHTML =
      '<div class="msg msg-ai">Conversación reiniciada. ¿Qué deseas consultar sobre las tiendas saludables, precios o recetas?</div>';
  });
}

function resetStoreForm() {
  document.getElementById('store-form-title').textContent = 'Nuevo Establecimiento';
  document.getElementById('store-id').value = '';
  document.getElementById('store-form').reset();
}

function resetProductForm() {
  document.getElementById('product-form-title').textContent = 'Nuevo Producto Alimenticio';
  document.getElementById('product-id').value = '';
  document.getElementById('product-form').reset();
  document.getElementById('product-available').checked = true;
}

function appendChatMessage(text, role) {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `msg msg-${role}`;
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

function formatSimpleMarkdown(text) {
  const safe = escapeHtml(text);
  const withBold = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const lines = withBold.split('\n');
  let html = '';
  let inList = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^[-*•]\s+/.test(line)) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      html += `<li>${line.replace(/^[-*•]\s+/, '')}</li>`;
    } else {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      html += line ? `<p style="margin:0.25rem 0;">${line}</p>` : '';
    }
  }
  if (inList) html += '</ul>';
  return html || safe;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

initApp();
