# PLAN — UPSELLS EN FILA Y DOWNSELL

> Dictado por Alberto el 10 de octubre de 2026. **Todavía no hay código: esto es el diseño.**
>
> Su condición, que manda sobre todo lo demás:
>
> > «Lo que más me importa es NO TOCAR EL COMPORTAMIENTO, no arruinar el motor de
> > información, compra, venta, entrega, cobros… todo eso está como un reloj, hecho con una
> > ligereza que se puede romper con cualquier mala cosa que se haga.»
>
> Y cómo pidió que se pensara: «analiza bien todo para no tener que hacer mini parches…
> piensa como un usuario, imagina que luego lo vas a usar tú, y piensa: me falta esto, me
> falta lo otro».

---

## 1. QUÉ ES, CON SUS PALABRAS

**Upsells en fila.** El cliente compra el producto principal → se le ofrece el upsell 1 →
si lo compra, el upsell 2 → y así hasta el último que esté activo.

**La regla de parada:** «si yo tuviese 4 upsells y el cliente no quiere el primero o el
segundo, no se insiste más, sino ya vendría a presentarse el regalo».

**Downsell.** Solo en el **último** upsell activo. Si el cliente dice que no, o no contesta
en X minutos, se le ofrece **ese mismo producto a un precio menor**. «El downsell no invade
la lista de upsells, sino se aplica solo en el último.»

**Todo opcional.** «Los upsells y downsells serían una extensión que yo podría activar o
desactivar cuando yo desee, no es una regla escrita.» Con todo apagado, el bot vende
**exactamente como hoy**.

**Funciona sobre las tres semimodalidades** (COMO HOY, COMO DOU, COMO OB), igual que el
upsell de hoy, y **respetando la absorción** (modo reenganche).

---

## 2. LO QUE YA EXISTE — SE REUTILIZA, NO SE RECONSTRUYE

Auditado el 10/10/2026.

| Qué | Dónde | Sirve para |
|---|---|---|
| La máquina del upsell: esperando → ofrecido → aceptado → pagado / rechazado | `upsell_state` en `db.ts`, `presentarUpsell` en `engine.ts` | **Es la que se repite** para cada producto de la fila |
| La forma de un upsell: intro, pregunta con botones sí/no, «qué trae», galería, respuesta si dice no, recordatorio, esperas | `UpsellConfig` en `config.ts` | Cada producto de la fila se «viste» con esta misma forma |
| La puerta única «¿cuál es el upsell de esta conversación?» | `seccionUpsell` | Por ahí pasan ~70 lecturas del motor. Si devuelve el producto que toca, **el motor no se entera** |
| El cobro separado del primer producto y del upsell | `upsell_base_cents`, `upsell_paid_cents` en `payment.ts` | Se reutiliza; hay que volver a fijar la base en cada paso |
| La ficha del producto: nombre, alias, precio por país, descuento, entrega, galería, contenido | `ProductoDeLaBiblioteca` | Casi todo lo que necesita un upsell. **Solo le falta su presentación** |
| El aviso de «2 opciones» nunca sale después de la compra | `config.ts`, regla del 28/09 (prueba HPRU3) | Protege la fila contra la absorción |
| La guardia de la ventana de 24 h | `engine.ts`, en los seguimientos | Hay que comprobar que también cubra las ofertas de la fila |

**LA IDEA CENTRAL:** el motor sigue viendo **un solo upsell a la vez**. Lo único nuevo es que
`seccionUpsell` devuelve **el que toca ahora** a esa conversación (el de su puesto en la
fila), armado con la ficha del producto + su presentación. Todo lo demás —cobrar, validar,
entregar, el Cerebro, el recordatorio— sigue pasando por donde pasa hoy.

---

## 3. LO QUE CONFIGURA EL DUEÑO

### 3.1 El upsell de hoy queda como el **upsell 1**, sin tocarlo

No se migra nada. El upsell que ya tiene escrito sigue exactamente donde está. La fila
añade **detrás** los upsells 2, 3, 4… Así lo que hoy vende no se mueve de sitio.

### 3.2 En la ficha de cada producto, su «Presentación como upsell»

