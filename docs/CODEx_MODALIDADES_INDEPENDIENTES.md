# Reglas para Codex: modalidades independientes

Este proyecto tiene 4 modalidades de venta. Deben tratarse como flujos comerciales independientes, no como variaciones del mismo contenido.

## Contexto operativo que no se debe olvidar

El bot recibe conversaciones desde las APIs oficiales de Meta y vende siguiendo
el contenido configurado desde el editor. La arquitectura es el motor de una
tienda vacia; el producto, sus precios, beneficios, pagos, entregas, galerias y
textos comerciales son inventario configurable, no reglas que pertenezcan al
codigo. Por eso, una instalacion puede cambiar completamente de producto desde
el editor sin contaminar la arquitectura con datos del producto anterior.

Una conversacion se crea o recupera por el mensaje entrante, sea organico o
desde un anuncio. `ctwa_clid` llega solo en el referral de un anuncio
Click-to-WhatsApp: se conserva como atribucion para CAPI/Ads Manager, pero no
habilita ni bloquea la atencion ni la venta.

El menu `Producto` del editor clona y activa perfiles comerciales separados.
Cada perfil contiene sus modalidades y contenido propios. Aislar contenido
significa aislarlo tanto entre modalidades como entre perfiles de producto.

## Impacto obligatorio en tokens

En cada propuesta e implementacion, declarar el impacto esperado en tokens de
IA: sin impacto, aumento ligero o aumento material, y explicar la causa. El
costo depende del prompt/contexto enviado, llamadas adicionales y extension de
la respuesta del LLM; no se deduce solo del numero de lineas de codigo. Buscar
siempre eliminar contexto duplicado y evitar llamadas o instrucciones
innecesarias, sin comprometer pagos, entrega, postventa ni el aislamiento entre
modalidades.

## Regla principal

No copiar, sincronizar, heredar ni reutilizar contenido comercial entre modalidades.

Si el operador escribe "papa" en una modalidad, esa palabra no debe aparecer en otra modalidad por efecto del editor, guardado, cambio de pestaña o cambio de modalidad.

## Que si se puede compartir

- Webhooks.
- Conexion Meta / WhatsApp / Messenger / Instagram.
- Guardado en GitHub.
- Base de datos.
- Validacion de pago.
- Envio de mensajes.
- Protecciones de repo.
- Motor interno y helpers tecnicos.

## Que no se debe compartir

- Intro.
- Seguimientos.
- Nombre de producto.
- Contenido del producto.
- Galerias.
- Entregas.
- Texto de pago.
- Reglas comerciales.
- Regalo y postventa si esta configurado por modalidad.
- Cerebro comercial o instrucciones de venta.

## Canales

Cada canal puede tener su propio saludo inicial y sus propios tiempos de espera.
Eso no autoriza copiar contenido entre modalidades ni entre canales. Si se edita
Messenger, Instagram, TikTok o WhatsApp dentro de `Canales`, el cambio debe quedar
guardado solo para ese canal y solo para la modalidad activa.

## Capacidades por modalidad

Lineal:
- Un solo producto.
- Un solo precio base.
- Pago directo.
- Entrega directa.
- Oferta de regalo.
- Entrega de regalo.
- Despedida.
- No debe mostrar Producto 2.
- No debe mostrar Pack.
- No debe pedir elegir opcion.

Order Bump:
- Su propio producto principal.
- Su propia opcion combo.
- Su propia opcion basica.
- Sus propios textos, precios, entregas y seguimientos.

Bioferta:
- Su propio producto A.
- Su propio producto B.
- Su propio pack.
- Sus propios textos, precios, entregas y seguimientos.

Doble Oferta 2 Productos:
- Su propio Producto 1.
- Su propio Producto 2.
- No debe depender del Pack de Bioferta u Order Bump.
- Sus propios textos, precios, entregas y seguimientos.

## Zonas peligrosas

Antes de tocar estas partes, analizar y explicar el riesgo:

- `templateFromCfg`
- `applyTemplate`
- `switchModalidad`
- `modality_templates`
- pestaña `Contenido`
- pestaña `Entrega`
- pestaña `Canales`
- `config/intro-data.yaml`
- `src/app/api/workflow/route.ts`
- `src/lib/workflow/config.ts`

## Instruccion operativa

No hacer cambios amplios para "reutilizar" o "sincronizar" contenido si afectan modalidades. Si hace falta una migracion, debe conservar datos existentes, pero evitar que se muestren o se copien en modalidades que no corresponden.

No pushear sin confirmacion explicita del usuario.
