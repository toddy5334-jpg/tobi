import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isConfigured(value: string | undefined): boolean {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  return (
    Boolean(trimmed) &&
    !trimmed.startsWith('tu_') &&
    !trimmed.startsWith('MY_') &&
    !trimmed.includes('tu-proyecto.supabase.co')
  );
}

const supabaseUrl = process.env.SUPABASE_URL?.trim() || '';
const supabaseKey = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  ''
).trim();

const supabaseConfigured =
  isConfigured(supabaseUrl) &&
  isConfigured(supabaseKey) &&
  /^https?:\/\/.+/i.test(supabaseUrl);

const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(supabaseUrl, supabaseKey)
  : null;

const geminiApiKey = process.env.GEMINI_API_KEY?.trim() || '';
const geminiConfigured = isConfigured(geminiApiKey);

const googleMapsApiKey = (
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.VITE_GOOGLE_MAPS_API_KEY ||
  ''
).trim();
const mapsConfigured = isConfigured(googleMapsApiKey);

function getGeminiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: geminiApiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function requireSupabase(res: Response): res is Response {
  if (!supabase) {
    res.status(503).json({
      error:
        'Base de datos Supabase no configurada. Configura SUPABASE_URL y SUPABASE_KEY en las variables de entorno.',
    });
    return false;
  }
  return true;
}

interface StorePayload {
  nombre: string;
  direccion: string;
  contacto: string;
  latitud: number;
  longitud: number;
}

function validateStorePayload(
  body: Record<string, unknown>
): { data?: StorePayload; error?: string } {
  const nombre = String(body?.nombre || '').trim();
  const direccion = String(body?.direccion || '').trim();
  const contacto = String(body?.contacto || '').trim();
  const latitud = Number(body?.latitud);
  const longitud = Number(body?.longitud);

  if (!nombre || !direccion || !contacto) {
    return { error: 'Nombre, dirección y contacto son obligatorios.' };
  }
  if (!Number.isFinite(latitud) || latitud < -90 || latitud > 90) {
    return { error: 'La latitud debe ser un número válido entre -90 y 90.' };
  }
  if (!Number.isFinite(longitud) || longitud < -180 || longitud > 180) {
    return { error: 'La longitud debe ser un número válido entre -180 y 180.' };
  }
  return { data: { nombre, direccion, contacto, latitud, longitud } };
}

interface ProductPayload {
  establecimiento_id: number;
  nombre: string;
  categoria: string;
  precio: number;
  disponible: boolean;
}

