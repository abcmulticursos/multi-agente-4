/**
 * EL TABLERO EN EL ARCHIVO: se lee y se limpia aquí, para la ruta de guardado (ida y vuelta) y
 * para el bot. Solo números finitos, textos cortos y listas con tope: algo raro en el archivo no
 * puede tumbar ni el editor ni el bot. Ver `tipos.ts` y PLAN-TABLERO.md.
 */
import type { BubbleButton, BubbleDecision, SequenceStep } from "@/lib/workflow/config";
import type {
  CableDelTablero,
  CobroDeLaFicha,
  CondicionDeLaFicha,
  FichaDelTablero,
  OpcionDeReparto,
  SalidaDeFicha,
  SeguimientoDeLaFicha,
  Tablero,
  TablerosDeLaTienda,
  TipoDeFicha,
  TramoDeCobro,
  VarianteDeFicha,
} from "./tipos";
import { CANALES_DEL_TABLERO } from "./tipos";
import type { CanalDelTablero } from "./tipos";

const TIPOS: TipoDeFicha[] = [
  "inicio",
  "mensaje",
  "seguimientos",
  "intro_ob",
  "entregar",
  "cobro",
  "condicion",
  "reparto",
  "esperar",
  "workflow",
  "regalo",
  "humano",
  "correo",
];

/**
 * EL CEREBRO GENERAL DE FÁBRICA (24/10/2026): quién es la IA y cómo habla en todo el tablero. Él lo
 * cambia en «🧠 Cerebro» si quiere; vacío vale éste. Las reglas que protegen el dinero (nunca números
 * de cuenta, solo los montos permitidos, solo lo presentado) no están aquí: van siempre, en el código.
 */
export const CEREBRO_DE_FABRICA = [
  "Eres el asistente de ventas de esta tienda por WhatsApp: persuasivo sin presionar, cálido y breve.",
  "Contesta primero lo que el cliente pregunta y después devuélvelo con suavidad a lo que tiene pendiente.",
  "Si pregunta el precio, dilo de frente con una frase corta de valor y una invitación suave. No lo esquives.",
  "Si muestra desconfianza o miedo a una estafa: primero reconoce lo que siente, luego tranquilízalo con honestidad y brevedad (la entrega es inmediata al validar el comprobante, el nombre del titular es siempre el mismo y verificable) y después invítalo con calma a seguir.",
  "Escribe en párrafos cortos separados por una línea en blanco (cada uno sale como una burbuja de WhatsApp: una idea por burbuja), con un emoji como mucho. No uses el nombre del cliente.",
].join("\n");

/** La ventana de Meta: pasado esto sin que el cliente escriba, un mensaje libre no llega. */
export const VENTANA_DE_META_MIN = 24 * 60 - 7;

const texto = (t: unknown, max: number): string => String(t ?? "").slice(0, max);
const numero = (n: unknown): number | undefined =>
  typeof n === "number" && Number.isFinite(n) ? n : undefined;
const positivo = (n: unknown): number | undefined => {
  const v = numero(n);
  return v !== undefined && v > 0 ? v : undefined;
};
const esObjeto = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const pais = (p: string): string | null => {
  const k = p.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(k) ? k : null;
};
const ids = (v: unknown, max = 60): string[] =>
  Array.isArray(v) ? [...new Set(v.slice(0, max).map((x) => texto(x, 120).trim()).filter(Boolean))] : [];

function leeTramos(v: unknown): TramoDeCobro[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 30).flatMap((t) => {
    const desde = numero((t as { desde?: unknown })?.desde);
    if (desde === undefined || desde < 0) return [];
    const hasta = numero((t as { hasta?: unknown })?.hasta);
    const id = texto((t as { id?: unknown })?.id, 60).trim();
    if (!id) return [];
    return [{ id, desde, ...(hasta !== undefined && hasta >= desde ? { hasta } : {}) }];
  });
}

