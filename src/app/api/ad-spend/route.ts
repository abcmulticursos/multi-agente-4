import { NextResponse, type NextRequest } from "next/server";
import {
  getAdSpendByCountry,
  getAdSpendCountryDays,
  setAdSpendCountry,
} from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Inversión en anuncios (para el ROAS y la ganancia del panel). Se registra
 * POR DÍA y POR PAÍS, cada una en la moneda de su país, para poder ver la
 * ganancia real de cada mercado. Solo lectura/escritura desde el panel — no
 * toca el bot.
 *
 *   GET  /api/ad-spend?from=…&to=…              → { by_country: { PE: 42000 } }
 *   GET  /api/ad-spend?from=…&to=…&country=PE&detail=1
 *                                               → añade days: [{date, amount_cents}]
 *   POST /api/ad-spend  { date, country, amount }
 *
 * Compatibilidad: la respuesta sigue trayendo total_cents (suma de todos los
 * países, sin convertir) y el POST acepta el antiguo amount_soles sin country,
 * que se registra como Perú.
 */
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  const country = req.nextUrl.searchParams.get("country");
  const detail = req.nextUrl.searchParams.get("detail") === "1";

  const by_country = getAdSpendByCountry(from, to);
  const total_cents = Object.values(by_country).reduce((a, n) => a + n, 0);
  const days =
    detail && from && to && country
      ? getAdSpendCountryDays(from, to, country)
      : undefined;

  return NextResponse.json(
    days ? { total_cents, by_country, days } : { total_cents, by_country },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    date?: string;
    country?: string;
    amount?: number;
    /** Nombre antiguo del campo; se conserva para no romper llamadas viejas. */
    amount_soles?: number;
  } | null;

  const monto = typeof body?.amount === "number" ? body.amount : body?.amount_soles;
  if (
    !body?.date ||
    typeof monto !== "number" ||
    !Number.isFinite(monto) ||
    monto < 0
  ) {
    return NextResponse.json(
      { ok: false, error: "datos inválidos (date + amount)" },
      { status: 400 }
    );
  }

  // "GLOBAL" es el cajón de inversión sin país, que se registra en dólares.
  const pais = (body.country ?? "PE").trim().toUpperCase();
  if (!/^([A-Z]{2}|GLOBAL)$/.test(pais)) {
    return NextResponse.json(
      { ok: false, error: "país inválido" },
      { status: 400 }
    );
  }

  setAdSpendCountry(body.date, pais, Math.round(monto * 100));
  return NextResponse.json({ ok: true });
}
