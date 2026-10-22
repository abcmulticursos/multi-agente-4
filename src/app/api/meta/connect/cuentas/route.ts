import { NextResponse } from "next/server";
import { cuentaDeFacebookDeCadaNegocio, listPermisosDeCuentas } from "@/lib/db";
import { loConectado } from "@/lib/meta/lo-conectado";
import { compartidoPor, cuentaDeLaTienda, puedeUsarlo, type ConCuenta } from "@/lib/meta/cuentas";
import { loadWorkflowConfig } from "@/lib/workflow/config";
import { cuentasDeFacebookConectadas } from "@/lib/meta/cuentas-de-facebook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * LAS CUENTAS DE META CONECTADAS, CADA UNA CON LO SUYO, LO COMPARTIDO Y SUS TIENDAS.
 *
 * LO PIDIÓ EL DUEÑO el 09/10/2026: «necesito yo saber cuántas cuentas de facebook están
 * conectadas, en este momento no lo veo, es incierto». Y el 10/10/2026: «que cada cuenta
 * tenga sus propios activos, y que yo pueda elegir activos de una misma cuenta, y si
 * están compartidos también». El dibujo está en PLAN-VARIAS-CUENTAS-DE-FACEBOOK.md.
 *
 * ── QUÉ CUENTA COMO «CUENTA CONECTADA» ─────────────────────────────────────
 *
 * La dueña de algún NÚMERO o de alguna PÁGINA. Los píxeles no suman: el login ve también
 * los que otros negocios le comparten, y contarlos inflaría el número con cuentas que él
 * nunca conectó. Esos píxeles van en la tarjeta de la cuenta que puede usarlos, como
 * compartidos, o aparte si ninguna puede.
 *
 * ── SOLO LEE ───────────────────────────────────────────────────────────────
 *
 * La base y la configuración. No llama a Meta ni escribe nada: abrir Meta Connect no
 * puede cambiar lo que el bot usa.
 */
type Estado = "ok" | "compartido" | "falta" | "otra" | "?" | "general";

