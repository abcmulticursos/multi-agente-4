// SIN BANDERA NO SE DISPARA, Y LOS TRES SITIOS DECIDEN IGUAL.
//
// LO PIDIO EL DUEÑO el 2 de octubre de 2026, y lo repitio cuatro veces:
//
//   «en la seccion intro y seguimientos, intro de order bump etc, incluso upsell, ahi
//    necesito que se pueda seleccionar banderas en los selectores, SINO NO SE DISPARAN»
//   «con tan solo elegir la bandera ya queda habilitada para lanzarse, si no tiene
//    bandera elegida, no sale»
//
// ── QUE CAMBIA, Y QUE NO ───────────────────────────────────────────────────
//
// ANTES habia tres escalones: los de su pais, los GENERALES —los que no llevan ninguna
// bandera— y como ultimo respaldo todos los encendidos.
//
// AHORA el escalon de los generales DESAPARECE: una pieza sin bandera no entra en el
// sorteo de nadie.
//
// PERO EL ULTIMO RESPALDO SE QUEDA, y no es contradecirle. Lo puso una prueba SUYA: con
// todos los cajones etiquetados y un cliente de un pais sin cajon, el bot se quedaba SIN
// INTRO — «y un cliente sin intro es una venta perdida segura, mucho peor que una intro
// que no era para el». Lo que cambia es de donde sale ese respaldo: antes podia ser una
// pieza SIN bandera —justo lo que el no quiere— y ahora solo una CON bandera, aunque sea
// de otro pais.
//
// O SEA: lo que no tiene bandera no sale nunca; lo que la tiene puede salvar a un cliente
// de un pais que el todavia no cubrio.
//
// ── POR QUE ESTA PRUEBA EXISTE ─────────────────────────────────────────────
//
// La regla vive en TRES sitios, porque son tres listas distintas: los cajones de intro,
// las variantes de intro y los seguimientos. Tienen que decidir IGUAL. Que uno sirva lo
// que otro descarta es el fallo que este proyecto ha pagado tres veces
// —`course_price_soles`, `image_gallery_2`, `pack_gallery`— y la semana pasada otra vez
// con los tiempos de las burbujas.
//
// ── LO QUE SE MIDIO ANTES DE ENCENDERLO ────────────────────────────────────
//
// En lineal —su cancha— 49 pestañas encendidas: 30 con bandera y 19 sin. Las 30 cubren
// Peru, Ecuador y Argentina en lineal, -DOU- y -OB-. Las 19 son restos de otro producto
// (FLORES DE PAPEL, QUIMICA EN ACCION, los seguimientos de fabrica). Se le enseño la
// lista con los nombres antes de tocar nada.
//
//   node scripts/prueba-sin-bandera-no-se-dispara.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const motor = readFileSync(join(RAIZ, "src", "lib", "workflow", "config.ts"), "utf8");
const engine = readFileSync(join(RAIZ, "src", "lib", "workflow", "engine.ts"), "utf8");
const pantalla = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── 1. LOS TRES SITIOS, UNO POR UNO ────────────────────────────────────────
console.log("\n— 1. los tres sitios descartan lo que no lleva bandera —\n");
comprobar(
  "los cajones de intro",
  /const conBandera = encendidos\.filter\(\(g\) => banderasDe\(g\)\.length > 0\);/.test(
    motor
  ) &&
    /conBandera\.length === 0\s*\r?\n?\s*\? encendidos\s*\r?\n?\s*: deSuPais\.length > 0\s*\r?\n?\s*\? deSuPais\s*\r?\n?\s*: conBandera;/.test(
      motor
    ),
  "elegirGrupoDeIntro"
);
comprobar(
  "las variantes de intro",
  /const conBandera = pool\.filter\(\s*\r?\n?\s*\(item\) => banderasDeLaIntro\(item\.variant - 1\)\.length > 0\s*\r?\n?\s*\);/.test(
    engine
  ) &&
    /conBandera\.length === 0\s*\r?\n?\s*\? pool\s*\r?\n?\s*: deSuPais\.length > 0\s*\r?\n?\s*\? deSuPais\s*\r?\n?\s*: conBandera;/.test(
      engine
    )
);
comprobar(
  "y los seguimientos",
  /const conBandera = deEstaSemimodalidad\.filter\(\(c\) => c\.banderas\.length > 0\);/.test(
    engine
  ) &&
    /conBandera\.length === 0\s*\r?\n?\s*\? deEstaSemimodalidad\s*\r?\n?\s*: losSuyos\.length > 0\s*\r?\n?\s*\? losSuyos\s*\r?\n?\s*: conBandera;/.test(
      engine
    )
);

