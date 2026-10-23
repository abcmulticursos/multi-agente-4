/**
 * DÓNDE ESTÁ CADA CLIENTE EN EL TABLERO, y lo que ya compró. Tablas propias: el motor de siempre
 * no las lee ni las escribe, y una conversación SIN fila aquí es del motor de siempre.
 *
 * `vuelta` sube cada vez que el cliente cambia de ficha: los relojes programados la llevan
 * anotada, y si al vencer ya no coincide, el cliente se movió y el reloj no hace nada. Así un
 * «no respondió en 3 horas» nunca le llega a quien sí respondió.
 */
import db from "@/lib/db";

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
`);

// LOS BOTONES YA USADOS (22/10/2026): un botón de un mensaje anterior vale (tras la insistencia
// toca «Sí, quiero» de la oferta), pero tocado OTRA VEZ no repite la entrega ni el cobro.
try {
  db.exec("ALTER TABLE tablero_estado ADD COLUMN botones_usados TEXT NOT NULL DEFAULT ''");
} catch {
  // Ya existía.
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

export interface EstadoEnElTablero {
  conversation_id: number;
  tienda_id: string;
  ficha_id: string;
  desde: number;
  vuelta: number;
  cobro_ficha_id: string | null;
  cobro_desde: number | null;
  cobro_pagado: number;
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
export function entrarAlTablero(conversationId: number, tiendaId: string, fichaId: string): boolean {
  return (
    db
      .prepare(
        "INSERT OR IGNORE INTO tablero_estado (conversation_id, tienda_id, ficha_id, desde) VALUES (?, ?, ?, ?)"
      )
      .run(conversationId, tiendaId, fichaId, ahora()).changes > 0
  );
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

export function abrirCobro(conversationId: number, fichaId: string): void {
  db.prepare(
    "UPDATE tablero_estado SET cobro_ficha_id = ?, cobro_desde = ?, cobro_pagado = 0 WHERE conversation_id = ?"
  ).run(fichaId, ahora(), conversationId);
}

export function sumarAlCobro(conversationId: number, monto: number): number {
  db.prepare("UPDATE tablero_estado SET cobro_pagado = cobro_pagado + ? WHERE conversation_id = ?").run(
    monto,
    conversationId
  );
  return estadoEnElTablero(conversationId)?.cobro_pagado ?? monto;
}

export function cerrarCobro(conversationId: number): void {
  db.prepare(
    "UPDATE tablero_estado SET cobro_ficha_id = NULL, cobro_desde = NULL, cobro_pagado = 0 WHERE conversation_id = ?"
  ).run(conversationId);
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

/**
 * Para «/reiniciar» una conversación: la saca del tablero y olvida sus compras y comprobantes,
 * como hace el motor de siempre al reiniciar. Así se puede volver a probar con la misma foto.
 */
export function salirDelTablero(conversationId: number): void {
  db.prepare("DELETE FROM tablero_estado WHERE conversation_id = ?").run(conversationId);
  db.prepare("DELETE FROM tablero_compras WHERE conversation_id = ?").run(conversationId);
  db.prepare("DELETE FROM tablero_pagos WHERE conversation_id = ?").run(conversationId);
}
