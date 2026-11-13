import { NextResponse, type NextRequest } from "next/server";
import {
  getMetaRuntimeSetting,
  listMetaConnections,
  listMetaWhatsAppConnections,
  negociosDeLaCuentaDeFacebook,
  quitarCuentaDeFacebookDeLaBase,
} from "@/lib/db";
import { actualizarCuentas } from "@/lib/meta/actualizar-cuentas";
import { cuentasDeFacebookConectadas, quitarCuentaDeLaLista } from "@/lib/meta/cuentas-de-facebook";
import { olvidarPaginasSinAcceso } from "@/lib/meta/procesar-permiso";
import { olvidar } from "@/lib/meta/recuerdo";
import { anotarFalloDeMeta } from "@/lib/meta/registro";
import { loadWorkflowConfig } from "@/lib/workflow/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * «QUITAR ESTA CUENTA» DE META CONNECT (13/11/2026). Él: «necesito poder desconectar las cuentas que no quiero…
 * Alberto ya no quiere que se use ahí». Y: «revisa bien para que no hayan fallos ni conflictos».
 *
 * EN DOS PASOS, y el primero no borra nada:
 *   1. Se ACTUALIZA con las DEMÁS cuentas (su permiso guardado, como «↻ Actualizar»): así, lo que ellas también ven
 *      queda con su permiso y no se pierde. Si la principal no se puede revisar (permiso vencido), se para aquí:
 *      sin ella no se puede saber qué es solo de la que se quita.
 *   2. Lo que queda SOLO por la cuenta que se quita —sus negocios, sus números y páginas que ninguna otra ve, sus
 *      píxeles— se enseña, con las tiendas que los usan. Con `confirmar`, se borra eso y la cuenta de la lista.
 *
 * La cuenta principal no se quita aquí: es la que mide las compras. Primero se entra con otra como principal.
 * No toca nada en Meta (la cuenta, sus números y sus páginas siguen allá), ni el contenido, ni los chats.
 */
