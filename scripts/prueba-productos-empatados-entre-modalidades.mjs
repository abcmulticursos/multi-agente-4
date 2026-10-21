// El mismo producto se llamaba distinto segun donde estuvieras.
//
// Order Bump y Doble Oferta + Upsell venden lo mismo en el fondo: un BASICO y
// un FULL. Pero los guardan en campos CRUZADOS:
//
//                 Order Bump                Doble Oferta + Upsell
//   basico        product_name              product_name_2
//   full          order_bump.combo.name     product_name
//
// O sea que `product_name` es el BASICO en una y el FULL en la otra. Por eso
// cada modalidad ofrecia comodines distintos: con un solo nombre, el comodin
// mentia en una de las dos. Y copiar un texto de una modalidad a otra cambiaba
// de producto sin avisar.
//
// EL EMPATE. Un comodin por PAPEL —base, full, complementario— y cada modalidad
// lo resuelve con SU campo. Se escribe igual en las dos; sale el de la que este
// vendiendo.
//
// LO QUE VIGILA ESTA PRUEBA
//
//   1. El reparto por modalidad existe y esta en UN solo sitio.
//   2. El visor del editor calcula EL MISMO reparto. Si uno cambia y el otro no,
//      la vista previa ensena un nombre y al cliente le llega otro — peor que
//      ver la llave cruda, porque nadie lo nota.
//   3. El COMPLEMENTARIO solo existe en Order Bump. Antes compartia significado
//      con `producto_secundario`, asi que en Doble Oferta + Upsell devolvia la
//      BASE: un nombre falso y creible.
//   4. `{{PRODUCTO_SECUNDARIO}}` y `{{PRODUCTO}}` siguen intactos: hay 125
//      textos escritos con ellos.
//
//   node scripts/prueba-productos-empatados-entre-modalidades.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const motor = leer("src", "lib", "workflow", "config.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};
const trozo = (fuente, desde, largo) => {
  const i = fuente.indexOf(desde);
  return i < 0 ? "" : fuente.slice(i, i + largo);
};

