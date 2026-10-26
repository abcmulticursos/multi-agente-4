/**
 * COPIAR FICHAS Y PONER MANTAS (25/10/2026). Vivían dentro del lienzo; ahora también las usa la
 * ventana «Exportar / importar» del editor, que no carga el lienzo. Solo datos: nada de pantalla.
 */
import type { CableDelTablero, Tablero } from "./tipos";

type Punto = { x: number; y: number };
type FichaCopiable = { id: string; tipo: string; x: number; y: number; guardada?: boolean; steps?: unknown[]; variantes?: Array<{ id: string; steps?: unknown[] }>; seguimientos?: Array<{ id: string; variantes: Array<{ id: string; steps?: unknown[] }> }> };

/** Copia de fichas con códigos NUEVOS (fichas, botones y cuadritos), y sus cables de dentro. */
export function copiarFichas<F extends FichaCopiable>(fichas: F[], cables: CableDelTablero[], desplazar: Punto): { fichas: F[]; cables: CableDelTablero[] } {
  const nuevo = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const idDe = new Map<string, string>();
  // LAS SALIDAS SE RENOMBRAN POR FICHA (26/10/2026). Antes: un código nuevo por cada aparición, así
  // que unos Seguimientos con VECINO/PICHINCHA/GUAYAQUIL en sus 2 seguimientos (los MISMOS 3 cuadritos)
  // salían con 6 círculos. Ahora, dentro de una ficha, el mismo código viejo → el mismo nuevo. Y la
  // clave lleva la ficha: dos fichas con los mismos cuadritos (su Intro y sus Seguimientos) no se
  // pisan los cables al copiarlas juntas.
  const salidaDe = new Map<string, string>();
  const renombrarPasos = (fichaVieja: string, pasos: unknown[] | undefined) =>
    (pasos ?? []).map((s) => {
      const p = JSON.parse(JSON.stringify(s)) as { buttons?: Array<{ id: string }>; decisions?: Array<{ id: string }> };
      const renombrar = (tipo: "btn" | "dec", prefijo: string, viejo: string) => {
        const clave = `${fichaVieja}|${tipo}:${viejo}`;
        if (!salidaDe.has(clave)) salidaDe.set(clave, `${tipo}:${nuevo(prefijo)}`);
        return salidaDe.get(clave)!.slice(4);
      };
      for (const b of p.buttons ?? []) b.id = renombrar("btn", "b", b.id);
      for (const d of p.decisions ?? []) d.id = renombrar("dec", "d", d.id);
      return p;
    });
  // Un Inicio no se copia: hay uno por país, y dos del mismo país no sabrían a quién recibir.
  const copias = fichas
    .filter((f) => f.tipo !== "inicio")
    .map((f) => {
      const id = nuevo("f");
      idDe.set(f.id, id);
      const c = { ...JSON.parse(JSON.stringify(f)), id, x: f.x + desplazar.x, y: f.y + desplazar.y } as F;
      if (c.steps) c.steps = renombrarPasos(f.id, c.steps);
      if (c.variantes) c.variantes = c.variantes.map((v) => ({ ...v, id: nuevo("v"), steps: renombrarPasos(f.id, v.steps) }));
      if (c.seguimientos)
        c.seguimientos = c.seguimientos.map((s) => ({
          ...s,
          id: nuevo("s"),
          variantes: s.variantes.map((v) => ({ ...v, id: nuevo("v"), steps: renombrarPasos(f.id, v.steps) })),
        }));
      return c;
    });
  // Los cables de dentro: la salida de un botón se renombra con su botón, y la de un reparto u
  // otra salida fija queda igual.
  const copiasDeCables = cables
    .filter((c) => idDe.has(c.de) && idDe.has(c.a))
    .map((c) => ({ id: nuevo("c"), de: idDe.get(c.de)!, a: idDe.get(c.a)!, salida: salidaDe.get(`${c.de}|${c.salida}`) ?? c.salida }));
  return { fichas: copias, cables: copiasDeCables };
}

/** Las fichas a las que llega un Inicio siguiendo sus cables: su ruta. */
export function rutaDe(t: Pick<Tablero, "cables">, inicioId: string): Set<string> {
  const vistas = new Set<string>([inicioId]);
  const cola = [inicioId];
  while (cola.length) {
    const id = cola.shift()!;
    for (const c of t.cables)
      if (c.de === id && !vistas.has(c.a)) {
        vistas.add(c.a);
        cola.push(c.a);
      }
  }
  return vistas;
}

/** La manta nueva de un Inicio: alrededor de su ruta si ya tiene fichas, o un hueco a su derecha. */
export function mantaPara(t: { fichas: FichaCopiable[]; cables: CableDelTablero[] }, inicio: FichaCopiable): NonNullable<Tablero["cajas"]>[number] {
  const ids = rutaDe(t, inicio.id);
  const enLaRuta = t.fichas.filter((f) => ids.has(f.id) && !f.guardada);
  const suyas = enLaRuta.length ? enLaRuta : [inicio];
  const minX = Math.min(...suyas.map((f) => f.x)) - 40;
  const minY = Math.min(...suyas.map((f) => f.y)) - 70;
  const maxX = Math.max(...suyas.map((f) => f.x + (f.tipo === "inicio" ? 200 : 250)), inicio.x + 1200) + 40;
  const maxY = Math.max(...suyas.map((f) => f.y + 260), inicio.y + 520) + 30;
  return {
    id: `manta-${inicio.id}`,
    x: Math.round(minX),
    y: Math.round(minY),
    ancho: Math.round(maxX - minX),
    alto: Math.round(maxY - minY),
    titulo: "",
    inicio: inicio.id,
  };
}
