import { NextResponse } from "next/server";
import {
  deleteMetaRuntimeSettings,
  getMetaRuntimeSetting,
} from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  if (!getMetaRuntimeSetting("meta_app_secret")) {
    return NextResponse.json(
      { ok: false, error: "Primero guarda la clave secreta de la App en Meta Connect." },
      { status: 400 }
    );
  }
  deleteMetaRuntimeSettings(["messenger_app_secret"]);
  return NextResponse.json({ ok: true });
}
