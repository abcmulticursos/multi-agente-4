// Un solo link "Elegir producto", con el producto al lado.
//
// ANTES
//
// El menú de links de un cuadrito tenía dos líneas sueltas —"Elegir el producto
// BÁSICO" y "Elegir el producto FULL"— y el segundo producto no estaba. Para
// mandarlo no había link: solo comodines, que pegan el precio pero no dejan
// anotado qué eligió el cliente.
//
// AHORA
//
// Una línea, "Elegir producto", y al lado un selector con los TRES: BÁSICO,
// FULL y UPSELL. Los mismos nombres que los cajones de entrega, para no tener
// que traducir de un sitio al otro.
//
// LO QUE NO CAMBIA
//
// Lo guardado sigue siendo choose_basico / choose_combo / choose_upsell. La
// agrupación es solo cómo se ve: un cuadrito de antes se abre como "Elegir
// producto" + FULL, sin tocar nada.
//
// EL CUIDADO
//
// El segundo producto NO pasa por el camino de los otros dos. Ese apunta
// order_bump_choice, que es de la primera oferta: usarlo aquí dejaría al bot
// cobrando el precio del primero y entregando lo que ya vendió. Va por el suyo,
// y solo si la modalidad lo tiene con nombre, precio y entrega.
//
//   node scripts/prueba-elegir-producto.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const config = leer("src", "lib", "workflow", "config.ts");
const engine = leer("src", "lib", "workflow", "engine.ts");
const api = leer("src", "app", "api", "workflow", "route.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. La acción existe en los tres sitios ──────────────────────────────────
//
// Los tres tienen su propia copia del tipo. Si a uno le falta, el link se
// guarda en un lado y se pierde en otro.
comprobar(
  "el motor conoce el link del segundo producto",
  /\| "choose_upsell"/.test(config),
  "sí"
);
comprobar(
  "y el guardado también",
  /\| "choose_upsell"/.test(api),
  "sí"
);
comprobar(
  "y el editor",
  /\| "choose_upsell"/.test(editor),
  "sí"
);
comprobar(
  // ESTE es el que se olvida. La lista es el filtro del guardado: lo que no
  // esté aquí se descarta sin decir nada y el cuadrito reaparece sin link.
  "está en la lista que deja pasar el guardado",
  /const LINKS_DE_DECISION: DecisionAction\[\] = \[[^\]]*"choose_upsell"/s.test(
    api
  ),
  "pasa"
);

// ── 2. El segundo producto va por su camino, no por el de los otros dos ─────
const caso = engine.match(
  /case "choose_upsell": \{[\s\S]*?\n {4}\}/
)?.[0] ?? "";
comprobar(
  "el segundo producto tiene su propio caso",
  caso.length > 0,
  "sí"
);
comprobar(
  // Si esto fallara, el bot cobraría el precio del primer producto y entregaría
  // lo que el cliente YA compró.
  "no pasa por el camino de la primera oferta",
  // Se mira solo el código: el nombre aparece a propósito en el comentario que
  // explica por qué NO se usa aquí.
  caso.length > 0 &&
    !caso
      .split(/\r?\n/)
      .filter((linea) => !linea.trim().startsWith("//"))
      .join("\n")
      .includes("deliverOrderBumpResponse("),
  "aparte"
);
comprobar(
  // Con lo que su cuadrito YA dijo: si ese texto llevaba la cuenta, solo se
  // anota la aceptacion y no se manda ninguna burbuja de fabrica encima.
  "manda los datos de pago del segundo",
  /await entregarDatosDePagoDelUpsell\(convo, \{\s*\r?\n\s*enviarDatos: !yaDioLosDatos,/.test(
    caso
  ),
  "sí"
);
comprobar(
  // Mandar datos de pago de algo que no se puede entregar es cobrar y quedar
  // mal. La comprobación es la misma que usa la oferta automática.
  "y antes comprueba que se pueda cerrar la venta",
  /if \(!isUpsellUsable\(cfgExtra\)\) \{/.test(caso) &&
    /return false;/.test(caso),
  "nombre, precio y entrega"
);
comprobar(
  "si no se puede, queda escrito en el registro",
  /console\.warn\(/.test(caso),
  "avisa"
);
comprobar(
  "y los otros dos productos siguen igual",
  /const cual = accion === "choose_combo" \? "combo" : "basico";/.test(engine) &&
    /await deliverOrderBumpResponse\(convo, cual, \{/.test(engine),
  "intacto"
);

// ── 3. El menú: una línea, no dos ───────────────────────────────────────────
comprobar(
  "el menú tiene una sola línea para elegir producto",
  /\{ valor: "choose_product", texto: "Elegir producto" \}/.test(editor),
  "una"
);
comprobar(
  "ya no hay un link suelto por producto",
  !/texto: "Elegir el producto BÁSICO"/.test(editor) &&
    !/texto: "Elegir el producto FULL"/.test(editor),
  "quitados"
);
comprobar(
  // Los mismos nombres que los cajones de entrega. Cuando no coincidían, llenar
  // el cajón equivocado costaba entregar el producto que no era.
  "el selector trae los tres con el nombre de su cajón",
  /\{ valor: "choose_basico", texto: "BÁSICO" \}/.test(editor) &&
    /\{ valor: "choose_combo", texto: "FULL" \}/.test(editor) &&
    /\{ valor: "choose_upsell", texto: "UPSELL \(el segundo producto\)" \}/.test(
      editor
    ),
  "BÁSICO, FULL, UPSELL"
);
comprobar(
  "el selector solo sale al elegir producto",
  /\{link === "choose_product" && \(/.test(editor),
  "sí"
);

// ── 4. Lo guardado no cambia de forma ───────────────────────────────────────
//
// "choose_product" es solo el nombre de la familia en el menú. Si llegara a
// guardarse tal cual, el motor no lo reconocería y el cuadrito no haría nada.
comprobar(
  "al guardar se escribe el producto, no la familia",
  /action:\s*\r?\n?\s*link === "choose_product"\s*\r?\n?\s*\? producto/.test(
    editor
  ),
  "choose_basico/combo/upsell"
);
comprobar(
  "y al reabrir, un cuadrito de antes se enseña agrupado",
  /esElegirProducto\(decision\.action\) \? "choose_product" :/.test(editor),
  "sin tocar nada"
);
comprobar(
  "con su producto ya marcado",
  /esElegirProducto\(decision\.action\)\s*\r?\n\s*\? \(decision\.action as DecisionAction\)/.test(
    editor
  ),
  "sí"
);

// ── 5. Se avisa donde el segundo producto no existe ─────────────────────────
comprobar(
  // Cada modalidad se sirve de lo suyo. Ofrecer un link que en Lineal u Order
  // Bump no hace nada, sin decirlo, es dejar que lo descubra un cliente.
  "avisa que el segundo producto no está en toda modalidad",
  /producto === "choose_upsell" && \(/.test(editor) &&
    /El segundo producto solo existe en las modalidades/.test(editor),
  "en amarillo"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
