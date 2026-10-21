// Copiar un producto de una modalidad a otra.
//
// Se comprueban las dos mitades, porque un cruce en cualquiera de ellas
// significa entregarle a la clienta el curso equivocado:
//
//   LEER   — que al pedir el Combo venga el Combo y no el Básico.
//   ESCRIBIR — que al mandarlo al Pack caiga en el Pack y en ninguna otra caja.
//
//   node scripts/prueba-importar.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RAIZ = process.cwd();
const TMP = join(RAIZ, "scripts", "_ti");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

// El módulo no importa nada, así que basta con quitarle los tipos.
const fuente = readFileSync(
  join(RAIZ, "src/lib/editor/importar-segundo-producto.ts"),
  "utf8"
);
writeFileSync(join(TMP, "m.ts"), fuente, "utf8");
try {
  execFileSync(
    process.execPath,
    [
      join(RAIZ, "node_modules", "typescript", "bin", "tsc"),
      join(TMP, "m.ts"),
      "--outDir",
      TMP,
      "--module",
      "esnext",
      "--target",
      "es2022",
      "--skipLibCheck",
    ],
    { stdio: "pipe" }
  );
} catch {
  // El compilador se queja de los tipos ambientales del proyecto, que aquí no
  // pintan nada. Lo que importa es que haya escrito el archivo; si no lo
  // escribió, el import de abajo falla y nos enteramos igual.
}
const {
  FUENTES_SEGUNDO_PRODUCTO,
  DESTINOS_PRODUCTO,
  destinosDeModalidad,
  leerProductoDeOrigen,
  aplicarProductoEnDestino,
} = await import(pathToFileURL(join(TMP, "m.js")).href);

// Cada texto es único y dice de dónde salió: si algo se cruza, se ve solo.
const paso = (que) => [{ type: "text", body: `ENTREGA DE ${que}` }];
const img = (que) => [{ topic: que, drive_url: `url/${que}` }];

