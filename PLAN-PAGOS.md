# PLAN — Rehacer la sección «Precios y pagos» con pop-ups

Documento de traspaso. Está escrito para que **otra persona (o Codex) pueda
terminarlo sin haber estado en la conversación**. Todo lo que dice aquí sobre
cómo funciona hoy el código está **verificado leyendo el código y la
configuración real**, no supuesto. Las líneas citadas son de `MULTIAGENTE 3` al
día de escribir esto; si no coinciden, buscar por el nombre de la función.

---

## 0. ANTES DE TOCAR NADA — LEE ESTO

### Las reglas que no se rompen

1. **No se arruina el comportamiento del bot.** Es un bot que vende de verdad,
   ahora mismo, a clientes reales. Lo peor que puede pasar es que deje de
   responder. Ante la duda: no tocar.
2. **No se revierte nada anterior.** Si algo estorba, se apaga con un
   interruptor y se conserva. Nunca se borra un campo con datos dentro.
3. **No se esconde el problema debajo de la alfombra.** Si algo está mal, se
   dice y se arregla de raíz; no se tapa el síntoma.
4. **Nunca se levanta el servidor de desarrollo (`npm run dev`).** El `.env`
   tiene credenciales reales de Meta y el worker despacharía los
   `scheduled_actions` pendientes a clientes de verdad. Para comprobar cosas se
   leen los archivos o se ejecutan las funciones sueltas con Node.
5. **Modalidades herméticas (regla 5-bis).** Ninguna modalidad sirve contenido
   de otra. Importar a mano sí; heredar por descuido, nunca.
6. **Todo cambio va a los DOS proyectos:**
   - `C:\Users\alberto\Desktop\MULTIAGENTE 3` → repo `multi-agente-3`
     (el único que Alberto edita y donde prueba)
   - `C:\Users\alberto\Desktop\BOT FRANKO` → repo `bot-franko`
     (vende de verdad; él no lo edita, pero **la implementación tiene que
     llegar igual**)

   `MULTI AGENTE 1` y `MULTI AGENTE 2` están **excluidos** por ahora.
   `MULTI AGENTE 3 (sin cambios)` y `MULTIAGENTE 2 (sin cambios)` son
   **respaldos intactos: no se tocan nunca.**

### El ritual de cada cambio, sin saltarse pasos

```
1. Auditar la zona ENTERA antes de tocarla (no parche tras parche).
2. Editar leyendo las líneas exactas. Nada de reemplazos a ciegas.
3. Escribir scripts/prueba-<lo-que-sea>.mjs con el POR QUÉ del fallo arriba.
4. node scripts/prueba-*.mjs  → las ~70 tienen que pasar.
5. Borrar .next y  npm run build   (la caché esconde errores que el deploy sí ve)
6. commit + push en MA3
7. git format-patch -1 --stdout > parche  →  aplicar en BOT FRANKO
8. Repetir 4 y 5 en FRANKO. commit + push.
9. Avisar a Alberto de que ya está subido (no pedirle que deploye antes).
```

### Cómo hablarle a Alberto

- Español **neutro** (nada de argentinismos ni frases traducidas del inglés).
- **Poco tecnicismo.** Explicar como se le explica a alguien que no programa.
- **Explicarle lo que se implementó.** Él no debe investigar por su cuenta cómo
  funciona lo que se construyó.
- **Preguntas de una en una.** Los menús de opciones múltiples no le sirven.
- Pasos de uno en uno, con confirmación entre uno y otro.

---

## 1. QUÉ QUIERE ALBERTO Y POR QUÉ

Sus palabras, resumidas:

> «Visualmente está pesado, y cubre mucho espacio porque está desplegado. Mi
> idea era simplificarlo en pop ups. Al tocar uno de ellos que se abra su propio
> contenido para llenarlo, y que en ese pop up esté también **la respuesta que
> el cliente recibe al elegirlo**, con los datos de pago. Así cada uno tendría
> su respuesta personalizada y me evitaría ir a otro lugar a llenar las
> respuestas.»

> «Lo que más estoy sufriendo en buscar y modificar son: **los botones de
> elección, los botones de método de pago, y los textos de respuesta al elegir
> producto**.»

