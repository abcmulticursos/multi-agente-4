import { getCountryInfo } from "@/lib/countries";
import { loadWorkflowConfig } from "@/lib/workflow/config";

// Horario silencioso de seguimientos (zona horaria del país seleccionado).
//
// Ventana QUIET: desde QUIET_START hasta QUIET_END del dia siguiente.
// Durante esta franja NO se envian seguimientos 2 y 3. Si un seguimiento
// se calcula para caer en esta ventana, se difiere a RESUME_AT del proximo
// dia habil (12:00 mediodia por defecto).
//
// IMPORTANTE: el seguimiento 1 ignora esta ventana — dispara siempre que
// se cumpla su delay desde el primer mensaje. La logica de seg 1 NO debe
// llamar a estas funciones.

// Valores de respaldo si la configuración no tiene horas válidas.
const QUIET_START_SEC_OF_DAY = 23 * 3600;
// 07:00 local — protege la madrugada
const QUIET_END_SEC_OF_DAY = 7 * 3600;

/** Offset (segundos) del país configurado en ESE instante, vía Intl → maneja
 *  DST correctamente (ej. Chile). Es lo que hay que SUMAR a unixSec para obtener
 *  la hora local. Perú = -18000. Si algo falla, cae a Perú. */
function activeOffsetSec(unixSec: number): number {
  const tz = getCountryInfo(loadWorkflowConfig()?.country).timezone;
  try {
    const date = new Date(unixSec * 1000);
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const p: Record<string, number> = {};
    for (const part of dtf.formatToParts(date))
      if (part.type !== "literal") p[part.type] = Number(part.value);
    const asUTC = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second
    );
    return Math.round((asUTC - date.getTime()) / 1000);
  } catch {
    return -5 * 3600; // fallback Perú
  }
}

function localSecOfDay(unixSec: number): number {
  const localSec = unixSec + activeOffsetSec(unixSec);
  return ((localSec % 86400) + 86400) % 86400;
}

function localMidnightUnix(unixSec: number): number {
  const sod = localSecOfDay(unixSec);
  return unixSec - sod;
}

/**
 * True si el unixSec dado cae en horario silencioso (22:10 - 07:00 Peru).
 *
 * La ventana cruza medianoche: [22:10, 24:00) ∪ [00:00, 07:00).
 */
export function isQuietHour(unixSec: number): boolean {
  const sod = localSecOfDay(unixSec);
  const { start, end } = configuredQuietTimes();
  if (start === end) return false;
  return start > end
    ? sod >= start || sod < end
    : sod >= start && sod < end;
}

/**
 * Si unixSec cae en horario silencioso, devuelve el proximo 12:00 Peru
 * (RESUME_AT) en unix sec. Si no cae, devuelve unixSec sin cambios.
 *
 * - Si cae despues de QUIET_START del dia D (22:10) → resume el dia D+1 12:00
 * - Si cae antes de QUIET_END del dia D (07:00, madrugada) → resume el mismo
 *   dia D 12:00
 */
export function adjustForQuietHours(unixSec: number): number {
  if (!isQuietHour(unixSec)) return unixSec;
  return nextLocalTime(unixSec, configuredQuietTimes().resumeAt) ?? unixSec;
}

/**
 * Parsea un "HH:MM" y devuelve los segundos desde la medianoche Peru.
 * Tira si el formato es invalido — esto vive en config/intro-data.yaml,
 * editado a mano, asi que cualquier rotura aparece en logs al cargar.
 */
function parseHHMM(s: string): number {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`hora invalida: "${s}" (esperado HH:MM)`);
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) {
    throw new Error(`hora fuera de rango: "${s}"`);
  }
  return h * 3600 + mi * 60;
}

function configuredQuietTimes(): {
  start: number;
  end: number;
  resumeAt: string;
} {
  const quiet = loadWorkflowConfig()?.followup_schedule?.quiet_hours;
  try {
    return {
      start: parseHHMM(quiet?.start || "23:00"),
      end: parseHHMM(quiet?.end || "07:00"),
      resumeAt: quiet?.resume_at || "07:00",
    };
  } catch {
    return {
      start: QUIET_START_SEC_OF_DAY,
      end: QUIET_END_SEC_OF_DAY,
      resumeAt: "07:00",
    };
  }
}

