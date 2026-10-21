// AL RECHAZAR UN COMPROBANTE, EL BOT NO ENSEÑA CÓMO FALSIFICARLO.
//
// LO QUE PASÓ — 30 de septiembre de 2026, seis pruebas en paralelo del dueño. A
// sus clientes les llegaban mensajes como estos:
//
//     «No pude validar ese comprobante: El comprobante muestra que el pago fue a
//      "Alberto Salinas", pero debe coincidir con "franko" (al menos el nombre o
//      el apellido). Por favor envíame una foto clara...»
//
//     «...necesito ver la FECHA en el comprobante. Las imágenes sin fecha (como
//      un afiche) no se aceptan...»
//
// Con sus palabras: «no puedes darle tips de cómo darme un comprobante, eso hace
// que puedan falsificar el nombre».
//
// Y el texto llegaba al cliente por DOS caminos —el respaldo determinista y la
// IA, a la que el prompt le pide «explícale el motivo»—, así que la única forma
// de cerrar los dos era quitar la pista del MOTIVO mismo. Por eso se arregla en
// payment.ts y no en el prompt: un cambio de prompt no es quirúrgico.
//
// LA EXCEPCIÓN, Y ES A PROPÓSITO: cuando el comprobante está a nombre de OTRA
// persona, sí se dicen los dos nombres. Lo pidió él, y su motivo es suyo: «para
// que el cliente no se pase de listo y mande un solo nombre, sino que vea que el
// comprobante debe corresponder realmente al receptor». Se enseña el nombre
// COMPLETO aunque por dentro solo se valide la primera palabra.
//
//   node scripts/prueba-el-rechazo-no-da-pistas.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const pago = readFileSync(join(RAIZ, "src", "lib", "workflow", "payment.ts"), "utf8");
const router = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 54)} ${valor}`);
};

// Solo el texto que VE EL CLIENTE. Los comentarios del código cuentan el fallo
// real —ahí las frases viejas tienen que poder citarse— así que se quitan antes
// de buscar; si no, esta prueba se pondría roja por su propia explicación.
const sinComentarios = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const pagoVivo = sinComentarios(pago);
const routerVivo = sinComentarios(router);

// ── 1. LA FECHA: NI SE NOMBRA ───────────────────────────────────────────────
console.log("\n— 1. sin fecha: se pide mejor foto, no se dice que falta la fecha —\n");
comprobar(
  "ya no le dice que necesita ver la FECHA",
  !/necesito ver la FECHA/.test(pagoVivo),
  "era la pista"
);
comprobar(
  "ni le explica lo del afiche",
  !/como un afiche/.test(pagoVivo),
  "le decia que imagen no sirve"
);
comprobar(
  "el motivo tecnico queda en el registro",
  /comprobante SIN FECHA y el país la exige/.test(pago),
  "para poder diagnosticar"
);

// ── 2. SIN NOMBRE VISIBLE: TAMPOCO SE NOMBRA ────────────────────────────────
console.log("\n— 2. sin nombre visible: lo mismo —\n");
comprobar(
  "ya no le dice que necesita ver el nombre del receptor",
  !/necesito ver el nombre del receptor/.test(pagoVivo)
);
comprobar(
  "el motivo tecnico queda en el registro",
  /SIN nombre de receptor visible/.test(pago)
);

// ── 3. NOMBRE EQUIVOCADO: AQUI SI SE DICEN LOS DOS, Y ENTERO ────────────────
console.log("\n— 3. a nombre de otro: se dicen los dos nombres —\n");
comprobar(
  "dice a nombre de quien esta",
  /El comprobante está a nombre de "\$\{args\.recipient_name\}"/.test(pagoVivo),
  "lo que el cliente mando"
);
comprobar(
  "y a nombre de quien debe estar",
  /debe estar a nombre de "\$\{expectedComoLoEscribio\}"/.test(pagoVivo),
  "lo que el dueño escribio"
);
// LA INTENCION NO CAMBIA: al cliente se le enseña el nombre TAL COMO el dueño lo
// escribio —ni en minusculas ni recortado a la primera palabra—, porque la
// validacion si usa solo la primera y ensenarsela le diria que con un solo nombre
// basta.
//
// Lo que cambio es de donde sale: desde el 30/09/2026 lo devuelve `elCobroDelPais`,
// la puerta unica del cobro, que es tambien la que da el nombre que se le ensena al
// cliente. Por eso no pueden desalinearse. Lo que se comprueba es que ese valor
// llegue ENTERO: sin `toLowerCase` y sin recorte en esa linea.
comprobar(
  "se enseña TAL COMO EL LO ESCRIBIO, no en minusculas",
  /const expectedComoLoEscribio = elCobroDelPais\(countryCode, config\)\.titular;/.test(
    pago
  ) &&
    /const expectedPrefix = expectedComoLoEscribio\.toLowerCase\(\);/.test(pago),
  "sin recortar a la primera palabra"
);
comprobar(
  "pero por dentro se sigue validando la primera palabra",
  /\.filter\(\(t\) => t\.length >= 3\)\s*\r?\n?\s*\.slice\(0, 1\);/.test(pago),
  "el pedido es cosmetico a proposito"
);
comprobar(
  "y se quito «al menos el nombre o el apellido»",
  !/al menos el nombre o el apellido/.test(pagoVivo),
  "esa coletilla decia que bastaba una parte"
);

// ── 4. DE USTED, NUNCA DE TU ────────────────────────────────────────────────
console.log("\n— 4. sin tuteo —\n");
for (const [frase, donde, texto] of [
  ["envíeme una foto más clara", pagoVivo, "los dos rechazos nuevos"],
  ["envíeme el comprobante correcto", pagoVivo, "el del nombre"],
  ["envíeme una foto más clara", routerVivo, "el respaldo del modo comprobante"],
]) {
  comprobar(`«${frase}»`, donde.includes(frase), texto);
}

// ── 5. EL RESPALDO SOLO CUANDO NO SE LEYO NINGUN COMPROBANTE ────────────────
//
// Era el que le puso al cliente «envíame una foto clara donde se vea el monto, la
// fecha y la operación» con un comprobante perfecto que solo estaba repetido: se
// disparaba tambien con el modelo habiendo contestado, y le tiraba la respuesta.
console.log("\n— 5. el respaldo del modo comprobante no pisa al modelo —\n");
comprobar(
  "existe la marca de «ya se leyo un comprobante»",
  /let yaSeLeyoUnComprobante = false;/.test(router)
);
comprobar(
  "se enciende al ejecutar la herramienta del pago",
  /REGISTER_PAYMENT_TOOL\.function\.name[\s\S]{0,120}?yaSeLeyoUnComprobante = true;/.test(
    router
  )
);
comprobar(
  "y el respaldo solo salta si NO se leyo ninguno",
  /if \(!yaSeLeyoUnComprobante\) \{/.test(router),
  "antes saltaba siempre"
);
// LA SEÑA INTERNA NO PUEDE SALIR AL CHAT. Al lector se le ORDENA responder
// «NO_COMPROBANTE» cuando la imagen no es un comprobante; es una seña entre él y
// el motor. El 30/09/2026 se le escapó a un cliente del dueño.
comprobar(
  "«NO_COMPROBANTE» se caza antes de enviarse",
  /NO\[_\\s-\]\?COMPROBANTE\/i\.test\(text\)/.test(router),
  "tolerante con guion y espacio"
);
comprobar(
  "y en su lugar sale una frase de verdad",
  /NO\[_\\s-\]\?COMPROBANTE[\s\S]{0,300}?No pude validar ese comprobante\. Por favor envíeme/.test(
    router
  )
);
comprobar(
  "ese respaldo ya no enumera monto, fecha y operacion",
  !/se vea el monto, la fecha y la operación/.test(routerVivo),
  "era la lista de requisitos"
);

// ── 6. LO QUE NO SE TOCA ────────────────────────────────────────────────────
console.log("\n— 6. lo que sigue igual —\n");
comprobar(
  "el pago parcial sigue diciendo cuanto falta",
  /Aún falta completar/.test(routerVivo),
  "ahi el cliente SI necesita el dato"
);
comprobar(
  "el nombre sigue revisandose solo en yape y plin",
  /if \(args\.payment_method === "yape" \|\| args\.payment_method === "plin"\) \{/.test(
    pago
  )
);
comprobar(
  "la huella del comprobante repetido sigue en pie",
  /const isDuplicateReceipt = fingerprints\.some\(\(f\) => countedSet\.has\(f\)\);/.test(
    pago
  ),
  "el dueño pidio expreso no tocarla"
);
comprobar(
  "y sin nombre configurado no se revisa nada",
  /expectedTokens\.length === 0 \|\|/.test(pago)
);

console.log(
  fallos === 0
    ? "\nTODO OK — el rechazo no enseña a falsificar, y el nombre se pide entero a proposito\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
