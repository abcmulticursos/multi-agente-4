# PROTOCOLO DE CAMBIOS — MULTI AGENTE 2

> **Este archivo pertenece SOLO a MULTI AGENTE 2.** No es universal ni se comparte
> con otros bots. Cada proyecto tiene el suyo, porque cada proyecto es distinto.
>
> **Para el usuario:** basta con decir *"necesito un cambio, aplica el protocolo"*.
> **Para la IA:** lo que sigue es obligatorio, sin excepciones ni atajos.

---

## Identidad de este proyecto

| | |
|---|---|
| Carpeta | `MULTI AGENTE 2` (Desktop) |
| Repo | `abcmulticursos/multiagente-2` |
| Despliegue | EasyPanel |
| Contenido activo | `config/intro-data.yaml` (editable desde `/editor`, hot-reload) |

**Este proyecto NO es igual a MULTI AGENTE 1.** Tiene mejoras propias que MA1 no
tiene: los avatares de las conexiones Meta (`page_picture_url`,
`profile_picture_url`, `selected` en `db.ts`, más su interfaz en el editor).
Al portar un arreglo desde MA1, comprobar primero que no pisa esto.

Antes de tocar nada, **confirmar que se está en este proyecto**.

---

## Protocolo obligatorio

### 1. Auditar antes de tocar

```bash
node scripts/auditoria.cjs
```

Solo lectura, no modifica nada. Re-lee el código y el contenido reales, así que
nunca está desactualizado — al contrario que cualquier documento, este incluido.

**Nunca aplicar un arreglo porque ya funcionó en MULTI AGENTE 1.** Aunque el
código parezca idéntico, hay que auditar este proyecto.

### 2. Causa raíz, no síntoma

Encontrar de dónde sale el problema realmente. Un parche que tapa el síntoma
suele sembrar el siguiente fallo.

> Caso real (17-ago-2026): el bot mezclaba cifras de un producto anterior. La
> causa no estaba en el contenido sino en `openrouter.ts`, en una regla que
> incluía el ejemplo *"never turn 1000 into 100"*. Ese número viajaba al modelo
> en cada llamada y lo leía como dato del producto en venta. Era, a su vez, el
> parche de una sesión anterior.

### 3. Análisis de impacto antes de editar

Enumerar qué flujos puede afectar el cambio: modalidades, canales, países,
monedas, precios, cobro, validación de comprobantes, entregas, correos, regalo,
postventa, intros, seguimientos, acciones programadas y conversaciones en
paralelo. Explicarlo **antes** de tocar el código.

### 4. Cambio quirúrgico que preserva el comportamiento

Lo mínimo posible, un archivo si se puede. **El bot debe quedar idéntico salvo
en lo que se pidió corregir.** Nada de refactorizar de paso, nada de "ya que
estoy". Nada de sustituir respuestas naturales del LLM por textos fijos.

### 5. El motor es genérico, el contenido es hermético

Ningún dato comercial —nombre, cifra, beneficio, temario— puede vivir en el
código. El único origen es el contenido del editor.

Esto lo verifica el bloque 2 del script de auditoría.

### 5-bis. Cada modalidad se sirve de lo suyo

**Ninguna modalidad puede enviarle al cliente contenido que pertenece a otra.**
Ni nombres, ni contenidos, ni galerías, ni muestras, ni entregas, ni precios.
Si a una modalidad le falta un dato, **no se envía nada** y queda avisado en el
log: nunca se rellena con el de la modalidad de al lado.

Esto vale también para el **upsell**, que es una fase y no una modalidad: tiene
su propio producto, su contenido, sus imágenes, su precio y su entrega. No lee
`product_name_2` ni `course_content_2`, que son del complemento de la modalidad
que está vendiendo.

No confundir con **importar**. Copiar el contenido de una modalidad a otra desde
el editor está bien y es una función deliberada: el operador decide, y a partir
de ahí cada copia es independiente. Lo prohibido es que en tiempo de ejecución
una modalidad lea el cajón de otra para responderle a un cliente.

El motivo es que una fuga así no se ve: el bot contesta con algo coherente, pero
del producto equivocado. No falla, miente.

Relacionado: el pendiente «Fuga entre modalidades» de más abajo describe una
puerta abierta de esta misma familia, en `applyTemplate` y `emptyTemplateForMode`.

### 6. Declarar qué se verificó y qué no

Ser explícito. Nada de afirmar sin comprobar. Si algo no se revisó, decirlo.

### 7. Declarar el impacto en tokens

Una de estas conclusiones, con su causa:
- "No afecta el súper ahorro de tokens."
- "Aumentará ligeramente el consumo" + por qué.
- "Aumentará el consumo" + qué contexto o llamadas lo producen.

### 8. Verificar

