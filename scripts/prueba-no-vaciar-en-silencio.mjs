// Un guardado no puede vaciar EN SILENCIO lo que tenia contenido.
//
// LO QUE PASO — Y FUE FEO
//
//   21:29  todo intacto
//   21:52  un guardado del editor dejo en blanco, de una vez:
//            el contenido del producto, su galeria, las marcas de «Info de
//            contenido», las dos intros, los tres seguimientos, la entrega de
//            pago aprobado, las muestras tras la intro — y la plantilla entera
//            de esa modalidad.
//
// Sin un aviso, sin un error. El editor dijo «guardado» y el trabajo ya no
// estaba. La causa fue el sistema de plantillas por modalidad: al encender otra
// modalidad se carga SU plantilla encima de la pantalla, y al guardar, esa
// plantilla vacia se escribio sobre lo vivo.
//
// POR QUE EL SEGURO VA EN EL SERVIDOR
//
// Arreglar esa causa concreta no basta: cualquier camino que deje la pantalla a
// medias —una carga a medio terminar, un navegador con la sesion vieja, un
// cambio futuro— produce el mismo desastre. Por el servidor pasan TODOS los
// guardados, y no se puede saltar con un navegador viejo.
//
// QUE HACE
//
// Compara lo guardado con lo que se pretende escribir. Si una seccion que TENIA
// contenido va a quedar VACIA, no escribe nada: devuelve 409 con la lista de lo
// que se perderia. El editor la enseña y solo reintenta si se confirma.
//
// Nunca decide por su cuenta. Solo obliga a que sea a proposito.
//
//   node scripts/prueba-no-vaciar-en-silencio.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const api = readFileSync(
  join(RAIZ, "src", "app", "api", "workflow", "route.ts"),
  "utf8"
);
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

// ── Las funciones reales, ejecutadas de verdad ──────────────────────────────
const trozo = (nombre) => {
  const desde = api.indexOf(`function ${nombre}`);
  const crlf = api.indexOf("\r\n}\r\n", desde);
  const hasta = crlf >= 0 ? crlf : api.indexOf("\n}\n", desde);
  return api.slice(desde, hasta + 5);
};
// Se conserva la CABECERA de la función: `pesoDeContenido` se llama a sí misma
// para bajar por la estructura, y sin su nombre no se encuentra.
const limpiar = (t) =>
  t
    // Los compuestos van PRIMERO: si se quitara antes `: string` a secas,
    // `: string | null` se quedaria en un `| null` suelto que no compila.
    .replace(/: string \| null/g, "")
    .replace(/: boolean/g, "")
    .replace(/: unknown/g, "")
    .replace(/: number/g, "")
    .replace(/: string\[\]/g, "")
    .replace(/: string/g, "")
    .replace(/: Record<string, unknown>/g, "")
    .replace(/<number>/g, "")
    .replace(/ as Record<string, unknown>/g, "")
    .replace(/ as object/g, "")
    // `x as { ... } | undefined` — los `: unknown` de dentro ya se fueron
    // arriba, asi que aqui se limpia la forma que queda.
    .replace(/ as \{[^}]*\}(\s*\|\s*undefined)?/g, "");

const listaFuente = api.slice(
  api.indexOf("const SECCIONES_VIGILADAS"),
  api.indexOf("];", api.indexOf("const SECCIONES_VIGILADAS")) + 2
);
const SECCIONES_VIGILADAS = new Function(
  "return " +
    listaFuente
      .replace(/^const SECCIONES_VIGILADAS[^=]*=\s*/, "")
      .replace(/;$/, "")
)();

const pesoDeContenido = new Function(
  "return " + limpiar(trozo("pesoDeContenido"))
)();
// El aviso dejo de mirar solo «antes contra despues»: antes de dar por perdida
// una seccion mira si sigue guardada en la capa de quien la tenia. Esos dos
// ayudantes van con el, o la funcion se queda sin ellos al extraerla.
const CLAVE_EN_LA_CAPA = new Function(
  "return " +
    limpiar(
      api.slice(
        api.indexOf("const CLAVE_EN_LA_CAPA"),
        api.indexOf("};", api.indexOf("const CLAVE_EN_LA_CAPA")) + 2
      )
    )
      .replace(/^const CLAVE_EN_LA_CAPA[^=]*=\s*/, "")
      .replace(/;$/, "")
)();
const modalidadQueVende = new Function(
  "return " + limpiar(trozo("modalidadQueVende"))
)();
const sigueGuardadoEnSuCapa = new Function(
  "pesoDeContenido",
  "modalidadQueVende",
  "CLAVE_EN_LA_CAPA",
  "return " + limpiar(trozo("sigueGuardadoEnSuCapa"))
)(pesoDeContenido, modalidadQueVende, CLAVE_EN_LA_CAPA);
const vaciaria = new Function(
  "SECCIONES_VIGILADAS",
  "pesoDeContenido",
  "sigueGuardadoEnSuCapa",
  "return " + limpiar(trozo("seccionesQueSeVaciarian"))
)(SECCIONES_VIGILADAS, pesoDeContenido, sigueGuardadoEnSuCapa);

