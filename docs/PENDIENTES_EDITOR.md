# Pendientes del editor

## Visor integral del recorrido comercial

Pendiente solicitado por el usuario. No implementar sin una petición expresa.

Crear un visor emergente, solo lectura, con aspecto de WhatsApp y recorrido
vertical completo. Debe permitir revisar de arriba a abajo el contenido que se
enviaría para la combinación elegida de producto, modalidad, canal, país y,
cuando corresponda, etiqueta de anuncio.

Alcance esperado:

- Reunir únicamente cajones y burbujas ON en el orden comercial: saludo, intro,
  seguimientos, pago, entrega, regalo y postventa aplicables.
- No ejecutar el workflow, no llamar IA, no enviar a Meta y no cambiar estados.
- Usar el mismo renderizador de burbujas del editor para que texto, archivos y
  formato se vean como el cliente los recibirá.
- Mostrar los comodines resueltos con el valor del país seleccionado y marcar
  visualmente el fragmento que proviene de un comodín con un color discreto y
  consistente. El texto literal permanece con el estilo normal.
- Incluir selector de país en el visor para revisar moneda, precios, receptor,
  métodos de pago y demás valores antes de clonar o vender en otro país.
- Permitir scroll normal y arrastre de la barra; no usar una conversación viva
  ni alterar conversaciones existentes.
- Marcar de forma visible los bloques OFF que fueron omitidos solo si se activa
  un modo opcional de revisión; por defecto el visor muestra únicamente ON.

Objetivo: detectar contenido fijo que debería usar un comodín antes de copiar
una configuración a otro país, sin tocar el comportamiento del bot.

## Mejoras operativas futuras

- Buscador de cajones por texto, etiqueta de anuncio o nombre.
- Vista resumen de cajones ON/OFF, peso, demora y etiqueta de anuncio.
- Validación previa al guardado para bloques ON incompletos.
- Historial restaurable de versiones comerciales.
