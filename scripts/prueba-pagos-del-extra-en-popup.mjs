// Las respuestas de pago del tercer producto se editan en UN solo sitio.
//
// PRIMERO estaban arriba del todo de la pestana Upsell, en un bloque amarillo
// con tres editores de burbujas abiertos, ocupando media pantalla.
//
// DESPUES pasaron a una ventana con un boton, que es como quedo un tiempo.
//
// AHORA viven donde vive su precio: en Precios y pagos, dentro de la ventana de
// este producto. Y la ventana de la pestana Upsell SE QUITO, porque las dos
// escribian en el MISMO campo: dos formularios para un solo dato terminan
// divergiendo, y ademas aquella plantaba tres cajones fijos —«Forma 1», «Forma
// 2», «Forma 3», atados a yape/bcp/efectivo— que en una plantilla que se
// instala para otros negocios no significan nada.
//
// LO QUE VIGILA ESTA PRUEBA
//
//   1. No queda ningun segundo editor de lo mismo.
//   2. La pestana Upsell dice donde estan, y si hay alguna escrita.
//   3. El aviso que vivia en aquella ventana no se perdio: escribir aqui la
//      cuenta la deja en DOS sitios, y el dia que se cambie en uno el otro
//      sigue mandando el viejo — sin error y sin aviso.
//   4. Lo guardado no cambia: mismo campo, misma forma.
//
//   node scripts/prueba-pagos-del-extra-en-popup.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(
  join(RAIZ, "src", "app", "editor", "page.tsx"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. Ni un segundo editor, ni un trío fijo ─────────────────────────────────
comprobar(
  "ya no está el bloque abierto arriba",
  !/Respuestas al confirmar el método de pago del tercer producto/.test(editor),
  "quitado"
);
comprobar(
  "ni la ventana que lo repetía",
  !/pagosDelExtraAbiertos/.test(editor) &&
    !/💳 Respuestas de pago propias de este producto/.test(editor),
  "un solo formulario"
);
// ESTO es lo que se colaba: tres cajones fijos con nombres de metodos que este
// bot no tiene por que conocer.
// Se mira lo que era SUYO —`upsell_pay_…`—, no cualquier trio del editor: las
// dos opciones del Order Bump tienen el suyo, con claves fijas por su tipo, y
// ese es otro asunto.
comprobar(
  "y ningún trío de métodos escrito a mano para el extra",
  !/idPrefix=\{`upsell_pay_\$\{method\}`\}/.test(editor),
  "los métodos son los suyos"
);

// ── 2. La pestaña Upsell dice dónde están ────────────────────────────────────
//
// Quitar la ventana sin decir a donde fueron seria esconderlas.
comprobar(
  "la pestaña Upsell dice dónde se escriben",
  /se escribe\s*\r?\n\s*en <strong>Precios y pagos<\/strong>, dentro de la ventana/.test(
    editor
  ),
  "no las esconde"
);
comprobar(
  "y si hay alguna escrita, lo avisa",
  /Hay \{escritas\} escrita/.test(editor) &&
    /tapa/.test(editor),
  "sin abrir nada"
);
// Una burbuja apagada o en blanco no cuenta como escrita: diria que hay algo
// donde no hay nada.
comprobar(
  "no cuenta las vacías ni las apagadas",
  /paso\.enabled !== false &&\s*\r?\n\s*\(paso\.texts\.some\(\(t\) => t\.trim\(\)\) \|\|\s*\r?\n\s*paso\.drive_url\.trim\(\)\)/.test(
    editor
  ),
  "sí"
);

// ── 3. El aviso del número de cuenta en dos sitios no se perdió ──────────────
comprobar(
  "avisa del riesgo de escribir aquí la cuenta",
  /queda en dos sitios: aquí y en\s*\r?\n\s*los datos de pago de siempre\. El día que lo cambies en uno, el otro\s*\r?\n\s*sigue mandando el viejo\./.test(
    editor
  ),
  "en ámbar"
);
// Y solo cuando hay alguna: con ninguna escrita no hay ningun riesgo que avisar,
// y el aviso seria ruido.
comprobar(
  "y solo cuando ya hay alguna",
  /\{creadas\.length === 0 \? \(/.test(editor),
  "sin ruido de más"
);

// ── 4. Lo guardado sigue igual ───────────────────────────────────────────────
comprobar(
  "mismo campo y misma forma",
  /upsell: \{ \.\.\.\(cfg\.upsell \?\? \{\}\), payment_responses: siguiente \}/.test(
    editor
  ),
  "intacto"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
