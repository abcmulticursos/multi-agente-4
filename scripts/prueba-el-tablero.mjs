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
comprobar("y solo con el tablero encendido y conectado", /!elTableroAtiende\(t, pais\)\) return false;/.test(motor));
comprobar(
  "atiende = encendido + Inicio con cable",
  /if \(!t\?\.encendido\) return false;/.test(datos) && /cableDeLaSalida\(t, inicio\.id, "siguiente"\)/.test(datos)
);
// (24/10) Lo del regalo —su pregunta, botones, fotos— sigue en el motor de siempre; solo lo que habla
// de OTRA cosa lo contesta el tablero (ver más abajo).
comprobar("el regalo lo sigue haciendo el motor de siempre", /if \(ESTADOS_DEL_REGALO\.has\(convo\.state \?\? ""\)\) \{/.test(motor) && /if \(delRegalo\) return false;/.test(motor));

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
{
  // INSTAGRAM (22/10/2026): la misma puerta; su tienda, la de la página unida a la cuenta.
  const instagram = leer("src", "app", "api", "webhooks", "instagram", "route.ts");
  const g = instagram.indexOf("await alRecibirMensaje(countryReady, content, tiendaDeInstagram)");
  comprobar(
    "Instagram: después de la pregunta del país y antes del motor de siempre",
    g > instagram.indexOf("if (gateHandled) return;") && g < instagram.indexOf("await tryWorkflowOnIncoming(countryReady, content)")
  );
  comprobar(
    "y el motor de siempre en Instagram sigue sin tienda, como hoy",
    !/setConversationMessengerPage|setConversationTienda/.test(instagram)
  );
  comprobar(
    "la lista numerada de Instagram: «1» elige el botón 1 (solo en Instagram)",
    /convo\.channel === "instagram" && \/\^\[1-3\]\$\/\.test\(dicho\)/.test(motor)
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
comprobar("«no pagó» solo si ese cobro sigue abierto y sin nada pagado", /estado\.cobro_pagado > 0 \|\| estado\.cobro_reloj !== payload\.reloj\) return;/.test(motor));

console.log("\n— 4. el archivo —\n");
comprobar("la ruta de guardado lo lee, por tienda y canal", /tableros: leeTablerosPorTienda\(config\?\.tableros/.test(ruta));
comprobar("y los workflows", /workflows: leeTableros\(config\?\.workflows/.test(ruta) && /doc\.set\(\s*"workflows"/.test(ruta));
comprobar("y lo escribe solo si el panel lo manda", /if \(body\.tableros && typeof body\.tableros === "object"\)/.test(ruta));
comprobar("una salida, un cable", /if \(vistos\.has\(llave\)\) return \[\];/.test(datos));

console.log("\n— 5. el dinero —\n");
comprobar("la IA del tablero solo nombra montos de su cobro", /prohibidos = \(t: string\) => importesDelTexto\(t\)/.test(ia));
comprobar("el mismo comprobante no vale dos veces", /if \(huella && !apuntarHuella\(huella, convo\.id\)\)/.test(motor));
comprobar("un botón ya usado no repite la entrega", /botonYaUsado\(convo\.id, id\)/.test(motor));

console.log("\n— 6. lo del 23/10: seguimientos, 24 h, regalo, workflows, botones —\n");
comprobar("los relojes no salen fuera de las 24 h", /if \(fueraDeLaVentana\(fresca\)\)/.test(motor));
comprobar("y respetan las horas de silencio", /adjustForQuietHours\(a\)/.test(motor));
comprobar("los seguimientos cuentan desde el último mensaje del cliente", /getLastUserMessageTime\(convoId\) \?\? ahora\(\)/.test(motor));
comprobar("al terminar el regalo, la ruta puede seguir", /ACCION_TRAS_REGALO/.test(motor) && /avisarFinDelRegalo\(convo\.id\)/.test(leer("src", "lib", "workflow", "engine.ts")));
comprobar(
  "el reenvío de un cliente del tablero manda lo que entregó el tablero",
  /if \(reenviarLoDelTablero\(convo\)\) return true;/.test(leer("src", "lib", "workflow", "payment.ts"))
);
comprobar("«Activar workflow» arranca en el siguiente tick, sin pisar el turno", /scheduleAction\(convo\.id, ACCION_ENTRAR_WF/.test(motor));
{
  // LOS BOTONES NO PIERDEN SU ACCIÓN AL REABRIR EL EDITOR (23/10/2026).
  const lista = ruta.slice(ruta.indexOf("const ACCIONES_DE_BOTON"), ruta.indexOf("];", ruta.indexOf("const ACCIONES_DE_BOTON")));
  comprobar(
    "el editor relee todas las acciones de botón que ofrece",
    ["choose_upsell", "decline_upsell", "show_order_bump", "accept_gift", "decline_gift", "claim_gift", "start_workflow"].every((a) => lista.includes(`"${a}"`))
  );
}
comprobar("el LeadSubmitted sale al entrar al tablero", /sendContactEvent\(\{/.test(motor));
comprobar(
  "Instagram sin asteriscos",
  /message: \{ text: sinFormatoDeWhatsApp\(text\) \}/.test(leer("src", "lib", "instagram", "client.ts"))
);

// ── LO DEL 23/10 TARDE: para vender como COMO HOY / COMO DOU / COMO OB ─────────
console.log("\n· la IA, el método, el upgrade, los seguimientos y el correo");
const pago = leer("src", "lib", "tablero", "pago.ts");
comprobar("la IA solo sabe de lo presentado (Presenta, cobro, entrega)", /presentadosDe\(estado\)/.test(motor) && /anotarPresentados\(convoId, f\.presenta/.test(motor));
comprobar("y del cobro solo el que se cobra: el oculto no se destapa", /anotarPresentados\(convoId, \[principal\]\)/.test(motor));
comprobar("con el método ya elegido no se repregunta", /const yaElegido = metodoVigente\(/.test(motor));
comprobar("nombrar un método para quejarse no es elegirlo", /messageHasPaymentConcern\(contenido\) \? null : metodoQueNombra/.test(motor));
comprobar("«mejor el otro» solo entre lo presentado", /Object\.keys\(precios\)\.filter\(\(id\) => vistos\.has\(id\)\)/.test(motor));
comprobar("los datos son SUS textos por método, sin nombres de métodos en el código", /resolveCountryPaymentProfile\(pais, config\)\?\.payment_responses/.test(pago) && !/["'](yape|plin|bcp)["']\s*[:)]/i.test(pago.replace(/bcp_transferencia/g, "")));
comprobar("el comprobante se valida contra lo que ELIGIÓ", /const elegidoId = estado\.cobro_elegido \?\? f\.cobro\.producto_id/.test(motor));
comprobar("el upgrade cobra la diferencia", /f\.cobro\.diferencia/.test(motor) && /precios\[id\] = Math\.round\(\(v - pagado\) \* 100\) \/ 100/.test(motor));
comprobar("los seguimientos usan las reglas de Ajustes (tardío, silencio, ráfaga)", /defer_late_leads_enabled/.test(motor) && /cumulativeBurstOffset/.test(motor) && /ignora_silencio/.test(motor));
comprobar("y vuelven a contar si el cliente escribe", /contarSeguimientosDesde\(convo\.id, ahora\(\)\)/.test(motor));
comprobar("el correo no sale desde el simulador", /if \(convo\.channel === "test"\) \{\s*console\.log\(`\[tablero:correo\]/.test(motor));
comprobar("y la ficha de correo se guarda (sus burbujas y su texto)", /tipo === "correo"\) && Array\.isArray\(f\.steps\)/.test(datos) && /ficha\.correo_texto = cuerpo/.test(datos));

console.log("\n· muestras, cerebros por etapa, correo, completar y el regalo (24/10)");
comprobar("las muestras solo de lo presentado y una sola vez", /presentadosDe\(estado\)\.flatMap/.test(motor) && /ya\.has\(id\)/.test(motor));
comprobar("una foto que falla no deja mudo al cliente", /no se pudo enviar la muestra/.test(motor));
comprobar("el cerebro general va primero (fijo) y las reglas del dinero siempre", /\(c\.cerebroGeneral \?\? ""\)\.trim\(\) \|\| CEREBRO_DE_FABRICA/.test(ia) && /REGLAS QUE NO SE ROMPEN/.test(ia));
comprobar("y el de la ficha solo en su ficha", /instrucciones: ficha\?\.instrucciones/.test(motor));
comprobar("«¿este es otro?»: la IA sabe lo que ofrece ahora", /LO QUE LE ESTÁS OFRECIENDO AHORA/.test(ia) && /ofreciendoAhora/.test(motor));
comprobar("«completar al otro» solo hacia un cobro con upgrade y sin cobro abierto", /x\.cobro\.diferencia/.test(motor) && /!estado\?\.cobro_ficha_id && !nota/.test(motor));
comprobar("y si estaba en el regalo, sale del regalo antes de cobrar", /cancelPendingActionsForConvo\(convo\.id\);\s*setConversationState\(convo\.id, "tablero"\);\s*\}\s*await irA\(convo\.id, t, upgrade\.id\)/.test(motor));
comprobar("en el regalo, lo que no es del regalo lo contesta el tablero", /deQueHablaConIA\(convo\.id, contenido/.test(motor));
comprobar("el correo: {{ENLACES}} y el de fábrica sin borrador", /enlacesParaElCorreo/.test(motor) && /CORREO_DE_FABRICA/.test(motor));
comprobar("pagar sin cable a la entrega avisa al dueño", /no tiene cable: entrégale a mano/.test(motor));
comprobar("se mide lo que cuesta cada turno", /\[tablero:ia:tokens\]/.test(ia));

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
