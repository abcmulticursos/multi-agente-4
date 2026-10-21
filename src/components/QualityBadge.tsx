"use client";

/**
 * Calificación de calidad del número, tal como la reporta Meta.
 *
 * Vive en su propio archivo porque la usan el panel de chats y el editor: una
 * sola definición, un solo aspecto. Antes estaba dentro de DashboardHeader y
 * por eso el editor no la tenía.
 */
export default function QualityBadge({ quality }: { quality: string | null }) {
  const value = quality?.toUpperCase();
  if (!value) return null;
  const isGreen = value === "GREEN";
  const isYellow = value === "YELLOW";
  // SIN CLASIFICAR NO ES BAJA, Y CONFUNDIRLAS ASUSTA PARA NADA.
  //
  // LO VIO EL DUEÑO el 01/10/2026, al conectar un número recién sacado: «¿todos
  // los números nuevos que se conectan a API aparecerán con calidad baja? acabo
  // de conectar uno nuevecito de paquete y sale así».
  //
  // No era el número: era esta pantalla. Meta devuelve UNKNOWN mientras el número
  // no tiene historial —no ha mandado nada, así que no hay nada que calificar— y
  // aquí TODO lo que no fuera verde o amarillo caía en «Baja», en rojo, con el
  // aviso «riesgo de bloqueo: recomendamos desactivar 1 seguimiento».
  //
  // O sea que aconsejaba apagar un seguimiento por un número sin un solo envío.
  // Un aviso que asusta cuando no pasa nada es peor que no avisar: enseña a
  // ignorar los avisos, y el día que la calidad baje DE VERDAD ya no se mira.
  //
  // Los valores de Meta son GREEN, YELLOW, RED y UNKNOWN (en algunas versiones
  // NA). Un valor que no reconozcamos se trata como sin clasificar, que es lo
  // prudente: inventarle una calificación mala a un dato que no entendemos es
  // exactamente el fallo que esto tenía.
  const sinClasificar = !isGreen && !isYellow && value !== "RED";
  const label = isGreen
    ? "Alta"
    : isYellow
      ? "Media"
      : sinClasificar
        ? "Sin clasificar"
        : "Baja";
  const punto = isGreen
    ? "bg-emerald-500"
    : isYellow
      ? "bg-amber-500"
      : sinClasificar
        ? "bg-neutral-400"
        : "bg-red-500";
  const texto = isGreen
    ? "text-emerald-700"
    : isYellow
      ? "text-amber-700"
      : sinClasificar
        ? "text-neutral-500"
        : "text-red-700";
  const titulo = isGreen
    ? "Calificación de calidad de Meta"
    : isYellow
      ? "Calificación media de Meta"
      : sinClasificar
        ? "Meta todavía no lo califica: este número aún no tiene historial de envíos. No es una mala calificación."
        : "Riesgo de bloqueo: recomendamos desactivar 1 seguimiento";
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-semibold ${texto}`}
      title={titulo}
    >
      <span className={`h-2.5 w-2.5 rounded-full ${punto}`} />
      {label}
    </span>
  );
}
