/**
 * EL CORREO MAL ESCRITO (29/10/2026, solo ALBERTO 4). Lo pidió el dueño: «han habido veces que el bot ha
 * enviado correos mal escritos, jotmail, yimail, gimail… necesito que el bot pueda distinguir si está bien o
 * mal, pero no quiero gastar en IA… por ejemplo @ gmail,com, yajoo. com». Y que se lo diga claro al cliente,
 * «no sea que el cliente diga sí está bien sin revisarlo».
 *
 * Todo aquí es código, sin IA. Se revisa lo que escribió y, si algo no cuadra, se le dice qué y se le propone
 * cómo quedaría bien. Con su «sí» se usa el corregido; si vuelve a escribir el mismo, se respeta (puede ser un
 * correo real poco común). Ningún correo dudoso se envía sin esa respuesta.
 */

/** Los proveedores de siempre y sus terminaciones reales. */
const PROVEEDORES: Record<string, string[]> = {
  gmail: ["com"],
  hotmail: ["com", "es", "com.ar", "com.mx", "cl"],
  outlook: ["com", "es", "com.ar", "cl"],
  yahoo: ["com", "es", "com.ar", "com.mx"],
  icloud: ["com"],
  live: ["com", "com.mx", "com.ar", "cl"],
};
/** Dominios reales que se parecen a los de arriba y NO son errores. */
const REALES = new Set([
  "ymail.com", "rocketmail.com", "mail.com", "email.com", "gmx.com", "gmx.es", "zoho.com", "yandex.com",
  "me.com", "mac.com", "msn.com", "aol.com", "protonmail.com", "proton.me", "hotmail.co.uk", "outlook.cl",
]);
/** Terminaciones que son «.com» mal escrito. */
const COM_MAL = /^(con|cpm|comm|cmo|om|cim|vom|xom|coom|co m|c0m|cm)$/;

