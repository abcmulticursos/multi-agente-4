"use client";

/**
 * EL LIENZO DE LA VISTA PIZARRA — solo dibuja; lo que cambia, lo cambia el editor.
 *
 * ── LO QUE ÉL PIDIÓ, Y POR QUÉ ESTÁ ASÍ (16/10/2026) ─────────────────────
 *
 * «Las conexiones son el futuro de este proyecto… aquí el rey del proyecto son las conexiones
 * y tienen que quedar bien». Y lo pensó como un novato: «a un usuario no le va a gustar hacer
 * cosas que no sabe, ni algo que no sea intuitivo».
 *
 *   · UN CARRIL POR PAÍS, hacia la derecha, como Sendy. Todos acaban en la misma POSTVENTA.
 *   · SI FALTA UNA FICHA, SE VE: sin intro, el país queda DESCONECTADO del Inicio («ah, qué
 *     raro, aquí está desconectado»); sin un seguimiento, el cable SALTA al siguiente.
 *   · CONECTAR = arrastrar del punto naranja al verde. Por dentro es poner la bandera de ese
 *     país; él no tiene que saberlo. Soltar en el vacío ofrece CREAR ahí una ficha ya
 *     conectada.
 *   · CORTAR = pasar el ratón por el cable y pulsar la «x».
 *   · LOS BOTONES Y CUADRITOS SON RAMAS: cada uno sale de la ficha con su punto naranja y
 *     lleva a su destino (la oferta de 2 opciones, el pago, un mensaje, una persona…).
 *   · CAJAS que él dibuja, estira y borra, detrás de todo, para ordenar a su gusto.
 *   · Lo que mueve se GUARDA con el contenido (Ctrl+S) y se DESHACE con Ctrl+Z, como todo.
 *
 * ESTE ARCHIVO NO DECIDE QUÉ SALE. Recibe las estaciones ya calculadas por
 * `loQueSaleEnLaEstacion` —que tiene su prueba contra el motor— y las dibuja. Cada cambio que
 * él hace aquí se lo pide al editor por `AccionesDelLienzo`, que escribe en el MISMO borrador
 * que los menús.
 *
 * SE CARGA SOLO AL ABRIR LA PIZARRA (con `next/dynamic`).
 */
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  SelectionMode,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  MiniMap,
  NodeResizeControl,
  Position,
  ReactFlow,
  useEdgesState,
  useNodes,
  useNodesState,
  useStore,
  ViewportPortal,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { leerCorte, type CorteDeRuta } from "@/lib/editor/lee-pizarra";

// ══ EL MODELO: lo único que este archivo sabe del bot ═══════════════════════════

export type TipoDePieza = "intro" | "ob" | "seguimiento" | "upsell" | "entrega";

/** «propia», «general», «prestada», «falta», «vacia» — ver `EstadoDelPais`. */
export type EstadoDeFila = "propia" | "general" | "prestada" | "falta" | "vacia";

export interface ResumenDeBurbuja {
  tipo: "texto" | "imagen" | "video" | "audio" | "documento";
  texto: string;
  espera: number;
}

/** UN BOTÓN O UN CUADRITO DE DECISIÓN: una rama que sale de la ficha. */
export interface RamaDePieza {
  /** Único dentro de la ficha: «burbuja:boton|cuadrito:id». */
  id: string;
  etiqueta: string;
  tipo: "boton" | "cuadrito";
  /** La acción guardada; «» = solo su mensaje. */
  accion: string;
  /** Burbujas de su mensaje. */
  mensajes: number;
  /** Un cuadrito sin palabras clave: el bot no lo activa nunca. */
  sinPalabras?: boolean;
}

export interface PiezaDePizarra {
  /** SU PESO EN EL SORTEO (17/10/2026). 1 si no lo trae. */
  peso?: number;
  /** Los anuncios que tiene puestos (sus nombres), si el bot los usa en esta ficha. */
  anunciosNombres?: string[];
  /** ¿El bot dirige esta ficha por anuncio? Intros y seguimientos sí; oferta y upsell no. */
  admiteAnuncios?: boolean;
  id: string;
  tipo: TipoDePieza;
  titulo: string;
  estado: "juega" | "apagada" | "fuera";
  motivo?: string;
  paises: string[];
  todasLasTiendas: boolean;
  otrasTiendas: string[];
  semimodalidad?: string;
  /** Hecha para otra semimodalidad que la que se está viendo: no se dibuja suelta aquí. */
  deOtraSemi?: boolean;
  /** SU CAMINO (18/10/2026). Vacío = el principal. El cliente que entra por la intro de un
   *  camino recibe los pasos de ese camino. Ver `etiqueta-de-camino.ts`. */
  camino?: string;
  /** TODOS SUS CAMINOS: el suyo y los que también pasan por ella. "" = el principal. */
  caminos?: string[];
  burbujas: number;
  anuncios: number;
  /** SOLO LAS ENCENDIDAS: «los off que no lo muestre». */
  resumen: ResumenDeBurbuja[];
  ramas: RamaDePieza[];
  editable: boolean;
}

export interface FilaDeEstacion {
  clave: string;
  etiqueta: string;
  estado: EstadoDeFila;
  piezas: string[];
  /** LAS APAGADAS DE ESTE PAÍS (20/10/2026): no salen, pero se dibujan en su sitio con sus cables,
   *  tenues («sin rosca 1, la 2 no funciona»). Solo pizarra: nada del bot las cuenta. */
  apagadas?: string[];
}

export interface EstacionDePizarra {
  id: string;
  tipo: TipoDePieza;
  titulo: string;
  cuando?: string;
  filas: FilaDeEstacion[];
  siQuedaVacia?: string;
  piezas: string[];
}

export interface ModeloDePizarra {
  estaciones: EstacionDePizarra[];
  piezas: PiezaDePizarra[];
  postventa?: {
    entregas: Array<{ id: string; puesto?: "unico" | "basico" | "full"; nombre: string; resumen: ResumenDeBurbuja[] }>;
    regalo: {
      encendido: boolean;
      /** Esta tienda tiene su propio regalo (17/10/2026); si no, es el de todas. */
      deEstaTienda?: boolean;
      resumen: ResumenDeBurbuja[];
      /** Las ramas del regalo (16/10/2026): «si dice sí se entrega, si dice no se agradece». */
      acepta?: string;
      noQuiere?: string;
      /** Los botones y cuadritos de sus burbujas. */
      ramas?: RamaDePieza[];
      /** Lo que se le manda al aceptar: el enlace para comentar. */
      pedido?: ResumenDeBurbuja[];
      pedidoEditable?: boolean;
      /** Lo que se le manda cuando dice que comentó. */
      premio?: string;
      /** Lo que se le dice si no lo quiere. */
      despedida?: string;
    };
    /** El cajón «Entrega pago aprobado» del CANAL está encendido: pisa la de TODAS las fichas. */
    entregaDelCanal?: boolean;
    /** De dónde salen los datos de pago, dicho para él. */
    pago?: string;
    /** Lo mismo, con quién cobra de verdad en cada país (su clave → su texto). */
    pagoPorPais?: Record<string, string>;
    /** EL UPSELL 1: su producto, su entrega y sus botones Sí / No. `nativos`: «Preguntar con
     *  botones» encendido; si no, el sí y el no se ESCRIBEN (el bot los detecta igual). */
    upsell?: { entregaId: string; nombre: string; entrega: ResumenDeBurbuja[]; si: string; no: string; nativos?: boolean };
    /** El upsell 1 APAGADO, con su producto guardado (19/10/2026). Sin `upsell`. */
    upsellApagado?: { nombre: string };
    /** LOS UPSELLS EN FILA, detrás del 1, cada uno con su entrega. Los apagados también. */
    enFila?: Array<{
      /** Su lugar en la fila guardada. */
      puesto?: number;
      entregaId: string;
      productoId?: string;
      nombre: string;
      minutos?: number;
      encendido?: boolean;
      entrega: ResumenDeBurbuja[];
      aviso?: string;
    }>;
    /** Los productos que se pueden poner en la fila. */
    paraLaFila?: Array<{ id: string; nombre: string }>;
    /** Los productos que se pueden elegir como upsell 1, cuando la tienda no tiene ninguno. */
    productosParaElUpsell?: Array<{ id: string; nombre: string }>;
    /** El regalo pregunta con botones nativos. */
    regaloConBotones?: boolean;
  };
}

type Punto = { x: number; y: number };

/** UNA CAJA QUE ÉL DIBUJA, detrás de todo. */
export interface CajaDePizarra {
  id: string;
  x: number;
  y: number;
  ancho: number;
  alto: number;
  titulo: string;
}

/** DÓNDE DEJÓ CADA COSA, por tienda y canal. Viaja con el contenido. */
export interface DisposicionDePizarra {
  posiciones: Record<string, { x: number; y: number }>;
  /** Ausente = todavía no tocó ninguna: salen las de cada país. [] = las borró todas. */
  cajas?: CajaDePizarra[];
  /** Los caminos que agregó con «+ País» antes de conectarles nada. */
  paises?: string[];
  /** Los saltos que dibujó él: «país|de|a». El bot ya salta; esto solo lo dibuja. */
  puentes?: string[];
  /** Los fondos de país que él borró: no vuelven solos. */
  sinFondo?: string[];
  /** Las fichas sueltas que él quiere VER en la pizarra; las demás, en «Fichas guardadas». */
  visibles?: string[];
  /** Los cables entre copias SUELTAS de un grupo pegado: «de|a». Ver `lee-pizarra.ts`. */
  enlaces?: string[];
  /** Las fichas «eliminadas» que no se podían quitar sin correr a las de detrás: archivadas. */
  archivadas?: string[];
  /** Los países que él quitó de esta pizarra (19/10/2026). «+ País» los devuelve. */
  quitados?: string[];
  /** Dónde van los recuadros de los botones de una copia, respecto a su ficha. Ver `lee-pizarra.ts`. */
  recuadros?: Record<string, Array<Punto | null>>;
  /** LOS CABLES QUE ÉL CURVÓ A MANO (19/10/2026): por id de cable, cuánto se corrió su punto
   *  medio respecto al de siempre. Solo pizarra. */
  curvas?: Record<string, Punto>;
  /** LO PUESTO «COMÚN» EN OTRO PAÍS Y AÚN SIN CONECTAR (20/10/2026): «país|ficha|grupo». «Nada
   *  debe conectar automáticamente»: se ve tenue en ese país hasta que él le tira el cable. El
   *  grupo junta las fichas de una misma cajita de seguimientos. Solo pizarra. */
  comunes?: string[];
  /** LOS BOTONES DE UNA COPIA QUE ESPERAN SU CABLE (20/10/2026): «ficha|rama». Al pegar o duplicar
   *  sus botones conservan su acción en el bot, pero la pizarra no dibuja el cable hasta que él lo
   *  tira. Solo pizarra. */
  ramasPorConectar?: string[];
  /** LOS CABLES DE BOTONES QUE ÉL CORTÓ (20/10/2026): «ficha|rama». «No me puedes cambiar una
   *  función al cortar el cable». Cortar no cambia el botón en el bot: su cable deja de dibujarse
   *  hasta que él lo vuelve a tirar. Solo pizarra. */
  cortados?: string[];
  /** LAS FICHAS QUE ÉL TENÍA APAGADAS AL DESCONECTARLAS (20/10/2026): al volver a conectarlas
   *  siguen apagadas (antes volvían encendidas). Ids de sub pestaña. Solo pizarra. */
  apagadas?: string[];
  /** LOS PAÍSES EN REVISIÓN (20/10/2026): no venden, pero se ven normales. Solo pizarra. */
  revision?: string[];
  /** LAS QUE ÉL APAGÓ DESDE LA PIZARRA (20/10/2026): se quedan en su sitio, con sus cables y
   *  tenues. Las apagadas viejas no se dibujan. Ids de sub pestaña. Solo pizarra. */
  quedanApagadas?: string[];
  /** EL PLANO DE CABLES: LOS CORTES (20/10/2026): «si yo corto la línea principal inicial,
   *  ningún poste se desconecta». Ver `CorteDeRuta`. Solo pizarra. */
  cortesDeRuta?: string[];
}


/** A DÓNDE PUEDE LLEVAR UNA RAMA. Son las acciones que el bot YA tiene; no se inventa ninguna. */
export type DestinoDeRama =
  | "mensaje"
  | "show_order_bump"
  | "show_payment"
  | "choose_basico"
  | "choose_combo"
  | "choose_upsell"
  | "decline_upsell"
  | "accept_gift"
  | "decline_gift"
  | "claim_gift"
  | "human";

export const DESTINOS: Array<{ valor: DestinoDeRama; icono: string; texto: string }> = [
  { valor: "mensaje", icono: "💬", texto: "Solo su mensaje" },
  { valor: "show_order_bump", icono: "🟪", texto: "Oferta de 2 opciones" },
  { valor: "show_payment", icono: "💳", texto: "Métodos de pago" },
  { valor: "choose_basico", icono: "🛒", texto: "Elige el BÁSICO" },
  { valor: "choose_combo", icono: "🛒", texto: "Elige el FULL" },
  { valor: "choose_upsell", icono: "🛒", texto: "Elige el UPSELL" },
  { valor: "decline_upsell", icono: "🛒", texto: "Rechaza el UPSELL (al regalo)" },
  { valor: "accept_gift", icono: "🎁", texto: "Acepta el regalo" },
  { valor: "decline_gift", icono: "🎁", texto: "Rechaza el regalo" },
  { valor: "claim_gift", icono: "🎁", texto: "Entregar el regalo" },
  { valor: "human", icono: "🙋", texto: "Pasar a una persona" },
];

/** «burbuja:boton|cuadrito:id» → el número de su burbuja. */
export function burbujaDeLaRama(ramaId: string): number | undefined {
  const n = Number(ramaId.split(":")[0]);
  return Number.isFinite(n) ? n : undefined;
}

export function destinoDeLaRama(r: RamaDePieza): { icono: string; texto: string } {
  if (!r.accion || r.accion === "send_steps") {
    return { icono: "💬", texto: r.mensajes > 0 ? `Mensaje · ${r.mensajes} burbuja(s)` : "Mensaje vacío" };
  }
  // UN CUADRITO PUEDE HACER LAS DOS COSAS: primero sus burbujas y después la acción. Se dice,
  // porque «Elige el BÁSICO» a secas parecía que le faltaba algo (16/10/2026).
  const conMensaje = r.mensajes > 0 ? "💬 + " : "";
  if (r.accion === "send_payment_method") return { icono: `${conMensaje}💳`, texto: "Datos de un método de pago" };
  const d = DESTINOS.find((x) => x.valor === r.accion);
  return d ? { icono: `${conMensaje}${d.icono}`, texto: d.texto } : { icono: "❔", texto: r.accion };
}

/** Lo que se puede crear al soltar un cable en el vacío. */
export type LoQueSeCrea =
  | { tipo: "intro" }
  | { tipo: "ob" }
  | { tipo: "upsell" }
  | { tipo: "seguimiento"; indice: number }
  | { tipo: "seguimiento-nuevo" };

/** Lo que el lienzo le pide al editor. Cada una escribe en el borrador de siempre. */
export interface AccionesDelLienzo {
  /** Abre el cajón ENTERO, con todas sus burbujas. */
  /** `burbuja`: la que se quiere ver al abrir (la de un botón o cuadrito). `pais`: el del
   *  camino desde el que se abre, para que la vista previa enseñe SUS precios. */
  abrir: (piezaId: string, burbuja?: number, pais?: string) => void;
  /** Quitarla de su lista (con su Ctrl+Z). */
  eliminar: (piezaId: string) => void;
  /** `desde`: la sub pestaña de la que sale el cable; su salto queda dibujado. */
  conectar: (piezaId: string, pais: string, desde?: string) => void;
  /** Conectarla a varios países en UN paso (un solo Ctrl+Z). */
  conectarATodos: (piezaId: string, paises: string[]) => void;
  /** `dondeQueda`: la ficha cortada se queda ahí, suelta y tenue —no desaparece—. */
  desconectar: (piezaId: string, pais: string, dondeQueda?: Punto) => void;
  alternar: (piezaId: string) => void;
  /** Con país: la copia nace ya conectada a ese país. Sin él, nace suelta en `junto`. */
  duplicar: (piezaId: string, paraPais?: string, junto?: Punto, recuadros?: Array<Punto | null>) => void;
  /** Sacar una ficha de «Fichas guardadas» a la pizarra, o devolverla. */
  mostrar: (piezaId: string, donde: Punto) => void;
  ocultar: (piezaId: string) => void;
  /** `yaPreguntado`: la pizarra ya avisó del cambio; no se vuelve a preguntar. */
  cambiarRama: (piezaId: string, ramaId: string, destino: DestinoDeRama, yaPreguntado?: boolean) => void;
  abrirRama: (piezaId: string, ramaId: string) => void;
  crearConectada: (que: LoQueSeCrea, pais: string, donde?: Punto) => void;
  cambiarDisposicion: (d: DisposicionDePizarra) => void;
  /** Los seguimientos del canal, para el menú de crear. `minutos`: desde el 1.er mensaje. */
  seguimientos: Array<{ indice: number; nombre: string; minutos?: number }>;
  /** LOS TIEMPOS EN SU TARJETA (17/10/2026). Upsell 1: minutos desde la entrega. Regalo:
   *  segundos de silencio. Los dos son uno para todas las tiendas. */
  tiempos?: { upsell?: number; regalo?: number };
  cambiarTiempo?: (que: "upsell" | "regalo" | number, valor: number) => void;
  /** ▶ VER RECORRIDO de un país (17/10/2026): el visor de siempre, de esta tienda y ese país. */
  verRecorrido?: (pais: string) => void;
  /** EL PRODUCTO DEL UPSELL 1 DE ESTA TIENDA, elegido desde su tarjeta (17/10/2026). */
  elegirUpsell?: (productoId: string) => void;
  /** Lo contrario: esta tienda deja de ofrecer el upsell 1 (17/10/2026). */
  quitarUpsell?: () => void;
  /** EL PESO Y LOS ANUNCIOS DE UNA FICHA, desde su tarjeta (17/10/2026). */
  cambiarPeso?: (piezaId: string, peso: number) => void;
  abrirAnuncios?: (piezaId: string) => void;
  /** COPIAR Y PEGAR (17/10/2026): copias sueltas en `donde`, con sus cables entre ellas
   *  (`enlaces`, por posición en la lista). Devuelve los ids de las copias. */
  pegar?: (items: Array<{ piezaId: string; donde: Punto; recuadros?: Array<Punto | null> }>, enlaces: Array<[number, number]>) => string[];
  /** Cortar el cable entre dos copias sueltas. */
  quitarEnlace?: (de: string, a: string) => void;
  /** UN CABLE ENTRE DOS FICHAS SUELTAS (18/10/2026): quedan en grupo y en el mismo camino. */
  enlazar?: (desdeId: string, haciaId: string) => void;
  /** Cortar el cable de un camino a una ficha de varios caminos: sale de ESE camino. */
  quitarDelCamino?: (piezaId: string, camino: string) => void;
  /** Cortar un cable que él dibujó entre dos fichas: se va ESE cable y nada más. */
  quitarPuente?: (pais: string, desdeId: string, haciaId: string) => void;
  /** Encender o apagar el upsell 1 de esta tienda sin perder su producto. */
  alternarUpsell1?: () => void;
  /** Abrir el gestor de un cajón (regalo, upsells), en el país desde el que se abrió. */
  abrirGestor?: (cual: "regalo" | "upsells" | "cobro" | "seguimientos", pais: string, camino?: string, soloEstas?: string[]) => void;
  /** Encender o apagar el regalo (uno solo para todo el bot). Pide confirmación. */
  alternarRegalo?: (encender: boolean) => void;
  /** Encender o apagar los upsells de esta tienda desde su cable. Pide confirmación. */
  alternarUpsells?: (encender: boolean) => void;
  /** Quitar un país de la pizarra: sus fichas se desconectan de él y quedan sueltas en `sitios`. */
  quitarPais?: (pais: string, sitios: Record<string, Punto>, piezasDeLaFila: string[]) => void;
  /** «Vender en este país» del menú: ¿vende? (el mismo interruptor, para el Inicio del país). */
  ventaDelPais?: (pais: string) => boolean;
  /** Encender o apagar «Vender en este país». */
  alternarVentaDelPais?: (pais: string) => void;
  /** Poner un cable suyo que solo se dibuja («país|de|a»), p. ej. el de «Quiere comprar». */
  ponerPuente?: (pais: string, desdeId: string, haciaId: string) => void;
  /** Cortar el cable de un camino que llega a una ficha: se va ESE cable; lo de detrás queda. */
  cortarCable?: (haciaId: string, pais: string, camino: string, desdeId?: string) => void;
  /** DELETE (17/10/2026): eliminar las fichas elegidas, con una sola pregunta. */
  eliminarVarias?: (piezaIds: string[], soloDeSuPais?: Array<{ piezaId: string; pais: string }>) => void;
  /** ¿La tienda ofrece la oferta de 2 opciones? */
  conOferta: boolean;
  /** Los botones NATIVOS (upsell, regalo) no viven en una ficha: se abre su menú. */
  irAlMenu?: (menu: "upsell" | "regalo") => void;
  /** LOS UPSELLS EN FILA DE ESTA TIENDA (17/10/2026). `k` = su lugar en la fila. */
  fila?: {
    agregar: (productoId: string) => void;
    alternar: (k: number) => void;
    quitar: (k: number) => void;
    minutos: (k: number, minutos: number) => void;
    /** Subirlo o bajarlo un puesto en la fila. */
    mover?: (k: number, haciaArriba: boolean) => void;
    /** Cambiar el producto de ese puesto. */
    cambiar?: (k: number, productoId: string) => void;
  };
  /** «USAR TAMBIÉN EN…» SIN CONECTAR (20/10/2026): la misma ficha (o la cajita entera) queda en
   *  esos países, tenue y sin cable, hasta que él la conecta. `grupo`: el de su cajita. */
  ponerComun?: (piezaIds: string[], paises: string[], grupo: string) => void;
  /** Lo contrario: quitarla de ese país (la ficha no se borra). */
  quitarComun?: (pais: string, piezaIds: string[]) => void;
  /** Conectar lo común a ese país con UN cable: todas sus fichas a la vez (un solo Ctrl+Z). */
  conectarComunes?: (piezaIds: string[], pais: string, desde?: string) => void;
  /** El cable de un botón copiado, tirado adonde ya lleva: deja de esperar (no cambia el botón). */
  confirmarCable?: (piezaId: string, ramaId: string) => void;
  /** EL INICIO EN REVISIÓN (20/10/2026): no vende (como apagado) pero se ve normal. Solo pizarra. */
  enRevision?: (pais: string) => boolean;
  alternarRevision?: (pais: string) => void;
  /** Cortar el cable de un botón: solo pizarra, el botón no cambia en el bot. */
  cortarCableDeBoton?: (piezaId: string, ramaId: string) => void;
  /** LAS RUTAS DE UN PAÍS CON SUS NÚMEROS (20/10/2026): clientes que entraron y cuántos pagaron.
   *  Vacío si el país tiene una sola ruta. Solo lectura. */
  numerosDeLasRutas?: (pais: string) => Array<{ ruta: string; clientes: number; ventas: number }>;
  /** Crear desde un gestor: sin ventana vieja, en el camino del cajón. Devuelve el id nuevo. */
  crearEnGestor?: (que: LoQueSeCrea, pais: string, camino: string) => string | null;
  /** Duplicar una versión de seguimiento desde su gestor (mismo país y camino). */
  duplicarEnGestor?: (piezaId: string, pais: string, camino: string) => string | null;
}

// ══ COLORES Y TEMA ═════════════════════════════════════════════════════════════

const COLOR: Record<TipoDePieza, { banda: string; borde: string; trazo: string }> = {
  intro: { banda: "bg-sky-600", borde: "border-sky-500", trazo: "#0284c7" },
  ob: { banda: "bg-violet-600", borde: "border-violet-500", trazo: "#7c3aed" },
  seguimiento: { banda: "bg-orange-500", borde: "border-orange-400", trazo: "#f97316" },
  upsell: { banda: "bg-amber-500", borde: "border-amber-400", trazo: "#f59e0b" },
  entrega: { banda: "bg-emerald-600", borde: "border-emerald-500", trazo: "#059669" },
};
const ROJO = "#dc2626";
/** Los cables entre copias sueltas de un grupo pegado: solo pizarra. */
const GRIS_DEL_GRUPO = "#64748b";
const AZUL_RAMA = "#6366f1";
/** Arrastrar la burbuja entera hasta un punto verde para conectarla (19/10). Apagado el 20/10:
 *  ahora el cable sale de su punto y la burbuja se queda en su sitio. */
const CONECTAR_ARRASTRANDO_LA_BURBUJA: boolean = false;

/**
 * EL OSCURO ES SOLO EL FONDO (16/10/2026). Lo pidió mirando Sendy: el lienzo oscuro y las
 * fichas BLANCAS, con su contenido legible. Por eso aquí no se toca ningún color de las fichas.
 */
const TEMA = {
  // EL FONDO DE CADA PAÍS CON CONTRASTE (17/10/2026): al 4 % «sigue muy atenuado, hazlo más
  // blanco… que haya más contraste, yo no veo que haya cambiado nada».
  claro: { fondo: "#f4f6fa", puntos: "#c3cad6", caja: "rgba(15,23,42,0.08)", bordeCaja: "rgba(15,23,42,0.18)", tituloCaja: "#334155" },
  oscuro: { fondo: "#15161a", puntos: "#34373f", caja: "rgba(255,255,255,0.13)", bordeCaja: "rgba(255,255,255,0.22)", tituloCaja: "#f1f5f9" },
};

import { banderaDe } from "./banderas";
export { banderaDe };

const ICONO: Record<ResumenDeBurbuja["tipo"], string> = {
  texto: "💬", imagen: "🖼️", video: "🎬", audio: "🎤", documento: "📄",
};

