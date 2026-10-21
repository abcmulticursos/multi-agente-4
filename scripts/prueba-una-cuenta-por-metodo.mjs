// UNA CUENTA POR MÉTODO: el mismo comodín da la cuenta del método que eligió.
//
// LO ENCONTRÉ MIDIENDO SU CONFIGURACIÓN el 30 de septiembre de 2026, cuando él me
// pidió que dejara de explicarle con ejemplos inventados y leyera lo suyo:
//
//     PAÍS 1  ·  casilla `numero_de_cuenta` VACÍA  ·  dos numeros escritos a mano
//               dentro de las burbujas (uno de billetera, otro de banco)
//     PAÍS 2  ·  casilla LLENA  ·  un solo alias, le bastaba
//     PAÍS 3  ·  casilla VACÍA
//
// LA CAUSA NO ERA DESCUIDO: la casilla guarda UNA cuenta y en un país se cobra por
// billetera Y por banco, que son cuentas distintas. La casilla no podía representar
// su caso, así que no la usó — y los números se quedaron escritos a mano, que es
// exactamente lo que el comodín vino a evitar. Su propio código lo cuenta: «el
// mismo número estaba escrito a mano en 234 cajas… ya había DOS números de BCP
// distintos circulando».
//
// POR QUÉ IMPORTA AHORA, y es lo que esta prueba protege de verdad: con el almacén
// de usuarios que cobran, el NOMBRE ya seguía al usuario —va con comodín— pero el
// NÚMERO no. Así que al poner a otra persona a cobrar, el bot mandaba EL NÚMERO DEL
// DUEÑO con EL NOMBRE DE ELLA: el cliente paga bien, el comprobante sale a nombre
// del dueño, la validación espera a ella y RECHAZA UN PAGO BUENO.
//
// LA CLAVE ES EL MÉTODO, y no hubo que pasarlo de función en función: la
// conversación ya lo guardaba en `selected_payment_method`.
//
// LO QUE PROTEGE:
//
//     SIN CUENTAS POR MÉTODO ESCRITAS, SE DEVUELVE LA DE SIEMPRE.
//
//   node scripts/prueba-una-cuenta-por-metodo.mjs
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

const conf = readFileSync(join(RAIZ, "src", "lib", "workflow", "config.ts"), "utf8");
const envio = readFileSync(join(RAIZ, "src", "lib", "workflow", "sender.ts"), "utf8");
const api = readFileSync(join(RAIZ, "src", "app", "api", "workflow", "route.ts"), "utf8");
const pantalla = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// Métodos y cuentas INVENTADOS. Los nombres de metodo son de mentira a proposito:
// una prueba escrita con los suyos taparia que el codigo no debe conocer ninguno.
const CFG = {
  payment_profiles_by_country: {
    PE: {
      numero_de_cuenta: "SUELTA-DEL-PAIS",
      cuentas_por_metodo: { billetera: "PAIS-BILLETERA", banco: "PAIS-BANCO" },
      payment_validation: { yape_recipient_name_starts_with: "TITULAR PE" },
    },
    // Un pais con UNA sola cuenta, como el caso en que le bastaba con el alias.
    AR: {
      numero_de_cuenta: "SOLO-UNA-AR",
      payment_validation: { yape_recipient_name_starts_with: "TITULAR AR" },
    },
  },
  cobradores: [
    {
      id: "u_otro",
      nombre: "OTRA PERSONA",
      por_pais: {
        PE: {
          titular: "TITULAR SUYO",
          cuentas_por_metodo: { billetera: "SUYA-BILLETERA", banco: "SUYA-BANCO" },
        },
        // Solo cuenta suelta, sin desglosar por metodo.
        AR: { titular: "TITULAR SUYO AR", numero_de_cuenta: "SUYA-SUELTA-AR" },
      },
    },
  ],
  tiendas: [
    { id: "t_a", numero: "111" },
    { id: "t_b", numero: "222", cobrador: "u_otro" },
  ],
};
const cuenta = (numero, pais, metodo) =>
  m.conLaTiendaDelTurno(m.tiendaDelNumero(numero, CFG), () =>
    m.elCobroDelPais(pais, CFG, metodo).numero_de_cuenta
  );

