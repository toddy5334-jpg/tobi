import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useMap,
  useMapsLibrary,
  type MapMouseEvent,
} from '@vis.gl/react-google-maps';
import {
  AlertTriangle,
  Bot,
  Check,
  MapPin,
  Pencil,
  RotateCcw,
  Search,
  Store,
  Trash2,
  Utensils,
} from 'lucide-react';

interface Producto {
  id: number;
  establecimiento_id: number;
  nombre: string;
  categoria: string;
  precio: number;
  disponible: boolean;
  creado_en?: string;
  establecimiento_nombre?: string;
  establecimiento_direccion?: string;
}

interface Establecimiento {
  id: number;
  nombre: string;
  direccion: string;
  contacto: string;
  latitud: number;
  longitud: number;
  creado_en?: string;
  productos?: Producto[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
}

interface ToastState {
  message: string;
  type: 'ok' | 'error';
}

const ASUNCION_CENTER = { lat: -25.2867, lng: -57.6 };

const CATEGORY_SUGGESTIONS = [
  'Integrales',
  'Frutas y Verduras',
  'Semillas y Frutos Secos',
  'Endulzantes Naturales',
  'Bebidas Saludables',
  'Legumbres',
  'Proteínas',
  'Lácteos y Fermentados',
];

const QUICK_PROMPTS = [
  {
    label: '¿Qué recetas puedo preparar con avena y banana?',
    prompt: '¿Qué recetas puedo preparar con avena y banana?',
  },
  {
    label: '¿Qué tiendas registradas venden productos integrales?',
    prompt: '¿Qué tiendas registradas venden productos integrales?',
  },
  {
    label: '¿Qué desayuno puedo preparar con los ingredientes disponibles?',
    prompt: '¿Qué desayuno puedo preparar con los ingredientes disponibles?',
  },
  {
    label: 'Precios y disponibilidad actual',
    prompt: '¿Qué productos están disponibles y cuáles son sus precios?',
  },
];

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  let data: unknown = null;
  let parseFailed = false;
  try {
    data = await res.json();
  } catch {
    data = null;
    parseFailed = true;
  }
  if (!res.ok) {
    const errObj = data as { error?: string; details?: string } | null;
    const msg = errObj?.error || errObj?.details || `Error HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (parseFailed || data === null) {
    throw new Error('Respuesta inválida del servidor.');
  }
  return data as T;
}

function renderBoldSegments(line: string): React.ReactNode[] {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function FormattedMessage({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: Array<
    { type: 'list'; items: string[] } | { type: 'para'; text: string }
  > = [];
  let currentList: string[] | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^[-*•]\s+/.test(line)) {
      const item = line.replace(/^[-*•]\s+/, '');
      if (!currentList) {
        currentList = [item];
        blocks.push({ type: 'list', items: currentList });
      } else {
        currentList.push(item);
      }
    } else {
      currentList = null;
      if (line) {
        blocks.push({ type: 'para', text: line });
      }
    }
  }

  if (!blocks.length) {
    return <span>{text}</span>;
  }

  return (
    <div className="space-y-1.5">
      {blocks.map((block, idx) =>
        block.type === 'list' ? (
          <ul key={idx} className="list-disc pl-5 space-y-1 my-1">
            {block.items.map((item, i) => (
              <li key={i}>{renderBoldSegments(item)}</li>
            ))}
          </ul>
        ) : (
          <p key={idx} className="leading-relaxed">
            {renderBoldSegments(block.text)}
          </p>
        )
      )}
    </div>
  );
}

function MapViewportController({
  establecimientos,
  focusStore,
}: {
  establecimientos: Establecimiento[];
  focusStore: Establecimiento | null;
}) {
  const map = useMap();
  const coreLib = useMapsLibrary('core');

  useEffect(() => {
    if (!map || !coreLib || !establecimientos.length) return;
    const valid = establecimientos.filter(
      (e) => Number.isFinite(Number(e.latitud)) && Number.isFinite(Number(e.longitud))
    );
    if (!valid.length) return;

    if (valid.length === 1) {
      map.setCenter({
        lat: Number(valid[0].latitud),
        lng: Number(valid[0].longitud),
      });
      map.setZoom(14);
      return;
    }

    const bounds = new coreLib.LatLngBounds();
    valid.forEach((e) => {
      bounds.extend({ lat: Number(e.latitud), lng: Number(e.longitud) });
    });
    map.fitBounds(bounds);
  }, [map, coreLib, establecimientos]);

  useEffect(() => {
    if (!map || !focusStore) return;
    const lat = Number(focusStore.latitud);
    const lng = Number(focusStore.longitud);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      map.panTo({ lat, lng });
      const currentZoom = map.getZoom();
      if (!currentZoom || currentZoom < 14) {
        map.setZoom(14);
      }
    }
  }, [map, focusStore]);

  return null;
}

function StoreAdvancedMarker({
  store,
  isSelected,
  onSelect,
  onCloseInfo,
}: {
  store: Establecimiento;
  isSelected: boolean;
  onSelect: (store: Establecimiento) => void;
  onCloseInfo: () => void;
}) {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const lat = Number(store.latitud);
  const lng = Number(store.longitud);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const disponibles = (store.productos || []).filter((p) => p.disponible).length;

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat, lng }}
        title={store.nombre}
        onClick={() => onSelect(store)}
      >
        <Pin
          background={isSelected ? '#145333' : '#1b6b43'}
          borderColor="#ffffff"
          glyphColor="#ffffff"
          scale={isSelected ? 1.2 : 1.0}
        />
      </AdvancedMarker>
      {isSelected && marker && (
        <InfoWindow
          anchor={marker}
          maxWidth={260}
          onCloseClick={onCloseInfo}
        >
          <div className="text-slate-800 space-y-1 p-0.5">
            <strong className="block text-sm text-[#1b6b43]">
              {store.nombre}
            </strong>
            <span className="block text-xs text-slate-600">
              {store.direccion}
            </span>
            <span className="block text-xs text-slate-600">
              Tel: {store.contacto}
            </span>
            <span className="block text-xs font-semibold text-emerald-800">
              {disponibles} producto(s) disponible(s)
            </span>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

export default function App() {
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    () => (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim()
  );
  const [mapsConfigured, setMapsConfigured] = useState<boolean>(
    () => Boolean((import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim())
  );
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  const [establecimientos, setEstablecimientos] = useState<Establecimiento[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [alertBanner, setAlertBanner] = useState<string>('');
  const [toast, setToast] = useState<ToastState | null>(null);

  const [selectedStore, setSelectedStore] = useState<Establecimiento | null>(null);
  const [infoWindowOpen, setInfoWindowOpen] = useState(false);

  // Filtros catálogo
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStoreId, setFilterStoreId] = useState('');
  const [filterAvailability, setFilterAvailability] = useState('');

  // Formulario establecimiento
  const [storeId, setStoreId] = useState('');
  const [storeName, setStoreName] = useState('');
  const [storeAddress, setStoreAddress] = useState('');
  const [storeContact, setStoreContact] = useState('');
  const [storeLat, setStoreLat] = useState('');
  const [storeLng, setStoreLng] = useState('');
  const [confirmDeleteStoreId, setConfirmDeleteStoreId] = useState<number | null>(null);

  // Formulario producto
  const [productId, setProductId] = useState('');
  const [productStoreId, setProductStoreId] = useState('');
  const [productName, setProductName] = useState('');
  const [productCategory, setProductCategory] = useState('');
  const [productPrice, setProductPrice] = useState('');
  const [productAvailable, setProductAvailable] = useState(true);
  const [confirmDeleteProductId, setConfirmDeleteProductId] = useState<number | null>(null);

  // Chat Gemini
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'ai',
      text: '¡Hola! Soy NutriMap AI. Puedo ayudarte a consultar tiendas registradas, productos disponibles, precios en guaraníes y sugerir recetas saludables con el stock real del sistema. ¿En qué te ayudo hoy?',
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [previousInteractionId, setPreviousInteractionId] = useState<string | null>(null);

  const mapSectionRef = useRef<HTMLElement>(null);
  const storeFormRef = useRef<HTMLFormElement>(null);
  const productFormRef = useRef<HTMLFormElement>(null);
  const chatBoxRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: 'ok' | 'error' = 'ok') => {
    setToast({ message, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
    }, 3500);
  }, []);

  useEffect(() => {
    const onQuota = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  const loadFilteredProducts = useCallback(
    async (qVal: string, catVal: string, storeVal: string, availVal: string) => {
      try {
        const params = new URLSearchParams({
          q: qVal.trim(),
          categoria: catVal,
          establecimientoId: storeVal,
          disponible: availVal,
        });
        const rows = await fetchJson<Producto[]>(
          `/api/productos?${params.toString()}`
        );
        setProductos(Array.isArray(rows) ? rows : []);
      } catch {
        setProductos([]);
      }
    },
    []
  );

  const refreshAll = useCallback(async () => {
    try {
      const ests = await fetchJson<Establecimiento[]>('/api/establecimientos');
      const safeEsts = Array.isArray(ests) ? ests : [];
      setEstablecimientos(safeEsts);
      setAlertBanner('');
      if (safeEsts.length > 0) {
        setProductStoreId((prev) => prev || String(safeEsts[0].id));
      }
      setSelectedStore((prev) => {
        if (!prev) return null;
        return safeEsts.find((e) => e.id === prev.id) || null;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al cargar datos';
      setEstablecimientos([]);
      setAlertBanner(msg);
    }
    await loadFilteredProducts(
      searchQuery,
      filterCategory,
      filterStoreId,
      filterAvailability
    );
  }, [
    filterAvailability,
    filterCategory,
    filterStoreId,
    loadFilteredProducts,
    searchQuery,
  ]);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await fetchJson<{
          googleMapsApiKey: string;
          status?: {
            supabaseConfigured?: boolean;
            mapsConfigured?: boolean;
            geminiConfigured?: boolean;
          };
        }>('/api/config');
        if (cfg.googleMapsApiKey) {
          setMapsApiKey(cfg.googleMapsApiKey);
          setMapsConfigured(true);
        }
      } catch {
        // Fallback to VITE_GOOGLE_MAPS_API_KEY if present
      }

      try {
        const health = await fetchJson<{
          services?: {
            supabase?: {
              configured?: boolean;
              connected?: boolean;
              error?: string | null;
            };
          };
        }>('/api/health');
        if (
          health?.services?.supabase?.configured &&
          !health?.services?.supabase?.connected
        ) {
          setAlertBanner(
            `Error de conexión con Supabase: ${health.services.supabase.error || 'Verifica tus tablas y claves.'}`
          );
          return;
        }
      } catch {
        // Continue to refreshAll
      }
      await refreshAll();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadFilteredProducts(
      searchQuery,
      filterCategory,
      filterStoreId,
      filterAvailability
    );
  }, [
    searchQuery,
    filterCategory,
    filterStoreId,
    filterAvailability,
    loadFilteredProducts,
  ]);

  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const kpis = useMemo(() => {
    const allProducts = establecimientos.flatMap((e) => e.productos || []);
    const availableCount = allProducts.filter((p) => p.disponible).length;
    const categories = new Set(
      allProducts.map((p) => p.categoria).filter(Boolean)
    );
    return {
      storesCount: establecimientos.length,
      productsCount: allProducts.length,
      availableCount,
      categoriesCount: categories.size,
      categoryOptions: [...categories].sort((a, b) => a.localeCompare(b, 'es')),
    };
  }, [establecimientos]);

  const handleMapClick = useCallback(
    (ev: MapMouseEvent) => {
      const latLng = ev.detail?.latLng;
      if (!latLng) return;
      const lat = latLng.lat.toFixed(6);
      const lng = latLng.lng.toFixed(6);
      setStoreLat(lat);
      setStoreLng(lng);
      showToast(`Coordenadas capturadas del mapa: ${lat}, ${lng}`, 'ok');
    },
    [showToast]
  );

  const handleSelectStore = useCallback((store: Establecimiento) => {
    setSelectedStore(store);
    setInfoWindowOpen(true);
  }, []);

  const focusStoreOnMap = useCallback((targetStoreId: number) => {
    const est = establecimientos.find((e) => Number(e.id) === Number(targetStoreId));
    if (!est) return;
    setSelectedStore(est);
    setInfoWindowOpen(true);
    mapSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [establecimientos]);

  const resetStoreForm = () => {
    setStoreId('');
    setStoreName('');
    setStoreAddress('');
    setStoreContact('');
    setStoreLat('');
    setStoreLng('');
  };

  const handleStoreSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      nombre: storeName.trim(),
      direccion: storeAddress.trim(),
      contacto: storeContact.trim(),
      latitud: storeLat,
      longitud: storeLng,
    };

    try {
      if (storeId) {
        await fetchJson(`/api/establecimientos/${storeId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        showToast('Establecimiento actualizado en Supabase.', 'ok');
      } else {
        await fetchJson('/api/establecimientos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        showToast('Establecimiento creado en Supabase.', 'ok');
      }
      resetStoreForm();
      await refreshAll();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Error al guardar establecimiento',
        'error'
      );
    }
  };

  const handleEditStore = (est: Establecimiento) => {
    setStoreId(String(est.id));
    setStoreName(est.nombre);
    setStoreAddress(est.direccion);
    setStoreContact(est.contacto);
    setStoreLat(String(est.latitud));
    setStoreLng(String(est.longitud));
    storeFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleDeleteStore = async (id: number) => {
    try {
      await fetchJson(`/api/establecimientos/${id}`, { method: 'DELETE' });
      setConfirmDeleteStoreId(null);
      if (storeId === String(id)) {
        resetStoreForm();
      }
      showToast('Establecimiento eliminado correctamente.', 'ok');
      await refreshAll();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Error al eliminar establecimiento',
        'error'
      );
    }
  };

  const resetProductForm = () => {
    setProductId('');
    setProductName('');
    setProductCategory('');
    setProductPrice('');
    setProductAvailable(true);
    if (establecimientos.length > 0) {
      setProductStoreId(String(establecimientos[0].id));
    }
  };

  const handleProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      establecimiento_id: productStoreId,
      nombre: productName.trim(),
      categoria: productCategory.trim(),
      precio: productPrice,
      disponible: productAvailable,
    };

    try {
      if (productId) {
        await fetchJson(`/api/productos/${productId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        showToast('Producto actualizado en Supabase.', 'ok');
      } else {
        await fetchJson('/api/productos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        showToast('Producto guardado en Supabase.', 'ok');
      }
      resetProductForm();
      await refreshAll();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Error al guardar producto',
        'error'
      );
    }
  };

  const handleEditProduct = (prod: Producto) => {
    setProductId(String(prod.id));
    setProductStoreId(String(prod.establecimiento_id));
    setProductName(prod.nombre);
    setProductCategory(prod.categoria);
    setProductPrice(String(prod.precio));
    setProductAvailable(Boolean(prod.disponible));
    productFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleDeleteProduct = async (id: number) => {
    try {
      await fetchJson(`/api/productos/${id}`, { method: 'DELETE' });
      setConfirmDeleteProductId(null);
      if (productId === String(id)) {
        resetProductForm();
      }
      showToast('Producto eliminado correctamente.', 'ok');
      await refreshAll();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Error al eliminar producto',
        'error'
      );
    }
  };

  const sendChatMessage = async (texto: string) => {
    if (isSendingChat) return;
    const cleanText = texto.trim();
    if (!cleanText) return;

    const userMsgId = `u-${Date.now()}`;
    const aiMsgId = `a-${Date.now()}`;

    setIsSendingChat(true);
    setChatInput('');
    setChatMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', text: cleanText },
      {
        id: aiMsgId,
        role: 'ai',
        text: 'Consultando registros en Supabase y generando respuesta...',
      },
    ]);

    try {
      const data = await fetchJson<{
        respuesta: string;
        interactionId?: string | null;
      }>('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensaje: cleanText,
          previousInteractionId,
        }),
      });

      if (data.interactionId) {
        setPreviousInteractionId(data.interactionId);
      }

      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId
            ? {
                ...m,
                text: data.respuesta || 'No se recibió respuesta.',
              }
            : m
        )
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error del asistente';
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId ? { ...m, text: `Error del asistente: ${msg}` } : m
        )
      );
    } finally {
      setIsSendingChat(false);
    }
  };

  const resetChat = () => {
    setPreviousInteractionId(null);
    setChatMessages([
      {
        id: `reset-${Date.now()}`,
        role: 'ai',
        text: 'Conversación reiniciada. ¿Qué deseas consultar sobre las tiendas saludables, precios o recetas?',
      },
    ]);
  };

  const selectedStoreCategorias = useMemo(() => {
    if (!selectedStore) return [];
    return [
      ...new Set(
        (selectedStore.productos || [])
          .map((p) => p.categoria)
          .filter(Boolean)
      ),
    ];
  }, [selectedStore]);

  return (
    <div className="min-h-screen flex flex-col bg-[#f3f7f4] text-[#1c2420]">
      {quotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* Topbar */}
      <header className="bg-gradient-to-br from-[#165937] to-[#1f7a4d] text-white px-5 py-4 shadow-md">
        <div className="max-w-[1180px] mx-auto flex flex-wrap justify-between items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">NutriMap AI</h1>
            <p className="text-sm text-white/90">
              Tiendas de alimentación saludable, catálogo en Supabase, Google Maps y asistente Gemini
            </p>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="Navegación rápida">
            <a
              href="#mapa"
              className="bg-white/15 hover:bg-white/25 transition px-3 py-1.5 rounded-full text-sm font-semibold"
            >
              Mapa
            </a>
            <a
              href="#catalogo"
              className="bg-white/15 hover:bg-white/25 transition px-3 py-1.5 rounded-full text-sm font-semibold"
            >
              Catálogo
            </a>
            <a
              href="#gestion"
              className="bg-white/15 hover:bg-white/25 transition px-3 py-1.5 rounded-full text-sm font-semibold"
            >
              Gestión CRUD
            </a>
            <a
              href="#asistente"
              className="bg-white/15 hover:bg-white/25 transition px-3 py-1.5 rounded-full text-sm font-semibold"
            >
              Asistente AI
            </a>
          </nav>
        </div>
      </header>

      <main className="max-w-[1180px] w-full mx-auto px-4 py-5 flex-1 flex flex-col gap-5">
        {/* Indicadores KPI */}
        <section aria-label="Indicadores del sistema">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            <article className="bg-white border border-[#d7e2dc] rounded-xl p-4 shadow-xs flex flex-col gap-1">
              <span className="text-xs font-semibold text-[#55645c]">
                Establecimientos
              </span>
              <strong className="text-2xl font-bold text-[#1b6b43]">
                {kpis.storesCount}
              </strong>
              <small
                className={`text-xs font-semibold ${
                  kpis.storesCount >= 5 ? 'text-[#166534]' : 'text-[#92400e]'
                }`}
              >
                {kpis.storesCount >= 5
                  ? 'Cumple mínimo (5+ locales)'
                  : `Faltan ${5 - kpis.storesCount} para el mínimo (5)`}
              </small>
            </article>
            <article className="bg-white border border-[#d7e2dc] rounded-xl p-4 shadow-xs flex flex-col gap-1">
              <span className="text-xs font-semibold text-[#55645c]">
                Productos
              </span>
              <strong className="text-2xl font-bold text-[#1b6b43]">
                {kpis.productsCount}
              </strong>
              <small className="text-xs text-[#55645c]">Total registrados</small>
            </article>
            <article className="bg-white border border-[#d7e2dc] rounded-xl p-4 shadow-xs flex flex-col gap-1">
              <span className="text-xs font-semibold text-[#55645c]">
                Disponibles
              </span>
              <strong className="text-2xl font-bold text-[#1b6b43]">
                {kpis.availableCount}
              </strong>
              <small className="text-xs text-[#55645c]">Con stock activo</small>
            </article>
            <article className="bg-white border border-[#d7e2dc] rounded-xl p-4 shadow-xs flex flex-col gap-1">
              <span className="text-xs font-semibold text-[#55645c]">
                Categorías
              </span>
              <strong className="text-2xl font-bold text-[#1b6b43]">
                {kpis.categoriesCount}
              </strong>
              <small className="text-xs text-[#55645c]">Tipos de alimento</small>
            </article>
          </div>
        </section>

        {alertBanner && (
          <div
            role="alert"
            className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm"
          >
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{alertBanner}</span>
          </div>
        )}

        {/* Mapa Interactivo */}
        <section
          id="mapa"
          ref={mapSectionRef}
          className="bg-white border border-[#d7e2dc] rounded-xl p-5 shadow-xs"
        >
          <div className="flex flex-wrap justify-between items-baseline gap-2 mb-3">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <MapPin className="w-5 h-5 text-[#1b6b43]" />
              Mapa de Establecimientos (Google Maps)
            </h2>
            <span className="text-xs text-[#55645c]">
              Haz clic en un marcador para ver información, o en el mapa para copiar coordenadas al formulario.
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 h-[400px] rounded-xl overflow-hidden border border-[#d7e2dc] bg-[#e5ece8]">
              {mapsConfigured && mapsApiKey ? (
                <APIProvider
                  apiKey={mapsApiKey}
                  libraries={['marker']}
                  language="es"
                  region="PY"
                >
                  <GoogleMap
                    mapId="DEMO_MAP_ID"
                    defaultCenter={ASUNCION_CENTER}
                    defaultZoom={12}
                    mapTypeControl={false}
                    streetViewControl={false}
                    gestureHandling="greedy"
                    internalUsageAttributionIds={[
                      'gmp_mcp_codeassist_v1_aistudio',
                    ]}
                    onClick={handleMapClick}
                    style={{ width: '100%', height: '100%' }}
                  >
                    <MapViewportController
                      establecimientos={establecimientos}
                      focusStore={selectedStore}
                    />
                    {establecimientos.map((est) => (
                      <StoreAdvancedMarker
                        key={est.id}
                        store={est}
                        isSelected={
                          infoWindowOpen && selectedStore?.id === est.id
                        }
                        onSelect={handleSelectStore}
                        onCloseInfo={() => setInfoWindowOpen(false)}
                      />
                    ))}
                  </GoogleMap>
                </APIProvider>
              ) : (
                <div className="h-full flex items-center justify-center p-6 text-center text-sm text-[#55645c]">
                  <p>
                    Configura la clave de Google Maps para visualizar el mapa interactivo de establecimientos.
                  </p>
                </div>
              )}
            </div>

            <aside className="border border-[#d7e2dc] rounded-xl p-4 bg-[#fafcfb] max-h-[400px] overflow-y-auto">
              {selectedStore ? (
                <div className="space-y-2 text-sm">
                  <h3 className="text-base font-bold text-[#1b6b43]">
                    {selectedStore.nombre}
                  </h3>
                  <p>
                    <strong>Dirección:</strong> {selectedStore.direccion}
                  </p>
                  <p>
                    <strong>Contacto:</strong> {selectedStore.contacto}
                  </p>
                  <p>
                    <strong>Coordenadas:</strong>{' '}
                    {Number(selectedStore.latitud).toFixed(5)},{' '}
                    {Number(selectedStore.longitud).toFixed(5)}
                  </p>
                  <p>
                    <strong>Categorías:</strong>{' '}
                    {selectedStoreCategorias.length
                      ? selectedStoreCategorias.join(', ')
                      : 'Sin categorías'}
                  </p>
                  <div>
                    <strong className="block mb-1">
                      Productos registrados ({(selectedStore.productos || []).length}):
                    </strong>
                    {(selectedStore.productos || []).length > 0 ? (
                      <ul className="list-disc pl-5 space-y-1.5">
                        {(selectedStore.productos || []).map((p) => (
                          <li key={p.id}>
                            <strong>{p.nombre}</strong> —{' '}
                            {Number(p.precio).toLocaleString('es-PY')} Gs. (
                            {p.categoria}){' '}
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                p.disponible
                                  ? 'bg-[#dcfce7] text-[#166534]'
                                  : 'bg-[#fee2e2] text-[#991b1b]'
                              }`}
                            >
                              {p.disponible ? 'Disponible' : 'Agotado'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[#55645c]">
                        Sin productos registrados en este establecimiento.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-2 text-sm">
                  <h3 className="text-base font-bold text-[#1b6b43]">
                    Selecciona un marcador
                  </h3>
                  <p className="text-[#55645c]">
                    Haz clic en cualquier pin del mapa para ver su dirección, contacto, categorías y productos disponibles.
                  </p>
                </div>
              )}
            </aside>
          </div>
        </section>

        {/* Catálogo */}
        <section
          id="catalogo"
          className="bg-white border border-[#d7e2dc] rounded-xl p-5 shadow-xs"
        >
          <div className="flex flex-wrap justify-between items-baseline gap-2 mb-3">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Utensils className="w-5 h-5 text-[#1b6b43]" />
              Catálogo de Productos y Establecimientos
            </h2>
            <span className="text-xs font-semibold text-[#55645c]">
              {productos.length} producto{productos.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="flex flex-wrap gap-2.5 mb-4">
            <div className="relative flex-[1_1_220px]">
              <Search className="w-4 h-4 text-[#55645c] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar producto, categoría o tienda (ej. avena, integral)..."
                className="w-full pl-9 pr-3 py-2 border border-[#d7e2dc] rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1b6b43]/30"
              />
            </div>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              aria-label="Filtrar por categoría"
              className="flex-[1_1_160px] px-3 py-2 border border-[#d7e2dc] rounded-lg text-sm bg-white"
            >
              <option value="">Todas las categorías</option>
              {kpis.categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={filterStoreId}
              onChange={(e) => setFilterStoreId(e.target.value)}
              aria-label="Filtrar por establecimiento"
              className="flex-[1_1_180px] px-3 py-2 border border-[#d7e2dc] rounded-lg text-sm bg-white"
            >
              <option value="">Todos los establecimientos</option>
              {establecimientos.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
            <select
              value={filterAvailability}
              onChange={(e) => setFilterAvailability(e.target.value)}
              aria-label="Filtrar por disponibilidad"
              className="flex-[1_1_150px] px-3 py-2 border border-[#d7e2dc] rounded-lg text-sm bg-white"
            >
              <option value="">Toda disponibilidad</option>
              <option value="true">Solo disponibles</option>
              <option value="false">Solo agotados</option>
            </select>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setFilterCategory('');
                setFilterStoreId('');
                setFilterAvailability('');
              }}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#e6ece9] hover:bg-[#d6e0db] transition cursor-pointer"
            >
              Limpiar
            </button>
          </div>

          {productos.length === 0 ? (
            <p className="text-sm text-[#55645c]">
              No se encontraron productos con ese filtro.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
              {productos.map((p) => (
                <article
                  key={p.id}
                  className="border border-[#d7e2dc] rounded-xl p-4 bg-white hover:shadow-md transition flex flex-col justify-between gap-3"
                >
                  <div>
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        p.disponible
                          ? 'bg-[#dcfce7] text-[#166534]'
                          : 'bg-[#fee2e2] text-[#991b1b]'
                      }`}
                    >
                      {p.disponible ? 'Disponible' : 'Agotado'}
                    </span>
                    <h3 className="text-base font-bold mt-2 mb-1">{p.nombre}</h3>
                    <p className="text-sm text-[#2f3b35]">
                      <strong>Categoría:</strong> {p.categoria}
                    </p>
                    <p className="text-sm text-[#2f3b35]">
                      <strong>Precio:</strong>{' '}
                      {Number(p.precio).toLocaleString('es-PY')} Gs.
                    </p>
                    <p className="text-sm text-[#2f3b35]">
                      <strong>Local:</strong> {p.establecimiento_nombre}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => focusStoreOnMap(p.establecimiento_id)}
                      className="px-2.5 py-1 rounded-md text-xs font-semibold bg-[#eaf4ee] text-[#1b6b43] hover:bg-[#d6eadf] cursor-pointer"
                    >
                      Mapa
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEditProduct(p)}
                      className="px-2.5 py-1 rounded-md text-xs font-semibold bg-[#0284c7] text-white hover:bg-[#0369a1] cursor-pointer inline-flex items-center gap-1"
                    >
                      <Pencil className="w-3 h-3" /> Editar
                    </button>
                    {confirmDeleteProductId === p.id ? (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => handleDeleteProduct(p.id)}
                          className="px-2 py-1 rounded-md text-xs font-semibold bg-[#dc2626] text-white hover:bg-[#b91c1c] cursor-pointer inline-flex items-center gap-1"
                        >
                          <Check className="w-3 h-3" /> Confirmar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteProductId(null)}
                          className="px-2 py-1 rounded-md text-xs font-semibold bg-[#e6ece9] text-[#1c2420] cursor-pointer"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteProductId(p.id)}
                        className="px-2.5 py-1 rounded-md text-xs font-semibold bg-[#dc2626] text-white hover:bg-[#b91c1c] cursor-pointer inline-flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" /> Eliminar
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* Gestión CRUD */}
        <section id="gestion" className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Establecimientos */}
          <div className="bg-white border border-[#d7e2dc] rounded-xl p-5 shadow-xs">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Store className="w-5 h-5 text-[#1b6b43]" />
              {storeId ? 'Editar Establecimiento' : 'Nuevo Establecimiento'}
            </h2>
            <p className="text-xs text-[#55645c] mt-1 mb-3">
              Registra o edita tiendas saludables. Tip: haz clic en cualquier punto del mapa para llenar latitud y longitud.
            </p>

            <form
              ref={storeFormRef}
              onSubmit={handleStoreSubmit}
              className="flex flex-col gap-2"
            >
              <label className="text-xs font-semibold text-[#55645c]" htmlFor="store-name">
                Nombre del establecimiento
              </label>
              <input
                id="store-name"
                type="text"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder="Ej. Verde & Vital Asunción"
                required
                className="px-3 py-2 border border-[#d7e2dc] rounded-lg text-sm bg-white"
              />

              <label className="text-xs font-semibold text-[#55645c]" htmlFor="store-address">
                Dirección
              </label>
              <input
                id="store-address"
                type="text"
                value={storeAddress}
                onChange={(e) => setStoreAddress(e.target.value)}
                placeholder="Ej. Av. Mariscal López 1450, Asunción"
                required
                className="px-3 py-2 border border-[#d7e2dc] rounded-lg text-sm bg-white"
              />

              <label className="text-xs font-semibold text-[#55645c]" htmlFor="store-contact">
                Teléfono o contacto
              </label>
              <input
                id="store-contact"
                type="text"
                value={storeContact}
                onChange={(e) => setStoreContact(e.target.value)}
                placeholder="Ej. +595 21 600 101"
                required
                className="px-3 py-2 border border-[#d7e2dc] rounded-lg text-sm bg-white"
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-[#55645c] mb-1" htmlFor="store-lat">
                    Latitud
                  </label>
                  <input
                    id="store-lat"
                    type="number"
                    step="any"
                    value={storeLat}
                    onChange={(e) => setStoreLat(e.target.value)}
                    placeholder="-25.29184"
                    required
                    className="w-full px-3 py-2 border border-[#d7e2dc] rounded-lg text-sm bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#55645c] mb-1" htmlFor="store-lng">
                    Longitud
                  </label>
                  <input
                    id="store-lng"
                    type="number"
                    step="any"
                    value={storeLng}
                    onChange={(e) => setStoreLng(e.target.value)}
                    placeholder="-57.59821"
                    required
                    className="w-full px-3 py-2 border border-[#d7e2dc] rounded-lg text-sm bg-white"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#1b6b43] hover:bg-[#145333] text-white transition cursor-pointer"
                >
                  Guardar Establecimiento
                </button>
                <button
                  type="button"
                  onClick={resetStoreForm}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#e6ece9] hover:bg-[#d6e0db] transition cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </form>

            <h3 className="text-sm font-bold mt-5 mb-2">
              Establecimientos Registrados
            </h3>
            <div className="flex flex-col gap-2 max-h-[290px] overflow-y-auto">
              {establecimientos.length === 0 ? (
                <p className="text-sm text-[#55645c]">
                  Aún no hay establecimientos cargados en Supabase.
                </p>
              ) : (
                establecimientos.map((e) => (
                  <div
                    key={e.id}
                    className="flex flex-wrap justify-between items-center gap-2 p-2.5 border border-[#d7e2dc] rounded-lg text-sm"
                  >
                    <div className="min-w-[180px] flex-1">
                      <strong className="block">{e.nombre}</strong>
                      <span className="text-xs text-[#55645c]">
                        {e.direccion} • {e.contacto}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => focusStoreOnMap(e.id)}
                        className="px-2.5 py-1 rounded-md text-xs font-semibold bg-[#eaf4ee] text-[#1b6b43] hover:bg-[#d6eadf] cursor-pointer"
                      >
                        Mapa
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEditStore(e)}
                        className="px-2.5 py-1 rounded-md text-xs font-semibold bg-[#0284c7] text-white hover:bg-[#0369a1] cursor-pointer"
                      >
                        Editar
                      </button>
                      {confirmDeleteStoreId === e.id ? (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => handleDeleteStore(e.id)}
                            className="px-2 py-1 rounded-md text-xs font-semibold bg-[#dc2626] text-white hover:bg-[#b91c1c] cursor-pointer"
                          >
                            Confirmar
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteStoreId(null)}
                            className="px-2 py-1 rounded-md text-xs font-semibold bg-[#e6ece9] text-[#1c2420] cursor-pointer"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteStoreId(e.id)}
                          className="px-2.5 py-1 rounded-md text-xs font-semibold bg-[#dc2626] text-white hover:bg-[#b91c1c] cursor-pointer"
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Productos */}
          <div className="bg-white border border-[#d7e2dc] rounded-xl p-5 shadow-xs">
            <h2 className="text-lg font-bold">
              {productId
                ? 'Editar Producto Alimenticio'
                : 'Nuevo Producto Alimenticio'}
            </h2>
            <p className="text-xs text-[#55645c] mt-1 mb-3">
              Asocia alimentos saludables a un establecimiento, indica su categoría, precio en Gs. y disponibilidad.
            </p>

            <form
              ref={productFormRef}
              onSubmit={handleProductSubmit}
              className="flex flex-col gap-2"
            >
              <label className="text-xs font-semibold text-[#55645c]" htmlFor="product-store">
                Establecimiento
              </label>
              <select
                id="product-store"
                value={productStoreId}
                onChange={(e) => setProductStoreId(e.target.value)}
                required
                className="px-3 py-2 border border-[#d7e2dc] rounded-lg text-sm bg-white"
              >
                {establecimientos.length === 0 ? (
                  <option value="">Registra primero un establecimiento</option>
                ) : (
                  establecimientos.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nombre}
                    </option>
                  ))
                )}
              </select>

              <label className="text-xs font-semibold text-[#55645c]" htmlFor="product-name">
                Nombre del producto
              </label>
              <input
                id="product-name"
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="Ej. Avena tradicional arrollada 500g"
                required
                className="px-3 py-2 border border-[#d7e2dc] rounded-lg text-sm bg-white"
              />

              <label className="text-xs font-semibold text-[#55645c]" htmlFor="product-category">
                Categoría / Tipo de alimento
              </label>
              <input
                id="product-category"
                type="text"
                list="category-suggestions"
                value={productCategory}
                onChange={(e) => setProductCategory(e.target.value)}
                placeholder="Ej. Integrales"
                required
                className="px-3 py-2 border border-[#d7e2dc] rounded-lg text-sm bg-white"
              />
              <datalist id="category-suggestions">
                {CATEGORY_SUGGESTIONS.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>

              <label className="text-xs font-semibold text-[#55645c]" htmlFor="product-price">
                Precio (Gs.)
              </label>
              <input
                id="product-price"
                type="number"
                step="1"
                min="0"
                value={productPrice}
                onChange={(e) => setProductPrice(e.target.value)}
                placeholder="Ej. 18000"
                required
                className="px-3 py-2 border border-[#d7e2dc] rounded-lg text-sm bg-white"
              />

              <label className="inline-flex items-center gap-2 text-sm font-semibold my-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={productAvailable}
                  onChange={(e) => setProductAvailable(e.target.checked)}
                  className="w-4 h-4 accent-[#1b6b43]"
                />
                Disponible para la venta
              </label>

              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#1b6b43] hover:bg-[#145333] text-white transition cursor-pointer"
                >
                  Guardar Producto
                </button>
                <button
                  type="button"
                  onClick={resetProductForm}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#e6ece9] hover:bg-[#d6e0db] transition cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </section>

        {/* Asistente Inteligente Gemini */}
        <section
          id="asistente"
          className="bg-white border border-[#d7e2dc] rounded-xl p-5 shadow-xs"
        >
          <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Bot className="w-5 h-5 text-[#1b6b43]" />
              Asistente Inteligente (Gemini AI)
            </h2>
            <button
              type="button"
              onClick={resetChat}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#e6ece9] hover:bg-[#d6e0db] transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Nueva conversación
            </button>
          </div>

          <p className="text-xs text-[#55645c] mb-3">
            Consulta recetas, disponibilidad, precios y establecimientos en tiempo real desde Supabase.{' '}
            <strong>
              Orientación alimentaria general, sin diagnósticos ni prescripciones médicas.
            </strong>
          </p>

          <div className="flex flex-wrap gap-1.5 mb-3">
            {QUICK_PROMPTS.map((qp) => (
              <button
                key={qp.prompt}
                type="button"
                disabled={isSendingChat}
                onClick={() => sendChatMessage(qp.prompt)}
                className="text-left text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#eaf4ee] text-[#1b6b43] border border-[#cce3d6] hover:bg-[#d9ece1] disabled:opacity-60 transition cursor-pointer"
              >
                {qp.label}
              </button>
            ))}
          </div>

          <div
            ref={chatBoxRef}
            aria-live="polite"
            className="h-[330px] overflow-y-auto border border-[#d7e2dc] rounded-xl p-3.5 bg-[#fafcfb] flex flex-col gap-3 mb-3"
          >
            {chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`px-3.5 py-2.5 rounded-xl max-w-[85%] text-sm break-words ${
                  msg.role === 'user'
                    ? 'bg-[#1b6b43] text-white self-end whitespace-pre-wrap'
                    : 'bg-[#e8efeb] text-[#1c2420] self-start'
                }`}
              >
                {msg.role === 'ai' ? (
                  <FormattedMessage text={msg.text} />
                ) : (
                  msg.text
                )}
              </div>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendChatMessage(chatInput);
            }}
            className="flex flex-col sm:flex-row gap-2.5"
          >
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Pregunta sobre recetas, tiendas integrales o precios..."
              required
              className="flex-1 min-w-0 px-3.5 py-2.5 border border-[#d7e2dc] rounded-lg text-sm bg-white"
            />
            <button
              type="submit"
              disabled={isSendingChat}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-[#1b6b43] hover:bg-[#145333] text-white disabled:opacity-60 transition cursor-pointer"
            >
              {isSendingChat ? 'Enviando...' : 'Enviar'}
            </button>
          </form>
        </section>
      </main>

      <footer className="text-center py-4 text-xs text-[#55645c]">
        <p>
          NutriMap AI — Proyecto Examen Práctico • Colegio Nacional EMD Asunción Escalada
        </p>
      </footer>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed right-4 bottom-4 z-50 px-4 py-3 rounded-xl text-white text-sm font-medium shadow-lg max-w-[90vw] ${
            toast.type === 'error' ? 'bg-[#b91c1c]' : 'bg-[#166534]'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
