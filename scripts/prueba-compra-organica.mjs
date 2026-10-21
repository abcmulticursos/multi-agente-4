// Qué evento de compra se le manda a Meta según de dónde vino el cliente.
//
// Antes, si el cliente no traía `ctwa_clid` (entró orgánico, no por un
// anuncio), la compra no se reportaba en absoluto. Ahora se reporta por el
// camino `system_generated`, que no exige click. Esta prueba fija las dos
// cosas que importan: que el orgánico ya se reporte, y que el que SÍ vino de
// un anuncio siga yendo exactamente como antes, con su ctwa_clid, para no
// perder ni una atribución.
//
// Corre sobre el CÓDIGO REAL: compila conversions.ts y le pide el evento. No
// hace ninguna llamada a Meta. Base de datos en memoria (NEXT_PHASE).
//
//   node scripts/prueba-compra-organica.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const RAIZ = process.cwd();
const TMP = join(RAIZ, "scripts", "_tmp-organico");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

writeFileSync(
  join(TMP, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        outDir: ".",
        module: "commonjs",
        target: "es2022",
        moduleResolution: "node",
        skipLibCheck: true,
        esModuleInterop: true,
        resolveJsonModule: true,
        noEmit: false,
        baseUrl: "../..",
        paths: { "@/*": ["src/*"] },
      },
      include: ["../../src/lib/meta/conversions.ts"],
    },
    null,
    2
  ),
  "utf8"
);

try {
  execFileSync(
    process.execPath,
    [join(RAIZ, "node_modules", "typescript", "bin", "tsc"), "-p", join(TMP, "tsconfig.json")],
    { stdio: "pipe" }
  );
} catch {
  // Los tipos ambientales del proyecto se quejan aquí y no pintan nada. Si el
  // archivo no se hubiera escrito, el require de abajo falla y nos enteramos.
}

process.env.NEXT_PHASE = "phase-production-build";
const require = createRequire(import.meta.url);
const Module = require("node:module");
const resolverOriginal = Module._resolveFilename;
Module._resolveFilename = function (peticion, ...resto) {
  if (peticion.startsWith("@/lib/")) {
    peticion = join(TMP, peticion.slice("@/lib/".length));
  }
  return resolverOriginal.call(this, peticion, ...resto);
};

const { buildPurchasePayload, buildMessagingUserData } = require(
  join(TMP, "meta", "conversions.js")
);

const TELEFONO = "51987654321";
const CLICK = "ctwa_abc123";

const compra = (userData) =>
  buildPurchasePayload({
    conversationId: 77,
    userData,
    value: 10,
    currency: "PEN",
  });

const casos = [
  {
    nombre: "vino de un anuncio (WhatsApp con click)",
    userData: buildMessagingUserData({
      channel: "whatsapp",
      phone: TELEFONO,
      firstName: "Ana",
      ctwa_clid: CLICK,
    }),
    accion: "business_messaging",
    canal: "whatsapp",
    llevaClick: true,
  },
  {
    nombre: "ORGÁNICO: WhatsApp sin click",
    userData: buildMessagingUserData({
      channel: "whatsapp",
      phone: TELEFONO,
      firstName: "Ana",
      ctwa_clid: null,
    }),
    accion: "system_generated",
    canal: undefined,
    llevaClick: false,
  },
  {
    nombre: "Messenger sin click (no cambia)",
    userData: buildMessagingUserData({
      channel: "messenger",
      phone: "messenger:1234567890",
      firstName: "Ana",
      ctwa_clid: null,
    }),
    accion: "business_messaging",
    canal: "messenger",
    llevaClick: false,
  },
  {
    nombre: "Instagram sin click (no cambia)",
    userData: buildMessagingUserData({
      channel: "instagram",
      phone: "instagram:9876543210",
      firstName: "Ana",
      ctwa_clid: null,
    }),
    accion: "business_messaging",
    canal: "instagram",
    llevaClick: false,
  },
];

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (nombre, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(nombre, 60)} ${valor}`);
};

for (const caso of casos) {
  const evento = compra(caso.userData);
  const ud = evento.user_data;
  comprobar(
    `${caso.nombre}: camino`,
    evento.action_source === caso.accion,
    evento.action_source
  );
  comprobar(
    `${caso.nombre}: canal`,
    evento.messaging_channel === caso.canal,
    evento.messaging_channel ?? "(ninguno, correcto para system_generated)"
  );
  comprobar(
    `${caso.nombre}: click de anuncio`,
    Boolean(ud.ctwa_clid) === caso.llevaClick,
    ud.ctwa_clid ? "lo lleva" : "no lo lleva"
  );
}

// Lo que no debe pasar nunca, pase lo que pase.
const organica = compra(
  buildMessagingUserData({
    channel: "whatsapp",
    phone: TELEFONO,
    firstName: "Ana",
    ctwa_clid: null,
  })
);
const crudo = JSON.stringify(organica);

comprobar(
  "la compra orgánica SÍ se reporta (antes se saltaba)",
  organica.action_source === "system_generated" && organica.event_name === "Purchase",
  `${organica.event_name} por ${organica.action_source}`
);
comprobar(
  "el teléfono viaja hasheado, nunca en claro",
  !crudo.includes(TELEFONO) && Array.isArray(organica.user_data.ph),
  organica.user_data.ph ? `ph=${String(organica.user_data.ph[0]).slice(0, 16)}...` : "(sin teléfono)"
);
comprobar(
  "el nombre viaja hasheado, nunca en claro",
  !crudo.toLowerCase().includes("ana") && Array.isArray(organica.user_data.fn),
  organica.user_data.fn ? "hasheado" : "(sin nombre)"
);
comprobar(
  "lleva el monto y la moneda de la venta",
  organica.custom_data?.value === 10 && organica.custom_data?.currency === "PEN",
  `${organica.custom_data?.value} ${organica.custom_data?.currency}`
);

rmSync(TMP, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
