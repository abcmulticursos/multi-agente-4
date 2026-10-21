// UNA TIENDA POR NÚMERO: cada número vende lo suyo, con el mismo almacén.
//
// LO PIDIÓ EL DUEÑO el 30 de septiembre de 2026: vender con varios números —«no
// solo con 1 o 2, sino con los 20 que permite Meta»— sin duplicar el proyecto y
// «sin que se filtren cosas de un lado a otro».
//
// Y ELIGIÓ EL NOMBRE COMO IDENTIDAD: «un día puede ser GRAFISMO, otro día
// LECTOESCRITURA». El número se le asigna dentro, y una tienda puede quedarse
// SIN número mientras se prepara.
//
// LO QUE ESTA PRUEBA PROTEGE, y es lo más importante de todo el cambio:
//
//     SIN NINGUNA TIENDA QUE LLEVE ESE NÚMERO, EL BOT SE COMPORTA COMO HOY.
//
// Ésa es la garantía de que subir esto no mueve el bot que ya vende. Si algún
// día alguien la rompe, esta prueba se pone roja antes de que lo haga un cliente.
//
//   node scripts/prueba-una-tienda-por-numero.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const DOBLE = "stub:db";
registerHooks({
  resolve(esp, ctx, next) {
    if (esp === "@/lib/db") return { url: DOBLE, format: "module", shortCircuit: true };
    if (esp.startsWith("@/")) {
      const rel = esp.slice(2);
      const conExt = /\.[a-z]+$/.test(rel) ? rel : `${rel}.ts`;
      return { url: pathToFileURL(join(RAIZ, "src", conExt)).href, shortCircuit: true };
    }
    return next(esp, ctx);
  },
  load(url, ctx, next) {
    if (url === DOBLE)
      return {
        format: "module", shortCircuit: true,
        source: `
          export const getConversationByPhone = () => null;
          export const getConversationById = () => null;
          export const getFrozenPrices = () => null;
          export const getUpsellFrozenPrices = () => null; export const getPuestoEnLaFila = () => null; export const leerCompradosDeLaFila = () => []; export const moverLaFila = () => {};
          export const setFrozenPrices = () => {};
        `,
      };
    return next(url, ctx);
  },
});
const m = await import(pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href);

