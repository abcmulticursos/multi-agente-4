// EL SELECTOR DE PAIS, SIEMPRE A LA VISTA.
//
// LO QUE PIDIO EL DUEÑO — 23 de septiembre de 2026, con sus palabras:
//
//   «Cada vez que yo edito en modo pop up cualquier texto, tengo que salir de
//    los pop ups para poder cambiar el boton de Argentina a Peru, o Ecuador.
//    No quiero salirme de las burbujas.»
//
// Y LO AMPLIO el 24 de septiembre: «necesito que agregues el selector de
// banderas a la derecha que siempre este visible, no solo en el momento del pop
// up». Asi que dejo de aparecer y desaparecer: esta puesto siempre.
//
// Eligio el sitio el mismo: ABAJO A LA DERECHA. Arriba ya viven «Ver recorrido»
// y «Salir de pantalla completa», que son de la pantalla; este es de lo que se
// esta escribiendo.
//
// LO QUE NO PUEDE ROMPERSE
//
//   1. Que sea un selector NUEVO. Tiene que llamar al mismo que el de Precios y
//      pagos: ese, ademas de cambiar el pais, siembra el perfil si ese pais aun
//      no tenia. Dos caminos para la misma decision acaban discrepando, y aqui
//      discrepar es editar los textos de un pais creyendo que son de otro.
//
//   2. Que DESAPAREZCA. Esa era la regla vieja —salir solo con un pop-up
//      abierto— y el dueño la cambio el 24/09. Se comprueba lo contrario: que no
//      quede ninguna condicion que lo esconda.
//
//   3. Que se quede DEBAJO de la ventana que se quiere editar. Las ventanas del
//      editor van en z-50: el flotante tiene que ir por encima.
//
//   node scripts/prueba-el-pais-flota-sobre-los-popups.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 52)} ${valor}`);
};

console.log("\n-- el flotante existe y esta puesto -------------------------");
comprobar(
  "el componente existe",
  /function PaisFlotanteSiempreALaVista\(/.test(editor),
  "en el editor"
);
comprobar(
  "y se dibuja en la pantalla",
  /<PaisFlotanteSiempreALaVista\b/.test(editor),
  "una sola vez"
);

console.log("\n-- NO es un selector nuevo ----------------------------------");
// EL CANDADO QUE MAS IMPORTA. Si algun dia alguien le pone su propio
// `setSelectedPaymentCountry`, el pais cambiaria a medias: sin sembrar el perfil
// del pais nuevo. Se fija que llame al camino de siempre.
comprobar(
  "llama al mismo camino que Precios y pagos",
  /<PaisFlotanteSiempreALaVista[\s\S]{0,160}?onPais=\{selectPaymentProfileCountry\}/.test(
    editor
  ),
  "selectPaymentProfileCountry"
);
comprobar(
  "y las banderas salen de la lista de siempre",
  /function PaisFlotanteSiempreALaVista\([\s\S]{0,2600}?COUNTRY_OPTIONS\.map\(/.test(
    editor
  ),
  "COUNTRY_OPTIONS"
);

// -- SIEMPRE PUESTO ----------------------------------------------------------
//
// ACTUALIZADO el 24/09/2026, conservando la intencion. Antes esta seccion exigia
// lo contrario —que solo saliera con un pop-up abierto— porque asi lo habia
// pedido el dueño. Lo cambio: «que siempre este visible, no solo en el momento
// del pop up». Lo que se comprueba ahora es que NADA lo esconda.
console.log("\n-- siempre puesto, no solo con pop-up -----------------------");
comprobar(
  "no queda condicion que lo esconda",
  !/if \(!hayPopUp\) return null;/.test(editor),
  "ya no desaparece"
);
comprobar(
  "y se quito el detector de pop-ups, que ya no decide nada",
  !/querySelectorAll\('\[aria-modal="true"\]'\)/.test(editor),
  "maquina muerta fuera"
);
comprobar(
  "se dibuja siempre que haya configuracion",
  /\{cfg && \(\s*<PaisFlotanteSiempreALaVista/.test(editor),
  "sin mas condiciones"
);

// -- ESCAPE CIERRA LA LISTA, Y SOLO LA LISTA ---------------------------------
//
// LO QUE PIDIO EL DUEÑO — 24/09/2026: «se despliega con el mouse pero hay que
// presionar nuevamente el boton para que se repliegue; agregale la opcion de
// apretar escape, pero sin afectar los menus y otras cosas que esten
// desplegadas en ese momento como pop ups».
//
// LOS DOS CANDADOS, y el segundo es el que importa: si el Escape no se para,
// cierra la lista Y la ventana de detras, y el dueño pierde lo que estaba
// editando por pulsar una tecla.
console.log("\n-- escape cierra la lista, y solo la lista ------------------");
comprobar(
  "escucha el Escape",
  /evento\.key !== "Escape"/.test(editor),
  "y nada mas"
);
comprobar(
  "solo mientras la lista esta abierta",
  /useEffect\(\(\) => \{\s*if \(!abierto\) return;/.test(editor),
  "cerrada, no escucha nadie"
);
comprobar(
  "y para el evento para no cerrar lo de detras",
  /evento\.stopPropagation\(\);\s*evento\.preventDefault\(\);/.test(editor),
  "la ventana de debajo se queda"
);
comprobar(
  "en fase de captura, antes que los demas",
  /addEventListener\("keydown", alPulsar, true\)/.test(editor),
  "llega el primero"
);
comprobar(
  "y se quita al cerrarse",
  /removeEventListener\("keydown", alPulsar, true\)/.test(editor),
  "no deja oyentes sueltos"
);

console.log("\n-- por encima de las ventanas -------------------------------");
comprobar(
  "va mas alto que los pop-ups",
  /z-\[60\]/.test(editor),
  "las ventanas van en z-50"
);
comprobar(
  "y abajo a la derecha, donde el lo pidio",
  /fixed bottom-5 right-5/.test(editor),
  "no arriba, que ya esta ocupado"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el pais se cambia sin cerrar la ventana, y por el camino de siempre\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
