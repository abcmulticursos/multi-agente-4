// EL BOT NO PUEDE OFRECER UN METODO DE PAGO QUE NO EXISTE.
//
// LO QUE PASO — 24 de septiembre de 2026, vendiendo en Argentina. El dueño tenia
// UN metodo encendido —transferencia— y el bot ofrecio tres:
//
//     - Transferencia bancaria
//     - Mercado Pago
//     - Uala
//
// El cliente eligio el segundo y recibio esto, literal:
//
//     «[Referencia Argentina] Puedes pagar por transferencia bancaria, ... o ...
//      Cambia este texto por tus datos reales de Argentina.»
//
// LA CAUSA, medida: no se los invento el modelo. Se los dijo el «Texto de
// metodos» del pais, que al encender un pais se siembra con una MUESTRA que
// nombra las marcas tipicas de ahi. Ese texto es el que se le entrega al modelo
// como la lista oficial, asi que mientras nadie lo reescriba manda la muestra y
// no la configuracion.
//
// Y EL DUEÑO YA HABIA INTENTADO LA CURA OBVIA: apago las burbujas de los dos
// metodos que no usa y los quito de su lista. No sirvio, porque los nombres no
// viven en los metodos: viven en esa frase.
//
// LO QUE SE ARREGLA, EN DOS PIEZAS:
//
//   1. La muestra NO VIAJA. Si el texto sigue siendo el de referencia, el motor
//      lo descarta y arma la lista con los metodos ENCENDIDOS del pais.
//   2. El guardarrail deja de ser ciego fuera de Peru. Su catalogo de marcas es
//      peruano y ecuatoriano, asi que las marcas de otros paises le pasaban por
//      delante. Ahora tambien caza los metodos que el pais TUVO y ya no ofrece,
//      sacandolos de sus propios datos — sin escribir ni una marca en el codigo.
//
// LO QUE NO PUEDE ROMPERSE:
//
//   · Un texto escrito por el dueño se manda INTACTO, aunque nombre tres
//     metodos. Eso es su decision, no un descuido.
//   · Un metodo encendido nunca se marca como inventado.
//   · Un pais con su texto ya escrito no nota ningun cambio.
//
// COMO SE MIDE: se monta un proyecto de juguete con su propio
// `config/intro-data.yaml` y se EJECUTA el cargador real contra el. Los nombres
// son inventados a proposito: una prueba escrita con sus marcas reales taparia
// justamente el fallo que esta regla evita.
//
//   node scripts/prueba-no-ofrece-metodos-que-no-existen.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
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
      return {
        url: pathToFileURL(join(RAIZ, "src", conExt)).href,
        shortCircuit: true,
      };
    }
    return next(esp, ctx);
  },
  load(url, ctx, next) {
    if (url === DOBLE)
      return {
        format: "module",
        shortCircuit: true,
        source:
          "export const getConversationByPhone=()=>null;export const getFrozenPrices=()=>null;export const getUpsellFrozenPrices=()=>null;export const getPuestoEnLaFila=()=>null;export const leerCompradosDeLaFila=()=>[];export const moverLaFila=()=>{};export const setFrozenPrices=()=>{};",
      };
    return next(url, ctx);
  },
});

// ── EL PROYECTO DE JUGUETE ───────────────────────────────────────────────────
//
// `config.ts` compone la ruta del archivo con `process.cwd()` al cargarse, asi
// que se cambia de directorio ANTES de importarlo.
const CASA = mkdtempSync(join(tmpdir(), "metodos-"));
mkdirSync(join(CASA, "config"), { recursive: true });
const ARCHIVO = join(CASA, "config", "intro-data.yaml");
let relojDelArchivo = 1_700_000_000;

/** Escribe el contenido y le mueve la fecha: la cache del cargador es por
 *  fecha de modificacion, y dos escrituras seguidas pueden compartirla. */
const montar = (perfil) => {
  writeFileSync(
    ARCHIVO,
    aYaml({
      country: "AR",
      greeting: { body_variants: ["hola"] },
      intro_sequence: [{ type: "text", body_variants: ["la intro"] }],
      payment_responses: {
        transferencia_bancaria: [{ type: "text", body_variants: ["datos"] }],
      },
      payment_text: "texto global, aqui no se usa",
      lineal: { enabled: true },
      modality_payment_profiles: { lineal: { AR: perfil } },
    }),
    "utf8"
  );
  relojDelArchivo += 60;
  const fecha = new Date(relojDelArchivo * 1000);
  utimesSync(ARCHIVO, fecha, fecha);
};

const TELEFONO = "5491111111111"; // Argentina
const MUESTRA =
  "[Referencia Pais] Puedes pagar por transferencia bancaria, Pagofacil o Billetera Lunar. Cambia este texto por tus datos reales.";
