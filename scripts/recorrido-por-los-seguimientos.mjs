// LA PRUEBA QUE EMPIEZA DONDE ACABA LA OTRA: ESPERAR LOS SEGUIMIENTOS
//
// LO PIDIO EL DUEÑO el 6/10/2026, y con razon: el recorrido de siempre compra enseguida, asi
// que TODO lo que depende de esperar —el descuento, el boton de la ultima burbuja del
// seguimiento 2— nunca se habia probado solo. El lo probaba a mano, abriendo tres ventanas y
// «aguantando» unas mientras dejaba correr otras.
//
// ── POR QUE NO HACE FALTA AGUANTAR NINGUNA ────────────────────────────────
//
// Esa era la parte dificil de copiar: el frenaba una ventana escribiendole cosas, porque cada
// mensaje del cliente REPROGRAMA los seguimientos. Lo resolvio el mismo, y es mas limpio:
//
//   «si el freno es el problema, puedes testear todas solo para ver el seguimiento 1, y luego
//    haces todo un testeo luego del seguimiento 2. Asi programas todas para trabajar igual.»
//
// Asi que aqui NADIE habla mientras espera. Las tres ventanas de una tanda llegan al mismo
// sitio, y la diferencia entre ellas es lo que hacen DESPUES.
//
// ── LAS DOS TANDAS ────────────────────────────────────────────────────────
//
//   TANDA 1 (--hasta=1)   las tres esperan el seguimiento 1 y compran ahi.
//   TANDA 2 (--hasta=2)   las tres esperan el seguimiento 2 —donde vive el descuento— y cada
//                         una reacciona distinto, que es como el lo hace:
//
//                             PE   toca el boton de la ultima burbuja
//                             EC   se hace el desentendido («no entiendo»)
//                             AR   pregunta («como es eso?»)
//
// ── QUE SE COMPRUEBA, Y POR QUE ESO ───────────────────────────────────────
//
//   · QUE EL SEGUIMIENTO LLEGUE. Si no llega, no hay prueba: se dice y se para.
//   · QUE EL PRECIO DEL SEGUIMIENTO 2 SEA EL REBAJADO. Es el punto entero de la tanda 2: el
//     descuento solo existe ahi, y si saliera el precio normal el cliente pagaria de mas
//     creyendo que le hicieron precio.
//   · QUE EL BOTON DE Y EL BOT DIGAN LO MISMO. Un boton que lleva a un precio distinto del
//     que el bot acaba de decir es la peor forma de perder una venta.
//   · QUE NO SE NOMBRE EL PRODUCTO OCULTO antes de tiempo, cuando la tienda vende en -OB-.
//
// NO SE INVENTA NINGUN PRECIO: los tres —normal, rebajado y el de la ficha— se leen de SU
// configuracion, asi que esto sigue valiendo cuando cambie de producto.
//
// ── Y LAS DOS MITADES QUE FALTABAN ────────────────────────────────────────
//
//   COMPRAR DENTRO DEL SEGUIMIENTO (--comprobante=<ruta>). El compra en tres momentos a
//   proposito: antes del seguimiento 1, EN el 1 y EN el 2. Los dos ultimos son donde el
//   precio cambia, y no se probaban nunca solos. Se exige que apruebe Y que cobre el importe
//   de ESA etapa: aprobar por el precio equivocado es peor que rechazar, porque el cliente se
//   va contento y la cuenta no cuadra.
//
//   LA TRANSICION (--transicion=dos_juntas|segunda_oculta). Mueve el selector de la tienda
//   CUANDO las ventanas ya estan esperando en el seguimiento, que es el momento exacto en que
//   el lo hace. Lo que se mide es lo unico que importa: que al cliente que ya tenia un precio
//   no se le cambie por debajo. Su configuracion se devuelve en bytes, pase lo que pase.
//
//   node scripts/recorrido-por-los-seguimientos.mjs --hasta=2 --tienda=tienda_muq67lks
//   node scripts/recorrido-por-los-seguimientos.mjs --hasta=1 --paises=PE,EC,AR
//   node scripts/recorrido-por-los-seguimientos.mjs --hasta=2 --tienda=X --comprobante=y.jpg
//   node scripts/recorrido-por-los-seguimientos.mjs --hasta=2 --tienda=X --transicion=segunda_oculta
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse as leerYaml } from "yaml";

