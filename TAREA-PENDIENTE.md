# TRASPASO — estado al 17 de septiembre de 2026

> **Para quien retome esto.** Está todo medido: no repitas la investigación que ya
> está aquí. Lee además `CLAUDE.md`, que manda sobre cualquier costumbre.
>
> Dos proyectos, hermanos pero **no idénticos**: `BOT ALBERTO 1` y `BOT FRANKO`.
> Lo que funciona en uno no se copia al otro sin auditar — hay una sección abajo
> con la diferencia que más ha costado.

---

## 0-BIS. LA EVOLUCIÓN QUE PIDIÓ — 22 de septiembre de 2026

> **IDEA DICTADA POR ÉL + DIAGNÓSTICO MEDIDO ESE MISMO DÍA. No empezado.**
> Esto no es un arreglo: es hacia dónde quiere que vaya el proyecto. En
> `BOT ALBERTO 2`, que **está en testeo y no vende** — ALBERTO 1 es el que
> vende. Eso cambia el cálculo de riesgo: aquí se puede medir rompiendo.

### QUÉ QUIERE, CON SUS PALABRAS

> «Quiero trabajar todo en la modalidad lineal y las otras modalidades luego las
> desaparecería, o quizás las dejaría ahí para que no molesten.»

Que las modalidades dejen de ser rutas distintas y pasen a **armarse con los
productos y los cuadritos de decisión**:

- **Habilitar todos los productos en lineal.** Hoy solo ofrece dos puestos
  —`unico` y `upsell`—. Él quiere elegir cuántos productos entran y qué papel
  juega cada uno.
- **Simular -DOU-**: una intro que presenta DOS productos en un solo mensaje, y
  un cuadrito con la elección. Nada programado por el bot.
- **Simular -OB-**: intro de un producto, cuadrito «¿deseas adquirirlo?», y al
  aceptar se revela el segundo con su propia intro.
- **«Upsell genérico»**: sus palabras. Un segundo (y tercero, y cuarto) producto
  que él presenta y cobra, encadenados, sin usar la etapa de upsell predefinida.
  Una **cola de ventas** en vez de una sola etapa.

**Por qué lo quiere:** *«Con esto evito cambio de datos al cambiar de
modalidad.»* Cambiar de modalidad hoy no es una continuación de su venta — no
lleva su intro ni sus datos.

### LO QUE YA FUNCIONA HOY, SIN TOCAR CÓDIGO

**El «upsell simulado» en lineal ya existe.** `puestosDeLaModalidad("lineal")`
devuelve `["unico","upsell"]` y la etapa está encendida (`upsell.enabled: true`).
Solo hay que **asignar un producto al puesto `upsell` de lineal** — en su
alineación está vacío. Es lo primero que debería probar.

**Y los cuadritos pueden más de lo que parece.** Su catálogo de acciones ya
incluye: mandar los datos de un método, mostrar los métodos, **mostrar la oferta
de 2 opciones** (`show_order_bump` — suelta la segunda intro), elegir
básico/full, elegir el segundo producto, el regalo y pasar a humano.

### EL MURO, MEDIDO EL 22/09

Son **dos tablas y una función**, todas en `src/lib/workflow/config.ts`:

1. **`puestosDeLaModalidad(modo)`** — decide qué puestos ofrece el editor.
   Lineal cae en el `return` final: `["unico","upsell"]`. **Por eso solo ve dos.**
2. **`CONTENIDO_DEL_PUESTO`** — dice qué puesto ocupa el hueco 1 y cuál el 2.
   `lineal: { unico: 1 }`: **lineal no tiene hueco 2**. Aunque asignara un
   segundo producto, su contenido, su galería y su precio no los leería nadie —
   la trampa de siempre de este proyecto.
3. **`getActiveTwoTierOffer`** — de ahí salen los precios de las dos opciones, el
   reconocimiento de cuál eligió el cliente y contra cuál se valida el
   comprobante. **Empieza preguntando qué modalidad es** y devuelve vacío en
   lineal.

