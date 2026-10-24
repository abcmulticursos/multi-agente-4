# CLAUDE.md

> **ESTE ES EL ÚNICO ARCHIVO QUE MANDA EN ESTE PROYECTO.** Contiene las órdenes
> permanentes del dueño del bot (cómo se trabaja) y la descripción técnica
> (cómo está hecho). `AGENTS.md` queda como historial y **ya no manda**: su
> contenido vigente está aquí, y lo que decía sobre trabajar en `MULTI AGENTE 1`,
> `MULTI AGENTE 2` o `AGENTE-KPOP` está anulado.

---

# PARTE 1 — CÓMO SE TRABAJA AQUÍ (órdenes permanentes)

## Alcance

- Se trabaja **exclusivamente en `BOT ALBERTO 1`**. No se toca ningún otro
  repositorio por parecido de código: ni `BOT FRANKO`, ni `MULTI AGENTE 1/2/3`,
  ni `AGENTE-KPOP`, ni copias de respaldo. Un arreglo que funcione en otra
  carpeta no se trae sin auditar antes esta.
- `config/product-profiles/index.json` y todos los YAML dentro de
  `config/product-profiles/` son parte de la plantilla y deben versionarse. Un
  clon debe conservar cada perfil visible en el selector del editor, no solo el
  producto activo de `config/intro-data.yaml`.
- Antes del primer commit o push de un clon, comprobar que el índice y cada
  perfil comercial aparecen en `git ls-files`.

## Orden del dueño: cambios quirúrgicos, y revisar toda la tubería

Esto lo dictó Alberto el 2026-09-13, con sus palabras:

> «Si está funcionando, dejarla funcionar. Solo hacemos cambios quirúrgicos sin
> cambiar nada. Ha habido casos que Claude ha modificado cosas que jamás pedí, ha
> quitado tiempos de lectura del comprobante, ha agregado cosas que ni siquiera
> le había dicho y me malogró el bot; y cuando le pedí revertir, me revirtió
> hasta una etapa de problemas que ya se habían solucionado y los trajo
> nuevamente a la vida. El bot tiene funciones y cada regla que se puso es por
> algo. Es un bot de miles de dólares: no se puede corromper la funcionalidad
> corrigiendo algo y salpicando otra. Siempre hay que revisar en qué puede
> afectar esa corrección; no mirar la corrección como un tornillo en la
> maquinaria y el resto no mirarlo — hay que verificar toda la tubería.»

De ahí salen estas seis obligaciones, que mandan sobre cualquier costumbre:

- **Lo que funciona no se toca**, aunque se vea mejorable. Si aparece algo
  mejorable, se dice y decide él; no se arregla de paso mientras se hace otra
  cosa.
- **Nada que no haya pedido.** Ni un tiempo, ni una regla, ni una mejora de
  propina. Si el arreglo obliga a tocar algo más, se avisa ANTES y se espera.
- **Revertir también es quirúrgico.** `git revert` del commit exacto, o del
  archivo exacto, tras leerlo. Nunca volver a un punto anterior en el tiempo:
  eso resucita fallos ya muertos.
- **Cada regla está por algo.** Los comentarios de este repositorio cuentan el
  fallo real que las puso ahí. Si una regla estorba, averiguar para qué está
  antes de moverla.
- **En código antes que en prompt.** Un detector determinístico cuesta cero
  tokens y no falla distinto cada vez; una regla escrita en el prompt viaja en
  cada turno y depende de que el modelo obedezca. No todo se resuelve con prompt.
- **Sugerencias, sí; cambios por cuenta propia, no.** Alberto trabaja sobre el
  campo que conoce y pide propuestas de fuera de su burbuja. Se proponen, con lo
  que ahorran y lo que arriesgan, y elige él.

### Este archivo se actualiza: es la bitácora, no una lápida

Dictado por Alberto el 2026-09-16:

> «El CLAUDE.md es la bitácora de mi proyecto sin terminar. Lo que ves ahí tiene
> que actualizarse a lo que yo pido y logro. Si para lograr esto ves que hay que
> desobedecer a CLAUDE.md, dímelo, yo apruebo y lo registras, para que ese archivo
> no sea una piedra de tropiezo.»

**Cómo se hace, y en este orden:**

1. **Primero comprobar que estorba de verdad.** Casi siempre no estorba: estorba
   el plan. Pasó el 16/09 — se pidió permiso para saltarse «no quitar lo que
   estorba» y al medir el alcance apareció una solución **aditiva** que la regla
   ya permitía, y que además era mejor que la que se iba a hacer. La regla hizo su
   trabajo. **Pedir permiso antes de medir es pedirle que te abra una puerta que
   no hacía falta.**
2. **Si tras medirlo sigue estorbando, decírselo con tres frases:** qué regla,
   qué impide, y qué se propone en su lugar. Él aprueba o no.
3. **Aprobado, se escribe aquí en el mismo turno**, con el caso real que lo
   motivó. Una regla cambiada sin dejar escrito por qué vuelve a discutirse el mes
   siguiente.

**Lo que NO se salta nunca, aunque él lo apruebe en caliente:** correr la venta
de verdad antes de entregar, y no meter productos, precios ni marcas de pago en
el código. Lo primero es lo único que demuestra que sigue vendiendo; lo segundo
rompe la plantilla para el siguiente producto.

**Y las reglas también se añaden.** Cuando algo se rompe por un hueco que este
archivo no cubría, se escribe el hueco — no solo el arreglo. Ver «el parche
palabra por palabra», que creció así.

### Obligación: proponer la solución mejor, y avisar cuando el cambio no sirve

Dictado por Alberto el 2026-09-13:

> «Yo trabajo según lo que veo y viví; tú tienes una visión más grande y conoces
> cosas y soluciones que yo ni me imagino, por mi falta de conocimiento. De ahora
> en adelante, si yo pido un cambio y tú tienes otra solución mejor, propónla. Si
> ves que el cambio va a ser inútil, dímelo. Es inaceptable no sugerir cuando
> tienes una solución mejor que no arruine el proyecto.»

Esto no contradice «nada que no haya pedido»: **se propone, y decide él.**
Callarse una solución mejor por obediencia es un fallo; implementarla sin permiso
es el otro. La obligación es hablar ANTES de editar, en tres frases: qué pidió,
qué se propone en su lugar, y qué gana y qué arriesga cada camino.

Y si el cambio pedido no va a resolver lo que él quiere resolver, **se dice antes
de hacerlo**, con el motivo. Un cambio inútil no es inofensivo: se queda en el
archivo como una regla más que alguien tendrá que interpretar mañana, y puede
chocar con otra que sí servía.

#### El parche palabra por palabra: el ejemplo que no se repite

Con sus palabras, el caso real:

> «En otra sesión le mostré una conversación del bot, y como vio que el bot se
> equivocaba en "una palabra que causaba el problema", empezó a agregar esa
> palabrita como solución. Al final hice otra prueba con otra palabra, y después
> solucionó agregando otra palabra, y así parchando y parchando —con todo el
> amplio conocimiento que tiene— haciendo esas cosas.»

El cliente no escribe la palabra del ejemplo: escribe la suya. Una lista de
palabras solo cubre la conversación que ya pasó, cada prueba nueva destapa otro
sinónimo, la lista crece sin freno y al final nadie sabe por qué está cada
término.

**La señal de alarma:** si la corrección propuesta es «añadir este término a la
lista», el diagnóstico todavía no está hecho. Antes de escribirla hay que
contestar qué CLASE de mensaje es ese —una confirmación, un acuse de recibo, una
objeción, una pregunta sin signos— y qué distingue a esa clase por estructura:
qué preguntó el bot justo antes, en qué etapa está la conversación, qué datos ya
recibió el cliente, si quedó una pregunta abierta. Eso sí cubre los sinónimos que
nunca se probaron.

Una lista de palabras vale solo como **desempate dentro de una regla
estructural** —ya acotada por etapa y contexto—, nunca como la regla entera.

**Y vale igual para el texto que escribe el propio bot.**

Sus burbujas conversacionales **las redacta el modelo**, no están escritas en el
contenido: improvisa el cierre cada vez. Una lista de frases contra un texto
generado no tiene ninguna posibilidad.

**El caso que lo puso aquí.** 16 de septiembre de 2026, **-DOU-**, conversación
HELLO1. El bot cerró con «¿Te gustaría llevarte el COMBO? Solo son S/. 14 — dime
y te indico cómo adquirirlo», el cliente dijo «si», y la elección no se registró:
ninguna de las 17 frases de la lista de `laOpcionQueElBotPropuso` cazaba esa. Sin
elección registrada el motor suelta el turno, contestó el modelo, y dos mensajes
después el cliente tuvo que volver a elegir. La lista se había escrito el día
antes con esta justificación, que es falsa: «aquí sí vale, son las formas en que
cierra EL BOT, y el bot escribe siempre igual». El bot no escribe: escribe el
modelo.

**Lo que sí es estable del texto del bot** son los datos que salen de la
configuración: **los precios y los nombres de las opciones**. Por ahí se decide,
nunca por cómo redacte. Ya hay un sitio que lo hace así y lleva meses sin dar
problemas —`looksLikeDirectPriceAnswer` en `handler.ts`, que exige un importe con
moneda ADEMÁS de la frase de venta—: ese es el patrón a copiar.

**Anotado como sospechoso, sin tocarlo:** `assistantOfferedVisualSample`
(`engine.ts`) decide con lista de palabras sobre el texto del modelo. Queda
señalado por si algún día falla; no se cambia mientras no dé problemas.

#### Cómo escribe la gente de verdad: ni signos, ni tildes, ni comas

Dictado por Alberto el 2026-09-14:

> «Las personas nunca ponen signos, ni comas: "¿qué contiene?", "¿por qué?" —
> jamás. Y con "por que" o "porque" no saben ni por qué lo mandan separado o
> junto.»

**Ningún detector puede apoyarse en la ortografía del cliente.** Lo que NO llega
nunca en un WhatsApp real:

- **Los signos `¿` y `?`.** Una regla que exige el signo para decidir está
  apagada en la práctica: solo se dispara con el cliente que no existe.
- **Las tildes.** Y como el motor normaliza quitándolas, `qué` (pregunta) y `que`
  (relleno) llegan al regex como la MISMA palabra. Lo mismo pasa con `cómo`/`como`
  y `cuánto`/`cuanto`.
- **Las comas.** No hay forma de cortar la frase en cláusulas por puntuación.
- **La separación de `porque`.** El mismo cliente escribe `porque`, `por que`,
  `porq` o `xq` para lo mismo, y no distingue el causal del interrogativo. Un
  detector que trate `por que` (separado) distinto de `porque` (junto) hace que
  la venta dependa de si el cliente pulsó la barra espaciadora.

**La consecuencia práctica:** si la única señal que separa dos significados es un
signo, una tilde o un espacio, **esa señal no existe**. Hay que decidir por
estructura: dónde cae la palabra en la frase, qué preguntó el bot justo antes, en
qué etapa está la conversación, qué datos ya recibió el cliente.

**El caso real que lo puso aquí.** El 13 de septiembre de 2026, dos pruebas en
paralelo de **-OB-**: «el combo esta bien» registró la elección y cobró el precio
del combo; «creo que el combo» no la registró —el ` que ` de relleno se leyó como
pregunta— y el cliente vio el precio del combo escrito por el modelo y el del
básico en los datos de pago. Dos precios en la misma ráfaga. La única diferencia
entre las dos pruebas era esa palabra.

### El bot es un reloj que funciona: no se rediseña de paso

Con sus palabras:

> «Hemos tratado de hacer que el bot sea como un reloj que funciona. No está muy
> bien estructurado, pero al menos con lo que funciona me deja trabajar. Entonces
> una implementación nueva que rompa los engranajes jode todo el proyecto.»

Que una zona esté mal estructurada **no es permiso para reordenarla.** Ese
desorden ya está en equilibrio y hay ventas pasando por ahí hoy. Reescribir,
unificar o «limpiar» de paso —aunque el resultado sea más elegante— es
exactamente el cambio que rompe engranajes.

Así que antes de añadir algo nuevo, un parche o una contención, la pregunta no es
solo «¿resuelve mi caso?», sino **«¿qué le pasa al reloj?»**: por dónde más pasa
esa función, qué regla existente puede adelantarse o quedar muerta, qué estado de
la conversación se mueve. Si la estructura de verdad estorba, se propone como
trabajo aparte, con su alcance y su riesgo, no dentro del arreglo de otra cosa.

### Nada de productos en el código: es una plantilla, no una tienda

Con sus palabras:

> «Nada de productos debe ingresar al código. Trabajamos con muchos productos: yo
> puedo elegir otro producto como principal, como base, como upsell o como
> complementario cuando quiera. Tu corrección no debe aplicarse a uno solo.»

Él guarda de 1 a 100 productos en el editor y **con un selector** decide cuál es
básico, cuál complementario, cuál full y cuál order bump. Ese reparto cambia
cuando le da la gana — y el motor tiene que seguir funcionando sin tocar nada.

**La regla, en una frase:** un arreglo que solo funciona con los productos de hoy
está roto mañana.

Lo que NUNCA se escribe en el código:

- Nombres de producto, ni sus abreviaturas, ni sus palabras características.
- Precios, ni importes de ejemplo usados como umbral.
- Nombres de métodos de pago o de bancos (son distintos en cada país).
- Textos comerciales que deberían vivir en el contenido.

**De dónde se saca esa información:** de la configuración, leída en cada mensaje
—`getActiveTwoTierOffer`, `nombreDeLaOpcion`, `getPaymentMethods(phone)`,
`seccionUpsell`, la biblioteca de productos y `alineacion_por_modalidad`—. Así
un cambio en el panel se aplica solo, sin tocar una línea.

**Cómo comprobarlo antes de subir:** cambiar mentalmente los productos por otros
cualesquiera y preguntarse si el arreglo seguiría funcionando. Si la respuesta
depende de cómo se llaman hoy, no está terminado.