/**
 * LOS DOS PRECIOS DE ESTA TIENDA EN ESTE PAIS: el normal y el rebajado.
 *
 * SE LEEN DE SU CONFIGURACION, no se escriben aqui. Es lo que permite que esta prueba siga
 * valiendo cuando cambie de producto o de precio — que es lo que mas hace—, y lo que exige
 * `CLAUDE.md`: ningun precio en el codigo.
 *
 * Se mira el producto que la tienda juega de `unico`/`basico`, que es el que anuncia el
 * seguimiento. Sin tienda se cae al primero de la biblioteca, que es el comportamiento de
 * siempre.
 */
function preciosDeLaFicha(tiendaId, pais) {
  try {
    const cfg = leerYaml(readFileSync("config/intro-data.yaml", "utf8"));
    const biblioteca = cfg?.biblioteca_de_productos ?? [];
    const tienda = (cfg?.tiendas ?? []).find((t) => t?.id === tiendaId);
    const quien = tienda?.alineacion?.unico ?? tienda?.alineacion?.basico ?? null;
    const prod = quien
      ? biblioteca.find((p) => p?.id === quien)
      : biblioteca[0];
    if (!prod) return null;
    const porPais = prod?.precios_por_pais?.[pais] ?? {};
    const normal = Number(porPais.price_soles ?? prod.price_soles);
    const rebajado = Number(
      porPais.discount_price_soles ?? prod.discount_price_soles
    );
    return {
      nombre: prod.name ?? "(sin nombre)",
      normal: Number.isFinite(normal) ? normal : null,
      rebajado: Number.isFinite(rebajado) ? rebajado : null,
    };
  } catch {
    return null;
  }
}

const args = process.argv.slice(2);
const valorDe = (n) =>
  args.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=") ?? "";
const tiene = (n) => args.includes(`--${n}`);
const BASE = valorDe("url") || "http://localhost:3007";
const TIENDA = valorDe("tienda");
const HASTA = Number(valorDe("hasta") || 2);
const PAISES = (valorDe("paises") || "PE,EC,AR").split(",").map((p) => p.trim());
/** Cuanto esperar como mucho a que salga el seguimiento, en minutos. */
const PACIENCIA = Number(valorDe("paciencia") || (HASTA === 1 ? 6 : 12));
/** El comprobante con el que paga dentro del seguimiento. Vacio = no compra. */
const COMPROBANTE = valorDe("comprobante");
/**
 * LA TRANSICION — `--transicion=dos_juntas|segunda_oculta`.
 *
 * Cambia la submodalidad de la tienda JUSTO cuando el seguimiento ya salio, que es como lo
 * hace el: deja que las ventanas lleguen al seguimiento 2 y recien entonces mueve el
 * selector. Lo que se mide es lo de siempre y lo unico que importa: que al cliente que ya
 * tenia un precio NO se le cambie por debajo.
 */
const TRANSICION = valorDe("transicion");
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

async function entrar() {
  const c = clave();
  if (!c) return;
  const r = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: c }),
  });
  const set = r.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * CAMBIA LA SUBMODALIDAD DE UNA TIENDA, Y DEVUELVE COMO DESHACERLO.
 *
 * ── POR QUE SE EDITA EL ARCHIVO A MANO Y NO CON EL LECTOR DE YAML ─────────
 *
 * Volcar el YAML entero con la libreria lo reescribiria de arriba abajo: comentarios,
 * comillas, orden y saltos de linea. Ese archivo es SU contenido —miles de lineas que el
 * edita todos los dias— y devolverlo «equivalente» no es devolverlo igual. Aqui se toca UNA
 * linea dentro del bloque de esa tienda y el resto no se roza.
 *
 * ── Y SE GUARDA EL ORIGINAL EN BYTES ──────────────────────────────────────
 *
 * El deshacer no reconstruye nada: reescribe los bytes exactos que habia. Asi la unica forma
 * de que su configuracion acabe distinta es que el proceso muera entre las dos operaciones, y
 * para eso esta el `finally` y el aviso a gritos de mas abajo.
 */
