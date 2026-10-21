// EL UPGRADE: PAGA EL BASICO Y DESPUES COMPLETA PARA EL FULL
//
// LO PIDIO EL DUEÑO el 06/10/2026. Es un caso central de su recorrido —`CLAUDE.md` lo nombra
// en las tres modalidades— y era de lo poco que no se probaba solo.
//
// ── POR QUE ES EL CASO MAS DELICADO DEL COBRO ────────────────────────────
//
// Es el unico donde el bot tiene que SUMAR. En todos los demas compara un importe con un
// precio y decide; aqui tiene que acordarse de lo que ya pago, pedir la diferencia exacta, y
// al llegar la segunda foto entregar EL FULL y no el basico.
//
// Y tiene dos formas de salir mal, las dos caras:
//
//   SI SE QUEDA CORTO    cobra 3,50 y entrega el full. Regalo de un producto.
//   SI SE PASA           no reconoce lo ya pagado y le pide el full entero otra vez. El
//                        cliente paga dos veces o se va.
//
// ── COMO SE PRUEBA ───────────────────────────────────────────────────────
//
//   1. La tienda se pone en COMO -DOU-, porque sin dos opciones no hay upgrade.
//   2. El cliente elige el FULL.
//   3. Paga el importe del BASICO. Tiene que quedar PARCIAL, no aprobado, y pedirle el resto.
//   4. Paga la diferencia. AHORA si: aprobado, por el total del full, y entrega.
//
// SU CONFIGURACION SE DEVUELVE EN BYTES, pase lo que pase — ver el `finally` del final.
//
//   node scripts/recorrido-del-upgrade.mjs --tienda=tienda_muq67lks --pais=EC \
//        --basico="...3.50.jpg" --diferencia="...1 DOLAR.jpg" --full=4.5
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const valorDe = (n) =>
  args.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=") ?? "";
const BASE = valorDe("url") || "http://localhost:3007";
const TIENDA = valorDe("tienda");
const PAIS = (valorDe("pais") || "EC").toUpperCase();
const METODO = valorDe("metodo") || "transferencia";
const BASICO = valorDe("basico");
const DIFERENCIA = valorDe("diferencia");
/** Lo que tiene que acabar cobrando, en su moneda. */
const TOTAL = Number(valorDe("full") || 0);
const CONFIG = "config/intro-data.yaml";

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

