// El «si» a «te paso los datos» es de la compra, no de una muestra.
//
// LO QUE PASO — el semibucle, con nombre y apellido
//
//   El bot cierra sus turnos con frases de su propio catalogo de CTA:
//
//       «¿Te animas a llevarte el combo? Solo dime y te paso los datos para pagar.»
//
//   El cliente contesta «si». Y la puerta que reenvia los datos sin gastar una
//   llamada al modelo NO se abria. El turno se iba al modelo y el modelo volvia
//   a preguntar: «¿Quieres que te indique como adquirirlo?». Dos «si» para lo
//   mismo, y el cliente esperando unos datos que ya habia pedido dos veces.
//
// LA CAUSA
//
//   `elBotOfrecioEnsenarAlgo` miraba si el bot habia ofrecido ENSENAR algo, para
//   que un «si» a «¿te enseño una foto?» no soltara la cuenta. Bien. Pero su
//   lista incluye «te paso» y NO miraba QUE se pasa. «te paso los datos» entraba
//   como si fuera una muestra.
//
//   O sea: el freno que protege la venta era el que la estaba parando.
//
// EL ARREGLO
//
//   La guarda no se quita —el fallo que tapa es real—: se acota. Si lo ofrecido
//   son los datos, el metodo o como adquirirlo, eso no es una muestra. Y la
//   senal de la muestra de verdad (`assistantOfferedVisualSample`, que exige una
//   palabra visual) sigue intacta y sigue mandando por su cuenta.
//
//   node scripts/prueba-el-si-a-los-datos-de-pago-es-de-la-compra.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const motor = readFileSync(join(RAIZ, "src", "lib", "workflow", "engine.ts"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── La guarda real, sacada del motor ─────────────────────────────────────────
const i = motor.indexOf("function elBotOfrecioEnsenarAlgo(");
if (i < 0) throw new Error("no encuentro elBotOfrecioEnsenarAlgo en engine.ts");
const fin = motor.indexOf("\n}", motor.indexOf("): boolean {", i));
const cuerpo = motor.slice(i, fin) + "\n}";

const armar = (hayMuestraVisual) =>
  new Function(
    "ultimoMensajeDelBot",
    [
      `const assistantOfferedVisualSample = () => ${hayMuestraVisual};`,
      cuerpo
        .replace(
          /function elBotOfrecioEnsenarAlgo\(\s*ultimoMensajeDelBot: string,\s*conversationId: number\s*\): boolean \{/,
          "function elBotOfrecioEnsenarAlgo(ultimoMensajeDelBot, conversationId) {"
        ),
      "return elBotOfrecioEnsenarAlgo(ultimoMensajeDelBot, 1);",
    ].join("\n\n")
  );

const guarda = armar(false);
const guardaConMuestra = armar(true);

// ── 1. Lo que estaba bloqueando la venta ─────────────────────────────────────
console.log("— el bot ofrecio LOS DATOS: el «si» es de la compra —\n");
const OFRECE_EL_PAGO = [
  "¿Te animas a llevarte el combo? Solo dime y te paso los datos para pagar.",
  "¿Te animas a llevarlo? Solo dime y te confirmo el paso a seguir",
  "¿Quieres que te indique cómo adquirirlo?",
  "Solo dime y te paso los datos de pago 😊",
  "¿Te gustaría que te ayude con el método de pago?",
  "¿Te explico cómo adquirirlo?",
  "Si te animas te paso la cuenta y listo",
  "¿Deseas las instrucciones para adquirirlo?",
];
for (const frase of OFRECE_EL_PAGO) {
  comprobar(
    `«${frase.slice(0, 46)}…»`,
    guarda(frase) === false,
    "no bloquea"
  );
}

// ── 2. LA GUARDA SIGUE ENTERA donde protege de verdad ────────────────────────
//    Un «si» a «¿te enseño una foto?» no puede soltar la cuenta. Ese fallo ya
//    se corrigio una vez y no vuelve.
console.log("\n— el bot ofrecio una MUESTRA: sigue bloqueando —\n");
const OFRECE_MUESTRA = [
  "¿Quieres que te muestre qué incluye?",
  "¿Te gustaría ver el contenido?",
  "Te cuento qué incluye si quieres",
  "¿Puedo mostrarte unas muestras?",
  "¿Te interesa conocer el contenido?",
];
for (const frase of OFRECE_MUESTRA) {
  comprobar(`«${frase.slice(0, 46)}…»`, guarda(frase) === true, "bloquea");
}

// ── 3. Y la senal de la muestra de verdad manda por su cuenta ────────────────
//    `assistantOfferedVisualSample` exige una palabra visual (foto, imagen,
//    muestra...). Si ELLA dice que hubo muestra, se bloquea aunque el texto
//    hable de pago: es la senal fiable y no se toca.
console.log("\n— la senal visual sigue mandando por su cuenta —\n");
comprobar(
  "hay muestra visual ofrecida -> bloquea igual",
  guardaConMuestra(
    "¿Te animas a llevarlo? Solo dime y te paso los datos para pagar."
  ) === true,
  "intacta"
);

// ── 4. La forma ──────────────────────────────────────────────────────────────
console.log("\n— la forma del arreglo —\n");
comprobar(
  "la lista de ofrecer enseñar NO se toco",
  /te \(cuento\|explico\|muestro\|enseno\|comparto\|paso\)/.test(motor),
  "se acota, no se quita"
);
comprobar(
  "se mira QUE se ofrece",
  /const loOfrecidoEsElPago =/.test(motor),
  "el objeto del ofrecimiento"
);
comprobar(
  "y la senal visual sigue sumando aparte",
  /assistantOfferedVisualSample\(conversationId\)/.test(motor),
  "sin tocar"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el «si» a los datos de pago ya no se lo come el freno"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