### DÓNDE ESTÁ EL TRABAJO DE VERDAD (y el riesgo)

Las tres piezas son pequeñas. El barrido no. Contado el 22/09:

```
isOrderBumpActive()     22 sitios
isDobleOfertaActive()   26 sitios
activeModalityKey()     32 sitios
```

En cada uno hay que decidir si significa **«¿es esta modalidad?»** o **«¿hay dos
opciones?»**. Los del segundo grupo cambian; los demás se quedan. Ahí es donde se
rompen cosas sin avisar.

### LO QUE NO ENTRA CON ESTO, Y HAY QUE DECÍRSELO

- **3, 4, N productos: no.** El sistema está hecho para dos opciones + un upsell.
  «Elegir producto» en el editor es solo una etiqueta que se traduce a
  básico/full/upsell; no existe «este producto de mi biblioteca».
- **La cola infinita de upsells: no.** Hay UNA etapa (`upsell_state`:
  ofrecido/aceptado/pagado), no una cola.
- **La entrega sigue yendo por puesto**, no por la ficha del producto elegido.

### EL ORDEN PROPUESTO, NO CONFIRMADO POR ÉL

1. Asignar un producto al puesto `upsell` de lineal y probarlo. Cero código.
2. La casilla «esta modalidad vende dos opciones» —lo que ya había dictado el
   21/09— y medir qué se cae de esos 80 sitios con su contenido real.
3. Los puestos y el hueco 2 en el editor, que es lo que le deja repartir.
4. **Las otras modalidades se quedan.** Quitarlas son 255 menciones en 11
   archivos (medido por él el 21/09) y apagadas no molestan.

Ver [[plan-segunda-opcion-en-cualquier-modalidad]]: esto es la versión ampliada
de aquello, y coinciden en el muro.

---

## 0. LO ÚLTIMO QUE DICTÓ — 21 de septiembre de 2026

> **DISEÑO DICTADO, NO MEDIDO, NO EMPEZADO.** Aquí NO hay diagnóstico: hay lo que
> él quiere. Antes de proponer una sola línea hay que medir (ver BANCO en
> `CLAUDE.md`). El escalón que nadie ha medido: **por qué en lineal el motor
> suelta el turno y lo contesta el modelo** cuando el cliente dice que quiere
> pagar o nombra un método.

### CUÁNDO SE SUELTAN LOS DATOS DE PAGO, MODALIDAD POR MODALIDAD

Su frase que lo resume:

> «Todas las modalidades no tienen la misma elección. El método de pago es la
> primera elección en OB, pero se puede ignorar en lineal, y en el caso de dou,
> con tan solo elegir cuál de los 2 desea ya se puede enviar "sin preguntar" el
> método.»

| Modalidad | Qué hay que saber antes de soltar los datos | Qué sobra |
|---|---|---|
| **lineal** | Nada. Un solo producto | **La pregunta del método.** Es pérdida de tiempo |
| **-DOU-** | **Cuál de los dos productos** | La pregunta del método |
| **-OB-** | Que acceda a comprar **y** el método —eso destapa la intro del order bump—; después elige producto | Nada: aquí el método SÍ es la primera elección |

**lineal.** Lo que YA le gusta y no se toca: tras la intro, si preguntan precio se
da el precio, si preguntan info se da la info, y el bot **siempre cierra
preguntando** («¿te gustaría que te indique cómo pagar?», «¿deseas que te ayude
con el método?», «¿deseas que te indique cómo adquirirlo?»). Sus palabras:
*«algunas de esas palabras ya están definidas y el bot las dice, y eso me gusta»*.

Lo que sobra: si el cliente dice que sí, hoy el bot contesta *«genial, puedes
elegir el método entre estas opciones»* y le hace elegir. Sus palabras:

> «Si cliente dijese sí, ya no es necesario preguntar el método de pago, ya que es
> un solo producto y se puede enviar los datos de pago. […] en lineal es pérdida
> de tiempo.»

Los datos salen **cuando decide pagar** O **cuando elige método**. No los dos en
fila.

**-DOU-.** Hay dos precios, así que falta una elección — pero **de PRODUCTO, no de
método**: *«en el caso de dou veo que no se está pidiendo método de pago, sino
elección de producto»*.

Y **descartó la versión “todo junto”** (una burbuja con los métodos y los dos
precios a la vez):

> «Es demasiada información en un solo texto, es como decir: mira aquí están los
> métodos de pago, tú decide cuál y aquí está la cuenta. Suena un poco a
> desinterés por el cliente.»

Lo que sí quiere:

> «Claro que sí, ¿me puedes confirmar cuál de los 2 te llama más la atención, el
> básico o el full? Si cliente dice full, se le envía directo los datos, así no
> hay pesadez al momento de enviar datos.»

(«básico 50 / full 60» los usó de EJEMPLO. No son sus precios.)

**-OB-.** No se toca: el método es la primera elección a propósito, porque es lo
que destapa la segunda intro con el producto oculto.

### LO QUE VIENE DE ANTES Y SIGUE EN PIE

- **Nada de palabritas.** *«No me gustan esas mierdas de palabritas.»* La
  afirmación se reconoce por la escena, no por una lista de «sí / ok / ya».
- **La pieza que reconoce la afirmación YA EXISTE:**
  `laPropuestaDelBotQueElClienteAfirmo` (`engine.ts`). Hoy se usa para saber qué
  producto eligió. Falta enchufarla.
- **Dónde iría su texto propio**, si quiere escribir él la frase: un **campo
  nuevo** en la pestaña **Pago**, NO dentro de las burbujas de pago que ya tiene.
  Motivo: **vacío = el bot se comporta como hoy**, sin interruptor que apagar.
  Propuesto, **no aprobado todavía**.

### LO QUE FALTA DECIDIR — preguntárselo, no inventarlo

1. **En lineal, con varios métodos configurados y sin elección del cliente: ¿qué
   datos se mandan?** Él dijo «se puede enviar los datos de pago» sin precisar
   cuál — y la versión «todo junto» es justo la que rechazó para -DOU-.
2. **Quién redacta la frase de -DOU-** («¿cuál de los 2 te llama más la
   atención?»): ¿la escribe él o la redacta el modelo?
3. **bioferta, doble_oferta_dos y upsell:** no los mencionó. No generalizar solo.

### EL MURO CONOCIDO

La elección de dos opciones sale toda de `getActiveTwoTierOffer` (`config.ts`), y
**empieza preguntando por la MODALIDAD**. Y los puestos viven en
`puestosDeLaModalidad`, escrito DOS veces —motor y editor—: las dos copias van
juntas o la pantalla ofrece un puesto que nadie reparte.

---

## 1. LO PRIMERO: lo que está a la espera de su prueba

**BOT ALBERTO 1 — se explica por escrito y al final se ofrecen las imágenes.**

**Ojo con la historia, porque ahorra días:** de esto hubo **cuatro diseños**. Los
tres primeros (`0f44cb0`, `80d0857`, `63d1ece` + `a990d2b`) intentaban que la
imagen **sustituyera** al texto y **ninguno funcionó** en su conversación real —
en el prompt las órdenes de contestar por escrito siempre ganaban. Están
revertidos o reescritos. **No se reintentan.**

**El que está vivo es el cuarto**, y es el que él pidió: contestar por escrito
como siempre y **cerrar ofreciendo** las imágenes; si acepta, **las manda el
motor**.

**Qué debe pasar:**