// ── 1. El reparto por modalidad, en un solo sitio ──────────────────────────
// LA VENTANA CRECIO CON LA FUNCION. El 23/09/2026 se le añadio la salvedad de
// la presentacion prestada y su porque, y con 2800 el recorte se quedaba antes
// del final: la prueba decia que faltaba algo que si estaba. Se ensancha, que
// es lo unico que cambia — lo que comprueba sigue siendo lo mismo.
// Se ensancho otra vez el 01/10/2026: entro el comentario que explica por que el
// complementario SENTADO si se nombra, y el final de la funcion se quedaba fuera.
const reparto = trozo(motor, "function nombresDeLosProductos(", 7200);
comprobar("existe el reparto por modalidad", reparto.length > 0, "nombresDeLosProductos");
comprobar(
  "en Order Bump el basico es el principal",
  /modo === "order_bump"[\s\S]{0,220}base: principal/.test(reparto),
  "product_name"
);
comprobar(
  "y su full es la opcion conjunta",
  /full: cfg\.order_bump\?\.combo\?\.name/.test(reparto),
  "order_bump.combo.name"
);
comprobar(
  "y su complementario es el segundo producto",
  /complementario: segundo/.test(reparto),
  "product_name_2"
);
comprobar(
  // Doble Oferta + Upsell es la que esta vendiendo: su reparto NO puede cambiar.
  "en el resto el full es el principal y la base el segundo",
  // LA INTENCION NO CAMBIA: el full es el principal y la base el segundo, letra por
  // letra. Lo que cambio el 01/10/2026 es la TERCERA linea: el complementario ya no
  // es un "" fijo, sino el producto que el dueño haya SENTADO en ese asiento. Lo
  // pidio el —«yo se que no se vende, pero tiene que representarse»— y se comprueba
  // en `prueba-el-complementario-sentado-se-nombra`.
  /return \{\s*\r?\n?\s*base: segundo,\s*\r?\n?\s*full: principal,\s*\r?\n?\s*complementario: elComplementoSentado\(\),\s*\r?\n?\s*\};/.test(
    reparto
  ),
  "como estaba"
);
// LINEAL Y UPSELL: UN SOLO PRODUCTO, ASI QUE LOS DOS NOMBRES SON EL.
//
// No se juntan dos productos distintos: es que ahi no hay dos. Antes
// {{PRODUCTO_BASE}} devolvia el SEGUNDO producto, que en Lineal no se vende:
// salia en blanco y la frase se quedaba a medias sin que nada lo dijera. Y
// obligaba a escribir los textos dos veces, unos con {{PRODUCTO}} y otros con
// {{PRODUCTO_BASE}}, diciendo lo mismo.
//
// EL 23/09/2026 SE LE AÑADIO UNA SALVEDAD, y solo una: cuando esas modalidades
// venden DOS con la presentacion prestada. El dueño sento un producto en el
// basico y otro en el full y los dos comodines le salian con el mismo nombre.
// Lo que esta prueba protege NO cambia —con un solo producto, los dos nombres
// son el— y se comprueba aparte en `prueba-cada-comodin-da-su-producto`.
comprobar(
  "en Lineal y Upsell los dos nombres son el unico",
  // Igual que arriba: los DOS nombres siguen siendo el unico. Solo cambio la tercera
  // linea, la del complementario sentado.
  /if \(modo === "lineal" \|\| modo === "upsell"\) \{/.test(reparto) &&
    /const elQueHaya = principal \|\| segundo;/.test(reparto) &&
    /base: elQueHaya,\s*\r?\n?\s*full: elQueHaya,\s*\r?\n?\s*complementario: elComplementoSentado\(\),/.test(
      reparto
    ),
  "ya no sale en blanco"
);
// Y LA SALVEDAD, ESCRITA: sin esto, quitarla no pondria roja ninguna prueba de
// aqui y volveria el fallo del nombre repetido.
comprobar(
  // Y DESDE EL 24/09 LA SALVEDAD PREGUNTA A LA TABLA, NO A UNA POSICION FIJA.
  //
  // «Como -OB-» pone delante el producto VISIBLE, para no destapar el full en la
  // primera pregunta. Con el reparto fijo de antes —«el caro en el hueco 1»— los
  // dos comodines salian CRUZADOS. Lo que esta comprobacion protege no cambia:
  // que la salvedad siga escrita y que cada comodin de el suyo.
  "salvo cuando de verdad vende dos",
  // El hueco es mas ancho que antes: en medio entro el comentario largo que explica
  // por que el complementario sentado si se nombra.
  /segundaOpcionPrestada\(cfg\) && principal && segundo\)\s*\{[\s\S]{0,2600}?tablaDeHuecos\(modo, cfg\)[\s\S]{0,400}?base: cajaDelHueco\(tabla\.basico\)[\s\S]{0,120}?full: cajaDelHueco\(tabla\.full\)/.test(
    reparto
  ),
  "cada comodin el suyo"
);

// ── 2. El visor calcula lo mismo ───────────────────────────────────────────
comprobar(
  "el visor reparte igual que el motor",
  /nombreBase: esOrderBump\s*\r?\n?\s*\? alineados\.productName\s*\r?\n?\s*: unSoloProducto\s*\r?\n?\s*\? alineados\.productName\s*\r?\n?\s*: alineados\.product2Name,/.test(
    editor
  ) &&
    /nombreFull: esOrderBump\s*\r?\n?\s*\? \(alineados\.full \?\? c\.order_bump\?\.combo\?\.name\)\s*\r?\n?\s*: alineados\.productName,/.test(
      editor
    ) &&
    // El visor sigue siendo espejo del motor, y por eso esta linea cambio CON el:
    // en Order Bump lee su caja, y fuera de ahi el complementario SENTADO en vez de
    // un "" fijo. Si solo cambiara uno de los dos, el visor mentiria — que es lo que
    // esta comprobacion existe para impedir.
    /nombreComplementario: esOrderBump\s*\r?\n?\s*\? alineados\.product2Name\s*\r?\n?\s*: \(alineados\.complementario \?\? ""\),/.test(
      editor
    ),
  "espejo"
);
// Y EL VISOR MIRA QUIEN JUEGA CADA PUESTO, no el cajon crudo.
//
// El editor lee la configuracion tal cual esta guardada; el reparto lo hace el
// motor al leerla. Sin esto, un producto puesto en un puesto se enviaba bien al
// cliente y en la pantalla seguia saliendo el nombre viejo del cajon. Enseñar
// una cosa y mandar otra es lo peor que puede hacer un visor: no parece roto,
// parece que el reparto no funciono.
comprobar(
  "el visor enseña el producto que juega, no el del cajón",
  /const alineados = \(\(\) => \{/.test(editor) &&
    /const alin = c\.alineacion_por_modalidad\?\.\[previewMode\] \?\? \{\};/.test(
      editor
    ),
  "lo que va a salir"
);
comprobar(
  "y si nadie juega ese puesto, se cae al cajón",
  /\?\? c\.product_name,/.test(editor) && /\?\? c\.upsell\?\.name,/.test(editor),
  "como hará el bot"
);
// EL VISOR Y EL MOTOR, LA MISMA REGLA — y el 23/09/2026 les cambio la misma
// salvedad a la vez. Si se separan, el visor enseña una cosa y el bot manda
// otra: se comprueba que los dos miren el DATO y no el nombre de la modalidad.
comprobar(
  "y el visor también sabe cuándo hay uno solo",
  /previewMode === "lineal" \|\| previewMode === "upsell"/.test(editor) &&
    /const unSoloProducto =[\s\S]{0,200}?segundaOpcionPrestada\(c\)/.test(editor),
  "misma regla"
);
comprobar(
  "y los usa al resolver, no un campo fijo",
  /\(producto_base\|producto_basico\)\s*\\s\*\\\}\\\}\/gi,\s*\r?\n?\s*literal\(nombreBase\)/.test(
    editor
  ) && /producto_full\\s\*\\\}\\\}\/gi, literal\(nombreFull\)\)/.test(editor),
  "nombreBase / nombreFull"
);

