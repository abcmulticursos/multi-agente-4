// EL PRECIO QUE DICE TIENE QUE SER EL DEL PRODUCTO QUE NOMBRA.
//
// LO QUE PASO — 27 de septiembre de 2026, su prueba HOLARG2. La oferta ya habia
// salido anunciando la opcion cara con su precio de oferta. El escribio «PRECIO»
// y el bot le contesto con el NOMBRE de la cara y el IMPORTE de la barata.
//
// Medido en el momento con su configuracion: el motor tenia los dos pares bien
// emparejados —cara 11.000 / 9.000 en oferta, barata 8.000 / 5.000— asi que el
// cruce lo hizo el modelo al redactar.
//
// Y EL GUARDARRAIL QUE YA EXISTIA NO PODIA VERLO: ese importe SI esta
// configurado, es el de la otra opcion, asi que pasaba limpio. Este mira lo que
// aquel no puede: que el precio dicho sea el DE ESE producto.
//
// ES DE LA FAMILIA MAS CARA QUE TIENE ESTE BOT. Con sus palabras, ya escritas en
// CLAUDE.md: «un precio que parece bueno y no lo es es peor que no decir
// ninguno: el cliente lo paga, el validador reconoce la opcion POR EL MONTO, y
// se entrega el enlace equivocado».
//
// LO QUE NO PUEDE ROMPERSE — cada candado tapa un falso positivo:
//
//   · CON LAS DOS NOMBRADAS no se toca: esta comparandolas, que es correcto.
//   · SI TAMBIEN DICE EL SUYO tampoco: «el pack sale 9.000; el otro, 5.000».
//   · UN PRECIO COMPARTIDO no distingue a ninguna.
//   · Y SI UN NOMBRE CONTIENE AL OTRO no se puede decidir leyendo.
//
//   node scripts/prueba-el-precio-es-del-producto-que-nombra.mjs
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