**Y en las pruebas, nombres inventados.** `scripts/prueba-*.mjs` usa fixtures
neutros a propósito: una prueba escrita con los productos reales tapa justamente
el fallo que esta regla evita.

**Deuda conocida, anotada para no olvidarla:** queda al menos una expresión con
nombres de métodos peruanos escritos a mano —`yape|plin|bcp|transferencia`, en la
detección de «quiere cambiar de método» de `handler.ts`—. Viene de antes y no se
toca por ahora; pero es exactamente lo que esta regla prohíbe, y en una
instalación de otro país no reconocería nada.

### No quitar por quitar: cada regla está ahí por algo

Con sus palabras:

> «Las reglas que se han agregado ahí no fueron agregadas sin sentido. Cada cosa
> que ves en el bot tiene sentido y está ahí por algo. Revisa por qué se pusieron
> ahí, y **no quites por quitar, como si fuera una telaraña que no sirve**.»

Una regla que estorba casi nunca es basura: es la cicatriz de un fallo que costó
una venta. Quitarla «porque no deja pasar mi caso» devuelve ese fallo a la vida.

**Antes de tocar una regla, averiguar para qué está.** Tres formas, en este
orden:

1. **Leer el comentario que tiene encima.** En este repositorio los comentarios
   cuentan el fallo real que la puso ahí, con el caso concreto. Casi siempre la
   respuesta está ahí mismo.
2. **`git log -S "<el texto de la regla>" -- <archivo>`** para ver en qué commit
   entró y qué decía ese commit.
3. **Preguntarle a Alberto.** Él vende con este bot todos los días y se acuerda
   del caso que la motivó.

Y cuando la regla sí estorba de verdad, la salida **no es quitarla**: es
**acotarla al caso exacto** —por etapa, por modalidad, por contexto— para que
siga protegiendo lo que protegía. Añadir lo pequeño en vez de mover lo grande.

### Tiempos y contenciones: el inventario antes de editar

Con sus palabras, el 2026-09-13:

> «El proyecto es carísimo. Cada implementación debe ser muy cuidadosa, cuidando
> el resultado: no solo es cambiar una parte y dejarla ahí, sino que hay que ver
> en qué puede afectar la implementación, qué puede dañar, qué puede romper. El
> bot tiene órdenes, códigos, reglas y muchas cosas que se han puesto por algo,
> casi nada nació al azar: tiempos, contenciones, etc. Entonces, antes de hacer
> una implementación, revisar cada cosa para no borrar nada.»

**Los tiempos y las contenciones son código funcional, no adorno.** Cuentan como
reglas puestas por un fallo real, igual que cualquier otra:

- **Tiempos:** las esperas entre burbujas, el tiempo de lectura del comprobante,
  los `delay_minutes_from_first_message` de los seguimientos, las franjas de
  `followup_schedule.slots_peru`, la separación mínima de 4 horas, las horas de
  silencio y el tick de 2 segundos del worker.
- **Contenciones:** los frenos que impiden repetir, reenviar o adelantarse — la
  cola antirráfaga, la deduplicación de webhooks, el candado por teléfono, la
  aprobación única, el enlace correcto una sola vez, y las guardas que exigen una
  condición previa antes de actuar (por ejemplo, que el bot no haya dejado una
  pregunta abierta).

Ninguno se cambia, se acorta, se alarga ni se quita si Alberto no lo pidió
expresamente. Un tiempo que parece de más suele ser el que deja leer el mensaje
anterior; una contención que parece redundante suele ser la que tapa un bucle.

**El inventario, antes de escribir la primera línea:** listar lo que ya vive en
las líneas que se van a tocar —reglas, tiempos, frenos, casos especiales y los
comentarios que explican qué fallo los puso ahí— y decir cuáles se conservan tal
cual. Al cerrar, confirmar que cada uno sigue en pie. Si el cambio obliga a mover
alguno, se avisa ANTES y se espera; y lo que se mueva se acota al caso exacto, no
se borra.

#### Toda serie de burbujas respeta su tiempo, y solo las encendidas lo cuentan

Dictado por Alberto el 2026-09-29:

> «De ahora en adelante toda serie de burbujas consecutivas tienen que respetar su
> tiempo, incluso en la intro de order bump, regalos etc, todas.»

**Son DOS reglas y van juntas.** Respetar el tiempo no vale de nada si lo respeta
una burbuja apagada: ésa no envía nada y su espera es tiempo muerto puro.

1. **Cada burbuja de una serie espera su `delay_after_sec`.** Da igual si la serie
   se manda de corrido (con `await`) o se reparte programando acciones: en el
   primer caso se espera, en el segundo se suma.
2. **Las apagadas se descartan ANTES de contar el tiempo.** No se programan, no
   esperan y no hacen cola en el obrero, que atiende UNA burbuja por conversación
   cada 2 segundos.

**Y hay un ayudante que ya hace las dos cosas: `sendConfiguredSteps`.** Una serie
nueva se manda con él. Escribir otro bucle es como se separan con el tiempo.

**El caso que lo puso aquí.** El 28/09/2026 él preguntó por qué tardaban sus
seguimientos. Medido con su contenido: salían 2 burbujas de 7, la tanda ocupaba
29 segundos y **21 de esos 29 los gastaban burbujas apagadas**. Su primera burbuja
visible llegaba al segundo 9 en vez de al 0. No era una regresión: el arreglo
existía desde días antes pero vivía en `programarPasosDeIntro`, y los seguimientos
tienen su propio programador. **La misma regla escrita en dos sitios y arreglada
en uno** — la trampa de siempre de este proyecto.

Al auditarlo entero aparecieron **catorce** sitios que mandan burbujas seguidas.
Trece respetaban el tiempo; el que no era la redirección por país, que las mandaba
de corrido **aunque su contenido ya trajera el campo escrito**: él podía subirlo en
el editor y no pasaba nada.

**Lo vigila `prueba-toda-serie-respeta-su-tiempo.mjs`**, que recorre los sitios uno
por uno. Si mañana se añade una serie sin espera, se pone roja.

**Lo que queda fuera, y está dicho a propósito:** los menús de botones mandan dos
burbujas seguidas —un texto y la burbuja de botones— y el editor NO ofrece una
espera para ellas. No hay tiempo que respetar. Si algún día se quiere una pausa
ahí, es un campo nuevo y lo decide él.

### Buscar barato: el proyecto ya está leído

`engine.ts` tiene ~9.700 líneas y `config.ts` ~6.500. Abrirlos enteros cuesta
cientos de miles de tokens **y se reenvían en cada turno siguiente**, así que una
sesión larga con lecturas grandes se encarece sola.

- **Por defecto, `grep`**: buscar el texto y leer solo las líneas que importan.
- **Leer un archivo entero solo cuando haga falta de verdad**, y avisando antes
  de lo que va a costar.
- **No releer lo ya leído** en la misma sesión, ni repetir pruebas ya corridas.
- **Una vez auditada la zona, solo `grep`.** Y si `grep` no alcanza para lo que
  hace falta saber, usar la vía más barata que sí lo resuelva —leer el rango
  exacto de líneas, `git log -S "<texto>"`, un listado de coincidencias— y
  decirlo, en vez de volver a abrir el archivo entero.
- El mapa del recorrido está más arriba en este archivo: sirve para saber a qué
  función ir sin tener que explorar.

### Lo que hay que entregar ANTES de cada corrección

1. **Qué la causa**, con archivo y línea.
2. **Qué cambio exacto** se propone.
3. **Quién más pasa por ahí**: todas las puertas que llaman a esa función, las
   seis modalidades, los seguimientos, el comprobante, la entrega, el reenvío.
   Esto es «verificar toda la tubería», y es obligatorio.
4. **Qué NO va a quedar verificado.**
5. **El contraste contra el recorrido de venta de Alberto, caso por caso.** Ese
   mapa —«Cómo funciona el bot», más abajo— no es lectura de fondo: es la lista
   con la que se mide cada cambio. Con sus palabras: «no lo dije para que lo leas
   y lo dejes tirado como un periódico».

   Los casos que hay que recorrer SIEMPRE, porque son los que se olvidan:

   - **El cliente CAMBIA DE OPINIÓN.** De producto, de método, o las dos. Antes
     de pagar y después. Es lo más común de la venta real y lo primero que se
     rompe.
   - Con método ya elegido, ¿le siguen llegando los datos sin repreguntar?
   - Al cambiar de método, ¿le llega el nuevo con el precio del producto que
     tiene elegido?
   - Al cambiar de producto, ¿le llega el nuevo con el método que ya eligió?
   - El upgrade, antes y después de la etapa upsell.
   - Las tres modalidades: lineal, **-OB-** y **-DOU-**. Que una no quede bien y
     la otra coja.
   - Y la otra mitad de la regla: que el bot **no se bloquee** contestando solo
     método y producto. La conversación tiene que seguir fluida.
5. **Qué se conserva**: el inventario de los tiempos, las contenciones y las
   reglas que ya viven en esas líneas, con la constancia de que siguen en pie
   después del cambio (ver «Tiempos y contenciones»).

Y al cerrar, con estas palabras: **«esto quedó probado, esto no»**.

### Al reparar el flujo, revisar la tubería entera y el contexto

Dictado por Alberto el 2026-09-14:

> «El bot es como una máquina completa que fluye como una tubería de principio a
> fin. A un cambio, yo sugiero una revisión de tubería completa para ver qué hizo
> romperse a la implementación. Mejor dicho: al hacer una reparación del flujo,
> chequear el contexto.»

Una fuga casi nunca está donde se ve el agua. Cuando una implementación rompe
algo, la pregunta no es «qué línea quedó mal escrita», sino **qué contexto
cambió**: qué estado se movió antes de tiempo, qué regla se adelantó a otra, qué
guarda dejó de cumplirse, qué dato que el paso siguiente daba por hecho ya no
llega.

**El recorrido obligatorio, en tres tramos:**

1. **Aguas arriba — qué llega al punto del cambio.** Qué dejó el turno anterior:
   el `state` de la conversación, si ya hay método elegido, si ya hay producto
   elegido, si el bot dejó una pregunta abierta, si ya se enviaron datos de pago,
   si el cliente ya pagó. Un arreglo que supone un contexto que no siempre llega
   funciona en la prueba y falla en la venta.
2. **El punto del cambio.** Qué reglas, tiempos y contenciones ya viven en esas
   líneas (el inventario de arriba), y cuál de ellas puede **adelantarse** a la
   nueva o **quedar muerta** detrás de ella. Dos reglas que se comen la una a la
   otra no dan error: dan silencio.
3. **Aguas abajo — qué espera el resto de la tubería.** Comprobante, aprobación,
   entrega, reenvío del material, correo, regalo, seguimientos programados y la
   etapa upsell. Si el cambio mueve el estado o sustituye un envío, hay que
   comprobar que lo que va después **sigue recibiendo lo que necesitaba**.

**Y el caso que más se repite:** la implementación no «se rompió sola». Se rompió
porque el contexto en que corre dejó de ser el que era cuando se escribió. Antes
de tocar la línea rota, reconstruir el recorrido del cliente que la rompió —el
log completo, no el trozo del síntoma— y decir en qué tramo se perdió.

### Nada se entrega sin haber corrido la venta de verdad

**`scripts/recorrido-completo.mjs` es obligatorio antes de entregar un cambio que
toque el motor, el prompt o el contenido.** No es un consejo ni un extra: es la
condición para decir que algo está corregido.

```bash
npm run dev                                          # en una terminal
node scripts/recorrido-completo.mjs --modalidad=order_bump
node scripts/recorrido-completo.mjs --todas          # antes de subir
```

**La diferencia, que es toda la diferencia:**

| | Pruebas `prueba-*.mjs` | El recorrido completo |
|---|---|---|
| Qué son | Pruebas **estáticas**: leen el código fuente | Prueba de **extremo a extremo**: levanta el sistema |
| Qué corre | Nada | Servidor, base de datos, worker, estados reales |
| Qué demuestran | Que no se borró algo por accidente | Que **la venta llega hasta el final** |
| Qué tardan | Milisegundos | Minutos — porque vive los tiempos del bot |

Una prueba estática comprueba que un texto **esté escrito** en un archivo. Que
esté escrito no prueba nada sobre lo que el bot hace con él. Las dos hacen falta,
pero **solo la segunda contesta la única pregunta que importa**: ¿sigue
vendiendo?

**Y el orden importa: rojo primero, verde después.** Se corre el recorrido ANTES
de tocar nada, hasta VER el fallo con sus propias letras. Después se corrige. Y
el mismo recorrido confirma el cambio. Quien no ve fallar la prueba primero no
sabe si arregló algo o si nunca estuvo roto.

**Lo que costó no hacerlo.** Los días 13 y 14 de septiembre de 2026 se le
entregaron a Alberto tres correcciones seguidas «verificadas» solo con pruebas
estáticas. Ninguna resolvió su caso, una dejó al bot mudo a media conversación, y
él pasó más de treinta horas haciendo de banco de pruebas: escribiendo a mano,
esperando, copiando el log y pegándolo. La primera vez que se corrió el recorrido
completo, el fallo apareció en la primera pasada y gratis:

```
FALLA  y al decir «mejor el otro» cambia de verdad   combo → combo
```

Esto ya estaba escrito en la cabecera del propio script desde que se creó: «el
fallo aparece aquí antes de que él lo viva». Estaba, y no se usaba.

**Cuando el recorrido no alcanza** —porque el turno lo contesta el modelo—, se
dice con esas palabras: «esto lo cubre el recorrido, esto no», y se pide permiso
antes de gastar `--con-modelo`, que consume sus créditos.

### El reporte antes de implementar: con los candados por delante

Dictado por Alberto el 2026-09-17, con sus palabras:

> «De ahora en adelante vas a darme el reporte de esta manera: "puedo hacer estos
> cambios, pero CLAUDE.md dice que no puedo hacer esto. Para lograrlo tengo que
> hacer esto ignorando esto". Me dices los candados que hay y preguntas si
> procedes.»

