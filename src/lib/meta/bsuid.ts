/**
 * LOS CLIENTES CON ALIAS (12/11/2026). WhatsApp deja usar un nombre de usuario en vez del número. A un negocio con el
 * que no habló en 30 días (y que no lo tiene en su libreta), Meta le manda el mensaje SIN el número: solo su
 * «business-scoped user ID» (BSUID) en `from_user_id`, del tipo «CO.13491208655302741918» (país ISO + punto + id;
 * «CO.ENT.…» si es el de la empresa matriz). Doc: developers.facebook.com/documentation/business-messaging/whatsapp/
 * business-scoped-user-ids. El caso real: un amigo de Alberto (número de Colombia) escribió a GRAFISMO y el bot
 * descartó su mensaje con «[wh] mensaje sin id o from, ignorando».
 *
 * El bot guarda a ese cliente con su BSUID donde iría el teléfono: así toda la maquinaria (conversación, candado,
 * tablero, programados) funciona igual, y al enviar se le escribe por `recipient` en vez de `to`.
 */

/** ¿Es un BSUID y no un teléfono? (una conversación archivada lleva «~id» al final: se ignora). */
export function esBSUID(identidad: string | null | undefined): boolean {
  const s = String(identidad ?? "").split("~")[0].trim();
  return /^[A-Z]{2}\.(ENT\.)?[A-Za-z0-9]+$/.test(s);
}

/** El país de un BSUID (sus dos letras), o null si no lo es. */
export function paisDelBSUID(identidad: string | null | undefined): string | null {
  return esBSUID(identidad) ? String(identidad).trim().slice(0, 2).toUpperCase() : null;
}
