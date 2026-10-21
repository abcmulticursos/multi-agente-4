/**
 * LA PIZARRA EN EL ARCHIVO: dónde dejó cada ficha y las cajas que dibujó, por tienda y canal.
 *
 * Lo pidió el dueño el 16/10/2026: «si yo muevo algo, en modo pizarra debería cambiar de
 * posición, le doy guardar y que se guarde y quede tal cual está». Va en el contenido para que
 * se vea igual en cualquier computadora. EL BOT NO LA LEE NUNCA: es solo de la pantalla.
 *
 * Vive suelta para que la ruta de guardado la use al leer Y al escribir —«la ruta de guardado se
 * come lo que nadie nombra»— y para que su prueba la pueda ejecutar sin levantar la ruta.
 *
 * Se limpia siempre: solo números finitos y textos cortos, con topes, para que algo raro en el
 * archivo no pueda tumbar la pantalla ni crecer sin freno.
 */
export interface CajaGuardada {
  id: string;
  x: number;
  y: number;
  ancho: number;
  alto: number;
  titulo: string;
}

export interface PizarraGuardada {
  vistas: Record<
    string,
    {
      posiciones: Record<string, { x: number; y: number }>;
      /** AUSENTE es distinto de []: ausente = «todavía no tocó ninguna» (la pantalla pone las
       *  de cada país); [] = «las borró todas». */
      cajas?: CajaGuardada[];
      /** LAS FICHAS SUELTAS QUE ÉL QUIERE VER EN LA PIZARRA (16/10/2026): «al cortar la
       *  conexión… el cajón no debería desaparecer, debería estar en ese lugar sin conexión».
       *  Las demás sueltas viven en el panel «Fichas guardadas». */
      visibles?: string[];
      /** LOS CAMINOS AGREGADOS CON «+ País» (16/10/2026), para que Ctrl+Z los quite y se
       *  guarden. Códigos de país de dos letras. */
      paises?: string[];
      /** LOS SALTOS QUE DIBUJÓ ÉL (17/10/2026): «país|de|a», ids de sub pestaña. */
      puentes?: string[];
      /** LOS FONDOS DE PAÍS QUE ÉL BORRÓ (17/10/2026): no vuelven solos. */
      sinFondo?: string[];
      /** LOS CABLES ENTRE COPIAS SUELTAS (17/10/2026): «que mantengan su conexión… al
       *  enchufarlas a un país que se conecte todo el flujo». «de|a», ids de sub pestaña. Solo
       *  pizarra: hasta que el grupo se conecta a un país, el bot no las manda. */
      enlaces?: string[];
      /** LAS FICHAS ARCHIVADAS (17/10/2026): «eliminar» un seguimiento del medio. Apagadas y sin
       *  país —el bot no las manda— y fuera de la vista. Ids de sub pestaña. */
      archivadas?: string[];
      /** LOS PAÍSES QUE ÉL QUITÓ DE ESTA PIZARRA (19/10/2026): «se pueden agregar países… pero no
       *  los puedo eliminar». Códigos de dos letras. «+ País» los devuelve. */
      quitados?: string[];
      /** DÓNDE VAN LOS RECUADROS DE SUS BOTONES (18/10/2026): «todas las copias deben quedar
       *  idénticas… y los cablecitos sueltos también». Por id de sub pestaña, la distancia de cada
       *  recuadro (en el orden de sus botones) a su ficha. Se apunta al copiar una ficha: la copia
       *  los pone donde la original los tenía. null = ese botón no tenía recuadro movido. */
      recuadros?: Record<string, Array<{ x: number; y: number } | null>>;
      /** LOS CABLES QUE ÉL CURVÓ A MANO (19/10/2026): «yo toco el cable, estiro y se mueve como
       *  yo quiera». Por id de cable, cuánto se corrió su punto medio. Solo pantalla. */
      curvas?: Record<string, { x: number; y: number }>;
      /** LO PUESTO «COMÚN» EN OTRO PAÍS Y AÚN SIN CONECTAR (20/10/2026): «país|ficha|grupo». «Nada
       *  debe conectar automáticamente»: el bot no lo lee; es la marca de que espera su cable. */
      comunes?: string[];
      /** LOS BOTONES DE UNA COPIA QUE ESPERAN EL CABLE DE ÉL (20/10/2026): «ficha|rama». El bot no
       *  lo lee: solo dice que la pizarra no dibuje ese cable hasta que él lo tire. */
      ramasPorConectar?: string[];
      /** LOS CABLES DE BOTONES QUE ÉL CORTÓ (20/10/2026): «ficha|rama». El bot no lo lee: cortar no
       *  cambia el botón; solo dice que la pizarra no dibuje ese cable hasta que él lo vuelva a tirar. */
      cortados?: string[];
      /** LAS FICHAS QUE ÉL TENÍA APAGADAS AL DESCONECTARLAS (20/10/2026): al reconectarlas siguen
       *  apagadas. Ids de sub pestaña. El bot no lo lee. */
      apagadas?: string[];
      /** LOS PAÍSES EN REVISIÓN (20/10/2026): no venden, pero se ven normales. El bot no lo lee. */
      revision?: string[];
      /** LAS QUE ÉL APAGÓ DESDE LA PIZARRA (20/10/2026): se quedan en su sitio. El bot no lo lee. */
      quedanApagadas?: string[];
      /** EL PLANO DE CABLES: los cortes (ver `CorteDeRuta`). El bot no lo lee. */
      cortesDeRuta?: string[];
    }
  >;
}

