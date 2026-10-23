/**
 * LOS NÚMEROS DE CUENTA ESCRITOS A MANO (23/10/2026, solo ALBERTO 4).
 *
 * Lo pidió el dueño: «tengo que llenar varios campos… esa respuesta la tengo que poner varias
 * veces en muchos lugares del editor y es un dolor de cabeza buscarlos». Y la condición: «la
 * respuesta que le llegue al cliente igual, pero con otra configuración interna».
 *
 * Medido en su contenido ese día: 1055 textos con datos de pago, 893 con el número escrito a
 * mano (su Yape 437 veces) y tres cuentas BCP distintas en Perú — dos a mano y otra guardada.
 * Cambiar el usuario que cobra no cambiaba nada de eso: el bot manda lo escrito tal cual.
 *
 * Esto NO mueve ni junta sus respuestas: cada texto se queda donde está, con su contexto. Solo
 * cambia el número por el comodín de su cuenta ({{CUENTA_<nombre>}}), que el bot YA resuelve
 * (`sender.ts`, por la cuenta de quien cobra en esa tienda). Antes de cambiar nada se calcula, tienda
 * por tienda, qué número saldría con el comodín: si no es exactamente el que está escrito, se avisa.
 *
 * Vive fuera de la página a propósito: así se prueba sin React (`prueba-numeros-a-mano.mjs`).
 * No importa nada del motor: lee los datos con la misma regla que `elCobroDelPais`, escrita aquí
 * para la pantalla (como `quienCobraEn`).
 */

export interface CuentasDeUnSitio {
  numero_de_cuenta?: string;
  cuentas_por_metodo?: Record<string, string>;
  nombre_completo?: string;
  titular?: string;
  metodos_apagados?: string[];
  payment_validation?: { yape_recipient_name_starts_with?: string };
  payment_buttons?: Array<{ method?: string; label?: string }>;
  enabled?: boolean;
}

export interface ConfigConCuentas {
  payment_profiles_by_country?: Partial<Record<string, CuentasDeUnSitio>>;
  modality_payment_profiles?: Partial<Record<string, Partial<Record<string, CuentasDeUnSitio>> | undefined>>;
  cobradores?: Array<{ id: string; nombre?: string; por_pais?: Partial<Record<string, CuentasDeUnSitio>> }>;
  tiendas?: Array<{ id: string; nombre?: string; cobrador?: string }>;
  payment_validation?: { yape_recipient_name_starts_with?: string };
}

const limpio = (v: unknown): string => String(v ?? "").trim();
export const soloCifras = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