**La forma, y es siempre la misma:**

1. **Qué puedo hacer**, dicho corto.
2. **Qué regla lo impide**, citada. Si no hay ninguna, se dice igual en una
   línea: «no hay candado».
3. **Qué habría que saltarse para lograrlo**, y a cambio de qué.
4. **Los candados**: reglas, proyectos congelados, dependencias, y lo que no se
   va a poder verificar.
5. **«¿Procedo?»** — y se espera.

**Por qué.** Él decide sobre lo que no ve. Un reporte que solo dice «lo hago» le
esconde el precio; un «no puedo» sin la regla delante le suena a capricho. Con los
candados a la vista aprueba o no en diez segundos, y queda constancia de qué
autorizó exactamente.

**Y el punto 3 no se da por aprobado porque él haya pedido el cambio.** Pedir algo
no es saber lo que cuesta: ese es justamente el dato que este reporte le pone
delante antes de que decida.

### La palabra CHK

Cuando Alberto escriba **CHK** —sola, al principio o al final de su pedido— es la
orden corta de aplicar TODO lo de esta PARTE 1 antes de tocar un archivo: leer
estas órdenes, entregar las cinco cosas de «Lo que hay que entregar ANTES de cada
corrección», recorrer la tubería en los tres tramos de arriba, contrastar contra
su recorrido de venta caso por caso, **correr `recorrido-completo.mjs` y pegarle
lo que sale**, y cerrar con «esto quedó probado, esto no».

**CHK no está cumplido sin el recorrido corrido.** Entregarle una corrección sin
haberla visto funcionar es exactamente lo que le costó treinta horas.

La inventó para no tener que repetir las reglas en cada pedido. Tres letras
valen por todo este archivo.

### La palabra BANCO — el modo de diagnóstico

Cuando Alberto escriba **BANCO**, la orden es esta: **no se propone ninguna
corrección hasta poder enseñar el escalón exacto donde se pierde.**

CHK y BANCO no compiten. CHK es la lista de la ENTREGA: qué hay que revisar y
correr antes de dar algo por bueno. BANCO es el DIAGNÓSTICO: cómo se encuentra
la causa antes de escribir una línea.

**De dónde salió.** Lo pidió el 15 de septiembre de 2026, después de una noche en
la que el mismo fallo —un cajón duplicado que no sobrevivía al guardado— se
«arregló» tres veces en tres sitios equivocados. Cada intento salía de una
hipótesis leída en el código. El cuarto salió de un programa que ejecutaba el
código de verdad e imprimía un número por escalón:

```
1. al abrir, en pantalla           1 cajón
2. tras pulsar Duplicar            2 cajones
3. en el estado del editor         2 cajones
4. en el cuerpo que se envía       0 cajones   ← aquí moría
```

Eso no es una opinión: es un número que baja, y señala una línea. El banco costó
veinte minutos; adivinar había costado días.

**LAS CINCO REGLAS:**

1. **Medir, no suponer.** Montar un banco —en `scripts/` si vale para siempre, o
   en el scratchpad si es de usar y tirar— que EJECUTE el código real, extraído
   del archivo fuente y no reescrito de memoria. Un código reimplementado prueba
   lo que uno cree que hace, que es justo lo que se está poniendo en duda.
2. **Partir el camino en escalones e imprimir el valor en cada uno.** El fallo
   está donde el número cambia. Si el camino no se puede partir, todavía no se
   entiende lo bastante como para arreglarlo.
3. **Sus datos son la prueba.** Leer su configuración y sus registros de verdad,
   contar y comparar lo que funciona contra lo que no. La asimetría señala sola:
   `intro_groups = 6` contra `upsell_intro_groups = 0` fue lo que destapó el
   fallo entero.
4. **Rojo primero.** Escribir la prueba que FALLA antes del arreglo. Quien no la
   vio fallar no sabe si arregló algo o si nunca estuvo roto.
   **Pero sus registros YA SON el rojo.** Si él acaba de mandar un log donde el
   fallo se ve —sobre todo con sus pantallas en paralelo, donde una falla y otra
   no—, eso es la medición y no hay que repetirla. Volver a reproducirlo le
   cuesta tiempo, créditos y paciencia para llegar al sitio donde ya estábamos.
   Lo dijo el 2026-09-15, con estas palabras: «yo te dije que no quería hacer el
   test… yo creo que tú puedes detectar el problema sin testear; lo que te mandé
   fue para testear LUEGO del arreglo».
5. **Nada se toca sin el escalón.** Si no se puede señalar la línea con un
   número, una línea de registro o una prueba que falla, el diagnóstico NO está
   hecho. Se dice con esas palabras y se sigue midiendo.

**Sus registros son evidencia, no decoración.** Lo que más ha valido: un número
que se repite igual seis veces (los +49 tokens del reintento), una línea que
aparece en dos conversaciones y en la tercera no, y la diferencia de estado entre
sus ventanas en paralelo. Cuando pega un log largo, ahí suele estar la respuesta
entera — no en el trozo del síntoma.

**Y la señal de que se está fallando otra vez:** si la propuesta empieza por
«creo que», «probablemente» o «debe de ser», no hay diagnóstico. Hay una
hipótesis, y las hipótesis se miden antes de escribirlas en el código.

### El respaldo entre países ya es un interruptor (aprobado el 16/10/2026)

**La regla que cambió.** Desde el 02/10, a un país sin pieza propia (intro, intro de order
bump, seguimiento, upsell) le llegaba una **con bandera de otro país** — «un cliente sin intro
es una venta perdida segura». El 16/10 Alberto decidió que eso no le sirve, con su caso: «si yo
tengo una intro de Perú y tiene unas condiciones al final de la intro, esa no me serviría para
Argentina… sería ilógico». Y pidió no quitarlo a ciegas: «hazlo mejor con un switch… usar
respaldo, y si está apagado que funcione como tú dices».

**Cómo quedó.** `respaldo_entre_paises` en Ajustes («🌎 Usar respaldo entre países»).
**Ausente o encendido = exactamente lo de antes.** Apagado:

| Falta la de su país | Qué hace el bot |
|---|---|
| Intro / intro de order bump | Pasa a HUMANO, cancela lo pendiente y avisa al dueño. NO le escribe al cliente |
| Seguimiento | No se agenda |
| Upsell | No se ofrece; sigue el regalo por el camino de «no pude ofrecerlo» |

**Dónde vive.** La regla en `src/lib/workflow/etiqueta-de-bandera.ts`. En el motor se AÑADIÓ una
línea debajo de cada uno de los tres sitios que eligen por bandera, sin tocar las de antes. Lo
fijan `prueba-el-respaldo-entre-paises-se-puede-apagar` y la segunda vuelta de
`prueba-la-pizarra-dice-lo-que-hace-el-bot`. La Pizarra lo dibuja: hueco rojo = pasa a humano.

### Y el respaldo entre tiendas, su gemelo (aprobado el 17/10/2026)

`soloDeSuTienda` tenía un escalón de respaldo: a una tienda sin pieza propia le servía la
«🌐 de todas». Alberto: «no podemos trabajar "me olvidé la tienda, se agarra de la otra"… ¿y si
agarra otro producto?». Lo único que sí debe respaldar son los usuarios (cobradores).

`respaldo_entre_tiendas` en Ajustes («🏪 Usar respaldo entre tiendas»). **Ausente o encendido =
lo de antes.** Apagado, con la misma tabla que el de países: intro / intro de order bump → humano
con aviso y sin escribirle al cliente; seguimiento → no se agenda; upsell → sigue el regalo; fila
de upsell → ninguna. La regla en `etiqueta-de-tienda.ts` (`aLaTiendaLeFaltaLoSuyo`); en el motor
se AÑADIÓ una guarda junto a cada `soloDeSuTienda`, sin tocar la de siempre. Lo fija
`prueba-el-respaldo-entre-tiendas-se-puede-apagar`.

**Excepción, y es a propósito: los upsells EN FILA no pasan por esa guarda.** Su presentación
vive en la ficha del producto, que no lleva tienda; la tienda ya la eligió la fila
(`filaDeLaConversacion`). Con la guarda, apagar el respaldo saltaba los upsells 2, 3, 4…

### Los botones de burbuja del upsell, como los nativos (17/10/2026)

Él quiere manejar el Sí / No del upsell desde cada ficha (por tienda y país), no con los nativos,
que son uno para todos: «que quede igual en cuanto a funcionamiento como los botones nativos».

- **«Rechazar UPSELL» (`decline_upsell`)** es otra puerta a `rechazarUpsell`, la MISMA del «No»
  nativo. **Solo en botones**: en un cuadrito del upsell el «no» ya lo decide el detector, y la
  acción además rechazaría dos veces (y tumbaría el downsell recién ofrecido).
- **Pulsados tarde no hacen nada**, como los nativos: con la oferta ya cerrada (rechazado,
  aceptado, pagado) el Sí y el No de burbuja sueltan el turno. Antes de la oferta no se toca.
- **Una copia de ficha lleva botones con su propio código** (`conBotonesNuevos`): el bot busca el
  botón por código y se queda con el primero — el fallo del 27/09 en los seguimientos.
- Lo fija `prueba-los-botones-del-upsell-como-los-nativos`. El regalo NO se tocó: él lo quiere
  automático (enlace y premio).

### Los caminos (18/10/2026)

«Cada camino tiene su propia ruta pero el final es el mismo… yo no necesito reemplazos, si no hay
conexión… no se conecta y punto». Intros, seguimientos e intros de order bump llevan `camino`
(vacío = principal) y `tambien_en_caminos` (otros que pasan por ella; `PRINCIPAL` = el principal).
La conversación anota el camino de su intro (`conversations.camino`, al elegirla; no cambia a
mitad). En cada seguimiento y en la intro de order bump juegan SOLO las de su camino
(`porCamino`, `etiqueta-de-camino.ts`), **sin reemplazos**: si su camino no sigue, ese cliente no
recibe ese paso; sin intro de order bump en su camino se queda TRABADO (ni se destapa ni cambia de
estado, `presentOrderBumpAndWaitForChoice`). **Un cliente del principal en un paso sin caminos
recibe la MISMA lista: sin caminos el bot es el de siempre.** El upsell, pago, entrega y regalo no
llevan camino. En la pizarra, el cable entre fichas fija el camino (`conCaminoDelCable`), duplicar
nace sin camino, y se marca «🛑 termina aquí» / «sin intro de order bump, se queda trabado». Lo
fija `prueba-los-caminos`; probado en vivo (cliente B se queda tras su seguimiento 1).

### De COMOHOY a COMO OB con los datos de pago ya enviados (18/10/2026, su prueba HP1)

Una conversación que recibió los datos de pago vendiendo un producto queda en `payment_done` sin
opción elegida. Al pasar la tienda a COMO OB, la IA recibía los DOS productos y hablaba del
segundo sin que la intro de order bump se hubiera mostrado. Ahora `orderBumpDeferredUntilPayment`
y `elOrderBumpSigueOculto` (openrouter.ts) incluyen ese caso: `payment_done` + sin elegir +
`elSegundoProductoSigueTapado`. En COMO OB normal no se llega a `payment_done` sin elegir, así que
solo toca la transición. Lo fija `prueba-la-transicion-a-ob-con-pago-enviado`.

### Cada semimodalidad con lo suyo en la pizarra (18/10/2026)

«Cada ficha debe vivir en su semimodalidad… si cambio de semimodalidad debo modificar lo que sea
sin que afecte a la otra». Dos piezas, solo del editor (el bot no cambia):
- `hacerPropiaLaSemi`: al abrir la pizarra en una semimodalidad, las fichas SIN etiqueta que juegan
  ahí reciben una copia con la etiqueta (al final de su lista; la original sigue para las otras).
  **Se copian todas las que juegan a la vez**: el bot filtra por semimodalidad la estación ENTERA de
  la tienda (`porSemimodalidad`), y copiar solo una dejaría sin la suya a los demás países.
- Una pizarra por semimodalidad: clave `tienda|canal|lineal|dou|ob` (`claveDeLaVista`); sin la suya
  arranca con la vieja `tienda|canal`. Eliminar renumera en TODAS las pizarras del canal
  (`enTodasLasPizarras`), y las archivadas valen para todas.
Lo que sigue compartido a propósito: productos, regalo, upsell, entregas, cobrador y los minutos de
cada seguimiento (estos son del canal: separarlos toca el motor).

### El botón repetido dentro de una ficha (el del DNI, 18/10/2026)

Duplicar una burbuja copiaba sus botones con el MISMO código, y en el seguimiento el bot ejecutaba
el de la primera burbuja que lo tuviera, aunque estuviera apagada. Ahora: en el editor, duplicar o
pegar en la misma ficha da códigos nuevos (`sinBotonesRepetidos`; mover con cortar/pegar conserva
los suyos, para quien ya recibió la burbuja), y en el motor `elBotonDeSuSeguimiento` prefiere el de
una burbuja ENCENDIDA dentro de su ficha. Con un código que no se repite nada cambia. Lo fija
`prueba-el-boton-repetido-de-una-burbuja`.

### El regalo por tienda (pedido el 17/10/2026)

«No todos los regalos van a ser iguales, por tienda es diferente… son productos diferentes y regalos
diferentes». Cada tienda puede traer `regalo` (`consent_sequence`, `ask_sequence`, `reward_message`,
`decline_message`) y **pisa campo a campo** al `gift_mechanic` general en las conversaciones de esa
tienda (`conElRegaloDeLaTienda`, aplicado al armar la configuración del turno, que ya va por tienda).
Botones, enlaces por anuncio, audio e interruptores siguen siendo los del bot. **Sin regalo propio
devuelve el MISMO objeto: nada cambia.** Se escribe desde la pizarra de la tienda (al editar el regalo
ahí, pasa a ser suyo). Lo fija `prueba-el-regalo-por-tienda`.

### El peso de los seguimientos (aprobado el 17/10/2026)

