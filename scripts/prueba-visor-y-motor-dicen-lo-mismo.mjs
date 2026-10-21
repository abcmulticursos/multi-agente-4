// El visor enseñaba el comodin crudo y al cliente le llegaba bien.
//
// Paso de verdad, y por mi culpa: al renombrar el segundo producto a
// {{PRODUCTO_SECUNDARIO}} lo agregue al MOTOR y me olvide del VISOR. Resultado:
// 125 textos mostrando "{{PRODUCTO_SECUNDARIO}}" en la vista previa mientras el
// mensaje real salia correcto.
//
// LA CAUSA ESTRUCTURAL, que no se va a ir sola:
//
// El visor y el motor son DOS programas distintos haciendo el mismo trabajo. El
// visor resuelve los comodines dentro del editor; el motor los resuelve al
// enviar. Nadie obliga a que coincidan. Cada vez que se agrega un comodin hay
// que tocar los dos, y olvidarse de uno no rompe nada visible hasta que alguien
// mira la pantalla equivocada.
//
// Los dos sintomas son malos y uno es peligroso:
//   - solo en el motor  -> lo ves crudo en el visor, al cliente le llega bien
//   - solo en el visor  -> lo ves bien en el visor y AL CLIENTE LE LLEGA CRUDO
//
// Esta prueba compara las dos listas. Si alguien agrega un comodin en uno y no
// en el otro, se pone en rojo antes de que salga a un cliente.
//
//   node scripts/prueba-visor-y-motor-dicen-lo-mismo.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

// Todo lo que resuelve de cara al cliente: el motor, el emisor y el cerebro.
const motor = [
  ["src", "lib", "workflow", "engine.ts"],
  ["src", "lib", "workflow", "config.ts"],
  ["src", "lib", "workflow", "sender.ts"],
  ["src", "lib", "openrouter.ts"],
]
  .map((p) => leer(...p))
  .join("\n");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

/**
 * Los nombres que aparecen DENTRO de una expresion de reemplazo.
 *
 * OJO: solo cuentan los que estan en un `.replace(/.../)`. La primera version de
 * esto contaba tambien los del catalogo — las entradas `token: "{{X}}"` — y por
 * eso dio un "todo bien" falso justo cuando el visor estaba roto. Un comodin
 * que solo esta en la lista no lo resuelve nadie.
 */
const zonasDeReemplazo = (texto) => {
  // En vez de intentar leer la expresion regular —que en este proyecto se
  // escribe de cuatro formas distintas y me hizo fallar dos veces—, se recorta
  // un trozo despues de cada `.replace(` y de cada PLACEHOLDER, y se busca el
  // nombre del comodin ahi dentro. Tosco, pero no se le escapa ninguna forma.
  const trozos = [];
  for (const marca of [".replace(", "PLACEHOLDER = "]) {
    let desde = 0;
    for (;;) {
      const i = texto.indexOf(marca, desde);
      if (i < 0) break;
      trozos.push(texto.slice(i, i + 400));
      desde = i + marca.length;
    }
  }
  return trozos.join("\n").toLowerCase();
};

const resuelve = (zonas, token) => {
  // El nombre, rodeado de algo que no sea letra/numero/guion bajo: asi
  // "producto" no cuenta como encontrado dentro de "producto_upsell".
  return new RegExp(`(^|[^a-z0-9_])${token.toLowerCase()}([^a-z0-9_]|$)`).test(
    zonas
  );
};

const zonasMotor = zonasDeReemplazo(motor);
const zonasVisor = zonasDeReemplazo(editor);
const delMotor = { has: (t) => resuelve(zonasMotor, t) };
const delVisor = { has: (t) => resuelve(zonasVisor, t) };

// El catalogo: lo que el editor te OFRECE al escribir {{. Los ocultos no
// cuentan — no se proponen, asi que nadie los va a escribir de nuevo.
const catalogo = [];
for (const m of editor.matchAll(
  /token:\s*"\{\{([A-Z0-9_]+)\}\}",(\s*\r?\n\s*oculto: true,)?/g
)) {
  if (!m[2]) catalogo.push(m[1]);
}

comprobar(
  "el catalogo tiene comodines",
  catalogo.length > 20,
  `${catalogo.length} ofrecidos`
);

const soloMotor = catalogo.filter((t) => delMotor.has(t) && !delVisor.has(t));
const soloVisor = catalogo.filter((t) => delVisor.has(t) && !delMotor.has(t));
const ninguno = catalogo.filter((t) => !delVisor.has(t) && !delMotor.has(t));

comprobar(
  // Sintoma: lo escribes, en la vista previa ves la llave, y no sabes si esta
  // bien o mal hasta que se lo mandas a un cliente.
  "el visor resuelve todos los que el editor ofrece",
  soloMotor.length === 0,
  soloMotor.length ? soloMotor.join(", ") : "ninguno se queda crudo"
);
comprobar(
  // Sintoma PEOR: lo ves bien en el visor y le llega crudo al cliente.
  "el motor resuelve todos los que el editor ofrece",
  soloVisor.length === 0,
  soloVisor.length ? soloVisor.join(", ") : "ninguno llega crudo"
);
comprobar(
  "ninguno se ofrece sin que lo resuelva alguien",
  ninguno.length === 0,
  ninguno.length ? ninguno.join(", ") : "todos tienen dueño"
);

// ── Los nombres del segundo producto, uno por uno ──────────────────────────
//
// Son la familia que ya se rompio, asi que se comprueban con nombre y apellido
// en los dos sitios.
for (const token of [
  "PRODUCTO",
  "PRODUCTO2",
  "PRODUCTO_SECUNDARIO",
  "PRODUCTO_COMPLEMENTARIO",
  "PRODUCTO_BASE",
  "PRODUCTO_FULL",
  "PRODUCTO_UPSELL",
]) {
  comprobar(
    `{{${token}}} lo resuelven los dos`,
    delMotor.has(token) && delVisor.has(token),
    `motor:${delMotor.has(token) ? "sí" : "NO"} visor:${delVisor.has(token) ? "sí" : "NO"}`
  );
}

console.log(
  fallos === 0
    ? "\nTODO OK — lo que ves en el visor es lo que le llega al cliente"
    : `\n${fallos} FALLA(S)`
);
process.exit(fallos === 0 ? 0 : 1);