const CARO = "PACK TORNADO";
const BARATO = "CANELA SIMPLE";
const CASA = mkdtempSync(join(tmpdir(), "precio-del-que-nombra-"));
mkdirSync(join(CASA, "config"), { recursive: true });
const ARCHIVO = join(CASA, "config", "intro-data.yaml");
let reloj = 1_700_000_000;
const montar = (caro, barato) => {
  writeFileSync(
    ARCHIVO,
    aYaml({
      country: "PE",
      greeting: { body_variants: ["hola"] },
      intro_sequence: [{ type: "text", body_variants: ["la intro"] }],
      payment_responses: { yape: [{ type: "text", body_variants: ["datos"] }] },
      course_price_soles: barato.price_soles,
      segunda_opcion_prestada: "dos_juntas",
      biblioteca_de_productos: [
        { id: "pb", name: BARATO, price_soles: barato.price_soles, precios_por_pais: { PE: barato } },
        { id: "pf", name: CARO, price_soles: caro.price_soles, precios_por_pais: { PE: caro } },
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
// Los mismos pares que tenia el: cara 11.000/9.000, barata 8.000/5.000.
montar(
  { price_soles: 11000, discount_price_soles: 9000 },
  { price_soles: 8000, discount_price_soles: 5000 }
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
const cruce = (texto) =>
  m.nombraUnaOpcionConElPrecioDeLaOtra(texto, "51999999999", m.loadWorkflowConfig());

// -- 1. EL CRUCE SE CAZA ----------------------------------------------------
console.log("-- 1. el cruce se caza ----------------------------------");
comprobar(
  "el nombre de la cara con el precio de la barata",
  cruce(`Claro 😊 El valor actual de ${CARO} es $5.000 ARS.`)?.ajeno === 5000,
  "el de HOLARG2"
);
comprobar(
  "y al reves: la barata con el precio de la cara",
  cruce(`${BARATO} te sale $9.000 ARS, un solo pago`)?.ajeno === 9000,
  "las dos direcciones"
);
comprobar(
  "tambien con el precio NORMAL de la otra",
  cruce(`${CARO} cuesta $8.000 ARS`)?.ajeno === 8000,
  "no solo el de oferta"
);
comprobar(
  "y dice a que opcion se le puso mal",
  cruce(`El valor actual de ${CARO} es $5.000 ARS.`)?.opcion === CARO,
  "para poder pedirle que lo rehaga"
);

// -- 2. LO QUE ES CORRECTO NO SE TOCA ---------------------------------------
console.log("\n-- 2. lo correcto pasa sin rozarse ----------------------");
comprobar(
  "cada uno con el suyo",
  cruce(`${CARO} sale $9.000 ARS y ${BARATO} $5.000 ARS`) === null,
  "nombra las dos: las compara"
);
comprobar(
  "nombra una y dice los DOS precios",
  cruce(`El ${CARO} sale $9.000 ARS; el otro, $5.000 ARS`) === null,
  "tambien dice el suyo"
);
comprobar(
  "nombra una con SU precio",
  cruce(`${BARATO} cuesta $5.000 ARS`) === null,
  "correcto"
);
comprobar(
  "sin nombrar ninguna",
  cruce("El pago es unico de $5.000 ARS y llega al instante") === null,
  "no hay a quien atribuirlo"
);
comprobar(
  "sin ningun importe",
  cruce(`Te cuento que ${CARO} incluye todo el material`) === null,
  "nada que comparar"
);
comprobar(
  "un importe que no es de nadie lo caza el otro guardarrail",
  cruce(`${CARO} cuesta $7.777 ARS`) === null,
  "cada uno lo suyo"
);

// -- 3. LOS CANDADOS DE LOS FALSOS POSITIVOS --------------------------------
console.log("\n-- 3. los candados ---------------------------------------");
montar(
  { price_soles: 9000, discount_price_soles: 5000 },
  { price_soles: 8000, discount_price_soles: 5000 }
);
comprobar(
  "un precio COMPARTIDO no señala a ninguna",
  cruce(`${CARO} sale $5.000 ARS`) === null,
  "no distingue nada"
);
montar(
  { price_soles: 11000, discount_price_soles: 9000 },
  { price_soles: 8000, discount_price_soles: 5000 }
);
comprobar(
  "y sin oferta de dos no decide nada",
  (() => {
    writeFileSync(
      ARCHIVO,
      aYaml({
        country: "PE",
        greeting: { body_variants: ["hola"] },
        intro_sequence: [{ type: "text", body_variants: ["la intro"] }],
        payment_responses: { yape: [{ type: "text", body_variants: ["datos"] }] },
        course_price_soles: 8000,
        biblioteca_de_productos: [{ id: "pb", name: BARATO, price_soles: 8000 }],
        lineal: { enabled: true },
        alineacion_por_modalidad: { lineal: { unico: "pb" } },
      }),
      "utf8"
    );
    reloj += 60;
    const f = new Date(reloj * 1000);
    utimesSync(ARCHIVO, f, f);
    return cruce(`${BARATO} cuesta $9.000 ARS`) === null;
  })(),
  "en lineal no hay otra opcion"
);

// -- 4. Y EL CEREBRO LO USA, CON REINTENTO ----------------------------------
console.log("\n-- 4. el cerebro rehace la respuesta --------------------");
const cerebro = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8");
// EL 28/09/2026 SE LE SUMO UN CUARTO MOTIVO al mismo `if` —«dijo el precio de
// UNA de las dos sin que hubiera elegido», ver
// `prueba-un-precio-solo-no-es-respuesta`— asi que la condicion pasa a varias
// lineas. Lo que esta prueba protege no es como este escrita: es que este cruce
// se siga mirando en el MISMO sitio que los demas, y no en una rama aparte.
comprobar(
  "se mira junto a los otros guardarrailes",
  /const cruzado = nombraUnaOpcionConElPrecioDeLaOtra\(/.test(cerebro) &&
    /if \(\s*datosDePagoSinElegir \|\|[\s\S]{0,200}?importesInventados\.length > 0 \|\|[\s\S]{0,200}?cruzado/.test(
      cerebro
    ),
  "el mismo sitio que ya mira lo que iba a mandar"
);
comprobar(
  "y se le pide que lo rehaga nombrando el precio de esa opcion",
  /which is the price of the OTHER option/.test(cerebro),
  "no se le manda al cliente"
);

process.chdir(RAIZ);
console.log(
  fallos === 0
    ? "\nTODO OK — el precio que dice es el del producto que nombra\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
