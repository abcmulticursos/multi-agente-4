# AGENTS.md — ARCHIVADO, YA NO MANDA

> **Este archivo no manda. Lee `CLAUDE.md`.**
>
> Sus órdenes permanentes vigentes se trasladaron a `CLAUDE.md`, que es ahora el
> único archivo de reglas del proyecto. Se conserva aquí solo como historial.
>
> Lo que decía sobre trabajar en `MULTI AGENTE 1`, `MULTI AGENTE 2` o
> `AGENTE-KPOP` está **anulado**: se trabaja exclusivamente en `BOT ALBERTO 1`.

## Orden de aislamiento vigente

- Durante la preparacion de `MULTI AGENTE 2`, trabajar exclusivamente en esa
  carpeta. Esta prohibido tocar `MULTI AGENTE 1`, AGENTE-KPOP u otros
  repositorios salvo autorizacion expresa posterior del usuario.
- `config/product-profiles/index.json` y todos los YAML dentro de
  `config/product-profiles/` son parte de la plantilla y deben versionarse.
  Un clon debe conservar cada perfil visible en el selector del editor, no solo
  el producto activo de `config/intro-data.yaml`.
- Antes del primer commit o push de un clon, comprobar que el indice y cada
  perfil comercial aparecen en `git ls-files`.

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
  archivos concretos de esa implementación tras inspeccionarlos. Está prohibido
  usar restauraciones amplias, `reset --hard`, checkout de ramas antiguas o
  cualquier acción que pueda reintroducir errores ya corregidos.
- Al finalizar un cambio aprobado, hacer commit claro y push a `main` de
  MULTI AGENTE 2, salvo indicación expresa contraria del usuario.

## Orden permanente: verificar contra el CONTENIDO, no solo contra el código

El código se comporta distinto según lo que haya escrito en `intro-data.yaml`.
Un cambio puede ser correcto leyéndolo y romper la venta con el contenido real.
Antes de dar por buena una corrección:

- **Abrir el contenido de hoy** (`git pull` primero: el operador edita en la
  nube) y comprobar el cambio contra los textos que hay escritos de verdad, no
  contra los de ejemplo. Dos modalidades con el mismo campo no tienen por qué
  usarlo igual: mirar QUÉ HAY ESCRITO en la otra antes de generalizar un
  arreglo.
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

Guía breve para contribuir en este proyecto.

## Objetivo

Este repositorio es un agente de WhatsApp basado en Next.js, TypeScript, React 19, Tailwind 4 y `better-sqlite3`.

## Comandos útiles

```bash
npm install
npm run dev
npm run build
npm run start
npm run lint
```

## Alcance de trabajo

- Trabajar únicamente en `MULTI AGENTE 1` salvo que el usuario indique de forma
  explícita otro proyecto. No tocar AGENTE-KPOP ni otros repositorios por
  similitud de código.

## Convenciones

- Prioriza TypeScript y cambios pequeños y coherentes con la arquitectura existente.
- Mantén la UI alineada con el estilo actual del dashboard.
- Usa `apply_patch` para editar archivos.
- No borres ni reviertas cambios que no hayas hecho tú.
- Evita agregar dependencias si no son necesarias.

## Regla Critica: No Regresiones

Este bot maneja ventas reales. No se implementa una funcion "y listo" ni se
acepta corregir un sintoma creando otra ruta paralela que pueda romper una
funcion ya probada.

## Regla no negociable: Verificacion comercial antes de publicar

Una compilacion correcta solo confirma que el codigo puede construirse; nunca
demuestra que el bot siga vendiendo correctamente. Ningun cambio se puede
considerar terminado ni pushear sin una verificacion proporcional del flujo
comercial que pueda alcanzar, incluso cuando el archivo editado parezca ser
solo de editor, importacion o interfaz.

- Antes de editar, declarar que rutas de ejecucion real quedan fuera de alcance
  y comprobarlo mediante imports, llamadas y datos persistidos; no basta con
  asumirlo por el nombre del archivo.
