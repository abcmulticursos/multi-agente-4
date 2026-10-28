# AVANCE — el tablero como el automático (encargo del 27/10/2026)

Si la sesión se corta, se retoma desde aquí. La lista completa está en `INVENTARIO-AUTOMATICO.md`.

## Orden de trabajo

1. Maquinaria (lo que pierde dinero)
   - [ ] 1a. Candado de la elección (H0, C1): con un cobro abierto, el método manda los datos de ESE cobro; nada lo mueve solo
   - [ ] 1b. Upgrade automático (D3/E6): sin ficha especial; también el comprobante de la diferencia
   - [ ] 1c. Pagar lo ofrecido después de comprar (D2/D5): un producto claro → su cobro; dos → «¿te refieres a A o a B?»
   - [ ] 1d. Cero silencios (F4): los frenos nunca dejan la respuesta vacía
   - [ ] 1e. La diferencia entre opciones es un monto válido (B13)
2. Cerebro (K1–K7): su cerebro del automático, adaptado, en el cerebro del tablero + los bloques por forma de vender
3. Reglas chicas (H1, H2, H4, G3, G8, G9, G11, I3, I4…)
4. Pruebas: clientes simulados en paralelo (su método, COMO-TESTEA-ALBERTO.md)

## Hecho (código, compila; sin subir todavía)

- 1a. Candado: con cobro abierto, los cuadritos/opciones que llevan a pagar no se siguen salvo que nombre
  el producto; la IA no elige por él; la IA sabe «EL CLIENTE YA ELIGIÓ: X (precio)».
- 1b/1c. `loQuePuedeComprar` + `comprarDespuesDeComprar`: upgrade automático (cobra la diferencia, con su
  mensaje), pagar lo ofrecido después de comprar, «¿A cuál te refieres?», comprobante de la diferencia
  durante el regalo y fuera de él.
- 1d. Nunca mudo: el freno del método quita solo la frase; respuesta vacía → pregunta corta.
- 1e. Las diferencias entre precios son montos válidos.
- 2. Cerebro: el tablero lee su cerebro por secciones (=== ROL/IDIOMA/PAGO/PRECIO Y CIERRE/POSTVENTA ===),
  recortado por etapa; reglas fijas del automático; bloque de las dos opciones (+ su regla de Ajustes);
  bloque de un producto. Los 8 tableros de ejemplo ya tienen la copia de su cerebro. Botón
  «⧉ Copiar el cerebro del automático» en el 🧠 Cerebro del tablero.
- 3. «No tengo X, tengo Y» (negación); «ya pagué» sin foto → pide el comprobante; precio de oferta explicado.
- Contenido: los 80 Cobros de las tiendas de ejemplo otra vez en 3 burbujas.
- Subido: e9314ee (fase 1 y 2).
- Después de e9314ee: el cerebro del tablero se cortaba a 6.000 caracteres (ahora 40.000); sin pago
  aprobado la IA no puede prometer la entrega (lo cazó la ronda 1: con $1 de $4 dijo «llegará tu
  enlace»); aviso al borrar fichas con clientes dentro (`numerosDelTablero` cuenta «ahora»).

## Probado

- Ronda 1 (9 clientes simulados a la vez, 11 min, sin congestión): ec_cambia, ec_hola, ec_desconfiado,
  ec_noentiendo, ec_precio_pack sin fallos. Fallos: la promesa de entrega sin pago (arreglado); PE de
  MASCOTAS no entra al tablero en la copia (va a la venta automática: es del contenido, no del motor).
- Ronda 2 (10 a la vez, 21 min): cazó y se arregló: el reenvío mandaba TODAS las entregas (ahora solo la
  que pide, con «Claro, te lo reenvío ahora mismo»); «no sé si es estafa, como que no confío» soltaba el
  order bump por la palabra «como» de un cuadrito (por palabra suelta ya solo cuentan nombres de producto
  y botones). Bien: «eligió uno y pagó otro» (pregunta y entrega el que pagó), el cerebro suyo («La
  inversión es de $3 — un solo pago… ¿te indico cómo adquirirlo y llevarte los bonos? 🎁»).
- Rondas 3–6 (25 clientes más, mezclados EC/PE/AR): upgrade pagando la diferencia, upsell tras el
  silencio y pagado durante el regalo, «ya pagué» sin foto, cambio de método y de producto, «no quiero
  pagar todavía», desconfianza, contribución, reenvío. Arreglado en el camino: «quiero pagar por
  mercado pago» con palabras de más no avanzaba en una venta de un producto (AR); la IA nombraba
  métodos que no existen; con «mandaré 20 soles» sin foto la IA decía «recibí tu comprobante, lo
  estoy verificando» (ahora pide la foto).
- Su prueba HEA1–HEA4 (27/10, noche), arreglada y reproducida en la copia: eligió el caro y pagó el
  barato → «¿fue una confusión o te quedas con…?» (texto fijo); «sí» a lo que la IA ofrece y «el de 100
  citas también quiero» → datos de frente; «¿a cuál te refieres?» ya no muestra productos no vistos;
  upgrade solo con su mensaje; tras el regalo, la entrega no vuelve a soltar upsell ni regalo; el
  seguimiento se corta si paga a medias; comprobante repetido con texto fijo. Log a disco (📄 Log).
- Sus pruebas H1–H4 (27/10, noche) y la prueba a escala (22 clientes simulados con su lista de trabas,
  COMO-TESTEA-ALBERTO.md): order bump EC con descuento en el seguimiento 2, lineal AR, doble oferta EC y PE,
  contribución PE. Arreglado: imágenes una sola vez y solo a «qué trae» (su oferta reemplaza la pregunta
  de la IA); el cierre de la galería con su texto; «guaya» → la lista de métodos (como <<METODOS_PAGO>>);
  la IA no dice «el sistema», ni «pago recibido / lo estoy revisando» sin comprobante, ni escribe enlaces
  sin pago; «no me llegó» → reenvío directo con el detector de la venta de siempre, también en el regalo;
  el regalo sin responder se vuelve a ofrecer una vez; «sí» con regalo y producto pendientes → sus dos
  burbujas; «sí» a un producto solo con su precio en la misma burbuja; «¿fue una confusión?» y el pago a
  medias con texto fijo y renglones; «completar» sin nada que completar → «va aparte»; «¿cuál de LOS
  dos?» + «sí» → las opciones otra vez (no en bucle); el seguimiento se corta si el cliente escribe; la
  lectura del comprobante reintenta ante un corte de red; lo incluido en lo comprado no se vuelve a ofrecer;
  con el regalo aceptado, abrir un cobro ya no lo saca del regalo. «📄 Log»: conversación + log técnico.
- Reenganche (`scripts/recorrido-reenganche.mjs`): los que estaban terminan en su tubería con su precio
  (datos ya recibidos, esperando seguimiento, upsell ofrecido); los nuevos entran por la nueva. OK.

## Notas para retomar

- La copia de pruebas es `scratchpad\copia4` (servidor en el puerto 3312).
- Nunca guardar desde pruebas. No tocar el motor del automático.