«En Perú voy a testear con varias intros… y varios seguimientos… cada uno con su peso». Las
intros, la intro de order bump y el upsell ya se sorteaban por peso; las variantes de un
seguimiento, parejo. Ahora cada variante tiene `weight` y los mensajes principales `steps_weight`
(ausente = 1). **SIN PESOS PUESTOS SE USA LA LÍNEA DE SIEMPRE, tal cual** (`chooseFollowupVariant`):
él no quiere retestear lo ya probado. Lo fija `prueba-el-peso-de-los-seguimientos`.

**Ojo con los anuncios, que no son iguales en intros y seguimientos** (medido el 17/10, sin
tocar): en la INTRO, quien llega por un anuncio recibe la suya y el resto se sortea entre TODAS
(incluida la del anuncio); en el SEGUIMIENTO, la del anuncio es solo para él y el resto se sortea
entre las que NO tienen anuncio (si no hay ninguna, no se manda). Él eligió dejarlo así; la
pizarra lo dice en el cable de cada ficha.

### EL TABLERO — el segundo motor (22/10/2026, SOLO EN ALBERTO 4)

«No quiero que mi bot sea una tubería soldada… sino ser armable, en base a decisiones, botones,
elecciones». En Mis tiendas → «🧩 Tablero», él arma la ruta de una tienda con fichas (Inicio,
Mensaje, Cobro, Entregar, Condición, Esperar, Postventa y regalo, Pasar a humano) y cables; **los
cables son las órdenes** (la pizarra solo dibuja; el tablero se ejecuta). Vive en `src/lib/tablero/`
y el plan entero en PLAN-TABLERO.md. ALBERTO 2 no lo tiene: él trabaja ahí y no se toca.

**Las cuatro reglas que lo aíslan, y su prueba es `prueba-el-tablero.mjs`:**
1. **Una conversación, un solo motor.** Entra SOLO al nacer (`state = new`) en una tienda con
   tablero **encendido y con el Inicio conectado**; queda con fila en `tablero_estado` y
   `state = "tablero"`. Las demás no pasan por ahí.
2. **Una sola entrada** en `handler.ts`, después de `leContestamos` y la moderación y antes de
   `tryWorkflowOnIncoming`. El regalo (`payment_approved`…`awaiting_facebook_comment`) lo sigue
   haciendo el motor de siempre.
3. **Lo compartido se usa, no se toca:** `sendConfiguredSteps`, la entrega del producto
   (`delivery` de la biblioteca), `scheduleGiftConsentWithDelay`, `notifyAdmin`, `sendPurchaseEvent`.
4. **Lo programado lleva su dueño:** `tablero_reloj` y `tablero_sin_pago` van al tablero desde el
   obrero. El reloj solo sale si el cliente sigue en esa ficha (`vuelta`); «no pagó» solo si ese
   cobro sigue abierto y sin nada pagado.

**El cobro abierto (la contribución):** acepta cualquier monto; mínimo y tramos POR PAÍS; los
pagos parciales se suman; sale por el tramo más alto que alcance. Mientras está abierto, un
comprobante en cualquier ficha (también en un recordatorio) se lee contra él. Lector propio
(`lector.ts`, misma visión que el de siempre) y huella del comprobante (`tablero_pagos`): el mismo
pago no vale dos veces, tampoco entre conversaciones.

**La IA dentro del tablero** (`conversador.ts`) NO usa el cerebro de las modalidades (llevaría
marcadores y datos de pago de otra venta): solo la conversación, la pregunta pendiente y los
montos de su cobro; si nombra otro monto se le pide otra vez y si insiste se quita esa frase.

**Probado el 22/10 en el simulador de una copia:** entrar por el Inicio, botón → humano, silencio →
insistencia (y no sale si respondió), botón tocado tarde (vale) y repetido (no reentrega),
contribución completa (entrega gratis → cobro → recordatorio 1 → esperar → recordatorio 2 →
comprobante de 15 → tramo 2 → plus → regalo), pago bajo el mínimo, comprobante repetido.
**Messenger (22/10, más tarde):** la misma entrada en `webhooks/messenger/route.ts`, DESPUÉS de la
pregunta del país; los botones van como respuestas rápidas con el mismo id. Probado en el
simulador como cliente de Messenger (país → tablero completo). Lo programado del tablero sale por
SU número y SU página (`withOutboundWhatsAppNumber` / `withOutboundMessengerPage`), como el de siempre.
**Instagram (22/10, más tarde):** la misma entrada en `webhooks/instagram/route.ts`. Sus
conversaciones no traen tienda (el motor de siempre las atiende con el contenido general, y así
sigue): el tablero usa la tienda de la página de Facebook unida a la cuenta de Instagram y abre su
turno con ella (`conSuTienda`). Los botones salen como lista numerada; el tablero entiende «1»,
«2», «3» (solo en Instagram) y, en cualquier canal, el texto del botón escrito.
**No probado:** Instagram de verdad (el simulador no lo tiene), un Messenger real y una venta real.

### El tablero, segunda vuelta (23/10/2026): «replicar la pizarra, mismos cables, mismo todo»

**La pantalla** (`LienzoDelTablero`) se ve y se maneja como la pizarra: fichas de 250 px con franja,
Inicio POR PAÍS (con «Vender con el tablero» y «En revisión»; sin país = «Otros países») y el fondo
semitransparente de su ruta, cables punteados de goma con la ✕ al pasar el ratón, cajas, clic derecho,
soltar el cable en el vacío crea una ficha conectada, Ctrl+C / Ctrl+V / Delete, fichas apagadas
(tenues; no mandan y siguen por su «→») y «Fichas guardadas». Claro / mixto / oscuro como la pizarra.

**Un tablero por tienda Y POR CANAL** (`tableros.<tienda>.<whatsapp|messenger|instagram>`), con
«Clonar desde WhatsApp»; lo guardado antes se lee como WhatsApp. **Workflows** (`workflows.<id>`): sin
tienda, uno para los tres canales; arrancan con la ficha «Ir a un workflow» o con «▶ Activar un
workflow» en un botón o cuadrito de la venta de siempre (`start_workflow`, `workflow_id`), que cancela
lo programado del motor de siempre y entra en el siguiente tick (`tablero_entrar_wf`).

**Fichas nuevas:** «Seguimientos» (una caja con su gestor flotante: seguimientos con minutos desde el
ÚLTIMO mensaje del cliente, versiones con peso, «activa el precio de oferta», salida «Terminaron sin
respuesta»), «Intro de order bump» (versiones con peso), «Reparto por peso», «Ir a un workflow»; la
Condición puede preguntar por anuncios concretos (claves del registro); el Regalo tiene «Al terminar
el regalo» (lo avisa el motor de siempre con `avisarFinDelRegalo`).

**El cobro, con las revisiones de siempre:** fecha si el país la exige, titular en Yape/Plin (la misma
regla de la primera palabra, `titularCoincide`), comprobante repetido, precio congelado al abrir el
cobro, precio normal / de oferta / según la etapa, y «eligió uno y pagó otro» (`acepta`: más caro →
se entrega ese; más barato → se pregunta «¿error o prefieres X?»). Un comprobante sin cobro abierto no
se cuenta: se avisa al dueño.

**Lo que el motor de siempre respeta también en el tablero:** la ventana de 24 h (no envía), las horas
de silencio (pospone), el «no pagó» se reinicia si escribe, el LeadSubmitted al entrar y el
InitiateCheckout al abrir un cobro, el reenvío del material (`reenviarLoDelTablero` en
`resendApprovedMaterial`: lo que entregó el tablero, no lo de la venta de siempre).

**La IA del tablero entiende la elección escrita** (`elegirOpcionConIA`) cuando ningún botón ni
cuadrito acierta: decide la opción sin escribir nada propio; «no quiero X» nunca es X; si duda,
ninguna. El texto del botón escrito vale como tocarlo; en Instagram, «1/2/3».

**Arreglado de paso (también en ALBERTO 2, pendiente de su permiso):** `readBubbleButtons` solo
releía 5 acciones: un botón con «Elegir UPSELL», «Rechazar UPSELL», «Abrir la oferta de 2 opciones»
o las del regalo volvía a «Enviar burbujas» al reabrir el editor. Ahora relee todas
(`ACCIONES_DE_BOTON`). Y en Instagram ya no salen los asteriscos (`sinFormatoDeWhatsApp`).

**Como en la pizarra, también:** «▶ Ver recorrido» en el fondo de cada país (ilumina su ruta y
encuadra; lo demás tenue) y «🔍 Buscar» (títulos y lo escrito en las burbujas; Enter va a ellas).
Solo vista: no cambian nada.

**Pruebas:** `prueba-el-tablero.mjs` (estática) y `recorrido-del-tablero.mjs` (vive la venta en el
simulador y devuelve el contenido tal cual, con su huella). Su escenario `activar` prueba en vivo
«▶ Activar un workflow» desde un botón de la venta de siempre (sin tablero → botón → workflow).

### El tablero, tercera vuelta (23/10/2026): para vender como COMO HOY / COMO DOU / COMO OB

Su pregunta: «¿has verificado que se pueda construir igual a los automáticos?». No se podía: la IA
del tablero no conocía los productos, el cobro no entendía el método ni los cambios de idea, no había
upgrade ni correo. Lo que se añadió (solo el tablero; el motor de siempre no se tocó):
- **«Presenta estos productos»** en mensaje, intro de order bump y seguimientos. La IA (`conversador.ts`)
  conoce el contenido, los regalos y el precio de su país SOLO de los ya presentados (también el que
  se cobra y el que se entrega): el oculto no existe para ella hasta su intro. Reglas de la casa en
  su cerebro: precio de frente, desconfianza con empatía, nunca números de cuenta; dialecto del país.
  OJO: no usa las secciones del cerebro del editor (son de un producto y de las modalidades).
- **Cobro «💳 Preguntar el método y mandar sus datos solo»** (`pago.ts`): sus burbujas preguntan; con
  el método ya elegido no se repregunta; nombrar un método (o su botón) manda SUS respuestas de
  «Métodos de pago» del país con el precio de lo elegido, y deja el método en la conversación
  ({{NUMERO_DE_CUENTA}} sale con esa cuenta); «mejor el otro» cambia de producto (solo entre lo
  presentado) y manda los datos con el método ya elegido; quejarse de un método no es elegirlo
  (`messageHasPaymentConcern`). La IA tiene «reenviar_datos_de_pago». {{PRODUCTO}} en esas burbujas
  = el producto del cobro.
- **Cobro «⬆️ Upgrade»:** si ya compró uno de la lista más barato, los más caros cuestan la diferencia.
- **Seguimientos:** las reglas de `scheduleFollowupSequences` con SU configuración (sus canales
  tienen contenido, así que cada seguimiento va a SUS minutos —medido: las franjas no se usan ahí—):
  lead tardío, horas de silencio (con «ignora» por seguimiento), cola antirráfaga, y vuelven a contar
  si el cliente escribe. En el simulador no se aplazan.
- **Ficha «📧 Pedir correo y enviar»:** sus burbujas lo piden; con el correo, manda por Gmail lo que
  le entregó el tablero (texto de la entrega con sus enlaces, limpio para correo) con su asunto y su
  texto ({{MATERIAL}}); sale por «Correo enviado». En el simulador no sale de verdad.
Probado en vivo (copia aislada, su Yape/BCP y su comprobante de 15): escenarios `metodo`, `ia`,
`upgrade`, `correo` del recorrido. **No probado:** el correo real (Gmail) y la IA con su contenido en
otros países.

### Los números de cuenta escritos a mano (23/10/2026, solo ALBERTO 4)

«Esa respuesta la tengo que poner varias veces en muchos lugares del editor… no sé dónde están», y la
condición: «la respuesta que le llegue al cliente igual, pero con otra configuración interna».
Medido ese día: 1055 textos con datos de pago, 893 con el número escrito a mano (su Yape 437 veces),
**cuatro cuentas BCP distintas en Perú** (tres a mano y la guardada), y seguimientos con bandera de
Argentina y de Ecuador —y piezas sin bandera— que llevan escritos sus datos de **Perú**. Cambiar el
usuario que cobra no cambiaba nada de eso: el bot manda lo escrito tal cual.

**Lo que hay ahora (solo editor, el motor no se tocó):**
- Menú usuarios → **🔎 Números escritos a mano**: una fila por número (y por su nombre de titular),
  con un botón que lo cambia por el comodín de su cuenta (`{{CUENTA_<nombre>}}`, que el bot ya
  resolvía). El texto se queda donde está, con su contexto. Si el número no está guardado, se guarda
  como «otra cuenta» del país (si el nombre ya es otra cuenta, `bcp_2`, `bcp_3`…: no se pisa).
- Antes de cambiar calcula, **por cada país que lee ese texto y por cada tienda**, qué saldría con el
  comodín (la regla de `elCobroDelPais`). Solo cambia donde sale igual. Quién lee un texto: el país de
  su sitio (`by_country`, perfil), o la bandera de su pieza, o —sin bandera— todos los países donde
  vende. A propósito por el lado seguro: no calcula el descarte de piezas sin bandera que hace el
  motor dentro de cada estación; contar un país de más solo deja ese texto esperando su aprobación.
- Arriba, **una decisión por país**: «que los clientes de Argentina vean su propia cuenta» en vez de
  la de Perú. Sin marcarla, esos textos no se tocan.
- Menú usuarios → Datos para pago → **Otras cuentas**: nombre + número + comodín, «+ Otra cuenta».
  Se guardan en el país, en su copia de cada modalidad y en el usuario que es él mismo (mismo
  titular): si no, en la tienda que cobra «su» usuario saldría su cuenta principal. Renombrar una
  cuenta cambia el comodín en sus textos. En cada usuario que cobra salen las mismas, con aviso si le
  falta alguna.
- **Aviso amarillo** en toda caja de texto que lleve escrito un número de una cuenta guardada, con
  «Cambiar por {{CUENTA_…}}».

