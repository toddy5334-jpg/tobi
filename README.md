# NutriMap AI

Sistema web dinámico dedicado a tiendas de alimentación saludable y centros nutricionales, desarrollado para el Examen Práctico Individual (Colegio Nacional EMD Asunción Escalada — Segundo Bachillerato Técnico en Informática).

**Alumna:** Sofia Isabel Gimenez Acosta

## Funcionalidades implementadas
- **Base de datos en Supabase (PostgreSQL):** Almacena establecimientos (nombre, dirección, contacto, latitud y longitud) y productos alimenticios (categoría, precio en Gs. y disponibilidad).
- **Catálogo y CRUD completo:** Altas, bajas, modificaciones y consultas de establecimientos y productos, con búsqueda en tiempo real y filtros por categoría/tipo de alimento, establecimiento y disponibilidad.
- **Google Maps interactivo (`@vis.gl/react-google-maps` + `AdvancedMarkerElement`):** Muestra los establecimientos registrados (5 iniciales en Asunción + los que agregues). Al seleccionar un marcador muestra un InfoWindow y el detalle completo con productos disponibles. También permite hacer clic en el mapa para capturar latitud y longitud al registrar un local.
- **Asistente Inteligente con Gemini (`@google/genai` + `gemini-4-hydrogen`):** Responde consultas dinámicas mediante `POST /api/chat` consultando los datos reales de Supabase, manteniendo orientación alimentaria general sin diagnósticos ni prescripciones médicas.
- **Interfaz responsiva:** Adaptable a celulares y computadoras.
- **Carpeta `/standalone`:** Conserva también una versión ligera HTML/CSS/JS + Express (`server.js`) opcional.

## Cómo configurar paso a paso

### 1. Base de datos en Supabase
1. Crea un proyecto gratuito en [supabase.com](https://supabase.com).
2. Ve a **SQL Editor -> New Query**, copia el contenido de `supabase_schema.sql` y ejecútalo (`Run`). Esto crea las tablas `establecimientos` y `productos` e inserta los 5 locales iniciales y 13 productos.
3. Ve a **Project Settings -> API** y copia:
   - `Project URL` → será tu `SUPABASE_URL`
   - `service_role` key (recomendada para el servidor) o `anon` public key → será tu `SUPABASE_KEY`

### 2. Clave de Gemini en Google AI Studio
1. Ingresa a [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Crea una API Key y cópiala → será tu `GEMINI_API_KEY`.

### 3. Clave de Google Maps
1. Ingresa a [console.cloud.google.com](https://console.cloud.google.com/).
2. Crea o selecciona un proyecto, habilita **Maps JavaScript API**.
3. En **Credenciales**, crea una **Clave de API** → será tu `GOOGLE_MAPS_API_KEY`.

### 4. Variables de entorno en local
1. Copia `.env.example` a `.env` (`.gitignore` ya protege `.env` para que nunca se suba a GitHub).
2. Completa tus valores reales en `.env`:
   ```env
   PORT=3000
   SUPABASE_URL=https://tu-proyecto.supabase.co
   SUPABASE_KEY=tu_supabase_service_role_o_anon_key
   GEMINI_API_KEY=tu_api_key_de_gemini
   GOOGLE_MAPS_API_KEY=tu_api_key_de_google_maps
   ```

### 5. Ejecutar en local
> **Requisito:** Necesitas **Node.js 20 o superior** instalado en tu equipo. No abras `index.html` directamente en el navegador ni con Live Server, porque la aplicación requiere el servidor Node.js + Vite.

Modo desarrollo:
```bash
npm install
npm run dev
```

Modo producción (igual que en Render):
```bash
npm install
npm run build
npm start
```
Luego abre `http://localhost:3000`.

### 6. Subir a GitHub y publicar en Render
> **Importante:** **GitHub** se usa para alojar el código del repositorio. No uses *GitHub Pages*, ya que GitHub Pages solo sirve sitios estáticos y esta aplicación necesita un servidor Node.js (`server.ts`) para conectarse a Supabase y Gemini de forma segura.

1. Sube este proyecto a tu repositorio en GitHub (verifica que `.env` y `node_modules/` **no** aparezcan en el repositorio; `.gitignore` los excluye automáticamente).
2. En [render.com](https://render.com), crea un **New Web Service** (o **Blueprint** usando el archivo `render.yaml` incluido) conectado a tu repositorio de GitHub:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/api/health`
3. En **Environment -> Environment Variables**, agrega las 4 variables secretas:
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
   - `GEMINI_API_KEY`
   - `GOOGLE_MAPS_API_KEY`
4. Haz clic en **Deploy** y verifica el estado en `/api/health`.
5. *(Opcional)* Si configuraste restricciones de dominio (HTTP referrers) en tu clave de **Google Maps**, recuerda agregar la URL de Render (por ejemplo `https://tu-app.onrender.com/*`) y `http://localhost:3000/*`.