// ── 1. EL MISMO COMODÍN, DOS CUENTAS ────────────────────────────────────────
console.log("\n— 1. la cuenta del método que eligió —\n");
comprobar("por billetera, la de billetera", cuenta("111", "PE", "billetera") === "PAIS-BILLETERA", cuenta("111", "PE", "billetera"));
comprobar("por banco, la del banco", cuenta("111", "PE", "banco") === "PAIS-BANCO", cuenta("111", "PE", "banco"));
comprobar(
  "y NO se cruzan",
  cuenta("111", "PE", "billetera") !== cuenta("111", "PE", "banco"),
  "cada método la suya"
);

// ── 2. LA GARANTÍA: SIN ESTO, LO DE SIEMPRE ─────────────────────────────────
console.log("\n— 2. sin cuentas por método, la de siempre —\n");
comprobar(
  "un país con una sola cuenta",
  cuenta("111", "AR", "billetera") === "SOLO-UNA-AR",
  "la suelta, como hoy"
);
comprobar(
  "un método que no está escrito",
  cuenta("111", "PE", "un_metodo_que_no_existe") === "SUELTA-DEL-PAIS",
  "cae a la suelta"
);
comprobar(
  "y SIN método —antes de elegir— la suelta",
  cuenta("111", "PE", null) === "SUELTA-DEL-PAIS",
  "el camino de siempre"
);
comprobar(
  "método vacío, igual",
  cuenta("111", "PE", "  ") === "SUELTA-DEL-PAIS"
);

// ── 3. EL USUARIO QUE COBRA MANDA SOBRE EL PAÍS ─────────────────────────────
//
// Y ES LA COMPROBACIÓN QUE EVITA EL PAGO RECHAZADO: si el nombre viene del usuario
// y el número del país, el cliente paga al dueño y el comprobante no coincide.
console.log("\n— 3. la cuenta y el titular, de la MISMA persona —\n");
{
  const suB = m.conLaTiendaDelTurno(m.tiendaDelNumero("222", CFG), () =>
    m.elCobroDelPais("PE", CFG, "billetera")
  );
  comprobar("la cuenta es la del usuario", suB.numero_de_cuenta === "SUYA-BILLETERA", suB.numero_de_cuenta);
  comprobar("y el titular también", suB.titular === "TITULAR SUYO", suB.titular);
  comprobar(
    "por banco, su cuenta de banco",
    cuenta("222", "PE", "banco") === "SUYA-BANCO"
  );
  comprobar(
    "NUNCA la del país con el nombre del usuario",
    suB.numero_de_cuenta !== "PAIS-BILLETERA",
    "ése era el pago rechazado"
  );
  // Un usuario que solo tiene cuenta suelta: vale para todos sus métodos.
  comprobar(
    "su cuenta suelta sirve para cualquier método",
    cuenta("222", "AR", "billetera") === "SUYA-SUELTA-AR"
  );
}