| Él escribe | Debe pasar |
|---|---|
| intención de saber qué contiene (con galería llena) | explicación **escrita** y al final una oferta de enseñar imágenes |
| responde «sí» a esa oferta | salen **todas** las muestras de esa etapa, en orden, con su burbuja de cierre |
| vuelve a preguntar por el contenido | solo texto, **sin volver a ofrecer** |
| galería vacía o sin checks | texto y **ninguna oferta** |
| «cuánto cuesta» / «cuándo me llega» | ninguna imagen, ninguna oferta |

**Qué mirar en el registro si algo no sale:**

| Línea | Qué significa |
|---|---|
| `[wf:oferta-imagenes]` | la regla SÍ le llegó al modelo, y el motor se lo apuntó |
| `media galeria por confirmacion (...) — lo apunto el motor` | el «sí» lo atendió el código: salieron todas |
| `— por el marcador del modelo` / `— por el texto de la oferta` | actuó uno de los dos respaldos |
| ninguna de las anteriores | la galería no tiene muestras pendientes para esa etapa |

**Si vuelve a salir UNA sola foto**, mire si en ese turno aparece `media galería
"<tema>"` (sin «por confirmacion»): ese es el camino de la foto suelta, que manda
una por diseño, y significa que el turno del «sí» llegó al modelo en vez de al
motor.

**La mitad que NO depende del modelo ya está probada ejecutando el código**
(`prueba-el-si-a-las-imagenes-ofrecidas.mjs`): el «sí» manda la galería aunque el
modelo redacte la oferta como le dé la gana. Lo que solo enseña la conversación
real es si el modelo ofrece.

**Y por qué NO hay un detector de palabras.** Él lo razonó: «el bot sabe
perfectamente descifrar cuándo una persona le está pidiendo información, y no se
confunde; ese criterio puede activar el envío de imágenes». **Si esto falla, la
salida NO es añadir palabras: es ajustar la instrucción o revertir.**

---

## 2. Cómo funciona el bot en las zonas que se tocaron

### 2.1 La elección de producto — quién la registra

Hay **tres puertas**, y en este orden:

1. **`awaiting_doble_oferta_dos_choice`** — el cliente aún elige.
   `detectTwoTierPick` lee sus palabras (nombres, alias, la lista propia del
   código y un comparador que tolera **una errata**).
2. **`payment_done` sin nada abonado** — ya eligió y cambia de idea.
   `inferTwoTierChoiceFromContext`, que es el **conservador**. Una prueba exige
   que aquí NO entre el detector amplio.
3. **El modelo**, con el marcador `<<ELIGE_PRODUCTO_1/2>>`.

**Y una cuarta lectura que se añadió esta semana, en las dos primeras puertas:**
`laPropuestaDelBotQueElClienteAfirmo`. La decisión puede estar repartida —la
propone el BOT y la afirma el CLIENTE con un «sí» pelado— y ninguna puerta miraba
las dos mitades. Detalles que importan:

- **Se decide por el PRECIO**, no por cómo redacte el modelo. El importe sale de
  la configuración; el modelo improvisa el texto.
- **Se lee el TURNO ENTERO del bot**, no la última burbuja: el motor parte cada
  respuesta en trozos («N chunks LLM») y el nombre y el precio suelen ir en el
  primero mientras la pregunta queda sola en el último.
- **Dos importes en el mismo turno = menú**, no oferta. Aunque sea el mismo número
  repetido.

### 2.2 Las muestras de imagen — dos caminos distintos

- **`<<MEDIA: topic>>`** — UNA imagen suelta, la elige el modelo de una lista.
- **`enviar_info_contenido`** — la SECUENCIA completa, en orden, con su cierre.
  Es la que manda «las dos imágenes».

**Ninguna se dispara sola: las llama el modelo.** El motor solo decide si le
enseña la galería, con `looksLikeProductContentTurn` / `looksLikeMediaTurn` (en
`openrouter.ts`). **Ese detector es MUY ancho** —incluye `llega`, `recibir`,
`adquirir`, `otro`, `combo`— así que sirve para enseñar la lista pero **NO sirve
como disparador de envío**: conectarlo directamente reproduce el fallo viejo de
«disparaba la imagen por cualquier palabra rara».

