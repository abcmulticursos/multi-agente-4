// Tres molestias del editor que costaban trabajo de verdad.
//
// 1. EL PAIS SE PERDIA. Elegias Argentina en Precios y pagos, refrescabas y
//    volvias a Peru sin ningun aviso. Peor que molesto: creias estar editando
//    los precios de Argentina y estabas tocando los de Peru.
//
// 2. EL DESPLEGABLE DE COMODINES TAPABA LO QUE ESCRIBIAS. Intentaba ponerse
//    debajo del renglon, pero si no cabia se volteaba ARRIBA — justo encima de
//    la linea que estabas escribiendo. No ver lo que uno escribe es lo unico
//    que no puede pasar en un cuadro de texto.
//
// 3. LA MONEDA LLEVABA GENTILICIO. "10 pesos argentinos" en mitad de una venta
//    suena a casa de cambio. A un argentino se le dice "10 pesos".
//
//   node scripts/prueba-editor-comodo.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const editor = leer("src", "app", "editor", "page.tsx");
const paises = leer("src", "lib", "countries.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. El país se recuerda ──────────────────────────────────────────────────
comprobar(
  "el país elegido se guarda",
  /EDITOR_COUNTRY_STORAGE_KEY/.test(editor) && /recordarPais\(country\)/.test(editor),
  "sí"
);
// EL FALLO: habia DOS selectores de pais. El de abajo llamaba a la funcion
// completa —que prepara el perfil del pais si aun no existe y guarda la
// eleccion— y el de ARRIBA, el que se usa todo el tiempo, solo movia la
// variable. Por eso cambiar de pais se sentia cosmetico y al refrescar volvia a
// Peru. Los dos tienen que pasar por la misma puerta.
comprobar(
  "el desplegable de arriba usa la función completa",
  /selectPaymentProfileCountry\(e\.target\.value as CountryCode\)/.test(editor),
  "misma puerta"
);
comprobar(
  "ya no queda un selector que solo cambie la variable",
  !/onChange=\{\(e\) => setSelectedPaymentCountry\(e\.target\.value as CountryCode\)\}/.test(
    editor
  ),
  "ninguno"
);
comprobar(
  "y se recupera al volver",
  /const guardado = paisRecordado\(\);/.test(editor),
  "sí"
);
comprobar(
  "se lee en un efecto, no al dibujar",
  /useEffect\(\(\) => \{\s*\r?\n\s*const guardado = paisRecordado\(\);/.test(editor),
  "sin desajuste"
);
comprobar(
  "solo acepta países que existen",
  /COUNTRY_OPTIONS\.some\(\(pais\) => pais\.code === valor\)/.test(editor),
  "sí"
);

// ── 2. El desplegable, siempre debajo ───────────────────────────────────────
comprobar(
  "el desplegable NO se voltea hacia arriba",
  !/baseRenglon - ALTO_MENU/.test(editor),
  "nunca arriba"
);
comprobar(
  "va siempre debajo del renglón",
  /const y = baseRenglon \+ \d+;/.test(editor),
  "debajo"
);
comprobar(
  "si hay poco espacio se encoge, no tapa",
  /Math\.min\(ALTO_MENU, window\.innerHeight - y - 12\)/.test(editor) &&
    /maxHeight: state\.alto/.test(editor),
  "se encoge"
);
// EL MINIMO SUBIO DE 120 A 180, y no es un capricho.
//
// En 120 px entran dos o tres comodines. Como el menu se encoge segun el sitio
// que quede debajo del cuadro, en los cajones de abajo se veian tres y en los de
// arriba seis — y con scroll interno y sin nada que lo indique, eso se lee como
// «en este cajon hay menos comodines». La lista siempre fue la misma.
comprobar(
  "y conserva un alto mínimo usable",
  /Math\.max\(\s*\r?\n?\s*180,/.test(editor),
  "180px"
);
// Y DICE CUANTOS HAY, pegado arriba, para que se entienda que hay que deslizar.
comprobar(
  "el menú dice cuántos comodines hay",
  /\{filtered\.length\} comodín\{filtered\.length === 1 \? "" : "es"\}/.test(
    editor
  ) && /desliza para ver todos/.test(editor),
  "no parecen menos"
);

// ── 3. La moneda, sin gentilicio ────────────────────────────────────────────
for (const moneda of ["COP", "MXN", "ARS", "CLP"]) {
  comprobar(
    `${moneda} dice «pesos», no el gentilicio`,
    new RegExp(`currency === "${moneda}"\\) return singular \\? "peso" : "pesos"`).test(
      paises
    ),
    "pesos"
  );
}
comprobar(
  "las que ya estaban bien no se tocan",
  /currency === "PEN"\) return singular \? "sol" : "soles"/.test(paises) &&
    /currency === "CRC"\) return singular \? "colón" : "colones"/.test(paises),
  "intactas"
);

// ── 4. El editor abre con las bases guardadas ───────────────────────────────
//
// Intro, Seguimientos y Salesbot se tocan de vez en cuando; el resto es el
// trabajo de todos los dias. Tenerlas siempre delante alarga la fila de
// pestañas y obliga a buscar la que se necesita entre las que no.
comprobar(
  "abre con las bases guardadas",
  /const \[showBaseTabs, setShowBaseTabs\] = useState\(false\);/.test(editor),
  "guardadas"
);
comprobar(
  "el Salesbot se guarda con ellas",
  /key === "intro" \|\| key === "seguimientos" \|\| key === "salesbot"/.test(editor),
  "sí"
);
comprobar(
  "y el botón las trae de vuelta",
  /showBaseTabs \? "Ocultar bases" : "Mostrar bases"/.test(editor),
  "no se pierde nada"
);
comprobar(
  "no abre parado en una pestaña oculta",
  /const \[tab, setTab\] = useState<Tab>\("canales"\)/.test(editor),
  "abre en Canales"
);

// ── 5. El nombre del pack, junto a su contenido ─────────────────────────────
//
// Estaba suelto arriba del todo, en un recuadro aparte, y no se parecia en nada
// al del Producto 1 —que si esta junto a su descripcion—. Habia que acordarse
// de que existia y de donde estaba.
comprobar(
  // El cajon se llamaba «Pack / opción conjunta». Ahora dice el papel del
  // producto —FULL—, que es como lo nombran su comodin y el resto de rotulos.
  // Lo que se vigila es lo mismo: que el nombre se escriba JUNTO a su contenido.
  "el nombre del FULL está dentro de «FULL (opción conjunta)»",
  /Collapsible\s*\r?\n?[\s\S]{0,400}?title="📦 FULL \(opción conjunta\)"[\s\S]{0,1800}?Nombre del producto FULL/.test(
    editor
  ),
  "junto a su contenido"
);
comprobar(
  "y ya no está suelto arriba",
  !/Combo \/ Mega Pack \(Order Bump\)/.test(editor),
  "sin recuadro aparte"
);
comprobar(
  // MULTI AGENTE 1 escribe la misma condición como `isOrderBump`. Se aceptan
  // las dos formas: lo que importa es que el campo siga siendo de Order Bump y
  // no aparezca en las demás modalidades.
  "sigue siendo solo de Order Bump",
  /\{(contentMode === "order_bump"|isOrderBump) && \(\s*\r?\n\s*<label/.test(editor),
  "sí"
);

// ── 6. "descuento", no "oferta" ─────────────────────────────────────────────
//
// En Precios y pagos el concepto es un descuento sobre el precio normal.
// "Oferta" ademas choca con "Doble Oferta", que es el nombre de dos
// modalidades: la misma palabra significaba dos cosas en la misma pantalla.
comprobar(
  "los campos dicen «descuento»",
  /Precio producto base — descuento/.test(editor) &&
    /Precio producto full — descuento/.test(editor) &&
    /Precio producto upsell — descuento/.test(editor),
  "los tres"
);
comprobar(
  "las ayudas también",
  !/0 = sin oferta/.test(editor) && /0 = sin descuento/.test(editor),
  "sí"
);
comprobar(
  "y el interruptor de la etapa",
  /Etapa de descuento/.test(editor) && /Activar el precio de descuento/.test(editor),
  "sí"
);
comprobar(
  "no se tocó el nombre de las modalidades",
  /Doble Oferta 2 Prod/.test(editor) && /Doble Oferta \+ Upsell/.test(editor),
  "intacto"
);

// ── 7. Argentina se escribe como allá ───────────────────────────────────────
//
// "18.000 pesos" en una conversacion de venta suena a otro pais. Alla se
// escribe "$18.000 ARS": pegado al simbolo y con el codigo.
comprobar(
  "los cuatro pesos usan su código, no la palabra",
  /const PESOS_CON_CODIGO = new Set\(\["ARS", "MXN", "COP", "CLP"\]\);/.test(paises) &&
    /if \(PESOS_CON_CODIGO\.has\(currency\)\) \{\s*\r?\n\s*return `\$\{symbol\}\$\{formatAmountForCountry\(monto, country\)\} \$\{currency\}`;/.test(
      paises
    ),
  "$18.000 ARS"
);
comprobar(
  // Soles, colones, dolares, bolivianos, quetzales y bolivares NO se confunden
  // con nada y su palabra es la que usa la gente. Solo los cuatro "peso"
  // comparten simbolo y nombre.
  "las monedas que no se confunden conservan su palabra",
  !/PESOS_CON_CODIGO = new Set\(\[[^\]]*"PEN"/.test(paises) &&
    !/PESOS_CON_CODIGO = new Set\(\[[^\]]*"CRC"/.test(paises),
  "soles, colones…"
);
comprobar(
  "y los demás países siguen con su palabra",
  /return `\$\{symbol\} \$\{formatAmountForCountry\(monto, country\)\} \$\{displayName\}`;/.test(
    paises
  ),
  "intactos"
);

// ── 8. El desplegable, más abajo ────────────────────────────────────────────
comprobar(
  "el desplegable se separa del renglón",
  /const y = baseRenglon \+ 14;/.test(editor),
  "14px"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