/** «BCP Interbancaria» → «bcp_interbancaria». La clave es la que va en el comodín. */
export function claveDeCuenta(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function comodinDeCuenta(clave: string): string {
  return `{{CUENTA_${clave.toUpperCase()}}}`;
}

/** «bcp_interbancaria» → «Bcp interbancaria», para la pantalla. */
export function nombreDeLaClave(clave: string): string {
  const t = clave.replace(/_+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : clave;
}

/** El perfil del país y sus copias por modalidad: el editor los guarda iguales (`guardarDatosDelUsuario`). */
export function perfilesDelPais(cfg: ConfigConCuentas, pais: string): Array<{ modalidad: string | null; perfil: CuentasDeUnSitio }> {
  const fuera: Array<{ modalidad: string | null; perfil: CuentasDeUnSitio }> = [];
  const base = cfg.payment_profiles_by_country?.[pais];
  if (base) fuera.push({ modalidad: null, perfil: base });
  for (const [modalidad, porPais] of Object.entries(cfg.modality_payment_profiles ?? {})) {
    const p = porPais?.[pais];
    if (p) fuera.push({ modalidad, perfil: p });
  }
  return fuera;
}

/** Los métodos de pago del país (sus botones), en minúsculas. */
export function metodosDelPais(cfg: ConfigConCuentas, pais: string): string[] {
  const vistos = new Set<string>();
  for (const { perfil } of perfilesDelPais(cfg, pais))
    for (const b of perfil.payment_buttons ?? []) {
      const m = limpio(b?.method).toLowerCase();
      if (m) vistos.add(m);
    }
  return [...vistos];
}

/** Las cuentas con nombre que NO son un método: «Interbancaria», «Cédula», la del upsell… */
export function otrasCuentas(cuentas: Record<string, string> | undefined, metodos: string[]): Array<[string, string]> {
  const deMetodo = new Set(metodos.map((m) => m.toLowerCase()));
  return Object.entries(cuentas ?? {}).filter(([k]) => !deMetodo.has(limpio(k).toLowerCase()));
}

function titularDelPerfil(cfg: ConfigConCuentas, perfil: CuentasDeUnSitio | undefined): string {
  return limpio(perfil?.payment_validation?.yape_recipient_name_starts_with) || limpio(cfg.payment_validation?.yape_recipient_name_starts_with);
}

/**
 * LOS USUARIOS QUE SON LA MISMA PERSONA QUE EL DUEÑO DEL PAÍS: su titular (el que aprueba el
 * comprobante) es el mismo. Hace falta porque el bot busca la cuenta PRIMERO en el usuario de la
 * tienda y, si no tiene esa cuenta con nombre, pone SU cuenta principal: una «Interbancaria»
 * guardada solo en el país saldría como el número del BCP en la tienda que cobra «Alberto».
 */
export function mismaPersona(cfg: ConfigConCuentas, pais: string): string[] {
  const titular = titularDelPerfil(cfg, cfg.payment_profiles_by_country?.[pais]).toLowerCase();
  if (!titular) return [];
  return (cfg.cobradores ?? [])
    .filter((c) => limpio(c.por_pais?.[pais]?.titular).toLowerCase() === titular)
    .map((c) => c.id);
}

function laCuenta(sitio: CuentasDeUnSitio | undefined, clave: string): string {
  const suya = clave.trim().toLowerCase();
  for (const [k, v] of Object.entries(sitio?.cuentas_por_metodo ?? {})) if (limpio(k).toLowerCase() === suya) return limpio(v);
  return "";
}

/** EXACTAMENTE la regla del bot (`elCobroDelPais` + `{{CUENTA_x}}` en `sender.ts`). */
export function cuentaQueSale(cfg: ConfigConCuentas, pais: string, clave: string, cobradorId: string | null, perfil: CuentasDeUnSitio | undefined): string {
  const cob = cobradorId ? (cfg.cobradores ?? []).find((c) => limpio(c.id) === cobradorId) : undefined;
  const suyo = cob?.por_pais?.[pais];
  const apagado = (suyo?.metodos_apagados ?? []).map((m) => limpio(m).toLowerCase()).includes(clave.toLowerCase());
  const delUsuario = laCuenta(suyo, clave) || limpio(suyo?.numero_de_cuenta);
  if (apagado) return delUsuario;
  return delUsuario || laCuenta(perfil, clave) || limpio(perfil?.numero_de_cuenta);
}

/** {{NOMBRE_COMPLETO}}, con la misma regla del bot. */
export function nombreQueSale(cfg: ConfigConCuentas, pais: string, cobradorId: string | null, perfil: CuentasDeUnSitio | undefined): string {
  const cob = cobradorId ? (cfg.cobradores ?? []).find((c) => limpio(c.id) === cobradorId) : undefined;
  const suyo = cob?.por_pais?.[pais];
  const titularSuyo = limpio(suyo?.titular);
  const titular = titularSuyo || titularDelPerfil(cfg, perfil);
  return titularSuyo ? limpio(suyo?.nombre_completo) || titularSuyo : limpio(suyo?.nombre_completo) || limpio(perfil?.nombre_completo) || titular;
}

/** Los sitios por donde puede salir un texto en ese país: cada tienda (con su usuario) y «sin tienda». */
function sitiosDelPais(cfg: ConfigConCuentas): Array<{ donde: string; cobradorId: string | null }> {
  return [
    ...(cfg.tiendas ?? []).map((t) => ({ donde: `la tienda «${limpio(t.nombre) || t.id}»`, cobradorId: limpio(t.cobrador) || null })),
    { donde: "los clientes sin tienda", cobradorId: null },
  ];
}

export interface Diferencia {
  donde: string;
  sale: string;
}

/**
 * ¿EL COMODÍN DARÍA EXACTAMENTE `literal` EN TODAS LAS TIENDAS DE ESE PAÍS? Devuelve dónde no.
 * `tipo` = "cuenta" (con su clave) o "nombre".
 */
export function dondeNoSaleIgual(cfg: ConfigConCuentas, pais: string, tipo: "cuenta" | "nombre", clave: string, literal: string): Diferencia[] {
  const fuera: Diferencia[] = [];
  const perfiles = perfilesDelPais(cfg, pais);
  if (perfiles.length === 0) perfiles.push({ modalidad: null, perfil: {} });
  for (const sitio of sitiosDelPais(cfg))
    for (const { modalidad, perfil } of perfiles) {
      const sale = tipo === "cuenta" ? cuentaQueSale(cfg, pais, clave, sitio.cobradorId, perfil) : nombreQueSale(cfg, pais, sitio.cobradorId, perfil);
      if (sale !== literal) {
        const donde = `${sitio.donde}${modalidad && perfiles.length > 1 ? ` (${modalidad})` : ""}`;
        if (!fuera.some((d) => d.donde === sitio.donde && d.sale === sale)) fuera.push({ donde, sale });
      }
    }
  return fuera;
}

// ── DÓNDE ESTÁN ────────────────────────────────────────────────────────────────

/** Campos que NO son textos para el cliente: las propias cuentas, ids de anuncios, tiendas… */
const NO_SON_TEXTOS = new Set([
  "cuentas_por_metodo",
  "numero_de_cuenta",
  "cobradores",
  "ad_registry",
  "tiendas",
  "ids",
  "payment_validation",
  "nombre_completo",
  "titular",
  "id",
  "drive_url",
  "url",
  "paises",
]);

/**
 * LA BANDERA DE UNA PIEZA (`paises`): una intro o un seguimiento con bandera solo lo leen los
 * clientes de esos países. La lleva el objeto de la pieza, y vale para todo lo que tiene dentro.
 */
function banderaDe(v: Record<string, unknown>, heredada: string[] | null): string[] | null {
  // Igual que `banderasDePieza` (pizarra-quien-sale.ts): con «dirigir por país» apagado no cuenta.
  if (v.pais_routing_enabled === false) return heredada;
  const p = v.paises;
  return Array.isArray(p) && p.length ? p.map((x) => String(x).trim().toUpperCase()).filter(Boolean) : heredada;
}

/**
 * LOS PAÍSES DONDE VENDE: los que tienen «Vender en este país» encendido en su perfil o en el de
 * alguna modalidad (ausente = encendido, como en el motor). Un texto que solo leería un país donde
 * no vende no lo lee nadie.
 */
export function paisesQueVenden(cfg: ConfigConCuentas): string[] {
  const fuera = new Set<string>();
  for (const [pais, p] of Object.entries(cfg.payment_profiles_by_country ?? {})) if (p && p.enabled !== false) fuera.add(pais);
  for (const porPais of Object.values(cfg.modality_payment_profiles ?? {}))
    for (const [pais, p] of Object.entries(porPais ?? {})) if (p && p.enabled !== false) fuera.add(pais);
  return [...fuera].sort();
}

/** Un texto con datos de pago: nombra una cuenta, un banco, un titular o lleva sus comodines.
 *  Palabras de banca en general: ninguna marca de pago ni nombre de banco (es una plantilla). */
const ES_DE_PAGO =
  /a nombre|titular|n[uú]mero de cuenta|\bcta\b|\bcci\b|\bcbu\b|cuenta|banc[oa]|bancari|\{\{\s*(nombre_receptor|nombre_completo|numero_de_cuenta|cuenta_[a-z0-9_]+|metodo_de_pago_[a-z0-9_]+)\s*\}\}/i;

/** Un número de 7 o más cifras, con espacios o guiones sueltos. No el trozo de un enlace, un id o un código. */
const NUMERO = /(?<![\p{L}\p{N}_/.:#=@+])(?<![\p{L}\p{N}]-)(\d(?:[ -]?\d){6,})(?![\p{L}\p{N}_/])/gu;

function* textos(
  v: unknown,
  ruta: string[] = [],
  bandera: string[] | null = null
): Generator<{ texto: string; ruta: string[]; bandera: string[] | null }> {
  if (typeof v === "string") {
    yield { texto: v, ruta, bandera };
    return;
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) yield* textos(v[i], [...ruta, String(i)], bandera);
    return;
  }
  if (v && typeof v === "object") {
    const suya = banderaDe(v as Record<string, unknown>, bandera);
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (NO_SON_TEXTOS.has(k)) continue;
      yield* textos(x, [...ruta, k], suya);
    }
  }
}

/** Cada trozo de la ruta, como él lo llama en el editor. Lo que no se conoce, no se nombra. */
const NOMBRES_DE_SITIO: Record<string, string> = {
  whatsapp: "WhatsApp",
  messenger: "Messenger",
  instagram: "Instagram",
  followups: "Seguimientos",
  intro_groups: "Intro",
  upsell_intro_groups: "Intro del upsell",
  upsell: "Upsell",
  payment: "Pago",
  payment_responses: "Respuesta por método",
  decisions: "cuadrito",
  buttons: "botón",
  metodo_pago_1: "Datos de pago 1",
  metodo_pago_2: "Datos de pago 2",
  metodo_pago_3: "Datos de pago 3",
  metodo_pago_principal: "Datos de pago 4",
  payment_text: "Texto del menú de pago",
  direct_payment_steps: "Pago directo",
  direct_payment_without_choice_steps: "Pago sin elección",
  payment_resend_steps: "Reenvío de datos",
  biblioteca_de_intros: "Biblioteca de intros",
  commercial_routes: "Rutas comerciales",
  order_bump: "Order bump",
  combo: "opción cara",
  basico: "opción barata",
  response: "respuesta al elegir",
  pregunta_steps: "pregunta",
  tableros: "Tablero",
  workflows: "Workflow",
  payment_profiles_by_country: "Usuario",
  modality_payment_profiles: "Usuario",
  lineal: "lineal",
  doble_oferta_upsell: "-DOU-",
  doble_oferta_dos: "doble oferta",
};

const PAISES = /^[A-Z]{2}$/;

export function nombreDelSitio(ruta: string[]): string {
  const partes: string[] = [];
  for (const r of ruta) {
    const n = NOMBRES_DE_SITIO[r] ?? (PAISES.test(r) ? r : null);
    if (n && partes[partes.length - 1] !== n) partes.push(n);
  }
  return partes.join(" · ") || "Otro sitio";
}

function paisDeLaRuta(ruta: string[]): string | null {
  return ruta.find((r) => PAISES.test(r)) ?? null;
}

/** Palabras que no nombran ninguna cuenta: «Cuenta:», «A la cuenta», «Cta.», «Número». */
const PALABRAS_DE_RELLENO = new Set(["a", "al", "la", "el", "de", "del", "mi", "tu", "cuenta", "cta", "numero", "número", "nro", "n", "no", "num"]);

/** «📲 *BCP*: -» → «BCP». Lo que dice delante del número, sin emojis ni asteriscos ni relleno. */
function etiquetaDeLaLinea(texto: string, inicio: number): string {
  const desde = texto.lastIndexOf("\n", inicio - 1) + 1;
  const antes = texto
    .slice(desde, inicio)
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return antes
    .split(" ")
    .filter((p) => p && !PALABRAS_DE_RELLENO.has(p.toLowerCase()))
    .slice(-3)
    .join(" ");
}

/**
 * EL NOMBRE QUE SE PROPONE PARA UNA CUENTA NUEVA: lo que dice su línea («BCP», «Interbancaria»,
 * «Pichincha»); si no dice nada, de dónde es («Upsell»); si tampoco, «Otra cuenta». Él lo cambia.
 */
export function nombrePropuesto(h: Pick<Hallazgo, "etiqueta" | "lugares">): string {
  if (h.etiqueta) return h.etiqueta.length <= 3 ? h.etiqueta.toUpperCase() : h.etiqueta[0].toUpperCase() + h.etiqueta.slice(1).toLowerCase();
  if (h.lugares.some((l) => /upsell/i.test(l.donde))) return "Upsell";
  return "Otra cuenta";
}

/**
 * UNA CLAVE LIBRE EN ESE PAÍS: si «bcp» ya es otra cuenta (otro número), «bcp_2», «bcp_3»… Así
 * las tres cuentas BCP distintas que hay hoy en Perú quedan las tres a la vista, sin pisarse.
 */
export function claveLibre(cfg: ConfigConCuentas, pais: string, base: string, cifras: string): string {
  const raiz = claveDeCuenta(base) || "cuenta";
  const ocupada = (k: string) =>
    perfilesDelPais(cfg, pais).some(({ perfil }) => {
      const v = laCuenta(perfil, k);
      return !!v && soloCifras(v) !== cifras;
    });
  let clave = raiz;
  for (let n = 2; ocupada(clave); n++) clave = `${raiz}_${n}`;
  return clave;
}

export interface CuentaConocida {
  pais: string;
  quien: string;
  clave: string | null;
  valor: string;
}

/** Todas las cuentas guardadas: del dueño por país y de cada usuario. */
export function cuentasConocidas(cfg: ConfigConCuentas): CuentaConocida[] {
  const fuera: CuentaConocida[] = [];
  const add = (pais: string, quien: string, clave: string | null, valor: unknown) => {
    if (soloCifras(valor).length >= 6) fuera.push({ pais, quien, clave, valor: limpio(valor) });
  };
  const paises = new Set<string>([
    ...Object.keys(cfg.payment_profiles_by_country ?? {}),
    ...Object.values(cfg.modality_payment_profiles ?? {}).flatMap((x) => Object.keys(x ?? {})),
  ]);
  for (const pais of paises)
    for (const { perfil } of perfilesDelPais(cfg, pais)) {
      add(pais, "tú", null, perfil.numero_de_cuenta);
      for (const [k, v] of Object.entries(perfil.cuentas_por_metodo ?? {})) add(pais, "tú", k, v);
    }
  for (const c of cfg.cobradores ?? [])
    for (const [pais, x] of Object.entries(c.por_pais ?? {})) {
      add(pais, limpio(c.nombre) || "un usuario", null, x?.numero_de_cuenta);
      for (const [k, v] of Object.entries(x?.cuentas_por_metodo ?? {})) add(pais, limpio(c.nombre) || "un usuario", k, v);
    }
  return fuera;
}

/**
 * QUIÉN LEE CADA TEXTO. Hace falta por texto y no por número. Medido el 23/10 en su contenido:
 * hay textos de Ecuador (`by_country.EC`) y seguimientos con bandera de Argentina y de Ecuador con
 * el Yape de PERÚ escrito dentro (copiados de los de Perú). Hoy esos clientes leen el número de
 * Perú; con el comodín leerían la cuenta de su país. Eso no se cambia sin que él lo decida.
 *
 * `de` = los países cuyos clientes leen ese texto, entre los que venden:
 *   · el país de su sitio (by_country.EC, el perfil de EC…), o
 *   · la bandera de su pieza (`paises`), o
 *   · si no tiene ninguna de las dos, TODOS los países donde vende.
 * Una lista vacía = no lo lee nadie (solo países donde no vende).
 *
 * A PROPÓSITO POR EL LADO SEGURO: el motor, además, deja fuera a una pieza sin bandera cuando
 * otra de su estación sí lleva (`porBanderaDelCliente`), y por tienda y semimodalidad. Eso aquí
 * no se calcula: contar de más un país solo hace que ese texto espere su aprobación; contar de
 * menos cambiaría lo que lee un cliente sin avisar.
 *
 * `hogar` = de qué país es el NÚMERO, para saber dónde guardar una cuenta nueva: el de una cuenta
 * guardada que vaya en el mismo texto o en la burbuja de al lado (el BCP va en una y el Yape en la
 * otra), o el de su sitio.
 */
export interface PaisesDeLosTextos {
  de: (ruta: string[], bandera: string[] | null) => string[];
  hogar: (ruta: string[], texto: string) => string | null;
  /** El país que más textos de pago tiene: el que se propone si no hay otra pista. */
  principal: string | null;
  venden: string[];
}

export function paisesDeLosTextos(cfg: ConfigConCuentas): PaisesDeLosTextos {
  const venden = paisesQueVenden(cfg);
  const porCifras = new Map<string, Set<string>>();
  for (const c of cuentasConocidas(cfg)) {
    const k = soloCifras(c.valor);
    porCifras.set(k, new Set([...(porCifras.get(k) ?? []), c.pais]));
  }
  // Un comodín de cuenta que solo existe en UN país también dice el país (tras pasar el Yape a
  // {{CUENTA_YAPE}}, el BCP de al lado sigue sabiendo que es de Perú).
  const clavesPorPais = new Map<string, Set<string>>();
  for (const pais of Object.keys(cfg.payment_profiles_by_country ?? {}))
    for (const { perfil } of perfilesDelPais(cfg, pais))
      for (const k of Object.keys(perfil.cuentas_por_metodo ?? {})) {
        const kk = k.toLowerCase();
        clavesPorPais.set(kk, new Set([...(clavesPorPais.get(kk) ?? []), pais]));
      }
  const propio = (texto: string): string | null => {
    for (const m of texto.matchAll(NUMERO)) {
      const p = porCifras.get(soloCifras(m[1]));
      if (p?.size === 1) return [...p][0];
    }
    for (const m of texto.matchAll(/\{\{\s*cuenta_([a-z0-9_]+)\s*\}\}/gi)) {
      const p = clavesPorPais.get(m[1].toLowerCase());
      if (p?.size === 1) return [...p][0];
    }
    return null;
  };
  // VECINOS = la misma burbuja o el mismo cuadrito (3 niveles). Más arriba ya se mezclan los textos
  // generales con los de `by_country`, y un texto general acabaría siendo «de Ecuador».
  const vecinos = new Map<string, Map<string, number>>();
  for (const { texto, ruta } of textos(cfg)) {
    const p = paisDeLaRuta(ruta) ?? propio(texto);
    if (!p) continue;
    for (let k = 1; k <= 3 && k < ruta.length; k++) {
      const clave = ruta.slice(0, ruta.length - k).join(".");
      const m = vecinos.get(clave) ?? new Map<string, number>();
      m.set(p, (m.get(p) ?? 0) + 1);
      vecinos.set(clave, m);
    }
  }
  // EL PAÍS DE LOS TEXTOS GENERALES: el que más textos de pago tiene. Un texto sin país lo reciben
  // los clientes de cualquier país, pero en la práctica los del país donde más vende.
  const cuenta = new Map<string, number>();
  for (const m of vecinos.values()) for (const [p, n] of m) cuenta.set(p, (cuenta.get(p) ?? 0) + n);
  const principal = [...cuenta].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
  return {
    principal,
    venden,
    de(ruta, bandera) {
      const lista = paisDeLaRuta(ruta) ? [paisDeLaRuta(ruta)!] : bandera ?? venden;
      return [...new Set(lista)].filter((p) => venden.includes(p)).sort();
    },
    hogar(ruta, texto) {
      const directo = propio(texto) ?? paisDeLaRuta(ruta);
      if (directo) return directo;
      for (let k = 1; k <= 3 && k < ruta.length; k++) {
        const m = vecinos.get(ruta.slice(0, ruta.length - k).join("."));
        if (m?.size) return [...m].sort((x, y) => y[1] - x[1])[0][0];
      }
      return null;
    },
  };
}

export interface Hallazgo {
  tipo: "numero" | "nombre";
  /** Las cifras del número, o el nombre tal cual. */
  clave: string;
  /** Cómo está escrito, y cuántas veces de cada forma. */
  formatos: Array<{ texto: string; veces: number }>;
  veces: number;
  /** Cuántos textos lo llevan. */
  textos: number;
  /** Lo que dice delante, para proponer el nombre de la cuenta. */
  etiqueta: string;
  /** De qué país es el número: el de su cuenta guardada, o el que dicen sus textos (`hogar`). */
  pais: string | null;
  /** Los clientes de qué países leen sus textos (null = textos que no lee nadie). Un texto sin
   *  bandera cuenta en todos los países donde vende. */
  paises: Array<{ pais: string | null; textos: number }>;
  /** La cuenta del dueño en ese país que ya lo tiene (clave y cómo está guardado). */
  cuenta: { clave: string; valor: string } | null;
  /** Otras cuentas guardadas con esas cifras (de usuarios, o la principal del país). */
  tambien: CuentaConocida[];
  lugares: Array<{ donde: string; veces: number }>;
  /** Veces que aparece en textos que NO son de pago (no se tocan). */
  fueraDePago: number;
}

/** Los números (y los nombres del titular) escritos a mano en los textos de pago. */
export function buscarNumerosAMano(cfg: ConfigConCuentas): Hallazgo[] {
  const conocidas = cuentasConocidas(cfg);
  const porCifras = new Map<string, CuentaConocida[]>();
  for (const c of conocidas) porCifras.set(soloCifras(c.valor), [...(porCifras.get(soloCifras(c.valor)) ?? []), c]);
  const paisDe = paisesDeLosTextos(cfg);

  type Acum = Omit<Hallazgo, "formatos" | "lugares" | "etiqueta" | "pais" | "paises" | "cuenta" | "tambien"> & {
    formatos: Map<string, number>;
    lugares: Map<string, number>;
    etiquetas: Map<string, number>;
    paises: Map<string | null, number>;
    hogares: Map<string, number>;
  };
  const acum = new Map<string, Acum>();
  const nuevo = (tipo: Hallazgo["tipo"], clave: string): Acum => ({
    tipo,
    clave,
    veces: 0,
    textos: 0,
    fueraDePago: 0,
    formatos: new Map(),
    lugares: new Map(),
    etiquetas: new Map(),
    paises: new Map(),
    hogares: new Map(),
  });
  const sumar = <K>(m: Map<K, number>, k: K, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
  const sumarLectores = (a: Acum, lectores: string[]) => {
    if (lectores.length === 0) sumar(a.paises, null);
    for (const p of lectores) sumar(a.paises, p);
  };

  // Los nombres del dueño por país (el de leer y el que valida), para encontrarlos escritos a mano.
  const nombres = new Set<string>();
  for (const pais of Object.keys(cfg.payment_profiles_by_country ?? {})) {
    const p = cfg.payment_profiles_by_country?.[pais];
    for (const n of [limpio(p?.nombre_completo), titularDelPerfil(cfg, p)]) if (n.includes(" ") && n.length >= 6) nombres.add(n);
  }

  for (const { texto, ruta, bandera } of textos(cfg)) {
    const dePago = ES_DE_PAGO.test(texto);
    const lectores = dePago ? paisDe.de(ruta, bandera) : [];
    const hogar = dePago ? paisDe.hogar(ruta, texto) : null;
    const vistosEnEste = new Set<string>();
    for (const m of texto.matchAll(NUMERO)) {
      const cifras = soloCifras(m[1]);
      if (cifras.length < 7) continue;
      if (!dePago) {
        if (porCifras.has(cifras)) {
          const a = acum.get(cifras) ?? nuevo("numero", cifras);
          a.fueraDePago++;
          acum.set(cifras, a);
        }
        continue;
      }
      const a = acum.get(cifras) ?? nuevo("numero", cifras);
      a.veces++;
      sumar(a.formatos, m[1]);
      sumar(a.lugares, nombreDelSitio(ruta));
      const etiqueta = etiquetaDeLaLinea(texto, m.index ?? 0);
      if (etiqueta) sumar(a.etiquetas, etiqueta);
      if (!vistosEnEste.has(cifras)) {
        a.textos++;
        sumarLectores(a, lectores);
        // Un texto general sin pista cuenta para el país donde más textos de pago hay.
        const suHogar = hogar ?? paisDe.principal;
        if (suHogar) sumar(a.hogares, suHogar);
        vistosEnEste.add(cifras);
      }
      acum.set(cifras, a);
    }
    if (!dePago) continue;
    for (const nombre of nombres) {
      const veces = texto.split(nombre).length - 1;
      if (!veces) continue;
      const a = acum.get(`nombre:${nombre}`) ?? nuevo("nombre", nombre);
      a.veces += veces;
      a.textos++;
      sumar(a.formatos, nombre, veces);
      sumar(a.lugares, nombreDelSitio(ruta), veces);
      sumarLectores(a, lectores);
      if (hogar) sumar(a.hogares, hogar);
      acum.set(`nombre:${nombre}`, a);
    }
  }

  const fuera: Hallazgo[] = [];
  for (const a of acum.values()) {
    if (a.veces === 0) continue;
    const guardadas = a.tipo === "numero" ? porCifras.get(a.clave) ?? [] : [];
    const paises = [...a.paises].sort((x, y) => y[1] - x[1]).map(([pais, textos]) => ({ pais, textos }));
    // EL NOMBRE es del país cuyo dueño se llama así; el NÚMERO, del de su cuenta guardada, o del que
    // dicen sus textos.
    const delNombre =
      a.tipo === "nombre"
        ? Object.entries(cfg.payment_profiles_by_country ?? {}).find(
            ([, p]) => limpio(p?.nombre_completo) === a.clave || titularDelPerfil(cfg, p) === a.clave
          )?.[0]
        : undefined;
    const pais =
      delNombre ??
      guardadas.find((g) => g.quien === "tú")?.pais ??
      [...a.hogares].sort((x, y) => y[1] - x[1])[0]?.[0] ??
      guardadas[0]?.pais ??
      paisDe.principal;
    const etiqueta = [...a.etiquetas].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "";
    // LA CUENTA DEL DUEÑO EN ESE PAÍS QUE YA LLEVA ESTE NÚMERO: si hay varias (Yape y Plin con el
    // mismo), la que nombra la línea; si ninguna, la primera.
    const deEl = guardadas.filter((g) => g.quien === "tú" && g.pais === pais && g.clave);
    const porNombre = deEl.find((g) => etiqueta.toLowerCase().includes(String(g.clave).toLowerCase()));
    const elegida = porNombre ?? deEl[0];
    fuera.push({
      tipo: a.tipo,
      clave: a.clave,
      formatos: [...a.formatos].sort((x, y) => y[1] - x[1]).map(([texto, veces]) => ({ texto, veces })),
      veces: a.veces,
      textos: a.textos,
      etiqueta,
      pais,
      paises,
      cuenta: elegida ? { clave: String(elegida.clave), valor: elegida.valor } : null,
      tambien: guardadas.filter((g) => !(g.quien === "tú" && g.pais === pais && g.clave === elegida?.clave)),
      lugares: [...a.lugares].sort((x, y) => y[1] - x[1]).map(([donde, veces]) => ({ donde, veces })),
      fueraDePago: a.fueraDePago,
    });
  }
  return fuera.sort((x, y) => (x.tipo === y.tipo ? y.veces - x.veces : x.tipo === "numero" ? -1 : 1));
}

/**
 * QUÉ PASA EN CADA PAÍS SI SE CAMBIA POR EL COMODÍN. Para cada país donde están sus textos: si el
 * comodín da las MISMAS cifras en todas las tiendas («igual», o «solo cambia el formato»), o en qué
 * tiendas daría otra cosa. `cfg` ya debe llevar la cuenta guardada si es nueva.
 */
export interface ResultadoPorPais {
  pais: string | null;
  textos: number;
  /** Mismas cifras (o mismo nombre) en todas las tiendas: se puede pasar sin cambiar lo que lee. */
  igual: boolean;
  /** Las cifras salen igual pero escritas de otra forma en algún texto (espacios). */
  soloFormato: boolean;
  diferencias: Diferencia[];
}

export function queSaleEnCadaPais(cfg: ConfigConCuentas, h: Hallazgo, clave: string, formato: string): ResultadoPorPais[] {
  return h.paises.map(({ pais, textos }) => {
    // Textos que no lee nadie (solo países donde no vende): da igual lo que digan.
    if (!pais) return { pais, textos, igual: true, soloFormato: false, diferencias: [] };
    const p = pais;
    if (h.tipo === "nombre") {
      const diferencias = dondeNoSaleIgual(cfg, p, "nombre", "", h.clave);
      return { pais, textos, igual: diferencias.length === 0, soloFormato: false, diferencias };
    }
    const todas = dondeNoSaleIgual(cfg, p, "cuenta", clave, formato);
    const diferencias = todas.filter((d) => soloCifras(d.sale) !== h.clave);
    const soloFormato = todas.length > diferencias.length || h.formatos.some((f) => f.texto !== formato);
    return { pais, textos, igual: diferencias.length === 0, soloFormato: diferencias.length === 0 && soloFormato, diferencias };
  });
}

// ── LOS CAMBIOS ──────────────────────────────────────────────────────────────

/** Cambia `cuentas_por_metodo` de un sitio sin tocar lo demás. `valor` null = quitarla. */
function conCuenta(sitio: CuentasDeUnSitio | undefined, clave: string, valor: string | null, claveVieja?: string): CuentasDeUnSitio {
  const cuentas = { ...(sitio?.cuentas_por_metodo ?? {}) };
  if (claveVieja && claveVieja !== clave) delete cuentas[claveVieja];
  if (valor === null) delete cuentas[clave];
  else cuentas[clave] = valor;
  return { ...(sitio ?? {}), cuentas_por_metodo: cuentas };
}

/**
 * GUARDA (O CAMBIA, O QUITA) UNA CUENTA DEL DUEÑO EN UN PAÍS, en los mismos sitios donde el
 * editor guarda sus datos —el país y su copia en cada modalidad— y en los usuarios que son él
 * mismo (`mismaPersona`). Así sale igual en todas las tiendas.
 */
export function conCuentaDelPais<T extends ConfigConCuentas>(cfg: T, pais: string, clave: string, valor: string | null, claveVieja?: string): T {
  const yo = new Set(mismaPersona(cfg, pais));
  const capas = { ...(cfg.modality_payment_profiles ?? {}) };
  for (const [modo, porPais] of Object.entries(capas))
    if (porPais?.[pais]) capas[modo] = { ...porPais, [pais]: conCuenta(porPais[pais], clave, valor, claveVieja) };
  return {
    ...cfg,
    payment_profiles_by_country: {
      ...(cfg.payment_profiles_by_country ?? {}),
      [pais]: conCuenta(cfg.payment_profiles_by_country?.[pais], clave, valor, claveVieja),
    },
    modality_payment_profiles: capas,
    cobradores: (cfg.cobradores ?? []).map((c) =>
      yo.has(c.id) ? { ...c, por_pais: { ...(c.por_pais ?? {}), [pais]: conCuenta(c.por_pais?.[pais], clave, valor, claveVieja) } } : c
    ),
  };
}

/**
 * EL FORMATO DE UNA CUENTA («935 286 681» o «935286681»): cambia todas las del dueño en ese país
 * con esas mismas cifras —Yape y Plin suelen ser el mismo número— y su cuenta principal si es ésa.
 */
export function conFormatoDeCuenta<T extends ConfigConCuentas>(cfg: T, pais: string, cifras: string, formato: string): T {
  const yo = new Set(mismaPersona(cfg, pais));
  const arreglar = (s: CuentasDeUnSitio | undefined): CuentasDeUnSitio | undefined => {
    if (!s) return s;
    const cuentas = Object.fromEntries(Object.entries(s.cuentas_por_metodo ?? {}).map(([k, v]) => [k, soloCifras(v) === cifras ? formato : v]));
    return {
      ...s,
      ...(s.cuentas_por_metodo ? { cuentas_por_metodo: cuentas } : {}),
      ...(soloCifras(s.numero_de_cuenta) === cifras ? { numero_de_cuenta: formato } : {}),
    };
  };
  const capas = { ...(cfg.modality_payment_profiles ?? {}) };
  for (const [modo, porPais] of Object.entries(capas)) if (porPais?.[pais]) capas[modo] = { ...porPais, [pais]: arreglar(porPais[pais]) };
  return {
    ...cfg,
    payment_profiles_by_country: { ...(cfg.payment_profiles_by_country ?? {}), [pais]: arreglar(cfg.payment_profiles_by_country?.[pais]) },
    modality_payment_profiles: capas,
    cobradores: (cfg.cobradores ?? []).map((c) => (yo.has(c.id) ? { ...c, por_pais: { ...(c.por_pais ?? {}), [pais]: arreglar(c.por_pais?.[pais]) } } : c)),
  };
}

/** Recorre el contenido y cambia los textos con `cambiar`. Copia solo lo que cambia. */
function cambiarTextos<T>(
  v: T,
  cambiar: (texto: string, ruta: string[], bandera: string[] | null) => string,
  contador: { n: number },
  ruta: string[] = [],
  bandera: string[] | null = null
): T {
  const clave = ruta[ruta.length - 1];
  if (clave && NO_SON_TEXTOS.has(clave)) return v;
  if (typeof v === "string") {
    const nuevo = cambiar(v, ruta, bandera);
    if (nuevo !== v) contador.n++;
    return nuevo as T;
  }
  if (Array.isArray(v)) {
    let cambio = false;
    const fuera = v.map((x, i) => {
      const y = cambiarTextos(x, cambiar, contador, [...ruta, String(i)], bandera);
      if (y !== x) cambio = true;
      return y;
    });
    return (cambio ? fuera : v) as T;
  }
  if (v && typeof v === "object") {
    const suya = banderaDe(v as Record<string, unknown>, bandera);
    let cambio = false;
    const fuera: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const y = cambiarTextos(x, cambiar, contador, [...ruta, k], suya);
      if (y !== x) cambio = true;
      fuera[k] = y;
    }
    return (cambio ? fuera : v) as T;
  }
  return v;
}

/**
 * EN QUÉ TEXTOS SE CAMBIA: solo en los que leen ÚNICAMENTE clientes de países de `solo` (null =
 * los textos que no lee nadie). Un texto sin bandera lo leen todos los países donde vende: se
 * cambia solo si en todos ellos sale igual (o él dijo que sí para ese país).
 */
export interface SoloEn {
  paises: PaisesDeLosTextos;
  solo: Set<string | null>;
}

const loLeenSoloDe = (soloEn: SoloEn | undefined, ruta: string[], bandera: string[] | null): boolean => {
  if (!soloEn) return true;
  const lectores = soloEn.paises.de(ruta, bandera);
  return lectores.length === 0 ? soloEn.solo.has(null) : lectores.every((p) => soloEn.solo.has(p));
};

/** Cambia el número (con esas cifras, escrito como sea) por el comodín, SOLO en los textos de pago. */
export function pasarNumeroAComodin<T>(cfg: T, cifras: string, comodin: string, soloEn?: SoloEn): { cfg: T; textos: number } {
  const contador = { n: 0 };
  const fuera = cambiarTextos(
    cfg,
    (texto, ruta, bandera) =>
      ES_DE_PAGO.test(texto) && loLeenSoloDe(soloEn, ruta, bandera)
        ? texto.replace(NUMERO, (entero, numero: string) => (soloCifras(numero) === cifras ? comodin : entero))
        : texto,
    contador
  );
  return { cfg: fuera, textos: contador.n };
}

/** Cambia el nombre escrito a mano por el comodín, SOLO en los textos de pago. */
export function pasarNombreAComodin<T>(cfg: T, nombre: string, comodin: string, soloEn?: SoloEn): { cfg: T; textos: number } {
  const contador = { n: 0 };
  const fuera = cambiarTextos(
    cfg,
    (texto, ruta, bandera) => (ES_DE_PAGO.test(texto) && loLeenSoloDe(soloEn, ruta, bandera) ? texto.split(nombre).join(comodin) : texto),
    contador
  );
  return { cfg: fuera, textos: contador.n };
}

/** Lo que haría el botón de una fila, ya calculado, para enseñarlo ANTES de pulsarlo. */
export interface Propuesta<T> {
  /** La clave de la cuenta («yape», «bcp_2»…). Vacía en un nombre. */
  clave: string;
  comodin: string;
  /** Cómo saldrá el número (o el nombre). */
  formato: string;
  /** La cuenta no existe y se guardará en `pais` (y en los usuarios que son él mismo). */
  nueva: boolean;
  /** La cuenta existe con otro formato y se guardará con éste. */
  cambiaFormato: boolean;
  pais: string;
  resultados: ResultadoPorPais[];
  /** El contenido con la cuenta ya guardada (o con su formato nuevo), sin tocar ningún texto. */
  conCuenta: T;
}

export function prepararPase<T extends ConfigConCuentas>(
  cfg: T,
  h: Hallazgo,
  elegido: { nombre?: string; formato?: string; pais?: string } = {}
): Propuesta<T> {
  const pais = elegido.pais || h.pais || paisesDeLosTextos(cfg).principal || "PE";
  const formato = elegido.formato ?? h.formatos[0]?.texto ?? h.clave;
  if (h.tipo === "nombre") {
    return {
      clave: "",
      comodin: "{{NOMBRE_COMPLETO}}",
      formato: h.clave,
      nueva: false,
      cambiaFormato: false,
      pais,
      resultados: queSaleEnCadaPais(cfg, h, "", h.clave),
      conCuenta: cfg,
    };
  }
  let clave: string;
  let conCuenta = cfg;
  let nueva = false;
  let cambiaFormato = false;
  if (h.cuenta && h.pais === pais) {
    clave = claveDeCuenta(h.cuenta.clave);
    if (h.cuenta.valor !== formato) {
      conCuenta = conFormatoDeCuenta(cfg, pais, h.clave, formato);
      cambiaFormato = true;
    }
  } else {
    clave = claveLibre(cfg, pais, elegido.nombre || nombrePropuesto(h), h.clave);
    const yaEsta = perfilesDelPais(cfg, pais).some(({ perfil }) => laCuenta(perfil, clave));
    nueva = !yaEsta;
    if (!yaEsta || perfilesDelPais(cfg, pais).some(({ perfil }) => laCuenta(perfil, clave) !== formato)) conCuenta = conCuentaDelPais(cfg, pais, clave, formato);
  }
  return {
    clave,
    comodin: comodinDeCuenta(clave),
    formato,
    nueva,
    cambiaFormato,
    pais,
    resultados: queSaleEnCadaPais(conCuenta, h, clave, formato),
    conCuenta,
  };
}

/**
 * EL BOTÓN: guarda la cuenta (si hace falta) y cambia el número por el comodín SOLO en los textos
 * cuyos lectores son todos de países donde sale igual, o de países que él aprobó (`tambienEn`:
 * «que los clientes de Argentina vean su propia cuenta»).
 */
export function aplicarPase<T extends ConfigConCuentas>(cfg: T, h: Hallazgo, p: Propuesta<T>, tambienEn: Iterable<string | null> = []): { cfg: T; textos: number } {
  const paises = paisesDeLosTextos(cfg);
  const solo = new Set<string | null>([...p.resultados.filter((r) => r.igual).map((r) => r.pais), ...tambienEn]);
  if (solo.size === 0) return { cfg, textos: 0 };
  const r =
    h.tipo === "nombre"
      ? pasarNombreAComodin(p.conCuenta, h.clave, p.comodin, { paises, solo })
      : pasarNumeroAComodin(p.conCuenta, h.clave, p.comodin, { paises, solo });
  // Si no cambió ningún texto, tampoco se guarda la cuenta (ni su formato): nada queda «sin usar».
  return r.textos === 0 ? { cfg, textos: 0 } : r;
}

/** Cambia un comodín por otro en todo el contenido (al renombrar una cuenta). */
export function renombrarComodin<T>(cfg: T, claveVieja: string, claveNueva: string): { cfg: T; textos: number } {
  const viejo = new RegExp(`\\{\\{\\s*cuenta_${claveVieja.replace(/[^a-z0-9_]/gi, "")}\\s*\\}\\}`, "gi");
  const contador = { n: 0 };
  const fuera = cambiarTextos(cfg, (texto) => texto.replace(viejo, comodinDeCuenta(claveNueva)), contador);
  return { cfg: fuera, textos: contador.n };
}

/** Cuántos textos usan ese comodín de cuenta. */
export function textosQueUsan(cfg: unknown, clave: string): number {
  const patron = new RegExp(`\\{\\{\\s*cuenta_${clave.replace(/[^a-z0-9_]/gi, "")}\\s*\\}\\}`, "i");
  let n = 0;
  for (const { texto } of textos(cfg)) if (patron.test(texto)) n++;
  return n;
}

/** Para el aviso amarillo de cada caja de texto: las cifras de las cuentas guardadas → su comodín. */
export function avisosDeNumeros(cfg: ConfigConCuentas): Map<string, string | null> {
  const fuera = new Map<string, string | null>();
  for (const c of cuentasConocidas(cfg)) {
    const cifras = soloCifras(c.valor);
    if (cifras.length < 7) continue;
    const comodin = c.quien === "tú" && c.clave ? comodinDeCuenta(claveDeCuenta(c.clave)) : null;
    if (!fuera.get(cifras)) fuera.set(cifras, comodin);
  }
  return fuera;
}

/** Los números de cuentas guardadas que trae un texto, para el aviso. */
export function numerosGuardadosEn(texto: string, guardados: Map<string, string | null>): Array<{ escrito: string; comodin: string | null }> {
  if (!texto || guardados.size === 0) return [];
  const fuera: Array<{ escrito: string; comodin: string | null }> = [];
  for (const m of texto.matchAll(NUMERO)) {
    const cifras = soloCifras(m[1]);
    if (guardados.has(cifras) && !fuera.some((x) => soloCifras(x.escrito) === cifras)) fuera.push({ escrito: m[1], comodin: guardados.get(cifras) ?? null });
  }
  return fuera;
}
