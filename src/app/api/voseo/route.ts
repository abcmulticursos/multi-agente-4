import { NextResponse, type NextRequest } from "next/server";
import { getClient } from "@/lib/openrouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * EL VOSEO CON IA (12/11/2026). Él: «tengo que convertir todo el texto en voseo argentino… no quiero cambiar todo el
 * texto, solo voseo y que parezca realmente argentino», y «cuidado con los comodines, no sea que el comodín se vea
 * afectado por la IA».
 *
 * LOS COMODINES NO LLEGAN A LA IA: antes de mandarlos, cada {{…}} y cada enlace se cambia por una marca ⟦n⟧, y al
 * volver se ponen de nuevo. Lo que vuelve se DESCARTA (queda el original) si: falta o sobra una marca, cambió un
 * número, cambió una palabra en MAYÚSCULAS, cambió la forma del spintax ({ | }), cambió la cantidad de emojis o de
 * saltos de línea, o el largo cambió demasiado.
 *
 * «QUE SUENE ARGENTINO» (12/11/2026). Él: «no solo es cambiar eso… que suene como argentino» («tenés problemas con los
 * chicos en casa?») y «no quiero que me cambie la riqueza de lo que quiero decir». Además del voseo, una lista corta de
 * palabras (niños → chicos, aquí → acá…), y se descarta la burbuja si cambian más de 1 de cada 3 palabras. Se aplica de
 * frente (él lee las fichas al final; Ctrl+Z lo deshace): desde el cajón de una ficha o, en el tablero, para las elegidas.
 */
const MARCA = /⟦(\d+)⟧/g;
const numeros = (s: string) => (s.match(/\d+(?:[.,]\d+)*/g) ?? []).sort().join("|");
const mayusculas = (s: string) => (s.match(/(?<![\p{L}\p{M}])[\p{Lu}\p{M}]{4,}(?![\p{L}\p{M}])/gu) ?? []).length;
const forma = (s: string) => s.replace(/[^{}|\n]/g, "");
const emojis = (s: string) => (s.match(/\p{Extended_Pictographic}/gu) ?? []).length;

function protegido(texto: string): { conMarcas: string; guardados: string[] } {
  const guardados: string[] = [];
  const conMarcas = texto.replace(/\{\{\s*[^{}]+?\s*\}\}|https?:\/\/\S+/g, (m) => {
    guardados.push(m);
    return `⟦${guardados.length - 1}⟧`;
  });
  return { conMarcas, guardados };
}

/**
 * LO QUE LA IA «CORRIGE» SE DEVUELVE (12/11/2026). Con «¿COMO LO ADQUIERO?» la IA ponía «CÓMO» y la burbuja entera se
 * descartaba por cambiar una MAYÚSCULA; él lo vio como «dice que no necesita». Cada palabra que la IA dejó igual salvo
 * tildes o mayúsculas vuelve a como la escribió él: solo queda lo que de verdad cambió (el voseo).
 */
