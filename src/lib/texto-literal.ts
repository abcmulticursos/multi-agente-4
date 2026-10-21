/**
 * PONER UN TEXTO TAL CUAL DENTRO DE UN REEMPLAZO.
 *
 * EL FALLO QUE ESTO EVITA, Y QUE NO SE VEÍA VENIR
 *
 * En `texto.replace(regex, reemplazo)`, el signo `$` tiene significado propio
 * dentro del reemplazo: `$1` no es un dólar seguido de un uno, es «el primer
 * trozo capturado por la expresión».
 *
 * Los comodines de precio se resuelven así:
 *
 *     texto.replace(/\{\{(monto_faltante|saldo_faltante)\}\}/gi, "$1.000 ARS")
 *
 * En Perú el precio empieza por "S/" y no pasa nada. En Argentina, México,
 * Colombia y Chile empieza por "$" — y si además el importe empieza por 1, el
 * "$1" del precio se interpreta como el grupo capturado. El cliente recibe:
 *
 *     «Puedes completar MONTO_FALTANTE.000 ARS para llevarte el completo»
 *
 * El nombre del comodín, en mitad de un mensaje de cobro. Pasó de verdad.
 *
 * Y es traicionero por lo estrecho que es: solo rompe con importes que empiezan
 * por 1 (1.000, 15.000, 18.000) y solo en países con "$". Con 6.000 o 7.000
 * funciona perfecto, así que se puede probar cien veces sin verlo.
 *
 * POR QUÉ UNA FUNCIÓN
 *
 * Cuando el reemplazo es una FUNCIÓN, JavaScript no interpreta nada: usa lo que
 * devuelva, carácter por carácter. Es la única forma que no depende de acordarse
 * de escapar nada.
 *
 * Se usa en todo reemplazo cuyo valor NO se escribió aquí al lado: precios,
 * nombres de producto, datos de pago, nombres de receptor. Cualquiera de ellos
 * puede traer un "$" y ninguno quiere que se interprete.
 */
export function literal(texto: string): () => string {
  return () => texto;
}