// ── 3. El complementario, solo donde existe ────────────────────────────────
for (const [donde, texto] of [
  ["el motor", motor],
  ["el visor", editor],
]) {
  comprobar(
    `${donde} separa el complementario del segundo producto`,
    /\(producto_complementario\|producto_complemento\|complemento\)/.test(texto) &&
      !/producto_secundario\|producto_base\|producto_complementario/.test(texto),
    "grupo propio"
  );
}
comprobar(
  // ESTA REGLA SE ACOTO EL 01/10/2026, Y ES EL UNICO CAMBIO DE INTENCION DE TODO
  // ESTE ARCHIVO. Lo pidio el dueño: «yo se que no se vende, pero tiene que
  // representarse en el visor y en la entrega del cliente».
  //
  // LO QUE PROTEGIA SIGUE EN PIE: no se nombra un producto que quedo en una CAJA de
  // otra venta. Esa caja es `product_name_2`, y fuera de Order Bump guarda el
  // producto de otra modalidad — nombrarla era el fallo.
  //
  // LO QUE CAMBIA: con el almacen hay un ASIENTO de complementario en la alineacion,
  // y lo que esta sentado ahi lo puso el a mano para esta venta. Eso si se nombra.
  // O sea: no se nombra el resto de una caja, pero si una eleccion.
  //
  // Medido antes de tocarlo: en su configuracion solo lineal tiene uno sentado, asi
  // que Order Bump y Doble Oferta + Upsell no se mueven.
  // El 02/10/2026 esta funcion dejo de armar la alineacion por su cuenta y paso a
  // preguntar a `laAlineacionQueJuega`, que es ahora el unico sitio donde vive esa regla.
  // Lo que se comprueba no cambia: que se nombre lo SENTADO y nunca un resto.
  "fuera de Order Bump se nombra el complementario SENTADO, no la caja",
  /const elComplementoSentado = \(\): string => \{/.test(motor) &&
    /const id = String\(laAlineacionQueJuega\(cfg, modo\)\?\.complementario \?\? ""\)\.trim\(\);/.test(
      motor
    ) &&
    /if \(!id\) return "";/.test(motor),
  "una eleccion si, un resto no"
);
comprobar(
  // Ofrecerlo donde no hace nada es mandar a usar una herramienta rota.
  "el selector solo lo ofrece en Order Bump",
  /mode === "order_bump"[\s\S]{0,180}new Set\(\["\{\{PRODUCTO\}\}", "\{\{PRODUCTO_SECUNDARIO\}\}"\]\)/.test(
    editor
  ) &&
    /"\{\{PRODUCTO_COMPLEMENTARIO\}\}",\s*\r?\n\s*\]\)/.test(editor),
  "escondido en las demas"
);
comprobar(
  "y esta en el catalogo con su explicacion",
  /token: "\{\{PRODUCTO_COMPLEMENTARIO\}\}"/.test(editor) &&
    /Solo en Order Bump: el producto que se SUMA al b/.test(editor),
  "en la lista"
);

