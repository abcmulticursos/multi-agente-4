import { getMetaRuntimeSetting, setMetaRuntimeSettings } from "@/lib/db";

/**
 * EL REGISTRO DE META CONNECT (21/10/2026).
 *
 * «No quiero entrar a EasyPanel, buscar entre todos los textos lo que necesitas y dártelo». Y
 * además muchos fallos de Meta Connect no dejaban NINGUNA línea en el log (cancelar en Facebook,
 * permisos que faltan…). Aquí se guardan los últimos 20 fallos de Meta, con la hora, qué se estaba
 * haciendo y el texto exacto de Meta; Meta Connect los muestra con «Copiar todo». Y también se
 * escriben en el log de EasyPanel, como respaldo.
 *
 * La pantalla muestra a los clientes una frase simple; el texto técnico vive aquí.
 */
export interface FalloDeMeta {
  cuando: number;
  donde: string;
  texto: string;
}

const CLAVE = "registro_meta_connect";
const CUANTOS = 20;

export function leerRegistroDeMeta(): FalloDeMeta[] {
  try {
    const crudo = getMetaRuntimeSetting(CLAVE);
    const lista = crudo ? (JSON.parse(crudo) as FalloDeMeta[]) : [];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

/** Anota un fallo de Meta. Nunca lanza: anotar no puede romper lo que estaba haciendo. */
export function anotarFalloDeMeta(donde: string, texto: string): void {
  try {
    console.log(`[meta-connect] fallo en ${donde}: ${texto}`);
    const lista = [{ cuando: Date.now(), donde, texto: texto.slice(0, 1500) }, ...leerRegistroDeMeta()].slice(0, CUANTOS);
    setMetaRuntimeSettings({ [CLAVE]: JSON.stringify(lista) });
  } catch {
    // Sin registro, se sigue igual.
  }
}
