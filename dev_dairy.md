# Dev Diary: Chat Privado E2EE — Hyper-Minimalista

## Stack elegido: GitHub Pages + Supabase (Free Tier)

### ¿Por qué NO GitHub Pages solo?

GitHub Pages sirve **archivos estáticos** (HTML, CSS, JS). No ejecuta código backend.
Para un chat necesitas:

- **Autenticación** → requiere backend para validar credenciales y emitir tokens
- **Mensajería en tiempo real** → requiere WebSockets o polling (backend)
- **Encriptación E2EE** → el frontend puede hacerla con Web Crypto API, pero el relay y almacenamiento necesitan backend

Solo el frontend puede ir en GitHub Pages. El backend debe vivir en otro lado.

### Stack final

| Capa | Servicio | Costo |
|------|----------|-------|
| Frontend (HTML/CSS/JS vanilla) | **GitHub Pages** | Gratis |
| DB + Realtime (WebSocket) | **Supabase Free Tier** | Gratis (500MB DB, 50k usuarios activos/mes) |
| Autenticación | **Supabase Auth** | Gratis (email/password) |
| Encriptación E2EE | **Web Crypto API** (cliente) | Gratis |
| Vida útil mensajes | RLS filter + cleanup function | Gratis |

---

## Prompt completo

```
Crea un servicio de chat privado para 2 usuarios con:

## Stack
- Frontend: HTML/CSS/JS vanilla, burbuja flotante que se abre/cierra
- Backend: Supabase Free Tier
  - Auth: Supabase Auth (email/password)
  - Realtime: Postgres Changes subscription a INSERT en messages
  - RLS: cada usuario solo ve sus conversaciones
- E2EE: Web Crypto API (AES-GCM + PBKDF2)
  - Clave derivada de un secreto compartido ingresado por ambos
  - Encriptar/desencriptar 100% en cliente
- Hosting: GitHub Pages

## Funcionalidad
1. Login/registro con Supabase Auth (email/password)
2. Chat para 2 usuarios específicos
3. Mensajes viajan encriptados — el servidor NUNCA ve texto plano
4. Realtime: al enviar, el otro recibe al instante
5. Burbuja flotante esquina inferior derecha
6. Sin frameworks, vanilla JS
7. Sin servidor propio — solo Supabase

## Vida útil: 24 horas
- TTL de 24h por conversación
- RLS filtra mensajes con created_at < 24h
- Cleanup programable con cleanup_expired()
- Countdown visible en UI

## Despliegue
1. Crear proyecto en Supabase (gratis)
2. SQL Editor: ejecutar supabase-schema.sql
3. Settings (⚙️) > API Keys > Pestaña "Publishable and secret API keys"
4. Copiar Project URL (Settings > API) y Publishable key a config.js
5. Database > Replication > marcar messages en supabase_realtime
6. GitHub Pages: push a main
```

## Deploy paso a paso (detallado)

### 1. Crear proyecto Supabase
- https://supabase.com → New project → nombre "private-e2ee-chat" → Free

### 2. Ejecutar schema SQL
- SQL Editor → New query → pegar `supabase-schema.sql` completo → Run

### 3. Copiar credenciales a config.js
- **Project URL**: Settings (⚙️) > **API** → copiar "Project URL"
  (ej: `https://bulybtgalshddzwtzhug.supabase.co`)
- **Publishable key**: Settings (⚙️) > **API Keys** → pestaña "Publishable
  and secret API keys" → Create new API keys (si no existe) → copiar
  "Publishable key" (empieza con `sb_publishable_...`)
- Pegar ambas en `config.js` (sin `/rest/v1/` al final de la URL)

### 4. Crear los 2 usuarios (sin registro público)
- Authentication > Settings > apagar **Enable sign up**
- SQL Editor → abrir `reset-seed.sql` → reemplazar emails/passwords → Run
- Verificar: `SELECT id, email FROM auth.users;`
- Verificar: `SELECT id, email FROM profiles;`
  (Si profiles está vacío, el trigger falló. Solución:
  ```sql
  INSERT INTO profiles (id, email)
  SELECT id, email FROM auth.users;
  ```)

### 5. Habilitar Realtime
- Database > Replication > marcar `messages` en `supabase_realtime`
  (Ya se agrega automático en el SQL, pero verificar)

### 6. Subir a GitHub Pages
```bash
git remote add origin https://github.com/TU_USER/private-e2ee-chat.git
git branch -M main
git push -u origin main
```
- GitHub repo > Settings > Pages > Branch: `main`, folder: `/ (root)` > Save

### 7. Cambiar email/contraseña (cuando quieras)
Abre `reset-seed.sql` — al final están las queries comentadas para:
- UPDATE auth.users SET email = ...
- UPDATE profiles SET email = ...
- UPDATE auth.users SET encrypted_password = crypt(...) ...

---

## Alternativa: Cloudflare Workers + Durable Objects (ultra-minimalista)

Si quieres evitar cualquier tercero y tener control total:

| Capa | Servicio | Costo |
|------|----------|-------|
| Frontend | Cloudflare Pages | Gratis |
| Backend WebSocket | Cloudflare Workers + Durable Objects | Gratis (100k req/día Workers) |
| Auth | JWT manual con Web Crypto | Gratis |

Con un solo Durable Object mantienes el estado de la sala y haces relay de mensajes encriptados. Un solo worker + un DO + frontend estático. No necesitas base de datos externa.
