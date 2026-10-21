/**
 * LA PIZARRA PREGUNTA «¿QUÉ SALE?» CON LAS MISMAS PIEZAS DE REGLA QUE EL BOT.
 *
 * Lo pidió el dueño el 16/10/2026 al aprobar la vista pizarra: «NO DEBE ROMPERSE EL
 * COMPORTAMIENTO DEL BOT». Y la otra mitad, que ya dijo cuando el visor de recorrido
 * enseñaba lo que no era: «muchísimo cuidado que no vaya a salir información falsa».
 *
 * ── POR QUÉ ESTE ARCHIVO Y NO LA FUNCIÓN DEL MOTOR ─────────────────────────
 *
 * El motor decide en tres sitios —`elegirGrupoDeIntro`, `chooseFollowupVariant` y
 * `sorteaCajonDeIntro`— y los tres viven en archivos que arrastran la base de datos, así que
 * el navegador no los puede cargar. Sacarlos de ahí sería tocar el motor, y la pizarra se
 * aprobó con la condición de no tocarlo.
 *
 * Así que esto COMPONE las mismas piezas sueltas que el motor ya comparte con la pantalla
 * —`soloDeSuTienda` y `porSemimodalidad`— en el MISMO orden que el motor, y escribe aquí el
 * único escalón que no está compartido: el de la bandera (tres líneas, copiadas de
 * `sorteaCajonDeIntro` y de `chooseFollowupVariant`, que dicen lo mismo).
 *
 * Y COMO UNA COPIA PUEDE SEPARARSE, HAY UNA PRUEBA QUE LA COMPARA CONTRA EL MOTOR DE VERDAD:
 * `scripts/prueba-la-pizarra-dice-lo-que-hace-el-bot.mjs`. Ejecuta `sorteaCajonDeIntro` con su
 * contenido real, tienda por tienda y país por país, y exige que salga lo mismo que dice aquí.
 *
 * NO IMPORTA NADA QUE TOQUE LA BASE DE DATOS: es la condición para que el navegador lo cargue.
 */
import { soloDeSuTienda, tiendasDe, aLaTiendaLeFaltaLoSuyo } from "@/lib/workflow/etiqueta-de-tienda";
import { porBanderaDelCliente } from "@/lib/workflow/etiqueta-de-bandera";
import {
  laSemimodalidadDeLaTienda,
  porSemimodalidad,
  semimodalidadDe,
} from "@/lib/workflow/etiqueta-de-semimodalidad";

/** Lo mínimo que la regla necesita de una pieza. Los nombres son los del YAML y los del
 *  editor, que en estas cuatro etiquetas coinciden letra por letra. */
export interface PiezaConEtiquetas {
  enabled?: boolean;
  tiendas?: string[] | null;
  paises?: string[] | null;
  pais_routing_enabled?: boolean;
  semimodalidad?: string | null;
}

/** La bandera tal como la lee el motor: apagar el dirigir por país la deja SIN bandera. */
export function banderasDePieza(p: PiezaConEtiquetas): string[] {
  if (p?.pais_routing_enabled === false) return [];
  return (p?.paises ?? [])
    .map((x) => String(x ?? "").trim().toUpperCase())
    .filter(Boolean);
}

/**
 * QUÉ LE PASA A UN PAÍS EN UNA ESTACIÓN.
 *
 *   «propia»    hay pieza con SU bandera
 *   «general»   nadie lleva bandera en esta estación, así que juegan todas (la regla de la
 *               casa: sin etiquetas puestas, nada cambia)
 *   «prestada»  no hay pieza con su bandera y le llega una CON bandera de otro país — la red
 *               de seguridad del motor. Se pinta en rojo: el cliente lee un texto que no es
 *               para él
 *   «falta»     no hay pieza con su bandera y el respaldo entre países está APAGADO: no le
 *               llega nada de otro país (16/10/2026). Qué pasa entonces depende de la estación
 *   «vacia»     no le llega nada de esta estación
 */
export type EstadoDelPais = "propia" | "general" | "prestada" | "falta" | "vacia";

export interface LoQueSaleEnUnPais<T> {
  pais: string;
  estado: EstadoDelPais;
  piezas: T[];
}

