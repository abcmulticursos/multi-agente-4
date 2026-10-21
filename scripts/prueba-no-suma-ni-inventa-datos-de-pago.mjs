// LOS DOS PRODUCTOS NO SE SUMAN, Y SIN ELEGIR NO SALEN DATOS DE PAGO.
//
// LO QUE PASO — 22 de septiembre de 2026, dos veces en el mismo dia.
//
//   1. Una clienta pidio «los dos kit». El modelo SUMO los dos precios, le dio
//      el total y ella lo pago. Cobro de mas. El full NO es un producto nuevo:
//      es el mismo producto mas un complemento, asi que «los dos» no existe.
//
//   2. Otra pregunto donde pagar y el modelo se INVENTO un titular completo,
//      un nombre que no esta en ninguna parte de su contenido.
//
//   En los dos casos el prompt YA lo prohibia por escrito —«sin opcion elegida
//   no des datos de pago»— y el modelo se lo salto igual.
//
//   Palabras del dueño: «el prompt es como una pared que jamas va a detener un
//   rio». Asi que esto no se le pide al modelo: se le impide.
//
// LOS DOS CANDADOS, y miran el RESULTADO, no la frase del cliente:
//
//     datos de pago sin opcion elegida   ->  no sale
//     un importe que el dueño no puso    ->  no sale
//
//   Da igual como lo pida el cliente —«los dos», «los datos de cada uno», o
//   algo que no se nos ocurra—: se revisa lo que el bot IBA A MANDAR.
//
// LO QUE NO PUEDE ROMPER, y cada limite sale de un caso que se midio:
//
//   1. LINEAL. Ahi no hay nada que elegir y el bot manda datos de pago sin
//      ninguna eleccion: correr el candado alli bloquearia TODAS las ventas.
//   2. LOS COMPROBANTES. Al rechazar o aprobar, el bot nombra al CLIENTE
//      («el pago figura a nombre de...»), y ese nombre no esta en el contenido
//      del dueño. Por eso el candado no corre si ya eligio ni si acaba de
//      llegar una imagen.
//   3. LOS PRECIOS TACHADOS. El «Precio anterior: ~$15.000~» esta configurado
//      y el bot lo dice a proposito.
//
//   node scripts/prueba-no-suma-ni-inventa-datos-de-pago.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

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

