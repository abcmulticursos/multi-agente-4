// CADA TIENDA DICE QUE LE FALTA, Y QUE PASA SI SALE A VENDER ASI
//
// LO PIDIO EL DUEÑO el 06/10/2026, cuando iba a crear dos tiendas mas y le daba miedo que se
// cruzaran los datos:
//
//   «necesito avisos para que me indique si algo esta mal… si yo reviso la tienda me deberia
//    decir que falta engancharse a algo sino vendera mal. Pero si deberia dejarme lanzar pero
//    con advertencia, y tambien que esas advertencias se puedan volver verde si yo lo deseo.»
//
// POR QUE HACIA FALTA, con un caso real de la noche anterior: LECTO ESCRITURA no estaba
// enganchada a NINGUN seguimiento —todos estaban etiquetados para la otra tienda—. El cliente
// que no compraba en el momento se perdia, y nunca veia el descuento. Nadie avisaba, y se
// descubrio corriendo una prueba que no podia esperar lo que no llegaba.
//
// LOS NUEVE AVISOS, Y POR QUE CADA UNO. Los cinco primeros son de configuracion; los dos del
// contenido son los que se olvidan; el ultimo es el que cobra sin entregar:
//
//     sin_numero            no atiende a nadie
//     numero_repetido       gana la primera y la otra calla, sin avisar
//     sin_pagina            las compras no se registran en Meta
//     sin_pixel             mide en el conjunto de datos general
//     sin_alineacion        vende los productos generales
//     sin_cobrador          cobra la cuenta del pais
//     sin_intros            el cliente saluda y no recibe nada
//     sin_seguimientos      el que no compra se pierde, y no ve el descuento
//     entrega_de_relleno    el cliente paga y recibe una direccion que no existe
//
//   node scripts/prueba-la-tienda-dice-que-le-falta.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");
const ruta = readFileSync(
  join(RAIZ, "src", "app", "api", "workflow", "route.ts"),
  "utf8"
);

let fallos = 0;
const comprobar = (titulo, condicion, detalle) => {
  const marca = condicion ? "  ok  " : "> FALLA";
  if (!condicion) fallos++;
  console.log(`${marca} ${String(titulo).padEnd(56)} ${detalle ?? ""}`);
};

const revision = (() => {
  const i = editor.indexOf("function revisarTienda(");
  const f = editor.indexOf("function TiendasDelProyecto(", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra la revision", revision.length > 0, "revisarTienda");

// -- 1. LOS DIEZ AVISOS -----------------------------------------------------
//
// El décimo, «cuenta_mezclada», entró el 09/10/2026: la tienda con la página de una
// cuenta de Meta y el píxel de otra. Ver PLAN-VARIAS-CUENTAS-DE-FACEBOOK.md.
for (const clave of [
  "cuenta_mezclada",
  "sin_numero",
  "numero_repetido",
  "sin_pagina",
  "sin_pixel",
  "sin_alineacion",
  "sin_cobrador",
  "sin_intros",
  "sin_seguimientos",
  "entrega_de_relleno",
]) {
  comprobar(`avisa de «${clave}»`, revision.includes(`clave: "${clave}"`), "");
}

// -- 2. CADA UNO DICE LA CONSECUENCIA, NO EL CAMPO -------------------------
//
// «Falta la pagina» no le dice nada a quien esta vendiendo. «Las compras no se van a
// registrar» si. Un aviso que no explica que se pierde se aprende a ignorar en dos dias.
// 11 desde el 12/10/2026: se sumó «frase_repetida», con las frases de entrada.
comprobar(
  "todos dicen que le ocurre al cliente",
  (revision.match(/queOcurre:/g) ?? []).length === 11,
  `${(revision.match(/queOcurre:/g) ?? []).length} de 11`
);
comprobar(
  "y se distingue lo grave de lo que puede ser a proposito",
  /grave: true/.test(revision) && /grave: false/.test(revision),
  "el vende en tres paises y no todo es un fallo"
);

// -- 3. SE PUEDEN IGNORAR, Y ESO SE GUARDA ---------------------------------
comprobar(
  "se puede ignorar un aviso",
  /ya lo sé, ignorar/.test(editor) && /volver a avisarme/.test(editor),
  "y volver a encenderlo"
);
comprobar(
  "se recuerdan POR CLAVE, no por posicion",
  /avisos_ignorados\?: string\[\]/.test(editor),
  "un aviso nuevo no hereda el ignorar de otro"
);
comprobar(
  "y sobreviven al guardado",
  /avisos_ignorados: strList\(t\?\.avisos_ignorados\)/.test(ruta),
  "este archivo no guarda lo que no se nombra"
);

// -- 4. NUNCA IMPIDE VENDER -------------------------------------------------
//
// El lo pidio con estas palabras: «deberia dejarme lanzar pero con advertencia». Un aviso que
// bloquea deja de ser un aviso.
comprobar(
  "se dice que no impide nada",
  /Nada de esto te impide vender/.test(editor),
  "es lo que va a pasar si lanzas asi"
);

// -- 5. EL AVISO DE LAS INTROS MIRA TODOS LOS CANALES ----------------------
//
// Mirar solo el canal abierto daria un aviso FALSO en cuanto el cambiara de pestaña. Un aviso
// que miente se aprende a ignorar, y entonces el de verdad tampoco se lee.
comprobar(
  "las intros se buscan en todos los canales y modalidades",
  /for \(const canal of Object\.values\(cfg\.channels \?\? \{\}\)\)/.test(revision),
  "solo salta si no esta en NINGUNA"
);

// -- 6. LA ENTREGA DE RELLENO SE RECONOCE POR LA DIRECCION ----------------
//
// No vale preguntar «¿hay algo escrito?»: un enlace de relleno esta escrito y no lleva a
// ninguna parte. Es justo el caso que se encontro en LECTO.
comprobar(
  "el enlace de relleno se caza por la direccion",
  revision.includes("const conEntregaFalsa") &&
    revision.includes("enlaces.every(") &&
    revision.includes("tiene un punto en su dominio"),
  "no vale preguntar si hay algo escrito"
);

// -- 7. Y LA FILA LO RESUME -------------------------------------------------
comprobar(
  "la fila dice cuantas cosas quedan",
  /cosas"\} por revisar/.test(editor),
  "sin tener que abrir"
);
comprobar(
  "y se pone verde cuando no queda ninguna",
  /lista para vender/.test(editor),
  "incluidos los que el decidio ignorar"
);

console.log("");
if (fallos > 0) {
  console.log(`> ${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — cada tienda dice que le falta, y se puede dar por bueno");