function leeCobro(v: unknown): CobroDeLaFicha | undefined {
  if (!esObjeto(v)) return undefined;
  const modo = v.modo === "abierto" ? "abierto" : "producto";
  const minimo_por_pais: Record<string, number> = {};
  if (esObjeto(v.minimo_por_pais))
    for (const [k, n] of Object.entries(v.minimo_por_pais).slice(0, 60)) {
      const p = pais(k);
      const m = numero(n);
      if (p && m !== undefined && m >= 0) minimo_por_pais[p] = m;
    }
  const precio_por_pais: Record<string, number> = {};
  if (esObjeto(v.precio_por_pais))
    for (const [k, n] of Object.entries(v.precio_por_pais).slice(0, 60)) {
      const p = pais(k);
      const m = numero(n);
      if (p && m !== undefined && m > 0) precio_por_pais[p] = m;
    }
  const tramos_por_pais: Record<string, TramoDeCobro[]> = {};
  if (esObjeto(v.tramos_por_pais))
    for (const [k, lista] of Object.entries(v.tramos_por_pais).slice(0, 60)) {
      const p = pais(k);
      const tramos = leeTramos(lista);
      if (p && tramos.length > 0) tramos_por_pais[p] = tramos;
    }
  const producto_id = texto(v.producto_id, 120).trim();
  const acepta = ids(v.acepta, 20).filter((x) => x !== producto_id);
  const precio = v.precio === "normal" || v.precio === "oferta" ? v.precio : undefined;
  return {
    modo,
    ...(producto_id ? { producto_id } : {}),
    ...(acepta.length ? { acepta } : {}),
    ...(precio ? { precio } : {}),
    ...(Object.keys(minimo_por_pais).length ? { minimo_por_pais } : {}),
    ...(Object.keys(tramos_por_pais).length ? { tramos_por_pais } : {}),
    ...(modo === "producto" && v.metodos === true ? { metodos: true } : {}),
    ...(modo === "producto" && v.metodos === true && v.sin_preguntar === true ? { sin_preguntar: true } : {}),
    ...(modo === "producto" && v.diferencia === true ? { diferencia: true } : {}),
    ...(modo === "producto" && Object.keys(precio_por_pais).length ? { precio_por_pais } : {}),
  };
}

function leeCondicion(v: unknown): CondicionDeLaFicha | undefined {
  if (!esObjeto(v)) return undefined;
  const tipo = v.tipo === "pais" || v.tipo === "anuncio" ? v.tipo : "compro";
  const producto_id = texto(v.producto_id, 120).trim();
  const paises = Array.isArray(v.paises)
    ? [...new Set(v.paises.slice(0, 60).map((p) => pais(String(p))).filter((p): p is string => !!p))]
    : [];
  const anuncios = ids(v.anuncios, 100);
  return {
    tipo,
    ...(producto_id ? { producto_id } : {}),
    ...(paises.length ? { paises } : {}),
    ...(anuncios.length ? { anuncios } : {}),
  };
}

function leeVariantes(v: unknown, leerPasos: (p: unknown[]) => unknown[]): VarianteDeFicha[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 10).flatMap((x) => {
    if (!esObjeto(x)) return [];
    const id = texto(x.id, 80).trim();
    if (!id) return [];
    const peso = numero(x.peso);
    const nombre = texto(x.nombre, 80).trim();
    // SUS ANUNCIOS (24/10/2026), como las etiquetas de AD de la pizarra: claves del registro.
    const anuncios = Array.isArray(x.anuncios)
      ? [...new Set(x.anuncios.slice(0, 40).map((a) => texto(a, 80).trim()).filter(Boolean))]
      : [];
    return [
      {
        id,
        ...(nombre ? { nombre } : {}),
        ...(peso !== undefined && peso >= 0 ? { peso } : {}),
        ...(anuncios.length ? { anuncios } : {}),
        ...(x.dirigir === false ? { dirigir: false } : {}),
        steps: (Array.isArray(x.steps) ? leerPasos(x.steps.slice(0, 60)) : []) as SequenceStep[],
      },
    ];
  });
}

function leeSeguimientos(v: unknown, leerPasos: (p: unknown[]) => unknown[]): SeguimientoDeLaFicha[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 12).flatMap((x) => {
    if (!esObjeto(x)) return [];
    const id = texto(x.id, 80).trim();
    if (!id) return [];
    return [
      {
        id,
        minutos: Math.max(1, Math.round(positivo(x.minutos) ?? 180)),
        variantes: leeVariantes(x.variantes, leerPasos),
        ...(x.activa_oferta === true ? { activa_oferta: true } : {}),
        ...(x.ignora_silencio === true ? { ignora_silencio: true } : {}),
        ...(x.ignora_tardio === true ? { ignora_tardio: true } : {}),
      },
    ];
  });
}

