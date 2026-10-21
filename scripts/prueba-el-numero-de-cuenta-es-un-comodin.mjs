// El numero de cuenta se escribe UNA vez y se inserta con {{NUMERO_DE_CUENTA}}.
//
// POR QUE EXISTE
//
//   El numero vivia escrito a mano DENTRO de cada cajon de datos de pago. Con
//   cuatro cajones por pais, cambiar de cuenta obligaba a editarlos todos, uno
//   por uno, en cada pais. Bastaba olvidar uno para seguir cobrando en una
//   cuenta que ya no es tuya, y nada avisaba de eso.
//
// EL CAMINO COMPLETO, QUE ES LO QUE ESTA PRUEBA VIGILA
//
//   Un campo del panel que no recorre las SIETE paradas es un campo muerto:
//   acepta lo que escribes y lo tira sin dar error. Ya paso en esta casa con el
//   «antes» de la opcion cara y con el precio del tercer producto.
//
//     1. el tipo del perfil de pais (motor)
//     2. la puerta que lo lee por pais (motor)
//     3. la sustitucion en el mensaje real (motor)
//     4. el tipo del editor
//     5. la vista previa del editor
//     6. la API, de ida Y de vuelta
//     7. la pantalla donde se escribe
//
// DONDE VIVE Y POR QUE
//
//   En el perfil del PAIS, como los cuatro cajones de pago, y no como el nombre
//   del receptor. Una cuenta es de un pais concreto: un respaldo global serviria
//   el numero de otro pais al cliente equivocado.
//
// LO QUE NO ES
//
//   No valida nada. El comprobante se sigue aprobando por monto y por el nombre
//   del receptor. Si alguien lo mete en la validacion, esta prueba se pone roja.
//
//   node scripts/prueba-el-numero-de-cuenta-es-un-comodin.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const config = leer("src", "lib", "workflow", "config.ts");
const sender = leer("src", "lib", "workflow", "sender.ts");
const pago = leer("src", "lib", "workflow", "payment.ts");
const editor = leer("src", "app", "editor", "page.tsx");
const ruta = leer("src", "app", "api", "workflow", "route.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// -- 1 y 2. EL MOTOR LO CONOCE Y LO LEE POR PAIS -----------------------------
comprobar(
  "el perfil del pais tiene el campo",
  /numero_de_cuenta\?: string;/.test(config),
  "config.ts"
);
// SIGUE HABIENDO UNA SOLA PUERTA. Lo que cambio el 30/09/2026 es que ademas del
// pais recibe el METODO: se midio que en un pais se cobra por billetera Y por
// banco, y son cuentas distintas. Ver `prueba-una-cuenta-por-metodo`.
comprobar(
  "hay UNA puerta que lo resuelve por pais",
  /export function getNumeroDeCuenta\(\s*\r?\n?\s*phone\?: string \| null,\s*\r?\n?\s*metodo\?: string \| null\s*\r?\n?\s*\): string \{/.test(
    config
  ),
  "getNumeroDeCuenta"
);
// Sin respaldo global A PROPOSITO: serviria la cuenta de otro pais.
//
// LA INTENCION NO CAMBIA. Lo que cambio es que desde el 30/09/2026 la cuenta puede
// venir del USUARIO QUE COBRA en esa tienda antes que del pais —el almacen de
// cobradores— y los tres datos del cobro salen juntos de `elCobroDelPais` para que
// el titular que valida y la cuenta a la que se paga sean siempre de la misma
// persona. Lo que se sigue comprobando es lo mismo: que detras del usuario esta el
// perfil del pais, y que NO hay respaldo global.
comprobar(
  "y sale del perfil del pais, sin respaldo global",
  /laCuentaDelMetodo\(perfil, metodo\) \|\|\s*\r?\n?\s*limpio\(perfil\?\.numero_de_cuenta\),/.test(
    config
  ) && !/config\?\.numero_de_cuenta/.test(config),
  "cada pais el suyo"
);

// -- 3. SE SUSTITUYE EN EL MENSAJE QUE LE LLEGA AL CLIENTE --------------------
comprobar(
  "el motor lo sustituye al enviar",
  /\(numero_de_cuenta\|numero_cuenta\|cuenta\|account_number\)/.test(sender) &&
    /literal\(numeroDeCuenta \|\| "\[Número de cuenta sin configurar\]"\)/.test(
      sender
    ),
  "sender.ts"
);
// TIENE QUE IR DESPUES DE LOS CAJONES.
//
// `expandirCajonesDePagoDelPais` pone el texto de «Datos de pago 1/2/3» y es
// justo AHI dentro donde se va a escribir el numero. Si esta sustitucion fuera
// antes, el comodin de dentro del cajon saldria crudo al cliente.
const posCajones = sender.indexOf("expandirCajonesDePagoDelPais(text, convo)");
const posCuenta = sender.indexOf("numero_de_cuenta|numero_cuenta");
comprobar(
  "y va DESPUES de abrir los cajones de pago",
  posCajones > 0 && posCuenta > posCajones,
  "funciona dentro de un cajon"
);

// -- 4 y 5. EL EDITOR --------------------------------------------------------
comprobar(
  "el editor conoce el campo",
  /numero_de_cuenta\?: string;/.test(editor),
  "mismo nombre que el motor"
);
comprobar(
  "esta en el catalogo de comodines",
  /token: "\{\{NUMERO_DE_CUENTA\}\}"/.test(editor),
  "se puede descubrir sin preguntar"
);
comprobar(
  "la vista previa lo resuelve igual que el motor",
  /\(numero_de_cuenta\|numero_cuenta\|cuenta\|account_number\)/.test(editor) &&
    /numeroDeCuenta: selectedProfile\?\.numero_de_cuenta \?\? ""/.test(editor),
  "lo que ves es lo que sale"
);

// -- 6. LA API, DE IDA Y DE VUELTA -------------------------------------------
//
// La API no guarda lo que le llega: RECONSTRUYE el perfil campo por campo. Un
// campo que no este nombrado en las DOS direcciones se descarta en silencio.
comprobar(
  "la API lo lee del yaml",
  /numero_de_cuenta: str\(p\?\.numero_de_cuenta\),/.test(ruta),
  "de vuelta"
);
comprobar(
  "y lo escribe al guardar",
  /numero_de_cuenta: str\(p\?\.numero_de_cuenta\)\.trim\(\),/.test(ruta),
  "de ida"
);

// -- 7. LA PANTALLA ----------------------------------------------------------
comprobar(
  "hay donde escribirlo, en Usuario",
  /Número de cuenta\s*\r?\n?\s*<\/span>/.test(editor) &&
    /onDatos\(\{ numero_de_cuenta: e\.target\.value \}\)/.test(editor),
  "junto al receptor"
);
// El nombre del receptor lleva ahora su papel escrito al lado.
comprobar(
  "el nombre dice que es el receptor",
  /Mi nombre \(Receptor\)/.test(editor),
  "sin adivinar"
);
// Y NO SE RECORTA AL ESCRIBIRLO.
//
// Mismo fallo que tuvo el nombre: recortar el valor y devolverlo al input hace
// imposible teclear un espacio. Un numero de cuenta se escribe con espacios.
comprobar(
  "se puede escribir con espacios",
  /const numeroDeCuenta = perfil\.numero_de_cuenta \?\? "";/.test(editor) &&
    /value=\{numeroDeCuenta\}/.test(editor),
  "935 286 681"
);

// -- LO QUE NO DEBE PASAR ----------------------------------------------------
comprobar(
  "NO se mete en la validacion del comprobante",
  !/numero_de_cuenta/.test(pago),
  "sigue aprobando por monto y receptor"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
