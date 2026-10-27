# Inventario: lo que hace el automático y si el tablero lo hace (27/10/2026)

Pedido de Alberto: «primero el inventario, estoy perdiendo días». Cada regla del automático que toca la
conversación de venta, de dónde sale (archivo y línea) y su estado en el tablero.

- ✅ el tablero lo hace igual · ⚠️ lo hace a medias o distinto · ❌ no lo hace · ➖ no aplica al tablero
- **(H1/H2/H3)** = lo vio en su prueba del 27/10.

---

## A. Cómo habla (reglas fijas del cerebro del automático, `openrouter.ts`)

El tablero usa de `system-prompt.ts` el tramo «DISTRUST OR FEAR» → «EMAIL CAPTURE». Las reglas fijas
que el automático añade en `openrouter.ts` NO las tiene:

| # | Regla del automático | Dónde | Tablero |
|---|---|---|---|
| A1 | No usar el nombre del cliente («confianzudo») | openrouter 1071 | ❌ |
| A2 | 1 emoji por respuesta, 2 como máximo; nada de besos ni guiños | openrouter 1072 | ❌ |
| A3 | Distancia profesional: nada de «tranqui», «amigo», «mi reina»… | openrouter 1078 | ❌ |
| A4 | Nunca «quisieras» en el cierre | openrouter 1079 | ❌ |
| A5 | Datos del producto solo si están en el contenido | openrouter 1085 | ⚠️ (una línea genérica) |
| A6 | Negrita ligera: 1 a 3 palabras por mensaje | openrouter 1722 | ❌ |
| A7 | Nunca escribir cuentas, titulares ni números: el sistema los manda (marcador) | openrouter 1728 | ⚠️ **(H2)**: la IA copió la cuenta del historial; hoy un freno la borra y la conversación se trabó |
| A8 | Respuesta en burbujas con doble salto, sin bloque gigante (con «Limitar burbujas»: resumir) | openrouter 1178 + system-prompt 70 | ⚠️ **(H3)**: salió en una burbuja (ver C4) |
| A9 | Cierres: lista de variantes y rotación | system-prompt 82–106 | ✅ (incluye «¿Deseas las instrucciones…?», que no le gusta: quitar) |
| A10 | Un solo producto: «solo ofrecemos este material», sin «opción 1/2» | openrouter 1522 | ❌ |

## B. Las dos opciones (Order Bump / Doble Oferta)

| # | Regla del automático | Dónde | Tablero |
|---|---|---|---|
| B1 | Sin opción elegida, «¿precio?» genérico → pregunta de cuál de las dos | openrouter 1461 | ❌ |
| B2 | «¿Qué es / qué trae la opción X?» → contenido, SIN precio | openrouter 1464 | ❌ |
| B3 | «son 2» → nombra las dos + UNA frase por la completa | openrouter 1505 | ✅ (27/10) |
| B4 | Un saludo o cambio de tema no elige el básico; las dos siguen vivas | openrouter 1454 | ✅ |
| B5 | Galería ya mostrada → «están más arriba», no se reenvía | openrouter 1445 | ❌ |
| B6 | Reacción a lo mostrado («entonces trae todo eso?») → aclara, no reofrece fotos | openrouter 1447 | ❌ |
| B7 | Nombra un método sin elegir → se anota y se pregunta cuál opción | engine 3373 / openrouter 1757 | ✅ |
| B8 | Elige justo después de preguntar el precio → confirma precio y pregunta | engine 3438 | ✅ |
| B9 | Quiere pagar sin elegir → recordatorio de las dos (texto del dueño) | engine 3534 | ✅ |
| B10 | Cambia de opción antes de pagar | engine 3561 | ✅ |
| B11 | Precio tras un seguimiento con la elección vencida → recordatorio | engine 3663 | ⚠️ |
| B12 | «El de 5000» elige por el precio del país | engine 4162 | ⚠️ sin medir |
| B13 | La diferencia entre las opciones («$1 más») es un monto válido | (montos de la venta) | ❌ **(H3)**: el filtro lo borra y pide otra respuesta |

## C. El método y los datos de pago

| # | Regla del automático | Dónde | Tablero |
|---|---|---|---|
| C1 | Con producto elegido, decir el método → datos de ESE producto | engine 4333 + memoria | ❌ **(H1)**: «vecino» con el PACK abierto le cobró el básico (un cuadrito de los seguimientos colgados mandó sobre el cobro) |
| C2 | Método ya elegido: no se repregunta; «¿cómo pago?» = recordar ese método | openrouter 1768 | ✅ con cobro abierto |
| C3 | «Sí» con los datos ya enviados → se reenvían | engine 3785 | ⚠️ sin medir |
| C4 | «Ok» seco con los datos enviados → se calla | engine 3724 | ✅ |
| C5 | Los datos siguen en pantalla → no se repiten | handler 2396 | ⚠️ |
| C6 | Pide los datos sin método → menú de métodos | engine 4216 | ✅ |
| C7 | En lineal basta un «sí» | engine 4233 | ✅ |
| C8 | Nadie paga un precio que nadie eligió | engine 4406 | ✅ |
| C9 | Un solo método en el país → datos de frente | — | ✅ (27/10) |

