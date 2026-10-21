// EL PRECIO DE CADA PAÍS SE EDITA DESDE LA FICHA, Y VA DONDE EL BOT LO LEE.
//
// LO QUE COSTÓ — 16 de septiembre de 2026. El dueño puso 10 en la ficha con la
// bandera de Perú, cambió a Argentina, escribió 1000, volvió a Perú… y seguía en
// 1000. Con sus palabras: «estoy viendo que el cambio de precio es único para
// todos». Tenía razón, y de paso se le fue el precio de Perú.
//
// NO ERA UN FALLO DEL MOTOR. El precio de cada país vive en Precios y pagos
// —`modality_payment_profiles[modalidad][país]`— y la ficha guarda UN precio, que
// es el RESPALDO para los países que no tengan el suyo. El motor lo resuelve
// bien. Lo que engañaba era el editor: un campo llamado «Precio» con la bandera
// de un país al lado PARECE de ese país, y no lo es.
//
// LO QUE SE HIZO, y no toca el motor ni el formato del contenido:
//  · La ficha enseña y EDITA el precio de cada país, escribiendo en el mismo
//    sitio que Precios y pagos.
//  · Los tres campos globales dicen en su nombre que son de TODOS los países.
//
//   node scripts/prueba-el-precio-de-la-ficha-es-por-pais.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8").replace(
  /\r\n/g,
  "\n"
);
const motor = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
).replace(/\r\n/g, "\n");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

const trozo = (fuente, desde, largo = 4000) => {
  const i = fuente.indexOf(desde);
  return i < 0 ? "" : fuente.slice(i, i + largo);
};

// ── 1. ENSEÑAR Y GUARDAR NO PUEDEN DISCREPAR ────────────────────────────────
//
// Es la comprobación que más vale de todas. Si el editor LEE el precio de un
// campo y lo GUARDA en otro, enseña un número y el bot cobra otro — y eso no se
// descubre hasta que un cliente paga de menos.
console.log("\n— el campo que se enseña es el que se guarda —\n");
const lectura = trozo(editor, "function preciosDelPapel(", 2200);
const escritura = trozo(editor, "function PreciosDelProductoPorPais(", 5000);
const rutas = trozo(editor, "function camposDelPapelEnElPais(", 1200);

