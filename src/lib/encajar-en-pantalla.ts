/**
 * EL MENÚ DEL CLIC DERECHO, SIEMPRE DENTRO DE LA PANTALLA (11/11/2026). «Se salen de la pantalla… no puedo elegir algunas
 * opciones cuando la burbuja está muy abajo». El menú nacía en el punto del ratón y, cerca del borde de abajo, sus últimas
 * opciones quedaban fuera. Se usa como `ref` del menú (una flecha, para que se vuelva a medir en cada dibujo): lo sube (o lo
 * corre a la izquierda) lo justo para que quepa; si ni así cabe, le pone el alto de la pantalla y scroll propio.
 * Sirve dentro de las ventanas al 90 %: el zoom se saca del propio menú (alto en pantalla ÷ alto sin zoom).
 */
export function encajarEnLaPantalla(el: HTMLElement | null) {
  if (!el) return;
  const margen = 8;
  const altoDePantalla = window.innerHeight;
  const anchoDePantalla = window.innerWidth;
  let caja = el.getBoundingClientRect();
  const zoom = el.offsetHeight > 0 ? caja.height / el.offsetHeight : 1;
  if (!zoom) return;
  if (caja.height > altoDePantalla - margen * 2) {
    el.style.maxHeight = `${(altoDePantalla - margen * 2) / zoom}px`;
    el.style.overflowY = "auto";
    caja = el.getBoundingClientRect();
  }
  let dy = 0;
  if (caja.bottom > altoDePantalla - margen) dy = altoDePantalla - margen - caja.bottom;
  if (caja.top + dy < margen) dy = margen - caja.top;
  let dx = 0;
  if (caja.right > anchoDePantalla - margen) dx = anchoDePantalla - margen - caja.right;
  if (caja.left + dx < margen) dx = margen - caja.left;
  if (dy) el.style.top = `${(Number.parseFloat(el.style.top) || 0) + dy / zoom}px`;
  if (dx) el.style.left = `${(Number.parseFloat(el.style.left) || 0) + dx / zoom}px`;
}
