// El regalo y el segundo producto pueden estar abiertos A LA VEZ. Quien se
// queda cada respuesta no lo puede decidir el orden del codigo.
//
// QUE PASABA
//
//   La oferta del segundo producto NO se cierra cuando sale el regalo — a
//   proposito, para no perder la venta. Asi que hay dos preguntas en pantalla y
//   un «si» suelto lo puede reclamar cualquiera.
//
//   El bloque del upsell esta escrito mas arriba, asi que se quedaba el «si»
//   del regalo. Y habia algo peor: el boton del regalo llegaba DISFRAZADO.
//   El webhook le cambiaba el texto por "Si quiero", pasara lo que pasara con
//   la etiqueta configurada — y "si quiero" es palabra por palabra una de las
//   claves tipicas del cuadrito del upsell.
//
//   Resultado: tocar el boton del REGALO compraba el SEGUNDO PRODUCTO. Siempre,
//   no por casualidad. Y ponerle otra etiqueta al boton no servia de nada,
//   porque la etiqueta se tiraba en el webhook.
//
// COMO QUEDA
//
//   El texto del boton viaja tal cual —como ya se hacia con los del producto
//   extra— y el motor lo reconoce comparandolo contra las etiquetas
//   configuradas: exacto, sin adivinar. Una etiqueta tocada es un HECHO; una
//   palabra clave es una suposicion. Asi que se mira primero.
//
//   node scripts/prueba-el-boton-manda-sobre-la-palabra.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const motor = leer("src", "lib", "workflow", "engine.ts");
const config = leer("src", "lib", "workflow", "config.ts");
const webhook = leer("src", "lib", "meta", "handler.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. Se acabo el disfraz ───────────────────────────────────────────────────
comprobar(
  "el boton del regalo viaja con SU texto",
  /id\.startsWith\("gift_accept:"\) \|\| id\.startsWith\("gift_reject:"\)[\s\S]{0,1400}?text = title\.trim\(\);/.test(
    webhook
  ),
  "sin disfraz"
);
// El disfraz exacto que causaba el choque. Que no vuelva.
comprobar(
  "ya no se cambia por «Si quiero»",
  !/text = "Si quiero";/.test(webhook) && !/text = "Por ahora no";/.test(webhook),
  "fuera"
);
// Los del producto extra ya viajaban asi. Que sigan.
comprobar(
  "los del producto extra siguen igual",
  /id === "upsell_si" \|\| id === "upsell_no"/.test(webhook),
  "no se toco"
);

// ── 2. El motor reconoce la etiqueta, no la adivina ──────────────────────────
comprobar(
  "hay un reconocedor por etiqueta para el regalo",
  /export function botonDelRegalo\(/.test(config),
  "botonDelRegalo"
);
comprobar(
  "compara exacto contra las etiquetas configuradas",
  /formas\.some\(\(f\) => f\.length > 0 && f === recibido\)/.test(config),
  "sin adivinar"
);
// WhatsApp corta las etiquetas a 20 caracteres: una larga vuelve recortada y
// una comparacion literal fallaria justo en el «si».
comprobar(
  "acepta la etiqueta cortada a 20 caracteres",
  /limpiar\(cruda\.slice\(0, 20\)\)/.test(config),
  "el tope de WhatsApp"
);
// Un boton "text" abre conversacion, no decide. Tratarlo como aceptacion seria
// regalar el premio a quien solo preguntaba.
comprobar(
  "un boton de solo texto no decide nada",
  /if \(boton\.action === "reject"\) return "no";\s*\r?\n\s*\/\/ action "text" no decide/.test(
    config
  ),
  "abre conversacion"
);
// Y sin el interruptor de botones no hay etiquetas que valgan: quien no los usa
// se queda exactamente como estaba.
comprobar(
  "sin botones encendidos no se aplica nada",
  /if \(!gift\?\.consent_buttons_enabled\) return null;/.test(config),
  "no toca a quien no los usa"
);

// ── 3. Y se mira ANTES que las palabras clave ────────────────────────────────
//
// Este es el punto entero: el bloque del regalo tiene que quedar por ENCIMA del
// bloque del upsell en el archivo. Si alguien lo mueve, vuelve el choque.
const iRegalo = motor.indexOf('const botonRegalo = botonDelRegalo(msgContent, config);');
const iUpsell = motor.indexOf('if (convo.upsell_state === "ofrecido") {');
comprobar(
  "el boton del regalo se mira antes que el cuadrito del upsell",
  iRegalo > 0 && iUpsell > 0 && iRegalo < iUpsell,
  iRegalo > 0 && iUpsell > 0 ? `${iRegalo} < ${iUpsell}` : "no se encontro"
);
// Solo mientras esa pregunta este de verdad abierta: una etiqueta suelta fuera
// de su momento no puede aceptar un regalo que nadie ofrecio.
comprobar(
  "y solo con la pregunta del regalo abierta",
  /if \(convo\.state === "awaiting_gift_consent"\) \{\s*\r?\n\s*const botonRegalo = botonDelRegalo/.test(
    motor
  ),
  "en su momento"
);

// ── 4. EL BOT MUDO ───────────────────────────────────────────────────────────
//
// El cuadrito «NO» suele estar sin burbujas —el rechazo lo contesta el flujo del
// regalo— y sin accion —no hay ninguna de rechazo—. Con la oferta abierta, un
// «no» del regalo caia ahi, no salia nada, y el turno se daba por atendido:
// el cliente escribia y NO CONTESTABA NADIE.
comprobar(
  "un cuadrito vacio y sin accion no se queda el turno",
  /if \(salioAlgo \|\| tieneBurbujas \|\| cuadrito\.action\) \{/.test(motor),
  "deja pasar el mensaje"
);
comprobar(
  "y queda escrito por que lo dejo pasar",
  /está vacío y sin acción → dejo pasar el mensaje/.test(motor),
  "no se calla"
);

console.log(
  fallos === 0
    ? "\nTODO OK — la etiqueta manda sobre la palabra clave"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