// ── 3b. UN MÉTODO QUE ESA PERSONA NO COBRA SE APAGA ─────────────────────────
//
// LO PIDIÓ EL DUEÑO el 01/10/2026, y vio un fallo de diseño real: «habrá veces que
// Melissa no tenga todos los metodos de pago, si se va a reemplazar con mis datos es
// un error, necesito que los metodos de pago de otro usuario que cobra pueda
// apagarse».
//
// TENIA RAZON. Sin esto, un metodo que ella no tiene heredaba la cuenta DEL DUEÑO:
// el cliente pagaba a la cuenta de el, el comprobante salia a nombre de el, y el bot
// —que esperaba el de ella— lo RECHAZABA. Pago bueno, comprobante rechazado, y el
// dinero en la cuenta equivocada.
console.log("\n— 3b. el método que no cobra, apagado —\n");
{
  const conApagado = {
    payment_profiles_by_country: {
      PE: {
        numero_de_cuenta: "SUELTA-DEL-DUEÑO",
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
            cuentas_por_metodo: { billetera: "DE ELLA BILLETERA" },
            // No cobra por banco.
            metodos_apagados: ["banco"],
          },
        },
      },
    ],
    tiendas: [{ id: "t_ella", numero: "888", cobrador: "u_ella" }],
  };
  const enSuTienda = (fn) =>
    m.conLaTiendaDelTurno(m.tiendaDelNumero("888", conApagado), fn);

  // LA COMPROBACION QUE DA SENTIDO A TODO ESTO.
  const porBanco = enSuTienda(() =>
    m.elCobroDelPais("PE", conApagado, "banco")
  );
  comprobar(
    "el método apagado NO hereda la cuenta del dueño",
    porBanco.numero_de_cuenta !== "DUEÑO-BANCO" &&
      porBanco.numero_de_cuenta !== "SUELTA-DEL-DUEÑO",
    `dio «${porBanco.numero_de_cuenta}»`
  );
  comprobar(
    "queda vacío, que se ve y se arregla",
    porBanco.numero_de_cuenta === "",
    "antes vacío que el cobro en la cuenta de otro"
  );
  comprobar(
    "y el método que sí cobra sigue bien",
    enSuTienda(() => m.elCobroDelPais("PE", conApagado, "billetera"))
      .numero_de_cuenta === "DE ELLA BILLETERA"
  );
  // PERO LO PRINCIPAL ES QUE NI SE LE OFREZCA.
  const apagados = enSuTienda(() => m.metodosApagadosDelCobro("PE", conApagado));
  comprobar("el motor sabe cuál está apagado", apagados.join(",") === "banco", apagados.join(","));
  comprobar(
    "sin usuario puesto no hay ninguno apagado",
    m.metodosApagadosDelCobro("PE", conApagado).length === 0,
    "el bot de siempre, intacto"
  );
}

// ── 4. LA CLAVE NO DEPENDE DE MAYÚSCULAS ────────────────────────────────────
//
// El la escribe en sus botones y el motor la guarda como venga. Si «Yape» y «yape»
// fueran cuentas distintas, la cuenta desapareceria por una mayuscula.
console.log("\n— 4. la clave no depende de mayúsculas —\n");
{
  const raro = {
    payment_profiles_by_country: {
      PE: { numero_de_cuenta: "SUELTA", cuentas_por_metodo: { "  BiLLeTeRa " : "LA BUENA" } },
    },
  };
  comprobar(
    "escrita con mayúsculas y espacios, se encuentra",
    m.elCobroDelPais("PE", raro, "billetera").numero_de_cuenta === "LA BUENA"
  );
}

// ── 5. EL MÉTODO SALE DE LA CONVERSACIÓN ────────────────────────────────────
//
// No hubo que pasarlo de funcion en funcion: ya estaba guardado. Si alguien lo
// quita de aqui, el comodin vuelve a dar siempre la cuenta suelta y nadie avisa.
console.log("\n— 5. el método viene de la conversación —\n");
comprobar(
  "el envío pasa el método elegido",
  /getNumeroDeCuenta\(\s*convo\.phone,\s*convo\.selected_payment_method\s*\)/.test(
    envio
  ),
  "sender.ts"
);
comprobar(
  "y la puerta lo acepta",
  /metodo\?: string \| null/.test(conf) &&
    /laCuentaDelMetodo\(delCobrador, metodo\) \|\|/.test(conf),
  "elCobroDelPais"
);
comprobar(
  "el orden es usuario -> país, y método -> suelta",
  /laCuentaDelMetodo\(delCobrador, metodo\) \|\|\s*\r?\n?\s*limpio\(delCobrador\?\.numero_de_cuenta\) \|\|\s*\r?\n?\s*laCuentaDelMetodo\(perfil, metodo\) \|\|\s*\r?\n?\s*limpio\(perfil\?\.numero_de_cuenta\),/.test(
    conf
  ),
  "de lo concreto a lo general"
);
// NINGUN NOMBRE DE METODO EN EL CODIGO. Es una plantilla: cada negocio tiene los
// suyos y con otros nombres.
comprobar(
  "el motor no conoce ningún método por su nombre",
  !/cuentas_por_metodo\s*\?\.\s*(yape|plin|bcp|efectivo|transferencia)/i.test(conf),
  "los escribe él en sus botones"
);

