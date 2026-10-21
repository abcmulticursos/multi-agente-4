# REPORTE DE VERIFICACIÓN — 12 de octubre de 2026

## EN UNA LÍNEA
Ninguna implementación rompió la venta. Hay 2 cosas que mirar: una prueba nueva roja (5.2) y un fallo del banco de pruebas que dejaba su configuración cambiada.

## LO QUE SE PROBÓ
| Qué | Resultado |
|---|---|
| Compilación | limpia, 0 errores (con `.next` borrado) |
| Batería estática | 314 pruebas, 7 rojas |
| Las 7 rojas conocidas | las mismas 7, no apareció otra |
| Venta completa, las modalidades | pasó: `--todas`, lineal, -DOU-, -OB- y Ecuador. México no vende: está apagado en su contenido (ver abajo) |
| Seguimientos 1 y 2 | pasó en las dos tiendas. Los rojos que salieron son del molde de la prueba (ver abajo) |
| Transición de semimodalidad | pasó, en GRAFISMO FONETICO y en vivo |
| Comprobantes malos | pasó: los tres rechazados en LECTO ESCRITURA, Perú |
| Upgrade | pasó: LECTO ESCRITURA, Ecuador, del básico al full |
| Las 4 pruebas nuevas | 3 verdes, 1 roja |

### Cada corrida
| Corrida | Tienda · país | Resultado |
|---|---|---|
| `--todas` | sin tienda | TODO OK |
| lineal | sin tienda | TODO OK |
| -DOU- (`doble_oferta_dos`) | sin tienda | TODO OK |
| -OB- (`order_bump`) | sin tienda | TODO OK |
| `--pais=MX` | sin tienda · México | 2 rojos: México apagado en su contenido |
| `--pais=EC` | sin tienda · Ecuador | TODO OK |
| Seguimiento 1 | sin tienda · PE, EC, AR | 3 rojos: sin tienda no hay seguimientos escritos |
| Seguimiento 2 | GRAFISMO FONETICO · PE, EC, AR | llegaron los 3; 3 rojos del molde |
| Seguimiento 2 | LECTO ESCRITURA · PE, EC, AR | TODO OK |
| Seguimiento 2 + transición a -OB- | GRAFISMO FONETICO · PE, EC, AR | llegaron los 3; 3 rojos del molde |
| Transición de submodalidad | GRAFISMO FONETICO · PE | TODO OK: el cambio no tumba la compra y entrega el material |
| Comprobantes malos | LECTO ESCRITURA · PE | TODO OK |
| Upgrade | LECTO ESCRITURA · EC | TODO OK |

### Los rojos de las corridas que NO son fallos del bot

**México (`--pais=MX`).** El bot pasó la conversación a humano y no vendió. El registro dice `pais MX apagado -> HUMANO`. México está apagado en su contenido desde antes de hoy. Es la conducta correcta.

**Seguimiento 1 sin tienda.** El comando de las instrucciones no lleva `--tienda`. Sin tienda, la conversación usa el contenido suelto de lineal, y ese no tiene seguimientos escritos. El registro dice `seguimiento_1 no tiene variantes listas`. Con tienda sí llegan: en GRAFISMO FONETICO y en LECTO ESCRITURA salieron el 1 y el 2.

**El precio del seguimiento 2 en GRAFISMO FONETICO (-DOU-).** La prueba compara contra el precio del BÁSICO, pero su seguimiento 2 ofrece el FULL: «{{Producto_full}} a tan solo {{precio_full}}». El bot dijo el rebajado del full en los tres países, que es lo correcto:

| País | Full en la ficha | Lo que dijo el bot |
|---|---|---|
| Perú | 14 → 10 | 14 / 10 |
| Ecuador | 4 → 3.5 | 4 / 3 / 3.5 |
| Argentina | 11000 → 9000 | 11000 / 8000 / 9000 |

Y después de reaccionar, el cliente siguió con el precio rebajado. Ninguno volvió al normal. En LECTO ESCRITURA (lineal) el molde sí acierta, y salió verde.

**La transición de submodalidad, primera vez.** No corrió: el comando de las instrucciones no lleva `--tienda`, y el script la exige. Se repitió con `--tienda=tienda_mupk9ybz --pais=PE` y el comprobante de 10 soles. Salió TODO OK.

## LO QUE FALLÓ

**1. Prueba nueva 5.2: una página o un píxel sin negocio desaparece del selector de la tienda**

