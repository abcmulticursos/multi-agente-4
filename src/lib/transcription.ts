import fs from "node:fs";
import path from "node:path";

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const DEFAULT_MODEL = "whisper-large-v3-turbo";

export interface TranscriptionResult {
  text: string;
  duration_sec: number | null;
}

interface GroqVerboseJson {
  text?: string;
  duration?: number;
  language?: string;
}

/**
 * Transcribe un archivo de audio local usando Groq Whisper.
 * Retorna el texto y la duración (si Groq la reporta).
 */
export async function transcribeAudio(
  absFilePath: string,
  mime: string
): Promise<TranscriptionResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY no configurada");
  }
  if (!fs.existsSync(absFilePath)) {
    throw new Error(`Archivo no existe: ${absFilePath}`);
  }
  const model = process.env.GROQ_WHISPER_MODEL ?? DEFAULT_MODEL;
  const language = process.env.GROQ_WHISPER_LANG ?? "es";

  const buffer = fs.readFileSync(absFilePath);
  const filename = path.basename(absFilePath);

  // Node 20+ tiene FormData/Blob nativos.
  const form = new FormData();
  // Casting porque el tipo de FormData en lib.dom espera Blob/File del DOM,
  // pero el Blob nativo de Node es compatible.
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mime }), filename);
  form.append("model", model);
  form.append("language", language);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq Whisper ${res.status}: ${text}`);
  }

  const data = (await res.json()) as GroqVerboseJson;
  const text = (data.text ?? "").trim();
  const duration =
    typeof data.duration === "number" ? Math.round(data.duration) : null;

  return { text, duration_sec: duration };
}
