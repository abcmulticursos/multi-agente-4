// ─────────────────────────────────────────────────────────────────────────
// SELECTOR DE PAÍS — fuente ÚNICA de verdad para el bot universal.
// Al elegir el país en la config (campo `country`), esto define de una sola vez:
//   • currency  → la moneda ISO 4217 que se envía a Meta (para ROAS/optimización)
//   • symbol    → el símbolo para el comodín {{MONEDA}} en los textos al cliente
//   • timezone  → la zona horaria IANA para seguimientos / horas de silencio
//   • dialect   → la instrucción de dialecto para el LLM (tuteo/voseo por país)
// Agregar un país nuevo = agregar UNA fila aquí. Nada más en el código.
// ─────────────────────────────────────────────────────────────────────────

export type CountryCode =
  | "PE"
  | "MX"
  | "CO"
  | "AR"
  | "BO"
  | "GT"
  | "CR"
  | "CL"
  | "EC"
  | "SV"
  | "VE";

export interface CountryInfo {
  label: string;
  /** ISO 4217 — lo que Meta necesita EXACTO para evaluar la campaña. */
  currency: string;
  /** Símbolo para {{MONEDA}} en los textos al cliente. */
  symbol: string;
  /** Zona horaria IANA para seguimientos y horas de silencio. */
  timezone: string;
  /** Instrucción de dialecto para el LLM (va al system prompt). */
  dialect: string;
}

export const COUNTRIES: Record<CountryCode, CountryInfo> = {
  PE: {
    label: "Perú",
    currency: "PEN",
    symbol: "S/.",
    timezone: "America/Lima",
    dialect:
      "The customer is PERUVIAN. Use Peruvian Spanish with TUTEO ('tú', 'puedes', 'tienes', 'quieres', 'te envío', 'dime'). NEVER use voseo ('vos', 'podés', 'tenés'). Do NOT use the slang 'al toque'; say 'de inmediato' or 'rápido'.",
  },
  MX: {
    label: "México",
    currency: "MXN",
    symbol: "$",
    timezone: "America/Mexico_City",
    dialect:
      "The customer is MEXICAN. Use Mexican Spanish with TUTEO ('tú', 'puedes', 'tienes', 'te mando'). Warm and natural Mexican expressions. NEVER use voseo ('vos', 'podés').",
  },
  CO: {
    label: "Colombia",
    currency: "COP",
    symbol: "$",
    timezone: "America/Bogota",
    dialect:
      "The customer is COLOMBIAN. Use Colombian Spanish, warm and polite. TUTEO ('tú', 'puedes') is fine; Colombians also use 'usted' politely, so a neutral warm tone works. NEVER use voseo ('vos', 'podés').",
  },
  AR: {
    label: "Argentina",
    currency: "ARS",
    symbol: "$",
    timezone: "America/Argentina/Buenos_Aires",
    dialect:
      "The customer is ARGENTINE. Use Argentine Spanish with VOSEO: 'vos', 'podés', 'tenés', 'querés', 'dejá', 'mandame', 'fijate', 'vení'. NEVER use tuteo ('tú', 'puedes', 'tienes', 'quieres') — it sounds foreign to them.",
  },
  BO: {
    label: "Bolivia",
    currency: "BOB",
    symbol: "Bs",
    timezone: "America/La_Paz",
    dialect:
      "The customer is BOLIVIAN. Use Bolivian Spanish with TUTEO ('tú', 'puedes', 'tienes'), warm and neutral. NEVER use Argentine voseo forms.",
  },
  GT: {
    label: "Guatemala",
    currency: "GTQ",
    symbol: "Q",
    timezone: "America/Guatemala",
    dialect:
      "The customer is GUATEMALAN. Use warm, neutral Central-American Spanish. A polite TUTEO/USTED tone is safe ('puedes'/'puede'). Avoid heavy Argentine voseo forms.",
  },
  CR: {
    label: "Costa Rica",
    currency: "CRC",
    symbol: "₡",
    timezone: "America/Costa_Rica",
    dialect:
      "The customer is COSTA RICAN (Tico). Ticos commonly use 'usted' even in friendly contexts, and also voseo. A warm 'usted' tone is safe and natural ('usted puede', 'le envío'). Avoid Peruvian slang.",
  },
  CL: {
    label: "Chile",
    currency: "CLP",
    symbol: "$",
    timezone: "America/Santiago",
    dialect:
      "The customer is CHILEAN. Use Chilean Spanish with TUTEO ('tú', 'puedes', 'tienes'), warm and neutral. Avoid heavy local slang and avoid Argentine voseo.",
  },
  EC: {
    label: "Ecuador",
    currency: "USD",
    symbol: "$",
    timezone: "America/Guayaquil",
    dialect:
      "The customer is ECUADORIAN. Use warm neutral Ecuadorian Spanish with TUTEO ('tu', 'puedes', 'tienes') or polite 'usted' when natural. Avoid Peruvian-specific slang.",
  },
  SV: {
    label: "El Salvador",
    currency: "USD",
    symbol: "$",
    timezone: "America/El_Salvador",
    dialect:
      "The customer is SALVADORAN. Voseo is common ('vos', 'podés') but a warm, neutral tone also works well. Avoid Peruvian-specific slang.",
  },
  VE: {
    label: "Venezuela",
    currency: "VES",
    symbol: "Bs",
    timezone: "America/Caracas",
    dialect:
      "The customer is VENEZUELAN. Use Venezuelan Spanish with TUTEO ('tú', 'puedes', 'tienes'), warm and natural. NEVER use Argentine voseo forms.",
  },
};

