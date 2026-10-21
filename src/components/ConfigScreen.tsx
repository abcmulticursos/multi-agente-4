"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const REQUIRED_VARS = [
  "META_ACCESS_TOKEN",
  "META_PHONE_NUMBER_ID",
  "META_APP_SECRET",
  "META_VERIFY_TOKEN",
] as const;

interface Props {
  status: "missing_config" | "error";
  missing?: string[];
  message?: string;
  onRetry: () => void;
}

function CopyableField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-neutral-500">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-800">
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-md border border-neutral-200 bg-tarjeta px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50"
        >
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
    </div>
  );
}

export default function ConfigScreen({
  status,
  missing,
  message,
  onRetry,
}: Props) {
  const [origin, setOrigin] = useState<string>("");
  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  const webhookUrl = origin ? `${origin}/api/webhook` : "/api/webhook";
  const missingSet = new Set(missing ?? []);

  return (
    <div className="min-h-screen bg-neutral-100 px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-neutral-900">
            Configura tu API de WhatsApp
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Conecta tu número con la API oficial de Meta. No necesitas
            escanear ningún QR.
          </p>
        </div>

        {status === "error" && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <div className="font-semibold">Error al conectar con Graph API</div>
            <div className="mt-1 text-xs">{message}</div>
            <div className="mt-2 text-xs text-red-600">
              Causas típicas: token expirado o sin permisos, phone_number_id
              incorrecto, o versión de Graph deprecada.
            </div>
          </div>
        )}

        <section className="rounded-lg border border-neutral-200 bg-tarjeta p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-900">
            1. Variables de entorno
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            Configúralas en <code>.env.local</code> (o en EasyPanel) y
            reinicia el servidor.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {REQUIRED_VARS.map((v) => {
              const isMissing = missingSet.has(v);
              return (
                <li key={v} className="flex items-center gap-2">
                  <span
                    className={
                      isMissing ? "text-red-600" : "text-emerald-600"
                    }
                  >
                    {isMissing ? "✗" : "✓"}
                  </span>
                  <code className="text-xs text-neutral-800">{v}</code>
                  {isMissing && (
                    <span className="text-xs text-red-600">faltante</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-lg border border-neutral-200 bg-tarjeta p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-900">
            2. URL del webhook (pega esto en el panel de Meta)
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            En desarrollo necesitas exponer localhost vía HTTPS — usa{" "}
            <code>ngrok http 3000</code> o Cloudflare Tunnel y reemplaza la
            URL.
          </p>
          <div className="mt-3 space-y-3">
            <CopyableField label="Callback URL" value={webhookUrl} />
            <CopyableField
              label="Verify Token"
              value="el valor de META_VERIFY_TOKEN del .env.local"
            />
          </div>
        </section>

        <section className="rounded-lg border border-neutral-200 bg-tarjeta p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-900">
            3. Pasos en developers.facebook.com
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-neutral-700">
            <li>
              Crea una app en{" "}
              <a
                href="https://developers.facebook.com/"
                target="_blank"
                rel="noreferrer"
                className="text-emerald-600 underline"
              >
                developers.facebook.com
              </a>
              .
            </li>
            <li>Agrega el producto WhatsApp.</li>
            <li>
              Copia el <code>Phone Number ID</code>, <code>WABA ID</code> y el{" "}
              <code>App Secret</code> (Settings → Basic).
            </li>
            <li>
              En Business Settings → System Users genera un{" "}
              <strong>System User Token permanente</strong>. No uses el token
              de prueba — dura 24h.
            </li>
            <li>
              En WhatsApp → Configuration → Webhook pega la URL de arriba y el{" "}
              <code>META_VERIFY_TOKEN</code>.
            </li>
            <li>
              Suscribe el webhook al campo <code>messages</code>.
            </li>
          </ol>
        </section>

        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/editor"
            className="rounded-md border border-neutral-300 bg-tarjeta px-5 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50"
          >
            Abrir editor sin conectar
          </Link>
          <a
            href="/meta-connect"
            className="rounded-md border border-blue-300 bg-blue-50 px-5 py-2 text-sm font-medium text-blue-700 shadow-sm hover:bg-blue-100"
          >
            Configurar desde Meta Connect
          </a>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md bg-emerald-500 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-600"
          >
            Volver a probar
          </button>
        </div>
      </div>
    </div>
  );
}
