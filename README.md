# Agente WhatsApp (Meta Cloud API)

Agente de WhatsApp que se conecta a un número real vía la **API oficial de Meta (WhatsApp Cloud API)** y responde con un LLM (OpenRouter). Incluye un dashboard local para ver conversaciones, intervenir manualmente y togglear cada chat entre modo IA y modo Humano.

> A diferencia de Baileys, **no hay QR ni sesión que escanear**. La autenticación es por `ACCESS_TOKEN` permanente + `PHONE_NUMBER_ID` configurados desde el panel de Meta for Developers. Los mensajes entrantes llegan por webhook HTTP.

## Stack

- Next.js 16 (App Router) + TypeScript + React 19
- Tailwind CSS 4
- better-sqlite3 (base de datos local file-based)
- openai SDK apuntando a OpenRouter
- Node.js 20+ (recomendado 22)

## Quickstart local

```bash
# 1. Instalar dependencias (compila better-sqlite3 nativo, ~1 min)
npm install

# 2. Copiar el ejemplo de variables y rellenarlo
cp .env.example .env.local

# 3. Levantar el dashboard
npm run dev
```

Abre <http://localhost:3000>. Si las env vars de Meta no están configuradas, verás la pantalla **"Configura tu API de WhatsApp"** con los pasos exactos.

### Túnel HTTPS para el webhook

Meta solo acepta webhooks por HTTPS. Para desarrollo, expón localhost con [ngrok](https://ngrok.com/) o Cloudflare Tunnel:

```bash
ngrok http 3000
```

Copia la URL pública (algo como `https://abc123.ngrok-free.app`) y úsala como base del webhook en el panel de Meta:

- **Callback URL**: `https://abc123.ngrok-free.app/api/webhook`
- **Verify Token**: el valor de `META_VERIFY_TOKEN` de tu `.env.local`

Luego suscribe el webhook al campo **`messages`**.

## Variables de entorno

Copia `.env.example` a `.env.local` y completa:

| Variable | Dónde se obtiene | Notas |
|---|---|---|
| `META_ACCESS_TOKEN` | Business Settings → System Users → Generate Token | **Tiene que ser un System User Token permanente.** Los tokens de "test" duran 24h y van a romper en producción. |
| `META_PHONE_NUMBER_ID` | App Dashboard → WhatsApp → API Setup | Identifica el número que envía los mensajes. |
| `META_WABA_ID` | App Dashboard → WhatsApp → API Setup | WhatsApp Business Account ID. |
| `META_APP_SECRET` | App Dashboard → Settings → Basic | Se usa para verificar la firma `X-Hub-Signature-256`. |
| `META_VERIFY_TOKEN` | Lo eliges tú | Cualquier string aleatoria. **Debe coincidir** con el que pegas en el panel de Meta cuando configuras el webhook. |
| `META_GRAPH_VERSION` | — | `v21.0` al momento de escribir esto. Actualizar cada ~6 meses. |
| `OPENROUTER_API_KEY` | <https://openrouter.ai/keys> | Para el LLM. |
| `OPENROUTER_MODEL` | — | Default `openai/gpt-4o-mini`. Cualquier modelo de OpenRouter. |

## Pasos en Meta for Developers

1. Crea una app en <https://developers.facebook.com/>.
2. Agrega el producto **WhatsApp**.
3. Copia `Phone Number ID`, `WABA ID` y `App Secret` (Settings → Basic) al `.env.local`.
4. En **Business Settings → System Users** genera un **System User Token permanente**. Asigna el WhatsApp Business Account con permisos `whatsapp_business_messaging` y `whatsapp_business_management`. Pega el token en `META_ACCESS_TOKEN`.
5. En **WhatsApp → Configuration → Webhook**:
   - Callback URL: `https://TU_DOMINIO/api/webhook`
   - Verify Token: el mismo string que pusiste en `META_VERIFY_TOKEN`
6. Suscribe el webhook al campo **`messages`**.

Si la verificación inicial falla con 403, es porque `META_VERIFY_TOKEN` del `.env.local` no coincide con el del panel.

## Personalizar el system prompt

Edita `src/lib/system-prompt.ts`:

```ts
export const SYSTEM_PROMPT = `
Eres el asistente virtual de [TU NEGOCIO]. Responde…
`.trim();
```

Reinicia el servidor para que tome el cambio.

## Estructura del proyecto

```
src/
├── app/
│   ├── page.tsx                # ConnectionGate
│   ├── layout.tsx
│   └── api/
│       ├── webhook/route.ts    # GET (verify) + POST (receive)
│       ├── connection/status/route.ts
│       ├── conversations/...
│       ├── messages/[conversationId]/route.ts
│       └── mode/[conversationId]/route.ts
├── components/                 # UI: ConfigScreen, Dashboard*, etc.
└── lib/
    ├── db.ts                   # better-sqlite3 + helpers
    ├── openrouter.ts           # cliente LLM
    ├── system-prompt.ts
    └── meta/
        ├── client.ts           # fetch a Graph API
        ├── verify.ts           # firma HMAC-SHA256
        └── handler.ts          # procesa payloads del webhook
data/                           # gitignored, runtime (SQLite)
```

## Ventana de 24h

WhatsApp Cloud API solo permite enviar texto libre dentro de las **24h posteriores al último mensaje del cliente**. Pasada esa ventana, Graph devuelve el error `131047` ("re-engagement message") y hay que usar **Message Templates** preaprobadas (fuera del scope de v1).

El dashboard captura ese error y muestra un cartel rojo en la UI. Para reactivar una conversación dormida hay que enviar una plantilla aprobada desde el panel de Meta.

## Despliegue (EasyPanel sin Docker)

1. Sube el repo al panel.
2. Configura las env vars en EasyPanel.
3. Crea un **volumen persistente** montado en `/app/data` (ahí vive `messages.db`).
4. EasyPanel detecta `nixpacks.toml` y `Procfile`. Build: `npm ci && npm run build`. Start: `npm run start`.
5. Configura el webhook en Meta apuntando al dominio público (HTTPS obligatorio).

## Seguridad

- **Dashboard sin auth**: si lo expones a internet, ponle Basic Auth o Cloudflare Access. Cualquiera con la URL puede leer todas las conversaciones y enviar mensajes haciéndose pasar por el dueño.
- **Webhook protegido por firma**: `POST /api/webhook` rechaza con 401 cualquier request sin `X-Hub-Signature-256` válido. La verificación de firma **no es opcional** — sin ella, cualquiera con la URL pública puede inyectar mensajes falsos en tu DB y forzar respuestas del LLM (gastando créditos).

## Troubleshooting

| Síntoma | Causa probable |
|---|---|
| `403` al verificar webhook | `META_VERIFY_TOKEN` no coincide con el del panel de Meta. |
| `401 invalid signature` en POST /api/webhook | `META_APP_SECRET` incorrecto, o el body se está parseando antes de hashear. |
| `OAuth error` / `401` al enviar a Graph | Token expirado o sin permisos. Genera un System User Token permanente, no uses el de prueba (24h). |
| Mensajes duplicados | Algo está fallando en la dedup. Revisa la tabla `processed_webhook_messages`. |
| `error 131047` al enviar | Fuera de la ventana de 24h. Usa una plantilla preaprobada. |

## Mejoras pendientes (no en v1)

- Mensajes con audio, imagen, documentos, ubicación, sticker.
- Function calling / tool use.
- Plantillas (`type: "template"`) para reabrir conversaciones >24h.
- Cola persistente con workers separados (en lugar de `void` + dedup).
- Autenticación del dashboard.
- Manejo de grupos.
