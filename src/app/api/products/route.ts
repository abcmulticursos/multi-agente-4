import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { isGithubPublishConfigured, publishFilesToGithub } from "@/lib/github";
import {
  PRODUCT_PROFILE_SCHEMA_VERSION,
  createProductId,
  ensureProductProfiles,
  productProfileStoreJson,
  profileIndexRelativePath,
  profileYamlPath,
  profileYamlRelativePath,
  writeProductProfileStore,
  writeTextFileAtomically,
  type ProductProfileStore,
} from "@/lib/product-profiles";
import { resetUnpaidConversationsForProductSwitch } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIG_PATH = path.join(process.cwd(), "config", "intro-data.yaml");

function readActiveYaml(): string {
  return fs.readFileSync(CONFIG_PATH, "utf8");
}

function productResponse(store: ProductProfileStore) {
  return {
    schema_version: PRODUCT_PROFILE_SCHEMA_VERSION,
    active_product_id: store.active_product_id,
    products: store.products,
  };
}

function requireGithub(): NextResponse | null {
  if (isGithubPublishConfigured()) return null;
  return NextResponse.json(
    {
      error:
        "GITHUB_TOKEN no configurado. No se puede cambiar de producto porque debe quedar guardado de forma permanente.",
    },
    { status: 500 }
  );
}

export async function GET(req: NextRequest) {
  let activeYaml: string;
  try {
    activeYaml = readActiveYaml();
  } catch {
    return NextResponse.json({ error: "No se pudo leer la configuracion activa." }, { status: 500 });
  }

  const store = ensureProductProfiles(activeYaml);
  const exportId = req.nextUrl.searchParams.get("export");
  if (!exportId) {
    return NextResponse.json(productResponse(store), {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const product = store.products.find((item) => item.id === exportId);
  if (!product) {
    return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });
  }
  let raw: string;
  try {
    raw =
      product.id === store.active_product_id
        ? activeYaml
        : fs.readFileSync(profileYamlPath(product.id), "utf8");
  } catch {
    return NextResponse.json({ error: "No se pudo leer el producto guardado." }, { status: 500 });
  }
  let config: unknown;
  try {
    config = parseDocument(raw).toJS();
  } catch {
    return NextResponse.json({ error: "El producto guardado no tiene formato valido." }, { status: 422 });
  }
  const filename = `${product.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "producto"}.json`;
  return new NextResponse(
    JSON.stringify(
      {
        schema_version: PRODUCT_PROFILE_SCHEMA_VERSION,
        type: "multiagente-product-profile",
        exported_at: new Date().toISOString(),
        product: { id: product.id, name: product.name },
        config,
      },
      null,
      2
    ),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function POST(req: NextRequest) {
  let body: { action?: string; id?: string; name?: string };
  try {
    body = (await req.json()) as { action?: string; id?: string; name?: string };
  } catch {
    return NextResponse.json({ error: "Solicitud invalida." }, { status: 400 });
  }
  const githubError = requireGithub();
  if (githubError) return githubError;

  let activeYaml: string;
  try {
    activeYaml = readActiveYaml();
  } catch {
    return NextResponse.json({ error: "No se pudo leer la configuracion activa." }, { status: 500 });
  }
  const store = ensureProductProfiles(activeYaml);
  const action = body.action;

  if (action === "create") {
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: "Escribe un nombre para el producto." }, { status: 400 });
    const id = createProductId(name, store);
    const now = new Date().toISOString();
    const next = {
      ...store,
      products: [...store.products, { id, name, created_at: now, updated_at: now }],
    };
    const currentProfile = store.products.find((item) => item.id === store.active_product_id);
    if (currentProfile) currentProfile.updated_at = now;

    const publish = await publishFilesToGithub([
      { path: profileYamlRelativePath(store.active_product_id), content: activeYaml },
      { path: profileYamlRelativePath(id), content: activeYaml },
      { path: profileIndexRelativePath(), content: productProfileStoreJson(next) },
    ], `productos: crea ${name}`);
    if (!publish.ok) return NextResponse.json({ error: publish.error }, { status: 500 });
    writeTextFileAtomically(profileYamlPath(store.active_product_id), activeYaml);
    writeTextFileAtomically(profileYamlPath(id), activeYaml);
    writeProductProfileStore(next);
    return NextResponse.json(productResponse(next));
  }

  if (action === "activate") {
    const target = store.products.find((item) => item.id === body.id && !item.archived);
    if (!target) return NextResponse.json({ error: "Producto no disponible." }, { status: 404 });
    if (target.id === store.active_product_id) {
      return NextResponse.json({ ...productResponse(store), reset_conversations: 0 });
    }
    let targetYaml: string;
    try {
      targetYaml = fs.readFileSync(profileYamlPath(target.id), "utf8");
      parseDocument(targetYaml);
    } catch {
      return NextResponse.json({ error: "El producto elegido no tiene una configuracion valida." }, { status: 422 });
    }
    const now = new Date().toISOString();
    const next: ProductProfileStore = {
      ...store,
      active_product_id: target.id,
      products: store.products.map((item) =>
        item.id === store.active_product_id || item.id === target.id
          ? { ...item, updated_at: now }
          : item
      ),
    };
    const publish = await publishFilesToGithub([
      { path: profileYamlRelativePath(store.active_product_id), content: activeYaml },
      { path: "config/intro-data.yaml", content: targetYaml },
      { path: profileIndexRelativePath(), content: productProfileStoreJson(next) },
    ], `productos: activa ${target.name}`);
    if (!publish.ok) return NextResponse.json({ error: publish.error }, { status: 500 });
    writeTextFileAtomically(profileYamlPath(store.active_product_id), activeYaml);
    writeTextFileAtomically(CONFIG_PATH, targetYaml);
    writeProductProfileStore(next);
    const resetConversations = resetUnpaidConversationsForProductSwitch();
    return NextResponse.json({
      ...productResponse(next),
      reset_conversations: resetConversations,
    });
  }

  if (action === "rename") {
    const name = body.name?.trim();
    const product = store.products.find((item) => item.id === body.id);
    if (!product || !name) return NextResponse.json({ error: "Producto o nombre invalido." }, { status: 400 });
    const next = {
      ...store,
      products: store.products.map((item) =>
        item.id === product.id ? { ...item, name, updated_at: new Date().toISOString() } : item
      ),
    };
    const publish = await publishFilesToGithub([
      { path: profileIndexRelativePath(), content: productProfileStoreJson(next) },
    ], "productos: renombra perfil");
    if (!publish.ok) return NextResponse.json({ error: publish.error }, { status: 500 });
    writeProductProfileStore(next);
    return NextResponse.json(productResponse(next));
  }

  if (action === "archive") {
    const product = store.products.find((item) => item.id === body.id);
    if (!product || product.id === store.active_product_id) {
      return NextResponse.json({ error: "No se puede archivar el producto activo." }, { status: 400 });
    }
    const next = {
      ...store,
      products: store.products.map((item) =>
        item.id === product.id ? { ...item, archived: true, updated_at: new Date().toISOString() } : item
      ),
    };
    const publish = await publishFilesToGithub([
      { path: profileIndexRelativePath(), content: productProfileStoreJson(next) },
    ], "productos: archiva perfil");
    if (!publish.ok) return NextResponse.json({ error: publish.error }, { status: 500 });
    writeProductProfileStore(next);
    return NextResponse.json(productResponse(next));
  }

  return NextResponse.json({ error: "Accion no reconocida." }, { status: 400 });
}
