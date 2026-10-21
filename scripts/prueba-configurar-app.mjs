// Dejar la app de Meta configurada desde la pantalla.
//
// Se verificó en la documentación de Meta qué se puede escribir por API y qué
// no: el DOMINIO de la app sí, los WEBHOOKS también, y la URI de
// redireccionamiento NO. Esta prueba fija que el código respete eso y, sobre
// todo, que no pueda dejar el bot sin recibir mensajes por accidente.
//
//   node scripts/prueba-configurar-app.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const ruta = readFileSync(
  join(RAIZ, "src", "app", "api", "meta", "connect", "configurar-app", "route.ts"),
  "utf8"
);
const pagina = readFileSync(
  join(RAIZ, "src", "app", "meta-connect", "page.tsx"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (nombre, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(nombre, 58)} ${valor}`);
};

// ── 1. Se puede mirar antes de tocar ────────────────────────────────────────
comprobar(
  "hay una consulta que solo LEE lo que la app tiene puesto",
  /export async function GET/.test(ruta) &&
    !ruta
      .slice(ruta.indexOf("export async function GET"), ruta.indexOf("export async function POST"))
      .includes('method: "POST"'),
  "solo lee"
);

// ── 2. Escribir pide confirmación ───────────────────────────────────────────
comprobar(
  "configurar pide confirmación antes de reescribir el webhook",
  /setConfirmarConfig\(true\)/.test(pagina) && /Sí, configurar/.test(pagina),
  "sí"
);
comprobar(
  "y se puede cancelar",
  /setConfirmarConfig\(false\)/.test(pagina) && /Cancelar/.test(pagina),
  "sí"
);
comprobar(
  "avisa de que el webhook es por donde entran los mensajes",
  /REESCRIBE el webhook/.test(pagina),
  "sí"
);

// ── 3. Lo que Meta sí deja escribir ─────────────────────────────────────────
comprobar(
  "pone el dominio de la app",
  /app_domains: \[dominio\]/.test(ruta),
  "sí"
);
comprobar(
  "registra los webhooks de los tres canales",
  ["whatsapp_business_account", "page", "instagram"].every((canal) =>
    ruta.includes(canal)
  ),
  "sí"
);
comprobar(
  "usa el verify token que ya tiene el bot, no uno inventado",
  /getWebhookVerifyToken/.test(ruta),
  "sí"
);
comprobar(
  "si Meta rechaza la lista larga de campos, prueba una más corta",
  /for \(const campos of listas\)/.test(ruta),
  "sí"
);

// ── 3 bis. Cada canal a SU direccion ────────────────────────────────────────
//
// Los tres canales tienen rutas distintas y verify tokens distintos, y cada
// ruta solo acepta el token de SU canal. Mandarle a Meta la direccion de
// WhatsApp para la pagina hacia que la comprobacion llegara con el token de
// Messenger, /api/webhook lo rechazara y Meta respondiera
// "(#2200) Callback verification failed ... 403". Paso de verdad.
comprobar(
  "cada canal apunta a su propia ruta",
  /whatsapp_business_account: "\/api\/webhook"/.test(ruta) &&
    /page: "\/api\/webhooks\/messenger"/.test(ruta) &&
    /instagram: "\/api\/webhooks\/instagram"/.test(ruta),
  "tres rutas"
);
comprobar(
  "la direccion se calcula con el canal, no fija",
  /function urlDelWebhook\(req: NextRequest, objeto: string\)/.test(ruta) &&
    /callback_url: urlDelWebhook\(req, objeto\)/.test(ruta),
  "por canal"
);
comprobar(
  "antes de tocar, se muestran las tres direcciones",
  /urlsPropuestas/.test(ruta) && /urlsPropuestas/.test(pagina),
  "las tres"
);

// ── 4. Lo que Meta NO deja, y no se finge ───────────────────────────────────
comprobar(
  "no intenta escribir la URI de redireccionamiento",
  !/redirect_uris/.test(ruta),
  "no lo intenta"
);
comprobar(
  "y devuelve esa URI para copiarla a mano",
  /uriDeRedireccion/.test(ruta) && /uriDeRedireccion/.test(pagina),
  "sí"
);

// ── 4 bis. Si Meta se niega, no deja al usuario a ciegas ────────────────────
//
// El candado "Permitir acceso de API a configuracion de la app" puede estar
// cerrado y no poder abrirse. Eso no rompe nada, pero entonces los tres campos
// hay que ponerlos a mano — y hay que saber QUE poner.
comprobar(
  "si no puede escribir los basicos, los devuelve para copiarlos",
  /datosBasicos: pasos\[0\]\?\.ok/.test(ruta) &&
    /dominio, sitioWeb: origen, politicaDePrivacidad/.test(ruta),
  "los tres"
);
comprobar(
  "y la pantalla los muestra",
  /datosBasicos\.dominio/.test(pagina) &&
    /datosBasicos\.sitioWeb/.test(pagina) &&
    /datosBasicos\.politicaDePrivacidad/.test(pagina),
  "si"
);
comprobar(
  "avisando de que eso no afecta a mensajes ni ventas",
  /No afecta a los mensajes ni al registro de ventas/.test(pagina),
  "si"
);

// ── 5. Un canal que falla no tumba a los demás ──────────────────────────────
comprobar(
  "cada paso se informa por separado, con su motivo",
  /pasos\.push\(/.test(ruta) && /ok: logrado/.test(ruta),
  "sí"
);

// ── 6. Los datos básicos de la app ──────────────────────────────────────────
comprobar(
  "pone también el sitio web y la política de privacidad",
  /website_url: origen/.test(ruta) && /privacy_policy_url/.test(ruta),
  "sí"
);
comprobar(
  "la política apunta a la página que el propio bot sirve",
  ruta.includes("privacidad`"),
  "sí"
);
comprobar(
  "los datos básicos van en UNA sola llamada, no en tres",
  /app_domains: \[dominio\][\s\S]{0,200}?website_url[\s\S]{0,200}?privacy_policy_url/.test(
    ruta
  ),
  "sí"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
