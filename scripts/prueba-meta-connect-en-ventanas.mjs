// Meta Connect: once filas numeradas, cada una con su ventana.
//
// COMO ESTABA
//
//   Once secciones abiertas, una debajo de otra, con listas de paginas y
//   bloques de variables dentro. Para llegar a la ultima habia que pasar por
//   las diez anteriores, y ninguna se toca mas de una vez al mes.
//
//   Y el orden era el de como se fueron escribiendo, no el de como se hacen las
//   cosas: el pixel salia antes que las paginas y que el numero.
//
// COMO QUEDA
//
//   Once filas en el orden del trabajo, numeradas. El numero no es adorno: esta
//   pantalla se recorre UNA vez, de arriba abajo, el dia que se conecta. Sin el
//   numero, once filas parecen once opciones sueltas.
//
// LO QUE NO PUEDE PASAR
//
//   Que se pierda una seccion por el camino. Tres no estaban en el orden que se
//   pidio —Instagram, las paginas detectadas y la configuracion automatica— y
//   se colocaron junto a su vecina natural en vez de quitarlas.
//
//   node scripts/prueba-meta-connect-en-ventanas.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const pantalla = readFileSync(
  join(RAIZ, "src", "app", "meta-connect", "page.tsx"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

comprobar(
  "existe la fila que abre una ventana",
  /function SeccionEnVentana\(/.test(pantalla),
  "SeccionEnVentana"
);

// -- 1. EL ORDEN, EL QUE SE PIDIO --------------------------------------------
//
// LAS DOS LISTAS DE PAGINAS VAN JUNTAS. Son la misma decision partida en dos:
// cuales atiende el bot y cuales podria atender. Separadas, habia que cerrar
// una para mirar la otra, que es justo lo que hace falta comparar.
const ORDEN = [
  "Conexión lista para iniciar",
  "Configuración automática",
  "Cuentas de lectura de Ads",
  "Páginas de Facebook",
  "Instagram para este agente",
  "Cuentas de WhatsApp",
  "Píxel",
  "Datos exactos para Meta",
  "Variables detectadas",
  "Variables manuales",
];
const titulos = [...pantalla.matchAll(/titulo="([^"]+)"\s*\r?\n\s*tono=/g)].map(
  (m) => m[1]
);
comprobar(
  "las diez secciones están, y en su orden",
  titulos.length === ORDEN.length && ORDEN.every((t, i) => titulos[i] === t),
  titulos.length === ORDEN.length ? "diez" : `hay ${titulos.length}`
);
// NINGUNA SE PIERDE. Tres no estaban en la lista que se pidio; quitarlas habria
// dejado sin sitio a Instagram, a la configuracion automatica y a las paginas
// que Meta detecta, que es justo por donde se empieza a conectar.
for (const t of ["Instagram para este agente", "Configuración automática"]) {
  comprobar(`«${t}» sigue estando`, titulos.includes(t), "no se perdió");
}
// LAS DETECTADAS YA NO SON UNA SECCION, pero su contenido sigue vivo DENTRO de
// la de paginas. Si desapareciera, no habria por donde agregar una pagina.
comprobar(
  "las páginas detectadas siguen, dentro de la de páginas",
  /Páginas de Facebook detectadas: elige las que trabajará este agente/.test(
    pantalla
  ),
  "misma ventana"
);

// -- 2. CADA UNA LLEVA SU NUMERO ---------------------------------------------
comprobar(
  "van numeradas del 1 al 10",
  // Desde el 10/10/2026 el número llega por `lugar(n)`: en el profesional devuelve el de
  // siempre; en el modo esencial, el suyo. Ver `prueba-modo-esencial`.
  [...Array(10).keys()].every((i) =>
    new RegExp(`\\{\\.\\.\\.lugar\\(${i + 1}\\)\\}`).test(pantalla)
  ) && !/lugar\(11\)/.test(pantalla),
  "el orden del trabajo"
);
// -- 2 bis. Y CADA UNA SU COLOR ----------------------------------------------
//
// Con el mismo color en las diez, el cuadrado deja de distinguir nada y es solo
// adorno. Es la misma regla que en el editor.
comprobar(
  "y cada una su color",
  new Set([...pantalla.matchAll(/tono="([^"]+)"/g)].map((m) => m[1])).size ===
    ORDEN.length,
  "diez distintos"
);
comprobar(
  "y el número se ve en la fila y en la ventana",
  (pantalla.match(/\{paso\}\. \{titulo\}/g) ?? []).length === 2,
  "fuera y dentro"
);

// -- 3. NO SE CIERRA AL TOCAR FUERA ------------------------------------------
//
// Por lo mismo que en el editor: dentro se pegan tokens largos y se seleccionan
// textos, y soltar el raton un pixel fuera cerraba la ventana.
const ventana = (() => {
  const i = pantalla.indexOf("function SeccionEnVentana(");
  const f = pantalla.indexOf("function SetDeVenta(", i);
  return i < 0 || f < 0 ? "" : pantalla.slice(i, f);
})();
comprobar(
  "el clic fuera no cierra la ventana",
  ventana.length > 0 &&
    /role="dialog"/.test(ventana) &&
    !/onClick=\{\(\) => setAbierto\(false\)\}[\s\S]{0,120}?role="dialog"/.test(
      ventana
    ),
  "solo Escape o Cerrar"
);
comprobar(
  "y Escape sí",
  /if \(evento\.key !== "Escape"\) return;/.test(ventana),
  "con su botón al lado"
);

// -- 4. EL RESUMEN SE QUEDA FUERA --------------------------------------------
//
// La tarjeta que dice si la venta se va a registrar no puede estar detras de un
// clic: es lo que hay que ver sin buscar.
comprobar(
  "el Set de venta sigue a la vista",
  /<SetDeVenta/.test(pantalla) &&
    pantalla.indexOf("<SetDeVenta") < pantalla.indexOf("<SeccionEnVentana"),
  "antes de las diez filas"
);

// -- 5. LA MISMA ROPA QUE EL EDITOR ------------------------------------------
//
// Iba sobre blanco, con secciones blancas encima: una sabana clara sin nada que
// separara una cosa de otra. El editor ya resolvio eso con tres alturas, y los
// colores viven en `globals.css` con nombres de funcion — asi que aqui se usan
// LOS MISMOS. No se copia una paleta: se lee la que ya hay.
comprobar(
  "el suelo y el panel salen del tema",
  /bg-panel p-5 shadow-sm/.test(pantalla) && /pb-56/.test(pantalla),
  "tres alturas"
);
comprobar(
  "y la cabecera es la de las pestañas del editor",
  /tracking-\[0\.16em\] text-acento/.test(pantalla) &&
    /font-titulo text-\[28px\] font-extrabold/.test(pantalla),
  "rótulo, título y frase"
);
// LOS DOS ENLACES DEL FINAL SE FUERON. Eran los mismos que ya estan arriba,
// repetidos porque la pantalla era larguisima. Con las secciones plegadas, el
// final esta a un palmo del principio.
// Se cuenta el ENLACE dibujado, no la palabra: el comentario que explica por
// qué se fue el segundo la nombra, y contar la palabra encontraría ese
// comentario y daría rojo para siempre.
comprobar(
  "no se repiten los enlaces de salir",
  (pantalla.match(/>Volver al chat<\/a>/g) ?? []).length === 1,
  "una sola vez"
);

console.log(
  fallos === 0
    ? "\nTODO OK — once pasos en orden, y ninguno se perdió"
    : `\n${fallos} FALLO(S)`
);
process.exit(fallos === 0 ? 0 : 1);
