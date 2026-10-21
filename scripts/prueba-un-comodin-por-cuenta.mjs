// UN COMODÍN POR CUENTA: {{CUENTA_YAPE}}, {{CUENTA_BCP}}…
//
// LO ENCONTRÓ EL DUEÑO USÁNDOLO, el 1 de octubre de 2026, a mitad de poner los
// comodines en sus burbujas: «PUTA MADRE ME MAREO, YA QUE EN UNA BURBUJA TENGO EL
// NUMERO DE BCP Y EL YAPE JUNTOS».
//
// Y TENÍA RAZÓN: ERA UN HUECO DEL DISEÑO. Hay burbujas suyas que listan LAS DOS
// cuentas en el mismo texto —«Yape: … / BCP: …»— para que el cliente elija al leer.
// Medido en su configuración: 3 sitios así, los cuadros «Datos de pago 1, 2 y 4».
//
// Ahí {{NUMERO_DE_CUENTA}} no alcanza. Ése se resuelve por el método ELEGIDO, así que
// solo puede dar UNO — y cuando el cliente todavía no ha elegido, ni eso.
//
// EL ARREGLO: un comodín que NOMBRA el método. Se resuelve por el nombre escrito, no
// por el elegido, así que una burbuja puede listar las dos cuentas y las dos siguen
// al usuario que cobra en ese número.
//
// LA CLAVE ES SUYA, NO DEL CÓDIGO: {{CUENTA_<lo que él llamó al método>}}. El motor no
// conoce ni un nombre de método — los lee de sus botones de pago.
//
//   node scripts/prueba-un-comodin-por-cuenta.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
const m = await import(pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href);

const envio = readFileSync(join(RAIZ, "src", "lib", "workflow", "sender.ts"), "utf8");
const pantalla = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// Métodos y cuentas INVENTADOS: una prueba con los suyos taparía que el código no
// debe conocer ningún nombre de método.
const CFG = {
  payment_profiles_by_country: {
    PE: {
      numero_de_cuenta: "LA SUELTA DEL DUEÑO",
      cuentas_por_metodo: { billetera: "DUEÑO-BILLETERA", banco: "DUEÑO-BANCO" },
      payment_validation: { yape_recipient_name_starts_with: "EL DUEÑO" },
      payment_buttons: [
        { label: "Billetera", method: "billetera" },
        { label: "Banco", method: "banco" },
      ],
    },
  },
  cobradores: [
    {
      id: "u_ella",
      nombre: "ELLA",
      por_pais: {
        PE: {
          titular: "TITULAR DE ELLA",
          cuentas_por_metodo: { billetera: "ELLA-BILLETERA", banco: "ELLA-BANCO" },
        },
      },
    },
  ],
  tiendas: [{ id: "t_ella", numero: "777", cobrador: "u_ella" }],
};

// LA BURBUJA QUE LISTA LAS DOS, que es el caso que lo puso aquí.
const BURBUJA = "Billetera: {{CUENTA_BILLETERA}} / Banco: {{CUENTA_BANCO}}";
// La misma resolución que hace el envío.
const rellenar = (tienda) =>
  BURBUJA.replace(/\{\{\s*cuenta_([a-z0-9_]+)\s*\}\}/gi, (_e, metodo) =>
    m.conLaTiendaDelTurno(
      tienda,
      () => m.elCobroDelPais("PE", CFG, metodo).numero_de_cuenta
    ) || `[Cuenta de ${metodo} sin configurar]`
  );

// ── 1. LAS DOS CUENTAS, EN UNA SOLA BURBUJA ─────────────────────────────────
console.log("\n— 1. dos cuentas en la misma burbuja —\n");
{
  const delDueno = rellenar(null);
  comprobar(
    "por el número de siempre, las dos del dueño",
    delDueno === "Billetera: DUEÑO-BILLETERA / Banco: DUEÑO-BANCO",
    delDueno
  );
  const deElla = rellenar(m.tiendaDelNumero("777", CFG));
  comprobar(
    "por el de la tienda, las dos de ella",
    deElla === "Billetera: ELLA-BILLETERA / Banco: ELLA-BANCO",
    deElla
  );
  comprobar(
    "y NUNCA cruzadas",
    !deElla.includes("DUEÑO") && !delDueno.includes("ELLA"),
    "ni una de cada una"
  );
}

