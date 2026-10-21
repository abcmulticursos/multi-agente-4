// Auth del dashboard. Una sola contraseña global vive en
// process.env.DASHBOARD_PASSWORD. La cookie de sesión es un HMAC firmado
// con esa misma contraseña — si la cambiás (rotación), todas las
// sesiones existentes quedan invalidadas automáticamente.
//
// Usa Web Crypto (no node:crypto) porque el middleware corre en el Edge
// runtime de Next y este módulo se importa desde ahí.

export const SESSION_COOKIE_NAME = "wa_session";
export const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 días

function getPassword(): string | null {
  const raw = process.env.DASHBOARD_PASSWORD;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

export function isAuthConfigured(): boolean {
  return getPassword() !== null;
}

function toHex(buf: ArrayBuffer): string {
  const arr = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < arr.length; i++) {
    out += arr[i].toString(16).padStart(2, "0");
  }
  return out;
}

async function hmacHex(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return toHex(sig);
}

function constTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function checkPassword(input: string): boolean {
  const expected = getPassword();
  if (!expected) return false;
  return constTimeEq(input, expected);
}

export async function buildSessionCookieValue(): Promise<string> {
  const secret = getPassword();
  if (!secret) throw new Error("DASHBOARD_PASSWORD no configurado");
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + SESSION_COOKIE_MAX_AGE;
  const payload = `${issuedAt}.${expiresAt}`;
  const sig = await hmacHex(payload, secret);
  return `${payload}.${sig}`;
}

export async function isValidSessionCookie(
  value: string | undefined | null
): Promise<boolean> {
  if (!value) return false;
  const secret = getPassword();
  if (!secret) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [issuedAtStr, expiresAtStr, sig] = parts;
  const expectedSig = await hmacHex(`${issuedAtStr}.${expiresAtStr}`, secret);
  if (!constTimeEq(sig, expectedSig)) return false;
  const expiresAt = Number.parseInt(expiresAtStr, 10);
  if (!Number.isFinite(expiresAt)) return false;
  if (Math.floor(Date.now() / 1000) >= expiresAt) return false;
  return true;
}