Lo que hoy tiene el upsell, pero dentro de la ficha del producto:

- **Su intro** (cajones de burbujas, como la intro del upsell).
- **La pregunta del final con botones**: «¿Lo quieres?» [Sí, lo quiero] [No, gracias]. El
  botón ya sabe a qué producto pertenece: no hay que enlazarlo a mano.
- **«Si pregunta qué trae»**: sus burbujas.
- **Lo que se le dice si dice que no.**
- **Su recordatorio**: una línea, una sola vez, si no contesta.

El precio, la entrega, la galería y el contenido **ya están en la ficha**: no se repiten.

La presentación **se guarda aunque el producto no esté en ninguna fila**, para usarla el
día que se quiera.

### 3.3 La lista «Upsells en fila»

```
Upsells en fila                      🏪 Tienda: LECTO ▾  [ encendido ]
   1. (el upsell de hoy)                                 ← fijo, el de siempre
   2. Cómo controlar las emociones en niños   ▾  a los [ 5 ] min   [on]
   3. Lecto Escritura nivel 2                 ▾  a los [ 10 ] min  [on]
   4. Cuaderno de trazos                      ▾  a los [ 5 ] min   [off]
   + Agregar producto
```

«A los N min» = minutos después de la entrega anterior. Cada producto con los suyos.

- Cada fila con su interruptor: apagar uno lo **salta**, sin borrarlo.
- **Por tienda**: cada tienda vende productos distintos, así que cada tienda tiene su fila.
  Sin tienda (o tienda sin fila), la general.

### 3.4 El downsell

```
Downsell del último upsell activo                       [ encendido ]
   Precio de downsell por país:   🇵🇪 S/ 15 (−40 %)   🇪🇨 $ 4 (−33 %)   …
                                  ↑ el % se calcula solo, solo para mirar
   Si dice que no:                se ofrece enseguida
   Si no contesta en:             [ 30 ] minutos
   Su mensaje:  «Entiendo. Como ya eres cliente, te lo dejo a {{PRECIO_DOWNSELL}}…»
                [Sí, lo quiero]  [No, gracias]
```

- Se aplica al último upsell **encendido**, sea cual sea. Si mañana apaga el 4, el downsell
  pasa solo al 3.
- **Una sola vez.** Si tampoco lo compra, sale el regalo.

### 3.5 Los avisos sutiles

En la línea pequeña ámbar de siempre:

- Un producto de la fila **sin presentación** → «no se ofrecerá».
- **Sin entrega** → «no se ofrecerá: el cliente pagaría y no recibiría nada».
- **Sin precio en un país donde vendes** → «en ese país se salta».
- **Downsell sin precio** en un país, o con precio **igual o mayor** que el normal.

Un upsell que no está completo **se salta solo**, nunca se ofrece a medias. Es la misma regla
que hoy tiene el upsell (`isUpsellUsable`).

### 3.6 Modo esencial

La fila y el downsell **sí se ven** en el esencial: son de vender, no de configurar el motor.

---

## 4. LO QUE VIVE EL CLIENTE — CADA CASO

| El cliente… | Lo que pasa |
|---|---|
| Compra el principal | Entrega → espera los minutos → presentación del upsell 1 (como hoy) |
| Dice «sí» al upsell N | Métodos de pago → paga → se valida **con el precio del N** → entrega del N → espera → presentación del N+1 |
| Dice «no» a un upsell que no es el último | Su respuesta de rechazo → **regalo**. No se insiste más |
| Dice «no» al último, con downsell encendido | Mensaje del downsell con el precio menor |
| No contesta al último en X minutos, con downsell | Igual: mensaje del downsell |
| No contesta a uno que no es el último | Su recordatorio (una vez) → si sigue sin contestar, regalo, como hoy |
| Dice «no» al downsell, o no contesta | Regalo |
| Pregunta «¿qué trae?» durante una oferta | Las burbujas «qué trae» **de ese producto** |
| Pregunta el precio | El precio **de ese producto** (o del downsell, si es la oferta del downsell) |
| Cambia de método a mitad | Los datos del nuevo método **con el precio del producto que está comprando** |
| Pide «no me llegó» | Se reenvía **todo lo que compró**, no solo lo último. Y **no** se vuelve a ofrecer lo que ya rechazó |
| Manda un comprobante de otro monto | Se valida contra el producto que está comprando, como hoy: si no cuadra, se le dice cuánto falta |
| Pasa de básico a full a mitad de la fila | Sigue siendo **cambio a full, no pago de upsell** (regla que ya existe; se fija con una prueba en cada puesto) |
| Escribe días después | Si pasaron más de 24 h, **no** se le manda una oferta fuera de la ventana de WhatsApp |
| Cae en horas de silencio | La oferta espera a la siguiente franja permitida, como los seguimientos |

