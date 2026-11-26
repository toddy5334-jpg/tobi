# NutriMap AI

Sistema web dinámico dedicado a tiendas de alimentación saludable y centros nutricionales, desarrollado para el Examen Práctico Individual (Colegio Nacional EMD Asunción Escalada — Segundo Bachillerato Técnico en Informática).

**Alumna:** Sofia Isabel Gimenez Acosta

## Funcionalidades implementadas
- **Base de datos en Supabase (PostgreSQL):** Almacena establecimientos (nombre, dirección, contacto, latitud y longitud) y productos alimenticios (categoría, precio en Gs. y disponibilidad).
- **Catálogo y CRUD completo:** Altas, bajas, modificaciones y consultas de establecimientos y productos, con búsqueda en tiempo real y filtros por categoría/tipo de alimento, establecimiento y disponibilidad.
- **Google Maps interactivo (`@vis.gl/react-google-maps` + `AdvancedMarkerElement`):** Muestra los establecimientos registrados. Al seleccionar un marcador muestra un InfoWindow y el detalle completo con productos disponibles. También permite hacer clic en el mapa para capturar latitud y longitud al registrar un local.
- **Asistente Inteligente con Gemini (`@google/genai` + `gemini-4-hydrogen`):** Responde consultas dinámicas mediante `POST /api/chat` consultando los datos reales de Supabase, manteniendo orientación alimentaria general sin diagnósticos ni prescripciones médicas.
- **Carpeta `/standalone`:** Conserva también la versión ligera HTML/CSS/JS + Express (`server.js`) lista para usar directamente en local o desplegar en Render.

## Cómo configurar paso a paso

### 1. Base de datos en Supabase
1. Crea un proyecto gratuito en [supabase.com](https://supabase.com).
2. Ve a **SQL Editor -> New Query**, copia el contenido de `supabase_schema.sql` y ejecútalo (`Run`). Esto crea las tablas `establecimientos` y `productos` e inserta los 5 locales iniciales y 13 productos.
3. Ve a **Project Settings -> API** y copia:
   - `Project URL` → será tu `SUPABASE_URL`
   - `service_role` key (o `anon` public key) → será tu `SUPABASE_KEY`

### 2. Variables de entorno
Completa `SUPABASE_URL`, `SUPABASE_KEY`, `GEMINI_API_KEY` y `GOOGLE_MAPS_API_KEY` en los secretos del entorno o en `.env` (nunca subas `.env` a GitHub).

### 3. Ejecutar en local
```bash
npm install
npm run dev
```
Luego abre `http://localhost:3000`.