function leeReparto(v: unknown): OpcionDeReparto[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 10).flatMap((x) => {
    if (!esObjeto(x)) return [];
    const id = texto(x.id, 60).trim();
    if (!id) return [];
    const nombre = texto(x.nombre, 60).trim();
    return [{ id, ...(nombre ? { nombre } : {}), peso: Math.max(0, numero(x.peso) ?? 1) }];
  });
}

/**
 * Lee un tablero. `leerPasos` convierte las burbujas: la ruta de guardado pasa la suya (el editor
 * y el archivo no las escriben igual); el bot las usa tal cual vienen del archivo.
 */
export function leeTablero(v: unknown, leerPasos: (pasos: unknown[]) => unknown[] = (p) => p): Tablero {
  const crudo = esObjeto(v) ? v : {};
  const fichas: FichaDelTablero[] = (Array.isArray(crudo.fichas) ? crudo.fichas : [])
    .slice(0, 500)
    .flatMap((f) => {
      if (!esObjeto(f)) return [];
      const id = texto(f.id, 80).trim();
      const tipo = TIPOS.includes(f.tipo as TipoDeFicha) ? (f.tipo as TipoDeFicha) : null;
      if (!id || !tipo) return [];
      const ficha: FichaDelTablero = {
        id,
        tipo,
        x: Math.round(numero(f.x) ?? 0),
        y: Math.round(numero(f.y) ?? 0),
      };
      const titulo = texto(f.titulo, 120).trim();
      if (titulo) ficha.titulo = titulo;
      if (tipo === "inicio") {
        const p = pais(String(f.pais ?? ""));
        if (p) ficha.pais = p;
        if (f.sin_venta === true) ficha.sin_venta = true;
        if (f.en_revision === true) ficha.en_revision = true;
        // Sus anuncios (26/10/2026): cada uno con su salida, para llevarlo a otra tubería.
        const anuncios = ids(f.anuncios, 40);
        if (anuncios.length) ficha.anuncios = anuncios;
      }
      if (f.apagada === true && tipo !== "inicio") ficha.apagada = true;
      if (f.guardada === true && tipo !== "inicio") ficha.guardada = true;
      if ((tipo === "mensaje" || tipo === "cobro" || tipo === "correo") && Array.isArray(f.steps))
        ficha.steps = leerPasos(f.steps.slice(0, 60)) as FichaDelTablero["steps"];
      const presenta = ids(f.presenta, 20);
      if ((tipo === "mensaje" || tipo === "intro_ob" || tipo === "seguimientos") && presenta.length) ficha.presenta = presenta;
      if (tipo === "correo") {
        const asunto = texto(f.correo_asunto, 200).trim();
        const cuerpo = texto(f.correo_texto, 4000);
        if (asunto) ficha.correo_asunto = asunto;
        if (cuerpo.trim()) ficha.correo_texto = cuerpo;
      }
      const instrucciones = texto(f.instrucciones, 3000).trim();
      if (instrucciones && tipo !== "inicio") ficha.instrucciones = instrucciones;
      if (tipo === "entregar" && f.por_correo === true) {
        ficha.por_correo = true;
        for (const k of ["correo_pregunta", "correo_si", "correo_no", "correo_pide"] as const) {
          const v = texto(f[k], k === "correo_si" || k === "correo_no" ? 20 : 600).trim();
          if (v) ficha[k] = v;
        }
      }
      if (tipo === "intro_ob") ficha.variantes = leeVariantes(f.variantes, leerPasos);
      if (tipo === "seguimientos") ficha.seguimientos = leeSeguimientos(f.seguimientos, leerPasos);
      if (tipo === "reparto") ficha.reparto = leeReparto(f.reparto);
      const sr = positivo(f.sin_respuesta_min);
      if ((tipo === "mensaje" || tipo === "intro_ob" || tipo === "correo") && sr) ficha.sin_respuesta_min = sr;
      const em = positivo(f.espera_min);
      if (tipo === "mensaje" && em) ficha.espera_min = em;
      const sp = positivo(f.sin_pago_min);
      if (tipo === "cobro" && sp) ficha.sin_pago_min = sp;
      const producto = texto(f.producto_id, 120).trim();
      if (tipo === "entregar" && producto) ficha.producto_id = producto;
      if (tipo === "entregar" && Array.isArray(f.entregas)) {
        const lista = f.entregas.map((x) => texto(x, 200).trim()).filter(Boolean).slice(0, 10);
        if (lista.length) ficha.entregas = lista;
      }
      if (tipo === "cobro") ficha.cobro = leeCobro(f.cobro) ?? { modo: "producto" };
      if (tipo === "condicion") ficha.condicion = leeCondicion(f.condicion) ?? { tipo: "compro" };
      const min = positivo(f.minutos);
      if (tipo === "esperar" && min) ficha.minutos = min;
      const wf = texto(f.workflow_id, 120).trim();
      if (tipo === "workflow" && wf) ficha.workflow_id = wf;
      return [ficha];
    });
  const idsDeFichas = new Set(fichas.map((f) => f.id));
  const vistos = new Set<string>();
  const cables: CableDelTablero[] = (Array.isArray(crudo.cables) ? crudo.cables : [])
    .slice(0, 2000)
    .flatMap((c) => {
      if (!esObjeto(c)) return [];
      const de = texto(c.de, 80).trim();
      const a = texto(c.a, 80).trim();
      const salida = texto(c.salida, 140).trim();
      if (!idsDeFichas.has(de) || !idsDeFichas.has(a) || !salida) return [];
      // UNA SALIDA, UN CABLE: si llegan dos, gana el primero. Dos cables desde el mismo puntito
      // dejarían al bot sin saber cuál seguir.
      const llave = `${de}|${salida}`;
      if (vistos.has(llave)) return [];
      vistos.add(llave);
      const vista = c.vista === "colita" || c.vista === "cable" ? c.vista : undefined;
      return [{ id: texto(c.id, 120).trim() || `c-${llave}`, de, salida, a, ...(vista ? { vista } : {}) }];
    });
  const curvas: Record<string, { x: number; y: number }> = {};
  if (esObjeto(crudo.curvas))
    for (const [k, p] of Object.entries(crudo.curvas).slice(0, 2000)) {
      const x = numero((p as { x?: unknown })?.x);
      const y = numero((p as { y?: unknown })?.y);
      if (x !== undefined && y !== undefined && Math.abs(x) < 100000 && Math.abs(y) < 100000)
        curvas[texto(k, 140)] = { x: Math.round(x), y: Math.round(y) };
    }
  const nombre = texto(crudo.nombre, 80).trim();
  // 40.000: cabe la copia entera de su cerebro del automático (≈18.000), que antes se cortaba a 6.000.
  const cerebro = texto(crudo.cerebro, 40000).trim();
  const cajas = Array.isArray(crudo.cajas)
    ? crudo.cajas.slice(0, 200).flatMap((k) => {
        if (!esObjeto(k)) return [];
        const x = numero(k.x), y = numero(k.y), ancho = numero(k.ancho), alto = numero(k.alto);
        const id = texto(k.id, 80).trim();
        if (!id || x === undefined || y === undefined || !ancho || !alto) return [];
        const color = texto(k.color, 20).trim();
        // LA MANTA DE UN PAÍS (24/10/2026): la caja que es el fondo de un Inicio. La maneja él.
        const inicio = texto(k.inicio, 80).trim();
        return [{ id, x: Math.round(x), y: Math.round(y), ancho: Math.round(ancho), alto: Math.round(alto), titulo: texto(k.titulo, 80), ...(color ? { color } : {}), ...(inicio ? { inicio } : {}) }];
      })
    : [];
  return {
    encendido: crudo.encendido === true,
    ...(nombre ? { nombre } : {}),
    ...(cerebro ? { cerebro } : {}),
    fichas,
    cables,
    ...(Object.keys(curvas).length ? { curvas } : {}),
    ...(cajas.length ? { cajas } : {}),
  };
}

