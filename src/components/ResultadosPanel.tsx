"use client";

import { useEffect, useMemo, useState } from "react";
import {
  COUNTRIES,
  countryOfConversation,
  formatCurrencyAmount,
  resolveCountry,
  type CountryCode,
} from "@/lib/countries";

/**
 * RESULTADOS DEL DÍA.
 *
 * Para saber desde el celular si la campaña está funcionando, sin tener que
 * abrir el Kanban ni sentarse en una computadora: cuántas entraron, cuántas
 * pagaron, cuánto entró, cuánto se gastó en anuncios y cuánto quedó.
 *
 * Los importes NUNCA se suman entre monedas. Vendes en soles y en dólares, y
 * sumarlos daría un número que no significa nada: van separados por país.
 *
 * Se calcula con las MISMAS conversaciones que alimentan el Kanban y con el
 * mismo criterio de país, para que las dos pantallas no den cifras distintas.
 * Es solo lectura: no toca nada del bot.
 */

export interface ResultadoConversacion {
  id: number;
  phone: string;
  channel?: string | null;
  country_code?: string | null;
  created_at?: number | null;
  paid_at?: number | null;
  paid_total_cents?: number;
}

interface Props {
  conversations: ResultadoConversacion[];
}

/** Fecha en Perú (YYYY-MM-DD). El bot trabaja con el día peruano. */
const FORMATO_DIA = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Lima",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function diaDe(epochSegundos: number): string {
  return FORMATO_DIA.format(new Date(epochSegundos * 1000));
}

/** Los últimos `n` días, del más reciente al más antiguo. */
function ultimosDias(n: number): string[] {
  const dias: string[] = [];
  const hoy = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(hoy.getTime() - i * 24 * 3600 * 1000);
    dias.push(FORMATO_DIA.format(d));
  }
  return dias;
}

interface Periodo {
  titulo: string;
  dias: Set<string>;
  desde: string;
  hasta: string;
}

interface Cifras {
  entraron: number;
  pagaron: number;
  /** Ingresos por país, en céntimos de su propia moneda. */
  ingresosPorPais: Map<CountryCode, number>;
}

function calcular(
  conversaciones: ResultadoConversacion[],
  dias: Set<string>
): Cifras {
  const cifras: Cifras = {
    entraron: 0,
    pagaron: 0,
    ingresosPorPais: new Map(),
  };
  for (const c of conversaciones) {
    if (c.created_at && dias.has(diaDe(c.created_at))) cifras.entraron += 1;
    if (c.paid_at && dias.has(diaDe(c.paid_at))) {
      cifras.pagaron += 1;
      const pais = countryOfConversation(c);
      const previo = cifras.ingresosPorPais.get(pais) ?? 0;
      cifras.ingresosPorPais.set(pais, previo + (c.paid_total_cents ?? 0));
    }
  }
  return cifras;
}

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const DIAS_SEMANA = ["D", "L", "M", "M", "J", "V", "S"];