/** País por defecto si la config no trae `country` (mantiene Perú = comportamiento
 *  actual de Mundial, para no cambiar nada de lo que ya funciona). */
export const DEFAULT_COUNTRY: CountryCode = "PE";

/**
 * País de una conversación, con el mismo criterio en TODO el panel.
 *
 * Manda el prefijo del teléfono, que es el dato duro. El país guardado solo se
 * usa en los canales donde no hay teléfono (Messenger y el simulador), y como
 * último recurso.
 *
 * Vive aquí y no en cada pantalla a propósito: el Kanban y los resultados
 * tienen que contar el mismo dinero en el mismo país. Dos copias de esto
 * acabarían dando dos verdades distintas.
 */
export function countryOfConversation(convo: {
  phone: string;
  channel?: string | null;
  country_code?: string | null;
}): CountryCode {
  const guardado = (convo.country_code ?? "").trim();
  const canal = String(convo.channel ?? "");
  const sinTelefono = canal === "messenger" || canal === "test";
  if (guardado && sinTelefono) return resolveCountry(guardado);
  const porTelefono = countryFromPhone(convo.phone);
  if (porTelefono) return porTelefono;
  return guardado ? resolveCountry(guardado) : DEFAULT_COUNTRY;
}

/** Normaliza lo que venga en la config (código o nombre) a un CountryCode válido.
 *  Acepta "PE", "peru", "Perú", "MX", "mexico", etc. Si no reconoce, cae a Perú. */
export function resolveCountry(raw: string | null | undefined): CountryCode {
  if (!raw) return DEFAULT_COUNTRY;
  const v = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
  // Por código ISO directo.
  const upper = raw.trim().toUpperCase();
  if (upper in COUNTRIES) return upper as CountryCode;
  // Por nombre.
  const byName: Record<string, CountryCode> = {
    peru: "PE",
    mexico: "MX",
    colombia: "CO",
    argentina: "AR",
    bolivia: "BO",
    guatemala: "GT",
    "costa rica": "CR",
    costarica: "CR",
    chile: "CL",
    ecuador: "EC",
    "el salvador": "SV",
    salvador: "SV",
    venezuela: "VE",
  };
  return byName[v] ?? DEFAULT_COUNTRY;
}

/** Devuelve la info del país configurado (o Perú por defecto). */
export function getCountryInfo(raw: string | null | undefined): CountryInfo {
  return COUNTRIES[resolveCountry(raw)];
}