> «Voy a agregar y quitar métodos de pago a mi antojo.»

Y el episodio que lo detonó: aceptó el producto upsell y recibió esto —

```
✅ ¡Perfecto! puedes adquirir el curso de esta manera 😊👇
🔴 Transferencia: 935286681
🙎🏻‍♂️A nombre de: Franko
💰 Monto: $7.500 ARS
😊 Una vez realizado, no olvides enviar la imagen de tu comprobante…
```

— y **no encontró ese texto en ninguna parte del menú Upsell**. Con razón: son
tres burbujas de tres sitios distintos, y ninguno es Upsell (ver §2.4).

---

## 2. CÓMO FUNCIONA HOY — HECHOS VERIFICADOS

### 2.1 Las tres capas de datos de pago

El mismo dato existe en copias, en tres niveles:

```
BASE (top-level del YAML)
  └── por PAÍS            → payment_profiles_by_country[PE|EC|MX|AR|…]
        └── por MODALIDAD → modality_payment_profiles[modalidad][país]
```

**Resolvedor central** — `src/lib/workflow/config.ts:2218`:

```ts
export function resolveCountryPaymentProfile(country, config) {
  const mode = activeModalityKey(config);          // config.ts:1853
  return (
    config.modality_payment_profiles?.[mode]?.[country] ??
    config.payment_profiles_by_country?.[country]
  );
}
```

**TODO el runtime de pago pasa por aquí.** Esto es lo que hace que «funcione en
todas las modalidades y todos los países» sea gratis: lo nuevo solo tiene que
colgarse de este resolvedor y hereda la escalera entera.

Ejemplo real de la configuración de Alberto (por qué no encontraba su texto):

```
modality_payment_profiles.doble_oferta_upsell.AR.metodo_pago_1
   = "🔴 *Transferencia : 935286681*\n🙎🏻‍♂️A nombre de: *{{NOMBRE_RECEPTOR}}*…"
```

### 2.2 Dónde se resuelven los comodines de método

`src/lib/workflow/sender.ts:111` — `expandirCajonesDePagoDelPais(text, convo)`:

```ts
const profile = resolveCountryPaymentProfile(getEffectiveCountryCode(convo.phone));
return text
  .replace(/\{\{\s*(precio_pre_eleccion|…)\s*\}\}/gi, literal(profile?.pre_choice_price_response ?? ""))
  .replace(/\{\{\s*(metodo_de_pago_1|metodo_pago_1)\s*\}\}/gi, literal(profile?.metodo_pago_1 ?? ""))
  .replace(/…_2…/gi, literal(profile?.metodo_pago_2 ?? ""))
  .replace(/…_3…/gi, literal(profile?.metodo_pago_3 ?? ""))
  .replace(/…principal…/gi, literal(profile?.metodo_pago_principal ?? ""));
```

**Aquí es donde va el comodín nuevo del Paso 1.** Ni un sitio más.

⚠️ **`literal()` es obligatorio** (`@/lib/texto-literal`). En JavaScript, un
`$1` dentro del texto de reemplazo significa «el grupo 1 de la expresión
regular». Sin `literal()`, un texto del operador que contenga `$1` se corrompe.
Ya pasó: `{{PRECIO_MERCADO}}` salía como `PRECIO_MERCADO8.000 ARS`.

⚠️ Se expande **antes** del resolvedor de precios, a propósito: el texto del
cajón lleva dentro sus propios comodines (`{{PRECIO_COMPLETO}}`…) que tienen que
resolverse con el precio del paso, no con el del curso. El comentario largo en
`sender.ts:85-110` cuenta el fallo real que eso causó (se cobraba de menos).

### 2.3 Los campos que existen hoy por país

`CountryPaymentProfile` — `src/lib/workflow/config.ts`, alrededor de la 600-668:

| Campo | Qué es |
|---|---|
| `course_price_soles`, `discount_price_soles`, `market_price` | precios del país |
| `payment_validation` | receptor a validar, exigir fecha |
| `payment_text` | el texto que ofrece los métodos (botones APAGADOS) |
| `payment_buttons[]` | `{label, method, aliases[]}` — **tope de 4** |
| `payment_responses{}` | por método: las burbujas que recibe el cliente |
| `metodo_pago_1/2/3` | **solo 3** cajones de datos de cuenta |
| `metodo_pago_principal` | el del pago sin elección |
| `order_bump{}`, `bioferta{}`, `upsell{}` | precios por producto de ese país |
| `pre_choice_price_response` | respuesta de precio antes de elegir |

