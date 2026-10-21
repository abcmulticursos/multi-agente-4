# MEJORAS DE PROYECTO — la medición de ventas en Meta (CAPI)

> **NO IMPLEMENTAR.** Dictado por Alberto el 24 de septiembre de 2026: «déjalo por
> ahora como está pero guárdalo como mejora de proyecto». Las dos mejoras de aquí
> están MEDIDAS y propuestas, y ninguna está aprobada.

---

## MEJORA 1 — dejar de mandar el identificador de la WABA

### Lo que quiere

Con sus palabras: **«lo que yo necesito es no asociar WABA con pixel, ese camino
no lo necesito»**.

Su forma de trabajar de siempre, que quiere recuperar:

```
1. Crear la página
2. Crear el conjunto de datos
3. Dar de alta el número
4. Vincular el conjunto de datos a la página
5. Campaña: elegir página, número y conjunto de datos
6. Meta Connect: elegir esos mismos tres
```

Sin tocar la WABA en ningún momento.

### Lo que se midió, comparando con el proyecto anterior

El proyecto viejo (`agente-whatsapp-grafismo`, sin Meta Connect) manda:

```
ctwa_clid                      SI
page_id                        SI
whatsapp_business_account_id   NO EXISTE en ese codigo
```

**El bot viejo nunca le decía a Meta cuál era la WABA.** Por eso Meta nunca
comprobaba ninguna asociación: no tenía WABA contra la que comprobar. Y por eso
él solo tenía que vincular la página con el conjunto de datos — `page_id` sí era
y sigue siendo obligatorio.

El proyecto actual, en `src/lib/meta/conversions.ts`:

```ts
const wabaId = getWhatsAppRuntimeConfig().wabaId;
if (wabaId) ud.whatsapp_business_account_id = wabaId;
```

En cuanto ese dato viaja, Meta valida que el conjunto de datos esté asociado a esa
WABA, y si no lo está devuelve **2804132 — «dataset sin WABA asociada»**.

**No cambió Meta: cambió el bot**, al empezar a mandar un dato más.

### El cambio propuesto

Quitar esas dos líneas. Con eso Meta deja de tener WABA que validar y la
asociación deja de hacer falta.

**Se queda todo lo demás:** `page_id` (obligatorio de verdad, 2804069 si falta),
`ctwa_clid`, `business_messaging`, `messaging_channel`, y las compras orgánicas
como `system_generated` — que es la mejora del bot nuevo sobre el viejo y no se
pierde.

### Los candados

- No hay regla de CLAUDE.md que lo impida: es quitar un dato opcional.
- **Toca el motor**, en el camino de medición de anuncios. No es pantalla.
- **Lo que NO se puede verificar:** que la atribución sea igual de buena sin ese
  dato. Si empeorara **no se ve**: atribuiría menos ventas, sin error ninguno.
- **Cómo se detectaría:** comparando ventas registradas contra ventas reales
  durante unos días. No es inmediato.
- **El recorrido de venta NO lo cubre**: estos eventos no salen en la prueba
  automática. Se comprueba con una compra real y el registro de EasyPanel.
- Va en su propio commit: revertir es una línea.

### En qué se apoya que sea seguro

Los ejemplos de la documentación de Meta para mensajería llevan `ctwa_clid`,
`action_source: business_messaging` y `messaging_channel: whatsapp`. **El
identificador de la WABA no aparece como obligatorio en ninguno.** Y su bot viejo
funcionó meses sin mandarlo.

---

## MEJORA 2 — un solo bot no puede medir varias páginas a la vez

### Lo que se midió

En `src/lib/meta/conversions.ts`:

```ts
const pageId = process.env.META_PAGE_ID ?? activeMeta?.page_id;
const wabaId = getWhatsAppRuntimeConfig().wabaId;
```

El bot **escucha todos los números conectados** —eso ya se arregló y está bien—
pero **reporta las conversiones con la página, la WABA y el conjunto de datos del
ACTIVO**, no con los del número por el que entró la conversación.

### Qué rompe

Si se montaran tres países con tres WABAs y tres páginas en un mismo despliegue:

```
Entra una venta por el número de Argentina
   -> se reporta con la página del activo (p.ej. Perú)
   -> Meta comprueba que ese número esté en esa página
   -> no lo está  ->  2804069, evento rechazado
```

Las del activo entrarían y las demás no, **sin error visible en la venta**.

### Por qué no urge

Él trabaja con **una WABA y un conjunto de datos por proyecto**, con un
despliegue por bot. Su forma de trabajar ya esquiva esto.

### Qué haría falta si algún día lo quiere

Que `page_id`, `waba_id` y el conjunto de datos salieran de la **conexión por la
que entró la conversación** —`convo.wa_phone_number_id`, que ya se guarda— en vez
de la activa. Es la misma idea que ya usa `withOutboundWhatsAppNumber` para
contestar por el número correcto.

**Antes de prometer nada hay que auditar** quién más lee esos valores.

---

## LO QUE NO HAY QUE VOLVER A INVESTIGAR

- **Fusionar el pixel de web con el de WhatsApp no sirve para nada** en su caso.
  Solo junta en una pantalla eventos de web y de conversación. Él solo vende por
  conversación. El conjunto de datos de la WABA **nace asociado a ella**: no hay
  que fusionar, hay que ELEGIR el correcto en Meta Connect.
- **El número no hay que conectarlo a mano a la página** cuando los dos están en
  el mismo Business Manager: Meta los conecta solo al elegir el número en el
  anuncio. Solo hace falta el PIN cuando están en Business Manager distintos.
- **El número que se pone en la configuración de la página es opcional** y no
  registra nada. Conviene que sea el mismo del bot, o ninguno, para que nadie
  caiga en un número sin atender.
