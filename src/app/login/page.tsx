"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") || "/";

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        // Usamos window.location en vez de router.replace para forzar una
        // navegación completa que recargue las cookies en el servidor.
        window.location.assign(from);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error || "Contraseña incorrecta");
    } catch {
      setError("Error de red");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-tarjeta rounded-2xl shadow-sm border border-neutral-200 p-6"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-white font-semibold">
            W
          </div>
          <div>
            <div className="text-base font-semibold text-neutral-900">
              Agente WhatsApp
            </div>
            <div className="text-xs text-neutral-500">
              Ingresa para continuar
            </div>
          </div>
        </div>

        <label
          htmlFor="dash-password"
          className="block text-sm font-medium text-neutral-700 mb-2"
        >
          Contraseña
        </label>
        <input
          id="dash-password"
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
          autoComplete="current-password"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
        />

        <label className="mt-3 flex items-center gap-2 text-sm text-neutral-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showPassword}
            onChange={(e) => setShowPassword(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-300 text-emerald-500 focus:ring-emerald-500"
          />
          Mostrar contraseña
        </label>

        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

        <button
          type="submit"
          disabled={submitting || !password}
          className="mt-5 w-full rounded-lg bg-emerald-500 text-white text-sm font-medium py-2 hover:bg-emerald-600 disabled:opacity-60"
        >
          {submitting ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