function validateProductPayload(
  body: Record<string, unknown>
): { data?: ProductPayload; error?: string } {
  const establecimiento_id = Number(body?.establecimiento_id);
  const nombre = String(body?.nombre || '').trim();
  const categoria = String(body?.categoria || '').trim();
  const precio = Number(body?.precio);
  const disponible =
    body?.disponible === undefined ? true : Boolean(body.disponible);

  if (!Number.isInteger(establecimiento_id) || establecimiento_id <= 0) {
    return { error: 'Selecciona un establecimiento válido.' };
  }
  if (!nombre || !categoria) {
    return {
      error: 'El nombre y la categoría del producto son obligatorios.',
    };
  }
  if (!Number.isFinite(precio) || precio < 0) {
    return {
      error: 'El precio debe ser un número válido mayor o igual a 0.',
    };
  }
  return {
    data: { establecimiento_id, nombre, categoria, precio, disponible },
  };
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/config', (_req: Request, res: Response) => {
    res.json({
      googleMapsApiKey: mapsConfigured ? googleMapsApiKey : '',
      status: {
        supabaseConfigured,
        mapsConfigured,
        geminiConfigured,
      },
    });
  });

  app.get('/api/health', async (_req: Request, res: Response) => {
    let dbConnected = false;
    let dbError: string | null = null;
    if (supabase) {
      try {
        const { error } = await supabase
          .from('establecimientos')
          .select('id', { count: 'exact', head: true });
        if (error) {
          dbError = error.message;
        } else {
          dbConnected = true;
        }
      } catch (err) {
        dbError = err instanceof Error ? err.message : String(err);
      }
    }
    res.json({
      ok: dbConnected && mapsConfigured && geminiConfigured,
      services: {
        supabase: {
          configured: supabaseConfigured,
          connected: dbConnected,
          error: dbError,
        },
        googleMaps: { configured: mapsConfigured },
        gemini: { configured: geminiConfigured },
      },
    });
  });

  // Listar establecimientos con sus productos anidados
  app.get('/api/establecimientos', async (_req: Request, res: Response) => {
    if (!requireSupabase(res) || !supabase) return;

    try {
      const [
        { data: estRows, error: estErr },
        { data: prodRows, error: prodErr },
      ] = await Promise.all([
        supabase
          .from('establecimientos')
          .select('*')
          .order('id', { ascending: true }),
        supabase.from('productos').select('*').order('id', { ascending: true }),
      ]);

      if (estErr) throw estErr;
      if (prodErr) throw prodErr;

      const productosPorEst = new Map<number, Record<string, unknown>[]>();
      for (const p of prodRows || []) {
        const estId = Number(p.establecimiento_id);
        const list = productosPorEst.get(estId) || [];
        list.push(p);
        productosPorEst.set(estId, list);
      }

      const data = (estRows || []).map((e) => ({
        ...e,
        productos: productosPorEst.get(Number(e.id)) || [],
      }));

      res.json(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        error: 'Error al obtener establecimientos de Supabase',
        details: message,
      });
    }
  });

  // Alta de establecimiento
  app.post('/api/establecimientos', async (req: Request, res: Response) => {
    if (!requireSupabase(res) || !supabase) return;

    const parsed = validateStorePayload(
      (req.body || {}) as Record<string, unknown>
    );
    if (parsed.error || !parsed.data) {
      return res.status(400).json({ error: parsed.error || 'Datos inválidos.' });
    }

    try {
      const { data, error } = await supabase
        .from('establecimientos')
        .insert([parsed.data])
        .select()
        .single();

      if (error) throw error;
      res.status(201).json({ ...data, productos: [] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res
        .status(500)
        .json({ error: 'Error al crear establecimiento', details: message });
    }
  });

  // Modificación de establecimiento
  app.put('/api/establecimientos/:id', async (req: Request, res: Response) => {
    if (!requireSupabase(res) || !supabase) return;

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res
        .status(400)
        .json({ error: 'ID de establecimiento inválido.' });
    }

    const parsed = validateStorePayload(
      (req.body || {}) as Record<string, unknown>
    );
    if (parsed.error || !parsed.data) {
      return res.status(400).json({ error: parsed.error || 'Datos inválidos.' });
    }

    try {
      const { data, error } = await supabase
        .from('establecimientos')
        .update(parsed.data)
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return res
          .status(404)
          .json({ error: 'Establecimiento no encontrado.' });
      }
      res.json(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        error: 'Error al actualizar establecimiento',
        details: message,
      });
    }
  });

  // Baja de establecimiento
  app.delete(
    '/api/establecimientos/:id',
    async (req: Request, res: Response) => {
      if (!requireSupabase(res) || !supabase) return;

      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res
          .status(400)
          .json({ error: 'ID de establecimiento inválido.' });
      }

      try {
        const { error } = await supabase
          .from('establecimientos')
          .delete()
          .eq('id', id);
        if (error) throw error;
        res.json({ ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({
          error: 'Error al eliminar establecimiento',
          details: message,
        });
      }
    }
  );

  // Consulta y búsqueda de productos
  app.get('/api/productos', async (req: Request, res: Response) => {
    if (!requireSupabase(res) || !supabase) return;

    const q = String(req.query.q || '')
      .trim()
      .toLowerCase();
    const categoria = String(req.query.categoria || '').trim();
    const establecimientoId = String(req.query.establecimientoId || '').trim();
    const disponible = String(req.query.disponible || '').trim();

    try {
      let query = supabase
        .from('productos')
        .select('*, establecimientos(nombre, direccion)')
        .order('id', { ascending: false });

      if (categoria) {
        query = query.eq('categoria', categoria);
      }
      if (establecimientoId) {
        const estIdNum = Number(establecimientoId);
        if (Number.isInteger(estIdNum) && estIdNum > 0) {
          query = query.eq('establecimiento_id', estIdNum);
        }
      }
      if (disponible === 'true') {
        query = query.eq('disponible', true);
      } else if (disponible === 'false') {
        query = query.eq('disponible', false);
      }

      const { data, error } = await query;
      if (error) throw error;

      let rows = (data || []).map((row) => {
        const estRel = row.establecimientos as
          | { nombre?: string; direccion?: string }
          | null
          | undefined;
        return {
          id: row.id,
          establecimiento_id: row.establecimiento_id,
          nombre: row.nombre,
          categoria: row.categoria,
          precio: Number(row.precio),
          disponible: Boolean(row.disponible),
          creado_en: row.creado_en,
          establecimiento_nombre: estRel?.nombre || 'Sin establecimiento',
          establecimiento_direccion: estRel?.direccion || '',
        };
      });

      if (q) {
        rows = rows.filter(
          (p) =>
            String(p.nombre).toLowerCase().includes(q) ||
            String(p.categoria).toLowerCase().includes(q) ||
            String(p.establecimiento_nombre).toLowerCase().includes(q)
        );
      }

      res.json(rows);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res
        .status(500)
        .json({ error: 'Error al consultar productos', details: message });
    }
  });

  // Alta de producto
  app.post('/api/productos', async (req: Request, res: Response) => {
    if (!requireSupabase(res) || !supabase) return;

    const parsed = validateProductPayload(
      (req.body || {}) as Record<string, unknown>
    );
    if (parsed.error || !parsed.data) {
      return res.status(400).json({ error: parsed.error || 'Datos inválidos.' });
    }

    try {
      const { data, error } = await supabase
        .from('productos')
        .insert([parsed.data])
        .select()
        .single();

      if (error) throw error;
      res.status(201).json(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res
        .status(500)
        .json({ error: 'Error al crear producto', details: message });
    }
  });

  // Modificación de producto
  app.put('/api/productos/:id', async (req: Request, res: Response) => {
    if (!requireSupabase(res) || !supabase) return;

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'ID de producto inválido.' });
    }

    const parsed = validateProductPayload(
      (req.body || {}) as Record<string, unknown>
    );
    if (parsed.error || !parsed.data) {
      return res.status(400).json({ error: parsed.error || 'Datos inválidos.' });
    }

    try {
      const { data, error } = await supabase
        .from('productos')
        .update(parsed.data)
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return res.status(404).json({ error: 'Producto no encontrado.' });
      }
      res.json(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res
        .status(500)
        .json({ error: 'Error al actualizar producto', details: message });
    }
  });

  // Baja de producto
  app.delete('/api/productos/:id', async (req: Request, res: Response) => {
    if (!requireSupabase(res) || !supabase) return;

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'ID de producto inválido.' });
    }

    try {
      const { error } = await supabase.from('productos').delete().eq('id', id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res
        .status(500)
        .json({ error: 'Error al eliminar producto', details: message });
    }
  });

  // Asistente inteligente con Gemini API consultando registros reales de Supabase
  app.post('/api/chat', async (req: Request, res: Response) => {
    const mensaje = String(req.body?.mensaje || '').trim();
    const previousInteractionId = req.body?.previousInteractionId
      ? String(req.body.previousInteractionId)
      : undefined;

    if (!mensaje) {
      return res
        .status(400)
        .json({ error: 'Escribe una consulta para el asistente.' });
    }

    if (!geminiConfigured) {
      return res.status(503).json({
        error:
          'Falta configurar GEMINI_API_KEY en el entorno del servidor.',
      });
    }

    try {
      let contextBlock = '';

      if (supabase) {
        const [
          { data: establecimientos, error: estErr },
          { data: prodData, error: prodErr },
        ] = await Promise.all([
          supabase
            .from('establecimientos')
            .select('id, nombre, direccion, contacto, latitud, longitud')
            .order('id'),
          supabase
            .from('productos')
            .select(
              'id, nombre, categoria, precio, disponible, establecimientos(nombre, direccion, contacto)'
            )
            .order('id'),
        ]);

        if (estErr) throw estErr;
        if (prodErr) throw prodErr;

        const productos = (prodData || []).map((p) => {
          const estRel = p.establecimientos as
            | { nombre?: string; direccion?: string; contacto?: string }
            | null
            | undefined;
          return {
            id: p.id,
            nombre: p.nombre,
            categoria: p.categoria,
            precio_gs: Number(p.precio),
            disponible: Boolean(p.disponible),
            establecimiento: estRel?.nombre || 'Desconocido',
            direccion: estRel?.direccion || '',
            contacto: estRel?.contacto || '',
          };
        });

        contextBlock = `ESTABLECIMIENTOS REGISTRADOS EN SUPABASE (${(establecimientos || []).length}):
${JSON.stringify(establecimientos || [], null, 2)}

PRODUCTOS REGISTRADOS EN SUPABASE (${productos.length}):
${JSON.stringify(productos, null, 2)}`;
      } else {
        contextBlock =
          'AVISO DEL SISTEMA: La conexión a Supabase aún no está configurada en este entorno. No inventes nombres de tiendas, precios ni stock específico; si te preguntan por tiendas o inventario específico, indica amablemente que falta configurar SUPABASE_URL y SUPABASE_KEY para consultar el catálogo en tiempo real, y ofrece igualmente orientación alimentaria general y recetas saludables.';
      }

      const contextoSistema = `Eres NutriMap AI, el asistente inteligente de una red de tiendas de alimentación saludable y centros nutricionales en Paraguay.

REGLAS OBLIGATORIAS:
1. Basa tus respuestas sobre tiendas, productos, categorías, precios (en Gs.) y disponibilidad ÚNICAMENTE en los registros reales actuales de Supabase listados abajo. No inventes tiendas, precios ni stock.
2. Si el usuario pide recetas (por ejemplo, con avena y banana o desayunos con los ingredientes disponibles), sugiere recetas saludables prácticas indicando qué ingredientes están disponibles en el catálogo real, en qué tienda se consiguen y a qué precio (cuando Supabase esté conectado).
3. Cuando te pregunten por productos integrales u otra categoría, lista exactamente los establecimientos registrados que tienen esos productos, su dirección, contacto y disponibilidad.
4. ORIENTACIÓN ALIMENTARIA GENERAL ÚNICAMENTE: NUNCA realices diagnósticos médicos, tratamientos de enfermedades ni prescripciones médicas o dietas clínicas personalizadas para patologías. Si el usuario consulta sobre una enfermedad o tratamiento médico, aclara amablemente que solo brindas orientación alimentaria general y recomienda acudir a un profesional de la salud o nutricionista matriculado.
5. Responde en español claro, cordial, conciso y bien organizado (puedes usar viñetas y negritas).

${contextBlock}`;

      const ai = getGeminiClient();

      let interaction;
      try {
        interaction = await ai.interactions.create({
          model: 'gemini-4-hydrogen',
          system_instruction: contextoSistema,
          input: mensaje,
          ...(previousInteractionId
            ? { previous_interaction_id: previousInteractionId }
            : {}),
        });
      } catch (firstErr) {
        if (previousInteractionId) {
          interaction = await ai.interactions.create({
            model: 'gemini-4-hydrogen',
            system_instruction: contextoSistema,
            input: mensaje,
          });
        } else {
          throw firstErr;
        }
      }

      let fullOutput = '';
      if (Array.isArray(interaction?.steps)) {
        for (const step of interaction.steps) {
          if (step.type === 'model_output' && Array.isArray(step.content)) {
            for (const c of step.content) {
              if (c.type === 'text' && typeof c.text === 'string') {
                fullOutput += c.text;
              }
            }
          }
        }
      }

      const respuesta =
        fullOutput.trim() ||
        interaction?.output_text ||
        'No pude generar una respuesta en este momento.';

      res.json({
        respuesta,
        interactionId: interaction?.id || null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        error: 'Error al consultar la API de Gemini',
        details: message,
      });
    }
  });

  app.all('/api/*', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Endpoint de API no encontrado.' });
  });

  const isCompiledServer = path.basename(__dirname) === 'dist-server';
  const isProduction =
    process.env.NODE_ENV === 'production' || isCompiledServer;

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = isCompiledServer
      ? path.resolve(__dirname, '..', 'dist')
      : path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NutriMap AI corriendo en http://localhost:${PORT}`);
  });
}

startServer();
