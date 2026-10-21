// EL SELLO DE LA CONVERSACION SALE DE LA TIENDA, NO DEL SELECTOR GENERAL
//
// EL SELLO es la nota que el bot le pega a una conversacion cuando el cliente saluda: «esta
// se vende con un producto» o «con dos». Se escribe UNA vez y no se cambia, para que mover el
// selector no le cambie la pelicula a un cliente a medias.
//
// EL FALLO. Esa nota se escribia leyendo el selector GENERAL, porque en ese punto del
// `handler` todavia no hay tienda abierta —la abre `conElTurnoDe` cien lineas mas abajo—. La
// tienda llegaba tarde.
//
// LO QUE COSTO, y lo vio el dueño testeando el 05/10/2026, dos veces el mismo dia:
//
//   · Puso su tienda en COMO -DOU- y el bot le soltó la intro de otra cosa: «acabo de poner
//     modalidad lineal... elegi mi tienda de grafismo fonético y me soltó la intro de dou».
//   · Y una conversacion NATIVA de -OB- recibia «hemos actualizado nuestro contenido y ahora
//     tenemos 2 opciones disponibles para ti» — el aviso de una transicion que nunca ocurrio.
//     Con sus palabras: «cuando nace conversación PURA COMO DOU O COMO OB eso de novedad no
//     debe existir».
//
// Y LE IMPEDIA LO QUE MAS NECESITA: «en una tienda voy a vender en lineal en la otra como ob,
// y otra comodou». El general solo puede decir UNA cosa, asi que las conversaciones nuevas
// nacian todas con la misma y «un numero, una venta» quedaba a medias.
//
// EL ARREGLO. Se envuelve esa llamada con la tienda de la conversacion. Una linea.
//
//   node scripts/prueba-el-sello-sale-de-la-tienda.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const handler = leer("src", "lib", "meta", "handler.ts");
const config = leer("src", "lib", "workflow", "config.ts");

let fallos = 0;
const comprobar = (titulo, condicion, detalle) => {
  const marca = condicion ? "  ok  " : "> FALLA";
  if (!condicion) fallos++;
  console.log(`${marca} ${String(titulo).padEnd(58)} ${detalle ?? ""}`);
};

// -- 1. EL ARREGLO ----------------------------------------------------------
comprobar(
  "el sello se escribe con la tienda puesta",
  /const presentacionAlNacer = conLaTiendaDelTurno\(\s*\r?\n\s*laTiendaDeLaConversacion\(convo\),\s*\r?\n\s*\(\) => laPresentacionConLaQueNace\(convo\)\s*\r?\n\s*\);/.test(
    handler
  ),
  "antes se leia el general"
);
comprobar(
  "y ya no se llama a pelo",
  !/^\s*const presentacionAlNacer = laPresentacionConLaQueNace\(convo\);/m.test(
    handler
  ),
  "esa era la linea del fallo"
);

// -- 2. SIN TIENDAS, TODO COMO HOY -----------------------------------------
//
// Es la garantia de este proyecto: una instalacion sin tiendas no puede notar nada. El
// envoltorio devuelve la llamada tal cual cuando no hay tienda.
comprobar(
  "sin tienda el envoltorio no envuelve nada",
  /if \(!tienda\) return fn\(\);/.test(config),
  "se lee el general, letra por letra"
);

// -- 3. LO QUE NO SE TOCA --------------------------------------------------
//
// El pidio el arreglo «SIN MALOGRAR». Estas son las piezas que comparten este tramo del
// handler: si alguna se hubiera movido, el arreglo habria dejado de ser quirurgico.
for (const [que, patron] of [
  ["el turno sigue abriendose abajo igual", /await conElTurnoDe\(convo, async \(\) => \{/],
  ["el precio sigue congelandose al nacer", /freezePricesForConvo\(convo\)/],
  ["el numero de salida se sigue anotando", /setConversationWaPhoneNumberId\(convo\.id, getOutboundWhatsAppNumber\(\)\)/],
  ["el sello sigue escribiendose una sola vez", /fijarPresentacionDeVentaSiFalta\(convo\.id, presentacionAlNacer\)/],
  ["y sigue quedando en el registro", /vende con la presentación «\$\{presentacionAlNacer\}» y se queda con ella/],
]) {
  comprobar(que, patron.test(handler), "intacto");
}

// -- 4. Y LA REGLA DEL AVISO NO SE TOCO ------------------------------------
//
// El aviso de «hemos actualizado» ya estaba escrito como el lo queria: solo sale si la
// conversacion nacio con un producto. No habia que cambiarlo — habia que darle un sello
// correcto que leer. Se vigila que siga igual, para que nadie «arregle» el aviso mañana
// creyendo que el fallo estaba ahi.
comprobar(
  "el aviso sigue pidiendo que la convo naciera con un producto",
  /if \(convo\.presentacion_de_venta !== "ninguna"\) return false;/.test(config),
  "la regla ya era correcta"
);

console.log("");
if (fallos > 0) {
  console.log(`> ${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — el sello sale de la tienda, y sin tiendas todo sigue igual");