// ── 4. Lo de siempre, intacto ──────────────────────────────────────────────
comprobar(
  "{{PRODUCTO_SECUNDARIO}} sigue dando el segundo producto",
  /\(producto_secundario\|producto2\)\s*\\s\*\\\}\{1,2\}\/gi,\s*\r?\n\s*literal\(getProductName2\(\)\)/.test(
    motor
  ),
  "125 textos a salvo"
);
comprobar(
  "{{PRODUCTO}} sigue dando el principal",
  /producto\\s\*\\\}\{1,2\}\/gi, literal\(getProductName\(\)\)\)/.test(motor),
  "intacto"
);

// ── 4-bis. Cada producto y SU precio se llaman igual ───────────────────────
//
// El producto se llamaba "complementario" y su precio "diferencia": al escribir
// habia que acordarse de que no se emparejaban. Ahora el par se escribe igual,
// como {{PRODUCTO_BASE}}/{{PRECIO_BASE}} y {{PRODUCTO_FULL}}/{{PRECIO_FULL}}.
for (const [donde, texto] of [
  ["el motor", motor],
  ["el visor", editor],
]) {
  comprobar(
    `${donde} resuelve el precio del complementario`,
    /\(precio_complementario\|precio_diferencia\|precio_extra_completo\)/.test(texto),
    "empatado con su producto"
  );
}
comprobar(
  // Es la diferencia entre las dos opciones: donde no hay dos, no hay nada que
  // restar. Ofrecerlo alli seria mandar a usar algo que sale en blanco.
  "y solo se ofrece donde hay dos opciones",
  /PRECIO_DIFERENCIA\|PRECIO_COMPLEMENTARIO\)/.test(editor),
  "en los dos filtros"
);
comprobar(
  "{{PRECIO_DIFERENCIA}} sigue funcionando, retirado de la lista",
  /token: "\{\{PRECIO_DIFERENCIA\}\}",\s*\r?\n\s*oculto: true,/.test(editor),
  "los textos viejos a salvo"
);

// ── 4-ter. Los mismos campos de precio en las dos modalidades ──────────────
//
// En Precios y pagos, Doble Oferta + Upsell tenia «Precio producto full», su
// descuento y su «antes», y el boton May/Min/Off. Order Bump tenia dos campos
// llamados «Combo: precio normal/descuento», sin boton y SIN el «antes» —el
// dato existia y lo usaba el bot, pero no habia donde escribirlo. Al full se le
// ponia el «antes» del basico y su descuento parecia mas chico de lo que es.
const CAMPOS_DE_PRECIO = [
  ["el precio del base", "`Precio producto base (${country.currency})`"],
  ["su descuento", "`Precio producto base — descuento (${country.currency})`"],
  ["el precio del full", "`Precio producto full (${country.currency})`"],
  ["su descuento", "`Precio producto full — descuento (${country.currency})`"],
  ["el «antes» del full", "`Precio anterior del full (${country.currency})`"],
];
for (const [que, etiqueta] of CAMPOS_DE_PRECIO) {
  comprobar(
    `${que} se llama igual en las dos`,
    editor.includes(etiqueta),
    etiqueta.slice(1, 40)
  );
}
comprobar(
  // Sin el, el full es el unico precio cuya moneda no se puede elegir.
  "el full de Order Bump tiene su boton de moneda",
  /combo_price_label_case: v,\s*\r?\n\s*\},\s*\r?\n\s*\}\),\s*\r?\n\s*ejemplo:/.test(
    editor
  ),
  "May / Min / Off"
);
comprobar(
  "y su «antes» se guarda de verdad",
  /combo_market_price: v > 0 \? v : undefined,/.test(editor),
  "combo_market_price"
);
comprobar(
  // Order Bump vende DOS productos: ofrecerle el precio de un tercero seria
  // pedirle un dato que su embudo no usa.
  "el precio del tercer producto sigue siendo solo de quien lo tiene",
  /layerMode === "doble_oferta_upsell"/.test(editor),
  "sin campos de mas"
);