- Para toda modificacion que pueda tocar, transportar, activar o seleccionar
  configuracion de una modalidad, verificar el recorrido completo de cada
  modalidad afectada: primer mensaje, intro, seguimientos, eleccion, pagos,
  comprobante, aprobacion, entrega, imagenes/documentos y reenvio.
- Las acciones programadas exigen una prueba de los tres pasos: se crean con
  el tiempo correcto, el worker/cron las recoge y el emisor usa exactamente la
  misma modalidad, canal y contenido con que fueron programadas. Probar al
  menos Seguimiento 1 y Seguimiento 2 cuando se toque editor, canales,
  modalidades o configuracion que pueda influir en ellos.
- Revisar las rutas equivalentes para Lineal, Order Bump, Bioferta y Doble
  Oferta, y para cada canal que use contenido propio. Nunca dar por probado
  un flujo de WhatsApp y asumir que Messenger, Instagram o una modalidad usan
  la misma fuente de datos.
- Si no es posible realizar una prueba funcional segura, detener el push,
  explicar con precision que no pudo comprobarse y pedir direccion. No afirmar
  que el comportamiento del bot esta preservado basandose solo en `npm run build`.
- En el cierre de cada cambio, informar que flujos concretos se verificaron y
  con que evidencia. El contenido manual del usuario no se modifica para
  probar: usar simulador, conversacion de prueba o datos aislados.

- Antes de editar, identifica la ruta existente que ya resuelve el caso y
  extiendela o reutilizala. No dupliques logica de ventas, pagos, galeria,
  entrega, correo, regalo, reenvio o seguimiento.
- Todo cambio debe preservar la funcionalidad de cada modalidad: lineal,
  order bump, bioferta y doble oferta. El contenido es editable; la logica
  interna debe seguir siendo generica para que este repositorio sirva como
  plantilla de futuros productos.
- Verifica los flujos afectados de principio a fin, incluyendo mensajes o
  comprobantes que llegan juntos, elecciones por boton y por texto, acciones
  programadas, reintentos y mas de una conversacion en paralelo.
- Para cualquier mejora de ahorro, prompt, cola o postventa, protege en
  particular: aprobacion unica, enlace correcto una sola vez, pedido de correo,
  regalo, reenvio del material y memoria de que el cliente ya pago.
- No publiques una correccion si solo arregla el caso visible pero deja sin
  revisar las rutas equivalentes. Si el alcance implica riesgo, explica el
  riesgo y propone una alternativa coherente antes de implementarla.
- No reemplaces respuestas naturales del LLM por textos fijos rigidos salvo que
  el usuario lo pida explicitamente. Esto impide trabajar bien: el bot pierde
  naturalidad, puede sonar tecnico y rompe ventas. Si una modalidad responde
  bien con IA natural y burbujas legibles, replica su disciplina de estilo en
  las modalidades equivalentes sin copiar su logica interna ni sus opciones.
- Si una modalidad empieza a responder con mensajes cortados, densos o poco
  naturales, no lo tapes con una respuesta fija. Primero compara con una
  modalidad que ya funcione bien. La solucion que funciono aqui fue: quitar el
  bypass fijo de `lineal + desconfianza`, devolver la respuesta al LLM natural,
  mantener el chunking normal y agregar una regla breve de disciplina comercial
  al bloque de la modalidad. Esa disciplina dice: responder primero la duda u
  objecion, escribir en parrafos/burbujas claras, no formar un bloque gigante,
  mantener tono profesional y cerrar con un siguiente paso suave. Aplicar esta
  idea a modalidades equivalentes (lineal, bioferta, doble oferta 2 productos)
  sin copiar opciones, precios, markers ni logica interna de otra modalidad.
- Antes de publicar, crea un punto de reversibilidad (commit claro) y ejecuta
  la verificacion adecuada. `npm run build` es obligatorio cuando cambie logica
  o tipos.
