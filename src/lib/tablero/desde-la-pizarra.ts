/**
 * DE LA PIZARRA AL TABLERO (25/10/2026). Alberto: «si yo armase un workflow en modo Pizarra… que
 * aparezca en modo tablero», «exportar ese workflow y que llegue a modo tablero… armado».
 *
 * Lee una tienda exportada desde la pizarra (`exportarTienda`: sus intros, su oferta de 2 opciones,
 * sus upsells, sus seguimientos y sus productos) y arma su tablero: un Inicio con su manta por
 * cada país que tiene intros, y detrás la misma tubería que la pizarra dibujaba.
 *
 * Los botones y cuadritos de la pizarra hacen cosas por su ACCIÓN («Elige el BÁSICO», «Oferta de 2
 * opciones»…); en el tablero lo que manda es el cable. Así que cada acción se vuelve un cable a la
 * ficha que hace eso, y el mensaje propio de un botón («Solo su mensaje») se vuelve una ficha
 * Mensaje. Nada del contenido se reescribe: las burbujas pasan tal cual.
 *
 * No toca nada: devuelve un tablero nuevo. Quien lo llama decide dónde ponerlo.
 */
import type { CableDelTablero, FichaDelTablero, SeguimientoDeLaFicha, Tablero, VarianteDeFicha } from "./tipos";

type Paso = {
  type?: string;
  buttons?: Array<{ id?: string; label?: string; action?: string; steps?: Paso[] }>;
  decisions?: Array<{ id?: string; title?: string; keywords?: string[]; action?: string; steps?: Paso[]; enabled?: boolean }>;
  [k: string]: unknown;
};

type Grupo = {
  name?: string;
  enabled?: boolean;
  weight?: number;
  steps?: Paso[];
  paises?: string[];
  semimodalidad?: string;
  adKeys?: string[];
  adRoutingEnabled?: boolean;
  ad_keys?: string[];
  ad_routing_enabled?: boolean;
};

/** Lo que trae un JSON de `exportarTienda` (lo que aquí se usa). */
export interface TiendaExportada {
  tienda?: { nombre?: string; semimodalidad?: string; alineacion?: Record<string, string>; upsell_apagado?: string };
  filaDeUpsell?: { enabled?: boolean; puestos?: Array<{ producto_id?: string; enabled?: boolean; minutos?: number }> };
  /** Minutos tras la entrega antes del upsell 1 (el «retraso» del upsell de la pizarra). */
  retrasoDelUpsell?: number;
  /** Segundos de silencio antes del regalo («Se ofrece tras X min» de la sección Regalo). */
  silencioDelRegalo?: number;
  fichas?: Array<{ canal: string; piezaId: string; obj: Grupo }>;
  /** Minutos de cada seguimiento (índice del seguimiento → minutos). Si falta, los de siempre. */
  tiemposDeSeguimiento?: Record<string, number>;
}

/** Los minutos de siempre si el archivo no los trae: 2 h, 10 h y 23 h. */
const MINUTOS_DE_SIEMPRE = [120, 600, 1380];
/** El seguimiento arranca cuando el cliente se queda callado este rato tras la intro. */
const CALLADO_TRAS_LA_INTRO = 15;

const COL = 330;
const FIL = 330;
const ALTO_DE_CARRIL = 1700;

const encendido = (g: Grupo) => g.enabled !== false && (g.steps ?? []).length > 0;
/** Las burbujas encendidas (las apagadas no salen, ni en la pizarra ni aquí). */
const activos = (pasos: Paso[] | undefined): Paso[] => (pasos ?? []).filter((p) => (p as { enabled?: boolean }).enabled !== false);
/** ¿Pregunta algo? Botones o cuadritos ENCENDIDOS en sus burbujas encendidas. */
const tieneOpciones = (pasos: Paso[] | undefined): boolean =>
  activos(pasos).some((p) => (p.buttons ?? []).length > 0 || (p.decisions ?? []).some((d) => d.enabled !== false));

/** Las de ese país; si ninguna lo nombra, las generales (sin bandera), como hace el bot. */
function delPais<T extends Grupo>(grupos: T[], pais: string): T[] {
  const suyas = grupos.filter((g) => (g.paises ?? []).includes(pais));
  if (suyas.length) return suyas;
  return grupos.filter((g) => (g.paises ?? []).length === 0);
}