### 2.4 De dónde salió el mensaje que Alberto no encontraba

| Burbuja recibida | De dónde sale |
|---|---|
| «✅ ¡Perfecto! puedes adquirir el curso de esta manera 😊👇» | `payment_responses.yape[0]` (BASE) |
| «🔴 Transferencia: 935286681 / A nombre de… / Monto…» | la burbuja solo dice `{{METODO_DE_PAGO_1}}`; el texto sale de `modality_payment_profiles.doble_oferta_upsell.AR.metodo_pago_1` |
| «😊 Una vez realizado…» | `payment_responses.yape[2]` (BASE) |

**Causa raíz**: el producto upsell **no tiene `payment_responses` propias**, así
que las pide prestadas. Ver `getUpsellPaymentResponses` — `engine.ts:4884`:

```ts
const own = seccionUpsell(config)?.payment_responses;   // no existe en su config
const direct = own?.[route];
const fallback = route === "efectivo" ? own?.bcp_transferencia : undefined;
const steps = (direct?.length ? direct : fallback)
  ?? getPaymentResponses(config, route, undefined, phone);   // ← cae aquí
```

### 2.5 Qué tiene y qué NO tiene cada producto

Verificado sobre la configuración real:

| | precio | descuento | **precio anterior** | respuesta propia | datos de pago propios |
|---|---|---|---|---|---|
| Lineal | ✅ | ✅ | ⚠️ uno solo por país | — | ✅ |
| Order Bump → básico | ✅ | ✅ | ❌ | ✅ `order_bump.basico.response` | ✅ `.payment_responses` |
| Order Bump → combo | ✅ | ✅ | ❌ | ✅ | ✅ |
| D.Oferta+Upsell → básico | ✅ | ✅ | ❌ | ✅ | ✅ |
| D.Oferta+Upsell → full | ✅ | ✅ | ❌ | ✅ | ✅ |
| **D.Oferta+Upsell → upsell** | ✅ | ✅ | ❌ | ❌ | ❌ |

Dos conclusiones que mandan sobre todo el plan:

- **La respuesta personalizada por elección YA EXISTE** para básico y combo. No
  hay que inventarla: hay que **traerla a la vista**.
- **El producto upsell es el único sin respuesta ni datos propios.** Ese hueco
  es el que produjo la burbuja redundante.

### 2.6 El límite que rompe «agregar y quitar a mi antojo»

- Botones de método: **hasta 4** (`src/app/editor/page.tsx:8872`).
- Cajones de datos: **solo 3** numerados + el principal.
- Un 4º método **no tiene dónde poner su cuenta**.
- Y los cajones cuelgan de un **número, no del método**: si se borra el método
  2, «Datos de pago 2» sigue ahí y pasa a alimentar a otro método.

### 2.7 Dónde está la pantalla hoy

`src/app/editor/page.tsx`:

| Qué | Línea aprox. |
|---|---|
| Pestaña «Precios y pagos» | `8332` (`tab === "pago"`) |
| Estado `paymentEditorView` (`"country"` \| `"common"`) | `4568` |
| Botones de método + `+ Agregar método` | `8547`–`8890` |
| Bloque azul «🔑 Datos de pago de {país}» | `23622` |
| Precios por producto del país | `23270`–`23520` aprox. |
| Ayudantes de campo vacío en rojo | `claseDeCampo` / `claseDeEtiqueta`, `2364` |

Ya hay precedente de cambiar de vista dentro de la pestaña (`paymentEditorView`),
así que el interruptor de vista nueva encaja con lo que ya existe.

---

## 3. EL PLAN, EN PASOS

Cada paso es **entregable por separado**: se sube, Alberto lo prueba, y solo
entonces se pasa al siguiente. Si hay que parar a mitad, lo entregado funciona.

---

### PASO 1 — El comodín `{{DATOS_DEL_METODO_ELEGIDO}}`