export async function GET() {
  const conectado = loConectado();
  // De qué cuenta de Facebook es cada negocio (Claudio, Alberto…).
  const deQuienEs = cuentaDeFacebookDeCadaNegocio();
  const tiendas = loadWorkflowConfig()?.tiendas ?? [];

  type Tarjeta = {
    id: string;
    nombre: string;
    /** La cuenta de Facebook que trajo este negocio (Claudio, Alberto…). null = no apuntada. */
    facebookNombre: string | null;
    /** Lo que es SUYO. */
    numeros: string[];
    /** Los mismos números, con su id: lo necesita el botón «Suscribir» de cada uno. */
    numerosConId: Array<{ id: string; etiqueta: string; detalle: string | null }>;
    paginas: string[];
    /** Las mismas páginas, con su id: para su foto en el pop up del negocio. */
    paginasConId: Array<{ id: string; etiqueta: string; detectada: boolean }>;
    pixels: string[];
    /** Lo que otras cuentas le COMPARTIERON, con quién se lo compartió. */
    compartidos: Array<{
      que: "número" | "página" | "píxel";
      nombre: string;
      de: string;
      /** El id, en números y páginas: para suscribirlos y para su foto. */
      id?: string;
    }>;
    /** Con qué se miden sus compras. Nunca el permiso en sí: solo cuál es. */
    medicion: "permanente" | "login" | "general";
    origen: "principal" | "nueva";
    puedeGenerarPermanente: boolean;
    /** Un píxel suyo para probar cuando la cuenta no tiene tiendas. */
    pixelParaProbar: string | null;
    tiendas: Array<{
      id: string;
      nombre: string;
      color: string | null;
      numero: string;
      pagina: Estado;
      pixel: Estado;
      /** El píxel con el que mide DE VERDAD (el suyo o el de Meta Connect). */
      pixelId: string | null;
      mezcla: string | null;
    }>;
  };
  const tarjetas = new Map<string, Tarjeta>();
  const tarjetaDe = (id: string, nombre: string | null | undefined) => {
    let t = tarjetas.get(id);
    if (!t) {
      t = {
        id,
        nombre: nombre?.trim() || "Cuenta sin nombre",
        facebookNombre: deQuienEs.get(id)?.facebookNombre ?? null,
        numeros: [],
        numerosConId: [],
        paginas: [],
        paginasConId: [],
        pixels: [],
        compartidos: [],
        medicion: "general",
        origen: "principal",
        puedeGenerarPermanente: false,
        pixelParaProbar: null,
        tiendas: [],
      };
      tarjetas.set(id, t);
    }
    return t;
  };

  // 1. LAS CUENTAS: las dueñas de números y de páginas.
  const sinIdentificar = {
    numeros: [] as string[],
    numerosConId: [] as Tarjeta["numerosConId"],
    paginas: [] as string[],
  };
  const nombreDeNumero = (n: (typeof conectado.numeros)[number]) =>
    n.detalle ? `${n.etiqueta} · ${n.detalle}` : n.etiqueta;
  for (const n of conectado.numeros) {
    const conId = { id: n.id, etiqueta: n.etiqueta, detalle: n.detalle ?? null };
    if (n.cuenta) {
      const t = tarjetaDe(n.cuenta, n.cuentaNombre);
      t.numeros.push(nombreDeNumero(n));
      t.numerosConId.push(conId);
    } else {
      sinIdentificar.numeros.push(nombreDeNumero(n));
      sinIdentificar.numerosConId.push(conId);
    }
  }
  // Una página ELEGIDA crea su cuenta; una solo detectada se apunta en la tarjeta de su
  // cuenta si esa cuenta ya existe, pero no crea una: una página que Meta ve y él nunca
  // eligió no es una cuenta conectada. Antes las detectadas no salían en ningún sitio, y
  // la tarjeta decía «Páginas: ninguna» aunque la cuenta tuviera.
  for (const p of conectado.paginas) {
    if (!p.elegida) continue;
    if (p.cuenta) {
      const t = tarjetaDe(p.cuenta, p.cuentaNombre);
      t.paginas.push(p.etiqueta);
      t.paginasConId.push({ id: p.id, etiqueta: p.etiqueta, detectada: false });
    } else sinIdentificar.paginas.push(p.etiqueta);
  }
  for (const p of conectado.paginas) {
    if (p.elegida || !p.cuenta) continue;
    const t = tarjetas.get(p.cuenta);
    if (!t) continue;
    t.paginas.push(`${p.etiqueta} (detectada)`);
    t.paginasConId.push({ id: p.id, etiqueta: p.etiqueta, detectada: true });
  }

  // 2. LOS PÍXELES: en la tarjeta de su dueña si existe, y como COMPARTIDOS en cada
  //    tarjeta que puede usarlos sin ser la dueña.
  const pixelsDeOtras: string[] = [];
  for (const px of conectado.pixels) {
    let enAlguna = false;
    const suya = px.cuenta ? tarjetas.get(px.cuenta) : undefined;
    if (suya) {
      suya.pixels.push(px.etiqueta);
      suya.pixelParaProbar ??= px.id;
      enAlguna = true;
    }
    for (const t of tarjetas.values()) {
      const de = compartidoPor(px, t.id);
      if (de) {
        t.compartidos.push({ que: "píxel", nombre: px.etiqueta, de });
        enAlguna = true;
      }
    }
    if (!enAlguna) {
      pixelsDeOtras.push(px.cuentaNombre ? `${px.etiqueta} · ${px.cuentaNombre}` : px.etiqueta);
    }
  }
  // Y los números y páginas que una cuenta tiene COMPARTIDOS de otra.
  for (const t of tarjetas.values()) {
    for (const n of conectado.numeros) {
      const de = compartidoPor(n, t.id);
      if (de) t.compartidos.push({ que: "número", nombre: nombreDeNumero(n), de, id: n.id });
    }
    for (const p of conectado.paginas) {
      const de = compartidoPor(p, t.id);
      if (de) t.compartidos.push({ que: "página", nombre: p.etiqueta, de, id: p.id });
    }
  }

  // 3. LAS TIENDAS, cada una en la tarjeta de su número. Su estado sale de la MISMA
  //    regla que usa el aviso del editor: ver `src/lib/meta/cuentas.ts`.
  const estadoDe = (cosa: ConCuenta | undefined, cuenta: string | null): Estado => {
    if (!cosa) return "?";
    if (!cosa.cuenta || !cuenta) return "?";
    if (cosa.cuenta === cuenta) return "ok";
    return puedeUsarlo(cosa, cuenta) ? "compartido" : "otra";
  };
  const tiendasSinCuenta: Tarjeta["tiendas"] = [];
  for (const t of tiendas) {
    if (t?.enabled === false) continue;
    const { cuenta, mezcla } = cuentaDeLaTienda(t, conectado, conectado.pixelGeneral);
    const numero = conectado.numeros.find((n) => n.id === String(t.numero ?? "").trim());
    const paginaId = String(t.pagina ?? "").trim();
    const pixelPropio = String(t.pixel ?? "").trim();
    const pixelId = pixelPropio || conectado.pixelGeneral || null;
    const estadoPixel: Estado = !pixelId
      ? "falta"
      : (() => {
          const e = estadoDe(conectado.pixels.find((p) => p.id === pixelId), cuenta?.id ?? null);
          // Vacío y el de Meta Connect sirve: se dice que es ése.
          return !pixelPropio && e !== "otra" ? "general" : e;
        })();
    const fila = {
      id: t.id,
      nombre: t.nombre?.trim() || "Tienda sin nombre",
      color: /^#[0-9a-fA-F]{6}$/.test(String(t.color ?? "")) ? String(t.color) : null,
      numero: numero?.etiqueta ?? (String(t.numero ?? "").trim() || "sin número"),
      pagina: paginaId
        ? estadoDe(conectado.paginas.find((p) => p.id === paginaId), cuenta?.id ?? null)
        : ("falta" as const),
      pixel: estadoPixel,
      pixelId,
      mezcla,
    };
    if (cuenta) tarjetaDe(cuenta.id, cuenta.nombre).tiendas.push(fila);
    else tiendasSinCuenta.push(fila);
  }

  // 4. CON QUÉ PERMISO MIDE CADA CUENTA. La regla es la de `permisoDeMedicionDeLaCuenta`
  //    en db.ts — aquí solo se dice cuál le toca, para que él lo vea.
  for (const p of listPermisosDeCuentas()) {
    const tarjeta = tarjetas.get(p.id);
    if (!tarjeta) continue;
    tarjeta.origen = p.origen;
    tarjeta.puedeGenerarPermanente = p.tieneConexion;
    tarjeta.medicion = p.tienePermanente
      ? "permanente"
      : p.origen === "nueva" && p.tieneConexion
        ? "login"
        : "general";
  }

  // Las cuentas que pueden ser filtro en las secciones de abajo: id y nombre.
  const cuentas = [...tarjetas.values()].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" })
  );
  // CUÁNTAS CUENTAS DE FACEBOOK: las que trajeron algún negocio de la lista. Él lo pidió
  // así el 10/10/2026: «eso no se llaman cuentas entonces, realmente están conectadas 2
  // cuentas de facebook». Lo de arriba (`total`) son negocios, y se dice con esa palabra.
  // Por su id y no por el nombre: dos cuentas pueden llamarse igual.
  const cuentasDeFacebook = new Set(
    [...tarjetas.keys()]
      .map((id) => deQuienEs.get(id)?.facebookId)
      .filter((id): id is string => Boolean(id))
  ).size;
  return NextResponse.json({
    cuentasDeFacebook,
    total: tarjetas.size,
    cuentas,
    sinIdentificar: { ...sinIdentificar, tiendas: tiendasSinCuenta },
    pixelsDeOtras,
    // Toda cuenta de Facebook que inició sesión, con los BM que trajo (21/10/2026): para que tenga
    // su fila aunque sus BM ya estén bajo otra o no tengan números ni páginas.
    conectadas: cuentasDeFacebookConectadas().map((c) => ({ nombre: c.nombre, origen: c.origen, negocios: c.negocios })),
  });
}
