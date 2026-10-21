# PLAN — El bot como un CRM: piezas sueltas y etiquetas que las conectan

Instrucciones para quien continúe (Codex, otra ventana, u otra persona). Está
escrito para poder ejecutarse **sin haber estado en la conversación**.

Los hechos sobre el código están **verificados leyéndolo**, no supuestos. Las
funciones y los campos se citan **por nombre**: los números de línea cambian,
los nombres no.

> ⚠️ **Antes de tocar nada, lee `AGENTS.md`.** Ahí están las órdenes permanentes
> del dueño. Y `PLAN-PAGOS.md` § 0, con las reglas de la casa. Aplican igual
> aquí y no se repiten.

---

## 1. LO QUE ALBERTO QUIERE, EN SUS PALABRAS

> «Tener en el editor un lugar donde se almacenan todos los productos, 1, 2, 3,
> 4, 5, 6, 7 etc. Yo poder etiquetar el producto como base, full, upsell etc.
> Al yo cambiar de modalidad sigan en mi base de datos de productos los
> productos que creé.»

> «Si yo quiero vender lineal, solo etiqueto mi producto y vendo en lineal. En
> el caso que se me antoje ponerle un upsell, etiqueto el producto que deseo que
> sea el upsell.»

> «Al cambiar de modalidad lo único que debería cambiar es la modalidad mas no
> los datos. Y si alguna modalidad tiene doble producto vendiendo y la cambio a
> lineal debería desactivar, mas no borrar ni reemplazar la información.»

Y sobre los recorridos:

> «Quiero tener mis propios intro datas, seguimientos, llenadas a mano. He visto
> en otros CRM que ellos ya tienen sus intro datas llenas con todo y seguimiento
> y ellos eligen cuál conectar. Yo lo tengo ya incorporado y no me gusta, porque
> cuando cambio de modalidad el texto aparece. En los CRM lo tienen preparado y
> apagado.»

> «Creo una tarjeta, al tocarla se abre al estilo editor de canales un pop up
> que me permita llenar todo el recorrido desde el inicio hasta la entrega. Si
> yo deseo duplico esa tarjeta y le cambio contenido, yo le pongo título:
> Intro Flores de Papel, Intro lectoescritura, etc.»

> «¿Una etiqueta puede funcionar como conector si tengo piezas sueltas?»

Y la restricción que manda sobre todo lo demás:

> «Recuerda que tenemos las herramientas funcionando, por lo cual no se debería
> reestructurar el bot, sino usar capas usando lo que funciona y conectarlas.»

---

## 2. LA IDEA, EN UNA FRASE

**Las piezas viven una sola vez, sueltas y con nombre. Una etiqueta dice qué
papel juega cada una. La modalidad solo decide qué papeles existen.**

Nada se copia por modalidad. Cambiar de modalidad cambia qué papeles se usan,
no el contenido.

---

## 3. LO QUE YA ESTÁ HECHO (verificado en el código)

### 3.1 La biblioteca de productos existe y es GLOBAL

- El campo es `biblioteca_de_productos`, en la RAÍZ de `WorkflowConfig`
  (`src/lib/workflow/config.ts`).
- **No está** en `ModalidadTemplateEditor` ni en `ModalidadTemplate`, así que
  **no se copia por modalidad**: es una sola lista y sobrevive al cambio.
- El tipo de cada producto es `ProductoDeLaBiblioteca`: `id`, `name`,
  `aliases`, `price_soles`, `discount_price_soles`, `market_price`, `regalos`,
  `delivery`, `image_gallery`, `course_content`, `etiqueta`.
- La API la lee y la escribe en `src/app/api/workflow/route.ts` (búscala por
  `biblioteca_de_productos`). **Está nombrada en los DOS sitios**, el de leer y
  el de escribir: ese archivo guarda por lista y lo que no está nombrado se cae
  al guardar, en silencio y sin error.

### 3.2 El reparto por etiqueta existe y es un solo punto

- `repartirPorEtiqueta(config)` en `src/lib/workflow/config.ts`.
- Se llama en `loadWorkflowConfig`, en la MISMA línea donde ya se aplicaba la
  capa del canal:

  ```ts
  const runtimeConfig = applyChannelContent(repartirPorEtiqueta(config), channel);
  ```

- **El orden importa**: etiquetas primero, canal después. Las dos escriben en
  las mismas cajas y el canal es la capa de más arriba.
- El archivo se lee del disco en UN solo sitio de todo el proyecto
  (`readConfigFromDisk`, llamado solo por `loadWorkflowConfig`), y hay ~170
  llamadas a `loadWorkflowConfig()`. Todas ven el resultado del reparto. **Por
  eso el motor no se entera de que existen las etiquetas.**
- **Vacía no hace nada.** Sin biblioteca, o con todos sin etiqueta, devuelve la
  configuración tal cual. Ésa es la garantía de que un bot que no use esto se
  comporta igual que antes.
