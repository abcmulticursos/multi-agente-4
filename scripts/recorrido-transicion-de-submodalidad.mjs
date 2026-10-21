// LA TRANSICION DE SUBMODALIDAD, EN VIVO: comprar en «como hoy» y cambiar a «como dou»
//
// LO PIDIO EL DUEÑO — 3 de octubre de 2026. Es la prueba que el hace a mano y que ninguna
// bateria reproducia, porque obliga a CAMBIAR LA TIENDA a mitad de la conversacion:
//
//   «en la ventana 1 enviaba el comprobante sin mas que decir, para ver si al cambiar a
//    comodou iba a rechazar la compra, pero si me entregaba el producto, eso quiere decir
//    que el cambio de semimodalidad no afecto la aprobacion de eleccion ni precio»
//
// COMO SE HACE SIN ARRUINAR NADA, y esto es lo que mas importa:
//
//   · Se copia `config/intro-data.yaml` ANTES de tocarlo.
//   · Se cambia UNA linea, con reemplazo exacto, y se ABORTA si no hay exactamente una
//     coincidencia. No se usa la puerta del editor: esa es la que una vez le vacio
//     contenido.
//   · Se restaura SIEMPRE al acabar, pase lo que pase, y se comprueba que el archivo quedo
//     byte por byte como estaba.
//
//   node scripts/recorrido-transicion-de-submodalidad.mjs --url=http://localhost:3007 \
//        --tienda=<id> --pais=PE --comprobante=<ruta>
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const valorDe = (n, d = null) => {
  const f = args.find((a) => a.startsWith(`--${n}=`));
  return f ? f.slice(n.length + 3) : d;
};
const BASE = (valorDe("url", "http://localhost:3000") || "").replace(/\/$/, "");
const TIENDA = valorDe("tienda");
const PAIS = (valorDe("pais", "PE") || "PE").toUpperCase();
const COMPROBANTE = valorDe("comprobante");
const METODO = valorDe("metodo", "yape") || "yape";
// LA CLAVE DEL PANEL, como la busca el recorrido: del entorno o del `.env` del proyecto.
// Todo `/api/` va detras de ella, asi que sin esto no se crea ni una conversacion de prueba.
const claveDelEnv = () => {
  for (const archivo of [".env.local", ".env"]) {
    try {
      const t = readFileSync(join(process.cwd(), archivo), "utf8");
      const m = t.match(/^\s*DASHBOARD_PASSWORD\s*=\s*(.*)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    } catch { /* sigue con el siguiente */ }
  }
  return "";
};
const CLAVE = valorDe("clave", process.env.DASHBOARD_PASSWORD || claveDelEnv());

const YAML_PATH = join(process.cwd(), "config", "intro-data.yaml");
const COPIA = join(process.cwd(), "config", "intro-data.yaml.copia-de-la-prueba");

const huella = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

let cookie = "";
const pedir = async (ruta, opciones = {}) =>
  fetch(`${BASE}${ruta}`, {
    ...opciones,
    headers: { ...(opciones.headers ?? {}), ...(cookie ? { cookie } : {}) },
    redirect: "manual",
  });

const entrar = async () => {
  const r = await pedir("/api/test-simulator?id=0");
  if (r.status !== 401 && r.status !== 403) return;
  const l = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: CLAVE }),
    redirect: "manual",
  });
  const set = l.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
};

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const estadoDe = async (id) => {
  const r = await pedir(`/api/test-simulator/${id}`);
  return r.ok ? await r.json() : null;
};

// EL CAMPO SE LLAMA «content», no «text». Mandarlo con otro nombre no da error: el mensaje
// simplemente no llega, y la prueba parece que falla cuando lo que falla es la prueba.
const enviarTexto = async (id, texto) => {
  const form = new FormData();
  form.set("content", texto);
  const r = await pedir(`/api/test-simulator/${id}/message`, { method: "POST", body: form });
  if (!r.ok) throw new Error(`no pude enviar «${texto}»: ${r.status}`);
  return r;
};