export async function POST(req: NextRequest) {
  const cuerpo = (await req.json().catch(() => null)) as { id?: unknown; nombre?: unknown; confirmar?: unknown } | null;
  const id = typeof cuerpo?.id === "string" && cuerpo.id ? cuerpo.id : null;
  const nombre = typeof cuerpo?.nombre === "string" && cuerpo.nombre ? cuerpo.nombre : null;
  const confirmar = cuerpo?.confirmar === true;
  const cuenta = cuentasDeFacebookConectadas().find((c) => (id ? c.id === id : !c.id && c.nombre === nombre));
  if (!cuenta) return NextResponse.json({ ok: false, error: "Esa cuenta ya no está conectada." });
  if (cuenta.origen === "principal")
    return NextResponse.json({
      ok: false,
      error:
        "Es la cuenta principal (la que mide las compras). Para quitarla, primero entra con la otra cuenta con «Iniciar sesión con Facebook» (así pasa a ser la principal) y luego quita ésta.",
    });

  // 1. Las demás cuentas, al día.
  const demas = await actualizarCuentas({ id: cuenta.id, nombre: cuenta.nombre });
  const falloPrincipal = demas.find((r) => r.principal && !r.ok);
  if (falloPrincipal)
    return NextResponse.json({
      ok: false,
      error: `No pude revisar con ${falloPrincipal.nombre ?? "la cuenta principal"}: ${falloPrincipal.error ?? "Meta no respondió."} Sin eso no sé qué depende solo de ${cuenta.nombre ?? "esta cuenta"}, así que no quité nada.`,
    });
  const vistosNumeros = new Set(demas.flatMap((r) => r.numerosVistos ?? []));
  const vistasPaginas = new Set(demas.flatMap((r) => r.paginasVistas ?? []));

  // 2. Lo que depende SOLO de ella.
  const negocios = negociosDeLaCuentaDeFacebook(cuenta.id, cuenta.nombre);
  const susNegocios = new Set(negocios.map((n) => n.id));
  const susPermisos = new Set(negocios.map((n) => n.token).filter((t): t is string => !!t));
  const numeros = listMetaWhatsAppConnections().filter(
    (n) => !vistosNumeros.has(n.phone_number_id) && ((n.business_id && susNegocios.has(n.business_id)) || susPermisos.has(n.access_token))
  );
  const paginas = listMetaConnections().filter((p) => !vistasPaginas.has(p.page_id) && !!p.business_id && susNegocios.has(p.business_id));
  // Un píxel suyo que otro negocio (de otra cuenta) también puede usar, se queda.
  let pixeles: Array<{ id: string; nombre: string }> = [];
  try {
    const lista = JSON.parse(getMetaRuntimeSetting("pixels_detectados") ?? "[]");
    if (Array.isArray(lista))
      pixeles = lista
        .filter(
          (p: { businessId?: string; accesoDe?: Array<{ id?: string }> }) =>
            susNegocios.has(String(p?.businessId ?? "")) && (p.accesoDe ?? []).every((a) => !a?.id || susNegocios.has(String(a.id)))
        )
        .map((p: { pixelId?: string; name?: string }) => ({ id: String(p.pixelId ?? ""), nombre: String(p.name ?? p.pixelId ?? "") }));
  } catch {
    pixeles = [];
  }
  const idsNumeros = new Set(numeros.map((n) => n.phone_number_id));
  const idsPaginas = new Set(paginas.map((p) => p.page_id));
  const idsPixeles = new Set(pixeles.map((p) => p.id));
  const pixelGeneral = getMetaRuntimeSetting("capi_pixel_id") ?? "";
  const tiendas = (loadWorkflowConfig()?.tiendas ?? [])
    .map((t) => {
      const motivos: string[] = [];
      if (idsNumeros.has(String(t.numero ?? "").trim())) motivos.push("su número");
      if (idsPaginas.has(String(t.pagina ?? "").trim())) motivos.push("su página");
      const pixel = String(t.pixel ?? "").trim() || pixelGeneral;
      if (pixel && idsPixeles.has(pixel)) motivos.push("su píxel");
      return { nombre: String(t.nombre ?? "").trim() || "Tienda sin nombre", motivos };
    })
    .filter((t) => t.motivos.length > 0);
  const resumen = {
    cuenta: cuenta.nombre ?? "Cuenta sin nombre",
    negocios: negocios.map((n) => n.nombre ?? n.id),
    numeros: numeros.map((n) => ({
      id: n.phone_number_id,
      nombre: [n.display_phone_number, n.verified_name].filter(Boolean).join(" · ") || n.phone_number_id,
      activo: n.active === 1,
    })),
    paginas: paginas.map((p) => ({ id: p.page_id, nombre: p.page_name, activa: p.active === 1 })),
    pixeles,
    pixelGeneral: !!pixelGeneral && idsPixeles.has(pixelGeneral),
    tiendas,
    otrasConError: demas.filter((r) => !r.ok).map((r) => `${r.nombre ?? "Cuenta"}: ${r.error}`),
  };
  if (!confirmar) return NextResponse.json({ ok: true, vistaPrevia: true, ...resumen });

  quitarCuentaDeFacebookDeLaBase({ numeros: [...idsNumeros], paginas: [...idsPaginas], negocios: [...susNegocios], pixeles: [...idsPixeles] });
  quitarCuentaDeLaLista(cuenta.id, cuenta.nombre);
  olvidarPaginasSinAcceso(cuenta.id ?? cuenta.nombre ?? "");
  olvidar();
  anotarFalloDeMeta(
    "Quitar una cuenta de Facebook (bien)",
    `${resumen.cuenta} · ${resumen.negocios.length} negocio(s) · ${resumen.numeros.length} número(s) · ${resumen.paginas.length} página(s) · ${resumen.pixeles.length} píxel(es)`
  );
  return NextResponse.json({ ok: true, hecho: true, ...resumen });
}