const conf = readFileSync(join(RAIZ, "src", "lib", "workflow", "config.ts"), "utf8");
const motor = readFileSync(join(RAIZ, "src", "lib", "workflow", "engine.ts"), "utf8");
const manejador = readFileSync(join(RAIZ, "src", "lib", "meta", "handler.ts"), "utf8");
const api = readFileSync(join(RAIZ, "src", "app", "api", "workflow", "route.ts"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// Un config de juguete, con nombres inventados: si esta prueba usara los suyos
// taparía justo el fallo que la regla de la casa evita.
const CFG = {
  segunda_opcion_prestada: "",
  modo_reenganche: true,
  tiendas: [
    { id: "t1", nombre: "GRAFISMO", numero: "111", semimodalidad: "" },
    { id: "t2", nombre: "GRAFISMO OB", numero: "222", semimodalidad: "segunda_oculta" },
    { id: "t3", nombre: "LECTOESCRITURA", numero: "333", semimodalidad: "dos_juntas" },
    { id: "t4", nombre: "EN PREPARACION" },
    { id: "t5", nombre: "APAGADA", numero: "999", enabled: false, semimodalidad: "dos_juntas" },
  ],
};

// ── 1. QUÉ TIENDA ATIENDE ───────────────────────────────────────────────────
console.log("\n— 1. a qué tienda le toca cada número —\n");
const cual = (n) => m.tiendaDelNumero(n, CFG)?.nombre ?? "(ninguna)";
comprobar("el número 111 lo atiende GRAFISMO", cual("111") === "GRAFISMO");
comprobar("el 222 lo atiende GRAFISMO OB", cual("222") === "GRAFISMO OB");
comprobar("un número que no es de nadie", cual("555") === "(ninguna)", "sigue como hoy");
comprobar("sin número no hay tienda", cual(null) === "(ninguna)");
comprobar(
  "una tienda SIN número no atiende a nadie",
  cual("") === "(ninguna)",
  "está preparada, no vendiendo"
);
comprobar(
  "y una tienda APAGADA tampoco, aunque tenga número",
  cual("999") === "(ninguna)",
  "el interruptor manda"
);

// ── 2. CADA TIENDA VENDE CON SU SEMIMODALIDAD ───────────────────────────────
//
// Es lo que pidió: el MISMO producto vendido lineal en un número y COMO OB en
// otro, sin duplicar nada.
console.log("\n— 2. el mismo producto, dos formas de venderlo —\n");
// Se resuelve la tienda con ESTE config —el de juguete— y se abre el turno con
// ella. `conElTurnoDe` hace lo mismo en el bot, pero resolviendo contra el
// archivo de verdad; aquí se le entrega la tienda ya buscada para poder medir
// sin tocar la configuración del dueño. La cadena que se prueba es la misma:
// tiendaDelNumero -> conLaTiendaDelTurno -> elSelectorQueManda.
const semiDe = (numero) =>
  m.conLaTiendaDelTurno(m.tiendaDelNumero(numero, CFG), () =>
    m.semimodalidadActiva(CFG)
  );
comprobar("por el 111 vende «como hoy»", semiDe("111") === "lineal");
comprobar("por el 222, COMO OB", semiDe("222") === "ob", "mismo producto, otra venta");
comprobar("por el 333, COMO DOU", semiDe("333") === "dou");

// ── 3. LA GARANTÍA: SIN TIENDA, TODO COMO HOY ───────────────────────────────
console.log("\n— 3. sin tienda, el bot de siempre —\n");
comprobar(
  "un número sin tienda usa el selector global",
  semiDe("555") === m.semimodalidadActiva(CFG),
  "no se inventa nada"
);
comprobar(
  "y sin conversación tampoco cambia nada",
  m.conElTurnoDe(null, () => m.semimodalidadActiva(CFG)) === m.semimodalidadActiva(CFG)
);
{
  // Con el selector global en COMO DOU y un número sin tienda, sigue mandando el
  // global: la tienda dirige, no secuestra.
  const global = { ...CFG, segunda_opcion_prestada: "dos_juntas" };
  const sinTienda = m.conLaTiendaDelTurno(m.tiendaDelNumero("555", global), () =>
    m.semimodalidadActiva(global)
  );
  comprobar("el global sigue mandando donde no hay tienda", sinTienda === "dou");
  // Y la tienda que dice «como hoy» NO hereda el global: «» es una respuesta.
  const conTienda = m.conLaTiendaDelTurno(m.tiendaDelNumero("111", global), () =>
    m.semimodalidadActiva(global)
  );
  comprobar(
    "y una tienda en «como hoy» no hereda el global",
    conTienda === "lineal",
    "«» es una respuesta, no un hueco"
  );
}

// ── 4. NO HAY POR DÓNDE FILTRARSE ───────────────────────────────────────────
//
// Una tienda no puede «caer» en la de al lado: o la eligió el número, o no existe
// para ella. Se comprueba entrando y saliendo de varias en el mismo proceso.
console.log("\n— 4. una tienda no se filtra en otra —\n");
{
  const visto = ["111", "222", "333", "555", "111"].map(semiDe).join(",");
  comprobar(
    "atender cinco turnos seguidos no arrastra nada",
    visto === "lineal,ob,dou,lineal,lineal",
    visto
  );
}

// ── 5. ESTÁ ENCHUFADO DONDE SE ATIENDE ──────────────────────────────────────
console.log("\n— 5. se abre al empezar el turno, una sola vez —\n");
comprobar(
  "al llegar un mensaje",
  /await conElTurnoDe\(convo, async \(\) => \{/.test(manejador),
  "handler.ts"
);
comprobar(
  "y al salir una burbuja programada",
  /conElTurnoDe\(convo, \(\) =>/.test(motor),
  "engine.ts"
);
comprobar(
  "la tienda entra en la llave de la configuración",
  /const suTienda = tiendaDelTurno\.getStore\(\);/.test(conf),
  "se arma una vez por tienda y se reusa"
);
comprobar(
  "el selector se lee por UNA sola puerta",
  (conf.match(/config\.segunda_opcion_prestada;/g) ?? []).length === 0 &&
    /function elSelectorQueManda\(/.test(conf),
  "nadie lo lee por su cuenta"
);
comprobar(
  "y la tienda juega SUS productos",
  /const suya = tiendaDelTurno\.getStore\(\)\?\.alineacion;/.test(conf),
  "del mismo almacén, sin copiar fichas"
);

// ── 6. SOBREVIVE AL GUARDADO ────────────────────────────────────────────────
console.log("\n— 6. las tiendas no se pierden al guardar —\n");
comprobar("hay un lector propio", /function leeTiendas\(/.test(api));
comprobar("se leen al abrir el editor", /const tiendas = leeTiendas\(config\?\.tiendas\);/.test(api));
// (17/10/2026: con «escribir», para pasar al archivo las burbujas del regalo de cada tienda)
comprobar("y se escriben al guardar", /doc\.set\("tiendas", leeTiendas\(body\.tiendas(, "escribir")?\)\);/.test(api));
comprobar(
  "una tienda sin id no se guarda",
  /\.filter\(\(t\) => String\(t\?\.id \?\? ""\)\.trim\(\)\)/.test(api),
  "el id es lo que la identifica"
);

// ── 7. LA PANTALLA ──────────────────────────────────────────────────────────
console.log("\n— 7. se crean y se ven en el editor —\n");
const pantalla = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");
comprobar("existe la pantalla", /function TiendasDelProyecto\(/.test(pantalla));
comprobar(
  "vive en Ajustes, la primera",
  /titleKey="ajustes_tiendas"/.test(pantalla),
  "decide QUÉ vende cada número"
);
comprobar(
  "la tienda nace con id propio, no con su nombre",
  /id: `tienda_\$\{Date\.now\(\)\.toString\(36\)\}`/.test(pantalla),
  "renombrarla no la convierte en otra"
);
comprobar(
  "y al cargar se tira la que no tenga id",
  /loaded\.tiendas = Array\.isArray\(loaded\.tiendas\)/.test(pantalla)
);
// LA GARANTÍA SE DICE EN LA PROPIA PANTALLA. Quien la abre dentro de seis meses
// tiene que poder leer que una lista vacía no apaga nada.
comprobar(
  "la pantalla explica que sin tiendas todo sigue igual",
  /Sin ninguna tienda, el bot vende como hasta hoy/.test(pantalla)
);
comprobar(
  "y que una tienda sin número está preparada, no vendiendo",
  /Preparada: ponle el número cuando quieras que empiece a vender/.test(pantalla)
);
// ELEGIR PRODUCTOS POR TIENDA, con el MISMO selector que la modalidad. No se
// copió: una copia acabaría avisando de cosas distintas en cada sitio.
comprobar(
  "cada tienda elige sus productos con el selector de siempre",
  /<AlineacionDeLaModalidad[\s\S]{0,400}?alineacion=\{\(tienda\.alineacion \?\? \{\}\) as AlineacionEditor\}/.test(
    pantalla
  ),
  "reutilizado, no copiado"
);
comprobar(
  "y los asientos siguen la semimodalidad DE ESA TIENDA",
  /segunda_opcion_prestada: tienda\.semimodalidad \?\? ""/.test(pantalla),
  "no la del selector general"
);
comprobar(
  "sin elegir nada, juega la alineación general",
  /Sin elegir nada, esta tienda juega los productos de la/.test(pantalla),
  "y la pantalla lo dice"
);

// ── 8. EL REENGANCHE SE ENCIENDE SOLO, TAMBIÉN DESDE LA TIENDA ──────────────
//
// LO PIDIÓ EL DUEÑO el 28/09/2026: «cuando cambie a como dou, o como ob
// automáticamente cambie a reenganche… estoy testeando y me estoy olvidando de
// cambiarlo en mis pruebas». El selector GENERAL ya lo hacía.
//
// EL DE LA TIENDA NO, y lo vio él mismo el 01/10 al leer en mi reporte que su
// reenganche estaba apagado: «recuerda que yo te pedí que el reenganche se encienda
// automáticamente». Tenía razón — el selector de la tienda es de ayer y salió sin eso.
console.log("\n— 8. el reenganche se enciende desde la tienda —\n");
comprobar(
  "al pasar a DOU u OB se enciende",
  /if \(valor !== ""\) onReenganche\(siguientes\);/.test(pantalla),
  "igual que el selector general"
);
// SOLO ENCIENDE. `modo_reenganche` es UNO para todo el bot: apagarlo porque una
// tienda vuelva a un producto dejaría sin reenganche a las que sigan en DOU u OB.
comprobar(
  "y NUNCA se apaga desde aquí",
  /else onTiendas\(siguientes\);/.test(pantalla),
  "el reenganche es uno para todo el bot"
);
// Y LOS DOS CAMBIOS EN UNA SOLA ESCRITURA. Dos `setCfg` seguidos parten del mismo
// estado, así que el segundo se comería el primero y la semimodalidad elegida se
// perdería en silencio. Esto estuvo a punto de pasar.
comprobar(
  "los dos cambios van juntos, no en dos escrituras",
  /onReenganche=\{\(tiendas\) =>\s*\r?\n?\s*setCfg\(\{\s*\r?\n?\s*\.\.\.cfg,\s*\r?\n?\s*tiendas,\s*\r?\n?\s*globals: \{ \.\.\.cfg\.globals, modo_reenganche: true \},/.test(
    pantalla
  ),
  "o se perdería la elección"
);

console.log(
  fallos === 0
    ? "\nTODO OK — cada número vende lo suyo, y sin tiendas el bot es el de siempre\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
