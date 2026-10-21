// AVISAR CUANDO EL ARCHIVO DE DRIVE ESTÁ RESTRINGIDO, SIN FALSAS ALARMAS.
//
// LO QUE PIDIÓ EL DUEÑO — 21 de septiembre de 2026, con sus palabras:
//
//   «Acabo de ver que agregué una imagen y no cargaba, y era porque la imagen
//    de Drive estaba restringida. ¿Hay manera de avisar que está restringida, y
//    QUE NO SEA FALSA ALARMA?»
//
//   Y sobre cómo enseñarlo: «que en vez de imagen diga que el archivo está
//   restringido, que vaya a Drive y lo comparta».
//
// CÓMO SE SABE, Y POR QUÉ ES FIABLE. No se adivina por la dirección: se le pide
// el archivo a Drive y se mira qué contesta. Un archivo compartido devuelve la
// imagen; uno restringido te manda a iniciar sesión.
//
// LA TRAMPA QUE HABÍA QUE ESQUIVAR, y es la mitad del encargo: un archivo
// PÚBLICO pero GRANDE también devuelve una página web — la del aviso de
// antivirus de Drive. Si se avisara por «me llegó una página web», ese caso
// daría falsa alarma, y un aviso que se equivoca deja de creerse.
//
// Por eso solo se avisa con dos señales que no admiten otra lectura: que Drive
// conteste 401/403, o que acabe mandando a `accounts.google.com`. Todo lo demás
// se queda en «no lo sé», que no asusta a nadie.
//
// ESTA PRUEBA SACA LA CONDICIÓN DEL ARCHIVO Y LA EJECUTA con las respuestas que
// Drive da de verdad. Comprobar que el texto del aviso está escrito no diría
// nada sobre cuándo salta.
//
//   node scripts/prueba-el-aviso-de-archivo-restringido.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const ruta = readFileSync(
  join(RAIZ, "src", "app", "api", "editor", "media-kind", "route.ts"),
  "utf8"
).replace(/\r\n/g, "\n");
const editor = readFileSync(
  join(RAIZ, "src", "app", "editor", "page.tsx"),
  "utf8"
).replace(/\r\n/g, "\n");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── LA CONDICIÓN REAL, EJECUTADA ───────────────────────────────────────────
console.log("— la condición que decide, sacada del archivo —\n");

