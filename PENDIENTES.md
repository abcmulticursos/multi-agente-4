# Pendientes

Última actualización: **5 de septiembre de 2026**

Vale para los dos bots: **MULTIAGENTE 3** y **BOT FRANKO**. Son copias de la
misma plantilla, así que todo lo de aquí se hace en los dos.

---

## 1. Lo que tienes que llenar tú

Nada de esto lo puedo hacer yo: son datos tuyos. Es lo más urgente de la lista
porque afecta a ventas de hoy.

### 1.1 El producto UPSELL no tiene con qué mostrarse

En la pestaña **Upsell** están vacías las tres formas que tiene el bot de
contestar cuando le preguntan por el segundo producto:

- **Galería** — hay un elemento titulado «PAGINAS SECRETAS» pero **sin enlace**,
  y una foto sin enlace no sirve de nada
- **Burbujas de «qué trae»** (info_steps) — ninguna
- **Respuesta genérica** — vacía

**Qué pasa hoy:** le ofreces el segundo producto, el cliente pregunta *«¿qué
contiene?»* y el bot contesta con palabras del modelo y **sin ninguna foto**.

Antes era peor: mandaba la foto del producto que el cliente **ya había
comprado**, invitándolo a comprarlo otra vez. Eso ya está tapado (ver §5), pero
tapado significa que ahora se calla, no que tenga qué enseñar.

**Ojo:** esto **no** se arregla desde Canales. Canales lleva seis cosas —intro,
seguimientos, pago, entrega, entregas por modalidad y postventa— y **no lleva
galerías**. La galería, las burbujas de «qué trae» y la respuesta genérica solo
viven en la pestaña Upsell.

### 1.2 El nombre del producto UPSELL

Se llama literalmente «PRODUCTO UPSELL». Como el bot reconoce la aceptación por
el **nombre del producto**, un nombre de relleno reconoce mal.

### 1.3 Argentina tiene un solo método de pago lleno

En **Precios y pagos → Argentina** solo está `transferencia`. Mercado Pago y
Ualá están vacíos.

### 1.4 Basura en la capa de Order Bump de Ecuador

Hay un método llamado `transferenci` (sin la «a» final) y otro con el nombre en
blanco.

---

## 2. Lo siguiente que sigue: rediseñar el editor

El paso 1 (la cáscara nueva: menú lateral, pestañas agrupadas) ya está hecho.

### Paso 2 — «lista corta + pop up», empezando por Precios y pagos

Hoy, al abrir un país, se te vienen encima decenas de campos a la vez. La idea
es ver una **lista corta** —un renglón por país— y que al hacer clic se abra un
**pop up** con lo de ese país, al estilo de los que ya hicimos para los
cuadritos de decisión.

Orden acordado:

1. Precios y pagos
2. El resto de las secciones
3. El tema oscuro, al final

**Por qué esta primero:** es la que más tocas y la más amontonada. Y es de donde
salen los datos de los links de las decisiones: cuando un cuadrito dice
«Mandar los datos de un método de pago → Yape», el número de cuenta se lee de
ahí, no se escribe en el cuadrito.

---

## 3. El segundo producto extra (un upsell más)

**Estado: pendiente. Hay que hacer §3.1 antes que §3.2.**

Hoy el bot maneja **un** producto extra. No es que falte un campo: «el segundo
producto» está escrito en singular en toda la cadena —3 columnas en la base de
datos, los ids de los botones `upsell_si`/`upsell_no`, el cobro, la fuente de
entrega `upsell`, el bloque del cerebro y la pestaña del editor.

Agregarlo a mano en el YAML **no sirve**: el bloque sobreviviría al guardado
(las llaves que el editor no conoce no se borran) pero **nadie lo lee**.

### 3.1 Primero: cuadritos de decisión en la pregunta del upsell

Hoy la pregunta del upsell entiende **cuatro cosas**, todas fijas en el código:

1. El texto del botón «Sí»
2. El texto del botón «No»
3. El nombre del producto o un alias
4. Una lista de palabras escrita en el código, que no se puede tocar desde el
   editor (`si, claro, dale, ya, obvio, quiero, ok…` / `no, nel, paso, después…`)

Lo que no se puede hacer hoy: poner tus propias palabras, tener más de dos
respuestas, contestar con varias burbujas, enlazar una respuesta a una acción,
o apagar una respuesta sola.

