import type { TipoDeFicha } from "@/lib/tablero/tipos";

/** Cómo se ve cada tipo de ficha del tablero: su icono, su nombre y su color. */
export const ASPECTO: Record<TipoDeFicha, { icono: string; nombre: string; color: string }> = {
  inicio: { icono: "🚀", nombre: "Inicio", color: "bg-emerald-600" },
  mensaje: { icono: "💬", nombre: "Mensaje", color: "bg-sky-600" },
  entregar: { icono: "📦", nombre: "Entregar", color: "bg-violet-600" },
  cobro: { icono: "💰", nombre: "Cobro", color: "bg-amber-600" },
  condicion: { icono: "🔀", nombre: "Condición", color: "bg-slate-600" },
  esperar: { icono: "⏱", nombre: "Esperar", color: "bg-teal-600" },
  regalo: { icono: "🎁", nombre: "Postventa y regalo", color: "bg-pink-600" },
  humano: { icono: "🙋", nombre: "Pasar a humano", color: "bg-rose-600" },
};