**Error detectado:** si el número de la tienda ya tiene su negocio identificado y la página o el píxel todavía no, el pop up Tiendas no los ofrece.
**Dónde:** `src/lib/meta/cuentas.ts`, línea 144 (`soloDeLaCuenta`).
**Qué cliente lo viviría:** usted pulsa «Actualizar lista de Meta». Meta le dice de quién es el número, pero no le contesta de quién es una página. En el pop up Tiendas (editor), esa página ya no sale para elegirla. Si ya estaba puesta en la tienda, sí sigue saliendo. Con todo sin identificar, como están sus conexiones de antes, se ofrece todo: ahí no hay bloqueo.
**Ojo:** el código lo hace a propósito. El comentario de las líneas 129 a 131 dice «tampoco lo que sigue sin identificar: ofrecerlo sería dejar abierta la misma puerta». Las instrucciones de esta verificación piden lo contrario: «lo vacío agrupa, no excluye». Las dos cosas no pueden ser verdad a la vez. Decide usted.
**NO LO ARREGLÉ** porque esta tarea era verificar.

**2. El banco de pruebas dejaba su configuración cambiada**

**Error detectado:** `recorrido-por-los-seguimientos.mjs --transicion=…` cambia la semimodalidad de la tienda y promete devolverla. Pero si encuentra un rojo, se cierra antes de devolverla.
**Dónde:** `scripts/recorrido-por-los-seguimientos.mjs`, línea 583 (`process.exit(1)` se salta el `finally` que restaura).
**Qué pasó hoy:** GRAFISMO FONETICO quedó en `segunda_oculta` en la copia local. Lo detectó la huella y la restauré desde la copia de seguridad. Su contenido en la nube no se tocó en ningún momento.
**NO LO ARREGLÉ** porque esta tarea era verificar. Es un script de pruebas, no el motor.

## LO QUE NO QUEDÓ PROBADO
- **Lo que contesta el modelo.** No se usó `--con-modelo`, para no gastar sus créditos. Los turnos que redacta el modelo no quedaron probados.
- **El comprobante dentro de `--todas` y de las modalidades sueltas.** Esos pasos salieron «saltado — hace falta una captura real», porque las instrucciones no les pasan comprobante. El pago sí quedó probado en la transición, en los comprobantes malos y en el upgrade.
- **México vendiendo.** Está apagado en su contenido.
- **Messenger e Instagram vendiendo de verdad.** Nunca se ha corrido una venta completa por ahí.
- **Dos páginas de Messenger a la vez, y dos cuentas de Facebook de verdad.** No hay con qué probarlo.
- **El registro de una compra real en Meta.** Solo se ve con una venta de verdad.
- **Sus cambios de esta noche en la nube** (Argentina y Ecuador apagados y algunos productos). Las pruebas usaron el contenido que había al empezar, a las 19:11.

## SU CONFIGURACIÓN
Huella antes: `679F0211C1A54435D218828C712390AEED6C143803D4B924C65942FF4B36E2A0`
Huella después: `679F0211C1A54435D218828C712390AEED6C143803D4B924C65942FF4B36E2A0`
Se restauró. La prueba de seguimientos con transición la había dejado con GRAFISMO FONETICO en `segunda_oculta` (ver «Lo que falló», punto 2). Ahora está idéntica, byte por byte.

## CONVERSACIONES DE PRUEBA
Se borró 1, la de la transición repetida a mano. Las demás las borró cada recorrido. Quedan 0.

## LAS 4 PRUEBAS NUEVAS
| Prueba | Resultado |
|---|---|
| `prueba-refrescar-no-borra-el-permiso.mjs` | verde. Las dos escrituras sacadas de `db.ts` se ejecutan en una base en memoria: refrescar pone el permiso nuevo, nunca lo deja vacío. Un refresco sin permiso lo rechaza la base, y el de antes se queda |
| `prueba-cuenta-sin-identificar-no-bloquea.mjs` | **roja**, por el punto 1 de «Lo que falló» |
| `prueba-el-aviso-de-mezcla-no-miente.mjs` | verde. Avisa con mezcla de verdad. Calla con lo sin identificar y con el píxel compartido |
| `prueba-el-kanban-no-pierde-tarjetas.mjs` | verde. En «Todas las tiendas» salen todas, también las sin tienda. Cada tienda más las sin tienda dan el total |

Con estas, la batería pasa a 318 pruebas y 8 rojas. La octava es la 5.2: hasta que usted decida, no es una regresión.

## AÑADIDO EL 13/10: LAS PRUEBAS CON EL MODELO

Usted dio permiso para usar el modelo después de la verificación. Se corrieron con `--con-modelo` y con comprobantes de verdad, todas con clientes de Perú. Ecuador y Argentina quedaron fuera porque los apagó esta noche en la nube.