- Todo comodin nuevo debe quedar completo antes de publicarse: debe aparecer
  como una previsualizacion entendible en el editor (nunca como texto crudo o
  marcador generico), resolverse en el envio real al cliente y usar el mismo
  formato en cada ruta/canal que lo soporte. Verificar tanto un valor
  configurado como el estado sin configurar; si falta un dato, el editor debe
  avisarlo claramente y el bot no debe inventarlo. No dar por terminado un
  comodin solo porque se puede insertar en un textarea.

## Conexion Meta desde el editor

Implementacion base realizada. El objetivo es
reducir la conexion de WhatsApp, Messenger e Instagram a un flujo entendible,
sin obligar al usuario a buscar endpoints, ejecutar consultas manuales o
adivinar que identificador corresponde a cada campo.

- Punto de entrada: una pantalla `Conexion Meta` dentro del editor, usando el
  inicio de sesion oficial de Meta. Debe guiar: conectar cuenta, elegir pagina,
  elegir canales y revisar antes de guardar.
- Al elegir una pagina, detectar y mostrar claramente: nombre de pagina,
  Facebook Page ID, Page Access Token, cuenta profesional de Instagram,
  Instagram Business Account ID y usuario de Instagram, cuando existan.
- Mostrar las URLs de webhook y los eventos requeridos con estado visible.
  Debe poder suscribir la pagina a `messages`, `messaging_postbacks` y
  `messaging_referrals` cuando los permisos lo permitan.
- Generar un bloque listo para copiar a EasyPanel, con etiquetas inequívocas:
  `MESSENGER_PAGE_ID` e `INSTAGRAM_PAGE_ID` usan el Facebook Page ID;
  `MESSENGER_PAGE_ACCESS_TOKEN` e `INSTAGRAM_PAGE_ACCESS_TOKEN` usan el Page
  Access Token; `INSTAGRAM_BUSINESS_ACCOUNT_ID` usa el ID de la cuenta
  profesional de Instagram. `META_IG_ACCOUNT_ID`, si se usa para CAPI, es el
  mismo ID profesional de Instagram. Un token que empieza con `IGAAY...` es de
  Instagram Login y no debe colocarse como `INSTAGRAM_PAGE_ACCESS_TOKEN` en el
  cliente actual, que envia por la API de pagina de Meta.
- Incluir botones de diagnostico simples: comprobar token, comprobar webhook y
  enviar prueba de Messenger/Instagram. Los errores deben decir que falta o que
  dato no coincide, sin mostrar mensajes tecnicos crudos.
- Explicar los bloqueos externos de forma directa: app en modo desarrollo,
  URL de privacidad, permisos de Meta, pagina no suscrita, token vencido o
  necesidad de redesplegar despues de cambiar variables.
- No prometer escritura directa de variables en EasyPanel salvo que exista una
  integracion explicita y autorizada con su API. Si no existe, ofrecer el bloque
  de variables listo para copiar y pegar.
- Mantener OAuth oficial, sin scraping, cookies ni mecanismos que pongan en
  riesgo las cuentas de Meta.
- Revisar la deteccion existente de `/meta-connect`: nunca debe asignar el
  Instagram Business Account ID a `INSTAGRAM_PAGE_ID`; ambos IDs deben
  conservarse separados para evitar respuestas que entran pero no pueden salir.
- Requisito de arranque para este futuro conector: el dashboard debe abrir y el
  bot debe iniciar en modo de configuracion aunque no exista ningun canal Meta
  conectado. La ausencia de WhatsApp, Messenger o Instagram no puede dejar la
  pagina caida ni impedir el acceso al editor.
- El despliegue nuevo solo debe requerir una configuracion base permanente de
  infraestructura (acceso al editor, base de datos y clave de cifrado). Los
  datos por canal, como token de Meta, WABA, Phone Number ID, Page ID, webhook
  y verify token, deben guardarse cifrados desde el editor despues de la
  autorizacion oficial de Meta; no deben volver a requerir variables ni
  redeploy por cada numero.
- Para WhatsApp, mantener el proceso oficial: el usuario autoriza Meta y
  verifica el numero. El editor genera/guarda el verify token, muestra la URL
  de webhook exacta, comprueba la conexion y activa el canal. La primera
  confirmacion en Meta sigue siendo manual por seguridad; nunca automatizar
  migraciones de numeros ni desconectar un numero de otro proveedor.