// ── 2. SE RESUELVE POR EL NOMBRE, NO POR LO ELEGIDO ─────────────────────────
//
// Es la diferencia con {{NUMERO_DE_CUENTA}}, y por eso hacía falta: aquí no hay
// método elegido todavía —la burbuja se manda ANTES de que elija— y aun así cada
// comodín da la cuenta que le toca.
console.log("\n— 2. no depende de que el cliente haya elegido —\n");
comprobar(
  "sin método elegido, cada comodín da el suyo",
  rellenar(null) === "Billetera: DUEÑO-BILLETERA / Banco: DUEÑO-BANCO",
  "el genérico aquí solo podría dar uno"
);
comprobar(
  "y el genérico sigue dando la suelta",
  m.elCobroDelPais("PE", CFG, null).numero_de_cuenta === "LA SUELTA DEL DUEÑO",
  "{{NUMERO_DE_CUENTA}} no cambió"
);

// ── 3. UN MÉTODO SIN CUENTA PROPIA CAE A LA SUELTA ──────────────────────────
console.log("\n— 3. un método sin cuenta escrita —\n");
comprobar(
  "cae a la cuenta suelta, no a un hueco",
  m.elCobroDelPais("PE", CFG, "un_metodo_que_no_existe").numero_de_cuenta ===
    "LA SUELTA DEL DUEÑO"
);

// ── 4. EL ENVÍO Y EL VISOR DICEN LO MISMO ───────────────────────────────────
//
// Si el visor resolviera distinto, enseñaría una cosa y el cliente leería otra. Esta
// semana eso ya costó once diferencias con el formato de la moneda.
console.log("\n— 4. el visor no miente —\n");
comprobar(
  "el envío lo resuelve por el método nombrado",
  /\{\{\\s\*cuenta_\(\[a-z0-9_\]\+\)\\s\*\}\}/.test(
    envio.replace(/\//g, "")
  ) || /cuenta_\(\[a-z0-9_\]\+\)/.test(envio),
  "sender.ts"
);
comprobar(
  "el visor usa el MISMO patrón",
  /cuenta_\(\[a-z0-9_\]\+\)/.test(pantalla),
  "page.tsx"
);
comprobar(
  "y el mismo respaldo: su cuenta, la suelta, y luego el aviso",
  /String\(suya \?\? ""\)\.trim\(\) \|\|\s*\r?\n?\s*context\?\.numeroDeCuenta\?\.trim\(\) \|\|/.test(
    pantalla
  ),
  "igual que en vivo"
);
comprobar(
  "el visor recibe las cuentas por método",
  /cuentasPorMetodo: selectedProfile\?\.cuentas_por_metodo \?\? \{\}/.test(pantalla)
);

// ── 5. LOS COMODINES SALEN DE SUS MÉTODOS ───────────────────────────────────
//
// Nunca una lista escrita en el código: este bot es una plantilla y cada negocio
// tiene los suyos, con sus nombres.
console.log("\n— 5. la lista de comodines es la de sus métodos —\n");
comprobar(
  "se arman desde sus botones de pago",
  /token: `\{\{CUENTA_\$\{metodo\.toUpperCase\(\)\}\}\}`/.test(pantalla),
  "si agrega un método, aparece solo"
);
// NI EN LOS COMENTARIOS. Esta comprobacion me pillo a MI al escribirla: habia puesto
// dos marcas suyas como ejemplo en el comentario del motor. La regla de la casa
// prohibe nombres de metodos de pago y de bancos en el codigo —son distintos en cada
// pais— y un ejemplo en un comentario es codigo igual: el siguiente que lo lea creera
// que esos son los metodos.
comprobar(
  "y el motor no nombra ningún método, ni de ejemplo",
  !/cuenta_(yape|plin|bcp|efectivo|plin)/i.test(envio),
  "es una plantilla"
);
comprobar(
  "ni la pantalla",
  !/CUENTA_(YAPE|PLIN|BCP|EFECTIVO)/i.test(pantalla),
  "los ejemplos van sin marca"
);
comprobar(
  "la ayuda dice cuándo usarlo",
  /Úsalo cuando una\s*\r?\n?\s*`? ?\+? ?`?burbuja nombre VARIAS cuentas a la vez/.test(
    pantalla
  ) || /burbuja nombre VARIAS cuentas a la vez/.test(pantalla),
  "y cuándo basta el genérico"
);

console.log(
  fallos === 0
    ? "\nTODO OK — una burbuja puede listar varias cuentas, y todas siguen a quien cobra\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
