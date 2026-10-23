// EL TABLERO NO TOCA LO QUE YA VENDE (22/10/2026, solo ALBERTO 4).
//
// El tablero es el segundo motor: la ruta que Alberto arma con fichas y cables. Esta prueba fija
// las cuatro reglas que lo hacen seguro (PLAN-TABLERO.md). Si una se cae, una conversación del
// motor de siempre podría acabar en el tablero, o al revés.
//
//   node scripts/prueba-el-tablero.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const manejador = leer("src", "lib", "meta", "handler.ts");
const obrero = leer("src", "lib", "workflow", "worker.ts");
const motor = leer("src", "lib", "tablero", "motor.ts");
const datos = leer("src", "lib", "tablero", "datos.ts");
const ruta = leer("src", "app", "api", "workflow", "route.ts");
const ia = leer("src", "lib", "tablero", "conversador.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 62)} ${valor}`);
};

console.log("\n— 1. una conversación, un solo motor —\n");
comprobar("solo entra al nacer", /if \(convo\.state !== "new"\) return false;/.test(motor), "las que ya empezaron siguen igual");
comprobar("y solo con el tablero encendido y conectado", /!elTableroAtiende\(t\)\) return false;/.test(motor));
comprobar(
  "atiende = encendido + Inicio con cable",
  /if \(!t\?\.encendido\) return false;/.test(datos) && /cableDeLaSalida\(t, inicio\.id, "siguiente"\)/.test(datos)
);
comprobar("el regalo lo sigue haciendo el motor de siempre", /if \(ESTADOS_DEL_REGALO\.has\(convo\.state \?\? ""\)\) return false;/.test(motor));

console.log("\n— 2. entra por un solo sitio, y después de los frenos —\n");
const gancho = manejador.indexOf("await alRecibirMensaje(");
comprobar("el gancho existe", gancho > 0);
comprobar("va DESPUÉS de «¿le contestamos?» y de moderar", gancho > manejador.indexOf("!leContestamos(fresh)") && gancho > manejador.indexOf("await moderarSiCorresponde(fresh, content)"));
comprobar("y ANTES del motor de siempre", gancho < manejador.indexOf("await tryWorkflowOnIncoming(fresh, content)"));
comprobar("si falla, una conversación del tablero no cae al motor de siempre", /if \(esDelTablero\(fresh\.id\)\) return;/.test(manejador));
{
  // MESSENGER (22/10/2026): la misma puerta, después de la pregunta del país.
  const messenger = leer("src", "app", "api", "webhooks", "messenger", "route.ts");
  const g = messenger.indexOf("await alRecibirMensaje(countryReady, content)");
  comprobar(
    "Messenger: después de la pregunta del país y antes del motor de siempre",
    g > messenger.indexOf("if (gateHandled) return;") && g < messenger.indexOf("await tryWorkflowOnIncoming(countryReady, content)")
  );
}
comprobar(
  "lo programado sale por su número y su página",
  /withOutboundWhatsAppNumber\(convo\.wa_phone_number_id/.test(motor) && /withOutboundMessengerPage\(convo\.messenger_page_id/.test(motor)
);

console.log("\n— 3. lo programado lleva su dueño —\n");
comprobar(
  "el obrero manda «tablero_*» al tablero y lo demás como siempre",
  /if \(action\.action_type\.startsWith\("tablero_"\)\) await ejecutarAccionDelTablero\(action\);\s*else await executeAction\(action\);/.test(obrero)
);
comprobar("el reloj solo sale si el cliente sigue en esa ficha", /estado\.vuelta !== payload\.vuelta/.test(motor));
comprobar("«no pagó» solo si ese cobro sigue abierto y sin nada pagado", /estado\.cobro_pagado > 0\) return;/.test(motor));

console.log("\n— 4. el archivo —\n");
comprobar("la ruta de guardado lo lee", /tableros: leeTableros\(config\?\.tableros/.test(ruta));
comprobar("y lo escribe solo si el panel lo manda", /if \(body\.tableros && typeof body\.tableros === "object"\)/.test(ruta));
comprobar("una salida, un cable", /if \(vistos\.has\(llave\)\) return \[\];/.test(datos));

console.log("\n— 5. el dinero —\n");
comprobar("la IA del tablero solo nombra montos de su cobro", /prohibidos = \(t: string\) => importesDelTexto\(t\)/.test(ia));
comprobar("el mismo comprobante no vale dos veces", /if \(huella && !apuntarHuella\(huella, convo\.id\)\)/.test(motor));
comprobar("un botón ya usado no repite la entrega", /botonYaUsado\(convo\.id, id\)/.test(motor));

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
