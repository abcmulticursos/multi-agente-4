// EL AVISO DE «HEMOS ACTUALIZADO» NO SALE AL PASAR A COMO -OB-
//
// EL AVISO es el puente para el cliente que empezó viendo UN producto cuando el dueño pasa a
// vender dos: «hemos actualizado nuestro contenido y ahora tenemos 2 opciones disponibles
// para ti», con los dos nombres. Sin él, ese cliente no se enteraría nunca.
//
// LO PIDIO EL DUEÑO el 05/10/2026, para la transicion a -OB-: «no debería ir en la transición
// de comolineal a comoob, es innecesario ya que cuando la persona elige pagar aparecen los 2
// productos, así haya venido desde como lineal».
//
// Y HAY UNA SEGUNDA RAZON, MAS GRAVE QUE LA QUE EL DIO: ese aviso NOMBRA LOS DOS PRODUCTOS.
// En -OB- el segundo esta OCULTO a proposito —de el no se dice ni el precio ni el contenido
// hasta que el cliente decide pagar o elige metodo, y eso esta en «lo intocable» de
// CLAUDE.md—. El aviso lo revelaba de entrada: no era solo innecesario, se saltaba la regla
// de la modalidad.
//
// EN -DOU- SE QUEDA, y por eso no se borro el aviso: ahi los dos productos se presentan desde
// el primer mensaje, asi que al cliente que venia de uno HAY que contarle que ahora hay dos.
//
//   node scripts/prueba-el-aviso-no-revela-el-producto-oculto.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const config = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);

let fallos = 0;
const comprobar = (titulo, condicion, detalle) => {
  const marca = condicion ? "  ok  " : "> FALLA";
  if (!condicion) fallos++;
  console.log(`${marca} ${String(titulo).padEnd(58)} ${detalle ?? ""}`);
};

// El cuerpo de la funcion, para que las comprobaciones no cacen texto de otra parte del
// archivo, que tiene seis mil lineas.
const cuerpo = (() => {
  const i = config.indexOf("export function hayQueAvisarDeLaActualizacion(");
  const f = config.indexOf("export function laRespuestaCuentaLaNovedad(", i);
  return i < 0 || f < 0 ? "" : config.slice(i, f);
})();
comprobar("se encuentra la funcion del aviso", cuerpo.length > 0, "hayQueAvisarDeLaActualizacion");

// -- 1. EL ARREGLO ----------------------------------------------------------
comprobar(
  "en -OB- no avisa",
  /if \(laPresentacionQueDiceElSelector\(config\) === "segunda_oculta"\) return false;/.test(
    cuerpo
  ),
  "ahi el segundo producto esta oculto"
);
// SE PREGUNTA AL SELECTOR QUE MANDA, que dentro del turno es el de la tienda. Si se
// preguntara al global, una tienda en -OB- avisaria por lo que diga otra.
comprobar(
  "y lo decide la tienda, no el selector global",
  /const valor = elSelectorQueManda\(config\);/.test(config),
  "cada tienda con lo suyo"
);

// -- 2. EN -DOU- SE QUEDA ---------------------------------------------------
//
// Es la mitad que NO se podia perder: borrar el aviso habria dejado sin puente al cliente
// de -DOU-, que si necesita saber que ahora hay dos.
comprobar(
  "el aviso sigue existiendo para -DOU-",
  /return getActiveTwoTierOffer\(config\) !== null;/.test(cuerpo),
  "ahi los dos se presentan desde el inicio"
);

// -- 3. LAS GUARDAS DE ANTES, INTACTAS -------------------------------------
//
// El pidio el cambio «sin malograr el comportamiento del bot». Estas cinco ya estaban y cada
// una viene de un fallo suyo: si alguna se hubiera caido, el aviso volveria a salir donde ya
// se habia quitado.
for (const [que, patron] of [
  ["solo con el modo reenganche encendido", /if \(config\.modo_reenganche !== true\) return false;/],
  ["una sola vez por conversacion", /if \(convo\.aviso_actualizacion_enviado === 1\) return false;/],
  ["no a quien no ha visto ninguna intro", /if \(convo\.intro_variant_sent == null\) return false;/],
  ["solo si nacio con UN producto", /if \(convo\.presentacion_de_venta !== "ninguna"\) return false;/],
  ["nunca despues de pagar", /if \(\(convo\.paid_total_cents \?\? 0\) > 0\) return false;/],
  ["ni en la postventa", /ESTADOS_DE_POSTVENTA\.has\(\(convo\.state \?\? ""\)\.trim\(\)\)/],
]) {
  comprobar(que, patron.test(cuerpo), "intacta");
}

console.log("");
if (fallos > 0) {
  console.log(`> ${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — en -OB- el producto oculto sigue oculto, y en -DOU- el puente sigue");
