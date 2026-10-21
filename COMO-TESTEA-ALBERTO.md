# CÓMO TESTEA ALBERTO

> Dictado por él el 3 de octubre de 2026, con sus palabras. **Esto no es una propuesta: es
> el método con el que ha validado el bot durante meses.** Cualquier batería automática que
> se escriba tiene que reproducir ESTO, no una venta de corrido.
>
> Su frase que lo resume: «recuerda que no se compra solo de corrido, hay variantes».

---

## LA FORMA: VENTANAS EN PARALELO, UNA POR TIEMPO

Siempre **varias conversaciones a la vez**, y en cada una escribe **algo distinto**, para ver
qué contesta el bot ante entradas diferentes en el mismo punto del recorrido.

**TRES EN LAS PURAS, CUATRO EN LAS TRANSICIONES.** Lo corrigió él el 6/10/2026: en las
pruebas de transición hace una cuarta ventana, y no es un extra — es la única que mide
**comprar sin pulsar el botón**. Las otras tres llegan a la compra por el botón del
seguimiento 2, así que sin la cuarta quedaba sin probar el camino hablado.

> «Yo decía "precio", en otra decía "qué contiene", en otra "no entiendo", "cómo me llega",
> etc. Entonces así iba viendo qué respondía y me llevaba a la compra.»

**Lo que él probó de verdad: solo PERÚ.** Lo que falta y quiere: las mismas 3 ventanas **por
país** (Perú, Argentina, Ecuador) y **por tienda** (grafismo y lectoescritura).

**POR QUÉ 3 Y NO 9.** Medido el 3/10/2026: el obrero manda UNA burbuja por conversación cada
2 segundos. Con 9 abiertas no falla, pero las burbujas se estiran y los seguimientos salen
tarde — y entonces no se distingue un fallo de una congestión. Con 3 los resultados además
son comparables con los que él ya tiene. Una tanda de 9 solo tiene sentido para probar
expresamente que las conversaciones no se mezclan.

---

## PRUEBA 1 — LINEAL PURO

- 3 ventanas, conversación con variantes hasta la compra.
- **No hay cambio de producto** (solo hay uno), **sí cambio de método de pago**.
- Al final: **compra el upsell** y **pide el regalo**.

---

## PRUEBA 2 — TRANSICIÓN DE «COMO HOY» A «COMO -DOU-»

Lo más fino que hace, y lo que más hay que respetar. Arranca las 3 en **lineal** y las lleva
a **tres tiempos distintos a propósito**:

| Ventana | Hasta dónde la deja llegar | Cómo lo consigue |
|---|---|---|
| 1 | **Sin seguimientos**, pero **con el precio ya pedido y los datos de pago recibidos** | Mete relleno cada poco: «ya vengo», «voy a cambiar el dinero», «voy a ver si tengo plata» |
| 2 | **Hasta el seguimiento 1** | Conversa algo para que no salte el 2 |
| 3 | **Hasta el seguimiento 2** | La deja correr |
| 4 | **Hasta el seguimiento 2**, igual que la 3 | La deja correr, pero aquí **no pulsa el botón** |

**Cuando la ventana 3 ya recibió el seguimiento 2**, recién entonces cambia la tienda de
«como hoy» a **como -DOU-**. Y ahí mide cuatro cosas distintas:

- **Ventana 1** — manda el comprobante **sin decir nada más**, con el precio que le dieron
  ANTES del cambio. Pregunta: ¿el cambio de submodalidad le tumba la aprobación o el precio?
  **Resultado: entregó bien, respetando el precio prometido.**
- **Ventana 3** — pulsa **el botón del seguimiento 2**, que llegó siendo lineal. Pregunta:
  ¿respeta el precio de ESE botón, y no el nuevo? **Resultado: sí, y entregó correcto.**
- **Ventana 2** — espera a que salga **su** seguimiento 2, que ya nace de -DOU-. Y antes de
  pulsar nada **pregunta el precio**, para comparar lo que dice el bot con lo que hace el
  botón. **Resultado: información y botón decían lo mismo, enlace correcto, y el upsell
  después funcionó.**