function cambiarSubmodalidad(tiendaId, valor) {
  const original = readFileSync(CONFIG);
  const texto = original.toString("utf8");
  const i = texto.indexOf(`- id: ${tiendaId}`);
  if (i < 0) throw new Error(`no encuentro la tienda ${tiendaId} en ${CONFIG}`);
  // El bloque de ESTA tienda: hasta la siguiente o hasta el final de la lista.
  const siguiente = texto.indexOf("\n  - id: ", i + 1);
  const fin = siguiente < 0 ? texto.length : siguiente;
  const bloque = texto.slice(i, fin);
  const yaTiene = /\n(\s+)semimodalidad: .*/.exec(bloque);
  let nuevo;
  if (yaTiene) {
    nuevo = bloque.replace(/\n(\s+)semimodalidad: .*/, `\n$1semimodalidad: ${valor}`);
  } else {
    // Se mete detras de `pagina:`, que es donde la tiene la otra tienda — asi el archivo
    // sigue leyendose igual si el lo abre.
    nuevo = bloque.replace(/\n(\s+)pagina: (.*)/, `\n$1pagina: $2\n$1semimodalidad: ${valor}`);
    if (nuevo === bloque) throw new Error("no supe donde poner la semimodalidad");
  }
  writeFileSync(CONFIG, texto.slice(0, i) + nuevo + texto.slice(fin), "utf8");
  return () => writeFileSync(CONFIG, original);
}

let fallos = 0;
const comprobar = (titulo, ok, detalle) => {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${String(titulo).padEnd(50)} ${detalle ?? ""}`);
};

async function abrir(pais) {
  const r = await pedir("/api/test-simulator", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ country: pais, channel: "whatsapp", ...(TIENDA ? { tienda: TIENDA } : {}) }),
  });
  if (!r.ok) throw new Error(`no pude abrir ${pais}: ${r.status} ${await r.text()}`);
  return (await r.json()).id;
}

/**
 * HABLA EL CLIENTE — con `FormData`, NO con JSON.
 *
 * Se intento primero con JSON y el mensaje no llegaba al motor: el servidor contestaba 200 y
 * el registro no mostraba ni un turno. El simulador espera un formulario, igual que la
 * pantalla de verdad, porque por ahi tambien viajan las fotos. Se copia de
 * `recorrido-completo.mjs`, que lleva meses funcionando.
 */
async function decir(id, { texto, boton, archivo } = {}) {
  const form = new FormData();
  if (texto) form.set("content", texto);
  if (boton) {
    form.set("button_id", boton.id);
    form.set("button_title", boton.title ?? "");
  }
  if (archivo) {
    // SE DICE QUE ES UNA FOTO, NO UN ARCHIVO CUALQUIERA. Sin el tipo, el simulador guarda
    // «application/octet-stream» y el lector del comprobante muere con «Unsupported MIME
    // type» — el mismo tropiezo que ya costo caro en el otro recorrido.
    const ext = archivo.toLowerCase().split(".").pop();
    const tipo = ext === "png" ? "image/png" : ext === "pdf" ? "application/pdf" : "image/jpeg";
    form.set(
      "file",
      new Blob([readFileSync(archivo)], { type: tipo }),
      archivo.split(/[\\/]/).pop()
    );
  }
  const r = await pedir(`/api/test-simulator/${id}/message`, {
    method: "POST",
    body: form,
  });
  if (!r.ok) throw new Error(`no pude hablarle a ${id}: ${r.status} ${await r.text()}`);
}

async function leer(id) {
  const r = await pedir(`/api/test-simulator/${id}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`no pude leer ${id}: ${r.status}`);
  return r.json();
}