- Dos con la misma etiqueta: gana el primero y queda escrito en el registro.

### 3.3 La pantalla existe

- `BibliotecaDeProductos` en `src/app/editor/page.tsx`, arriba del todo en la
  pestaña **Contenido**.
- Cada fila: producto, precio, pasos de entrega y el desplegable del papel.
  Se abre en ventana con nombre, alias, tres precios, contenido, entrega y
  galería.
- `PAPELES_DE_PRODUCTO`: `""` (Sin usar), `basico`, `full`, `upsell`,
  `upsell_2`.
- `papelesDeLaModalidad(modo)` decide cuáles se ofrecen.
- **Un papel, un producto**: al etiquetar uno, el que lo tenía pasa a «Sin usar»
  en el mismo gesto y se dice en pantalla.
- `SiLoLlenaLaBiblioteca` vacía el cajón viejo del papel tomado y dice quién lo
  llena. `AvisoDeQueLaBibliotecaLlena` avisa sin vaciar, para el cajón del
  upsell, que mezcla producto y etapa.
- `PreciosDelProducto` enseña, país por país, qué precio se va a cobrar y de
  dónde sale, con rojo donde falta.

### 3.4 Las piezas del recorrido YA son tarjetas con nombre e interruptor

Esto es importante y es el ochenta por ciento del trabajo del § 5:

| Pieza | Tipo | Tiene nombre | Tiene interruptor |
| --- | --- | --- | --- |
| Intro | `ChannelIntroGroupEditor` | `name` | `enabled` |
| Seguimiento | `EditorFollowup` | `name` | `enabled` |
| Entrega | `ChannelDeliveryGroupEditor` | `name` (+ `key`) | `enabled` |

Las intros además llevan `weight` (reparto) y ruteo por anuncio (`adName`,
`adId`, `adKeys`, `adRoutingEnabled`). Los seguimientos llevan
`delay_minutes_from_first_message`, `ignore_quiet_hours`,
`ignore_late_lead_defer` y variantes.

**Lo que falta no es «poder tener varias»: es agruparlas y sacarlas de las
capas.**

### 3.5 Nada se borra al cambiar de modalidad

- Cada modalidad guarda lo suyo en `modality_templates[modo]`.
- `noPisarConVacio(anterior, nueva)` se niega a guardar una plantilla vacía
  encima de una que tenía contenido. **Se puso porque un día eso borró el
  trabajo de Alberto**: la capa de `doble_oferta_upsell` se quedó sin su
  producto, su galería y su contenido.
- O sea, su regla de «desactivar, no borrar» **ya es la regla de la casa**.

---

## 4. LO QUE FALTA — FASE A: TERMINAR LOS PRODUCTOS

Esto es la mitad del problema y hay que hacerlo **antes** que la fase B.

### A.1 La etiqueta debe llenar también el contenido del producto

**El síntoma que arregla**, en sus palabras: «al cambiar de lineal a order bump,
aparece otro producto».

**La causa**: `repartirPorEtiqueta` llena hoy `order_bump.combo`,
`order_bump.basico`, `doble_oferta_dos.*` y `upsell`. **No llena**
`product_name`, `course_content` ni `image_gallery`, que son los tres campos de
la pestaña Contenido y viven **por modalidad**. Por eso asoma el producto viejo
de esa capa.

**Qué hacer**: que el papel del producto BASE llene además esos tres campos, y
el del segundo producto llene `product_name_2`, `course_content_2` e
`image_gallery_2`.

**Y aplicar `SiLoLlenaLaBiblioteca` a esos tres campos.** Si se dejaran
editables, uno escribe ahí, guarda, y el bot sigue enviando lo del producto
etiquetado. Sin error y sin aviso.

### A.2 Faltan papeles

- **`unico`** (o `base`) para Lineal: hoy Lineal solo puede etiquetar `upsell`,
  así que su producto único no se puede etiquetar.
- **`complementario`** para Order Bump: es el que se suma al básico para formar
  la opción conjunta. Hoy no tiene papel.

### A.3 Los papeles por modalidad

`papelesDeLaModalidad` tiene que devolver:

| Modalidad | Papeles |
| --- | --- |
| `lineal` | único, upsell |
| `upsell` | único, upsell |
| `order_bump` | básico, complementario, full, upsell |
| `doble_oferta_dos` | básico, full, upsell |
| `doble_oferta_upsell` | básico, full, upsell |
| `bioferta` | producto 1, producto 2, pack, upsell |

Ofrecer un papel que esa modalidad no usa deja etiquetar algo que no va a salir
por ningún lado, sin nada que lo explique.

### A.4 Apagar es «Sin usar»

Ya funciona: poner un producto en «Sin usar» lo deja guardado y no se ofrece.
No hace falta nada nuevo. Confirmarlo en la prueba.

---

## 5. LO QUE FALTA — FASE B: LOS RECORRIDOS

Solo **después** de la fase A. Las dos escriben en los mismos sitios; hacerlas a
la vez deja sin forma de saber cuál causó un fallo.

