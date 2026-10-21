// LOS COMPROBANTES QUE EL BOT TIENE QUE RECHAZAR
//
// LO PIDIO EL DUEÑO el 06/10/2026, antes de salir a vender. Y la pregunta era buena: TODO lo
// que se habia probado hasta ahora eran pagos BUENOS, y los aprobaba bien. Nadie habia mirado
// si rechaza los malos.
//
// POR QUE IMPORTA MAS QUE LO OTRO: si aprueba uno malo, el entrega el producto y NO HA
// COBRADO. Un pago bueno rechazado se nota en el momento —el cliente reclama—; un pago malo
// aprobado no lo nota nadie hasta cuadrar las cuentas.
//
// ── LOS TRES CASOS, Y SON LOS QUE PASAN DE VERDAD ────────────────────────
//
//   NOMBRE     el comprobante esta a nombre de otra persona. Es el caso del que reenvia el
//              pago de un amigo, o el de la captura sacada de otro chat.
//   IMPORTE    paga menos de lo que vale. El bot debe contarlo como PARCIAL y pedir el resto,
//              nunca entregar.
//   OTRO PAIS  un comprobante de otra moneda. Un dolar no es un sol, y el importe «3» podria
//              colarse como si lo fuera.
//
// NO SE EXIGE QUE CONTESTE DE UNA FORMA CONCRETA: la frase la escribe el modelo y cambia cada
// vez. Lo que se exige es lo unico que no puede fallar — QUE NO QUEDE APROBADO Y QUE NO
// ENTREGUE.
//
//   node scripts/recorrido-comprobantes-malos.mjs --tienda=tienda_muq67lks --pais=PE
import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const valorDe = (n) =>
  args.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=") ?? "";
const BASE = valorDe("url") || "http://localhost:3007";
const TIENDA = valorDe("tienda");
const PAIS = (valorDe("pais") || "PE").toUpperCase();
const METODO = valorDe("metodo") || "yape";
const CARPETA =
  valorDe("comprobantes") || "C:/Users/alberto/Desktop/comprobantes para prueba";

/** Los tres, con el porque de cada uno. Se pueden cambiar sin tocar el resto. */
const MALOS = [
  {
    caso: "a nombre de otra persona",
    archivo: "YAPEO MELISSA 12 SOLES.jpg",
    porque: "esta tienda cobra a nombre de otro",
  },
  {
    caso: "por menos de lo que vale",
    archivo: "yapeo ALBERTO 5 soles.jpg",
    porque: "el nombre esta bien, el importe no llega",
  },
  {
    caso: "de otro pais",
    archivo: "PICHINCHA 3 DOLARES.jpg",
    porque: "un dolar no es un sol",
  },
];

let cookie = "";
const pedir = (ruta, op = {}) =>
  fetch(`${BASE}${ruta}`, {
    ...op,
    headers: { ...(op.headers ?? {}), ...(cookie ? { cookie } : {}) },
  });

function clave() {
  if (process.env.DASHBOARD_PASSWORD?.trim()) return process.env.DASHBOARD_PASSWORD.trim();
  for (const f of [".env.local", ".env"]) {
    if (!existsSync(f)) continue;
    const l = readFileSync(f, "utf8")
      .split(/\r?\n/)
      .find((x) => /^\s*DASHBOARD_PASSWORD\s*=/.test(x));
    const v = l?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
    if (v) return v;
  }
  return "";
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let fallos = 0;
const comprobar = (titulo, ok, detalle) => {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${String(titulo).padEnd(46)} ${detalle ?? ""}`);
};

async function decir(id, { texto, archivo } = {}) {
  const form = new FormData();
  if (texto) form.set("content", texto);
  if (archivo) {
    form.set(
      "file",
      new Blob([readFileSync(archivo)], { type: "image/jpeg" }),
      archivo.split(/[\\/]/).pop()
    );
  }
  const r = await pedir(`/api/test-simulator/${id}/message`, { method: "POST", body: form });
  if (!r.ok) throw new Error(`no pude hablarle a ${id}: ${r.status}`);
}

const leer = async (id) =>
  (await pedir(`/api/test-simulator/${id}`, { cache: "no-store" })).json();
const delBot = (d) => (d.messages ?? []).filter((m) => m.role !== "user");

/** Espera a que el bot deje de escribir, para no leer a medias. */
async function queAsienten(id, quietoMs = 12000, topeMs = 150000) {
  const tope = Date.now() + topeMs;
  let d = await leer(id);
  let n = delBot(d).length;
  let quieto = Date.now();
  while (Date.now() < tope && Date.now() - quieto < quietoMs) {
    await dormir(3000);
    d = await leer(id);
    if (delBot(d).length !== n) {
      n = delBot(d).length;
      quieto = Date.now();
    }
  }
  return d;
}

async function main() {
  const c = clave();
  if (c) {
    const r = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: c }),
    });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
  }

  console.log(
    `\nCOMPROBANTES QUE HAY QUE RECHAZAR — ${PAIS}${TIENDA ? ` · ${TIENDA}` : ""}\n`
  );

  for (const malo of MALOS) {
    const r = await pedir("/api/test-simulator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        country: PAIS,
        channel: "whatsapp",
        ...(TIENDA ? { tienda: TIENDA } : {}),
      }),
    });
    const { id } = await r.json();
    console.log(`── ${malo.caso} (${malo.archivo}) ──`);

    // Hasta los datos de pago, por el camino corto.
    await decir(id, { texto: "hola" });
    await queAsienten(id, 9000, 120000);
    await decir(id, { texto: "quiero comprar" });
    await queAsienten(id, 9000, 90000);
    await decir(id, { texto: METODO });
    const listo = await queAsienten(id, 9000, 90000);
    comprobar(
      "llega a los datos de pago",
      listo.conversation?.state === "payment_done",
      `estado=${listo.conversation?.state}`
    );

    const antes = delBot(listo).length;
    await decir(id, { texto: "listo ya pague" });
    await decir(id, { archivo: `${CARPETA}/${malo.archivo}` });
    const d = await queAsienten(id, 15000, 180000);
    const conv = d.conversation ?? {};

    // LO UNICO QUE NO PUEDE FALLAR.
    comprobar(
      "NO lo da por aprobado",
      conv.state !== "payment_approved",
      `estado=${conv.state} · ${malo.porque}`
    );
    const despues = delBot(d).slice(antes);
    const texto = despues.map((m) => String(m.content ?? "")).join("\n");
    comprobar(
      "y no le manda el material",
      !/drive\.google|enlace de acceso|INGRESA AQU/i.test(texto),
      `${despues.length} burbujas tras el comprobante`
    );
    comprobar(
      "pero le contesta algo",
      despues.length > 0,
      "no se queda mudo"
    );
    await pedir(`/api/test-simulator/${id}`, { method: "DELETE" }).catch(() => {});
    console.log("");
  }

  if (fallos > 0) {
    console.log(`> ${fallos} FALLA(S) — revisar: un comprobante malo aprobado es dinero`);
    process.exit(1);
  }
  console.log("TODO OK — los tres fueron rechazados y no se entrego nada");
}

main().catch((e) => {
  console.error("\nSE ROMPIO:", e.message);
  process.exit(1);
});