**Probado:** `prueba-numeros-a-mano.mjs` (con datos inventados) y, con el MOTOR REAL en la copia
aislada, cada texto cambiado armado antes y después para cada país que lo lee y cada tienda: 318
textos, 1032 combinaciones, **0 diferencias**. **No probado:** que él lo aplique en su contenido (eso
lo hace él, con Ctrl+Z y Ctrl+S como siempre); el formato del número (espacios) sí cambia en los
textos escritos de otra forma, y la fila lo dice antes.

### El tablero, cuarta vuelta (24/10/2026): muestras, cerebros por etapa, correo y la prueba por países

«Haz todas las pruebas correspondientes, para yo no tener que hacer una prueba y decirte: me entregó
el producto incorrecto…». Lo que se añadió (solo el tablero; el motor de siempre no se tocó):
- **Muestras con foto:** la IA las manda con `enviar_muestras`, solo de lo ya presentado, cada una
  una vez (`tablero_estado.muestras`); una foto que falla no deja mudo al cliente.
- **Cerebros por etapa:** «🧠 Cerebro» general por tablero (`cerebro`, vacío = `CEREBRO_DE_FABRICA`
  en datos.ts) + «🧠 Instrucciones para la IA aquí» por ficha (`instrucciones`, opcional). Lo fijo va
  primero (más barato como prefijo). Las reglas del dinero van siempre en el código. «LO QUE LE ESTÁS
  OFRECIENDO AHORA» para que «¿este es otro?» se entienda por la etapa.
- **Correo sin borrador:** «📧 Ofrecer también por correo» en Entregar (botones; pide la dirección si
  no la dio; manda `{{ENLACES}}` de lo entregado). Apagado, si lo pide de palabra se manda igual
  (`enviar_por_correo`). En una conversación del tablero, un mensaje con un correo y los botones del
  correo los atiende SIEMPRE el tablero, también durante el regalo: el motor de siempre mandaba SU
  plantilla (de su venta, no de lo comprado en el tablero).
- **Completar al otro** en cualquier momento (`completar_al_otro`), también desde el regalo (sale de él).
- **Durante el regalo**, lo que no es del regalo (`deQueHablaConIA`) lo contesta la IA del tablero.
- **Pagó y la salida no tiene cable:** aviso al dueño («entrégale a mano») y al cliente «un asesor».
- Arreglos que cazó la prueba: {{PRODUCTO_ENTREGADO}} salía vacío en la entrega («Entrega para **»);
  el lector rechazaba un recibo argentino bueno (ahora con la herramienta obligatoria y «es_comprobante»);
  «me quedo con el básico» no se entendía en el cobro (ahora la IA ve precio y básico/completo);
  la IA escribía **negrita** de markdown (ahora *una* estrella, como WhatsApp); la IA prometía «ya te lo
  envío» con el envío fallado.
- **Tokens, medidos:** 1.632 de entrada por turno en promedio (771–3.143) contra 7.000–10.000 de la
  venta de siempre.
Prueba: `scripts/recorrido-tablero-paises.mjs` (PE en COMO DOU con upsell y regalo, EC en COMO OB con
muestra, AR en COMO HOY con correo, y las desconexiones) con sus comprobantes reales.
**No probado:** el correo real — Gmail rechazó la contraseña de aplicación que dio (535 BadCredentials).

### Las tiendas de ejemplo (24/10/2026)

Las pidió Alberto «para aprender» el tablero: todo lo que dice **TIENDA** en el nombre lo armó Claude.
Son ficticias y están para probar en el simulador; él pidió NO borrarlas.
- **TIENDA COCINA FÁCIL** (botones, 1 upsell, upgrade), **TIENDA PEQUEÑOS FELICES** (cuadritos,
  2 upsells), **TIENDA TALLER MAESTRO** (elección escrita, 3 upsells), **TIENDA MASCOTAS FELICES**
  (botones, 1 upsell con cuadritos, correo) y **TIENDA PEQUEÑA ESTILISTA** (venta por contribución:
  5 PDF, 7 niveles de 12 a 69, 4 recordatorios dentro de las 24 h).
- Cada tablero tiene 4 mantas: 🇵🇪 tubería doble oferta, 🇪🇨 order bump, 🇦🇷 lineal y 🌍 otros países
  (no vende, pasa a un asesor). Precios hechos para sus comprobantes: PE 15/20/5, EC 3/4/3, AR 8000.
- 20 productos nuevos con ids `pt…` (los suyos, intactos). Enlaces de entrega en example.com.
- Número: el de su tienda GRAFISMO + una frase de entrada con el nombre de la tienda, así el
  simulador las encuentra y en vivo solo entra quien escriba esa frase.
- Prueba: `scripts/recorrido-tiendas-ejemplo.mjs` (vende en las 5, con sus comprobantes).