### B.1 Las piezas salen de las capas

Hoy las intros y los seguimientos viven dentro de la modalidad y del canal. Ésa
es la causa de «cambio de modalidad y el texto aparece».

Van a una lista global, igual que los productos: `biblioteca_de_intros`,
`biblioteca_de_seguimientos`. Las capas viejas **no se borran**: se dejan de
leer mientras haya recorrido activo.

### B.2 El recorrido es una tarjeta de ETIQUETAS, no de copias

Las dos formas posibles, y por qué se elige la segunda:

**(A) La tarjeta guarda una copia de todo.** Es lo que hacen los CRM. Fácil de
entender. El problema aparece al tercer producto: el mismo seguimiento usado en
cinco recorridos son cinco copias, corregir una errata son cinco ediciones, y
las copias envejecen distinto. Un día dos recorridos que se creían iguales dejan
de serlo y nadie sabe cuál es el bueno.

**(B) La tarjeta guarda etiquetas que apuntan a las piezas.** Las piezas viven
una vez. Cambiar un seguimiento lo cambia en todos los recorridos que lo usan, y
quien quiera uno distinto lo duplica **a propósito**.

**Se elige (B)**, y no por elegancia: es la misma pieza que ya se construyó para
los productos. Una etiqueta ya es un conector. «Este producto hace de full» y
«esta intro es la que se usa» son la misma frase.

Forma propuesta:

```ts
interface RecorridoGuardado {
  id: string;
  nombre: string;          // «Flores de Papel», «Lectoescritura»
  activo?: boolean;        // solo UNO activo a la vez
  introIds: string[];      // apuntan a la biblioteca de intros
  seguimientoIds: string[];
  entregaIds: string[];
}
```

### B.3 La pantalla

Tarjetas con nombre, al estilo de las filas de Canales: cuadrado de color,
título, frase y «Abrir». Dentro, el recorrido entero desde la intro hasta la
entrega, con el mismo reparto de `ChannelsPrototypeTab`.

Duplicar una tarjeta copia sus etiquetas, no las piezas.

### B.4 EL AVISO IMPORTANTE DEL ENCHUFE

En un CRM el workflow es una isla: mensajes y esperas, nada más. **Aquí un
recorrido toca el motor en más sitios:**

- La intro tiene **pesos de reparto** (`weight`) y **ruteo por anuncio**.
- Los seguimientos tienen **horarios permitidos** (`slots_peru`), **ráfagas**
  (`burst_delays_seconds`), **hueco mínimo** (`min_gap_hours_between`),
  **horas de silencio** y la **ventana de 24 h de Meta**.
- La entrega tiene una **clave** (`key`) que el motor busca por nombre para
  saber qué caja entregar (`order_bump_basico`, `upsell`, `central`…).

Agruparlas no es difícil. **Lo que hay que cuidar es que al enchufar no se
pierdan esas propiedades**, porque son las que evitan que el bot escriba a las
tres de la mañana o entregue el producto equivocado.

---

## 6. REGLAS QUE NO SE NEGOCIAN

1. **No se reestructura el bot.** Capas encima de lo que funciona, conectadas en
   el punto único que ya existe. Es su instrucción textual.
2. **Vacío no hace nada.** Cualquier capa nueva, sin llenar, tiene que dejar el
   bot exactamente como estaba. Es lo que permite soltarla sin miedo.
3. **Nada se borra.** Las capas viejas se dejan de leer, no se vacían. El día
   que algo salga raro, el contenido de antes sigue entero.
4. **Un dato, un sitio.** Si la etiqueta llena un campo, ese campo deja de
   editarse donde estaba, y se dice quién lo llena. Dos sitios editando lo mismo
   con uno que gana en silencio es la forma de perder trabajo sin enterarse.
5. **El guardado va por lista.** Todo campo nuevo tiene que nombrarse en los DOS
   sitios de `route.ts`, el de leer y el de escribir. Si no, se guarda en la
   pantalla y desaparece al recargar, sin error.
6. **El motor no se toca.** Ni cómo vende, ni cómo aprueba, ni cómo entrega, ni
   cómo responde.

---

## 7. POR DÓNDE EMPEZAR

1. Leer `repartirPorEtiqueta` y `BibliotecaDeProductos`. Son cortas y explican
   el patrón entero.
2. Hacer A.2 y A.3 (los papeles). Es lo más corto y lo que desbloquea Lineal.
3. Hacer A.1 (el contenido del producto). Ahí desaparece el producto fantasma.
4. Parar, que Alberto lo pruebe vendiendo, y **solo entonces** la fase B.

Las pruebas de la casa que vigilan esto:

- `scripts/prueba-etiquetas-de-productos.mjs`
- `scripts/prueba-el-aviso-de-vaciado-no-miente.mjs`
- `scripts/prueba-la-etapa-upsell-en-cualquier-modalidad.mjs`