function useTemaDelEditor(): "claro" | "oscuro" {
  const leer = () =>
    typeof document !== "undefined" && document.documentElement.dataset.tema === "oscuro" ? "oscuro" : "claro";
  const [tema, setTema] = useState<"claro" | "oscuro">(leer);
  useEffect(() => {
    const obs = new MutationObserver(() => setTema(leer()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema"] });
    return () => obs.disconnect();
  }, []);
  return tema;
}

// ══ CONTEXTO: las acciones llegan a los nodos sin rehacer la pizarra ═══════════

const Contexto = createContext<{
  acciones: AccionesDelLienzo;
  menu: (x: number, y: number, contenido: ContenidoDelMenu) => void;
  avisar: (t: string) => void;
  /** «Duplicar aquí al lado», desde el ícono de la franja. */
  clonar?: (nodoId: string, piezaId: string) => void;
  /** Los cables curvados a mano, y cómo curvar o enderezar uno (null = enderezar). */
  curvas?: Record<string, Punto>;
  curvar?: (cableId: string, corrimiento: Punto | null) => void;
} | null>(null);

type ContenidoDelMenu =
  | { tipo: "pieza"; piezaId: string; pais: string; nodoId: string; suelta: boolean }
  | { tipo: "inicio"; pais: string; etiqueta: string }
  | { tipo: "cable"; cableId: string }
  | { tipo: "comun"; pais: string; piezaIds: string[] }
  | { tipo: "cajon"; pais: string; piezaIds: string[]; grupo: string }
  | { tipo: "rama"; piezaId: string; ramaId: string }
  | { tipo: "crear"; pais: string; donde?: Punto }
  | { tipo: "destino"; piezaId: string; ramaId: string }
  | { tipo: "upsell"; productos: Array<{ id: string; nombre: string }>; conProducto: boolean };

// ══ LOS PUNTOS DE CONEXIÓN: verde entra, naranja sale, siempre a los lados ═════

/** «Que las conexiones sean laterales, no arriba ni abajo, para que haya armonía». */
// UN 50 % MÁS GRANDES (19/10/2026): «haz un poco más grandes los puntos, por lo menos un 50 %».
const PUNTO_VERDE = "!h-[21px] !w-[21px] !border-2 !border-white !bg-emerald-500";
const PUNTO_NARANJA = "!h-[21px] !w-[21px] !border-2 !border-white !bg-orange-500";
/** El de «Quiere comprar / pagar» (19/10/2026): rosado como su fila, siempre. Sin cable lleva
 *  el aro que pide cable (`punto-pide-cable`), no rojo: el rojo es «a esta ficha no llega nadie». */
const PUNTO_ROSADO = "!h-[21px] !w-[21px] !border-2 !border-white !bg-pink-500";
const ARO_ROSADO = { "--aro": "rgba(236, 72, 153, 0.35)" } as React.CSSProperties;
const ARO_NARANJA = { "--aro": "rgba(249, 115, 22, 0.35)" } as React.CSSProperties;

// ══ LOS NODOS ══════════════════════════════════════════════════════════════════

type DatosDeInicio = {
  /** El país de este Inicio (uno por país desde el 19/10/2026). */
  carril: { clave: string; etiqueta: string; sinIntro: boolean };
  /** ¿Vende en este país? (el «Vender en este país» del menú). Sin país, no lleva interruptor. */
  vende?: boolean;
  /** Qué les pasa a los clientes de un país que no tiene fila (ya no se dibuja). */
  otros?: string;
  /** Sus rutas con clientes y ventas, si tiene más de una. */
  rutas?: Array<{ ruta: string; clientes: number; ventas: number }>;
  /** EN REVISIÓN (20/10/2026): no vende, pero se ve normal para trabajarlo. Solo pizarra. */
  revision?: boolean;
};
/** Una fila rosada «de palabra»: lo que el cliente dice sin pulsar un botón. */
type FilaDePalabra = {
  /** El id de su punto: «palabra», o «palabra:basico» / «palabra:full». */
  id: string;
  texto: string;
  /** Los únicos sitios donde su cable se puede soltar (adonde el bot va de verdad). `clave` es
   *  lo que se guarda en el cable; `nodo`, adónde se dibuja. */
  destinos: Array<{ clave: string; nodo: string }>;
  /** Su cable ya lo puso él. Si no, el punto lleva el aro que lo pide. */
  conectada: boolean;
};
type DatosDePieza = {
  pieza: PiezaDePizarra;
  cuando?: string;
  pais: string;
  estacion: string;
  suelta?: boolean;
  /** No le llega ningún cable (18/10/2026): punto rojo, sin reconectar nada. */
  sinEntrada?: boolean;
  /** Las filas rosadas «de palabra»: «Quiere comprar / pagar», o una «Elige X» por producto.
   *  Ver `filasDePalabra`. */
  palabras?: FilaDePalabra[];
  /** «Falta conectar»: el ⚠ de su franja y lo que explica al pasar el ratón. */
  aviso?: string;
  /** «COMÚN N»: la MISMA sub pestaña en varios países lleva el mismo número en todos. */
  comun?: number;
  /** Su parte del sorteo en ESTE país y esta columna (0-100), si hay más de una. */
  porcentaje?: number;
  /** Cómo la reparte el bot por anuncio, dicho corto. */
  notaDeAnuncio?: string;
  /** LA MISMA FICHA PUESTA «COMÚN» EN OTRO PAÍS, AÚN SIN CONECTAR (20/10/2026). No es una copia:
   *  al conectarla, ese país usa la misma. Hasta entonces el bot no la manda ahí. */
  comunPendiente?: { pais: string; grupo: string };
  /** LOS BOTONES DE UNA COPIA QUE ESPERAN SU CABLE (20/10/2026): «el usuario no debe ver una
   *  conexión automática… tendrá que conectarlo de manera manual». El bot sí los lleva; la
   *  pizarra no dibuja su cable hasta que él lo tira. Ids de rama. */
  ramasSinCable?: string[];
  /** No le llega nada (detrás de una apagada, de un cable cortado o de un país apagado): tenue. */
  cadenaApagada?: boolean;
  /** Él la desconectó de este país (el plano): se dibuja en su sitio, con sus cables. */
  desconectada?: boolean;
};

/**
 * EL PESO Y LOS ANUNCIOS, AL PIE DE LA TARJETA (17/10/2026): «en Perú voy a testear con varias
 * intros… y varios seguimientos… cada uno con su peso» y «colocar ads en las fichas». Escriben en
 * los mismos campos que los menús.
 */
function PesoYAnuncios({ p, porcentaje, nota }: { p: PiezaDePizarra; porcentaje?: number; nota?: string }) {
  const ctx = useContext(Contexto);
  if (!ctx?.acciones.cambiarPeso) return null;
  const peso = p.peso ?? 1;
  return (
    // Doble clic aquí es para el peso, no para abrir la ficha.
    <div className="nodrag flex flex-wrap items-center gap-1.5 border-t border-slate-200 px-2 py-1 text-[11px] text-slate-700" onDoubleClick={(e) => e.stopPropagation()}>
      <label className="flex items-center gap-1 font-semibold" title="Cuántas partes del sorteo se lleva entre las de su columna en este país">
        ⚖ peso
        <input
          key={peso}
          type="number"
          min={1}
          defaultValue={peso}
          onBlur={(e) => {
            const n = Math.max(1, Math.floor(Number(e.target.value) || 1));
            if (n !== peso) ctx.acciones.cambiarPeso?.(p.id, n);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="w-12 rounded border border-slate-300 px-1 py-0.5 font-normal"
        />
        {porcentaje !== undefined && <span className="font-bold text-sky-700">· {porcentaje}%</span>}
      </label>
      {/* SOLO SI TIENE ANUNCIOS, Y CORTO (17/10/2026): «eso me malogra el visor y me confunde».
          Los nombres, al pasar el ratón; se ponen y se quitan dentro de la ficha (doble clic). */}
      {p.admiteAnuncios && (p.anunciosNombres ?? []).length > 0 && (
        <button
          type="button"
          onClick={() => ctx.acciones.abrir(p.id)}
          className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900"
          title={`Anuncios: ${(p.anunciosNombres ?? []).join(", ")}. ${nota ?? ""} Clic para verlos o cambiarlos dentro de la ficha.`}
        >
          📣 {(p.anunciosNombres ?? []).length === 1 ? "1 anuncio" : `${(p.anunciosNombres ?? []).length} anuncios`}
        </button>
      )}
    </div>
  );
}
type DatosDePrestada = { titulo: string; deDonde: string; pais: string; estacion: string; texto: string };
type DatosDeDestino = {
  piezaId: string;
  ramaId: string;
  icono: string;
  texto: string;
  esMensaje: boolean;
  /** Sigue hasta el Pago (18/10/2026): su punto de salida, para el cable. */
  alPago?: boolean;
  /** Arrastrado encima de un punto verde: al soltar se conecta, así que ya no se ve. */
  uniendose?: boolean;
  /** «Mensaje vacío»: el botón no hace nada; su punto pide cable. */
  vacio?: boolean;
};
type DatosDeCaja = {
  caja: CajaDePizarra;
  tema: "claro" | "oscuro";
  alCambiar: (c: CajaDePizarra) => void;
  /** Elegida con un clic en su título: Delete la borra. */
  elegida: boolean;
  alElegir: () => void;
  /** El fondo de un país: lleva su «▶ Ver recorrido». */
  pais?: string;
  alVerRecorrido?: () => void;
};

/**
 * EL INICIO DE UN PAÍS (19/10/2026): «quería el INICIO separado… con capacidad de tenerlos
 * encendidos y apagados; tenerlos apagados no significa que no pueda hacer conexiones». Uno por
 * país, al lado de su recuadro, y se mueve como cualquier ficha. Su interruptor es EL MISMO
 * «Vender en este país» del menú (no toca el motor): apagado, el bot no vende en ese país en
 * ninguna tienda, y a quien escriba le contesta que no hay venta y lo pasa a humano. Sus cables
 * se pueden poner igual.
 */
function NodoDeInicio({ data }: NodeProps<Node<DatosDeInicio>>) {
  const ctx = useContext(Contexto);
  const c = data.carril;
  const vende = data.vende;
  // CUATRO COLORES (20/10/2026): verde = vende · azul = en revisión (no vende, se ve normal) ·
  // gris = apagado (no vende, el país se ve tenue) · anaranjado = sin intro conectada. «Ese aviso de
  // SIN INTRO NO AVANZAN está de más… con solo ver el inicio del país».
  const desconectado = !!c.sinIntro;
  const estado: "venta" | "revision" | "apagado" = vende === false ? (data.revision ? "revision" : "apagado") : "venta";
  const color = desconectado
    ? { borde: "border-orange-400", banda: "bg-orange-500" }
    : estado === "venta"
      ? { borde: "border-emerald-500", banda: "bg-emerald-600" }
      : estado === "revision"
        ? { borde: "border-sky-500", banda: "bg-sky-600" }
        : { borde: "border-slate-400", banda: "bg-slate-500" };
  return (
    <div
      className={`w-[200px] rounded-xl border-2 bg-white shadow-lg ${color.borde}`}
      title={desconectado ? "Desconectado: este país no tiene ninguna intro conectada. Arrastra el punto naranja hasta una intro." : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (c.clave) ctx?.menu(e.clientX, e.clientY, { tipo: "inicio", pais: c.clave, etiqueta: c.etiqueta });
      }}
    >
      <div className={`rounded-t-[10px] px-3 py-2 text-white ${color.banda}`}>
        <div className="text-sm font-bold">▶ Inicio</div>
        <div className="text-[11px] opacity-90">
          {desconectado ? "Desconectado · sin intro" : estado === "revision" ? "En revisión · no vende" : estado === "apagado" ? "Apagado · no vende" : "El cliente escribe"}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 p-2">
        <div className="relative rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-semibold text-slate-800">
          {c.etiqueta}
          <Handle type="source" position={Position.Right} id={`carril:${c.clave}`} className={PUNTO_NARANJA} />
        </div>
        {vende !== undefined && ctx?.acciones.alternarVentaDelPais && (
          <button
            type="button"
            className={`nodrag rounded-md border px-2 py-1 text-left text-[11px] font-bold ${
              vende ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-slate-100 text-slate-700"
            }`}
            title={
              "Es el mismo «Vender en este país» del menú.\n" +
              "· Vale para TODAS tus tiendas y semimodalidades.\n" +
              "· Apagado: a cualquier cliente de este país que escriba —también al que va a mitad de compra— " +
              "el bot le dice que no hay venta y lo pasa a humano.\n" +
              "· Los cables se pueden poner igual. Se guarda con «Guardar»."
            }
            onClick={() => {
              if (vende && !window.confirm(`¿Apagar la venta en ${c.etiqueta}? Vale para TODAS tus tiendas, y también corta a los que van a mitad de compra en ese país.`)) return;
              ctx.acciones.alternarVentaDelPais?.(c.clave);
            }}
          >
            {vende ? "🟢 Vende" : estado === "revision" ? "🔵 En revisión · no vende" : "⚪ Apagado · no vende"}
          </button>
        )}
        {/* SIN VENDER, REVISIÓN O APAGADO (20/10/2026): «para yo poder verlo bien voy a tener que
            conectar el país y eso hace que se active… modo revisión… azul». Los dos no venden; la
            diferencia es solo cómo se ve en la pizarra. */}
        {vende === false && ctx?.acciones.alternarRevision && (
          <button
            type="button"
            className="nodrag rounded-md border border-slate-300 bg-white px-2 py-1 text-left text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
            title="Solo cambia cómo se ve en la pizarra. En los dos el bot no vende en este país."
            onClick={() => ctx.acciones.alternarRevision?.(c.clave)}
          >
            {estado === "revision" ? "⚪ Pasar a apagado (tenue)" : "🔵 Pasar a revisión (se ve normal)"}
          </button>
        )}
        {/* CLIENTES Y VENTAS DE CADA RUTA (20/10/2026): «yo veo cuál ruta vende más y las demás las
            apago». Cuentan los chats, por la intro que recibió cada cliente. */}
        {(data.rutas ?? []).length > 0 && (
          <div
            className="rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] text-violet-900"
            data-numeros-de-rutas
            title={
              "Clientes que entraron por cada ruta (la intro que recibieron) y cuántos pagaron.\n" +
              "La Ruta A es la principal: si otra tienda también vende en este país, sus clientes cuentan aquí."
            }
          >
            {(data.rutas ?? []).map((r) => (
              <div key={r.ruta} className="flex justify-between gap-2">
                <span className="font-bold">Ruta {r.ruta}</span>
                <span>
                  {r.clientes} · {r.ventas} venta{r.ventas === 1 ? "" : "s"}
                  {r.clientes > 0 ? ` (${Math.round((100 * r.ventas) / r.clientes)}%)` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
        {data.otros && (
          <div className="px-1 text-[10px] leading-snug text-slate-500" title="Los clientes de un país que no está en esta lista">
            🌍 Otros países: {data.otros}
          </div>
        )}
      </div>
    </div>
  );
}

const BURBUJAS_A_LA_VISTA = 5;

function NodoDePieza({ id, data, selected }: NodeProps<Node<DatosDePieza>>) {
  const { pieza: p, cuando, pais } = data;
  const ctx = useContext(Contexto);
  const c = COLOR[p.tipo];
  // TENUE SI ESTÁ SUELTA: «debería estar en ese lugar sin conexión o tenue» (16/10/2026).
  // Y TENUE SI NO LE LLEGA NADA (20/10/2026): «sin rosca 1, la 2 no funciona». Lo de detrás de una
  // apagada o de un cable cortado se ve tenue, con sus cables.
  const apagada = p.estado === "apagada" || !!data.suelta || !!data.cadenaApagada;
  const letrero = data.aviso
    ? "FALTA CONECTAR"
    : data.desconectada
      ? "DESCONECTADA"
      : data.suelta
      ? p.estado === "apagada" && !data.pais ? "SIN CONECTAR" : "SUELTA"
      : p.estado === "apagada"
        ? p.motivo === "Sin burbujas con contenido" ? "VACÍA" : "APAGADA"
        : "NO LE LLEGA";
  return (
    <div
      // DOBLE CLIC EN CUALQUIER PARTE DE LA FICHA (22/10/2026): «al dar clic en sus títulos se abre el
      // pop up, debe abrirse cuando doble clickee cualquier lugar de la ficha». Antes solo la franja
      // de color. Lo de dentro que abre otra cosa (una rama → su burbuja) o que no debe abrir (⧉ 🗑 ⚠,
      // el peso) ya corta el doble clic.
      onDoubleClick={() => p.editable && ctx?.acciones.abrir(p.id, undefined, pais || undefined)}
      onContextMenu={(e) => {
        e.preventDefault();
        // Una común sin conectar tiene su propio menú: quitarla de ese país (la ficha no se borra).
        if (data.comunPendiente) {
          ctx?.menu(e.clientX, e.clientY, { tipo: "comun", pais: data.comunPendiente.pais, piezaIds: [p.id] });
          return;
        }
        ctx?.menu(e.clientX, e.clientY, { tipo: "pieza", piezaId: p.id, pais, nodoId: id, suelta: !!data.suelta });
      }}
      // ELEGIDA (con Shift + arrastrar, o un clic): un borde azul, para saber qué se va a mover.
      // TENUE PERO CON SU COLOR (19/10/2026): «si está en gris me confundo… aunque sea tenga color
      // y atenuado, y cuando le pase el mouse por encima se ponga no atenuado». Borde punteado y
      // transparente (ver `.ficha-tenue` en globals.css); al pasar el ratón, normal.
      className={`relative w-[250px] rounded-lg border-2 bg-white text-slate-800 shadow-md ${c.borde} ${
        apagada ? "ficha-tenue border-dashed" : ""
      } ${selected ? "ring-4 ring-sky-400" : ""}`}
    >
      {/* «COMÚN N», UNA PESTAÑITA ARRIBA (17/10/2026): «que tenga encima un letrero que diga
          común y un número… los 3 tendrían ese común 1 y yo diría: ah ok, este es el mismo, solo
          cambia el contenido de los comodines de acuerdo a país». */}
      {data.comunPendiente && (
        <div
          className="absolute -top-[19px] left-3 rounded-t-md bg-sky-600/70 px-2 py-0.5 text-[10px] font-bold tracking-wide text-white shadow"
          title={data.aviso}
        >
          COMÚN · sin conectar
        </div>
      )}
      {data.comun && (
        <div
          className="absolute -top-[19px] left-3 rounded-t-md bg-sky-600 px-2 py-0.5 text-[10px] font-bold tracking-wide text-white shadow"
          title={`Es la misma sub pestaña en ${p.paises.map(banderaDe).join(" ")}: si la editas, cambia en todos. Los comodines (precio, producto…) salen de cada país.`}
        >
          COMÚN {data.comun}
        </div>
      )}
      <Handle type="target" position={Position.Left} id="entra" className={PUNTO_VERDE} />
      {data.sinEntrada && (
        <span
          className="pointer-events-auto absolute -left-[32px] top-1/2 h-[18px] w-[18px] -translate-y-1/2 rounded-full bg-red-600 ring-2 ring-white"
          title="No le llega ningún cable: nadie entra por aquí. Conéctala desde la anterior, o déjala así si es a propósito."
        />
      )}
      <Handle type="source" position={Position.Right} id="sale" className={PUNTO_NARANJA} style={{ top: 18 }} />
      {/* LA FRANJA DE COLOR. El doble clic ya lo atiende la ficha entera (arriba). */}
      <div
        title={p.editable ? "Doble clic en la ficha para abrir el cajón entero" : "Se edita en su sección de siempre"}
        className={`flex cursor-pointer items-center gap-2 rounded-t-[6px] ${c.banda} px-2 py-1.5 text-white`}
      >
        {/* EL ⚠ ARRIBA, CON SU EXPLICACIÓN AL PASAR EL RATÓN (16/10/2026). */}
        {data.aviso && (
          <span
            title={data.aviso}
            className="shrink-0 cursor-help rounded bg-amber-400 px-1 text-xs font-bold text-amber-950"
            onDoubleClick={(e) => e.stopPropagation()}
          >
            ⚠
          </span>
        )}
        <span className="truncate text-xs font-bold">{p.titulo || "(sin nombre)"}</span>
        {/* SU CAMINO (18/10/2026): una marca corta, sin más texto. */}
        {(p.camino || p.caminos) && (
          <span
            className="shrink-0 rounded bg-white/90 px-1 text-[10px] font-bold text-slate-800"
            title={
              (p.caminos?.length ?? 0) > 1
                ? `La comparten: ${(p.caminos ?? []).map((c) => (c ? `camino ${c}` : "el principal (P)")).join(", ")}.`
                : `Camino ${p.camino}: el cliente que entra por la intro de este camino recibe sus pasos.`
            }
          >
            {(p.caminos ?? [p.camino ?? ""]).map((c) => c || "P").join("·")}
          </span>
        )}
        {apagada && (
          <span className="ml-auto shrink-0 text-[10px]">{letrero}</span>
        )}
        {/* CLONAR Y BORRAR, COMO EN SENDY (19/10/2026). Lo mismo que el clic derecho. No en una
            común sin conectar: borrarla borraría la ficha de verdad, la de los otros países. */}
        <span className={`${apagada ? "" : "ml-auto"} ${data.comunPendiente ? "hidden" : "flex"} shrink-0 items-center gap-1`}>
          <button
            type="button"
            title="Duplicar aquí al lado"
            className="nodrag rounded px-1 text-sm leading-none text-white/90 hover:bg-white/20 hover:text-white"
            onClick={(e) => {
              e.stopPropagation();
              ctx?.clonar?.(id, p.id);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            ⧉
          </button>
          <button
            type="button"
            title="Eliminar"
            className="nodrag rounded px-1 text-sm leading-none text-white/90 hover:bg-white/20 hover:text-white"
            onClick={(e) => {
              e.stopPropagation();
              ctx?.acciones.eliminar(p.id);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            🗑
          </button>
        </span>
      </div>
      <div className="flex flex-col gap-1 px-2 pt-1.5">
        {p.resumen.slice(0, BURBUJAS_A_LA_VISTA).map((b, i) => (
          <div key={i}>
            <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 text-[11px]">
              <span className="shrink-0">{ICONO[b.tipo]}</span>
              <span className="truncate">{b.texto || "(sin texto)"}</span>
            </div>
            {b.espera > 0 && i < p.resumen.length - 1 && (
              <div className="pl-2 pt-0.5 text-[10px] text-slate-500">⏱ {b.espera} s</div>
            )}
          </div>
        ))}
        {p.resumen.length === 0 && <div className="text-[11px] italic text-slate-500">Sin burbujas encendidas</div>}
        {p.resumen.length > BURBUJAS_A_LA_VISTA && (
          <div className="text-[10px] font-semibold text-slate-500">+ {p.resumen.length - BURBUJAS_A_LA_VISTA} burbuja(s) más</div>
        )}
      </div>
      {/* LAS RAMAS: botones y cuadritos, cada uno con su punto para llevarlo a otro sitio. */}
      {p.ramas.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1 border-t border-slate-200 px-2 pt-1.5">
          {p.ramas.map((r) => (
            <div
              key={r.id}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                ctx?.menu(e.clientX, e.clientY, { tipo: "rama", piezaId: p.id, ramaId: r.id });
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                ctx?.acciones.abrir(p.id, burbujaDeLaRama(r.id), pais || undefined);
              }}
              className={`relative flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 pr-4 text-[11px] font-semibold ${
                r.tipo === "boton" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-indigo-300 bg-indigo-50 text-indigo-800"
              }`}
              title={r.tipo === "boton" ? "Botón · doble clic para verlo · arrastra su punto para llevarlo a otro destino" : "Cuadrito de decisión · doble clic para verlo · arrastra su punto"}
            >
              <span className="text-[9px] opacity-70">{r.tipo === "boton" ? "BOTÓN" : "SI DICE"}</span>
              <span className="truncate">{r.etiqueta || "(sin texto)"}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={`rama:${r.id}`}
                className={`${PUNTO_NARANJA} ${data.ramasSinCable?.includes(r.id) ? "punto-pide-cable" : ""}`}
                style={data.ramasSinCable?.includes(r.id) ? ARO_NARANJA : undefined}
                title={data.ramasSinCable?.includes(r.id) ? "Falta tu cable: tíralo adonde lleva este botón (el Pago o la oferta)." : undefined}
              />
            </div>
          ))}
        </div>
      )}
      {/* DE PALABRA (19/10/2026): rosada y punteada, para que no parezca un botón. */}
      {(data.palabras?.length ?? 0) > 0 && (
        <div className="mt-1.5 flex flex-col gap-1 border-t border-slate-200 px-2 pt-1.5">
          {data.palabras!.map((f) => {
            // Con el aro mientras él no tire su cable (19/10/2026): «me obliga a yo conectar».
            const pide = !f.conectada && f.destinos.length > 0;
            return (
              <div
                key={f.id}
                className="relative flex items-center gap-1.5 rounded-full border border-dashed border-pink-400 bg-pink-50 px-2 py-0.5 pr-4 text-[11px] font-semibold text-pink-800"
                title="No es un botón: es el cliente que lo dice de palabra. El bot lo lleva ahí desde cualquier paso."
              >
                <span className="shrink-0">💬</span>
                <span className="truncate">{f.texto}</span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={f.id}
                  title={pide ? "Sin cable: tíralo a donde va cuando lo dice de palabra" : undefined}
                  className={`${PUNTO_ROSADO} ${pide ? "punto-pide-cable" : ""}`}
                  style={pide ? ARO_ROSADO : undefined}
                />
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1 border-t border-slate-200 px-2 py-1 text-[10px] text-slate-500">
        {p.paises.length > 0 ? (
          <span className="text-sm leading-none">{p.paises.map(banderaDe).join(" ")}</span>
        ) : (
          <span className="rounded bg-slate-100 px-1">sin país</span>
        )}
        {p.otrasTiendas.length > 0 && (
          <span className="rounded bg-amber-100 px-1 text-amber-900">también en {p.otrasTiendas.join(", ")}</span>
        )}
        <span className="ml-auto">{p.tipo === "seguimiento" && ctx?.acciones.cambiarTiempo ? "" : cuando ?? ""}</span>
      </div>
      <PesoYAnuncios p={p} porcentaje={data.porcentaje} nota={data.notaDeAnuncio} />
      {/* LOS MINUTOS DEL SEGUIMIENTO, AL FINAL DE SU TARJETA (17/10/2026). Son del seguimiento
          entero: se dice, para que no sorprenda que cambien en sus otras fichas. */}
      {p.tipo === "seguimiento" &&
        ctx?.acciones.cambiarTiempo &&
        (() => {
          const fi = Number(p.id.split(":")[1]);
          const seg = ctx.acciones.seguimientos.find((s) => s.indice === fi);
          if (!seg) return null;
          const m = seg.minutos ?? 0;
          return (
            <CampoDeTiempo
              etiqueta="a los"
              valor={m}
              unidad="min"
              nota={`Desde el 1.er mensaje del cliente. Es el tiempo de TODO el Seguimiento ${fi + 1}: igual en todas sus fichas, tiendas y países.`}
              aviso={
                fi === 0 && m <= 0
                  ? "⚠ Con 0 este seguimiento no se programa."
                  : m <= 0
                    ? "Con 0 sale en la próxima franja horaria de seguimientos (menú ajustes)."
                    : m > 24 * 60
                    ? "⚠ Pasa de 24 h: WhatsApp no deja enviarlo."
                    : undefined
              }
              alCambiar={(n) => ctx.acciones.cambiarTiempo?.(fi, n)}
            />
          );
        })()}
    </div>
  );
}

/** Con el respaldo encendido, a un país sin la suya le llega la de otro. Se dice en UNA ficha
 *  corta, no copiando las de los otros países —eso le pareció «que se duplicó»—. */
function NodoDePrestada({ data }: NodeProps<Node<DatosDePrestada>>) {
  return (
    <div className="w-[250px] rounded-lg border-2 border-dashed border-red-500 bg-red-50 px-2 py-2 text-[11px] text-red-800 shadow">
      <Handle type="target" position={Position.Left} id="entra" className={PUNTO_VERDE} />
      <Handle type="source" position={Position.Right} id="sale" className={PUNTO_NARANJA} />
      <div className="font-bold">⚠ Sin {data.titulo.toLowerCase()} propio</div>
      <div>{data.texto}</div>
    </div>
  );
}

/**
 * EL UPSELL EN UNA SOLA TARJETA (16/10/2026). Con dos presentaciones y dos entregas, unir cada
 * entrega con cada presentación dibujaba cables cruzados: «me parece fatal… si yo me enredo,
 * cómo será un novato». Ahora le entra un cable por entrega y salen Sí y No; dentro, cada
 * presentación es una fila con su bandera (o «sin país»): doble clic la abre, clic derecho da
 * su menú de siempre (usar en un país, sacar, duplicar…).
 */
type BotonDeTarjeta = {
  id: string;
  texto: string;
  color: string;
  /** «boton» (se pulsa), «cuadrito» (palabras clave) o «escribe» (el bot detecta un sí / no escrito). */
  tipo?: "boton" | "cuadrito" | "escribe";
  /** Doble clic: dónde se edita. */
  alAbrir?: () => void;
  ayuda?: string;
};
/**
 * LOS BOTONES DE UNA TARJETA, A LA VISTA (17/10/2026): «ese upsell tiene 2 botones, no has
 * implementado… visualizarlos, y por ende no hay opción de hacer conexión; el ofrecimiento de
 * regalo tampoco». Cada botón con su punto naranja, como los de sus seguimientos.
 */
function BotonesDeTarjeta({ botones }: { botones?: BotonDeTarjeta[] }) {
  if (!botones?.length) return null;
  return (
    <div className="mt-1 flex flex-col gap-1 border-t border-slate-200 px-2 pb-1.5 pt-1.5">
      {botones.map((b) => (
        <div
          key={b.id}
          onDoubleClick={b.alAbrir}
          title={b.ayuda ?? (b.alAbrir ? "Doble clic para editarlo" : undefined)}
          className={`relative flex items-center gap-1.5 rounded-full border-2 bg-white px-2 py-0.5 pr-4 text-[11px] font-semibold text-slate-800 ${b.alAbrir ? "cursor-pointer" : ""}`}
          style={{ borderColor: b.color }}
        >
          <span className="text-[9px] opacity-70">
            {b.tipo === "cuadrito" ? "CUADRITO" : b.tipo === "escribe" ? "ESCRIBE" : "BOTÓN"}
          </span>
          <span className="truncate">{b.texto}</span>
          <Handle type="source" position={Position.Right} id={`boton:${b.id}`} className={PUNTO_NARANJA} />
        </div>
      ))}
    </div>
  );
}

type DatosDeUpsell = {
  titulo: string;
  filas: PiezaDePizarra[];
  pais?: string;
  botones?: BotonDeTarjeta[];
  /** «COMÚN N» de cada fila que esté en varios países. */
  comunes?: Record<string, number>;
  /** Enseña sus minutos (el upsell 1, con producto). */
  conTiempo?: boolean;
  /** SIN PRODUCTO DE UPSELL ELEGIDO (17/10/2026): tenue y sin conexión. */
  sinProducto?: boolean;
  /** Los productos que se pueden poner de upsell (clic derecho: elegir o cambiar). */
  productos?: Array<{ id: string; nombre: string }>;
  /** APAGADO CON SU PRODUCTO GUARDADO (19/10/2026): se ve como un upsell de la fila apagado. */
  apagado?: boolean;
  /** Lleva el interruptor ENCENDIDO / APAGADO (cuando tiene producto, encendido o apagado). */
  conInterruptor?: boolean;
};
function NodoDeUpsell({ id, data }: NodeProps<Node<DatosDeUpsell>>) {
  const ctx = useContext(Contexto);
  const c = COLOR.upsell;
  // Apagado se ve igual que sin producto: tenue y sin conexión.
  const sinProducto = data.sinProducto || data.apagado;
  return (
    <div
      // PIZARRA LIMPIA (17/10/2026): «no vuelvas a poner cosas que ensucien la pizarra». Elegir,
      // cambiar o desactivar el producto va al clic derecho de la tarjeta, no encima de ella.
      onContextMenu={(e) => {
        e.preventDefault();
        ctx?.menu(e.clientX, e.clientY, { tipo: "upsell", productos: data.productos ?? [], conProducto: !sinProducto });
      }}
      title="Clic derecho para elegir, cambiar o desactivar su producto"
      className={`w-[270px] rounded-lg border-2 bg-white text-slate-800 shadow-md ${sinProducto ? "border-dashed border-slate-400" : c.borde}`}
      style={sinProducto ? { opacity: 0.75 } : undefined}
    >
      <Handle type="target" position={Position.Left} id="entra" className={PUNTO_VERDE} />
      {!data.botones?.length && !sinProducto && (
        <Handle type="source" position={Position.Right} id="sale" className={PUNTO_NARANJA} style={{ top: 18 }} />
      )}
      <div className={`rounded-t-[6px] ${sinProducto ? "bg-slate-400" : c.banda} px-2 py-1.5 text-xs font-bold text-white`}>🛒 {data.titulo}</div>
      {data.apagado ? (
        <div className="px-2 pt-1.5 text-[11px] text-slate-600">Apagado: el bot lo salta y sigue con el siguiente.</div>
      ) : (
        sinProducto && <div className="px-2 pt-1.5 text-[11px] font-bold text-amber-800">⚠ Sin producto de upsell</div>
      )}
      {/* EL MISMO INTERRUPTOR QUE LOS UPSELLS DE LA FILA (19/10/2026): «el upsell 1 apagado no se
          parece al upsell 2 apagado… debería tener su botón de apagado y encendido». Apagarlo no
          le quita el producto: lo guarda y lo devuelve al encenderlo. */}
      {data.conInterruptor && ctx?.acciones.alternarUpsell1 && (
        <div className="nodrag flex items-center gap-1.5 border-b border-slate-200 px-2 py-1.5 text-[11px]">
          <button
            type="button"
            onClick={() => ctx.acciones.alternarUpsell1?.()}
            className={`rounded px-1.5 py-0.5 font-bold text-white ${data.apagado ? "bg-slate-400" : "bg-emerald-600"}`}
            title={data.apagado ? "Apagado: el bot lo salta. Clic para encenderlo." : "Encendido: el bot lo ofrece. Clic para apagarlo."}
          >
            {data.apagado ? "APAGADO" : "ENCENDIDO"}
          </button>
        </div>
      )}
      <div className="flex flex-col gap-1 p-2">
        {data.filas.map((p) => (
          <div
            key={p.id}
            onDoubleClick={() => ctx?.acciones.abrir(p.id, undefined, data.pais)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              ctx?.menu(e.clientX, e.clientY, { tipo: "pieza", piezaId: p.id, pais: data.pais ?? "", nodoId: id, suelta: false });
            }}
            title="Doble clic para abrirla · clic derecho para sus países"
            className={`flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 text-[11px] hover:border-amber-400 ${p.estado === "apagada" ? "opacity-50" : ""}`}
          >
            {data.comunes?.[p.id] && (
              <span className="shrink-0 rounded bg-sky-600 px-1 text-[9px] font-bold text-white">COMÚN {data.comunes[p.id]}</span>
            )}
            <span className="truncate font-semibold">{p.titulo || "(sin nombre)"}</span>
            <span className="ml-auto shrink-0">
              {p.paises.length > 0 ? p.paises.map(banderaDe).join(" ") : <span className="rounded bg-slate-200 px-1 text-[10px]">sin país</span>}
            </span>
            {/* SU PESO, como en las demás tarjetas (17/10/2026). Con una sola no hace falta. */}
            {data.filas.length > 1 && ctx?.acciones.cambiarPeso && (
              <label
                className="nodrag flex shrink-0 items-center gap-0.5 text-[10px]"
                onDoubleClick={(e) => e.stopPropagation()}
                title="Su peso en el sorteo"
              >
                ⚖
                <input
                  key={p.peso ?? 1}
                  type="number"
                  min={1}
                  defaultValue={p.peso ?? 1}
                  onBlur={(e) => {
                    const n = Math.max(1, Math.floor(Number(e.target.value) || 1));
                    if (n !== (p.peso ?? 1)) ctx.acciones.cambiarPeso?.(p.id, n);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="w-9 rounded border border-slate-300 px-0.5"
                />
                <span className="font-bold text-sky-700">
                  {Math.round((100 * (p.peso ?? 1)) / data.filas.reduce((s, q) => s + (q.peso ?? 1), 0))}%
                </span>
              </label>
            )}
          </div>
        ))}
        {data.filas.length > 1 && (
          <div className="text-[10px] text-slate-600">Hay {data.filas.length}: cada cliente recibe una, según su peso.</div>
        )}
      </div>
      <BotonesDeTarjeta botones={data.botones} />
      {/* SUS MINUTOS, como los upsells de la fila (17/10/2026). */}
      {data.conTiempo && ctx?.acciones.cambiarTiempo && (
        <CampoDeTiempo
          etiqueta="sale a los"
          valor={ctx.acciones.tiempos?.upsell ?? 0}
          unidad="min"
          nota="Desde que recibe su compra. Es uno solo para todas las tiendas."
          alCambiar={(n) => ctx.acciones.cambiarTiempo?.("upsell", n)}
        />
      )}
    </div>
  );
}

function NodoDeDestino({ data }: NodeProps<Node<DatosDeDestino>>) {
  const ctx = useContext(Contexto);
  return (
    <div
      // DOBLE CLIC SIEMPRE ENSEÑA ALGO (16/10/2026): «esa burbujita Elige el básico solo es visual,
      // no puedo darle doble click y ver qué dice». Si es un mensaje, se escribe; si es una acción,
      // se abre la sub pestaña en la burbuja de ese botón o cuadrito, con todo lo que hace.
      onDoubleClick={() =>
        data.esMensaje
          ? ctx?.acciones.abrirRama(data.piezaId, data.ramaId)
          : ctx?.acciones.abrir(data.piezaId, burbujaDeLaRama(data.ramaId))
      }
      onContextMenu={(e) => {
        e.preventDefault();
        ctx?.menu(e.clientX, e.clientY, { tipo: "destino", piezaId: data.piezaId, ramaId: data.ramaId });
      }}
      title={data.esMensaje ? "Doble clic para escribir su mensaje · clic derecho para cambiar el destino" : "Doble clic para ver lo que hace · clic derecho para cambiar el destino"}
      // SE DESVANECE RÁPIDO AL TOCAR EL VERDE, Y REAPARECE SUAVE (19/10/2026): «un desvanecimiento
      // rápido… reaparece suave si me alejo me parece genial».
      className={`w-[170px] cursor-pointer rounded-lg border-2 border-indigo-300 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-800 shadow transition-opacity ${
        data.uniendose ? "opacity-0 duration-100" : "opacity-100 duration-300"
      }`}
    >
      {/* UN SOLO PUNTO, EL NARANJA (18/10/2026): «esos cablecitos deberían tener solo un punto, no
          2, porque confunden». El cable de su botón sigue llegando aquí; el punto no se ve. */}
      <Handle type="target" position={Position.Left} id="entra" isConnectable={false} className="!h-1 !w-1 !min-w-0 !border-0 !bg-transparent" />
      {/* SU PUNTO NARANJA, SIEMPRE (18/10/2026): «dame la capacidad de conectar arrastrando ese
          puntito… al pago». Arrastrarlo a un Pago o a la intro de order bump cambia lo que hace su
          botón, igual que tirar del punto naranja del botón. */}
      {/* TIRAR DEL PUNTO MUEVE EL RECUADRO ENTERO (19/10/2026): «yo quiero jalar el punto
          anaranjado y que esa burbuja lo acompañe». No estira una línea: arrastra el recuadro con
          su cable; encima del punto verde de un Pago o de la intro de order bump, el recuadro se
          esconde, y al soltar se conecta. Ver `alArrastrar`. */}
      {/* (Los puntos del editor no dejan arrastrar la ficha: el que se ve es parte del recuadro,
          y el de verdad, encima e invisible, solo sostiene su cable al Pago.) */}
      {/* DEL PUNTO SALE UN CABLE, Y LA BURBUJA SE QUEDA EN SU SITIO (20/10/2026): «debería partir
          un cable desde el punto de la burbuja hacia la conexión, así no hay confusión». Ya no
          arrastra el recuadro: se suelta en un Pago, en el Cobro y entrega o en la intro de order
          bump, como cualquier otro punto (`onConnect`, «desde el recuadro de un botón»).
          «Mensaje vacío»: su botón no hace nada todavía; el punto pide su cable. */}
      <Handle
        type="source"
        position={Position.Right}
        id="sale"
        className={`${PUNTO_NARANJA} cursor-crosshair ${data.vacio ? "punto-pide-cable" : ""}`}
        style={data.vacio ? ARO_NARANJA : undefined}
      />
      <span className="mr-1">{data.icono}</span>
      {data.texto}
    </div>
  );
}

/**
 * LA POSTVENTA EN LÍNEA, COMO SENDY (16/10/2026): «debería haber un pago y una entrega… no quiero
 * que varíe mucho con respecto a Sendy». Antes era UNA ficha con todo dentro y «no se puede
 * descifrar». Ahora cada paso es su ficha: 💳 Pago → 📦 Entrega → (🟨 Upsell) → 🎁 Regalo.
 */
type DatosDeFijo = {
  /** Su cable de salida lo pone él y todavía no lo puso: el punto lleva el aro que lo pide. */
  pideCable?: boolean;
  /** Su cable de ENTRADA falta (un cajón apagado): el punto verde lleva el aro que lo pide. */
  pideEntrada?: boolean;
  /** Es un cajón: doble clic abre su gestor (19/10/2026). */
  gestor?: "regalo" | "upsells";
  /** Las fichas que viven dentro del cajón (las presentaciones del upsell 1 de este país). */
  piezasDentro?: string[];
  tipo: "pago" | "entrega" | "regalo" | "upsell" | "enlace" | "despedida";
  titulo: string;
  subtitulo: string;
  /** A qué abre el doble clic; vacío = no se edita aquí. */
  abre: string;
  resumen: ResumenDeBurbuja[];
  aviso?: string;
  apagado?: boolean;
  /** El país del camino donde está: su doble clic abre la vista previa en ese país. */
  pais?: string;
  /** La misma en todos los caminos (una entrega, el regalo): se dice con una etiqueta. */
  compartida?: boolean;
  botones?: BotonDeTarjeta[];
  /** Un upsell de la fila: se maneja aquí mismo (17/10/2026). `k` = su lugar en la fila. */
  fila?: { k: number; encendido: boolean; minutos?: number };
  /** El regalo enseña su tiempo de silencio. */
  conTiempoDelRegalo?: boolean;
};

/**
 * UN TIEMPO, EN SU TARJETA (17/10/2026): «necesito ese tiempo de seguimiento al final… y también en
 * el regalo». Escribe en el MISMO dato que su menú; `nota` dice desde cuándo cuenta y a quién más
 * afecta, porque estos tiempos son de todo el seguimiento / de todas las tiendas.
 */
function CampoDeTiempo({
  etiqueta,
  valor,
  unidad,
  nota,
  alCambiar,
  aviso,
  escala = 1,
}: {
  etiqueta: string;
  valor: number;
  unidad: "min" | "seg";
  nota: string;
  alCambiar: (n: number) => void;
  aviso?: string;
  /** Cuántas unidades guardadas son una de pantalla (60: se guarda en segundos y se ve en minutos). */
  escala?: number;
}) {
  // EN PANTALLA, EN SU UNIDAD (19/10/2026: «el regalo hay que ponerlo en minutos»). Con escala,
  // admite medio minuto; se guarda redondeado a la unidad de siempre.
  const enPantalla = Math.round((valor / escala) * 10) / 10;
  return (
    // Doble clic aquí es para el número, no para abrir la ficha.
    <div className="nodrag border-t border-slate-200 px-2 py-1.5 text-[11px] text-slate-700" onDoubleClick={(e) => e.stopPropagation()}>
      <label className="flex items-center gap-1 font-semibold" title={nota}>
        ⏱ {etiqueta}
        <input
          // `key`: si cambia por fuera (Ctrl+Z, el menú), el campo se pone al día.
          key={valor}
          type="number"
          min={0}
          step={escala > 1 ? 0.5 : 1}
          defaultValue={enPantalla}
          onBlur={(e) => {
            const n = escala > 1 ? Math.max(0, Math.round((Number(e.target.value) || 0) * escala)) : Math.max(0, Math.floor(Number(e.target.value) || 0));
            if (n !== valor) alCambiar(n);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="w-16 rounded border border-slate-300 px-1 py-0.5 font-normal"
        />
        {unidad}
      </label>
      <div className="mt-0.5 text-[10px] leading-snug text-slate-500">{nota}</div>
      {aviso && <div className="mt-0.5 text-[10px] font-semibold text-red-700">{aviso}</div>}
    </div>
  );
}

/** LOS MANDOS DE UN UPSELL EN FILA: encender, sus minutos y quitarlo. */
function MandosDeLaFila({ fila }: { fila: NonNullable<DatosDeFijo["fila"]> }) {
  const ctx = useContext(Contexto);
  const f = ctx?.acciones.fila;
  if (!f) return null;
  return (
    <div className="nodrag flex flex-wrap items-center gap-1.5 border-t border-slate-200 px-2 py-1.5 text-[11px]">
      <button
        type="button"
        onClick={() => f.alternar(fila.k)}
        className={`rounded px-1.5 py-0.5 font-bold text-white ${fila.encendido ? "bg-emerald-600" : "bg-slate-400"}`}
        title={fila.encendido ? "Encendido: el bot lo ofrece. Clic para apagarlo." : "Apagado: el bot lo salta. Clic para encenderlo."}
      >
        {fila.encendido ? "ENCENDIDO" : "APAGADO"}
      </button>
      <label className="flex items-center gap-1 text-slate-600" title="Minutos después de la entrega anterior">
        a los
        <input
          type="number"
          min={0}
          defaultValue={fila.minutos ?? 0}
          onBlur={(e) => {
            const m = Math.max(0, Math.floor(Number(e.target.value) || 0));
            if (m !== (fila.minutos ?? 0)) f.minutos(fila.k, m);
          }}
          className="w-14 rounded border border-slate-300 px-1 py-0.5"
        />
        min
      </label>
      <button
        type="button"
        onClick={() => f.quitar(fila.k)}
        className="ml-auto rounded border border-red-200 px-1.5 py-0.5 text-red-700 hover:bg-red-50"
        title="Quitarlo de la fila (el producto no se borra)"
      >
        Quitar
      </button>
    </div>
  );
}

const ESTILO_FIJO: Record<DatosDeFijo["tipo"], { banda: string; borde: string; icono: string }> = {
  pago: { banda: "bg-teal-600", borde: "border-teal-500", icono: "💳" },
  entrega: { banda: "bg-emerald-600", borde: "border-emerald-500", icono: "📦" },
  regalo: { banda: "bg-pink-500", borde: "border-pink-400", icono: "🎁" },
  upsell: { banda: "bg-amber-500", borde: "border-amber-400", icono: "🛒" },
  enlace: { banda: "bg-fuchsia-500", borde: "border-fuchsia-400", icono: "🔗" },
  despedida: { banda: "bg-slate-500", borde: "border-slate-400", icono: "👋" },
};

/**
 * UN CAJÓN QUE JUNTA VARIAS TARJETAS (19/10/2026): 💳 Cobro y entrega, ⏱ Seguimientos. «Yo quiero
 * un orden y no una maraña». Las tarjetas de dentro siguen vivas pero escondidas; sus cables
 * entran y salen por los puntos del borde del cajón, uno por cada botón o fila que lleva a algún
 * lado. Doble clic abre su gestor. Ver `enCajones`.
 */
type DatosDeCajon = {
  tipo: "cobro" | "seguimientos";
  titulo: string;
  icono: string;
  /** Lo que se ve dentro, en pocas líneas. */
  lineas: string[];
  pais: string;
  /** Para los seguimientos: su camino («» = el principal). */
  camino?: string;
  /** Los puntos de entrada (izquierda). */
  entradas: Array<{ id: string; texto: string }>;
  /** Los puntos de salida (derecha): cada botón, cuadrito o fila «de palabra» que lleva a algo. */
  salidas: Array<{ id: string; texto: string; pide?: boolean; rosado?: boolean }>;
  apagado?: boolean;
  /** La primera y la última tarjeta de dentro (para conectar a o desde el cajón). */
  primera?: string;
  ultima?: string;
  /** Todas las tarjetas de dentro (ids de nodo): copiar, pegar y Delete las usan. */
  dentro: string[];
  /** Un cajón pegado y aún sin país: sus fichas (ids), para que su gestor enseñe solo ésas. */
  soloEstas?: string[];
  /** Una cajita puesta «común» en otro país, aún sin conectar: en cuál, y su grupo. */
  comunDe?: { pais: string; grupo: string };
  /** Las fichas de dentro (ids de sub pestaña), para «Usar también en…». */
  piezasDe?: string[];
};
function NodoDeCajon({ data }: NodeProps<Node<DatosDeCajon>>) {
  const ctx = useContext(Contexto);
  const estilo =
    data.tipo === "cobro"
      ? { banda: "bg-teal-600", borde: "border-teal-500" }
      : { banda: "bg-orange-500", borde: "border-orange-400" };
  return (
    <div
      className={`w-[260px] rounded-lg border-2 bg-white text-slate-800 shadow-md ${estilo.borde} ${data.apagado ? "ficha-tenue border-dashed" : ""}`}
      onDoubleClick={() => ctx?.acciones.abrirGestor?.(data.tipo, data.pais, data.camino, data.soloEstas)}
      // CLIC DERECHO EN LA CAJITA (20/10/2026): «Usar también en…» (común, sin conectar), o, si es
      // una común en espera, quitarla de ese país.
      onContextMenu={(e) => {
        if (data.tipo !== "seguimientos") return;
        e.preventDefault();
        e.stopPropagation();
        if (data.comunDe) {
          ctx?.menu(e.clientX, e.clientY, { tipo: "comun", pais: data.comunDe.pais, piezaIds: data.piezasDe ?? [] });
        } else if (data.pais) {
          ctx?.menu(e.clientX, e.clientY, { tipo: "cajon", pais: data.pais, piezaIds: data.piezasDe ?? [], grupo: `${data.pais}${data.camino ?? ""}` });
        }
      }}
      title="Doble clic para abrir su gestor"
    >
      <div className={`flex items-center gap-2 rounded-t-[6px] ${estilo.banda} px-2 py-1.5 text-white`}>
        <span className="text-xs font-bold">
          {data.icono} {data.titulo}
        </span>
      </div>
      {data.entradas.length === 1 && data.entradas[0].id === "entra" && (
        <Handle type="target" position={Position.Left} id="entra" className={PUNTO_VERDE} style={{ top: 18 }} />
      )}
      <div className="flex flex-col gap-1 px-2 py-1.5">
        {data.entradas.length > 1 || (data.entradas[0] && data.entradas[0].id !== "entra")
          ? data.entradas.map((e) => (
              <div key={e.id} className="relative rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 text-[11px] font-semibold">
                <Handle type="target" position={Position.Left} id={e.id} className={PUNTO_VERDE} style={{ left: -10 }} />
                {e.texto}
              </div>
            ))
          : null}
        {data.lineas.map((l, i) => (
          <div key={i} className="truncate text-[11px] text-slate-600">
            {l}
          </div>
        ))}
        <div className="text-[10px] text-slate-500">Doble clic: su gestor.</div>
      </div>
      {data.salidas.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-slate-200 px-2 py-1.5">
          {data.salidas.map((s) => (
            // SIN `truncate` EN LA FILA (19/10/2026): recortaba lo que sale de ella, y el punto, que
            // va al borde del cajón, quedaba escondido. Se recorta solo el texto.
            <div
              key={s.id}
              className={`relative rounded-full border px-2 py-0.5 pr-4 text-[11px] font-semibold ${
                s.rosado ? "border-dashed border-pink-400 bg-pink-50 text-pink-800" : s.id === "sale" ? "border-slate-200 bg-slate-50 text-slate-700" : "border-emerald-300 bg-emerald-50 text-emerald-800"
              }`}
            >
              <span className="block truncate">{s.texto}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={s.id}
                className={`${s.rosado ? PUNTO_ROSADO : PUNTO_NARANJA} ${s.pide ? "punto-pide-cable" : ""}`}
                // AL BORDE DEL CAJÓN, no dentro de su fila (19/10/2026): 8 px de margen + 2 de borde.
                style={{ ...(s.pide ? (s.rosado ? ARO_ROSADO : ARO_NARANJA) : {}), right: -10 }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * JUNTAR EN CAJONES (19/10/2026), después de dibujar todo: el cobro y la entrega de cada país, y
 * los seguimientos de cada país y camino. No cambia nada de lo calculado: esconde esas tarjetas
 * (siguen en la lista, así cortar y conectar funcionan igual) y pasa sus cables al cajón. Un punto
 * de salida del cajón se llama «tarjeta~punto», y al conectar desde él se traduce de vuelta.
 */
function enCajones(
  nodos: Node[],
  cables: Edge[],
  /** Dónde DEJÓ él cada tarjeta (lo guardado). El cajón va donde están sus fichas de verdad, no
   *  donde las pondría la pizarra de fábrica (20/10/2026: la cajita pegada caía al fondo). */
  guardadaEn: (nodoId: string) => Punto | undefined = () => undefined
): { nodos: Node[]; cables: Edge[]; reales: Edge[] } {
  const sitio = (n: Node) => {
    const g = guardadaEn(n.id);
    return g && Number.isFinite(g.x) && Number.isFinite(g.y) ? g : n.position;
  };
  const escondidas = new Map<string, string>(); // tarjeta → su cajón
  const nuevos: Node[] = [];
  const porId = new Map(nodos.map((n) => [n.id, n]));
  // ── 💳 COBRO Y ENTREGA, por país ──
  const deCobro = nodos.filter((n) => /^pv:[^:]+:(pago|entrega):(basico|full|unico)$/.test(n.id));
  const paisesDeCobro = [...new Set(deCobro.map((n) => n.id.split(":")[1]))];
  for (const p of paisesDeCobro) {
    const suyos = deCobro.filter((n) => n.id.split(":")[1] === p);
    const pagos = suyos.filter((n) => n.id.includes(":pago:"));
    if (pagos.length === 0) continue;
    const id = `pv:${p}:cobro`;
    for (const n of suyos) escondidas.set(n.id, id);
    const x = Math.min(...suyos.map((n) => sitio(n).x));
    const y = Math.min(...suyos.map((n) => sitio(n).y));
    const datosDe = (n: Node) => n.data as DatosDeFijo;
    nuevos.push({
      id,
      type: "cajon",
      position: { x, y },
      data: {
        tipo: "cobro",
        icono: "💳",
        titulo: "Cobro y entrega",
        pais: p === "otros" ? "" : p,
        lineas: pagos.map((n) => `${datosDe(n).titulo.replace(/^Pago · /, "")} → pago → entrega`),
        entradas: pagos.map((n) => ({
          id: `entra:${n.id.split(":").pop()}`,
          texto: pagos.length > 1 ? `Si elige ${datosDe(n).titulo.replace(/^Pago · /, "")}` : "Quiere pagar",
        })),
        salidas: [{ id: "sale", texto: "Pagó y recibió su entrega" }],
        dentro: suyos.map((n) => n.id),
      } satisfies DatosDeCajon,
      deletable: false,
    });
  }
  // ── ⏱ SEGUIMIENTOS, por país y camino ──
  const deSeg = nodos.filter((n) => n.type === "pieza" && /^pz:[^:]+:seg:/.test(n.id) && !(n.data as DatosDePieza).suelta);
  const grupos = new Map<string, Node[]>();
  for (const n of deSeg) {
    const d = n.data as DatosDePieza;
    const k = `${n.id.split(":")[1]}|${d.pieza.camino ?? ""}`;
    grupos.set(k, [...(grupos.get(k) ?? []), n]);
  }
  // LA VERSIÓN RECIÉN CREADA Y AÚN VACÍA, DENTRO DE SU CAJÓN (19/10/2026: «cuando creo un seguimiento
  // interno en esa caja, el seguimiento aparece afuera»). Hasta que tiene contenido el bot no la
  // manda y la pizarra la dibuja suelta; si ya va a un país, entra en el cajón de ese país y camino.
  for (const n of nodos) {
    if (n.type !== "pieza" || !n.id.startsWith("suelta:seg:")) continue;
    const d = n.data as DatosDePieza;
    const camino = d.pieza.camino ?? "";
    const pais = d.pieza.paises.find((p) => grupos.has(`${p}|${camino}`)) ?? d.pieza.paises[0];
    if (!pais) continue;
    const k = `${pais}|${camino}`;
    grupos.set(k, [...(grupos.get(k) ?? []), n]);
  }
  // LOS SEGUIMIENTOS PEGADOS, AÚN SIN PAÍS, EN SU PROPIO CAJÓN (20/10/2026: «cuando copio en grupo,
  // le hace split al seguimiento»). Van juntos los que están unidos por los cables grises del grupo
  // pegado; uno pegado solo, en su cajón también. Al conectarlo a un país pasa al cajón de ese país.
  const sinPais = nodos.filter(
    (n) => n.type === "pieza" && n.id.startsWith("suelta:seg:") && (n.data as DatosDePieza).pieza.paises.length === 0
  );
  if (sinPais.length > 0) {
    const raiz = new Map<string, string>();
    const buscar = (x: string): string => {
      const r = raiz.get(x) ?? x;
      if (r === x) return x;
      const final = buscar(r);
      raiz.set(x, final);
      return final;
    };
    for (const c of cables) {
      if (!c.id.startsWith("enlace:")) continue;
      const a = buscar(c.source);
      const b = buscar(c.target);
      if (a !== b) raiz.set(a, b);
    }
    for (const n of sinPais) {
      const k = `~suelto:${buscar(n.id)}|`;
      grupos.set(k, [...(grupos.get(k) ?? []), n]);
    }
  }
  // LA CAJITA PUESTA «COMÚN» EN OTRO PAÍS, AÚN SIN CONECTAR (20/10/2026): sus fichas van juntas, en
  // un cajón tenue en ese país. Un cable a él las conecta todas a la vez.
  for (const n of nodos) {
    if (n.type !== "pieza" || !n.id.startsWith("comun:")) continue;
    const d = n.data as DatosDePieza;
    if (!d.comunPendiente || d.pieza.tipo !== "seguimiento") continue;
    const k = `~comun:${d.comunPendiente.pais}:${d.comunPendiente.grupo || d.pieza.id}|`;
    grupos.set(k, [...(grupos.get(k) ?? []), n]);
  }
  for (const [k, suyos] of grupos) {
    const [p, camino] = k.split("|");
    // Uno pegado sin país: su cajón se llama por su primera ficha, y no es de ningún país. Uno
    // común sin conectar: por su país y su grupo.
    const comunEn = p.startsWith("~comun:") ? p.slice("~comun:".length) : null;
    const suelto = p.startsWith("~suelto:") || !!comunEn;
    const id = comunEn
      ? `segs:comun:${comunEn}`
      : suelto
        ? `segs:suelta:${[...suyos].map((n) => (n.data as DatosDePieza).pieza.id).sort()[0]}`
        : `segs:${p}:${camino || "P"}`;
    for (const n of suyos) escondidas.set(n.id, id);
    // El número sale de la FICHA («seg:1:3» → seguimiento 2), no del nodo: las sueltas se llaman distinto.
    const numeroDe = (n: Node) => Number((n.data as DatosDePieza).pieza.id.split(":")[1] ?? 0) + 1;
    const enOrden = [...suyos].sort((a, b) => numeroDe(a) - numeroDe(b) || a.position.y - b.position.y);
    // Su sitio: el de las que están en el camino (las sueltas recién creadas están en otro lado).
    // En uno suelto, todas son sueltas: su sitio es el de ellas.
    const delCamino = suelto ? suyos : suyos.filter((n) => !n.id.startsWith("suelta:"));
    const x = Math.min(...(delCamino.length ? delCamino : suyos).map((n) => sitio(n).x));
    const y = Math.min(...(delCamino.length ? delCamino : suyos).map((n) => sitio(n).y));
    const salidas: DatosDeCajon["salidas"] = [{ id: "sale", texto: "Continúa al siguiente paso" }];
    for (const n of enOrden) {
      const d = n.data as DatosDePieza;
      const s = `S${numeroDe(n)}`;
      for (const r of d.pieza.ramas)
        salidas.push({ id: `${n.id}~rama:${r.id}`, texto: `${s} · ${r.etiqueta || "(sin texto)"}`, pide: d.ramasSinCable?.includes(r.id) });
      for (const f of d.palabras ?? []) salidas.push({ id: `${n.id}~${f.id}`, texto: `${s} · ${f.texto}`, rosado: true, pide: !f.conectada && f.destinos.length > 0 });
    }
    const porSeguimiento = new Map<number, string[]>();
    for (const n of enOrden) {
      const d = n.data as DatosDePieza;
      const vacia = d.pieza.motivo === "Sin burbujas con contenido" ? " (vacía: aún no sale)" : "";
      porSeguimiento.set(numeroDe(n), [...(porSeguimiento.get(numeroDe(n)) ?? []), `${d.pieza.titulo || "(sin nombre)"}${vacia}`]);
    }
    nuevos.push({
      id,
      type: "cajon",
      position: { x, y },
      data: {
        tipo: "seguimientos",
        icono: "⏱",
        titulo: comunEn ? "Seguimientos · COMÚN · sin conectar" : suelto ? "Seguimientos · sin conectar" : `Seguimientos${camino ? ` · camino ${camino}` : ""}`,
        pais: suelto || p === "otros" ? "" : p,
        camino,
        ...(suelto ? { soloEstas: enOrden.map((n) => (n.data as DatosDePieza).pieza.id) } : {}),
        ...(comunEn ? { comunDe: { pais: comunEn.split(":")[0], grupo: comunEn.split(":").slice(1).join(":") } } : {}),
        lineas: [...porSeguimiento.entries()].map(([nro, titulos]) => `${nro}. ${titulos.join(" · ")}`),
        entradas: [{ id: "entra", texto: "" }],
        salidas,
        // Conectar al cajón o desde él usa las del camino, no una vacía recién creada.
        primera: (enOrden.find((n) => !n.id.startsWith("suelta:")) ?? enOrden[0])?.id,
        ultima: ([...enOrden].reverse().find((n) => !n.id.startsWith("suelta:")) ?? enOrden[enOrden.length - 1])?.id,
        dentro: enOrden.map((n) => n.id),
        piezasDe: enOrden.map((n) => (n.data as DatosDePieza).pieza.id),
        // Sin conectar (pegado o común en espera): tenue, como las fichas sueltas.
        apagado: suelto || suyos.every((n) => (n.data as DatosDePieza).pieza.estado === "apagada"),
      } satisfies DatosDeCajon,
      deletable: false,
    });
  }
  // LA PRESENTACIÓN DE UPSELL RECIÉN CREADA Y VACÍA, DENTRO DEL CAJÓN DE UPSELLS de su país (20/10/2026),
  // igual que los seguimientos: no queda suelta afuera. Su gestor la enseña.
  for (const n of nodos) {
    if (n.type !== "pieza" || !n.id.startsWith("suelta:up:")) continue;
    const pais = (n.data as DatosDePieza).pieza.paises.find((p) => porId.has(`pv:${p}:upsells`));
    if (pais) escondidas.set(n.id, `pv:${pais}:upsells`);
  }
  if (escondidas.size === 0) return { nodos, cables, reales: cables };
  // Los cables: los de dentro se van; los que entran o salen, al borde de su cajón.
  const vistos = new Set<string>();
  const cablesNuevos: Edge[] = [];
  for (const c of cables) {
    const cajonDe = escondidas.get(c.source);
    const cajonA = escondidas.get(c.target);
    if (cajonDe && cajonDe === cajonA) continue;
    let source = c.source;
    let sourceHandle = c.sourceHandle ?? null;
    let target = c.target;
    let targetHandle = c.targetHandle ?? null;
    if (cajonA) {
      target = cajonA;
      targetHandle = cajonA.endsWith(":cobro") ? `entra:${c.target.split(":").pop()}` : "entra";
      // A la entrega solo llega el pago, que está dentro: nada más.
      if (cajonA.endsWith(":cobro") && c.target.includes(":entrega:")) continue;
    }
    if (cajonDe) {
      if (cajonDe.endsWith(":cobro")) {
        // Del cobro solo sale lo que sale de una entrega.
        if (!c.source.includes(":entrega:")) continue;
        sourceHandle = "sale";
      } else {
        sourceHandle = (sourceHandle ?? "sale") === "sale" ? "sale" : `${c.source}~${sourceHandle}`;
      }
      source = cajonDe;
    }
    const llave = `${source}|${sourceHandle}|${target}|${targetHandle}`;
    if (vistos.has(llave)) continue;
    vistos.add(llave);
    cablesNuevos.push(source === c.source && target === c.target ? c : { ...c, id: `${c.id}#${llave}`, source, sourceHandle, target, targetHandle });
  }
  return {
    nodos: [...nodos.map((n) => (escondidas.has(n.id) ? { ...n, hidden: true } : n)), ...nuevos.map((n) => ({ ...n, position: porId.get(n.id)?.position ?? n.position }))],
    cables: cablesNuevos,
    // Los de siempre, entre las tarjetas de verdad: copiar los usa para llevarse los cables del grupo.
    reales: cables,
  };
}

/** UNA ETIQUETA EN EL CAMINO: la respuesta del cliente que lleva a cada lado. */
type DatosDeEtiqueta = { texto: string; color: string };
function NodoDeEtiqueta({ data }: NodeProps<Node<DatosDeEtiqueta>>) {
  return (
    <div
      className="rounded-full border-2 bg-white px-3 py-1 text-[11px] font-bold text-slate-800 shadow"
      style={{ borderColor: data.color }}
    >
      <Handle type="target" position={Position.Left} id="entra" className={PUNTO_VERDE} />
      {data.texto}
      <Handle type="source" position={Position.Right} id="sale" className={PUNTO_NARANJA} />
    </div>
  );
}
/**
 * LA ZONA SOMBREADA DE LO ELEGIDO, TAMBIÉN CON SHIFT + CLIC (19/10/2026): «cuando selecciono 2
 * con el mouse y zona seleccionada sale un área atenuada; esa área también debe aparecer cuando
 * las seleccione con Shift + clic». La misma que pinta React Flow al elegir arrastrando, pero
 * solo dibujada (no atrapa clics: Shift + clic sigue quitando una de la selección).
 */
function ZonaDeLaSeleccion() {
  // EL ZOOM, PARA LA ELEVACIÓN (19/10/2026): 3 píxeles de pantalla con cualquier zoom. Ver
  // `--zoom-pizarra` en globals.css.
  const zoom = useStore((s) => s.transform[2]);
  useEffect(() => {
    document.documentElement.style.setProperty("--zoom-pizarra", String(zoom || 1));
  }, [zoom]);
  const nodos = useNodes();
  const laSuya = useStore((s) => s.nodesSelectionActive || s.userSelectionActive);
  const elegidas = nodos.filter((n) => n.selected && n.type !== "caja");
  if (laSuya || elegidas.length < 2) return null;
  const x0 = Math.min(...elegidas.map((n) => n.position.x));
  const y0 = Math.min(...elegidas.map((n) => n.position.y));
  const x1 = Math.max(...elegidas.map((n) => n.position.x + (n.measured?.width ?? 250)));
  const y1 = Math.max(...elegidas.map((n) => n.position.y + (n.measured?.height ?? 200)));
  return (
    <ViewportPortal>
      <div
        className="react-flow__nodesselection-rect"
        style={{ position: "absolute", transform: `translate(${x0}px, ${y0}px)`, width: x1 - x0, height: y1 - y0, pointerEvents: "none" }}
      />
    </ViewportPortal>
  );
}

function NodoFijo({ data }: NodeProps<Node<DatosDeFijo>>) {
  const ctx = useContext(Contexto);
  const e = ESTILO_FIJO[data.tipo];
  return (
    <div
      className={`w-[250px] rounded-lg border-2 bg-white text-slate-800 shadow-md ${e.borde} ${data.apagado ? "ficha-tenue border-dashed" : ""}`}
      // UN CAJÓN SE ABRE CON DOBLE CLIC EN CUALQUIER PARTE (19/10/2026).
      onDoubleClick={() => data.gestor && ctx?.acciones.abrirGestor?.(data.gestor, data.pais ?? "")}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="entra"
        title={data.pideEntrada ? "Apagado: conéctale un cable para encenderlo" : undefined}
        className={`${PUNTO_VERDE} ${data.pideEntrada ? "punto-pide-cable" : ""}`}
        style={data.pideEntrada ? ({ "--aro": "rgba(16, 185, 129, 0.35)" } as React.CSSProperties) : undefined}
      />
      {!data.botones?.length && (
        <Handle
          type="source"
          position={Position.Right}
          id="sale"
          title={data.pideCable ? "Sin cable: tíralo a la Entrega de este producto" : undefined}
          className={`${PUNTO_NARANJA} ${data.pideCable ? "punto-pide-cable" : ""}`}
          style={{ top: 18, ...(data.pideCable ? ARO_NARANJA : {}) }}
        />
      )}
      <div
        onDoubleClick={() => data.abre && ctx?.acciones.abrir(data.abre, undefined, data.pais)}
        title={data.gestor ? "Doble clic para abrir su gestor" : data.abre ? "Doble clic para abrir y editar" : data.subtitulo}
        className={`flex cursor-pointer items-center gap-2 rounded-t-[6px] ${data.apagado ? "bg-slate-400" : e.banda} px-2 py-1.5 text-white`}
      >
        <span className="text-xs font-bold">{e.icono} {data.titulo}</span>
        {data.apagado && <span className="ml-auto text-[10px]">APAGADO</span>}
      </div>
      <div className="flex flex-col gap-1 px-2 py-1.5">
        {data.resumen.slice(0, BURBUJAS_A_LA_VISTA).map((b, i) => (
          <div key={i} className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 text-[11px]">
            <span className="shrink-0">{ICONO[b.tipo]}</span>
            <span className="truncate">{b.texto || "(sin texto)"}</span>
          </div>
        ))}
        <div className="text-[10px] text-slate-500">{data.subtitulo}</div>
        {data.compartida && (
          <div
            className="self-start rounded bg-sky-100 px-1 text-[10px] font-semibold text-sky-900"
            title="Es la misma en todos los caminos: si la editas, cambia en todos"
          >
            🔗 la misma en todos los caminos
          </div>
        )}
        {data.aviso && <div className="rounded bg-red-50 px-1.5 py-1 text-[10px] font-semibold text-red-700">{data.aviso}</div>}
      </div>
      {data.fila && <MandosDeLaFila fila={data.fila} />}
      <BotonesDeTarjeta botones={data.botones} />
      {/* EL TIEMPO DEL REGALO (17/10/2026): «¿a partir de qué punto empieza a correr?». */}
      {data.conTiempoDelRegalo && ctx?.acciones.cambiarTiempo && (
        <CampoDeTiempo
          etiqueta="sale tras"
          valor={ctx.acciones.tiempos?.regalo ?? 0}
          unidad="min"
          escala={60}
          nota="De silencio, desde que recibe su compra (o desde la oferta del upsell). Si el cliente escribe, vuelve a cero. Si dice «No» al upsell, sale enseguida. Uno solo para todas las tiendas."
          alCambiar={(n) => ctx.acciones.cambiarTiempo?.("regalo", n)}
        />
      )}
    </div>
  );
}

/**
 * LA CAJA: un rectángulo detrás de todo (16/10/2026).
 *
 * Lo afinó al usarla: «que no se pueda mover, solo manejar con los bordes y las esquinas, eso
 * evitará que yo al arrastrar no se mueva el fondo sino el panorama… quítale el borde que es
 * una línea azul… y tampoco los puntos de las esquinas: yo puedo ver los bordes y arrastrarlos
 * cuando la flecha adquiera la forma de doble flecha».
 *
 * Por eso el CUERPO no recoge el ratón (arrastrar dentro mueve el panorama). Y lo volvió a
 * afinar: «que no tengan ese borde pespunteado, y que solo se puedan agrandar y reducir desde
 * las esquinas, no desde los bordes… yo clickeo en la esquina, se selecciona y le doy borrar».
 * Así que solo hay CUATRO ESQUINAS, invisibles hasta que el cursor cambia encima; un clic en
 * una la elige (Delete la borra) y arrastrarla cambia el tamaño. El título también la elige,
 * y con doble clic la renombra.
 */
const ESQUINAS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
function NodoDeCaja({ data }: NodeProps<Node<DatosDeCaja>>) {
  const t = TEMA[data.tema];
  return (
    <div
      className="h-full w-full"
      style={{ pointerEvents: "none" }}
      // Un clic en una esquina (sin arrastrar) la elige.
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(".react-flow__resize-control")) {
          e.stopPropagation();
          data.alElegir();
        }
      }}
    >
      {ESQUINAS.map((esquina) => (
        <NodeResizeControl
          key={esquina}
          position={esquina}
          minWidth={160}
          minHeight={100}
          style={{
            width: 18,
            height: 18,
            border: "none",
            borderRadius: 4,
            pointerEvents: "all",
            background: data.elegida ? t.tituloCaja : "transparent",
            opacity: data.elegida ? 0.8 : 1,
          }}
          onResizeEnd={(_e, r) => data.alCambiar({ ...data.caja, x: r.x, y: r.y, ancho: r.width, alto: r.height })}
        />
      ))}
      <div
        className="h-full w-full rounded-2xl"
        style={{
          background: t.caja,
          // Sin borde punteado; elegida, una línea fina para saber cuál se va a borrar.
          outline: data.elegida ? `2px solid ${t.tituloCaja}` : "none",
          pointerEvents: "none",
        }}
      >
        <div
          onClick={(e) => {
            e.stopPropagation();
            data.alElegir();
          }}
          onDoubleClick={() => {
            const nuevo = window.prompt("Nombre de la caja", data.caja.titulo);
            if (nuevo !== null) data.alCambiar({ ...data.caja, titulo: nuevo.slice(0, 80) });
          }}
          // Separado de la esquina, para que su punto de agarre no le quite el clic.
          className={`ml-5 mt-3 inline-block cursor-pointer rounded-md px-1 text-sm font-bold uppercase tracking-wide ${data.elegida ? "underline" : ""}`}
          style={{ color: t.tituloCaja, pointerEvents: "all" }}
          title="Clic para elegirla (y Delete la borra) · doble clic para renombrarla"
        >
          {data.caja.titulo || "Caja"}
        </div>
        {/* ▶ VER RECORRIDO DE ESTE PAÍS (17/10/2026): «al yo activar ver recorrido aparezca en
            Perú su recorrido». El visor de siempre, con esta tienda y este país. */}
        {data.pais && data.alVerRecorrido && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data.alVerRecorrido?.();
            }}
            className="nodrag ml-2 mt-3 inline-block rounded-md bg-emerald-600 px-2 py-0.5 align-top text-[11px] font-bold text-white shadow hover:bg-emerald-700"
            style={{ pointerEvents: "all" }}
            title="Lo que le llega a un cliente de este país, mensaje por mensaje"
          >
            ▶ Ver recorrido
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * EL CABLE QUE SE CORTA: al pasar el ratón aparece una «x» roja en su tercio (siempre a la
 * vista). Cortar es pedirle al editor que quite esa conexión. Si el cable no es una conexión
 * suya —una prestada—, la «x» explica por qué no se puede, en vez de no hacer nada.
 */
type DatosDelCable = { alCortar: () => void; etiqueta?: string };

/**
 * UNA SOLA CURVA, SIEMPRE PERFECTA, QUE PASA POR EL PUNTO JALADO (20/10/2026: «al soltarla queda una
 * forma rara… me gustaría que quede perfecta»). Antes eran dos tramos unidos en el punto, y en
 * algunas posiciones la unión hacía un quiebre. Ahora es UNA curva de Bézier: sale y entra
 * horizontal como las de siempre, y sus dos tiradores se corren juntos lo justo para que su
 * mitad caiga en el punto (en una Bézier cúbica, la mitad se mueve 3/4 de lo que se corren).
 */
function caminoDeGoma(sx: number, sy: number, tx: number, ty: number, corrimiento: Punto): [string, number, number] {
  const k = Math.max(60, Math.abs(tx - sx) / 2);
  const dx = corrimiento.x / 0.75;
  const dy = corrimiento.y / 0.75;
  const d = `M ${sx},${sy} C ${sx + k + dx},${sy + dy} ${tx - k + dx},${ty + dy} ${tx},${ty}`;
  return [d, (sx + tx) / 2 + corrimiento.x, (sy + ty) / 2 + corrimiento.y];
}
function CableCortable({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data }: EdgeProps<Edge<DatosDelCable>>) {
  const [encima, setEncimaYa] = useState(false);
  // Al salir, un respiro antes de esconder el ✕: así el ratón pasa del cable al ✕ sin que se apague.
  const reloj = useRef<number | null>(null);
  const setEncima = (v: boolean) => {
    if (reloj.current) window.clearTimeout(reloj.current);
    reloj.current = null;
    if (v) setEncimaYa(true);
    else reloj.current = window.setTimeout(() => setEncimaYa(false), 180);
  };
  const ctx = useContext(Contexto);
  const zoom = useStore((s) => s.transform[2]);
  // EL CABLE DE GOMA (19/10/2026): «yo toco el cable, estiro y se mueve como yo quiera… que no sea
  // un hule raro». Se guarda cuánto se corrió su punto medio; mientras se jala, en local.
  const guardado = ctx?.curvas?.[id];
  const [jalando, setJalando] = useState<Punto | null>(null);
  const corrimiento = jalando ?? guardado ?? null;
  const [recto, xRecto, yRecto] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const [camino, xm, ym] = corrimiento
    ? caminoDeGoma(sourceX, sourceY, targetX, targetY, corrimiento)
    : [recto, xRecto, yRecto];
  const alJalar = (e: React.PointerEvent) => {
    if (e.button !== 0 || !ctx?.curvar) return;
    e.stopPropagation();
    const inicio = { x: e.clientX, y: e.clientY };
    const desde = guardado ?? { x: 0, y: 0 };
    let ultimo: Punto | null = null;
    const mover = (ev: PointerEvent) => {
      const dx = (ev.clientX - inicio.x) / zoom;
      const dy = (ev.clientY - inicio.y) / zoom;
      if (!ultimo && Math.hypot(dx, dy) < 3 / zoom) return;
      ultimo = { x: desde.x + dx, y: desde.y + dy };
      setJalando(ultimo);
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      if (ultimo) ctx.curvar?.(id, ultimo);
      setJalando(null);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  };
  const medidor = useRef<SVGPathElement>(null);
  const [punto, setPunto] = useState({ x: xm, y: ym });
  useEffect(() => {
    const p = medidor.current;
    if (!p) return;
    // UN CABLE QUE NO SE PUEDE MEDIR NO TUMBA LA PÁGINA (20/10/2026): con un extremo inválido el
    // camino queda vacío y `getPointAtLength` lanza un error que se llevaba toda la pizarra.
    try {
      const q = p.getPointAtLength(p.getTotalLength() / 3);
      if (Number.isFinite(q.x) && Number.isFinite(q.y)) setPunto({ x: q.x, y: q.y });
    } catch {}
  }, [camino]);
  return (
    <>
      <g onMouseEnter={() => setEncima(true)} onMouseLeave={() => setEncima(false)}>
        <path ref={medidor} d={camino} fill="none" stroke="none" />
        <BaseEdge id={id} path={camino} interactionWidth={0} style={{ ...style, strokeWidth: encima ? 5 : (style?.strokeWidth ?? 3) }} />
        <path
          d={camino}
          fill="none"
          stroke="transparent"
          strokeWidth={24}
          className="nopan nodrag"
          style={{ cursor: jalando ? "grabbing" : "grab", pointerEvents: "stroke" }}
          onPointerDown={alJalar}
          onContextMenu={(e) => {
            if (!corrimiento) return;
            e.preventDefault();
            e.stopPropagation();
            ctx?.menu(e.clientX, e.clientY, { tipo: "cable", cableId: id });
          }}
        >
          <title>Jálalo para acomodar su recorrido · clic derecho: enderezar</title>
        </path>
      </g>
      <EdgeLabelRenderer>
        <button
          type="button"
          title="Cortar esta conexión"
          data-cable={id}
          onMouseEnter={() => setEncima(true)}
          onMouseLeave={() => setEncima(false)}
          onClick={(e) => {
            e.stopPropagation();
            data?.alCortar();
          }}
          className="nodrag nopan absolute flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-red-600 text-xs font-bold text-white shadow-lg transition-opacity"
          // INVISIBLE, NO ATRAPA EL CLIC (19/10/2026): con dos cables vecinos (dos botones de un cajón
          // a la misma ficha) el ✕ escondido de uno quedaba encima del otro y cortaba el que no era.
          // Solo responde el del cable que tiene el ratón encima.
          style={{ transform: `translate(-50%, -50%) translate(${punto.x}px, ${punto.y}px)`, pointerEvents: encima ? "all" : "none", opacity: encima ? 1 : 0 }}
        >
          ✕
        </button>
        {data?.etiqueta && (
          <div
            className="nodrag nopan pointer-events-none absolute rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700 shadow-sm"
            style={{ transform: `translate(-50%, -50%) translate(${xm}px, ${ym}px)` }}
          >
            {data.etiqueta}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

const TIPOS_DE_NODO = {
  inicio: NodoDeInicio,
  pieza: NodoDePieza,
  prestada: NodoDePrestada,
  destino: NodoDeDestino,
  upsell: NodoDeUpsell,
  fijo: NodoFijo,
  etiqueta: NodoDeEtiqueta,
  caja: NodoDeCaja,
  cajon: NodoDeCajon,
};
const TIPOS_DE_CABLE = { cortable: CableCortable };

// ══ LA DISPOSICIÓN AUTOMÁTICA ══════════════════════════════════════════════════

const X_PRIMERA_COLUMNA = 320;
/** Ancho de cada columna: la ficha (250) + el sitio de los destinos de sus ramas (170). */
const ANCHO_DE_COLUMNA = 470;
const ESPACIO_ENTRE_CARRILES = 60;
const MARGEN_DEL_CARRIL = 44;

/** Lo que hace un botón o cuadrito que lleva a la compra (a la oferta o a un Pago). */
const ACCIONES_DE_COMPRA = new Set(["show_order_bump", "choose_basico", "choose_combo", "show_payment", "send_payment_method"]);
/**
 * «QUIERE COMPRAR», DE PALABRA (19/10/2026): «intro, seguimiento 1, seguimiento 2… tienen 2
 * destinos… no hay ningún indicador que diga que no hay conexión». El bot lleva a la compra al
 * cliente que lo dice, en CUALQUIER paso, con cable o sin él. Las intros y seguimientos SIN un
 * botón de compra llevan una fila rosada que lo dice; con botón, el camino sale del botón.
 */
function llevaPalabra(p: PiezaDePizarra): boolean {
  return (p.tipo === "intro" || p.tipo === "seguimiento") && !p.ramas.some((r) => ACCIONES_DE_COMPRA.has(r.accion));
}

/** Lo copiado con Ctrl+C, para pegarlo en esta tienda o en otra. Ver `portapapeles`. */
const PORTAPAPELES_DE_LA_PIZARRA: {
  current: {
    piezas: Array<{ piezaId: string; x: number; y: number; recuadros?: Array<Punto | null> }>;
    enlaces: Array<[number, number]>;
  } | null;
} = { current: null };

/** EL INICIO DE CADA PAÍS (19/10/2026): «quería el INICIO separado» por país. Uno por fila. */
const idDelInicio = (clave: string) => `inicio:${clave || "otros"}`;
const esInicio = (id: string | undefined) => !!id && (id === "inicio" || id.startsWith("inicio:"));

/** Cómo vende la semimodalidad que se está viendo: lo que decide qué filas «de palabra» hay. */
type VentaDeLaPizarra = { hayOferta: boolean; dosProductos: boolean; basico?: string; full?: string };
/** La de la pizarra que se está dibujando (la pone `disponer` al empezar), para medir las fichas. */
let ventaQueSeDibuja: VentaDeLaPizarra = { hayOferta: false, dosProductos: false };

/**
 * LAS FILAS «DE PALABRA» DE UNA FICHA (19/10/2026), según cómo vende la semimodalidad:
 *   · COMO OB: intros y seguimientos sin botón de compra → «Quiere comprar» (a su oferta); la
 *     intro de order bump → una «Elige X» por cada producto al que no lleve ya un botón.
 *   · COMO DOU: intros y seguimientos → una «Elige X» por cada producto sin botón (la elección
 *     se pide dentro de la intro y el cliente puede decirla en cualquier paso).
 *   · COMOHOY: intros y seguimientos sin botón de compra → «Quiere pagar» (a su Pago).
 * `a` es adónde va: «oferta», o el Pago de ese producto.
 */
function filasDePalabraDe(p: PiezaDePizarra, v: VentaDeLaPizarra): Array<{ id: string; texto: string; a: "oferta" | "basico" | "full" | "unico" }> {
  // SOLO SI LA FICHA NO TIENE NINGÚN BOTÓN NI CUADRITO (19/10/2026): «cuando yo los borre o
  // desactive, y no haya nada que los pueda vincular a los pagos… al desconectarlos aparecen esos
  // otros botones, y es confuso, veo 4 conexiones». Con botones, los conecta él; las filas son
  // para la ficha que no tiene con qué.
  if (p.ramas.length > 0) return [];
  const porProducto = () =>
    (["basico", "full"] as const).map((q) => ({ id: `palabra:${q}`, texto: `Elige ${(q === "basico" ? v.basico : v.full) ?? q}`, a: q }));
  if (p.tipo === "ob") return v.dosProductos ? porProducto() : [];
  if (p.tipo !== "intro" && p.tipo !== "seguimiento") return [];
  if (v.hayOferta) return [{ id: "palabra", texto: "Quiere comprar", a: "oferta" }];
  if (v.dosProductos) return porProducto();
  return [{ id: "palabra", texto: "Quiere pagar", a: "unico" }];
}

function altoDe(p: PiezaDePizarra): number {
  const vistas = Math.min(BURBUJAS_A_LA_VISTA, p.resumen.length);
  const esperas = p.resumen.slice(0, vistas).filter((b, i) => b.espera > 0 && i < p.resumen.length - 1).length;
  return 34 + Math.max(1, vistas) * 30 + esperas * 15 + (p.resumen.length > BURBUJAS_A_LA_VISTA ? 18 : 0) +
    (p.ramas.length > 0 ? 10 + p.ramas.length * 26 : 0) + (() => {
      const n = filasDePalabraDe(p, ventaQueSeDibuja).length;
      return n > 0 ? 10 + n * 26 : 0;
    })() + (p.otrasTiendas.length > 0 ? 40 : 30) + 40 +
    // El campo de minutos al final de un seguimiento, y la fila de peso y anuncios (17/10/2026).
    (p.tipo === "seguimiento" ? 62 : 0) + 30;
}

function etiquetaDelCarril(f: FilaDeEstacion, hayPaises: boolean): string {
  if (f.clave) return f.etiqueta.replace(/^Si país = /, "");
  return hayPaises ? "Otros países" : "Todos los países";
}

type Resultado = { nodos: Node[]; cables: Edge[]; cablesReales?: Edge[]; cajasDeFabrica: CajaDePizarra[]; dibujadas: Set<string> };

function disponer(
  modeloEntero: ModeloDePizarra,
  acciones: AccionesDelLienzo,
  avisar: (t: string) => void,
  /** Dónde está AHORA un nodo (con lo que él movió): ahí se queda la ficha al cortarla. */
  dondeEsta: (nodoId: string) => Punto | undefined,
  /** Las sueltas que él quiere ver en la pizarra. */
  visibles: string[],
  /** Los saltos que él dibujó: «país|de|a» (ids de sub pestaña). */
  puentes: string[] = [],
  /** El fondo GUARDADO de cada país (su y y su alto): la fila se queda pegada a él. */
  anclas: Map<string, { x?: number; y: number; alto: number }> = new Map(),
  /** Hasta dónde llega lo que él ya colocó: un país NUEVO empieza más abajo, sin pisarlo. */
  fondoOcupado = 0,
  /** Dónde DEJÓ él un nodo (lo guardado). Para que lo nuevo nazca junto a lo suyo. */
  guardadaEn: (nodoId: string) => Punto | undefined = () => undefined,
  /** Los cables entre copias sueltas de un grupo pegado: «de|a». */
  enlaces: string[] = [],
  /** Lo puesto «común» en otro país y aún sin conectar: «país|ficha|grupo». */
  comunesSinConectar: string[] = [],
  /** Los botones de una copia que esperan el cable de él: «ficha|rama». */
  ramasPorConectar: string[] = [],
  /** Los cables de botones que él cortó: «ficha|rama». */
  cortados: string[] = [],
  /** El plano: los cables de ruta que él cortó (ver `CorteDeRuta`). */
  cortesDeRuta: string[] = []
): Resultado {
  const cortes = cortesDeRuta.map(leerCorte).filter((x): x is CorteDeRuta => !!x);
  const porConectar = new Set(ramasPorConectar);
  const cortado = new Set(cortados);
  /** ¿Él cortó el cable de este botón? Su cable no se dibuja (el botón no cambia) hasta que lo tire. */
  const loCorto = (pieza: PiezaDePizarra, r: RamaDePieza): boolean =>
    cortado.has(`${pieza.id}|${r.id}`) && ACCIONES_DE_COMPRA.has(r.accion ?? "");
  /** CORTAR ES SOLO PANTALLA (20/10/2026): antes dejaba el botón en «solo su mensaje» en el bot. */
  const alCortarLaRama = (piezaId: string, ramaId: string) => () =>
    acciones.cortarCableDeBoton ? acciones.cortarCableDeBoton(piezaId, ramaId) : acciones.cambiarRama(piezaId, ramaId, "mensaje");
  /**
   * ¿ESTE BOTÓN DE UNA COPIA ESPERA SU CABLE AL PAGO? (20/10/2026: «si hay conexión intro →
   * seguimientos → intro de order bump y copio el bloque, sí debe mantenerla… el problema es cuando
   * conecto al país, eso se engancha al pago»). Solo lo que va al PAGO espera; lo que va a la oferta
   * es un cable de dentro del bloque y se dibuja como en el original. La regla de adónde va es la
   * de abajo: en COMO OB, «Elige X» de antes de la oferta va a la oferta.
   */
  const esperaAlPago = (pieza: PiezaDePizarra, r: RamaDePieza): boolean =>
    porConectar.has(`${pieza.id}|${r.id}`) &&
    ACCIONES_DE_COMPRA.has(r.accion ?? "") &&
    r.accion !== "show_order_bump" &&
    !(ventaQueSeDibuja.hayOferta && pieza.tipo !== "ob" && (r.accion === "choose_basico" || r.accion === "choose_combo" || r.accion === "show_payment"));
  const nodos: Node[] = [];
  const cables: Edge[] = [];
  const cajasDeFabrica: CajaDePizarra[] = [];
  const piezaPorId = new Map(modeloEntero.piezas.map((p) => [p.id, p]));
  // EL UPSELL NO VA EN LOS CARRILES: se ofrece después de entregar, así que va en la línea de
  // la postventa, como en Sendy. Los carriles son lo de ANTES de pagar.
  const modelo = { ...modeloEntero, estaciones: modeloEntero.estaciones.filter((e) => e.tipo !== "upsell") };
  const estacionDelUpsell = modeloEntero.estaciones.find((e) => e.tipo === "upsell");
  const todasLasFilas = modelo.estaciones[0]?.filas ?? [];
  const hayPaises = todasLasFilas.some((f) => f.clave);
  // SIN FILA «OTROS PAÍSES» cuando hay países (17/10/2026): «eso de otros países no tiene
  // sentido, yo nunca voy a usar algo en otros países». Lo que les pasa se dice en el Inicio.
  const filasDeCarril = hayPaises ? todasLasFilas.filter((f) => f.clave) : todasLasFilas;
  const filaDeOtros = hayPaises ? todasLasFilas.find((f) => !f.clave) : undefined;
  const otrosEnElInicio = !filaDeOtros
    ? undefined
    : filaDeOtros.piezas.length > 0
      ? "reciben la intro sin país."
      : "no tienen intro: pasan a humano.";
  const ancho = X_PRIMERA_COLUMNA + modelo.estaciones.length * ANCHO_DE_COLUMNA;
  const enAlgunCarril = new Set(modeloEntero.estaciones.flatMap((e) => e.filas.flatMap((f) => f.piezas)));
  /** La ficha de la oferta de 2 opciones en cada carril: las ramas que llevan ahí, van a ella. */
  const ofertaDelCarril = new Map<string, string>();

  const cable = (
    id: string,
    source: string,
    sourceHandle: string,
    target: string,
    color: string,
    alCortar?: () => void,
    /** Lo que dice el cable a mitad de camino: «cuando quiere pagar», «si elige X»… */
    etiqueta?: string
  ): Edge => ({
    id,
    source,
    sourceHandle,
    target,
    targetHandle: "entra",
    type: alCortar ? "cortable" : "default",
    // SIN TEXTOS EN LOS CABLES (18/10/2026): «recuerda no poner textos en los cables, eso se sabe
    // reconocer con solo ver el cable». La `etiqueta` se recibe y se ignora.
    data: alCortar ? { alCortar } : undefined,
    ...(void etiqueta, {}),
    deletable: false,
    // TODOS PUNTEADOS, QUIETOS Y SIN PUNTA DE FLECHA, como pidió.
    // UN 50 % MÁS GRUESOS (19/10/2026): «en la línea también un 50 % más de grosor».
    style: { stroke: color, strokeWidth: 3, strokeDasharray: "9 6" },
  });

  // ── LA POSTVENTA, POR CAMINO ───────────────────────────────────────────────────
  const pv = modeloEntero.postventa;
  const entregasPv = pv?.entregas ?? [];
  const delBasico = entregasPv.find((e) => e.puesto === "basico");
  const delFull = entregasPv.find((e) => e.puesto === "full");
  /** Con dos productos, cada uno tiene su pago: la elección los separa. */
  const dosProductos = !!delBasico && !!delFull;
  /** COMO OB: hay columna de oferta (la intro de order bump). */
  const hayOferta = modeloEntero.estaciones.some((e) => e.tipo === "ob");
  ventaQueSeDibuja = { hayOferta, dosProductos, basico: delBasico?.nombre, full: delFull?.nombre };
  const VERDE = "#059669";
  const GRIS = "#94a3b8";
  /** El icono delante, salvo que su texto ya empiece con uno («✅ Sí lo quiero» salía «✅ ✅»). */
  const conIcono = (icono: string, texto: string) =>
    /^\p{Extended_Pictographic}/u.test(texto.trim()) ? texto.trim() : `${icono} ${texto}`;
  const idPv = (clave: string, que: string) => `pv:${clave || "otros"}:${que}`;
  type Salida = { id: string; handle: string };
  const fijo = (id: string, x: number, yy: number, data: DatosDeFijo) =>
    nodos.push({ id, type: "fijo", position: { x, y: yy }, data, deletable: false });
  const etiquetaPv = (id: string, x: number, yy: number, texto: string, color: string) =>
    nodos.push({ id, type: "etiqueta", position: { x, y: yy }, data: { texto, color } satisfies DatosDeEtiqueta, deletable: false });
  const unirPv = (desde: Salida[], hasta: string, color: string) => {
    for (const d of desde) cables.push(cable(`c:${d.id}:${d.handle}->${hasta}`, d.id, d.handle, hasta, color));
  };

  /**
   * EL FINAL DEL CAMINO DE UN PAÍS: 💳 Pago → 📦 Entrega → 🛒 su Upsell (Sí / No) → 🎁 Regalo.
   * Con dos productos hay dos pagos, uno por opción: a cada uno llega lo que el cliente elija
   * (los botones o cuadritos de la intro de order bump se conectan a ellos).
   */
  function postventaDelCarril(
    clave: string,
    etiqueta: string,
    x0: number,
    yF: number,
    ultimo: Salida | null,
    /** El último paso de cada OTRO camino (18/10/2026): también llega al Pago. */
    ultimosDeOtrosCaminos: Salida[] = []
  ): { x: number; alto: number } {
    const pais = clave || undefined;
    let x = x0;
    let yy = yF;
    const tramos = dosProductos
      ? [
          { que: "basico", e: delBasico },
          { que: "full", e: delFull },
        ]
      : [{ que: "unico", e: entregasPv[0] }];
    const salidasDeEntrega: Salida[] = [];
    for (const t of tramos) {
      const idPago = idPv(clave, `pago:${t.que}`);
      // DEL PAGO A SU ENTREGA, EL CABLE LO PONE ÉL (19/10/2026): «en el caso del delivery o
      // entrega también necesito que sea una conexión visualmente mentirosa». El bot entrega igual;
      // sin su cable, el punto del Pago lleva el aro que lo pide.
      const cableAEntrega = puentes.includes(`${clave}|pago:${t.que}|entrega:${t.que}`);
      fijo(idPago, x, yy, {
        tipo: "pago",
        titulo: dosProductos ? `Pago · ${t.e?.nombre}` : "Pago",
        subtitulo: `${dosProductos ? `Si elige ${t.e?.nombre}. ` : ""}${pv?.pagoPorPais?.[clave] ?? pv?.pago ?? ""}`,
        abre: "pago",
        resumen: [],
        pais,
        pideCable: !cableAEntrega,
      });
      // El pago tampoco va «después»: llega cuando el cliente decide, o cuando elige su opción.
      // UNA SOLA CONEXIÓN POR PAGO (17/10/2026): «me sale doble conexión, desde los botones y
      // desde el punto naranja de la barra de título». Si un botón ya lleva a este pago, la del
      // título (la de quien escribe el nombre) no se dibuja.
      // DE ESA MISMA FICHA (18/10/2026): «en COMOHOY el seguimiento 2 no está conectado al pago».
      // Un cuadrito del seguimiento 1 que iba al pago escondía el cable del final, y la cadena
      // quedaba cortada. Ahora solo lo esconde un botón de la última ficha, como en COMO OB.
      // (Directo de su botón, o pasando por el mensaje de su botón.)
      // Y LO MISMO DESDE EL ÚLTIMO DE CADA CAMINO (18/10/2026).
      for (const u of [ultimo, ...ultimosDeOtrosCaminos]) {
        // DE UNA INTRO O UN SEGUIMIENTO YA NO SALE DEL TÍTULO (19/10/2026): llega su fila «Quiere
        // pagar» o su botón de compra. Del título solo sale a su siguiente paso.
        // Y DE LA INTRO DE ORDER BUMP TAMPOCO (19/10/2026): llegan sus filas «Elige X» o sus botones.
        const tipoDelUltimo = (nodos.find((n) => n.id === u?.id)?.data as Partial<DatosDePieza> | undefined)?.pieza?.tipo;
        if (tipoDelUltimo === "intro" || tipoDelUltimo === "seguimiento" || tipoDelUltimo === "ob") continue;
        const yaLlegaUnBoton = cables.some(
          (x) =>
            x.target === idPago &&
            ((x.source === u?.id && String(x.sourceHandle ?? "").startsWith("rama:")) ||
              (!!u && x.source.startsWith(`dest:${u.id}:`)))
        );
        if (u && !esInicio(u.id) && !yaLlegaUnBoton && !cables.some((x) => x.id === `c:${u.id}:${u.handle}->${idPago}`)) {
          const c = cable(`c:${u.id}:${u.handle}->${idPago}`, u.id, u.handle, idPago, "#0d9488");
          // EL ÚNICO CABLE CON AVISO (18/10/2026): «en ese cablecito del punto anaranjado necesito
          // que haya un aviso… "si elige grafismo"». Es el cliente que no pulsa ningún botón y
          // dice de palabra (o paga) ese producto; sin aviso parecía un cable que sobraba.
          cables.push(
            dosProductos
              ? {
                  ...c,
                  label: `si elige ${(t.e?.nombre ?? "").toLowerCase()}`,
                  labelStyle: { fontSize: 10, fontWeight: 700, fill: "#0f766e" },
                  labelBgStyle: { fill: "#ffffff", stroke: "#99f6e4" },
                  labelBgPadding: [5, 3] as [number, number],
                  labelBgBorderRadius: 6,
                }
              : c
          );
        }
      }
      const idEntrega = idPv(clave, `entrega:${t.que}`);
      fijo(idEntrega, x + 300, yy, {
        tipo: "entrega",
        titulo: t.e ? `Entrega · ${t.e.nombre}` : "Entrega",
        subtitulo: t.e ? "Lo que recibe al aprobarse su pago. Vive en la ficha del producto." : "Esta tienda no tiene producto con entrega.",
        abre: t.e?.id ?? "",
        resumen: t.e?.resumen ?? [],
        aviso: !t.e
          ? "⚠ Quien pague no recibe nada."
          : pv?.entregaDelCanal
            ? "⚠ La entrega del canal está encendida y pisa ésta, en TODAS las tiendas."
            : undefined,
        compartida: true,
        pais,
      });
      if (cableAEntrega) {
        cables.push(
          cable(`c:${idPago}:sale->${idEntrega}`, idPago, "sale", idEntrega, VERDE, () =>
            acciones.quitarPuente?.(clave, `pago:${t.que}`, `entrega:${t.que}`)
          )
        );
      }
      salidasDeEntrega.push({ id: idEntrega, handle: "sale" });
      yy += 200;
    }
    x += 620;
    let siguientes: Salida[] = salidasDeEntrega;
    /** Las salidas que van DIRECTO al regalo (los «No»), aunque haya más upsells en fila. */
    const alRegalo: Salida[] = [];

    // SU UPSELL: el de su país, con sus botones a la vista.
    const filaUp = estacionDelUpsell?.filas.find((f) => f.clave === clave);
    const piezasUp = (filaUp?.estado === "prestada" ? [] : filaUp?.piezas ?? []).flatMap((pid) => {
      const p = piezaPorId.get(pid);
      return p ? [p] : [];
    });
    // LOS UPSELLS, EN SU CAJÓN (19/10/2026): «el upsell tiene sus componentes… yo no quiero que
    // esté suelto sino metido tipo el gestor de seguimientos». Una sola tarjeta: el upsell 1 y los
    // de la fila, cada uno con su presentación, su pago y su entrega, se ven y se editan en su
    // gestor (doble clic). Su cable de entrada es VERDADERO: está si alguno se ofrece; cortarlo
    // los apaga y conectarlo enciende el upsell 1 (con su aviso). Sale al regalo.
    if (acciones.abrirGestor) {
      const idUps = idPv(clave, "upsells");
      const filaActiva = !pv?.upsell || (piezasUp.length > 0 && filaUp?.estado !== "general");
      const upsell1Ofrece = !!pv?.upsell && piezasUp.length > 0 && filaUp?.estado !== "general";
      const deLaFila = filaActiva ? (pv?.enFila ?? []) : [];
      const algunoOfrece = upsell1Ofrece || deLaFila.some((f) => f.encendido !== false);
      const lineas: ResumenDeBurbuja[] = [
        ...(pv?.upsell || pv?.upsellApagado
          ? [{ tipo: "texto" as const, texto: `1. ${(pv?.upsell ?? pv?.upsellApagado)!.nombre}${upsell1Ofrece ? "" : " · apagado"}`, espera: 0 }]
          : []),
        ...(pv?.enFila ?? []).map((f, k) => ({
          tipo: "texto" as const,
          texto: `${k + 2}. ${f.nombre}${f.encendido === false ? " · apagado" : ""}`,
          espera: 0,
        })),
      ];
      // Encendido, pero sin presentación en este país: aquí el bot no lo ofrece, y un cable no lo
      // arreglaría (lo que falta es su presentación para este país).
      const sinPresentacionAqui = !!pv?.upsell && !upsell1Ofrece && !algunoOfrece;
      fijo(idUps, x, yF, {
        tipo: "upsell",
        titulo: "Upsells",
        subtitulo: algunoOfrece
          ? "Doble clic: cada upsell con su presentación, su pago y su entrega."
          : sinPresentacionAqui
            ? `Aquí no se ofrece: el upsell no tiene presentación para ${etiqueta}. Doble clic para verlo.`
            : lineas.length > 0
              ? "Apagados: no se ofrece ninguno. Conéctale un cable para encender el primero."
              : "Sin upsells. Doble clic para agregar uno.",
        abre: "",
        gestor: "upsells",
        piezasDentro: piezasUp.map((p) => p.id),
        resumen: lineas,
        apagado: !algunoOfrece,
        pais,
        pideEntrada: (!algunoOfrece && lineas.length > 0 && !sinPresentacionAqui) || (algunoOfrece && cortado.has(`pv:upsells|${clave || "otros"}`)),
      });
      if (algunoOfrece) {
        // CORTAR ESTE CABLE ES SOLO PANTALLA (20/10/2026): antes apagaba los upsells de verdad, en
        // todos los países. Para apagarlos está su interruptor, dentro de su cajón.
        if (!cortado.has(`pv:upsells|${clave || "otros"}`))
          for (const d of siguientes) {
            cables.push(
              cable(`c:${d.id}:${d.handle}->${idUps}`, d.id, d.handle, idUps, COLOR.upsell.trazo, () =>
                acciones.cortarCableDeBoton ? acciones.cortarCableDeBoton("pv:upsells", clave || "otros") : acciones.alternarUpsells?.(false)
              )
            );
          }
        siguientes = [{ id: idUps, handle: "sale" }];
      }
      x += 300;
    } else {
    if (piezasUp.length > 0 && clave && filaUp?.estado === "general") {
      // Sin bandera: tenue, con su ⚠, sin conectar. Lo conecta él.
      let yT = yF;
      for (const pieza of piezasUp) {
        nodos.push({
          id: `hueco:${clave}:upsell:${pieza.id}`,
          type: "pieza",
          position: { x, y: yT },
          data: {
            pieza,
            cuando: estacionDelUpsell?.cuando,
            pais: clave,
            estacion: estacionDelUpsell!.id,
            suelta: true,
            aviso: `Falta conectar. Hoy el bot SÍ le ofrece este upsell a ${etiqueta}: no tiene bandera, así que vale para todos (y si hay varios, uno al azar). Para conectarlo, arrastra hasta su punto verde el naranja de una entrega.`,
          },
          deletable: false,
        });
        yT += altoDe(pieza);
      }
      siguientes = [];
      x += 320;
    } else if (piezasUp.length > 0) {
      const idUp = idPv(clave, "upsell");
      // LOS BOTONES Y CUADRITOS DE SUS FICHAS, A LA VISTA (17/10/2026): «esos son respuestas que
      // yo podría editar… también debería verlo cuando haga botones o cuadritos». Cada uno con su
      // punto naranja y su cable: «Elige el UPSELL» al pago del upsell, «Rechaza» al regalo, y
      // cualquier otro a su destino, como en las intros.
      // (Sin producto de upsell no hay oferta: la tarjeta queda como antes, con su salida.)
      const ramasUp = pv?.upsell
        ? piezasUp.flatMap((p) => p.ramas.map((r) => ({ p, r, id: `r~${p.id}~${r.id}` })))
        : [];
      const deLaFicha = (p: PiezaDePizarra) => (piezasUp.length > 1 ? ` · ${p.titulo || "ficha"}` : "");
      const botonesUp: BotonDeTarjeta[] = [
        // LOS NATIVOS: con «Preguntar con botones» son botones; sin él, el bot igual entiende un
        // sí o un no escrito. No viven en ninguna ficha: el doble clic abre su menú.
        ...(pv?.upsell
          ? [
              {
                id: "si",
                texto: conIcono("✅", pv.upsell.si),
                color: VERDE,
                tipo: pv.upsell.nativos ? ("boton" as const) : ("escribe" as const),
                alAbrir: () => acciones.irAlMenu?.("upsell"),
                ayuda: "Del menú Upsell → «Elección con botones». Doble clic para ir allí.",
              },
              {
                id: "no",
                texto: conIcono("❌", pv.upsell.no),
                color: GRIS,
                tipo: pv.upsell.nativos ? ("boton" as const) : ("escribe" as const),
                alAbrir: () => acciones.irAlMenu?.("upsell"),
                ayuda: "Del menú Upsell → «Elección con botones». Doble clic para ir allí.",
              },
            ]
          : []),
        ...ramasUp.map(({ p, r, id }) => ({
          id,
          texto: `${r.etiqueta || "(sin texto)"}${deLaFicha(p)}`,
          color: r.accion === "choose_upsell" ? VERDE : r.accion === "decline_upsell" ? GRIS : AZUL_RAMA,
          tipo: r.tipo,
          alAbrir: () => acciones.abrir(p.id, burbujaDeLaRama(r.id), pais),
          ayuda: "Doble clic para abrir su ficha en esa burbuja",
        })),
      ];
      nodos.push({
        id: idUp,
        type: "upsell",
        position: { x, y: yF },
        data: {
          titulo: pv?.upsell ? `Upsell · ${pv.upsell.nombre}` : pv?.upsellApagado ? `Upsell · ${pv.upsellApagado.nombre}` : "Upsell",
          filas: piezasUp,
          pais,
          botones: botonesUp.length > 0 ? botonesUp : undefined,
          conTiempo: !!pv?.upsell,
          sinProducto: !pv?.upsell,
          apagado: !pv?.upsell && !!pv?.upsellApagado,
          conInterruptor: !!pv?.upsell || !!pv?.upsellApagado,
          productos: pv?.productosParaElUpsell ?? [],
        } satisfies DatosDeUpsell,
        deletable: false,
      });
      // SIN PRODUCTO, SIN CABLE (17/10/2026): el bot no lo ofrece, así que la línea sigue de la
      // entrega al regalo (o a la fila) por debajo, y la tarjeta queda tenue a un lado.
      if (pv?.upsell) unirPv(salidasDeEntrega, idUp, COLOR.upsell.trazo);
      // Los que no van ni al pago ni al regalo, a su destino (doble clic lo abre, clic derecho lo cambia).
      ramasUp.forEach(({ p, r, id }, i) => {
        if (r.accion === "choose_upsell" || r.accion === "decline_upsell") return;
        const d = destinoDeLaRama(r);
        const idDestino = `dest:${idUp}:${id}`;
        nodos.push({
          id: idDestino,
          type: "destino",
          position: { x: x + 300, y: yF + 230 + i * 40 },
          data: {
            piezaId: p.id,
            ramaId: r.id,
            icono: d.icono,
            texto: d.texto,
            esMensaje: !r.accion || r.accion === "send_steps",
          },
          deletable: false,
        });
        cables.push(cable(`c:${idUp}:${id}`, idUp, `boton:${id}`, idDestino, AZUL_RAMA));
      });
      x += 320;
      if (pv?.upsell) {
        const idPagoUp = idPv(clave, "up:pago");
        const idEntregaUp = idPv(clave, "up:entrega");
        // Del Pago a su Entrega el cable lo pone él, como en los demás Pagos (19/10/2026).
        const upConEntrega = puentes.includes(`${clave}|up:pago|up:entrega`);
        fijo(idPagoUp, x, yF, {
          tipo: "pago",
          titulo: "Pago del upsell",
          subtitulo: "Precio: el de su ficha, por su país. Se paga entero.",
          abre: "pago",
          resumen: [],
          pais,
          pideCable: !upConEntrega,
        });
        unirPv([{ id: idUp, handle: "boton:si" }], idPagoUp, VERDE);
        // Sus botones de burbuja hacen lo mismo que los nativos: el «Sí» al pago, el «No» al regalo.
        for (const { r, id } of ramasUp) {
          if (r.accion === "choose_upsell") unirPv([{ id: idUp, handle: `boton:${id}` }], idPagoUp, VERDE);
          if (r.accion === "decline_upsell") alRegalo.push({ id: idUp, handle: `boton:${id}` });
        }
        fijo(idEntregaUp, x + 300, yF, {
          tipo: "entrega",
          titulo: `Entrega · ${pv.upsell.nombre}`,
          subtitulo: "Lo que recibe al pagar el upsell. Vive en su ficha.",
          abre: pv.upsell.entregaId,
          resumen: pv.upsell.entrega,
          compartida: true,
          pais,
        });
        if (upConEntrega) {
          cables.push(
            cable(`c:${idPagoUp}:sale->${idEntregaUp}`, idPagoUp, "sale", idEntregaUp, VERDE, () =>
              acciones.quitarPuente?.(clave, "up:pago", "up:entrega")
            )
          );
        }
        // «SI NO QUIERE EL PRIMERO O EL SEGUNDO, NO SE INSISTE MÁS» (motor, `rechazarUpsell` →
        // `pararLaFila`): el «No» va directo al regalo. Al siguiente upsell solo se llega
        // después de comprar éste.
        siguientes = [{ id: idEntregaUp, handle: "sale" }];
        alRegalo.push({ id: idUp, handle: "boton:no" });
        x += 620;
      }
      // (Sin producto: `siguientes` sigue siendo la entrega, que va al regalo como hace el bot.)
    }

    // LOS UPSELLS EN FILA, cada uno con su entrega. Se manejan aquí (17/10/2026): «¿cómo
    // metería un segundo o tercer upsell ahí?». Un apagado se queda en su sitio, sin cables:
    // el bot lo salta. Y detrás de todos, «+ Agregar upsell».
    // LA FILA, DONDE EL BOT LA EMPIEZA (`prepararElSiguienteDeLaFila` en config.ts): detrás del upsell 1
    // cuando lo paga, o directo tras la entrega si la tienda no tiene upsell 1. En un país donde
    // el upsell 1 no se ofrece, tampoco: antes se dibujaba igual, como si le llegara.
    const hayUpsell1 = !!pv?.upsell && piezasUp.length > 0 && filaUp?.estado !== "general";
    const filaJuega = !pv?.upsell || hayUpsell1;
    let numero = pv?.upsell ? 2 : 1;
    // LO NUEVO NACE JUNTO A LO SUYO (17/10/2026). Si él movió la tarjeta de la que sale (la
    // entrega anterior), el upsell nuevo aparece a su derecha, no en el sitio «de fábrica» —ahí
    // salía pegado al borde del fondo, lejos de su cable—. Lo que él ya movió no se toca.
    const colocados = new Map<string, Punto>();
    const junto = (id: string, desde: string | undefined, dx: number, dy: number, xDef: number, yDef: number): Punto => {
      const base = desde ? guardadaEn(desde) ?? colocados.get(desde) : undefined;
      const p = !guardadaEn(id) && base ? { x: base.x + dx, y: base.y + dy } : { x: xDef, y: yDef };
      colocados.set(id, p);
      return p;
    };
    /** La tarjeta junto a la que nace la siguiente: la entrega anterior, o un apagado. */
    let anterior: string | undefined = siguientes[0]?.id;
    (filaJuega ? pv?.enFila ?? [] : []).forEach((f, k) => {
      const id = idPv(clave, `fila:${k}`);
      const encendido = f.encendido !== false;
      const aqui = junto(id, anterior, 320, 0, x, yF);
      fijo(id, aqui.x, aqui.y, {
        tipo: "upsell",
        titulo: encendido ? `Upsell ${numero} · ${f.nombre}` : `Upsell · ${f.nombre}`,
        subtitulo: encendido
          ? "Su presentación vive en su ficha de producto. Doble clic para editarla."
          : "Apagado: el bot lo salta y sigue con el siguiente.",
        // DOBLE CLIC ABRE SU PRESENTACIÓN (19/10/2026), como cualquier otra ficha.
        abre: f.productoId ? `presentacion:${f.productoId}` : "",
        resumen: [],
        aviso: encendido ? f.aviso : undefined,
        pais,
        fila: { k: f.puesto ?? k, encendido, minutos: f.minutos },
      });
      if (!encendido) {
        anterior = id;
        x += 300;
        return;
      }
      numero++;
      unirPv(siguientes, id, COLOR.upsell.trazo);
      // SU PAGO, COMO EL UPSELL 1 (19/10/2026): «lo lógico es que cada upsell tenga sus 2
      // conexiones, su pago y su entrega». El bot cobra cada upsell de la fila por su cuenta.
      // Del Pago a su Entrega el cable lo pone él, como en los demás Pagos.
      const idPagoFila = idPv(clave, `fila-pago:${k}`);
      const suPago = junto(idPagoFila, id, 0, 230, x, yF + 230);
      const llavePagoEntrega = `${clave}|fila-pago:${k}|fila-entrega:${k}`;
      const pagoConEntrega = puentes.includes(llavePagoEntrega);
      fijo(idPagoFila, suPago.x, suPago.y, {
        tipo: "pago",
        titulo: `Pago · ${f.nombre}`,
        subtitulo: "Precio: el de su ficha, por su país. Se paga entero.",
        abre: "pago",
        resumen: [],
        pais,
        pideCable: !pagoConEntrega,
      });
      unirPv([{ id, handle: "sale" }], idPagoFila, VERDE);
      const idEntrega = idPv(clave, `fila-entrega:${k}`);
      // A la derecha de su Pago.
      const suEntrega = junto(idEntrega, idPagoFila, 300, 0, x + 300, yF + 230);
      anterior = idEntrega;
      fijo(idEntrega, suEntrega.x, suEntrega.y, {
        tipo: "entrega",
        titulo: `Entrega · ${f.nombre}`,
        subtitulo: "Si dice que sí y paga. Vive en su ficha.",
        abre: f.entregaId,
        resumen: f.entrega,
        compartida: true,
        pais,
      });
      if (pagoConEntrega) {
        cables.push(
          cable(`c:${idPagoFila}:sale->${idEntrega}`, idPagoFila, "sale", idEntrega, VERDE, () =>
            acciones.quitarPuente?.(clave, `fila-pago:${k}`, `fila-entrega:${k}`)
          )
        );
      }
      // Si éste lo compra, sigue el próximo; si no lo quiere (o calla), al regalo.
      siguientes = [{ id: idEntrega, handle: "sale" }];
      alRegalo.push({ id, handle: "sale" });
      x += 320;
    });
    } // (fin de los upsells sin cajón)
    // «+ AGREGAR UPSELL» YA NO VA AQUÍ (17/10/2026): «me interrumpe la visión… quítalo de ahí».
    // Está en el menú «+», como todo lo que se agrega.

    // EL REGALO, EN SU CAJÓN (19/10/2026): «yo no quiero que esté suelto sino metido tipo el
    // gestor de seguimientos». Una sola tarjeta; doble clic abre su gestor con los pasos en orden
    // (ofrecimiento → enlace → comentó → premio, y la despedida). Su cable de entrada es VERDADERO:
    // está si el regalo está encendido —es uno solo para todo el bot—, cortarlo lo apaga y
    // conectarlo lo enciende (con su aviso). Lo de dentro no se cablea: el bot lo hace en ese orden.
    const rg = pv?.regalo;
    const idRegalo = idPv(clave, "regalo");
    if (acciones.abrirGestor) {
      fijo(idRegalo, x, yF, {
        tipo: "regalo",
        titulo: "Regalo",
        subtitulo: !rg?.encendido
          ? "Apagado: no se ofrece. Conéctale un cable para encenderlo."
          : `${rg.deEstaTienda ? "El regalo de esta tienda." : "El de todas las tiendas."} Doble clic: sus pasos.`,
        conTiempoDelRegalo: !!rg?.encendido,
        abre: "",
        gestor: "regalo",
        resumen: rg?.resumen ?? [],
        apagado: !rg?.encendido,
        compartida: true,
        pais,
        pideEntrada: !rg?.encendido || cortado.has(`pv:regalo|${clave || "otros"}`),
      });
      // CORTAR ESTE CABLE ES SOLO PANTALLA (20/10/2026): antes apagaba el regalo de verdad, en todos
      // los países. Para apagarlo está su interruptor, dentro de su cajón.
      if (rg?.encendido && !cortado.has(`pv:regalo|${clave || "otros"}`)) {
        for (const d of [...siguientes, ...alRegalo]) {
          cables.push(
            cable(`c:${d.id}:${d.handle}->${idRegalo}`, d.id, d.handle, idRegalo, "#ec4899", () =>
              acciones.cortarCableDeBoton ? acciones.cortarCableDeBoton("pv:regalo", clave || "otros") : acciones.alternarRegalo?.(false)
            )
          );
        }
      }
      x += 300;
      return { x, alto: Math.max(yy - yF, 300) };
    }
    fijo(idRegalo, x, yF, {
      tipo: "regalo",
      titulo: "Ofrecimiento de regalo",
      // EL DE ESTA TIENDA, O EL DE TODAS (17/10/2026): «por tienda es diferente».
      subtitulo: !rg?.encendido
        ? "Apagado: no se ofrece."
        : rg.deEstaTienda
          ? "El regalo de esta tienda."
          : "El de todas las tiendas. Si lo editas aquí, esta tienda tendrá el suyo.",
      conTiempoDelRegalo: !!rg?.encendido,
      abre: "regalo",
      resumen: rg?.resumen ?? [],
      apagado: !rg?.encendido,
      compartida: true,
      pais,
      botones: rg?.encendido
        ? [
            // Los nativos, con doble clic a su menú (17/10/2026: «lo que sí quiero es poder manejar
            // esos botones»). Sin botones nativos, el bot entiende igual un sí o un no escrito.
            {
              id: "acepta",
              texto: conIcono("✅", rg.acepta ?? "Acepta"),
              color: VERDE,
              tipo: pv?.regaloConBotones ? ("boton" as const) : ("escribe" as const),
              alAbrir: () => acciones.irAlMenu?.("regalo"),
              ayuda: "Del menú Regalo. Doble clic para ir allí.",
            },
            {
              id: "no",
              texto: conIcono("❌", rg.noQuiere ?? "No quiere"),
              color: GRIS,
              tipo: pv?.regaloConBotones ? ("boton" as const) : ("escribe" as const),
              alAbrir: () => acciones.irAlMenu?.("regalo"),
              ayuda: "Del menú Regalo. Doble clic para ir allí.",
            },
            // Y los botones y cuadritos que él puso en sus burbujas.
            ...(rg.ramas ?? []).map((r) => ({
              id: `r~${r.id}`,
              texto: r.etiqueta || "(sin texto)",
              color: r.accion === "accept_gift" ? VERDE : r.accion === "decline_gift" ? GRIS : AZUL_RAMA,
              tipo: r.tipo,
              alAbrir: () => acciones.abrir("regalo", burbujaDeLaRama(r.id), pais),
              ayuda: "Doble clic para abrir el ofrecimiento en esa burbuja",
            })),
          ]
        : undefined,
    });
    unirPv([...siguientes, ...alRegalo], idRegalo, "#ec4899");
    let alto = yy - yF;
    if (rg?.encendido) {
      const xr = x + 300;
      fijo(idPv(clave, "regalo:enlace"), xr, yF, {
        tipo: "enlace",
        titulo: "Enlace para comentar",
        subtitulo: rg.pedidoEditable ? "Lo que recibe al aceptar." : "Lo que recibe al aceptar. Se edita en la sección del regalo.",
        abre: rg.pedidoEditable ? "regalo-pedido" : "",
        resumen: rg.pedido ?? [],
        compartida: true,
        pais,
      });
      unirPv([{ id: idRegalo, handle: "boton:acepta" }], idPv(clave, "regalo:enlace"), VERDE);
      etiquetaPv(idPv(clave, "regalo:comento"), xr + 300, yF + 20, "💬 Dice que comentó", VERDE);
      unirPv([{ id: idPv(clave, "regalo:enlace"), handle: "sale" }], idPv(clave, "regalo:comento"), VERDE);
      fijo(idPv(clave, "regalo:premio"), xr + 500, yF, {
        tipo: "regalo",
        titulo: "Entrega del regalo",
        subtitulo: "Cuando dice que comentó.",
        abre: "regalo-premio",
        resumen: rg.premio ? [{ tipo: "texto", texto: rg.premio, espera: 0 }] : [],
        compartida: true,
        pais,
      });
      unirPv([{ id: idPv(clave, "regalo:comento"), handle: "sale" }], idPv(clave, "regalo:premio"), VERDE);
      fijo(idPv(clave, "regalo:despedida"), xr, yF + 190, {
        tipo: "despedida",
        titulo: "Despedida",
        subtitulo: "Si no quiere el regalo.",
        abre: "regalo-despedida",
        resumen: rg.despedida ? [{ tipo: "texto", texto: rg.despedida, espera: 0 }] : [],
        compartida: true,
        pais,
      });
      unirPv([{ id: idRegalo, handle: "boton:no" }], idPv(clave, "regalo:despedida"), GRIS);
      // Sus botones y cuadritos: a donde lleva su acción, igual que los nativos; los demás, a su
      // destino (doble clic lo abre, clic derecho lo cambia).
      (rg.ramas ?? []).forEach((r, i) => {
        const h = `boton:r~${r.id}`;
        if (r.accion === "accept_gift") return unirPv([{ id: idRegalo, handle: h }], idPv(clave, "regalo:enlace"), VERDE);
        if (r.accion === "decline_gift") return unirPv([{ id: idRegalo, handle: h }], idPv(clave, "regalo:despedida"), GRIS);
        if (r.accion === "claim_gift") return unirPv([{ id: idRegalo, handle: h }], idPv(clave, "regalo:premio"), VERDE);
        const d = destinoDeLaRama(r);
        const idDestino = idPv(clave, `regalo:dest:${r.id}`);
        nodos.push({
          id: idDestino,
          type: "destino",
          position: { x: xr, y: yF + 380 + i * 40 },
          data: { piezaId: "regalo", ramaId: r.id, icono: d.icono, texto: d.texto, esMensaje: !r.accion || r.accion === "send_steps" },
          deletable: false,
        });
        cables.push(cable(`c:${idRegalo}:${h}`, idRegalo, h, idDestino, AZUL_RAMA));
      });
      x = xr + 500 + 260;
      alto = Math.max(alto, 330);
    } else {
      x += 260;
    }
    // (El regalo con su campo de tiempo es más alto: el fondo del país lo abarca.)
    return { x, alto: Math.max(alto, rg?.encendido ? 300 : 220) };
  }

  let y = 0;
  let anchoTotal = ancho;
  const carriles: Array<DatosDeInicio["carril"]> = [];
  // CADA PAÍS PEGADO A SU FONDO (17/10/2026): al agregar un país, su fila se metía en medio y
  // corría a las de abajo, mientras lo que él ya había movido y sus fondos guardados se quedaban
  // quietos: «cuando creo un nuevo país se están montando las pestañas». Ahora los países con
  // fondo guardado van donde está su fondo, y los nuevos, DEBAJO de todo.
  const ordenadas = [
    ...filasDeCarril.filter((f) => anclas.has(f.clave)).sort((a, b) => anclas.get(a.clave)!.y - anclas.get(b.clave)!.y),
    ...filasDeCarril.filter((f) => !anclas.has(f.clave)),
  ];
  let yLibre = 0;
  ordenadas.forEach((filaGuia) => {
    const clave = filaGuia.clave;
    // EL PLANO DE ESTE PAÍS (20/10/2026): lo que él cortó se dibuja como estaba. La ruta propia que
    // el bot le dio al tramo cortado (`letra`) se lee como la de antes (`original`), así todos sus
    // cables siguen en su sitio; solo falta el cable que él cortó, y el tramo se ve tenue.
    const cortesAqui = cortes.filter((x) => x.pais === clave);
    const letraOriginal = new Map(cortesAqui.filter((x) => x.letra).map((x) => [x.letra, x.original]));
    const tramoCortado = new Set<string>();
    const deAqui = new Map(
      [...piezaPorId].map(([pid, p]) => {
        const suyos = p.caminos ?? [p.camino ?? ""];
        if (!suyos.some((r) => letraOriginal.has(r))) return [pid, p] as const;
        tramoCortado.add(pid);
        const como = [...new Set(suyos.map((r) => (letraOriginal.has(r) ? letraOriginal.get(r)! : r)))];
        return [pid, { ...p, camino: como[0] || undefined, caminos: como.length > 1 ? como : undefined }] as const;
      })
    );
    const desconectadaAqui = (pid: string) => cortesAqui.some((x) => x.quitado && x.hacia === pid);
    /** ¿Es éste el cable que él cortó? (de `desde` —ficha o Inicio— a `hacia`). */
    // (También el que llega, desde el mismo sitio, a otra versión del mismo cajón cortado.)
    const esElCortado = (desdeNodo: string, hacia: string) =>
      cortesAqui.some((x) => {
        if (x.hacia !== hacia && !tramoCortado.has(hacia)) return false;
        if (x.desde === "inicio") return esInicio(desdeNodo);
        return (nodos.find((m) => m.id === desdeNodo)?.data as Partial<DatosDePieza> | undefined)?.pieza?.id === x.desde;
      });
    const etiqueta = etiquetaDelCarril(filaGuia, hayPaises);
    const bandera = clave ? banderaDe(clave) : "";
    const ancla = anclas.get(clave);
    y = ancla ? ancla.y + 10 : Math.max(y, yLibre, anclas.size > 0 ? fondoOcupado : 0);
    // LAS APAGADAS VAN EN SU SITIO, DETRÁS DE LAS QUE SALEN (20/10/2026): con sus cables y tenues.
    // Detrás, para que las que salen manden: el camino sigue por ellas, y el sorteo es solo suyo.
    const celdas = modelo.estaciones.map((e) => {
      const f = e.filas.find((x) => x.clave === clave);
      return f && (f.apagadas ?? []).length > 0 && f.estado !== "prestada" && f.estado !== "general"
        ? { ...f, piezas: [...f.piezas, ...(f.apagadas ?? []).filter((p) => !f.piezas.includes(p))] }
        : f;
    });
    /** Las que salen de verdad en cada paso (sin las apagadas). */
    const vivasEn = (col: number) => modelo.estaciones[col]?.filas.find((x) => x.clave === clave)?.piezas ?? [];
    const yFichas = y + MARGEN_DEL_CARRIL;
    let altoDelCarril = 120;
    /** El último nodo del camino: de él sale el siguiente cable. null = el camino está cortado. */
    let anterior: { id: string; handle: string } | null = null;
    /** La intro de order bump de cada camino en este país (18/10/2026). */
    const ofertaPorCamino = new Map<string, string>();
    /**
     * Y EL ÚLTIMO DE CADA CAMINO (18/10/2026): «cada camino tiene su propia ruta pero el final es
     * el mismo». "" = el principal. Cada ficha cuelga del último de SU camino; un camino sin
     * ficha en un paso sigue por la del principal, como hace el bot (`porCamino`). Sin caminos
     * solo existe "", que es el mismo `anterior` de siempre: se dibuja igual que antes.
     */
    let anteriores = new Map<string, { id: string; handle: string }>();
    const fijarAnterior = (a: { id: string; handle: string } | null) => {
      anterior = a;
      anteriores = a ? new Map([["", a]]) : new Map();
    };
    /** ¿Hay caminos en este país? Sin ellos no se marca nada y todo se ve como siempre. */
    const hayCaminosEnElPais = celdas.some((celda) => (celda?.piezas ?? []).some((pid) => !!deAqui.get(pid)?.caminos));
    /** Dónde quedó cada ficha dibujada, para poner al lado la marca de fin de camino. */
    const posDeLaFicha = new Map<string, Punto>();
    /** Los caminos que terminan antes del final: «🛑 B termina aquí». */
    const finesDeCamino: Array<{ camino: string; desde: string }> = [];
    let sinIntro = false;
    // LA FICHA DE LA OFERTA DE ESTE CARRIL, sabida ANTES de dibujar: las ramas de la intro van
    // primero y tienen que saber que existe, o se dibujaría su cable dos veces.
    modelo.estaciones.forEach((e, col) => {
      const celda = celdas[col];
      if (e.tipo === "ob" && celda && celda.estado !== "prestada" && celda.piezas[0] && !ofertaDelCarril.has(clave)) {
        ofertaDelCarril.set(clave, `pz:${clave}:${e.id}:${celda.piezas[0]}`);
      }
      // Y LA DE CADA CAMINO (18/10/2026): sus botones van a la oferta de su camino.
      if (e.tipo === "ob" && celda && celda.estado !== "prestada") {
        for (const pid of celda.piezas) {
          const q = deAqui.get(pid);
          for (const c of q?.caminos ?? [q?.camino ?? ""]) if (!ofertaPorCamino.has(c)) ofertaPorCamino.set(c, `pz:${clave}:${e.id}:${pid}`);
        }
      }
    });
    /** La oferta a la que va una ficha: la de alguno de sus caminos. Sin caminos en el país, la
     *  de siempre. Con caminos y sin la suya, ninguna: el bot la deja trabada (sin reemplazos). */
    const ofertaPara = (p: PiezaDePizarra): string | undefined => {
      for (const c of p.caminos ?? [p.camino ?? ""]) if (ofertaPorCamino.has(c)) return ofertaPorCamino.get(c);
      return hayCaminosEnElPais ? undefined : ofertaDelCarril.get(clave);
    };
    /** Adónde lleva el bot al que lo dice de palabra: la oferta de su camino, o sus Pagos.
     *  `clave` es lo que se guarda en el cable; `nodo`, adónde se dibuja. */
    const destinosDePalabra = (p: PiezaDePizarra, pais: string): Array<{ clave: string; nodo: string }> => {
      if (hayOferta) {
        const oferta = ofertaPara(p);
        return oferta ? [{ clave: oferta.split(":").slice(3).join(":"), nodo: oferta }] : [];
      }
      return (dosProductos ? ["pago:basico", "pago:full"] : ["pago:unico"]).map((q) => ({ clave: q, nodo: idPv(pais, q) }));
    };

    celdas.forEach((celda, col) => {
      const e = modelo.estaciones[col];
      const x = X_PRIMERA_COLUMNA + col * ANCHO_DE_COLUMNA;
      const esIntro = e.tipo === "intro";
      const conPiezas = !!celda && celda.piezas.length > 0;
      // LO QUE NO TIENE SU CABLE NO SE CONECTA SOLO (16/10/2026): «nada debe reconectarse,
      // todo debería ser conectado por mí». Una sub pestaña SIN BANDERA le llega de verdad a un
      // país sin la suya —así lo hace el bot, y no se toca—, pero aquí no se dibuja conectada:
      // queda el hueco, con el aviso de lo que se lanzaría. «Que quede desconectado de manera
      // cosmética pero que el aviso diga: falta conectar, se lanzará esto». Otros países sí se
      // dibuja conectado: ahí lo sin bandera es lo único que puede llegar.
      //
      // Lo afinó al verlo: sin recuadro de aviso, «ponerle al seguimiento atenuado un signo de
      // warning en la parte de arriba y aparezca el hint». La sub pestaña tenue lleva su punto
      // verde: arrastrar hasta él el naranja de la anterior la conecta.
      if (clave && celda?.estado === "general" && conPiezas) {
        let yTenue = yFichas;
        for (const pid of celda.piezas) {
          const pieza = piezaPorId.get(pid);
          if (!pieza) continue;
          nodos.push({
            id: `hueco:${clave}:${e.id}:${pid}`,
            type: "pieza",
            position: { x, y: yTenue },
            data: {
              pieza,
              cuando: e.cuando,
              pais: clave,
              estacion: e.id,
              suelta: true,
              aviso: `Falta conectar. Hoy el bot SÍ le manda ésta a ${etiqueta}, porque no tiene bandera y vale para los países sin la suya. Para conectarla, arrastra hasta su punto verde el naranja de la anterior.`,
            },
            deletable: false,
          });
          yTenue += altoDe(pieza);
        }
        // EL CAMINO QUEDA CORTADO AQUÍ: nada se conecta solo con lo que sigue.
        fijarAnterior(null);
        altoDelCarril = Math.max(altoDelCarril, yTenue - yFichas);
        return;
      }
      if (esIntro) fijarAnterior(conPiezas ? { id: idDelInicio(clave), handle: `carril:${clave}` } : null);
      // (Sin intro que SALGA: el Inicio se pone anaranjado aunque haya una apagada dibujada.)
      if (esIntro && vivasEn(col).length === 0) sinIntro = true;
      // SI FALTA, EL CAMINO QUEDA CORTADO (16/10/2026). Antes el cable saltaba al siguiente —el
      // bot sí pasa al siguiente seguimiento—, y él lo vio como «se reconecta solo a otro cajón».
      // Lo que sigue queda sin cable de entrada: lo conecta él.
      if (!conPiezas) {
        fijarAnterior(null);
        return;
      }

      // CON RESPALDO, LA PRESTADA ES UNA SOLA FICHA CORTA, no las copias de los otros países.
      if (celda!.estado === "prestada") {
        const id = `prest:${clave}:${e.id}`;
        const de = [...new Set(celda!.piezas.flatMap((pid) => piezaPorId.get(pid)?.paises ?? []))];
        nodos.push({
          id,
          type: "prestada",
          position: { x, y: yFichas },
          data: {
            titulo: e.titulo,
            deDonde: de.join(","),
            pais: clave,
            estacion: e.id,
            texto: `Le llega el de ${de.map(banderaDe).join(" ") || "otro país"}. Dale el suyo, o apaga el respaldo en Ajustes.`,
          },
          deletable: false,
        });
        if (anterior) {
          cables.push(
            cable(`c:${anterior.id}->${id}`, anterior.id, anterior.handle, id, ROJO, () =>
              avisar(
                `Ese cable no es una conexión tuya: ${etiqueta} recibe la ficha de otro país porque no tiene la suya. Crea o duplica una para ${etiqueta}, o apaga el respaldo en Ajustes.`
              )
            )
          );
        }
        fijarAnterior({ id, handle: "sale" });
        altoDelCarril = Math.max(altoDelCarril, 110);
        return;
      }

      let yDeLaFicha = yFichas;
      let primero: string | null = null;
      /** La primera ficha de cada camino en este paso: de ella cuelga su paso siguiente. */
      const primeroPorCamino = new Map<string, string>();
      // EL PESO Y EL ANUNCIO, COMO LOS USA EL BOT (17/10/2026). Intro: quien llega por un anuncio
      // recibe la suya, y el resto se sortea entre TODAS por peso (`chooseIntroSequence`).
      // Seguimiento: la de su anuncio es solo para él, y el resto se sortea entre las que NO
      // tienen anuncio (`chooseFollowupVariant` → `porEtiqueta`).
      const enLaCelda = celda!.piezas.flatMap((pid) => {
        const q = deAqui.get(pid);
        return q ? [q] : [];
      });
      const conAnuncio = (q: PiezaDePizarra) => (q.anunciosNombres ?? []).length > 0;
      const hayAnuncios = enLaCelda.some((q) => vivasEn(col).includes(q.id) && conAnuncio(q));
      const vivas = new Set(vivasEn(col));
      const enElSorteo = enLaCelda.filter((q) => vivas.has(q.id));
      const delSorteo = e.tipo === "seguimiento" && hayAnuncios ? enElSorteo.filter((q) => !conAnuncio(q)) : enElSorteo;
      const pesoTotal = delSorteo.reduce((s, q) => s + (q.peso ?? 1), 0);
      for (const pid of celda!.piezas) {
        const pieza = deAqui.get(pid);
        if (!pieza) continue;
        const id = `pz:${clave}:${e.id}:${pid}`;
        /** En el plano: desconectada de este país por él, o parte de un tramo que él cortó. */
        const sinCorriente = desconectadaAqui(pid) || tramoCortado.has(pid);
        const notaDeAnuncio = conAnuncio(pieza)
          ? e.tipo === "seguimiento"
            ? "Solo la reciben los que llegan por ese anuncio."
            : "Los que llegan por ese anuncio la reciben siempre; los demás también pueden recibirla en el sorteo."
          : undefined;
        nodos.push({
          id,
          type: "pieza",
          position: { x, y: yDeLaFicha },
          data: {
            pieza,
            cuando: e.cuando,
            pais: clave,
            estacion: e.id,
            porcentaje:
              delSorteo.length > 1 && delSorteo.includes(pieza)
                ? Math.round((100 * (pieza.peso ?? 1)) / pesoTotal)
                : undefined,
            notaDeAnuncio,
            ...(sinCorriente ? { cadenaApagada: true } : {}),
            ...(desconectadaAqui(pid) ? { desconectada: true } : {}),
          },
          deletable: false,
        });
        // DE LA ÚLTIMA DE CADA UNO DE SUS CAMINOS, y de nadie más: sin reemplazos (18/10/2026).
        // Sin caminos, todas son del principal y cuelgan del mismo `anterior` de siempre.
        const susCaminos = pieza.caminos ?? [pieza.camino ?? ""];
        posDeLaFicha.set(id, { x, y: yDeLaFicha });
        for (const deCamino of susCaminos) {
          // En la intro todos arrancan del Inicio: ahí se sortea por qué camino entra.
          const desdeSuCamino = esIntro ? anteriores.get("") : anteriores.get(deCamino);
          if (!desdeSuCamino || cables.some((x) => x.id === `c:${desdeSuCamino.id}->${id}`)) continue;
          // EL CABLE QUE ÉL CORTÓ NO SE DIBUJA; todos los demás, sí (el plano).
          if (esElCortado(desdeSuCamino.id, pid)) continue;
          const suya = !!clave && pieza.paises.includes(clave);
          // (Dentro de un tramo cortado, su ruta de verdad es la letra que le dio el bot.)
          const rutaReal = tramoCortado.has(pid) ? ([...letraOriginal].find(([, o]) => o === deCamino)?.[0] ?? deCamino) : deCamino;
          cables.push(
            cable(
              `c:${desdeSuCamino.id}->${id}`,
              desdeSuCamino.id,
              desdeSuCamino.handle,
              id,
              COLOR[e.tipo].trazo,
              () =>
                // CORTAR ES QUITAR ESTE CABLE Y NADA MÁS (18/10/2026). Ver `cortarCable`.
                acciones.cortarCable && suya
                  ? acciones.cortarCable(
                      pieza.id,
                      clave,
                      rutaReal,
                      (nodos.find((m) => m.id === desdeSuCamino.id)?.data as Partial<DatosDePieza> | undefined)?.pieza?.id
                    )
                  : susCaminos.length > 1 && acciones.quitarDelCamino
                  ? acciones.quitarDelCamino(pieza.id, deCamino)
                  : suya
                  ? // SE QUEDA DONDE ESTABA, tenue y suelta: «el cajón no debería desaparecer».
                    acciones.desconectar(pieza.id, clave, dondeEsta(id))
                  : avisar(
                      clave
                        ? `«${pieza.titulo}» no tiene país: vale para todos. Para sacarla solo de ${etiqueta}, ponle los países que sí deben recibirla (clic derecho → Conectar también a…).`
                        : "En «Otros países» no hay país que quitar."
                    ),
              // LA OFERTA NO VA «DESPUÉS» DEL ÚLTIMO SEGUIMIENTO: sale cuando el cliente quiere
              // pagar o elige método, en cualquier momento (17/10/2026). El cable lo dice.
              // (Los anuncios ya no se escriben en el cable: ensuciaba la pizarra. Ver la marca
              // «📣 N anuncios» de la tarjeta.)
              e.tipo === "ob" ? "cuando quiere pagar" : undefined
            )
          );
        }
        primero = primero ?? id;
        for (const deCamino of susCaminos) if (!primeroPorCamino.has(deCamino)) primeroPorCamino.set(deCamino, id);
        // «QUIERE COMPRAR», DE PALABRA (19/10/2026): a la oferta de su camino en COMO OB, a los
        // Pagos en las otras. Sin oferta en su camino no hay cable: ahí se marca «trabado».
        // EL CABLE LO PONE ÉL (19/10/2026): «yo debería hacer la conexión visualmente aunque sea
        // cosmético… para los nuevos usuarios». Se guarda como sus otros cables («país|ficha|
        // destino»: la sub pestaña de la oferta, o «pago:…»), se corta con su ✕, y sin él el
        // punto de la fila se ve hueco. Solo se dibuja si va adonde el bot va de verdad.
        // UNA FILA POR PRODUCTO en COMO DOU y en la intro de order bump (19/10/2026): ver
        // `filasDePalabraDe`.
        const palabras: FilaDePalabra[] = filasDePalabraDe(pieza, ventaQueSeDibuja).map((f) => {
          const destinos = f.a === "oferta" ? destinosDePalabra(pieza, clave) : [{ clave: `pago:${f.a}`, nodo: idPv(clave, `pago:${f.a}`) }];
          const puestos = destinos.filter((t) => puentes.includes(`${clave}|${pieza.id}|${t.clave}`));
          for (const t of puestos) {
            cables.push(
              cable(`w:${id}:${f.id}->${t.nodo}`, id, f.id, t.nodo, "#db2777", () =>
                acciones.quitarPuente?.(clave, pieza.id, t.clave)
              )
            );
          }
          return { id: f.id, texto: f.texto, destinos, conectada: destinos.length > 0 && puestos.length === destinos.length };
        });
        if (palabras.length > 0) {
          const nodo = nodos.find((n) => n.id === id);
          if (nodo) nodo.data = { ...(nodo.data as DatosDePieza), palabras };
        }
        // LOS BOTONES DE UNA COPIA QUE ESPERAN SU CABLE: aro en su punto, y sin cable dibujado.
        const sinCable = pieza.ramas.filter((r) => esperaAlPago(pieza, r) || loCorto(pieza, r)).map((r) => r.id);
        if (sinCable.length > 0) {
          const nodo = nodos.find((n) => n.id === id);
          if (nodo) nodo.data = { ...(nodo.data as DatosDePieza), ramasSinCable: sinCable };
        }
        // LAS RAMAS DE ESTA FICHA, con su destino al lado.
        pieza.ramas.forEach((r, i) => {
          const d = destinoDeLaRama(r);
          // UN CUADRITO QUE EL BOT NO LEE NO SE DIBUJA CONECTADO (17/10/2026). Él puso cuadritos al
          // final de la intro de order bump y la pizarra los unió a los pagos, pero el motor solo
          // lee cuadritos en la intro, el upsell y el regalo; y uno sin palabras no se activa en
          // ningún sitio. Se queda su recuadro, con el aviso.
          const noLoLee =
            // (sin palabras solo se avisa en la intro: en el upsell es el de «cualquier otra respuesta»)
            r.tipo === "cuadrito" && (pieza.tipo === "ob" || (r.sinPalabras && pieza.tipo === "intro"))
              ? pieza.tipo === "ob"
                ? "⚠ el bot no lee cuadritos aquí: usa botones"
                : "⚠ sin palabras clave: no se activa"
              : null;
          if (noLoLee) {
            const idDestino = `dest:${id}:${r.id}`;
            nodos.push({
              id: idDestino,
              type: "destino",
              position: { x: x + 275, y: yDeLaFicha + altoDe(pieza) - 70 - (pieza.ramas.length - i) * 34 },
              data: { piezaId: pieza.id, ramaId: r.id, icono: "⚠", texto: `${d.texto} · ${noLoLee.replace(/^⚠ /, "")}`, esMensaje: false },
              deletable: false,
            });
            cables.push(cable(`r:${id}:${r.id}`, id, `rama:${r.id}`, idDestino, "#f59e0b"));
            return;
          }
          // DE UNA COPIA, SU CABLE LO TIRA ÉL (20/10/2026: «el usuario no debe ver una conexión
          // automática»). El bot sí lo lleva; aquí queda su colita (el recuadro) sin conectar, igual
          // que en la original, y el aro en su punto, hasta que él la lleve al Pago o a la oferta.
          const esperaSuCable = esperaAlPago(pieza, r);
          // UN BOTÓN QUE ESPERA SU CABLE SIEMPRE ENSEÑA SU COLITA (20/10/2026): «me gusta el tema de
          // las colitas… al darle clic veo lo que hay ahí… es como un cable roto pero veo que
          // necesita conexión». Cortado por él o de una copia, en las tres semimodalidades: en vez
          // de su cable (directo a la oferta o al Pago) sale su recuadro, suelto y con el aro, y
          // desde su punto se vuelve a conectar. Conectado, se dibuja otra vez como siempre.
          const cortadoSinBurbuja = loCorto(pieza, r);
          // LA BURBUJA SE QUEDA SIEMPRE EN EL CABLE (20/10/2026): «me gustan las burbujitas de los
          // cables porque al darle clic me muestran qué hay dentro… y la reconexión desde la punta de
          // la burbuja es genial». Todo botón que va a la oferta o a un Pago se dibuja botón →
          // burbuja → destino, conectado o no, en las tres semimodalidades (cada una con lo suyo).
          // EN COMO OB, «ELEGIR» ANTES DE LA OFERTA ES DESTAPARLA (17/10/2026). Así lo hace el
          // motor —`ejecutarAccion`: «choose_combo/choose_basico» y «show_payment» presentan
          // primero la oferta si el producto oculto sigue tapado (commit c37696d, 27/09)—, así
          // que su cable va a la oferta. Lo había dibujado yendo al Pago, y no es lo que pasa.
          const suOferta = ofertaPara(pieza);
          const vaALaOferta =
            !!suOferta &&
            (r.accion === "show_order_bump" ||
              (pieza.tipo !== "ob" && (r.accion === "choose_basico" || r.accion === "choose_combo" || r.accion === "show_payment")));
          // LA ELECCIÓN LLEVA A SU PAGO (17/10/2026): «si dice GRAFISMO se dirige hacia grafismo,
          // yo debería poder conectarlo». «Elige el BÁSICO» va al pago del básico, «Elige el
          // FULL» al del full; con un solo producto, «Métodos de pago» va a su pago.
          // En COMO OB, solo los botones DE LA OFERTA llevan al pago: los de antes van a la oferta
          // (arriba), y si este país no tiene oferta, se queda su recuadro con el aviso (abajo).
          const pagoDeLaRama =
            hayOferta && pieza.tipo !== "ob"
              ? null
              : dosProductos && r.accion === "choose_basico"
              ? "basico"
              : dosProductos && r.accion === "choose_combo"
                ? "full"
                : !dosProductos && r.accion === "show_payment"
                  ? "unico"
                  : null;
          const idDestino = `dest:${id}:${r.id}`;
          // LO QUE EL MOTOR HACE DE VERDAD CON ESA ACCIÓN AQUÍ, dicho en el recuadro:
          //  · «Elegir» con UN solo producto no hace nada (`ejecutarAccion`: «esta modalidad no
          //    vende dos opciones → esa acción no hace nada»).
          //  · «Datos de un método» en COMO OB manda los datos SIN mostrar antes la oferta: esa
          //    acción no tiene el candado del 27/09. Es del motor y no se toca: se avisa.
          // (Con su mensaje sí hace algo: el bot lo manda ANTES de la acción —`sendConfiguredSteps`
          // y luego `ejecutarAccion` en engine.ts—, y ahí suelen ir los datos de pago.)
          const texto =
            !dosProductos && (r.accion === "choose_basico" || r.accion === "choose_combo") && r.mensajes === 0
              ? `${d.texto} · ⚠ con un producto no hace nada`
              : hayOferta && !ofertaDelCarril.has(clave) && pieza.tipo !== "ob" &&
                  (r.accion === "choose_basico" || r.accion === "choose_combo" || r.accion === "show_payment")
                ? `${d.texto} · ⚠ ${etiqueta} no tiene intro de order bump`
              : ofertaDelCarril.has(clave) && pieza.tipo !== "ob" && r.accion === "send_payment_method"
                ? `${d.texto} · ⚠ sin mostrar antes la oferta`
                : d.texto;
          // Y DE SU MENSAJE AL PAGO (18/10/2026): «que pase primero por la burbuja y luego al pago».
          // Una rama que elige o pide pagar lleva al cliente al Pago (sus datos van en el mensaje
          // o los manda el bot). Con dos productos, «pagar» o «datos de un método» sirve a los dos.
          const pagosDelMensaje =
            !dosProductos && (r.accion === "choose_basico" || r.accion === "choose_combo") && r.mensajes === 0
              ? []
              : r.accion === "choose_basico"
              ? [dosProductos ? "basico" : "unico"]
              : r.accion === "choose_combo"
                ? [dosProductos ? "full" : "unico"]
                : r.accion === "show_payment" || r.accion === "send_payment_method"
                  ? dosProductos
                    ? ["basico", "full"]
                    : ["unico"]
                  : [];
          nodos.push({
            id: idDestino,
            type: "destino",
            position: { x: x + 275, y: yDeLaFicha + altoDe(pieza) - 70 - (pieza.ramas.length - i) * 34 },
            data: {
              piezaId: pieza.id,
              ramaId: r.id,
              icono: d.icono,
              texto,
              esMensaje: !r.accion || r.accion === "send_steps",
              alPago: pagosDelMensaje.length > 0,
              // El aro en su punto: botón vacío, o cable al Pago cortado por él / de una copia.
              vacio: ((!r.accion || r.accion === "send_steps") && r.mensajes === 0) || esperaSuCable || cortadoSinBurbuja,
            },
            deletable: false,
          });
          // (De una copia que espera su cable al Pago, o de un cable que él cortó, la colita queda
          // suelta: sin este cable solo.) EL TRAMO QUE SE CORTA ES ÉSTE, el de la burbuja al Pago
          // (20/10/2026): la burbuja es el mensaje de su botón y se queda pegada a él.
          // Adónde sigue desde la burbuja: la oferta, su Pago, o los Pagos de su mensaje.
          const alFinal = vaALaOferta
            ? [suOferta!]
            : pagoDeLaRama
              ? [idPv(clave, `pago:${pagoDeLaRama}`)]
              : pagosDelMensaje.map((q) => idPv(clave, `pago:${q}`));
          if (!esperaSuCable && !cortadoSinBurbuja)
            for (const destinoFinal of alFinal)
              cables.push(cable(`m:${idDestino}->${destinoFinal}`, idDestino, "sale", destinoFinal, "#0d9488", alCortarLaRama(pieza.id, r.id)));
          cables.push(cable(`r:${id}:${r.id}`, id, `rama:${r.id}`, idDestino, AZUL_RAMA));
        });
        yDeLaFicha += altoDe(pieza);
      }
      if (primero) {
        const nuevos = new Map([...primeroPorCamino].map(([c, idDe]) => [c, { id: idDe, handle: "sale" }] as const));
        // UN CAMINO SIN FICHA EN ESTE PASO TERMINA AQUÍ (18/10/2026): sin reemplazos, «no se
        // conecta y punto». Si hay caminos en este país, se marca dónde se queda.
        for (const [c, a] of anteriores) {
          if (nuevos.has(c) || !hayCaminosEnElPais || esInicio(a.id)) continue;
          finesDeCamino.push({ camino: c, desde: a.id });
        }
        anteriores = nuevos;
        anterior = nuevos.get("") ?? { id: primero, handle: "sale" };
      }
      altoDelCarril = Math.max(altoDelCarril, yDeLaFicha - yFichas);
    });

    // DÓNDE TERMINA CADA CAMINO (18/10/2026): «el usuario debe tener el control del camino y saber
    // dónde se queda». Una marca corta al lado de su última ficha.
    for (const fin of finesDeCamino) {
      const donde = posDeLaFicha.get(fin.desde);
      if (!donde) continue;
      nodos.push({
        id: `fin:${clave}:${fin.camino || "principal"}:${fin.desde}`,
        type: "etiqueta",
        position: { x: donde.x + 280, y: donde.y - 4 },
        data: { texto: `🛑 ${fin.camino ? `Camino ${fin.camino}` : "Principal"} termina aquí`, color: "#b91c1c" } satisfies DatosDeEtiqueta,
        deletable: false,
        draggable: false,
      });
    }
    // Y EN COMO OB, LOS QUE NO LLEGAN A NINGUNA INTRO DE ORDER BUMP: el bot los deja trabados.
    if (hayOferta && hayCaminosEnElPais) {
      const colOferta = modelo.estaciones.findIndex((e) => e.tipo === "ob");
      const colIntro = modelo.estaciones.findIndex((e) => e.tipo === "intro");
      const deLaCelda = (col: number) =>
        new Set((celdas[col]?.piezas ?? []).flatMap((pid) => piezaPorId.get(pid)?.caminos ?? [piezaPorId.get(pid)?.camino ?? ""]));
      const llegan = deLaCelda(colOferta);
      const sinOferta = [...deLaCelda(colIntro)].filter((c) => !llegan.has(c));
      if (colOferta >= 0 && sinOferta.length > 0) {
        nodos.push({
          id: `fin:${clave}:sin-oferta`,
          type: "etiqueta",
          position: { x: X_PRIMERA_COLUMNA + colOferta * ANCHO_DE_COLUMNA, y: yFichas - 34 },
          data: {
            texto: `🛑 ${sinOferta.map((c) => (c ? `Camino ${c}` : "Principal")).join(", ")}: sin intro de order bump, se queda trabado`,
            color: "#b91c1c",
          } satisfies DatosDeEtiqueta,
          deletable: false,
          draggable: false,
        });
      }
    }

    // (LAS RAMAS QUE LLEVAN A LA OFERTA DE 2 OPCIONES se unían aquí a su ficha. Desde el 20/10/2026
    // van por su burbuja, con las demás ramas: ver «LA BURBUJA SE QUEDA SIEMPRE EN EL CABLE».)

    // LOS SALTOS QUE ÉL DIBUJÓ (17/10/2026): si falta un paso, el bot pasa al siguiente, pero
    // el cable no se pone solo; lo pone él, y se queda.
    for (const pu of puentes) {
      const [pPais, deId, aId] = pu.split("|");
      if (pPais !== clave) continue;
      const nodoDe = nodos.find((n) => n.type === "pieza" && (n.data as DatosDePieza).pais === clave && (n.data as DatosDePieza).pieza.id === deId && n.id.startsWith("pz:"));
      const nodoA = nodos.find((n) => n.type === "pieza" && (n.data as DatosDePieza).pais === clave && (n.data as DatosDePieza).pieza.id === aId && n.id.startsWith("pz:"));
      // Solo se salta si ya hay un cable DEL CAMINO entre las dos (no uno de sus botones).
      if (!nodoDe || !nodoA || cables.some((c) => c.source === nodoDe.id && c.target === nodoA.id && c.sourceHandle === "sale")) continue;
      const aPieza = (nodoA.data as DatosDePieza).pieza;
      // A LA OFERTA LLEVA SU FILA «QUIERE COMPRAR» O SU BOTÓN (19/10/2026): el cable que él
      // dibujó se guarda, pero no se pinta. Lo que dice si llega a la oferta es esa fila: si su
      // camino no tiene oferta, no tiene cable (y sale «trabado»), aunque él lo hubiera dibujado.
      if (aPieza.tipo === "ob" && (nodoDe.data as DatosDePieza).pieza.tipo !== "ob") continue;
      cables.push(
        cable(`p:${nodoDe.id}->${nodoA.id}`, nodoDe.id, "sale", nodoA.id, COLOR[aPieza.tipo].trazo, () =>
          // CORTARLO QUITA ESTE CABLE Y NADA MÁS (18/10/2026): «corté uno de los cables y se
          // cortaron los 3… no puede haber cortes de ese tipo». Antes sacaba del país la ficha de
          // destino (la intro de order bump), y con ella se iban los cables de las demás.
          acciones.quitarPuente
            ? acciones.quitarPuente(clave, deId, aId)
            : acciones.desconectar(aPieza.id, clave, dondeEsta(nodoA.id))
        )
      );
    }

    // SIN ENTRADA, UN PUNTO ROJO (18/10/2026): «si hay un puente sin conexión debería haber aunque
    // sea un punto rojo que indique que ahí termina, pero no reconectar». Una ficha de este país
    // (que no sea la intro) a la que no le llega ningún cable lo dice, sin que nada se mueva solo.
    const conEntrada = new Set(cables.map((x) => x.target));
    for (const n of nodos) {
      if (n.type !== "pieza" || !n.id.startsWith(`pz:${clave}:`) || conEntrada.has(n.id)) continue;
      const dp = n.data as DatosDePieza;
      if (dp.pieza.tipo === "intro") continue;
      n.data = { ...dp, sinEntrada: true };
    }

    // ── LA POSTVENTA DE ESTE PAÍS, en su propia fila (17/10/2026) ──────────────────────
    // «Cada país sigue su camino completo», sin cruces: Pago → Entrega → su Upsell → Regalo.
    // Lo que es igual en todos (las entregas y el regalo) lleva «🔗 la misma en todos».
    const ultimo = anterior as { id: string; handle: string } | null;
    // UN PAÍS VACÍO SE VE VACÍO (17/10/2026): «al agregar un nuevo cuadro aparecen nuevos pagos…
    // debería aparecer la zona del recuadro pero vacía». La postventa sale cuando tiene algo.
    const tieneAlgo = nodos.some(
      (n) => n.id.startsWith(`pz:${clave}:`) || n.id.startsWith(`hueco:${clave}:`) || n.id.startsWith(`prest:${clave}:`)
    );
    const otrosUltimos = [...anteriores].filter(([c]) => !!c).map(([, a]) => a);
    const finDelCarril = tieneAlgo
      ? postventaDelCarril(clave, etiqueta, ancho + 40, yFichas, ultimo, otrosUltimos)
      : { x: ancho, alto: 120 };
    altoDelCarril = Math.max(altoDelCarril, finDelCarril.alto);
    anchoTotal = Math.max(anchoTotal, finDelCarril.x);

    carriles.push({ clave, etiqueta, sinIntro });
    // SU INICIO, AL LADO DE SU RECUADRO (19/10/2026). Se mueve como cualquier ficha y su sitio
    // se guarda con los demás.
    nodos.push({
      id: idDelInicio(clave),
      type: "inicio",
      // A la izquierda de su recuadro, esté donde él lo haya dejado.
      position: { x: (ancla?.x ?? X_PRIMERA_COLUMNA - 30) - 300, y: (ancla ? ancla.y : y - 10) + 30 },
      data: {
        carril: { clave, etiqueta, sinIntro },
        vende: clave ? acciones.ventaDelPais?.(clave) : undefined,
        otros: carriles.length === 1 ? otrosEnElInicio : undefined,
        rutas: clave ? acciones.numerosDeLasRutas?.(clave) : undefined,
        revision: clave ? acciones.enRevision?.(clave) : undefined,
      },
      deletable: false,
    });
    const alto = MARGEN_DEL_CARRIL + altoDelCarril + 20;
    cajasDeFabrica.push({
      id: `caja:carril:${clave || "otros"}`,
      x: X_PRIMERA_COLUMNA - 30,
      y: y - 10,
      ancho: finDelCarril.x - X_PRIMERA_COLUMNA + 60,
      alto,
      titulo: `${bandera} ${etiqueta}${tieneAlgo ? "" : " · vacío: conecta su intro desde el Inicio"}`.trim(),
    });
    yLibre = Math.max(yLibre, y + alto + ESPACIO_ENTRE_CARRILES, ancla ? ancla.y + ancla.alto + ESPACIO_ENTRE_CARRILES : 0);
    y = yLibre;
  });


  // LAS SUELTAS QUE ÉL QUIERE VER, en su sitio. Las demás viven en «Fichas guardadas».
  const deEstacion = new Map<string, EstacionDePizarra>();
  for (const e of modeloEntero.estaciones) for (const pid of e.piezas) deEstacion.set(pid, e);
  // DIBUJADAS = las que ya se ven en la pizarra (en un camino, tenues en un hueco o en la
  // tarjeta del upsell): ésas no van al panel «Fichas guardadas».
  const dibujadas = new Set([
    ...nodos.filter((n) => n.type === "pieza").map((n) => (n.data as DatosDePieza).pieza.id),
    ...nodos.filter((n) => n.type === "upsell").flatMap((n) => (n.data as DatosDeUpsell).filas.map((p) => p.id)),
    // Y las que viven dentro de un cajón (19/10/2026).
    ...nodos.filter((n) => n.type === "fijo").flatMap((n) => (n.data as DatosDeFijo).piezasDentro ?? []),
  ]);
  let i = 0;
  for (const pid of visibles) {
    if (dibujadas.has(pid)) continue;
    const pieza = piezaPorId.get(pid);
    if (!pieza) continue;
    const e = deEstacion.get(pid);
    nodos.push({
      id: `suelta:${pid}`,
      type: "pieza",
      position: { x: X_PRIMERA_COLUMNA + (i % 4) * 300, y: y + 60 + Math.floor(i / 4) * 260 },
      data: {
        pieza,
        cuando: e?.cuando,
        pais: "",
        estacion: e?.id ?? "",
        suelta: true,
        // Sus botones copiados que esperan cable: con su aro desde que se pega.
        ramasSinCable: pieza.ramas.filter((r) => esperaAlPago(pieza, r)).map((r) => r.id),
        aviso: "Sin conectar: el bot no la manda. Para usarla, arrastra hasta su punto verde el punto naranja de la anterior en la fila de un país.",
      },
      deletable: false,
    });
    i++;
  }
  // «COMÚN N»: cada sub pestaña con VARIOS países, numerada en el orden del camino. La misma
  // lleva el mismo número en todas las filas donde aparece.
  const comunes = new Map<string, number>();
  for (const e of modeloEntero.estaciones)
    for (const pid of e.piezas)
      if ((piezaPorId.get(pid)?.paises.length ?? 0) > 1 && !comunes.has(pid)) comunes.set(pid, comunes.size + 1);
  for (const n of nodos) {
    if (n.type === "pieza") {
      const d = n.data as DatosDePieza;
      const k = comunes.get(d.pieza.id);
      if (k) n.data = { ...d, comun: k };
    } else if (n.type === "upsell") {
      const d = n.data as DatosDeUpsell;
      n.data = { ...d, comunes: Object.fromEntries(d.filas.flatMap((p) => (comunes.has(p.id) ? [[p.id, comunes.get(p.id)!]] : []))) };
    }
  }
  // LOS CABLES DE UN GRUPO PEGADO (17/10/2026): entre copias SUELTAS, tal como estaban en el
  // original. Grises y punteados: son solo de la pizarra. Al conectar una a un país, se conecta
  // todo el grupo (ver `conectar` en el editor) y estos cables dejan de hacer falta.
  for (const enlace of enlaces) {
    const [de, a] = enlace.split("|");
    const idDe = `suelta:${de}`;
    const idA = `suelta:${a}`;
    if (!nodos.some((n) => n.id === idDe) || !nodos.some((n) => n.id === idA)) continue;
    const c = cable(`enlace:${enlace}`, idDe, "sale", idA, GRIS_DEL_GRUPO, () => acciones.quitarEnlace?.(de, a));
    cables.push({ ...c, style: { ...(c.style ?? {}), strokeDasharray: "6 4" } });
  }
  // LO PUESTO «COMÚN» EN OTRO PAÍS, AÚN SIN CONECTAR (20/10/2026): «hacerla común no significa que
  // hay que conectarla automáticamente». Tenue, al final de la fila de ese país; su cable la conecta.
  // Una que ya se conectó a ese país no sale (ya está en su camino).
  const pendientesPorPais = new Map<string, number>();
  for (const entrada of comunesSinConectar) {
    const [pais, pid, grupo = ""] = entrada.split("|");
    const pieza = piezaPorId.get(pid);
    const caja = cajasDeFabrica.find((c) => c.id === `caja:carril:${pais}`);
    if (!pieza || !caja || pieza.paises.includes(pais)) continue;
    const k = pendientesPorPais.get(pais) ?? 0;
    pendientesPorPais.set(pais, k + 1);
    const e = modeloEntero.estaciones.find((x) => x.piezas.includes(pid));
    const id = `comun:${pais}:${pid}`;
    nodos.push({
      id,
      type: "pieza",
      position: guardadaEn(id) ?? { x: caja.x + Math.max(40, caja.ancho - 320), y: caja.y + 50 + k * 70 },
      data: {
        pieza,
        cuando: e?.cuando,
        pais: "",
        estacion: e?.id ?? "",
        suelta: true,
        comunPendiente: { pais, grupo },
        aviso: `COMÚN · sin conectar en ${banderaDe(pais)} ${pais}: es la MISMA ficha de ${pieza.paises.map(banderaDe).join(" ")} (si la editas, cambia en todos). El bot no la manda aquí hasta que la conectes con un cable. Clic derecho: quitarla de ${pais}.`,
      } satisfies DatosDePieza,
      deletable: false,
    });
  }
  // LOS CAJONES DE COBRO Y DE SEGUIMIENTOS (19/10/2026), sobre lo ya dibujado.
  const conCajones = acciones.abrirGestor ? enCajones(nodos, cables, guardadaEn) : { nodos, cables, reales: cables };
  return {
    nodos: conLaCadena(conCajones.nodos, conCajones.cables),
    cables: delColorDeQuienParte(conCajones.nodos, conCajones.cables),
    cablesReales: conCajones.reales,
    cajasDeFabrica,
    dibujadas,
  };
}

/**
 * SIN ROSCA 1, LA 2 NO FUNCIONA (20/10/2026): «si apago la rosca 1, el seguimiento también se
 * apaga». Se sigue la corriente desde cada Inicio por los cables; no pasa por una ficha apagada ni
 * por un cajón apagado. Las fichas y cajones de seguimientos de un país a los que no llega se ven
 * tenues («NO LE LLEGA»), con sus cables. Un país APAGADO (no vende y no está en revisión) no reparte
 * corriente: se ve tenue entero. Solo pantalla.
 */
function conLaCadena(nodos: Node[], cables: Edge[]): Node[] {
  const porId = new Map(nodos.map((n) => [n.id, n]));
  const salen = new Map<string, string[]>();
  for (const c of cables) salen.set(c.source, [...(salen.get(c.source) ?? []), c.target]);
  const corta = (n: Node | undefined) =>
    !!n &&
    ((n.type === "pieza" && (n.data as DatosDePieza).pieza.estado === "apagada") ||
      (n.type === "cajon" && !!(n.data as DatosDeCajon).apagado));
  const recorrer = (desde: string[], pasaPorApagadas: boolean): Set<string> => {
    const vistos = new Set<string>();
    const pila = [...desde];
    while (pila.length > 0) {
      const id = pila.pop()!;
      if (vistos.has(id)) continue;
      vistos.add(id);
      if (!pasaPorApagadas && corta(porId.get(id))) continue;
      for (const t of salen.get(id) ?? []) if (!vistos.has(t)) pila.push(t);
    }
    return vistos;
  };
  const llega = recorrer(nodos.filter((n) => n.type === "inicio").map((n) => n.id), false);
  // SOLO SE ATENÚA LO QUE DE VERDAD NO RECIBE A NADIE (20/10/2026): un hueco en medio del camino no
  // cuenta (el bot salta al paso siguiente), así que no basta con «no le llega cable». Tenue es:
  //   · lo que va detrás de una ficha que él apagó aquí;
  //   · lo de una ruta a la que no llega ninguna intro de su país (un tramo cortado);
  //   · todo un país apagado (no vende y no está en revisión).
  // (Y lo de detrás de lo que él cortó: el plano ya marca tenue su tramo o la desconectada.)
  const detrasDeApagadas = recorrer(
    nodos
      .filter(
        (n) =>
          n.type === "pieza" &&
          !!(n.data as DatosDePieza).pais &&
          ((n.data as DatosDePieza).pieza.estado === "apagada" || !!(n.data as DatosDePieza).cadenaApagada)
      )
      .map((n) => n.id),
    true
  );
  const paisesApagados = new Set(
    nodos
      .filter((n) => n.type === "inicio" && (n.data as DatosDeInicio).vende === false && !(n.data as DatosDeInicio).revision)
      .map((n) => (n.data as DatosDeInicio).carril.clave)
  );
  const rutasVivas = new Map<string, Set<string>>();
  for (const n of nodos) {
    if (n.type !== "pieza") continue;
    const d = n.data as DatosDePieza;
    if (!d.pais || d.suelta || d.pieza.tipo !== "intro" || d.pieza.estado === "apagada" || !llega.has(n.id)) continue;
    const s = rutasVivas.get(d.pais) ?? new Set<string>();
    for (const r of d.pieza.caminos ?? [d.pieza.camino ?? ""]) s.add(r);
    rutasVivas.set(d.pais, s);
  }
  // (Un país sin ninguna intro no se atenúa entero: eso ya lo dice su Inicio anaranjado.)
  const huerfana = (d: DatosDePieza) => {
    const vivas = rutasVivas.get(d.pais);
    return d.pieza.tipo !== "intro" && !!vivas && vivas.size > 0 && !(d.pieza.caminos ?? [d.pieza.camino ?? ""]).some((r) => vivas.has(r));
  };
  const sinCorriente = (n: Node, d: DatosDePieza) =>
    paisesApagados.has(d.pais) || (!llega.has(n.id) && (detrasDeApagadas.has(n.id) || huerfana(d)));
  return nodos.map((n) => {
    if (n.type === "pieza") {
      const d = n.data as DatosDePieza;
      if (!d.pais || d.suelta || d.comunPendiente || d.pieza.estado === "apagada" || !sinCorriente(n, d)) return n;
      return { ...n, data: { ...d, cadenaApagada: true } };
    }
    if (n.type === "cajon") {
      const d = n.data as DatosDeCajon;
      if (d.tipo !== "seguimientos" || !d.pais || d.soloEstas || d.comunDe || d.apagado) return n;
      const dentro = d.dentro.map((id) => porId.get(id)).filter((x): x is Node => !!x && x.type === "pieza");
      const tenue =
        paisesApagados.has(d.pais) ||
        (dentro.length > 0 && dentro.every((x) => !!(x.data as DatosDePieza).cadenaApagada)) ||
        (!llega.has(n.id) && (detrasDeApagadas.has(n.id) || (dentro.length > 0 && dentro.every((x) => huerfana(x.data as DatosDePieza)))));
      return tenue ? { ...n, data: { ...d, apagado: true } } : n;
    }
    return n;
  });
}

/** El color de la banda de arriba de una tarjeta: el que llevan los cables que salen de ella. */
function colorDeLaTarjeta(n: Node | undefined): string | null {
  if (!n) return null;
  if (n.type === "pieza") return COLOR[(n.data as DatosDePieza).pieza.tipo]?.trazo ?? null;
  if (n.type === "upsell") return COLOR.upsell.trazo;
  if (n.type === "inicio") return "#059669";
  if (n.type === "prestada") return ROJO;
  if (n.type === "cajon") return (n.data as DatosDeCajon).tipo === "cobro" ? "#0d9488" : COLOR.seguimiento.trazo;
  if (n.type === "fijo") {
    const colores: Record<DatosDeFijo["tipo"], string> = {
      pago: "#0d9488",
      entrega: "#059669",
      regalo: "#ec4899",
      upsell: COLOR.upsell.trazo,
      enlace: "#d946ef",
      despedida: "#64748b",
    };
    return colores[(n.data as DatosDeFijo).tipo] ?? null;
  }
  return null;
}

/**
 * EL CABLE LLEVA EL COLOR DE DONDE SALE (20/10/2026): «el color del cable no es el del que recibe
 * sino del que parte… de la intro, azul; de los seguimientos, anaranjado». La burbuja de un botón
 * no tiene color propio: su cable sigue con el de la tarjeta de su botón, de punta a punta. El rojo
 * del aviso (le llega la ficha de otro país) se queda rojo: es un aviso, no una conexión suya.
 */
function delColorDeQuienParte(nodos: Node[], cables: Edge[]): Edge[] {
  const porId = new Map(nodos.map((n) => [n.id, n]));
  const colorDe = (id: string, vistos = 0): string | null => {
    const n = porId.get(id);
    if (n?.type === "destino" && vistos < 3) {
      const entra = cables.find((c) => c.target === id);
      return entra ? colorDe(entra.source, vistos + 1) : null;
    }
    return colorDeLaTarjeta(n);
  };
  return cables.map((c) => {
    if ((c.style as { stroke?: string } | undefined)?.stroke === ROJO) return c;
    const color = colorDe(c.source);
    return color ? { ...c, style: { ...(c.style ?? {}), stroke: color } } : c;
  });
}

/**
 * LO QUE APARECE SOLO, ACOMODADO COMO EL PRIMER PAÍS (17/10/2026): «quisiera que cuando aparezcan
 * las burbujitas por default… se alineen como la primera de Perú, o quien esté primero». Una
 * tarjeta de un país que él nunca movió toma el sitio que tiene su igual en el primer país (de
 * arriba abajo) donde sí la movió, corrido lo que separa a los dos países. Lo que él ya movió no
 * se toca; si ningún país tiene su igual acomodada, queda donde la pone la pizarra.
 *
 * «Su igual»: la misma tarjeta en el otro país. Para la postventa es el mismo nombre con el otro
 * país; para las fichas, la misma posición dentro de su estación (la 1.ª intro con la 1.ª intro);
 * para los destinos de sus botones, el mismo puesto bajo su ficha.
 */
function conLaFormaDelPrimero(nodos: Node[], cajasDeFabrica: CajaDePizarra[], guardadas: Record<string, Punto>): Node[] {
  const paises = cajasDeFabrica
    .filter((c) => c.id.startsWith("caja:carril:"))
    .map((c) => {
      const k = c.id.slice("caja:carril:".length);
      return k === "otros" ? "" : k;
    });
  if (paises.length < 2) return nodos;
  const porId = new Map(nodos.map((n) => [n.id, n]));
  const deQuePais = (id: string): string | null => {
    const m = /^(?:dest:)?(pz|hueco|prest|pv):([^:]*):/.exec(id);
    if (!m) return null;
    return m[1] === "pv" && m[2] === "otros" ? "" : m[2];
  };
  // EL MODELO es el primer país, de arriba abajo, que él ya acomodó. Ese no se toca nunca.
  const modelo = paises.find((p) => Object.keys(guardadas).some((k) => deQuePais(k) === p && porId.has(k)));
  if (modelo === undefined) return nodos;
  /** Su estación: «intro», «ob», «upsell» o «seg:N» (que lleva sus dos puntos). */
  const estacionDe = (resto: string) => (resto.startsWith("seg:") ? resto.split(":").slice(0, 2).join(":") : resto.split(":")[0]);
  /** Las tarjetas de una estación de un país, en orden. */
  const enOrden = (prefijo: string) => nodos.filter((n) => n.id.startsWith(prefijo));
  /** Dónde empieza el recuadro de cada país: lo que los separa es lo único que se corre. */
  const arribaDe = (pais: string) => cajasDeFabrica.find((c) => c.id === `caja:carril:${pais || "otros"}`)?.y ?? 0;
  /** Su igual en el país `r`. */
  const igual = (id: string, de: string, r: string): string | null => {
    const pvDe = `pv:${de || "otros"}:`;
    if (id.startsWith(pvDe)) return `pv:${r || "otros"}:${id.slice(pvDe.length)}`;
    for (const tipo of ["pz", "hueco", "prest"]) {
      const pre = `${tipo}:${de}:`;
      if (!id.startsWith(pre)) continue;
      const est = estacionDe(id.slice(pre.length));
      const k = enOrden(`${pre}${est}:`).findIndex((n) => n.id === id);
      return k < 0 ? null : enOrden(`${tipo}:${r}:${est}:`)[k]?.id ?? null;
    }
    if (id.startsWith("dest:")) {
      const padre = nodos
        .filter((n) => id.startsWith(`dest:${n.id}:`))
        .sort((a, b) => b.id.length - a.id.length)[0];
      if (!padre) return null;
      const suPadre = igual(padre.id, de, r);
      if (!suPadre) return null;
      const hermanos = nodos.filter((n) => n.id.startsWith(`dest:${padre.id}:`));
      const k = hermanos.findIndex((n) => n.id === id);
      return nodos.filter((n) => n.id.startsWith(`dest:${suPadre}:`))[k]?.id ?? null;
    }
    return null;
  };
  return nodos.map((n) => {
    if (guardadas[n.id] || n.type === "caja" || n.id.startsWith("suelta:")) return n;
    const de = deQuePais(n.id);
    if (de === null || de === modelo || !paises.includes(de)) return n;
    const otra = igual(n.id, de, modelo);
    const suSitio = otra && porId.has(otra) ? guardadas[otra] : undefined;
    if (!suSitio) return n;
    // La misma columna que en el modelo, y bajada lo que separa a los dos países.
    return { ...n, position: { x: suSitio.x, y: suSitio.y + (arribaDe(de) - arribaDe(modelo)) } };
  });
}

/** Las guardadas en grupos, en el orden del camino: intros, cada seguimiento, oferta, upsell. */
function gruposDelPanel(piezas: PiezaDePizarra[]): Array<{ titulo: string; piezas: PiezaDePizarra[] }> {
  const grupos = new Map<string, { orden: number; titulo: string; piezas: PiezaDePizarra[] }>();
  for (const p of piezas) {
    const [tipo, a] = p.id.split(":");
    const n = Number(a);
    const [orden, titulo] =
      tipo === "intro" ? [0, "Intros"]
      : tipo === "seg" ? [10 + n, `Seguimiento ${n + 1}`]
      : tipo === "ob" ? [500, "Intros de order bump"]
      : tipo === "up" ? [600, "Upsell"]
      : [900, "Otras"];
    const g = grupos.get(titulo) ?? { orden, titulo, piezas: [] };
    g.piezas.push(p);
    grupos.set(titulo, g);
  }
  return [...grupos.values()].sort((x, y) => x.orden - y.orden);
}

// ══ EL COMPONENTE ══════════════════════════════════════════════════════════════

const paraBuscar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function LienzoDePizarra({
  modelo,
  acciones,
  disposicion,
  probando = null,
  buscar = "",
  temaDeLaPizarra,
  pedidoDeCaja = 0,
  registrarPosiciones,
  claveDeLaVista,
}: {
  /** De qué pizarra se trata (tienda, canal y forma de vender): para recordar qué parte se miraba. */
  claveDeLaVista?: string;
  /** Le da al editor una forma de saber DÓNDE está ahora cada sub pestaña: lo que deja de
   *  salir por un cambio se queda en ese sitio, no se va solo a ninguna parte. */
  registrarPosiciones?: (dondeEstaLaPieza: (piezaId: string, pais?: string) => Punto | undefined) => void;
  modelo: ModeloDePizarra;
  acciones: AccionesDelLienzo;
  /** Lo guardado de esta tienda y canal: posiciones y cajas. */
  disposicion: DisposicionDePizarra;
  probando?: string | null;
  buscar?: string;
  temaDeLaPizarra?: "claro" | "oscuro";
  /** Cada vez que sube, se añade una caja nueva en el centro de la vista. */
  pedidoDeCaja?: number;
}) {
  const temaDelEditor = useTemaDelEditor();
  const tema = temaDeLaPizarra ?? temaDelEditor;
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => {
    if (!aviso) return;
    const t = window.setTimeout(() => setAviso(null), 7000);
    return () => window.clearTimeout(t);
  }, [aviso]);

  // Lo último de todo, para que nada trabaje con una foto vieja.
  const vivo = useRef({ disposicion, acciones });
  vivo.current = { disposicion, acciones };
  /**
   * LA PARTE DE LA PIZARRA QUE SE MIRABA, RECORDADA (20/10/2026): al recargar se vuelve ahí, sin
   * encuadrar todo de nuevo. En este navegador; sin almacenamiento, se encuadra todo como siempre.
   */
  const vistaGuardada = useMemo(() => {
    if (!claveDeLaVista) return undefined;
    try {
      const v = JSON.parse(window.localStorage.getItem(`pizarra-mirada:${claveDeLaVista}`) ?? "null") as { x: number; y: number; zoom: number } | null;
      return v && [v.x, v.y, v.zoom].every((n) => Number.isFinite(n)) && v.zoom > 0 ? v : undefined;
    } catch {
      return undefined;
    }
    // Solo al abrir esta pizarra.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const recordarMirada = (v: { x: number; y: number; zoom: number }) => {
    if (!claveDeLaVista || ![v.x, v.y, v.zoom].every((n) => Number.isFinite(n))) return;
    try {
      window.localStorage.setItem(`pizarra-mirada:${claveDeLaVista}`, JSON.stringify(v));
    } catch {}
  };

  /** Dónde está AHORA cada nodo, con lo que él movió. Se lee al cortar un cable. */
  const nodosVivos = useRef<Node[]>([]);
  /** Lo elegido antes de un recuadro de Shift: el recuadro lo suma, no lo reemplaza. */
  const sumando = useRef<Set<string> | null>(null);
  const dondeEsta = (nodoId: string): Punto | undefined => {
    const n = nodosVivos.current.find((x) => x.id === nodoId);
    return n ? { x: Math.round(n.position.x), y: Math.round(n.position.y) } : undefined;
  };
  // CADA SEMIMODALIDAD CON LO SUYO A LA VISTA (18/10/2026): la lista guardada es una para las
  // tres; aquí solo se DIBUJAN las que son de la que se está viendo (o de todas). La lista no se
  // toca: `guardar` escribe la de `disposicion`, entera, y al volver a la otra vista siguen ahí.
  const deOtraSemi = new Set(modelo.piezas.filter((p) => p.deOtraSemi).map((p) => p.id));
  const visibles = (disposicion.visibles ?? []).filter((id) => !deOtraSemi.has(id));
  // LOS FONDOS GUARDADOS DE CADA PAÍS, y hasta dónde llega lo que él ya colocó.
  const anclas = new Map(
    (disposicion.cajas ?? [])
      .filter((c) => c.id.startsWith("caja:carril:"))
      .map((c) => {
        const clave = c.id.slice("caja:carril:".length);
        return [clave === "otros" ? "" : clave, { x: c.x, y: c.y, alto: c.alto }] as const;
      })
  );
  const fondoOcupado = Math.max(
    0,
    ...Object.values(disposicion.posiciones).map((p) => p.y + 320),
    ...(disposicion.cajas ?? []).map((c) => c.y + c.alto + ESPACIO_ENTRE_CARRILES)
  );
  const claveDeAnclas = [...anclas].map(([k, v]) => `${k}:${v.y}:${v.alto}`).join(",");
  const base = useMemo(
    () =>
      disponer(
        modelo,
        acciones,
        setAviso,
        dondeEsta,
        visibles,
        disposicion.puentes ?? [],
        anclas,
        fondoOcupado,
        (id) => disposicion.posiciones[id],
        disposicion.enlaces ?? [],
        disposicion.comunes ?? [],
        disposicion.ramasPorConectar ?? [],
        disposicion.cortados ?? [],
        disposicion.cortesDeRuta ?? []
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modelo, acciones, visibles.join("|"), (disposicion.puentes ?? []).join(","), claveDeAnclas, fondoOcupado, (disposicion.enlaces ?? []).join(","), (disposicion.comunes ?? []).join(","), (disposicion.ramasPorConectar ?? []).join(","), (disposicion.cortados ?? []).join(","), (disposicion.revision ?? []).join(","), (disposicion.cortesDeRuta ?? []).join(",")]
  );
  // LAS CAJAS DE CADA PAÍS SOLO CRECEN: si el camino se alarga (17/10/2026: la postventa pasó
  // a cada fila), la caja que él guardó se estira hasta cubrirlo; nunca se achica sola.
  // Y CADA PAÍS TIENE SU FONDO (17/10/2026): «cada vez que yo agregue un país nuevo debe
  // aparecer su cuadro o fondo atenuado». Si falta el de un país (recién agregado), se pone.
  const cajas = disposicion.cajas
    ? [
        ...disposicion.cajas
          // La de un país que ya no tiene fila (como «Otros países») se va con su fila.
          .filter((c) => !c.id.startsWith("caja:carril:") || base.cajasDeFabrica.some((f) => f.id === c.id))
          .map((c) => {
          const f = base.cajasDeFabrica.find((x) => x.id === c.id);
          return f ? { ...c, ancho: Math.max(c.ancho, f.x + f.ancho - c.x), alto: Math.max(c.alto, f.y + f.alto - c.y) } : c;
        }),
        // …salvo el que él borró a propósito: ése no vuelve solo.
        ...base.cajasDeFabrica.filter(
          (f) => !disposicion.cajas!.some((c) => c.id === f.id) && !(disposicion.sinFondo ?? []).includes(f.id)
        ),
      ]
    : base.cajasDeFabrica;
  const cajasVivas = useRef(cajas);
  cajasVivas.current = cajas;

  /** Guarda en el borrador dónde quedó todo. Se llama al SOLTAR, no en cada píxel: así cada
   *  movimiento es UN paso de deshacer. */
  const guardar = (cambios: Partial<DisposicionDePizarra>) => {
    const d = vivo.current.disposicion;
    // NUNCA UNA POSICIÓN INVÁLIDA (20/10/2026): una sola tumbaba la página al dibujarla.
    const nuevas = Object.fromEntries(
      Object.entries(cambios.posiciones ?? {}).filter(([, p]) => Number.isFinite(p?.x) && Number.isFinite(p?.y))
    );
    vivo.current.acciones.cambiarDisposicion({
      ...d,
      posiciones: { ...d.posiciones, ...nuevas },
      cajas: cambios.cajas ?? d.cajas ?? cajasVivas.current,
      ...(cambios.visibles ? { visibles: cambios.visibles } : {}),
      ...(cambios.sinFondo ? { sinFondo: cambios.sinFondo } : {}),
    });
  };

  // «FICHAS GUARDADAS»: las sueltas que no están a la vista. Se arrastran a la pizarra.
  const [panel, setPanel] = useState(false);
  const guardadas = modelo.piezas.filter((p) => !base.dibujadas.has(p.id) && !visibles.includes(p.id));
  const refDelPanel = useRef<HTMLDivElement>(null);
  const refDelBotonDelPanel = useRef<HTMLButtonElement>(null);
  // ESCAPE O UN CLIC AFUERA LA CIERRAN (16/10/2026).
  useEffect(() => {
    if (!panel) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel(false);
    };
    const alPulsar = (e: PointerEvent) => {
      const t = e.target as globalThis.Node | null;
      if (refDelPanel.current?.contains(t) || refDelBotonDelPanel.current?.contains(t)) return;
      // Agarrar una sub pestaña NO la cierra: es para poder arrastrarla a la lista.
      if ((e.target as HTMLElement | null)?.closest?.(".react-flow__node:not(.react-flow__node-caja)")) return;
      setPanel(false);
    };
    window.addEventListener("keydown", alTeclear);
    window.addEventListener("pointerdown", alPulsar);
    return () => {
      window.removeEventListener("keydown", alTeclear);
      window.removeEventListener("pointerdown", alPulsar);
    };
  }, [panel]);
  // AL ESTIRAR O MOVER UNA MALLA, NADA SE MUEVE SOLO (20/10/2026: «estiré la malla de país y se
  // autoalineó arriba el upsell de Perú»). Lo que nunca se movió no tenía sitio guardado y se
  // recalculaba desde la malla; antes de cambiarla, todo eso se queda donde está.
  const cambiarCaja = (c: CajaDePizarra) => {
    const posiciones: Record<string, { x: number; y: number }> = {};
    for (const n of nodosVivos.current) {
      if (n.type === "caja" || n.hidden || n.id.startsWith("suelta:")) continue;
      if (vivo.current.disposicion.posiciones[n.id] || !Number.isFinite(n.position.x) || !Number.isFinite(n.position.y)) continue;
      posiciones[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    }
    guardar({ posiciones, cajas: cajasVivas.current.map((x) => (x.id === c.id ? c : x)) });
  };

  /**
   * LA CAJA ELEGIDA, para borrarla con Delete. Va por su cuenta y no por la selección de la
   * librería: la caja no recoge el ratón —para que arrastrar dentro mueva el panorama—, así que
   * nunca quedaba «seleccionada». Se elige con un clic en su título.
   */
  const [cajaElegida, setCajaElegida] = useState<string | null>(null);
  useEffect(() => {
    if (!cajaElegida) return;
    const alTeclear = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "Escape") setCajaElegida(null);
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      e.preventDefault();
      guardar({
        cajas: cajasVivas.current.filter((c) => c.id !== cajaElegida),
        // El fondo de un país borrado a propósito no vuelve solo.
        ...(cajaElegida.startsWith("caja:carril:")
          ? { sinFondo: [...new Set([...(vivo.current.disposicion.sinFondo ?? []), cajaElegida])] }
          : {}),
      });
      setCajaElegida(null);
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cajaElegida]);

  const inicial = useMemo(() => {
    const nodosDeCaja: Node[] = cajas.map((c) => ({
      id: c.id,
      type: "caja",
      position: { x: c.x, y: c.y },
      // SIN MOVERSE Y SIN QUEDARSE EL RATÓN: arrastrar dentro mueve el panorama. Solo sus
      // bordes, esquinas y título responden (ver `NodoDeCaja`).
      style: { width: c.ancho, height: c.alto, pointerEvents: "none" as const },
      zIndex: -10,
      // ENTRA EN LA SELECCIÓN SI QUEDA ENTERA DENTRO (19/10/2026): «cuando seleccione completamente
      // el cajón transparente de país también entre en la calidad de objeto seleccionado». Y se
      // mueve con el grupo. Sigue sin atrapar el ratón (arrastrar dentro mueve el panorama): solo
      // se elige con el recuadro de selección, y se mueve arrastrando otra de las elegidas.
      draggable: true,
      selectable: true,
      data: (() => {
        // El fondo de un país («caja:carril:PE») lleva su «▶ Ver recorrido».
        const pais = /^caja:carril:([A-Z]{2})$/.exec(c.id)?.[1];
        return {
          caja: c,
          tema,
          alCambiar: cambiarCaja,
          elegida: c.id === cajaElegida,
          alElegir: () => setCajaElegida(c.id),
          pais,
          alVerRecorrido: pais && acciones.verRecorrido ? () => acciones.verRecorrido?.(pais) : undefined,
        };
      })(),
      deletable: false,
    }));
    const conSuSitio = conLaFormaDelPrimero(base.nodos, base.cajasDeFabrica, disposicion.posiciones).map((n) =>
      disposicion.posiciones[n.id] ? { ...n, position: disposicion.posiciones[n.id] } : n
    );
    // LO NUEVO NACE EN UN SITIO LIBRE (17/10/2026): «al crear un nuevo cuadro aparece encima de
    // los demás y se combinan… no sé cuáles son los nuevos». Una suelta sin sitio guardado se
    // pone en el primer hueco libre DEBAJO de todo, sin pisar nada.
    // Con el tamaño REAL de lo ya dibujado cuando se conoce; si no, el estimado.
    const medida = (id: string) => nodosVivos.current.find((x) => x.id === id)?.measured;
    const ocupados = conSuSitio
      .filter((n) => !(n.id.startsWith("suelta:") && !disposicion.posiciones[n.id]))
      .map((n) => ({
        x: n.position.x,
        y: n.position.y,
        w: medida(n.id)?.width ?? 270,
        h: medida(n.id)?.height ?? (n.type === "pieza" ? altoDe((n.data as DatosDePieza).pieza) : 200),
      }));
    const fondo = Math.max(0, ...ocupados.map((r) => r.y + r.h), ...cajas.map((c) => c.y + c.alto)) + 60;
    const libre = (h: number): Punto => {
      for (let fila = 0; fila < 50; fila++)
        for (let col = 0; col < 8; col++) {
          const x = X_PRIMERA_COLUMNA + col * 300;
          const y = fondo + fila * 280;
          const choca = ocupados.some((r) => x < r.x + r.w + 20 && x + 270 > r.x - 20 && y < r.y + r.h + 20 && y + h > r.y - 20);
          if (!choca) return { x, y };
        }
      return { x: X_PRIMERA_COLUMNA, y: fondo };
    };
    for (const n of conSuSitio) {
      if (!n.id.startsWith("suelta:") || disposicion.posiciones[n.id]) continue;
      const h = n.type === "pieza" ? altoDe((n.data as DatosDePieza).pieza) : 160;
      n.position = libre(h);
      ocupados.push({ ...n.position, w: 270, h });
    }
    // LOS RECUADROS DE SUS BOTONES VAN PEGADOS A SU FICHA (18/10/2026): «al copiar la intro de
    // order bump, esos puntos sueltos de los botones aparecen alejados y confunde». Si la ficha
    // no está en su sitio de fábrica (la movió, o es una copia), su recuadro se pone a la misma
    // distancia de ella que tiene de fábrica. Lo que él movió a mano no se toca.
    const deFabrica = new Map(base.nodos.map((n) => [n.id, n.position]));
    const ahora = new Map(conSuSitio.map((n) => [n.id, n.position]));
    const conSusRecuadros = conSuSitio.map((n) => {
      if (n.type !== "destino" || disposicion.posiciones[n.id]) return n;
      const padre = conSuSitio
        .filter((m) => m.type !== "destino" && n.id.startsWith(`dest:${m.id}:`))
        .sort((a, b) => b.id.length - a.id.length)[0];
      const pAhora = padre && ahora.get(padre.id);
      // Una copia: donde la original tenía los suyos.
      const deLaCopia = padre && disposicion.recuadros?.[(padre.data as Partial<DatosDePieza>).pieza?.id ?? ""];
      if (pAhora && deLaCopia) {
        const k = conSuSitio.filter((m) => m.type === "destino" && m.id.startsWith(`dest:${padre.id}:`)).findIndex((m) => m.id === n.id);
        const d = deLaCopia[k];
        if (d) return { ...n, position: { x: pAhora.x + d.x, y: pAhora.y + d.y } };
      }
      const pFab = padre && deFabrica.get(padre.id);
      const dFab = deFabrica.get(n.id);
      if (!pFab || !pAhora || !dFab || (pFab.x === pAhora.x && pFab.y === pAhora.y)) return n;
      return { ...n, position: { x: pAhora.x + (dFab.x - pFab.x), y: pAhora.y + (dFab.y - pFab.y) } };
    });
    return { nodos: [...nodosDeCaja, ...conSusRecuadros], cables: base.cables };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, disposicion, tema, cajaElegida]);

  const [nodos, setNodos, alMoverNodos] = useNodesState(inicial.nodos);
  const [cables, setCables, alCambiarCables] = useEdgesState(inicial.cables);

  useEffect(() => {
    registrarPosiciones?.((piezaId, pais) => {
      // (Con país: la de ESE país, para una ficha que está en varios.)
      const n =
        (pais
          ? nodosVivos.current.find((x) => x.type === "pieza" && (x.data as DatosDePieza).pieza.id === piezaId && (x.data as DatosDePieza).pais === pais)
          : undefined) ??
        nodosVivos.current.find(
          (x) =>
            (x.type === "pieza" && (x.data as DatosDePieza).pieza.id === piezaId) ||
            (x.type === "upsell" && (x.data as DatosDeUpsell).filas.some((p) => p.id === piezaId))
        );
      return n ? { x: Math.round(n.position.x), y: Math.round(n.position.y) } : undefined;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // LO RECIÉN LLEGADO, MARCADO Y A LA VISTA (17/10/2026): «no sé cuáles son los nuevos». Lo
  // que entra a la vista (una suelta nueva, una caja) se resalta unos segundos y se centra.
  const [recien, setRecien] = useState<string | null>(null);
  const visiblesAntes = useRef<string[] | null>(null);
  useEffect(() => {
    const antes = visiblesAntes.current;
    visiblesAntes.current = visibles;
    if (!antes) return; // la primera vez no es «nuevo»: es lo que ya había
    const nueva = visibles.find((pid) => !antes.includes(pid));
    if (!nueva) return;
    const id = `suelta:${nueva}`;
    setRecien(id);
    window.setTimeout(() => {
      const n = nodosVivos.current.find((x) => x.id === id);
      const rf = instancia.current;
      const caja = contenedor.current?.getBoundingClientRect();
      if (!n || !rf || !caja) return;
      // LO QUE ENTRA DENTRO DE UN CAJÓN NO MUEVE LA VISTA (20/10/2026: «agregué un seguimiento nuevo
      // en el cajón… y la pantalla se mueve hacia abajo»). Su sitio guardado es un hueco donde no
      // se ve nada: él sigue viendo el cajón que edita.
      if (n.hidden) return;
      // Solo se mueve la vista si NO se ve ya: lo que se queda en su sitio no hace saltar nada.
      const enPantalla = rf.flowToScreenPosition({ x: n.position.x + 125, y: n.position.y + 40 });
      const seVe = enPantalla.x > caja.left && enPantalla.x < caja.right && enPantalla.y > caja.top && enPantalla.y < caja.bottom;
      if (!seVe) rf.setCenter(n.position.x + 125, n.position.y + 80, { duration: 500, zoom: rf.getZoom() });
    }, 150);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibles.join("|")]);
  useEffect(() => {
    if (!recien) return;
    const t = window.setTimeout(() => setRecien(null), 4500);
    return () => window.clearTimeout(t);
  }, [recien]);
  useEffect(() => {
    // LO ELEGIDO SIGUE ELEGIDO (17/10/2026): «las fichas flotantes no deben deseleccionarse al
    // mover». Al soltar se guarda su sitio y la pizarra se vuelve a dibujar; sin esto, esa
    // vuelta desmarcaba todo y había que elegirlas otra vez.
    const elegidas = new Set(nodosVivos.current.filter((n) => n.selected).map((n) => n.id));
    setNodos(elegidas.size > 0 ? inicial.nodos.map((n) => (elegidas.has(n.id) ? { ...n, selected: true } : n)) : inicial.nodos);
    setCables(inicial.cables);
  }, [inicial, setNodos, setCables]);
  nodosVivos.current = nodos;

  // ── COPIAR Y PEGAR (17/10/2026) ──────────────────────────────────────────────────────────
  // «necesito hacer copy y paste a las fichas flotantes… que yo los seleccione en grupo o solo».
  // Ctrl+C: las fichas elegidas (clic, o Shift + arrastrar), con los cables que las unen. Ctrl+V:
  // copias SUELTAS a la derecha de todo, sin tapar nada, con esos cables entre ellas y marcadas
  // hasta que hace clic en otro lado. Al conectar una a un país, se conecta todo el grupo.
  // EL PORTAPAPELES SOBREVIVE AL CAMBIAR DE TIENDA (19/10/2026): «necesito poder copiar de una
  // tienda a la otra las fichas… en este momento puedo pegar solo en la misma tienda». Vive fuera
  // del lienzo (que se rehace al cambiar de tienda); pegar en otra tienda hace las copias de ésa.
  const portapapeles = PORTAPAPELES_DE_LA_PIZARRA;
  const porElegir = useRef<Set<string> | null>(null);
  // ARRASTRAR UN RECUADRO DE BOTÓN HASTA UN PUNTO VERDE (19/10/2026): «cuando el punto naranja
  // se una con el verde, antes de soltar el click ya debería desaparecer la burbuja… si me
  // arrepiento y retiro arrastrando sin soltar, la burbuja debería reaparecer».
  const union = useRef<{ dest: string; hacia: string } | null>(null);
  const [colorDelCableNuevo, setColorDelCableNuevo] = useState(AZUL_RAMA);
  /** Lo que hace el botón del recuadro si se suelta en ese destino. false = ahí no se conecta. */
  /**
   * EL CABLE DE UN BOTÓN COPIADO, TIRADO ADONDE YA LLEVA (20/10/2026): solo se dibuja; su acción en
   * el bot no se reescribe (en COMO OB, «Elige X» ya pasa por la oferta: soltarlo ahí la cambiaría).
   */
  // Y CUALQUIER BOTÓN, COPIADO O NO (20/10/2026: «cuando reconecto me salen avisos y no sé por
  // qué»): si ya lleva ahí, soltarlo ahí no cambia nada ni pregunta.
  const confirmarSiYaLleva = (piezaId: string, ramaId: string, destinoId: string): boolean => {
    // (Esperando: un botón de una copia, o uno cuyo cable él cortó. Reconectarlo solo lo vuelve a dibujar.)
    const pendiente =
      (vivo.current.disposicion.ramasPorConectar ?? []).includes(`${piezaId}|${ramaId}`) ||
      (vivo.current.disposicion.cortados ?? []).includes(`${piezaId}|${ramaId}`);
    if (pendiente && !acciones.confirmarCable) return false;
    const rama = modelo.piezas.find((p) => p.id === piezaId)?.ramas.find((r) => r.id === ramaId);
    if (!rama) return false;
    const aPago = /^pv:[^:]+:pago:(basico|full|unico)$/.exec(destinoId)?.[1];
    const destino = nodosVivos.current.find((n) => n.id === destinoId);
    const aOferta = destino?.type === "pieza" && (destino.data as DatosDePieza).pieza.tipo === "ob";
    // ¿Ya lleva a ESE Pago? Con un solo producto, todo lo que es de compra va a él. Con dos,
    // «pagar» y «datos de un método» sirven a los dos; «Elige X», solo al suyo (como se dibuja).
    const deCompra = ACCIONES_DE_COMPRA.has(rama.accion ?? "") && rama.accion !== "show_order_bump";
    const alPago =
      !!aPago &&
      deCompra &&
      (aPago === "unico" ||
        rama.accion === "show_payment" ||
        rama.accion === "send_payment_method" ||
        (aPago === "basico" && rama.accion === "choose_basico") ||
        (aPago === "full" && rama.accion === "choose_combo"));
    const coincide = alPago || (aOferta && (rama.accion === "show_order_bump" || (deCompra && rama.accion !== "send_payment_method")));
    if (!coincide) return false;
    if (pendiente) acciones.confirmarCable?.(piezaId, ramaId);
    return true;
  };
  /**
   * ARRASTRAR QUE CAMBIA LO QUE HACE UN BOTÓN, CON AVISO CLARO (20/10/2026: «si es entonces real,
   * déjalo así pero deja la advertencia clara al conectar»). Si el botón ya lleva ahí, no pregunta.
   */
  /** Devuelve si se hizo (cancelado el aviso: no; la colita vuelve a su sitio). */
  const cambiarConAviso = (piezaId: string, ramaId: string, destino: DestinoDeRama): boolean => {
    const rama = modelo.piezas.find((p) => p.id === piezaId)?.ramas.find((r) => r.id === ramaId);
    const nueva = destino === "mensaje" ? "send_steps" : destino;
    // SOLO CUANDO SE PIERDE ALGO (20/10/2026: «cuando reconecto me salen avisos y no sé por qué»):
    // un botón vacío o cortado (mensaje sin escribir) no tiene nada que perder; conecta sin preguntar.
    const vacio = (!rama?.accion || rama.accion === "send_steps") && (rama?.mensajes ?? 0) === 0;
    if (rama && !vacio && (rama.accion || "send_steps") !== nueva) {
      const que = rama.tipo === "boton" ? "el botón" : "el cuadrito";
      const ahora = destinoDeLaRama(rama).texto;
      const despues = destinoDeLaRama({ ...rama, accion: nueva, mensajes: 0 }).texto;
      const pierde = rama.tipo === "boton" && (!rama.accion || rama.accion === "send_steps") && rama.mensajes > 0 ? "\n\nSu mensaje se borra al guardar." : "";
      if (
        !window.confirm(
          `⚠ Esto CAMBIA lo que hace ${que} «${rama.etiqueta || "(sin texto)"}» en el bot.\n\nAhora: ${ahora}\nDesde ahora: ${despues}${pierde}\n\n¿Seguir?`
        )
      )
        return false;
    }
    acciones.cambiarRama(piezaId, ramaId, destino, true);
    return true;
  };
  const unirRecuadro = (dd: DatosDeDestino, destinoId: string): boolean => {
    const destino = nodosVivos.current.find((n) => n.id === destinoId);
    if (!destino) return false;
    if (confirmarSiYaLleva(dd.piezaId, dd.ramaId, destinoId)) return true;
    const aPago = /^pv:[^:]+:pago:(basico|full|unico)$/.exec(destino.id)?.[1];
    if (aPago) return cambiarConAviso(dd.piezaId, dd.ramaId, aPago === "basico" ? "choose_basico" : aPago === "full" ? "choose_combo" : "show_payment");
    if ((destino.data as Partial<DatosDePieza>).pieza?.tipo === "ob") return cambiarConAviso(dd.piezaId, dd.ramaId, "show_order_bump");
    return false;
  };
  /** Esconde el recuadro y lleva su cable al destino; con null, lo deja como estaba. */
  const marcarUnion = (dest: string, hacia: string | null) => {
    // EL PAGO VIVE DENTRO DEL CAJÓN 💳 COBRO Y ENTREGA (20/10/2026): el cable de vista previa va al
    // punto verde del cajón («Si elige X»), no a la tarjeta escondida, para que se vea y la colita
    // se desvanezca como siempre.
    const pago = hacia ? /^pv:([^:]+):pago:(basico|full|unico)$/.exec(hacia) : null;
    const cajonDelPago = pago && nodosVivos.current.some((n) => n.id === `pv:${pago[1]}:cobro`) ? `pv:${pago[1]}:cobro` : null;
    const verTarget = cajonDelPago ?? hacia;
    const verHandle = cajonDelPago ? `entra:${pago![2]}` : "entra";
    setNodos((ns) => ns.map((x) => (x.id === dest ? { ...x, data: { ...(x.data as DatosDeDestino), uniendose: !!hacia } } : x)));
    setCables((cs) =>
      cs.map((c) => {
        const suyo = (c.data as { recuadro?: string; handleDelRecuadro?: string | null } | undefined)?.recuadro;
        if (c.target === dest || suyo === dest) {
          return hacia
            ? {
                ...c,
                target: verTarget!,
                targetHandle: verHandle,
                data: { ...(c.data ?? {}), recuadro: dest, handleDelRecuadro: suyo === dest ? (c.data as { handleDelRecuadro?: string | null }).handleDelRecuadro : c.targetHandle ?? null },
              }
            : {
                ...c,
                target: dest,
                targetHandle: (c.data as { handleDelRecuadro?: string | null } | undefined)?.handleDelRecuadro ?? c.targetHandle,
                data: { ...(c.data ?? {}), recuadro: undefined },
              };
        }
        if (c.source === dest) return { ...c, hidden: !!hacia };
        return c;
      })
    );
  };
  const alArrastrar = (n: Node, arrastrados: Node[]) => {
    // (20/10/2026) Mover la burbuja ya no la conecta: el cable sale de su punto. Esto queda apagado.
    if (CONECTAR_ARRASTRANDO_LA_BURBUJA !== true) return;
    if (n.type !== "destino" || arrastrados.length !== 1) return;
    const sel = (id: string, h: string) => `.react-flow__node[data-id="${CSS.escape(id)}"] .react-flow__handle[data-handleid="${h}"]`;
    const punto = document.querySelector(sel(n.id, "sale"))?.getBoundingClientRect();
    if (!punto) return;
    const px = punto.left + punto.width / 2;
    const py = punto.top + punto.height / 2;
    let hacia: string | null = null;
    for (const m of nodosVivos.current) {
      // LOS PUNTOS VERDES DEL CAJÓN 💳 COBRO Y ENTREGA (20/10/2026): sus Pagos están escondidos
      // dentro; soltar la colita en «Si elige X» es soltarla en el Pago de ese producto.
      if (m.type === "cajon" && (m.data as DatosDeCajon).tipo === "cobro") {
        for (const e of (m.data as DatosDeCajon).entradas) {
          const verde = document.querySelector(sel(m.id, e.id))?.getBoundingClientRect();
          if (verde && Math.hypot(verde.left + verde.width / 2 - px, verde.top + verde.height / 2 - py) < 28) {
            hacia = m.id.replace(/cobro$/, `pago:${e.id.replace(/^entra:/, "")}`);
            break;
          }
        }
        if (hacia) break;
        continue;
      }
      const esPago = /^pv:[^:]+:pago:(basico|full|unico)$/.test(m.id);
      const esOferta = m.type === "pieza" && (m.data as DatosDePieza).pieza.tipo === "ob";
      if (!esPago && !esOferta) continue;
      const verde = document.querySelector(sel(m.id, "entra"))?.getBoundingClientRect();
      if (!verde) continue;
      if (Math.hypot(verde.left + verde.width / 2 - px, verde.top + verde.height / 2 - py) < 28) {
        hacia = m.id;
        break;
      }
    }
    const antes = union.current?.dest === n.id ? union.current.hacia : null;
    if (hacia === antes) return;
    union.current = hacia ? { dest: n.id, hacia } : null;
    marcarUnion(n.id, hacia);
  };
  // SHIFT QUE SE QUEDA «APRETADO» (19/10/2026): si se suelta Shift sin que la pizarra se entere
  // (fuera de la ventana, o en medio de un arrastre), React Flow sigue creyendo que está apretado:
  // arrastrar en un hueco dibuja una selección en vez de mover el panorama. Cada clic sin Shift
  // se lo dice.
  useEffect(() => {
    const alPulsar = (e: PointerEvent) => {
      // (Desde el body: React Flow mira de qué elemento viene la tecla, y el documento no lo es.)
      if (!e.shiftKey) document.body.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", code: "ShiftLeft", bubbles: true }));
    };
    window.addEventListener("pointerdown", alPulsar, true);
    return () => window.removeEventListener("pointerdown", alPulsar, true);
  }, []);
  // DÓNDE TIENE LOS RECUADROS DE SUS BOTONES una ficha, respecto a ella (18/10/2026): la copia
  // los pone igual. En el orden de sus botones.
  const recuadrosDelNodo = (nodoId: string): Array<Punto | null> | undefined => {
    const padre = nodosVivos.current.find((n) => n.id === nodoId);
    if (!padre) return undefined;
    const suyos = nodosVivos.current.filter((n) => n.type === "destino" && n.id.startsWith(`dest:${nodoId}:`));
    if (suyos.length === 0) return undefined;
    return suyos.map((n) => ({ x: Math.round(n.position.x - padre.position.x), y: Math.round(n.position.y - padre.position.y) }));
  };
  const cablesVivos = useRef<Edge[]>([]);
  cablesVivos.current = cables;
  // Los cables de verdad, entre las tarjetas de dentro de los cajones (para copiar el grupo).
  const cablesReales = useRef<Edge[]>([]);
  cablesReales.current = base.cablesReales ?? base.cables;
  /** LO ELEGIDO, CON LO DE DENTRO DE SUS CAJONES (19/10/2026): «copio el bloque, pego y no
   *  aparece nada». Un cajón de seguimientos elegido cuenta como sus fichas de dentro. */
  const elegidasConSusCajones = (tipos: string[]) => {
    const vivos = nodosVivos.current;
    const dentro = new Set(
      vivos
        .filter((n) => n.selected && n.type === "cajon" && (n.data as DatosDeCajon).tipo === "seguimientos" && !(n.data as DatosDeCajon).comunDe)
        .flatMap((n) => (n.data as DatosDeCajon).dentro)
    );
    // Lo común en espera NO cuenta: es la ficha de otros países; Delete la borraría de verdad.
    // Se quita de ese país con su clic derecho.
    return vivos.filter((n) => tipos.includes(n.type ?? "") && !n.id.startsWith("comun:") && (n.selected || dentro.has(n.id)));
  };
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      // DELETE BORRA LAS FICHAS ELEGIDAS (17/10/2026): «yo debería presionar Delete y borrar».
      // Una caja elegida tiene su propio Delete (la borra a ella), y entonces no se toca nada más.
      if ((e.key === "Delete" || e.key === "Backspace") && !e.ctrlKey && !e.metaKey && acciones.eliminarVarias) {
        const elegidas = elegidasConSusCajones(["pieza"]);
        if (elegidas.length === 0) return;
        e.preventDefault();
        // UNA FICHA COMÚN (en varios países), elegida en el camino de UN país, solo se saca de ese
        // país: borrarla entera la quitaría también de los otros. Las demás se eliminan.
        const soloDeSuPais: Array<{ piezaId: string; pais: string }> = [];
        const enteras: string[] = [];
        for (const n of elegidas) {
          const d = n.data as DatosDePieza;
          if (d.pais && !d.suelta && d.pieza.paises.length > 1) soloDeSuPais.push({ piezaId: d.pieza.id, pais: d.pais });
          else enteras.push(d.pieza.id);
        }
        acciones.eliminarVarias([...new Set(enteras)], soloDeSuPais);
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const tecla = e.key.toLowerCase();
      if (tecla === "c") {
        // LAS FICHAS ELEGIDAS, Y TAMBIÉN LAS DE UPSELL (17/10/2026): «quiero agarrar todo el
        // workflow de Perú, copiarlo y conectarlo a Argentina». Las de upsell viven dentro de su
        // tarjeta, así que se toman de ella. El pago, la entrega y el regalo no se copian: salen
        // solos en el camino del país en cuanto su intro está conectada.
        const elegidos = elegidasConSusCajones(["pieza", "upsell"]);
        if (elegidos.length === 0) return;
        // LAS DE DENTRO DE UN CAJÓN SE COPIAN DONDE ESTÁ EL CAJÓN (20/10/2026): escondidas guardan
        // un sitio viejo, y la copia salía lejos de su intro. Así el pegado tiene la misma forma.
        const sitioDelCajon = new Map<string, Punto>();
        for (const n of nodosVivos.current) {
          if (n.type !== "cajon" || !n.selected) continue;
          (n.data as DatosDeCajon).dentro.forEach((id, k) => sitioDelCajon.set(id, { x: n.position.x, y: n.position.y + k * 4 }));
        }
        for (let k = 0; k < elegidos.length; k++) {
          const s = sitioDelCajon.get(elegidos[k].id);
          if (s) elegidos[k] = { ...elegidos[k], position: s };
        }
        // Una ficha COMÚN elegida en dos países se copia UNA vez.
        const vistos = new Map<string, { x: number; y: number; nodo: string }>();
        const deUpsell: string[] = [];
        for (const n of elegidos) {
          if (n.type === "upsell") {
            (n.data as DatosDeUpsell).filas.forEach((p, k) => {
              if (vistos.has(p.id)) return;
              vistos.set(p.id, { x: n.position.x, y: n.position.y + k * 40, nodo: n.id });
              deUpsell.push(p.id);
            });
            continue;
          }
          const pid = (n.data as DatosDePieza).pieza.id;
          if (!vistos.has(pid)) vistos.set(pid, { x: n.position.x, y: n.position.y, nodo: n.id });
        }
        const lista = [...vistos.entries()];
        // (Por su posición REAL en la lista; las de upsell comparten tarjeta y no cuentan aquí.)
        const indice = new Map(
          lista.flatMap(([pid, v], i) => (deUpsell.includes(pid) ? [] : [[v.nodo, i] as const]))
        );
        const enlaces: Array<[number, number]> = [];
        for (const c of cablesReales.current) {
          const i = indice.get(c.source);
          const j = indice.get(c.target);
          if (i !== undefined && j !== undefined && i !== j && !enlaces.some(([a, b]) => a === i && b === j)) enlaces.push([i, j]);
        }
        // Las de upsell van al grupo colgadas de la última ficha del camino (la más a la derecha):
        // así, al conectar el grupo a un país, también reciben ese país.
        const delCamino = lista.map(([pid, v], i) => ({ pid, v, i })).filter((x) => !deUpsell.includes(x.pid));
        const ultima = delCamino.sort((a, b) => b.v.x - a.v.x)[0];
        lista.forEach(([pid], i) => {
          if (ultima && deUpsell.includes(pid)) enlaces.push([ultima.i, i]);
        });
        portapapeles.current = {
          piezas: lista.map(([piezaId, v]) => ({ piezaId, x: v.x, y: v.y, recuadros: recuadrosDelNodo(v.nodo) })),
          enlaces,
        };
        e.preventDefault();
        setAviso(`${lista.length === 1 ? "1 ficha copiada" : `${lista.length} fichas copiadas`}. Ctrl+V para pegarlas.`);
        return;
      }
      if (tecla === "v" && portapapeles.current && acciones.pegar) {
        e.preventDefault();
        const { piezas, enlaces } = portapapeles.current;
        // A LA DERECHA DE TODO, en la altura de las originales: nada queda tapado.
        const alFinal =
          Math.max(
            0,
            ...nodosVivos.current
              .filter((n) => n.type !== "caja")
              .map((n) => n.position.x + (n.measured?.width ?? 270))
          ) + 220;
        const xMin = Math.min(...piezas.map((p) => p.x));
        const items = piezas.map((p) => ({
          piezaId: p.piezaId,
          donde: { x: Math.round(alFinal + (p.x - xMin)), y: Math.round(p.y) },
          recuadros: p.recuadros,
        }));
        const nuevas = acciones.pegar(items, enlaces);
        if (nuevas.length === 0) return;
        porElegir.current = new Set(nuevas.map((id) => `suelta:${id}`));
        setAviso(
          nuevas.length === 1
            ? "Copia pegada a la derecha, suelta. Conéctala a un país cuando quieras."
            : `${nuevas.length} copias pegadas a la derecha, sueltas. Revisa, borra lo que sobre y conecta la primera a un país: se conecta todo el grupo.`
        );
        const primera = items[0].donde;
        window.setTimeout(() => instancia.current?.setCenter(primera.x + 250, primera.y + 150, { duration: 500, zoom: instancia.current.getZoom() }), 200);
      }
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acciones]);
  // LAS RECIÉN PEGADAS, ELEGIDAS (con su borde) en cuanto aparecen. Un clic en otro lado las suelta.
  useEffect(() => {
    const quiero = porElegir.current;
    if (!quiero || !nodos.some((n) => quiero.has(n.id))) return;
    porElegir.current = null;
    // LAS ESCONDIDAS DENTRO DE UN CAJÓN NO SE ELIGEN: se elige su CAJÓN (20/10/2026). Elegidas, se
    // arrastraban sin medida, su sitio se guardaba como número inválido y al conectar se caía
    // la página entera («This page couldn't load»). Y así el cajón se mueve con el bloque.
    const cajonesElegidos = new Set(
      nodos
        .filter((n) => n.type === "cajon" && (n.data as DatosDeCajon).dentro.some((id) => quiero.has(id)))
        .map((n) => n.id)
    );
    setNodos((ns) => ns.map((n) => ({ ...n, selected: !n.hidden && (quiero.has(n.id) || cajonesElegidos.has(n.id)) })));
  }, [nodos, setNodos]);

  // UNA CAJA NUEVA, en el centro de lo que se ve.
  const instancia = useRef<ReactFlowInstance | null>(null);
  const ultimoPedido = useRef(pedidoDeCaja);
  useEffect(() => {
    if (pedidoDeCaja === ultimoPedido.current) return;
    ultimoPedido.current = pedidoDeCaja;
    // EN UN SITIO LIBRE, DEBAJO DE TODO (17/10/2026): en el centro de la vista caía encima de
    // lo que hubiera y «se combinaban». Y se centra la vista en ella, para que se vea cuál es.
    const fondo =
      Math.max(
        0,
        ...nodosVivos.current.map((n) => n.position.y + (n.type === "caja" ? Number((n.style as { height?: number } | undefined)?.height ?? 0) : 240))
      ) + 80;
    const id = `caja:${Date.now().toString(36)}`;
    guardar({
      cajas: [...cajasVivas.current, { id, x: X_PRIMERA_COLUMNA, y: Math.round(fondo), ancho: 400, alto: 240, titulo: "Caja" }],
    });
    setRecien(id);
    window.setTimeout(() => instancia.current?.setCenter(X_PRIMERA_COLUMNA + 200, fondo + 120, { duration: 500, zoom: instancia.current.getZoom() }), 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoDeCaja]);

  // EL MENÚ: clic derecho, o soltar un cable en el vacío.
  const [menu, setMenu] = useState<{ x: number; y: number; contenido: ContenidoDelMenu } | null>(null);
  const contenedor = useRef<HTMLDivElement>(null);
  /** Cuándo se abrió el menú. Al soltar un cable el navegador manda un «clic» justo después:
   *  sin esta espera, ese mismo clic cerraba el menú que se acababa de abrir. */
  const abiertoEn = useRef(0);
  useEffect(() => {
    if (!menu) return;
    const cerrar = () => {
      if (Date.now() - abiertoEn.current < 350) return;
      setMenu(null);
    };
    const conEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("click", cerrar);
    window.addEventListener("keydown", conEscape);
    return () => {
      window.removeEventListener("click", cerrar);
      window.removeEventListener("keydown", conEscape);
    };
  }, [menu]);
  const abrirMenu = (x: number, y: number, contenido: ContenidoDelMenu) => {
    abiertoEn.current = Date.now();
    const caja = contenedor.current?.getBoundingClientRect();
    setMenu({ x: x - (caja?.left ?? 0), y: y - (caja?.top ?? 0), contenido });
  };
  /**
   * DÓNDE NACE LA COPIA de una ficha. AL LADO de la original, y él la mueve (16/10/2026)… pero
   * NUNCA encima de otra (17/10/2026): si al lado no cabe, va al primer hueco libre de abajo.
   * Con el TAMAÑO REAL de cada tarjeta: a ojo (200) una intro de diez burbujas se pisaba.
   */
  const alLadoDe = (nodoId: string): Punto | undefined => {
    const aqui = dondeEsta(nodoId);
    const alLado = aqui ? { x: aqui.x + 290, y: aqui.y } : undefined;
    const altoDeLaCopia = nodosVivos.current.find((n) => n.id === nodoId)?.measured?.height ?? 300;
    return alLado &&
      !nodosVivos.current.some((n) => {
        if (n.type === "caja" || n.id === nodoId) return false;
        const w = n.measured?.width ?? 270;
        const h = n.measured?.height ?? 300;
        return alLado.x < n.position.x + w + 20 && alLado.x + 270 > n.position.x - 20 && alLado.y < n.position.y + h + 20 && alLado.y + altoDeLaCopia > n.position.y - 20;
      })
      ? alLado
      : undefined;
  };
  // CLONAR Y BORRAR DESDE LA FRANJA (19/10/2026): «mira la pestaña de Sendy, tiene un botón para
  // clonar y otro para borrar». Hacen lo mismo que «Duplicar aquí al lado» y «Eliminar» del clic
  // derecho.
  const clonarAlLado = (nodoId: string, piezaId: string) =>
    acciones.duplicar(piezaId, undefined, alLadoDe(nodoId), recuadrosDelNodo(nodoId));
  const vivoDeLasFranjas = useRef({ clonarAlLado });
  vivoDeLasFranjas.current = { clonarAlLado };
  const valorDelContexto = useMemo(
    () => ({
      acciones,
      menu: abrirMenu,
      avisar: setAviso,
      clonar: (nodoId: string, piezaId: string) => vivoDeLasFranjas.current.clonarAlLado(nodoId, piezaId),
      curvas: disposicion.curvas,
      curvar: (cableId: string, corrimiento: Punto | null) => {
        const d = vivo.current.disposicion;
        const curvas = { ...(d.curvas ?? {}) };
        if (corrimiento) curvas[cableId] = { x: Math.round(corrimiento.x), y: Math.round(corrimiento.y) };
        else delete curvas[cableId];
        vivo.current.acciones.cambiarDisposicion({ ...d, curvas });
      },
    }),
    [acciones, disposicion.curvas]
  );
  // EL MENÚ NO SE SALE DE LA PANTALLA (17/10/2026): «no me permite ver eliminar, se queda oculta
  // fuera de la pantalla cuando estoy muy cerca al borde». Se mide al abrirse y, si no cabe, se
  // corre hacia arriba o hacia la izquierda.
  const refDelMenu = useRef<HTMLDivElement>(null);
  const [posMenu, setPosMenu] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    setPosMenu(null);
    if (!menu) return;
    const m = refDelMenu.current?.getBoundingClientRect();
    const c = contenedor.current?.getBoundingClientRect();
    if (!m || !c) return;
    let { x, y } = menu;
    if (c.left + x + m.width > c.right - 8) x = Math.max(8, c.width - m.width - 8);
    if (c.top + y + m.height > c.bottom - 8) y = Math.max(8, c.height - m.height - 8);
    if (x !== menu.x || y !== menu.y) setPosMenu({ x, y });
  }, [menu]);

  // «PROBAR RECORRIDO» Y EL BUSCADOR: solo cómo se ve.
  const enElCarril = (id: string, pais: string) =>
    id.startsWith(`pz:${pais}:`) ||
    id.startsWith(`prest:${pais}:`) ||
    id.startsWith(`dest:pz:${pais}:`) ||
    id.startsWith(`hueco:${pais}:`) ||
    // su postventa, que ahora va en su propia fila
    id.startsWith(`pv:${pais || "otros"}:`);
  const consulta = paraBuscar(buscar.trim());
  const coincide = (n: Node) => {
    if (n.type !== "pieza" || consulta.length < 2) return false;
    const p = (n.data as DatosDePieza).pieza;
    return paraBuscar([p.titulo, ...p.resumen.map((b) => b.texto), ...p.ramas.map((r) => r.etiqueta)].join(" ")).includes(consulta);
  };
  const filtrando = probando !== null || consulta.length >= 2;
  const conRecien = (lista: Node[]) =>
    recien
      ? lista.map((n) =>
          n.id === recien ? { ...n, style: { ...n.style, outline: "4px solid #f59e0b", outlineOffset: 6, borderRadius: 14 } } : n
        )
      : lista;
  /**
   * LA RUTA QUE EL VISOR ESTÁ MIRANDO, ILUMINADA (20/10/2026): «¿cómo vería esa rama activa en la
   * pizarra?». El visor la avisa con un evento; aquí se ve esa ruta y lo demás queda tenue. Solo
   * vista: no cambia nada.
   */
  const [rutaIluminada, setRutaIluminada] = useState<{ pais: string; camino: string; margen?: number } | null>(null);
  useEffect(() => {
    const alAvisar = (e: Event) => setRutaIluminada(((e as CustomEvent).detail as { pais: string; camino: string; margen?: number } | null) ?? null);
    window.addEventListener("pizarra:iluminar-ruta", alAvisar);
    return () => window.removeEventListener("pizarra:iluminar-ruta", alAvisar);
  }, []);
  const estaEnLaRuta = (n: Node): boolean => {
    if (!rutaIluminada) return true;
    const { pais, camino } = rutaIluminada;
    if (n.type === "caja") return true;
    if (n.id === idDelInicio(pais)) return true;
    if (n.type === "cajon") return n.id === `segs:${pais}:${camino || "P"}` || n.id === `pv:${pais}:cobro`;
    if (n.type === "fijo" || n.type === "upsell" || n.type === "etiqueta") return n.id.startsWith(`pv:${pais}:`);
    if (n.type === "destino") return n.id.includes(`:${pais}:`);
    if (n.type === "pieza") {
      const d = n.data as DatosDePieza;
      return d.pais === pais && (d.pieza.caminos ?? [d.pieza.camino ?? ""]).includes(camino);
    }
    return false;
  };
  useEffect(() => {
    const rf = instancia.current;
    if (!rf || !rutaIluminada) return;
    const ids = nodosVivos.current.filter((n) => n.type !== "caja" && !n.hidden && estaEnLaRuta(n)).map((n) => n.id);
    if (ids.length === 0) return;
    // CON EL VISOR AL LADO, SE ENCUADRA EN LO QUE QUEDA A LA VISTA (la izquierda), no debajo de él.
    const caja = contenedor.current?.getBoundingClientRect();
    const b = rf.getNodesBounds(ids);
    if (!caja || b.width === 0) return;
    const ancho = Math.max(200, caja.width - (rutaIluminada.margen ?? 0));
    const zoom = Math.min(1, ancho / (b.width * 1.2), caja.height / (b.height * 1.25));
    rf.setViewport(
      { x: (ancho - b.width * zoom) / 2 - b.x * zoom, y: (caja.height - b.height * zoom) / 2 - b.y * zoom, zoom },
      { duration: 500 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rutaIluminada]);
  const nodosVistosSinRuta = conRecien(!filtrando
    ? nodos
    : nodos.map((n) => {
        // EL BUSCADOR NO APAGA LA POSTVENTA (16/10/2026). «Probar» sí apaga la de los otros
        // países: desde el 17/10 cada país lleva la suya en su fila.
        const siempre = n.type === "caja" || (esInicio(n.id) && probando === null);
        const dePostventa = n.type === "fijo" || n.type === "etiqueta" || n.type === "upsell";
        const visible =
          siempre || (probando !== null ? enElCarril(n.id, probando) || n.id === idDelInicio(probando) : dePostventa || coincide(n));
        return {
          ...n,
          style: {
            ...n.style,
            opacity: visible ? 1 : 0.12,
            ...(probando === null && coincide(n) ? { outline: "3px solid #f59e0b", outlineOffset: 3, borderRadius: 10 } : {}),
          },
        };
      }));
  const nodosVistos = !rutaIluminada
    ? nodosVistosSinRuta
    : nodosVistosSinRuta.map((n) => (estaEnLaRuta(n) ? n : { ...n, style: { ...n.style, opacity: 0.15 } }));
  const fueraDeLaRuta = new Set(rutaIluminada ? nodosVistos.filter((n) => !estaEnLaRuta(n)).map((n) => n.id) : []);
  const cablesVistosSinRuta =
    probando === null
      ? cables
      : cables.map((c) => {
          const del =
            (esInicio(c.source) && c.sourceHandle === `carril:${probando}`) ||
            enElCarril(c.source, probando) ||
            enElCarril(c.target, probando);
          return { ...c, animated: del, style: { ...c.style, opacity: del ? 1 : 0.08, strokeWidth: del ? 3 : 2 } };
        });
  const cablesVistos =
    fueraDeLaRuta.size === 0
      ? cablesVistosSinRuta
      : cablesVistosSinRuta.map((c) =>
          fueraDeLaRuta.has(c.source) || fueraDeLaRuta.has(c.target) ? { ...c, style: { ...c.style, opacity: 0.08 } } : { ...c, animated: true }
        );
  useEffect(() => {
    const rf = instancia.current;
    if (!rf) return;
    const ids =
      probando !== null
        ? nodosVivos.current.filter((n) => enElCarril(n.id, probando) || n.id === idDelInicio(probando)).map((n) => ({ id: n.id }))
        : consulta.length >= 2
          ? nodosVivos.current.filter(coincide).map((n) => ({ id: n.id }))
          : [];
    if (ids.length > 0) rf.fitView({ nodes: ids, padding: 0.2, duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probando, consulta]);

  const paisesDeLosCarriles = (modelo.estaciones[0]?.filas ?? [])
    .filter((f) => f.clave)
    .map((f) => ({ clave: f.clave, etiqueta: f.etiqueta.replace(/^Si país = /, "") }));
  const piezaDe = (id: string) => modelo.piezas.find((p) => p.id === id);
  const hayOfertaVisible = modelo.estaciones.some((e) => e.tipo === "ob");
  const t = TEMA[tema];

  /** ¿De qué país es el cable que sale de este nodo? */
  const paisDelOrigen = (nodoId: string, handle: string | null | undefined): string | null => {
    if (esInicio(nodoId)) return String(handle ?? "").replace(/^carril:/, "");
    const n = nodosVivos.current.find((x) => x.id === nodoId);
    const d = n?.data as Partial<DatosDePieza & DatosDePrestada> | undefined;
    return d?.pais ?? null;
  };

  return (
    <Contexto.Provider value={valorDelContexto}>
      <div
        ref={contenedor}
        className="relative h-full w-full"
        style={{ background: t.fondo }}
        // SOLTAR UNA FICHA DEL PANEL en la pizarra: queda ahí, a la vista.
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("text/ficha-pizarra")) e.preventDefault();
        }}
        onDrop={(e) => {
          const pid = e.dataTransfer.getData("text/ficha-pizarra");
          const rf = instancia.current;
          if (!pid || !rf) return;
          e.preventDefault();
          const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          acciones.mostrar(pid, { x: Math.round(p.x - 125), y: Math.round(p.y - 20) });
        }}
      >
        <ReactFlow
          nodes={nodosVistos}
          edges={cablesVistos}
          onInit={(i) => {
            instancia.current = i;
          }}
          onMoveEnd={(_e, v) => recordarMirada(v)}
          {...(vistaGuardada ? { defaultViewport: vistaGuardada } : {})}
          // UN SEGUNDO RECUADRO SUMA (17/10/2026): «si vuelvo a presionar shift lo agarre». Mientras
          // se dibuja, lo que ya estaba elegido no se suelta.
          // (18/10/2026: «cuando uso Shift para seleccionar con un recuadro otra, se deseleccionan
          // los otros… y al hacer Ctrl+Z se seleccionan solas». React Flow las suelta POR DENTRO al
          // empezar el recuadro; apartar ese cambio no bastaba, porque la tarjeta seguía siendo
          // el mismo objeto y la pantalla no se enteraba. Ahora se rehace la tarjeta, elegida.)
          onNodesChange={(cambios) => {
            const previas = sumando.current;
            if (!previas) {
              alMoverNodos(cambios);
              return;
            }
            const sueltas = new Set(cambios.flatMap((c) => (c.type === "select" && !c.selected && previas.has(c.id) ? [c.id] : [])));
            alMoverNodos(cambios.filter((c) => !(c.type === "select" && sueltas.has(c.id))));
            if (sueltas.size > 0) setNodos((ns) => ns.map((n) => (sueltas.has(n.id) ? { ...n, selected: true } : n)));
          }}
          onSelectionStart={() => {
            const previas = new Set(nodosVivos.current.filter((n) => n.selected).map((n) => n.id));
            sumando.current = previas;
            // Al empezar el recuadro React Flow suelta todo; se vuelven a elegir enseguida.
            if (previas.size > 0) setNodos((ns) => ns.map((n) => (previas.has(n.id) ? { ...n, selected: true } : n)));
          }}
          onSelectionEnd={() => {
            const previas = sumando.current;
            sumando.current = null;
            if (previas && previas.size > 0) setNodos((ns) => ns.map((n) => (previas.has(n.id) ? { ...n, selected: true } : n)));
          }}
          onEdgesChange={alCambiarCables}
          nodeTypes={TIPOS_DE_NODO}
          edgeTypes={TIPOS_DE_CABLE}
          colorMode={tema === "oscuro" ? "dark" : "light"}
          zoomOnDoubleClick={false}
          // VARIAS A LA VEZ, como en n8n (17/10/2026): Shift + arrastrar en el vacío dibuja el
          // rectángulo; arrastrar sin Shift sigue moviendo la vista, como él está acostumbrado.
          selectionKeyCode="Shift"
          // SHIFT + CLIC SUMA O QUITA UNA FICHA (17/10/2026): «si alguna se me quedó fuera, al
          // hacerle clic con Shift la sume, y si alguna no la quiero, con Shift se deseleccione».
          multiSelectionKeyCode={["Shift", "Control", "Meta"]}
          // SOLO LO QUE QUEDA ENTERO DENTRO (17/10/2026): «con solo pasar el mouse se selecciona…
          // necesito que lo que entre dentro del área de selección por completo se seleccione».
          selectionMode={SelectionMode.Full}
          onPaneClick={() => {
            if (Date.now() - abiertoEn.current >= 350) setMenu(null);
            setCajaElegida(null);
          }}
          // AL SOLTAR LO QUE SE MOVIÓ, queda en el borrador: se guarda con Ctrl+S y se
          // deshace con Ctrl+Z, como cualquier cambio del editor.
          onNodeDrag={(_e, n, arrastrados) => alArrastrar(n, arrastrados)}
          onNodeDragStop={(e, _n, arrastrados) => {
            // EL RECUADRO SOLTADO SOBRE UN PUNTO VERDE: se conecta y no se guarda su sitio.
            const u = union.current;
            union.current = null;
            if (u && arrastrados.length === 1 && arrastrados[0].id === u.dest) {
              if (!unirRecuadro(arrastrados[0].data as DatosDeDestino, u.hacia)) marcarUnion(u.dest, null);
              return;
            }
            // SOLTADA SOBRE LA LISTA: vuelve a «Fichas guardadas» (16/10/2026: «al arrastrar la
            // pestaña a la lista se guarde»). Solo las sueltas: una conectada se corta con su ✕.
            const r = refDelPanel.current?.getBoundingClientRect();
            const ev = e as unknown as { clientX: number; clientY: number };
            if (r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
              const sueltas = arrastrados.filter((n) => n.id.startsWith("suelta:"));
              if (sueltas.length > 0) {
                vivo.current.acciones.ocultar(sueltas[0].id.slice("suelta:".length));
                return;
              }
            }
            const posiciones: Record<string, { x: number; y: number }> = {};
            // NADA MÁS SE MUEVE (19/10/2026): «cuando muevo los elementos de Perú en grupo, también
            // se mueven los upsells de los otros grupos… y algunos cajones como pago». Los otros
            // países copian la forma del primero mientras él no los mueva: al mover el primero,
            // se iban detrás. Ahora, al soltar, todo lo que no tenía sitio guardado se queda en el
            // que tiene ahora mismo.
            const movidos = new Set(arrastrados.map((n) => n.id));
            const valido = (p: { x: number; y: number }) => Number.isFinite(p.x) && Number.isFinite(p.y);
            for (const n of nodosVivos.current) {
              if (n.type === "caja" || n.hidden || movidos.has(n.id) || n.id.startsWith("suelta:")) continue;
              if (vivo.current.disposicion.posiciones[n.id] || !valido(n.position)) continue;
              posiciones[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
            }
            let cajasNuevas: CajaDePizarra[] | undefined;
            for (const n of arrastrados) {
              // Una escondida (dentro de un cajón) no tiene sitio propio: la mueve su cajón. Y una
              // posición inválida nunca se guarda (20/10/2026: tumbaba la página).
              if (n.hidden || !valido(n.position)) continue;
              if (n.type === "caja") {
                cajasNuevas = (cajasNuevas ?? cajasVivas.current).map((c) =>
                  c.id === n.id ? { ...c, x: Math.round(n.position.x), y: Math.round(n.position.y) } : c
                );
              } else {
                posiciones[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
                // AL MOVER UN CAJÓN, SUS FICHAS DE DENTRO VAN CON ÉL (20/10/2026): al conectarlo, el
                // cajón nuevo se arma donde están ellas, y saltaba al sitio viejo.
                if (n.type === "cajon") {
                  (n.data as DatosDeCajon).dentro.forEach((id, k) => {
                    posiciones[id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) + k * 4 };
                  });
                }
              }
            }
            guardar({ posiciones, ...(cajasNuevas ? { cajas: cajasNuevas } : {}) });
          }}
          // SOLO LAS CAJAS SE BORRAN CON DELETE. Las fichas, nunca por accidente.
          deleteKeyCode={["Delete", "Backspace"]}
          onNodesDelete={(borrados) => {
            const ids = new Set(borrados.filter((n) => n.type === "caja").map((n) => n.id));
            if (ids.size > 0) guardar({ cajas: cajasVivas.current.filter((c) => !ids.has(c.id)) });
          }}
          /**
           * CONECTAR: del punto naranja al verde.
           *   · de un carril (o del Inicio) a una ficha → esa ficha entra en el camino de ese país
           *   · de una rama a la ficha de la oferta    → la rama lleva a la oferta de 2 opciones
           */
          onConnect={(conexion) => {
            // DESDE O HACIA UN CAJÓN (19/10/2026): se traduce a la tarjeta de dentro, que sigue viva
            // (escondida), y todo lo de abajo funciona igual que siempre. Ver `enCajones`.
            let c = conexion;
            const cajonDe = nodosVivos.current.find((n) => n.id === c.source && n.type === "cajon");
            if (cajonDe && String(c.sourceHandle ?? "").includes("~")) {
              // SOLO EL PRIMER «~» SEPARA (20/10/2026): el código de un botón COPIADO también lleva
              // «~» (`conBotonesNuevos`), y partirlo entero perdía el final: el botón de una copia
              // no se encontraba y su cable no se conectaba nunca.
              const todo = String(c.sourceHandle);
              const corte = todo.indexOf("~");
              c = { ...c, source: todo.slice(0, corte), sourceHandle: todo.slice(corte + 1) };
            } else if (cajonDe) {
              const d = cajonDe.data as DatosDeCajon;
              if (d.ultima) c = { ...c, source: d.ultima, sourceHandle: "sale" };
            }
            // LO COMÚN EN ESPERA SE CONECTA CON SU CABLE (20/10/2026): la cajita entera o la ficha, de
            // una vez, y solo desde una ficha (o el Inicio) del país donde está esperando.
            const comunDestino = (() => {
              const n = nodosVivos.current.find((x) => x.id === c.target);
              if (n?.type === "cajon" && (n.data as DatosDeCajon).comunDe)
                return { pais: (n.data as DatosDeCajon).comunDe!.pais, piezas: (n.data as DatosDeCajon).piezasDe ?? [] };
              if (n?.type === "pieza" && (n.data as DatosDePieza).comunPendiente)
                return { pais: (n.data as DatosDePieza).comunPendiente!.pais, piezas: [(n.data as DatosDePieza).pieza.id] };
              return null;
            })();
            if (comunDestino) {
              const paisDelCable = paisDelOrigen(c.source, c.sourceHandle);
              if (paisDelCable !== comunDestino.pais) {
                setAviso(`Ésta espera en ${banderaDe(comunDestino.pais)} ${comunDestino.pais}: conéctala desde una ficha (o el Inicio) de ${comunDestino.pais}.`);
                return;
              }
              const origenDelCable = nodosVivos.current.find((n) => n.id === c.source);
              const desde = origenDelCable?.type === "pieza" ? (origenDelCable.data as DatosDePieza).pieza.id : undefined;
              acciones.conectarComunes?.(comunDestino.piezas, comunDestino.pais, desde);
              return;
            }
            const cajonA = nodosVivos.current.find((n) => n.id === c.target && n.type === "cajon");
            if (cajonA) {
              const d = cajonA.data as DatosDeCajon;
              if (d.tipo === "cobro") {
                c = { ...c, target: cajonA.id.replace(/cobro$/, `pago:${String(c.targetHandle ?? "entra:unico").replace(/^entra:/, "")}`), targetHandle: "entra" };
              } else if (d.primera) {
                c = { ...c, target: d.primera, targetHandle: "entra" };
              }
            }
            const destino = nodosVivos.current.find((n) => n.id === c.target);
            if (!destino) return;
            const handle = String(c.sourceHandle ?? "");
            // UN CABLE DE UNA RUTA A UNA INTRO DE ORDER BUMP QUE AÚN NO ES DE ELLA (20/10/2026: «cuando
            // duplico la intro de order bump… debería poder recibir las conexiones también desde el
            // cajón de seguimientos»). Soltarlo ahí es decir «que sea de esta ruta»: se conecta, y
            // desde ese momento acepta todos sus cables. Si la ruta ya tenía la suya, quedan dos y el
            // bot sortea entre ellas: se avisa, para que no quede una prueba A/B sin querer.
            const ofertaDestino = destino.type === "pieza" ? (destino.data as DatosDePieza).pieza : undefined;
            if (ofertaDestino?.tipo === "ob" && !handle.startsWith("boton:")) {
              const paisDeLaRuta = paisDelOrigen(c.source, c.sourceHandle);
              if (paisDeLaRuta && !ofertaDestino.paises.includes(paisDeLaRuta)) {
                const origenDeLaRuta = nodosVivos.current.find((n) => n.id === c.source);
                const desde = origenDeLaRuta?.type === "pieza" ? (origenDeLaRuta.data as DatosDePieza).pieza.id : undefined;
                const yaTenia = nodosVivos.current.some((n) => {
                  if (n.type !== "pieza") return false;
                  const d = n.data as DatosDePieza;
                  return !d.suelta && d.pais === paisDeLaRuta && d.pieza.tipo === "ob";
                });
                acciones.conectar(ofertaDestino.id, paisDeLaRuta, desde);
                if (yaTenia)
                  setAviso(
                    `${banderaDe(paisDeLaRuta)} ${paisDeLaRuta} queda con 2 intros de order bump: el bot sorteará entre las dos. Si querías reemplazar la original, córtale su cable.`
                  );
                return;
              }
            }
            // LA FILA ROSADA «QUIERE COMPRAR / PAGAR» (19/10/2026): el cable lo pone él, pero solo
            // adonde el bot va de verdad; en otro sitio no se conecta, y se dice por qué.
            if (handle === "palabra" || handle.startsWith("palabra:")) {
              const dp = nodosVivos.current.find((n) => n.id === c.source)?.data as DatosDePieza | undefined;
              const fila = dp?.palabras?.find((f) => f.id === handle);
              const t = fila?.destinos.find((x) => x.nodo === destino.id);
              // UNA OFERTA PARA VARIOS CAMINOS (18/10/2026, «también podré usar una intro de order
              // bump única»): si su camino no tiene oferta, soltarlo en una la comparte con él.
              const aOferta = (destino.data as Partial<DatosDePieza>).pieza;
              if (dp && fila && !t && handle === "palabra" && aOferta?.tipo === "ob" && fila.destinos.length === 0) {
                acciones.conectar(aOferta.id, dp.pais, dp.pieza.id);
                return;
              }
              if (!dp || !fila || !t) {
                setAviso(
                  handle !== "palabra"
                    ? `«${fila?.texto ?? "Elige"}» va al Pago de ese producto, en su país.`
                    : hayOfertaVisible
                      ? "Esta ficha es de otro camino: «Quiere comprar» solo va a la intro de order bump de su camino. Para llevarla a otra oferta, primero conéctala a ese camino."
                      : "«Quiere pagar» va al Pago de su país."
                );
                return;
              }
              acciones.ponerPuente?.(dp.pais, dp.pieza.id, t.clave);
              return;
            }
            // A UN CAJÓN APAGADO (19/10/2026): el cable es verdadero, conectarlo lo enciende.
            const aCajon = /^pv:[^:]+:(regalo|upsells)$/.exec(destino.id)?.[1];
            if (aCajon && acciones.abrirGestor) {
              // Si el cable solo estaba cortado en la pizarra, vuelve a dibujarse y nada más.
              const suPais = destino.id.split(":")[1];
              const marca = `pv:${aCajon}`;
              const estaApagado = !!(destino.data as Partial<DatosDeFijo>).apagado;
              if ((vivo.current.disposicion.cortados ?? []).includes(`${marca}|${suPais}`)) {
                acciones.confirmarCable?.(marca, suPais);
                if (!estaApagado) return;
              }
              if (aCajon === "regalo") acciones.alternarRegalo?.(true);
              else acciones.alternarUpsells?.(true);
              return;
            }
            // DE UN PAGO A SU ENTREGA (19/10/2026): el cable lo pone él, y solo a la de su producto.
            // Vale para los Pagos del camino, el del upsell 1 y los de la fila de upsells.
            const delPago = /^pv:([^:]+):(pago:(?:basico|full|unico)|up:pago|fila-pago:\d+)$/.exec(c.source);
            if (delPago) {
              const suEntrega = delPago[2]
                .replace(/^pago:/, "entrega:")
                .replace(/^up:pago$/, "up:entrega")
                .replace(/^fila-pago:/, "fila-entrega:");
              if (destino.id !== `pv:${delPago[1]}:${suEntrega}`) {
                setAviso("Cada Pago va a la Entrega de su mismo producto, en su país.");
                return;
              }
              acciones.ponerPuente?.(delPago[1] === "otros" ? "" : delPago[1], delPago[2], suEntrega);
              return;
            }
            // DESDE EL RECUADRO DE UN BOTÓN (18/10/2026): lo mismo que tirar del punto de su botón.
            const deRecuadro = nodosVivos.current.find((n) => n.id === c.source);
            if (deRecuadro?.type === "destino") {
              const dd = deRecuadro.data as DatosDeDestino;
              const aPago = /^pv:[^:]+:pago:(basico|full|unico)$/.exec(destino.id)?.[1];
              const destinoPieza = (destino.data as Partial<DatosDePieza>).pieza;
              if (confirmarSiYaLleva(dd.piezaId, dd.ramaId, destino.id)) return;
              if (aPago) {
                cambiarConAviso(dd.piezaId, dd.ramaId, aPago === "basico" ? "choose_basico" : aPago === "full" ? "choose_combo" : "show_payment");
              } else if (destinoPieza?.tipo === "ob") {
                cambiarConAviso(dd.piezaId, dd.ramaId, "show_order_bump");
              } else {
                setAviso("El recuadro de un botón se conecta a un Pago o a la intro de order bump.");
              }
              return;
            }
            // LOS BOTONES DEL UPSELL Y DEL REGALO llevan siempre a lo mismo: lo decide el bot.
            if (handle.startsWith("boton:")) {
              setAviso("Ese botón lleva siempre a lo mismo: Sí → paga y recibe; No → sigue. Lo que dice cada botón se cambia con doble clic en su tarjeta.");
              return;
            }
            if (handle.startsWith("rama:")) {
              const origen = nodosVivos.current.find((n) => n.id === c.source);
              const pieza = (origen?.data as DatosDePieza | undefined)?.pieza;
              const destinoPieza = (destino.data as Partial<DatosDePieza>).pieza;
              const rama = handle.slice("rama:".length);
              if (pieza && confirmarSiYaLleva(pieza.id, rama, destino.id)) return;
              // A UN PAGO: elegir ese producto (o, con uno solo, ir a pagar).
              const aPago = /^pv:[^:]+:pago:(basico|full|unico)$/.exec(destino.id)?.[1];
              if (pieza && aPago) {
                cambiarConAviso(pieza.id, rama, aPago === "basico" ? "choose_basico" : aPago === "full" ? "choose_combo" : "show_payment");
              } else if (pieza && destinoPieza?.tipo === "ob") {
                cambiarConAviso(pieza.id, rama, "show_order_bump");
              } else if (pieza) {
                setAviso("Un botón o cuadrito se conecta a la oferta de 2 opciones o a un Pago, o suéltalo en el vacío para elegir su destino.");
              }
              return;
            }
            if (destino.type !== "pieza") {
              setAviso("Suéltalo sobre el punto verde de una ficha.");
              return;
            }
            const pais = paisDelOrigen(c.source, c.sourceHandle);
            if (!pais) {
              // DE UNA SUELTA A OTRA (18/10/2026): se enlazan en grupo, en el mismo camino.
              const deSuelta = nodosVivos.current.find((n) => n.id === c.source);
              if (deSuelta?.type === "pieza" && deSuelta.id.startsWith("suelta:") && acciones.enlazar) {
                acciones.enlazar((deSuelta.data as DatosDePieza).pieza.id, (destino.data as DatosDePieza).pieza.id);
                return;
              }
              setAviso("Ese cable no sale de un país: arrastra desde una ficha de un carril, o desde el Inicio.");
              return;
            }
            // De una sub pestaña a otra: además de la bandera, queda dibujado ESE cable (por si
            // salta un paso que a este país le falta).
            const origen = nodosVivos.current.find((n) => n.id === c.source);
            const desde = origen?.type === "pieza" ? (origen.data as DatosDePieza).pieza.id : undefined;
            acciones.conectar((destino.data as DatosDePieza).pieza.id, pais, desde);
          }}
          // SOLTAR EN EL VACÍO: crear ahí una ficha ya conectada, o elegir el destino de la rama.
          onConnectEnd={(evento, estado) => {
            if (estado.isValid || !estado.fromNode) return;
            const punto = "changedTouches" in evento ? evento.changedTouches[0] : evento;
            const sobre = document.elementFromPoint(punto.clientX, punto.clientY);
            // Una CAJA es fondo, no una ficha: soltar dentro de una caja es soltar en el vacío.
            // Sin esto no salía nunca el menú, porque las cajas de cada país lo cubren todo.
            if (sobre?.closest(".react-flow__node:not(.react-flow__node-caja)")) return;
            const handle = String(estado.fromHandle?.id ?? "");
            if (handle.startsWith("rama:")) {
              const pieza = (estado.fromNode.data as DatosDePieza).pieza;
              abrirMenu(punto.clientX, punto.clientY, { tipo: "rama", piezaId: pieza.id, ramaId: handle.slice(5) });
              return;
            }
            const pais = paisDelOrigen(estado.fromNode.id, handle);
            // La ficha nueva nace DONDE SOLTÓ el cable.
            const p = instancia.current?.screenToFlowPosition({ x: punto.clientX, y: punto.clientY });
            const donde = p ? { x: Math.round(p.x), y: Math.round(p.y - 20) } : undefined;
            if (pais) abrirMenu(punto.clientX, punto.clientY, { tipo: "crear", pais, donde });
          }}
          // EL CABLE QUE SE TIRA YA LLEVA SU COLOR (20/10/2026): el de la tarjeta de donde sale, y
          // no cambia al soltarlo. De la burbuja de un botón, el de la tarjeta de su botón.
          onConnectStart={(_e, { nodeId }) => {
            const n = nodosVivos.current.find((x) => x.id === nodeId);
            const deLaBurbuja =
              n?.type === "destino"
                ? nodosVivos.current.find((x) => x.type === "pieza" && (x.data as DatosDePieza).pieza.id === (n.data as DatosDeDestino).piezaId)
                : undefined;
            setColorDelCableNuevo(colorDeLaTarjeta(deLaBurbuja ?? n) ?? AZUL_RAMA);
          }}
          connectionLineStyle={{ stroke: colorDelCableNuevo, strokeWidth: 2.5, strokeDasharray: "6 6" }}
          // Con una mirada recordada, se abre ahí; sin ella, todo encuadrado como siempre.
          fitView={!vistaGuardada}
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.1}
          style={{ background: "transparent" }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color={t.puntos} />
          <Controls showInteractive={false} />
          {/* EL MINIMAPA SOLO SE MIRA (19/10/2026): «se mueve de su sitio… se pone al centro de la
              pantalla… y ahí creo que se traba». Atrapaba el ratón: los clics caían en él. */}
          <MiniMap pannable={false} zoomable={false} nodeStrokeWidth={3} style={{ pointerEvents: "none" }} />
          <ZonaDeLaSeleccion />
        </ReactFlow>

        {/* «FICHAS GUARDADAS» (16/10/2026): las sueltas viven aquí y no en el lienzo —eran 42
            fichas de otros productos debajo de todo, «un montón de pop ups que no sé qué
            significan»—. Se arrastra la que se quiera a la pizarra. */}
        <button
          ref={refDelBotonDelPanel}
          type="button"
          onClick={() => setPanel((v) => !v)}
          className="absolute right-3 top-3 z-10 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow hover:bg-slate-50"
        >
          📦 Fichas guardadas ({guardadas.length})
        </button>
        {panel && (
          <div ref={refDelPanel} className="absolute bottom-3 right-3 top-12 z-10 flex w-72 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-3 py-2 text-[11px] text-slate-600">
              <b className="text-slate-800">Arrástrala a la pizarra.</b> Son las que no están conectadas aquí: apagadas, de otras tiendas o de otros productos. Para devolver una suelta, arrástrala aquí.
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {guardadas.length === 0 && <div className="p-2 text-xs text-slate-500">No hay ninguna.</div>}
              {/* CON SEPARADORES (17/10/2026): «para diferenciar las intros y seguimientos y las
                  intros de order bump». En el orden del camino. */}
              {gruposDelPanel(guardadas).map(({ titulo, piezas: delGrupo }) => (
                <div key={titulo} className="mb-2">
                  <div className="sticky top-0 z-10 -mx-2 mb-1 border-b border-slate-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    {titulo} · {delGrupo.length}
                  </div>
              {delGrupo.map((p) => (
                <div
                  key={p.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/ficha-pizarra", p.id);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  title={p.motivo}
                  className="mb-1.5 cursor-grab rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 hover:border-indigo-400 active:cursor-grabbing"
                >
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-800">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${COLOR[p.tipo].banda}`} />
                    <span className="truncate">{p.titulo || "(sin nombre)"}</span>
                  </div>
                  <div className="truncate pl-4 text-[10px] text-slate-500">
                    {p.paises.map(banderaDe).join(" ")} {p.motivo ?? ""}
                  </div>
                </div>
              ))}
                </div>
              ))}
            </div>
          </div>
        )}
        {menu && (
          <div
            ref={refDelMenu}
            className="absolute z-20 max-h-[70vh] min-w-[220px] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm text-slate-800 shadow-xl"
            style={{ left: posMenu?.x ?? menu.x, top: posMenu?.y ?? menu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* QUITAR UN PAÍS (19/10/2026): «se pueden agregar países… pero no los puedo eliminar».
                Lo que se agrega, se quita. Ver `quitarPais`. */}
            {menu.contenido.tipo === "cable" && (() => {
              const { cableId } = menu.contenido;
              return (
                <button
                  type="button"
                  onClick={() => {
                    setMenu(null);
                    valorDelContexto.curvar(cableId, null);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  〰 Enderezar el cable
                </button>
              );
            })()}
            {menu.contenido.tipo === "inicio" && acciones.quitarPais && (() => {
              const { pais, etiqueta } = menu.contenido;
              return (
                <>
                  <div className="truncate border-b border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-500">▶ Inicio · {etiqueta}</div>
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(null);
                      // Dónde está ahora cada ficha de ese país: ahí se queda, suelta.
                      // SOLO LAS QUE SE VEN EN SU FILA (las de su camino, las tenues del upsell y las
                      // de la tarjeta del upsell): nunca las de otra tienda o semimodalidad.
                      const sitios: Record<string, Punto> = {};
                      const deLaFila = new Set<string>();
                      for (const n of nodosVivos.current) {
                        if (n.type === "pieza" && (n.id.startsWith(`pz:${pais}:`) || n.id.startsWith(`hueco:${pais}:`))) {
                          const pid = (n.data as DatosDePieza).pieza.id;
                          deLaFila.add(pid);
                          sitios[pid] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
                        }
                        if (n.type === "upsell" && n.id === `pv:${pais}:upsell`) {
                          for (const f of (n.data as DatosDeUpsell).filas) deLaFila.add(f.id);
                        }
                        if (n.type === "fijo" && n.id.startsWith(`pv:${pais}:`)) {
                          for (const pid of (n.data as DatosDeFijo).piezasDentro ?? []) deLaFila.add(pid);
                        }
                      }
                      acciones.quitarPais?.(pais, sitios, [...deLaFila]);
                    }}
                    className="block w-full px-3 py-1.5 text-left text-red-700 hover:bg-slate-100"
                  >
                    🗑 Quitar país
                  </button>
                </>
              );
            })()}
            {/* LA CAJITA DE SEGUIMIENTOS: usarla también en otro país, común y sin conectar (20/10/2026). */}
            {menu.contenido.tipo === "cajon" && (() => {
              const { pais, piezaIds, grupo } = menu.contenido;
              const otros = paisesDeLosCarriles.filter((c) => c.clave && c.clave !== pais);
              const opcion = (texto: string, hacer: () => void) => (
                <button
                  key={texto}
                  type="button"
                  onClick={() => {
                    hacer();
                    setMenu(null);
                  }}
                  className="block w-full px-3 py-1.5 text-left hover:bg-slate-100"
                >
                  {texto}
                </button>
              );
              return (
                <>
                  <div className="truncate border-b border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-500">⏱ Seguimientos · {banderaDe(pais)} {pais}</div>
                  {otros.length === 0 && <div className="px-3 py-1.5 text-[11px] text-slate-500">No hay otros países en esta pizarra.</div>}
                  {acciones.ponerComun && otros.length > 1 && opcion("🌎 Usar en todos los países (sin conectar)", () => acciones.ponerComun?.(piezaIds, otros.map((c) => c.clave), grupo))}
                  {acciones.ponerComun && otros.length > 0 && (
                    <div className="border-t border-slate-200 pt-1">
                      <div className="px-3 py-1 text-[11px] font-semibold text-slate-500">🔌 Usar también en… (sin conectar)</div>
                      {otros.map((c) => opcion(`   ${c.etiqueta}`, () => acciones.ponerComun?.(piezaIds, [c.clave], grupo)))}
                    </div>
                  )}
                </>
              );
            })()}
            {/* UNA COMÚN EN ESPERA: quitarla de ese país (la ficha no se borra; sigue en los suyos). */}
            {menu.contenido.tipo === "comun" && (() => {
              const { pais, piezaIds } = menu.contenido;
              return (
                <>
                  <div className="truncate border-b border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-500">COMÚN · sin conectar en {banderaDe(pais)} {pais}</div>
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(null);
                      acciones.quitarComun?.(pais, piezaIds);
                    }}
                    className="block w-full px-3 py-1.5 text-left text-red-700 hover:bg-slate-100"
                  >
                    ✂️ Quitar de {banderaDe(pais)} {pais} (no se borra)
                  </button>
                </>
              );
            })()}
            {menu.contenido.tipo === "pieza" && (() => {
              const { piezaId, pais, nodoId, suelta } = menu.contenido;
              const aqui = dondeEsta(nodoId);
              const junto = alLadoDe(nodoId);
              const p = piezaDe(piezaId);
              if (!p) return null;
              const boton = (texto: string, hacer: () => void, peligro = false) => (
                <button
                  key={texto}
                  type="button"
                  onClick={() => {
                    hacer();
                    setMenu(null);
                  }}
                  className={`block w-full px-3 py-1.5 text-left hover:bg-slate-100 ${peligro ? "text-red-700" : ""}`}
                >
                  {texto}
                </button>
              );
              return (
                <>
                  <div className="truncate border-b border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-500">{p.titulo}</div>
                  {p.editable && boton("✏️ Abrir y editar", () => acciones.abrir(piezaId, undefined, pais || undefined))}
                  {boton(p.estado === "apagada" ? "🟢 Encender" : "⚪ Apagar", () => acciones.alternar(piezaId))}
                  {boton("⧉ Duplicar aquí al lado", () => acciones.duplicar(piezaId, undefined, junto, recuadrosDelNodo(nodoId)))}
                  {paisesDeLosCarriles.filter((c) => c.clave !== pais).length > 0 && (
                    <div className="border-t border-slate-200 pt-1">
                      <div className="px-3 py-1 text-[11px] font-semibold text-slate-500">⧉ Duplicar para…</div>
                      {paisesDeLosCarriles
                        .filter((c) => c.clave !== pais)
                        .map((c) => boton(`   ${c.etiqueta}`, () => acciones.duplicar(piezaId, c.clave, undefined, recuadrosDelNodo(nodoId))))}
                    </div>
                  )}
                  {/* LA MISMA PARA TODOS DE UNA VEZ: queda «COMÚN» en cada fila (17/10/2026). Y SIN
                      CONECTAR (20/10/2026: «nada debe conectar automáticamente»): aparece tenue en
                      cada país y su cable la conecta. */}
                  {acciones.ponerComun &&
                    paisesDeLosCarriles.filter((c) => c.clave && !p.paises.includes(c.clave)).length > 1 &&
                    boton("🌎 Usar en todos los países (sin conectar)", () =>
                      acciones.ponerComun?.(
                        [piezaId],
                        paisesDeLosCarriles.filter((c) => c.clave && !p.paises.includes(c.clave)).map((c) => c.clave),
                        ""
                      )
                    )}
                  {acciones.ponerComun && paisesDeLosCarriles.some((c) => c.clave && !p.paises.includes(c.clave)) && (
                    <div className="border-t border-slate-200 pt-1">
                      <div className="px-3 py-1 text-[11px] font-semibold text-slate-500">🔌 Usar también en… (sin conectar)</div>
                      {paisesDeLosCarriles
                        .filter((c) => c.clave && !p.paises.includes(c.clave))
                        .map((c) => boton(`   ${c.etiqueta}`, () => acciones.ponerComun?.([piezaId], [c.clave], "")))}
                    </div>
                  )}
                  {pais && p.paises.includes(pais) &&
                    boton(`✂️ Sacar de ${banderaDe(pais)} ${pais}`, () => acciones.desconectar(piezaId, pais, aqui), true)}
                  {/* SIN CARRIL (el upsell de la línea, o una suelta): se saca de cada país suyo. */}
                  {!pais &&
                    p.paises.map((b) =>
                      boton(`✂️ Sacar de ${banderaDe(b)} ${b}`, () => acciones.desconectar(piezaId, b, suelta ? aqui : undefined), true)
                    )}
                  {/* Sin arrastrar (17/10/2026): «que haya una opción en el menú que diga regresar a
                      fichas guardadas, con eso ya no las arrastro». */}
                  {suelta && boton("↩ Regresar a Fichas guardadas", () => acciones.ocultar(piezaId))}
                  <div className="my-1 border-t border-slate-200" />
                  {boton("🗑 Eliminar", () => acciones.eliminar(piezaId), true)}
                </>
              );
            })()}
            {(menu.contenido.tipo === "rama" || menu.contenido.tipo === "destino") && (() => {
              const { piezaId, ramaId } = menu.contenido;
              const r = piezaDe(piezaId)?.ramas.find((x) => x.id === ramaId);
              return (
                <>
                  <div className="border-b border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-500">
                    «{r?.etiqueta ?? ""}» lleva a…
                  </div>
                  {r && (!r.accion || r.accion === "send_steps") && (
                    <button
                      type="button"
                      onClick={() => {
                        acciones.abrirRama(piezaId, ramaId);
                        setMenu(null);
                      }}
                      className="block w-full px-3 py-1.5 text-left hover:bg-slate-100"
                    >
                      ✏️ Escribir su mensaje
                    </button>
                  )}
                  {DESTINOS.filter(
                    (d) =>
                      (d.valor !== "show_order_bump" || acciones.conOferta) &&
                      // Solo los botones: en un cuadrito del upsell el «no» ya lo decide el bot.
                      (d.valor !== "decline_upsell" || r?.tipo === "boton")
                  ).map((d) => (
                    <button
                      key={d.valor}
                      type="button"
                      onClick={() => {
                        acciones.cambiarRama(piezaId, ramaId, d.valor);
                        setMenu(null);
                      }}
                      className="block w-full px-3 py-1.5 text-left hover:bg-slate-100"
                    >
                      {d.icono} {d.texto}
                    </button>
                  ))}
                </>
              );
            })()}
            {menu.contenido.tipo === "upsell" && (() => {
              const { productos, conProducto } = menu.contenido;
              const boton = (texto: string, hacer: () => void, peligro = false) => (
                <button
                  key={texto}
                  type="button"
                  onClick={() => {
                    hacer();
                    setMenu(null);
                  }}
                  className={`block w-full px-3 py-1.5 text-left hover:bg-slate-100 ${peligro ? "text-red-700" : ""}`}
                >
                  {texto}
                </button>
              );
              return (
                <>
                  <div className="border-b border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-500">
                    {conProducto ? "🛒 Cambiar el producto de upsell" : "🛒 Elegir el producto de upsell"}
                  </div>
                  {productos.length === 0 && <div className="px-3 py-1.5 text-[11px] text-slate-500">No hay otros productos en la tienda.</div>}
                  {productos.map((p) => boton(`   ${p.nombre}`, () => acciones.elegirUpsell?.(p.id)))}
                  {conProducto && acciones.quitarUpsell && (
                    <>
                      <div className="my-1 border-t border-slate-200" />
                      {boton("⏻ Desactivar el upsell en esta tienda", () => acciones.quitarUpsell?.(), true)}
                    </>
                  )}
                </>
              );
            })()}
            {menu.contenido.tipo === "crear" && (() => {
              const { pais, donde } = menu.contenido;
              const crear = (texto: string, que: LoQueSeCrea) => (
                <button
                  key={texto}
                  type="button"
                  onClick={() => {
                    acciones.crearConectada(que, pais, donde);
                    setMenu(null);
                  }}
                  className="block w-full px-3 py-1.5 text-left hover:bg-slate-100"
                >
                  {texto}
                </button>
              );
              return (
                <>
                  <div className="border-b border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-500">
                    Crear aquí, ya conectado a {banderaDe(pais)} {pais}
                  </div>
                  {crear("🟦 Intro", { tipo: "intro" })}
                  {acciones.seguimientos.map((s) => crear(`🟧 ${s.nombre}`, { tipo: "seguimiento", indice: s.indice }))}
                  {crear(`🟧 Seguimiento nuevo (${acciones.seguimientos.length + 1})`, { tipo: "seguimiento-nuevo" })}
                  {acciones.conOferta && crear("🟪 Oferta de 2 opciones", { tipo: "ob" })}
                  {crear("🟨 Upsell", { tipo: "upsell" })}
                </>
              );
            })()}
          </div>
        )}
        {aviso && (
          <div className="absolute left-1/2 top-3 z-20 max-w-xl -translate-x-1/2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950 shadow-lg">
            {aviso}
          </div>
        )}
      </div>
    </Contexto.Provider>
  );
}
