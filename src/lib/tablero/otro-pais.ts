/**
 * EL CLIENTE DE OTRO PAÍS (18/11/2026). Él: «hay personas de Venezuela que viven en Colombia y tienen cuenta de Venezuela
 * y quieren pagar con Pago Móvil… al enviar el dato de Venezuela solo cambia el dato pero no el contexto». Y la regla que
 * dictó: «cualquier cosa que haga notar claramente que es de otro país… que le pregunte "¿deseas recibir la información
 * para Venezuela?"… se pregunta solo una vez por conversación, siempre y cuando haga notar que es de otro país». Y ojo:
 * «hola soy de Venezuela» no es pagar — por eso se PREGUNTA, y decide el cliente.
 *
 * Dos señales, las dos salidas de su configuración (ningún país, moneda ni método escrito aquí como regla):
 *   1. Nombra un país —o su gentilicio— donde él vende (tiene métodos de pago puestos) y que no es el suyo → se pregunta.
 *   2. Nombra un método de pago que solo está en los datos de OTRO país (Pago Móvil) → ese país, sin preguntar.
 * Los gentilicios son el nombre de cada país dicho de persona: datos del país, como su etiqueta, no frases del cliente.
 */
import { COUNTRIES, type CountryCode } from "@/lib/countries";
import { resolveCountryPaymentProfile, type WorkflowConfig } from "@/lib/workflow/config";

/** Cómo se nombra a la gente de cada país (masculino y femenino; sin tildes, como llega todo al comparar). */
const GENTILICIOS: Partial<Record<CountryCode, string[]>> = {
  PE: ["peruano", "peruana"],
  MX: ["mexicano", "mexicana"],
  CO: ["colombiano", "colombiana"],
  AR: ["argentino", "argentina"],
  BO: ["boliviano", "boliviana"],
  GT: ["guatemalteco", "guatemalteca"],
  CR: ["costarricense", "tico", "tica"],
  CL: ["chileno", "chilena"],
  EC: ["ecuatoriano", "ecuatoriana"],
  SV: ["salvadoreno", "salvadorena"],
  VE: ["venezolano", "venezolana"],
};

const normal = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "").replace(/[^a-z0-9ñ]+/g, " ").replace(/\s+/g, " ").trim();

/** Sus métodos encendidos en ese país: los nombres y alias con que lo dice la gente. */
function metodosDelPais(pais: CountryCode, config: WorkflowConfig | null): Array<{ metodo: string; claves: string[] }> {
  const perfil = resolveCountryPaymentProfile(pais, config ?? undefined) as
    | { payment_buttons?: Array<{ label?: string; method?: string; aliases?: string[]; enabled?: boolean }> }
    | undefined;
  return (perfil?.payment_buttons ?? [])
    .filter((b) => b && b.enabled !== false && String(b.method ?? "").trim())
    .map((b) => ({ metodo: String(b.method).trim(), claves: [b.label ?? "", ...(b.aliases ?? [])].map(normal).filter((k) => k.length >= 3) }));
}

/** ¿Vende en ese país? Tiene al menos un método de pago puesto. */
function vendeEn(pais: CountryCode, config: WorkflowConfig | null): boolean {
  return metodosDelPais(pais, config).length > 0;
}

const NEGACIONES = new Set(["no", "ni", "sin", "tampoco", "nunca", "jamas"]);

/** ¿La frase normalizada trae la clave como palabras enteras, sin un «no» justo antes? */
function laDice(frase: string, clave: string): boolean {
  const palabras = frase.split(" ");
  const suyas = clave.split(" ");
  for (let i = 0; i + suyas.length <= palabras.length; i++) {
    if (suyas.every((w, k) => palabras[i + k] === w)) {
      const antes = palabras.slice(Math.max(0, i - 3), i);
      if (!antes.some((w) => NEGACIONES.has(w))) return true;
    }
  }
  return false;
}

/** El país —donde vende, distinto del suyo— que el cliente deja ver que es el suyo. null = ninguno. */
export function otroPaisQueMenciona(texto: string, suPais: CountryCode, config: WorkflowConfig | null): CountryCode | null {
  const frase = normal(texto);
  if (!frase) return null;
  for (const codigo of Object.keys(COUNTRIES) as CountryCode[]) {
    if (codigo === suPais || !vendeEn(codigo, config)) continue;
    const nombres = [COUNTRIES[codigo].label, ...(GENTILICIOS[codigo] ?? [])].map(normal);
    if (nombres.some((n) => n && laDice(frase, n))) return codigo;
  }
  return null;
}

/**
 * El país del método que nombra, si ese método SOLO está en los datos de otro país donde vende (Pago Móvil → Venezuela).
 * Un método que también tiene su país (una transferencia) no dice nada: null.
 */
export function paisDelMetodoQueNombra(texto: string, suPais: CountryCode, config: WorkflowConfig | null): CountryCode | null {
  const frase = normal(texto);
  if (!frase) return null;
  const suyas = new Set(metodosDelPais(suPais, config).flatMap((m) => m.claves));
  for (const codigo of Object.keys(COUNTRIES) as CountryCode[]) {
    if (codigo === suPais) continue;
    for (const m of metodosDelPais(codigo, config))
      if (m.claves.some((k) => !suyas.has(k) && laDice(frase, k))) return codigo;
  }
  return null;
}

/** «Sí» o «no» a la pregunta del país (el botón, o escrito). null = no contestó eso. */
export function respuestaAlPais(texto: string, botonSi: string, botonNo: string): boolean | null {
  const t = texto.trim();
  if (t === `bubble:${botonSi}`) return true;
  if (t === `bubble:${botonNo}`) return false;
  const frase = normal(t);
  if (!frase || frase.split(" ").length > 6) return null;
  if (/^(no|nop|nel|no gracias|mejor no|aun no|todavia no)\b/.test(frase)) return false;
  if (/^(si|sii+|sip|ok|okey|dale|claro|por favor|porfa|perfecto|de acuerdo|esta bien|ya|bueno|listo|obvio)\b/.test(frase)) return true;
  return null;
}

/** El nombre del país para decírselo («Venezuela»). */
export function nombreDelPais(pais: CountryCode): string {
  return COUNTRIES[pais]?.label ?? pais;
}
