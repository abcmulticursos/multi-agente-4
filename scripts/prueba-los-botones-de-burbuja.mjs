// Los botones de una burbuja: se ven, hacen lo suyo, y dejan escrito lo que dicen.
//
// CUATRO COSAS QUE EL DUENO ENCONTRO EL 15 DE SEPTIEMBRE DE 2026, todas de la
// misma pieza, probando un boton «Quiero el descuento» en un seguimiento.
//
//   1. AL TOCARLO QUEDABA ESCRITO EL ID. Con sus palabras: «yo pensé que al
//      presionar el botón aparecería "quiero el descuento", pero apareció
//      bubble:c7633c9e-3acb-4b2d-b735-f66afc3b2e86, no sé qué es».
//      Y no era solo estetico: ese texto entra en el historial que lee el
//      modelo, asi que donde deberia leer que eligio el cliente, leia una cadena
//      sin significado. El resto de botones —regalo, producto extra— ya
//      guardaban su etiqueta, con un comentario explicando por que. Estos eran
//      la excepcion.
//
//   2. FALTABAN ACCIONES EN EL SELECTOR. Busco el segundo producto y no estaba.
//      El CUADRITO lo ofrecia y el boton no — aunque `ejecutarAccion`, que es la
//      MISMA funcion para los dos, tiene su `case` desde siempre. No era una
//      limitacion: era una lista corta. Faltaban cinco.
//
//   3. O MANDABA SU TEXTO O ELEGIA PRODUCTO, NUNCA LAS DOS. Con «Enviar
//      burbujas» salia su texto y no se elegia nada; con «Elegir Combo» se
//      elegia y su texto desaparecia. El cuadrito nunca tuvo ese problema: manda
//      lo suyo y DESPUES ejecuta. Al boton solo le faltaba pasarle lo escrito.
//
//   4. NO SE VEIAN EN LA VISTA PREVIA. Se escribian a ciegas, y lo que el motor
//      descarta —el cuarto boton, la etiqueta larga— se descartaba en silencio.
//
//   node scripts/prueba-los-botones-de-burbuja.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8").replace(/\r\n/g, "\n");
const config = leer("src", "lib", "workflow", "config.ts");
const motor = leer("src", "lib", "workflow", "engine.ts");
const manejador = leer("src", "lib", "meta", "handler.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. LA ETIQUETA QUEDA ESCRITA, Y EL ID SIGUE ENRUTANDO ───────────────────
console.log("\n— lo que queda escrito al tocar el boton —\n");
comprobar(
  "el id sigue siendo lo que se enruta",
  /text = id;/.test(manejador) &&
    /if \(msgContent\.startsWith\("bubble:"\)\)/.test(motor),
  "sin el id no hay accion que encontrar"
);
comprobar(
  "pero en el chat queda su etiqueta",
  // Desde el 22/10/2026 la regla vive en `textoDelBotonPulsado` (la comparte Messenger).
  /visible = title\.trim\(\) \|\| id;/.test(manejador) &&
    /if \(traducido\.visible !== null\) contenidoVisible = traducido\.visible;/.test(manejador),
  "lo que el cliente vio"
);
comprobar(
  "y es lo que se guarda en el mensaje",
  /const contenidoGuardado = contenidoVisible \?\? content;/.test(manejador) &&
    /insertMessage\(convo\.id, "user", contenidoGuardado, waMsgId\)/.test(manejador),
  "tambien en el historial del modelo"
);
comprobar(
  "y con media, igual",
  /insertMessageWithMedia\(convo\.id, "user", contenidoGuardado, waMsgId, media\)/.test(
    manejador
  ),
  "un solo sitio decide"
);
// Sin etiqueta no se puede inventar una: mejor el id que un mensaje vacio.
comprobar(
  "sin etiqueta, cae al id y no a vacio",
  /title\.trim\(\) \|\| id/.test(manejador),
  "nunca una burbuja en blanco"
);

// ── 2. LAS CINCO ACCIONES QUE FALTABAN ──────────────────────────────────────
console.log("\n— las acciones que el motor ya sabia hacer —\n");
const NUEVAS = [
  "choose_upsell",
  "show_order_bump",
  "accept_gift",
  "decline_gift",
  "claim_gift",
];
const tipoDelMotor = (() => {
  const i = config.indexOf("export type BubbleButtonAction =");
  const f = config.indexOf(";", i);
  return i < 0 ? "" : config.slice(i, f);
})();
const tipoDelEditor = (() => {
  const i = editor.indexOf("type BubbleButtonAction =");
  const f = editor.indexOf(";", i);
  return i < 0 ? "" : editor.slice(i, f);
})();
for (const accion of NUEVAS) {
  comprobar(
    `«${accion}» esta en el tipo del motor y del editor`,
    tipoDelMotor.includes(`"${accion}"`) && tipoDelEditor.includes(`"${accion}"`),
    "los dos, o TypeScript no deja guardarla"
  );
  comprobar(
    `y se puede elegir en el selector`,
    editor.includes(`<option value="${accion}">`),
    "visible para el dueno"
  );
}
// LO QUE HACE QUE ESTO SEA SEGURO: no se programa nada nuevo. `ejecutarAccion`
// ya tiene el `case` de las cinco, y es la misma funcion que usan los cuadritos.
for (const accion of NUEVAS) {
  comprobar(
    `y el motor ya la atendia: case "${accion}"`,
    new RegExp(`case "${accion}"`).test(motor),
    "no es codigo nuevo"
  );
}

// ── 3. MANDA SU TEXTO **Y** EJECUTA LA ACCION ───────────────────────────────
console.log("\n— su texto y la accion, no una cosa o la otra —\n");
const puerta = (() => {
  const i = motor.indexOf("async function runBubbleButtonAction");
  const f = motor.indexOf("\nasync function ejecutarAccion", i);
  return i < 0 || f < 0 ? "" : motor.slice(i, f);
})();
comprobar("se encuentra el manejador del boton", puerta.length > 200);
comprobar(
  "primero salen sus burbujas",
  /const suyas = button\.steps \?\? \[\];\s*\n\s*if \(suyas\.length > 0\) await sendConfiguredSteps\(convo, suyas\);/.test(
    puerta
  ),
  "el orden del cuadrito"
);
comprobar(
  "y despues la accion, sabiendo que ya salieron",
  /ejecutarAccion\([\s\S]{0,200}suyas\.length > 0 \? suyas : undefined/.test(puerta),
  "asi no repite lo de fabrica"
);
// SIN BURBUJAS NO CAMBIA NADA: es exactamente la llamada de antes.
comprobar(
  "sin burbujas, la llamada es la de siempre",
  /suyas\.length > 0 \? suyas : undefined/.test(puerta),
  "undefined, como antes"
);
comprobar(
  "el editor deja escribirlas en cualquier accion",
  // Desde el 23/10/2026 tampoco con «Activar workflow», que no lleva burbujas propias.
  /button\.action !== "human" && (button\.action !== "start_workflow" && )?\(/.test(editor),
  "antes solo con «enviar burbujas»"
);
comprobar(
  "y no se pierden al cambiar de accion",
  /action: e\.target\.value as BubbleButtonAction, steps: button\.steps \?\? \[\]/.test(
    editor
  ),
  "lo escrito se conserva"
);

// ── 4. SE VEN EN LA VISTA PREVIA, CON LAS REGLAS DE VERDAD ──────────────────
//
// La previa tiene que mentir lo menos posible: si pinta cuatro botones y el
// motor manda tres, no sirve de nada.
console.log("\n— y se ven antes de vivir una conversacion —\n");
comprobar(
  "la vista previa los dibuja",
  /<BotonesDeLaBurbuja step=\{s\} \/>/.test(editor),
  "dentro de la burbuja"
);
const previa = (() => {
  const i = editor.indexOf("function BotonesDeLaBurbuja");
  const f = editor.indexOf("\nfunction ChatPreview", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
const enElMotor = (() => {
  const i = motor.indexOf("const buttons = (step.buttons ?? [])");
  return i < 0 ? "" : motor.slice(i, i + 400);
})();
comprobar("se encuentran los dos sitios", previa.length > 200 && enElMotor.length > 100);
comprobar(
  "exige id Y etiqueta, igual que el motor",
  /\(b\.id \?\? ""\)\.trim\(\) && \(b\.label \?\? ""\)\.trim\(\)/.test(previa) &&
    /button\.id\.trim\(\) && button\.label\.trim\(\)/.test(enElMotor),
  "sin una de las dos, no sale"
);
comprobar(
  "corta en TRES, igual que el motor",
  /\.slice\(0, 3\)/.test(previa) && /\.slice\(0, 3\)/.test(enElMotor),
  "el limite de WhatsApp"
);
comprobar(
  "y la etiqueta a 20, igual que el motor",
  /\.slice\(0, 20\)/.test(previa) && /\.slice\(0, 20\)/.test(enElMotor),
  "tambien el limite"
);
comprobar(
  "avisa de lo que no se va a enviar",
  /no se enviar/.test(previa),
  "en vez de descartarlo en silencio"
);
// AUDIO Y DOCUMENTO VAN APARTE, y la previa tiene que enseñarlo: ahi el motor no
// puede colgar los botones del mensaje y manda una burbuja con un texto fijo.
comprobar(
  "audio y documento se pintan en burbuja aparte",
  /step\.type === "audio" \|\| step\.type === "document"/.test(previa) &&
    /Qué deseas hacer\?/.test(previa),
  "como los manda el motor"
);
comprobar(
  "y ese texto fijo es el mismo que manda el motor",
  /"¿Qué deseas hacer\?"/.test(motor),
  "no se inventa otro"
);

console.log(
  fallos === 0
    ? "\nTODO OK — los botones se ven, hacen lo suyo y dejan escrito lo que dicen\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