## D. Después de comprar (upsell, upgrade, regalo)

| # | Regla del automático | Dónde | Tablero |
|---|---|---|---|
| D1 | Postventa: no reiniciar la venta ni reofrecer | openrouter 1056 | ✅ |
| D2 | «Completar» con dos productos en la mesa → «¿a cuál te refieres?» | engine 2621 (`preguntarPorCualDeLosDos`) | ❌ **(H2)** |
| D3 | Upgrade automático: pagó A y paga la diferencia → recibe B | engine 2661 / payment.ts | ❌ **(H3)**: solo con una ficha Cobro «upgrade», que MASCOTAS no tiene |
| D4 | El extra se paga entero (no con lo ya pagado) | engine 9013 | ⚠️ lo dice la IA, no el bot |
| D5 | Quiere pagar el segundo producto → datos del segundo con SU precio (marcador) | openrouter 1788 / handler 1964 | ❌ **(H2)**: «quiero pagar eso de mascotas» → la IA eligió otro y se trabó |
| D6 | El comprobante del segundo producto no es «ya pagaste» | engine 2594 | ✅ (27/10) |
| D7 | Upsell: botón, cuadrito, «sí/no», por su nombre | engine 2922 | ✅ (por su nombre: ⚠️) |
| D8 | Regalo: botones, cuadritos, captura, correo, silencio | engine 2856 / 3213 / 3310 | ✅ (es el mismo motor) |
| D9 | En el regalo, preguntas → respuesta del regalo, no venta | openrouter 1994 / 2014 | ✅ (27/10) |

## E. Pagos (`payment.ts`)

| # | Regla | Tablero |
|---|---|---|
| E1 | Fecha si el país la exige; titular en Yape/Plin | ✅ |
| E2 | Comprobante repetido (en su chat) | ✅ (en vivo, en cualquier chat) |
| E3 | Pagos a medias se suman y se pide lo que falta | ✅ |
| E4 | Eligió uno y pagó otro | ✅ |
| E5 | 3 comprobantes rechazados → aviso | ✅ |
| E6 | Upgrade por acumulación | ❌ (= D3) |

## F. Otros

| # | Regla | Tablero |
|---|---|---|
| F1 | Número extranjero («tu número no es de aquí») | ❌ |
| F2 | «Tengo una duda» → pregunta corta cuál | ❌ |
| F3 | Saludo a mitad de la venta («hola») → corto, con el producto | ⚠️ **(H2)**: no es una regla escrita del automático (sale de su cerebro); en el tablero mi freno dejó al cliente SIN respuesta |
| F4 | Bot mudo → nunca: si no hay respuesta, algo sale | ❌ (mi freno de «no preguntar el método» borró una respuesta entera) |

## G. Lo que faltaba inventariar (revisión del 27/10, más tarde)

Zonas que la primera pasada no cubrió. ❓ = sin medir todavía en el tablero.

| # | Regla del automático | Dónde | Tablero |
|---|---|---|---|
| G1 | Muestras en orden (básico → complementario → full), una sola vez, solo con galería y checks | handler / openrouter 1614–1709 | ✅ (25/10) — el orden por puesto ❓ |
| G2 | El producto oculto del order bump: ni precio ni contenido hasta su intro | openrouter 1454 / CLAUDE.md A5 | ✅ (la IA solo conoce lo presentado) |
| G3 | Precio de oferta: si pregunta por qué está más barato, «promoción por seguir interesado» | openrouter 1181 | ❌ |
| G4 | Seguimientos: franjas, horas de silencio, lead tardío, antirráfaga, reinicio al escribir | engine 4606 / quiet-hours | ✅ (27/10, con «ignora…») |
| G5 | Preferencia de entrega (WhatsApp o correo) tras pagar | engine 12535–12775 | ❌ (hay «Ofrecer también por correo» en la Entrega, pero no la pregunta de preferencia) |
| G6 | Encuesta al cliente después de la compra | engine 849–938 | ⚠️ sale si el regalo la programa (lo hace el motor de siempre) |
| G7 | A humano tras el comentario del regalo | engine 824 | ✅ (el regalo es del motor de siempre) |
| G8 | Preguntar el nombre del cliente | engine 2132 | ❌ |
| G9 | Aviso de país (Venezuela / «¿atienden en Perú?») | engine 2141 | ❌ |
| G10 | El bot no se queda mudo con un comprobante (acuse) | handler 2521–2613 | ❌ (= F4) |
| G11 | Pregunta de precio repetida en segundos → no se contesta dos veces | handler `shouldSuppressDuplicatePriceReply` | ❌ (va después de la entrada del tablero) |
| G12 | Order bump DESPUÉS de pagar (`awaiting_post_payment_order_bump_choice`) | engine 3392 | ➖ se arma con cables (una oferta después de la Entrega) |
| G13 | Audio del cliente (se transcribe y se contesta) | handler 1370 | ✅ (la transcripción llega al tablero como texto) |

## H. Barrido completo de funciones del automático (27/10, más tarde)