const enviarImagen = async (id, ruta) => {
  const form = new FormData();
  form.set("file", new Blob([readFileSync(ruta)], { type: "image/jpeg" }), "comprobante.jpg");
  const r = await pedir(`/api/test-simulator/${id}/message`, { method: "POST", body: form });
  if (!r.ok) throw new Error(`no pude enviar el comprobante: ${r.status}`);
  return r;
};

// Espera a que el bot deje de escribir: cuando el numero de mensajes no sube en 8 segundos.
const esperarAlBot = async (id, maximoMs = 120000, minimo = 1) => {
  // EXIGE QUE HAYA LLEGADO ALGO ANTES DE DARSE POR SATISFECHA. Sin esto la espera se
  // cumplia en 8 segundos con CERO mensajes: el obrero manda la intro poco a poco y la
  // prueba se iba antes de que empezara.
  let ultimo = -1, quieto = 0;
  const hasta = Date.now() + maximoMs;
  while (Date.now() < hasta) {
    await esperar(2000);
    const e = await estadoDe(id);
    const n = (e?.messages ?? []).length;
    if (n === ultimo && n >= minimo) { quieto += 2; if (quieto >= 10) return e; }
    else { ultimo = n; quieto = 0; }
  }
  return await estadoDe(id);
};

// ── EL CAMBIO DE SUBMODALIDAD, CON RED ──────────────────────────────────────
const cambiarSubmodalidad = (de, a) => {
  const texto = readFileSync(YAML_PATH, "utf8");
  // CUATRO ESPACIOS: es la sangria del campo DENTRO de una tienda. Los cajones de intro y
  // de seguimiento tambien tienen `semimodalidad`, pero con otra sangria — y por eso se
  // compara la linea entera y se aborta si no hay exactamente UNA.
  // SE TRABAJA POR LINEAS, no con un reemplazo de texto corrido: su archivo usa saltos de
  // linea de Windows, y buscar «...\n» no encontraba nada. Asi el final de linea da igual.
  const lineas = texto.split("\n");
  const buscada = `    semimodalidad: ${de}`;
  const donde = [];
  lineas.forEach((l, i) => {
    if (l.replace(/\r$/, "") === buscada) donde.push(i);
  });
  if (donde.length !== 1)
    throw new Error(
      `ABORTO: esperaba UNA linea «${buscada}» y encontre ${donde.length}. No toco nada.`
    );
  const conRetorno = lineas[donde[0]].endsWith("\r");
  lineas[donde[0]] = `    semimodalidad: ${a}` + (conRetorno ? "\r" : "");
  writeFileSync(YAML_PATH, lineas.join("\n"), "utf8");
};

/**
 * LAS TRES VENTANAS DEL DUEÑO, tal como las hace a mano (ver COMO-TESTEA-ALBERTO.md):
 *
 *   1 — no la deja llegar a ningun seguimiento. Cambia la tienda y manda el comprobante
 *       sin decir nada mas. Mide: ¿el cambio le tumba la aprobacion o el precio?
 *   2 — la deja llegar al seguimiento 1 y NO al 2. Cambia la tienda y vuelve a escribir.
 *       Mide: ¿le cuenta la novedad de que ahora hay dos productos?
 *   3 — la deja llegar al seguimiento 2, que trae botones con la eleccion pegada. Cambia
 *       la tienda y PULSA ese boton. Mide: ¿respeta el precio que ese boton traia de antes?
 *
 * Sus tiempos reales, leidos del canal de WhatsApp: seguimiento 1 a los 2 minutos y
 * seguimiento 2 a los 5.
 */
const VENTANA = Number(valorDe("ventana", "1")) || 1;