// ── 6. SOBREVIVE AL GUARDADO ────────────────────────────────────────────────
console.log("\n— 6. las cuentas no se pierden al guardar —\n");
comprobar("hay un lector propio", /function leeCuentasPorMetodo\(/.test(api));
comprobar(
  "se tiran las vacías",
  /if \(clave && valor\) out\[clave\] = valor;/.test(api),
  "una clave vacía se ve igual que una cuenta puesta"
);
comprobar(
  "la clave se normaliza",
  /String\(metodo \?\? ""\)\.trim\(\)\.toLowerCase\(\)/.test(api)
);
comprobar(
  "el perfil del país las lee y las escribe",
  (api.match(/cuentas_por_metodo: leeCuentasPorMetodo\(p\?\.cuentas_por_metodo\)/g) ?? [])
    .length === 2,
  "las dos direcciones"
);
comprobar(
  "y el usuario que cobra también",
  /const cuentas_por_metodo = leeCuentasPorMetodo\(d\?\.cuentas_por_metodo\);/.test(api)
);

// ── 7. LA PANTALLA, Y QUE EL VISOR NO MIENTA ────────────────────────────────
console.log("\n— 7. se escriben, y el visor dice la verdad —\n");
comprobar(
  "las casillas salen de SUS métodos",
  /Una cuenta por método/.test(pantalla) &&
    /metodosDelPais\.map\(\(boton\) => \{/.test(pantalla),
  "nunca una lista escrita en el código"
);
comprobar(
  "el usuario que cobra tiene las suyas",
  /Sus cuentas, una por método/.test(pantalla) &&
    // Lleva `{` y no `(` desde que cada método tiene su interruptor al lado.
    /metodosDe\(pais\.code\)\.map\(\(metodo\) => \{/.test(pantalla),
  "con su interruptor cada una"
);
// LO QUE MAS IMPORTA DE LA PANTALLA. Un visor que miente en un numero de cuenta es
// peor que no tener visor: se escribe a ciegas y el error se descubre cobrando.
comprobar(
  "el visor enseña la cuenta DE ESE método",
  /numeroDeCuenta:\s*\r?\n?\s*\(\s*\r?\n?\s*perfil\.cuentas_por_metodo\?\.\[/.test(
    pantalla
  ),
  "no la general"
);
comprobar(
  "y cae a la suelta si ese método no tiene",
  /\(perfil\.numero_de_cuenta \?\? ""\)\.trim\(\),/.test(pantalla),
  "igual que en vivo"
);

// ── 8. EL MÉTODO APAGADO NO SE OFRECE, EN LOS DOS SITIOS QUE OFRECEN ────────
//
// Es lo principal del apagado: si se ofrece, alguien lo elige. Se comprueba en los
// dos sitios, porque uno pinta los botones y el otro reconoce lo que el cliente
// ESCRIBE — si solo se filtrara uno, bastaria con teclear el nombre del metodo.
console.log("\n— 8. un método apagado no se ofrece ni se reconoce —\n");
comprobar(
  "no sale como botón",
  /const apagadosDelCobro = metodosApagadosDelCobro\(country, config\);[\s\S]{0,300}?!apagadosDelCobro\.includes\(String\(b\.method \?\? ""\)\.trim\(\)\.toLowerCase\(\)\)/.test(
    conf
  ),
  "getPaymentButtons"
);
comprobar(
  "ni se reconoce si el cliente lo escribe",
  (conf.match(/!apagadosDelCobro\.includes\(/g) ?? []).length === 2,
  "getPaymentMethods también"
);
comprobar(
  "y el cinturón: apagado no hereda la del dueño",
  /numero_de_cuenta: elMetodoEstaApagadoParaElCobro\(country, cfg, metodo\)/.test(
    conf
  )
);
comprobar(
  "la pantalla avisa si se apagan TODOS",
  /Su\s*\r?\n?\s*tienda no tendría ninguna forma de cobrar aquí/.test(pantalla),
  "o el cliente llega y no hay cómo pagar"
);
comprobar(
  "y el apagado sobrevive al guardado",
  /metodos_apagados\.length > 0 \? \{ metodos_apagados \} : \{\}/.test(api) &&
    /strList\(d\?\.metodos_apagados\)/.test(api)
);

console.log(
  fallos === 0
    ? "\nTODO OK — el comodín da la cuenta del método, y sin cuentas por método la de siempre\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