/**
 * LOS TABLEROS DE UNA TIENDA, UNO POR CANAL. Lo guardado antes del 23/10/2026 era UN tablero por
 * tienda (con `fichas` dentro): se lee como el de WhatsApp, que es donde funcionaba.
 */
export function leeTablerosDeLaTienda(
  v: unknown,
  leerPasos?: (pasos: unknown[]) => unknown[]
): TablerosDeLaTienda {
  if (!esObjeto(v)) return {};
  if (Array.isArray(v.fichas)) return { whatsapp: leeTablero(v, leerPasos) };
  const fuera: TablerosDeLaTienda = {};
  for (const canal of CANALES_DEL_TABLERO) if (esObjeto(v[canal])) fuera[canal] = leeTablero(v[canal], leerPasos);
  return fuera;
}

/** Todos los tableros, por tienda y canal. */
export function leeTablerosPorTienda(
  v: unknown,
  leerPasos?: (pasos: unknown[]) => unknown[]
): Record<string, TablerosDeLaTienda> {
  const fuera: Record<string, TablerosDeLaTienda> = {};
  if (!esObjeto(v)) return fuera;
  for (const [clave, t] of Object.entries(v).slice(0, 200)) {
    const k = texto(clave, 120).trim();
    if (k) fuera[k] = leeTablerosDeLaTienda(t, leerPasos);
  }
  return fuera;
}

