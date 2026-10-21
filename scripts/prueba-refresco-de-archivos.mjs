// La foto de Drive se quedaba pegada para siempre.
//
// LO QUE PASABA
//
// El bot baja el archivo de Drive UNA vez, lo convierte al formato de Meta y
// guarda la copia en su disco con el id de Drive como nombre. A partir de ahi
// usaba esa copia siempre: no caducaba, no comprobaba nada, no la borraba nadie.
//
// Reemplazar la foto en Drive conservando el mismo enlace no servia de nada — el
// bot seguia mandando la vieja para siempre. La unica salida era cambiar el
// enlace en cada burbuja, a mano. Y la copia vive en el volumen persistente, asi
// que deployar tampoco la borraba.
//
// LO QUE AHORA
//
//  1. Antes de usar su copia, el bot le pide a Drive la FICHA del archivo —peso
//     y fecha— sin descargarlo. Si cambio, lo baja de nuevo. Cuesta unos cientos
//     de bytes; al lado de subir la foto a Meta no se nota.
//
//  2. Un boton ↻ al lado de la etiqueta del enlace borra la copia a mano, para
//     el caso raro que la ficha no ve —una foto nueva que pese EXACTAMENTE lo
//     mismo— y para cuando hay prisa.
//
//  3. Ese boton tambien refresca la miniatura del editor. Google la manda con
//     "cache-control: max-age=86400", asi que el navegador la guarda 24 HORAS:
//     por eso a veces se actualizaba sola (se habia cumplido el dia) y otras no.
//     Con una marca pegada al enlace, para el navegador es otra direccion.
//
// LO QUE NO SE TOCA
//
// La subida a Meta sigue igual, en cada envio, como pidio Alberto.
//
//   node scripts/prueba-refresco-de-archivos.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const drive = leer("src", "lib", "workflow", "drive.ts");
const api = leer("src", "app", "api", "editor", "refrescar-media", "route.ts");
const editor = leer("src", "app", "editor", "page.tsx");
const sender = leer("src", "lib", "workflow", "sender.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. La ficha del archivo ─────────────────────────────────────────────────
comprobar(
  "el bot pide la ficha del archivo sin bajarlo",
  /method: "HEAD"/.test(drive) &&
    /content-length/.test(drive) &&
    /last-modified/.test(drive),
  "peso y fecha"
);
comprobar(
  // ESTE es el fallo original: devolvia la copia sin preguntar nada.
  "y la compara antes de usar la copia guardada",
  /const huellaAhora = await huellaDeDrive\(fileId\);\s*\r?\n\s*const huellaGuardada = leerHuella\(absReady\);/.test(
    drive
  ),
  "sí"
);
comprobar(
  "si cambió, la baja de nuevo",
  /if \(!huellaAhora \|\| huellaAhora === huellaGuardada\) \{/.test(drive),
  "sí"
);
comprobar(
  // Que la comprobación falle NO puede dejar a un cliente sin su foto. Si Drive
  // no contesta se usa la copia igual.
  "si Drive no contesta, se usa la copia igual",
  /Devuelve null si Drive no contesta/.test(drive) &&
    /catch \{\s*\r?\n\s*return null;/.test(drive),
  "nunca se queda mudo"
);
comprobar(
  // Guardarla antes de convertir dejaría una ficha diciendo "al día" sobre una
  // copia que no llegó a existir.
  "la ficha se guarda DESPUÉS de convertir",
  /guardarHuella\(absReady, \(await huellaDeDrive\(fileId\)\) \?\? ""\);/.test(
    drive
  ),
  "sí"
);

// ── 2. El botón ↻ ───────────────────────────────────────────────────────────
comprobar(
  "hay una forma de olvidar la copia a mano",
  /export function olvidarCopiaDeDrive\(driveUrl: string\): number \{/.test(drive),
  "sí"
);
comprobar(
  // El mismo id puede estar guardado como .jpg y como .mp4 si alguien cambió el
  // selector de tipo. Borrar solo uno dejaría el otro pegado.
  "borra el archivo en cualquier formato",
  /if \(!nombre\.startsWith\(`\$\{fileId\}\.`\)\) continue;/.test(drive),
  "todos"
);
comprobar(
  "el editor tiene a quién pedírselo",
  /export async function POST\(req: NextRequest\)/.test(api) &&
    /olvidarCopiaDeDrive\(url\)/.test(api),
  "sí"
);
comprobar(
  "y el botón está al lado de la etiqueta del enlace",
  /<BotonDeRefrescoDeMedia url=\{step\.drive_url\} \/>/.test(editor),
  "↻"
);
comprobar(
  "sin texto, solo la flecha",
  /\{estado === "listo" \? "✓" : "↻"\}/.test(editor),
  "sí"
);
comprobar(
  "y no sale si la burbuja aún no tiene enlace",
  /if \(!limpio\) return null;/.test(editor),
  "oculto"
);

// ── 3. La miniatura del editor ──────────────────────────────────────────────
comprobar(
  // El navegador la guarda 24 horas. Sin cambiar el enlace, no la vuelve a pedir.
  "la miniatura acepta una marca de refresco",
  /function driveThumb\(url: string, marca\?: number\): string \| null \{/.test(
    editor
  ) && /const refresco = marca \? `&v=\$\{marca\}` : "";/.test(editor),
  "sí"
);
comprobar(
  // Sin marca el enlace es el de siempre y el navegador reutiliza su copia, que
  // es lo que se quiere el 99% del tiempo.
  "y sin marca el enlace queda como estaba",
  /marca \? `&v=\$\{marca\}` : ""/.test(editor),
  "intacto"
);
comprobar(
  "el visor usa la marca del archivo que dibuja",
  /driveThumb\(s\.drive_url, marcasDeMedia\.marcaDe\(s\.drive_url\)\)/.test(
    editor
  ),
  "sí"
);
comprobar(
  // El botón está en el editor y la miniatura en el visor: son dos ramas
  // distintas del árbol.
  "botón y visor se hablan por contexto",
  /const MarcasDeMediaContext = createContext</.test(editor) &&
    /<MarcasDeMediaContext\.Provider value=\{marcasDeMedia\}>/.test(editor),
  "sí"
);

// ── 4. Lo que NO se toca ────────────────────────────────────────────────────
comprobar(
  // Alberto lo pidió expresamente: la subida a Meta se queda como está.
  "la subida a Meta sigue en cada envío",
  /const \{ media_id \} = await uploadMediaToMeta\(ready\.abs_path, ready\.mime\);/.test(
    sender
  ),
  "intacta"
);

// ── 5. Comprobación en vivo (informativa, no falla la prueba) ───────────────
//
// Si Google dejara de mandar el peso y la fecha, la ficha se quedaría vacía y el
// bot volvería a usar su copia siempre. Aquí se ve al momento.
const idDePrueba = "1W9EB00_FLrgYRwqPwj7eef09Gn2yfqQU";
try {
  const res = await fetch(
    `https://drive.google.com/uc?export=download&id=${idDePrueba}`,
    { method: "HEAD", redirect: "follow" }
  );
  const peso = res.headers.get("content-length");
  const fecha = res.headers.get("last-modified");
  console.log(
    `\n(en vivo) Drive contesta peso=${peso ?? "-"} fecha=${fecha ?? "-"} → ${
      peso || fecha ? "la ficha sirve" : "SIN FICHA: el bot usaría su copia siempre"
    }`
  );
} catch {
  console.log("\n(en vivo) sin conexión — no se pudo comprobar, no cuenta");
}

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
