// EL COMPROBANTE SE APRUEBA POR EL PRIMER NOMBRE DEL TITULAR, NO POR EL APELLIDO.
//
// LO QUE PASÓ — 29 de septiembre de 2026. El dueño mandó a una conversación de
// Perú un comprobante que NO era suyo y el bot lo aprobó. Al medirlo aparecieron
// dos agujeros distintos; éste es el del nombre.
//
// La regla comparaba CUALQUIER parte del nombre configurado —nombre o apellido—
// y le bastaba con que una coincidiera. Con «Alberto Salinas» escrito en Precios
// y pagos, un comprobante a nombre de «Jose Salinas» se aprobaba: el apellido
// alcanzaba. Cualquier homónimo de apellido cobraba por él.
//
// LO QUE PIDIÓ, con sus palabras: «si pongo 1 nombre y un apellido, o 2 nombres o
// más cosas, que reconozca para aprobación solo el primer nombre, punto».
//
// LO QUE NO SE PUEDE PERDER, y por eso está aquí:
//
//   · Yape y Plin TRUNCAN el apellido («Alberto S***», «Alberto Sal*»). Si el
//     arreglo exigiera el nombre entero, dejaría fuera a todos los clientes de
//     Yape — que son la mayoría.
//   · BCP y transferencia NO miran el nombre. Eso se queda como estaba: el dueño
//     lo dijo expreso el mismo día.
//   · Y la trampa del orden: el filtro de longitud va ANTES del recorte. Al revés,
//     un nombre que empiece por una palabra corta deja la lista VACÍA, y una
//     lista vacía APRUEBA A CUALQUIERA.
//
//   node scripts/prueba-el-primer-nombre-aprueba.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const pago = readFileSync(join(RAIZ, "src", "lib", "workflow", "payment.ts"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── 1. LA REGLA SIGUE VIVIENDO SOLO EN LA RAMA DE YAPE/PLIN ─────────────────
console.log("\n— 1. el nombre solo se revisa en billeteras —\n");
comprobar(
  "la revision entra solo con yape o plin",
  /if \(args\.payment_method === "yape" \|\| args\.payment_method === "plin"\) \{/.test(
    pago
  ),
  "sin bcp ni transferencia"
);
comprobar(
  "y queda escrito que en banco no se mira",
  /Para BCP\/transferencia: solo el monto se valida/.test(pago)
);

// ── 2. SE USA SOLO LA PRIMERA PALABRA, Y EL ORDEN ES EL CORRECTO ────────────
console.log("\n— 2. del nombre configurado, solo la primera palabra —\n");
const zona = pago.slice(
  pago.indexOf("const expectedTokens = normalizeName(expectedPrefix)"),
  pago.indexOf("const nameMatches =")
);
comprobar("la zona existe", zona.length > 40, `${zona.length} letras`);
comprobar(
  "se recorta a la primera palabra",
  /\.slice\(0, 1\)/.test(zona),
  "slice(0, 1)"
);
comprobar(
  "el filtro de longitud va ANTES del recorte",
  zona.indexOf("filter((t) => t.length >= 3)") < zona.indexOf(".slice(0, 1)"),
  "si no, la lista queda vacia y aprueba a cualquiera"
);
comprobar(
  "la red de «lista vacia = no se revisa» sigue en pie",
  /expectedTokens\.length === 0 \|\|/.test(pago),
  "sin nombre configurado, no se revisa"
);
comprobar(
  "sin nombre visible sigue rechazando",
  /if \(expectedPrefix && !got\) \{/.test(pago)
);

// ── 3. LA REGLA, EJECUTADA CONTRA CASOS REALES ──────────────────────────────
//
// No se reimplementa: se extrae el texto EXACTO del archivo y se ejecuta. Si
// alguien la cambia, esto se entera.
console.log("\n— 3. la regla de verdad, ejecutada —\n");
const desde = pago.indexOf("const normalizeName = (s: string): string =>");
const hasta = pago.indexOf("if (expectedPrefix && !nameMatches)");
comprobar("se pudo extraer la regla del archivo", desde > 0 && hasta > desde);

if (desde > 0 && hasta > desde) {
  const decide = new Function(
    "expectedPrefix",
    "got",
    `${pago.slice(desde, hasta).replace(/: string/g, "")} return nameMatches;`
  );
  // Nombres inventados a proposito: si esta prueba usara los suyos, taparia
  // justo el fallo que la regla de la casa evita.
  const CASOS = [
    ["Ramiro Ledesma", "Ramiro Ledesma", true, "el titular, completo"],
    ["Ramiro Ledesma", "Ramiro L***", true, "la billetera oculta el apellido"],
    ["Ramiro Ledesma", "Ramiro Led*", true, "apellido cortado"],
    ["Ramiro Ledesma", "Ramiro", true, "solo el primer nombre"],
    ["Ramiro Ledesma", "RAMIRO LEDESMA", true, "en mayusculas"],
    ["Ramiro Ledesma", "Ramíro Ledesma", true, "con tilde"],
    ["Ramiro Ledesma", "ramiro ledesma g", true, "con segundo apellido"],
    ["Ramiro Ledesma", "Tomas Ledesma", false, "OTRA persona, mismo apellido"],
    ["Ramiro Ledesma", "Ledesma", false, "solo el apellido"],
    ["Ramiro Ledesma", "Nadia Quispe", false, "otra persona"],
    // Lo escrito con adornos tiene que seguir funcionando: se limpian aparte.
    ["*Ramiro*", "Ramiro", true, "con asteriscos alrededor"],
    ["*Ramiro*", "Tomas Ledesma", false, "con asteriscos, otro"],
    // Una palabra corta delante no puede vaciar la lista.
    ["De Ramiro Ledesma", "Ramiro Ledesma", true, "empieza por palabra corta"],
    ["De Ramiro Ledesma", "Nadia Quispe", false, "empieza por palabra corta, otro"],
  ];
  for (const [cfg, recibido, esperado, nota] of CASOS) {
    const r = decide(cfg.toLowerCase(), recibido.toLowerCase());
    comprobar(
      `«${cfg}» vs «${recibido}» -> ${esperado ? "aprueba" : "rechaza"}`,
      r === esperado,
      nota
    );
  }
}

console.log(
  fallos === 0
    ? "\nTODO OK — aprueba por el primer nombre, y el apellido ya no abre la puerta\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