/** El canal de una conversación, tal como lo ve el tablero (el simulador dice cuál imita). */
export function canalDelTablero(convo: { channel?: string | null; test_channel?: string | null }): CanalDelTablero {
  const c = convo.channel === "test" ? convo.test_channel : convo.channel;
  return c === "messenger" || c === "instagram" ? c : "whatsapp";
}

/** EL INICIO QUE LE TOCA A UN PAÍS: el suyo, o el de «Otros países». */
export function inicioDelPais(t: Tablero, pais: string): FichaDelTablero | null {
  const inicios = t.fichas.filter((f) => f.tipo === "inicio");
  return inicios.find((f) => f.pais === pais) ?? inicios.find((f) => !f.pais) ?? null;
}

/** Todos los tableros guardados, por tienda (o por id de workflow). */
export function leeTableros(
  v: unknown,
  leerPasos?: (pasos: unknown[]) => unknown[]
): Record<string, Tablero> {
  const fuera: Record<string, Tablero> = {};
  if (!esObjeto(v)) return fuera;
  for (const [clave, t] of Object.entries(v).slice(0, 200)) {
    const k = texto(clave, 120).trim();
    if (k) fuera[k] = leeTablero(t, leerPasos);
  }
  return fuera;
}

/** LA CLAVE DE UN WORKFLOW en `tablero_estado`, para distinguirla de la de una tienda. */
export const claveDeWorkflow = (id: string) => `wf:${id}`;
export const esClaveDeWorkflow = (clave: string) => clave.startsWith("wf:");

/** Todas las burbujas de una ficha: las suyas y las de sus versiones y seguimientos. */
export function pasosDeLaFicha(f: FichaDelTablero): SequenceStep[] {
  const encendidas = (pasos: SequenceStep[] | undefined) =>
    (pasos ?? []).filter((s) => (s as { enabled?: boolean }).enabled !== false);
  if (f.tipo === "intro_ob") return (f.variantes ?? []).flatMap((v) => encendidas(v.steps));
  if (f.tipo === "seguimientos") return (f.seguimientos ?? []).flatMap((s) => s.variantes.flatMap((v) => encendidas(v.steps)));
  return encendidas(f.steps);
}

/** Los botones y cuadritos de unas burbujas (cada uno una salida). */
export function opcionesDe(pasos: SequenceStep[]): { botones: BubbleButton[]; cuadritos: BubbleDecision[] } {
  const botones: BubbleButton[] = [];
  const cuadritos: BubbleDecision[] = [];
  const vistos = new Set<string>();
  for (const p of pasos) {
    for (const b of p.buttons ?? []) if (b?.id && !vistos.has(`b${b.id}`)) (vistos.add(`b${b.id}`), botones.push(b));
    for (const d of p.decisions ?? [])
      if (d?.id && d.enabled !== false && !vistos.has(`d${d.id}`)) (vistos.add(`d${d.id}`), cuadritos.push(d));
  }
  return { botones, cuadritos };
}

/**
 * ELEGIR DE PALABRA, SIN BOTONES NI CUADRITOS (27/10/2026): una Intro o un Order bump que presenta dos
 * o más productos y no tiene ninguna opción tiene una salida por producto («✍️ Si elige X»). El
 * cliente lo escribe como quiera y la IA reconoce cuál; así cada camino tiene su cable a la vista.
 * Salen de su «🏷 Presenta»: si se quita un producto de ahí, su salida se va.
 */
export function eligeDeLaFicha(f: FichaDelTablero): string[] {
  if (f.tipo !== "mensaje" && f.tipo !== "intro_ob") return [];
  const presenta = [...new Set(f.presenta ?? [])];
  if (presenta.length < 2) return [];
  const { botones, cuadritos } = opcionesDe(pasosDeLaFicha(f));
  return botones.length + cuadritos.length === 0 ? presenta : [];
}