---

## 5. LO QUE VE EL DUEÑO

- **El aviso de venta** de cada upsell, con su puesto: «🛒 VENTA EN FILA 2 de 4: Producto X,
  monto». El downsell, con su nombre: «⬇️ DOWNSELL: Producto X, monto».
- **El chat** dice qué productos compró ese cliente y en qué puesto de la fila va.
- **Meta (CAPI)**: una compra por cada venta, con su monto, igual que hoy el upsell.
- **El kanban / ROAS** cuenta el dinero de cada venta de la fila.

---

## 6. LAS SEMIMODALIDADES Y LA ABSORCIÓN

- La fila arranca **después de la compra**, y en esa zona el aviso de «2 opciones» ya no
  puede salir (regla del 28/09). Se fija con una prueba para cada puesto de la fila.
- Qué fila y qué productos le tocan a una conversación sale de la **misma puerta de hoy**
  (`seccionUpsell` → tienda y semimodalidad de la conversación). La fila no decide eso por su
  cuenta: lo hereda.
- Se mide con reenganche **encendido y apagado**, en COMO HOY, COMO DOU y COMO OB.

---

## 7. LOS CANDADOS — LO QUE PUEDE ROMPERSE SI SE HACE MAL

| Zona | Riesgo | Cómo se protege |
|---|---|---|
| El cobro | Un comprobante del 3 sumado al 2 | La base del cobro se vuelve a fijar al cargar cada producto; prueba por puesto |
| Cambio a full | Confundirlo con pagar un upsell | La regla de hoy, comprobada en cada puesto |
| El regalo | Salir a mitad de la fila o no salir | Sale solo al terminar la fila o al primer «no» |
| El reenvío | Reenviar solo lo último | Reenvía todo lo comprado |
| El recordatorio | Uno solo para toda la fila | Uno por producto |
| Ventana de 24 h | Ofertas que no llegan | Comprobar que la guardia cubre las ofertas de la fila |
| Horas de silencio | Ofertas a las 3 a. m. | Las ofertas programadas respetan las franjas |
| Conversaciones en curso el día del deploy | Cambiarles el comportamiento | Sin fila puesta, el puesto es 0 y todo sigue igual |
| El Cerebro | Que hable del producto equivocado | La sección del upsell se arma con el producto que toca |

**Lo que no se va a poder verificar sin conversaciones reales:** cómo redacta el Cerebro en el
upsell 3 o 4, y el cliente que paga dos productos con un solo comprobante (en la primera
versión se trata como pago del que está comprando; el sobrante se avisa al administrador).

---

## 7-bis. «NO DEBE HABER MANERA DE EQUIVOCARSE» — SU ORDEN DEL 10/10/2026

> «No debe haber manera de equivocarse, no sea que el bot recuerde un producto que ya vendió,
> o no se vaya a confundir quizás con el upgrade. Hasta ahora no he visto a nadie hacer
> upgrade, en 1000 personas que compraron.»

1. **Nunca se ofrece un producto que ese cliente ya compró.** La conversación lleva la lista
   de lo pagado y la fila se salta lo que esté en ella. Cubre también el error de poner en la
   fila el mismo producto que el principal, o repetir uno.
2. **El cobro de cada upsell va por separado:** al cargar cada producto se vuelve a fijar la
   base desde la que se cuenta lo pagado por él.
3. **El upgrade no se toca.** Casi nadie lo usa, así que no se inventa nada para él: se
   conserva la regla de hoy y una prueba la comprueba en cada puesto de la fila.

---

