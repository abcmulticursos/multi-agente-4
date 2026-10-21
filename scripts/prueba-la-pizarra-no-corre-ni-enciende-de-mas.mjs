// LA PIZARRA NO CORRE NÚMEROS NI ENCIENDE DE MÁS — las tres reglas de la parte 3.
//
// La parte 3 de la pizarra (16/10/2026) conecta, desconecta, duplica y agrega fichas. Cada una
// de estas reglas evita un fallo de venta, y por eso se vigilan:
//
//   1. LO NUEVO VA AL FINAL DE SU LISTA. El motor recuerda POR NÚMERO qué intro y qué variante
//      de seguimiento le tocó a cada cliente. Insertar en medio correría los números, y a quien
//      está a medias le saldría otra pieza.
//   2. LO QUE NACE O SE QUEDA SIN BANDERA, NACE O QUEDA APAGADO. Una pieza encendida sin
//      bandera, donde nadie lleva banderas, juega para TODOS.
//   3. LOS «MENSAJES PRINCIPALES» NO SE CONECTAN NI SE DESCONECTAN: sus etiquetas las heredan
//      las variantes.
//
// Y una cuarta: todo va al MISMO borrador que los menús (snapshot + setCfg), nunca a un
// guardado propio.
//
//   node scripts/prueba-la-pizarra-no-corre-ni-enciende-de-mas.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pantalla = readFileSync(join(process.cwd(), "src", "app", "editor", "page.tsx"), "utf8");
let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 70)}`);
};
const cuerpo = (nombre) =>
  // El archivo puede llegar con saltos de Windows (\r\n): el final de la función se busca con
  // los dos.
  pantalla.match(new RegExp(`function ${nombre}\\([\\s\\S]*?\\r?\\n\\}\\r?\\n`))?.[0] ?? "";

console.log("\n— 1. lo nuevo va al final —\n");
const ubicar = cuerpo("ubicarPieza");
comprobar("agregarAlFinal siempre añade DETRÁS de la lista", (ubicar.match(/agregarAlFinal: \(n\) =>/g) ?? []).length >= 4 && !/splice\(/.test(ubicar));
const agregar = cuerpo("agregarPieza");
comprobar("«+» añade detrás, nunca inserta", !/splice\(/.test(agregar) && /\[\s*\.\.\.contenido\.intro_groups,/.test(agregar));
comprobar("duplicar usa agregarAlFinal", /u\.agregarAlFinal\(/.test(cuerpo("duplicarPieza")));

console.log("\n— 2. lo suelto no sale —\n");
comprobar("la copia nace apagada y sin banderas", /enabled: false,\s*\r?\n\s*paises: \[\],/.test(cuerpo("duplicarPieza")));
comprobar("lo que crea «+» nace apagado", (agregar.match(/enabled: false/g) ?? []).length >= 4);
comprobar("un seguimiento nuevo nace apagado entero", /name: `seguimiento_\$\{n\}`,[\s\S]{0,120}?enabled: false,/.test(agregar));
comprobar("sin su última bandera, se apaga", /paises\.length === 0 \? \{ enabled: false \}/.test(cuerpo("desconectarPieza")));
comprobar("conectar enciende y pone el dirigir por país", /enabled: true/.test(cuerpo("conectarPieza")) && /conDirigirPorPais\(u\)/.test(cuerpo("conectarPieza")));
comprobar("conectar no quita la ficha de las otras tiendas («🌐 todas» se queda en todas)", /tiendas\.length > 0 && tiendaId && !tiendas\.includes\(tiendaId\)/.test(cuerpo("conectarPieza")));

console.log("\n— 3. los mensajes principales no se tocan —\n");
comprobar("no se conectan", /if \(u\.esBase\) return \{ error:/.test(cuerpo("conectarPieza")));
comprobar("no se desconectan", /if \(u\.esBase\) return \{ error:/.test(cuerpo("desconectarPieza")));
comprobar("no se duplican", /if \(!u \|\| u\.esBase\) return null;/.test(cuerpo("duplicarPieza")));

console.log("\n— 4. todo va al mismo borrador —\n");
comprobar("cada cambio hace foto para deshacer y va a setCfg", /const aplicar = \(nuevo: FullConfig \| null\) => \{\s*\r?\n\s*if \(!nuevo\) return;\s*\r?\n\s*onSnapshot\(\);\s*\r?\n\s*onConfigChange\(nuevo\);/.test(pantalla));
comprobar("la pizarra recibe setCfg, no un guardado propio", /onConfigChange=\{setCfg\}\s*\r?\n\s*onSnapshot=\{snapshot\}/.test(pantalla));

console.log(`\n${fallos === 0 ? "TODO OK — nada se corre ni se enciende de más" : `${fallos} FALLO(S)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