- **Ventana 4** — arranca en «como hoy», pregunta el precio, deja llegar el seguimiento 1 y
  luego el 2, y **compra SIN pulsar el botón**. Pregunta: ¿respeta el precio por el camino
  hablado? Ésta es la que él añadió el 6/10/2026.

Y añade: **el cambio de elección hablado («ese no, mejor el otro») funcionaba perfecto** una
vez aparecidos los dos productos.

**POR QUÉ LAS CUATRO JUNTAS PRUEBAN LO QUE IMPORTA.** Cada una ataca el contrato por un lado
distinto: a quien ya tenía un precio, a quien tiene una burbuja vieja en pantalla, a quien
nace después del cambio, y a quien compra hablando. Si las cuatro respetan su precio,
**a nadie se le cambió por debajo** — que es la regla que este bot no puede romper.

---

## PRUEBA 3 — TRANSICIÓN DE «COMO HOY» A «COMO -OB-»

Los mismos cuatro tiempos que la prueba 2, y el cambio se hace **cuando la ventana 3 recibe
su seguimiento 2**. Lo que midió, actualizado con su recorrido del 6/10/2026:

- **Ventana 1** — ya había preguntado el precio y recibido los datos, y no se le deja llegar
  al seguimiento 1. Después del cambio **paga de frente**. Pregunta: ¿acepta el comprobante
  con el precio de antes? **Resultado: lo aceptó y entregó correcto.**
- **Ventana 3** — pulsa el botón del seguimiento 2, que llegó siendo lineal. **Resultado: le
  dio un precio y respetó ese precio. Todo OK.**
- **Ventana 2** — había llegado solo al seguimiento 1. Tras el cambio se la deja llegar al
  seguimiento 2, que ya sale de **-OB-**. Y ahí, en la última burbuja, **no pulsa el botón:
  pregunta «precio»**.

  **Y AQUÍ ESTÁ LA COMPROBACIÓN MÁS VALIOSA DE TODAS.** El bot le nombró **solo el producto
  1** y **NO le reveló el producto 2**: le preguntó si quería pagar, y **solo al decir que sí
  salió la intro de order bump**. Es la regla dura de -OB- —del producto oculto no se dice ni
  el precio ni el contenido hasta que decide pagar— respetada **en plena transición**, que es
  donde más fácil se rompería.

  Después se hizo el desentendido a propósito: «¿cómo que son 2?», «no entiendo», «¿ahora son
  2?». **Resultado: buenas respuestas, le explicó, le preguntó cuál quería, y al elegir le dio
  los datos y entregó correcto.**
- **Ventana 4** — como la 3: la deja llegar al seguimiento 2 y cambia a -OB-. Pero **no pulsa
  el botón**, sino que hace preguntas, y al decidir pagar **sale la intro de order bump**,
  elige producto y **entrega correcta**.

**Las cuatro, en los tres países. Resultado: todo bien.**

---

## PRUEBA 4 — «COMO -DOU-» Y «COMO -OB-» PUROS, SIN TRANSICIÓN

Las mismas 3 ventanas por país, con las mismas variantes, pero arrancando ya en esa
submodalidad. **Y comprando en tres momentos distintos a propósito:** una antes del
seguimiento 1, otra en el seguimiento 1, y otra en el seguimiento 2 —en la etapa de oferta—,
para que el precio de cada etapa quede probado.

---

## REGISTRO — LO QUE QUEDÓ PROBADO EL 6 DE OCTUBRE DE 2026

Él lo corrió entero, en la tienda **GRAFISMO FONETICO**, y lo contó al terminar. Queda aquí
para que mañana nadie se pregunte si esto estaba cubierto.

| Lo que corrió | Ventanas | Países | Resultado |
|---|---|---|---|
| COMO HOY puro | 3, comprando en tres momentos | los 3 | bien |
| COMO -DOU- puro | 3, comprando en tres momentos | los 3 | bien |
| COMO -OB- puro | 3, comprando en tres momentos | los 3 | bien |
| Transición COMO HOY → COMO -DOU- | 4 | los 3 | bien |
| Transición COMO HOY → COMO -OB- | 4 | los 3 | bien |

**LAS TRES COSAS QUE ESTO DEMUESTRA, y son las que importan:**

