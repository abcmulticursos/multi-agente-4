/**
 * EL TABLERO EN EL ARCHIVO: se lee y se limpia aquí, para la ruta de guardado (ida y vuelta) y
 * para el bot. Solo números finitos, textos cortos y listas con tope: algo raro en el archivo no
 * puede tumbar ni el editor ni el bot. Ver `tipos.ts` y PLAN-TABLERO.md.
 */
import type {
  CableDelTablero,
  CobroDeLaFicha,
  CondicionDeLaFicha,
  FichaDelTablero,
  SalidaDeFicha,
  Tablero,
  TipoDeFicha,
  TramoDeCobro,
} from "./tipos";

const TIPOS: TipoDeFicha[] = ["inicio", "mensaje", "entregar", "cobro", "condicion", "esperar", "regalo", "humano"];

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
  const tramos_por_pais: Record<string, TramoDeCobro[]> = {};
  if (esObjeto(v.tramos_por_pais))
    for (const [k, lista] of Object.entries(v.tramos_por_pais).slice(0, 60)) {
      const p = pais(k);
      const tramos = leeTramos(lista);
      if (p && tramos.length > 0) tramos_por_pais[p] = tramos;
    }
  const producto_id = texto(v.producto_id, 120).trim();
  return {
    modo,
    ...(producto_id ? { producto_id } : {}),
    ...(Object.keys(minimo_por_pais).length ? { minimo_por_pais } : {}),
    ...(Object.keys(tramos_por_pais).length ? { tramos_por_pais } : {}),
  };
}

function leeCondicion(v: unknown): CondicionDeLaFicha | undefined {
  if (!esObjeto(v)) return undefined;
  const tipo = v.tipo === "pais" || v.tipo === "anuncio" ? v.tipo : "compro";
  const producto_id = texto(v.producto_id, 120).trim();
  const paises = Array.isArray(v.paises)
    ? [...new Set(v.paises.slice(0, 60).map((p) => pais(String(p))).filter((p): p is string => !!p))]
    : [];
  return { tipo, ...(producto_id ? { producto_id } : {}), ...(paises.length ? { paises } : {}) };
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
      if ((tipo === "mensaje" || tipo === "cobro") && Array.isArray(f.steps))
        ficha.steps = leerPasos(f.steps.slice(0, 60)) as FichaDelTablero["steps"];
      const sr = positivo(f.sin_respuesta_min);
      if (tipo === "mensaje" && sr) ficha.sin_respuesta_min = sr;
      const sp = positivo(f.sin_pago_min);
      if (tipo === "cobro" && sp) ficha.sin_pago_min = sp;
      const producto = texto(f.producto_id, 120).trim();
      if (tipo === "entregar" && producto) ficha.producto_id = producto;
      if (tipo === "cobro") ficha.cobro = leeCobro(f.cobro) ?? { modo: "producto" };
      if (tipo === "condicion") ficha.condicion = leeCondicion(f.condicion) ?? { tipo: "compro" };
      const min = positivo(f.minutos);
      if (tipo === "esperar" && min) ficha.minutos = min;
      return [ficha];
    });
  const ids = new Set(fichas.map((f) => f.id));
  const vistos = new Set<string>();
  const cables: CableDelTablero[] = (Array.isArray(crudo.cables) ? crudo.cables : [])
    .slice(0, 2000)
    .flatMap((c) => {
      if (!esObjeto(c)) return [];
      const de = texto(c.de, 80).trim();
      const a = texto(c.a, 80).trim();
      const salida = texto(c.salida, 140).trim();
      if (!ids.has(de) || !ids.has(a) || !salida) return [];
      // UNA SALIDA, UN CABLE: si llegan dos, gana el primero. Dos cables desde el mismo puntito
      // dejarían al bot sin saber cuál seguir.
      const llave = `${de}|${salida}`;
      if (vistos.has(llave)) return [];
      vistos.add(llave);
      return [{ id: texto(c.id, 120).trim() || `c-${llave}`, de, salida, a }];
    });
  return { encendido: crudo.encendido === true, fichas, cables };
}

/** Todos los tableros guardados, por tienda. */
export function leeTableros(
  v: unknown,
  leerPasos?: (pasos: unknown[]) => unknown[]
): Record<string, Tablero> {
  const fuera: Record<string, Tablero> = {};
  if (!esObjeto(v)) return fuera;
  for (const [tienda, t] of Object.entries(v).slice(0, 200)) {
    const k = texto(tienda, 120).trim();
    if (k) fuera[k] = leeTablero(t, leerPasos);
  }
  return fuera;
}

/**
 * LAS SALIDAS DE UNA FICHA: los puntitos de los que él tira cables. Las mismas para la pantalla y
 * para el bot, por eso viven aquí.
 */
export function salidasDeLaFicha(f: FichaDelTablero, paisVisto?: string): SalidaDeFicha[] {
  switch (f.tipo) {
    case "inicio":
    case "entregar":
    case "esperar":
      return [{ clave: "siguiente", etiqueta: "→" }];
    case "humano":
    case "regalo":
      return [];
    case "condicion":
      return [
        { clave: "si", etiqueta: "Sí" },
        { clave: "no", etiqueta: "No" },
      ];
    case "mensaje": {
      const salidas: SalidaDeFicha[] = [];
      let pregunta = false;
      for (const paso of f.steps ?? []) {
        if ((paso as { enabled?: boolean }).enabled === false) continue;
        for (const b of paso.buttons ?? []) {
          if (!b?.id) continue;
          pregunta = true;
          salidas.push({ clave: `btn:${b.id}`, etiqueta: `🔘 ${b.label || "Botón"}` });
        }
        for (const d of paso.decisions ?? []) {
          if (!d?.id || d.enabled === false) continue;
          pregunta = true;
          salidas.push({
            clave: `dec:${d.id}`,
            etiqueta: `💬 ${d.title || (d.keywords ?? []).slice(0, 2).join(", ") || "Otra respuesta"}`,
          });
        }
      }
      if (pregunta) salidas.push({ clave: "otra", etiqueta: "✍️ Otra cosa" });
      else salidas.push({ clave: "siguiente", etiqueta: "→" });
      if (f.sin_respuesta_min) salidas.push({ clave: "sin_respuesta", etiqueta: `⏰ No respondió en ${minutosLegibles(f.sin_respuesta_min)}` });
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
        salidas.push({ clave: "pagado", etiqueta: "✅ Pagó" });
        salidas.push({ clave: "menos", etiqueta: "↓ Pagó de menos" });
      }
      if (f.sin_pago_min) salidas.push({ clave: "sin_pago", etiqueta: `⏰ No pagó en ${minutosLegibles(f.sin_pago_min)}` });
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

/** ¿Este tablero está listo para atender? Encendido, con una ficha Inicio y su cable puesto. */
export function elTableroAtiende(t: Tablero | null | undefined): boolean {
  if (!t?.encendido) return false;
  const inicio = t.fichas.find((f) => f.tipo === "inicio");
  return !!inicio && !!cableDeLaSalida(t, inicio.id, "siguiente");
}