**No es urgente** — nada está roto, lo que no encaja se lo lleva el modelo, que
sabe que hay un segundo producto en oferta. Es un límite, no una falla.

**Pero es requisito del segundo upsell.** Si la cadena se construye sobre el
sí/no fijo de ahora, todos los productos de la cadena compartirían las mismas
dos respuestas y las mismas palabras del código.

**Trabajo:** la maquinaria de «pausar y esperar la respuesta» ya existe, es la
de la intro. Hay que soltarla de la intro: hoy la marca de pausa
(`intro_paused_index`) apunta a la lista de burbujas de la intro y a ninguna
otra.

### 3.2 Después: la cadena de productos extra

- El extra deja de ser uno y pasa a ser una **lista**. Cada uno con lo suyo:
  nombre, intro, pregunta, precio por país, galería y **su propia entrega en
  Canales**
- Una columna nueva que diga **cuál** está en oferta ahora. Las tres que ya
  existen siguen sirviendo, referidas a ese
- La **cadena**: cuando el extra 1 se paga —o lo rechaza, o vence el plazo—
  arranca el extra 2 pasados sus minutos. El regalo se corre al final de la fila
- La pestaña Upsell pasa a ser una lista corta con un pop up por producto (encaja
  con §2)

**La parte difícil ya está resuelta:** el sistema cuenta cada venta por separado
—guarda una foto de lo pagado y mide lo que entra por encima— y eso funciona
igual para el tercero, el cuarto o el quinto.

**Decisión tuya antes de arrancar:** ¿el extra 2 se ofrece solo a quien compró
el extra 1, o también a quien dijo que no?

---

## 4. Cosas más chicas, aplazadas

| Qué | Estado |
|---|---|
| **Reducir la lista de comodines** (14 de precio → ~4). Esconder variantes y darles nombres que digan el producto de la modalidad activa: «Precio del Full», no «Precio opción 1». No se renombra ni se borra nada — riesgo cero | Acordado, sin fecha |
| **Que el saludo acepte cuadritos de decisión.** Hoy solo los aceptan las burbujas de la intro; del saludo solo se toma su texto | Pendiente |
| **Vista previa de comodines al pasar el mouse** | Aplazado hace tiempo |
| **Poner al día MULTI AGENTE 1 y 2.** Están muy atrás; se hace todo de una tanda cuando lo pidas | Esperando tu señal |
| **El lienzo visual del flujo** («pizarra», estilo n8n) | Aplazado hace tiempo |

---

## 5. Terminado hace poco (para no repetirlo)

- Un solo link **«Elegir producto»** con selector BÁSICO / FULL / **UPSELL** en
  los cuadritos de decisión — el UPSELL no existía antes
  (`scripts/prueba-elegir-producto.mjs`)
- La **pregunta del upsell** convertida en cajón de burbujas con su visor de
  WhatsApp. La última burbuja encendida es la pregunta, la que lleva los botones
  (`scripts/prueba-pregunta-del-upsell.mjs`)
- El bot ofrecía el segundo producto y **enseñaba la foto del primero**
  (`scripts/prueba-galeria-del-upsell.mjs`)
- El `MONTO_FALTANTE.000 ARS` que salía en vez del número
  (`scripts/prueba-dolar-en-comodines.mjs`)
- Títulos **fijos** BÁSICO / FULL / UPSELL en los cajones de entrega. Los
  títulos personalizables cruzados eran por qué llenaste el cajón equivocado
- Los cuadritos de decisión enteros: etiquetas, colores, palabras clave,
  interruptor, confirmación al borrar y links
  (`scripts/prueba-decisiones.mjs`)

---

## Reglas que no se tocan

- Nunca arruinar el comportamiento del bot. Es lo último que debe pasar
- Nada de meter el problema debajo de la alfombra
- Todo a la nube; no se trabaja en local
- **Nunca levantar el servidor local:** el `.env` tiene credenciales reales de
  Meta y el worker despacharía `scheduled_actions` pendientes a clientes de
  verdad
- Cada modalidad se sirve de lo suyo: ninguna presta contenido a otra (regla 5-bis)
- Auditar antes de corregir, aunque el arreglo ya funcione en el otro bot
- Compilar limpio (borrar `.next`) antes de subir
- Solo se tocan **MULTIAGENTE 3** y **BOT FRANKO**. Las carpetas
  `MULTI AGENTE 3 (sin cambios)` y `MULTIAGENTE 2 (sin cambios)` son respaldos