**Por qué primero:** sin él, «una sola respuesta para todos los métodos» es
imposible, y los pop-ups pierden la mitad de su sentido. Es la bisagra.

**El problema que resuelve:** hoy, una respuesta tiene que escribir
`{{METODO_DE_PAGO_1}}`, que siempre trae el método 1. Por eso hay tres
respuestas, una por método. No fue capricho: era una limitación.

**Qué hacer**

1. En `src/lib/workflow/sender.ts`, dentro de `expandirCajonesDePagoDelPais`,
   añadir un `.replace(...)` más para
   `{{DATOS_DEL_METODO_ELEGIDO}}` (aceptar también
   `{{METODO_DE_PAGO_ELEGIDO}}` como alias, mismo estilo permisivo que los
   otros: `/\{\{\s*(datos_del_metodo_elegido|metodo_de_pago_elegido)\s*\}\}/gi`).
2. Resolverlo así:
   - `const elegido = convo.selected_payment_method` (columna de
     `conversations`; ya la usa `entregarDatosDePagoDelUpsell`,
     `engine.ts:5601`).
   - Buscar su posición en `profile.payment_buttons` por `method`.
   - Posición 0 → `metodo_pago_1`, 1 → `metodo_pago_2`, 2 → `metodo_pago_3`.
   - **Si no hay método elegido o no se encuentra** → caer a
     `metodo_pago_principal`, y si ese está vacío, a `metodo_pago_1`.
     **Nunca devolver cadena vacía sin intentar el respaldo**: una burbuja de
     datos de pago en blanco es una venta perdida.
3. Envolver el resultado en `literal()`. **Obligatorio.**
4. Registrar el comodín en la lista del editor (`src/app/editor/page.tsx`, la
   tabla que hoy tiene `["{{METODO_DE_PAGO_1}}", "Datos de pago 1 del país…"]`,
   ~`13746`) para que salga en el autocompletado y en el selector de comodines.

**Cuidado**

- `selected_payment_method` puede traer `"plin"`, que el motor trata como
  `"yape"` (ver `entregarDatosDePagoDelUpsell`). Normalizar igual que allí.
- No tocar el comportamiento de `{{METODO_DE_PAGO_1/2/3}}`. Se quedan.

**Prueba** — `scripts/prueba-comodin-del-metodo-elegido.mjs`

- Con el método 2 elegido, devuelve `metodo_pago_2`.
- Sin método elegido, cae al principal.
- Con el principal vacío, cae al 1.
- Con un método que no está en `payment_buttons`, cae al respaldo (no vacío).
- Un texto que contenga `$1` o `$&` sale intacto (la trampa de `literal()`).
- `{{METODO_DE_PAGO_1}}` sigue resolviendo igual que antes.

---

### PASO 2 — Lineal: interruptor «una sola respuesta»

**El problema:** para el pago en Lineal hay **seis cajones**:

1. `payment_text` (ofrece los métodos)
2. `payment_buttons` (3 botones con alias)
3. `payment_responses` (3 secuencias × 3 burbujas = 9 burbujas)
4. `metodo_pago_1/2/3` + principal (datos de cuenta)
5. `direct_payment_steps` + `direct_payment_cta`
6. `direct_payment_without_choice_steps` + `direct_payment_without_choice_cta`

Alberto quiere **una**, que él arma con sus burbujas y comodines.

**Qué hacer**

1. Campo nuevo en la configuración, junto a los de pago:
   ```yaml
   respuesta_unica_de_pago:
     enabled: false          # APAGADO por defecto. Sin esto, todo sigue igual.
     steps: []               # las burbujas que él arma
   ```
2. En `getPaymentResponses` (`engine.ts:4822`): **si `enabled` está encendido y
   `steps` tiene algo**, devolver esos pasos en lugar de los del método.
   Si está apagado o vacío, **no cambiar nada**.
3. En cada método (Paso 3, el pop-up) un interruptor
   «Usar una respuesta propia para este método». Encendido, ese método usa sus
   `payment_responses` de siempre; apagado, usa la compartida.
4. **No borrar nada de lo viejo.** Los seis cajones siguen guardados. El
   interruptor solo decide cuál se lee.