const PERFIL = {
  enabled: true,
  course_price_soles: 9000,
  payment_text: MUESTRA,
  payment_buttons: [
    {
      label: "Transferencia",
      method: "transferencia_bancaria",
      aliases: ["transferencia"],
      principal: true,
    },
  ],
  // Los cajones que quedaron escritos de la siembra, ya sin su metodo en la
  // lista: son los «huerfanos» que el panel deja a la vista para poder vaciarlos.
  payment_responses: {
    transferencia_bancaria: [{ type: "text", body_variants: ["CBU 123"] }],
    pagofacil: [{ type: "text", body_variants: [MUESTRA] }],
    billetera_lunar: [{ type: "text", body_variants: [MUESTRA] }],
  },
};

montar(PERFIL);
process.chdir(CASA);
const cfgMod = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href
);
const { getPaymentText, getPaymentMethodsList, marcasDePagoNoConfiguradas } =
  cfgMod;
const { esTextoDeReferencia } = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "editor", "revisar-pais.ts")).href
);

let fallos = 0;
const comprobar = (titulo, ok, nota = "") => {
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok   " : "FALLA"} ${titulo.padEnd(56).slice(0, 56)} ${nota}`
  );
};

console.log("-- 1. la muestra no viaja ----------------------------------");
const texto = getPaymentText(TELEFONO);
console.log(`     lo que dice de sus metodos: «${texto.replace(/\n/g, " / ")}»`);
comprobar(
  "no manda el texto de muestra",
  !esTextoDeReferencia(texto),
  "ni al modelo ni al cliente"
);
comprobar(
  "nombra el metodo que SI existe",
  /Transferencia/i.test(texto),
  "el encendido"
);
comprobar(
  "y no nombra los que no existen",
  !/pagofacil/i.test(texto) && !/lunar/i.test(texto),
  "los que quito de su lista"
);

console.log("\n-- 2. su texto se respeta tal cual ------------------------");
montar({ ...PERFIL, payment_text: "Pagas por Pagofacil y ya." });
comprobar(
  "el texto del dueño se manda intacto",
  getPaymentText(TELEFONO) === "Pagas por Pagofacil y ya.",
  "aunque nombre otra cosa: es su decision"
);

console.log("\n-- 3. sin metodos, no nombra ninguno ----------------------");
montar({ ...PERFIL, payment_buttons: [] });
comprobar(
  "la lista sale vacia",
  getPaymentMethodsList(TELEFONO).trim() === "",
  "antes nombraba tres marcas de un solo pais"
);
comprobar(
  "y el texto avisa en vez de inventar",
  /sin configurar/i.test(getPaymentText(TELEFONO)),
  "es un error visible, no una marca falsa"
);

console.log("\n-- 4. el guardarrail caza lo que el bot no ofrece ---------");
montar(PERFIL);
const inventadas = marcasDePagoNoConfiguradas(
  "Puedes pagar con Pagofacil o con Billetera Lunar, como prefieras",
  TELEFONO
);
console.log(`     marcas marcadas: ${inventadas.join(", ") || "(ninguna)"}`);
comprobar(
  "caza los metodos que quito de su lista",
  inventadas.some((m) => /pagofacil/.test(m)) &&
    inventadas.some((m) => /lunar/.test(m)),
  "y su catalogo no los conocia"
);
comprobar(
  "no marca el metodo que SI ofrece",
  marcasDePagoNoConfiguradas("Puedes pagar por transferencia bancaria", TELEFONO)
    .length === 0,
  "el encendido nunca es inventado"
);

console.log("\n-- 5. un metodo APAGADO cuenta como retirado --------------");
montar({
  ...PERFIL,
  payment_buttons: [
    ...PERFIL.payment_buttons,
    {
      label: "Billetera Lunar",
      method: "billetera_lunar",
      aliases: ["lunar"],
      enabled: false,
    },
  ],
});
comprobar(
  "apagado no se ofrece",
  !/lunar/i.test(getPaymentText(TELEFONO)),
  "conserva sus datos, pero no sale"
);
comprobar(
  "y si el modelo lo nombra, se caza",
  marcasDePagoNoConfiguradas("te paso los datos de Billetera Lunar", TELEFONO)
    .length > 0,
  "apagar es apagar de verdad"
);

console.log("\n-- 6. nada de esto toca a un pais ya escrito --------------");
montar({
  ...PERFIL,
  payment_text: "Elige: transferencia bancaria.",
  payment_responses: {
    transferencia_bancaria: [{ type: "text", body_variants: ["CBU 123"] }],
  },
});
comprobar(
  "su texto sale igual que antes",
  getPaymentText(TELEFONO) === "Elige: transferencia bancaria.",
  "sin muestra no hay nada que sustituir"
);
comprobar(
  "y no hay metodos retirados que cazar",
  marcasDePagoNoConfiguradas("pagas por transferencia bancaria", TELEFONO)
    .length === 0,
  "cero falsos positivos"
);

process.chdir(RAIZ);
console.log(
  fallos === 0
    ? "\nTODO OK — el bot solo nombra los metodos que existen\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
