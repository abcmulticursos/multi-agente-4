/**
 * DESCARGAR EL LOG (27/10/2026). GET /api/logs → los días guardados (JSON).
 * GET /api/logs?dia=AAAA-MM-DD|hoy → el log de ese día (todas las conversaciones).
 * GET /api/logs?dia=hoy&convo=N → UN SOLO ARCHIVO con la conversación entera (lo que escribió el
 * cliente y lo que respondió el bot, sacado de la base de datos) y, intercaladas por hora, las líneas
 * técnicas de esa conversación. Su pedido: «así te paso solo un log». Protegido por el login del panel.
 */
import { NextResponse } from "next/server";
import { getConversationById, getMessages } from "@/lib/db";
import { diaDeHoy, diasGuardados, leerElLog } from "@/lib/registro-a-disco";

export const dynamic = "force-dynamic";

const PERU = 5 * 3600; // las horas del archivo están en hora de Perú

function horaPeru(seg: number): string {
  return new Date((seg - PERU) * 1000).toISOString().slice(0, 19).replace("T", " ");
}

function descargar(texto: string, nombre: string) {
  return new NextResponse(texto || "(no hay nada para ese día o esa conversación)", {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre}"`,
    },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const pedido = url.searchParams.get("dia");
  if (!pedido) return NextResponse.json({ dias: diasGuardados(), hoy: diaDeHoy() });
  const dia = pedido === "hoy" ? diaDeHoy() : pedido;
  const convoId = Number(url.searchParams.get("convo") || 0) || null;
  if (!convoId) return descargar(leerElLog(dia), `log-${dia}.txt`);

  const convo = getConversationById(convoId);
  // Con una conversación: ayer y hoy (una prueba puede cruzar la medianoche).
  const dias = pedido === "hoy" ? [diaDeHoy(new Date(Date.now() - 86400 * 1000)), dia] : [dia];

  type Linea = { t: number; orden: number; texto: string };
  const lineas: Linea[] = [];

  // 1. LA CONVERSACIÓN, de la base de datos (no se corta aunque el servidor se reinicie).
  for (const m of getMessages(convoId, 5000)) {
    const quien = m.role === "user" ? "CLIENTE" : m.role === "human" ? "ASESOR " : "BOT    ";
    let cuerpo = (m.content ?? "").trim();
    if (m.media_type) {
      const adjunto = m.media_type === "image" ? "[imagen]" : m.media_type === "audio" ? "[audio]" : `[${m.media_type}]`;
      cuerpo = cuerpo ? `${adjunto} ${cuerpo}` : adjunto;
      if (m.transcription) cuerpo += ` (transcripción: ${m.transcription})`;
    }
    lineas.push({
      t: m.created_at,
      orden: m.role === "user" ? 0 : 2,
      texto: `${horaPeru(m.created_at).slice(11)}  ${quien}: ${cuerpo.replace(/\s*\n\s*\n*\s*/g, "\n                   ")}`,
    });
  }

  // 2. LAS LÍNEAS TÉCNICAS de esa conversación, con la hora del archivo.
  for (const d of dias) {
    const base = Date.parse(`${d}T00:00:00Z`) / 1000 + PERU;
    let ultima = base;
    for (const l of leerElLog(d, convoId, convo?.phone ?? null).split("\n")) {
      if (!l.trim()) continue;
      const m = l.match(/^(\d{2}):(\d{2}):(\d{2}) (.*)$/);
      const t = m ? base + Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : ultima;
      ultima = t;
      lineas.push({ t, orden: 1, texto: `${m ? `${m[1]}:${m[2]}:${m[3]}` : "        "}        (técnico) ${m ? m[4] : l}` });
    }
  }

  lineas.sort((a, b) => a.t - b.t || a.orden - b.orden);
  const cabecera = [
    `CONVERSACIÓN ${convoId}${convo ? ` · ${convo.client_name ?? convo.name ?? ""} · ${convo.phone} · ${convo.channel}` : ""}`,
    `Descargado: ${horaPeru(Math.floor(Date.now() / 1000))} (hora de Perú)`,
    "CLIENTE / BOT = lo que se escribieron · (técnico) = lo que hizo el bot por dentro",
    "".padEnd(90, "─"),
  ];
  return descargar([...cabecera, ...lineas.map((l) => l.texto)].join("\n"), `conversacion-${convoId}-${dia}.txt`);
}
