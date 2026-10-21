# VISTA PIZARRA — el mismo contenido, visto como piezas y enchufes

> Acordado con Alberto el **16 de octubre de 2026**. Él lo pidió así: «el modo actual se
> conserve… tendría que convertirse en una modalidad adicional, tipo N8N con su visor tipo
> pizarra», y dejó las decisiones de diseño en mis manos: «no conozco nada de cómo funciona
> una pizarra, tú tienes mayor información… yo soy solo un observador».

## Qué es, en una frase

**Otra forma de mirar y manejar lo MISMO.** La vista clásica (menús y pop ups) no se toca y
sigue ahí. La pizarra lee y escribe exactamente los mismos campos, por el mismo guardado.

## Las dos reglas que mandan sobre todo lo demás

1. **El motor no se toca.** Ni motor, ni prompt, ni tiempos, ni cobros, ni seguimientos
   programados. El bot no sabe si algo se creó desde la pizarra o desde un menú.
2. **La pizarra no puede mentir.** Lo que dibuja como «esto sale» se decide con las mismas
   funciones que usa el bot, y una prueba lo compara contra el motor de verdad, con su
   contenido real, tienda por tienda y país por país.

## Cómo es (decidido)

- **Lógica de Kommo, aspecto de Sendy.** Cada ESTACIÓN de la venta es un bloque con una FILA
  POR PAÍS y la fila «Ninguna de las condiciones», cada una con su punto. Las PIEZAS (los
  cajones) flotan alrededor con colores por tipo, y un cable une cada fila con la pieza que
  sale para ese país.
- **Tienda y semimodalidad van en la cabecera**, no en el dibujo: ya se eligen al entrar.
- **Pestañas WhatsApp · Messenger · Instagram.**
- **Rojo = le llega la de otro país.** Es la red de seguridad del motor (sin pieza para su
  país, sale una CON bandera de otro), dibujada en vez de explicada.
- **Gris = apagada. Flotando sin cable = no enchufada a esta tienda.** Son dos cosas.
- **Sello 🌐 «Todas las tiendas»** en las piezas sin tienda.

## Estado al 16/10/2026

| Hecho | Commit |
|---|---|
| Fase 1: mirar (carriles por país hacia la derecha, claro/oscuro, Ctrl+Z propio) | `ac8c95e`, `f3bacf4` |
| Interruptor «Usar respaldo entre países» (Ajustes) + huecos en la pizarra | `ab48e72` |
| Fase 2: contenido en cada ficha, doble clic / clic derecho → Editar | `68ff8d3` |
| Fase 3: conectar/desconectar (arrastrando el enchufe o clic derecho), apagar, duplicar, «+», «+ País», posiciones recordadas en el navegador | `5d9a1a5` |
| Fase 4: upsell por carril, postventa (entrega y regalo) editable, «Probar recorrido», buscador | `07ab408` |
| Cables como Sendy (verde entra, naranja sale, «x» para cortar) y oscuro solo del fondo | `a990fd5` |
| «Las conexiones son el rey»: vista fija con Menús/Pizarra, ramas de botones y cuadritos, cajas, crear en el vacío, duplicar para un país, cajón entero, huecos que desconectan o saltan, posiciones y cajas guardadas con Ctrl+S (`pizarra`), todo con Ctrl+Z | `6585781` |
| Postventa en línea como Sendy (Pago → Entrega por producto → Upsell → Regalo, aviso si la entrega del canal pisa las fichas), panel «Fichas guardadas» (`visibles`), caja quieta que se estira por los bordes, cortar sin aviso dejando la ficha tenue en su sitio, duplicado al lado | `0aa88a6` |
| Sus correcciones: ventana con el editor completo y renombrar, doble clic en ramas, huecos «Falta conectar» (nada se conecta solo en el dibujo), semimodalidad en la franja, «+ País» con Ctrl+Z, Escape/clic afuera, cajas solo por esquinas, cobro con doble clic, upsell Sí/No, upsells en fila, regalo en ramas | `d49fa8a` |
| «Mis tiendas»: la puerta de la pizarra (crear, cambiar datos con la ficha de Ajustes, duplicar con sus sub pestañas, apagar, eliminar), ← y + dentro de la pizarra | `b1d4cc7` |

**Vocabulario con él:** «sub pestaña» = cada recuadro de la pizarra; «ficha» = solo la ficha
de producto de Contenido. Es para hablar: la pantalla aún dice «Fichas guardadas».

**Pendiente:** exportar una tienda a JSON. La frase activadora ya existe («Frases de entrada»).

**Lo que NO hace, a propósito:** que un botón o cuadrito salte a CUALQUIER ficha («este botón →
seguimiento 3»). Hoy solo lleva a los destinos que el bot ya tiene. Lo otro son los TRAMOS y
necesita el motor: proyecto aparte, con su reporte de candados.

Pendiente, y es DECISIÓN SUYA porque cambia cómo vende el bot (reporte con candados antes):
el interruptor de seguimientos por número, quitar el respaldo por tienda («🌐 todas las
tiendas»), y el fallo de «mejor el otro» en lineal y upsell (que ya existía).

## Fases (cada una en su commit, para poder revertirla sola)

1. **Mirar.** Pizarra de solo lectura con estaciones, filas por país, piezas, cables y avisos.
2. **Editar.** Doble clic o clic derecho → «Editar» abre el MISMO pop up de la vista clásica.
3. **Crear y enchufar.** «+ Nuevo…», [ENCHUFAR] / [DESENCHUFAR] con cables, duplicar.
   Con dos avisos obligatorios:
   - desenchufar una pieza 🌐 de UNA tienda la ata a las demás por nombre, y las tiendas
     que se creen mañana ya no la recibirían;
   - un seguimiento nuevo es un turno del canal entero: medir antes que en las otras
     tiendas no salga nada y que no retrase a los demás.
4. **Ideas fuera de su burbuja:** ▶ «Probar recorrido» con una bolita, panel de avisos,
   buscador, y la chapa del comodín en cada pieza.

## Lo que NO entra en la pizarra hasta que él decida

- **El interruptor de «usar anuncios»** (`ad_routing_enabled`). Está anotado desde el 24/09
  que se ve pero no se guarda. Ponerlo aquí sería mentir igual que el de hoy.
- **Caminos inventados con cables.** Los cables solo enchufan piezas a estaciones; el orden
  de la venta lo sigue poniendo el motor. Los caminos libres son el plan de los TRAMOS.

## Candados que se cumplen

| Candado | Cómo |
|---|---|
| Dependencia nueva | `@xyflow/react` (React Flow), aprobada el 16/10. Solo pantalla, se carga al abrir la pizarra |
| Un solo guardado | La pizarra usa `setCfg` y el guardado de siempre: seguro contra vaciado y grabación atómica |
| Posiciones de las piezas | Fuera de `intro-data.yaml`, para no hacer más lento el guardado |
| Verificación comercial | Compilación limpia + prueba pizarra-contra-motor + `recorrido-completo` antes de subir |
