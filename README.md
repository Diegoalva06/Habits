# 🔥 Habits

App para crear, organizar y seguir hábitos diarios, con rachas, niveles, logros y estadísticas.
Frontend en HTML/CSS/JS puro y backend con [Supabase](https://supabase.com) (auth + Postgres).

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html`, `styles.css` | Interfaz |
| `app.js` | Interfaz y lógica: XP, logros, estadísticas, login |
| `core.js` | Núcleo sin DOM: fechas, rachas y saneamiento de todo lo que entra (respaldos, localStorage, servidor) |
| `db.js` | Capa de datos con Supabase (auth, lectura y escrituras en cola) |
| `config.js` | URL y anon key de tu proyecto Supabase |
| `supabase/schema.sql` | Tablas y políticas de seguridad (RLS) |
| `supabase/migrations/` | Cambios posteriores al esquema (límites y validaciones) |
| `_headers` | Cabeceras de seguridad de Netlify (CSP, anti-clickjacking…) |
| `tests/` | Tests del núcleo (`node --test`) |
| `manifest.webmanifest`, `icons/` | PWA: nombre, colores e íconos al instalarla |
| `sw.js` | Service worker: la app abre sin internet |

## App instalable (PWA)

- **Android / Chrome / Edge**: Ajustes → *Instalar Habits*.
- **iPhone**: en Safari, Compartir → *Agregar a inicio*.

Al editar `sw.js`: si agregas archivos a `SHELL`, sube la versión de `CACHE`; y si actualizas
la versión de supabase-js en `index.html`, cambia también `SDK` en `sw.js`.

Sin configurar `config.js`, la app funciona en **modo local** (sin cuentas, datos en el navegador).

## Configurar el backend (Supabase)

1. Crea un proyecto gratis en [supabase.com](https://supabase.com/dashboard).
2. **SQL Editor → New query**: pega el contenido de `supabase/schema.sql` y pulsa **Run**.
   Repite con cada archivo de `supabase/migrations/` (en orden).
3. **Project Settings → API**: copia *Project URL* y la key *anon public* en `config.js`.
   > La anon key es pública por diseño; la seguridad la dan las políticas RLS.
   > Nunca uses la key `service_role` en el frontend.
4. **Authentication → URL Configuration**:
   - *Site URL*: la URL de tu página (ej. `https://habits-diego.netlify.app`).
   - *Redirect URLs*: agrega esa misma URL y la de pruebas local (ej. `http://127.0.0.1:5500/**`).
5. (Opcional) **Authentication → Sign In / Providers → Email**: si desactivas *Confirm email*,
   los usuarios entran apenas se registran, sin confirmar el correo.
6. (Opcional) Login con Google: actívalo en **Authentication → Providers → Google**
   (necesitas un Client ID de Google Cloud) y pon `googleLogin: true` en `config.js`.

## Seguridad del registro (recomendado)

La anon key es pública, así que cualquiera puede llamar a la API de registro.
Para frenar cuentas falsas en masa, en el panel de Supabase:

1. **Authentication → Attack Protection**
   - Activa **CAPTCHA** con *Cloudflare Turnstile*. Crea el sitio en
     [dash.cloudflare.com → Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile),
     pega la *secret key* en Supabase y la *site key* en `turnstileSiteKey` de `config.js`
     (activa las dos cosas a la vez: si solo activas Supabase, nadie podrá entrar).
   - Activa **Leaked password protection**.
2. **Authentication → Rate Limits**: baja los límites de registros y correos por hora.
3. **Authentication → Sign In / Providers → Email**: deja *Confirm email* activado
   (cuando tengas SMTP propio) para que no se puedan crear cuentas con correos ajenos.

## Tests

```bash
node --test
```

No necesitan instalar nada (Node 18+).

## Actualizar el SDK de Supabase

`index.html` lo carga desde jsDelivr con un hash SRI: si el archivo del CDN cambia, el navegador
se niega a ejecutarlo. Si subes de versión, usa `dist/umd/supabase.js` (no `.min.js`, que jsDelivr
genera al vuelo) y recalcula el hash:

```bash
curl -sL https://cdn.jsdelivr.net/npm/@supabase/supabase-js@VERSION/dist/umd/supabase.js   | openssl dgst -sha384 -binary | openssl base64 -A
```

## Probar en local

Usa un servidor (no abras el archivo con doble clic, el login necesita `http://`):
la extensión **Live Server** de VS Code → clic derecho en `index.html` → *Open with Live Server*.

## Deploy en Netlify

Arrastra la carpeta `Habits` a [app.netlify.com/drop](https://app.netlify.com/drop),
o conecta el repositorio de GitHub. Luego pon la URL final en el paso 4.
