// EL COMPROBANTE QUE VIENE EN PDF TIENE QUE VERSE.
//
// LO QUE PASO — 22 de septiembre de 2026
//
//   Una clienta pago y mando su comprobante como PDF. El bot lo rechazo:
//
//       comprobante REJECTED. Razon: el pago fue a "FLAVIO M.", pero debe
//       coincidir con "Franco robles"
//
//   El comprobante decia FRANCO NICOLAS ROBLES. El dueño tuvo que cerrar esa
//   venta a mano. Solo se arreglo cuando capturo la pantalla del PDF y se la
//   mando al bot como foto: aprobada al instante.
//
// POR QUE, CON LOS NUMEROS DELANTE
//
//   Las dos lecturas del MISMO comprobante, en su registro:
//
//       PDF   ->  prompt=501    -> rechazado
//       foto  ->  prompt=2707   -> aprobado
//
//   Google lo documenta: «Each document page is equivalent to 258 tokens». Una
//   pagina de PDF vale un solo cuadro; una foto se trocea en varios. El lector
//   vio el PDF con seis veces menos detalle, y en un comprobante de fondo
//   oscuro y letra fina eso basta para confundir un nombre.
//
//   Y ese techo no se levanta: la misma documentacion dice que no hay mejora
//   subiendo la resolucion de la pagina.
//
// LO QUE NO PUEDE VOLVER A PASAR
//
//   1. Que un comprobante en PDF llegue al lector como documento cuando dentro
//      solo hay una foto.
//   2. Que un PDF de banco CON texto pase por aqui: para esos, extraer su texto
//      es mejor que mirarlo, y es lo que hace el camino de siempre.
//   3. Que un PDF raro rompa la lectura. Si algo no encaja, se devuelve null y
//      se sigue como hoy.
//
//   node scripts/prueba-el-comprobante-en-pdf-se-ve.mjs
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import zlib from "node:zlib";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const RAIZ = process.cwd();
registerHooks({
  resolve(esp, ctx, next) {
    if (esp.startsWith("@/")) {
      const rel = esp.slice(2);
      const conExt = /\.[a-z]+$/.test(rel) ? rel : `${rel}.ts`;
      return {
        url: pathToFileURL(join(RAIZ, "src", conExt)).href,
        shortCircuit: true,
      };
    }
    return next(esp, ctx);
  },
});

const { imagenDentroDelPdf } = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "meta", "pdf-a-imagen.ts")).href
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

const carpeta = mkdtempSync(join(tmpdir(), "pruebapdf-"));

