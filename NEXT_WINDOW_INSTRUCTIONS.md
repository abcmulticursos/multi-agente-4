# Relevo — dónde se quedó el trabajo

> Escrito el **24 de septiembre de 2026**, al cerrar la sesión anterior y a
> petición del dueño: «voy a cerrar sesión para que otro Claude continúe el
> trabajo, necesito que continúe viendo esto».

## LO PRIMERO, ANTES DE TOCAR NADA

1. **`git pull`.** Él edita el contenido desde el panel, en la nube. Lo que hay
   en disco puede estar viejo antes de empezar.
2. **Lee `CLAUDE.md` entero.** Es el único archivo que manda aquí: sus órdenes
   permanentes y cómo está hecho el proyecto. Este documento NO lo resume ni lo
   sustituye — solo dice dónde se quedó el trabajo.
3. **Se trabaja SOLO en `BOT ALBERTO 2`.** `BOT ALBERTO 1` y `BOT FRANKO` están
   quietos.

## CÓMO ESTÁ CONFIGURADO SU BOT AHORA MISMO

Medirlo, no suponerlo — pero para orientarse:

- Modalidad **lineal**, con el selector **PRESENTA: `dos_juntas`** encendido.
- Asientos: `unico` y `basico` = QUIMICA EN ACCION. **`full` y `upsell` VACÍOS.**
- Como el full está vacío, el bot **vende uno solo**, y eso es correcto: así se
  arregló el 24/09.

**Consecuencia para las pruebas:** `prueba-deploy` sale ROJA por eso. No es una
regresión: es su asiento FULL vacío. Y el recorrido con comprobante no puede
aprobar, porque su captura de prueba es de S/. 10 y el producto cuesta S/. 20.

## LA BATERÍA

**235 verdes. 7 rojas, TODAS conocidas:**

| Roja | Qué es |
|---|---|
| `prueba-deploy` | su asiento FULL vacío (arriba) |
| `prueba-acepto-el-extra-y-no-llego-nada` | de antes |
| `prueba-el-cajon-de-pago-cobra-lo-de-su-paso` | su `{{METODO_DE_PAGO_1}}` en un cuadrito |
| `prueba-elegir-por-el-numero` | de antes |
| `prueba-la-etapa-upsell-en-cualquier-modalidad` | FLORCITAS AMARILLAS OB sin entrega |
| `prueba-regalo-no-se-mete-en-medio` | de antes |
| `prueba-regatear-no-es-elegir` | de antes |

**Si aparece una OCTAVA, esa sí es tuya.**

## LO QUE SE HIZO EL 23 Y 24 DE SEPTIEMBRE

Cada uno en su commit, con el porqué dentro. De lo más reciente hacia atrás:

- `5faf58b` la bandera se escribe (como los ads), sale en el título y **sobrevive
  al guardado** — la ruta de guardado reconstruye el contenido campo por campo y
  se comía lo que nadie nombraba ahí
- `5978213` la bandera del seguimiento llega a sus cajones, y la oferta también
- `b481130` **la bandera dirige intros y seguimientos**, como la etiqueta de ads
- `ef7ac2d` el guardarraíl no lee los enlaces como precios, ni vigila sin venta
- `1a10dab` el nombre del producto no cae al texto de fábrica
- `d684f42` el precio solo viaja si queda algo que vender; el aviso, una vez
- `ff87b1a` el selector de banderas siempre a la vista (+ Escape lo cierra)
- Antes: la entrega con «PRESENTA:», que era el fallo gordo — pagaba y no
  recibía nada; «COMO -OB-» comportándose como -OB-; el precio del FULL; el
  descuento en el visor de su etapa.

**El hilo de todos ellos es el mismo fallo de esta casa:** preguntar por el
NOMBRE de la modalidad en vez de por el DATO. Si aparece algo raro con el
selector violeta, busca por ahí primero.

## LO QUE ESTÁ ABIERTO

### Pendiente suyo (contenido, no código)

1. **Sentar un producto en el asiento FULL** si quiere probar -OB- o -DOU-.
2. **La entrega de TINTAS PEPITO** sigue con el texto de fábrica («Opción 1:
   Entrega para… (Plantilla…)»). Ahora SÍ se envía, así que le llegaría eso.
3. **La etapa upsell está encendida pero vacía** — sin nombre, precio 0, sin
   entrega. Por eso el bot no la ofrece, y hace bien.

### Decisión suya, sin tomar

**Los horarios de seguimiento son de Perú para todos.** Con las banderas ya
puestas esto empieza a doler: lo que en Perú sale a las 21:45, en Argentina sale
a las 23:45. Las tres salidas están en `PLAN-BANDERA-COMO-ETIQUETA.md`.

### Planes escritos y NO empezados

- **`PLAN-TRAMOS-CAMINO-PERSONALIZADO.md`** — los TRAMOS: grupos de burbujas
  guardados, con una acción «continuar con el tramo ___» y un reloj. Dijo
  expresamente: «lo vemos luego».
- **`PLAN-MEDICION-META-CAPI.md`** — quitar el identificador de la WABA de los
  eventos, y el `page_id` por conexión. Medido; dijo «déjalo por ahora».
- **`PLAN-BANDERA-COMO-ETIQUETA.md`** — ya implementado en su mayor parte; queda
  la fase de horarios.

### Reportado y SIN tocar (él no lo ha pedido)

La misma ruta de guardado se come, desde antes, dos cosas de la familia de los
anuncios:

1. **`ad_keys` del seguimiento en Canales** — el cajón (variante) sí se guarda,
   el seguimiento entero no.
2. **`ad_routing_enabled`** de seguimientos y variantes, en Canales y en la
   modalidad. El interruptor existe en pantalla, el motor lo obedece
   (`engine.ts:495` y `:538`), pero no se escribe en ningún sitio: al refrescar
   vuelve a ON.

### Fallo conocido, sin arreglar

**Dos preguntas abiertas a la vez.** El modelo puede cerrar con una pregunta de
venta mientras el motor espera un sí/no (el del regalo), y la respuesta del
cliente se va a la que no era. Le pasó el 24/09: dijo «ok» a la pregunta del
modelo y aceptó el regalo sin querer. No se ha tocado.

## TRES TRAMPAS EN LAS QUE CAÍ, PARA QUE NO SE REPITAN

1. **Reescribí `engine.ts` con PowerShell** y rompí 2.041 líneas de acentos.
   `CLAUDE.md` lo prohíbe expresamente. Se restauró con `git checkout` y se
   rehízo con la herramienta de edición. **No uses `Set-Content` sobre código.**
2. **Corrí la batería entera por costumbre** cuando bastaban las dos pruebas del
   cambio. Él lo tiene dicho: proporcional al riesgo.
3. **Empecé a implementar por una pregunta suya.** Una pregunta es una pregunta;
   sin un «procede» no se toca código.

## LO QUE ÉL ESPERA DE CADA ENTREGA

Está todo en `CLAUDE.md`, pero lo que más repite:

- **Correr `recorrido-completo.mjs`** antes de decir que algo está arreglado, si
  toca motor, prompt o contenido. `--comprobante=<foto>` para llegar a la
  entrega; `--quedarse=combo|basico` para elegir con qué opción termina.
- **Explicarle lo implementado sin tecnicismos**, por fases, y decirle «esto
  quedó probado, esto no».
- **Avisar cuando está subido**, no pedirle que deploye antes.
- **Medir antes de proponer.** Sus registros de EasyPanel ya son la evidencia:
  no le pidas que reproduzca lo que ya te mandó.
