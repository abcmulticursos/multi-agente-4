import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";

const CONFIG_DIR = path.join(process.cwd(), "config");
const PROFILES_DIR = path.join(CONFIG_DIR, "product-profiles");
const INDEX_PATH = path.join(PROFILES_DIR, "index.json");

export const PRODUCT_PROFILE_SCHEMA_VERSION = 1;

export interface ProductProfileMeta {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  archived?: boolean;
}

export interface ProductProfileStore {
  schema_version: number;
  active_product_id: string;
  products: ProductProfileMeta[];
}

/** Escribe primero un temporal y luego lo reemplaza: nunca deja medio archivo. */
export function writeTextFileAtomically(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, content, "utf8");
  fs.renameSync(temporary, filePath);
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeId(value: string): string {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || "producto";
}

function productNameFromYaml(raw: string): string {
  try {
    const parsed = parseDocument(raw).toJS() as { product_name?: unknown };
    return typeof parsed?.product_name === "string" && parsed.product_name.trim()
      ? parsed.product_name.trim()
      : "Producto actual";
  } catch {
    return "Producto actual";
  }
}

export function profileYamlRelativePath(productId: string): string {
  return `config/product-profiles/${productId}.yaml`;
}

export function profileYamlPath(productId: string): string {
  return path.join(PROFILES_DIR, `${productId}.yaml`);
}

export function profileIndexRelativePath(): string {
  return "config/product-profiles/index.json";
}

function validStore(value: unknown): value is ProductProfileStore {
  if (!value || typeof value !== "object") return false;
  const store = value as Partial<ProductProfileStore>;
  return (
    store.schema_version === PRODUCT_PROFILE_SCHEMA_VERSION &&
    typeof store.active_product_id === "string" &&
    Array.isArray(store.products) &&
    store.products.every(
      (product) =>
        product &&
        typeof product.id === "string" &&
        typeof product.name === "string"
    )
  );
}

/**
 * Migra de forma no destructiva el bot actual al primer perfil. El YAML activo
 * sigue siendo el unico archivo que lee el motor en produccion.
 */
export function ensureProductProfiles(activeYaml: string): ProductProfileStore {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
  try {
    const parsed = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8")) as unknown;
    if (validStore(parsed)) return parsed;
  } catch {
    // Primera ejecucion: se crea el perfil inicial abajo.
  }

  const createdAt = nowIso();
  const initial: ProductProfileMeta = {
    id: "producto-actual",
    name: productNameFromYaml(activeYaml),
    created_at: createdAt,
    updated_at: createdAt,
  };
  const store: ProductProfileStore = {
    schema_version: PRODUCT_PROFILE_SCHEMA_VERSION,
    active_product_id: initial.id,
    products: [initial],
  };
  writeTextFileAtomically(profileYamlPath(initial.id), activeYaml);
  writeProductProfileStore(store);
  return store;
}

export function writeProductProfileStore(store: ProductProfileStore): void {
  writeTextFileAtomically(INDEX_PATH, `${JSON.stringify(store, null, 2)}\n`);
}

export function productProfileStoreJson(store: ProductProfileStore): string {
  return `${JSON.stringify(store, null, 2)}\n`;
}

export function createProductId(name: string, store: ProductProfileStore): string {
  const base = safeId(name);
  const known = new Set(store.products.map((product) => product.id));
  if (!known.has(base)) return base;
  let suffix = 2;
  while (known.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
