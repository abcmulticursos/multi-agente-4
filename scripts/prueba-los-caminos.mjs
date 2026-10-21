// LOS CAMINOS (18/10/2026): «cada camino tiene su propia ruta pero el final es el mismo… yo no
// necesito reemplazos, si no hay conexión… no se conecta y punto, es como si se trabara».
//
// QUÉ PROTEGE:
//   1. La regla (`porCamino`): SOLO las de su camino, sin reemplazos. Una ficha puede ser de
//      varios caminos. SIN NINGUNA FICHA CON CAMINO devuelve LA MISMA lista (nada cambia).
//   2. El bot: la conversación anota el camino de su intro; el seguimiento y la intro de order
//      bump se eligen dentro de su camino; sin intro de order bump en su camino, se queda trabado
//      (ni se destapa ni cambia de estado). El upsell no lleva camino.
//   3. El guardado: el camino y los «también» se leen y se escriben, o se perderían.
//   4. La pizarra: una ficha cuelga de la última de cada uno de SUS caminos; marca dónde termina
//      cada camino; cortar un cable de una ficha de varios la saca solo de ese camino.
//
//   node scripts/prueba-los-caminos.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const regla = leer("src", "lib", "workflow", "etiqueta-de-camino.ts");
const motor = leer("src", "lib", "workflow", "engine.ts");
const config = leer("src", "lib", "workflow", "config.ts");
const ruta = leer("src", "app", "api", "workflow", "route.ts");
const db = leer("src", "lib", "db.ts");
const lienzo = leer("src", "components", "pizarra", "LienzoDePizarra.tsx");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 72)} ${valor}`);
};

const dir = mkdtempSync(join(tmpdir(), "caminos-"));
writeFileSync(join(dir, "regla.ts"), regla, "utf8");
const { porCamino, leeCamino, caminosDe } = await import(pathToFileURL(join(dir, "regla.ts")).href);
const de = (x) => caminosDe(x);
const nombres = (l) => l.map((x) => x.n).join(",") || "(ninguna)";

console.log("\n— 1. la regla —\n");
const sinCaminos = [{ n: 1 }, { n: 2 }];
comprobar("sin caminos, cliente del principal: LA MISMA lista (nada cambia)", porCamino(sinCaminos, de, "") === sinCaminos && porCamino(sinCaminos, de, null) === sinCaminos);
comprobar("cliente B en un paso sin ninguna ficha B: NINGUNA (su camino termina)", porCamino(sinCaminos, de, "B").length === 0);
const mezcla = [{ n: "A1" }, { n: "A2" }, { n: "B1", camino: "B" }, { n: "C1", camino: "C" }];
comprobar("cliente del camino B: solo las B", nombres(porCamino(mezcla, de, "B")) === "B1", nombres(porCamino(mezcla, de, "B")));
comprobar("cliente del principal: solo las del principal", nombres(porCamino(mezcla, de, "")) === "A1,A2");
comprobar("camino sin ficha en este paso: NINGUNA (sin reemplazo)", nombres(porCamino(mezcla, de, "D")) === "(ninguna)");
comprobar("principal sin ficha en este paso: NINGUNA", nombres(porCamino([{ n: "B1", camino: "B" }], de, "")) === "(ninguna)");
const compartida = [{ n: "S", tambien_en_caminos: ["B"] }, { n: "C1", camino: "C" }];
comprobar("una ficha de varios caminos sirve a todos ellos", nombres(porCamino(compartida, de, "")) === "S" && nombres(porCamino(compartida, de, "B")) === "S");
comprobar("«PRINCIPAL» en los también = el principal", caminosDe({ camino: "B", tambien_en_caminos: ["PRINCIPAL"] }).join("|") === "B|");
comprobar("el camino escrito se limpia", leeCamino(" b ") === "B" && leeCamino("c-1!") === "C1" && leeCamino(null) === "");

console.log("\n— 2. el bot —\n");
comprobar("la conversación guarda su camino (columna nueva)", /\["camino", "TEXT"\]/.test(db) && /camino: string \| null;/.test(db));
comprobar("y se borra con lo demás al reiniciar por cambio de producto", /intro_variant_sent = NULL,\s*camino = NULL,/.test(db));
comprobar("se anota al elegir la intro", /setCaminoDeLaConversacion\(convo\.id, config\.intro_caminos\?\.\[chosenIntro\.variant - 1\] \?\? null\)/.test(motor));
comprobar("y al programarla solo si no lo tenía (no cambia a mitad)", /if \(convo && !convo\.camino\) setCaminoDeLaConversacion\(convoId, config\.intro_caminos\?\.\[variant - 1\] \?\? null\)/.test(motor));
comprobar("las intros llevan su camino a la lista que lee el bot", /next\.intro_caminos = introOnlyGroups\.map\(\(group\) => caminoDe\(group\)\)/.test(config));
comprobar("el seguimiento se elige dentro de su camino, al final", /const pool = porCamino\(deTodosLosCaminos, \(c\) => c\.caminos, camino\);/.test(motor));
comprobar("con el camino de la conversación, en las dos llamadas", (motor.match(/getEffectiveCountryCode\(convo\.phone, config\),\s*convo\.camino\s*\)/g) ?? []).length === 2);
comprobar("los mensajes principales son del principal", /caminos: \[""\],/.test(motor));
comprobar("la intro de order bump, la de su camino", /porCamino\(vivosDeTodosLosCaminos, \(g\) => caminosDe\(g\), caminoDelCliente\)/.test(config));
comprobar("sin la suya, se queda trabado antes de destapar nada", motor.indexOf("apunte.faltaLaDeSuCamino") > 0 && motor.indexOf("apunte.faltaLaDeSuCamino") < motor.indexOf("markOrderBumpRevealed(convo.id);"));
comprobar("sin pasar el camino, el sorteo de cajones es el de siempre", /caminoDelCliente === undefined\s*\?\s*vivosDeTodosLosCaminos/.test(config));
comprobar("el upsell no lleva camino", !/up\.intro_groups,[^;]*convo\.camino/.test(motor));

console.log("\n— 3. el guardado —\n");
for (const v of ["group", "variant", "g", "v"]) {
  comprobar(`camino y «también», lectura y escritura (${v})`,
    new RegExp(`camino: leeCamino\\(${v}\\?\\.camino\\),\\s*tambien_en_caminos: leeTambienEnCaminos\\(${v}\\?\\.tambien_en_caminos\\),`).test(ruta) &&
      new RegExp(`leeTambienEnCaminos\\(${v}\\?\\.tambien_en_caminos\\)\\.length > 0 \\? \\{ tambien_en_caminos`).test(ruta));
}

// 19/10/2026: el editor rearma cada intro campo por campo antes de mandarla (`cleanChannelContent`)
// y se le olvidaba el camino: la intro perdía su «B» al guardar.
comprobar("el editor manda el camino de las intros al guardar", /\.\.\.\(group\.camino \? \{ camino: group\.camino \} : \{\}\),\s*\.\.\.\(\(group\.tambien_en_caminos \?\? \[\]\)\.length > 0/.test(editor));

console.log("\n— 4. la pizarra —\n");
comprobar("cada ficha cuelga de la última de cada uno de sus caminos", /const desdeSuCamino = esIntro \? anteriores\.get\(""\) : anteriores\.get\(deCamino\);/.test(lienzo));
comprobar("sin caminos, un solo anterior (se dibuja como antes)", /anteriores = a \? new Map\(\[\["", a\]\]\) : new Map\(\);/.test(lienzo));
comprobar("marca dónde termina cada camino", /termina aquí/.test(lienzo) && /se queda trabado/.test(lienzo));
comprobar("cortar un cable de una ficha de varios la saca solo de ese camino", /acciones\.quitarDelCamino\(pieza\.id, deCamino\)/.test(lienzo) && /quitarDelCamino: \(piezaId: string, camino: string\) =>/.test(editor));
comprobar("cortar un cable quita ESE cable: lo de detrás queda como tramo suelto", /acciones\.cortarCable\(/.test(lienzo) && /cortarCable: \(haciaId: string, pais: string, camino: string, desdeId\?: string\) =>/.test(editor));
comprobar("cortar un cable dibujado por él quita solo ese", /acciones\.quitarPuente\s*\?\s*acciones\.quitarPuente\(clave, deId, aId\)/.test(lienzo) && /quitarPuente: \(pais: string, desdeId: string, haciaId: string\) =>/.test(editor));
comprobar("reconectar un tramo suelto lo devuelve entero", /UN TRAMO SUELTO VUELVE ENTERO/.test(editor));
comprobar("una ficha sin cable que le llegue lleva punto rojo", /sinEntrada: true/.test(lienzo));
comprobar("el recuadro de un botón tiene punto naranja que cambia su destino", /DESDE EL RECUADRO DE UN BOTÓN/.test(lienzo) && /"show_order_bump"\);/.test(lienzo));
comprobar("la copia pone sus recuadros donde la original", /recuadros: recuadrosDelNodo\(v\.nodo\)/.test(lienzo) && /const conRecuadros = /.test(editor));
comprobar("la intro conectada a un tramo con punto rojo toma su camino", /const nuevo = huerfanos\[0\] \?\?/.test(editor));
comprobar("al cortar, el upsell no entra en el tramo (no lleva camino)", /\.filter\(\(id\) => \/\^\(seg\|ob\):\/\.test\(id\) && susCaminos\(id\)\.includes\(camino\)\)/.test(editor));
comprobar("el recuadro de un botón muestra un solo punto, el naranja", /id="entra" isConnectable=\{false\} className="!h-1/.test(lienzo));
comprobar("el cable del título al pago dice «si elige…»", /label: `si elige \$\{/.test(lienzo));
comprobar("«quiere comprar» de palabra: fila rosada; el cable lo pone él (aro sin él)", /cable\(`w:\$\{id\}:\$\{f\.id\}->\$\{t\.nodo\}`, id, f\.id/.test(lienzo) && /conectada: destinos\.length > 0 && puestos\.length === destinos\.length/.test(lienzo));
comprobar("COMO DOU y la intro de order bump: una fila «Elige X» por producto sin botón", /function filasDePalabraDe\(/.test(lienzo) && /id: `palabra:\$\{q\}`/.test(lienzo));
comprobar("del Pago a su Entrega el cable lo pone él", /const cableAEntrega = puentes\.includes\(/.test(lienzo) && /const delPago = \/\^pv:/.test(lienzo));
comprobar("un Inicio por país, con el «Vender en este país» del menú", /id: idDelInicio\(clave\),/.test(lienzo) && /alternarVentaDelPais: \(pais: string\) =>/.test(editor));
comprobar("y solo se conecta adonde el bot va de verdad", /if \(handle === "palabra" \|\| handle\.startsWith\("palabra:"\)\) \{/.test(lienzo) && /ponerPuente: \(pais: string, desdeId: string, haciaId: string\) =>/.test(editor));
comprobar("de una intro, un seguimiento o la oferta ya no sale el cable del título al Pago", /if \(tipoDelUltimo === "intro" \|\| tipoDelUltimo === "seguimiento" \|\| tipoDelUltimo === "ob"\) continue;/.test(lienzo));
comprobar("el recuadro se arrastra entero y conecta al soltarlo en un punto verde", /onNodeDrag=\{\(_e, n, arrastrados\) => alArrastrar\(n, arrastrados\)\}/.test(lienzo) && /const unirRecuadro = /.test(lienzo));
comprobar("el cable entre fichas fija el camino", /conCaminoDelCable\(conSuSitio, desde, \{ antes: piezaId, ahora: id \}, pais\)/.test(editor));
comprobar("y entre sueltas, en grupo", /enlazar: \(desdeId: string, haciaId: string\) =>/.test(editor) && /acciones\.enlazar\(/.test(lienzo));
comprobar("duplicar nace sin camino", /camino: undefined,\s*tambien_en_caminos: undefined,\s*\}\);/.test(editor));
comprobar("un bloque pegado, en un país con sus fichas, es un camino nuevo", /const caminoDelBloque = compite && sinCamino\.length > 0/.test(editor));
comprobar("una intro copiada, del Inicio a un país con intro, abre camino", /if \(conTodo && !desde && suelta && piezaId\.startsWith\("intro:"\)\)/.test(editor));

console.log(`\n${fallos === 0 ? "TODO OK — cada cliente sigue SOLO su camino, y sin caminos nada cambia" : `${fallos} FALLO(S)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