// ── 5. Los rotulos dicen el papel, no el numero ────────────────────────────
// LOS ROTULOS SALEN DEL PUESTO, no se escriben a mano en cada modalidad. Antes
// cada cajon tenia su titulo propio y el mismo campo se llamaba «Producto 1» en
// una modalidad y «PRODUCTO BÁSICO» en otra: habia que traducirlo de cabeza al
// cambiar, y traduciendo mal se llena el cajon equivocado. Cuatro nombres y ni
// uno mas, iguales en las seis.
const ROTULOS = [
  ["el basico", 'nombre: "Producto básico"'],
  ["el complementario", 'nombre: "Producto complementario"'],
  ["el full", 'nombre: "Producto full"'],
  ["el upsell", 'nombre: "Producto upsell"'],
];
for (const [que, marca] of ROTULOS) {
  comprobar(`${que} lleva su nombre`, editor.includes(marca), marca.slice(0, 34));
}
comprobar(
  "y el cajón lo saca del puesto, no de la modalidad",
  /function rotuloDelPuesto\(/.test(editor) &&
    /title=\{rotuloDelPuesto\(puestoDelCajonDeContenido\(contentMode, 1\)\)\}/.test(
      editor
    ),
  "un solo sitio"
);
// «PRODUCTO 1», «PRODUCTO 2» Y «ÚNICO» NO VUELVEN. Eran nombres del archivo, no
// papeles, y mezclarlos con los papeles es lo que confundia.
comprobar(
  "ya no quedan nombres de archivo como rótulo",
  !/"📚 Producto 1/.test(editor) &&
    !/"📦 Producto 2"/.test(editor) &&
    !/nombre: "Único"/.test(editor),
  "sin traducciones"
);
comprobar(
  "la opción conjunta se llama FULL",
  editor.includes('title="📦 FULL (opción conjunta)"'),
  "no «pack»"
);
comprobar(
  // Renombrar el cajon y dejar los avisos con el nombre viejo manda al operario
  // a buscar algo que ya no se llama asi.
  "ningun aviso manda al rotulo viejo",
  !/Order Bump → Opción 1 Combo|Order Bump → Opción 2 Básico/.test(editor),
  "todos actualizados"
);

// ── 6. El basico entra primero en pantalla ─────────────────────────────────
comprobar(
  "en Doble Oferta + Upsell el basico va arriba del full",
  /if \(isDobleOfertaUpsell\) \{\s*\r?\n\s*return \(\s*\r?\n\s*<>\s*\r?\n\s*\{cajonSegundo\}\s*\r?\n\s*\{cajonPrincipal\}/.test(
    editor
  ),
  "primero por donde entra el cliente"
);
comprobar(
  "en Order Bump el complementario cuelga del basico",
  /if \(isOrderBumpContent\) \{[\s\S]{0,420}relative ml-10[\s\S]{0,320}\{cajonSegundo\}/.test(
    editor
  ),
  "sangrado y mas corto"
);

console.log(
  fallos === 0
    ? "\nTODO OK — un comodin por papel, y cada modalidad da el suyo"
    : `\n${fallos} FALLA(S)`
);
process.exit(fallos === 0 ? 0 : 1);
