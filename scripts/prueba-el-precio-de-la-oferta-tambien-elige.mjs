// «QUIERO EL DE 5000» TIENE QUE ELEGIR, AUNQUE 5000 SEA EL PRECIO DE OFERTA.
//
// LO QUE PASO — 26 de septiembre de 2026, su prueba HOLAARG3, y es de las caras.
// El cliente estaba en etapa de descuento. El bot le escribio, con sus propias
// letras, la opcion barata con su importe promocional:
//
//     📖 Opcion 2 — <la opcion barata> → $5.000 ARS
//
// Habia elegido el full ($9.000) y pago $5.000, asi que el bot le pidio la
// diferencia. El contesto «quiero el de 5000» — o sea, el precio que el propio
// bot acababa de escribirle— y NO SE RECONOCIO. Esta puerta solto el turno, lo
// cogio el modelo, y el modelo se invento dos cosas que no existen en el codigo:
// que el enlace «ya se habia enviado» y que «no se me permite reenviarlo».
//
// El cliente termino escribiendo «no me ha llegado estafador» a un bot que tenia
// su pago cobrado y su producto sin entregar. Solo salio de ahi por casualidad,
// al NOMBRAR el producto — ese camino si funcionaba; el del precio, no.
//
// POR QUE NO CALZABA. La eleccion por cifra comparaba contra las cajas de la
// oferta, donde viven los precios GLOBALES. Los suyos viven en la ficha, POR
// PAIS, y ademas estaba en oferta: 5000 era el promocional de Argentina y no
// estaba en ninguna de las dos cajas. Es la caja que un camino llena y otro no
// lee — el fallo que mas veces ha costado dinero en este proyecto.
//
// LO MEDIDO ANTES DE TOCAR NADA, ejecutando la funcion:
//
//     «quiero el de 8000»   (el NORMAL)   → basico   ✅
//     «quiero el de 5000»   (el de OFERTA)→ NADA     ❌  ← la venta perdida
//
// LO QUE NO PUEDE ROMPERSE:
//
//   · LAS DOS COMPARACIONES DE SIEMPRE DECIDEN PRIMERO, letra por letra. Lo
//     nuevo va el ULTIMO y solo contesta donde antes no contestaba nadie.
//   · LA AMBIGÜEDAD SIGUE SIN DECIDIR: si la cifra vale para las dos opciones,
//     no elige ninguna. Elegir a medias cobra el precio que no era.
//   · SIN TELEFONO, COMO ANTES. Quien no lo pase —las pruebas, la
//     reconciliacion del comprobante— lee el pais por defecto, igual que hoy.
//
//   node scripts/prueba-el-precio-de-la-oferta-tambien-elige.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { stringify as aYaml } from "yaml";

