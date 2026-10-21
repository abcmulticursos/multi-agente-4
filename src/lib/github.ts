// Publica archivos en GitHub con una defensa estricta contra repos equivocados.
//
// Variables requeridas para publicar:
// - GITHUB_TOKEN: token con permiso de escritura de contents.
// - GITHUB_REPO: repo destino en formato owner/repo.
// - EXPECTED_GITHUB_REPO: repo que este deploy espera usar.
// - GITHUB_BRANCH: rama destino. Opcional, default main.

import { execSync } from "node:child_process";

const DEFAULT_BRANCH = "main";
const PROJECT_IDENTITY_PATH = "config/project-identity.json";

export function isGithubPublishConfigured(): boolean {
  return Boolean(process.env.GITHUB_TOKEN?.trim());
}

function normalizeRepo(repo: string): string {
  return repo.trim().toLowerCase();
}

function isRepoName(repo: string): boolean {
  return /^[^/\s]+\/[^/\s]+$/.test(repo);
}

function getDeployedRepo(): string | null {
  try {
    const url = execSync("git config --get remote.origin.url", {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const match = url.match(/github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
    return match ? normalizeRepo(match[1]) : null;
  } catch {
    return null;
  }
}

export interface PublishResult {
  ok: boolean;
  error?: string;
}

export interface GithubFileUpdate {
  path: string;
  content: string;
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "agente-editor",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function verifyRepoIdentity(
  repo: string,
  branch: string,
  headers: Record<string, string>
): Promise<PublishResult> {
  const expectedRepo = process.env.EXPECTED_GITHUB_REPO?.trim();
  if (!expectedRepo) {
    return {
      ok: false,
      error:
        "EXPECTED_GITHUB_REPO no configurado. No se guarda porque no se puede verificar la identidad del proyecto.",
    };
  }
  if (!isRepoName(expectedRepo)) {
    return {
      ok: false,
      error: `EXPECTED_GITHUB_REPO invalido: "${expectedRepo}". Usa el formato owner/repo.`,
    };
  }
  if (normalizeRepo(repo) !== normalizeRepo(expectedRepo)) {
    return {
      ok: false,
      error: `Repo equivocada. Este deploy espera "${expectedRepo}" pero GITHUB_REPO apunta a "${repo}". No se guardo nada.`,
    };
  }

  const deployedRepo = getDeployedRepo();
  if (deployedRepo && deployedRepo !== normalizeRepo(expectedRepo)) {
    return {
      ok: false,
      error: `Repo equivocada. Este deploy viene de "${deployedRepo}" pero esperaba "${expectedRepo}". No se guardo nada.`,
    };
  }

  try {
    const url = `https://api.github.com/repos/${repo}/contents/${PROJECT_IDENTITY_PATH}?ref=${encodeURIComponent(branch)}`;
    const res = await fetch(url, { headers, cache: "no-store" });
    if (res.status === 404) {
      return {
        ok: false,
        error: `Falta ${PROJECT_IDENTITY_PATH} en ${repo}. No se guarda porque no se pudo verificar la identidad del proyecto.`,
      };
    }
    if (res.status === 401) {
      return { ok: false, error: "Token invalido o sin permisos (401)" };
    }
    if (!res.ok) {
      return { ok: false, error: `GitHub identity GET ${res.status}` };
    }

    const data = (await res.json()) as { content?: string; encoding?: string };
    if (data.encoding !== "base64" || !data.content) {
      return {
        ok: false,
        error: `Identidad invalida en ${PROJECT_IDENTITY_PATH}.`,
      };
    }

    const identity = JSON.parse(
      Buffer.from(data.content, "base64").toString("utf8")
    ) as { repo?: string };
    if (normalizeRepo(identity.repo ?? "") !== normalizeRepo(expectedRepo)) {
      return {
        ok: false,
        error: `Identidad de repo equivocada. ${PROJECT_IDENTITY_PATH} declara "${identity.repo ?? "(vacio)"}" pero este deploy espera "${expectedRepo}". No se guardo nada.`,
      };
    }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof SyntaxError
          ? `No se pudo leer ${PROJECT_IDENTITY_PATH}: JSON invalido.`
          : "No se pudo verificar la identidad del repo en GitHub.",
    };
  }

  return { ok: true };
}

export async function publishFileToGithub(
  repoPath: string,
  content: string,
  commitMessage: string
): Promise<PublishResult> {
  // GUARDAR UN ARCHIVO VA POR LA MISMA PUERTA QUE GUARDAR VARIOS.
  //
  // EL FALLO: «GitHub PUT 500», una y otra vez, y el editor guardando a la
  // tercera o la cuarta.
  //
  // Esto usaba la API de CONTENIDOS: mete el archivo ENTERO, en base64, dentro
  // del cuerpo de un PUT. Esa API está hecha para archivos de hasta 1 MB, y
  // `config/intro-data.yaml` ya pasa de 1,5 MB — más de 2 MB una vez pasado a
  // base64. Por encima del límite GitHub no rechaza limpio: se atraganta, y unas
  // veces pasa y otras devuelve 500. De ahí el «guarda a la cuarta».
  //
  // No es del token (daría 401), ni un conflicto (409), ni contenido inválido
  // (422). Es el tamaño, y no va a volver a bajar: el archivo solo crece.
  //
  // LA PUERTA BUENA YA ESTABA AQUÍ. `publishFilesToGithub` publica por la API de
  // Git —crea el árbol, crea el commit y mueve la rama— que no tiene ese límite.
  // Se usaba solo para guardar varios archivos a la vez. Ahora la usan los dos,
  // así que no puede volver a pasar que uno de los dos caminos se quede corto.
  //
  // Lo que NO cambia: el mismo repositorio, la misma rama, el mismo commit y la
  // misma verificación de identidad (la hace `publishFilesToGithub` igual que se
  // hacía aquí). Solo cambia por qué endpoint de GitHub entra el archivo.
  return publishFilesToGithub(
    [{ path: repoPath, content }],
    commitMessage
  );
}

/**
 * Publica varios archivos en UN solo commit. Se usa cuando una operacion debe
 * conservar consistencia entre indice, perfil y configuracion activa.
 */
export async function publishFilesToGithub(
  files: GithubFileUpdate[],
  commitMessage: string
): Promise<PublishResult> {
  if (files.length === 0) return { ok: true };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return { ok: false, error: "GITHUB_TOKEN no configurado" };
  const repo = process.env.GITHUB_REPO?.trim();
  if (!repo || !isRepoName(repo)) {
    return { ok: false, error: "GITHUB_REPO no configurado o invalido." };
  }
  const branch = process.env.GITHUB_BRANCH?.trim() || DEFAULT_BRANCH;
  const headers = githubHeaders(token);
  const identity = await verifyRepoIdentity(repo, branch, headers);
  if (!identity.ok) return identity;
  const api = `https://api.github.com/repos/${repo}/git`;
  try {
    const refRes = await fetch(
      `${api}/ref/heads/${encodeURIComponent(branch)}`,
      { headers, cache: "no-store" }
    );
    if (!refRes.ok) return { ok: false, error: `GitHub ref GET ${refRes.status}` };
    const ref = (await refRes.json()) as { object?: { sha?: string } };
    const parentSha = ref.object?.sha;
    if (!parentSha) return { ok: false, error: "GitHub no devolvio la rama destino." };

    const commitRes = await fetch(`${api}/commits/${parentSha}`, {
      headers,
      cache: "no-store",
    });
    if (!commitRes.ok) return { ok: false, error: `GitHub commit GET ${commitRes.status}` };
    const commit = (await commitRes.json()) as { tree?: { sha?: string } };
    if (!commit.tree?.sha) return { ok: false, error: "GitHub no devolvio el arbol actual." };

    const treeRes = await fetch(`${api}/trees`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        base_tree: commit.tree.sha,
        tree: files.map((file) => ({
          path: file.path,
          mode: "100644",
          type: "blob",
          content: file.content,
        })),
      }),
    });
    if (!treeRes.ok) return { ok: false, error: `GitHub tree POST ${treeRes.status}` };
    const tree = (await treeRes.json()) as { sha?: string };
    if (!tree.sha) return { ok: false, error: "GitHub no creo el arbol nuevo." };

    const newCommitRes = await fetch(`${api}/commits`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ message: commitMessage, tree: tree.sha, parents: [parentSha] }),
    });
    if (!newCommitRes.ok) return { ok: false, error: `GitHub commit POST ${newCommitRes.status}` };
    const newCommit = (await newCommitRes.json()) as { sha?: string };
    if (!newCommit.sha) return { ok: false, error: "GitHub no creo el commit nuevo." };

    const updateRefRes = await fetch(
      `${api}/refs/heads/${encodeURIComponent(branch)}`,
      {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ sha: newCommit.sha, force: false }),
      }
    );
    if (!updateRefRes.ok) return { ok: false, error: `GitHub ref PATCH ${updateRefRes.status}` };
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo completar la publicacion atomica en GitHub." };
  }
}