const sinTildes = (p: string) => p.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const PALABRA = /^[\p{L}\p{M}]+$/u;
/** Las palabras del texto nuevo que no estaban en el original (sin contar tildes ni mayúsculas). */
function palabrasNuevas(conMarcas: string, dicho: string): string[] {
  const a = conMarcas.split(/([\p{L}\p{M}]+)/u).filter((t) => PALABRA.test(t)).map(sinTildes);
  const b = dicho.split(/([\p{L}\p{M}]+)/u).filter((t) => PALABRA.test(t));
  const L = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === sinTildes(b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const nuevas: string[] = [];
  let i = 0;
  let j = 0;
  while (j < b.length) {
    if (i < a.length && a[i] === sinTildes(b[j])) (i++, j++);
    else if (i < a.length && L[i + 1][j] >= L[i][j + 1]) i++;
    else nuevas.push(b[j++]);
  }
  return nuevas;
}
/**
 * CADA PALABRA CAMBIADA PASA POR LA ADUANA (12/11/2026). Él: «no quiero que cambie la riqueza de lo que quiere decir…
 * no sea que diga Ormidas y piense que es Hormigas», y «no quiero que pongas una regla que diga "a ormidas no le pongas
 * hormigas"». Nada de listas de palabras protegidas: una regla GENERAL por la CLASE de cambio. La IA propone; aquí se
 * queda solo lo que es (1) una tilde, (2) un verbo incompleto (aprovecha → aprovechar), (3) una letra de más o de menos
 * en una palabra común en minúscula (escencial → esencial) y, en voseo, (4) el verbo al voseo, (5) las palabras
 * argentinas de la orden. Todo lo demás vuelve a como lo escribió él. Un nombre con mayúscula («Ormidas») solo puede
 * recibir una tilde.
 */
// «🔄 QUITAR VOSEO» (12/11/2026). Él: «tengo un texto buenísimo pero está en argentino y lo quiero usar en Colombia o
// Perú… al igual que se le pone voseo, quitarlo». `tuteo` = el camino de vuelta, con la misma aduana al revés.
export type Modo = "voseo" | "ortografia" | "tuteo";
const ARGENTINAS: Record<string, string[]> = {
  tu: ["vos"], ti: ["vos"], eres: ["sos"], ven: ["veni"], ninos: ["chicos"], ninas: ["chicas"], nino: ["nene", "chico"], nina: ["nena", "chica"],
  aqui: ["aca"], alli: ["alla"], dinero: ["plata"], movil: ["celular"], ordenador: ["computadora"], coger: ["agarrar"], vale: ["dale"], ahorita: ["ahora"],
};
/** La misma lista al revés, para quitar el voseo: vos → tú, sos → eres, chicos → niños… */
const DE_VUELTA: Record<string, string[]> = {};
for (const [tuteo, voseos] of Object.entries(ARGENTINAS)) for (const v of voseos) (DE_VUELTA[v] ??= []).push(tuteo);
const CLITICO = /(me|nos|te|lo|la|le|los|las|les)$/;
function distancia(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** ¿Vale este cambio de una palabra por otra? (las dos con letras distintas; las tildes van aparte). */
function cambioValido(o: string, n: string, modo: Modo): boolean {
  const so = sinTildes(o);
  const sn = sinTildes(n);
  const minuscula = o[0] === o[0].toLowerCase();
  if (sn === `${so}r`) return true; // verbo incompleto: aprovecha → aprovechar
  // escencial → esencial (pero nunca un verbo entero que pierde su «r»: realizar → realizá no es una errata).
  if (minuscula && so.length >= 4 && so[0] === sn[0] && so !== `${sn}r` && distancia(so, sn) <= 1) return true;
  if (modo === "tuteo") {
    if ((DE_VUELTA[so] ?? []).includes(sn)) return true;
    // El verbo de vuelta: misma primera letra, el voseo terminaba en vocal con tilde (+ s): podés → puedes, escribí → escribe.
    if (so[0] === sn[0] && /[áéí]s?$/iu.test(o) && /[aei]s?$/iu.test(sn) && Math.abs(so.length - sn.length) <= 2) return true;
    // El imperativo con su pronombre: decime → dime, contame → cuéntame, hacelo → hazlo.
    const c = so.match(CLITICO)?.[1];
    return !!c && sn.endsWith(c) && so[0] === sn[0] && Math.abs(so.length - sn.length) <= 2;
  }
  if (modo !== "voseo") return false;
  if ((ARGENTINAS[so] ?? []).includes(sn)) return true;
  // El verbo al voseo: misma primera letra, y el nuevo termina en vocal con tilde (+ s): puedes → podés, escribe → escribí.
  if (so[0] === sn[0] && /[áéí]s?$/iu.test(n) && /[aeiáéí]s?$/iu.test(o) && Math.abs(so.length - sn.length) <= 2) return true;
  // El imperativo con su pronombre: dime → decime, cuéntame → contame, hazlo → hacelo.
  const c = so.match(CLITICO)?.[1];
  if (c && sn.endsWith(c) && so[0] === sn[0] && Math.abs(so.length - sn.length) <= 2) return true;
  return false;
}
/** ¿Vale este cambio de tildes? Poner o mover una tilde, sí; quitarla solo en el voseo de un imperativo (envíanos → envianos). */
function tildeValida(o: string, n: string, modo: Modo): boolean {
  if (/[áéíóú]/iu.test(n)) return true;
  // De vuelta al tuteo, la tilde del voseo se va: realizá → realiza, mirá → mira.
  if (modo === "tuteo") return /[áéí]s?$/iu.test(o);
  return modo === "voseo" && (CLITICO.test(sinTildes(o)) || /[aei]$/i.test(sinTildes(o)));
}
/** La palabra nueva con las mayúsculas y minúsculas de la suya (COMO → CÓMO, nunca «Cómo»). */
const conSuCaso = (o: string, n: string) =>
  [...n].map((ch, k) => (o[k] !== undefined && o[k] === o[k].toUpperCase() && o[k] !== o[k].toLowerCase() ? ch.toUpperCase() : ch.toLowerCase())).join("");
function porLaAduana(conMarcas: string, dicho: string, modo: Modo): string | null {
  const a = conMarcas.split(/([\p{L}\p{M}]+)/u).filter((t) => PALABRA.test(t));
  const partes = dicho.split(/([\p{L}\p{M}]+)/u);
  const b = partes.map((t, i) => [t, i] as const).filter(([t]) => PALABRA.test(t));
  const L = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      L[i][j] = sinTildes(a[i]) === sinTildes(b[j][0]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let viejas: string[] = [];
  let nuevas: Array<readonly [string, number]> = [];
  // Un tramo de palabras distintas entre dos iguales: una por una si son tantas como antes; si no, solo «contigo → con vos».
  const cerrarTramo = (): boolean => {
    if (viejas.length === nuevas.length) {
      viejas.forEach((o, k) => {
        if (!cambioValido(o, nuevas[k][0], modo)) partes[nuevas[k][1]] = o;
      });
    } else if (
      !(modo === "voseo" && viejas.length === 1 && sinTildes(viejas[0]) === "contigo" && nuevas.map((x) => sinTildes(x[0])).join(" ") === "con vos") &&
      !(modo === "tuteo" && viejas.map(sinTildes).join(" ") === "con vos" && nuevas.length === 1 && sinTildes(nuevas[0][0]) === "contigo")
    ) {
      return false;
    }
    viejas = [];
    nuevas = [];
    return true;
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && sinTildes(a[i]) === sinTildes(b[j][0])) {
      if (!cerrarTramo()) return null;
      const [n, k] = b[j];
      // Mayúsculas: siempre las suyas. Tildes: solo si la tilde es válida.
      if (n !== a[i]) partes[k] = n.toLowerCase() === a[i].toLowerCase() || !tildeValida(a[i], n, modo) ? a[i] : conSuCaso(a[i], n);
      i++;
      j++;
    } else if (j >= b.length || (i < a.length && L[i + 1][j] >= L[i][j + 1])) viejas.push(a[i++]);
    else nuevas.push(b[j++]);
  }
  if (!cerrarTramo()) return null;
  return partes.join("");
}

/**
 * «PODÉS REALIZÁ» → «PODÉS REALIZAR» (12/11/2026). La IA pasaba a orden un verbo que debe quedar entero («Podés
 * aprovechar… y realizá un pago»). Sin IA: tras podés/puedes/querés/vas a/para… (o tras «… aprovechar … y»), una orden
 * con tilde final vuelve a ser el verbo entero.
 */
const MODAL = "podés|puedes|podemos|pueden|querés|quieres|vas a|va a|van a|para|poder|debés|debes|tenés que|tienes que|hay que";
const NO_ES_VERBO = new Set(["aca", "alla", "ahi", "aqui", "alli", "mi", "si", "mas", "esta", "sera", "mama", "papa", "bebe", "cafe", "sofa", "quiza", "tambien", "aun", "asi"]);
const entero = (raiz: string, tilde: string) => {
  if (NO_ES_VERBO.has(sinTildes(raiz + tilde))) return null;
  const v = `${raiz}${sinTildes(tilde)}r`;
  return raiz === raiz.toUpperCase() ? v.toUpperCase() : v;
};
function conVerbosEnteros(t: string): string {
  const L = "\\p{L}";
  const tras = new RegExp(`(?<![${L}])(${MODAL})(\\s+[*_~]*)([${L}]{3,}?)([áéí])(?![${L}])`, "giu");
  const yLuego = new RegExp(`(?<![${L}])(${MODAL})(\\s+[*_~]*[${L}]+(?:ar|er|ir)(?![${L}])[^.!?\\n¿¡]{0,60}?\\sy\\s+[*_~]*)([${L}]{3,}?)([áéí])(?![${L}])`, "giu");
  let antes = "";
  while (antes !== t) {
    antes = t;
    t = t.replace(tras, (m, mod, sep, raiz, tilde) => (entero(raiz, tilde) ? `${mod}${sep}${entero(raiz, tilde)}` : m));
    t = t.replace(yLuego, (m, mod, medio, raiz, tilde) => (entero(raiz, tilde) ? `${mod}${medio}${entero(raiz, tilde)}` : m));
  }
  return t;
}

function devuelto(original: string, conMarcas: string, guardados: string[], dichoCrudo: string, modo: Modo): { texto: string | null; motivo?: string } {
  const pasado = porLaAduana(conMarcas, dichoCrudo, modo);
  if (pasado === null) return { texto: null, motivo: "la IA cambió palabras que no son voseo ni ortografía" };
  const dicho = modo === "voseo" ? conVerbosEnteros(pasado) : pasado;
  const marcas = [...dicho.matchAll(MARCA)].map((m) => Number(m[1]));
  if (marcas.length !== guardados.length || new Set(marcas).size !== guardados.length || marcas.some((n) => n >= guardados.length))
    return { texto: null, motivo: "la IA tocó un comodín o un enlace" };
  if (numeros(dicho.replace(MARCA, " ")) !== numeros(conMarcas.replace(MARCA, " "))) return { texto: null, motivo: "la IA cambió un número" };
  // LO QUE QUIERE DECIR NO SE TOCA (12/11/2026). Él: «no quiero que me cambie la riqueza de lo que quiero decir». El
  // voseo y las palabras argentinas cambian pocas palabras; si cambian más de 1 de cada 3 (mínimo 3), la IA reescribió.
  const nuevas = palabrasNuevas(conMarcas, dicho);
  const total = conMarcas.split(/([\p{L}\p{M}]+)/u).filter((t) => PALABRA.test(t)).length;
  if (nuevas.length > Math.max(3, Math.ceil(total / 3))) return { texto: null, motivo: "la IA cambió demasiadas palabras" };
  // Las MAYÚSCULAS (nombres de producto, títulos): las mismas en cantidad, y a lo sumo 2 cambiadas (un verbo al voseo,
  // «¿COMO LO ADQUIERES?» → «ADQUIRÍS»). Antes se exigían idénticas y un título con un verbo tiraba la burbuja entera.
  // Ahora cada palabra en MAYÚSCULAS ya pasó por la aduana (solo tilde o verbo al voseo); aquí, que sigan siendo las mismas.
  if (mayusculas(dicho) !== mayusculas(conMarcas)) return { texto: null, motivo: "la IA cambió una palabra en MAYÚSCULAS" };
  if (forma(dicho) !== forma(conMarcas)) return { texto: null, motivo: "la IA cambió el spintax o los saltos de línea" };
  if (emojis(dicho) !== emojis(conMarcas)) return { texto: null, motivo: "la IA cambió los emojis" };
  const largo = dicho.length / Math.max(1, conMarcas.length);
  if (largo < 0.85 || largo > 1.2) return { texto: null, motivo: "la IA cambió demasiado el texto" };
  const texto = dicho.replace(MARCA, (_, n) => guardados[Number(n)]);
  return { texto: texto === original ? original : texto };
}

const COMUN =
  "NO cambies el sentido, NO agregues ni quites ideas, NO reescribas la frase, NO cambies el orden, la puntuación, los signos ¿? ¡!, los emojis, " +
  "el formato (*negrita*, _cursiva_, ~tachado~), los saltos de línea ni los caracteres { | } (el spintax: cambia solo las palabras dentro). " +
  "NO cambies nombres propios, marcas, nombres de productos ni palabras raras o que no conozcas: si una palabra puede ser un nombre, déjala. " +
  "Las marcas ⟦0⟧, ⟦1⟧… déjalas exactamente donde están. Si no hay nada que cambiar, devuelve el texto igual. " +
  'Responde SOLO con JSON: {"textos": ["…", "…"]} en el mismo orden y con la misma cantidad.';
const ORTOGRAFIA_DE_PASO =
  "Corrige también la ortografía evidente de palabras comunes: tildes que faltan (como → cómo en una pregunta, opcion → opción, facil → fácil), " +
  "una letra equivocada (escencial → esencial) y el verbo que quedó a medias (puedes aprovecha → puedes aprovechar). ";
const ORDEN_VOSEO =
  "Pasas mensajes de WhatsApp de ventas al VOSEO de Argentina, cambiando LO MÍNIMO. Cambia la segunda persona del tuteo: " +
  "«tú» → «vos»; los verbos al voseo (tienes → tenés, puedes → podés, quieres → querés, eres → sos, sabes → sabés, necesitas → necesitás, vienes → venís, deseas → deseás, prefieres → preferís); " +
  "los imperativos (escribe → escribí, mira → mirá, elige → elegí, envía → enviá, envíanos → envianos, realiza → realizá, responde → respondé, indica → indicá, " +
  "descarga → descargá, completa → completá, llévate → llevate, cuéntame → contame, dime → decime, hazlo → hacelo, ven → vení, aprovecha → aprovechá); " +
  "también en MAYÚSCULAS (RESPONDE → RESPONDÉ, ESCRIBE → ESCRIBÍ). «contigo» → «con vos». Los pronombres te/tu/tus/ti se quedan salvo «ti» tras preposición → «vos». " +
  "OJO: el verbo ENTERO (infinitivo) NO se cambia nunca: «podés realizar», «para obtener», «vas a recibir», «aprovechar… y realizar» se quedan así. " +
  "Pasa la burbuja COMPLETA: no dejes un «tú» al lado de un «vos» (si deseas podés → si deseás podés). " +
  "Para que suene argentino, cambia SOLO estas palabras cuando aparezcan, una por una: niños/niñas → chicos/chicas, niño/niña (uno solo) → nene/nena, " +
  "aquí → acá, allí → allá, dinero → plata, móvil → celular, ordenador → computadora, coger → agarrar, vale (=de acuerdo) → dale, ahorita → ahora. " +
  ORTOGRAFIA_DE_PASO +
  "Si un texto usa «usted», déjalo igual. " +
  COMUN;
const ORDEN_TUTEO =
  "Pasas mensajes de WhatsApp de ventas del VOSEO argentino al TUTEO neutro (para Colombia, Perú, Ecuador…), cambiando LO MÍNIMO. " +
  "«vos» → «tú» (o «ti» tras preposición: para vos → para ti; con vos → contigo); los verbos (tenés → tienes, podés → puedes, querés → quieres, sos → eres, " +
  "sabés → sabes, necesitás → necesitas, venís → vienes, deseás → deseas, preferís → prefieres, recibís → recibes, obtenés → obtienes); " +
  "los imperativos (escribí → escribe, mirá → mira, elegí → elige, enviá → envía, envianos → envíanos, mandanos → mándanos, realizá → realiza, respondé → responde, " +
  "indicá → indica, descargá → descarga, completá → completa, llevate → llévate, contame → cuéntame, decime → dime, hacelo → hazlo, vení → ven, aprovechá → aprovecha); " +
  "también en MAYÚSCULAS (RESPONDÉ → RESPONDE, ESCRIBÍ → ESCRIBE). El verbo ENTERO (podés realizar → puedes realizar) se queda entero. " +
  "Las palabras muy argentinas, de vuelta: chicos/chicas (hijos) → niños/niñas, nene/nena → niño/niña, plata → dinero. «acá» puede quedarse. " +
  "Pasa la burbuja COMPLETA: no dejes un «vos» al lado de un «tú». " +
  ORTOGRAFIA_DE_PASO +
  "Si un texto usa «usted», déjalo igual. " +
  COMUN;
const ORDEN_ORTOGRAFIA =
  "Corriges la ORTOGRAFÍA de mensajes de WhatsApp de ventas, cambiando LO MÍNIMO. " +
  ORTOGRAFIA_DE_PASO +
  "NO cambies el tuteo, el voseo ni el usted: cada texto sigue hablando igual. NO cambies palabras por sinónimos ni regionalismos. " +
  COMUN;

export async function POST(req: NextRequest) {
  let body: { textos?: unknown; modo?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }
  const modo: Modo = body.modo === "ortografia" ? "ortografia" : body.modo === "tuteo" ? "tuteo" : "voseo";
  const textos = Array.isArray(body.textos) ? body.textos.map((t) => (typeof t === "string" ? t.slice(0, 4000) : "")).slice(0, 60) : [];
  if (!textos.some((t) => t.trim())) return NextResponse.json({ error: "No hay texto que revisar." }, { status: 400 });
  const piezas = textos.map(protegido);
  try {
    const r = await getClient().chat.completions.create({
      model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
      temperature: 0,
      ...({ reasoning: { enabled: false }, usage: { include: true } } as object),
      messages: [
        { role: "system", content: modo === "voseo" ? ORDEN_VOSEO : modo === "tuteo" ? ORDEN_TUTEO : ORDEN_ORTOGRAFIA },
        { role: "user", content: JSON.stringify({ textos: piezas.map((p) => p.conMarcas) }) },
      ],
    });
    const crudo = (r.choices[0]?.message?.content ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    let dichos: unknown[] = [];
    try {
      const j = JSON.parse(crudo.slice(crudo.indexOf("{"), crudo.lastIndexOf("}") + 1)) as { textos?: unknown };
      dichos = Array.isArray(j.textos) ? j.textos : [];
    } catch {
      return NextResponse.json({ error: "La IA no respondió bien. Prueba otra vez." }, { status: 502 });
    }
    const resultados = textos.map((t, i) => {
      if (!t.trim()) return { texto: t };
      const d = dichos[i];
      if (typeof d !== "string" || !d.trim()) return { texto: null, motivo: "la IA no devolvió esta burbuja" };
      const r = devuelto(t, piezas[i].conMarcas, piezas[i].guardados, d, modo);
      // En el log, qué propuso la IA cuando se descarta: así se ve por qué una burbuja «quedó igual».
      if (r.texto === null) console.log(`[voseo] descartada (${r.motivo}): «${d.replace(/\s+/g, " ").slice(0, 300)}»`);
      return r;
    });
    const uso = r.usage as { prompt_tokens?: number; completion_tokens?: number; cost?: number } | undefined;
    console.log(`[voseo] ${modo} · ${textos.length} texto(s) → ${resultados.filter((x) => x.texto && x.texto !== textos[resultados.indexOf(x)]).length} cambiados, ${resultados.filter((x) => x.texto === null).length} descartados · ${uso?.prompt_tokens ?? "?"}+${uso?.completion_tokens ?? "?"} tokens${typeof uso?.cost === "number" ? ` · $${uso.cost.toFixed(5)}` : ""}`);
    return NextResponse.json({ resultados, costo: typeof uso?.cost === "number" ? uso.cost : null });
  } catch (err) {
    console.error("[voseo] no se pudo pedir:", err);
    return NextResponse.json({ error: "No se pudo conectar con la IA. Prueba otra vez." }, { status: 502 });
  }
}