## 8. LO QUE QUEDA FUERA DE LA PRIMERA VERSIÓN, Y SE DICE

- Downsell en medio de la fila (él pidió que no).
- Una fila distinta por país (la fila es por tienda; un país sin precio salta ese producto).
- Pagar dos upsells juntos con un solo comprobante.

---

## 9. LAS FASES

1. **Medir.** La venta completa (`recorrido-completo.mjs`) en COMO HOY, COMO DOU y COMO OB,
   con reenganche encendido y apagado, con comprobante. Se guarda el resultado: es el
   «antes». No se toca nada.
2. **Pantalla.** La presentación en la ficha, la lista «Upsells en fila», el downsell y los
   avisos. Se guarda pero el bot no lo usa. Riesgo cero para la venta.
3. **Motor**, en su propio commit:
   - con la fila vacía, la venta completa tiene que salir **idéntica** al «antes»;
   - pruebas nuevas: acepta 1 y rechaza 2; acepta todos; downsell por «no» y por silencio;
     cambia de método a mitad; monto equivocado; full a mitad; reenvío a mitad; 24 h.
   - Antes de empezar esta fase se le consulta a él, con el «antes» en la mano.
4. **Encender en una sola tienda**, mirar ventas reales, y después en las demás.

Si algo falla se revierte **solo el commit** de esa fase.

---

## 9-bis. FASE 1 HECHA — EL «ANTES» (10/10/2026)

Medido con `recorrido-completo.mjs` + comprobante real, contra su contenido de hoy (reenganche
encendido, upsell encendido). **Sin tocar una línea del bot.**

| Tienda | Semimodalidad | Comprobante | Resultado |
|---|---|---|---|
| GRAFISMO FONÉTICO (`tienda_mupk9ybz`) | COMO DOU, se queda en básico | Yape Melissa S/ 10 | **24 de 25** |
| LECTO ESCRITURA (`tienda_muq67lks`) | COMO HOY | Yape Alberto S/ 11 | **19 de 20** |

```
node scripts/recorrido-completo.mjs --tienda=tienda_mupk9ybz --quedarse=basico --metodo=yape --comprobante="…\YAPEO MELISSA 10 SOLES C.jpg"
node scripts/recorrido-completo.mjs --tienda=tienda_muq67lks --metodo=yape --comprobante="…\YAPEO ALBERTO 11 soles b.jpg"
```

Los dos llegan a: pago aprobado → upsell ofrecido → pregunta qué es → lo acepta → datos para
pagarlo. **La única roja, la misma en las dos:** «y cierra con una pregunta» — cuando el
cliente pregunta qué es el extra, el Cerebro contesta bien pero no remata con una pregunta. Es
redacción del modelo, no del motor. **Queda como parte del «antes»: no se persigue aquí.** Si
después del cambio sale verde o roja, da igual; lo que no puede pasar es que se ponga roja
otra cosa.

**Lo que este «antes» no cubre:** pagar el upsell con un segundo comprobante, su entrega y el
regalo. El recorrido usa un solo comprobante. Para la fase 3 hará falta que pueda mandar un
segundo (cambio en el script de prueba, no en el bot).

---

## 9-ter. FASE 2 HECHA — LA PANTALLA (10/10/2026)

- **Ficha del producto → «🛒 Presentación como upsell»** (`PresentacionComoUpsellDelProducto`):
  intro, pregunta final + texto de los dos botones, «si pregunta qué trae», «si dice que no»
  y recordatorio. Se guarda en `presentacion_upsell`, con los mismos nombres que `UpsellConfig`.
- **Menú Upsell → «Upsells en fila»** (`FilasDeUpsell`), debajo del upsell de hoy: cajones con
  la **pastilla de tienda en la fachada**, puesto 1 fijo (el de hoy), productos con sus
  minutos, ↑↓, encendido y papelera; el **downsell** con precio por país, el **% calculado
  solo** (no se guarda), espera y su mensaje; y los **avisos** en ámbar.
- **El guardado** (`/api/workflow`): una sola lista de campos para leer y escribir
  (`limpiaPresentacionUpsell`, `limpiaFilasDeUpsell`), con las burbujas traducidas en las dos
  direcciones, como la entrega.
