# PLAN — Que cada modalidad tenga sus propios campos y no se filtren

Instrucciones para quien continúe (Codex u otra persona). Está escrito para
poder ejecutarse **sin haber estado en la conversación**.

Los hechos sobre el código están **verificados leyéndolo**, no supuestos. Las
funciones se citan **por nombre**: los números de línea cambian, los nombres no.

> ⚠️ **Antes de tocar nada, lee `PLAN-PAGOS.md` § 0.** Ahí están las reglas de la
> casa (nunca `npm run dev`, el ritual de cada cambio, los dos proyectos, cómo
> hablarle a Alberto). Aplican igual aquí. No se repiten.

---

## 1. EL PROBLEMA

Alberto trabaja hoy en una modalidad y mañana en otra. **Al cambiar de
modalidad, el contenido se entrevera.** Sus palabras:

> «Yo trabajo en Doble Oferta + Upsell, y mañana quiero trabajar en Order Bump;
> cambio de modalidad y todo se va a la mierda.»

> «No entiendo por qué al cambiar de modalidad se tiene que reemplazar texto, si
> cada modalidad es un vendedor distinto con sus propias características.»

Tiene razón, y no es un fallo suelto: es cómo está construido.

### La causa, en una frase

**El contenido existe por duplicado.** Una copia en la caja de cada modalidad
(`modality_templates`) y otra en los campos de primer nivel que lee el motor. El
editor las copia de una a otra **automáticamente y en los dos sentidos** — al
cargar, al cambiar de modalidad y al guardar.

El propio código lo dice, en el comentario de `WorkflowConfig.modality_templates`
(`src/lib/workflow/config.ts`):

> *«Al guardar, la plantilla de la modalidad ACTIVA se copia a los campos
> top-level (intro_sequence, followup_sequences, gift_mechanic, etc.) que el
> motor lee → el MOTOR no cambia.»*

Se hizo así para no tener que tocar el motor. Funcionó hasta que hizo falta
moverse entre modalidades.

### Lo que se rompe hoy (todo verificado)

| Qué pasa | Dónde |
|---|---|
| Al cambiar de modalidad, el contenido se **intercambia** | `switchModalidad` |
| Campos que la modalidad nueva no usa **se vacían de verdad**, no solo se ocultan (`product_name_2`, `course_content_2`, `image_gallery_2`, `pack_gallery`, `complement_info_topic`) | `applyTemplate` |
| `greeting`, `email`, `email_vip` **caen a vacío** si la plantilla no los trae | `applyTemplate` |
| Un `""` o un `[]` en la plantilla **pisa** el valor lleno de primer nivel (`??` no filtra vacíos) | `applyTemplate` |
| Cambiar de modalidad **no toma foto para deshacer** — Ctrl+Z no lo devuelve | el llamador de `switchModalidad` |
| Al guardar, los campos de primer nivel se rehacen desde la modalidad que **VENDE**, no la que se edita | `save()` |

### ⚠️ UNA PARTE YA ESTÁ ARREGLADA — no la vuelvas a diagnosticar

La madrugada del 6 de septiembre se encontró un fallo distinto que **causaba
buena parte del desastre** y que ya está corregido (commit «Al cargar el editor
se tiraban DOS modalidades»):

> Al abrir el editor se reescribía `modality_templates` con **solo cuatro
> claves** (lineal, order_bump, bioferta, doble_oferta_dos). `doble_oferta_upsell`
> y `upsell` **se tiraban en cada carga**, y al guardar después esa pérdida
> quedaba grabada en el archivo.

Por eso parecía que el contenido «se borraba al cambiar de modalidad»: en
realidad se tiraba antes, **nada más abrir el editor**. Arreglado con `...mt`
delante de los cuatro respaldos. Prueba:
`scripts/prueba-no-tirar-plantillas-al-cargar.mjs`.

**El resto de este plan sigue en pie**: el intercambio al cambiar de modalidad
es un problema real y aparte, y es el que se arregla aquí.

**Ya ocurrió de verdad**, el 5 de septiembre de 2026: un guardado dejó en blanco
el contenido del producto, su galería, las marcas de «Info de contenido», las
dos intros, los tres seguimientos, la entrega de pago aprobado, las muestras
tras la intro y la plantilla entera de una modalidad. Se recuperó del historial
de git.

---

## 2. LO QUE ALBERTO DECIDIÓ — Y LO QUE RECHAZÓ

