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

## Probado

(nada aún)

## Notas para retomar

- La copia de pruebas es `scratchpad\copia4` (servidor en el puerto 3312).
- Nunca guardar desde pruebas. No tocar el motor del automático.