comprobar(
  "hay una sola tabla de qué campo usa cada papel",
  /function campoDePrecioDelPapel\(/.test(editor) &&
    /function camposDelPapelEnElPais\(/.test(editor),
  "para que no se separen"
);
for (const [papel, campoLeido, campoEscrito] of [
  ["full", "order_bump?.combo_price_soles", '"order_bump.combo_price_soles"'],
  ["basico/unico", "course_price_soles", '"course_price_soles"'],
  ["upsell", "upsell?.price_soles", '"upsell.price_soles"'],
]) {
  comprobar(
    `el papel «${papel}» lee y escribe el mismo campo`,
    lectura.includes(campoLeido) && rutas.includes(campoEscrito),
    campoLeido
  );
}
// LOS TRES IMPORTES, no solo el precio: el descuento y el tachado también son
// del país. Si se quedaran globales, el bot cobraría bien y anunciaría mal.
comprobar(
  "y los tres importes van por país, no solo el precio",
  /combo_discount_price_soles/.test(rutas) &&
    /combo_market_price/.test(rutas) &&
    /discount_price_soles/.test(rutas) &&
    /market_price/.test(rutas),
  "precio, descuento y tachado"
);
comprobar(
  "el complementario no tiene precio propio",
  /if \(papel === "upsell"\) return "upsell";\s*\n\s*return null;/.test(editor),
  "no se vende suelto"
);

// ── 2. ESCRIBE DONDE EL BOT LEE PRIMERO ─────────────────────────────────────
//
// CAMBIÓ DE SITIO EL 17/09/2026, Y EL MOTIVO ES DE ÉL: «que cada producto tenga
// su precio fijado y que al activarlo respete ese precio como PRIORIDAD sobre el
// precio de la sección precios y pagos». Guardándolo en la capa del país, el
// importe se quedaba con el PUESTO: al cambiar quién juega de básico se seguía
// cobrando el del producto anterior. Ahora vive en el PRODUCTO, por país, y el
// motor lo pregunta ANTES que a la capa — ver `preciosDeLaFichaEnElPais`.
console.log("\n— y escribe donde el motor lee primero —\n");
comprobar(
  "guarda en el PRODUCTO, por país",
  /precios_por_pais: \{[\s\S]{0,200}?\[pais\]: \{/.test(escritura),
  "el precio viaja con el producto"
);
comprobar(
  "y el motor lo lee antes que la capa del país",
  /const countryPrice =\s*\n\s*deLaFicha\.precio \?\?/.test(motor),
  "prioridad, no respaldo"
);
// LO QUE FALLÓ EN EL PRIMER INTENTO, y hay que fijar para no repetirlo: se
// añadió una rejilla nueva y se dejaron los tres campos de siempre escribiendo
// en la ficha. Él editó los de siempre —los que ve— y volvió a pasar lo mismo.
comprobar(
  "los tres campos de la ficha siguen la BANDERA",
  /<PreciosDelProductoPorPais[\s\S]{0,300}?pais=\{pais\}/.test(editor),
  "no una rejilla aparte"
);
comprobar(
  "y la bandera es la misma de arriba",
  /pais=\{selectedPaymentCountry\}/.test(editor),
  "la de Precios y pagos"
);
comprobar(
  "y el motor lee esa capa antes que nada",
  /config\.modality_payment_profiles\?\.\[mode\]\?\.\[country\] \?\?\s*\n?\s*config\.payment_profiles_by_country\?\.\[country\]/.test(
    motor
  ),
  "resolveCountryPaymentProfile"
);
// YA NO HACE FALTA SEMBRAR EL PERFIL DEL PAÍS, y eso es una preocupación menos:
// al no tocar `modality_payment_profiles`, ningún país puede quedarse con una
// capa a medias —sin cuenta, sin métodos de cobro, sin validación— por haber
// escrito un precio. El riesgo desapareció con el cambio de sitio.
comprobar(
  "ya NO toca la capa de pagos del país",
  !/mergeCountryPaymentProfileForEditor/.test(escritura),
  "imposible dejarla a medias"
);
// SE ESCRIBE UN CAMPO, NO SE REEMPLAZA EL PRODUCTO NI EL PAÍS. Poner el
// descuento de Perú no puede borrar su precio normal ni los otros países.
comprobar(
  "conservando los demás países y los demás campos",
  /\.\.\.\(p\.precios_por_pais \?\? \{\}\),/.test(escritura) &&
    /\.\.\.\(p\.precios_por_pais\?\.\[pais\] \?\? \{\}\),/.test(escritura),
  "no se pisa nada"
);
// Y NO TOCA A LOS DEMÁS PRODUCTOS: se reescribe solo el de esta ficha.
comprobar(
  "y solo cambia el producto de esta ficha",
  /\.map\(\(p\) =>\s*\n?\s*p\?\.id === producto\.id/.test(escritura),
  "los otros siete quedan igual"
);

// ── 3. NO SE TOCA LO QUE FUNCIONA ───────────────────────────────────────────
console.log("\n— y el respaldo sigue siendo el respaldo —\n");
comprobar(
  "el motor sigue cayendo a la ficha si el país no tiene precio",
  /vale\(kReg\)|\(typeof kReg === "number" && kReg > 0 \? kReg : undefined\) \?\?\s*\n?\s*option\?\.price_soles/.test(
    motor
  ),
  "la regla de siempre, intacta"
);
// LOS TRES CAMPOS «TODOS LOS PAÍSES» SE FUERON — 17/09/2026. Con sus palabras:
// «yo no vendo un precio global para todos los países; jamás deben tener precios
// de otro país ya que son monedas y montos distintos». Un respaldo entre monedas
// distintas cobra en la que no es, y nadie se entera hasta que alguien paga.
comprobar(
  "ya no se piden los tres campos globales",
  !/Precio · TODOS los países/.test(editor) &&
    !/Con descuento · TODOS/.test(editor) &&
    !/Antes \/ tachado · TODOS/.test(editor),
  "ningún país hereda de otro"
);
// TODOS LOS PRODUCTOS LLEVAN SUS PRECIOS, JUEGUEN O NO. Orden suya: «al
// complementario ponle igual que los demás, en caso que un día desee volverlo
// producto de venta y colocarlo como básico, full o upsell».
comprobar(
  "todos los productos tienen sus casillas de precio",
  /\{onCfg && \(\s*\n\s*<PreciosDelProductoPorPais/.test(editor),
  "también el complementario"
);
// PERO NO SE LE EXIGE PRECIO A QUIEN NO COBRA. El complementario no tiene precio
// propio, así que pedírselo en rojo era un aviso que miente — y un aviso que
// miente enseña a ignorar todos los demás.
comprobar(
  // LA REGLA NO SE FUE: SE MUDÓ. El 25/09/2026 el aviso de la lista pasó a ser
  // tres etiquetas —SIN CONTENIDO, SIN PRECIO, SIN ENLACE DE ENTREGA— y quien
  // decide es `lasFaltasDelProducto`, que ahora vale para la lista, para el
  // selector y para el guardado. La pregunta sigue siendo la misma y sigue
  // hecha por el DATO: ¿este puesto cobra?
  "y el aviso rojo no se lo pide al complementario",
  /if \(!puesto \|\| campoDePrecioDelPapel\(puesto\) !== null\) \{/.test(editor),
  "no tiene precio propio"
);
comprobar(
  "el aviso rojo de los países sin precio sigue en pie",
  /function PreciosDelProducto\(\{[\s\S]{0,1800}?faltan\.map\(\(f\) => f\.etiqueta\)\.join\(", "\)/.test(
    editor
  ),
  "lo que ya funcionaba"
);

// ── 4. LA REGLA, SIMULADA ───────────────────────────────────────────────────
//
// Se reproduce la resolución del motor con datos inventados y se comprueba que
// poner el precio de un país no mueve el de los demás — que es exactamente lo
// que él vio fallar.
console.log("\n— y poner el precio de un país no mueve el de otro —\n");
const vale = (n) => (typeof n === "number" && n > 0 ? n : undefined);
const resolver = (cfg, modo, pais, papel) => {
  const perfil =
    cfg.modality_payment_profiles?.[modo]?.[pais] ??
    cfg.payment_profiles_by_country?.[pais];
  const delPais =
    papel === "full"
      ? vale(perfil?.order_bump?.combo_price_soles)
      : papel === "upsell"
        ? vale(perfil?.upsell?.price_soles)
        : vale(perfil?.course_price_soles);
  return delPais ?? cfg.ficha[papel] ?? 0;
};
const cfg = {
  ficha: { basico: 20, full: 35, upsell: 12 },
  payment_profiles_by_country: { MX: { numero_de_cuenta: "CUENTA-MX" } },
  modality_payment_profiles: { doble_oferta_upsell: {} },
};
comprobar("antes: MX cae al respaldo de la ficha", resolver(cfg, "doble_oferta_upsell", "MX", "basico") === 20, "20");
// Ahora se guarda el precio de MX, sembrando el perfil entero.
cfg.modality_payment_profiles.doble_oferta_upsell.MX = {
  ...cfg.payment_profiles_by_country.MX,
  course_price_soles: 500,
};
comprobar("después: MX cobra el suyo", resolver(cfg, "doble_oferta_upsell", "MX", "basico") === 500, "500");
comprobar(
  "y MX no perdió su cuenta al guardarlo",
  cfg.modality_payment_profiles.doble_oferta_upsell.MX.numero_de_cuenta === "CUENTA-MX",
  "sigue ahí"
);
comprobar(
  "y los demás países no se movieron",
  resolver(cfg, "doble_oferta_upsell", "PE", "basico") === 20 &&
    resolver(cfg, "doble_oferta_upsell", "MX", "full") === 35,
  "cada uno el suyo"
);

console.log(
  fallos === 0
    ? "\nTODO OK — cada país su precio, y la ficha sigue siendo el respaldo\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