/** Letras que hay que cambiar, quitar, poner o voltear para ir de una palabra a otra. */
function distancia(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/** El dominio, revisado: el mismo si está bien, o el que probablemente quiso escribir. */
function dominioRevisado(dominio: string): string {
  const d = dominio.toLowerCase();
  if (REALES.has(d)) return d;
  const [nombre, ...resto] = d.split(".");
  const fin = resto.join(".");
  const suyos = PROVEEDORES[nombre];
  if (suyos) return suyos.includes(fin) ? d : `${nombre}.${suyos[0]}`;
  // ¿Un proveedor de siempre mal escrito? (jotmail, yimail, gimail, yajoo, hotmial, outlok…)
  let mejor: string | null = null;
  let menor = Infinity;
  for (const p of Object.keys(PROVEEDORES)) {
    if (p.length < 5 || nombre.length < 4) continue;
    const n = distancia(nombre, p);
    if (n <= 2 && n < menor) {
      menor = n;
      mejor = p;
    }
  }
  if (mejor) return `${mejor}.${PROVEEDORES[mejor].includes(fin) ? fin : PROVEEDORES[mejor][0]}`;
  // Un dominio cualquiera (de su trabajo, de su universidad): solo se mira si el «.com» está mal escrito.
  if (COM_MAL.test(fin)) return `${nombre}.com`;
  return d;
}

export type CorreoRevisado =
  | { tipo: "bien"; correo: string }
  | { tipo: "dudoso"; escrito: string; sugerido: string };

/**
 * Busca un correo en lo que escribió y lo revisa. `sinArroba`: también lo busca sin «@» («juan gmail com»,
 * «juan arroba gmail punto com») — solo cuando se le acaba de pedir el correo. null si no hay ninguno.
 */
export function revisarCorreo(texto: string, sinArroba = false): CorreoRevisado | null {
  const t = texto.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
  // «arroba» y «punto» escritos con letras.
  const conSignos = t.replace(/\s+arroba\s+/g, "@").replace(/\s+punto\s+/g, ".");
  // Bien formado («juan@gmail.com», «alumno@upc.edu.pe»): solo se revisa el dominio.
  const bien = conSignos.match(/([a-z0-9._%+-]+)@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/);
  if (bien) {
    const sugerido = `${bien[1]}@${dominioRevisado(bien[2])}`;
    // Si lo dictó con palabras («juan arroba gmail punto com»), se le confirma igual.
    if (conSignos !== t) return { tipo: "dudoso", escrito: texto.trim().slice(0, 80), sugerido };
    return sugerido === bien[0] ? { tipo: "bien", correo: sugerido } : { tipo: "dudoso", escrito: bien[0], sugerido };
  }
  // Con «@» pero separado, con coma o sin terminación: «juan @ gmail,com», «juan@gmail .com», «juan@gmail».
  // Después del punto o la coma solo cuenta una terminación («com», «pe»…): «juan@gmail, hola» no es «.hola».
  const m = conSignos.match(
    /([a-z0-9._%+-]+)\s*@\s*([a-z0-9-]+(?:\s?[.,]\s?(?:com|es|net|org|edu|gob|pe|ar|mx|cl|co|ec|bo|uy|py|ve|me|io|info|con|cpm|comm|cmo)\b){0,3})/
  );
  if (m) {
    const escrito = m[0].trim();
    const local = m[1].replace(/^\.+|\.+$/g, "");
    let dominio = m[2].replace(/\s+/g, "").replace(/,/g, ".");
    // Sin terminación («juan@gmail»): si es un proveedor de siempre, la suya.
    if (!dominio.includes(".")) dominio = PROVEEDORES[dominio] ? `${dominio}.${PROVEEDORES[dominio][0]}` : `${dominio}.com`;
    const sugerido = `${local}@${dominioRevisado(dominio)}`;
    if (!local) return null;
    return sugerido === escrito ? { tipo: "bien", correo: sugerido } : { tipo: "dudoso", escrito, sugerido };
  }
  if (!sinArroba) return null;
  // Sin «@»: «juan gmail com», «juan gmail.com», «juangmail.com».
  const proveedores = Object.keys(PROVEEDORES).join("|");
  const s =
    conSignos.match(new RegExp(`\\b([a-z0-9._%+-]{3,})\\s+(${proveedores})\\s*[.,]?\\s*(com|es)\\b`)) ??
    conSignos.match(new RegExp(`\\b([a-z0-9._%+-]{3,}?)(${proveedores})\\s*[.,]\\s*(com|es)\\b`));
  if (!s) return null;
  return { tipo: "dudoso", escrito: s[0].trim(), sugerido: `${s[1]}@${dominioRevisado(`${s[2]}.${s[3]}`)}` };
}

/** Lo que se le dice cuando el correo no cuadra (texto fijo, sin IA). */
export function textoDelCorreoDudoso(r: { escrito: string; sugerido: string }): string {
  return `Me parece que tu correo está mal escrito: *${r.escrito}* 🤔\n\n¿Quisiste decir *${r.sugerido}*?\n\nSi es así, respóndeme *sí*. Si no, escríbemelo de nuevo revisándolo bien 🙏`;
}

/** El correo que el bot le propuso en su último mensaje («¿Quisiste decir *x*?»), o null. */
export function correoQueSeLePropuso(textoDelBot: string): string | null {
  return textoDelBot.match(/¿Quisiste decir \*([^*\s]+@[^*\s]+)\*\?/)?.[1] ?? null;
}

/** Lo que el bot marcó como mal escrito en su último mensaje, o null. */
export function correoQueSeMarco(textoDelBot: string): string | null {
  return textoDelBot.match(/tu correo está mal escrito: \*([^*]+)\*/)?.[1] ?? null;
}

/**
 * La confirmación del envío: EL MISMO TEXTO del automático (`tryCaptureEmail` en engine.ts), palabra por
 * palabra. Él lo pidió así el 29/10/2026: «nada de reofrecer otros correos… se vende, se entrega y punto».
 */
export function textoDelCorreoEnviado(correo: string): string {
  return `✅ ¡Recibí tu correo: *${correo}*!\n\n📧 Te lo envié también allí para que no lo pierdas. Si no te aparece en tu bandeja de entrada, revisa la carpeta de *SPAM* / *Correo no deseado* 🔎`;
}