**Cuidado**

- `getPaymentResponses` la usan también el upsell (`getUpsellPaymentResponses`,
  `engine.ts:4884`) y el pago directo. Auditar los tres antes de tocar.
- El filtro `step.enabled !== false` tiene que seguir aplicándose.

**Prueba** — `scripts/prueba-respuesta-unica-de-pago.mjs`

- Apagado → sale exactamente lo mismo que hoy, método por método.
- Encendido → sale la compartida para todos.
- Encendido pero con `steps` vacío → sale lo de hoy (no se queda mudo).
- Un método con «respuesta propia» encendida → sale la suya, no la compartida.
- Las burbujas apagadas siguen sin enviarse.

---

### PASO 3 — La vista nueva de pagos, con pop-ups

**El interruptor (esto es lo que lo hace reversible)**

```
Precios y pagos          [ Vista clásica ] [ Vista nueva ]
```

- **Arranca en la clásica.** Nada cambia hasta que él toque el botón.
- Se guarda en `localStorage` **solo en su navegador** — igual que
  `EDITOR_MODALITY_STORAGE_KEY`. No se manda a la API ni toca la configuración
  del bot.
- **Las dos vistas editan LOS MISMOS campos.** No son dos copias del dato: son
  dos ventanas al mismo dato. Por eso «revertir» es volver a hacer clic.

> ⚠️ **Ventana nueva sí. Campo nuevo duplicado, nunca.** Dos casillas para el
> mismo valor terminan diciendo cosas distintas y nadie sabe cuál manda. Es
> exactamente el desorden del que se está saliendo.

**Cómo se ve la vista nueva**

```
📍 Estás editando: Doble Oferta + Upsell → 🇦🇷 Argentina     ← cartel FIJO

PRECIOS    🟩 precio base   🟨 precio full   🟪 precio upsell   🟥 nombre y fecha

MÉTODOS    💳 Yape/Plin     💳 Transferencia    💵 Efectivo    [+ Agregar]

RESPUESTAS 📦 al elegir el BÁSICO   📦 al elegir el FULL   📦 al elegir el UPSELL
```

Cada cuadrito **abre un pop-up**, no se despliega hacia abajo.

**El cartel de arriba no es decoración.** Todo el enredo de Alberto viene de no
saber en qué capa está parado (§2.1). Tiene que estar SIEMPRE visible y decir
modalidad + país.

**El pop-up de un método de pago lleva todo junto:**

```
┌─ 💳 Transferencia ──────────────────────────────┐
│  Nombre del botón:  Transferencia               │
│  Otras formas de pedirlo: transferencia, cbu    │
│                                                 │
│  🔑 Datos de la cuenta                          │
│  🔴 Transferencia: 935286681                    │
│  A nombre de: {{NOMBRE_RECEPTOR}}               │
│  💰 Monto: {{PRECIO_SEGUN_ELECCION}}            │
│                                                 │
│  ☐ Usar una respuesta propia para este método   │
│  💬 Lo que el cliente recibe al elegirlo        │
│  [burbuja 1] [burbuja 2] [burbuja 3]            │
│              + vista previa al lado             │
│                                                 │
│  ℹ️ Esta respuesta también se usa para el        │
│     producto upsell.                            │
└─────────────────────────────────────────────────┘
```

Ese renglón `ℹ️` es el que le habría ahorrado la búsqueda del §2.4. **Ponerlo.**

**Los cuadritos de precios** (él los dibujó así):

| Cuadrito | Qué abre |
|---|---|
| 🟩 precio base | precio base + descuento + **precio anterior** |
| 🟨 precio full | precio full + su descuento + su precio anterior |
| 🟪 precio upsell | precio upsell + su descuento + su precio anterior |
| 🟥 nombre y fecha | nombre del receptor + exigir fecha del comprobante |

**Pregunta abierta para Alberto:** la caja amarilla «Etapa de descuento»
(activar el precio de descuento y en qué seguimiento se activa) es **común** a
todos los precios, no de uno solo. Preguntarle si la quiere visible fuera de los
cuadritos o con cuadrito propio. **No decidirlo por él.**

**Reglas de la pantalla** (las suyas, ya establecidas)

