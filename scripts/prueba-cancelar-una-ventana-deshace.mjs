// En las ventanas de 👤 Usuario, salir sin querer ya no guarda.
//
// EL FALLO
//
//   Las tres ventanas de Usuario —Usuario, Metodos de pago y Respuestas de
//   emergencia— escriben en el borrador MIENTRAS se teclea. No hay copia aparte
//   que confirmar. Asi que Escape y el clic fuera dejaban el cambio hecho.
//
//   Y eso es justo lo contrario de lo que espera cualquiera: se toca fuera para
//   salir SIN tocar nada. El cambio quedaba guardado sin haberlo pedido, sin
//   aviso, y sin forma de deshacerlo de una vez.
//
// COMO QUEDA
//
//   Dos botones arriba: Cancelar y Guardar, en ese orden. Escape y el clic
//   fuera se van por Cancelar, que devuelve el borrador a como estaba al abrir.
//
// LO QUE NO SE TOCO
//
//   `onCancelar` es OPCIONAL. Las otras seis ventanas del editor que usan esta
//   misma cascara siguen exactamente igual: un solo boton «Listo», y Escape y
//   el clic fuera cierran guardando. Se pasan una a una, no todas a ciegas.
//
//   node scripts/prueba-cancelar-una-ventana-deshace.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// -- 1. HAY A DONDE VOLVER ---------------------------------------------------
//
// El punto de retorno guarda el borrador ENTERO y la ALTURA del historial. Lo
// segundo importa tanto como lo primero: sin truncar el historial, deshacer
// despues traeria de vuelta justo lo que se acaba de cancelar.
comprobar(
  "se guarda el borrador al abrir",
  /function marcarPuntoDeRetorno\(\) \{[\s\S]{0,260}?puntoDeRetorno\.current = \{ config: cur, historial: history\.length \};/.test(
    editor
  ),
  "config + altura del historial"
);
comprobar(
  "cancelar devuelve el borrador",
  /function volverAlPuntoDeRetorno\(\) \{[\s\S]{0,400}?setCfg\(punto\.config\);/.test(
    editor
  ),
  "queda como estaba"
);
comprobar(
  "y no deja fotos de un cambio que ya no existe",
  /setHistory\(\(h\) => h\.slice\(0, punto\.historial\)\);/.test(editor) &&
    /volverAlPuntoDeRetorno[\s\S]{0,400}?setRedoHistory\(\[\]\);/.test(editor),
  "deshacer no lo resucita"
);

// -- 2. LA VENTANA SABE CANCELAR ---------------------------------------------
const ventana = (() => {
  const i = editor.indexOf("function VentanaDeProducto(");
  const f = editor.indexOf("function ChapaDeComodin(", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra la ventana", ventana.length > 0, "VentanaDeProducto");
// LA SALIDA DE EMERGENCIA ES ESCAPE, Y YA.
//
// EL CLIC FUERA SE APAGO A PROPOSITO. Estas ventanas son de escribir: se pasa
// dentro un rato largo, seleccionando y arrastrando el raton. Un arrastre que
// empieza dentro de un campo y suelta un pixel fuera de la ventana contaba como
// «clic fuera» y la cerraba. Y no cierra sin mas: en las que saben deshacer,
// DESHACE todo lo escrito desde que se abrio.
//
// Perder el trabajo por soltar el raton dos centimetros a la izquierda no es un
// atajo, es una trampa.
// Y DESHACE SIEMPRE, no solo en las ventanas que sabian: la huella del borrador
// se guarda al abrir y se devuelve al salir. Antes Escape solo cerraba en casi
// todas, asi que lo escrito se quedaba en el borrador y subia con el siguiente
// guardado — lo contrario de lo que significa salir sin guardar.
// Y DESDE EL 18/09/2026, SOLO DESHACE SI QUEDA ALGO SIN GUARDAR.
//
// La intención de arriba no cambia: Escape sigue siendo la salida sin guardar y
// sigue deshaciendo lo escrito. Lo que se le añadió es una condición, por un caso
// que contó el dueño: guardas dentro de una sub-ventana, vuelves a la de arriba y
// pulsas Escape creyendo que ahí no tocaste nada… y su foto, tomada ANTES del
// cambio, deshacía lo que acabas de guardar. Sin nada pendiente no hay nada que
// deshacer. Ver `prueba-tras-guardar-la-ventana-dice-cerrar.mjs`.
comprobar(
  "Escape sale por cancelar",
  /guardadoDelEditor\.restaurar\(huellaAlAbrirLaVentana\);/.test(ventana) &&
    /if \(evento\.key !== "Escape"\) return;[\s\S]{0,260}?salir\(\);/.test(ventana),
  "y deshace si sabe"
);
comprobar(
  "y no deshace lo que ya se guardó",
  /if \(huellaAlAbrirLaVentana && guardadoDelEditor\?\.sucio\) \{/.test(ventana),
  "sin nada pendiente, solo cierra"
);
// SE DEJA REVERSIBLE: un solo interruptor devuelve el comportamiento anterior
// tal cual, sin tocar nada mas. Por eso el clic fuera no se BORRA, se apaga.
comprobar(
  "el clic fuera está apagado, y es reversible",
  /const EL_CLIC_FUERA_CIERRA_LA_VENTANA = false;/.test(editor) &&
    /onClick=\{EL_CLIC_FUERA_CIERRA_LA_VENTANA \? salir : undefined\}/.test(
      ventana
    ),
  "un solo interruptor"
);
comprobar(
  "y la pantalla ya no promete el clic fuera",
  /: "Escape = cancelar"/.test(ventana),
  "no ofrece lo que no hace"
);
// LOS DOS BOTONES SE MUDARON a `BotonesDeLaVentana`, justo encima. Se miran
// ahi, y ademas se comprueba que la ventana los sigue dibujando.
const botones = (() => {
  const i = editor.indexOf("function BotonesDeLaVentana(");
  const f = editor.indexOf("function VentanaDeProducto(", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar(
  "la ventana dibuja los dos botones",
  /<BotonesDeLaVentana onCerrar=\{onCerrar\} onCancelar=\{onCancelar\} \/>/.test(
    ventana
  ) && botones.length > 0,
  "BotonesDeLaVentana"
);
// SON DOS SIEMPRE.
//
// Se probo con uno solo que cambiaba de nombre —«Guardar» con cambios,
// «Cerrar» sin ellos— y estaba mal: con un solo boton, salir SIN guardar deja
// de ser posible. Uno escribe, se arrepiente, y el unico boton que hay guarda.
//
// Y Cancelar no puede ir condicionado: en las ventanas que no saben deshacer
// tambien hace falta una salida que no suba nada.
// SIEMPRE HAY SALIDA, y la palabra dice lo que el boton hace.
//
// Sin tocar nada dentro de la ventana no hay nada que guardar ni nada que
// cancelar: un solo boton, «Cerrar». En cuanto se toca algo salen los dos.
comprobar(
  "Cancelar sale siempre, sepa deshacer o no",
  /\(onCancelar \?\? onCerrar\)\(\);/.test(botones) &&
    !/\{onCancelar && \(/.test(botones),
  "nunca se queda sin salida"
);
// Y AHORA DESHACE TAMBIEN EN LAS VENTANAS QUE NO SABIAN: se devuelve la huella
// del borrador de cuando se abrio. Antes, sin `onCancelar`, Cancelar solo
// cerraba y lo escrito subia con el siguiente guardado.
comprobar(
  "y Cancelar deshace, no solo cierra",
  /guardado\?\.restaurar\(huellaAlAbrir\);/.test(botones),
  "en todas las ventanas"
);
comprobar(
  "y se llama «Cerrar» cuando no hay nada que cancelar",
  /if \(!cambioAqui\) \{[\s\S]{0,700}?Cerrar\s*\r?\n\s*<\/button>/.test(botones),
  "la palabra no miente"
);
// LO QUE CUENTA ES SI CAMBIO ALGO EN ESTA VENTANA, no en todo el editor.
//
// Se miraba el «hay cambios sin guardar» global, asi que una ventana recien
// abierta ya salia con «Guardar» encendido por algo escrito media hora antes en
// otra pestaña: se abre, no se toca nada, y el boton dice que hay trabajo
// pendiente ahi.
// Y ADEMÁS, DESDE EL 18/09/2026, QUE QUEDE ALGO SIN GUARDAR DE VERDAD.
//
// Son DOS preguntas, y las dos hacen falta:
//   · la foto propia impide que una ventana recién abierta ofrezca guardar lo que
//     se escribió en otra pestaña — es lo que protege el párrafo de arriba;
//   · el estado real del borrador impide que siga ofreciendo guardar algo que YA
//     se guardó desde una sub-ventana, que es lo que contó el dueño.
//
// Mirar solo la global sería volver al fallo viejo; mirar solo la foto es el que
// se acaba de arreglar. Por eso la condición exige LAS DOS.
comprobar(
  "la ventana compara con lo que había al abrirse",
  /const \[huellaAlAbrir\] = useState\(\(\) => guardado\?\.huella \?\? ""\);/.test(
    botones
  ) && /\(guardado\?\.huella \?\? ""\) !== huellaAlAbrir/.test(botones),
  "no con el editor entero"
);
comprobar(
  "y además pregunta si queda algo sin guardar",
  /const cambioAqui = sucio && \(guardado\?\.huella \?\? ""\) !== huellaAlAbrir;/.test(
    botones
  ),
  "las dos, no una"
);
// EL VERDE DEJA LO ESCRITO Y CIERRA. NO HACE GUARDADO GENERAL.
//
// ESTO CAMBIO EL 28/09/2026, A PETICION DEL DUEÑO:
//
//   «Yo quiero que el guardar de los pop ups guarden los cambios del contenido de
//    sus ventanas respectivas, pero que no hagan guardado general. Pero, cuando
//    yo haga algun cambio en el editor que aparezca al lado de "guardar" AUN NO
//    HAS GUARDADO TUS CAMBIOS, como aviso extra.»
//
// ANTES SUBIA, y no fue un capricho: el boton decia «Guardar» y solo cerraba, asi
// que uno se iba tranquilo con el trabajo sin subir. Lo que arreglo eso no fue el
// guardado general: fue que ALGUIEN AVISE. Ahora avisa el cartel de la barra, y
// por eso las dos comprobaciones van JUNTAS aqui: si desaparece el cartel, esto
// vuelve a ser la trampa de antes.
comprobar(
  "Guardar deja lo escrito y cierra, sin subir",
  /\/\/ SE QUEDA LO ESCRITO Y SE CIERRA\. NO SUBE NADA\./.test(botones) &&
    !/guardado\.guardar\(\)/.test(botones),
  "sube el de la barra, o Ctrl+S"
);
comprobar(
  "  y el cartel avisa de lo que queda sin subir",
  /Aún no has guardado tus cambios/.test(editor) &&
    /function AvisoDeSinGuardar\(/.test(editor) &&
    /if \(!sucio \|\| guardando\) return null;/.test(editor),
  "la otra mitad del cambio"
);
comprobar(
  "  y esta pegado a los DOS botones de guardar general",
  (editor.match(/<AvisoDeSinGuardar sucio=\{isDirty\} guardando=\{saving\} \/>/g) ?? [])
    .length === 2,
  "la cabecera y el modo concentracion"
);
// Y CUANDO NO HAY NADA QUE GUARDAR NO SE APAGA: no aparece. El boton verde solo
// existe cuando se toco algo en esta ventana, asi que gris no hace falta.
comprobar(
  "sin cambios, el verde no aparece siquiera",
  /if \(!cambioAqui\) \{/.test(botones) &&
    /disabled:bg-neutral-200 disabled:text-neutral-500/.test(botones),
  "no hay nada que subir"
);
// EL ESTADO SALE DEL EDITOR, no de un `useState` propio: si la ventana tuviera
// su propia idea de «hay cambios», diria verde con todo guardado.
comprobar(
  "el estado sale del guardado de verdad",
  /const GuardadoDelEditor = createContext</.test(editor) &&
    /sucio: isDirty,\s*\r?\n\s*guardando: saving,\s*\r?\n\s*guardar: save,\s*\r?\n\s*huella: huellaDelBorrador,/.test(
      editor
    ),
  "el mismo que la barra de arriba"
);
// CANCELAR A LA IZQUIERDA DE GUARDAR, y en ese orden en el codigo.
//
// El de salir sin nada nunca va donde esta el de confirmar en la ventana de al
// lado: se pulsa por costumbre y se guarda justo lo que se queria tirar.
//
// El orden se compara con saltos de linea TOLERANTES: el archivo va con CRLF y
// buscar "Cancelar\n" a secas devolvia -1 — que es menor que cualquier cosa,
// asi que la comprobacion pasaba sin comprobar nada.
comprobar(
  "hay Cancelar, y a la IZQUIERDA de Guardar",
  (() => {
    const cancelar = botones.search(/\r?\n\s*Cancelar\s*\r?\n\s*<\/button>/);
    const guardar = botones.search(/\{guardando \? "Guardando…" : "Guardar"\}/);
    return cancelar >= 0 && guardar >= 0 && cancelar < guardar;
  })(),
  "el de salir nunca donde el de confirmar"
);
comprobar(
  // «Listo» es lo que decian las ventanas que solo cierran. Se retiro porque
  // que unas dijeran una cosa y otras otra obligaba a recordar cual era cual;
  // ahora lo que cambia es si HAY algo que guardar, no de que ventana se trate.
  "no queda ningún «Listo»",
  !/"Listo"/.test(ventana) && !/"Listo"/.test(botones),
  "una sola forma de salir"
);

// -- 3. ESCAPE CIERRA DE DENTRO HACIA FUERA ----------------------------------
//
// Dentro de dos de estas ventanas se abren otras, y cada una escucha Escape por
// su cuenta. Esta se monta primero, asi que corria primero: un solo golpe
// cerraba la de dentro Y cancelaba esta, y el trabajo de las dos se iba junto.
comprobar(
  "con una ventana encima, Escape no cancela esta",
  /if \(contenedor\.current\?\.querySelector\('\[role="dialog"\]'\)\) return;/.test(
    ventana
  ) && /ref=\{contenedor\}/.test(ventana),
  "es de la de dentro"
);

// -- 4. LAS VENTANAS DE USUARIO, CONECTADAS ----------------------------------
//
// Abrir es marcar a donde volver. Si una se abriera sin pasar por `abrir`,
// seria la unica que no se puede cancelar, y no habria forma de notarlo.
//
// SON CUATRO desde que el nombre de leer se separo del que valida el
// comprobante: la de arriba es «usuario» y la de los datos de pago se quedo con
// lo de siempre. Ver `prueba-dos-nombres-independientes`.
comprobar(
  "abrir marca el punto de retorno",
  /const abrir = \(cual: "usuario" \| "datos" \| "mensajes" \| "emergencia"\) => \{\s*\r?\n\s*onMarcarPunto\(\);/.test(
    editor
  ),
  "las cuatro por el mismo sitio"
);
for (const cual of ["usuario", "datos", "mensajes", "emergencia"]) {
  comprobar(
    `la ventana «${cual}» se abre por ahi`,
    new RegExp(`onClick=\\{\\(\\) => abrir\\("${cual}"\\)\\}`).test(editor) &&
      !new RegExp(`onClick=\\{\\(\\) => setAbierta\\("${cual}"\\)\\}`).test(editor),
    "marca antes de la primera letra"
  );
}
comprobar(
  "y las cuatro tienen su Cancelar",
  (editor.match(/onCancelar=\{cancelar\}/g) ?? []).length === 4,
  "4 de 4"
);
comprobar(
  "cancelar cierra y deshace",
  /const cancelar = \(\) => \{\s*\r?\n\s*onCancelarVentana\(\);\s*\r?\n\s*setAbierta\(null\);/.test(
    editor
  ),
  "las dos cosas"
);
comprobar(
  "el editor le pasa las dos manos a la pestaña",
  /onMarcarPunto=\{marcarPuntoDeRetorno\}/.test(editor) &&
    /onCancelarVentana=\{volverAlPuntoDeRetorno\}/.test(editor),
  "conectado"
);

// -- 5. LAS DEMAS VENTANAS NO SE TOCARON -------------------------------------
comprobar(
  "cancelar es opcional",
  /onCancelar\?: \(\) => void;/.test(ventana),
  "las otras seis siguen igual"
);
// SIN `onCancelar`, CANCELAR SIGUE SALIENDO: cierra sin subir nada. Antes en
// esas ventanas no habia ninguna salida que no guardara.
comprobar(
  "y sin el, Cancelar al menos cierra",
  /\(onCancelar \?\? onCerrar\)\(\);/.test(botones),
  "siempre hay salida"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