- **El motor no lee nada de esto.** Lo vigila `prueba-upsells-en-fila-fase-2.mjs`: si un
  archivo del motor nombra los campos nuevos, se pone roja.

**Probado:** banco con las funciones reales del guardado (13 de 13: ida y vuelta sin perder
nada). **No se probó guardando de verdad**: el guardado del editor publica en su GitHub, y una
prueba habría ensuciado su contenido real.

---

## 9-quater. FASE 3 HECHA — EL MOTOR (10/10/2026)

**Cómo funciona.** El motor sigue viendo un solo upsell a la vez. `seccionUpsell` sabe de qué
conversación es el turno (`conLaFilaDe`) y, si esa conversación va por un producto de la fila
o por su downsell, lo devuelve «vestido» de upsell: ficha + presentación. Ofrecer, cobrar,
validar, entregar, el Cerebro y el recordatorio pasan por donde pasaban.

| Regla dictada | Dónde vive |
|---|---|
| El upsell de hoy es el 1 y no se toca | `seccionUpsellDeSiempre` |
| Cada producto con sus minutos | `retraso_minutos` del vestido |
| Al pagar, el siguiente | `prepararElSiguienteDeLaFila`, al terminar la entrega (`continuarTrasEntrega`) |
| Al primer «no» o silencio, regalo y nada más | `upsell_fila_parada` (rechazo y plazo vencido) |
| Nunca lo ya comprado, ni el principal, ni repetidos, ni lo que quedó atrás | `siguienteDeLaFila` |
| Producto a medias (sin presentación, entrega o precio en SU país) se salta | `sePuedeOfrecerDeLaFila` |
| Downsell solo en el último, una vez, más barato, por «no» o por silencio | `elDownsellQueToca`, `segundosDelPlazoDeLaOferta` |
| Cada venta cobrada aparte, con su precio | `moverLaFila` limpia estado, precio congelado y cuenta |
| Reenvío: todo lo comprado | `entregasDeLoCompradoEnLaFila` + `fila_producto` en cada burbuja |
| Aviso de venta con su nombre | «VENTA EN FILA» / «DOWNSELL» |
| Correo | con producto de la fila no se manda la plantilla del upsell 1 (llevaría otro acceso) |
| Quien ya llegó al regalo no reabre la fila al pedir un reenvío | `prepararElSiguienteDeLaFila` |

Cinco columnas nuevas en `conversations`, vacías por defecto: sin fila puesta, el bot no las
lee ni las escribe.

**Probado:**
- `prueba-upsells-en-fila-fase-3.mjs` (nueva): banco con el `config.ts` real — sin fila, el
  upsell es el MISMO objeto de siempre y no se lee la base; qué producto toca y cuáles se
  saltan; pasar al siguiente; parada; regalo; downsell (último, una vez, más barato, su
  plazo); tienda; producto borrado; reenvío de todo lo comprado.
- Las 310 pruebas: solo las 7 rojas de siempre. 40 dobles de la base de datos ganaron una
  línea (las funciones nuevas, en «sin fila»); dos pruebas ajustadas conservando su intención.
- Venta completa, sin fila, con los comprobantes del «antes»: **GRAFISMO idéntico al antes**
  (misma roja de redacción); **LECTO 20/20** (la roja de redacción esta vez salió verde).
- `tsc` y `npm run build` limpios, con `.next` borrado.

**La matriz que pedía la sección 6, completada el mismo día** (él lo detectó: «¿probaste
como ob?» — se me había pasado). COMO OB no existe en ninguna tienda, así que se corrió en
dos COPIAS aisladas del proyecto (worktrees en el scratchpad, borradas después), una con el
código de antes de la fase 3 (`8c74bbe`) y otra con el de ahora (`c6f4dae`), cambiando en la
copia solo la semimodalidad de GRAFISMO y el reenganche. Su contenido real y su GitHub no se
tocaron. Cada par se comparó línea por línea:

