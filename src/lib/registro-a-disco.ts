/**
 * EL LOG, TAMBIÉN EN DISCO (27/10/2026, su pedido). El visor de EasyPanel guarda solo las últimas
 * líneas y se pierden al reiniciar el contenedor o cuando la máquina entra en reposo: se le cortaba
 * justo la conversación que quería mostrar. Aquí cada línea que el bot ya imprime se copia, con su
 * hora, a `data/logs/AAAA-MM-DD.log` (la carpeta que sobrevive al deploy), y se guardan 14 días.
 *
 * NO cambia nada de lo que el bot hace: solo copia. Si escribir falla, se ignora (el log de siempre
 * sigue saliendo por la consola igual).
 */
import fs from "node:fs";
import path from "node:path";

export const CARPETA_DE_LOGS = path.join(process.cwd(), "data", "logs");
const DIAS_QUE_SE_GUARDAN = 14;

/** La fecha de hoy en Perú (AAAA-MM-DD): el día del archivo. */
export function diaDeHoy(fecha = new Date()): string {
  return new Date(fecha.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

function horaDePeru(fecha = new Date()): string {
  return new Date(fecha.getTime() - 5 * 3600 * 1000).toISOString().slice(11, 19);
}

function aTexto(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return `${a.message}${a.stack ? `\n${a.stack}` : ""}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

let instalado = false;
let diaAbierto = "";
let salida: fs.WriteStream | null = null;

function borrarLosViejos(): void {
  try {
    const limite = diaDeHoy(new Date(Date.now() - DIAS_QUE_SE_GUARDAN * 86400 * 1000));
    for (const f of fs.readdirSync(CARPETA_DE_LOGS))
      if (/^\d{4}-\d{2}-\d{2}\.log$/.test(f) && f.slice(0, 10) < limite) fs.unlinkSync(path.join(CARPETA_DE_LOGS, f));
  } catch {
    // sin carpeta o sin permiso: no pasa nada
  }
}

function escribir(nivel: string, args: unknown[]): void {
  try {
    const hoy = diaDeHoy();
    if (hoy !== diaAbierto || !salida) {
      salida?.end();
      fs.mkdirSync(CARPETA_DE_LOGS, { recursive: true });
      salida = fs.createWriteStream(path.join(CARPETA_DE_LOGS, `${hoy}.log`), { flags: "a" });
      salida.on("error", () => {
        salida = null;
      });
      diaAbierto = hoy;
      borrarLosViejos();
    }
    salida.write(`${horaDePeru()} ${nivel}${aTexto(args)}\n`);
  } catch {
    // nunca rompe el bot por el log
  }
}

/** Se llama una vez al arrancar el servidor (instrumentation.ts). */
export function guardarElLogEnDisco(): void {
  if (instalado) return;
  instalado = true;
  const log = console.log.bind(console);
  const warn = console.warn.bind(console);
  const error = console.error.bind(console);
  console.log = (...args: unknown[]) => {
    log(...args);
    escribir("", args);
  };
  console.warn = (...args: unknown[]) => {
    warn(...args);
    escribir("AVISO ", args);
  };
  console.error = (...args: unknown[]) => {
    error(...args);
    escribir("ERROR ", args);
  };
}

/** Los días que hay guardados, del más nuevo al más viejo. */
export function diasGuardados(): string[] {
  try {
    return fs
      .readdirSync(CARPETA_DE_LOGS)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/**
 * El log de un día; con `convo`, solo las líneas de esa conversación: las que dicen su número y las
 * que llevan su teléfono (las del webhook: «mensaje de <teléfono>»).
 */
export function leerElLog(dia: string, convo?: number | null, telefono?: string | null): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return "";
  let texto = "";
  try {
    texto = fs.readFileSync(path.join(CARPETA_DE_LOGS, `${dia}.log`), "utf8");
  } catch {
    return "";
  }
  if (!convo) return texto;
  const n = String(convo);
  const suya = new RegExp(`(convo[ =]${n}\\b|/api/test-simulator/${n}\\b)`);
  return texto
    .split("\n")
    .filter((l) => suya.test(l) || (!!telefono && l.includes(telefono)))
    .join("\n");
}
