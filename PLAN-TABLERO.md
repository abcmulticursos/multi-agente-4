# PLAN — EL TABLERO (el segundo motor, la ruta armable)

> **ESTADO, 22/10/2026 (noche):** construidas las 8 roscas para **WhatsApp**: fichas Inicio,
> Mensaje (botones, cuadritos, «otra cosa», «no respondió»), Cobro (producto o pago abierto con
> tramos por país, «no pagó»), Entregar, Condición (compró / país / anuncio), Esperar, Postventa y
> regalo, y Pasar a humano. Varias ventas por conversación: cada cobro es su propio ticket
> (`tablero_compras`). Falta: Messenger e Instagram. Ver la sección «EL TABLERO» de CLAUDE.md.

> Pedido por Alberto el 22/10/2026. **Solo en ALBERTO 4**: «el bot alberto 2 queda tal como
> está… la nueva manera de trabajar el segundo motor lo apliques en alberto 4 mientras yo uso
> alberto 2». **No se empieza ninguna fase sin su aprobación.**

## Qué quiere, con sus palabras

> «Yo quiero que el bot pueda hacer eso en la semi modalidad COMOHOY, pero yo modificándola; es
> como yo armar mi propia ruta… no quiero que mi bot sea una tubería soldada… sino ser armable,
> en base a decisiones, botones, elecciones.»

> «El bot no termina ahí: luego viene la insistencia del bot, eso yo lo programo pero nada
> automático en ese aspecto; luego viene la postventa, regalo, etc.»

> «Si yo quiero, luego de la venta vuelvo a crear nuevamente otra igual, con elección… pensarlo
> sin límites jugando con lo que tenemos, y si se necesita alguna "rosca" adicional dímelo.»

El primer caso que lo motiva es la **venta por contribución**, como la de Sendy:
1. El bot ofrece y dice la condición: «¿deseas recibir el material?».
2. El cliente acepta y recibe el material gratis.
3. El cliente manda su contribución, con el monto que quiera.
4. Según el monto, recibe un plus distinto.
5. Siguen la insistencia que él programe, la postventa y el regalo.

## Las cuatro reglas que impiden conflictos

1. **Una conversación, un solo motor.** Al nacer queda marcada como `tablero` o `de siempre`, y
   esa marca no cambia a mitad de la conversación.
2. **Sin cables, nada cambia.** El tablero solo despierta en COMOHOY y solo si la tienda tiene un
   tablero con una ficha de inicio conectada. COMODOU y COMOOB no se enteran de que existe.
3. **Lo compartido se usa, no se modifica.** Envío de burbujas (`sendConfiguredSteps`), lectura
   de comprobantes, entrega y regalo se llaman tal como están. Si alguno necesita algo, se le
   **añade**; nunca se le cambia lo que ya hace.
4. **Lo programado lleva su dueño.** Cada acción programada del tablero tiene su propio tipo, y el
   obrero nunca la mezcla con las del motor de siempre.

**Comprobación en cada fase:** la batería y `recorrido-completo.mjs --todas` se corren ANTES y
DESPUÉS. Si cambia algo del motor de siempre, la fase no se sube.

## Cómo se maneja cada respuesta (su pregunta del 22/10)

**Con ventanas flotantes, como el salesbot de Kommo**, y con el mismo cajón prolijo que ya usa
para editar burbujas:

- **Doble clic en una ficha** → se abre su ventana flotante. Ahí escribe las burbujas, con sus
  tiempos, imágenes, audios, comodines y visor de WhatsApp.
- **Lo que el cliente puede contestar** se define dentro de la misma ventana:
  - **Botones** → cada botón es una salida.
  - **Cuadritos de decisión** (palabras o frases) → cada cuadrito es una salida.
  - **«Otra cosa»** → la IA conversa y lo trae de vuelta (ver rosca 8).
  - **«No respondió en X tiempo»** → la salida del reloj, para la insistencia.
- **Cada salida aparece como un puntito en el borde de la ficha.** De ahí tira el cable a la
  ficha que quiera: adelante, atrás, en círculo o a una venta nueva.
- **Una salida sin cable no hace nada.** «Nada se conecta solo.»

## El cobro sigue abierto mientras insiste (su aclaración del 22/10)

> «Al final de la entrega, si el cliente no paga, decirle, como una especie de seguimientos:
> "hola ya te envié, estoy a la espera de tu contribución", o "hola, ¿te gustó el material? me
> dijiste que me enviarías"… y el monto que envíe el cliente, yo defino a qué ruta se va.»

