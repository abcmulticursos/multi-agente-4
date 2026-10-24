/**
 * DÓNDE ESTÁ CADA CLIENTE EN EL TABLERO, y lo que ya compró y recibió. Tablas propias: el motor de
 * siempre no las lee ni las escribe, y una conversación SIN fila aquí es del motor de siempre.
 *
 * `vuelta` sube cada vez que el cliente cambia de ficha (o contesta sin moverse): los relojes
 * programados la llevan anotada, y si al vencer ya no coincide, el reloj no hace nada. Así un
 * «no respondió en 3 horas» nunca le llega a quien sí respondió.
 *
 * Este archivo NO importa el motor (ni el de siempre ni el del tablero): el motor de siempre lo
 * importa a él (fin del regalo), y al revés habría un círculo.
 */
import db, { scheduleAction } from "@/lib/db";

db.exec(`
  CREATE TABLE IF NOT EXISTS tablero_estado (
    conversation_id INTEGER PRIMARY KEY,
    tienda_id TEXT NOT NULL,
    ficha_id TEXT NOT NULL,
    desde INTEGER NOT NULL,
    vuelta INTEGER NOT NULL DEFAULT 0,
    -- El cobro que sigue abierto mientras salen los recordatorios (ver PLAN-TABLERO.md).
    cobro_ficha_id TEXT,
    cobro_desde INTEGER,
    cobro_pagado REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS tablero_compras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    ficha_id TEXT NOT NULL,
    producto_id TEXT,
    salida TEXT NOT NULL,
    monto REAL NOT NULL,
    moneda TEXT,
    at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_tablero_compras_convo ON tablero_compras(conversation_id);
  CREATE TABLE IF NOT EXISTS tablero_pagos (
    huella TEXT PRIMARY KEY,
    conversation_id INTEGER NOT NULL,
    at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  -- LO QUE LE ENTREGARON LAS FICHAS «Entregar» (23/10/2026), para el reenvío.
  CREATE TABLE IF NOT EXISTS tablero_entregas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    producto_id TEXT NOT NULL,
    at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_tablero_entregas_convo ON tablero_entregas(conversation_id);
`);

// Columnas que llegaron después: se añaden si faltan.
for (const [col, tipo] of [
  ["botones_usados", "TEXT NOT NULL DEFAULT ''"],
  // El canal con el que entró: sigue en ESE tablero aunque luego escriba por otro sitio.
  ["canal", "TEXT NOT NULL DEFAULT 'whatsapp'"],
  // Un seguimiento con «activa el precio de oferta» ya salió.
  ["oferta", "INTEGER NOT NULL DEFAULT 0"],
  // La caja «Seguimientos»: cuál toca y la ficha (el token invalida los relojes viejos).
  ["seg_ficha", "TEXT"],
  ["seg_idx", "INTEGER NOT NULL DEFAULT 0"],
  ["seg_token", "INTEGER NOT NULL DEFAULT 0"],
  // El reloj del «no pagó»: se reinicia cuando el cliente escribe.
  ["cobro_reloj", "INTEGER NOT NULL DEFAULT 0"],
  // Los precios con los que se abrió el cobro (congelados): {productoId: precio}.
  ["cobro_precios", "TEXT"],
  // «¿Fue un error o deseas X?»: el producto que se le propuso.
  ["cobro_propuesta", "TEXT"],
  // La versión que le salió de cada ficha con versiones: {fichaId: varianteId}.
  ["variantes", "TEXT NOT NULL DEFAULT '{}'"],
  // El último comprobante (id del mensaje) que el tablero ya leyó: no se vuelve a leer.
  ["comprobante_leido", "INTEGER"],
  // Los productos que ya se le presentaron (la IA solo habla de éstos): JSON con sus ids.
  ["presentados", "TEXT NOT NULL DEFAULT '[]'"],
  // En un cobro con varios productos, el que eligió (o al que cambió). Vacío = el de la ficha.
  ["cobro_elegido", "TEXT"],
  // Desde cuándo cuentan los seguimientos de la caja (su último mensaje, o la hora a la que se
  // aplazó un lead tardío), como el T0 del motor de siempre.
  ["seg_desde", "INTEGER"],
  // Las muestras de la galería que ya se le enviaron («<producto>#<n>»): cada una, una sola vez.
  ["muestras", "TEXT NOT NULL DEFAULT '[]'"],
  // Esperando su correo para mandarle los enlaces (1 = se le pidió la dirección; 2 = se le preguntó
  // si lo enviamos a la que ya dio).
  ["correo_espera", "INTEGER NOT NULL DEFAULT 0"],
] as const) {
  try {
    db.exec(`ALTER TABLE tablero_estado ADD COLUMN ${col} ${tipo}`);
  } catch {
    // Ya existía.
  }
}

