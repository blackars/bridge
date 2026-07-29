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
| Autenticación | **Supabase Auth** | Gratis (email/password o magic link) |
| Encriptación E2EE | **Web Crypto API** (cliente) | Gratis |
| Vida útil mensajes | Supabase Row Level Security + cleanup cron | Gratis |

---

## Prompt completo para implementar

```
Crea un servicio de chat privado para 2 usuarios con:

## Stack
- Frontend: HTML/CSS/JS vanilla (hyper-minimalista, una sola página, estilo ventana flotante tipo nube que se abre/cierra con un botón)
- Backend: Supabase (Free Tier)
  - Auth con Supabase Auth (email/password)
  - Mensajería en tiempo real con Supabase Realtime (subscription a INSERT en la tabla messages)
  - Row Level Security (RLS) para que cada usuario solo vea sus propias conversaciones
- Encriptación: End-to-end con Web Crypto API (AES-GCM)
  - Derivar clave compartida del chat usando un secreto común ingresado por ambos usuarios (PBKDF2)
  - Encriptar cada mensaje en cliente antes de enviarlo a Supabase
  - Desencriptar al recibirlo antes de mostrarlo
- Hosting: GitHub Pages (frontend estático, sin backend propio)

## Funcionalidad
1. Pantalla de login/registro (Supabase Auth con email/password)
2. Sala de chat único para 2 usuarios específicos (identificados por email)
3. Los mensajes viajan encriptados (E2EE) a la DB de Supabase — el servidor NUNCA ve el contenido
4. Realtime: al enviar, el otro usuario recibe al instante vía Realtime subscriptions
5. Diseño tipo "burbuja flotante" (chat widget) que se pueda abrir/cerrar con un botón, posicionado en la esquina inferior derecha de la pantalla
6. Sin frameworks, sin dependencias npm, todo vanilla
7. Sin servidor propio — todo el "backend" es Supabase

## Vida útil de la conversación: 24 horas
- Cada sala de chat entre 2 usuarios tiene un TTL (time-to-live) de 24 horas
- Al crear la sala, se guarda un `created_at` timestamp
- Los mensajes con más de 24 horas se limpian automáticamente:
  - Opción A: Una función serverless (Supabase Edge Function o cron) que corre cada hora eliminando mensajes expirados
  - Opción B: Una consulta RLS que filtra mensajes con `created_at > NOW() - INTERVAL '24 hours'` y un cleanup periódico
  - Opción C: Política de retention en la misma tabla con un trigger
- La interfaz debe mostrar el tiempo restante de la conversación (countdown)
- Al expirar, los mensajes se borran y la sala se cierra automáticamente

## Despliegue
1. Crear proyecto en Supabase (gratis, sin tarjeta)
2. Configurar Auth (email/password)
3. Crear tablas: `profiles`, `conversations`, `messages` (con RLS policies)
4. Habilitar Realtime en la tabla `messages`
5. Configurar cleanup automático (Edge Function con pg_cron o Vercel Cron Job)
6. Subir frontend estático a GitHub Pages
7. Conectarlo a Supabase con anon key y project URL

Dame el código completo con instrucciones de deploy paso a paso.
```

---

## Alternativa: Cloudflare Workers + Durable Objects (ultra-minimalista)

Si quieres evitar cualquier tercero y tener control total:

| Capa | Servicio | Costo |
|------|----------|-------|
| Frontend | Cloudflare Pages | Gratis |
| Backend WebSocket | Cloudflare Workers + Durable Objects | Gratis (100k req/día Workers) |
| Auth | JWT manual con Web Crypto | Gratis |

Con un solo Durable Object mantienes el estado de la sala y haces relay de mensajes encriptados. Un solo worker + un DO + frontend estático. No necesitas base de datos externa.