/**
 * UN CABLE DE RUTA QUE ÉL CORTÓ (20/10/2026): «si yo corto la línea principal inicial, ningún
 * poste se desconecta». En el bot, lo de detrás pasó a una ruta propia (`letra`) a la que no llega
 * nadie, o la de destino salió de ese país (`quitado`). En la pizarra se dibuja todo como estaba
 * (la `letra` se lee como la ruta `original`), menos ESE cable, y tenue. Se guarda
 * «país|desde|hacia|original|letra|quitado» («~» = principal o nada; desde «inicio»).
 */
export interface CorteDeRuta {
  pais: string;
  desde: string;
  hacia: string;
  original: string;
  letra: string;
  quitado: boolean;
}
export function leerCorte(x: string): CorteDeRuta | null {
  const p = String(x ?? "").split("|");
  if (p.length !== 6 || !/^[A-Z]{2}$/.test(p[0]) || !p[2]) return null;
  const nada = (v: string) => (v === "~" ? "" : v);
  return { pais: p[0], desde: p[1], hacia: p[2], original: nada(p[3]), letra: nada(p[4]), quitado: p[5] === "1" };
}
export function escribirCorte(c: CorteDeRuta): string {
  return [c.pais, c.desde || "inicio", c.hacia, c.original || "~", c.letra || "~", c.quitado ? "1" : "0"].join("|");
}