Se le propusieron varias cosas. **Rechazó dos, y con razón. No las reintroduzcas.**

### ❌ RECHAZADO: el respaldo automático

Se propuso que, si la caja de una modalidad está vacía, el motor tirara de los
campos de primer nivel. Lo rechazó:

> «Yo no quiero que el bot rellene nada, sino que respete los cajones que están
> así. Yo puedo dejar vacíos a propósito porque quiero trabajar después.»

Tiene razón: **eso es la misma enfermedad otra vez** — contenido de un sitio
apareciendo en otro sin pedirlo. **Una caja vacía se queda vacía.**

### ❌ RECHAZADO: bloquear la venta si faltan campos

Se propuso no dejar activar una modalidad incompleta. Lo rechazó:

> «Eso que el sistema no me deja vender no puede ser, yo puedo vender con campos
> incompletos, lo hago en este momento. No puede haber limitaciones.»

**Nada de validaciones que impidan vender.** Vender con campos a medias es su
decisión.

### ✅ LO QUE QUIERE — sus palabras exactas

> «Lo único que yo quiero es que respete mis campos por modalidad y no se filtre
> a otro o viceversa.»

Eso es **todo el encargo**. Ni una cosa más.

---

## 3. LAS TRES REGLAS

1. **Cada modalidad tiene sus propios campos.**
2. **El motor lee los de la modalidad que está vendiendo.** Si algo está vacío,
   va vacío. No se rellena con nada.
3. **Nada se copia de una modalidad a otra por su cuenta. Nunca.** Copiar es
   posible, pero solo cuando él lo pide con el botón que ya existe («Importar
   contenido desde otra modalidad»).

---

## 4. LO QUE HAY QUE HACER

### PASO 0 — La mudanza, una sola vez

**No crea ni rellena nada.** Lo que hoy está en los campos de primer nivel *es*
el contenido de la modalidad activa; solo se guarda donde a partir de ahora se
busca. Es el mismo dato, cambiado de sitio.

Sin este paso, el primer arranque tras el cambio dejaría a la modalidad activa
sin contenido.

- Copiar los campos de `ModalidadTemplate` desde el primer nivel a
  `modality_templates[<modalidad activa>]`, **solo donde la caja no tenga ya un
  valor propio** (lo que ya está en la caja manda: es más específico).
- Se hace **una vez**, y debe ser **idempotente**: correrlo dos veces no puede
  cambiar nada la segunda.
- Las cajas de las otras modalidades **no se tocan**. Las vacías siguen vacías.
- Con la configuración actual de Alberto, cinco modalidades ya tienen contenido
  y solo `upsell` no tiene caja. Verificarlo antes y después.

> Hacerlo como un script en `scripts/` que se ejecuta a mano y deja el YAML
> escrito, **no** como una migración automática al arrancar. Una migración que
> corre sola en un bot que vende es justo lo que no queremos.

### PASO 1 — El motor lee de la caja de su modalidad

**Un solo sitio: `loadWorkflowConfig()` en `src/lib/workflow/config.ts`.**

Después de leer la configuración del disco y **antes** de devolverla, superponer
la caja de la modalidad activa sobre los campos de primer nivel, en memoria:

```
modo      = activeModalityKey(config)      // ya existe, mismo archivo
plantilla = config.modality_templates?.[modo]
si hay plantilla → devolver { ...config, ...campos definidos de la plantilla }
```

Detalles que importan:

- **Solo los campos que la plantilla trae de verdad.** Si la plantilla no tiene
  la clave, se deja lo que haya. Si la trae vacía (`""` / `[]`), **ese vacío
  manda**: esa es la regla 2 y es lo que Alberto pidió. Ojo: `??` no distingue
  «no está» de «está vacío» — hay que mirar `hasOwnProperty`.
- **El motor no cambia ni una línea.** Sigue leyendo los mismos nombres de campo.
  Todo ocurre antes de que los vea.
- `loadWorkflowConfig` tiene **caché por `mtime` y por canal**. La superposición
  va donde no rompa esa caché ni la haga inútil. Leer esa función entera antes
  de tocarla.
- Los nombres de `ModalidadTemplate` (`src/lib/workflow/config.ts`) son los del
  **motor** (`followup_sequences`, `gift_mechanic`, `email_template`,
  `system_prompt_sections`), **no** los del editor (`followups`, `gift`,
  `email`, `prompt_sections`). No confundirlos: es la trampa más fácil de este
  trabajo.