**Comodines en el tablero** (`src/lib/tablero/comodines.ts`): {{PRODUCTO_BASE}}, {{PRECIO_FULL}},
{{PRECIO_UPSELL}}… se llenan con los productos que presenta CADA ficha (el más barato = base, el más
caro = full, el primero = producto/upsell), con el precio del país del cliente. La lista del «{{» del
editor ya no se filtra por modalidad (el editor está siempre en lineal y escondía esos comodines).

## LO LOGRADO, LO INTOCABLE, Y QUÉ HACER EN UNA EMERGENCIA

> Escrito el 17 de septiembre de 2026, a petición del dueño: «deja escrito el
> funcionamiento del bot, cómo debe comportarse, lo que se ha logrado y lo que no
> se debe quebrantar, y en caso de emergencia qué reglas romper».
>
> **Si llegas nuevo a este proyecto, lee esta sección entera antes de tocar un
> archivo.** Y lee `TAREA-PENDIENTE.md`, que dice qué está a medias hoy.

### A. Cómo debe comportarse el bot — el contrato, con sus palabras

1. **Lo decidido no se repregunta.** Con método ya elegido, si decide comprar →
   datos de pago directamente. Cambia de método → los datos del nuevo con el
   precio del producto que tenga. Cambia de producto → los datos del nuevo con el
   método que ya eligió. **Nunca «¿qué producto deseas?» dos veces.**
2. **Una afirmación no se detecta por palabra.** «El bot tiene la suficiente
   inteligencia para saber cuándo han afirmado su pregunta.» Y la otra mitad:
   **que no se bloquee** contestando solo método y producto — la conversación
   tiene que seguir fluida.
3. **Nadie recibe datos de pago sin haber elegido**, cuando hay dos opciones.
4. **Ningún importe que no sea de la opción elegida.** Un precio que parece bueno
   y no lo es es peor que no decir ninguno: el cliente lo paga, el validador
   reconoce la opción **por el monto**, y se entrega el enlace equivocado.
5. **En -DOU- no hay producto oculto**: básico y full se presentan desde el
   inicio. **El oculto es el producto extra**, hasta que se revela tras la compra.
   En **-OB-** sí hay oculto: del full no se dice **ni precio ni contenido** hasta
   que el cliente decide pagar o elige método.
6. **Las muestras salen en orden**: básico → complementario → full, y **una sola
   vez**. Si la galería está vacía o sin checks, **no se ofrecen**.
7. **El cliente cambia de idea todo el tiempo** —de producto, de método, las dos,
   antes y después de pagar— y eso es lo primero que se rompe. Es el caso que hay
   que recorrer siempre.

### B. Lo logrado — y la prueba que lo protege

Cada línea es una conducta que **ya funciona** y que **no puede regresar**. Si
tocas su zona y una de estas prueba se pone roja, **para**: eso es una regresión,
no una prueba desactualizada.

| Conducta | Commit | Prueba que la fija |
|---|---|---|
| Cada modalidad enseña **sus** muestras | `9f9d52c` | `prueba-las-muestras-de-cada-modalidad` |
| «quiero **saber** qué trae» no compra | `9f9d52c` | `prueba-querer-saber-no-es-querer-comprar` |
| «creo **que** el 1» se lee como elección | `f9254f3`, `a54d4c1` | `prueba-el-numero-de-la-lista-elige` |
| El dinero del extra no cuenta como upgrade | `81f2338` | `prueba-el-pago-del-extra-no-reabre-la-eleccion` |
| El «sí» a lo que el bot propuso **es** elegir | `3421d3a` | `prueba-el-si-a-lo-que-el-bot-propuso` |
| Sin elección **no salen** datos de pago | `4778ce8` | `prueba-sin-eleccion-no-hay-datos-de-pago` |
| Se lee el **turno entero** del bot, no la última burbuja | `d97d20c` | `prueba-la-propuesta-del-bot-no-queda-fija` |
| Los precios de la ficha siguen la **bandera del país** | `81d9354` | `prueba-el-precio-de-la-ficha-es-por-pais` |
| Las muestras salen **en orden**, el full al final | `a806230` | `prueba-el-orden-de-las-muestras` |

**En BOT FRANKO**, lo mismo portado con sus diferencias: `d0e453a` (el «sí» a la
propuesta y ningún método suelta datos sin elección), `88dc020` (nombrar el
producto manda sobre un cuadrito ya contestado) y `aa43b83` (la muestra de la
segunda opción ya no depende de otra modalidad).

### C. LO INTOCABLE — lo que no se quebranta nunca

1. **Nada de productos, precios ni marcas de pago en el código.** Es una
   plantilla: él cambia de producto cuando quiere. Un arreglo que solo funciona
   con los productos de hoy está roto mañana.
2. **Ninguna lista de palabras como regla entera** — ni contra lo que escribe el
   cliente **ni contra lo que escribe el bot**, que lo redacta el modelo. Vale
   solo como desempate dentro de una regla estructural.
3. **Los tiempos y las contenciones son código funcional**, no adorno. No se
   acortan, alargan ni quitan sin que él lo pida.
4. **Revertir es quirúrgico**: `git revert` del commit exacto, tras leerlo. **Está
   prohibido** volver a un punto anterior en el tiempo —`reset --hard`, checkout
   de ramas viejas, restauraciones amplias—: eso resucita fallos ya muertos. Ya
   pasó y le costó caro.
5. **La aprobación única, el enlace correcto una sola vez, el pedido de correo,
   el regalo, el reenvío del material y la memoria de que ya pagó.** Nada de eso
   se toca de paso.
6. **Nunca reescribir un archivo de código con PowerShell** (`Set-Content` rompe
   los acentos y deja el proyecto sin compilar).

### D. EMERGENCIA — qué se puede saltar y qué no

**Qué es una emergencia:** el bot está atendiendo clientes y hace algo que cuesta
ventas o dinero — entrega el enlace equivocado, cobra un importe que no es, se
queda mudo a media conversación, o responde cosas que no son suyas. **No es
emergencia** que una prueba esté roja, que algo se vea mejorable, ni que él esté
enfadado.

**LO PRIMERO, Y CASI SIEMPRE LO CORRECTO: `git revert` del commit exacto.**
Aquí cada cambio va en su propio commit a propósito, justamente para esto.
Revertir es más rápido y más seguro que arreglar en caliente, y se puede volver a
aplicar después con calma.

**Reglas que SÍ se pueden relajar mientras arde:**

| Regla | Cómo se relaja | Qué se debe hacer después, sin falta |
|---|---|---|
| «Nada que no haya pedido» | Actúa sobre lo que esté bloqueando la venta sin esperar respuesta | Decírselo **en el mismo mensaje**, sin adornos |
| Las cinco cosas que hay que entregar antes de corregir | Entrega lo mínimo: qué lo causa y qué se toca | Completar el análisis en cuanto deje de sangrar |
| «Rojo primero»: la prueba antes del arreglo | El arreglo puede ir primero | La prueba se escribe **el mismo día**, o volverá |
| Preguntar antes de tocar algo colindante | Tócalo si el arreglo lo obliga | Explicar qué más se movió y por qué |

**Reglas que NO se saltan ni en emergencia:**

1. **No decir «arreglado» sin haber corrido la venta de verdad.** Es la regla que
   nació de treinta horas perdidas: tres correcciones «verificadas» con pruebas
   estáticas, ninguna resolvió su caso y una dejó al bot mudo. *Excepción única:*
   un **revert** puede desplegarse sin el recorrido — deshacer es seguro; añadir
   no lo es.
2. **No tocar el prompt como arreglo de emergencia.** Es lo menos predecible que
   tiene este bot y no se puede verificar rápido. En el prompt todo compite a la
   vez y la orden más larga gana.
3. **No volver atrás en el tiempo.** Ver «lo intocable», punto 4.
4. **No meter productos, precios ni marcas de pago en el código** para salir del
   paso. Ese parche se queda para siempre y rompe la plantilla.

**Y la disciplina que más tiempo ha ahorrado esta semana, que tampoco se salta:**

> **Antes de culpar a un cambio, quítalo y vuelve a correr.**

Tres veces se dio por roto algo que no lo estaba: dos eran del entorno —ffmpeg sin
instalar, `.next` borrado con el servidor vivo— y una era su propio contenido, que
cambió entre dos corridas. Quitar el cambio y repetir cuesta dos minutos y evita
«arreglar» lo que funcionaba.

### E. Lo que este bot NO perdona — los tres fallos que más han costado

Están escritos en detalle en sus secciones, pero si solo lees tres cosas:

1. **La caja que una modalidad llena y otra no abre.** Se ve igual que una caja
   vacía y nadie avisa. Ha pasado tres veces. **Pregunta por el dato, nunca por el
   nombre de la modalidad.**
2. **El parche palabra por palabra.** Cada prueba nueva destapa otro sinónimo, la
   lista crece sin freno y nadie sabe por qué está cada término. **Si tu
   corrección empieza por «añadir esta palabra», el diagnóstico no está hecho.**
3. **Sustituir con nada.** Si una rama reemplaza algo —burbujas de pago, entrega,
   respuesta— hay que comprobar que lo que la sustituye **salió de verdad** antes
   de dar el paso por hecho. Sustituir con nada deja al cliente sin datos de pago
   y la venta marcada como entregada.

## El recorrido de venta, contado por el dueño

Dictado por Alberto el 2026-09-13. Es el mapa de lo que el bot tiene que hacer.
Cualquier cambio se mide contra esto.

### Vocabulario (fijado por él, para no confundirse)

- **upsell** = el PRODUCTO que se revela DESPUÉS de la compra. Tiene su propia
  presentación —él la llama «intro»— y sus propias reglas.
- **Doble Oferta + Upsell** = una MODALIDAD. Cuando se hable de modalidad se dice
  el nombre completo.
- **producto base** y **producto full** = el full es el base + un complemento.

### Lineal

1. El cliente saluda → sale la intro.
2. Al terminar puede pasar de todo: elegir método de pago, o cuestionar («¿es
   estafa?», «¿qué contiene?», «¿es real?»), o elegir método de frente.
3. Recibe los datos de pago. Y después todavía puede: repreguntar, **cambiar de
   método**, volver a tener objeciones, aceptar, y decir «voy a pagar».
4. **Con el método ya elegido NO se le vuelve a preguntar cuál es.** Pero SÍ
   puede cambiarlo cuando quiera —pasa de verdad— y la compra debe seguir.
5. Compra → si el producto upsell está activo, sale su presentación → lo compre o
   no, se continúa con la postventa (el regalo).

### Doble Oferta + Upsell

Igual que Lineal al principio, pero se ofrecen DOS productos —base y full— y el
cliente elige uno según su ánimo. Corren las mismas dudas, objeciones, preguntas
y cambios de elección.

- **Upgrade:** compró uno y después quiere pagar la diferencia por el más caro.
  El bot se lo permite y lo lleva bien hasta la entrega.
- Después de la compra se revela el producto upsell, y luego la postventa.

### Order Bump

1. Hay un producto para presentar desde el saludo (el **base**) y un producto
   **oculto** que se revela más tarde.
2. La primera intro muestra el producto base.
3. **El producto full se revela SOLO cuando el cliente decide pagar o elige
   método de pago.** Ahí sale la segunda intro, la del order bump.
4. **REGLA DURA: del producto full no se dice NI EL PRECIO NI EL CONTENIDO hasta
   ese momento.** Nunca antes.
5. El cliente elige cualquiera de los dos. Corren las mismas dudas, cambios de
   método, objeciones y el upgrade.
6. **Si ya eligió método y luego elige producto, los datos de pago salen de
   frente, sin repreguntar.**
7. Después, el producto upsell y la postventa, igual que las demás.

### Reglas transversales de todo el recorrido

- **Repreguntar es innecesario cuando el cliente ya recibió datos de pago o ya
  eligió método.** Lo ya decidido no se vuelve a preguntar.
- **Casi nadie escribe signos de interrogación.** Cuidado con confundir una
  pregunta con una afirmación, y al revés. Hay reglas estructuradas para esto;
  no son perfectas, pero funcionan.
- Cada producto tiene sus reglas establecidas y funcionales «hasta donde hemos
  podido llegar». Solo se hacen cambios ligeros y quirúrgicos para no malograr lo
  que ya se logró.

### Y la frase que lo resume, con sus palabras

> «Ninguna modificación debe joder el comportamiento funcional del bot. Siempre
> revisar en qué puede afectar el cambio, qué puede destruir. Cada cambio hacerlo
> pensando, sin negligencia, y verificar si hay una propuesta mejor **que no
> destruya lo que funciona**.»

---

## Cómo funciona el bot — la versión larga del dueño

Dictado por Alberto el 2026-09-13, ampliando el recorrido de arriba. **Lo que
está aquí manda sobre cualquier suposición sacada del código.** Y él lo dice
expreso: aquí no está todo — hay variables del comportamiento del comprador que
no caben en un texto. Ante la duda, preguntarle.

### Abreviaturas que él usa

| Escribe | Significa |
|---|---|
| **-OB-** | La modalidad Order Bump |
| **-DOU-** | La modalidad Doble Oferta + Upsell |
| **lineal** | La modalidad Lineal |

Y hay que responderle con esas mismas abreviaturas, para que no se confunda.

### Los productos y sus categorías

Él vende productos y los guarda en una sección del editor, **de 1 a 100**, cada
uno con su contenido. Después, **con un selector**, decide qué categoría le toca
a cada uno en la venta:

| Categoría | Qué es |
|---|---|
| **BÁSICO** | El producto base |
| **COMPLEMENTARIO** | **No tiene precio propio.** Es un plus que se une a otro producto para subir el ticket |
| **FULL** | El básico + el complementario |
| **ORDER BUMP** | El producto que se vende DESPUÉS de la compra inicial |

**Ojo con la palabra «order bump»:** él la usa para dos cosas y hay que
distinguirlas por contexto — el **producto** y la **etapa**. Igual con «upsell»:
la **etapa** es la que va después de la venta, y el **upsell** es el producto que
se ofrece ahí.

### Las intros, por modalidad

| Modalidad | Intros | Qué presenta |
|---|---|---|
| **lineal** | 1 | Un solo producto. Con esa intro la presentación queda completa |
| **-DOU-** | 1 | Los DOS productos, básico y full, desde el primer mensaje |
| **-OB-** | 2 | La primera presenta el básico. La segunda —la «intro de order bump»— **revela el producto oculto** |

**En -OB-, la segunda intro se suelta solo cuando el cliente elige método de pago
o muestra claramente que quiere pagar.** Y esa segunda intro **no entrega los
datos de pago**: presenta el full y le da a elegir entre básico y full.

### Qué pasa al terminar cada intro

Todas terminan pidiendo que elija método de pago, y eso es modificable con los
**cuadritos de decisiones**, que ejecutan lo que él programe según la respuesta.

- **lineal** — elige método → datos de pago. Si no elige, el modelo lo acompaña
  hasta la compra, y cuando acepta se le reenvían los datos.
- **-OB-** — elige método → sale la segunda intro con el producto oculto → elige
  básico o full → datos de pago.
- **-DOU-** — elige entre los dos productos, o método de pago. Normalmente la
  intro cierra con esa pregunta.

**En las tres:** si el cliente no contesta lo que se le pidió, el modelo conversa
y lo lleva a la venta. Eso ya funciona.

### Lo que pasa después, y ya funciona bien

- **lineal** — tras la compra, a los minutos que él configure, se presenta el
  **producto upsell** con botones de sí/no.
- **-OB-** — el cliente puede elegir full y cambiar al básico, o al revés. Puede
  pagar el básico y después **completar para el full** («el upgrade»); el bot lo
  maneja bien. Y después de la compra llega el upsell. **En la etapa de upsell
  también se puede hacer el upgrade**, y el bot todavía logra vender el upsell
  después del upgrade.
- **-DOU-** — igual pero más simple, porque el cliente ya conoce los dos
  productos desde la intro. También admite upgrade antes o después del upsell. Y
  cuando dice «quiero el otro», el bot sabe cuál era su compra; **si no lo sabe,
  le pregunta a cuál se refiere.**

**El producto upsell tiene precio y contenido propios, y NO se puede adquirir
completando un pago anterior.** Se paga entero.

### El método de pago y el producto: lo que NO se repregunta

Esta es la regla que él más repite:

- Con **método ya elegido**, si el cliente decide comprar → **datos de pago
  directamente**, sin palabrería y de forma natural. Ya hay mensajes escritos
  para eso.
- El cliente **puede cambiar de método** («no tengo yape, tengo plin») → se le
  mandan los datos del nuevo método **con el precio del producto que tenga
  elegido**. Sin repreguntar nada.
- El cliente **puede cambiar de producto** teniendo método elegido → los datos
  del producto nuevo, con ese método. Sin volver a preguntar «¿qué producto
  deseas?», «¿deseas llevarlo?» ni «elige tu método».
- Si el bot pregunta «¿deseas adquirirlo?» y el cliente afirma —«ok», «sí»,
  «está bien», lo que sea— se reenvían los datos **en el acto**.

Y con sus palabras, las dos mitades de la misma regla:

> «Una afirmación a la pregunta **no detectar por palabra**: el bot tiene la
> suficiente inteligencia para saber cuándo han afirmado su pregunta.»

> «Pero ojo, tampoco irse al extremo de quedarse bloqueado en solo responder
> método y producto: que la conversación siga siendo fluida y no bucleada.»

### La maquinaria y el tornillo

> «Imaginemos que el bot es una maquinaria con tornillos y elementos armados. Al
> yo pedir un cambio, Codex *solo miraba el tornillo*: lo quitaba, lo ajustaba o
> lo cambiaba, pero no miraba qué pasaba si quitaba ese tornillo y el bot se
> caía. Es como decir: le quito el tornillo por uno más fino, y listo — quedaba
> la máquina tambaleando. A eso yo le llamo **mirar el tornillo**.»

Lo contrario de mirar el tornillo es mirar la máquina: por dónde más pasa esa
función, qué regla puede quedar muerta, qué etapa se mueve.

### Lo que él espera de cada implementación

- **Verificar primero si lo que pide es preciso o va a funcionar.** Si no va a
  resolver su problema, decírselo y **dar una salida mejor**.
- **Cuidar el super ahorro.** Si hace falta tocarlo un poco, no hay problema;
  pero si hay solución sin tocarlo, esa se propone y se aplica.
- **Sugerir siempre**, con el riesgo por delante. Con sus palabras: «yo vivo en
  una burbuja; tú conoces cosas que yo ni me imagino». No hacer de caballo que va
  donde se le ordena.
- **Respuestas claras y resúmenes entendibles, con cuadros.**

## Orden permanente: análisis antes de cambiar

Antes de implementar cualquier cambio, medir y comunicar sus consecuencias.
No basta con resolver el caso visible.

- Identificar todos los flujos, modalidades, canales, tareas programadas,
  estados persistidos y rutas equivalentes que el cambio pueda afectar.
- Explicar antes de editar si cambia un comportamiento, qué permanece igual,
  el riesgo de regresión y el impacto de consumo de tokens de IA.
- Proteger estrictamente todo lo ya probado: ventas, pagos, comprobantes,
  entregas, regalos, correos, reenvíos, seguimientos, conversaciones paralelas
  y conexiones de Meta. Una mejora no puede corromper una solución anterior.
- Reutilizar y extender la ruta existente; no añadir parches paralelos que
  alteren comportamientos establecidos sin revisar sus equivalentes.
- Crear un commit de reversibilidad antes de cambios de lógica y verificar en
  proporción al riesgo. Cuando se toquen tipos o lógica, ejecutar `npm run build`.
- Si hay que revertir una implementación, revertir solamente el commit o los
  archivos concretos de esa implementación tras inspeccionarlos. **Está
  prohibido** usar restauraciones amplias, `reset --hard`, checkout de ramas
  antiguas o cualquier acción que pueda reintroducir errores ya corregidos.
- Al finalizar un cambio aprobado, hacer commit claro y push a `main`, salvo
  indicación expresa contraria del usuario.

## Orden permanente: verificar contra el CONTENIDO, no solo contra el código

El código se comporta distinto según lo que haya escrito en `intro-data.yaml`.
Un cambio puede ser correcto leyéndolo y romper la venta con el contenido real.
Antes de dar por buena una corrección:

- **Abrir el contenido de hoy** (`git pull` primero: el operador edita en la
  nube) y comprobar el cambio contra los textos que hay escritos de verdad, no
  contra los de ejemplo. Dos modalidades con el mismo campo no tienen por qué
  usarlo igual: mirar QUÉ HAY ESCRITO en la otra antes de generalizar un arreglo.
- **Un campo con texto no es un campo con texto utilizable.** El editor guarda
  las burbujas en `body_variants` y deja `body` vacío; una burbuja cuyas
  variantes sean todas `<<plantilla>>` existe, pasa los filtros y no envía nada.
  Toda guarda que decida «esto está lleno» debe preguntar por lo que de verdad
  se va a enviar.
- **Silencio es un fallo, no un caso menor.** Si una rama SUSTITUYE algo
  —burbujas de pago, entrega, respuesta— hay que comprobar que lo que la
  sustituye salió realmente antes de dar el paso por hecho y de mover el estado
  de la conversación. Sustituir con nada deja al cliente sin datos de pago y la
  venta marcada como entregada.
- **Una línea de log no prueba que algo salió.** Escribir el log después de
  llamar al envío solo prueba que se llamó. Cuando el resultado importa, la
  función de envío debe informar de si envió, y el log decir lo que pasó.
- **Leer el log del cliente completo, no el trozo del síntoma.** Dos síntomas
  seguidos suelen ser un solo fallo: el segundo mensaje del cliente es la
  consecuencia del silencio del primero.
- **Dejar una prueba que fije el fallo**, en `scripts/prueba-*.mjs`, con el
  relato de lo que pasó. Si una prueba existente choca por un renombrado
  legítimo, se actualiza la afirmación conservando su intención; no se borra.

## Regla crítica: no regresiones

Este bot maneja ventas reales. No se implementa una función «y listo» ni se
acepta corregir un síntoma creando otra ruta paralela que pueda romper una
función ya probada.

- Antes de editar, identificar la ruta existente que ya resuelve el caso y
  extenderla o reutilizarla. No duplicar lógica de ventas, pagos, galería,
  entrega, correo, regalo, reenvío o seguimiento.
- Todo cambio debe preservar la funcionalidad de cada modalidad: **lineal,
  order bump, bioferta y doble oferta**. El contenido es editable; la lógica
  interna debe seguir siendo genérica para que este repositorio sirva como
  plantilla de futuros productos.
- Verificar los flujos afectados de principio a fin, incluyendo mensajes o
  comprobantes que llegan juntos, elecciones por botón y por texto, acciones
  programadas, reintentos y más de una conversación en paralelo.
- Para cualquier mejora de ahorro, prompt, cola o postventa, proteger en
  particular: aprobación única, enlace correcto una sola vez, pedido de correo,
  regalo, reenvío del material y memoria de que el cliente ya pagó.
- No publicar una corrección que solo arregla el caso visible pero deja sin
  revisar las rutas equivalentes. Si el alcance implica riesgo, explicar el
  riesgo y proponer una alternativa coherente antes de implementarla.

## Regla no negociable: verificación comercial antes de publicar

Una compilación correcta solo confirma que el código puede construirse; **nunca
demuestra que el bot siga vendiendo correctamente**. Ningún cambio se puede
considerar terminado ni pushear sin una verificación proporcional del flujo
comercial que pueda alcanzar, incluso cuando el archivo editado parezca ser solo
de editor, importación o interfaz.

- Antes de editar, declarar qué rutas de ejecución real quedan fuera de alcance
  y comprobarlo mediante imports, llamadas y datos persistidos; no basta con
  asumirlo por el nombre del archivo.
- Para toda modificación que pueda tocar, transportar, activar o seleccionar
  configuración de una modalidad, verificar el recorrido completo de cada
  modalidad afectada: primer mensaje, intro, seguimientos, elección, pagos,
  comprobante, aprobación, entrega, imágenes/documentos y reenvío.
- Las acciones programadas exigen una prueba de los tres pasos: se crean con el
  tiempo correcto, el worker/cron las recoge, y el emisor usa exactamente la
  misma modalidad, canal y contenido con que fueron programadas. Probar al menos
  Seguimiento 1 y Seguimiento 2 cuando se toque editor, canales, modalidades o
  configuración que pueda influir en ellos.
- Revisar las rutas equivalentes para Lineal, Order Bump, Bioferta y Doble
  Oferta, y para cada canal que use contenido propio. Nunca dar por probado un
  flujo de WhatsApp y asumir que Messenger o Instagram usan la misma fuente de
  datos.
- Si no es posible realizar una prueba funcional segura, **detener el push**,
  explicar con precisión qué no pudo comprobarse y pedir dirección. No afirmar
  que el comportamiento del bot está preservado basándose solo en `npm run build`.
- En el cierre de cada cambio, informar qué flujos concretos se verificaron y
  con qué evidencia. El contenido manual del usuario no se modifica para probar:
  usar simulador, conversación de prueba o datos aislados.

## Naturalidad del bot: no taparlo con textos fijos

- No reemplazar respuestas naturales del LLM por textos fijos rígidos salvo que
  el usuario lo pida explícitamente. Eso hace que el bot pierda naturalidad,
  suene técnico y rompa ventas. Si una modalidad responde bien con IA natural y
  burbujas legibles, replicar su disciplina de estilo en las equivalentes sin
  copiar su lógica interna ni sus opciones.
- Si una modalidad empieza a responder con mensajes cortados, densos o poco
  naturales, no taparlo con una respuesta fija. Primero comparar con una
  modalidad que ya funcione bien. La solución que funcionó fue: quitar el bypass
  fijo de `lineal + desconfianza`, devolver la respuesta al LLM natural, mantener
  el chunking normal y agregar una regla breve de disciplina comercial al bloque
  de la modalidad. Esa disciplina dice: responder primero la duda u objeción,
  escribir en párrafos/burbujas claras, no formar un bloque gigante, mantener
  tono profesional y cerrar con un siguiente paso suave.

## Comodines

Todo comodín nuevo debe quedar completo antes de publicarse: debe aparecer como
una previsualización entendible en el editor (nunca como texto crudo o marcador
genérico), resolverse en el envío real al cliente y usar el mismo formato en cada
ruta/canal que lo soporte. Verificar tanto un valor configurado como el estado
sin configurar; si falta un dato, el editor debe avisarlo claramente y el bot no
debe inventarlo. No dar por terminado un comodín solo porque se puede insertar en
un textarea.

## Convenciones

- Priorizar TypeScript y cambios pequeños y coherentes con la arquitectura
  existente.
- Mantener la UI alineada con el estilo actual del dashboard.
- No borrar ni revertir cambios que no hayas hecho tú.
- Evitar agregar dependencias si no son necesarias.
- Editar los archivos leyendo antes las líneas exactas. Nunca reescribir un
  archivo de código con PowerShell (`Set-Content` rompe los acentos y deja el
  proyecto sin compilar).

## Zonas sensibles

- `data/` contiene datos en tiempo de ejecución y no debe tratarse como código
  fuente.
- `.env` y secretos no deben commitearse.
- `build`, `.next` y otros artefactos generados no deben modificarse manualmente.

## Conexión Meta — reglas vigentes

El conector ya está implementado y vive en `/meta-connect`. Guarda cifrada la
configuración ingresada desde el dashboard y conserva las variables de EasyPanel
como respaldo para no romper conexiones antiguas. Reglas que siguen en pie:

- **Nunca asignar el Instagram Business Account ID a `INSTAGRAM_PAGE_ID`.** Ambos
  IDs deben conservarse separados: mezclarlos produce respuestas que entran pero
  no pueden salir.
- Etiquetas correctas del bloque para EasyPanel: `MESSENGER_PAGE_ID` e
  `INSTAGRAM_PAGE_ID` usan el Facebook Page ID; `MESSENGER_PAGE_ACCESS_TOKEN` e
  `INSTAGRAM_PAGE_ACCESS_TOKEN` usan el Page Access Token;
  `INSTAGRAM_BUSINESS_ACCOUNT_ID` usa el ID de la cuenta profesional de
  Instagram. Un token que empieza con `IGAAY...` es de Instagram Login y no debe
  colocarse como `INSTAGRAM_PAGE_ACCESS_TOKEN`.
- Messenger e Instagram pueden usar páginas de Facebook distintas. Detectar una
  página nunca debe cambiar la activa sin un clic del usuario, y nunca activar
  Instagram por defecto. Filtrar webhooks de páginas o cuentas no activas para
  impedir respuestas cruzadas.
- El dashboard debe abrir y el bot debe iniciar en modo de configuración aunque
  no exista ningún canal Meta conectado. La ausencia de WhatsApp, Messenger o
  Instagram no puede dejar la página caída ni impedir el acceso al editor.
- Mantener OAuth oficial: sin scraping, cookies ni mecanismos que pongan en
  riesgo las cuentas de Meta. Meta exige dos pasos manuales (crear/autorizar la
  app y confirmar Callback URL + Verify Token); el bot no debe intentar saltarlos.
- Nunca automatizar migraciones de números ni desconectar un número de otro
  proveedor.
- **No construir un enrutador central de webhooks** mientras los proyectos deban
  seguir independientes: sería un punto único de fallo.
- La configuración interna se cifra con `META_CONNECT_ENCRYPTION_KEY` si existe
  o, como respaldo, con `DASHBOARD_PASSWORD`. No cambiar la contraseña del
  dashboard en una instalación que usa el respaldo sin antes definir una clave
  estable, porque ya no se podrán leer las credenciales cifradas.

## Pendiente: comentario con palabra clave a Messenger

**No implementar hasta que el usuario lo solicite.** Reglas simples por página de
Facebook: si alguien comenta una palabra elegida (`INFO`, `PRECIO`, `QUIERO`),
enviarle un mensaje privado de Messenger ya configurado.

- Esa primera respuesta debe ser fija y no usar LLM, para no consumir IA en una
  automatización de palabra clave.
- Después, si la persona responde algo que no corresponde a una regla fija, debe
  continuar el flujo normal del bot con IA, contenido y modalidad de Messenger.
- Mantener esta automatización aislada de WhatsApp, Instagram y las modalidades
  de venta existentes; no alterar una conversación ya en curso.

## Un cambio de prompt NUNCA es quirúrgico. No presentarlo como tal.

En el motor un cambio es quirúrgico de verdad: se toca una rama y las demás no se
enteran, y se puede demostrar leyendo el código. **En el prompt no hay ramas.**
Todo lo que está en un bloque activo compite por la atención del modelo al mismo
tiempo, y la orden más larga o más explícita gana.

Pasó el 13 de septiembre de 2026: se añadió «cuando expliques las opciones,
recomienda» al bloque `ORDER BUMP ACTIVE` — el mismo bloque que dice «cuando
decida, registra la elección y cierra». El modelo se quedó explicando. El cliente
dijo «si ese quiero», el bot repitió la descripción y volvió a preguntar
«¿quieres que te indique cómo adquirirlo?». Dos «sí» para lo mismo: el semibucle
que el dueño había pedido quitar, de vuelta.

Antes de escribir UNA línea en un bloque de prompt:

- **Decir con qué otras órdenes del MISMO bloque puede competir.** Si compite con
  cerrar, con registrar una elección o con emitir un marcador, ahí no va.
- **Buscar un sitio que solo exista en ese turno**: la respuesta de una
  herramienta que solo se llama en esa situación, o un bloque `CURRENT TURN`. Lo
  que no está en el turno de la decisión no puede estorbarla.
- **Si lo que se quiere es que algo PASE, va al motor**, no al prompt. El prompt
  sirve para cómo suena, no para qué ocurre. Esto ya está dicho más arriba y se
  ha incumplido tres veces en una sola sesión.
- **Y no llamarlo quirúrgico.** Decirle al dueño que es un cambio de prompt, que
  su único examen es la conversación corrida, y que el script de pruebas NO lo
  cubre: ese script comprueba que el texto esté en el archivo, y que el texto
  esté no prueba nada sobre lo que el modelo hace con él.

## HECHO: se quitó el candado «solo lineal» de la etapa upsell (2026-09-15)

**Ya no está.** Se deja escrito aquí porque explica una regla que sigue viva y
porque es el ejemplo de cómo se cierra un pendiente de estos: con evidencia, no
con ganas.

**La evidencia que faltaba, y la trajo él.** Tres pantallas en paralelo en
**-DOU-**, las tres con la oferta del extra en pantalla. Dos contestaron
vendiendo; la tercera se fue a la postventa y le pidió otra vez la foto de un
comprobante **ya aprobado y entregado**, y siguió pidiéndola cuando él le dijo
dos veces que la había mandado.

```
convo 100  «este es otro»   salida=211 tk    5,4 s
convo  98  «este es otro»   salida=904 tk   22,4 s   ← se fue por las ramas
```

El mismo mensaje y el mismo prompt, resultado distinto: **una moneda cargada, no
un fallo que salte siempre.** Sus registros confirman que la sección entraba: el
prompt del 98 pasa de 7.157 tokens vendiendo a 10.563 en la etapa upsell.

**Lo que queda en pie, y hay que respetar si alguien lo toca:**

- **Qué arregla la exclusión.** Con la oferta del extra en pantalla, la sección
  `postventa` le dice al modelo que su papel de venta terminó y que redirija al
  material ya entregado. Por eso el bot contestaba «¿recibiste bien tu
  producto?» —o pedía un comprobante ya aprobado— y abandonaba la segunda venta.
- **Solo mientras está `ofrecido`.** Al aceptar, la sección VUELVE: ahí viven los
  reintentos de comprobante rechazado y hacen falta. Esa condición no se toca.
- **Vale para las seis, y así debe quedarse.** Las tres piezas de la etapa upsell
  —`isPostSale`, `upsell_state` y `seccionUpsell`— son iguales en todas las
  modalidades. Volver a meter una condición de modalidad sería escribir una
  diferencia que no existe.
- Lo comprueba `prueba-lo-decidido-no-se-repregunta.mjs`, que ahora exige lo
  contrario que antes: que NO quede ninguna condición de modalidad.

**La lección del cierre, que vale para el próximo pendiente.** El dueño no tuvo
que montar una prueba nueva: bastó con leer las tres pantallas que ya había
corrido. Dos contra una, con el mismo mensaje, es evidencia de sobra. Reproducir
a mano lo que sus registros ya demuestran le cuesta tiempo y créditos para llegar
al sitio donde ya estábamos.

---

# PARTE 2 — CÓMO ESTÁ HECHO EL PROYECTO

## Commands

```bash
npm install       # installs deps; compiles better-sqlite3 native bindings (~1 min)
npm run dev       # start dev server at localhost:3000
npm run build     # production build (uses in-memory SQLite to avoid DB lock)
npm run start     # start production server
npm run lint      # ESLint via Next.js
```

No test suite exists. TypeScript type checking runs implicitly during build.

## Architecture

### Stack

Next.js 16 (App Router) + TypeScript + React 19 + Tailwind 4 + better-sqlite3 (file-based, WAL mode). LLM calls go through the `openai` SDK pointed at OpenRouter.

### Data flow

```
Meta Cloud API ──webhook──▶ POST /api/webhook
                                 │
                          verifySignature (HMAC-SHA256)
                                 │
                          processWebhookPayload (src/lib/meta/handler.ts)
                                 │
                     withPhoneLock (serializes per phone)
                          │               │
                   tryWorkflowOnIncoming   generateReply (LLM)
                   (workflow/engine.ts)    (src/lib/openrouter.ts)
                          │
                   scheduleAction → scheduled_actions table
                          │
                   worker tick (every 2s setInterval)
                   + /api/cron/tick (external cron keepalive)
```

Incoming messages respond immediately with `200 OK` to Meta; all processing runs `void` in background. A phone-level mutex (`phoneLocks` map) serializes concurrent messages from the same sender.

### Database (`src/lib/db.ts`)

Single SQLite file at `data/messages.db`. Schema is created + migrated inline via idempotent `ALTER TABLE ... ADD COLUMN` blocks on startup. Key tables:

- `conversations` — one row per WhatsApp number; holds `state` (workflow FSM), `mode` (AI/HUMAN), payment tracking, NocoDB sync fields, ad attribution
- `messages` — chat history with media support and `wa_status` (sent/delivered/read/failed) updated monotonically
- `scheduled_actions` — queue of deferred bot actions (intro steps, followups, payment steps). Polled every 2s by the worker
- `processed_webhook_messages` — dedup table keyed by `wa_message_id`

During `next build`, an in-memory SQLite is used (controlled by `NEXT_PHASE === "phase-production-build"`) to avoid locking the live DB.

### Workflow engine (`src/lib/workflow/`)

The bot runs a sales funnel with explicit FSM states defined in `WorkflowState` (db.ts):

```
new → awaiting_response → intro_running → intro_done
    → payment_done → awaiting_order_bump_choice
    → payment_approved → awaiting_email → awaiting_gift_consent → awaiting_facebook_comment
    → awaiting_bioferta_choice
```

Key files:
- `engine.ts` — `tryWorkflowOnIncoming()` (main FSM dispatch) + `executeAction()` (worker handler). Returns `true` when the workflow handled the turn (LLM is suppressed), `false` to fall through to LLM.
- `config.ts` — loads `config/intro-data.yaml` (hot-reloaded, no restart needed). Defines all content: greeting, intro sequences, payment responses, followup sequences, order bump, bioferta, gift mechanic, country redirect.
- `payment.ts` — `register_payment_amount` tool definition for LLM; validates comprobantes, approves/rejects, triggers product delivery.
- `worker.ts` — `tick()` polls `scheduled_actions` every 2s; processes max 1 action per conversation per tick to preserve delays.
- `sender.ts` — wraps Meta Graph API calls (`sendBotText`, `sendBotButtons`, `sendBotMediaFromDrive`).
- `quiet-hours.ts` — followup scheduling: time slots, 4h minimum gap, anti-burst queue, quiet hours (no messages in dead hours).

### Workflow configuration (`config/intro-data.yaml`)

This is the active bot configuration. Sections with `<<PLACEHOLDER>>` strings are silently skipped — the bot won't run broken sequences. All content changes (text, media URLs, pricing, followup schedules) are made here without redeployment.

Key sections:
- `greeting`, `intro_sequence`, `intro_sequence_2/3`, `intro_enabled` — A/B intro variants chosen randomly
- `payment_responses.yape/bcp_transferencia/efectivo` — step-by-step payment instructions
- `followup_sequences` — up to 3 re-engagement sequences, each with `delay_minutes_from_first_message`
- `followup_schedule.slots_peru` — allowed send times (e.g. `["12:00","18:00","21:45"]`)
- `order_bump.combo/basico` — intermediate upsell offer (intercepts first payment method selection)
- `bioferta_doble` — double-product offer variant
- `payment_approved_sequence` — delivery steps after approved payment
- `gift_mechanic` — post-sale Facebook engagement flow
- `country_redirect.ecuador` — messages sent when `<<PAIS: ecuador>>` marker is emitted by LLM

### El reparto por puestos, y dónde acaba cada cosa

Esto es lo que más se ha malentendido, y lo que más caro ha salido. **El YAML
guardado engaña:** `repartirPorEtiqueta` (en `config.ts`) reescribe las cajas en
cada carga, a partir de `biblioteca_de_productos` + `alineacion_por_modalidad`.
Leer el archivo a ojo da el valor de antes del reparto.

**Quién ocupa cada hueco** — tabla `CONTENIDO_DEL_PUESTO`:

```
lineal:              { unico: 1 }
upsell:              { unico: 1 }
order_bump:          { basico: 1, complementario: 2 }
doble_oferta_dos:    { full: 1,   basico: 2 }     <- OJO: el 1 es el CARO
doble_oferta_upsell: { full: 1,   basico: 2 }     <- OJO: el 1 es el CARO
bioferta:            { basico: 1, complementario: 2 }
```

**Y dónde se escribe cada hueco:**

| Hueco | Nombre | Contenido | Galería |
|---|---|---|---|
| 1 | `product_name` | `course_content` | `image_gallery` |
| 2 | `product_name_2` | `course_content_2` | `image_gallery_2` |
| — | | | `pack_gallery` ← el producto que juega de **full**, y solo cuando `full` no tiene hueco |

**Las cajas que nadie refresca son la trampa de este proyecto.** Una caja que una
modalidad llena y otra no abre se ve igual que una caja vacía, y nadie avisa. Ha
pasado tres veces:

- `course_price_soles` — no se refresca en -DOU- ni en -OB-, y de ahí salió un
  importe que no era de ninguna opción.
- `image_gallery_2` — su condición nombraba tres modalidades y se olvidaba de la
  cuarta: el bot enseñaba una muestra de las dos que había marcadas.
- `pack_gallery` — misma familia.

**La regla que sale de ahí:** una condición que nombra modalidades a mano es un
fallo esperando. Preguntar por el DATO —¿hay segunda opción?, ¿qué puestos tiene
esta modalidad?— en vez de por el nombre de la modalidad.

### HECHO: se explica por escrito y al final se ofrecen las imágenes (2026-09-17)

**LA CONDUCTA, que es la que manda:** a la intención de conocer el contenido, el
bot **contesta por escrito como siempre** y **cierra ofreciendo enseñar las
imágenes**, con sus propias palabras. Si el cliente acepta, **las manda el
motor**: la tanda completa, en orden, con la burbuja de cierre del dueño. Y si la
galería está vacía o sin checks, **no se ofrece nada**: texto y punto.

Con las palabras de Alberto:

> «Que a la primera intención del cliente de saber qué contiene, el bot le dé la
> información como de costumbre, y al final de la explicación le diga "¿deseas ver
> unas imágenes?". Esto solo lo va a decir cuando haya imágenes en la galería; si
> no hay imágenes ni check activo no se ofrece, se envía texto y punto. Yo
> necesitaba que el bot le enseñe las imágenes cuando pregunte, ya que una imagen
> habla más que mil palabras.»

Y sobre quién redacta la frase:

> «Deja que el agente diga lo que desee en ese aspecto.»

**ANTES DE ESTE DISEÑO HUBO TRES QUE NO FUNCIONARON, y es lo más valioso de esta
entrada.** Los tres intentaban que la imagen **sustituyera** al texto, y ninguno
sobrevivió a su conversación real:

1. **«Contesta en texto Y manda las imágenes».** El modelo recibía dos órdenes y
   cumplía la principal: escribir. *En el prompt, una orden «además de» pierde
   siempre contra la orden principal.*
2. **La regla dentro de los bloques de -DOU- y -OB-.** Él probó en **lineal**, que
   no recibe ninguno de los dos: texto y ninguna imagen. Era la lista que se
   olvida de una modalidad, ahora en el prompt.
3. **Quitarle la razón a las tres órdenes que mandaban contestar por escrito**,
   con una salvedad en cada una. Tampoco: seguían compitiendo.

> **LA LECCIÓN, y cuesta cuatro intentos:** en el prompt no se gana una pelea
> entre órdenes. **Si el cambio necesita que una instrucción existente pierda, el
> diseño está mal.** El que funcionó no le quita el turno a nadie: deja intactas
> todas las órdenes de contestar por escrito y solo **añade un cierre**.

**Y LA PARTE QUE DE VERDAD SOSTIENE ESTO ESTÁ EN EL MOTOR, no en el prompt.**
Como la frase la redacta el modelo, el motor no puede reconocerla leyéndola. Se
midió ejecutando la función real contra diez formas de ofrecer: **falló 7 de 10,
incluida la frase textual del dueño** —«¿deseas ver unas imágenes?»: `deseas` no
estaba en la lista, y `fotos` tampoco porque solo estaba `foto`—. Sin arreglar
eso, el bot ofrece, el cliente dice «sí» y no pasa nada: el fallo de HELLO1 otra
vez.

**El primer arreglo fue pedirle al MODELO que marcara su propia oferta** con
`<<OFRECI_IMAGENES>>`. **Falló, y es la quinta lección de la misma familia.** En
sus tres pruebas en paralelo del 17/09 la marca aparece **una sola vez**: ofreció
bien en las tres, la marcó en una. En las otras dos el «sí» se fue al modelo —una
contestó texto y la otra tiró del camino de la foto suelta, que manda **UNA** por
diseño, así que de sus dos fichas marcadas recibió una—.

> **Si la parte que DECIDE depende de que el modelo se acuerde de algo, no está
> hecha.** Da igual que el mecanismo sea correcto: el examen no es si funciona
> cuando obedece, es cuántas veces de diez obedece.

**Lo que sí funciona: el motor se lo apunta a sí mismo.** Quien le pide ofrecer es
el motor —es la línea `[wf:oferta-imagenes]` del registro, y salió en las tres—,
así que lo sabe sin preguntarle a nadie. En cada llamada al modelo se apunta si a
ese turno se le inyectó la regla (cliente preguntando por contenido **y** muestras
pendientes); en el turno siguiente, un «sí» corto lo atiende el código y **el
modelo ni ve ese turno**, así que el camino de la foto suelta no puede
secuestrarlo. `apuntarQueSeLePidioOfrecerImagenes` en `openrouter.ts`.

**Hay tres señales, y las tres se conservan**: la del motor (la única que no
depende del modelo), el marcador, y la lista de palabras de siempre. Ninguna
decide sola y no se quitó ninguna.

Cuatro cosas que no se tocan:

- **La nota del motor dura UN turno** y **se consume al leerla**, para que un «sí»
  de otra cosa no saque fotos la semana que viene.
- **El marcador se limpia ANTES que ningún otro**, porque más abajo hay puertas
  que terminan el turno —Ecuador, el menú de pago— y se le escaparía al cliente.
- **Solo dispara si queda alguna muestra por ver**, y al enviarlas todas quedan
  marcadas.
- **El motor de venta corre antes** que esa puerta, así que un «sí» que de verdad
  era para comprar lo atiende él.

**Y el orden lo manda la galería, no la lista de temas.** La puerta del «sí»
recorría `product_info_topics` y mandaba las muestras en el orden en que
estuvieran escritos los temas — con su contenido de hoy en -DOU- eso mandaba el
**full primero**, justo al revés de su regla (`a806230`). Ahora se recorre la
galería, que ya viene ordenada por puesto.

**Y hay dos reglas de etapa que hay que respetar aquí**, porque estaban a medias:

- La **secuencia** de muestras debe pedir la galería **excluyendo el producto
  oculto** del order bump, igual que el otro camino. Se pregunta a
  `elOrderBumpSigueOculto`, que vive en un solo sitio para los dos.
- El freno de **«ya enviadas» es por etapa, no para siempre**: al destapar el
  order bump aparecen fotos que el cliente no ha visto. Se pregunta si queda
  alguna muestra de ESA etapa sin ver — comparando **en minúsculas**, que es como
  se guardan los temas enviados.

**Los frenos no están en el criterio: están en el motor.** Una sola vez, nada si
la galería está vacía o sin checks, nada después de la compra, y el producto
oculto del order bump sigue oculto. Son candados de código.

**Qué quedó probado y qué no.** Probado, ejecutando el código real:
`prueba-el-si-a-las-imagenes-ofrecidas.mjs` —el «sí» manda la galería aunque el
modelo redacte la oferta como quiera, y no dispara con un «no», con una pregunta
de precio, sin galería ni con las muestras ya vistas—, más
`prueba-las-muestras-van-por-etapa.mjs` y el recorrido completo en lineal, -OB- y
-DOU-. **No probado:** que el modelo redacte la oferta y emita el marcador. Eso
solo lo enseña la conversación corrida. Va en su propio commit para poder
revertirlo con una línea.

### Las muestras de imagen: quién decide enviarlas

Hay **dos caminos distintos** y se confunden:

- **`<<MEDIA: topic>>`** — UNA imagen suelta, la elige el modelo de una lista que
  se le inyecta con el producto de cada muestra. Tiene freno: nunca más de una por
  respuesta, y nunca sin que la pidan.
- **`enviar_info_contenido`** — la SECUENCIA completa: todas las muestras
  configuradas, en orden, y al final el cierre. Es la que manda «las dos
  imágenes».

**Ninguna se dispara sola: las llama el modelo.** El motor solo decide si la
galería se le enseña, con `looksLikeProductContentTurn` / `looksLikeMediaTurn`
(en `openrouter.ts`). **Ese detector es MUY ancho** —incluye `llega`, `recibir`,
`adquirir`, `otro`, `combo`— así que sirve para enseñar la lista, pero **no sirve
como disparador de envío**: conectarlo directamente reproduce el fallo de
«disparaba la imagen por cualquier palabra rara».

**Si la galería está vacía o sin checks, el bot ni se entera de que existe** —hay
un bloque que se lo dice— así que no la ofrece. Eso ya funciona.

### LLM integration (`src/lib/openrouter.ts`, `src/lib/system-prompt.ts`)

Uses `openai` SDK pointing at `https://openrouter.ai/api/v1`. The system prompt (hardcoded in `system-prompt.ts`) is templated with `{{PRODUCTO}}` and `{{PRICE}}` at runtime. The LLM has one tool: `register_payment_amount` — called when it detects a payment receipt image, which triggers `executeRegisterPayment()` in `payment.ts`.

LLM markers the engine intercepts in handler.ts:
- `<<PAIS: ecuador>>` → sends country_redirect messages
- `<<METODOS_PAGO>>` → sends payment buttons/text menu
- `<<REENVIAR_MATERIAL>>` → resends approved delivery content

### Dashboard (`src/components/`, `src/app/page.tsx`)

React SPA rendered at `/`. Key components: `ConversationList` (Kanban/list views), `ConversationPanel` (chat UI with mode toggle AI↔HUMAN), `DashboardHeader` (filters, ROAS panel). Auth is optional basic auth via `src/lib/auth.ts`.

### Integrations

- **NocoDB** (`src/lib/nocodb.ts`, `src/lib/leads-sync.ts`) — optional CRM sync; lead labels (warm/hot/pago/reclamo) pushed on each state change
- **Meta CAPI** (`src/lib/meta/conversions.ts`) — Contact + Purchase events for ad attribution (CTWA click IDs captured from first message)
- **Email** (`src/lib/email.ts`) — sends course access emails via SMTP (nodemailer)
- **Notifications** (`src/lib/notifications.ts`) — admin alerts (e.g. 3+ failed payment attempts)

### Deployment

EasyPanel (no Docker). `Procfile` + `nixpacks.toml` configure build (`npm ci && npm run build`) and start (`npm run start`). Data lives in a persistent volume at `/app/data`. An external cron (cron-job.org or UptimeRobot) must hit `GET /api/cron/tick` with `Authorization: Bearer $CRON_SECRET` every 1-5 minutes to keep the worker alive when the container sleeps.