const main = async () => {
  if (!TIENDA) throw new Error("hace falta --tienda=<id>");
  if (!COMPROBANTE || !existsSync(COMPROBANTE))
    throw new Error("hace falta --comprobante=<ruta a una captura real>");

  copyFileSync(YAML_PATH, COPIA);
  const antes = huella(YAML_PATH);
  console.log("");
  console.log("copia de seguridad hecha. huella del archivo: " + antes.slice(0, 16));

  let fallos = 0;
  const comprobar = (t, ok, d) => {
    console.log(`${ok ? "  ok  " : "> FALLA"} ${String(t).padEnd(52)} ${d ?? ""}`);
    if (!ok) fallos++;
  };

  try {
    await entrar();

    // 1. La tienda arranca en «como hoy» (semimodalidad vacia).
    console.log("");
    console.log("· Pongo la tienda en «como hoy»");
    cambiarSubmodalidad("dos_juntas", '""');
    await esperar(3000);

    // 2. El cliente escribe y recibe la intro.
    const r = await pedir("/api/test-simulator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        country: PAIS, name: "Transicion", channel: "whatsapp", tienda: TIENDA,
      }),
    });
    const { id } = await r.json();
    console.log("· Conversacion " + id + " creada en la tienda");

    await enviarTexto(id, "hola");
    let e = await esperarAlBot(id);
    comprobar("el bot contesta la intro", (e?.messages ?? []).length > 1,
      `${(e?.messages ?? []).length} mensajes`);

    const textoDelBot = (datos, cuantos = 5) =>
      (datos?.messages ?? [])
        .filter((m) => m.role === "assistant")
        .slice(-cuantos)
        .map((m) => m.content ?? "")
        .join("\n");

    // ── VENTANA 2: dejarla llegar al SEGUIMIENTO 1 y no al 2 ──────────────
    if (VENTANA === 2) {
      console.log("");
      console.log("· Espero el seguimiento 1 (2 min). Sin tocar nada.");
      const cuantosAntes = (e?.messages ?? []).length;
      const hasta = Date.now() + 240000;
      let llego = false;
      while (Date.now() < hasta && !llego) {
        await esperar(5000);
        e = await estadoDe(id);
        if ((e?.messages ?? []).length > cuantosAntes) llego = true;
      }
      comprobar("llega el seguimiento 1", llego, `${(e?.messages ?? []).length} mensajes`);
      await esperarAlBot(id, 60000);

      console.log("");
      console.log("· CAMBIO LA TIENDA a «como dou»");
      cambiarSubmodalidad('""', "dos_juntas");
      await esperar(3000);

      console.log("");
      console.log("· Vuelve a escribir pidiendo informacion");
      const antesDeEscribir = (await estadoDe(id))?.messages?.length ?? 0;
      await enviarTexto(id, "que contiene");
      e = await esperarAlBot(id, 120000, antesDeEscribir + 1);
      const dijo = textoDelBot(e, 6);
      // ¿Le conto que ahora hay DOS? Se busca que nombre las dos opciones.
      const dosNombres =
        /super\s*pack/i.test(dijo) && /grafismo/i.test(dijo);
      comprobar("le cuenta que ahora hay dos opciones", dosNombres,
        dosNombres ? "nombra las dos" : "no las nombra");
      console.log("        lo que dijo: " + dijo.replace(/\s+/g, " ").slice(0, 150));
      return;
    }

    // ── VENTANA 3: dejarla llegar al SEGUIMIENTO 2 y pulsar su boton ──────
    if (VENTANA === 3) {
      console.log("");
      console.log("· Espero el seguimiento 2 (5 min). Sin tocar nada.");
      const hasta = Date.now() + 480000;
      // `buttons` viene como un OBJETO indexado por mensaje, no como lista: se aplana
      // igual que lo hace el recorrido completo.
      let botones = [];
      while (Date.now() < hasta && botones.length === 0) {
        await esperar(5000);
        e = await estadoDe(id);
        botones = Object.values(e?.buttons ?? {}).flat();
      }
      comprobar("llega el seguimiento 2 con sus botones", botones.length > 0,
        botones.length ? `${botones.length} boton(es)` : "sin botones");
      if (botones.length === 0) return;
      console.log("        botones: " +
        botones.map((x) => x.title ?? x.id).join(" · "));

      console.log("");
      console.log("· CAMBIO LA TIENDA a «como dou», con el boton ya en pantalla");
      cambiarSubmodalidad('""', "dos_juntas");
      await esperar(3000);

      console.log("");
      console.log("· Pulsa el boton que recibio ANTES del cambio");
      const b0 = botones[0];
      const form = new FormData();
      form.set("button_id", b0.id);
      form.set("button_title", b0.title ?? "");
      const rb = await pedir(`/api/test-simulator/${id}/message`, { method: "POST", body: form });
      comprobar("el boton se acepta", rb.ok, `http ${rb.status}`);
      e = await esperarAlBot(id, 120000);
      const tras = textoDelBot(e, 5);
      comprobar("le manda los datos de pago", /\d{6,}|\d{3}\s\d{3}\s\d{3}/.test(tras),
        `estado=${e?.conversation?.state}`);
      console.log("        importes: " + ((tras.match(/\b\d+(?:[.,]\d+)?\b/g) ?? []).join(", ") || "(ninguno)"));

      console.log("");
      console.log("· Manda el comprobante");
      await enviarImagen(id, COMPROBANTE);
      e = await esperarAlBot(id, 150000);
      comprobar("respeta el precio del boton y aprueba",
        e?.conversation?.state === "payment_approved", `estado=${e?.conversation?.state}`);
      comprobar("y le llega su material", /https?:\/\//.test(textoDelBot(e, 6)), "");
      return;
    }

    // 3. Pide pagar y recibe los datos — TODAVIA en «como hoy».  (VENTANA 1)
    console.log("");
    console.log("· Pide pagar, aun en «como hoy»");
    await enviarTexto(id, METODO);
    e = await esperarAlBot(id);
    const ultimas = textoDelBot(e, 4);
    const precioQueLeDijo = (ultimas.match(/\d+(?:[.,]\d+)?/g) ?? []).join(", ");
    comprobar("le manda los datos de pago", /\d/.test(ultimas), `estado=${e?.conversation?.state}`);
    console.log("        importes que vio el cliente: " + (precioQueLeDijo || "(ninguno)"));

    // 4. AHORA el cambio, en mitad de la conversacion.
    console.log("");
    console.log("· CAMBIO LA TIENDA a «como dou», con la venta a medias");
    cambiarSubmodalidad('""', "dos_juntas");
    await esperar(3000);

    // 5. Manda el comprobante sin decir nada mas — la ventana 1 del dueño.
    console.log("");
    console.log("· Manda el comprobante, sin decir nada mas");
    await enviarImagen(id, COMPROBANTE);
    e = await esperarAlBot(id, 120000);
    const estadoFinal = e?.conversation?.state;
    comprobar(
      "el cambio NO le tumba la compra",
      estadoFinal === "payment_approved",
      `estado=${estadoFinal}`
    );
    const texto = (e?.messages ?? [])
      .filter((m) => m.role === "assistant")
      .slice(-5)
      .map((m) => m.content ?? "")
      .join("\n");
    comprobar(
      "y le llega su material",
      /https?:\/\//.test(texto),
      /https?:\/\//.test(texto) ? "con enlace" : "SIN enlace"
    );
  } finally {
    copyFileSync(COPIA, YAML_PATH);
    const despues = huella(YAML_PATH);
    console.log("");
    console.log(
      antes === despues
        ? "SU CONFIGURACION RESTAURADA: identica, byte por byte."
        : "⚠⚠ LA RESTAURACION NO COINCIDE — revise " + COPIA
    );
  }

  console.log("");
  if (fallos > 0) { console.log(`> ${fallos} FALLA(S)`); process.exit(1); }
  console.log("TODO OK — la transicion respeta la compra");
};

main().catch((e) => {
  console.error("ERROR: " + e.message);
  process.exit(1);
});