**Los frenos viven en el motor, no en el criterio del modelo:** una sola vez ·
nada si la galería está vacía o sin checks · nada después de la compra · el
producto oculto del order bump sigue oculto.

**El orden de salida** lo manda el PUESTO, no la caja: básico → complementario →
full. Se ordena con un rango escrito una sola vez y **sin nombrar modalidades**.

### 2.3 El reparto por puestos — por qué el YAML guardado engaña

`repartirPorEtiqueta` reescribe las cajas en cada carga, desde
`biblioteca_de_productos` + `alineacion_por_modalidad`. **Leer el archivo a ojo da
el valor de antes del reparto.**

```
lineal:              { unico: 1 }
upsell:              { unico: 1 }
order_bump:          { basico: 1, complementario: 2 }
doble_oferta_dos:    { full: 1,   basico: 2 }     <- el 1 es el CARO
doble_oferta_upsell: { full: 1,   basico: 2 }     <- el 1 es el CARO
bioferta:            { basico: 1, complementario: 2 }
```

| Hueco | Nombre | Contenido | Galería |
|---|---|---|---|
| 1 | `product_name` | `course_content` | `image_gallery` |
| 2 | `product_name_2` | `course_content_2` | `image_gallery_2` |
| — | | | `pack_gallery` ← el **full**, y solo cuando `full` no tiene hueco |

**La trampa de este proyecto son las cajas que nadie refresca.** Una caja que una
modalidad llena y otra no abre se ve igual que una caja vacía, y nadie avisa. Ha
pasado tres veces: `course_price_soles`, `image_gallery_2` y `pack_gallery`.

**La regla que sale de ahí:** una condición que nombra modalidades a mano es un
fallo esperando. Preguntar por el DATO, no por el nombre de la modalidad.

### 2.4 Los precios — mandan los del país

```
1º  modality_payment_profiles[modalidad][país]    <- manda
2º  la ficha del producto (biblioteca)            <- respaldo
3º  el global
```

En el editor, los tres importes de la ficha se editan **por país**, siguiendo la
bandera de arriba, y escriben en el mismo sitio que «Precios y pagos». Al escribir
en un país sin capa propia **se siembra el perfil entero**: guardar solo el precio
crearía una capa a medias y ese país perdería su cuenta, sus métodos y la
validación del comprobante.

---

## 3. La diferencia entre los dos proyectos que más ha costado

**BOT FRANKO no tiene biblioteca de productos ni alineación.** Sus cajas
`combo`/`basico` valen **0** y los precios de verdad viven **por país**, en
`modality_payment_profiles[modalidad][país]`, y se piden con
`getOrderBumpPriceSoles(opción, descuento, teléfono)`.

**Copiar código de ALBERTO a FRANKO sin eso deja la regla escrita y MUERTA:** lee
0 y no dispara nunca. Pasó, se detectó antes de subir, y por eso la versión de
FRANKO pide el precio por país.

**Y FRANKO vende en ARGENTINA, no en Perú.** Perú está apagado: cualquier prueba
sin `--pais=AR` deriva a humano y parece que el bot no contesta. Su método de
cobro es **transferencia**, no yape/plin — una guarda escrita solo para yape/plin
allí no protege nada.

---

## 4. Lo que se hizo, por commit

**BOT ALBERTO 1**

