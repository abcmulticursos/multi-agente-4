"use client";

import { useEffect, useState } from "react";

/**
 * «💰 REGISTRAR COMPRA EN META» (16/11/2026): para un pago que el bot no aprobó y él entregó a mano. Manda a Meta la
 * MISMA compra que manda el bot al aprobar (con el anuncio de donde vino). No entrega ni le escribe al cliente.
 * Ver `/api/meta/compra-manual`.
 */

type Datos = {
  sugerido: { valor: number | null; moneda: string };
  yaRegistrada: { valor: number; moneda: string; at: number } | null;
  yaPagado: number;
  vinoDeUnAnuncio: boolean;
  esDePrueba: boolean;
};

type Resultado =
  | { ok: true; pixel: string | null; tienda: string | null; vinoDeUnAnuncio: boolean }
  | { ok: false; error: string; explicacion?: { quePasa: string; queHacer: string } | null };

/** «6.500» o «6,500» = seis mil quinientos (así escriben en Argentina); «6,5» = seis y medio. */
export function aNumero(texto: string): number {
  let t = texto.trim().replace(/\s/g, "");
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) t = t.replace(/[.,]/g, "");
  else t = t.replace(",", ".");
  return Number(t);
}

export default function RegistrarCompraEnMeta({
  conversationId,
  onCerrar,
}: {
  conversationId: number;
  onCerrar: () => void;
}) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [valor, setValor] = useState("");
  const [moneda, setMoneda] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  useEffect(() => {
    let vivo = true;
    void fetch(`/api/meta/compra-manual/${conversationId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Datos) => {
        if (!vivo) return;
        setDatos(d);
        setValor(d.sugerido?.valor ? String(d.sugerido.valor) : "");
        setMoneda(d.sugerido?.moneda ?? "");
      })
      .catch(() => vivo && setResultado({ ok: false, error: "No pude leer la conversación." }));
    return () => {
      vivo = false;
    };
  }, [conversationId]);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !enviando) onCerrar();
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [enviando, onCerrar]);

  async function registrar() {
    setEnviando(true);
    setResultado(null);
    const monto = aNumero(valor);
    try {
      const r = await fetch(`/api/meta/compra-manual/${conversationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valor: monto, moneda }),
      });
      const d = (await r.json()) as Resultado;
      setResultado(d);
      if (d.ok) setDatos((x) => (x ? { ...x, yaRegistrada: { valor: monto, moneda: moneda.toUpperCase(), at: Date.now() / 1000 } } : x));
    } catch {
      setResultado({ ok: false, error: "No hubo respuesta del bot. Revisa tu conexión y vuelve a intentar." });
    } finally {
      setEnviando(false);
    }
  }

  const fecha = (s: number) => new Date(s * 1000).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" });
  const listo = resultado?.ok === true;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !enviando && onCerrar()}>
      <div className="w-full max-w-md rounded-lg bg-tarjeta p-5 text-neutral-800 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold">💰 Registrar compra en Meta</h3>
        <p className="mt-1 text-xs text-neutral-500">
          Para un pago que el bot no aprobó y entregaste a mano. Meta la cuenta en el anuncio de donde vino el cliente.
          No le escribe nada al cliente ni cambia la venta.
        </p>

        {!datos && !resultado ? <p className="mt-4 text-sm text-neutral-500">Cargando…</p> : null}

        {datos ? (
          <>
            {datos.esDePrueba ? (
              <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs font-semibold text-amber-900">
                Es una conversación del simulador: a Meta no se le manda nada.
              </p>
            ) : null}
            {datos.yaRegistrada && !listo ? (
              <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs font-semibold text-amber-900">
                ⚠ Ya registraste una compra de {datos.yaRegistrada.valor} {datos.yaRegistrada.moneda} el{" "}
                {fecha(datos.yaRegistrada.at)}. Si la registras otra vez, Meta contará dos compras.
              </p>
            ) : null}
            {datos.yaPagado > 0 && !listo ? (
              <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs font-semibold text-amber-900">
                ⚠ El bot ya aprobó pagos por {datos.yaPagado} en esta conversación y esa compra ya se le mandó a Meta.
                Registra solo lo que el bot NO aprobó.
              </p>
            ) : null}
            <p className={`mt-3 text-xs ${datos.vinoDeUnAnuncio ? "text-emerald-700" : "text-neutral-500"}`}>
              {datos.vinoDeUnAnuncio
                ? "📢 Vino de un anuncio: la compra se le suma a ese anuncio."
                : "Este cliente no vino de un anuncio: la compra se registra en tu pixel, sin anuncio."}
            </p>
            <div className="mt-3 flex gap-2">
              <label className="flex-1 text-xs font-semibold text-neutral-600">
                Monto que pagó
                <input
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  inputMode="decimal"
                  disabled={enviando || listo || datos.esDePrueba}
                  placeholder="6500"
                  className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm font-normal"
                />
              </label>
              <label className="w-24 text-xs font-semibold text-neutral-600">
                Moneda
                <input
                  value={moneda}
                  onChange={(e) => setMoneda(e.target.value.toUpperCase().slice(0, 3))}
                  disabled={enviando || listo || datos.esDePrueba}
                  placeholder="ARS"
                  className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm font-normal uppercase"
                />
              </label>
            </div>
          </>
        ) : null}

        {resultado?.ok === true ? (
          <div className="mt-3 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-900">
            <div className="font-semibold">
              ✅ Compra registrada en Meta: {valor} {moneda}
            </div>
            {resultado.tienda ? <div>Tienda: {resultado.tienda}</div> : null}
            {resultado.pixel ? <div className="break-all">Pixel: {resultado.pixel}</div> : null}
          </div>
        ) : null}
        {resultado?.ok === false ? (
          <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800">
            <div className="font-semibold">No se registró.</div>
            {resultado.explicacion ? (
              <div className="mt-1">
                {resultado.explicacion.quePasa} {resultado.explicacion.queHacer}
              </div>
            ) : null}
            <div className="mt-1 break-words">{resultado.error}</div>
          </div>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCerrar}
            disabled={enviando}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            {listo ? "Listo" : "Cancelar"}
          </button>
          {!listo ? (
            <button
              type="button"
              onClick={() => void registrar()}
              disabled={enviando || !datos || datos.esDePrueba || !valor.trim() || moneda.length !== 3}
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {enviando ? "Registrando…" : datos?.yaRegistrada ? "Registrar otra compra" : "Registrar compra"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
