// La intro de la oferta y la del upsell pasan a ser CAJONES, como las intros.
//
// LO QUE PASABA
//
//   Cada una era UNA secuencia y nada mas. Para probar otra version habia que
//   borrar la que habia, y la anterior se perdia. Las intros de la modalidad son
//   cajones desde hace tiempo —nombre, interruptor, peso, duplicar— y estas dos
//   se habian quedado atras.
//
// COMO SE HIZO, Y POR QUE ASI
//
//   El motor sigue leyendo lo mismo: una lista de burbujas. Lo que cambia es
//   quien se la da. Es el mismo truco de la biblioteca de productos: una capa
//   delante y el modo de vender intacto.
//
//   PERO EL SORTEO NO PUEDE SER UNA CAPA. Si el dado se tirara al leer el
//   archivo, a TODOS los clientes les tocaria el mismo cajon hasta que el
//   archivo cambiara: no seria un reparto, seria elegir. Se tira por
//   conversacion, en el momento de mandarla.
//
//   Y SE TIRA CON LA SEMILLA DE LA CONVERSACION, no al azar puro: si el envio se
//   reintenta, al mismo cliente le vuelve a tocar el mismo. Recibir media oferta
//   de una version y media de otra es peor que cualquier reparto desequilibrado.
//
// LO QUE NO PUEDE VOLVER A PASAR
//
//   1. Que un bot sin cajones cambie de comportamiento. Sin ninguno, o con todos
//      apagados, sale la secuencia de siempre.
//   2. Que un boton escrito en un cajon deje de reconocerse porque al cliente le
//      toco otro.
//   3. Que los cajones se caigan al guardar: el archivo se escribe por lista.
//
//   node scripts/prueba-cajones-de-intro-de-la-oferta.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const config = leer("src", "lib", "workflow", "config.ts");
const motor = leer("src", "lib", "workflow", "engine.ts");
const api = leer("src", "app", "api", "workflow", "route.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// -- 1. EL SORTEO ------------------------------------------------------------
const sorteo = (() => {
  const i = config.indexOf("export function sorteaCajonDeIntro(");
  const f = config.indexOf("\n}", config.indexOf("return vivos[vivos.length", i));
  return i < 0 ? "" : config.slice(i, f);
})();
comprobar("existe el sorteo", sorteo.length > 0, "sorteaCajonDeIntro");
comprobar(
  "solo entran los encendidos y con burbujas",
  /g\?\.enabled !== false && \(g\?\.steps \?\? \[\]\)\.length > 0/.test(sorteo),
  "un cajón vacío no sale"
);
// SIN NINGUNO, NULL. Es la garantia: quien llama se queda con la secuencia de
// siempre y el bot se comporta igual que antes de que esto existiera.
comprobar(
  "sin ninguno devuelve null",
  /if \(vivos\.length === 0\) return null;/.test(sorteo),
  "el bot no cambia"
);
comprobar(
  "y con uno solo, ése sale siempre",
  /if \(vivos\.length === 1\) return vivos\[0\]\.steps \?\? null;/.test(sorteo),
  "igual que antes"
);
// EL PESO ES UN REPARTO: con dos a 1 y 3, de cada cuatro clientes uno ve el
// primero y tres el segundo.
comprobar(
  "el peso reparte, no prioriza",
  /const total = vivos\.reduce\(\(suma, g\) => suma \+ pesoDe\(g\), 0\);/.test(
    sorteo
  ) && /tirada -= pesoDe\(g\);/.test(sorteo),
  "por partes"
);
// ESTABLE POR CONVERSACION: un reintento no mezcla dos versiones.
comprobar(
  "la misma conversación cae siempre en el mismo cajón",
  /Math\.abs\(Math\.floor\(semilla\)\) % total/.test(sorteo),
  "un reintento no mezcla"
);

// -- 2. EL MOTOR LO USA EN LOS DOS SITIOS ------------------------------------
// ACTUALIZADA el 24/09/2026 conservando su intencion. Antes fijaba la forma
// EXACTA de la llamada, con sus dos argumentos. El 24/09 se le añadio un tercero
// —el pais del cliente, para que la bandera pueda dirigir— y la forma cambio.
// Lo que protege no cambia: que la oferta sortee SUS cajones y caiga a la intro
// de siempre si no hay ninguno.
// ACTUALIZADA OTRA VEZ el 16/10/2026, conservando su intencion. El resultado del sorteo se
// guarda ahora en `delCajon` y la caida a la intro de siempre va unas lineas mas abajo:
// entre medias se mira si al cliente le falta el cajon de su pais con el respaldo entre
// paises apagado (ver `etiqueta-de-bandera.ts`), y eso tiene que ir ANTES de caer a la de
// siempre, porque la de siempre tambien puede ser de otro pais.
comprobar(
  "la oferta de Order Bump sortea su intro",
  /const delCajon = sorteaCajonDeIntro\(\s*ob\.intro_groups,\s*convo\.id[\s\S]{0,1200}?delCajon \?\? \(Array\.isArray\(ob\.intro\) \? ob\.intro : null\)/.test(
    motor
  ),
  "y cae a la de siempre"
);
comprobar(
  "y el upsell también",
  /sorteaCajonDeIntro\(\s*up\.intro_groups,\s*convo\.id[\s\S]{0,120}?\)\s*\?\?\s*up\.intro\s*\?\?\s*\[\]/.test(
    motor
  ),
  "y cae a la de siempre"
);
// LOS BOTONES SE BUSCAN EN TODOS LOS CAJONES. Esto no envia: reconoce lo que el
// cliente acaba de escribir. Mirando solo el sorteado, un boton de otro cajon no
// se reconoceria — y el cliente lo tiene delante si le salio esa version.
comprobar(
  "los botones se reconocen vengan del cajón que vengan",
  (motor.match(/\(up\.intro_groups \?\? \[\]\)\.flatMap\(\(g\) => g\.steps \?\? \[\]\)/g) ?? [])
    .length === 2,
  "en los dos sitios que los buscan"
);

// -- 3. SE GUARDAN Y SE LEEN -------------------------------------------------
comprobar(
  "la API los lee",
  /function readGruposDeIntro\(/.test(api) &&
    /intro_groups: readGruposDeIntro\(obCfg\?\.intro_groups\)/.test(api),
  "de ida"
);
comprobar(
  "y los escribe",
  /function writeGruposDeIntro\(/.test(api) &&
    /intro_groups: writeGruposDeIntro\(ob\?\.intro_groups\)/.test(api) &&
    /intro_groups: writeGruposDeIntro\(u\?\.intro_groups\)/.test(api),
  "y de vuelta"
);
// Las burbujas pasan por el mismo traductor que el resto del archivo: la
// pantalla usa `texts` y el motor `body_variants`.
comprobar(
  "las burbujas se traducen como las demás",
  /steps: Array\.isArray\(g\?\.steps\)\s*\r?\n?\s*\? \(g\.steps as EditorStep\[\]\)\.map\(writeStep\)/.test(
    api
  ),
  "writeStep, como todas"
);

// -- 4. LA PANTALLA ----------------------------------------------------------
comprobar(
  "hay una lista de cajones reusable",
  /function CajonesDeIntro\(/.test(editor),
  "la misma en los dos"
);
comprobar(
  "con encendido, peso y duplicar",
  /<CirculoDeEncendido/.test(editor) &&
    /⧉ Duplicar/.test(editor) &&
    /weight: Math\.max\(1, Math\.floor\(v \|\| 1\)\)/.test(editor),
  "como las intros"
);
// EL PRIMERO NACE CON LO QUE YA ESTABA ESCRITO: se pasa a cajones sin reescribir
// nada y sin que el bot cambie de texto.
comprobar(
  "el primer cajón hereda la versión de siempre",
  /grupos\.length === 0 && respaldo\.length > 0/.test(editor),
  "no hay que reescribir"
);
// Y LA COPIA NACE APAGADA: se duplica para cambiarle algo, y encendida entraria
// al reparto antes de estar lista.
// El nombre dejo de salir de una plantilla fija: desde el 15 de septiembre de
// 2026 se PIDE al duplicar, con el de siempre ya escrito —ver
// `prueba-al-duplicar-se-pide-el-nombre`—. Lo que esta comprobacion protege
// sigue siendo lo mismo: que la copia nazca APAGADA.
comprobar(
  "la copia nace apagada",
  /name: nombre,\s*\r?\n[\s\S]{0,200}?enabled: false,/.test(editor),
  "no vende a medio hacer"
);
// CINCO SITIOS: la oferta y el upsell de la modalidad, los de cada canal, y —desde el
// 10/10/2026— la presentacion de cada producto de la fila de upsells, que pidio «que
// funcione igual» que la intro del upsell de Canales.
comprobar(
  "los cinco sitios usan la lista",
  (editor.match(/<CajonesDeIntro/g) ?? []).length === 5,
  "oferta y upsell, en modalidad y canal, y la ficha de la fila"
);

// -- 4-BIS. Y EN CANALES, CON SU PROPIA COPIA --------------------------------
//
// Mismo trato que la intro y los seguimientos del canal: con cajones escritos
// ahi mandan esos, y vacio deja mandar a la modalidad. Solo el CONTENIDO: el
// interruptor de la oferta y los minutos no son por canal, son la misma venta se
// entre por donde se entre.
comprobar(
  "Canales tiene sus dos filas nuevas",
  /clave: "orderbump" as const/.test(editor) &&
    /clave: "upsell" as const/.test(editor),
  "entre seguimientos y entregas"
);
comprobar(
  "y el canal guarda sus propios cajones",
  /order_bump_intro_groups\?: GrupoDeIntroEditor\[\]/.test(editor) &&
    /upsell_intro_groups\?: GrupoDeIntroEditor\[\]/.test(editor),
  "por canal"
);
comprobar(
  "el motor los aplica encima de la modalidad",
  /if \(\(content\.order_bump_intro_groups \?\? \[\]\)\.length > 0\)/.test(
    config
  ) && /if \(\(content\.upsell_intro_groups \?\? \[\]\)\.length > 0 && next\.upsell\)/.test(config),
  "vacío deja mandar a la modalidad"
);
// EL PUNTO VERDE ES EL INTERRUPTOR, Y LLAMA AL MISMO SITIO QUE SU PESTAÑA.
//
// Decia el estado y nada mas. Ahora tambien lo cambia, pero por el MISMO camino:
// Order Bump pasa por el cambio de modalidad —con su guardado y su recarga— y
// Upsell escribe el mismo campo de la etapa. Un segundo camino propio acabaria
// discrepando del primero, y no habria manera de saber cual mando.
comprobar(
  "la fila dice si está activo",
  /\{activo \? "Activo" : "Apagado"\}/.test(editor) &&
    /clave === "orderbump"\s*\r?\n?\s*\? cfg\.order_bump\.enabled === true/.test(
      editor
    ),
  "el punto y la palabra"
);
comprobar(
  "y el punto lo apaga de verdad",
  /onCambiarActivo\?\.\(!activo\)/.test(editor) &&
    /onCambiarActivo=\{\s*\r?\n?\s*clave === "orderbump"/.test(editor),
  "no es un cartel"
);
comprobar(
  "Order Bump va por el cambio de modalidad, no por un atajo",
  /onModalidadOrderBump=\{\(encendida\) =>\s*\r?\n?\s*setModalidad\("order_bump", encendida\)/.test(
    editor
  ),
  "guarda y recarga, como su pestaña"
);
comprobar(
  "y el upsell escribe el mismo campo de la etapa",
  /const alternarEtapaUpsell = \(encendida: boolean\) => \{[\s\S]{0,220}?upsell: \{ \.\.\.\(cfg\.upsell \?\? \{\}\), enabled: encendida \}/.test(
    editor
  ),
  "sin cambiar de modalidad"
);
// LA OFERTA SOLO DONDE HAY DOS OPCIONES. En Lineal a secas no las hay, asi que
// esa fila mandaria a escribir algo que no sale.
//
// El 22/09/2026 se le añadio la presentacion prestada: lineal puede vender dos
// opciones SIN dejar de llamarse lineal. La fila preguntaba por el NOMBRE y no
// aparecia, asi que no habia donde escribir esa intro para ese canal. Ahora
// pregunta por el DATO. Lo que se comprueba NO cambia: que no salga donde se
// vende una sola.
comprobar(
  "la fila de la oferta solo sale donde hay dos opciones",
  /if \(clave === "orderbump"\) \{[\s\S]{0,120}?activeModality\(cfg\) === "order_bump" \|\|[\s\S]{0,120}?segundaOpcionPrestada\(cfg\) === "segunda_oculta"/.test(
    editor
  ),
  "en Lineal a secas no sale"
);

// -- 4-TER. Y LA ELECCIÓN CON BOTONES, TAMBIÉN POR CANAL --------------------
//
// Es lo ULTIMO que lee el cliente antes de decidir, y estaba solo en la
// modalidad: se podia escribir la oferta de WhatsApp y la pregunta que la remata
// seguia siendo la de todos. Va con los cajones porque es lo mismo —lo que el
// cliente lee— y cambia igual segun por donde entro.
comprobar(
  "el canal guarda su elección con botones",
  /order_bump_choice_prompt\?: string/.test(editor) &&
    /upsell_pregunta_steps\?: EditorStep\[\]/.test(editor) &&
    /upsell_boton_si\?: string/.test(editor),
  "texto y etiquetas"
);
// CAMPO A CAMPO, NO EN BLOQUE: escribir solo el texto de la oferta en un canal
// no puede llevarse por delante las etiquetas que ese canal no toco.
comprobar(
  "el motor la aplica campo a campo",
  /\? \{ choice_prompt: content\.order_bump_choice_prompt \}/.test(config) &&
    /\? \{ boton_si: content\.upsell_boton_si \}/.test(config) &&
    /\? \{ pregunta_steps: content\.upsell_pregunta_steps \}/.test(config),
  "lo vacío deja mandar a la modalidad"
);
// EL INTERRUPTOR AUSENTE NO ES «APAGALO», ES «NO OPINO». Escribiendo un `false`
// de relleno se apagarian los botones en todos los canales que nunca los tocaron.
comprobar(
  "un interruptor sin decidir no se escribe",
  /\.\.\.\(typeof content\?\.order_bump_use_buttons === "boolean"/.test(api) &&
    /\.\.\.\(typeof content\?\.upsell_use_buttons === "boolean"/.test(api),
  "la clave ausente hereda"
);
comprobar(
  "y se lee como ausente, no como falso",
  /typeof c\?\.order_bump_use_buttons === "boolean"\s*\r?\n?\s*\? c\.order_bump_use_buttons\s*\r?\n?\s*: undefined/.test(
    api
  ),
  "undefined, no false"
);
// LA PREGUNTA SE SIEMBRA con la de la modalidad, como los cajones: una pantalla
// en blanco pareceria que la pregunta se perdio.
comprobar(
  "la pregunta del canal nace con la de la modalidad",
  /const preguntaDelUpsell =\s*\r?\n?\s*\(editableContent\.upsell_pregunta_steps \?\? \[\]\)\.length > 0/.test(
    editor
  ),
  "no abre en blanco"
);
// Y LA MOTO EN ENTREGAS: la bolsa pasó a ser la oferta, y dos filas de la misma
// lista con el mismo dibujo es lo que hace dudar de en cuál estás.
comprobar(
  "«Entregas por modalidad» cambia de dibujo",
  /icono: "🛵"/.test(editor),
  "la bolsa es de la oferta"
);

// -- 5. CADA CAJÓN CON SU DIBUJO ---------------------------------------------
//
// Dentro de Canales las intros, los seguimientos y las variantes llevaban los
// tres el mismo telefono, porque el dibujo salia de la PESTAÑA. Tiene que decir
// que clase de mensaje es, no donde estas parado.
comprobar(
  "cada clase de cajón tiene su dibujo",
  /intro: "📱"/.test(editor) &&
    /seguimiento: "📲"/.test(editor) &&
    /orderBump: "🛍️"/.test(editor) &&
    /upsell: "⬆️"/.test(editor),
  "no se confunden"
);
// Y LOS DE DENTRO, MAS PEQUEÑOS: con tres niveles a la vista, donde empieza uno
// y acaba otro habia que deducirlo por la sangria.
comprobar(
  "el cajón de dentro lleva el dibujo pequeño",
  /const NivelDeCajon = createContext\(0\);/.test(editor) &&
    /tamano=\{nivel === 0 \? "lg" : "md"\}/.test(editor) &&
    /<NivelDeCajon\.Provider value=\{nivel \+ 1\}>/.test(editor),
  "se cuenta solo"
);

// -- 6. Y EL IMPORTADOR VIEJO SE VA ------------------------------------------
//
// Copiaba un producto del cajon de una modalidad al cajon de otra, y esos
// cajones ya no envian nada. Ofrecer llenar algo que no se usa es peor que no
// ofrecer nada.
comprobar(
  "«Copiar un producto desde otra modalidad» ya no se ofrece",
  !/<ImportadorDeProducto /.test(editor),
  "los productos viven en un solo sitio"
);

console.log(
  fallos === 0
    ? "\nTODO OK — la intro de la oferta y la del upsell son cajones"
    : `\n${fallos} FALLO(S)`
);
process.exit(fallos === 0 ? 0 : 1);