const RAIZ = process.cwd();
const DOBLE = "stub:db";
registerHooks({
  resolve(esp, ctx, next) {
    if (esp === "@/lib/db")
      return { url: DOBLE, format: "module", shortCircuit: true };
    if (esp.startsWith("@/")) {
      const rel = esp.slice(2);
      const conExt = /\.[a-z]+$/.test(rel) ? rel : `${rel}.ts`;
      return { url: pathToFileURL(join(RAIZ, "src", conExt)).href, shortCircuit: true };
    }
    return next(esp, ctx);
  },
  load(url, ctx, next) {
    if (url === DOBLE)
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export const getConversationByPhone = () => null;
          export const getConversationById = () => null;
          export const getFrozenPrices = () => null;
          export const getUpsellFrozenPrices = () => null; export const getPuestoEnLaFila = () => null; export const leerCompradosDeLaFila = () => []; export const moverLaFila = () => {};
          export const setFrozenPrices = () => {};
        `,
      };
    return next(url, ctx);
  },
});

const CARO = "PACK TORNADO 2 EN 1";
const BARATO = "CANELA SIMPLE";
const CASA = mkdtempSync(join(tmpdir(), "precio-oferta-"));
mkdirSync(join(CASA, "config"), { recursive: true });
const ARCHIVO = join(CASA, "config", "intro-data.yaml");
let reloj = 1_700_000_000;
const montar = (fichaBase, fichaFull) => {
  writeFileSync(
    ARCHIVO,
    aYaml({
      country: "PE",
      greeting: { body_variants: ["hola"] },
      intro_sequence: [{ type: "text", body_variants: ["la intro"] }],
      payment_responses: { yape: [{ type: "text", body_variants: ["datos"] }] },
      course_price_soles: fichaBase.price_soles,
      segunda_opcion_prestada: "dos_juntas",
      biblioteca_de_productos: [
        {
          id: "pb",
          name: BARATO,
          price_soles: fichaBase.price_soles,
          precios_por_pais: { PE: fichaBase },
        },
        {
          id: "pf",
          name: CARO,
          price_soles: fichaFull.price_soles,
          precios_por_pais: { PE: fichaFull },
        },
      ],
      lineal: { enabled: true },
      alineacion_por_modalidad: { lineal: { basico: "pb", unico: "pb", full: "pf" } },
    }),
    "utf8"
  );
  reloj += 60;
  const f = new Date(reloj * 1000);
  utimesSync(ARCHIVO, f, f);
};
// Como su ficha de verdad: normal y promocional, distintos.
montar(
  { price_soles: 8000, discount_price_soles: 5000 },
  { price_soles: 11000, discount_price_soles: 9000 }
);
process.chdir(CASA);
const m = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href
);

let fallos = 0;
const comprobar = (titulo, ok, nota = "") => {
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok   " : "FALLA"} ${titulo.padEnd(54).slice(0, 54)} ${nota}`
  );
};
const elige = (frase, teniendo = "combo") =>
  m.inferTwoTierChoiceFromContext(frase, teniendo, m.loadWorkflowConfig(), {
    elExtraNoEstaEnJuego: true,
    phone: "51999999999",
  });

// -- 1. EL PRECIO QUE EL BOT LE ENSEÑO, SEA CUAL SEA LA ETAPA ---------------
console.log("-- 1. elige por el precio que tiene delante --------------");
comprobar(
  "«quiero el de 5000» (el de OFERTA del barato)",
  elige("quiero el de 5000") === "basico",
  "el de HOLAARG3"
);
comprobar(
  "«quiero el de 8000» (el NORMAL del barato)",
  elige("quiero el de 8000") === "basico",
  "seguia funcionando y sigue"
);
// EL CAMINO DE SUBIR, que es el otro sentido: tenia el barato y pide el caro.
// Se prueba CON una eleccion previa a proposito — sin ninguna hay un candado
// antiguo que impide que un numero suelto compre, y ese no se toca: nacio de que
// «2» eligiera el combo por ser la cifra de un nombre.
comprobar(
  "«quiero el de 9000» (el de OFERTA del caro)",
  elige("quiero el de 9000", "basico") === "combo",
  "la otra mitad"
);
comprobar(
  "«quiero el de 11000» (el NORMAL del caro)",
  elige("quiero el de 11000", "basico") === "combo",
  "como siempre"
);

// -- 2. LA AMBIGÜEDAD SIGUE SIN DECIDIR ------------------------------------
//
// Si la misma cifra vale para las dos opciones no se elige ninguna: elegir a
// medias cobra el precio que no era, y de eso ya hay cicatrices en este archivo.
console.log("\n-- 2. una cifra ambigua no elige ------------------------");
montar(
  { price_soles: 7000, discount_price_soles: 5000 },
  { price_soles: 9000, discount_price_soles: 5000 }
);
comprobar(
  "el mismo promocional en las dos: no decide",
  elige("quiero el de 5000") === null,
  "mejor preguntar que cobrar mal"
);
comprobar(
  "pero el normal, que sí distingue, sigue decidiendo",
  elige("quiero el de 7000") === "basico",
  "no se rompe lo que ya iba"
);

// -- 3. SIN TELEFONO, COMO ANTES -------------------------------------------
//
// Es la garantia de que esto no mueve a nadie que no lo haya pedido: quien no
// pasa el telefono lee el pais por defecto, que es lo de hoy.
console.log("\n-- 3. sin telefono, el comportamiento de siempre ---------");
montar(
  { price_soles: 8000, discount_price_soles: 5000 },
  { price_soles: 11000, discount_price_soles: 9000 }
);
comprobar(
  "sin telefono tambien resuelve con el pais por defecto",
  m.inferTwoTierChoiceFromContext(
    "quiero el de 5000",
    "combo",
    m.loadWorkflowConfig(),
    { elExtraNoEstaEnJuego: true }
  ) === "basico",
  "aqui el defecto es el mismo pais"
);

// -- 4. Y VA EL PRIMERO: EL QUE COBRA MANDA --------------------------------
//
// ESTO SE DIO LA VUELTA EL 28/09/2026, y hay que leer las dos fechas antes de
// tocarlo otra vez:
//
//   26/09 — esta lectura se añadio AL FINAL, «solo donde no contestaba nadie»,
//           para no cambiar ni un caso de los de antes. Ese cuidado parecia lo
//           prudente.
//   28/09 — su prueba HOL3 demostro que ese orden ERA el fallo. Con la opcion
//           cara elegida y la oferta corriendo, «ESTA A 10 soles» —el precio de
//           la cara con descuento— lo cambiaba a la barata y le cobraba 8,
//           porque la comparacion de la caja contestaba antes. Y en las cajas el
//           precio de la cara valia CERO: sus precios viven en la ficha por pais.
//
// Asi que ahora el que cobra va PRIMERO y las dos comparaciones de las cajas se
// quedan detras, contestando cuando el precio de verdad no se puede resolver.
// NO SE QUITO NINGUNA. Ver `prueba-el-importe-senala-al-producto-correcto`.
console.log("\n-- 4. el que cobra manda, y las cajas quedan detras -------");
const fuente = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);
const laPuerta = (() => {
  const i = fuente.indexOf("export function inferTwoTierChoiceFromContext(");
  const f = fuente.indexOf("\nfunction elOrdinalQueEligio(", i);
  return i < 0 || f < 0 ? "" : fuente.slice(i, f);
})();
const posDe = (t) => laPuerta.indexOf(t);
comprobar(
  "el del que cobra va PRIMERO",
  posDe("const porElQueCobra = laOpcionPorElPrecioQueCobra(") > 0 &&
    posDe("const porElQueCobra = laOpcionPorElPrecioQueCobra(") <
      posDe("const regularCombo = matchesPrice("),
  "es el precio que el cliente tiene delante"
);
comprobar(
  "y las dos comparaciones de la caja siguen ahi, detras",
  posDe("const regularCombo = matchesPrice(") > 0 &&
    posDe("const promoCombo = matchesPrice(") >
      posDe("const regularCombo = matchesPrice("),
  "no se quito ninguna"
);
comprobar(
  "la puerta del cambio de opcion le pasa el telefono Y la etapa",
  (() => {
    const motor = readFileSync(
      join(RAIZ, "src", "lib", "workflow", "engine.ts"),
      "utf8"
    );
    const conTelefono = (motor.match(/phone: convo\.phone,/g) ?? []).length;
    const conEtapa = (
      motor.match(/conOferta: isDiscountActiveForConversation\(convo, config\)/g) ??
      []
    ).length;
    return conTelefono >= 2 && conEtapa >= 4;
  })(),
  "su precio y su etapa, en las cuatro puertas"
);

process.chdir(RAIZ);
console.log(
  fallos === 0
    ? "\nTODO OK — el precio de oferta tambien elige, y lo ambiguo sigue sin decidir\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
