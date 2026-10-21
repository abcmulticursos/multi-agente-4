import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import {
  isGithubPublishConfigured,
  publishProjectIdentityToGithub,
} from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDENTITY_PATH = path.join(
  process.cwd(),
  "config",
  "project-identity.json"
);

function isRepoName(repo: string): boolean {
  return /^[^/\s]+\/[^/\s]+$/.test(repo);
}

function normalizeProject(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readIdentity(): { project: string; repo: string } {
  try {
    const parsed = JSON.parse(fs.readFileSync(IDENTITY_PATH, "utf8")) as {
      project?: unknown;
      repo?: unknown;
    };
    return {
      project: String(parsed.project ?? ""),
      repo: String(parsed.repo ?? ""),
    };
  } catch {
    return { project: "", repo: "" };
  }
}

export async function GET() {
  return NextResponse.json({
    identity: readIdentity(),
    env: {
      githubRepo: process.env.GITHUB_REPO?.trim() ?? "",
      expectedGithubRepo: process.env.EXPECTED_GITHUB_REPO?.trim() ?? "",
      githubBranch: process.env.GITHUB_BRANCH?.trim() || "main",
      tokenConfigured: isGithubPublishConfigured(),
    },
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    project?: unknown;
    repo?: unknown;
  };
  const project = normalizeProject(body.project);
  const repo = String(body.repo ?? "").trim();

  if (!project) {
    return NextResponse.json(
      { ok: false, error: "Proyecto invalido. Ejemplo: nombre-del-proyecto" },
      { status: 400 }
    );
  }
  if (!isRepoName(repo)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Repo invalida. Usa el formato owner/repo, ejemplo: usuario/repo-del-proyecto",
      },
      { status: 400 }
    );
  }

  const githubRepo = process.env.GITHUB_REPO?.trim();
  const expectedRepo = process.env.EXPECTED_GITHUB_REPO?.trim();
  if (!githubRepo) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "GITHUB_REPO no configurado. No se puede guardar identidad sin verificar la repo real.",
      },
      { status: 400 }
    );
  }
  if (!isRepoName(githubRepo)) {
    return NextResponse.json(
      {
        ok: false,
        error: `GITHUB_REPO invalido: "${githubRepo}". Usa el formato owner/repo.`,
      },
      { status: 400 }
    );
  }
  if (!expectedRepo) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "EXPECTED_GITHUB_REPO no configurado. No se puede guardar identidad sin verificar que repo espera este deploy.",
      },
      { status: 400 }
    );
  }
  if (!isRepoName(expectedRepo)) {
    return NextResponse.json(
      {
        ok: false,
        error: `EXPECTED_GITHUB_REPO invalido: "${expectedRepo}". Usa el formato owner/repo.`,
      },
      { status: 400 }
    );
  }
  if (githubRepo.toLowerCase() !== expectedRepo.toLowerCase()) {
    return NextResponse.json(
      {
        ok: false,
        error: `Repo equivocada. GITHUB_REPO apunta a "${githubRepo}", pero EXPECTED_GITHUB_REPO espera "${expectedRepo}".`,
      },
      { status: 400 }
    );
  }
  if (repo.toLowerCase() !== expectedRepo.toLowerCase()) {
    return NextResponse.json(
      {
        ok: false,
        error: `Repo equivocada. Este deploy espera "${expectedRepo}", pero intentaste guardar "${repo}".`,
      },
      { status: 400 }
    );
  }

  const content = `${JSON.stringify({ project, repo }, null, 2)}\n`;

  if (!isGithubPublishConfigured()) {
    return NextResponse.json({
      ok: false,
      persisted: false,
      tokenConfigured: false,
      error:
        "GITHUB_TOKEN no configurado. La identidad no se modifico para evitar que este deploy quede ligado a una repo equivocada.",
      identity: readIdentity(),
    }, { status: 400 });
  }

  // GitHub valida la repo configurada contra la repo real del deploy antes de
  // escribir. Nunca alteramos el archivo local si esa validacion falla.
  const published = await publishProjectIdentityToGithub(
    content,
    "chore: update project identity"
  );
  if (!published.ok) {
    return NextResponse.json({
      ok: false,
      persisted: false,
      tokenConfigured: true,
      error: published.error ?? "No se pudo verificar la repo autorizada.",
      identity: readIdentity(),
    }, { status: 409 });
  }

  try {
    fs.mkdirSync(path.dirname(IDENTITY_PATH), { recursive: true });
    fs.writeFileSync(IDENTITY_PATH, content, "utf8");
  } catch {
    return NextResponse.json({
      ok: false,
      persisted: true,
      tokenConfigured: true,
      error:
        "La identidad se guardo en GitHub, pero no se pudo actualizar el archivo local. Reinicia o redeploya este agente para sincronizarlo.",
      identity: readIdentity(),
    }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    persisted: true,
    tokenConfigured: true,
    identity: { project, repo },
  });
}