const FICHAS_CON_RESPUESTA: TipoDeFicha[] = ["mensaje", "intro_ob", "seguimientos"];

/** LO QUE MANDA UNA FICHA «ENTREGAR», en orden: su lista de entregas, o la principal de su producto. */
export function entregasDeLaFicha(f: FichaDelTablero): string[] {
  if (f.entregas?.length) return f.entregas;
  return f.producto_id ? [f.producto_id] : [];
}

/**
 * LAS SALIDAS DE UNA FICHA: los puntitos de los que él tira cables. Las mismas para la pantalla y
 * para el bot, por eso viven aquí. `nombres` pone nombre a los productos (pantalla).
 */
export function salidasDeLaFicha(
  f: FichaDelTablero,
  paisVisto?: string,
  nombres?: Record<string, string>
): SalidaDeFicha[] {
  switch (f.tipo) {
    case "inicio":
      // VARIAS TUBERÍAS EN UN PAÍS (26/10/2026): una salida por cada anuncio marcado, y «→» para los demás.
      return [
        ...(f.anuncios ?? []).map((k) => ({ clave: `anuncio:${k}`, etiqueta: `📣 ${nombres?.[`anuncio:${k}`] ?? k}` })),
        { clave: "siguiente", etiqueta: (f.anuncios ?? []).length ? "→ Los demás" : "→" },
      ];
    case "entregar":
    case "esperar":
      return [{ clave: "siguiente", etiqueta: "→" }];
    case "humano":
    case "workflow":
      return [];
    case "regalo":
      return [{ clave: "fin", etiqueta: "🏁 Al terminar el regalo" }];
    case "correo":
      return [
        { clave: "enviado", etiqueta: "✉️ Correo enviado" },
        ...(f.sin_respuesta_min ? [{ clave: "sin_respuesta", etiqueta: `⏰ No dio su correo en ${minutosLegibles(f.sin_respuesta_min)}` }] : []),
      ];
    case "condicion":
      return [
        { clave: "si", etiqueta: "Sí" },
        { clave: "no", etiqueta: "No" },
      ];
    case "reparto": {
      const opciones = f.reparto ?? [];
      const total = opciones.reduce((s, o) => s + o.peso, 0) || 1;
      return opciones.map((o, i) => ({
        clave: `rep:${o.id}`,
        etiqueta: `🎲 ${o.nombre || `Ruta ${i + 1}`} · ${Math.round((o.peso / total) * 100)}%`,
      }));
    }
    case "mensaje":
    case "intro_ob":
    case "seguimientos": {
      const salidas: SalidaDeFicha[] = [];
      const { botones, cuadritos } = opcionesDe(pasosDeLaFicha(f));
      for (const b of botones) salidas.push({ clave: `btn:${b.id}`, etiqueta: `🔘 ${b.label || "Botón"}` });
      for (const d of cuadritos)
        salidas.push({
          clave: `dec:${d.id}`,
          etiqueta: `💬 ${d.title || (d.keywords ?? []).slice(0, 2).join(", ") || "Otra respuesta"}`,
        });
      // ELIGE DE PALABRA, SIN BOTONES NI CUADRITOS (27/10/2026): una salida por cada producto que presenta.
      for (const id of eligeDeLaFicha(f)) salidas.push({ clave: `elige:${id}`, etiqueta: `✍️ Si elige ${nombres?.[id] ?? "este producto"}` });
      const pregunta = salidas.length > 0;
      if (f.tipo === "seguimientos") {
        salidas.push({ clave: "fin", etiqueta: "🏁 Terminaron sin respuesta" });
        return salidas;
      }
      // SIN OPCIONES, «→» es continuar. CON OPCIONES (26/10/2026) ese mismo puntito dice lo que hace:
      // «⏳ Seguimientos» va a sus Seguimientos (salen mientras no elige; sus opciones siguen valiendo), y
      // «⏳ Si no responde» siempre se ve (a sus minutos, o al silencio del regalo si no tiene).
      if (!pregunta) {
        salidas.push({ clave: "siguiente", etiqueta: "→" });
        return salidas;
      }
      // 27/10/2026: «"si no elige seguimientos" confunde»: se llama como lo que es, sus Seguimientos.
      salidas.push({ clave: "siguiente", etiqueta: "⏳ Seguimientos" });
      salidas.push({
        clave: "sin_respuesta",
        etiqueta: f.sin_respuesta_min ? `⏳ Si no responde en ${minutosLegibles(f.sin_respuesta_min)}` : "⏳ Si no responde",
      });
      // «Otra cosa» ya no aparece sola: solo se ve en la ficha que ya la tiene conectada (el lienzo la
      // filtra), así nada de lo que existe se rompe.
      salidas.push({ clave: "otra", etiqueta: "✍️ Otra cosa" });
      return salidas;
    }
    case "cobro": {
      const salidas: SalidaDeFicha[] = [];
      if (f.cobro?.modo === "abierto") {
        const paises = paisVisto ? [paisVisto] : Object.keys(f.cobro.tramos_por_pais ?? {});
        // Las salidas de los tramos van por id, que es el mismo en todos los países: el tramo 1
        // de Perú y el tramo 1 de México salen por el MISMO puntito, cada uno con sus montos.
        const vistos = new Set<string>();
        for (const p of paises)
          for (const t of f.cobro.tramos_por_pais?.[p] ?? []) {
            if (vistos.has(t.id)) continue;
            vistos.add(t.id);
            salidas.push({
              clave: `tramo:${t.id}`,
              etiqueta: paisVisto
                ? `💰 ${t.desde}${t.hasta !== undefined ? `–${t.hasta}` : "+"}`
                : `💰 Tramo ${vistos.size}`,
            });
          }
        // Un monto que no cae en ningún tramo (o sin tramos puestos para ese país).
        salidas.push({ clave: "pagado", etiqueta: "✅ Pagó (fuera de tramos)" });
        salidas.push({ clave: "menos", etiqueta: "↓ Menos del mínimo" });
      } else {
        salidas.push({ clave: "pagado", etiqueta: `✅ Pagó ${nombres?.[f.cobro?.producto_id ?? ""] ?? ""}`.trim() });
        for (const otro of f.cobro?.acepta ?? [])
          salidas.push({ clave: `prod:${otro}`, etiqueta: `✅ Pagó ${nombres?.[otro] ?? "otro producto"}` });
        salidas.push({ clave: "menos", etiqueta: "↓ Pagó de menos" });
      }
      // «SI NO PAGA»: siempre está y siempre se llama igual (26/10/2026: sin minutos sueltos). Hacia unos
      // Seguimientos salen a sus tiempos; hacia otra ficha (el Regalo), tras el silencio del regalo.
      salidas.push({ clave: "sin_pago", etiqueta: "⏳ Si no paga" });
      return salidas;
    }
  }
}

