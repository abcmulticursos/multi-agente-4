# Detección de elección + Fallback determinístico (doble oferta 2 productos)

> Documento para que cualquier IA (Claude, Codex, etc.) implemente esta robustez
> igual en este proyecto o en otro clonado de la misma base. Es **agnóstico al
> producto**: no menciona "Mundial". Solo aplica a la modalidad **doble oferta 2
> productos** (estado `awaiting_doble_oferta_dos_choice`).

## Problema que resuelve
Cuando el bot pregunta "¿cuál prefieres?" (opción cara vs barata), el humano
responde de formas impredecibles: nombre exacto, precio, sinónimos, con errores
de tipeo, o algo que no cuadra. Si no se reconoce la elección, el turno cae al
LLM, que solo conversa y **NO entrega los datos de pago** → el cliente queda
"colgado", sin poder comprar (se ve como un bot roto / "error infantil").

## Solución en 2 capas

### Capa 1 — Detección robusta de la elección: `detectTwoTierPick(msg, config)`
Vive en `src/lib/workflow/config.ts`. Devuelve `"combo" | "basico" | null`.
Reconoce la elección por, en este orden:

1. **Nombre / tokens exactos** de cada opción (`detectExactOrderBumpChoice`):
   por el nombre configurado o sus tokens distintivos.
2. **Guard de PREGUNTA**: si el mensaje es una pregunta/duda
   (`isOrderBumpConversationQuestion`) → devuelve `null` (lo maneja el LLM).
3. **Precio**: número que coincide con el precio de una opción (truncado), en
   **dígito** ("el de 9") y **escrito** ("el de nueve"). Mapa de palabras
   uno..veinte → número.
4. **Semántico con antónimos SIMÉTRICOS** (clave para robustez):
   - Opción MAYOR/combo: `combo, completo, pack, premium, vip, mayor, todo,
     caro, costoso, alto, grande, full`.
   - Opción MENOR/basico: `basico, barato, economico, comodo, accesible, menor,
     simple, bajo, sencillo, chico`.
   - **Tolerancia a errores de tipeo** en las palabras largas y distintivas
     (>=5 letras): distancia de edición Damerau/OSA <= 2 (sustitución,
     inserción, omisión, transposición). Así "compelto", "cmpleto", "basiko"
     también deciden.
   - **Anti-colisión**: las palabras cortas y el par `mayor`/`menor` van solo en
     match exacto (están a 1 edición → un typo apuntaría a ambos).
   - **Auto-cancelación**: si un mensaje apunta a AMBAS opciones a la vez →
     devuelve `null` (no entrega nada equivocado; lo guía el LLM).

Función auxiliar `withinOneTypo` / `editDistance` (Damerau-OSA acotada) para la
tolerancia a typos.

### Capa 2 — Fallback determinístico (red de seguridad)
Vive en `src/lib/workflow/engine.ts`, dentro de `tryWorkflowOnIncoming`, en el
bloque `if (state === "awaiting_doble_oferta_dos_choice")`. Si la Capa 1 no
reconoció la elección **y** el mensaje no es pregunta ni objeción, el bot
**re-pregunta desde el código** cuál opción prefiere. Sin llamar al LLM = **0
tokens**. Así el cliente nunca queda sin avanzar.

```ts
if (state === "awaiting_doble_oferta_dos_choice") {
  const choice = detectTwoTierPick(msgContent, config);
  if (choice) {
    await deliverDobleOfertaPaymentDetails(convo, choice);
    return true;
  }
  // FALLBACK DETERMINÍSTICO (cero tokens, sin LLM):
  const clarification = config?.doble_oferta_dos?.choice_clarification?.trim();
  if (
    clarification &&
    !isOrderBumpConversationQuestion(msgContent) && // preguntas -> LLM
    !messageHasPaymentConcern(msgContent)           // objeciones -> LLM
  ) {
    await sendBotText(
      convo,
      renderOrderBumpTemplate(clarification, !!convo.discount_active)
    );
    return true;
  }
  return false; // preguntas/objeciones -> LLM
}
```

## Dependencias (deben existir en el proyecto)
- Config: `doble_oferta_dos.choice_clarification` (texto de la re-pregunta; soporta
  comodines `{{OPCION_1}}`/`{{OPCION_2}}` = nombres de combo/basico).
- `detectTwoTierPick(msg, config)` — detección principal (Capa 1).
- `isOrderBumpConversationQuestion(msg)` — ¿es pregunta/duda? (gate).
- `messageHasPaymentConcern(msg)` — ¿es objeción / miedo a estafa? (gate).
- `renderOrderBumpTemplate(text, discount)` — reemplaza `{{OPCION_1}}/{{OPCION_2}}`
  por los nombres reales.
- `sendBotText`, `deliverDobleOfertaPaymentDetails`.

## Comportamiento resultante (impacto)
| Entrada del cliente en el estado de elección | Qué hace el bot |
|---|---|
| Nombre exacto / con 1-2 typos | Entrega el pago de esa opción |
| Precio en dígito o palabra ("el de 9" / "el de nueve") | Entrega el pago |
| Semántico ("el mas caro", "el barato") | Entrega el pago |
| Pregunta ("¿qué incluye?") u objeción ("es caro", "estafa") | Pasa al LLM |
| Algo raro / filler / off-topic | Re-pregunta las 2 opciones (sin LLM) |
| Ambiguo (apunta a las 2) | Pasa al LLM |

- No afecta otras modalidades (order bump, bioferta, venta simple).
- No hay bucle infinito: re-pregunta 1 vez por mensaje del cliente.
- Ahorra tokens (los turnos ambiguos ya no van al LLM).

## Qué NO cubre (para tener claro)
Esta robustez es SOLO para el paso de **elegir producto**. Otros pasos con
variación de palabras tienen su propia detección independiente:
- Reclamar el regalo ("comentado" y variantes) → `containsCommentedKeyword`.
- Pedir el material por correo → manejo en el estado `awaiting_email`.
- Elegir método de pago (yape/bcp/efectivo) → `detectPaymentRoute`.
Si se quiere la misma robustez ahí, hay que endurecer cada una por separado.

## Cómo instruir a otra IA (resumen de 1 frase)
> "En `engine.ts`, en el handler del estado `awaiting_doble_oferta_dos_choice`,
> agrega un fallback determinístico: si `detectTwoTierPick` no reconoce la
> elección y el mensaje NO es pregunta (`isOrderBumpConversationQuestion`) ni
> objeción (`messageHasPaymentConcern`), envía `doble_oferta_dos.choice_clarification`
> (renderizado con `renderOrderBumpTemplate`) y devuelve `true`; si no, devuelve
> `false` para que lo maneje el LLM. Y asegúrate de que `detectTwoTierPick`
> reconozca nombre, precio (dígito y palabra), antónimos simétricos
> (caro/barato, alto/bajo, mayor/menor) y tolere 1-2 errores de tipeo."