**Prueba** — `scripts/prueba-el-motor-lee-su-modalidad.mjs`
- Con la caja llena, el motor ve lo de la caja.
- Con un campo vacío en la caja, el motor ve **vacío** (no el de primer nivel).
- Con un campo ausente en la caja, ve el de primer nivel.
- Cambiar la modalidad activa cambia lo que ve el motor, **sin escribir nada**.
- La caja de una modalidad **no** afecta a lo que ve otra.

### PASO 2 — El editor deja de copiar

En `src/app/editor/page.tsx`:

- **`save()`**: hoy hace `applyTemplate(cfg, _runtimeTemplate, _runtimeMode)` y
  manda eso a los campos de primer nivel. **Eso desaparece.** Guardar debe
  escribir en `modality_templates[<modalidad que se edita>]` y en los campos
  compartidos de verdad (pagos por país, ajustes…), y **no** rehacer el primer
  nivel desde la modalidad que vende.
- **`switchModalidad()`**: no debe escribir contenido en ningún sitio. Cambiar de
  modalidad pasa a ser **solo mirar otra caja**.
- **`applyTemplate()`**: deja de forzar a vacío los campos que la modalidad no
  usa. Si un campo no aplica, **se oculta en pantalla; no se borra el dato.**
  (Hoy borrar es lo que hace que se pierda al guardar.)
- **El llamador de `switchModalidad`** (busca `setCfg(switchModalidad(`): añadir
  `snapshot()` antes, para que Ctrl+Z devuelva. Hoy no lo hace — verificado.

**Prueba** — `scripts/prueba-cambiar-modalidad-no-escribe.mjs`
- Cambiar de modalidad no altera ningún campo de otra modalidad.
- Editar en A y cambiar a B y volver a A: lo de A sigue igual.
- Guardar estando en A no toca la caja de B.
- Una caja vacía sigue vacía después de cambiar de un lado a otro.
- Ctrl+Z deshace el cambio de modalidad.

### PASO 3 — Retirar los andamios, solo si sobran

Hay tres seguros puestos el 5 de septiembre **por este mismo problema**:

| Seguro | Dónde |
|---|---|
| El servidor rechaza guardados que vaciarían secciones con contenido | `SECCIONES_VIGILADAS` / `seccionesQueSeVaciarian`, `src/app/api/workflow/route.ts` |
| Una caja de modalidad no se puede pisar con nada | `noPisarConVacio`, `page.tsx` |
| Cartel ámbar cuando se edita una modalidad distinta de la que vende | `page.tsx`, arriba del `<main>` |

**No los quites.** Siguen valiendo aunque la causa desaparezca, y sus pruebas
están escritas. El cartel además sigue siendo útil como información.

---

## 5. ORDEN Y CRITERIO DE PARADA

```
PASO 0  → correr, verificar, commit, push, avisar. PARAR y que Alberto lo mire.
PASO 1  → probar, compilar, subir a los dos. PARAR y que lo pruebe.
PASO 2  → probar, compilar, subir a los dos. PARAR y que lo pruebe.
```

Entre pasos se para siempre. **Un paso a medias no se sube**: se revierte en
local y se le dice por dónde iba.

El Paso 1 sin el Paso 2 ya funciona (el motor lee bien; el editor sigue copiando
de más, que es lo de hoy). El Paso 2 sin el Paso 1 **no**: dejaría al motor sin
contenido. Ese orden no se cambia.

---

## 6. CÓMO SABER QUE SALIÓ BIEN

La prueba de Alberto, con sus palabras:

> Trabajo hoy en Doble Oferta + Upsell. Mañana cambio a Order Bump y trabajo
> ahí. Al volver a Doble Oferta + Upsell, **todo está como lo dejé.**

Y las tres reglas del § 3, comprobables una por una.

---

## 7. LO QUE NO SE HACE

- ❌ Rellenar una caja vacía con nada. **Vacío es vacío.**
- ❌ Impedir vender con campos incompletos.
- ❌ Copiar contenido entre modalidades sin que él lo pida.
- ❌ Tocar el motor de venta. Este trabajo es del cargador y del editor.
- ❌ Migraciones que corran solas al arrancar.
- ❌ Quitar los tres seguros del § Paso 3.
