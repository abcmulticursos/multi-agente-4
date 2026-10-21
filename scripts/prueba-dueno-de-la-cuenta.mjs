// De que negocio es una cuenta publicitaria.
//
// EL FALLO QUE SE ARREGLO
//
// Se recorrian todos los negocios que el token alcanza y, de cada uno, se
// miraban A LA VEZ sus cuentas PROPIAS y las de CLIENTE —las que ese negocio ve
// por ser socio, sin ser suyas—. Se devolvia el primero que coincidiera, asi
// que si un socio aparecia antes que el dueño, la consulta contestaba con el
// nombre equivocado.
//
// Y no parecia un error: contesta un nombre real, de un negocio que existe.
// Solo que no es el que se pregunto. Salio consultando una cuenta de un BM y
// recibiendo el nombre de otro con nombre parecido.
//
// Lo que se fija aqui:
//
//  1. Que primero se le pregunte a la CUENTA quien es su dueño. Una llamada, y
//     es la verdad, no una deduccion.
//  2. Que al recorrer negocios, las cuentas PROPIAS de todos se miren antes que
//     las de cliente. Si se mezclaran, un socio listado antes del dueño volveria
//     a ganar.
//  3. Que cuando solo se llego por acceso compartido se DIGA. Ahi no se sabe
//     quien es el dueño; callarlo seria repetir el fallo con otra cara.
//  4. Que las dos consultas —buscar un anuncio y listar campañas— usen esto
//     mismo. El fallo estaba en las dos.
//
//   node scripts/prueba-dueno-de-la-cuenta.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const duenno = leer("src", "lib", "meta", "dueno-de-la-cuenta.ts");
const origen = leer("src", "app", "api", "meta", "ads-readers", "origin", "route.ts");
const cuenta = leer("src", "app", "api", "meta", "ads-readers", "account", "route.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. Preguntar antes que deducir ──────────────────────────────────────────
comprobar(
  "primero se le pregunta el dueño a la cuenta",
  /business\{id,name\},owner_business\{id,name\}/.test(duenno),
  "una llamada"
);
comprobar(
  "y el dueño manda sobre el negocio de paso",
  /comoNegocio\(cuenta\?\.owner_business\) \?\? comoNegocio\(cuenta\?\.business\)/.test(
    duenno
  ),
  "owner primero"
);

// ── 2. Propias antes que de cliente ─────────────────────────────────────────
//
// El orden de los bucles es LO que arregla el fallo: el edge por fuera y los
// negocios por dentro. Al reves —negocios por fuera— se volveria a mirar las
// dos listas de un mismo negocio antes de pasar al siguiente, que es
// exactamente como se colaba el socio.
comprobar(
  "las cuentas propias de TODOS van antes que las de cliente",
  /for \(const edge of \["owned_ad_accounts", "client_ad_accounts"\]\)\s*\{\s*for \(const fila of filas\)/.test(
    duenno
  ),
  "edge por fuera"
);

// ── 3. No callar lo que no se sabe ──────────────────────────────────────────
comprobar(
  "se marca cuando solo es acceso compartido",
  /compartido: edge === "client_ad_accounts"/.test(duenno),
  "sí"
);
comprobar(
  "y eso se ve en el nombre que se muestra",
  /\(acceso compartido\)/.test(duenno),
  "sí"
);
comprobar(
  "el dueño de verdad no lleva ninguna coletilla",
  /compartido \? `\$\{negocio\.name\} \(acceso compartido\)` : negocio\.name/.test(
    duenno
  ),
  "limpio"
);

// ── 4. Las dos consultas, arregladas ────────────────────────────────────────
comprobar(
  "buscar un anuncio usa esto",
  /negocioDeLaCuenta\(accountId, accessToken\)/.test(origen),
  "sí"
);
comprobar(
  "listar campañas también",
  /negocioDeLaCuenta\(accountId, token\)/.test(cuenta),
  "sí"
);
comprobar(
  "ya no queda el recorrido que se equivocaba",
  !/client_ad_accounts/.test(origen) && !/client_ad_accounts/.test(cuenta),
  "fuera"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