```bash
npm run build    # obligatorio si cambia lógica o tipos
```

Nota: `npm run lint` está roto (Next 16 interpreta `lint` como carpeta). No es un
fallo introducido por un cambio.

Además: probar en el **simulador del panel** antes de dar nada por bueno.

### 9. Git — reglas duras

- Commit aislado y claro **antes** de cambios de lógica
- Commitear **solo los archivos propios**; nunca el trabajo en curso del usuario
- `git pull --rebase` **siempre** antes de `git push` — el panel publica contenido
  a GitHub y pushear sin traer primero pisa su trabajo
- **Prohibido** `--force`, `reset --hard` y restaurar estados amplios
- Para deshacer: `git revert <commit>` del cambio concreto
- **No pushear sin confirmación explícita del usuario**

### 10. Al terminar

Enumerar qué cambió, qué se conserva, cómo se verificó y cuál es el comando de
reversión.

---

## Estado conocido (auditado el 17-ago-2026)

Correr `node scripts/auditoria.cjs` para el estado actual. Esto es la foto de ese día:

- **Producto activo:** Matemáticas con Minecraft · **modalidad:** lineal
- **Otras modalidades:** order_bump → Matemáticas con Minecraft ·
  bioferta → Grafismo Fonético · doble_oferta_dos → Combo Completo
- **Canales activos:** WhatsApp y Messenger. Instagram y TikTok apagados
- **Países:** PE y EC habilitados. Titulares: Alberto Salinas (PE), Carlos Quimi (EC)
- **Precios lineal:** PE 7 · EC 2
- **Datos de producto en el motor:** 0 ✅ (corregido ese día)

### PROYECTO EN CONSTRUCCIÓN

Este bot **se está configurando**. Hay intros apagadas y contenido a medio editar.
Un desajuste aquí no es necesariamente un fallo: puede ser trabajo en curso.
**Preguntar antes de "corregir" contenido.**

Pendiente al terminar la configuración: el `course_content` todavía describe
Flores de Papel ("Más de 50 modelos de flores de papel") mientras el producto se
llama *Matemáticas con Minecraft*. Lo mismo la galería y varias intros.

### Otros pendientes conocidos

**Fuga entre modalidades — PARCIALMENTE CERRADA.** Un campo ausente en un cajón
heredaba el de la última modalidad activa, y al guardar quedaba grabado como
propio. Origen: `applyTemplate` y `emptyTemplateForMode`.

Analizado campo por campo. Quedó así:

- **Cerrado:** `greeting`, `email`, `email_vip` y `gift`. Caen a vacío en los dos
  sitios: la plantilla en blanco y el respaldo de `applyTemplate`. Los vacíos
  están definidos una sola vez (`SALUDO_VACIO`, `CORREO_VACIO`, `REGALO_VACIO`)
  para que no puedan divergir. El regalo vacío lleva `has: false`, que es "esta
  modalidad no tiene regalo" — no un regalo a medias.
- **Ya estaban bien:** `course_content_2`, `product_name_2`, `image_gallery_2`,
  `pack_gallery`, `complement_info_topic`.
- **Nunca filtraron:** el resto del contenido, porque la plantilla en blanco sí
  los define (`course_content`, `product_name`, galerías, entregas, postventa,
  seguimientos, temas…).
- **NO deben cerrarse:** `bioferta`, `order_bump`, `doble_oferta_dos` son los
  cajones de las modalidades, no contenido. Vaciarlos al cambiar de modalidad
  borraría la configuración de la otra. Y `globals`, `dynamic_fields` y
  `post_gift_comment_auto_human_enabled` son globales de verdad.

**El envío de correo quedó protegido** en dos niveles, porque vaciar la plantilla
sin esto le habría mandado un correo en blanco a quien acaba de pagar:

- `sendEmail` (`src/lib/email.ts`) rechaza asunto o cuerpo vacíos. Es la última
  línea de defensa y cubre a cualquier futuro llamador.
- El llamador de `engine.ts` lo comprueba antes y lo dice en el log. Una
  plantilla sin rellenar es un objeto con los campos en blanco: no es null ni
  tiene comodines, así que pasaba los dos guardas que ya existían.

**`bioferta` y `doble_oferta_dos` heredan sus precios** de `payment_profiles_by_country`
en vez de declararlos. Están apagadas, así que no afecta.

---

## Zonas peligrosas

Antes de tocarlas, analizar y explicar el riesgo:

`templateFromCfg` · `applyTemplate` · `switchModalidad` · `modality_templates` ·
pestañas Contenido / Entrega / Canales · `config/intro-data.yaml` ·
`src/app/api/workflow/route.ts` · `src/lib/workflow/config.ts` ·
`src/app/api/products/route.ts` (cambiar de producto resetea conversaciones sin pagar)