export function leePizarra(v: unknown): PizarraGuardada {
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null);
  const texto = (t: unknown, max: number) => String(t ?? "").slice(0, max);
  const vistas: PizarraGuardada["vistas"] = {};
  const crudo = (v as { vistas?: unknown } | null | undefined)?.vistas;
  if (crudo && typeof crudo === "object") {
    for (const [clave, vista] of Object.entries(crudo as Record<string, unknown>).slice(0, 200)) {
      const posiciones: Record<string, { x: number; y: number }> = {};
      const p = (vista as { posiciones?: unknown } | null)?.posiciones;
      if (p && typeof p === "object") {
        for (const [id, pos] of Object.entries(p as Record<string, unknown>).slice(0, 2000)) {
          const x = num((pos as { x?: unknown } | null)?.x);
          const y = num((pos as { y?: unknown } | null)?.y);
          if (x !== null && y !== null) posiciones[texto(id, 200)] = { x, y };
        }
      }
      const c = (vista as { cajas?: unknown } | null)?.cajas;
      const cajas = Array.isArray(c)
        ? c.slice(0, 200).flatMap((k) => {
            const x = num(k?.x), y = num(k?.y), ancho = num(k?.ancho), alto = num(k?.alto);
            if (x === null || y === null || ancho === null || alto === null) return [];
            return [{ id: texto(k?.id, 80), x, y, ancho, alto, titulo: texto(k?.titulo, 80) }];
          })
        : undefined;
      const vis = (vista as { visibles?: unknown } | null)?.visibles;
      const visibles = Array.isArray(vis)
        ? [...new Set(vis.slice(0, 500).map((x) => texto(x, 120)).filter(Boolean))]
        : undefined;
      const pa = (vista as { paises?: unknown } | null)?.paises;
      const paises = Array.isArray(pa)
        ? [...new Set(pa.slice(0, 60).map((x) => texto(x, 2).toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)))]
        : undefined;
      const pu = (vista as { puentes?: unknown } | null)?.puentes;
      const puentes = Array.isArray(pu)
        ? [...new Set(pu.slice(0, 500).map((x) => texto(x, 200)).filter((x) => /^[A-Z]{2}\|[^|]+\|[^|]+$/.test(x)))]
        : undefined;
      const sf = (vista as { sinFondo?: unknown } | null)?.sinFondo;
      const sinFondo = Array.isArray(sf)
        ? [...new Set(sf.slice(0, 200).map((x) => texto(x, 80)).filter((x) => x.startsWith("caja:carril:")))]
        : undefined;
      const en = (vista as { enlaces?: unknown } | null)?.enlaces;
      const enlaces = Array.isArray(en)
        ? [...new Set(en.slice(0, 500).map((x) => texto(x, 200)).filter((x) => /^[a-z]+:[^|]+\|[a-z]+:[^|]+$/.test(x)))]
        : undefined;
      const ar = (vista as { archivadas?: unknown } | null)?.archivadas;
      const archivadas = Array.isArray(ar)
        ? [...new Set(ar.slice(0, 500).map((x) => texto(x, 120)).filter((x) => /^[a-z]+:[^|]+$/.test(x)))]
        : undefined;
      const re = (vista as { recuadros?: unknown } | null)?.recuadros;
      const recuadros: Record<string, Array<{ x: number; y: number } | null>> = {};
      if (re && typeof re === "object" && !Array.isArray(re)) {
        for (const [id, lista] of Object.entries(re as Record<string, unknown>).slice(0, 500)) {
          const k = texto(id, 120);
          if (!/^[a-z]+:[^|]+$/.test(k) || !Array.isArray(lista)) continue;
          recuadros[k] = lista.slice(0, 20).map((d) => {
            const x = num((d as { x?: unknown } | null)?.x);
            const y = num((d as { y?: unknown } | null)?.y);
            return x !== null && y !== null ? { x, y } : null;
          });
        }
      }
      const qu = (vista as { quitados?: unknown } | null)?.quitados;
      const quitados = Array.isArray(qu)
        ? [...new Set(qu.slice(0, 60).map((x) => texto(x, 2).toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)))]
        : undefined;
      const cu = (vista as { curvas?: unknown } | null)?.curvas;
      const curvas: Record<string, { x: number; y: number }> = {};
      if (cu && typeof cu === "object" && !Array.isArray(cu)) {
        for (const [id, d] of Object.entries(cu as Record<string, unknown>).slice(0, 1000)) {
          const x = num((d as { x?: unknown } | null)?.x);
          const y = num((d as { y?: unknown } | null)?.y);
          if (x !== null && y !== null && Math.abs(x) < 100000 && Math.abs(y) < 100000) curvas[texto(id, 300)] = { x, y };
        }
      }
      const co = (vista as { comunes?: unknown } | null)?.comunes;
      const comunes = Array.isArray(co)
        ? [...new Set(co.slice(0, 500).map((x) => texto(x, 300)).filter((x) => /^[A-Z]{2}\|[a-z]+:[^|]+\|[^|]*$/.test(x)))]
        : [];
      const rpc = (vista as { ramasPorConectar?: unknown } | null)?.ramasPorConectar;
      const ramasPorConectar = Array.isArray(rpc)
        ? [...new Set(rpc.slice(0, 2000).map((x) => texto(x, 300)).filter((x) => /^[a-z]+:[^|]+\|[^|]+$/.test(x)))]
        : [];
      const cor = (vista as { cortados?: unknown } | null)?.cortados;
      const cortados = Array.isArray(cor)
        ? [...new Set(cor.slice(0, 2000).map((x) => texto(x, 300)).filter((x) => /^[a-z]+:[^|]+\|[^|]+$/.test(x)))]
        : [];
      const apa = (vista as { apagadas?: unknown } | null)?.apagadas;
      const apagadas = Array.isArray(apa)
        ? [...new Set(apa.slice(0, 500).map((x) => texto(x, 120)).filter((x) => /^[a-z]+:[^|]+$/.test(x)))]
        : [];
      const rev = (vista as { revision?: unknown } | null)?.revision;
      const revision = Array.isArray(rev)
        ? [...new Set(rev.slice(0, 60).map((x) => texto(x, 2).toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)))]
        : [];
      const qa = (vista as { quedanApagadas?: unknown } | null)?.quedanApagadas;
      const quedanApagadas = Array.isArray(qa)
        ? [...new Set(qa.slice(0, 500).map((x) => texto(x, 120)).filter((x) => /^[a-z]+:[^|]+$/.test(x)))]
        : [];
      const cdr = (vista as { cortesDeRuta?: unknown } | null)?.cortesDeRuta;
      const cortesDeRuta = Array.isArray(cdr)
        ? [...new Set(cdr.slice(0, 500).map((x) => texto(x, 300)).filter((x) => !!leerCorte(x)))]
        : [];
      vistas[texto(clave, 200)] = {
        ...(cortesDeRuta.length > 0 ? { cortesDeRuta } : {}),
        ...(quedanApagadas.length > 0 ? { quedanApagadas } : {}),
        ...(revision.length > 0 ? { revision } : {}),
        ...(apagadas.length > 0 ? { apagadas } : {}),
        ...(cortados.length > 0 ? { cortados } : {}),
        ...(ramasPorConectar.length > 0 ? { ramasPorConectar } : {}),
        ...(comunes.length > 0 ? { comunes } : {}),
        ...(Object.keys(curvas).length > 0 ? { curvas } : {}),
        ...(quitados && quitados.length > 0 ? { quitados } : {}),
        ...(Object.keys(recuadros).length > 0 ? { recuadros } : {}),
        ...(archivadas ? { archivadas } : {}),
        posiciones,
        ...(cajas ? { cajas } : {}),
        ...(visibles ? { visibles } : {}),
        ...(paises ? { paises } : {}),
        ...(puentes ? { puentes } : {}),
        ...(sinFondo ? { sinFondo } : {}),
        ...(enlaces ? { enlaces } : {}),
      };
    }
  }
  return { vistas };
}