export function minutosLegibles(m: number): string {
  if (m % 1440 === 0) return `${m / 1440} día${m === 1440 ? "" : "s"}`;
  if (m % 60 === 0) return `${m / 60} h`;
  return `${m} min`;
}

/** El cable de una salida, o null si él no tiró ninguno: una salida sin cable no hace nada. */
export function cableDeLaSalida(t: Tablero, fichaId: string, salida: string): CableDelTablero | null {
  return t.cables.find((c) => c.de === fichaId && c.salida === salida) ?? null;
}

/**
 * ¿Este tablero atiende a un cliente de ese país? Encendido, con el Inicio de su país (o el de
 * «Otros países») vendiendo, fuera de revisión y con su cable puesto.
 */
export function elTableroAtiende(t: Tablero | null | undefined, pais?: string): boolean {
  if (!t?.encendido) return false;
  const inicio = pais ? inicioDelPais(t, pais) : t.fichas.find((f) => f.tipo === "inicio");
  if (!inicio || inicio.sin_venta || inicio.en_revision) return false;
  return !!cableDeLaSalida(t, inicio.id, "siguiente") || (inicio.anuncios ?? []).some((k) => !!cableDeLaSalida(t, inicio.id, `anuncio:${k}`));
}

/**
 * LOS AVISOS DE UNA FICHA, para que a simple vista se vea lo que no va a funcionar. No bloquean
 * nada: él decide. `pais` = el país con el que se ven los montos.
 */