// ── 1-bis. SIN NINGUNA BANDERA EN TODO EL PROYECTO, NADA CAMBIA ───────────
//
// ES LA REGLA DE LA CASA, la misma que llevan las otras tres etiquetas. Y aqui es
// OBLIGATORIA, porque esto es una PLANTILLA: una instalacion nueva no tiene ninguna
// bandera escrita, y sin este escalon el bot naceria MUDO — ni una intro, sin ningun
// error que lo explicara.
//
// No es una suposicion: al encender la regla sin este escalon, tres pruebas que llevaban
// semanas en verde se pusieron rojas de golpe. Lo dijeron ellas.
console.log("\n— 1-bis. sin ninguna bandera, nada cambia —\n");
for (const [donde, texto, patron] of [
  ["los cajones", motor, /conBandera\.length === 0\s*\r?\n?\s*\? encendidos/],
  ["las variantes", engine, /conBandera\.length === 0\s*\r?\n?\s*\? pool/],
  ["los seguimientos", engine, /conBandera\.length === 0\s*\r?\n?\s*\? deEstaSemimodalidad/],
]) {
  comprobar(`${donde} dejan pasar todo`, patron.test(texto), "la plantilla sigue viva");
}

// ── 2. NINGUNO SE QUEDO CON EL ESCALON VIEJO ──────────────────────────────
//
// Es la mitad que de verdad protege: si alguien vuelve a poner `length === 0` en uno de
// los tres, esa lista volveria a servir las piezas sin bandera y las otras dos no. El
// fallo no daria error — daria silencio en unos sitios y no en otros.
console.log("\n— 2. no queda ningun escalon de «sin bandera» —\n");
comprobar(
  "no vuelve el escalón de los generales en los cajones",
  !/generales = encendidos\.filter\(\(g\) => banderasDe\(g\)\.length === 0\)/.test(motor),
  "ni como respaldo"
);
comprobar(
  "ni en las variantes",
  !/pool\.filter\(\s*\r?\n?\s*\(item\) => banderasDeLaIntro\(item\.variant - 1\)\.length === 0/.test(
    engine
  )
);
comprobar(
  "ni en los seguimientos",
  !/deEstaSemimodalidad,[\s\S]{0,200}?\(c\) => c\.banderas\.length === 0/.test(engine)
);

// ── 3. NADIE SE QUEDA SIN NADA POR UN PAIS QUE EL NO CUBRIO ───────────────
//
// El respaldo sigue, y es el que puso una prueba SUYA. Si se quitara, un cliente de un
// pais sin pieza etiquetada no recibiria NADA — y eso el ya lo vivio.
console.log("\n— 3. el respaldo de su propia prueba sigue en pie —\n");
comprobar(
  "el respaldo existe y es el de CON bandera",
  /: deSuPais\.length > 0\s*\r?\n?\s*\? deSuPais\s*\r?\n?\s*: conBandera;/.test(motor) &&
    /: losSuyos\.length > 0\s*\r?\n?\s*\? losSuyos\s*\r?\n?\s*: conBandera;/.test(engine),
  "algo antes que nada"
);
comprobar(
  "y queda escrito por qué",
  /un cliente sin intro es una venta perdida segura/.test(motor),
  "para que nadie lo quite sin saberlo"
);

// ── 4. Y SE VE EN LA PANTALLA CUAL NO VA A SALIR ──────────────────────────
//
// La regla sin el aviso seria una trampa: el dueño apaga medio bot sin enterarse. El
// borde rojo y el simbolo son lo que convierten la regla en algo que se puede arreglar.
console.log("\n— 4. y la pantalla dice cuál no va a salir —\n");
comprobar(
  "el aviso es solo el símbolo",
  /aria-label="Sin país: esta pestaña no se dispara"/.test(pantalla) &&
    !/⚠ sin país/.test(pantalla),
  "«para no ensuciar la pantalla»"
);
comprobar(
  "con el porqué en el hint",
  /title="SIN PAÍS NO SE DISPARA\./.test(pantalla),
  "invisible hasta que pasa el ratón"
);
// LAS CINCO FACHADAS. El 02/10 el dueño pillo que estaba en una sola: «no le has puesto
// selector de banderas en la fachada de las intros ¿que paso?».
for (const [donde, patron] of [
  ["la intro", /seleccionados=\{_tpl\?\.intro_paises\?\.\[idx\] \?\? \[\]\}/],
  ["el seguimiento", /seleccionados=\{f\.paises \?\? \[\]\}/],
  ["la variante", /seleccionados=\{variant\.paises \?\? \[\]\}/],
  ["el cajón (order bump y upsell)", /seleccionados=\{grupo\.paises \?\? \[\]\}/],
  // Y LOS DOS DE CANALES, QUE SON LOS QUE EL MIRA.
  //
  // Costo tres intentos dar con ellos, y la culpa fue de leerle a medias: el dijo «no el
  // cajon master del menu Canales» y se entendio que las de Canales quedaban fuera. Es al
  // reves — el MASTER es la baldosa de fuera, y la bandera va en los cajones de DENTRO.
  //
  // Su camino, dictado el 02/10/2026: «Menu canales, pop up master INTRO… al abrirse el
  // pop up INTRO · WHATSAPP, ahi dentro estan las sub pestañas… ahi dice por titulo
  // 🇵🇪 PRUEBA LINEAL PERU», y «SEGUIMIENTOS · WHATSAPP… seguimiento 1, 2 y 3… y DENTRO
  // DE CADA UNO DE ELLOS estan los seguimientos que deben tener la bandera».
  [
    "la intro del canal",
    /onEdit\(`channel_\$\{channel\}_intro_\$\{index\}_paises`\);\s*\r?\n?\s*updateGroup\(index, \{ paises \}\);/,
  ],
  [
    "la variante de seguimiento del canal",
    /_variant_\$\{variantIndex\}_paises`\s*\r?\n?\s*\);\s*\r?\n?\s*updateVariant\(index, variantIndex, \{ paises \}\);/,
  ],
]) {
  comprobar(`${donde} elige su bandera en la fachada`, patron.test(pantalla));
}
// EL SEGUIMIENTO DEL CANAL NO LLEVA PASTILLA, Y ES CORRECTO.
//
// En el canal el etiquetado vive en la VARIANTE, no en el seguimiento —igual que el de
// anuncios—. Su fila enseña el resumen de las banderas de sus variantes, que es
// informacion, no una eleccion. Ponerle una pastilla ahi seria ofrecerle un campo que el
// motor no lee: el fallo de la caja que una parte llena y otra no abre.
comprobar(
  "y el seguimiento del canal enseña las de sus variantes",
  /banderasDeLasVariantes\(followup\)/.test(pantalla),
  "ahí la bandera es de la variante"
);
comprobar(
  "y la bandera ya no se repite pegada al nombre",
  !/banderasDeLaPieza\(_tpl\?\.intro_paises\?\.\[idx\]\) && \(/.test(pantalla) &&
    !/banderasDeLaPieza\(f\.paises\)\s*\r?\n?\s*\? `\$\{banderasDeLaPieza\(f\.paises\)\} `/.test(
      pantalla
    ),
  "lo pidió él: partía el título en dos"
);

console.log(
  fallos === 0
    ? "\nTODO OK — sin bandera no sale, y los tres sitios deciden igual\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