/**
 * LOS IMPORTES QUE HAY EN UN TEXTO, normalizados para poder compararlos.
 *
 * NO SE LEE NINGUN PRECIO DE LA CONFIGURACION a proposito: lo que se compara es lo que el
 * bot DIJO contra lo que el bot HIZO. Asi esto sigue valiendo cuando el cambie de producto,
 * de pais o de precio, que es lo que mas hace.
 *
 * Se aceptan las tres formas en que escribe sus importes: «S/. 11», «$ 3.50», «12500 ARS».
 * Y se tira todo lo que no sea un precio —numeros de cuenta, telefonos, numeros de
 * comprobante— exigiendo que haya una marca de moneda cerca.
 */
function preciosDe(texto) {
  const t = String(texto ?? "");
  const encontrados = new Set();
  // EL NUMERO, CON SUS MILES. La primera version partia «8.500» en «8.5» y «500», asi que
  // Argentina salia roja comparando trozos. Se captura el numero ENTERO —con sus puntos o
  // comas de miles— y se decide despues que es cada separador.
  const NUM = "[0-9][0-9.,]*";
  const patrones = [
    new RegExp(`(?:S/\\.?|\\$|USD|ARS|soles|d[óo]lares|dolares|pesos)\\s*(${NUM})`, "gi"),
    new RegExp(`(${NUM})\\s*(?:soles|d[óo]lares|dolares|pesos|ARS|USD)`, "gi"),
  ];
  for (const p of patrones) {
    for (const m of t.matchAll(p)) {
      const n = aNumero(m[1]);
      if (n !== null) encontrados.add(String(n));
    }
  }
  return [...encontrados];
}

/**
 * «8.500», «8,500», «3.50», «3,50» y «11» al mismo numero.
 *
 * LA REGLA, y sale de como escribe el sus precios: si lo que hay detras del ultimo separador
 * son TRES cifras, ese separador es de miles (8.500 = 8500). Si son una o dos, es decimal
 * (3.50 = 3.5). Es la unica forma de leer bien los pesos argentinos y los dolares con la
 * misma funcion.
 */
function aNumero(crudo) {
  const s = String(crudo ?? "").trim().replace(/[.,]$/, "");
  if (!/[0-9]/.test(s)) return null;
  const ultimo = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  let n;
  if (ultimo === -1) {
    n = Number(s);
  } else {
    const cola = s.slice(ultimo + 1);
    n =
      cola.length === 3
        ? Number(s.replace(/[.,]/g, ""))
        : Number(s.slice(0, ultimo).replace(/[.,]/g, "") + "." + cola);
  }
  return Number.isFinite(n) && n > 0 ? n : null;
}

const delBot = (d) => (d.messages ?? []).filter((m) => m.role !== "user");
const textoDe = (ms) => ms.map((m) => String(m.content ?? "")).join("\n");
/** Los botones llegan como objeto; se aplanan igual que en el otro recorrido. */
const botonesDe = (d) => Object.values(d.buttons ?? {}).flat();

/**
 * ESPERA A QUE SALGA EL SEGUIMIENTO QUE TOCA, SIN HABLARLE.
 *
 * Se reconoce por el estado del seguimiento en la conversacion, no por el texto: el texto es
 * suyo y cambia, el indice no. Y no se le escribe NADA mientras espera — un mensaje
 * reprogramaria el seguimiento y la prueba no llegaria nunca.
 */
async function esperarSeguimiento(id, cual, minutos) {
  const hasta = Date.now() + minutos * 60_000;
  while (Date.now() < hasta) {
    const d = await leer(id);
    const c = d.conversation ?? {};
    /**
     * COMO SE SABE POR DONDE VA, Y POR QUE NO POR EL INDICE.
     *
     * El primer intento miraba `last_followup_index >= 2` y NUNCA se cumplia: se midio
     * contra la base y ese campo se queda en 1 aunque el motor haya mandado el seguimiento
     * 2 —el registro decia «arranca SEGUIMIENTO 2 … enviado» y el indice seguia en 1—. Una
     * prueba que espera un numero que no llega da un rojo falso, que es peor que no probar.
     *
     * EL DATO QUE SI LO DICE ES `discount_active`: se enciende al ENTRAR EN LA ETAPA DE
     * OFERTA, que es exactamente lo que trae el seguimiento 2 y lo que esta prueba viene a
     * mirar. Se pregunta por lo que importa, no por un contador.
     */
    const llego =
      cual >= 2
        ? !!c.discount_active
        : (c.last_followup_index ?? 0) >= 1 || !!c.discount_active;
    if (llego) return { llego: true, datos: await queAsienten(id) };
    await dormir(5000);
  }
  return { llego: false, datos: await leer(id) };
}