export function avisosDeLaFicha(t: Tablero, f: FichaDelTablero, pais: string): string[] {
  const avisos: string[] = [];
  const tieneCable = (salida: string) => !!cableDeLaSalida(t, f.id, salida);
  const pasos = pasosDeLaFicha(f);
  const pasada = (min: number | undefined) => !!min && min >= VENTANA_DE_META_MIN;
  switch (f.tipo) {
    case "inicio":
      if (!tieneCable("siguiente")) avisos.push("El Inicio no tiene cable: ningún cliente entra a esta ruta.");
      if (f.sin_venta) avisos.push("«Vender en este país» está apagado: sus clientes van a la venta automática.");
      if (f.en_revision) avisos.push("En revisión: no recibe clientes.");
      break;
    case "mensaje":
      if (pasos.length === 0) avisos.push("No tiene burbujas: no manda nada.");
      if (pasada(f.sin_respuesta_min)) avisos.push("«No respondió» pasa las 24 h: por WhatsApp ya no llegaría.");
      break;
    case "intro_ob":
      if ((f.variantes ?? []).every((v) => (v.steps ?? []).length === 0)) avisos.push("No tiene burbujas: no manda nada.");
      if (opcionesDe(pasos).botones.length + opcionesDe(pasos).cuadritos.length === 0)
        avisos.push("No tiene botones ni cuadritos para elegir el producto.");
      break;
    case "seguimientos":
      if ((f.seguimientos ?? []).length === 0) avisos.push("No tiene seguimientos.");
      if ((f.seguimientos ?? []).some((s) => pasada(s.minutos)))
        avisos.push("Un seguimiento pasa las 24 h desde el último mensaje: por WhatsApp no llegaría.");
      break;
    case "entregar":
      if (entregasDeLaFicha(f).length === 0) avisos.push("No tiene ninguna entrega elegida.");
      break;
    case "cobro":
      if (f.cobro?.modo === "abierto") {
        if (!(f.cobro.tramos_por_pais?.[pais]?.length) && f.cobro.minimo_por_pais?.[pais] === undefined)
          avisos.push(`Sin mínimo ni tramos para ${pais}: cualquier monto sale por «Pagó (fuera de tramos)».`);
      } else if (!f.cobro?.producto_id) avisos.push("No tiene producto elegido.");
      if (pasada(f.sin_pago_min)) avisos.push("«No pagó» pasa las 24 h: por WhatsApp ya no llegaría.");
      break;
    case "esperar":
      if (pasada(f.minutos)) avisos.push("Espera más de 24 h: si el cliente no escribe, lo siguiente no llega por WhatsApp.");
      break;
    case "reparto":
      if ((f.reparto ?? []).filter((o) => o.peso > 0).length < 2) avisos.push("Necesita al menos 2 rutas con peso.");
      break;
    case "workflow":
      if (!f.workflow_id) avisos.push("No tiene workflow elegido.");
      break;
    case "condicion":
      if (f.condicion?.tipo === "compro" && !f.condicion.producto_id) avisos.push("No tiene producto elegido.");
      if (f.condicion?.tipo === "pais" && !(f.condicion.paises ?? []).length) avisos.push("No tiene países elegidos.");
      break;
    case "correo":
      if (pasos.length === 0) avisos.push("No tiene burbujas: no le pide el correo.");
      if ((f.correo_texto ?? "").trim() && !/\{\{(MATERIAL|ENLACES)\}\}/.test(f.correo_texto ?? ""))
        avisos.push("El texto del correo no lleva {{ENLACES}} ni {{MATERIAL}}: no irían sus enlaces.");
      break;
  }
  // La IA solo habla de lo que ya se presentó. Se avisa en las que presentan de verdad: la intro de
  // order bump y el primer mensaje de un Inicio (la intro). Un «gracias» no necesita producto.
  const esLaIntro = f.tipo === "mensaje" && t.cables.some((c) => c.a === f.id && t.fichas.find((x) => x.id === c.de)?.tipo === "inicio");
  if ((f.tipo === "intro_ob" || esLaIntro) && !(f.presenta ?? []).length && pasos.length > 0 && !f.apagada)
    avisos.push("No dice qué producto presenta: la IA no sabrá contestar «qué contiene» hasta un cobro o una entrega.");
  // Una ficha que espera respuesta y no tiene NINGÚN cable de salida deja al cliente sin camino.
  if (FICHAS_CON_RESPUESTA.includes(f.tipo) && f.tipo !== "seguimientos") {
    const salidas = salidasDeLaFicha(f, pais);
    if (salidas.length > 0 && !salidas.some((s) => tieneCable(s.clave)))
      avisos.push("Ninguna de sus salidas tiene cable: aquí termina la ruta.");
  }
  return avisos;
}
