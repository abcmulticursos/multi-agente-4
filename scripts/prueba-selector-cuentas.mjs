// Los selectores con foto de Meta Connect.
//
// Se construyen a mano y no con un <select> porque un <option> del navegador
// solo admite texto: no hay forma de meterle una imagen.
//
// Lo que se fija aquí:
//
//  1. Que elegir una cuenta distinta PIDA CONFIRMACIÓN antes de cambiarla. Es
//     lo que decide por qué página responde el bot y por qué número atiende:
//     un clic distraído no puede cambiarlo en producción.
//  2. Que elegir la que ya está activa no haga nada.
//  3. Que las fotos tengan respaldo: si no hay foto, o si la que hay no carga,
//     queda el círculo con la inicial y la fila no se rompe.
//
//   node scripts/prueba-selector-cuentas.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const pagina = readFileSync(
  join(RAIZ, "src", "app", "meta-connect", "page.tsx"),
  "utf8"
);
const avatares = readFileSync(
  join(RAIZ, "src", "app", "api", "meta", "connect", "whatsapp", "avatares", "route.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (nombre, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(nombre, 58)} ${valor}`);
};

const cuenta = (aguja) => pagina.split(aguja).length - 1;

// ── 1. Confirmar antes de cambiar ───────────────────────────────────────────
const elegir = pagina.slice(
  pagina.indexOf("const elegir = (opcion: OpcionDeSelector)"),
  pagina.indexOf("const elegir = (opcion: OpcionDeSelector)") + 400
);
comprobar(
  "elegir otra cuenta pide confirmación dentro de la página",
  /setPorConfirmar\(opcion\)/.test(elegir),
  "sí"
);
comprobar(
  "elegir la que ya está activa no hace nada",
  /if \(opcion\.activa\) return;/.test(elegir),
  "sí"
);
comprobar(
  "se puede cancelar sin cambiar nada",
  /setPorConfirmar\(null\)/.test(pagina) && /Cancelar/.test(pagina),
  "sí"
);

// ── 2. Los tres selectores existen y activan lo que toca ────────────────────
for (const [nombre, aguja] of [
  ["página", "onElegir={(pageId) => void activate(pageId)}"],
  ["número", "onElegir={(phoneNumberId) => void activateWhatsApp(phoneNumberId)}"],
  ["pixel", "onElegir={(pixelId) => void guardarPixel(pixelId)}"],
]) {
  comprobar(
    `el selector de ${nombre} activa lo que corresponde`,
    cuenta(aguja) === 1,
    "sí"
  );
}

// ── 3. Las fotos ────────────────────────────────────────────────────────────
comprobar(
  "la página usa su foto de perfil pública",
  /graph\.facebook\.com\/\$\{conn\.pageId\}\/picture/.test(pagina),
  "sí"
);
comprobar(
  "el número usa la foto de perfil que trae la API",
  /avataresWhatsApp\[connection\.phoneNumberId\]/.test(pagina),
  "sí"
);
comprobar(
  "si una foto no carga, queda el círculo con la inicial",
  /onError=\{\(\) => setFallo\(true\)\}/.test(pagina),
  "sí"
);
comprobar(
  "sin foto también se dibuja el círculo",
  /if \(foto && !fallo\)/.test(pagina),
  "sí"
);

// ── 4. La marca de cuál está activa ─────────────────────────────────────────
comprobar(
  "se marca cuál está activa, en el botón y en la lista",
  cuenta(">\n                  Activa\n                </span>") +
    cuenta("Activa") >= 2,
  "sí"
);

// ── 5. Traer las fotos no puede romper la pantalla ──────────────────────────
comprobar(
  "un número sin foto o con token vencido no deja sin fotos a los demás",
  /\} catch \{/.test(avatares) && /Promise\.all/.test(avatares),
  "sí"
);
comprobar(
  "la URL de la foto no se guarda (caduca)",
  !/setMetaRuntimeSettings|INSERT|saveMeta/.test(avatares),
  "no se guarda"
);

// ── 6. El buscador de la lista ──────────────────────────────────────────────
comprobar(
  "hay un buscador dentro del desplegable",
  /Buscar por nombre o número…/.test(pagina) &&
    /contentEditable/.test(pagina),
  "sí"
);
comprobar(
  "busca sin tildes ni mayúsculas",
  /normalize\("NFD"\)[\s\S]{0,80}?replace\(\/\\p\{Mn\}\/gu, ""\)/.test(pagina),
  "sí"
);
comprobar(
  "busca también en el subtítulo, no solo en el nombre",
  /opcion\.titulo\} \$\{opcion\.subtitulo \?\? ""\}/.test(pagina),
  "sí"
);
comprobar(
  "el buscador solo aparece si la lista es larga",
  /opciones\.length > 5 \?/.test(pagina),
  "más de 5"
);
comprobar(
  "si nada coincide, lo dice en vez de mostrarse vacío",
  /Nada coincide con/.test(pagina),
  "sí"
);
// Lo buscado se limpia al abrir, al cerrar y al elegir: si no, al volver a
// abrir aparecería media lista escondida por una búsqueda de hace rato.
comprobar(
  "lo buscado se limpia al abrir, cerrar y elegir",
  (pagina.match(/setBusqueda\(""\)/g) ?? []).length >= 3,
  `${(pagina.match(/setBusqueda\(""\)/g) ?? []).length} sitios`
);

// ── 7. Nada de cambiar un estado dentro del cálculo de otro ─────────────────
//
// Un setState dentro de la función que calcula OTRO estado hace que el
// desplegable se abra y se cierre solo: React puede ejecutar esa función más de
// una vez, y cada vez invertía el valor. Cuesta horas de encontrar, así que se
// vigila.
const impuros = [
  ...pagina.matchAll(/set[A-Z]\w*\(\s*\([^)]*\)\s*=>\s*\{([\s\S]{0,400}?)\}\s*\)/g),
].filter(([, cuerpo]) => /\bset[A-Z]\w*\(/.test(cuerpo));

comprobar(
  "ningún cambio de estado dentro del cálculo de otro estado",
  impuros.length === 0,
  impuros.length === 0
    ? "limpio"
    : `${impuros.length} caso(s) — así se abría y cerraba solo el desplegable`
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