/**
 * ESPERA A QUE EL BOT TERMINE DE HABLAR.
 *
 * `discount_active` se enciende al ENTRAR en la etapa de oferta, o sea ANTES de que salgan
 * sus burbujas. La primera version leia justo en ese instante y por eso veia el precio viejo
 * y «ningun boton»: el seguimiento 2 todavia estaba saliendo. El boton vive en la ULTIMA
 * burbuja, asi que leer pronto es garantizar que no se ve.
 *
 * Se espera a que pasen 12 segundos sin una burbuja nueva. El obrero manda una cada 2, asi
 * que con eso la tanda esta cerrada.
 */
async function queAsienten(id, quietoMs = 12000, topeMs = 120000) {
  const tope = Date.now() + topeMs;
  let d = await leer(id);
  let cuantas = delBot(d).length;
  let quieto = Date.now();
  while (Date.now() < tope && Date.now() - quieto < quietoMs) {
    await dormir(3000);
    d = await leer(id);
    const ahora = delBot(d).length;
    if (ahora !== cuantas) {
      cuantas = ahora;
      quieto = Date.now();
    }
  }
  return d;
}

async function main() {
  await entrar();
  console.log(
    `\nRECORRIDO POR LOS SEGUIMIENTOS — hasta el ${HASTA} · ${PAISES.join(", ")}` +
      `${TIENDA ? ` · tienda ${TIENDA}` : ""}\n`
  );

  // Se abren LAS TRES A LA VEZ, como las abre el: asi comparten el reloj y se ve si una
  // estorba a otra.
  const ventanas = [];
  for (const pais of PAISES) {
    const id = await abrir(pais);
    await decir(id, { texto: "hola" });
    ventanas.push({ pais, id });
    console.log(`  · ${pais}: ventana ${id} abierta`);
  }

  console.log(`\nEsperando el seguimiento ${HASTA} (hasta ${PACIENCIA} min, sin hablarles)...`);
  for (const v of ventanas) {
    const { llego, datos } = await esperarSeguimiento(v.id, HASTA, PACIENCIA);
    v.llego = llego;
    v.datos = datos;
    console.log(`  · ${v.pais}: ${llego ? `seguimiento ${HASTA} recibido` : "NO LLEGO"}`);
  }

  /**
   * Y AQUI SE MUEVE EL SELECTOR, con las ventanas ya en el seguimiento.
   *
   * ES EL MOMENTO EXACTO EN QUE EL LO HACE: «cuando la ventana 3 llegue al seguimiento 2,
   * cambiar de comohoy a comoob». Antes no vale —las conversaciones naceran ya en la nueva—
   * y despues tampoco, porque lo que se quiere medir es justo al cliente que quedo a medias.
   *
   * LO QUE TIENE QUE PASAR: nada malo. El precio prometido se respeta, el boton que ya estaba
   * en pantalla sigue valiendo lo que decia, y la venta llega hasta el final.
   */
  if (TRANSICION) {
    if (!TIENDA) throw new Error("--transicion necesita --tienda");
    deshacer = cambiarSubmodalidad(TIENDA, TRANSICION);
    console.log(`\n  ⟳ la tienda pasa a «${TRANSICION}» con las ventanas ya esperando`);
    // El motor relee el archivo solo; se le da un respiro para que lo note.
    await dormir(4000);
  }

  // CADA VENTANA REACCIONA DISTINTO, que es como lo hace el: «en una ventana toca el botón,
  // en otro hazte el desentendido y en el otro pregunta como es eso».
  const REACCIONES = [
    { como: "toca el boton", hacer: "boton" },
    { como: "se hace el desentendido", hacer: "decir", texto: "no entiendo" },
    { como: "pregunta", hacer: "decir", texto: "como es eso?" },
  ];

  for (let i = 0; i < ventanas.length; i++) {
    const v = ventanas[i];
    console.log(`\n── ${v.pais} ──`);
    comprobar(`llego el seguimiento ${HASTA}`, v.llego, `convo ${v.id}`);
    if (!v.llego) continue;
    const texto = textoDe(delBot(v.datos));
    const botones = botonesDe(v.datos);
    comprobar("y trae algo escrito", texto.trim().length > 0, `${texto.length} caracteres`);
    /**
     * EL PRECIO QUE ANUNCIA EL SEGUIMIENTO.
     *
     * Es el punto entero de la tanda 2: ahi vive el descuento. Si saliera el precio normal,
     * el cliente pagaria de mas creyendo que le hicieron precio — y eso no da ningun error.
     */
    const suPrecio = preciosDe(texto);
    const ficha = preciosDeLaFicha(TIENDA, v.pais);
    if (HASTA === 2) {
      comprobar(
        "anuncia un precio",
        suPrecio.length > 0,
        suPrecio.join(" · ") || "ninguno"
      );
      /**
       * Y QUE SEA EL REBAJADO, QUE ES EL PUNTO DE TODO ESTO.
       *
       * Si aqui saliera el precio normal, el cliente pagaria de mas creyendo que le hicieron
       * precio — y no daria ningun error en ningun sitio. Es justo el fallo que no avisa.
       */
      if (ficha?.rebajado != null) {
        comprobar(
          "y es el precio REBAJADO de la ficha",
          suPrecio.includes(String(ficha.rebajado)),
          `ficha: ${ficha.normal} → ${ficha.rebajado} · dijo: ${suPrecio.join("/")}`
        );
      }
      comprobar(
        "y trae su boton",
        botones.length > 0,
        botones.map((b) => b.title ?? b.id).join(" · ") || "ninguno"
      );
    }
    if (HASTA !== 2) continue;

    // LA REACCION, Y LO QUE SE EXIGE DESPUES
    const r = REACCIONES[i % REACCIONES.length];
    console.log(`  · reacciona: ${r.como}`);
    const antes = delBot(v.datos).length;
    if (r.hacer === "boton" && botones.length > 0) {
      await decir(v.id, { boton: botones[botones.length - 1] });
    } else if (r.hacer === "boton") {
      comprobar("habia boton que tocar", false, "no se pudo tocar nada");
      continue;
    } else {
      await decir(v.id, { texto: r.texto });
    }
    // Se le da tiempo a contestar: el bot escribe por burbujas y con sus esperas.
    await dormir(25000);
    const d2 = await leer(v.id);
    const nuevas = delBot(d2).slice(antes);
    const dicho = textoDe(nuevas);
    comprobar("contesta algo", nuevas.length > 0, `${nuevas.length} burbujas`);
    const precioDespues = preciosDe(dicho);
    /**
     * LO QUE DIGA DESPUES TIENE QUE CUADRAR CON LO QUE DIJO ANTES.
     *
     * Un boton que lleva a un precio distinto del que el bot acaba de anunciar es la peor
     * forma de perder una venta: el cliente se siente engañado justo al pagar. Y lo mismo
     * vale cuando pregunta en vez de tocar.
     *
     * Si despues no nombra ningun precio no se exige nada: contestar una duda sin repetir el
     * precio es correcto.
     */
    /**
     * EL PRECIO DE DESPUES SIGUE SIENDO EL REBAJADO.
     *
     * LA PRIMERA VERSION DE ESTO ESTABA AL REVES y daba rojos falsos: exigia que el precio
     * de despues fuera IGUAL al del seguimiento, y marcaba como fallo que Ecuador pasara de
     * 3,50 a 2,50 — cuando 2,50 ES el rebajado y bajar era lo correcto. Se midio contra su
     * ficha y se dio la vuelta.
     *
     * Lo que de verdad no puede pasar es lo contrario: que tras entrar en la oferta vuelva a
     * cobrar el precio NORMAL. Eso si seria romperle la promesa al cliente.
     */
    if (precioDespues.length === 0) {
      comprobar("no contradice el precio", true, "no nombro precio, correcto");
    } else if (ficha?.rebajado != null && ficha?.normal != null) {
      const volvioAlNormal =
        precioDespues.includes(String(ficha.normal)) &&
        !precioDespues.includes(String(ficha.rebajado));
      comprobar(
        "sigue con el precio rebajado, no vuelve al normal",
        !volvioAlNormal,
        `ficha: ${ficha.normal} → ${ficha.rebajado} · ahora: ${precioDespues.join("/")}`
      );
    } else {
      comprobar("dio un precio", true, precioDespues.join("/"));
    }

    /**
     * Y COMPRA AHI MISMO, dentro del seguimiento — `--comprobante=<ruta>`.
     *
     * ES LA MITAD QUE FALTABA DE SU METODO. El compra en tres momentos distintos a
     * proposito: antes del seguimiento 1, EN el seguimiento 1 y EN el seguimiento 2. Los dos
     * ultimos no se habian probado nunca de forma automatica, y son justo donde el precio
     * cambia.
     *
     * LO QUE SE EXIGE: que apruebe, y que el total cobrado sea el que toca en esta etapa —el
     * rebajado si venimos del seguimiento 2—. Aprobar un pago por el importe equivocado es
     * peor que rechazarlo: el cliente se va contento y la cuenta no cuadra.
     */
    if (COMPROBANTE) {
      console.log("  · y paga aqui mismo");
      const antesDePagar = delBot(d2).length;
      await decir(v.id, { texto: "listo ya pague" });
      await decir(v.id, { archivo: COMPROBANTE });
      const d3 = await queAsienten(v.id, 15000, 180000);
      const c3 = d3.conversation ?? {};
      comprobar(
        "el pago queda aprobado",
        c3.state === "payment_approved",
        `estado=${c3.state}`
      );
      const cobrado = (c3.paid_total_cents ?? 0) / 100;
      if (ficha?.rebajado != null) {
        const esperado = HASTA >= 2 ? ficha.rebajado : ficha.normal;
        comprobar(
          `y cobra ${HASTA >= 2 ? "el precio rebajado" : "el precio normal"}`,
          cobrado === esperado,
          `esperado ${esperado} · cobrado ${cobrado}`
        );
      }
      const entrega = textoDe(delBot(d3).slice(antesDePagar));
      comprobar(
        "y le entrega algo",
        /http|drive|enlace|acceso/i.test(entrega),
        `${entrega.length} caracteres tras el pago`
      );
    }
  }

  /**
   * Y SE BORRAN LAS CONVERSACIONES, salvo que se pida conservarlas.
   *
   * NO ES LIMPIEZA POR ORDEN: dejarlas puso ROJA una prueba de la bateria
   * —`prueba-no-suma-ni-inventa-datos-de-pago`, que vigila las conversaciones VIVAS—.
   * Un banco que ensucia la casa hace que mañana alguien persiga un fallo que no existe.
   * El otro recorrido ya lo hacia asi; esto se copia de el.
   */
  if (tiene("conservar")) {
    console.log(`\n  (conversaciones conservadas: ${ventanas.map((v) => v.id).join(", ")})`);
  } else {
    for (const v of ventanas) {
      await pedir(`/api/test-simulator/${v.id}`, { method: "DELETE" }).catch(() => {});
    }
  }

  console.log("");
  if (fallos > 0) {
    console.log(`> ${fallos} FALLA(S)`);
    process.exit(1);
  }
  console.log("TODO OK — los seguimientos llegaron y traen lo suyo");
}

/**
 * LA CONFIGURACION SUYA SE DEVUELVE PASE LO QUE PASE.
 *
 * Si la prueba se rompe a mitad con el selector movido, su tienda se quedaria vendiendo de
 * otra forma sin que el lo sepa — y eso es exactamente el fallo que vino a buscar. Por eso el
 * deshacer vive aqui fuera, corre en el `finally`, y si fallara se dice A GRITOS con la
 * tienda y el valor, para poder arreglarlo a mano en diez segundos.
 */
let deshacer = null;
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
          `«${TRANSICION}» y hay que quitarselo a mano en el editor. Motivo: ${err.message}`
      );
      process.exitCode = 1;
    }
  });