1. **A nadie se le cambió el precio por debajo.** Ni al que ya tenía los datos de pago, ni al
   que tenía una burbuja vieja en pantalla, ni al que nació después del cambio, ni al que
   compró hablando sin pulsar el botón.
2. **El producto oculto de -OB- siguió oculto**, incluso llegando a -OB- por transición y
   preguntando el precio a bocajarro.
3. **El upsell siguió vendiendo encima de la transición.**

**Lo que NO cubre este registro:** la tienda LECTO ESCRITURA. Todo esto es de GRAFISMO.

---

## REGISTRO — LECTO ESCRITURA Y LAS DOS TIENDAS A LA VEZ (6/10/2026, de madrugada)

Corrido mientras él dormía, con su autorización expresa: «testear todo lo que hice en la
tienda lectoescritura y 2 tiendas al mismo tiempo». **No se tocó una línea de código.** Su
`intro-data.yaml` se modificó solo para cambiar la submodalidad de LECTO y se devolvió
**byte a byte** — misma huella SHA256 (`F8AD5E01…`) y `git status` limpio.

### LO QUE SE CORRIÓ

**Nueve ventas completas de LECTO** — 3 submodalidades × 3 países — con sus comprobantes
reales, cada uno con el titular que le toca:

| | Perú (Alberto Salinas) | Ecuador (Carlos Quimi) | Argentina (Franko Robles) |
|---|---|---|---|
| **COMO HOY** | venta completa | **sin fallas** | venta completa |
| **COMO -DOU-** | **TODO OK** (con cambio de elección) | **sin fallas** | venta completa |
| **COMO -OB-** | **sin fallas** | **sin fallas** | venta completa |

En las nueve: comprobante aprobado, precio correcto, entrega y oferta del extra.

**Las dos tiendas a la vez**, mismo país y titulares distintos a propósito — si se mezclaran,
el comprobante se rechazaría por el nombre:

```
GRAFISMO   comprobante de Melissa 14   →  APROBADO S/. 14   entrega «ob_combo»
LECTO      comprobante de Alberto 11   →  APROBADO S/. 11   entrega «approved»
```

**No se mezclan.** Cada una con su precio, su titular y su camino de entrega, a la vez.

### HALLAZGO 1 — LECTO ENTREGA UN ENLACE DE RELLENO ⚠️ LO MÁS IMPORTANTE

Después de pagar, el cliente de LECTO recibe esto:

```
TE ENTREGO TU PRODUCTO BASICO **GRAFISMO TOCA EL ENLACE**
(aqui abajo debe decir lectoescritura) 😊👇️
---*LECTOESCRITURA*---
https://09op4243lj45j6345i6u3o4i56
```

Ese enlace **no existe**: es el de relleno que él dejó al preparar la ficha. Y el texto lleva
sus propias notas de trabajo, incluida la palabra GRAFISMO — tanto, que el modelo se
disculpó solo: «creo que hubo un error en mi mensaje anterior 😅».

**Si LECTO sale a vender así, el cliente paga y recibe un enlace muerto.** Es contenido suyo,
en `biblioteca_de_productos` → LECTOESCRITURA → `delivery`. No se tocó.

### HALLAZGO 2 — ARGENTINA REPITE SU FRASE DE ENTRADA AL REENVIAR LOS DATOS

Al volver a nombrar el mismo método, Argentina manda cuatro burbujas y repite su línea de
entrada —«Excelente!, Puedes realizar tu pago a través de los siguientes datos»—. Perú manda
tres y no repite nada.

**Por qué:** Argentina tiene una burbuja de entrada antes de los datos y Perú no. Al
reenviar sale la secuencia entera. Salió en las tres corridas de Argentina.

**Gravedad: poca.** No repite el producto ni el precio, solo la línea que anuncia los datos.
Si le molesta, se quita esa burbuja en el editor y queda como Perú.

### HALLAZGO 3 — EN ARGENTINA UN «SÍ» ELIGE; EN ECUADOR NO

Esperando que el cliente elija entre los dos productos:

```
Ecuador     «si»  →  sigue esperando, no manda nada        ✅
Argentina   «si»  →  elige y manda los datos de pago
```

