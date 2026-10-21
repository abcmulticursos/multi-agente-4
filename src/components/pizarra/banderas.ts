/**
 * LAS BANDERAS DE LA PIZARRA, en un archivo suelto.
 *
 * Las usan el lienzo y el editor. Si el editor las importara del lienzo, arrastraría la
 * librería de la pizarra a todo el editor, y la pizarra se carga solo al abrirla.
 */
const BANDERA: Record<string, string> = {
  PE: "🇵🇪", EC: "🇪🇨", CO: "🇨🇴", MX: "🇲🇽", AR: "🇦🇷", BO: "🇧🇴",
  GT: "🇬🇹", CR: "🇨🇷", CL: "🇨🇱", SV: "🇸🇻", VE: "🇻🇪",
};

export const banderaDe = (codigo: string): string => BANDERA[codigo] ?? codigo;