export function countryFromCurrency(
  currency: string | null | undefined
): CountryCode {
  const code = (currency ?? "").trim().toUpperCase();
  const match = (Object.entries(COUNTRIES) as Array<[CountryCode, CountryInfo]>)
    .find(([, info]) => info.currency === code);
  return match?.[0] ?? DEFAULT_COUNTRY;
}

function formatAmountForCountry(amount: number, country: CountryCode): string {
  const localeByCountry: Record<CountryCode, string> = {
    PE: "es-PE",
    MX: "es-MX",
    CO: "es-CO",
    AR: "es-AR",
    BO: "es-BO",
    GT: "es-GT",
    CR: "es-CR",
    CL: "es-CL",
    EC: "es-EC",
    SV: "es-SV",
    VE: "es-VE",
  };
  return amount.toLocaleString(localeByCountry[country], {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function currencyDisplayName(
  currency: string,
  country: CountryCode,
  amount: number
): string {
  const singular = Math.abs(amount - 1) < 1e-9;
  if (currency === "PEN") return singular ? "sol" : "soles";
  if (currency === "USD") return singular ? "dólar" : "dólares";
  // Sin gentilicio: a un argentino no se le dice "10 pesos argentinos", se le
  // dice "10 pesos". El país ya lo sabe quien está leyendo, y nombrarlo suena a
  // folleto de cambio de divisas en mitad de una conversación de venta.
  if (currency === "COP") return singular ? "peso" : "pesos";
  if (currency === "MXN") return singular ? "peso" : "pesos";
  if (currency === "ARS") return singular ? "peso" : "pesos";
  if (currency === "BOB") return singular ? "boliviano" : "bolivianos";
  if (currency === "GTQ") return singular ? "quetzal" : "quetzales";
  if (currency === "CRC") return singular ? "colón" : "colones";
  if (currency === "CLP") return singular ? "peso" : "pesos";
  if (currency === "VES") return singular ? "bolívar" : "bolívares";
  return COUNTRIES[country].currency;
}

/**
 * Cómo se llama la parte pequeña de cada moneda.
 *
 * Sin esto, un faltante de 0.90 se escribía "S/. 0.90 Soles". Un cliente lo
 * leyó como si fueran soles, mandó 9 y hubo que devolverle la diferencia. Menos
 * de una unidad se dice en la parte pequeña: "90 céntimos".
 *
 * El peso colombiano y el chileno NO están aquí a propósito: en la calle no
 * existe "90 centavos de peso chileno", así que no se inventa una unidad que
 * nadie puede pagar.
 */
const SUBUNIDAD_POR_MONEDA: Record<string, { singular: string; plural: string }> = {
  PEN: { singular: "céntimo", plural: "céntimos" },
  USD: { singular: "centavo", plural: "centavos" },
  ARS: { singular: "centavo", plural: "centavos" },
  MXN: { singular: "centavo", plural: "centavos" },
  BOB: { singular: "centavo", plural: "centavos" },
  GTQ: { singular: "centavo", plural: "centavos" },
  CRC: { singular: "céntimo", plural: "céntimos" },
  VES: { singular: "céntimo", plural: "céntimos" },
};

function aplicarCaso(
  texto: string,
  labelCase: "title" | "upper" | "lower"
): string {
  if (labelCase === "upper") return texto.toUpperCase();
  if (labelCase === "lower") return texto.toLowerCase();
  return texto.replace(
    /(^|\s)(\p{L})/gu,
    (_, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`
  );
}

/**
 * Monedas que se escriben con su código en vez de con su palabra.
 *
 * Son las cuatro que se llaman "peso" y comparten el símbolo $: sin el código
 * no se sabe de qué pesos se habla, y el gentilicio ("pesos mexicanos") suena a
 * casa de cambio en mitad de una venta.
 */
const PESOS_CON_CODIGO = new Set(["ARS", "MXN", "COP", "CLP"]);

export function formatCurrencyAmount(
  amount: number,
  rawCountry?: string | null,
  rawCurrency?: string | null,
  /** Cómo sale la PALABRA de la moneda (soles, dólares…) o su código (ARS).
   *  El símbolo va siempre y siempre igual. "off" = solo el símbolo. */
  labelCase: "title" | "upper" | "lower" | "off" = "title"
): string {
  const country = rawCountry ? resolveCountry(rawCountry) : countryFromCurrency(rawCurrency);
  const info = COUNTRIES[country];
  const currency = (rawCurrency ?? info.currency).trim().toUpperCase();
  const symbol = info.currency === currency ? info.symbol : getCountryInfo(countryFromCurrency(currency)).symbol;

  // Menos de una unidad se dice en la parte pequeña, o no se dice.
  let monto = amount;
  if (amount > 0 && amount < 1) {
    const subunidad = SUBUNIDAD_POR_MONEDA[currency];
    if (subunidad) {
      const partes = Math.round(amount * 100);
      // 0.996 redondearía a 100, que ya es una unidad entera: en ese caso se
      // sigue por el camino normal y se dice "1 sol", no "100 céntimos".
      if (partes > 0 && partes < 100) {
        const nombre = partes === 1 ? subunidad.singular : subunidad.plural;
        // Aquí no hay símbolo del que tirar —"50 céntimos" se dice entero—,
        // así que "off" se queda con el nombre puesto: quitarlo dejaría un
        // "50" suelto que no dice de qué habla.
        return `${partes} ${aplicarCaso(
          nombre,
          labelCase === "off" ? "title" : labelCase
        )}`;
      }
    } else {
      // Monedas sin parte pequeña: se sube a la unidad más chica que alguien
      // puede pagar de verdad. Nunca a 0, que dejaría un cobro invisible.
      monto = 1;
    }
  }

  const titleDisplayName = currencyDisplayName(currency, country, monto).replace(
    /(^|\s)(\p{L})/gu,
    (_, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`
  );
  const displayName =
    labelCase === "upper"
      ? titleDisplayName.toUpperCase()
      : labelCase === "lower"
        ? titleDisplayName.toLowerCase()
        : titleDisplayName;
  // LOS PESOS SE ESCRIBEN CON SU CÓDIGO: "$18.000 ARS", "$350 MXN".
  //
  // Cuatro países usan el mismo símbolo y la misma palabra, así que "350 pesos"
  // no dice de qué pesos se habla. Allá los precios se escriben pegados al
  // símbolo y con el código detrás, y en una conversación de venta eso se lee
  // natural; "350 pesos mexicanos" suena a casa de cambio.
  //
  // Las demás monedas NO entran aquí: "S/. 10 soles" o "₡ 2.900 colones" no se
  // confunden con nada y su palabra es la que usa la gente.
  // SOLO EL SÍMBOLO, SIN LA PALABRA.
  //
  // El símbolo NUNCA se quita: un número pelado ("10") no dice de qué moneda
  // habla, y en un bot que vende en seis países eso es una confusión servida.
  // Lo que se puede quitar es la palabra o el código de detrás, para quien
  // prefiere "S/. 10" a secas.
  if (labelCase === "off") {
    return PESOS_CON_CODIGO.has(currency)
      ? `${symbol}${formatAmountForCountry(monto, country)}`
      : `${symbol} ${formatAmountForCountry(monto, country)}`;
  }
  if (PESOS_CON_CODIGO.has(currency)) {
    return `${symbol}${formatAmountForCountry(monto, country)} ${currency}`;
  }
  return `${symbol} ${formatAmountForCountry(monto, country)} ${displayName}`;
}

const PHONE_PREFIX_COUNTRIES: Array<[string, CountryCode]> = [
  ["593", "EC"],
  ["591", "BO"],
  ["502", "GT"],
  ["506", "CR"],
  ["503", "SV"],
  ["58", "VE"],
  ["57", "CO"],
  ["56", "CL"],
  ["54", "AR"],
  ["52", "MX"],
  ["51", "PE"],
];

export function countryFromPhone(
  phone: string | null | undefined
): CountryCode | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return (
    PHONE_PREFIX_COUNTRIES.find(([prefix]) => digits.startsWith(prefix))?.[1] ??
    null
  );
}