// ── Un PDF de mentira: una foto de 4x3 metida dentro, como los del telefono ──
function pdfConFoto(ancho, alto, canales) {
  const pixeles = Buffer.alloc(ancho * alto * canales);
  for (let i = 0; i < pixeles.length; i++) pixeles[i] = (i * 7) % 256;
  const flujo = zlib.deflateSync(pixeles);
  const color = canales === 3 ? "DeviceRGB" : "DeviceGray";
  const cabecera = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${ancho} /Height ${alto} /ColorSpace /${color} /BitsPerComponent 8 /Filter /FlateDecode /Length ${flujo.length} >>\nstream\n`;
  return {
    buf: Buffer.concat([
      Buffer.from(cabecera, "latin1"),
      flujo,
      Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1"),
    ]),
    pixeles,
  };
}

const guardar = (nombre, buf) => {
  const p = join(carpeta, nombre);
  writeFileSync(p, buf);
  return p;
};

// -- 1. SU PDF DE VERDAD -----------------------------------------------------
//
// El comprobante que rechazo el bot. Se busca donde el dueño lo dejo; si no
// esta, la prueba lo dice y sigue con los de mentira.
const SUYO = join(
  process.env.TEMP ?? tmpdir(),
  "claude",
  "C--Users-alberto",
  "bb935ca5-99d5-4ad8-930b-94428d01de3e",
  "scratchpad",
  "comprobante.pdf"
);
if (existsSync(SUYO)) {
  const foto = imagenDentroDelPdf(SUYO);
  comprobar(
    "de su comprobante de verdad sale una foto",
    !!foto,
    foto ? `${foto.ancho}x${foto.alto} ${foto.mime}` : "nada"
  );
  comprobar(
    "y es un PNG valido",
    !!foto &&
      foto.bytes.length > 1000 &&
      foto.bytes[0] === 0x89 &&
      foto.bytes.subarray(1, 4).toString("latin1") === "PNG",
    "firma correcta"
  );
  // LA FOTO TIENE QUE PESAR LO QUE PESA UNA FOTO. Si saliera un sello de 10x10
  // el lector seguiria sin ver nada.
  comprobar(
    "y es grande, no un sello",
    !!foto && foto.ancho >= 400 && foto.alto >= 400,
    foto ? `${foto.ancho}x${foto.alto}` : "-"
  );
} else {
  console.log(
    `····  su comprobante no esta en ${SUYO}, me salto esas tres\n`
  );
}

// -- 2. LOS DOS FORMATOS QUE SE SABEN SACAR ----------------------------------
const color = pdfConFoto(600, 800, 3);
const fotoColor = imagenDentroDelPdf(guardar("color.pdf", color.buf));
comprobar(
  "una foto en color sale entera",
  !!fotoColor && fotoColor.ancho === 600 && fotoColor.alto === 800,
  "600x800"
);
const gris = pdfConFoto(300, 400, 1);
const fotoGris = imagenDentroDelPdf(guardar("gris.pdf", gris.buf));
comprobar(
  "y una en blanco y negro tambien",
  !!fotoGris && fotoGris.ancho === 300 && fotoGris.alto === 400,
  "300x400"
);

// -- 3. LAS SALIDAS: SI ALGO NO ENCAJA, NO SE TOCA ---------------------------
//
// Esto es lo que impide que rompa nada. En todos estos casos devuelve null y el
// bot sigue por el camino de siempre.
comprobar(
  "un PDF CON texto no pasa por aqui",
  imagenDentroDelPdf(
    guardar(
      "contexto.pdf",
      Buffer.from(
        "%PDF-1.4\n1 0 obj\n<< /Font << /F1 5 0 R >> >>\nendobj\n%%EOF",
        "latin1"
      )
    )
  ) === null,
  "su texto se extrae mejor"
);
comprobar(
  "un PDF sin imagenes tampoco",
  imagenDentroDelPdf(
    guardar("vacio.pdf", Buffer.from("%PDF-1.4\n%%EOF", "latin1"))
  ) === null,
  "nada que sacar"
);
comprobar(
  "un archivo que ni existe no revienta",
  imagenDentroDelPdf(join(carpeta, "no-existe.pdf")) === null,
  "devuelve null"
);
// BYTES QUE NO CUADRAN CON EL TAMAÑO DECLARADO: el flujo trae algo mas y
// dibujarlo daria una imagen rota. Mejor no tocarlo.
const roto = pdfConFoto(600, 800, 3);
const mentira = roto.buf
  .toString("latin1")
  .replace("/Width 600", "/Width 599");
comprobar(
  "si los bytes no cuadran, no se inventa nada",
  imagenDentroDelPdf(
    guardar("roto.pdf", Buffer.from(mentira, "latin1"))
  ) === null,
  "se sigue como hoy"
);

// -- 4. LA MAS GRANDE GANA ---------------------------------------------------
//
// Un comprobante puede traer el logo del banco como segunda imagen. La que
// importa es la del comprobante.
const grande = pdfConFoto(800, 1000, 3);
const chica = pdfConFoto(40, 40, 3);
const dos = Buffer.concat([
  grande.buf.subarray(0, grande.buf.length - 7),
  chica.buf.subarray(chica.buf.indexOf("4 0 obj")),
]);
const elegida = imagenDentroDelPdf(guardar("dos.pdf", dos));
comprobar(
  "con dos imagenes, se queda la grande",
  !!elegida && elegida.ancho === 800,
  elegida ? `${elegida.ancho}x${elegida.alto}` : "nada"
);

// -- 5. Y EL MOTOR LA ENSEÑA COMO FOTO ---------------------------------------
const modelo = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8");
comprobar(
  "el lector recibe una imagen, no un documento",
  /imagenDentroDelPdf\(resolveMediaAbsPath\(m\.media_url\)\)/.test(modelo) &&
    /type: "image_url"[\s\S]{0,200}?foto\.mime/.test(modelo),
  "image_url"
);
comprobar(
  "y si no se puede sacar, sigue mandando el PDF",
  /type: "file"[\s\S]{0,200}?file_data: pdfUrl/.test(modelo),
  "el camino de siempre"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el comprobante en PDF se ve como una foto"
    : `\n${fallos} FALLO(S)`
);
process.exit(fallos === 0 ? 0 : 1);
