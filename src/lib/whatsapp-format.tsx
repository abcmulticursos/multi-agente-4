import type { ReactNode } from "react";

// Convierte el marcado estilo WhatsApp a nodos React:
//   *texto*  → negrita
//   _texto_  → cursiva
//   ~texto~  → tachado
//
// Implementación de un solo nivel (sin anidar marcadores). Cubre el uso
// real de mensajes de venta. Los marcadores no pueden cruzar saltos de
// línea — así un "*" suelto no se come medio mensaje.
const TOKEN_RE = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;

// Los ENLACES quedan fuera del formato. WhatsApp reconoce la URL entera y no
// le aplica marcado; aquí se hace igual.
//
// Sin esto, un enlace de Drive con dos guiones bajos —
// .../1VmGlE_XthJKKFjSqD9HVzrTs4i3_Gy-V/view — se mostraba en cursiva y SIN
// los guiones, así que en pantalla parecía un enlace roto aunque al cliente
// le llegara entero. Cundía el pánico por un problema que no existía.
const URL_RE = /(https?:\/\/[^\s]+)/g;
const ES_URL = /^https?:\/\/\S+$/;

function aplicarMarcado(texto: string, prefijo: number): ReactNode[] {
  return texto.split(TOKEN_RE).map((part, i) => {
    const key = `${prefijo}-${i}`;
    if (!part) return null;
    const inner = part.slice(1, -1);
    if (!inner) return part;
    if (part.startsWith("*") && part.endsWith("*")) {
      return <strong key={key}>{inner}</strong>;
    }
    if (part.startsWith("_") && part.endsWith("_")) {
      return <em key={key}>{inner}</em>;
    }
    if (part.startsWith("~") && part.endsWith("~")) {
      return <del key={key}>{inner}</del>;
    }
    return part;
  });
}

/**
 * Signos que suelen quedar pegados al final de un enlace al escribirlo dentro
 * de una frase ("mira esto: https://x.com/a."). Se sacan fuera para que no
 * formen parte del enlace, igual que hace WhatsApp.
 */
function partirColaDelEnlace(url: string): [string, string] {
  const m = url.match(/[.,;:!?)\]}"']+$/);
  if (!m) return [url, ""];
  return [url.slice(0, url.length - m[0].length), m[0]];
}

export function renderWhatsAppFormat(text: string): ReactNode {
  if (!text) return text;
  return text.split(URL_RE).map((segmento, indice) => {
    if (!segmento) return null;
    // El enlace se muestra intacto —con sus guiones bajos y todo— y se puede
    // tocar, en azul, como en WhatsApp.
    if (ES_URL.test(segmento)) {
      const [enlace, cola] = partirColaDelEnlace(segmento);
      if (!enlace) return segmento;
      return (
        <span key={`u-${indice}`}>
          <a
            href={enlace}
            target="_blank"
            rel="noopener noreferrer"
            className="break-words text-sky-700 underline decoration-sky-700/40 underline-offset-2 hover:decoration-sky-700"
          >
            {enlace}
          </a>
          {cola}
        </span>
      );
    }
    return aplicarMarcado(segmento, indice);
  });
}