export interface SlotScheduleInput {
  /** Ahora, en unix seconds. */
  nowSec: number;
  /** Cuando se ejecuto el seguimiento anterior (unix sec). Si es 0 o
   *  null, no se aplica la regla de min_gap. */
  lastFollowupAtSec: number | null;
  /** Slots horarios disponibles en formato "HH:MM" hora Peru. */
  slotsHHMM: string[];
  /** Minimo de horas entre seguimientos consecutivos. */
  minGapHours: number;
  /** false = ignora horario silencioso, util para pruebas nocturnas. */
  quietHoursEnabled?: boolean;
}

/** True cuando la hora local de unixSec ya alcanzó HH:MM. Un valor inválido
 * se considera apagado para que un ajuste incompleto no detenga el bot. */
export function isAtOrAfterLocalTime(unixSec: number, hhmm: string): boolean {
  try {
    return localSecOfDay(unixSec) >= parseHHMM(hhmm);
  } catch {
    return false;
  }
}

/** Próxima ocurrencia local de HH:MM. Devuelve null si el formato es inválido. */
export function nextLocalTime(unixSec: number, hhmm: string): number | null {
  try {
    const targetSec = parseHHMM(hhmm);
    const midnight = localMidnightUnix(unixSec);
    return midnight + (localSecOfDay(unixSec) >= targetSec ? 86400 : 0) + targetSec;
  } catch {
    return null;
  }
}

/**
 * Calcula el proximo slot horario en que puede dispararse un seguimiento
 * (seg 2 o seg 3) respetando:
 *  - slot debe ser >= nowSec
 *  - slot - lastFollowupAtSec >= minGapHours * 3600
 *  - el slot NO cae en quiet hours
 *  - si nowSec esta en quiet hours, el primer slot candidato es el
 *    RESUME_AT (12:00) del dia que corresponde
 *
 * Si no hay slot que cumpla hoy, busca en dias siguientes (hasta 7 dias
 * de margen — si pasa eso, algo esta muy mal y devolvemos null).
 *
 * Devuelve el unix sec del slot elegido, o null si no encuentra.
 */
export function computeNextFollowupSlot(
  input: SlotScheduleInput
): number | null {
  const {
    nowSec,
    lastFollowupAtSec,
    slotsHHMM,
    minGapHours,
    quietHoursEnabled = true,
  } = input;
  const minGapSec = minGapHours * 3600;
  const slotsSec = slotsHHMM.map(parseHHMM).sort((a, b) => a - b);
  if (slotsSec.length === 0) return null;

  // Si nowSec esta en quiet hours, arrancamos la busqueda desde el RESUME_AT
  // adecuado (12:00) — eso fuerza que el primer slot evaluado sea >= 12:00
  // del dia correspondiente.
  const searchStart = quietHoursEnabled && isQuietHour(nowSec)
    ? adjustForQuietHours(nowSec)
    : nowSec;

  // Buscamos hasta 7 dias adelante por seguridad.
  let dayMidnight = localMidnightUnix(searchStart);
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    for (const sec of slotsSec) {
      const slotUnix = dayMidnight + sec;
      if (slotUnix < searchStart) continue;
      if (quietHoursEnabled && isQuietHour(slotUnix)) continue;
      if (
        lastFollowupAtSec !== null &&
        lastFollowupAtSec > 0 &&
        slotUnix - lastFollowupAtSec < minGapSec
      ) {
        continue;
      }
      return slotUnix;
    }
    dayMidnight += 86400;
  }
  return null;
}

/**
 * Calcula el offset acumulado para la posicion N (0-based) en una cola
 * anti-rafaga con delays ciclicos.
 *
 * Ejemplo con burstDelays = [15, 21, 27, 32]:
 *   pos 0 → 15 (primer cliente sale 15s despues del slot)
 *   pos 1 → 15+21 = 36
 *   pos 2 → 15+21+27 = 63
 *   pos 3 → 15+21+27+32 = 95
 *   pos 4 → 95+15 = 110
 *   pos 5 → 110+21 = 131
 *   ...
 *
 * Si burstDelays esta vacio, devuelve 0 (todos al mismo instante — solo
 * tiene sentido para slots con 1 cliente).
 */
export function cumulativeBurstOffset(
  positionZeroBased: number,
  burstDelays: number[]
): number {
  if (burstDelays.length === 0) return 0;
  let total = 0;
  for (let i = 0; i <= positionZeroBased; i++) {
    total += burstDelays[i % burstDelays.length];
  }
  return total;
}