Recorridas una por una las funciones de `engine.ts`, `handler.ts` y `payment.ts`. Lo que no estaba
en las secciones de arriba:

| # | Regla del automático | Dónde | Tablero |
|---|---|---|---|
| H0 | **EL CANDADO DE LA ELECCIÓN — la palabra del bot es ley.** Elegido un producto, precio, datos, contenido y lo que diga la IA son de ESE producto hasta que el cliente cambie claramente. Nada lo mueve solo (cuadrito, seguimiento, IA) | engine 3561–3700 (cambio de opción), `lockExpectedPriceForConvo` | ❌ **(H1)** — regla nº 1 |
| H1 | «No tengo yape, tengo plin»: un método NEGADO no se elige | engine 11726 `methodMentionIsNegated` | ⚠️ el tablero usa `detectDynamicPaymentMethod` sin la negación — medir |
| H2 | «Ya pagué» / «ahorita te pago» sin foto: se le pide el comprobante, no se le vende otra vez | engine 11703 `messageAnnouncesPayment` | ⚠️ lo contesta la IA — medir |
| H3 | Pagó sin elegir: se deduce la opción por el monto | payment.ts `inferOrderBumpChoiceFromAmount` | ✅ (`cobroQueEncajaConElPago`) |
| H4 | Elección ambigua entre las dos → «¿te refieres a X o a Y?» | engine 10694 `sendTwoTierChoiceClarification` | ⚠️ la IA responde; no hay pregunta fija |
| H5 | Redirección de país (`<<PAIS: …>>`: el cliente es de otro país → mensajes de ese país) | engine 9068 `sendCountryRedirect` | ❌ |
| H6 | Postventa con RECLAMO insistente («no me llegó», «¿a qué hora?») → al insistir, reenvía | handler / `resendApprovedMaterial` + COMO-TESTEA-ALBERTO | ⚠️ hay herramienta de reenvío; el «tras 3–5 quejas siempre entrega» sin medir |
| H7 | Aviso de novedad al pasar de 1 a 2 productos (con el REENGANCHE encendido) | engine 10600 `renderAvisoDeActualizacion` | ❌ (ver I) |
| H8 | Contenido guiado del dueño (modo guiado: respuestas fijas por tema) | engine 1183 `tryGuidedSalesbotContent` | ➖ el tablero arma eso con fichas y cuadritos |
| H9 | Reglas fijas por palabra del dueño (salesbot) | engine 1852 `runSalesbotRules` | ➖ decidido no trasladar (26/10) |

## I. REENGANCHE — cambiar de tubería con clientes dentro (pruebas propias)

Lo que él hace: vende con una tubería lineal; arma otra (COMO DOU o COMO OB) suelta; cuando está lista,
desconecta la lineal del Inicio y conecta la nueva. **Solo los clientes nuevos entran por la nueva;
los antiguos terminan su compra como empezaron, con su precio congelado.**

| # | Del automático | Tablero |
|---|---|---|
| I1 | La conversación anota con qué forma nació y se queda con ella («lineal extendida») — handler 1475 | ✅ por diseño: el cliente sigue en su ficha, con los cables de la tubería vieja |
| I2 | Precio congelado al dar el precio / los datos | ✅ al abrir el cobro |
| I3 | Interruptor REENGANCHE: los antiguos pasan a la forma nueva, con aviso de novedad | ❌ |
| I4 | Borrar la tubería vieja con clientes dentro | ⚠️ se quedan sin ruta (solo la IA): hay que DESCONECTAR, no borrar — avisarlo en pantalla |

**Las pruebas del reenganche (distintas de las normales)**, con sus ventanas en tiempos distintos,
conectadas a la tubería vieja en el momento del cambio:
1. Con los datos de pago ya recibidos → paga: ¿precio y producto de antes?
2. Esperando su seguimiento 1 → ¿le sale el de la vieja (su camino)?
3. En el seguimiento 2, pulsa el botón → ¿precio del botón?
4. En el seguimiento 2, compra hablando → ¿precio de su tubería?
5. Con el upsell ofrecido → ¿lo puede comprar?
6. Un cliente nuevo → ¿entra por la nueva y ve los dos productos?

## J. El contrato de la venta (dictado el 27/10)

Hay información correcta · palabras finales que llevan a la compra · romper objeciones · sugerir
métodos de pago · entender la elección de pago · **la elección es ley (H0)** · entrega correcta ·
postventa que se comporta como el automático (H6, D1) · reenvío de enlaces sin fallas.
**Pendiente aparte:** el correo.

---

## Lo que falta, por orden de daño

0. **H0** — el candado de la elección (la palabra del bot es ley). Incluye C1.
1. **C1** — cobra el producto equivocado. **D3/E6** — el upgrade no existe sin ficha especial.
   **D2/D5** — pagar el segundo producto se confunde y se traba.
2. **F4** y **A7** — silencio y conversación trabada.
3. **B13**, **A8** — respuestas apretadas y reintentos (tokens).
4. **A1–A6, A10, B1, B2, B5, B6, F1, F2** — cómo habla: copiar las mismas reglas del automático.
5. **B11, B12, C3, C5, D4, D7** — medir antes de tocar.
