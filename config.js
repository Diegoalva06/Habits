/* =========================================================
   Configuración de Supabase
   Copia estos valores de: Supabase → Project Settings → API
   - supabaseUrl:     "Project URL"
   - supabaseAnonKey: "anon public" key
   La anon key es pública por diseño: la seguridad la dan las
   políticas RLS de supabase/schema.sql. NUNCA pongas aquí la
   "service_role" key.

   Si dejas los valores de ejemplo, la app funciona en modo local
   (cada navegador guarda sus hábitos, sin cuentas).
   ========================================================= */
window.HABITS_CONFIG = {
  supabaseUrl: 'https://hqsjczlpagfbyqzlxbrr.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhxc2pjemxwYWdmYnlxemx4YnJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMzEzNjksImV4cCI6MjEwNzYwNzM2OX0.9znbuBIIuj-y4zt2Inj1b5dHU-NJhtI59XtHBBfD2TY',
  googleLogin: false, // ponlo en true cuando actives Google en Authentication → Providers
};