| Corrida | Tienda | Contenido | Resultado |
|---|---|---|---|
| Venta con modelo y comprobante | LECTO ESCRITURA | el de ahora | pagó y se aprobó. El upsell no salió: **usted lo apagó esta noche** (registro: «le falta el INTERRUPTOR (está apagado)») |
| -DOU-, se queda con el básico | GRAFISMO FONETICO | el de ahora | igual: pagó y se aprobó; upsell apagado |
| -DOU-, se queda con el full | GRAFISMO FONETICO | el de ahora | igual: pagó 14 y se aprobó; upsell apagado |
| Las 6 modalidades con el modelo | sin tienda | el de ahora | TODO OK |
| Venta con upsell | LECTO ESCRITURA | el de antes de esta noche | **TODO OK** |
| -DOU- con upsell | GRAFISMO FONETICO | el de antes de esta noche | **TODO OK** |

**Lo que hizo el modelo, y salió bien en todas:**
- Contestó al precio y a «¿no es estafa?».
- Leyó el comprobante y lo aprobó con el importe correcto (11, 10 y 14 soles).
- En el upsell supo describir el extra, sin decir «opcional». Contestó corto y cerró con una pregunta.
- No volvió a pedir el comprobante ya aprobado.
- Al aceptar el extra, mandó dónde pagarlo.

**Cómo se probó el upsell sin tocar su contenido:** se puso la copia de antes de esta noche, solo en esta computadora y solo mientras duraron esas dos corridas. Al acabar se devolvió su contenido actual. Huella: `542A53FB4FE903985FB5C7BF24FF7B318D36312FEDD0C24E2B5FDF4EC0797E10`, la misma que antes de empezar. Su contenido en la nube no se tocó.

**Conversaciones de prueba:** 0.

## AÑADIDO EL 13/10: ECUADOR Y ARGENTINA, CON EL MODELO

Usted volvió a encender los dos países y el upsell. Se corrieron con el modelo, comprobantes de verdad y el método «transferencia».

| Corrida | Tienda | País | Comprobante | Pago | Upsell | Rojos |
|---|---|---|---|---|---|---|
| Su producto | LECTO ESCRITURA | Ecuador | Pichincha 3.50 | aprobado | ofrecido y aceptado | 1 (A) |
| Su producto | LECTO ESCRITURA | Argentina | 8500 pesos | aprobado | ofrecido y aceptado | 1 (B) |
| -DOU-, básico | GRAFISMO FONETICO | Ecuador | Pichincha 3 | aprobado | ofrecido y aceptado | 0 |
| -DOU-, full | GRAFISMO FONETICO | Ecuador | Pichincha 4 | aprobado | ofrecido y aceptado | 1 (A) |
| -DOU-, básico | GRAFISMO FONETICO | Argentina | 8000 pesos | aprobado | ofrecido y aceptado | 1 (B) |
| -DOU-, full | GRAFISMO FONETICO | Argentina | 11000 pesos | aprobado | ofrecido y aceptado | 1 (B) |

**Rojo A: el modelo no cerró con una pregunta (Ecuador).**
Al preguntar el cliente qué es el extra, el modelo lo describió bien, pero no terminó con una pregunta. Es redacción del modelo: cambia de una vez a otra. En Perú y en otra de Ecuador sí cerró con pregunta. El extra se vendió igual en las dos.

**Rojo B: en Argentina, el reenvío de los datos repite la frase de la primera vez.**
**Error detectado:** el cliente vuelve a escribir «transferencia» y el bot le reenvía los datos con «Excelente!, Puedes realizar tu pago a través de los siguientes datos» otra vez delante.
**Dónde:** `src/lib/workflow/engine.ts`, líneas 8303 a 8308 (`unTextoLlevaLosDatosParaPagar`). Para quitar esa frase, el bot busca la burbuja que lleva los datos. La reconoce por `{{METODO_DE_PAGO_1}}` o por seis cifras seguidas. La burbuja de Argentina lleva `{{NUMERO_DE_CUENTA}}`, y eso no lo reconoce. Por eso cree que no hay datos y no quita nada. En Perú y Ecuador los datos van con `{{METODO_DE_PAGO_…}}` y sí funciona.
**Qué cliente lo viviría:** un argentino que ya recibió la cuenta y vuelve a nombrar su método recibe la presentación otra vez, con los datos y el monto correctos.
**No es una regresión.** Ese detector no ha cambiado desde el 21/09, y nada de lo hecho estos días pasa por ahí.
**NO LO ARREGLÉ** porque esta tarea era verificar.

**Su configuración:** huella antes y después `6E5750DC926E1DC050F62093CB6F4D4C8F13479809EBF53F3CD0F74F11614253`, idéntica. **Conversaciones de prueba:** 0.

No se deployó nada.
