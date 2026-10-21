// SIN CLASIFICAR NO ES CALIDAD BAJA.
//
// LO VIO EL DUEÑO el 1 de octubre de 2026, al conectar un número recién sacado:
// «¿todos los números nuevos que se conectan a API aparecerán con calidad baja?
// acabo de conectar uno nuevecito de paquete y sale así».
//
// NO ERA EL NÚMERO: ERA LA PANTALLA. Meta devuelve `UNKNOWN` mientras un número no
// tiene historial —no ha mandado nada, así que no hay nada que calificar— y la chapa
// mandaba TODO lo que no fuera verde o amarillo a «Baja»: punto rojo, letra roja, y
// este consejo al pasar por encima:
//
//     «Riesgo de bloqueo: recomendamos desactivar 1 seguimiento»
//
// O sea que le aconsejaba apagar un seguimiento —perder recuperación de ventas— por
// un número que no había enviado ni un mensaje.
//
// POR QUÉ ESTO VALE UNA PRUEBA: un aviso que asusta cuando no pasa nada es peor que
// no avisar. Enseña a ignorar los avisos, y el día que la calidad baje DE VERDAD ya
// nadie los mira. El rojo tiene que seguir significando rojo.
//
//   node scripts/prueba-sin-clasificar-no-es-calidad-baja.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const chapa = readFileSync(
  join(RAIZ, "src", "components", "QualityBadge.tsx"),
  "utf8"
);
const cliente = readFileSync(join(RAIZ, "src", "lib", "meta", "client.ts"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// Se EJECUTA la misma decisión de la chapa, extraída de su código. No se
// reimplementa de memoria: se copian las tres líneas que deciden.
const decidir = (quality) => {
  const value = quality?.toUpperCase();
  if (!value) return null;
  const isGreen = value === "GREEN";
  const isYellow = value === "YELLOW";
  const sinClasificar = !isGreen && !isYellow && value !== "RED";
  return isGreen
    ? "Alta"
    : isYellow
      ? "Media"
      : sinClasificar
        ? "Sin clasificar"
        : "Baja";
};

// ── 1. CADA VALOR DE META, SU ETIQUETA ──────────────────────────────────────
console.log("\n— 1. lo que dice Meta y lo que se enseña —\n");
comprobar("GREEN  → Alta", decidir("GREEN") === "Alta");
comprobar("YELLOW → Media", decidir("YELLOW") === "Media");
comprobar("RED    → Baja", decidir("RED") === "Baja", "el rojo sigue siendo rojo");
// EL CASO QUE LO PUSO AQUÍ.
comprobar(
  "UNKNOWN → Sin clasificar",
  decidir("UNKNOWN") === "Sin clasificar",
  "el número nuevo de paquete"
);
comprobar("NA → Sin clasificar", decidir("NA") === "Sin clasificar");
comprobar(
  "minúsculas también",
  decidir("unknown") === "Sin clasificar" && decidir("green") === "Alta"
);
comprobar("sin valor no se pinta nada", decidir(null) === null);
// Un valor que Meta añada mañana no puede salir como «Baja»: inventarle una mala
// calificación a un dato que no entendemos es justo el fallo que esto tenía.
comprobar(
  "un valor nuevo de Meta NO sale como Baja",
  decidir("ALGO_QUE_META_INVENTE") === "Sin clasificar",
  "lo prudente"
);

// ── 2. EL CONSEJO DE APAGAR UN SEGUIMIENTO, SOLO EN ROJO ────────────────────
//
// Es la parte que costaba ventas: ese consejo salía con un número nuevo.
console.log("\n— 2. el consejo solo cuando toca —\n");
comprobar(
  "el aviso de riesgo sigue existiendo",
  /Riesgo de bloqueo: recomendamos desactivar 1 seguimiento/.test(chapa),
  "para el rojo de verdad"
);
comprobar(
  "y NO se da sin clasificar",
  /sinClasificar\s*\r?\n?\s*\? "Meta todavía no lo califica/.test(chapa),
  "ahí se explica, no se asusta"
);
comprobar(
  "el texto dice que no es mala calificación",
  /No es una mala calificación/.test(chapa),
  "con esas palabras"
);
comprobar(
  "y sin clasificar se pinta neutro, no rojo",
  /sinClasificar\s*\r?\n?\s*\? "bg-neutral-400"/.test(chapa)
);

// ── 3. EL VALOR VIENE DE META, TAL CUAL ─────────────────────────────────────
//
// Si alguien lo tradujera antes de llegar aquí, habría dos verdades.
console.log("\n— 3. el dato es de Meta, sin tocar —\n");
comprobar(
  "se pide a la Graph API",
  /fields=display_phone_number,verified_name,quality_rating/.test(cliente),
  "quality_rating"
);

console.log(
  fallos === 0
    ? "\nTODO OK — un número nuevo sale «Sin clasificar», y el rojo sigue siendo rojo\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