export async function publishProjectIdentityToGithub(
  content: string,
  commitMessage: string
): Promise<PublishResult> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return { ok: false, error: "GITHUB_TOKEN no configurado" };

  const repo = process.env.GITHUB_REPO?.trim();
  if (!repo) {
    return {
      ok: false,
      error:
        "GITHUB_REPO no configurado. No se publica para evitar escribir en una repo equivocada.",
    };
  }
  if (!isRepoName(repo)) {
    return {
      ok: false,
      error: `GITHUB_REPO invalido: "${repo}". Usa el formato owner/repo.`,
    };
  }

  const expectedRepo = process.env.EXPECTED_GITHUB_REPO?.trim();
  if (!expectedRepo) {
    return {
      ok: false,
      error:
        "EXPECTED_GITHUB_REPO no configurado. No se puede reparar la identidad sin saber que repo espera este deploy.",
    };
  }
  if (!isRepoName(expectedRepo)) {
    return {
      ok: false,
      error: `EXPECTED_GITHUB_REPO invalido: "${expectedRepo}". Usa el formato owner/repo.`,
    };
  }
  if (normalizeRepo(repo) !== normalizeRepo(expectedRepo)) {
    return {
      ok: false,
      error: `Repo equivocada. Este deploy espera "${expectedRepo}" pero GITHUB_REPO apunta a "${repo}". No se guardo nada.`,
    };
  }

  const deployedRepo = getDeployedRepo();
  if (deployedRepo && deployedRepo !== normalizeRepo(expectedRepo)) {
    return {
      ok: false,
      error: `Repo equivocada. Este deploy viene de "${deployedRepo}" pero esperaba "${expectedRepo}". No se guardo nada.`,
    };
  }

  const branch = process.env.GITHUB_BRANCH?.trim() || DEFAULT_BRANCH;
  const base = `https://api.github.com/repos/${repo}/contents/${PROJECT_IDENTITY_PATH}`;
  const headers = githubHeaders(token);

  let sha: string | undefined;
  try {
    const getRes = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, {
      headers,
      cache: "no-store",
    });
    if (getRes.ok) {
      const data = (await getRes.json()) as { sha?: string };
      sha = data.sha;
    } else if (getRes.status === 401) {
      return { ok: false, error: "Token invalido o sin permisos (401)" };
    } else if (getRes.status !== 404) {
      return { ok: false, error: `GitHub GET ${getRes.status}` };
    }
  } catch {
    return { ok: false, error: "No se pudo contactar a GitHub (GET)" };
  }

  const body: Record<string, unknown> = {
    message: commitMessage,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch,
  };
  if (sha) body.sha = sha;

  try {
    const putRes = await fetch(base, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!putRes.ok) {
      const text = await putRes.text();
      return {
        ok: false,
        error: `GitHub PUT ${putRes.status}: ${text.slice(0, 200)}`,
      };
    }
  } catch {
    return { ok: false, error: "No se pudo contactar a GitHub (PUT)" };
  }

  return { ok: true };
}
