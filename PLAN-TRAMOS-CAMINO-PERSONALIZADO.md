# MODIFICACIÓN DE PROYECTO A NIVEL PERSONALIZADO — los TRAMOS

> **NO IMPLEMENTAR.** Dictado por Alberto el 23 de septiembre de 2026, con estas
> palabras: «anótala como MODIFICACIÓN DE PROYECTO A NIVEL PERSONALIZADO, lo
> vemos luego». Se guarda para retomarlo entero, no para empezarlo.

## Qué quiere, con sus palabras

> «Yo quiero líneas personalizadas, no deseo llenar los cuadritos con el
> contenido. Es incómodo tener que entrar al cuadrito y ver su contenido para
> corregir un texto o una letra, mientras que en las líneas personalizadas o las
> intros y seguimientos nativas puedo hacer la corrección directa. Lo que
> necesito es que en los cuadritos de decisiones pueda yo elegir, en la última
> burbuja, cuál intro o seguimiento sigue.»

Y el dato que añadió después, que cambia el diseño:

> «Necesito definir qué sería cada línea, si es un seguimiento o una línea. Necesito
> que tenga un RELOJ para que se suelte la siguiente, tal como lo hacen los
> seguimientos —Seguimiento 1, 2, 3— con su respectivo sesgado y reinicio de
> tiempo cuando el cliente escribe.»

## Qué es un TRAMO

Un grupo de burbujas guardado con su nombre, que se edita igual que una intro y
**no significa nada para el motor hasta que alguien lo llama**. Mismo editor,
mismo visor, mismas burbujas, mismos comodines.

**Nombre propuesto: TRAMOS.** Un camino se hace de tramos, y no se confunde con
nada de lo que ya existe. Él lo llamó «líneas personalizadas»; queda a su
elección.

## POR QUÉ NO SE REUSAN LAS INTROS Y SEGUIMIENTOS NATIVOS

Fue la primera propuesta —añadir una acción «soltar la secuencia X» apuntando a
las que ya existen— y **es la equivocada**. Sus secuencias nativas no son solo
contenido: llevan efectos enganchados.

- La **intro** mueve el estado de la conversación y programa los seguimientos.
- El **seguimiento** mueve `last_followup_index`, y de ese contador depende
  `isDiscountActiveForConversation`, o sea **su etapa de descuento**.

Lanzar a mano un seguimiento nativo le encendería el descuento a un cliente sin
querer. No da error, no se ve, y aparece como un cobro raro tres días después.

**Un tramo es contenido puro y por eso es seguro.** El instinto del dueño era el
correcto.

## LO QUE HAY QUE CONSTRUIR

### Imprescindible

1. **La sección de tramos.** Crear, nombrar, editar, duplicar. Igual que hoy se
   edita una intro.
2. **Dos acciones nuevas** en el cuadrito de decisión y en el botón:
   - `Continuar con el tramo ___` (con selector)
   - y la del reloj, abajo.

### El RELOJ — lo que pidió el 23/09 y falta diseñar

Un tramo tiene que poder soltar el siguiente **por tiempo**, como los
seguimientos, con las dos reglas que ya viven en `quiet-hours.ts`:

- el retraso desde que empezó (`delay_minutes_from_first_message`);
- y el **reinicio cuando el cliente escribe** — la línea
  `[wf] convo N: sigue escribiendo, los seguimientos vuelven a contar desde ahora`.

**Decisiones abiertas, todas suyas:**

- ¿El reloj es del TRAMO («este tramo suelta al siguiente en N minutos») o del
  CAMINO («este camino tiene estos tramos, con estos tiempos»)? Lo segundo se
  parece más a lo que ya hay.
- ¿Respeta las franjas horarias y las horas de silencio, como los seguimientos?
  Debería, o le escribirá a clientes de madrugada.
- ¿Y la separación mínima de 4 horas entre mensajes?
- ¿Qué pasa si el cliente contesta a medio camino: se cancela el resto, se
  reinicia, o sigue?

### Comodidad, para después

- Carpetas para ordenar los tramos («intros», «seguimientos», «regalos»…).
- El armador de caminos con contenedores, clic derecho, duplicar.
- Editar una burbuja desde el propio visor, sin volver a su sección.

## LA PREGUNTA QUE HAY QUE CONTESTAR ANTES DE ESCRIBIR CÓDIGO

**¿Qué pasa cuando un tramo termina y su última burbuja no lleva cuadrito?**

Tres salidas, y hay que elegir una:

1. Se calla y contesta el modelo, como hoy cuando el motor no atiende el turno.
2. Salta a otro tramo fijo, elegido por él.
3. Espera un plazo y, si nadie contesta, suelta algo.

Sin decidir esto, el bot se queda mudo a media venta. **Ya pasó dos veces en este
proyecto**, y las dos por lo mismo: una rama que sustituye algo y no comprueba
que lo que la sustituye salió de verdad.

## PARA QUÉ LO QUIERE

Para armar a mano el recorrido que hoy decide el motor: su propia ruta tipo
-DOU- y su propia ruta tipo -OB-, sin depender de «una tubería soldada» (sus
palabras). La revelación del segundo producto dejaría de ser una etapa del motor
y pasaría a ser un tramo suyo, soltado por el cuadrito que él decida.

Y el final no cambia: **el upsell y el regalo nativos siguen funcionando**,
porque cuelgan de que el pago se apruebe, no de qué intro salió.

## EL RIESGO QUE HAY QUE CUIDAR

**Que una línea salga dos veces** — una por el reloj automático y otra por el
tramo. Se evita con los interruptores ON/OFF que ya tiene, pero conviene un aviso
en el editor que lo marque, como el que ya avisa de un cuadrito que dice «sí» sin
acción.

## LO QUE NO ESTÁ MEDIDO

No se ha auditado la maquinaria que manda secuencias (`scheduleDeliverySequence`,
el worker, `quiet-hours`) para saber si un tramo puede usarla tal cual o hace
falta algo aparte. **Antes de prometer fases o tiempos, eso hay que mirarlo**, y
entregarle el reporte con los candados delante.
