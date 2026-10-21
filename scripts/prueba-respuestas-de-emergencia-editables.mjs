// LAS RESPUESTAS DE EMERGENCIA SE EDITAN DESDE EL PANEL.
//
// LO PIDIO EL DUEÑO — 29 de septiembre de 2026. Vio una de estas frases en su
// prueba y pregunto «¿donde esta esta frase en el editor?». No estaba: las cuatro
// vivian escritas en `openrouter.ts` y para cambiar una habia que tocar el codigo.
//
// LAS CUATRO, y cuando sale cada una:
//
//   · el modelo devuelve VACIO dos veces                  -> «sin_respuesta»
//   · lo mismo, con los datos de pago ya enviados          -> «..._con_pago»
//   · la respuesta llega CORTADA tres veces                -> «respuesta_cortada»
//   · el modelo se enreda y se agota el tope de vueltas    -> «no_entendi»
//
// LA REGLA QUE NO SE PUEDE PERDER: vacio = sale la de siempre. Estas frases
// aparecen justo cuando algo ha ido mal, asi que un campo sin llenar no puede
// dejar al cliente sin respuesta.
//
//   node scripts/prueba-respuestas-de-emergencia-editables.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";

const RAIZ = process.cwd();
const AQUI = dirname(fileURLToPath(import.meta.url));
const llm = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8");
const cfgSrc = readFileSync(join(RAIZ, "src", "lib", "workflow", "config.ts"), "utf8");
const api = readFileSync(join(RAIZ, "src", "app", "api", "workflow", "route.ts"), "utf8");
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

const CAMPOS = [
  "emergencia_no_entendi",
  "emergencia_respuesta_cortada",
  "emergencia_sin_respuesta",
  "emergencia_sin_respuesta_con_pago",
];

