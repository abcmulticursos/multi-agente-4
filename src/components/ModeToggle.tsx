"use client";

import { useState } from "react";

type Mode = "AI" | "HUMAN";

interface Props {
  conversationId: number;
  mode: Mode;
  onChanged: (mode: Mode) => void;
}

export default function ModeToggle({ conversationId, mode, onChanged }: Props) {
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (pending) return;
    const next: Mode = mode === "AI" ? "HUMAN" : "AI";
    setPending(true);
    try {
      const res = await fetch(`/api/mode/${conversationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      if (!res.ok) throw new Error("No se pudo cambiar el modo");
      onChanged(next);
    } catch (err) {
      console.error(err);
      alert("Error cambiando modo");
    } finally {
      setPending(false);
    }
  }

  const isAi = mode === "AI";
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      className={[
        "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition",
        isAi
          ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
          : "bg-amber-100 text-amber-700 hover:bg-amber-200",
        pending ? "opacity-60 cursor-wait" : "cursor-pointer",
      ].join(" ")}
      title={isAi ? "Cambiar a modo humano" : "Cambiar a modo IA"}
    >
      <span
        className={[
          "h-2 w-2 rounded-full",
          isAi ? "bg-emerald-500" : "bg-amber-500",
        ].join(" ")}
      />
      {isAi ? "IA" : "HUMANO"}
    </button>
  );
}
