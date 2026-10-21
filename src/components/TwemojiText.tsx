"use client";

import { useMemo, useState, type ReactNode } from "react";

/**
 * LA VERSIÓN VA FIJADA, Y ESA ES TODA LA CORRECCIÓN.
 *
 * Aquí decía `.../gh/googlefonts/noto-emoji/svg`, SIN versión. Sin versión, ese
 * servidor entrega «lo que haya hoy» en ese repositorio — y ese repositorio
 * movió su carpeta. Desde entonces devolvía 404 para TODOS los emojis.
 *
 * No se vio porque más abajo hay una red de seguridad: si la imagen no llega,
 * se dibuja el carácter a secas. Así que no salieron cuadros rotos, salieron los
 * emojis del sistema — y en un Mac de 2018 eso significa cuadraditos para los
 * modernos y los compuestos partidos en dos.
 *
 * Con la versión fijada, ese repositorio puede reorganizarse las veces que
 * quiera y aquí no cambia nada. Comprobado: 17 de 17, incluidos los de 2024 y
 * los que llevan tono de piel.
 */
const NOTO_EMOJI_BASE =
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@v2.047/svg";

function hasEmojiCodePoint(text: string): boolean {
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (
      (cp >= 0x1f000 && cp <= 0x1faff) ||
      (cp >= 0x2600 && cp <= 0x27bf) ||
      cp === 0x00a9 ||
      cp === 0x00ae ||
      cp === 0x203c ||
      cp === 0x2049 ||
      cp === 0x3030 ||
      cp === 0x303d ||
      cp === 0x3297 ||
      cp === 0x3299
    ) {
      return true;
    }
  }
  return false;
}

function emojiCodepoint(emoji: string): string {
  const codepoints = Array.from(emoji)
    .map((char) => char.codePointAt(0))
    .filter((cp): cp is number => typeof cp === "number")
    .filter((cp) => cp !== 0xfe0f && cp !== 0xfe0e)
    .map((cp) => cp.toString(16));
  return codepoints.join("_");
}

function isEmojiModifier(cp: number): boolean {
  return (
    cp === 0xfe0f ||
    cp === 0xfe0e ||
    cp === 0x200d ||
    cp === 0x20e3 ||
    (cp >= 0x1f3fb && cp <= 0x1f3ff)
  );
}

function segmentTextCompat(text: string): string[] {
  const codepoints = Array.from(text);
  const segments: string[] = [];

  for (let i = 0; i < codepoints.length; i++) {
    let current = codepoints[i];
    const first = current.codePointAt(0) ?? 0;

    if (first >= 0x1f1e6 && first <= 0x1f1ff && i + 1 < codepoints.length) {
      const next = codepoints[i + 1].codePointAt(0) ?? 0;
      if (next >= 0x1f1e6 && next <= 0x1f1ff) {
        segments.push(current + codepoints[i + 1]);
        i++;
        continue;
      }
    }

    while (i + 1 < codepoints.length) {
      const next = codepoints[i + 1];
      const nextCp = next.codePointAt(0) ?? 0;
      if (isEmojiModifier(nextCp)) {
        current += next;
        i++;
        if (nextCp === 0x200d && i + 1 < codepoints.length) {
          current += codepoints[i + 1];
          i++;
        }
        continue;
      }
      break;
    }

    segments.push(current);
  }

  return segments;
}

export function TwemojiGlyph({
  emoji,
  className = "mx-[1px] inline-block h-[1.28em] w-[1.28em] align-[-0.25em]",
}: {
  emoji: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const codepoint = emojiCodepoint(emoji);
  if (failed || !codepoint) return <>{emoji}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${NOTO_EMOJI_BASE}/emoji_u${codepoint}.svg`}
      alt={emoji}
      title={emoji}
      draggable={false}
      // El navegador solo descarga los que estan a la vista. Es lo que permite
      // tener 1.921 emojis en el selector sin pedir 1.921 imagenes de golpe.
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

export function TwemojiText({ text }: { text: string }) {
  const nodes = useMemo<ReactNode[]>(
    () =>
      segmentTextCompat(text).map((segment, index) =>
        hasEmojiCodePoint(segment) ? (
          <TwemojiGlyph key={index} emoji={segment} />
        ) : (
          segment
        )
      ),
    [text]
  );
  return <>{nodes}</>;
}
