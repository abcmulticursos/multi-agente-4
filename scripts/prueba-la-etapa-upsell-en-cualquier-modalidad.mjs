// La etapa Upsell deja de ser de dos modalidades y pasa a ser de la que la
// tenga llena.
//
// QUE ES LA ETAPA UPSELL
//
//   La segunda venta: tras entregar el primer producto, el bot ofrece otro. No
//   es un mensaje — lleva su nombre, su intro, su pregunta, su precio, su
//   galeria, sus respuestas de pago y su entrega. Una venta entera en pequeño.
//
// COMO ESTABA
//
//   Solo la tenian «Doble Oferta + Upsell» y la modalidad «Upsell». Y encima se
//   editaba en UN SOLO SITIO: al guardar se copiaba dentro de Doble Oferta +
//   Upsell, asi que tocar la de una pisaba la de la otra.
//
//   Lineal, Order Bump y Doble Oferta no podian tener ninguna. Y no era que
//   faltara tuberia: `seccionUpsell` les devolvia `null`. Todo lo de despues
//   —precio, cobro, validacion del comprobante, entrega, cerebro y la espera del
//   regalo— ya pasaba por ahi sin preguntar nunca por la modalidad.
//
// COMO QUEDA
//
//   Cada modalidad guarda SU etapa en su capa. La puerta devuelve la de la que
//   vende. Y una etapa vacia es inerte: el motor exige encendida, con nombre,
//   con entrega y con precio.
//
// EL CHOQUE QUE SE ENCONTRO REVISANDO (y que no llego a deployarse)
//
//   `upsell.enabled` significaba «la modalidad Upsell vende». Al reusarlo como
//   «esta modalidad ofrece un segundo producto», encender la etapa en Lineal
//   habria cambiado la modalidad que vende el bot. Se separo en dos campos.
//
//   node scripts/prueba-la-etapa-upsell-en-cualquier-modalidad.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const editor = leer("src", "app", "editor", "page.tsx");
const config = leer("src", "lib", "workflow", "config.ts");
const motor = leer("src", "lib", "workflow", "engine.ts");
const pago = leer("src", "lib", "workflow", "payment.ts");
const ruta = leer("src", "app", "api", "workflow", "route.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. LOS DOS INTERRUPTORES, SEPARADOS ──────────────────────────────────────
//
// Aqui estaba el choque. Un mismo campo no puede decir «la modalidad Upsell
// vende» y «esta modalidad ofrece un segundo producto»: encender la etapa en
// Lineal habria dejado de vender Lineal, sin tocar nada mas.
const escalera = (() => {
  const i = config.indexOf("function activeModalityKey(config: WorkflowConfig)");
  const f = config.indexOf('return "lineal";', i);
  return i < 0 || f < 0 ? "" : config.slice(i, f);
})();
comprobar("se encuentra la escalera de modalidades", escalera.length > 0, "activeModalityKey");
comprobar(
  "la modalidad Upsell tiene su propio interruptor",
  /config\.upsell_modalidad_enabled \?\? config\.upsell\?\.enabled/.test(escalera),
  "no comparte campo con la etapa"
);
comprobar(
  "y el editor decide igual que el motor",
  /c\.upsell_modalidad_enabled \?\? c\.upsell\?\.enabled/.test(editor),
  "dos escaleras que dicen lo mismo"
);
// El `??` es compatibilidad, no un parche: un archivo que aun no se ha guardado
// con esta version sigue decidiendose con el campo antiguo. Y se cierra solo,
// porque el guardado escribe SIEMPRE el nuevo.
comprobar(
  "el interruptor nuevo se escribe en cada guardado",
  /upsell_modalidad_enabled: _runtimeMode === "upsell"/.test(editor),
  "la ventana de compatibilidad se cierra sola"
);
comprobar(
  "y la ruta lo lleva y lo trae",
  /upsell_modalidad_enabled:/.test(ruta) &&
    /doc\.set\("upsell_modalidad_enabled"/.test(ruta),
  "de ida y de vuelta"
);
// Activar esa modalidad enciende su etapa: sin ella seria Lineal con otro
// nombre, y antes salia gratis porque un solo campo hacia las dos cosas.
// Y SE ENCIENDE EN SU CAPA, NO EN LA PANTALLA.
//
// El guardado arma lo que lee el motor desde la CAPA de la modalidad que vende,
// no desde lo que hay en pantalla. Encenderla solo en pantalla se perdia al
// guardar —la capa seguia diciendo «apagada»— y la modalidad Upsell quedaba
// activa sin ofrecer nada. Antes no hacia falta porque el guardado forzaba el
// interruptor a partir del nombre de la modalidad; eso se quito porque apagaba
// la etapa en Lineal y en Order Bump.
comprobar(
  "activar la modalidad Upsell enciende su etapa EN SU CAPA",
  /if \(newMode === "upsell"\) \{[\s\S]{0,300}?templates\.upsell = \{[\s\S]{0,200}?upsell: \{ \.\.\.\(capa\.upsell \?\? \{ \.\.\.UPSELL_VACIO \}\), enabled: true \},/.test(
    editor
  ),
  "quien la activa espera que ofrezca"
);
// Y en pantalla SOLO si es esa misma la que se edita: en cualquier otra,
// tocarlo le encenderia la etapa a la modalidad que el operador tiene delante.
comprobar(
  "y no le enciende la etapa a la modalidad que se edita",
  /newMode === "upsell" && editingMode === "upsell"/.test(editor),
  "cada una la suya"
);

// ── 2. LA PUERTA DEL MOTOR ───────────────────────────────────────────────────
const puerta = (() => {
  const i = config.indexOf("export function seccionUpsell(");
  const f = config.indexOf("\n}", config.indexOf("return cfg.upsell ?? null;", i));
  return i < 0 || f < 0 ? "" : config.slice(i, f);
})();
comprobar("se encuentra la puerta", puerta.length > 0, "seccionUpsell");
comprobar(
  "Doble Oferta + Upsell sigue leyendo la SUYA",
  /if \(key === "doble_oferta_upsell"\) return cfg\.doble_oferta_upsell\?\.upsell \?\? null;/.test(
    puerta
  ),
  "lo que funciona no se toca"
);
comprobar(
  "y las demas leen la de la modalidad que vende",
  /return cfg\.upsell \?\? null;/.test(puerta) && !/return null;\s*\n\}/.test(puerta),
  "se acabo el candado"
);

// ── 3. LA TUBERIA DE DESPUES NO SE TOCO ──────────────────────────────────────
//
// Precio, cobro, validacion del comprobante, entrega y cerebro ya pasaban todos
// por la puerta y ninguno pregunta por la modalidad. Esta prueba lo fija: si
// alguien mete un «si la modalidad es X» en cualquiera de ellos, se pone roja.
comprobar(
  "el precio del extra sale de la puerta",
  /const up = seccionUpsell\(config\);/.test(config),
  "getUpsellPriceSoles"
);
comprobar(
  "la entrega del extra sale de la puerta",
  /const seq = seccionUpsell\(\)\?\.delivery;/.test(pago),
  "entregarUpsell"
);
comprobar(
  "el comprobante del extra se decide por el ESTADO, no por la modalidad",
  /const esPagoDeUpsell =\s*\r?\n?\s*!pidioSubirAlCombo &&\s*\r?\n?\s*\(convo\.upsell_state === "aceptado" \|\| convo\.upsell_state === "ofrecido"\)/.test(
    pago
  ),
  "upsell_state"
);
comprobar(
  "el cierre tras entregar es el mismo para todas",
  /if \(isUpsellUsable\(config\) && laOfertaSigueDebiendose\)/.test(motor) &&
    /seguirConRegalo\(convo\.id\);/.test(motor),
  "continuarTrasEntrega"
);
// La red de seguridad que ya existia y hay que conservar.
comprobar(
  "si ofrecerlo falla, el regalo NO se pierde",
  /no pude ofrecerlo, sigo con el regalo/.test(motor),
  "prefiero perder la segunda venta"
);

// ── 4. LA ENTREGA POR CANAL, EN TODAS ────────────────────────────────────────
//
// El eslabon que se habria quedado desconectado: el grupo «upsell» de cada canal
// solo se aplicaba dentro de las ramas de las dos modalidades que podian tener
// etapa. Sin esto, el bot ofreceria el extra y lo cobraria, pero al entregarlo
// ignoraria lo que el operador escribio en ese canal.
comprobar(
  "la entrega del extra por canal vale para cualquier modalidad",
  /const entregaDelUpsellDelCanal = deliveryGroupSteps\(content, "upsell"\);/.test(
    config
  ),
  "fuera de la escalera de ramas"
);
// PERO SOLO SI EL CANAL TIENE ALGO QUE MANDAR.
//
// `deliveryGroupSteps` devuelve los pasos del grupo, y un grupo recien aparecido
// los tiene VACIOS. Un array vacio es "verdadero" en JavaScript, asi que pisaba
// la entrega escrita en la pestaña Upsell con nada — y sin entrega el segundo
// producto deja de ofrecerse. Se apagaba solo, sin avisar.
//
// Y pasa justo con esta caja porque es NUEVA: en las modalidades que antes no
// podian tener etapa, aparece sola la primera vez que se abre Canales, vacia.
comprobar(
  "una caja de canal vacia no borra la entrega escrita",
  /if \(hasSendableSteps\(entregaDelUpsellDelCanal\) && next\.upsell\)/.test(
    config
  ),
  "vacio no es una entrega"
);
// Y la caja donde escribirla. Sin ella el motor buscaría un grupo que el editor
// nunca ofrece: el bot ofrecería el segundo producto, lo cobraría, y al
// entregarlo no tendría qué mandar por ese canal.
comprobar(
  "el editor ofrece esa caja en cualquier modalidad",
  /const grupoDelUpsell = \(\): ChannelDeliveryGroupEditor\[\] =>/.test(editor) &&
    (editor.match(/\.\.\.grupoDelUpsell\(\),/g) ?? []).length >= 5,
  "una caja por modalidad"
);
comprobar(
  "y solo cuando esa modalidad tiene etapa escrita",
  /if \(!\(etapa\?\.name \?\? ""\)\.trim\(\)\) return \[\];/.test(editor),
  "una caja para un producto que no existe confunde"
);

// ── 5. CADA ETAPA EN SU CAPA ─────────────────────────────────────────────────
comprobar(
  "la capa de cada modalidad guarda su etapa",
  /^  upsell\?: FullConfig\["upsell"\];$/m.test(editor),
  "ModalidadTemplateEditor"
);
comprobar(
  "lo que se edita se guarda en SU capa",
  /upsell: c\.upsell,/.test(editor),
  "templateFromCfg"
);
comprobar(
  "y una capa sin etapa cae a VACIA, no a la del vecino",
  /upsell: t\.upsell \?\? \{ \.\.\.UPSELL_VACIO \}/.test(editor),
  "vacia es honesta"
);
comprobar(
  "la etapa esta protegida del guardado cruzado",
  /\["upsell", "la etapa Upsell"\]/.test(editor),
  "LO_QUE_DICE_EL_BOT"
);
comprobar(
  "y conserva su interruptor al protegerla",
  /"upsell",\s*\n\] as const;/.test(editor),
  "SECCIONES_CON_INTERRUPTOR"
);
// La capa tiene que EXISTIR antes de sembrarla: «upsell» suele faltar, y
// saltarsela dejaria a Doble Oferta + Upsell sin etapa — apagandole el tercer
// producto al guardar.
comprobar(
  "se crea la capa que falte antes de sembrar",
  /if \(!loaded\.modality_templates\[modo\]\) \{[\s\S]{0,200}emptyTemplateForMode\(/.test(
    editor
  ),
  "ninguna se queda fuera"
);

// ── 6. LA PESTAÑA Y EL IMPORTAR ──────────────────────────────────────────────
comprobar(
  "la pestaña Upsell se ve en todas las modalidades",
  !/if \(key === "upsell"\)\s*\r?\n?\s*return activeModality\(cfg\) === "upsell"/.test(
    editor
  ) && !/\(tab === "upsell" && modo !== "upsell" && !dobleConUpsell\)/.test(editor),
  "ya no se echa de ninguna"
);
// El interruptor es ahora un boton que dice lo que va a hacer. Lo que importa no
// ha cambiado: es UNO solo, y enciende la ETAPA de la modalidad que se edita —
// nunca la modalidad Upsell, que en Lineal cambiaria lo que vende el bot.
comprobar(
  "hay un solo interruptor, y es el de la etapa",
  /"Desactivar upsell" : "Activar upsell"/.test(editor) &&
    !/Activar la modalidad Upsell/.test(editor),
  "en Lineal ya no cambia lo que vende"
);
comprobar(
  "se puede traer la etapa de otra modalidad",
  /function TraerEtapaUpsell\(/.test(editor) &&
    /const importarEtapaUpsell = \(origen: Modo\): void =>/.test(editor),
  "importar si, prestar no"
);
comprobar(
  "solo se ofrecen origenes que TIENEN etapa escrita",
  /return !!\(cfg\.modality_templates\?\.\[modo\]\?\.upsell\?\.name \?\? ""\)\.trim\(\);/.test(
    editor
  ),
  "traer de una vacia seria borrar la tuya"
);
comprobar(
  "y el interruptor NO se importa",
  /upsell: \{ \.\.\.traida, enabled: cfg\.upsell\?\.enabled === true \}/.test(editor),
  "encenderla es decision aparte"
);

// ── 6 bis. LOS MINUTOS DE ESPERA TAMBIEN SON DE TODAS ────────────────────────
//
// El motor nunca miro la modalidad para esto: lee `retraso_minutos` de la etapa
// que este vendiendo, sea la que sea. Pero el CAMPO para ponerlos salia solo en
// Doble Oferta + Upsell, de cuando la etapa era suya. En Lineal y en Order Bump
// la espera se quedaba en 0 y el upsell salia pegado a la entrega — que es
// justo lo que este campo existe para evitar.
comprobar(
  "el motor espera igual en cualquier modalidad",
  /seccionUpsell\(config\)\?\.retraso_minutos \?\? 0/.test(motor),
  "sale de la puerta, no de la modalidad"
);
comprobar(
  "y el campo para ponerlos se ve en todas",
  /Minutos desde la entrega hasta ofrecer el Upsell/.test(editor) &&
    !/activeModality\(cfg\) === "doble_oferta_upsell" \? \(\s*\r?\n?\s*\/\/ Solo en esta modalidad/.test(
      editor
    ),
  "sin reja de modalidad"
);
comprobar(
  "la API los deja pasar en las dos direcciones",
  (ruta.match(/retraso_minutos: num\(/g) ?? []).length >= 4,
  "leer y escribir"
);

// ── 5 bis. EL INTERRUPTOR SOBREVIVE AL GUARDADO ──────────────────────────────
//
// Aqui estaba el fallo que dejaba la etapa MUERTA fuera de la modalidad Upsell,
// y se encontro revisando la tuberia entera, no probando.
//
// `order_bump.enabled`, `bioferta.enabled` y `doble_oferta_dos.enabled` SON la
// modalidad: la pantalla los fuerza a partir de cual vende, y esta bien. Pero
// `upsell.enabled` dejo de significar eso —ahora es «esta modalidad ofrece un
// segundo producto»— y seguia forzandose igual, en TRES sitios: al cargar el
// editor, en lo que se manda a guardar, y en la vista de despues de guardar.
//
// El resultado: en Lineal y en Order Bump la casilla se encendia en pantalla y
// el guardado la apagaba en el mismo viaje. Su prueba en el archivo era la capa
// `lineal.upsell` con nombre escrito y `enabled: false`.
// El `(?<!\w)` deja fuera `upsell_modalidad_enabled`, que SI se decide por la
// modalidad y tiene que seguir haciendolo: es el otro significado, el que se
// separo justamente para que estos dos no volvieran a ser el mismo campo.
const forzados = (
  editor.match(/(?<!\w)enabled: (_runtimeMode|runtime) === "upsell"/g) ?? []
).length;
comprobar(
  "el interruptor de la etapa no se fuerza por la modalidad",
  forzados === 0,
  forzados === 0 ? "sale de su capa" : `${forzados} sitio(s) lo fuerzan`
);
comprobar(
  "lo que se guarda sale de la capa que vende",
  /enabled: _runtimeApplied\.upsell\?\.enabled === true,/.test(editor),
  "no del nombre de la modalidad"
);
// Y el de la MODALIDAD sigue escribiendose por separado: son dos cosas, y
// juntarlas otra vez es volver al choque del principio.
comprobar(
  "el de la modalidad se sigue escribiendo aparte",
  /upsell_modalidad_enabled: _runtimeMode === "upsell"/.test(editor),
  "dos campos, dos significados"
);
// Y su entrega por canal no se puede borrar por accidente: la caja se repone
// de la modalidad, asi que borrarla la devolvia VACIA y se perdia lo escrito.
comprobar(
  "la entrega del upsell es fija tambien en Lineal",
  /const isFixedDeliveryGroup = \(key: string\) =>\s*\r?\n?\s*key === "upsell" \|\|/.test(
    editor
  ),
  "no se borra ni se mueve"
);

// ── 6 quinquies. Y SI NO SE OFRECE, QUE SE SEPA POR QUE ──────────────────────
//
// El motor exige CUATRO cosas: interruptor, nombre, precio y entrega. Si falta
// una, se salta la segunda venta y sigue con el regalo — bien hecho: prefiere
// no vender a no poder entregar. Pero lo hacia EN SILENCIO, y desde fuera «no
// se ofrece» y «esta roto» se ven exactamente igual.
//
// Costo una prueba completa de venta descubrir que en Lineal faltaban el
// interruptor y la entrega. Ahora lo dice el log, y el editor lo dice ANTES.
comprobar(
  "el motor dice en el log que le falta",
  /NO lo ofrezco — le falta \$\{loQueLeFalta\.join\(/.test(motor) &&
    /const loQueLeFalta = queLeFaltaAlUpsell\(config\);/.test(motor),
  "no se calla"
);
// Solo cuando le falta algo. Si ya se ofrecio antes no hay nada que explicar, y
// una modalidad que nunca la uso no tiene por que llenar el log en cada venta.
comprobar(
  "y no ensucia el log cuando no toca",
  /loQueLeFalta\.length > 0 && \(seccionUpsell\(config\)\?\.name \?\? ""\)\.trim\(\)/.test(
    motor
  ),
  "solo si esta a medias"
);
// Las mismas cuatro condiciones que decide `isUpsellUsable`, en el mismo
// archivo: si se separaran, el aviso diria una cosa y el bot haria otra.
comprobar(
  "explica exactamente lo que exige el motor",
  /export function queLeFaltaAlUpsell\(/.test(config) &&
    /falta\.push\("el INTERRUPTOR/.test(config) &&
    /falta\.push\("el NOMBRE del producto"\)/.test(config) &&
    /falta\.push\("la ENTREGA/.test(config) &&
    /falta\.push\("el PRECIO/.test(config),
  "las cuatro"
);
// Y el editor lo enseña ANTES de gastar una prueba de venta entera.
comprobar(
  "el editor lo enseña antes de probar",
  /function ChequeoDelUpsell\(/.test(editor) &&
    /<ChequeoDelUpsell cfg=\{cfg\} \/>/.test(editor),
  "en la pestaña Upsell"
);
// Contando la entrega DEL CANAL: es donde vive de verdad, y en el archivo suele
// estar vacia. Mirar solo el archivo daria un rojo falso permanente.
comprobar(
  "y cuenta la entrega del canal, no solo la del archivo",
  /grupo\.key === "upsell" &&\s*\r?\n?\s*grupo\.enabled !== false &&\s*\r?\n?\s*\(grupo\.steps \?\? \[\]\)\.some\(pasoTieneAlgo\)/.test(
    editor
  ),
  "donde vive de verdad"
);

// ── 6 sexies. EL CUADRITO QUE CONTESTA QUE SI PERO NO ACEPTA ─────────────────
//
// Un cuadrito de la oferta manda sus burbujas y, sin ACCION enlazada, ahi se
// acaba: `responderConElCuadritoDelExtra` hace `if (!cuadrito.action) return
// false`. No se anota que acepto, no salen los datos de pago con el precio del
// segundo producto, y no queda registrado el metodo — y de ese apunte dependen
// el monto contra el que se valida el comprobante y el producto que se entrega.
//
// Paso de verdad, en Order Bump: un cuadrito «SI» con las instrucciones de pago
// escritas dentro y sin accion. Y no siempre se nota: mientras el regalo no haya
// salido, un «si» suelto se acepta por otro camino. Pasado ese plazo ya no, asi
// que en una prueba funciona y en la siguiente no, segun lo que se tarde en
// contestar.
comprobar(
  "un cuadrito sin accion NO acepta la oferta",
  /await sendConfiguredSteps\(convo, cuadrito\.steps, precioDelExtra\);\s*\r?\n\s*if \(!cuadrito\.action\) return false;/.test(
    motor
  ),
  "contestar no es aceptar"
);
// Como eso es a proposito —un «si» puede ser del regalo, que es la pregunta mas
// reciente—, lo que se vigila es que el editor AVISE. Si no, la unica forma de
// enterarse es que se caiga una venta en el cobro.
// El aviso era una caja roja aparte y ahora es la QUINTA LINEA del chequeo: eran
// dos cajas de estado, una debajo de otra, diciendo cada una la mitad de si el
// producto se va a vender. Lo que se vigila sigue siendo lo mismo, que el editor
// AVISE: sin eso, la unica forma de enterarse es que se caiga una venta.
comprobar(
  "y el editor avisa de los que suenan a aceptacion",
  /function cuadritosQueNoAceptan\(cfg: FullConfig\): string\[\]/.test(editor) &&
    /const flojos = cuadritosQueNoAceptan\(cfg\);/.test(editor) &&
    /Los cuadritos que dicen «sí» aceptan/.test(editor),
  "antes de que se caiga una venta"
);
// Y no se cuenta entre las cuatro que deciden si se OFRECE. Sumarlo ahi haria
// que la cabecera dijera «asi no se ofrece» cuando si se ofrece, y mandaria a
// buscar el fallo donde no esta: lo que se rompe es el cobro.
comprobar(
  "pero sin mentir sobre lo que esta roto",
  /flojos\.length > 0\s*\r?\n?\s*\?\s*"⚠️ Se ofrece, pero el «sí» no se cobra"/.test(
    editor
  ),
  "se ofrece, no se cobra"
);
comprobar(
  "el aviso no molesta con el cuadrito «NO»",
  /if \(cuadrito\.action === "choose_upsell"\) continue;/.test(editor) &&
    /if \(!dice\.some\(suenaASi\)\) continue;/.test(editor),
  "solo los que dicen que si"
);
// Y la accion que hay que enlazar tiene que seguir existiendo en el menu.
comprobar(
  "la accion que lo arregla sigue en el menu de enlaces",
  /\{ valor: "choose_upsell", texto: "UPSELL \(el segundo producto\)" \}/.test(
    editor
  ),
  "UPSELL (el segundo producto)"
);

// ── 6 quater. Y SU CAJON EN «CONTENIDO» ──────────────────────────────────────
//
// El cajon «PRODUCTO UPSELL» de la pestaña Contenido —nombre, contenido y
// galeria— salia solo en Doble Oferta + Upsell. En Lineal y en Doble Oferta el
// producto del upsell no tenia donde escribirse: el bot lo ofreceria sin
// nombre, y sin nombre no lo ofrece (isUpsellUsable exige nombre).
//
// Se muestra SIEMPRE, no solo cuando ya tiene nombre: el nombre se escribe
// dentro, asi que esconderlo hasta tenerlo seria un cajon al que nunca se puede
// entrar. Es justo lo contrario del boton de precio, que si depende del nombre
// porque ese nombre se escribe en otro sitio.
comprobar(
  "el cajon del upsell en Contenido no depende de la modalidad",
  /\{\/\* EL CAJÓN DEL UPSELL ES DE TODAS LAS MODALIDADES\./.test(editor) &&
    !/\{isDobleOfertaUpsell && \(\s*\r?\n\s*<Collapsible title="🎁 PRODUCTO UPSELL">/.test(
      editor
    ),
  "se ve en todas"
);
comprobar(
  "y es el MISMO campo que el de la pestaña Upsell",
  (editor.match(/upsell: \{ \.\.\.cfg\.upsell, name: e\.target\.value \}/g) ?? [])
    .length >= 2,
  "un nombre, no dos copias"
);

// ── 6 ter. EL PRECIO DEL UPSELL, EN TODAS Y POR PAIS ─────────────────────────
//
// Mismo caso que los minutos, y peor: el motor resuelve
// `modality_payment_profiles[modalidad][pais].upsell` SIN preguntar cual es la
// modalidad, pero el boton UPSELL de «Precios y pagos» salia solo en Doble
// Oferta + Upsell. En Lineal y en Order Bump el upsell se quedaba con un unico
// precio global para todos los paises — y en un pais con otra moneda eso es
// cobrar mal, que no da error: cobra de menos y nadie se entera.
comprobar(
  "el motor resuelve el precio del upsell por modalidad y pais",
  /const mode = activeModalityKey\(config\);\s*\r?\n\s*return \(\s*\r?\n\s*config\.modality_payment_profiles\?\.\[mode\]\?\.\[country\]/.test(
    config
  ) &&
    /resolveCountryPaymentProfile\(\s*\r?\n?\s*getEffectiveCountryCode\(phone, cfg\),\s*\r?\n?\s*cfg\s*\r?\n?\s*\)\?\.upsell/.test(
      config
    ),
  "nunca pregunta por la modalidad"
);
// Y con LA MISMA configuracion que decide. Estas dos caian al archivo del disco
// por su valor por defecto: se decidia con una configuracion y se consultaba el
// precio en otra. En produccion coinciden, pero es una trampa puesta — basta
// preguntar por una configuracion de prueba para que conteste con la real.
comprobar(
  "y el precio sale de la misma configuracion que decide",
  /const cfg = config \?\? loadWorkflowConfig\(\);\s*\r?\n\s*const delPais = resolveCountryPaymentProfile\(/.test(
    config
  ),
  "no la del disco"
);
comprobar(
  "el boton UPSELL sale en cualquier modalidad con etapa",
  /\(layerMode === "doble_oferta_upsell" \|\|\s*\r?\n?\s*!!\(cfg\.upsell\?\.name \?\? ""\)\.trim\(\)\) && \(/.test(
    editor
  ),
  "si hay producto, hay precio"
);
// Y una sola casilla para ese precio. La de la pestaña Upsell escribia la
// global mientras «Precios y pagos» escribia la del pais: dos numeros para lo
// mismo, y manda el del pais. Ahora las dos escriben la capa de la modalidad.
comprobar(
  "la casilla de la pestaña escribe la MISMA capa que Precios y pagos",
  /const modoDeLaCapa = activeModality\(cfg\);/.test(editor) &&
    /cfg\.modality_payment_profiles\?\.\[modoDeLaCapa\] \?\? \{\}/.test(editor) &&
    !/doble_oferta_upsell: \{\s*\r?\n\s*\.\.\.capa,/.test(editor),
  "un precio, un sitio"
);

// ── 7. EL CONTENIDO DE HOY, COMO AVISO ───────────────────────────────────────
const cfg = YAML.parse(leer("config", "intro-data.yaml"));
const runtime = cfg.doble_oferta_upsell?.enabled
  ? "doble_oferta_upsell"
  : (cfg.upsell_modalidad_enabled ?? cfg.upsell?.enabled)
    ? "upsell"
    : cfg.doble_oferta_dos?.enabled
      ? "doble_oferta_dos"
      : cfg.order_bump?.enabled
        ? "order_bump"
        : cfg.bioferta_doble?.enabled
          ? "bioferta"
          : "lineal";
// LA RAIZ ES DE LA MODALIDAD QUE VENDE, NO DE LA MODALIDAD «UPSELL».
//
// AQUI ESTABA UNA NOTA QUE ACUSABA A QUIEN NO ERA.
//
// Esto leia `cfg.upsell` para la modalidad Upsell. Pero la raiz no es suya: el
// editor proyecta ahi la etapa de la modalidad que esta VENDIENDO, sea cual
// sea. Asi que con Order Bump vendiendo, la etapa de Order Bump se leia como si
// fuera de la modalidad Upsell — y su capa, que esta vacia, ni se miraba.
//
// Resultado: la prueba avisaba de que la modalidad Upsell tenia un producto a
// medias que no existe, y mandaba a arreglar un problema inventado. Eso gasta
// mas confianza que no avisar.
//
// Cada modalidad lee SU capa. Solo la que vende cae a la raiz, que es donde
// esta proyectada la suya.
const etapaDe = (m) =>
  m === "doble_oferta_upsell"
    ? cfg.doble_oferta_upsell?.upsell
    : m === runtime
      ? cfg.modality_templates?.[m]?.upsell ?? cfg.upsell
      : cfg.modality_templates?.[m]?.upsell;
// LA ENTREGA PUEDE VENIR DEL CANAL, y hay que mirarla como la mira el bot.
//
// La primera version de esta prueba leia solo el archivo base y decia que la
// etapa que vende estaba incompleta — cuando en los logs se veia ofrecida y
// aceptada. El motor arma la configuracion aplicando encima el contenido del
// canal, y la entrega del extra vive ahi: en el grupo «upsell» del canal, no en
// la seccion. Sin esto, la prueba mentia.
const entregaDelCanal = (modo) => {
  for (const canal of ["whatsapp", "messenger", "instagram", "tiktok"]) {
    const c = cfg.channels?.[canal];
    if (c?.enabled !== true || c?.use_content !== true) continue;
    const grupo = (c.modality_templates?.[modo]?.delivery_groups ?? []).find(
      (g) => g.key === "upsell" && g.enabled !== false
    );
    if ((grupo?.steps ?? []).length > 0) return grupo.steps;
  }
  return null;
};
// Y LA TERCERA FUENTE: EL PRODUCTO SENTADO EN EL PUESTO «UPSELL».
//
// Desde que existe el reparto de puestos, la entrega de la segunda venta sale de
// la ficha del producto y no de la etapa. Mirando solo la etapa y el canal, esta
// prueba decia «le falta la entrega» de una segunda venta que se entrega
// perfectamente — y una prueba que acusa en falso se deja de mirar.
const entregaDelPuesto = (modo) => {
  const id = cfg.alineacion_por_modalidad?.[modo]?.upsell;
  if (!id) return null;
  const producto = (cfg.biblioteca_de_productos ?? []).find((p) => p?.id === id);
  const pasos = producto?.delivery ?? [];
  return pasos.length > 0 ? pasos : null;
};
// EL PRECIO SE BUSCA DONDE LO BUSCA EL MOTOR: primero la capa del pais y
// despues el escrito en la etapa. Mirando solo la etapa, la tabla de abajo
// decia «apagada o incompleta» de una etapa que se ofrece perfectamente, con su
// precio puesto por pais. Una tabla que contradice a su propia comprobacion es
// peor que no tener tabla.
const vale = (n) => typeof n === "number" && n > 0;
const tienePrecio = (u, modo) =>
  vale(u?.price_soles) ||
  Object.values(
    cfg.modality_payment_profiles?.[modo] ?? cfg.payment_profiles_by_country ?? {}
  ).some((p) => vale(p?.upsell?.price_soles));
const usable = (u, modo) => {
  const entrega =
    Array.isArray(u?.delivery) && u.delivery.length > 0
      ? u.delivery
      : entregaDelCanal(modo) ?? entregaDelPuesto(modo);
  return (
    !!u &&
    u.enabled === true &&
    (u.name ?? "").trim().length >= 2 &&
    !!entrega &&
    entrega.length > 0 &&
    tienePrecio(u, modo)
  );
};
console.log(`\n--- las etapas de hoy (vende: ${runtime}) ---`);
for (const m of ["lineal", "order_bump", "bioferta", "doble_oferta_dos", "doble_oferta_upsell", "upsell"]) {
  const u = etapaDe(m);
  const marca = m === runtime ? "  <-- LA QUE VENDE" : "";
  console.log(
    `     ${pad(m, 22)} ${
      !u ? "(sin capa todavia)" : usable(u, m) ? `OFRECE «${u.name}»` : "apagada o incompleta"
    }${marca}`
  );
}
// AQUI SE EXIGIA QUE DOBLE OFERTA + UPSELL TUVIERA SU ETAPA LLENA, Y ESTABA MAL
// PLANTEADO.
//
// Se puso como referencia: era la unica modalidad que tenia etapa cuando esto
// se escribio, asi que si dejaba de ofrecer era que el cambio habia roto lo que
// funcionaba.
//
// Pero eso mide el CONTENIDO del dueÃ±o, no el codigo. El dia que cambia de
// producto o vacia esa modalidad —que es su derecho y no rompe nada— la prueba
// se pone roja sola. Una prueba que se pone roja porque alguien vendio otra
// cosa deja de mirarse, y ese dia tampoco avisa de lo que si importa.
//
// LO QUE SE MIDE AHORA: COHERENTE SI ESTA LLENA.
//
// Una etapa EMPEZADA —alguien le escribio un nombre— tiene que estar completa:
// encendida, con entrega y con precio. A medias es el caso peligroso, porque el
// bot entrega, se salta la segunda venta y no dice por que.
//
// Una modalidad sin etapa no es un fallo: es una modalidad que no vende un
// segundo producto, que es lo normal.
const empezadas = ["lineal", "order_bump", "bioferta", "doble_oferta_dos", "doble_oferta_upsell", "upsell"]
  .map((m) => ({ modo: m, etapa: etapaDe(m) }))
  .filter(({ etapa }) => (etapa?.name ?? "").trim().length >= 2);

if (empezadas.length === 0) {
  console.log(
    "\n     Ninguna modalidad tiene etapa empezada. No hay nada que comprobar\n" +
      "     con el contenido, y eso no es un fallo: es que hoy no vendes un\n" +
      "     segundo producto en ninguna."
  );
} else {
  for (const { modo, etapa } of empezadas) {
    const falta = [];
    if (etapa.enabled !== true) falta.push("el interruptor");
    const entrega =
      Array.isArray(etapa.delivery) && etapa.delivery.length
        ? etapa.delivery
        : entregaDelCanal(modo) ?? entregaDelPuesto(modo);
    if (!entrega || entrega.length === 0) falta.push("la entrega");
    // El precio puede estar en Precios y pagos y no en la etapa. Se busca donde
    // lo busca el motor. Ver `tienePrecio`.
    if (!tienePrecio(etapa, modo)) falta.push("el precio");
    // ROJO SOLO EN LA QUE VENDE.
    //
    // Una etapa a medias en la modalidad ACTIVA significa que ahora mismo el
    // bot entrega, se salta la segunda venta y no dice por que. Eso es un
    // fallo y tiene que parar la prueba.
    //
    // En una modalidad que no vende es una nota: no esta perdiendo ninguna
    // venta hoy, y dejarla en rojo por algo inofensivo es la forma de que la
    // prueba se deje de mirar — y el dia que si importe, tampoco se vea.
    if (modo === runtime) {
      comprobar(
        `${modo}: la etapa empezada está completa`,
        falta.length === 0,
        falta.length === 0
          ? `ofrece «${etapa.name}»`
          : `le falta ${falta.join(", ")}`
      );
    } else if (falta.length > 0) {
      console.log(
        `     nota  ${pad(modo, 22)} tiene «${etapa.name}» a medias: le falta ${falta.join(
          ", "
        )}. No vende hoy, pero el dia que la actives no se ofrecera.`
      );
    }
  }
}

console.log(
  `\n${fallos === 0 ? "TODO OK — la etapa Upsell es de cada modalidad, y la que vende no se toco" : `${fallos} FALLOS`}`
);
process.exit(fallos === 0 ? 0 : 1);
