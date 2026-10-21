"use client";

import { useEffect, useState } from "react";

interface Props {
  phone: string;
  verifiedName: string | null;
  productName?: string | null;
}

function formatPhone(phone: string): string {
  return phone.startsWith("+") ? phone : `+${phone}`;
}

/**
 * La foto NO se pide a Meta directamente.
 *
 * Meta entrega la foto de perfil como un enlace FIRMADO que caduca. Se pintaba
 * ese enlace tal cual en la etiqueta de imagen, así que en cuanto vencía —o si
 * el navegador no podía abrirlo— quedaba el icono de imagen rota. Se veía
 * distinto en cada bot solo porque cada uno tenía su enlace con su antigüedad,
 * no porque uno estuviera peor programado que otro.
 *
 * /api/meta/avatar?wa=active lo resuelve en el servidor: pide el enlace fresco
 * con el token y devuelve la imagen. Esa dirección no vence nunca.
 */
const FOTO = "/api/meta/avatar?wa=active";

/** Miniatura suave, con una vista ampliada de identidad al estilo WhatsApp. */
export default function WhatsAppIdentityAvatar({
  phone,
  verifiedName,
  productName,
}: Props) {
  const [open, setOpen] = useState(false);
  // Si la imagen no carga —número sin foto, token sin permiso, lo que sea— se
  // vuelve a la inicial. Nunca se deja el icono de rota: no dice nada y parece
  // que el bot esté averiado.
  const [sinFoto, setSinFoto] = useState(false);
  const name = verifiedName?.trim() || "WhatsApp API";

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-12 w-12 shrink-0 aspect-square items-center justify-center overflow-hidden rounded-full bg-emerald-500 text-base font-semibold text-white ring-2 ring-emerald-100 transition hover:ring-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
        aria-label={`Ver perfil de ${name}`}
        title="Ver perfil de WhatsApp"
      >
        {sinFoto ? (
          "W"
        ) : (
          <img
            src={FOTO}
            alt=""
            onError={() => setSinFoto(true)}
            className="h-full w-full rounded-full object-cover blur-[0.18px] saturate-[.94] contrast-[.97]"
          />
        )}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
          role="presentation"
          onMouseDown={() => setOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={`Perfil de ${name}`}
            className="w-full max-w-sm rounded-2xl bg-tarjeta p-5 text-center shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mx-auto flex h-56 w-56 items-center justify-center overflow-hidden rounded-full bg-emerald-500 text-5xl font-semibold text-white ring-4 ring-emerald-100">
              {sinFoto ? (
                "W"
              ) : (
                <img
                  src={FOTO}
                  alt={`Foto de ${name}`}
                  onError={() => setSinFoto(true)}
                  className="h-full w-full rounded-full object-cover"
                />
              )}
            </div>
            <h2 className="mt-5 text-lg font-bold text-neutral-950">{name}</h2>
            <p className="mt-1 text-sm text-neutral-600">{formatPhone(phone)}</p>
            <p className="mt-4 rounded-lg bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-800">
              Producto: {productName?.trim() || "Sin producto activo"}
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-5 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Cerrar
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}
