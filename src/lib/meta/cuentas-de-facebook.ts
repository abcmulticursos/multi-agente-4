import { getMetaRuntimeSetting, setMetaRuntimeSettings } from "@/lib/db";

/**
 * LAS CUENTAS DE FACEBOOK QUE INICIARON SESIÓN, Y QUÉ BM TRAJO CADA UNA (21/10/2026).
 *
 * «Acabo de conectar una segunda cuenta de Facebook pero no aparece en Meta Connect». Meta Connect
 * mostraba cada cuenta A TRAVÉS de sus negocios, y cada negocio una sola vez, bajo la primera cuenta
 * que lo trajo. Una segunda cuenta que administra los mismos BM (o cuyos BM no tienen números ni
 * páginas) quedaba conectada pero invisible. Aquí se anota cada una al iniciar sesión, para que
 * siempre tenga su fila. «Cerrar sesión de Meta» lo borra con todo lo demás.
 */
export interface CuentaDeFacebookConectada {
  id: string | null;
  nombre: string | null;
  origen: "principal" | "nueva";
  /** Los BM que trajo su inicio de sesión. */
  negocios: string[];
  cuando: number;
}

const CLAVE = "cuentas_de_facebook_conectadas";

export function cuentasDeFacebookConectadas(): CuentaDeFacebookConectada[] {
  try {
    const crudo = getMetaRuntimeSetting(CLAVE);
    const lista = crudo ? (JSON.parse(crudo) as CuentaDeFacebookConectada[]) : [];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

/** Anota (o pone al día) la cuenta que acaba de iniciar sesión. Nunca lanza. */
export function anotarCuentaDeFacebook(c: Omit<CuentaDeFacebookConectada, "cuando">): void {
  try {
    const misma = (x: CuentaDeFacebookConectada) => (c.id && x.id ? x.id === c.id : x.nombre === c.nombre);
    let lista = cuentasDeFacebookConectadas().filter((x) => !misma(x));
    // Solo hay UNA principal: la que entra como principal desplaza a la anterior a «nueva».
    if (c.origen === "principal") lista = lista.map((x) => (x.origen === "principal" ? { ...x, origen: "nueva" as const } : x));
    lista = [...lista, { ...c, cuando: Date.now() }];
    setMetaRuntimeSettings({ [CLAVE]: JSON.stringify(lista) });
  } catch {
    // Sin la lista, Meta Connect se ve como antes.
  }
}