- Legibilidad primero. Componentes de la casa (`Collapsible`, `ChatPreview`,
  `EditorEmojiTextarea`, `EditorEmojiInput`), nada inventado desde cero.
- Nada de tamaños fijos: tiene que respirar en cualquier ancho.
- Los campos que dejan el bot inservible, **en rojo mientras estén vacíos**
  (usar `claseDeCampo` / `claseDeEtiqueta`, `page.tsx:2364`).

⚠️ **Trampa de Tailwind, ya documentada en el código:** los colores **no se
apilan**. Juntar `border-neutral-300` y `border-red-400` en la misma cadena no
decide nada — gana el que la hoja de estilos tenga más abajo, no el que se
escriba último. Por eso `claseDeCampo` recibe la base **sin color** y pone ella
el que toca. Hay una comprobación que verifica que los dos nunca salgan a la vez
(`scripts/prueba-campos-que-faltan-en-rojo.mjs`).

**Prueba** — `scripts/prueba-vista-nueva-de-pagos.mjs`

- El interruptor arranca apagado (la vista clásica es la de fábrica).
- La vista nueva escribe en los MISMOS campos que la clásica (comparar que
  ambas apuntan al mismo `profile[...]`).
- No existe ningún campo que solo tenga la vista nueva salvo los declarados en
  los Pasos 4 y 5.
- El cartel de modalidad + país aparece siempre.
- Cambiar de vista no modifica la configuración (mismo JSON antes y después).

---

### PASO 4 — La cuenta pegada al método, no al número

**El problema:** §2.6. Tope de 3 cajones para hasta 4 botones, y colgados de un
número. Borrar un método le pasa su cuenta a otro.

**Qué hacer**

1. Añadir un campo `datos` (texto) **dentro de cada entrada de
   `payment_buttons`**. Ahí vive la cuenta de ese método.
2. **Al leer**, con respaldo escalonado, para no romper nada de lo que ya hay:
   ```
   button.datos   ??   metodo_pago_{posición+1}   ??   metodo_pago_principal
   ```
3. **Al escribir desde la vista nueva**, escribir en `button.datos`.
4. `{{METODO_DE_PAGO_1/2/3}}` **siguen funcionando**: apuntan al 1º, 2º y 3º
   método de la lista con el mismo respaldo escalonado. **Ninguna burbuja que
   Alberto ya escribió se toca.**
5. Quitar el tope de 4 en `page.tsx:8872`. Poner un tope alto y razonable (12)
   solo para que no se dispare por accidente.

**Cuidado**

- WhatsApp solo admite **3 botones** en un mensaje interactivo. Con más de 3
  métodos, `sendBotButtons` tiene que degradar a lista numerada en texto — ya lo
  hace para Messenger; comprobar que también aquí. **Si no, avisarlo en la
  pantalla en vez de mandar un mensaje que Meta rechace.**
- No borrar `metodo_pago_1/2/3` del YAML. Se quedan como respaldo y como lo que
  lee la vista clásica.

**Prueba** — `scripts/prueba-datos-pegados-al-metodo.mjs`

- Un método con `datos` propios usa los suyos.
- Sin `datos`, cae a `metodo_pago_{posición}` (compatibilidad).
- **Borrar el método 2 no le pasa su cuenta al que ocupa ese puesto después.**
  (Esta es LA comprobación del paso.)
- Con 5 métodos, el 4º y el 5º tienen cuenta propia y funcionan.
- Con más de 3 métodos, los botones degradan a lista en texto.

---

### PASO 5 — Precio anterior por producto

**Hoy** hay un solo `market_price`, por país, compartido por todos los
productos. Alberto quiere uno **por producto**:

> «Cada producto de cada modalidad debe tener su precio base, precio descuento y
> precio anterior.»

Su modelo, con sus palabras:

- **Lineal**: 1 producto.
- **Order Bump**: el básico y el combo. El **producto adicional no tiene precio
  propio** — no se vende por separado; se llega a él pagando un plus. Así está
  ya en los datos (`order_bump.combo` / `order_bump.basico` y nada más). ✅
- **Doble Oferta + Upsell**: básico, full y upsell. Los tres con los suyos.
- Las demás modalidades no están probadas y hoy no se usan, **pero hay que
  implementarlas pensando en que algún día se usarán.**