const nuevoCfg = () => ({
  product_name: "NOMBRE LINEAL",
  payment_approved: paso("CENTRAL"),
  image_gallery: img("GALERIA-1"),
  image_gallery_2: img("GALERIA-2"),
  pack_gallery: img("GALERIA-PACK"),
  globals: { course_price_soles: 47 },
  order_bump: {
    basico: { name: "NOMBRE OB BASICO", aliases: ["ob-b"], price_soles: 30, discount_price_soles: 25, delivery: paso("OB BASICO") },
    combo: { name: "NOMBRE OB COMBO", aliases: ["ob-c"], price_soles: 60, discount_price_soles: 50, delivery: paso("OB COMBO") },
  },
  doble_oferta_dos: {
    combo: { name: "NOMBRE DD P1", aliases: [], price_soles: 70, discount_price_soles: 0, delivery: paso("DD P1") },
    basico: { name: "NOMBRE DD P2", aliases: [], price_soles: 40, discount_price_soles: 0, delivery: paso("DD P2") },
  },
  bioferta: {
    pack_price_soles: 90,
    pack_discount_price_soles: 80,
    product_a: { name: "NOMBRE BF A", aliases: [], delivery: [] },
    product_b: { name: "NOMBRE BF B", aliases: [], delivery: paso("BF B") },
    pack: { name: "NOMBRE BF PACK", aliases: [], delivery: paso("BF PACK") },
  },
  upsell: { name: "NOMBRE UPSELL", price_soles: 10, delivery: paso("UPSELL") },
});

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (nombre, condicion, detalle = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${nombre}${detalle ? `  ${detalle}` : ""}`);
};

// ---------------- LEER ----------------
console.log("LEER: de cada producto sale lo suyo\n");
const esperado = {
  "lineal:unico":            ["NOMBRE LINEAL",    47, "CENTRAL",   "GALERIA-1"],
  "order_bump:basico":       ["NOMBRE OB BASICO", 30, "OB BASICO", "GALERIA-1"],
  "order_bump:combo":        ["NOMBRE OB COMBO",  60, "OB COMBO",  "GALERIA-2"],
  // El Producto 1 de la Doble Oferta no tiene entrega propia: usa la central.
  "bioferta:a":              ["NOMBRE BF A",      47, "CENTRAL",   "GALERIA-1"],
  "bioferta:b":              ["NOMBRE BF B",      47, "BF B",      "GALERIA-2"],
  "bioferta:pack":           ["NOMBRE BF PACK",   90, "BF PACK",   "GALERIA-PACK"],
  "doble_oferta_dos:combo":  ["NOMBRE DD P1",     70, "DD P1",     "GALERIA-1"],
  "doble_oferta_dos:basico": ["NOMBRE DD P2",     40, "DD P2",     "GALERIA-2"],
};

const cfg = nuevoCfg();
for (const f of FUENTES_SEGUNDO_PRODUCTO) {
  const r = leerProductoDeOrigen(cfg, f.clave);
  const [nombre, precio, entrega, galeria] = esperado[f.clave];
  const ok =
    r.name === nombre &&
    r.price_soles === precio &&
    r.delivery[0]?.body === `ENTREGA DE ${entrega}` &&
    r.image_gallery[0]?.topic === galeria;
  comprobar(
    pad(f.etiqueta, 28),
    ok,
    `nombre=${pad(r.name, 18)} precio=${pad(r.price_soles, 4)} entrega=${pad(r.delivery[0]?.body ?? "(vacía)", 20)} galeria=${r.image_gallery[0]?.topic ?? "(vacía)"}`
  );
}

// La plantilla de la modalidad manda sobre el top-level.
const conPlantilla = {
  ...cfg,
  modality_templates: {
    order_bump: {
      order_bump: {
        basico: { name: "DESDE LA PLANTILLA", aliases: [], price_soles: 99, delivery: paso("PLANTILLA") },
        combo: cfg.order_bump.combo,
      },
      image_gallery: img("GALERIA-PLANTILLA"),
    },
  },
};
const p = leerProductoDeOrigen(conPlantilla, "order_bump:basico");
comprobar(
  pad("la plantilla manda sobre el top-level", 28),
  p.name === "DESDE LA PLANTILLA" &&
    p.price_soles === 99 &&
    p.image_gallery[0]?.topic === "GALERIA-PLANTILLA"
);

// ---------------- ESCRIBIR ----------------
console.log("\nESCRIBIR: cada destino toca SU caja y ninguna otra\n");

const traido = {
  name: "LO TRAIDO",
  aliases: ["traido"],
  price_soles: 123,
  discount_price_soles: 99,
  delivery: paso("LO TRAIDO"),
  image_gallery: img("GALERIA-TRAIDA"),
};

// Dónde debe aparecer lo traído, y dónde NO debe haber cambiado nada.
const destinos = {
  "order_bump:combo": {
    donde: (c) => c.order_bump.combo,
    galeria: (c) => c.image_gallery_2,
    conPrecio: true,
  },
  "doble_oferta_dos:basico": {
    donde: (c) => c.doble_oferta_dos.basico,
    galeria: (c) => c.image_gallery_2,
    conPrecio: true,
  },
  "bioferta:b": {
    donde: (c) => c.bioferta.product_b,
    galeria: (c) => c.image_gallery_2,
    conPrecio: false,
  },
  "bioferta:pack": {
    donde: (c) => c.bioferta.pack,
    galeria: (c) => c.pack_gallery,
    conPrecio: false, // el precio del pack vive fuera del producto
  },
  "upsell:segundo": {
    donde: (c) => c.upsell,
    galeria: (c) => c.upsell.image_gallery,
    conPrecio: true,
  },
};

/** Todas las cajas de producto, para vigilar que solo cambie la elegida. */
const foto = (c) =>
  JSON.stringify([
    c.order_bump.combo,
    c.order_bump.basico,
    c.doble_oferta_dos.combo,
    c.doble_oferta_dos.basico,
    c.bioferta.product_a,
    c.bioferta.product_b,
    c.bioferta.pack,
    c.upsell,
    c.image_gallery,
    c.image_gallery_2,
    c.pack_gallery,
    c.payment_approved,
    c.product_name,
  ]);

for (const destino of DESTINOS_PRODUCTO) {
  const antes = nuevoCfg();
  const fotoAntes = foto(antes);
  const despues = aplicarProductoEnDestino(antes, destino.clave, traido);
  const d = destinos[destino.clave];
  const caja = d.donde(despues);

  const llego =
    caja.name === "LO TRAIDO" &&
    caja.delivery[0]?.body === "ENTREGA DE LO TRAIDO" &&
    d.galeria(despues)[0]?.topic === "GALERIA-TRAIDA" &&
    (!d.conPrecio || caja.price_soles === 123);

  // El objeto de entrada no se toca.
  const noMuta = foto(antes) === fotoAntes;

  // Cuántas cajas cambiaron: la suya y su galería, nada más.
  const antesLista = JSON.parse(fotoAntes);
  const despuesLista = JSON.parse(foto(despues));
  const cambiadas = antesLista.filter(
    (v, i) => JSON.stringify(v) !== JSON.stringify(despuesLista[i])
  ).length;
  const soloLoSuyo = cambiadas <= 2;

  comprobar(
    pad(`→ ${destino.etiqueta} (${destino.modalidad})`, 46),
    llego && noMuta && soloLoSuyo,
    `cajas tocadas=${cambiadas}`
  );
  if (!llego) console.log("        no llegó bien lo copiado");
  if (!noMuta) console.log("        modificó el objeto de entrada");
  if (!soloLoSuyo) console.log("        tocó cajas que no eran la suya");
}

// El precio del pack sí se copia, pero fuera del producto.
{
  const c = aplicarProductoEnDestino(nuevoCfg(), "bioferta:pack", traido);
  comprobar(
    pad("el precio del pack cae en pack_price_soles", 46),
    c.bioferta.pack_price_soles === 123 &&
      c.bioferta.pack_discount_price_soles === 99
  );
}

// Doble Oferta comparte precio entre sus 2 productos: no debe inventarse uno.
{
  const c = aplicarProductoEnDestino(nuevoCfg(), "bioferta:b", traido);
  comprobar(
    pad("Producto 2 de Doble Oferta no recibe precio", 46),
    c.bioferta.product_b.price_soles === undefined &&
      c.globals.course_price_soles === 47
  );
}

// Los destinos que se ofrecen dependen de la modalidad que se edita.
comprobar(
  pad("Lineal no ofrece ningún destino", 46),
  destinosDeModalidad("lineal").length === 0
);
comprobar(
  pad("Doble Oferta ofrece Producto 2 y Pack", 46),
  destinosDeModalidad("bioferta").length === 2
);

// Un destino inventado no escribe nada.
comprobar(
  pad("un destino desconocido no toca nada", 46),
  aplicarProductoEnDestino(nuevoCfg(), "no:existe", traido) === null
);

rmSync(TMP, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTodos los casos correctos." : `\n${fallos} mal.`);
process.exit(fallos === 0 ? 0 : 1);
