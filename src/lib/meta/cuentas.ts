/**
 * DE QUÉ CUENTA DE META ES CADA TIENDA, Y SI USA ALGO QUE SU CUENTA NO PUEDE USAR.
 *
 * LO PIDIÓ EL DUEÑO el 09/10/2026: «yo no quiero elegir una página de una cuenta y un
 * píxel de la otra y un whatsapp de la otra». Y lo precisó el 10/10/2026: «que yo pueda
 * elegir activos de una misma cuenta, y si están compartidos también». El diseño entero
 * está en PLAN-VARIAS-CUENTAS-DE-FACEBOOK.md.
 *
 * ── UNA SOLA PUERTA ─────────────────────────────────────────────────────────
 *
 * Esto lo usan DOS pantallas: las tarjetas de Meta Connect y el aviso dentro de la
 * tienda, en el editor. Si cada una decidiera a su manera, un día la tarjeta diría «✓»
 * y la tienda «⚠» de la misma tienda. Por eso vive aquí, y por eso este archivo no
 * importa nada del servidor: lo pueden leer el navegador y el servidor.
 *
 * ── LA CUENTA LA FIJA EL NÚMERO ────────────────────────────────────────────
 *
 * El número es lo que atiende al cliente, así que es el que manda. La página y el píxel
 * valen si son DE SU CUENTA o ESTÁN COMPARTIDOS CON ELLA — eso es lo que Meta acepta.
 *
 * QUÉ CAMBIÓ EL 10/10/2026, y por qué. La primera versión solo miraba al DUEÑO: un píxel
 * que BM Basura 2 le compartía a Aula Virtual Pro salía como «mezcla» y no se ofrecía en
 * su tienda. Para Meta eso es correcto, y él lo quiere poder elegir. Ahora un compartido
 * vale igual que uno propio, y se dice de quién viene.
 *
 * Si el número todavía no tiene cuenta identificada no se esconde nada ni se avisa de
 * nada: no hay con qué comparar, y esconder sería dejarle sin poder elegir.
 */

export interface CuentaConNombre {
  id: string;
  nombre: string | null;
}

/** Algo conectado que se puede elegir, con la cuenta a la que pertenece. */
export interface ConCuenta {
  id: string;
  /** Cómo se llama, para poder nombrarlo en el aviso. */
  etiqueta?: string;
  /** El id del negocio de Meta dueño. null = sin identificar. */
  cuenta?: string | null;
  cuentaNombre?: string | null;
  /** Las cuentas que pueden usarlo: la dueña y las que lo tienen compartido. */
  accesoDe?: CuentaConNombre[];
}

export interface LoConectado {
  numeros: ConCuenta[];
  paginas: ConCuenta[];
  pixels: ConCuenta[];
}

export interface CuentaDeLaTienda {
  /** La cuenta del número, que es la que manda. null = sin número o sin identificar. */
  cuenta: { id: string; nombre: string } | null;
  /** La frase del aviso si usa algo que su cuenta no puede usar. null = todo bien (o no
   *  se puede saber). */
  mezcla: string | null;
}

const nombreDe = (c: ConCuenta | undefined): string =>
  c?.cuentaNombre?.trim() || "una cuenta sin nombre";

/** ¿Puede esta cuenta usarlo? Sí si es suyo o si se lo compartieron. */
export function puedeUsarlo(cosa: ConCuenta, cuentaId: string): boolean {
  return cosa.cuenta === cuentaId || (cosa.accesoDe ?? []).some((c) => c.id === cuentaId);
}

/**
 * QUIÉN SE LO COMPARTIÓ, para decirlo junto al nombre: «compartido por BM Basura 2».
 * null = es suyo, o esta cuenta no puede usarlo.
 */
export function compartidoPor(cosa: ConCuenta, cuentaId: string): string | null {
  if (!cosa.cuenta || cosa.cuenta === cuentaId) return null;
  return puedeUsarlo(cosa, cuentaId) ? nombreDe(cosa) : null;
}

/**
 * LA CUENTA DE UNA TIENDA Y SI USA ALGO QUE SU CUENTA NO PUEDE USAR.
 *
 * `pixelGeneral` es el de Meta Connect: una tienda con el píxel vacío mide con ése, así
 * que también cuenta. Una tienda que parece limpia porque no eligió píxel y luego mide
 * en uno que su cuenta no puede usar es exactamente el disgusto que esto evita.
 */
export function cuentaDeLaTienda(
  tienda: { numero?: string | null; pagina?: string | null; pixel?: string | null },
  conectado: LoConectado,
  pixelGeneral?: string | null
): CuentaDeLaTienda {
  const buscar = (lista: ConCuenta[], id: string | null | undefined) => {
    const suyo = String(id ?? "").trim();
    return suyo ? lista.find((c) => c.id === suyo) : undefined;
  };
  const numero = buscar(conectado.numeros, tienda.numero);
  const pagina = buscar(conectado.paginas, tienda.pagina);
  const pixelPropio = String(tienda.pixel ?? "").trim();
  const pixel = buscar(conectado.pixels, pixelPropio || pixelGeneral);

  if (!numero?.cuenta) return { cuenta: null, mezcla: null };
  const cuenta = { id: numero.cuenta, nombre: nombreDe(numero) };

  // Solo se juzga lo que tiene dueño conocido. Una pieza sin identificar no se da por
  // mala: no se sabe, y un aviso que se equivoca se aprende a ignorar.
  const fallos: string[] = [];
  const revisar = (que: string, cosa: ConCuenta | undefined, compartida: string) => {
    if (!cosa?.cuenta || puedeUsarlo(cosa, cuenta.id)) return;
    const nombre = cosa.etiqueta ? ` «${cosa.etiqueta}»` : "";
    fallos.push(`${que}${nombre} es de ${nombreDe(cosa)} y no está ${compartida} con ${cuenta.nombre}`);
  };
  revisar("la página", pagina, "compartida");
  revisar(
    pixelPropio ? "el píxel" : "el píxel de Meta Connect, que usa por estar vacío,",
    pixel,
    "compartido"
  );
  if (!fallos.length) return { cuenta, mezcla: null };

  return {
    cuenta,
    mezcla: `${fallos.join("; y ")}. Meta puede rechazar sus compras.`.replace(/^./, (l) =>
      l.toUpperCase()
    ),
  };
}

/**
 * LAS OPCIONES DE UN SELECTOR: las de la cuenta del número Y las compartidas con ella.
 *
 * «No se evita la mezcla con cuidado: se evita no ofreciéndola.» Lo que su cuenta no
 * puede usar no aparece, y tampoco lo que sigue sin identificar: ofrecerlo sería dejar
 * abierta la misma puerta.
 *
 * LA ÚNICA EXCEPCIÓN ES LA QUE YA TIENE PUESTA. Si la tienda se configuró antes, esconder
 * su valor haría que el selector dijera «escrito a mano» sobre algo que él eligió de la
 * lista. Se deja a la vista —el aviso ya dice qué pasa— y así puede cambiarla.
 */
export function soloDeLaCuenta<T extends ConCuenta>(
  opciones: T[],
  cuentaId: string | null | undefined,
  puesto: string | null | undefined
): { visibles: T[]; escondidas: number } {
  if (!cuentaId) return { visibles: opciones, escondidas: 0 };
  const suyo = String(puesto ?? "").trim();
  const visibles = opciones.filter((o) => puedeUsarlo(o, cuentaId) || o.id === suyo);
  return { visibles, escondidas: opciones.length - visibles.length };
}