```
Entregar → Cobro abierto ─ pagó 80 → plus de 80 · pagó 140 → plus de 140 · menos del mínimo → …
                         └ no pagó en X → recordatorio 1 → no pagó en Y → recordatorio 2 → …
```

- **El cobro queda pendiente** mientras el cliente recorre los recordatorios. Un comprobante que
  llegue en cualquier ficha se lee contra ESE cobro y sigue la salida de su monto.
- **Al pagar se cancelan** los recordatorios que faltaban de ese cobro.
- Los recordatorios son fichas Mensaje normales: él escribe cuántos quiera y con qué tiempo.

## Las piezas (tipos de ficha)

| Ficha | Para qué | Sus salidas |
|---|---|---|
| **Inicio** | Por dónde entra el cliente (por tienda; opcional por anuncio o país) | una |
| **Mensaje** | Burbujas | sus botones, sus cuadritos, «otra cosa», «no respondió en X» |
| **Entregar** | Manda un producto de la biblioteca, cuando sea | una |
| **Cobro** | Pide el pago de un producto, o un **pago abierto** | precio exacto · cada tramo de monto · menos del mínimo · no pagó en X |
| **Condición** | Separa por lo que ya pasó: compró X, país, vino de anuncio | sí / no |
| **Esperar** | Pausa de X tiempo | una |
| **Postventa / regalo** | Arranca el regalo de siempre | al terminar |
| **Humano** | Pasa la conversación a mano y avisa | ninguna |

## Las roscas que faltan, y qué toca cada una

| # | Rosca | Toca el motor de siempre |
|---|---|---|
| 0 | **Los datos del tablero**: fichas y cables guardados en el contenido, que el bot SÍ lee (la pizarra de hoy solo dibuja) | no |
| 1 | **El cable libre** y la posición del cliente en el tablero | no; es una tabla nueva |
| 2 | **El reloj**: «no respondió en X → ir a…»; si responde, se corta | no; tipo propio en el obrero |
| 3 | **Entregar cualquier producto en cualquier momento** | usa la entrega de siempre sin cambiarla |
| 4 | **Cobro con salidas y pago abierto** | sí, el lector de comprobantes: se le **añade** «leer el monto sin exigir precio» |
| 5 | **Varias ventas en la misma conversación**: cada ficha de cobro es su propio ticket, con su precio congelado y su comprobante | sí; registro de compras en Meta por venta |
| 6 | **Condiciones** | no |
| 7 | **Postventa y regalo conectables** | usa el regalo de siempre sin cambiarlo |
| 8 | **Lo que la IA sabe en cada ficha**: solo los productos ya presentados hasta ahí, y nunca un precio que no sea el de su ficha de cobro | sí, el armado del prompt: bloque nuevo solo para conversaciones del tablero |

**La única entrada al motor de siempre es una:** en `handler.ts`, si la conversación es de
tablero, el turno lo atiende el tablero. Las conversaciones `de siempre` no pasan por ahí.

## Las fases, cada una con su aprobación

| Fase | Qué queda funcionando | Lo que él puede probar al terminar |
|---|---|---|
| **1** | Roscas 0 + 1: tablero en el editor con fichas **Inicio, Mensaje y Humano**, ventanas flotantes, botones y cuadritos como salidas, y cables libres | Armar una ruta de mensajes con botones y recorrerla en el simulador |
| **2** | Rosca 2: el reloj → su insistencia | Que el seguimiento salga solo si no responde, y se corte si responde |
| **3** | Rosca 3 y ficha **Esperar** | Entregar material antes del pago |
| **4** | Roscas 4 + 5: cobro, pago abierto y tramos | **La venta por contribución completa** |
| **5** | Rosca 6: condiciones | Una segunda venta que no ofrece lo que ya tiene |
| **6** | Rosca 7: postventa y regalo | La ruta completa de punta a punta |
| **7** | Rosca 8: la IA dentro del tablero, afinada | Conversaciones libres en medio de la ruta |

Desde la fase 1 la IA ya contesta lo que no encaje, con el contenido de la tienda. La fase 7 es
la que la afina ficha por ficha.

## Lo que NO se va a poder verificar sin él

- Lo que redacta la IA dentro del tablero: solo lo muestra la conversación corrida.
- El pago real y el registro de la compra en Meta: necesitan una venta de verdad.
- Que las rutas que él arme tengan sentido comercial: el tablero obedece los cables, no los juzga.

## Lo que no se toca

- ALBERTO 2 entero.
- En ALBERTO 4: COMODOU, COMOOB y COMOHOY sin tablero siguen con el motor de siempre, tal cual.
- Ninguna regla, tiempo ni contención del motor de siempre se mueve. Lo nuevo vive en
  `src/lib/tablero/`.