**Qué hacer**

1. `market_price?: number` dentro de cada opción: `order_bump.combo/basico`,
   `doble_oferta_dos.*`, `doble_oferta_upsell.combo/basico/upsell`,
   `bioferta_doble.*`, y también en las capas por país
   (`profile.order_bump`, `profile.bioferta`, `profile.upsell`).
2. Respaldo: si la opción no tiene el suyo → el `market_price` del país → el
   global. **Nunca dejarlo en 0 por sorpresa**: 0 significa «no mostrar».
3. `{{PRECIO_MERCADO}}` tiene que resolver al del producto en juego.
   ⚠️ Hubo un fallo aquí antes: revisar `{{PRECIO_MERCADO}}` en la modalidad
   Doble Oferta + Upsell, y **usar `literal()`**.

**Prueba** — `scripts/prueba-precio-anterior-por-producto.mjs`

- Cada producto muestra el suyo.
- Sin el suyo, cae al del país; sin ese, al global.
- En 0 no se muestra nada (no sale «$0»).
- `{{PRECIO_MERCADO}}` trae el del producto elegido, no el del primero.

---

### PASO 6 — El producto upsell, con respuesta y datos propios

**El hueco del §2.5**: es el único producto sin `response` ni
`payment_responses`. Por eso se le cuela la burbuja genérica redundante
(«✅ ¡Perfecto! puedes adquirir el curso de esta manera»), que suena repetida
después de que el cliente ya dijo que sí.

**Qué hacer**

1. Añadir `response` y `payment_responses` a la sección upsell (top-level
   `upsell` y `doble_oferta_upsell.upsell`, las dos: el editor escribe en la
   primera y la API arma la segunda).
2. `getUpsellPaymentResponses` (`engine.ts:4884`) **ya las prefiere si existen**
   — el código del respaldo ya está escrito. Solo hay que darle dónde
   guardarlas y una pantalla donde escribirlas.
3. Su pop-up: `📦 al elegir el UPSELL`, igual que los del básico y el full.
4. **Si se dejan vacías, sigue el comportamiento de hoy** (pide prestadas las
   generales). Nada se rompe si no las llena.

**Prueba** — `scripts/prueba-respuesta-propia-del-upsell.mjs`

- Con respuesta propia → sale la suya, sin la burbuja genérica.
- Vacía → sale exactamente lo de hoy (compatibilidad).
- El precio que aparece es el del upsell, no el de la primera compra.
  (⚠️ Este fallo ya ocurrió: ver el comentario de `sender.ts:94-106`.)

---

## 4. TRAMPAS DEL PROYECTO — LEER ANTES DE ESCRIBIR CÓDIGO

| Trampa | Qué pasa | Cómo se evita |
|---|---|---|
| `String.replace` y `$1` | Un `$1` en el texto de reemplazo significa «grupo 1». El texto del operador se corrompe | `literal()` de `@/lib/texto-literal`. Ya hay 46 sitios usándolo |
| Colores de Tailwind apilados | `border-neutral-300 border-red-400` → gana el de la hoja, no el escrito último | `claseDeCampo` con la base sin color |
| Pruebas y CRLF | Los archivos son CRLF; una expresión que acabe en `;\n` no encuentra nada | Escribir siempre `;\r?\n` |
| API `parseDocument` + `doc.set` | Una clave que no esté listada dentro de un objeto de `doc.set` **se pierde al guardar**. Las de primer nivel sobreviven | Al añadir un campo dentro de un objeto, añadirlo TAMBIÉN en `src/app/api/workflow/route.ts` (lectura y escritura) |
| Limpiar campos mientras se escribe | Un `.trim().filter(Boolean)` en cada tecla borra la coma recién escrita | Limpiar al guardar, no al teclear (`strListLimpia` en la API) |
| PowerShell `Get-Content -Raw` + `Set-Content` | Corrompe UTF-8 (se comen los acentos y los emojis) | Usar las herramientas de edición, no la consola |
| Caché de `.next` | Esconde errores que el deploy sí ve | Borrar `.next` antes de `npm run build` |
| El editor auto-commitea | Aparecen commits «editor: actualiza flujo» del propio Alberto | `git pull --rebase` antes de empujar |