/** Igual que en el recorrido de los seguimientos: una linea, y se devuelven los bytes. */
function ponerSubmodalidad(tiendaId, valor) {
  const original = readFileSync(CONFIG);
  const texto = original.toString("utf8");
  const i = texto.indexOf(`- id: ${tiendaId}`);
  if (i < 0) throw new Error(`no encuentro la tienda ${tiendaId}`);
  const sig = texto.indexOf("\n  - id: ", i + 1);
  const fin = sig < 0 ? texto.length : sig;
  const bloque = texto.slice(i, fin);
  const nuevo = /\n(\s+)semimodalidad: .*/.test(bloque)
    ? bloque.replace(/\n(\s+)semimodalidad: .*/, `\n$1semimodalidad: ${valor}`)
    : bloque.replace(/\n(\s+)pagina: (.*)/, `\n$1pagina: $2\n$1semimodalidad: ${valor}`);
  if (nuevo === bloque) throw new Error("no supe donde poner la semimodalidad");
  writeFileSync(CONFIG, texto.slice(0, i) + nuevo + texto.slice(fin), "utf8");
  return () => writeFileSync(CONFIG, original);
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let fallos = 0;
const comprobar = (titulo, ok, detalle) => {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${String(titulo).padEnd(48)} ${detalle ?? ""}`);
};

async function decir(id, { texto, archivo } = {}) {
  const form = new FormData();
  if (texto) form.set("content", texto);
  if (archivo)
    form.set(
      "file",
      new Blob([readFileSync(archivo)], { type: "image/jpeg" }),
      archivo.split(/[\\/]/).pop()
    );
  const r = await pedir(`/api/test-simulator/${id}/message`, { method: "POST", body: form });
  if (!r.ok) throw new Error(`no pude hablarle: ${r.status}`);
}

const leer = async (id) =>
  (await pedir(`/api/test-simulator/${id}`, { cache: "no-store" })).json();
const delBot = (d) => (d.messages ?? []).filter((m) => m.role !== "user");

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

let deshacer = null;

async function main() {
  if (!TIENDA || !BASICO || !DIFERENCIA || !TOTAL) {
    throw new Error("hacen falta --tienda, --basico, --diferencia y --full");
  }
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

  console.log(`\nEL UPGRADE — ${PAIS} · ${TIENDA}\n`);
  deshacer = ponerSubmodalidad(TIENDA, "dos_juntas");
  console.log("  ⟳ la tienda pasa a COMO -DOU- (sin dos opciones no hay upgrade)");
  await dormir(4000);

  const r = await pedir("/api/test-simulator", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ country: PAIS, channel: "whatsapp", tienda: TIENDA }),
  });
  const { id } = await r.json();

  await decir(id, { texto: "hola" });
  await queAsienten(id, 9000, 120000);
  await decir(id, { texto: "quiero el full" });
  await queAsienten(id, 9000, 90000);
  await decir(id, { texto: METODO });
  const listo = await queAsienten(id, 9000, 90000);
  comprobar(
    "elige el full y recibe los datos",
    listo.conversation?.state === "payment_done",
    `estado=${listo.conversation?.state}`
  );

  // ── PASO 1: PAGA EL IMPORTE DEL BASICO ──────────────────────────────────
  console.log("\n  · paga el importe del basico");
  let antes = delBot(listo).length;
  await decir(id, { texto: "listo ya pague" });
  await decir(id, { archivo: BASICO });
  const d1 = await queAsienten(id, 15000, 180000);
  const c1 = d1.conversation ?? {};
  comprobar(
    "NO lo da por aprobado todavia",
    c1.state !== "payment_approved",
    `estado=${c1.state}`
  );
  comprobar(
    "pero se queda con lo que ya pago",
    (c1.paid_total_cents ?? 0) > 0,
    `lleva ${(c1.paid_total_cents ?? 0) / 100}`
  );
  const dicho1 = delBot(d1)
    .slice(antes)
    .map((m) => String(m.content ?? ""))
    .join("\n");
  comprobar(
    "y no le manda el material",
    !/drive\.google|INGRESA AQU/i.test(dicho1),
    "todavia no ha pagado todo"
  );
  comprobar("le contesta algo", dicho1.trim().length > 0, "no se queda mudo");

  // ── PASO 2: COMPLETA LA DIFERENCIA ──────────────────────────────────────
  console.log("\n  · completa la diferencia");
  antes = delBot(d1).length;
  await decir(id, { texto: "ahi va el resto" });
  await decir(id, { archivo: DIFERENCIA });
  const d2 = await queAsienten(id, 15000, 180000);
  const c2 = d2.conversation ?? {};
  comprobar(
    "AHORA si lo aprueba",
    c2.state === "payment_approved",
    `estado=${c2.state}`
  );
  comprobar(
    "y suma los dos pagos",
    (c2.paid_total_cents ?? 0) / 100 === TOTAL,
    `esperado ${TOTAL} · cobrado ${(c2.paid_total_cents ?? 0) / 100}`
  );
  const dicho2 = delBot(d2)
    .slice(antes)
    .map((m) => String(m.content ?? ""))
    .join("\n");
  comprobar(
    "y le entrega",
    /http|drive|enlace|acceso/i.test(dicho2),
    `${dicho2.length} caracteres`
  );

  await pedir(`/api/test-simulator/${id}`, { method: "DELETE" }).catch(() => {});

  console.log("");
  if (fallos > 0) {
    console.log(`> ${fallos} FALLA(S)`);
    process.exitCode = 1;
    return;
  }
  console.log("TODO OK — pago parcial reconocido, diferencia sumada y full entregado");
}

main()
  .catch((e) => {
    console.error("\nSE ROMPIO:", e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    if (!deshacer) return;
    try {
      deshacer();
      console.log("  ⟳ configuracion devuelta a como estaba");
    } catch (err) {
      console.error(
        `\n  ⚠️  NO PUDE DEVOLVER LA CONFIGURACION. La tienda ${TIENDA} quedo en ` +
          `«dos_juntas» y hay que quitarselo a mano. Motivo: ${err.message}`
      );
      process.exitCode = 1;
    }
  });