// ── El desastre exacto que ocurrió ──────────────────────────────────────────
const antes = {
  product_name: "SUPER KIT FLORES DE PAPEL",
  course_content: "📚 Kit Completo…",
  image_gallery: [{ topic: "IMAGEN SUPER KIT FLORES DE PAPEL" }],
  product_info_topics: ["IMAGEN SUPER KIT FLORES DE PAPEL"],
  intro_sequence: [{ body: "hola" }, { body: "mira" }],
  intro_sequence_2: [{ body: "otra" }],
  followup_sequences: [{ steps: [{ body: "x" }] }],
  payment_approved_sequence: [{ body: "gracias" }],
  samples_after_sequence: [{ body: "muestra" }],
  modality_templates: {
    lineal: { product_name: "SUPER KIT", course_content: "algo" },
    doble_oferta_upsell: { product_name: "SUPER KIT", course_content: "algo" },
  },
};
const despues = {
  product_name: "",
  course_content: "",
  image_gallery: [],
  product_info_topics: [],
  intro_sequence: [],
  intro_sequence_2: [],
  followup_sequences: [],
  payment_approved_sequence: [],
  samples_after_sequence: [],
  modality_templates: {
    lineal: { product_name: "SUPER KIT", course_content: "algo" },
    doble_oferta_upsell: { product_name: "", course_content: "" },
  },
};

const perdidas = vaciaria(antes, despues);
comprobar("el desastre real se detecta", perdidas.length >= 9, `${perdidas.length} secciones`);
for (const esperada of [
  "Contenido del producto 1",
  "Galería del producto 1",
  "Info de contenido (lo marcado)",
  "Intro",
  "Seguimientos",
  "Entrega «Pago aprobado»",
]) {
  comprobar(`  avisa de: ${esperada}`, perdidas.includes(esperada), "en la lista");
}
comprobar(
  // El desastre borró SOLO una de las cinco plantillas. Mirando el bloque
  // entero seguiría pesando mucho y no saltaría ninguna alarma.
  "y la plantilla que se vació, una entre cinco",
  perdidas.some((p) => p.includes("doble_oferta_upsell")),
  "detectada"
);
comprobar(
  "la plantilla que NO se tocó no se nombra",
  !perdidas.some((p) => p.includes("«lineal»")),
  "sin ruido"
);

// ── Lo que NO puede molestar ────────────────────────────────────────────────
comprobar(
  "guardar sin cambios no avisa de nada",
  vaciaria(antes, antes).length === 0,
  "callado"
);
comprobar(
  "cambiar un texto por otro no avisa",
  vaciaria(antes, { ...antes, course_content: "otro texto" }).length === 0,
  "callado"
);
comprobar(
  "llenar algo que estaba vacío no avisa",
  vaciaria({ ...antes, course_content: "" }, antes).length === 0,
  "callado"
);
comprobar(
  // Cinco pasos VACÍOS es perderlo todo igual. "Existe" no es "tiene algo".
  "un arreglo de pasos en blanco cuenta como vacío",
  vaciaria(
    { intro_sequence: [{ body: "hola" }] },
    { intro_sequence: [{ body: "" }, { body: "  " }] }
  ).length === 1,
  "lo pilla"
);
comprobar(
  "apagar un interruptor no cuenta como vaciar",
  vaciaria({ upsell: { enabled: true } }, { upsell: { enabled: false } })
    .length === 0,
  "callado"
);

// ── El enganche, en los dos lados ───────────────────────────────────────────
comprobar(
  "el servidor corta ANTES de publicar",
  api.indexOf("requiereConfirmacion") < api.indexOf("publishFileToGithub("),
  "no escribe"
);
comprobar(
  "y devuelve 409 con la lista",
  /requiereConfirmacion: true,\s*\r?\n\s*vaciaria: seVaciarian,/.test(api) &&
    /\{ status: 409 \}/.test(api),
  "409"
);
comprobar(
  // Si la comparación fallara y bloqueara, el seguro sería el problema.
  "si la comparación falla, NO bloquea el guardado",
  /catch \{[\s\S]{0,240}seVaciarian = \[\];/.test(api),
  "deja pasar"
);
comprobar(
  "solo se salta con la confirmación expresa",
  /body\.confirmar_vaciado !== true/.test(api),
  "a propósito"
);
comprobar(
  "el editor enseña la lista y puede cancelar",
  /res\.status === 409 && data\?\.requiereConfirmacion/.test(editor) &&
    /No se guardó nada\. Tu contenido sigue intacto\./.test(editor),
  "se puede cancelar"
);
comprobar(
  "y solo reintenta con confirmar_vaciado",
  /confirmar_vaciado: true/.test(editor),
  "reintenta"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