const motor = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href
);
const { pareceDatosDePago, importesQueNoSonSuyos, getOrderBumpPriceSoles } = motor;
const m2 = motor;

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 52)} ${valor}`);
};

// El telefono de la clienta de verdad, para que los precios sean los de SU pais.
const AR = "5492227580764";

// -- 1. ¿QUE ES «DAR DATOS DE PAGO»? ----------------------------------------
console.log("\n-- 1. que cuenta como dar datos de pago ----------------------");
comprobar(
  "una cuenta larga cuenta",
  pareceDatosDePago("CBU: 4530000800014259932243"),
  "forma de cuenta"
);
comprobar(
  "un titular cuenta",
  pareceDatosDePago("A nombre de: Alguien Inventado"),
  "forma de titular"
);
// UNA SOLA LLAMADA NO PUEDE ENVENENAR A LA SIGUIENTE. El regex global recuerda
// donde se quedo, y con eso el segundo titular se escapaba.
comprobar(
  "y el segundo titular seguido tambien",
  pareceDatosDePago("A nombre de: Otro Mas") &&
    pareceDatosDePago("A nombre de: Y Otro"),
  "sin memoria entre llamadas"
);
comprobar(
  "explicar el contenido NO cuenta",
  !pareceDatosDePago("Trae mas de 3.000 diseños editables y una guia"),
  "no son datos de pago"
);
comprobar(
  "saludar tampoco",
  !pareceDatosDePago("¡Hola! Claro que si, te cuento todo 😊"),
  "no son datos de pago"
);

// -- 2. LA SUMA ---------------------------------------------------------------
console.log("\n-- 2. la suma de los dos productos ---------------------------");
// LA MISMA PRUEBA VALE EN LOS DOS BOTS. Uno vende con dos opciones y el otro
// con una: si solo hay una, no hay suma posible, asi que se comprueba lo que si
// aplica —que un importe inventado cae igual— y el resto se dice.
const caro = getOrderBumpPriceSoles("combo", false, AR);
const barato = getOrderBumpPriceSoles("basico", false, AR);
const base = m2.getEffectivePriceSoles(false, AR);
if (typeof caro === "number" && typeof barato === "number") {
  console.log(`     (sus precios: ${barato} y ${caro}; la suma seria ${barato + caro})`);
  comprobar(
    "el total sumado NO es un precio suyo",
    importesQueNoSonSuyos(`Total por los dos: $${barato + caro} ARS`, AR).includes(
      barato + caro
    ),
    "cazado"
  );
  comprobar(
    "pero cada precio suelto SI lo es",
    importesQueNoSonSuyos(`Sale $${caro} ARS`, AR).length === 0 &&
      importesQueNoSonSuyos(`Sale $${barato} ARS`, AR).length === 0,
    "los dos pasan"
  );
} else {
  console.log(`     (aqui se vende UNA sola opcion: precio ${base}, no hay suma posible)`);
  comprobar(
    "un importe inventado cae igual",
    importesQueNoSonSuyos(`Te sale $${base * 3 + 7} ARS`, AR).length > 0,
    "cazado"
  );
  comprobar(
    "y su precio de verdad pasa",
    importesQueNoSonSuyos(`Te sale $${base} ARS`, AR).length === 0,
    "pasa"
  );
}

// -- 3. LO QUE NO DEBE MARCAR -------------------------------------------------
console.log("\n-- 3. lo que NO debe marcar ----------------------------------");
for (const [que, t] of [
  ["una cantidad, no dinero", "Trae mas de 3.000 diseños editables"],
  ["una fecha", "Te lo entrego hoy 22/09/2026 sin falta"],
  ["un numero de operacion", "Anoto la operacion 00123456789"],
  ["sin numeros", "¡Hola! Te cuento todo sobre el material"],
  // EL ENLACE DEL REGALO. Lo destapo la prueba del dueño el 24/09/2026: el
  // guardarrail salio con «importes que no estan configurados
  // (122107740843423600)», que no es un precio sino el identificador del post
  // de Facebook. El «s/» de la moneda peruana estaba SIN FRONTERA, asi que
  // casaba con la barra de cualquier enlace: «post s/ 1221077…».
  //
  //     https://www.facebook.com/1265196766679188/posts/122107740795423600
  //                                              ^^^^^^^^
  //
  // Y el bot, tras insistir, le contesto con el texto de elegir opcion —«¿Cual
  // prefieres: QUIMICA EN ACCION o QUIMICA EN ACCION?»— en una conversacion que
  // iba del regalo. Una señal falsa que acaba en el chat de un cliente.
  [
    "el enlace del regalo",
    "Ingresa a https://www.facebook.com/1265196766679188/posts/122107740795423600 y comenta",
  ],
  ["un enlace sin protocolo", "Entra a www.midominio.com/posts/98765432100 y listo"],
  ["una lista numerada del regalo", "1 Ingresa al enlace 2 Escribe un comentario 3 Regresa aqui"],
  ["una palabra que acaba en «ars»", "Te sirve para disfrazars 500 veces"],
]) {
  const f = importesQueNoSonSuyos(t, AR);
  comprobar(que, f.length === 0, f.length ? `MARCA ${f.join(",")}` : "pasa");
}

// -- 3-bis. EL SALDO DEL UPGRADE ES UN IMPORTE SUYO ---------------------------
//
// LO QUE PASÓ — 24 de septiembre de 2026. El cliente había pagado la opción
// barata y pidió subir a la cara. El motor calculó bien el saldo y se lo dijo:
// «te falta completar S/.11». Y este guardarraíl marcó ese 11 como precio
// inventado, CUATRO veces en la misma conversación, así que cada respuesta se
// rehizo y costó el doble:
//
//     [wf] convo 116 pidio upgrade a combo en postventa; saldo pendiente S/.11
//     [llm:guardarail] convo 116: dijo importes que no están configurados (11)
//
// Un saldo no está configurado en el panel porque es una RESTA: el precio de la
// opción menos lo que ya abonó. Depende de la conversación. Así que lo que
// faltaba no era permitir cifras nuevas, era darle el dato con el que
// reconocerlas.
//
// Y LA MITAD QUE IMPORTA: la guarda no se afloja. Se permite lo que sale de SUS
// precios menos lo abonado, y nada más.
console.log("\n-- 3-bis. el saldo del upgrade -------------------------------");
{
  const caroAR = getOrderBumpPriceSoles("combo", false, AR);
  const baratoAR = getOrderBumpPriceSoles("basico", false, AR);
  if (typeof caroAR === "number" && typeof baratoAR === "number") {
    const saldo = caroAR - baratoAR;
    console.log(
      `     (pago ${baratoAR}, el caro vale ${caroAR}, el saldo es ${saldo})`
    );
    comprobar(
      // EL 25/09 ESTO SE QUEDÓ CORTO, Y PARA BIEN.
      //
      // Aquí se exigía que sin saber lo abonado el saldo saliera MARCADO — era el
      // rojo que probaba el arreglo del día anterior. Al día siguiente el dueño
      // se topó con el mismo guardarraíl marcándole el AHORRO (30 − 26 = 4) en
      // una conversación donde no había pagado nada, y la regla se amplió: toda
      // resta entre dos importes suyos cuenta como suya, con abono o sin él.
      //
      // Lo que esta comprobación protege no cambia —que el saldo es un importe
      // legítimo— y ahora lo es por los dos caminos. Lo que NO puede aflojarse
      // son las sumas, y eso lo vigilan las dos de abajo y la sección 3-ter.
      "el saldo es un importe suyo, con abono o sin el",
      importesQueNoSonSuyos(`Te falta $${saldo} ARS`, AR).length === 0 &&
        importesQueNoSonSuyos(`Te falta $${saldo} ARS`, AR, baratoAR).length ===
          0,
      "es una resta de sus precios"
    );
    comprobar(
      "sabiendo lo abonado, el saldo pasa",
      importesQueNoSonSuyos(`Te falta $${saldo} ARS`, AR, baratoAR).length === 0,
      "es una resta de los suyos"
    );
    comprobar(
      "y la suma inventada sigue cazada",
      importesQueNoSonSuyos(
        `Los dos juntos: $${caroAR + baratoAR} ARS`,
        AR,
        baratoAR
      ).includes(caroAR + baratoAR),
      "abonar algo no abre la puerta"
    );
    comprobar(
      "un saldo que no sale de sus precios, tambien",
      importesQueNoSonSuyos(`Te falta $${saldo + 3} ARS`, AR, baratoAR).includes(
        saldo + 3
      ),
      "solo la resta exacta"
    );
  } else {
    console.log("     (aqui se vende UNA sola opcion: no hay upgrade que medir)");
  }
  // Y SIN ABONO NO SE AÑADE NADA: un cliente que no ha pagado no tiene saldo, y
  // dejar pasar restas ahí sería abrir la puerta por nada.
  const baseAR = m2.getEffectivePriceSoles(false, AR);
  if (typeof baseAR === "number" && baseAR > 1) {
    comprobar(
      "sin haber abonado, se comporta igual que antes",
      importesQueNoSonSuyos(`Te falta $${baseAR - 1} ARS`, AR, 0).includes(
        baseAR - 1
      ),
      "cero no es un abono"
    );
  }
}

// -- 3-ter. EL AHORRO TAMBIÉN ES UNA RESTA DE LOS SUYOS -----------------------
//
// LO QUE PASÓ — 25 de septiembre de 2026, en su prueba. El cliente preguntó «que
// son 2 noentiendo» y acabó recibiendo el mensaje de emergencia del bot. Uno de
// los dos guardarraíles que se comieron los intentos fue éste:
//
//     [llm:guardarail] convo 135: dijo importes que no están configurados (4)
//
// Su combo costaba 30 y con descuento 26: el «4» era EL AHORRO, que es justo lo
// que hay que decirle a un cliente en etapa de oferta. Medido, los tres ahorros
// que salen de su configuración salían marcados.
//
// La resta del upgrade ya se permitía, pero solo con algo ABONADO, y aquí el
// cliente no había pagado nada. El ahorro no necesita pago: existe desde que hay
// un precio tachado y uno de oferta.
//
// Y SE ACOTA A LAS RESTAS, que es lo que protege: sumar no es restar, así que la
// suma que puso aquí este guardarraíl sigue cazada.
console.log("\n-- 3-ter. el ahorro entre dos precios suyos ------------------");
{
  const caroAR = getOrderBumpPriceSoles("combo", false, AR);
  const caroPromo = getOrderBumpPriceSoles("combo", true, AR);
  const baratoAR = getOrderBumpPriceSoles("basico", false, AR);
  if (typeof caroAR === "number" && typeof baratoAR === "number") {
    // Sin abonar nada: antes se marcaba, ahora pasa.
    const entreOpciones = caroAR - baratoAR;
    comprobar(
      "la diferencia entre sus dos opciones pasa",
      importesQueNoSonSuyos(`la diferencia es $${entreOpciones} ARS`, AR)
        .length === 0,
      `${caroAR} - ${baratoAR} = ${entreOpciones}`
    );
    if (typeof caroPromo === "number" && caroPromo > 0 && caroPromo !== caroAR) {
      const ahorro = caroAR - caroPromo;
      comprobar(
        "y el ahorro del precio tachado tambien",
        importesQueNoSonSuyos(`ahorras $${ahorro} ARS`, AR).length === 0,
        `${caroAR} - ${caroPromo} = ${ahorro}`
      );
    }
    // Y LA MITAD QUE PROTEGE: una SUMA no es una resta.
    comprobar(
      "la suma de los dos sigue cazada",
      importesQueNoSonSuyos(
        `los dos juntos $${caroAR + baratoAR} ARS`,
        AR
      ).includes(caroAR + baratoAR),
      "sumar no es restar"
    );
    comprobar(
      "y un importe que no sale de ninguna resta, tambien",
      importesQueNoSonSuyos(`te lo dejo en $${caroAR * 7 + 3} ARS`, AR).length >
        0,
      "no se abrio la puerta a cifras nuevas"
    );
  } else {
    console.log("     (aqui se vende UNA sola opcion: no hay dos precios que restar)");
  }
}

// -- 4. SUS BURBUJAS DE VERDAD ------------------------------------------------
//
// Lo que el bot dijo en su base: ni una sola puede salir marcada por importes.
console.log("\n-- 4. sus burbujas de verdad ---------------------------------");
let revisadas = 0;
let marcadas = 0;
const ejemplos = [];
try {
  const { createRequire } = await import("node:module");
  const requerir = createRequire(join(RAIZ, "package.json"));
  const Database = requerir("better-sqlite3");
  const db = new Database("data/messages.db", { readonly: true });
  const filas = db
    .prepare(
      "SELECT id, content FROM messages WHERE role='assistant' AND content IS NOT NULL AND TRIM(content) <> ''"
    )
    .all();
  // SOLO LAS DE LA MONEDA DE HOY. En su base quedan burbujas del 16 de
  // septiembre, de cuando el bot vendia en SOLES: «S/. 18», «S/. 10». Contra la
  // configuracion argentina de hoy salen marcadas, y ESO ESTA BIEN — a una
  // clienta argentina no debe salirle un precio en soles. Compararlas aqui seria
  // dar por falso positivo justo lo que el candado tiene que cazar.
  const esDeLaMonedaDeHoy = (t) => /\$|\bars\b|pesos/i.test(t) && !/s\/\./i.test(t);
  for (const f of filas) {
    if (!esDeLaMonedaDeHoy(f.content)) continue;
    revisadas++;
    const fuera = importesQueNoSonSuyos(f.content, AR);
    if (fuera.length) {
      marcadas++;
      if (ejemplos.length < 5)
        ejemplos.push(`      msg ${f.id}: ${fuera.join(", ")}  |  ${f.content.replace(/\s+/g, " ").slice(0, 60)}`);
    }
  }
} catch (e) {
  console.log(`     (sin base local: ${e.message.slice(0, 60)})`);
}
if (revisadas > 0) {
  comprobar(
    "ninguna de sus burbujas sale marcada",
    marcadas === 0,
    `${revisadas} revisadas, ${marcadas} marcadas`
  );
  for (const e of ejemplos) console.log(e);
}

// -- 5. LOS LIMITES ESTAN EN EL CODIGO ----------------------------------------
//
// Si alguien quita una de las tres condiciones, el candado empieza a romper
// cosas buenas. Se fijan aqui para que no se caigan sin que nadie lo note.
console.log("\n-- 5. los tres limites siguen puestos ------------------------");
const cerebro = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8");
comprobar(
  "solo si HAY dos opciones",
  /const hayDosOpciones = isOrderBumpActive\(\) \|\| isDobleOfertaActive\(\);/.test(
    cerebro
  ),
  "en lineal no corre"
);
comprobar(
  "solo si NO hay eleccion",
  /hayDosOpciones && !yaEligio && !turnHasImage && pareceDatosDePago\(text\)/.test(
    cerebro
  ),
  "los comprobantes pasan"
);
comprobar(
  "y si insiste, sale SU texto",
  /choice_clarification/.test(cerebro) && /renderOrderBumpTemplate\(/.test(cerebro),
  "no una frase escrita en el codigo"
);
comprobar(
  "una sola segunda oportunidad",
  /pagoInventadoRetries < 1/.test(cerebro),
  "nunca una tercera"
);

console.log(
  fallos === 0
    ? "\nTODO OK — no se suman los dos, y sin elegir no salen datos de pago\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