| Caso | Antes | Ahora | Diferencias |
|---|---|---|---|
| COMO DOU, reenganche encendido | 22 + 1 roja | 22 + 1 roja | 0 |
| COMO HOY, reenganche encendido | 19 + 1 roja | 20 | solo la roja de redacción |
| COMO OB, reenganche encendido | 22 + 1 roja | 23 | solo la roja de redacción |
| COMO DOU, reenganche apagado | 23 | 23 | 0 |
| COMO HOY, reenganche apagado | 20 | 20 | 0 |
| COMO OB, reenganche apagado | 23 | 22 + 1 roja | solo la roja de redacción |

La única roja, en cualquier lado, es «y cierra con una pregunta»: la redacción del modelo, que
sale al azar en antes y en ahora. Que la copia COMO OB vendió como OB está en su registro:
«order bump (interceptando pago)» — el full se destapó al elegir método.

**No probado:**
- Una venta real CON fila de punta a punta (pagar el 2, el 3, el downsell): exige guardar
  una fila en su contenido y el guardado publica en su GitHub. Es la fase 4: encenderla en
  una sola tienda y mirar.
- En un reenvío de varios productos de la fila, `{{PRODUCTO_ENTREGADO}}` y el precio dentro
  de las entregas viejas salen con la oferta en curso.
- Las ofertas de la fila respetan las horas de silencio igual que el upsell de hoy: sin regla
  nueva.

---

## 9-quinquies. LA PRESENTACIÓN, CON LA FORMA DE CANALES → UPSELL (10/10/2026)

Él lo vio al revisar: en el upsell de siempre los botones son **opcionales** (casilla
«Preguntar con botones»), la intro va en **cajones** y cada canal puede llevar lo suyo. La
presentación de la ficha no: salían botones si había textos —una regla escondida— y la intro
era una lista suelta. Con sus palabras: «el estilo de la presentación de botones [de Canales]
es un ejemplo de cómo debe quedar, incluso en la previsualización y edición, y siempre hay que
representar bien los comodines en los visores».

Ahora, en Productos → la ficha → «🛒 Presentación como upsell»:
- **Pestañas WhatsApp / Messenger / Instagram.** WhatsApp es la principal; en los otros dos,
  cada campo en blanco usa el de WhatsApp (la regla de Canales). Motor:
  `presentacionEnEsteCanal`.
- **La intro en cajones** (`CajonesDeIntro`, el mismo de Canales), con peso y etiquetas. El
  motor los sortea como los del upsell de siempre. La lista vieja queda de respaldo.
- **Dentro de cada cajón, «Elección con botones»**: la pregunta, la casilla **«Preguntar con
  botones»**, los dos textos, lo que se dice si dice que no, y la vista previa con los botones
  colgando (`ButtonsPreview`), igual que en Canales.
- **Los comodines del visor dicen ESTE producto**: {{PRODUCTO_UPSELL}}, {{PRECIO_UPSELL}},
  {precio} y el «antes», con su precio en el país del visor (`preciosDelLlamanteMandan`). Sin
  precio en ese país sale el hueco, que es lo que hace el bot: lo salta.
- Una presentación guardada antes de la casilla sigue igual: botones si están los dos textos.

Probado: `prueba-upsells-en-fila-fase-3` (cajones, casilla, Messenger con lo suyo, Instagram
heredando, presentación de antes), banco del guardado con las funciones reales (10 de 10: ida,
vuelta e ida otra vez idénticas; la casilla en «no» se guarda; un canal vacío no se escribe),
las 310 pruebas (solo las 7 rojas de siempre), build limpio, y la venta completa en las dos
tiendas sin fila. **No visto en el navegador**: lo mira él.

---

## 10. LO QUE ÉL DECIDIÓ

1. **La fila es por tienda.** Y la tienda se elige **en la fachada** del pop up, con la misma
   pastilla de tienda que ya llevan los cajones de intro y seguimientos — no en otro menú.
2. **El precio del downsell es fijo por país**, y lo pone él. El **porcentaje de descuento se
   calcula solo y se muestra** al lado, como referencia («−40 %»); no se guarda ni decide nada.
3. **Los minutos: cada producto con los suyos.** Cada fila de la lista lleva su campo
   «se ofrece a los [ N ] minutos de la entrega anterior». Es el mismo dato que hoy tiene el
   upsell (`retraso_minutos`), así que la máquina ya sabe esperar.