export interface EstadoEnElTablero {
  conversation_id: number;
  tienda_id: string;
  ficha_id: string;
  desde: number;
  vuelta: number;
  cobro_ficha_id: string | null;
  cobro_desde: number | null;
  cobro_pagado: number;
  botones_usados: string;
  canal: string;
  oferta: number;
  seg_ficha: string | null;
  seg_idx: number;
  seg_token: number;
  cobro_reloj: number;
  cobro_precios: string | null;
  cobro_propuesta: string | null;
  variantes: string;
  comprobante_leido: number | null;
  presentados: string;
  cobro_elegido: string | null;
  seg_desde: number | null;
  muestras: string;
  correo_espera: number;
}

export function esperarCorreo(conversationId: number, modo: 0 | 1 | 2): void {
  db.prepare("UPDATE tablero_estado SET correo_espera = ? WHERE conversation_id = ?").run(modo, conversationId);
}

/** Las muestras que ya se le enviaron. */
export function muestrasEnviadas(e: EstadoEnElTablero | null): string[] {
  try {
    const v = JSON.parse(e?.muestras || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function anotarMuestras(conversationId: number, ids: string[]): void {
  const e = estadoEnElTablero(conversationId);
  if (!e || ids.length === 0) return;
  db.prepare("UPDATE tablero_estado SET muestras = ? WHERE conversation_id = ?").run(
    JSON.stringify([...new Set([...muestrasEnviadas(e), ...ids])]),
    conversationId
  );
}

/** Los productos que ya se le presentaron, en orden. */
export function presentadosDe(e: EstadoEnElTablero | null): string[] {
  try {
    const v = JSON.parse(e?.presentados || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Anota productos como presentados (sin repetir). */
export function anotarPresentados(conversationId: number, ids: Array<string | null | undefined>): void {
  const nuevos = ids.filter((x): x is string => !!x && !!x.trim());
  if (nuevos.length === 0) return;
  const e = estadoEnElTablero(conversationId);
  if (!e) return;
  const todos = [...new Set([...presentadosDe(e), ...nuevos])];
  db.prepare("UPDATE tablero_estado SET presentados = ? WHERE conversation_id = ?").run(JSON.stringify(todos), conversationId);
}

/** En el cobro abierto, el producto que eligió (o null = el de la ficha). */
export function elegirEnElCobro(conversationId: number, productoId: string | null): void {
  db.prepare("UPDATE tablero_estado SET cobro_elegido = ? WHERE conversation_id = ?").run(productoId, conversationId);
}

/** Desde cuándo cuentan los seguimientos de la caja. */
export function contarSeguimientosDesde(conversationId: number, desde: number): void {
  db.prepare("UPDATE tablero_estado SET seg_desde = ? WHERE conversation_id = ?").run(desde, conversationId);
}

export function marcarComprobanteLeido(conversationId: number, mensajeId: number | null): void {
  if (mensajeId === null) return;
  db.prepare("UPDATE tablero_estado SET comprobante_leido = ? WHERE conversation_id = ?").run(mensajeId, conversationId);
}

const ahora = () => Math.floor(Date.now() / 1000);

export function estadoEnElTablero(conversationId: number): EstadoEnElTablero | null {
  return (
    (db.prepare("SELECT * FROM tablero_estado WHERE conversation_id = ?").get(conversationId) as
      | EstadoEnElTablero
      | undefined) ?? null
  );
}

/** La conversación entra al tablero. Solo una vez: si ya tenía fila, no se toca. */
export function entrarAlTablero(conversationId: number, tiendaId: string, fichaId: string, canal = "whatsapp"): boolean {
  return (
    db
      .prepare(
        "INSERT OR IGNORE INTO tablero_estado (conversation_id, tienda_id, ficha_id, desde, canal) VALUES (?, ?, ?, ?, ?)"
      )
      .run(conversationId, tiendaId, fichaId, ahora(), canal).changes > 0
  );
}

/** Pasa a OTRO tablero (un workflow), desde su Inicio. Lo de dentro se reinicia; las compras no. */
export function cambiarDeTablero(conversationId: number, clave: string, fichaId: string, canal = "whatsapp"): void {
  if (!estadoEnElTablero(conversationId)) {
    entrarAlTablero(conversationId, clave, fichaId, canal);
    return;
  }
  db.prepare(
    `UPDATE tablero_estado SET tienda_id = ?, ficha_id = ?, desde = ?, vuelta = vuelta + 1,
       cobro_ficha_id = NULL, cobro_desde = NULL, cobro_pagado = 0, cobro_precios = NULL, cobro_propuesta = NULL,
       cobro_elegido = NULL, seg_ficha = NULL, seg_idx = 0, seg_token = seg_token + 1, botones_usados = ''
     WHERE conversation_id = ?`
  ).run(clave, fichaId, ahora(), conversationId);
}

/** Mueve al cliente a otra ficha y devuelve la vuelta nueva. */
export function moverA(conversationId: number, fichaId: string): number {
  db.prepare(
    "UPDATE tablero_estado SET ficha_id = ?, desde = ?, vuelta = vuelta + 1 WHERE conversation_id = ?"
  ).run(fichaId, ahora(), conversationId);
  return estadoEnElTablero(conversationId)?.vuelta ?? 0;
}

/**
 * EL CLIENTE CONTESTÓ SIN MOVERSE DE FICHA (la IA le respondió): sube la vuelta para que el
 * reloj de «no respondió» de esa ficha ya no salga. Él sí respondió.
 */
export function tocarVuelta(conversationId: number): void {
  db.prepare("UPDATE tablero_estado SET vuelta = vuelta + 1 WHERE conversation_id = ?").run(conversationId);
}

export function abrirCobro(conversationId: number, fichaId: string, precios: Record<string, number>): void {
  db.prepare(
    `UPDATE tablero_estado SET cobro_ficha_id = ?, cobro_desde = ?, cobro_pagado = 0, cobro_precios = ?,
       cobro_propuesta = NULL, cobro_elegido = NULL, cobro_reloj = cobro_reloj + 1 WHERE conversation_id = ?`
  ).run(fichaId, ahora(), JSON.stringify(precios), conversationId);
}

export function preciosDelCobro(e: EstadoEnElTablero): Record<string, number> {
  try {
    const v = JSON.parse(e.cobro_precios ?? "{}");
    return v && typeof v === "object" ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function sumarAlCobro(conversationId: number, monto: number): number {
  db.prepare("UPDATE tablero_estado SET cobro_pagado = cobro_pagado + ? WHERE conversation_id = ?").run(
    monto,
    conversationId
  );
  return estadoEnElTablero(conversationId)?.cobro_pagado ?? monto;
}

export function proponerProducto(conversationId: number, productoId: string | null): void {
  db.prepare("UPDATE tablero_estado SET cobro_propuesta = ? WHERE conversation_id = ?").run(productoId, conversationId);
}

/** El reloj del «no pagó» vuelve a empezar (el cliente escribió). Devuelve su token nuevo. */
export function reiniciarRelojDelCobro(conversationId: number): number {
  db.prepare("UPDATE tablero_estado SET cobro_reloj = cobro_reloj + 1 WHERE conversation_id = ?").run(conversationId);
  return estadoEnElTablero(conversationId)?.cobro_reloj ?? 0;
}

export function cerrarCobro(conversationId: number): void {
  db.prepare(
    `UPDATE tablero_estado SET cobro_ficha_id = NULL, cobro_desde = NULL, cobro_pagado = 0, cobro_precios = NULL,
       cobro_propuesta = NULL, cobro_elegido = NULL, cobro_reloj = cobro_reloj + 1 WHERE conversation_id = ?`
  ).run(conversationId);
}

/** Cambia los precios congelados del cobro abierto (solo para BAJARLOS a la oferta: ver el motor). */
export function ponerPreciosDelCobro(conversationId: number, precios: Record<string, number>): void {
  db.prepare("UPDATE tablero_estado SET cobro_precios = ? WHERE conversation_id = ?").run(JSON.stringify(precios), conversationId);
}

export function activarOferta(conversationId: number): void {
  db.prepare("UPDATE tablero_estado SET oferta = 1 WHERE conversation_id = ?").run(conversationId);
}

/** La caja «Seguimientos»: arranca o pasa al siguiente. Devuelve el token nuevo. */
export function ponerSeguimiento(conversationId: number, fichaId: string | null, idx: number): number {
  db.prepare("UPDATE tablero_estado SET seg_ficha = ?, seg_idx = ?, seg_token = seg_token + 1 WHERE conversation_id = ?").run(
    fichaId,
    idx,
    conversationId
  );
  return estadoEnElTablero(conversationId)?.seg_token ?? 0;
}

export function varianteVista(e: EstadoEnElTablero, fichaId: string): string | null {
  try {
    return (JSON.parse(e.variantes || "{}") as Record<string, string>)[fichaId] ?? null;
  } catch {
    return null;
  }
}

export function apuntarVariante(conversationId: number, fichaId: string, varianteId: string): void {
  const e = estadoEnElTablero(conversationId);
  if (!e) return;
  let mapa: Record<string, string> = {};
  try {
    mapa = JSON.parse(e.variantes || "{}");
  } catch {}
  mapa[fichaId] = varianteId;
  db.prepare("UPDATE tablero_estado SET variantes = ? WHERE conversation_id = ?").run(JSON.stringify(mapa), conversationId);
}

export function anotarCompra(c: {
  conversationId: number;
  fichaId: string;
  productoId?: string | null;
  salida: string;
  monto: number;
  moneda?: string | null;
}): void {
  db.prepare(
    "INSERT INTO tablero_compras (conversation_id, ficha_id, producto_id, salida, monto, moneda) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(c.conversationId, c.fichaId, c.productoId ?? null, c.salida, c.monto, c.moneda ?? null);
}

export function comprasDelCliente(
  conversationId: number
): Array<{ ficha_id: string; producto_id: string | null; salida: string; monto: number; moneda: string | null; at: number }> {
  return db
    .prepare("SELECT ficha_id, producto_id, salida, monto, moneda, at FROM tablero_compras WHERE conversation_id = ? ORDER BY id")
    .all(conversationId) as Array<{
    ficha_id: string;
    producto_id: string | null;
    salida: string;
    monto: number;
    moneda: string | null;
    at: number;
  }>;
}

export function anotarEntrega(conversationId: number, productoId: string): void {
  db.prepare("INSERT INTO tablero_entregas (conversation_id, producto_id) VALUES (?, ?)").run(conversationId, productoId);
}

/** Los productos que le entregó el tablero, sin repetir, en el orden en que salieron. */
export function entregasDelCliente(conversationId: number): string[] {
  const filas = db
    .prepare("SELECT producto_id FROM tablero_entregas WHERE conversation_id = ? ORDER BY id")
    .all(conversationId) as Array<{ producto_id: string }>;
  return [...new Set(filas.map((f) => f.producto_id))];
}

/**
 * EL MISMO COMPROBANTE NO VALE DOS VECES: se guarda su huella (número de operación, o fecha y
 * monto) y si ya estaba, devuelve false. Vale entre conversaciones: el mismo pago mandado por
 * dos clientes también se caza.
 */
export function apuntarHuella(huella: string, conversationId: number): boolean {
  return (
    db.prepare("INSERT OR IGNORE INTO tablero_pagos (huella, conversation_id) VALUES (?, ?)").run(huella, conversationId)
      .changes > 0
  );
}

export function botonYaUsado(conversationId: number, botonId: string): boolean {
  const fila = db.prepare("SELECT botones_usados FROM tablero_estado WHERE conversation_id = ?").get(conversationId) as
    | { botones_usados?: string }
    | undefined;
  return (fila?.botones_usados ?? "").split("\n").includes(botonId);
}

export function apuntarBoton(conversationId: number, botonId: string): void {
  if (botonYaUsado(conversationId, botonId)) return;
  db.prepare(
    "UPDATE tablero_estado SET botones_usados = CASE WHEN botones_usados = '' THEN ? ELSE botones_usados || char(10) || ? END WHERE conversation_id = ?"
  ).run(botonId, botonId, conversationId);
}

/**
 * EL REGALO TERMINÓ (lo avisa el motor de siempre, 23/10/2026). Si la conversación es del tablero,
 * se programa seguir por la salida «Al terminar el regalo» de su ficha. Sin tablero, nada.
 */
export function avisarFinDelRegalo(conversationId: number): void {
  if (!estadoEnElTablero(conversationId)) return;
  scheduleAction(conversationId, "tablero_tras_regalo", {}, ahora() + 3);
}

/**
 * Para «/reiniciar» una conversación: la saca del tablero y olvida sus compras, entregas y
 * comprobantes, como hace el motor de siempre al reiniciar.
 */
export function salirDelTablero(conversationId: number): void {
  db.prepare("DELETE FROM tablero_estado WHERE conversation_id = ?").run(conversationId);
  db.prepare("DELETE FROM tablero_compras WHERE conversation_id = ?").run(conversationId);
  db.prepare("DELETE FROM tablero_pagos WHERE conversation_id = ?").run(conversationId);
  db.prepare("DELETE FROM tablero_entregas WHERE conversation_id = ?").run(conversationId);
}