function aTexto(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** "2026-08-20" → "20 de agosto de 2026". Para leerlo, no para calcular. */
function enPalabras(fecha: string): string {
  if (!fecha) return "";
  const anio = fecha.slice(0, 4);
  const mes = Number(fecha.slice(5, 7)) - 1;
  const dia = Number(fecha.slice(8, 10));
  return `${dia} de ${MESES[mes] ?? "?"} de ${anio}`;
}

/** Cómo se lee el rango elegido: un día suelto o de una fecha a otra. */
function rangoEnPalabras(desde: string, hasta: string): string {
  if (!desde || !hasta) return "";
  if (desde === hasta) return `Día ${enPalabras(desde)}`;
  return `Del ${enPalabras(desde)} al ${enPalabras(hasta)}`;
}

/**
 * CALENDARIO PROPIO.
 *
 * El campo de fecha del navegador abre el calendario del celular, con sus
 * botones de "establecer / cancelar / borrar", que no se pueden quitar. Este
 * es nuestro: se toca un día y queda elegido al instante, y se sale con UN
 * toque en la zona oscura. Para volver al inicio está el botón "Quitar".
 */
function Calendario({
  valor,
  onElegir,
  onCerrar,
}: {
  valor: string;
  onElegir: (fecha: string) => void;
  onCerrar: () => void;
}) {
  const hoy = new Date();
  const inicial = valor
    ? {
        anio: Number(valor.slice(0, 4)),
        mes: Number(valor.slice(5, 7)) - 1,
      }
    : { anio: hoy.getFullYear(), mes: hoy.getMonth() };
  const [anio, setAnio] = useState(inicial.anio);
  const [mes, setMes] = useState(inicial.mes);

  const primerDiaSemana = new Date(Date.UTC(anio, mes, 1)).getUTCDay();
  const diasDelMes = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const hoyTexto = aTexto(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());

  function mover(paso: number) {
    const d = new Date(Date.UTC(anio, mes + paso, 1));
    setAnio(d.getUTCFullYear());
    setMes(d.getUTCMonth());
  }

  return (
    <div
      // UN solo toque aquí cierra. La tarjeta de dentro no propaga el toque.
      onClick={onCerrar}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xs rounded-2xl bg-tarjeta p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => mover(-1)}
            aria-label="Mes anterior"
            className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-600 transition-colors active:bg-neutral-100"
          >
            ‹
          </button>
          <span className="text-base font-semibold capitalize text-neutral-800">
            {MESES[mes]} {anio}
          </span>
          <button
            type="button"
            onClick={() => mover(1)}
            aria-label="Mes siguiente"
            className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-600 transition-colors active:bg-neutral-100"
          >
            ›
          </button>
        </div>

        <div className="mb-1 grid grid-cols-7 text-center text-xs font-medium text-neutral-400">
          {DIAS_SEMANA.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: primerDiaSemana }).map((_, i) => (
            <span key={`vacio-${i}`} />
          ))}
          {Array.from({ length: diasDelMes }).map((_, i) => {
            const dia = i + 1;
            const texto = aTexto(anio, mes, dia);
            const elegido = texto === valor;
            const esHoy = texto === hoyTexto;
            return (
              <button
                key={dia}
                type="button"
                onClick={() => {
                  // Se elige y se cierra: sin botón de confirmar.
                  onElegir(texto);
                  onCerrar();
                }}
                // Tres estados distinguibles de un vistazo:
                //  · elegido → círculo verde relleno
                //  · hoy     → círculo azul solo con el borde, para ubicarte
                //              aunque hayas elegido otro día
                //  · resto   → texto suelto
                className={`flex h-11 items-center justify-center rounded-full text-base transition-colors ${
                  elegido
                    ? "bg-emerald-600 font-semibold text-white"
                    : esHoy
                      ? "font-semibold text-sky-700 ring-2 ring-inset ring-sky-500 active:bg-neutral-100"
                      : "text-neutral-700 active:bg-neutral-100"
                }`}
              >
                {dia}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Todos los días entre dos fechas (YYYY-MM-DD), inclusive. */
function diasEntre(desde: string, hasta: string): string[] {
  const dias: string[] = [];
  const fin = new Date(`${hasta}T12:00:00Z`).getTime();
  let actual = new Date(`${desde}T12:00:00Z`).getTime();
  // Tope de seguridad: un año. Evita colgarse si las fechas vienen al revés.
  for (let i = 0; actual <= fin && i < 366; i++) {
    dias.push(FORMATO_DIA.format(new Date(actual)));
    actual += 24 * 3600 * 1000;
  }
  return dias;
}

export default function ResultadosPanel({ conversations }: Props) {
  // Rango elegido a mano. Vacío = se muestran los periodos de siempre.
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  /** Qué campo está eligiendo día ahora mismo. */
  const [calendario, setCalendario] = useState<"desde" | "hasta" | null>(null);

  const periodos = useMemo<Periodo[]>(() => {
    // Con un rango elegido, manda ese y solo ese.
    if (desde && hasta && desde <= hasta) {
      const dias = diasEntre(desde, hasta);
      return [
        {
          titulo: rangoEnPalabras(desde, hasta),
          dias: new Set(dias),
          desde,
          hasta,
        },
      ];
    }
    const [hoy, ayer] = ultimosDias(2);
    const siete = ultimosDias(7);
    return [
      { titulo: "Hoy", dias: new Set([hoy]), desde: hoy, hasta: hoy },
      { titulo: "Ayer", dias: new Set([ayer]), desde: ayer, hasta: ayer },
      {
        titulo: "Últimos 7 días",
        dias: new Set(siete),
        desde: siete[siete.length - 1],
        hasta: siete[0],
      },
    ];
  }, [desde, hasta]);

  // Inversión en anuncios por país, para cada periodo. Se guarda por la clave
  // "desde|hasta" de cada uno.
  const [gastos, setGastos] = useState<Record<string, Record<string, number>>>(
    {}
  );
  useEffect(() => {
    let cancelado = false;
    void (async () => {
      for (const p of periodos) {
        try {
          const res = await fetch(
            `/api/ad-spend?from=${p.desde}&to=${p.hasta}`,
            { cache: "no-store" }
          );
          if (!res.ok || cancelado) continue;
          const data = (await res.json()) as {
            by_country?: Record<string, number>;
          };
          if (cancelado) return;
          setGastos((previo) => ({
            ...previo,
            [`${p.desde}|${p.hasta}`]: data.by_country ?? {},
          }));
        } catch {
          // Sin inversión cargada simplemente no se muestra el gasto.
        }
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [periodos]);

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <div className="mx-auto flex max-w-lg flex-col gap-4">
        {/* Elegir fechas. Vacío = Hoy, Ayer y los últimos 7 días. Con las dos
            puestas, se muestra solo ese rango. Para ver un día suelto, se pone
            la misma fecha en las dos. */}
        <section className="rounded-xl border border-neutral-200 bg-tarjeta p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-neutral-700">
              Elegir fechas
            </span>
            {(desde || hasta) && (
              <button
                type="button"
                onClick={() => {
                  setDesde("");
                  setHasta("");
                  setCalendario(null);
                }}
                className="rounded-md px-2 py-1 text-xs text-neutral-500 underline transition-colors active:bg-neutral-100"
              >
                Quitar
              </button>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-1">
              <span className="mb-1 block text-xs text-neutral-500">Desde</span>
              <button
                type="button"
                onClick={() => setCalendario("desde")}
                className="w-full rounded-md border border-neutral-300 px-3 py-2.5 text-left text-base transition-colors active:bg-neutral-100 md:py-2 md:text-sm"
              >
                {desde || <span className="text-neutral-400">Elegir día</span>}
              </button>
            </div>
            <div className="flex-1">
              <span className="mb-1 block text-xs text-neutral-500">Hasta</span>
              <button
                type="button"
                onClick={() => setCalendario("hasta")}
                className="w-full rounded-md border border-neutral-300 px-3 py-2.5 text-left text-base transition-colors active:bg-neutral-100 md:py-2 md:text-sm"
              >
                {hasta || <span className="text-neutral-400">Elegir día</span>}
              </button>
            </div>
          </div>
          {calendario && (
            <Calendario
              valor={calendario === "desde" ? desde : hasta}
              onElegir={(fecha) => {
                if (calendario === "desde") {
                  setDesde(fecha);
                  // Con solo el "desde" puesto, se asume ese mismo día: así
                  // ver un día suelto es un toque, no dos.
                  if (!hasta) setHasta(fecha);
                } else {
                  setHasta(fecha);
                  if (!desde) setDesde(fecha);
                }
              }}
              onCerrar={() => setCalendario(null)}
            />
          )}
          {desde && hasta && desde > hasta ? (
            <p className="mt-2 text-xs text-red-600">
              La fecha de inicio es posterior a la del final.
            </p>
          ) : desde && hasta ? (
            // Lo elegido, escrito en palabras: los números sueltos de arriba
            // se leen mal y es fácil confundir el mes con el día.
            <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
              {rangoEnPalabras(desde, hasta)}
            </p>
          ) : (
            <p className="mt-2 text-xs text-neutral-400">
              Para un solo día, pon la misma fecha en las dos.
            </p>
          )}
        </section>

        {periodos.map((p) => {
          const cifras = calcular(conversations, p.dias);
          const gasto = gastos[`${p.desde}|${p.hasta}`] ?? {};
          // Países con movimiento: los que vendieron o los que tuvieron gasto.
          const paises = new Set<CountryCode>(cifras.ingresosPorPais.keys());
          for (const code of Object.keys(gasto)) {
            if (code !== "GLOBAL" && (gasto[code] ?? 0) > 0) {
              paises.add(resolveCountry(code));
            }
          }
          return (
            <section
              key={p.titulo}
              className="rounded-xl border border-neutral-200 bg-tarjeta p-4 shadow-sm"
            >
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                {p.titulo}
              </h2>

              <div className="flex gap-6">
                <div>
                  <div className="text-2xl font-bold text-neutral-900">
                    {cifras.entraron}
                  </div>
                  <div className="text-xs text-neutral-500">Entraron</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-emerald-600">
                    {cifras.pagaron}
                  </div>
                  <div className="text-xs text-neutral-500">Pagaron</div>
                </div>
              </div>

              {paises.size === 0 ? (
                <p className="mt-3 text-sm text-neutral-400">
                  Todavía no hay ventas en este periodo.
                </p>
              ) : (
                <div className="mt-3 flex flex-col gap-3">
                  {[...paises].map((pais) => {
                    const info = COUNTRIES[pais];
                    const ingreso = cifras.ingresosPorPais.get(pais) ?? 0;
                    const invertido = gasto[pais] ?? 0;
                    const ganancia = ingreso - invertido;
                    return (
                      <div
                        key={pais}
                        className="rounded-lg bg-neutral-50 px-3 py-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-neutral-800">
                            {info.label}
                          </span>
                          <span className="text-base font-semibold text-neutral-900">
                            {formatCurrencyAmount(ingreso / 100, pais)}
                          </span>
                        </div>
                        {invertido > 0 && (
                          <div className="mt-1 flex flex-col gap-0.5 text-xs">
                            <div className="flex justify-between text-neutral-500">
                              <span>gasto en anuncios</span>
                              <span>
                                {formatCurrencyAmount(invertido / 100, pais)}
                              </span>
                            </div>
                            <div
                              className={`flex justify-between font-medium ${
                                ganancia >= 0
                                  ? "text-emerald-700"
                                  : "text-red-600"
                              }`}
                            >
                              <span>ganancia</span>
                              <span>
                                {formatCurrencyAmount(ganancia / 100, pais)}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}

        <p className="px-1 text-center text-xs text-neutral-400">
          Cada país en su propia moneda. No se suman entre sí.
        </p>
      </div>
    </div>
  );
}