---

## 5. LO QUE ALBERTO TIENE QUE LLENAR ÉL (no es un fallo)

Anotado para no perseguir fantasmas:

- El producto upsell se llamaba «PRODUCTO UPSELL» y no tenía alias.
- Su muestra «PAGINAS SECRETAS» **no tiene enlace de Drive**.
- Sin `info_steps` ni `respuesta_generica`; `use_buttons: false`.
- Las tres plantillas de correo están **vacías** → hoy no se manda ningún correo.
- Argentina, en la capa BASE, solo tiene `transferencia` llena y está
  `enabled: false` (la que se usa es la capa de la modalidad).
- Hay métodos basura en la capa EC del Order Bump (`transferenci`, uno en
  blanco) que conviene limpiar.
- Los alias del combo en FRANKO contienen «quiero» — ya inocuo para el detector
  de upgrade, pero todavía se usa para reconocer la elección. Revisar.

---

## 6. LO QUE QUEDÓ PENDIENTE, FUERA DE ESTE PLAN

Por orden de lo que él ha pedido más veces:

1. **Cuadritos de decisión en la pregunta del upsell.** Quiere probarlos. Falta
   leer `decisionQueCoincide` en la última burbuja encendida de
   `pregunta_steps` mientras `upsell_state === "ofrecido"`, y una acción nueva
   **«rechazar el segundo producto»** (hoy su cuadrito «NO QUIERO» no tiene
   ninguna acción que elegir).
2. **Achicar fotos enormes** al convertir (~1600 px). Hoy nada las redimensiona
   y Meta rechaza en silencio las de más de 5 MB.
3. **Enlaces de cualquier sitio**, no solo Google Drive.
4. **Tapar el hueco del Cerebro**: devolver solo la caja «Pago» (no «Precio y
   cierre») mientras el segundo producto está ofrecido.
5. **Reducir la lista de comodines** y **vista previa al pasar el mouse**.
6. **Saludo con cuadritos de decisión.**
7. **Piel de Messenger en el simulador**: al elegir Messenger se sigue viendo
   como WhatsApp. Los colores del marco están escritos a mano en
   `src/app/simulador/page.tsx`, en el `<section>` de la ventana de chat
   (~línea 225 y siguientes); hay que sacarlos a una paleta por canal.
8. **Poner al día MULTI AGENTE 1 y 2.**
9. **La pizarra visual.**
10. **El tema oscuro** — él dijo que al final del todo.

11. **El hueco blanco de la Galería de muestras** (pedido el 6/09, con captura).

    En `GalleryEditor` (`src/app/editor/page.tsx`, busca `Palabras que activan
    esta muestra`) la maqueta es así:

    ```
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="space-y-2">   ← tema, cuándo enviarla, palabras
      <div className="lg:col-span-2">  ← GalleryCaptionBubbleEditor
    ```

    La celda DERECHA de la primera fila queda **vacía**: un rectángulo blanco de
    unos 300 px de alto en cada muestra. Y el editor de burbuja, que ya trae su
    vista previa a la derecha, va debajo ocupando las dos columnas.

    Lo que pide: que **la vista previa suba y ocupe ese hueco**, en los tres
    productos (usan el mismo `GalleryEditor`, así que se arregla una vez).

    La vista previa vive DENTRO de `GalleryCaptionBubbleEditor`, así que no
    basta con mover cajas por fuera: hay que sacarla a la columna derecha y
    dejar que ocupe las dos filas (`lg:row-span-2`), o pasarla como algo que el
    padre coloque. Necesita probarse a ojo en pantalla ancha y estrecha —
    acuérdate de que él no quiere tamaños fijos.

---

## 7. SI HAY QUE PARAR A MITAD

Cada paso se sube terminado y probado. Si se corta el trabajo entre dos pasos,
lo entregado funciona y la vista clásica sigue siendo la de fábrica: **Alberto
no se queda con un editor a medias.**

Lo único que **no** se puede dejar a medias es un paso por dentro. Si un paso se
queda sin terminar, **no se sube**: se revierte el trabajo local y se le dice
por dónde iba.