export function tableroDesdeLaPizarra(
  datos: TiendaExportada,
  canal: string,
  productosQueExisten: Set<string>,
  /** Las burbujas de pago del canal (las mismas que la pizarra manda al cobrar). */
  pasosDelCobro: unknown[] = [],
  /** Los nombres de los productos, para titular cobros y entregas. */
  nombres: Record<string, string> = {}
): { tablero: Tablero; avisos: string[] } {
  const nombreDe = (pid: string) => nombres[pid]?.trim() || pid;
  const avisos: string[] = [];
  const fichas: FichaDelTablero[] = [];
  const cables: CableDelTablero[] = [];
  let n = 0;
  const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(++n).toString(36)}`;
  const cable = (de: string, salida: string, a: string) => {
    // Una salida, un cable (como al dibujarlo a mano).
    if (cables.some((c) => c.de === de && c.salida === salida)) return;
    cables.push({ id: uid("c"), de, salida, a });
  };

  const tienda = datos.tienda ?? {};
  const al = tienda.alineacion ?? {};
  const existe = (id?: string) => !!id && productosQueExisten.has(id);
  const basico = existe(al.basico) ? al.basico : undefined;
  const full = existe(al.full) ? al.full : undefined;
  const semi = tienda.semimodalidad === "dos_juntas" ? "dou" : tienda.semimodalidad === "segunda_oculta" ? "ob" : "lineal";
  if (!basico) avisos.push("La tienda no tiene producto básico elegido: los cobros quedan sin producto.");
  if (semi !== "lineal" && !full) avisos.push("La tienda vende 2 opciones pero no tiene el producto full: el cobro del full queda sin producto.");

  // LOS UPSELLS EN FILA: el de la tienda primero y después los de su fila.
  // Cada uno con su espera tras la entrega anterior: el 1 con el retraso del upsell, los de la fila
  // con sus minutos (5 si no tienen).
  const conEspera = [
    ...(existe(al.upsell) ? [{ id: al.upsell!, minutos: datos.retrasoDelUpsell ?? 5 }] : []),
    ...((datos.filaDeUpsell?.enabled === false ? [] : datos.filaDeUpsell?.puestos ?? [])
      .filter((p) => p.enabled !== false && existe(p.producto_id))
      .map((p) => ({ id: p.producto_id!, minutos: p.minutos ?? 5 }))),
  ].filter((u, i, l) => l.findIndex((x) => x.id === u.id) === i);
  const upsells = conEspera.map((u) => u.id);

  const delCanal = (datos.fichas ?? []).filter((f) => f.canal === canal);
  const deTipo = (t: string) => delCanal.filter((f) => f.piezaId.startsWith(`${t}:`));
  // Solo las de su semimodalidad (o generales): en la pizarra las de otra no se ven en esta tienda.
  const deSuSemi = (g: Grupo) => !g.semimodalidad || g.semimodalidad === semi;
  const intros = deTipo("intro").map((f) => f.obj).filter((g) => encendido(g) && deSuSemi(g));
  const obs = deTipo("ob").map((f) => f.obj).filter((g) => encendido(g) && deSuSemi(g));
  const ups = deTipo("up").map((f) => f.obj).filter((g) => encendido(g) && deSuSemi(g));
  // Seguimientos: «seg:<cuál>:<versión>».
  const segs = new Map<number, Grupo[]>();
  for (const f of deTipo("seg")) {
    if (!encendido(f.obj) || !deSuSemi(f.obj)) continue;
    const cual = Number(f.piezaId.split(":")[1]);
    segs.set(cual, [...(segs.get(cual) ?? []), f.obj]);
  }
  if (intros.length === 0) {
    avisos.push(`Esta tienda no tiene intros encendidas en la pizarra (${canal}, su semimodalidad): no hay de dónde arrancar el tablero.`);
    return { tablero: { encendido: false, fichas: [], cables: [], cajas: [] }, avisos };
  }

  // LOS PAÍSES: uno por cada bandera de sus intros; las intros sin bandera van a «Otros países».
  const paises = [...new Set(intros.flatMap((g) => g.paises ?? []))];
  const carriles: string[] = [...paises, ...(intros.some((g) => (g.paises ?? []).length === 0) || paises.length === 0 ? [""] : [])];

  carriles.forEach((pais, k) => {
    const Y = k * ALTO_DE_CARRIL;
    const poner = (f: Omit<FichaDelTablero, "x" | "y">, col: number, fila: number): string => {
      fichas.push({ ...f, x: 60 + col * COL, y: Y + fila * FIL } as FichaDelTablero);
      return f.id;
    };
    const misIntros = pais ? delPais(intros, pais) : intros.filter((g) => (g.paises ?? []).length === 0);
    const misObs = delPais(obs, pais);
    const misUps = delPais(ups, pais);
    const inicio = poner({ id: uid("inicio"), tipo: "inicio", ...(pais ? { pais } : {}) }, 0, 0);

    // LOS COBROS Y LAS ENTREGAS (uno por producto), como los arma la pizarra en su postventa.
    const cobros = new Map<string, string>();
    const entregas = new Map<string, string>();
    /** `callado`: la ficha de antes ya preguntó el método; el cobro no lo vuelve a preguntar. */
    const cobroDe = (pid: string | undefined, col: number, fila: number, acepta: string[] = [], callado = false): string | undefined => {
      if (!pid) return undefined;
      const clave = `${pid}${callado ? "|callado" : ""}`;
      const ya = cobros.get(clave);
      if (ya) return ya;
      const id = poner(
        {
          id: uid("cobro"),
          tipo: "cobro",
          titulo: `Cobro · ${nombreDe(pid)}${callado ? " (caja abierta, sin preguntar)" : ""}`,
          sin_pago_min: 60,
          cobro: { modo: "producto", producto_id: pid, acepta: acepta.filter((a) => a !== pid), precio: "etapa", metodos: true, ...(callado ? { sin_preguntar: true } : {}) },
          steps: copiarPasos(pasosDelCobro as Paso[]) as FichaDelTablero["steps"],
        },
        col,
        fila + (callado ? 1 : 0)
      );
      cobros.set(clave, id);
      return id;
    };
    const entregaDe = (pid: string, col: number, fila: number): string => {
      const ya = entregas.get(pid);
      if (ya) return ya;
      const id = poner({ id: uid("entrega"), tipo: "entregar", titulo: `Entrega · ${nombreDe(pid)}`, producto_id: pid }, col, fila);
      entregas.set(pid, id);
      return id;
    };
    const opciones = [basico, ...(semi !== "lineal" ? [full] : [])].filter(Boolean) as string[];
    const cobroBasico = () => cobroDe(basico, 3, 0, opciones);
    const cobroFull = () => cobroDe(full ?? basico, 3, 2, opciones);

    // EL ORDER BUMP (oferta de 2 opciones), una sola ficha con sus versiones.
    let fichaOb: string | undefined;
    const obDelPais = (): string | undefined => {
      if (fichaOb) return fichaOb;
      if (misObs.length === 0) return undefined;
      const variantes: VarianteDeFicha[] = misObs.map((g, i) => ({
        id: uid("v"),
        nombre: g.name?.trim() || `Versión ${String.fromCharCode(65 + i)}`,
        peso: g.weight ?? 1,
        steps: copiarPasos(g.steps) as VarianteDeFicha["steps"],
      }));
      fichaOb = poner({ id: uid("ob"), tipo: "intro_ob", titulo: "Oferta de 2 opciones", presenta: opciones, variantes }, 2, 0);
      return fichaOb;
    };

    /** Las salidas de una ficha según la ACCIÓN de cada botón o cuadrito. */
    const cablearOpciones = (fichaId: string, pasos: Paso[] | undefined, col: number, fila: number) => {
      let extra = 0;
      for (const p of activos(pasos)) {
        // SUS BURBUJAS PROPIAS: el bot del tablero manda las de un CUADRITO antes de seguir su cable
        // (`actuarCuadrito`), pero no las de un BOTÓN. Así que las de un botón se pasan a una ficha
        // Mensaje en medio (y se quitan del botón), y las de un cuadrito se quedan en él.
        const todas = [
          ...(p.buttons ?? []).map((b) => ({ salida: `btn:${b.id}`, accion: b.action, steps: b.steps, nombre: b.label, esBoton: true, quitar: () => delete b.steps })),
          ...(p.decisions ?? [])
            .filter((d) => d.enabled !== false)
            .map((d) => ({ salida: `dec:${d.id}`, accion: d.action, steps: d.steps, nombre: d.title, esBoton: false, quitar: () => {} })),
        ];
        for (const o of todas) {
          if (!o.salida.includes(":") || o.salida.endsWith(":undefined")) continue;
          if (cables.some((c) => c.de === fichaId && c.salida === o.salida)) continue;
          let destino: string | undefined;
          switch (o.accion) {
            case "choose_basico":
              destino = cobroBasico();
              break;
            case "choose_combo":
              destino = cobroFull();
              break;
            case "show_order_bump":
              destino = obDelPais() ?? cobroBasico();
              break;
            case "show_payment":
            case "send_payment_method":
              destino = cobroBasico();
              break;
            case "human":
              destino = poner({ id: uid("humano"), tipo: "humano", titulo: "Pasa a una persona" }, col + 1, fila + 1 + extra++);
              break;
            default:
              // «Solo su mensaje»: el de un botón, en una ficha Mensaje; el de un cuadrito ya lo manda él.
              if (o.esBoton && (o.steps ?? []).length > 0) {
                destino = poner(
                  { id: uid("msg"), tipo: "mensaje", titulo: o.nombre?.trim() || "Mensaje del botón", steps: copiarPasos(o.steps) as FichaDelTablero["steps"] },
                  col + 1,
                  fila + 1 + extra++
                );
                o.quitar();
              }
          }
          // UN BOTÓN CON MENSAJE Y ACCIÓN («💬 + Elige el FULL»): primero su mensaje y luego su acción.
          if (destino && o.esBoton && o.accion && o.accion !== "send_steps" && (o.steps ?? []).length > 0) {
            const antes = poner(
              { id: uid("msg"), tipo: "mensaje", titulo: o.nombre?.trim() || "Mensaje del botón", steps: copiarPasos(o.steps) as FichaDelTablero["steps"] },
              col + 1,
              fila + 1 + extra++
            );
            cable(antes, "siguiente", destino);
            destino = antes;
            o.quitar();
          }
          if (destino) cable(fichaId, o.salida, destino);
        }
      }
    };

    // LAS INTROS: una sola va directa; varias se sortean por su peso, como en la pizarra.
    const introIds: string[] = [];
    /** La primera ficha tras el Inicio: el sorteo de intros, o la única intro. */
    let entrada: string | undefined;
    if (misIntros.length > 1) {
      const rep = poner(
        { id: uid("rep"), tipo: "reparto", titulo: "Intros por peso", reparto: misIntros.map((g, i) => ({ id: `r${i + 1}`, nombre: g.name?.trim() || `Intro ${i + 1}`, peso: g.weight ?? 1 })) },
        1,
        0
      );
      entrada = rep;
      misIntros.forEach((g, i) => {
        const id = poner({ id: uid("intro"), tipo: "mensaje", titulo: g.name?.trim() || `Intro ${i + 1}`, presenta: semi === "dou" ? opciones : basico ? [basico] : [], steps: copiarPasos(g.steps) as FichaDelTablero["steps"] }, 2, i * 2 - 0.5);
        cable(rep, `rep:r${i + 1}`, id);
        introIds.push(id);
      });
    } else if (misIntros.length === 1) {
      const g = misIntros[0];
      const id = poner({ id: uid("intro"), tipo: "mensaje", titulo: g.name?.trim() || "Intro", presenta: semi === "dou" ? opciones : basico ? [basico] : [], steps: copiarPasos(g.steps) as FichaDelTablero["steps"] }, 1, 0);
      entrada = id;
      introIds.push(id);
    }
    // LAS INTROS CON ETIQUETA DE ANUNCIO, como la venta de siempre (`chooseIntroSequence`): quien
    // viene de uno de sus anuncios recibe ESA intro; los demás, el sorteo de siempre entre todas.
    // Una «Condición: ¿vino de este anuncio?» por cada una, antes del sorteo.
    {
      let siguiente = entrada;
      const etiquetadas = misIntros
        .map((g, i) => ({ g, id: introIds[i] }))
        .filter(({ g, id }) => id && g.adRoutingEnabled !== false && (g.adKeys ?? []).length > 0)
        .reverse();
      etiquetadas.forEach(({ g, id }, j) => {
        const cond = poner(
          { id: uid("cond"), tipo: "condicion", titulo: `¿Vino del anuncio de «${g.name?.trim() || "su intro"}»?`, condicion: { tipo: "anuncio", anuncios: [...(g.adKeys ?? [])] } },
          // Debajo del Inicio, una sobre otra (no invaden el país de arriba).
          0,
          1.2 + j
        );
        cable(cond, "si", id);
        if (siguiente) cable(cond, "no", siguiente);
        siguiente = cond;
      });
      if (siguiente) cable(inicio, "siguiente", siguiente);
    }
    misIntros.forEach((_g, i) => {
      const id = introIds[i];
      if (!id) return;
      const f = fichas.find((x) => x.id === id)!;
      const pasos = (f.steps ?? []) as Paso[];
      cablearOpciones(id, pasos, 2, 1);
      // Sin botones ni cuadritos ENCENDIDOS, la intro sigue sola: a la oferta (order bump) o al cobro.
      if (!tieneOpciones(pasos)) {
        // Si la intro ya pregunta el método (sus cuadritos de método, aunque estén apagados: en la
        // pizarra el bot los reconoce solo), el cobro se abre sin volver a preguntarlo.
        const yaPregunta = activos(pasos).some((p) => (p.decisions ?? []).some((d) => d.action === "send_payment_method"));
        const siguiente = semi === "ob" ? obDelPais() ?? cobroDe(basico, 3, 0, opciones, yaPregunta) : cobroDe(basico, 3, 0, opciones, yaPregunta);
        if (siguiente) cable(id, "siguiente", siguiente);
      }
      f.sin_respuesta_min = CALLADO_TRAS_LA_INTRO;
    });
    // La oferta: sus versiones (ya copiadas, con sus códigos) eligen cobro con sus botones.
    const cablearOferta = () => {
      const f = fichaOb ? fichas.find((x) => x.id === fichaOb) : undefined;
      for (const v of f?.variantes ?? []) cablearOpciones(f!.id, (v.steps ?? []) as Paso[], 2, 2);
    };
    cablearOferta();

    // LOS SEGUIMIENTOS, en una caja: si se queda callado tras la intro o no paga.
    const seguimientos: SeguimientoDeLaFicha[] = [...segs.entries()]
      .sort(([a], [b]) => a - b)
      .flatMap(([cual, vs]) => {
        const deEste = delPais(vs, pais);
        if (deEste.length === 0) return [];
        // Los mismos minutos: la caja «Seguimientos» los cuenta desde el ÚLTIMO mensaje del cliente,
        // no desde que llega a ella, así que los 15 min de «no respondió» no se suman.
        const minutos = Math.max(1, datos.tiemposDeSeguimiento?.[String(cual)] ?? MINUTOS_DE_SIEMPRE[cual] ?? 1380);
        return [
          {
            id: uid("s"),
            minutos,
            variantes: deEste.map((g, i) => ({
              id: uid("v"),
              nombre: g.name?.trim() || `Versión ${String.fromCharCode(65 + i)}`,
              peso: g.weight ?? 1,
              steps: copiarPasos(g.steps) as VarianteDeFicha["steps"],
              ...((g.ad_keys ?? []).length ? { anuncios: g.ad_keys, dirigir: g.ad_routing_enabled !== false } : {}),
            })),
          },
        ];
      });
    if (seguimientos.length > 0) {
      const s = poner({ id: uid("seg"), tipo: "seguimientos", titulo: "Seguimientos", presenta: opciones, seguimientos }, 2, 3);
      // «NO RESPONDIÓ» → LA CAJA ABIERTA EN SILENCIO → SEGUIMIENTOS (25/10/2026). Con la caja (el cobro)
      // abierta, un «yape» o un comprobante en medio de los seguimientos se atiende como siempre; sin
      // ella no había con qué. No le llega nada: abre el cobro sin preguntar y a 1 min pasa a la caja.
      const caja = cobroDe(basico, 3, 0, opciones, true);
      if (caja) {
        const f = fichas.find((x) => x.id === caja)!;
        f.sin_pago_min = 1;
      }
      const sinRespuesta = caja ?? s;
      for (const i of introIds) cable(i, "sin_respuesta", sinRespuesta);
      if (fichaOb) {
        const ob = fichas.find((x) => x.id === fichaOb)!;
        ob.sin_respuesta_min = CALLADO_TRAS_LA_INTRO;
        cable(fichaOb, "sin_respuesta", sinRespuesta);
      }
      // Los botones de los seguimientos (p. ej. «Quiero pagar») también llevan a su sitio.
      for (const seg of seguimientos) for (const v of seg.variantes) cablearOpciones(s, v.steps as Paso[], 3, 4);
      // Y TODOS los cobros de la venta (también los que acaban de nacer de esos botones): si no paga.
      for (const c of cobros.values()) cable(c, "sin_pago", s);
    } else {
      for (const i of introIds) delete fichas.find((x) => x.id === i)!.sin_respuesta_min;
    }

    // Si la oferta nació recién de un botón de los seguimientos, también se cablea.
    cablearOferta();

    // LO QUE SIGUE AL PAGO: la entrega de lo que pagó, los upsells en fila y el regalo.
    let pendientes: Array<[string, string]> = [];
    for (const [clave, c] of cobros) {
      const pid = clave.split("|")[0];
      const e = entregaDe(pid, 4, pid === basico ? 0 : 2);
      cable(c, "pagado", e);
      pendientes.push([e, "siguiente"]);
      // Si paga el precio del otro producto, se le entrega ese.
      for (const otro of opciones) if (otro !== pid) cable(c, `prod:${otro}`, entregaDe(otro, 4, otro === basico ? 0 : 2));
    }
    pendientes = pendientes.filter(([e], i, l) => l.findIndex(([x]) => x === e) === i);
    // EL SILENCIO ANTE UN UPSELL LLEVA AL REGALO, como en la venta de siempre (`upsell_timeout`): sin
    // contestar, o con el «sí» y sin pagar, tras el silencio de la sección Regalo sale el regalo, y la
    // fila no ofrece más. El cobro sigue abierto: si paga después, se le entrega igual.
    const minutosDelRegalo = Math.max(1, Math.round((datos.silencioDelRegalo ?? 300) / 60));
    const alRegaloPorSilencio: Array<[string, string]> = [];
    upsells.forEach((pid, i) => {
      const col = 5 + i * 2;
      const g = misUps[i] ?? misUps[0];
      let pasos = copiarPasos(g?.steps);
      if (!g) avisos.push(`${pais || "Otros países"}: el upsell ${i + 1} no tiene presentación en la pizarra; quedó su ficha vacía para escribirla.`);
      // El tablero necesita saber el sí y el no: si la presentación no los trae, se le ponen dos botones.
      const conOpciones = tieneOpciones(pasos);
      if (!conOpciones) {
        const vivos = activos(pasos);
        const ultimo = vivos[vivos.length - 1];
        const botones = [
          { id: uid("b"), label: "Sí, lo quiero", action: "choose_upsell" },
          { id: uid("b"), label: "No, gracias", action: "decline_upsell" },
        ];
        if (ultimo && (ultimo.type ?? "text") === "text") ultimo.buttons = botones;
        else pasos = [...pasos, { type: "text", body_variants: ["¿Lo agregas? 😊"], buttons: botones }];
      } else {
        // En la pizarra el «no» del upsell lo detecta el bot solo; en el tablero necesita su salida.
        const hayNo = activos(pasos).some((p) => [...(p.buttons ?? []), ...(p.decisions ?? []).filter((d) => d.enabled !== false)].some((o) => o.action === "decline_upsell"));
        if (!hayNo) {
          const conOpciones = [...activos(pasos)].reverse().find((p) => tieneOpciones([p]))!;
          if ((conOpciones.decisions ?? []).length)
            conOpciones.decisions = [
              ...(conOpciones.decisions ?? []),
              { id: uid("d"), title: "NO", keywords: ["no", "no gracias", "ahora no", "paso", "luego", "despues", "después", "no quiero"], action: "decline_upsell" },
            ];
          else if ((conOpciones.buttons ?? []).length < 3) conOpciones.buttons = [...(conOpciones.buttons ?? []), { id: uid("b"), label: "No, gracias", action: "decline_upsell" }];
          avisos.push(`${pais || "Otros países"}: al upsell ${i + 1} le puse un «No» (en la pizarra lo detectaba el bot solo), que lleva al regalo.`);
        }
      }
      const fu = poner(
        { id: uid("up"), tipo: "mensaje", titulo: `Upsell ${i + 1} · ${nombreDe(pid)}`, presenta: [pid], steps: pasos as FichaDelTablero["steps"], sin_respuesta_min: minutosDelRegalo },
        col,
        0
      );
      alRegaloPorSilencio.push([fu, "sin_respuesta"]);
      // LA ESPERA DE SIEMPRE antes de ofrecerlo (en la pizarra, «minutos tras la entrega»). Solo
      // tras la entrega: quien dijo «no» al anterior no espera.
      const minutos = Math.max(1, Math.round(conEspera[i]?.minutos ?? 5));
      const espera = poner({ id: uid("espera"), tipo: "esperar", titulo: `Espera ${minutos} min`, minutos }, col - 1, 1.6);
      cable(espera, "siguiente", fu);
      for (const [de, salida] of pendientes) cable(de, salida, salida === "siguiente" && fichas.find((x) => x.id === de)?.tipo === "entregar" ? espera : fu);
      const cu = poner(
        { id: uid("cobro"), tipo: "cobro", titulo: `Cobro · ${nombreDe(pid)}`, sin_pago_min: minutosDelRegalo, cobro: { modo: "producto", producto_id: pid, acepta: [], precio: "etapa", metodos: true }, steps: copiarPasos(pasosDelCobro as Paso[]) as FichaDelTablero["steps"] },
        col,
        1
      );
      const eu = poner({ id: uid("entrega"), tipo: "entregar", titulo: `Entrega · ${nombreDe(pid)}`, producto_id: pid }, col + 1, 1);
      cable(cu, "pagado", eu);
      alRegaloPorSilencio.push([cu, "sin_pago"]);
      const siguientes: Array<[string, string]> = [[eu, "siguiente"]];
      for (const p of activos(pasos))
        for (const o of [
          ...(p.buttons ?? []).map((b) => ({ salida: `btn:${b.id}`, accion: b.action, b })),
          ...(p.decisions ?? []).filter((d) => d.enabled !== false).map((d) => ({ salida: `dec:${d.id}`, accion: d.action, b: null })),
        ]) {
          // Un BOTÓN con mensaje propio: su mensaje en una ficha antes de seguir (el tablero no manda
          // las burbujas de un botón; las de un cuadrito sí, solas).
          const conMensaje = (destino: string): string => {
            if (!o.b || !(o.b.steps ?? []).length) return destino;
            const m = poner({ id: uid("msg"), tipo: "mensaje", titulo: o.b.label?.trim() || "Mensaje del botón", steps: copiarPasos(o.b.steps) as FichaDelTablero["steps"] }, col, 2.6);
            delete o.b.steps;
            cable(m, "siguiente", destino);
            return m;
          };
          if (o.accion === "choose_upsell" || o.accion === "show_payment") cable(fu, o.salida, conMensaje(cu));
          else if (o.accion === "decline_upsell") {
            if (o.b && (o.b.steps ?? []).length) {
              // Su despedida y luego lo que sigue (el siguiente upsell o el regalo).
              const m = poner({ id: uid("msg"), tipo: "mensaje", titulo: o.b.label?.trim() || "Mensaje del botón", steps: copiarPasos(o.b.steps) as FichaDelTablero["steps"] }, col, 2.6);
              delete o.b.steps;
              cable(fu, o.salida, m);
              siguientes.push([m, "siguiente"]);
            } else siguientes.push([fu, o.salida]);
          }
        }
      pendientes = siguientes;
    });
    const regalo = poner({ id: uid("regalo"), tipo: "regalo", titulo: "Regalo" }, 5 + upsells.length * 2, 0);
    for (const [de, salida] of [...pendientes, ...alRegaloPorSilencio]) cable(de, salida, regalo);
  });

  const tablero: Tablero = { encendido: false, fichas, cables, cajas: [] };
  return { tablero, avisos };
}

/**
 * Las burbujas tal cual, con códigos NUEVOS en sus botones y cuadritos. Siempre nuevos: las copias
 * hechas en la pizarra conservan los códigos de su original, y en el tablero cada botón es una
 * salida con su propio cable (dos con el mismo código se pisaban).
 */
let contador = 0;
function copiarPasos(pasos: Paso[] | undefined): Paso[] {
  const copia = JSON.parse(JSON.stringify(pasos ?? [])) as Paso[];
  const nuevo = (p: string) => `${p}-${Date.now().toString(36)}-${(++contador).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  for (const p of copia) {
    for (const b of p.buttons ?? []) b.id = nuevo("b");
    for (const d of p.decisions ?? []) d.id = nuevo("d");
  }
  return copia;
}
