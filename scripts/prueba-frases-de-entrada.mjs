// FRASES DE ENTRADA: UN NÚMERO ATENDIENDO VARIAS TIENDAS.
//
// LO PIDIÓ EL DUEÑO el 12/10/2026: «necesito que un solo número pueda atender a más de 2
// tiendas. Yo creo mis 3 tiendas y cada tienda tenga una palabra clave, pero ojo, esta
// palabra clave es opcional… crearía 3 campañas con el mismo número, pero en cada campaña a
// WhatsApp cambiaría la frase de entrada». Con su ejemplo: «Pack Mascotas», en
// «Hola me interesa el super pack mascotas», «…acerca del pack mascotas»,
// «…información sobre el Pack Mascotas».
//
// Y SU CONDICIÓN, QUE MANDA: «TOTALMENTE PROHIBIDO QUE CAMBIE EL COMPORTAMIENTO… al final de
// la implementación debe quedar IDÉNTICO». Por eso lo primero que se comprueba aquí es que,
// SIN FRASES, todo elige la tienda exactamente como antes.
//
// Ejecuta el config.ts DE VERDAD con una configuración inventada (nombres neutros).
//
//   node scripts/prueba-frases-de-entrada.mjs
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
    if (esp === "@/lib/db") return { url: DOBLE, format: "module", shortCircuit: true };
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
        format: "module", shortCircuit: true,
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

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 62)} ${valor}`);
};

const CASA = mkdtempSync(join(tmpdir(), "frases-de-entrada-"));
mkdirSync(join(CASA, "config"), { recursive: true });
const ARCHIVO = join(CASA, "config", "intro-data.yaml");
let reloj = 1_700_000_000;
const montar = (tiendas) => {
  writeFileSync(
    ARCHIVO,
    aYaml({
      country: "PE",
      greeting: { body_variants: ["hola"] },
      intro_sequence: [{ type: "text", body_variants: ["la intro"] }],
      payment_responses: { yape: [{ type: "text", body_variants: ["datos"] }] },
      course_price_soles: 10,
      tiendas,
    }),
    "utf8"
  );
  reloj += 60;
  const f = new Date(reloj * 1000);
  utimesSync(ARCHIVO, f, f);
};
// Sin frases: dos tiendas con su número, como hoy.
const SIN_FRASES = [
  { id: "ta", nombre: "TIENDA A", numero: "111" },
  { id: "tb", nombre: "TIENDA B", numero: "222", semimodalidad: "dos_juntas" },
];
// Con frases: tres tiendas en el MISMO número 111, y una cuarta en el 222.
const CON_FRASES = [
  { id: "tm", nombre: "MASCOTAS", numero: "111", frases_de_entrada: ["Pack Mascotas"] },
  { id: "ts", nombre: "SUPER", numero: "111", frases_de_entrada: ["super pack mascotas"] },
  { id: "td", nombre: "DEFECTO", numero: "111" },
  { id: "tz", nombre: "OTRO NUMERO", numero: "222", frases_de_entrada: ["pack gatos"] },
  { id: "tx", nombre: "APAGADA", numero: "111", enabled: false, frases_de_entrada: ["pack apagado"] },
];
montar(SIN_FRASES);
process.chdir(CASA);
const m = await import(pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href);
const nombre = (t) => t?.nombre ?? "(ninguna)";

console.log("\n— 1. sin frases, todo como hoy —\n");
{
  const cfg = m.loadWorkflowConfig();
  comprobar("el 111 lo atiende su tienda", nombre(m.tiendaDelNumero("111", cfg)) === "TIENDA A");
  comprobar("el 222 la suya", nombre(m.tiendaDelNumero("222", cfg)) === "TIENDA B");
  comprobar("ninguna frase elige nada", m.tiendaPorFraseDeEntrada("hola pack mascotas", "111", cfg) === null);
  comprobar(
    "la conversación sin anotar sale por su número",
    nombre(m.laTiendaDeLaConversacion({ wa_phone_number_id: "222" })) === "TIENDA B"
  );
  comprobar(
    "y el turno abre esa misma tienda",
    m.conElTurnoDe({ wa_phone_number_id: "222" }, () => nombre(m.laTiendaDelTurno())) === "TIENDA B"
  );
  // Dos tiendas en el mismo número y ninguna con frase: gana la primera, como antes.
  montar([...SIN_FRASES, { id: "tc", nombre: "TIENDA C", numero: "111" }]);
  comprobar(
    "dos sin frase en el mismo número: la primera, como antes",
    nombre(m.tiendaDelNumero("111", m.loadWorkflowConfig())) === "TIENDA A"
  );
}

console.log("\n— 2. la frase elige la tienda, con sus ejemplos —\n");
montar(CON_FRASES);
{
  const cfg = m.loadWorkflowConfig();
  const por = (msg, num = "111") => nombre(m.tiendaPorFraseDeEntrada(msg, num, cfg));
  comprobar("«Hola quiero saber mas acerca del pack mascotas»", por("Hola quiero saber mas acerca del pack mascotas") === "MASCOTAS");
  comprobar("«Hola necesito información sobre el Pack Mascotas»", por("Hola necesito información sobre el Pack Mascotas") === "MASCOTAS");
  comprobar("mayúsculas y signos: «PACK MASCOTAS!!»", por("PACK MASCOTAS!!") === "MASCOTAS");
  comprobar("con tilde de más: «pack máscotas»", por("pack máscotas") === "MASCOTAS");
  comprobar(
    "«Hola me interesa el super pack mascotas»: gana la frase más larga",
    por("Hola me interesa el super pack mascotas") === "SUPER"
  );
  comprobar("sin frase, ninguna: «Hola»", por("Hola") === "(ninguna)");
  comprobar("pegada no es la frase: «packmascotas»", por("packmascotas") === "(ninguna)");
  comprobar("media frase no basta: «pack»", por("hola pack") === "(ninguna)");
  comprobar("la frase de otro número no sirve aquí", por("pack gatos") === "(ninguna)");
  comprobar("y en su número sí", por("pack gatos", "222") === "OTRO NUMERO");
  comprobar("una tienda apagada no se elige", por("pack apagado") === "(ninguna)");
  comprobar("sin número no se elige nada", por("pack mascotas", "") === "(ninguna)");
}

console.log("\n— 3. sin frase que la elija, la de por defecto del número —\n");
{
  const cfg = m.loadWorkflowConfig();
  comprobar(
    "el 111 sin frase va a la que no tiene frases",
    nombre(m.tiendaDelNumero("111", cfg)) === "DEFECTO",
    "aunque esté tercera en la lista"
  );
}

console.log("\n— 4. la conversación anotada se queda en su tienda —\n");
{
  const anotada = { wa_phone_number_id: "111", tienda_id: "tm" };
  comprobar("anotada en MASCOTAS, la tienda es MASCOTAS", nombre(m.laTiendaDeLaConversacion(anotada)) === "MASCOTAS");
  comprobar(
    "y el turno entero se atiende con ella",
    m.conElTurnoDe(anotada, () => nombre(m.laTiendaDelTurno())) === "MASCOTAS"
  );
  comprobar(
    "si escribe a OTRO número nuestro, manda ese número",
    nombre(m.laTiendaDeLaConversacion({ wa_phone_number_id: "222", tienda_id: "tm" })) === "OTRO NUMERO"
  );
  comprobar(
    "si la tienda anotada ya no existe, manda el número",
    nombre(m.laTiendaDeLaConversacion({ wa_phone_number_id: "111", tienda_id: "borrada" })) === "DEFECTO"
  );
  comprobar(
    "si la tienda anotada está apagada, manda el número",
    nombre(m.laTiendaDeLaConversacion({ wa_phone_number_id: "111", tienda_id: "tx" })) === "DEFECTO"
  );
}

console.log("\n— 5. el código que lo pone en marcha —\n");
{
  const db = readFileSync(join(RAIZ, "src", "lib", "db.ts"), "utf8");
  const handler = readFileSync(join(RAIZ, "src", "lib", "meta", "handler.ts"), "utf8");
  const ruta = readFileSync(join(RAIZ, "src", "app", "api", "workflow", "route.ts"), "utf8");
  comprobar(
    "se anota una sola vez y solo con la conversación nueva",
    /SET tienda_id = \? WHERE id = \? AND tienda_id IS NULL AND state = 'new'/.test(db),
    "una frase a mitad de una venta no cambia nada"
  );
  const anota = handler.indexOf("getOutboundWhatsAppNumber() ?? convo.wa_phone_number_id");
  const congela = handler.indexOf("freezePricesForConvo(convo);");
  const presenta = handler.indexOf("const presentacionAlNacer");
  comprobar(
    "se anota ANTES del precio congelado y de la presentación",
    anota > 0 && congela > anota && presenta > anota,
    "nace ya en su tienda"
  );
  comprobar(
    "el guardado conserva las frases",
    /frases_de_entrada: strListLimpia\(t\?\.frases_de_entrada\)/.test(ruta)
  );
}

console.log("");
if (fallos > 0) {
  console.log(`${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — sin frases, como siempre; con frases, cada tienda recibe a los suyos");
