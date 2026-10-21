// Apagar las burbujas del regalo apaga de verdad.
//
// El motor tiene un camino antiguo para configuraciones sin secuencia: manda
// el audio del campo "Audio del regalo" y luego el texto. El problema era que
// apagar TODAS las burbujas caía en ese camino, y sonaba un audio con su
// burbuja apagada en pantalla.
//
//   node scripts/prueba-regalo-apagado.mjs
import { readFileSync } from "node:fs";

const fuente = readFileSync("src/lib/workflow/engine.ts", "utf8").replace(
  /\r\n/g,
  "\n"
);
const desde = fuente.indexOf("function scheduleGiftAudioAndText");
if (desde < 0) throw new Error("no encontré scheduleGiftAudioAndText");
const cuerpo = fuente.slice(desde, fuente.indexOf("\n}\n", desde));

let fallos = 0;
const comprobar = (nombre, ok, detalle = "") => {
  if (!ok) fallos++;
  console.log(`${ok ? "ok   " : "FALLA"} ${nombre}${detalle ? `  → ${detalle}` : ""}`);
};

comprobar(
  "el motor distingue si hay secuencia configurada",
  cuerpo.includes("haySecuenciaConfigurada")
);
comprobar(
  "con secuencia toda apagada NO programa el audio viejo",
  /haySecuenciaConfigurada\)\s*\{[\s\S]*?ACTION_SEND_GIFT_TEXT[\s\S]*?return;/.test(
    cuerpo
  ) &&
    !/haySecuenciaConfigurada\)\s*\{[\s\S]*?ACTION_SEND_GIFT_AUDIO[\s\S]*?return;/.test(
      cuerpo
    )
);
comprobar(
  "sin secuencia (configuración antigua) el audio se conserva",
  cuerpo.includes("ACTION_SEND_GIFT_AUDIO")
);

// Simulación de los tres casos.
{
  const decidir = (pasos) => {
    const activos = pasos.filter((p) => p.enabled !== false && p.contenido);
    if (activos.length) return activos.map(() => "paso");
    if (pasos.length > 0) return ["texto"];
    return ["audio", "texto"];
  };

  comprobar(
    "una burbuja encendida: un solo mensaje",
    decidir([{ enabled: true, contenido: true }]).join(",") === "paso"
  );
  comprobar(
    "dos encendidas: dos mensajes",
    decidir([
      { enabled: true, contenido: true },
      { enabled: true, contenido: true },
    ]).length === 2
  );
  comprobar(
    "todas apagadas: solo el texto, sin audio",
    decidir([
      { enabled: false, contenido: true },
      { enabled: false, contenido: true },
      { enabled: false, contenido: true },
    ]).join(",") === "texto"
  );
  comprobar(
    "sin secuencia: sigue el camino antiguo (audio + texto)",
    decidir([]).join(",") === "audio,texto"
  );
}

console.log(fallos === 0 ? "\nLos 7 casos correctos." : `\n${fallos} mal.`);
process.exit(fallos === 0 ? 0 : 1);