// ── 1. EL MOTOR LAS LEE DEL CONTENIDO ───────────────────────────────────────
console.log("\n— 1. el motor las lee del contenido —\n");
comprobar(
  "hay un solo sitio que decide el texto",
  /function textoDeEmergencia\(/.test(llm) &&
    /const EMERGENCIAS_POR_DEFECTO = \{/.test(llm)
);
comprobar(
  "y las cuatro puertas lo usan",
  (llm.match(/textoDeEmergencia\("/g) ?? []).length === 4,
  `${(llm.match(/textoDeEmergencia\("/g) ?? []).length} de 4`
);
for (const clave of ["no_entendi", "respuesta_cortada", "sin_respuesta", "sin_respuesta_con_pago"]) {
  comprobar(`la puerta «${clave}» pide su texto`, llm.includes(`textoDeEmergencia("${clave}")`));
}
comprobar(
  "ninguna frase se devuelve ya escrita a mano",
  !/return "Disculpa/.test(llm) && !/return "Claro\. Los datos de pago/.test(llm)
);
comprobar(
  "los cuatro campos existen en la configuracion",
  CAMPOS.every((c) => cfgSrc.includes(`${c}?: string;`))
);

// ── 2. VACIO = LA DE SIEMPRE (se ejecuta el codigo real) ────────────────────
//
// Se extrae del archivo fuente, no se reescribe de memoria, y se le pone un
// cargador de configuracion de juguete para poder probar los dos casos.
console.log("\n— 2. vacio = la de siempre, y escrita = la suya —\n");
const recorta = (desde, hasta) => {
  const a = llm.indexOf(desde);
  const b = llm.indexOf(hasta, a);
  return a < 0 || b < 0 ? "" : llm.slice(a, b + hasta.length);
};
const porDefecto = recorta("const EMERGENCIAS_POR_DEFECTO = {", "} as const;");
const funcion = recorta("function textoDeEmergencia(", "\n}");
comprobar("se pueden extraer las dos piezas", porDefecto.length > 0 && funcion.length > 0);

// FUERA DEL PROYECTO A PROPOSITO: Node se niega a quitar los tipos de un .ts que
// viva dentro de `node_modules`, y dentro de `scripts/` ensuciaria el repositorio.
const COPIA = join(mkdtempSync(join(tmpdir(), "emergencias-")), "extraido.ts");
let ejecutado = false;
try {
  writeFileSync(
    COPIA,
    `let FALSA: Record<string, string | undefined> | null = null;\n` +
      `export function ponerConfig(c: Record<string, string | undefined> | null) { FALSA = c; }\n` +
      `function loadWorkflowConfig() { return FALSA; }\n` +
      `${porDefecto}\n${funcion}\nexport { textoDeEmergencia, EMERGENCIAS_POR_DEFECTO };\n`,
    "utf8"
  );
  const m = await import(pathToFileURL(COPIA).href);
  ejecutado = true;

  // a) sin nada configurado
  m.ponerConfig(null);
  for (const clave of Object.keys(m.EMERGENCIAS_POR_DEFECTO)) {
    comprobar(
      `sin configurar, «${clave}» usa la de siempre`,
      m.textoDeEmergencia(clave) === m.EMERGENCIAS_POR_DEFECTO[clave]
    );
  }
  // b) con el campo vacio o solo espacios — igual que sin configurar
  m.ponerConfig({
    emergencia_no_entendi: "",
    emergencia_respuesta_cortada: "   ",
    emergencia_sin_respuesta: "\n",
    emergencia_sin_respuesta_con_pago: "",
  });
  for (const clave of Object.keys(m.EMERGENCIAS_POR_DEFECTO)) {
    comprobar(
      `vacio o en blanco, «${clave}» usa la de siempre`,
      m.textoDeEmergencia(clave) === m.EMERGENCIAS_POR_DEFECTO[clave]
    );
  }
  // c) con texto suyo — manda el suyo
  m.ponerConfig({
    emergencia_no_entendi: "A ver, cuentame otra vez 😊",
    emergencia_respuesta_cortada: "Se me trabo, repiteme eso",
    emergencia_sin_respuesta: "Perdon, no te segui",
    emergencia_sin_respuesta_con_pago: "Los datos estan arriba, mandame tu foto",
  });
  comprobar("escrita, manda la suya (no_entendi)", m.textoDeEmergencia("no_entendi") === "A ver, cuentame otra vez 😊");
  comprobar("escrita, manda la suya (respuesta_cortada)", m.textoDeEmergencia("respuesta_cortada") === "Se me trabo, repiteme eso");
  comprobar("escrita, manda la suya (sin_respuesta)", m.textoDeEmergencia("sin_respuesta") === "Perdon, no te segui");
  comprobar("escrita, manda la suya (con_pago)", m.textoDeEmergencia("sin_respuesta_con_pago") === "Los datos estan arriba, mandame tu foto");
} catch (err) {
  comprobar("se puede ejecutar el codigo extraido", false, String(err).slice(0, 60));
}
if (!ejecutado) console.log("   (no se pudo ejecutar; quedan las comprobaciones estaticas)");

// ── 3. VIAJAN POR LA API, EN LOS DOS SENTIDOS ───────────────────────────────
console.log("\n— 3. entran y salen del archivo —\n");
for (const campo of CAMPOS) {
  comprobar(`${campo}: llega al editor`, api.includes(`${campo}: str(config?.${campo})`) || api.includes(`${campo}: str(\n`) || new RegExp(`${campo}[\\s\\S]{0,40}str\\(`).test(api));
}
comprobar(
  "y se guardan en el archivo, con el mismo molde que el mensaje de desconfianza",
  /for \(const clave of \[\s*"emergencia_no_entendi"/.test(api) &&
    /doc\.set\(clave, blockNode\(doc, valor\.replace/.test(api)
);

// ── 4. SE VEN Y SE EDITAN EN EL PANEL ───────────────────────────────────────
console.log("\n— 4. la seccion del editor —\n");
comprobar(
  "existe la seccion «Respuestas de emergencia»",
  /title="Respuestas de emergencia"/.test(editor)
);
comprobar(
  "vive en el Cerebro y recuerda si estaba abierta",
  /titleKey="cerebro_emergencias"/.test(editor)
);
comprobar(
  "los cuatro campos estan en la pantalla",
  CAMPOS.every((c) => editor.includes(`campo: "${c}"`))
);
comprobar(
  "cada uno tiene su cuadro de texto editable",
  // Desde el 10/10/2026 lleva delante el candado del Cerebro: se edita igual, una vez
  // escrita la contraseña del editor. Ver `prueba-modo-esencial`.
  /onChange=\{\(e\) => \{\s*if \(!cerebroDesbloqueado\) return;\s*setCfg\(\{ \.\.\.cfg, \[campo\]: e\.target\.value \}\);/.test(
    editor
  )
);
comprobar(
  "y su VISOR, el mismo de las demas burbujas",
  /<SpintaxPreviewBubble\s*variants=\{\[valor\.trim\(\) \|\| porDefecto\]\}/.test(
    editor
  )
);
comprobar(
  "el visor enseña la de siempre cuando el cuadro esta vacio",
  /valor\.trim\(\) \|\| porDefecto/.test(editor)
);
comprobar(
  "hay boton para volver a la de siempre",
  /Usar la de siempre/.test(editor) &&
    /setCfg\(\{ \.\.\.cfg, \[campo\]: "" \}\)/.test(editor)
);
comprobar(
  "el cuadro avisa de que vacio no deja al bot mudo",
  /sale la frase de siempre/i.test(editor)
);
comprobar(
  "los cuatro campos viajan al importar y exportar",
  /"emergencia_no_entendi",\s*"emergencia_respuesta_cortada",\s*"emergencia_sin_respuesta",\s*"emergencia_sin_respuesta_con_pago",/.test(
    editor
  )
);
comprobar(
  "y el tipo del editor los conoce",
  CAMPOS.every((c) => editor.includes(`${c}?: string;`))
);

console.log(
  fallos === 0
    ? "\nTODO OK — las cuatro respuestas de emergencia se editan desde el panel, y vacias sale la de siempre\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
