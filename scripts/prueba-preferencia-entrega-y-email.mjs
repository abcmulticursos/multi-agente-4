import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const engine = read("src", "lib", "workflow", "engine.ts");
const payment = read("src", "lib", "workflow", "payment.ts");
const brain = read("src", "lib", "openrouter.ts");
let failures = 0;
const check = (name, ok) => {
  if (!ok) failures++;
  console.log(`${ok ? "ok   " : "FALLA"} ${name}`);
};

// La pregunta antes de entregar solamente puede empezar desde el check del editor.
check(
  "la preferencia de entrega exige el check activado",
  /if \(pref\?\.enabled !== true\) return false;/.test(payment)
);
check(
  "solo elegir correo entra en awaiting_email",
  (engine.match(/setConversationState\(convo\.id, "awaiting_email"\)/g) ?? [])
    .length === 1 &&
    /if \(preference === "email"\)[\s\S]{0,400}?setConversationState\(convo\.id, "awaiting_email"\)/.test(
      engine
    )
);
check(
  "la postventa y el upsell no se disfrazan de espera de correo",
  !/function seguirConRegalo[\s\S]{0,600}?setConversationState\(conversationId, "awaiting_email"\)/.test(
    engine
  ) &&
    !/setUpsellState\(convo\.id, "esperando"\);[\s\S]{0,200}?setConversationState\(convo\.id, "awaiting_email"\)/.test(
      engine
    ) &&
    !/setUpsellState\(convo\.id, "ofrecido"\);[\s\S]{0,200}?setConversationState\(convo\.id, "awaiting_email"\)/.test(
      engine
    )
);
check(
  "la IA solo cree que se pidió correo cuando el check es true",
  /post_sale_delivery_preference\?\.enabled === true/.test(brain) &&
    !/post_sale_delivery_preference\?\.enabled !== false/.test(brain)
);

console.log(failures === 0 ? "\nTodo correcto." : `\n${failures} fallo(s).`);
process.exit(failures === 0 ? 0 : 1);