**No es un fallo:** la intro de Argentina cierra **proponiendo** una opción, así que el «sí»
la elige — que es la regla del proyecto desde `3421d3a`. La de Ecuador no la propone. Y el
precio fue el correcto: aprobó los 12.500 del full.

Queda escrito porque al leer el registro parece que Argentina se salta la elección, y no.

### LO QUE NO SE PUDO PROBAR, Y HAY QUE DECIRLO

**Las transiciones con las cuatro ventanas.** El banco de pruebas no sabe frenar los
seguimientos hablando, ni pulsar el botón del seguimiento 2, ni cambiar la submodalidad a
mitad de una conversación viva. Eso sigue siendo trabajo suyo, o hay que construirlo.

### DETALLES DE LA CORRIDA

- Once corridas en total (nueve + dos repeticiones para confirmar fallas).
- **Gastó créditos suyos de OpenRouter:** el comprobante obliga a usar el modelo, y sin él no
  hay forma de validar una foto.
- La falla «y cierra con una pregunta» salió 2 veces de 11 y no se reprodujo al repetir: es
  el modelo redactando distinto, no una regresión. No perseguirla.
- Quedan **dos conversaciones de prueba sin borrar** (las últimas), conservadas a propósito
  para poder mirar qué entregó cada tienda. Se pueden borrar desde el panel.

---

## LO QUE HACE SIEMPRE, EN TODAS

**No se la pone fácil al bot.** Sus palabras:

> «su "qué contiene", "sí pero qué contiene", "ok pero no es estafa", cosas así, y siempre
> daba la talla.»

**La etapa upsell, haciéndose el desentendido:**

> «venía la etapa upsell y la compraba, me hacía el desentendido: "¿y esto qué es?", "¿no
> entiendo?" y por lo general el bot siempre daba la talla.»

**Y al final, SIEMPRE el reclamo:**

> «no me ha llegado el producto», «¿a qué hora me van a enviar?»

Y lo que espera: que insistiendo acabe entregando. Lo que obtuvo: a veces los enlaces de
frente, a veces indicaciones primero, pero **tras 3, 4 o 5 quejas siempre entregaba**. Eso
le gustó y es conducta a conservar.

---

## QUÉ SE PUEDE AUTOMATIZAR Y QUÉ NO

Medido el 3/10/2026.

**SE PUEDE, Y GRATIS** (motor, sin modelo). El simulador acepta país y tienda:

```
POST /api/test-simulator   →  { country: "PE" | "AR" | "EC", tienda: <id> }
```

Varias conversaciones en paralelo, intro, elección por botón, datos de pago, comprobante
(con capturas reales), entrega, compra del upsell, regalo, y el reclamo con su reenvío.
Lineal puro, -DOU- puro y -OB- puro.

**CUESTA SUS CRÉDITOS:** las variantes de conversación —«precio», «qué contiene», «no
entiendo», «sí pero no es estafa»—. Las contesta el modelo, y son el corazón de su método.
**No se gastan sin pedirle permiso.**

**NECESITA SU PERMISO APARTE:** las transiciones. Cambiar la submodalidad de la tienda a
mitad de la conversación obliga a **escribir en su configuración** por la misma puerta que
usa el editor. Eso es tocar su contenido — y es lo que una vez le vació contenido. No se
hace sin que él lo autorice expresamente.

**NO SE PUEDE SIMULAR:** la foto del comprobante. El bot LEE la imagen para sacar el monto,
así que hace falta una captura real en el disco. `--comprobante=<ruta>` en
`recorrido-completo.mjs`.

**TARDA DE VERDAD:** los seguimientos salen a los minutos que él configuró. La ventana que
espera al seguimiento 2 tarda varios minutos por vuelta.

---

## LO QUE VALIDA EL COMPROBANTE, Y HAY QUE RESPETAR

Medido el 3/10/2026, por país:

| | Titular que exige | ¿Pide fecha en el comprobante? |
|---|---|---|
| PERÚ | el configurado para PE | **SÍ** |
| ECUADOR | el configurado para EC | no |
| ARGENTINA | el configurado para AR | no |

Una captura con otro titular, o una de Perú sin fecha visible, **se rechaza con razón**. No
es un fallo del bot.
