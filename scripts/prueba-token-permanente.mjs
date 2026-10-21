// El botón que genera el token permanente.
//
// El token que trae "Conectar con Meta" dura unos 60 días. Este pide uno de
// usuario del sistema, que no vence, y lo guarda solo.
//
// Lo que se fija aquí:
//
//  1. Que pida el token SIN fecha de caducidad. Si se pidiera con los 60 días,
//     el botón no serviría para nada: seguiría venciendo.
//  2. Que si Meta lo rechaza NO se reintente en bucle. Se prueba una vez por
//     usuario del sistema y se para, mostrando lo que dijo Meta.
//  3. Que al guardarlo quede puesto en los DOS sitios — WhatsApp y el reporte
//     de compras — porque si no, uno de los dos seguiría con el que vence.
//
//   node scripts/prueba-token-permanente.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const ruta = readFileSync(
  join(RAIZ, "src", "app", "api", "meta", "connect", "token-permanente", "route.ts"),
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

// ── 1. Que de verdad sea permanente ─────────────────────────────────────────
comprobar(
  "se pide SIN fecha de caducidad",
  /set_token_expires_in_60_days: false/.test(ruta),
  "sin caducidad"
);

// ── 2. Que no quede reintentando ────────────────────────────────────────────
comprobar(
  "en cuanto uno funciona, se para",
  // 1200 y no 600: desde el 10/10/2026 en medio está el permanente POR CUENTA, que se
  // guarda en su cuenta en vez de en los globales. Sigue saliendo al primer acierto.
  /if \(res\.ok && typeof cuerpo\?\.access_token === "string"\)[\s\S]{0,1200}?return NextResponse\.json\(\{\s*ok: true/.test(
    ruta
  ),
  "sale al primer acierto"
);
comprobar(
  "no hay ningún reintento del mismo usuario",
  !/while|setTimeout|retry|reintent(ar|o)\(/i.test(ruta),
  "un intento por usuario"
);
comprobar(
  "si falla, se muestra lo que respondió Meta",
  /intentos\.push\(/.test(ruta) && /cuerpo\?\.error\?\.message/.test(ruta),
  "sí"
);

// ── 3. Que se guarde donde hace falta ───────────────────────────────────────
comprobar(
  "queda guardado para WhatsApp",
  /whatsapp_access_token_override: cuerpo\.access_token/.test(ruta),
  "sí"
);
comprobar(
  "y también para el reporte de compras",
  /capi_access_token: cuerpo\.access_token/.test(ruta) &&
    /capi_token_origen: "manual"/.test(ruta),
  "sí"
);

// ── 4. Los permisos que necesita el bot ─────────────────────────────────────
comprobar(
  "pide los permisos de mas a menos, no todo o nada",
  /ESCALERA_DE_PERMISOS/.test(ruta) && /for \(const permisos of ESCALERA_DE_PERMISOS\)/.test(ruta),
  "escalera"
);
comprobar(
  "en cuanto Meta acepta una lista, se para",
  /permisosLogrados = permisos;[\s\S]{0,40}?break;/.test(ruta),
  "si"
);
comprobar(
  "dice que permisos consiguio",
  /permisos: permisosLogrados\.split\(","\)/.test(ruta),
  "si"
);

for (const permiso of [
  "whatsapp_business_messaging",
  "whatsapp_business_management",
  "ads_read",
  "business_management",
]) {
  comprobar(`pide el permiso ${permiso}`, ruta.includes(permiso), "sí");
}

// ── 5. La llamada va firmada, como exige Meta ───────────────────────────────
comprobar(
  "la llamada va firmada con el secreto de la app",
  /appsecret_proof/.test(ruta) && /createHmac\("sha256"/.test(ruta),
  "sí"
);

// ── 6. El botón existe y no se puede pulsar dos veces a la vez ──────────────
comprobar(
  "el botón se bloquea mientras trabaja",
  /disabled=\{generandoPermanente\}/.test(pagina),
  "sí"
);

// ── 7. Instalar la app antes de pedir el token ──────────────────────────────
//
// El id de un usuario del sistema solo sirve para una app que tenga INSTALADA.
// Sin instalarla primero, pedir el token devuelve "Unsupported request", que no
// parece un problema de configuración y despista un buen rato.
comprobar(
  "instala la app antes de pedir el token",
  ruta.includes("applications`") && /business_app: appId/.test(ruta),
  "sí"
);
comprobar(
  "el orden es instalar y DESPUÉS pedir",
  ruta.indexOf("applications`") < ruta.indexOf("access_tokens`"),
  "sí"
);
comprobar(
  "si ya estaba instalada, no corta: sigue al token",
  /errorAlInstalar[\s\S]{0,400}?const url = new URL/.test(ruta),
  "sí"
);
comprobar(
  "si falla el token, se muestra también el fallo al instalar",
  ruta.includes("al instalar la app"),
  "sí"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