const condicion = (ruta.match(
  /if \((res\.status === 401 \|\| res\.status === 403 \|\| \(esHtml && teMandaAIniciarSesion\))\) \{/
) ?? [])[1];
comprobar("se encuentra la condición", !!condicion, condicion ?? "—");

// Hasta el FINAL DE LÍNEA, no hasta el primer «;»: esta línea lleva un «;»
// dentro de las comillas y cortar ahí parte la expresión por la mitad.
const bloqueHtml = (ruta.match(/const esHtml = (.+);\n/) ?? [])[1];
const bloqueSesion = (ruta.match(
  /const teMandaAIniciarSesion = \(\(\) => \{([\s\S]*?)\}\)\(\);/
) ?? [])[1];
comprobar("se encuentra cómo mira el tipo de respuesta", !!bloqueHtml);
comprobar("se encuentra cómo mira a dónde acabó", !!bloqueSesion);

if (!condicion || !bloqueHtml || !bloqueSesion) {
  console.log("\nsin el código no se puede ejecutar nada. PARO.\n");
  process.exit(1);
}

const decidir = new Function(
  "res",
  "mime",
  `const esHtml = ${bloqueHtml};
   const teMandaAIniciarSesion = (() => {${bloqueSesion}})();
   return (${condicion}) ? "restringido" : "no aviso";`
);

// ── LOS CASOS QUE DA DRIVE DE VERDAD ───────────────────────────────────────
console.log("\n— cuándo SÍ hay que avisar —\n");

comprobar(
  "Drive contesta 403: te niega el archivo",
  decidir({ status: 403, url: "https://drive.google.com/uc?id=X" }, "text/html") ===
    "restringido"
);
comprobar(
  "Drive contesta 401: pide identificarse",
  decidir({ status: 401, url: "https://drive.google.com/uc?id=X" }, "text/html") ===
    "restringido"
);
comprobar(
  "acaba mandando a iniciar sesión",
  decidir(
    { status: 200, url: "https://accounts.google.com/v3/signin/identifier?x=1" },
    "text/html; charset=utf-8"
  ) === "restringido"
);

console.log("\n— y cuándo NO, que es lo que pidió —\n");

comprobar(
  "un archivo PÚBLICO GRANDE ← LA FALSA ALARMA",
  decidir(
    { status: 200, url: "https://drive.google.com/uc?id=X&confirm=t" },
    "text/html; charset=utf-8"
  ) === "no aviso",
  "el aviso de antivirus también es una página web"
);
comprobar(
  "una imagen normal",
  decidir({ status: 200, url: "https://drive.usercontent.google.com/download?id=X" }, "image/jpeg") ===
    "no aviso"
);
comprobar(
  "un video",
  decidir({ status: 206, url: "https://drive.usercontent.google.com/download?id=X" }, "video/mp4") ===
    "no aviso"
);
comprobar(
  "un PDF",
  decidir({ status: 200, url: "https://drive.usercontent.google.com/download?id=X" }, "application/pdf") ===
    "no aviso"
);
comprobar(
  "una respuesta rara que no dice nada claro",
  decidir({ status: 500, url: "https://drive.google.com/uc?id=X" }, "text/plain") ===
    "no aviso",
  "no saber no es lo mismo que estar restringido"
);
comprobar(
  "y una dirección rota no revienta la comprobación",
  decidir({ status: 200, url: "esto no es una direccion" }, "text/html") === "no aviso"
);

// ── SIN RESPUESTA NO SE AVISA ──────────────────────────────────────────────
console.log("\n— y si Drive no contesta —\n");

const rescate = (ruta.match(/\} catch \{\s*\n\s*\/\/[^\n]*\n\s*return NextResponse\.json\(\{ kind: "(\w+)"/) ?? [])[1];
comprobar(
  "sin internet o con Drive caído, se dice «no lo sé»",
  rescate === "unknown",
  `devuelve "${rescate}"`
);

// ── Y EN LA PANTALLA: EN VEZ DE LA IMAGEN, EL AVISO ────────────────────────
console.log("\n— lo que ve el dueño —\n");

comprobar(
  "el aviso se mira ANTES que el tipo de archivo",
  /if \(step\.type === "text" \|\| !step\.drive_url\.trim\(\)\) return null;[\s\S]{0,1400}?if \(resolvedKind === "restringido"\) \{/.test(
    editor
  ),
  "si no deja abrirlo, da igual si era imagen"
);
comprobar(
  "  dice que está restringido",
  /title: "El archivo está restringido en Drive"/.test(editor)
);
comprobar(
  "  y dice qué hacer en Drive",
  /Compartir.{0,40}Cualquier persona con el enlace/.test(editor),
  "no solo que está mal: cómo arreglarlo"
);
comprobar(
  "  en rojo, no en amarillo",
  /title: "El archivo está restringido en Drive",[\s\S]{0,400}?tone: "danger"/.test(
    editor
  )
);
comprobar(
  "la miniatura NO se dibuja cuando hay aviso",
  /const thumb =\s*\n?\s*!previewIssue &&/.test(editor),
  "por eso en el sitio de la foto sale el mensaje"
);
comprobar(
  "«restringido» no se cuela como si fuera un tipo de archivo",
  /type LinkMediaResolution = LinkMediaKind \| "loading" \| "restringido";/.test(
    editor
  ),
  "no compite con imagen, video o PDF"
);

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : `${fallos} EN ROJO`}\n`);
process.exit(fallos === 0 ? 0 : 1);
