# Propuesta: workflow para la pregunta inicial con rutas

## Objetivo

Permitir que la pregunta inicial configurable (por ejemplo, «¿Tienes experiencia en el tema?») tenga respuestas y secuencias diferentes según el cliente responda afirmativamente o negativamente.

La propuesta debe convivir con los cajones actuales del editor. No se deben reemplazar las intros ni modificar las modalidades comerciales existentes.

## Cómo debe funcionar

```text
[Inicio]
    ↓
[Pregunta inicial]
    ├── Sí → [Burbuja Sí 1] → [Burbuja Sí 2] ─┐
    │                                          ├→ [Intro común o siguiente etapa]
    └── No → [Burbuja No 1] → [Burbuja No 2] ─┘
```

El editor puede mostrarlo como un lienzo tipo workflow (fondo oscuro, nodos, líneas, zoom y desplazamiento). Cada nodo representa un cajón o una secuencia editable. Al seleccionar un nodo se abre el editor actual de texto, audio, imagen, video y botones.

La primera versión recomendada es de solo lectura: debe representar las rutas reales que el motor ya tiene conectadas. La edición de conexiones se puede habilitar después de validar visualmente el mapa.

## Configuración propuesta

Agregar un bloque independiente, por ejemplo `initial_question_flow`, con:

- `enabled`: apagado por defecto; apagado conserva exactamente el comportamiento actual.
- `question`: texto de la pregunta inicial.
- `yes_sequence`: cajones que se envían cuando la respuesta es afirmativa.
- `no_sequence`: cajones que se envían cuando la respuesta es negativa.
- `ambiguous_sequence`: respuesta para «no entendí» o una nueva solicitud de aclaración.
- `continue_to_common_intro`: si ambas ramas continúan luego a la intro común.
- `common_intro_after_branch`: punto de unión opcional antes de seguir con la modalidad activa.

La configuración debe poder editarse desde el mismo editor de cajones y conservar variantes, delays, botones y medios ya soportados.

## Estados y detección

Al enviar la pregunta, guardar un estado temporal explícito, por ejemplo `awaiting_initial_question`.

- Mientras ese estado esté activo, interpretar únicamente respuestas afirmativas o negativas.
- «Sí», «si», «claro», «tengo experiencia», etc. → rama `yes_sequence`.
- «No», «nunca», «no tengo experiencia», etc. → rama `no_sequence`.
- Respuesta ambigua → `ambiguous_sequence`, sin elegir una ruta al azar.
- Después de resolver la pregunta, limpiar el estado antes de continuar.

No volver a interpretar cualquier «sí» o «no» posterior como respuesta a esta pregunta. Esto es obligatorio para no interferir con selección de productos, confirmación de upsell, regalo, correo o pago.

## Compatibilidad por modalidad

La pregunta inicial es una capa previa al flujo comercial y no debe leer ni modificar la configuración de una modalidad. Después de la rama, el motor debe continuar con la modalidad activa que ya habría usado:

- Lineal
- Order Bump
- Bioferta
- Doble Oferta 2 Productos
- Doble Oferta + Upsell
- Upsell

No duplicar la lógica de pago, comprobantes, entrega, correo, upsell ni regalo dentro de las ramas. Las ramas solo deben entregar contenido inicial y luego devolver el control al flujo común.

## Reglas de seguridad

- Toggle apagado = comportamiento anterior byte a byte en lo posible.
- No cambiar `intro_sequence`, `intro_sequence_2` ni `intro_sequence_3` automáticamente.
- No alterar precios, respuestas de métodos de pago, validación de comprobantes o entregas.
- No enviar una rama si la pregunta no fue enviada o si ya fue respondida.
- Evitar doble envío si llegan varios mensajes durante la transición.
- Si falta una rama configurada, usar la intro actual como fallback seguro.
- Si falla el envío de una burbuja, registrar el error y continuar sin dejar la conversación bloqueada.

## Pruebas obligatorias antes de publicar

1. Toggle apagado: flujo actual idéntico.
2. Respuesta «Sí»: solo secuencia afirmativa y luego unión correcta.
3. Respuesta «No»: solo secuencia negativa y luego unión correcta.
4. Respuesta ambigua: no dispara ninguna rama incorrecta.
5. Un segundo «sí/no» durante pago, upsell o regalo no reabre la pregunta inicial.
6. Probar cada modalidad comercial y verificar que sus precios, pagos, entregas y estados no cambian.
7. Probar WhatsApp y los demás canales habilitados.
8. Verificar reinicio de conversación, mensajes duplicados y respuesta tardía.
9. Ejecutar TypeScript, build y pruebas específicas antes de commit/push.

## Cómo retomar esta propuesta en otra sesión

La nueva sesión debe leer primero `AGENTS.md`, `CLAUDE.md` y este archivo en ambas carpetas. Debe inspeccionar el estado actual del repositorio y no asumir que existe un editor de workflows todavía.

Implementar en pasos pequeños y reversibles:

1. Modelar el bloque de configuración y su normalización.
2. Agregar el estado temporal y la detección determinística.
3. Conectar las secuencias al flujo común sin duplicar ventas.
4. Mostrar primero un mapa visual de solo lectura.
5. Agregar controles de edición únicamente después de pasar las pruebas.
6. Verificar ambos repositorios y ambas modalidades antes de publicar.

No hacer un refactor global del motor ni reemplazar los cajones existentes para implementar esta propuesta.

## Aclaración pendiente: dos tipos de inicio excluyentes

El saludo cosmético y el saludo con pregunta son alternativas, no pasos consecutivos.

```text
Tipo de inicio elegido
   ├── Saludo cosmético → saludo → intro normal
   └── Saludo con pregunta → Sí/No → intro correspondiente
```

El editor debe mostrar un selector excluyente:

- **Saludo cosmético:** envía el saludo; cualquier respuesta continúa con la intro normal y no espera una decisión.
- **Saludo con pregunta y rutas:** envía «Hola, ¿ya tienes experiencia?», espera esa respuesta y elige la ruta Sí o No.

Al activar uno se desactiva el otro. Si se desactiva el modo con pregunta, no debe quedar ninguna conversación esperando `awaiting_initial_question`; debe volver al comportamiento del saludo cosmético.
