// Horario silencioso de seguimientos: 22:00 a 07:00 hora Peru (UTC-5).
// Durante esta ventana, los seguimientos automaticos se posponen al
// proximo 07:00 para no despertar al cliente. El intro_data y las
// respuestas a mensajes del cliente NO estan afectados — la persona
// esta activa cuando escribe, asi que recibe respuesta inmediata.

const PERU_OFFSET_SEC = 5 * 3600;
const QUIET_START_HOUR = 22;
const QUIET_END_HOUR = 7;

/**
 * Si el unixSec dado cae en horario silencioso (22:00-07:00 Peru),
 * devuelve el proximo 07:00 Peru en unix sec. Si no cae, devuelve
 * el mismo unixSec sin cambios.
 */
export function adjustForQuietHours(unixSec: number): number {
  const peruSec = unixSec - PERU_OFFSET_SEC;
  const secOfDay = ((peruSec % 86400) + 86400) % 86400;
  const hour = Math.floor(secOfDay / 3600);

  if (hour >= QUIET_END_HOUR && hour < QUIET_START_HOUR) {
    return unixSec;
  }

  const peruMidnight = unixSec - secOfDay;
  if (hour < QUIET_END_HOUR) {
    return peruMidnight + QUIET_END_HOUR * 3600;
  }
  return peruMidnight + 86400 + QUIET_END_HOUR * 3600;
}

/** True si el unixSec dado cae en horario silencioso (22-07 Peru). */
export function isQuietHour(unixSec: number): boolean {
  const peruSec = unixSec - PERU_OFFSET_SEC;
  const secOfDay = ((peruSec % 86400) + 86400) % 86400;
  const hour = Math.floor(secOfDay / 3600);
  return hour < QUIET_END_HOUR || hour >= QUIET_START_HOUR;
}