export interface LoQueSaleEnLaEstacion<T> {
  /** Las que pasan la tienda y la semimodalidad: las que pueden salir en esta tienda. */
  enJuego: T[];
  /** Una fila por país pedido. */
  porPais: LoQueSaleEnUnPais<T>[];
  /** La fila «Ninguna de las condiciones»: un cliente de un país que no está en la lista. */
  ninguna: LoQueSaleEnUnPais<T>;
}

/**
 * EL ESCALÓN DE LA BANDERA, CON LA MISMA FUNCIÓN QUE EL MOTOR.
 *
 *     si NADIE lleva bandera            -> juegan todas
 *     si hay alguna con la del cliente  -> juegan SOLO ésas
 *     si no                             -> con respaldo, las que llevan ALGUNA (de otro país);
 *                                          sin respaldo, ninguna
 *
 * Lo que no tiene bandera no sale nunca en cuanto alguien etiqueta. Lo pidió el dueño el
 * 02/10/2026: «si no tiene bandera elegida, no sale».
 */
function porBandera<T extends PiezaConEtiquetas>(
  piezas: T[],
  pais: string,
  conRespaldo: boolean
): LoQueSaleEnUnPais<T> {
  const delCliente = String(pais ?? "").trim().toUpperCase();
  const r = porBanderaDelCliente(piezas, banderasDePieza, delCliente, conRespaldo);
  if (r.faltaLaSuya) {
    return { pais: delCliente, estado: conRespaldo ? "prestada" : "falta", piezas: r.jugadas };
  }
  const nadieLlevaBandera = !piezas.some((p) => banderasDePieza(p).length > 0);
  if (nadieLlevaBandera) {
    return { pais: delCliente, estado: piezas.length > 0 ? "general" : "vacia", piezas };
  }
  return { pais: delCliente, estado: "propia", piezas: r.jugadas };
}

/**
 * LO QUE SALE EN UNA ESTACIÓN DE UNA TIENDA, PAÍS POR PAÍS.
 *
 * El orden es el del motor y no se cambia: TIENDA → SEMIMODALIDAD → BANDERA. El anuncio va
 * después en el motor y aquí no se resuelve: depende del anuncio por el que entró cada
 * cliente, así que la pizarra lo enseña como etiqueta en la pieza, no como fila.
 *
 * `semimodalidadDeLaTienda` es el valor GUARDADO en la tienda («», «dos_juntas»,
 * «segunda_oculta»); se traduce aquí con la misma función que usa el motor.
 */
export function loQueSaleEnLaEstacion<T extends PiezaConEtiquetas>(
  piezas: T[],
  tiendaId: string | null,
  semimodalidadDeLaTienda: string | null | undefined,
  paises: string[],
  /** `respaldo_entre_paises` del bot. Ausente = encendido, como el motor. */
  conRespaldo = true,
  /** `respaldo_entre_tiendas` del bot (17/10/2026). Ausente = encendido, como el motor. */
  conRespaldoTienda = true
): LoQueSaleEnLaEstacion<T> {
  const encendidas = piezas.filter((p) => p?.enabled !== false);
  // Apagado y sin nada de esta tienda: no juega ninguna, igual que en el motor.
  const deSuTienda =
    !conRespaldoTienda && aLaTiendaLeFaltaLoSuyo(encendidas, (p) => tiendasDe(p), tiendaId || null)
      ? []
      : soloDeSuTienda(encendidas, (p) => tiendasDe(p), tiendaId || null);
  const enJuego = porSemimodalidad(
    deSuTienda,
    (p) => semimodalidadDe(p),
    laSemimodalidadDeLaTienda({ semimodalidad: semimodalidadDeLaTienda ?? "" })
  );
  return {
    enJuego,
    porPais: paises.map((pais) => porBandera(enJuego, pais, conRespaldo)),
    // Un país que nadie nombra: si hay banderas puestas, le llega una de otro (o nada).
    ninguna: porBandera(enJuego, "", conRespaldo),
  };
}

/**
 * LOS PAÍSES QUE MERECEN FILA: los que aparecen en alguna bandera del proyecto.
 *
 * No se escribe una lista a mano. Si mañana etiqueta Chile, Chile aparece solo.
 */
export function paisesConBandera(piezas: PiezaConEtiquetas[]): string[] {
  const vistos = new Set<string>();
  for (const p of piezas) for (const b of banderasDePieza(p)) vistos.add(b);
  return [...vistos];
}