- No construir un enrutador central de webhooks solo para evitar ese clic de
  Meta mientras los proyectos deban seguir independientes. Seria un punto
  unico de fallo y cambiaria la arquitectura sin necesidad.
- El conector implementado vive en `/meta-connect`. Guarda de forma cifrada la
  configuracion ingresada desde el dashboard y conserva las variables de
  EasyPanel como respaldo para no romper conexiones antiguas.
- Messenger e Instagram: iniciar sesion con OAuth, elegir explicitamente la
  pagina activa y usar `Configurar pagina activa` para suscribir sus eventos.
  Detectar una pagina nunca debe cambiar la activa sin un clic del usuario.
- Messenger e Instagram pueden usar paginas de Facebook distintas. Messenger
  conserva su pagina activa; Instagram se selecciona por separado desde una
  cuenta profesional detectada y vinculada a su propia pagina. Nunca activar
  Instagram por defecto ni cambiar Messenger al elegirlo. Antes de activar,
  mostrar la cuenta y su pagina vinculada y advertir que la misma cuenta no
  debe quedar atendida por dos bots a la vez. Filtrar webhooks de paginas o
  cuentas no activas para impedir respuestas cruzadas.
- WhatsApp: el conector detecta numeros/WABAs, pero el usuario elige el numero
  activo. Puede suscribirlo al webhook desde el panel. No migra, desconecta ni
  registra numeros en otro proveedor.
- Meta exige dos pasos manuales: crear/autorizar la app y confirmar en su panel
  la Callback URL + Verify Token de cada canal. El panel muestra ambos valores
  para copiar. El bot no debe intentar saltar esas autorizaciones.
- El token OAuth detectado para WhatsApp puede vencer. Ofrecer y priorizar el
  token permanente de System User cuando el usuario lo tenga; sin el, informar
  que debera reconectar cuando Meta lo venza.
- La configuracion interna se cifra con `META_CONNECT_ENCRYPTION_KEY` si existe
  o, como respaldo, con `DASHBOARD_PASSWORD`. No cambiar la contraseña del
  dashboard en una instalacion que usa el respaldo sin antes definir una clave
  estable, porque ya no se podran leer las credenciales cifradas.

## Pendiente: Comentario con palabra clave a Messenger

No implementar hasta que el usuario lo solicite. Agregar en el editor reglas
simples por pagina de Facebook: si una persona comenta una palabra elegida por
el usuario, por ejemplo `INFO`, `PRECIO` o `QUIERO`, enviarle un mensaje privado
de Messenger de venta ya configurado.

- Esta primera respuesta debe ser fija y no usar LLM, para no consumir IA en
  una automatizacion de palabra clave.
- Despues, si la persona responde o pregunta algo que no corresponde a una
  regla fija, debe continuar el flujo normal del bot con IA, contenido y
  modalidad del canal Messenger.
- La interfaz debe permitir crear, editar, activar, desactivar y borrar cada
  palabra/regla, y elegir que intro o secuencia propia de Messenger dispara.
- Usar los eventos y permisos oficiales de Meta para comentarios de pagina y
  mensajes privados. No responder publicamente ni enviar mensajes fuera de las
  reglas permitidas por Meta, salvo que el usuario habilite expresamente una
  respuesta publica.
- Mantener esta automatizacion aislada de WhatsApp, Instagram y las modalidades
  de venta existentes; no alterar una conversacion que ya este en curso.

## Zonas sensibles

- `data/` contiene datos en tiempo de ejecución y no debe tratarse como código fuente.
- `.env` y secretos no deben commitearse.
- `build`, `.next` y otros artefactos generados no deben modificarse manualmente.

## Verificación

- Si cambias lógica, ejecuta al menos `npm run lint`.
- Si el cambio afecta compilación o tipos, valida con `npm run build`.

## Referencias

- `README.md` para uso y despliegue.
- `CLAUDE.md` para contexto técnico más detallado.
