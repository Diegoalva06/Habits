# 🔥 Habits

App para crear, organizar y seguir hábitos diarios, con rachas, niveles, logros y estadísticas.
Frontend en HTML/CSS/JS puro y backend con [Supabase](https://supabase.com) (auth + Postgres).

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html`, `styles.css` | Interfaz |
| `app.js` | Lógica: rachas, XP, logros, estadísticas, login |
| `db.js` | Capa de datos con Supabase (auth, lectura y escrituras en cola) |
| `config.js` | URL y anon key de tu proyecto Supabase |
| `supabase/schema.sql` | Tablas y políticas de seguridad (RLS) |

Sin configurar `config.js`, la app funciona en **modo local** (sin cuentas, datos en el navegador).

## Configurar el backend (Supabase)

1. Crea un proyecto gratis en [supabase.com](https://supabase.com/dashboard).
2. **SQL Editor → New query**: pega el contenido de `supabase/schema.sql` y pulsa **Run**.
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

## Probar en local

Usa un servidor (no abras el archivo con doble clic, el login necesita `http://`):
la extensión **Live Server** de VS Code → clic derecho en `index.html` → *Open with Live Server*.

## Deploy en Netlify

Arrastra la carpeta `Habits` a [app.netlify.com/drop](https://app.netlify.com/drop),
o conecta el repositorio de GitHub. Luego pon la URL final en el paso 4.
