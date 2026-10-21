/**
 * Devuelve los marcadores de WhatsApp a un texto que se copió con el mouse.
 *
 * El problema: en pantalla, `*hola*` se dibuja como <strong>hola</strong>. Al
 * seleccionar con el mouse, el navegador copia lo que VE —"hola" en negrita—
 * y los asteriscos se pierden. Al pegarlo en el editor o en otro chat, el
 * texto llegaba sin formato y había que volver a marcarlo a mano.
 *
 * La solución es leer la selección al revés: se recorre el trozo de página
 * seleccionado y cada etiqueta vuelve a su marcador. Es exactamente la
 * operación inversa de `renderWhatsAppFormat`, así que las dos tienen que
 * moverse juntas: si allí se añade un marcador nuevo, aquí también.
 */

/** Etiquetas de bloque: entre una y otra va un salto de línea, para que al
 *  seleccionar varias burbujas no salgan todas pegadas en un renglón. */
const BLOQUES = new Set(["div", "p", "li", "tr", "section", "article"]);

function serializar(nodo: Node): string {
  if (nodo.nodeType === Node.TEXT_NODE) return nodo.textContent ?? "";
  if (nodo.nodeType !== Node.ELEMENT_NODE) return "";
  const el = nodo as Element;
  const dentro = Array.from(el.childNodes).map(serializar).join("");
  const etiqueta = el.tagName.toLowerCase();
  if (etiqueta === "br") return "\n";
  // Sin contenido no hay nada que marcar: un <strong> vacío no debe
  // convertirse en dos asteriscos sueltos.
  if (!dentro) return "";
  if (etiqueta === "strong" || etiqueta === "b") return `*${dentro}*`;
  if (etiqueta === "em" || etiqueta === "i") return `_${dentro}_`;
  if (etiqueta === "del" || etiqueta === "s") return `~${dentro}~`;
  if (BLOQUES.has(etiqueta)) return `${dentro}\n`;
  // Todo lo demás (enlaces, <span>, envoltorios de estilo) devuelve su texto
  // tal cual: no lleva marcador en WhatsApp, así que aquí tampoco.
  return dentro;
}

/**
 * Texto con marcadores a partir de lo que el usuario tenga seleccionado.
 * Devuelve cadena vacía si no hay nada que copiar.
 */
export function marcadoDesdeSeleccion(fragmento: DocumentFragment): string {
  const crudo = Array.from(fragmento.childNodes).map(serializar).join("");
  return (
    crudo
      // Tres o más saltos seguidos quedan en dos: separan burbujas sin dejar
      // huecos enormes al pegar.
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+\n/g, "\n")
      .trim()
  );
}