| Commit | Qué |
|---|---|
| `9f9d52c` | cada modalidad enseña sus muestras; «quiero saber» ≠ comprar |
| `f9254f3` | la regla de posición del «que» |
| `81f2338` | el dinero del extra, y la escalera de precios |
| `30fd65a` | la guarda vale para la etapa del extra entera |
| `a54d4c1` | «creo que el 1» elige la opción 1 |
| `3421d3a` | el «sí» a lo que el bot acaba de proponer |
| `4778ce8` | sin elección no salen datos de pago (el precio fantasma) |
| `d97d20c` | se lee el TURNO entero del bot, no la última burbuja |
| `81d9354` | los tres precios de la ficha siguen la bandera del país |
| `a806230` | las muestras salen en orden: básico primero, full al final |
| `0f44cb0` | **a la primera pregunta de contenido salen también las imágenes** ← a prueba |

**BOT FRANKO**

| Commit | Qué |
|---|---|
| `d0e453a` | el «sí» a la propuesta del bot; ningún método suelta datos sin elección |
| `88dc020` | nombrar el producto manda sobre un cuadrito ya contestado |
| `aa43b83` | la muestra de la segunda opción ya no depende de otra modalidad |

---

## 5. Trampas del entorno — leer antes de decir «está roto»

- **`spawn ffmpeg ENOENT`.** En esta máquina **no está instalado ffmpeg**, y un
  paso de media de la intro falla por eso. Sin intro terminada el motor
  **suprime toda entrada** («intro no terminó a tiempo, suprimo entrada») y
  ninguna conversación de prueba avanza: parece un bot mudo y no lo es. En el
  servidor del dueño las imágenes salen — sus registros lo demuestran.
- **La intro es larga y se para a preguntar.** Mandarle el «sí» antes de que
  pregunte lo tira: hay que esperar a que pause y contestar entonces.
- **Borrar `.next` con `npm run dev` corriendo deja el servidor inservible**
  (login 500). Se arregla reiniciándolo. Dos pruebas vivas dependen de
  `localhost:3000`.
- **El servidor de FRANKO se levantó en `localhost:3100`** para no chocar con el
  de ALBERTO.
- **Antes de diagnosticar, `git pull`:** él edita contenido desde el editor y eso
  llega como commits «editor: actualiza flujo». Más de un «se rompió» era su
  contenido cambiando entre dos corridas.

---

## 6. Pendientes abiertos

**De contenido (los arregla él, no son código):**

- **ALBERTO 1 · el combo de Perú no tiene precio en ninguna parte.** La ficha
  quedó en 0 y la capa de Perú tiene el básico en 10 y el combo en 0. Con eso, el
  comodín del precio del combo sale **en blanco** — el bot no inventa precios. Es
  exactamente lo que él vio como «los comodines no se representan en el
  simulador».
- **ALBERTO 1 · MX, GT, CO y BO** siguen sin precio propio.

**De código, medidos y no tocados:**

- **FRANKO · el modelo se autoelige producto.** Con un método que no es de su país
  («yape» en Argentina) emitió `<<ELIGE_PRODUCTO_2>>` y registró el básico sin que
  el cliente nombrara nada. Es del prompt.
- **FRANKO · el recorrido de -DOU- falla de forma intermitente** en dos
  comprobaciones; una ya fallaba antes de todo este trabajo.
- **ALBERTO 1 · dos rojos permanentes** en la batería
  (`prueba-acepto-el-extra-y-no-llego-nada`, `prueba-regalo-no-se-mete-en-medio`):
  afirman conducta que él cambió a propósito. No son regresiones.

---

## 7. Cómo se verifica aquí — el mínimo innegociable

```powershell
npx tsc --noEmit                      # limpio
Get-ChildItem scripts\prueba-*.mjs    # correrlas todas
npm run dev                           # y con el servidor arriba:
node scripts/recorrido-completo.mjs --modalidad=doble_oferta_upsell
```

- **ALBERTO 1:** 216 pruebas, 2 rojos conocidos.
- **FRANKO:** 175 pruebas, 0 rojos. Recorrido **con `--pais=AR`**.
- **Y la regla de oro:** antes de culpar a un cambio, quítalo y vuelve a correr.
  Esta semana tres «lo rompiste» resultaron ser el entorno o su contenido.
