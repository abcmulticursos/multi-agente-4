import type { TipoDeFicha } from "@/lib/tablero/tipos";

/**
 * Cómo se ve cada tipo de ficha del tablero: su icono, su nombre, la franja, el borde y el color
 * de sus cables. Los de la pizarra para lo que ella también tiene (intro = mensaje en celeste,
 * seguimiento en naranja, intro de order bump en violeta, entrega en verde, cobro en turquesa).
 */
export const ASPECTO: Record<TipoDeFicha, { icono: string; nombre: string; color: string; borde: string; trazo: string }> = {
  inicio: { icono: "▶", nombre: "Inicio", color: "bg-emerald-600", borde: "border-emerald-500", trazo: "#059669" },
  mensaje: { icono: "💬", nombre: "Mensaje", color: "bg-sky-600", borde: "border-sky-500", trazo: "#0284c7" },
  seguimientos: { icono: "🔁", nombre: "Seguimientos", color: "bg-orange-500", borde: "border-orange-400", trazo: "#f97316" },
  intro_ob: { icono: "🎁", nombre: "Intro de order bump", color: "bg-violet-600", borde: "border-violet-500", trazo: "#7c3aed" },
  entregar: { icono: "📦", nombre: "Entregar", color: "bg-emerald-600", borde: "border-emerald-500", trazo: "#059669" },
  // TURQUESA (27/10/2026): «el cobro anaranjado se parece mucho a los seguimientos; el dólar es verde».
  cobro: { icono: "💰", nombre: "Cobro", color: "bg-teal-500", borde: "border-teal-400", trazo: "#14b8a6" },
  condicion: { icono: "🔀", nombre: "Condición", color: "bg-slate-600", borde: "border-slate-500", trazo: "#475569" },
  reparto: { icono: "🎲", nombre: "Reparto por peso", color: "bg-fuchsia-600", borde: "border-fuchsia-500", trazo: "#c026d3" },
  esperar: { icono: "⏱", nombre: "Esperar", color: "bg-stone-500", borde: "border-stone-400", trazo: "#78716c" },
  workflow: { icono: "▶▶", nombre: "Ir a un workflow", color: "bg-indigo-600", borde: "border-indigo-500", trazo: "#4f46e5" },
  regalo: { icono: "🎁", nombre: "Postventa y regalo", color: "bg-pink-600", borde: "border-pink-500", trazo: "#db2777" },
  humano: { icono: "🙋", nombre: "Pasar a humano", color: "bg-rose-600", borde: "border-rose-500", trazo: "#e11d48" },
  correo: { icono: "📧", nombre: "Pedir correo y enviar", color: "bg-cyan-600", borde: "border-cyan-500", trazo: "#0891b2" },
};

/** El orden en que se ofrecen al crear una ficha. */
export const TIPOS_PARA_CREAR: TipoDeFicha[] = [
  "mensaje",
  "seguimientos",
  "intro_ob",
  "cobro",
  "entregar",
  "correo",
  "condicion",
  "reparto",
  "esperar",
  "workflow",
  "regalo",
  "humano",
];
