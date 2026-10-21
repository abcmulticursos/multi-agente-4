# LA BANDERA COMO ETIQUETA — dirigir intros y seguimientos por país

> **NO IMPLEMENTAR.** Especificado por Alberto el 24 de septiembre de 2026. Falta
> auditar el coste y que él dé el visto bueno.

## Lo que quiere, con sus palabras

> «Quiero que los seguimientos e intros y todo lo que yo elija se redirija a un
> país. Agregarle a las pestañas de seguimientos, intros etc, la capacidad de
> ponerle un selector con la banderita y el nombre: a un seguimiento o intro lo
> duplico, le pongo la banderita de Perú, o de Argentina o Ecuador, y que eso se
> vaya hacia el número de su respectiva lada.»

Y lo afinó después, que es lo que hace la propuesta buena:

> «¿Qué te parece usar la bandera como etiqueta? En este momento yo puedo
> etiquetar con los ads a dónde quiero que se vaya cada intro, seguimiento, etc.
> Me gustaría solo eso: ponerle la etiqueta, que en este caso sería la bandera, y
> que lo redirija de acuerdo a su país. **Pero eso no quita que se pueda etiquetar
> con los ads.**»

**DÓNDE SE APLICA:** intro, seguimientos, intro de order bump, intro de -DOU-,
intro del upsell — todo lo de la parte de venta. **La postventa NO**, y su
instinto es correcto: ahí no se sortea nada, la entrega la decide el producto
comprado.

## POR QUÉ SU DISEÑO ES MEJOR QUE EL PRIMERO QUE SE LE PROPUSO

La primera propuesta fue «un campo de país». La suya es «una etiqueta más, como
la del ad». Gana por tres motivos:

1. **El raíl ya está construido.** En `FollowupSequence` y `FollowupVariant` ya
   existe exactamente esta forma:

   ```ts
   /** Anuncios que pueden recibir esta variante. Vacío = general. */
   ad_keys?: string[];
   /** false = conserva etiquetas, pero entra al sorteo general. */
   ad_routing_enabled?: boolean;
   ```

   La bandera sería su gemela: `paises?: CountryCode[]` con su propio
   `pais_routing_enabled`.

2. **Ya sabe usarlo.** Misma mecánica que maneja a diario con los ads. Vacío =
   general; con etiqueta = solo para ésos.

3. **Trae gratis el interruptor de pruebas.** Ese `ad_routing_enabled` sirve para
   conservar las etiquetas y apagar el enrutado — probar sin borrar su trabajo.

## LA REGLA AL ELEGIR

**Las dos etiquetas tienen que cumplirse.**

```
cajón con 🇵🇪 y ad «NAVIDAD»  -> solo a peruanos que vinieron de ese anuncio
cajón con 🇵🇪 y sin ad         -> a todos los peruanos
cajón sin 🇵🇪 y con ad         -> a ese anuncio, de cualquier país
cajón sin nada                 -> general, como hoy
```

**Y SIN NINGUNA BANDERA PUESTA, NADA CAMBIA.** Todos los cajones quedan
generales, todos siguen jugando, y el bot se comporta idéntico a hoy. Se enciende
cajón por cajón y se vuelve atrás quitando la bandera.

## LA BANDERA TIENE QUE VERSE EN LA LISTA

Pedido con una captura el 24/09: en la lista de cajones —«INTRO · WHATSAPP»— la
bandera elegida debe aparecer **en la fila**, sin abrir el cajón.

```
▶  📱  🇵🇪  PRUEBA LINEAL            ● ☐  Subir Bajar Mover 🗑 Abrir
▶  📱  🇦🇷  QUIMICA EN ACCION        ● ☐  Subir Bajar Mover 🗑 Abrir
▶  📱      INTRO FLORES DE PAPEL     ● ☐  Subir Bajar Mover 🗑 Abrir
```

Entre el icono del canal y el nombre: ahí no estorba al punto de encendido ni a
los botones, y se lee de un vistazo bajando la lista.

**HOY LO ESTÁ HACIENDO A MANO**, escribiendo el emoji dentro del nombre —
«🇵🇪 QUIMICA EN ACCION - PERU»—. Con esto el nombre vuelve a ser solo el nombre.

## EL AGUJERO QUE HAY QUE DECIDIR ANTES

**Los horarios de los seguimientos son uno solo para todos.** Hoy hay franjas de
Perú (`followup_schedule.slots_peru`), separación mínima de 4 horas y horas de
silencio. Mandando a Argentina con franjas peruanas hay dos horas de desfase: lo
que en Perú sale a las 21:45, allí sale a las 23:45.

Tres salidas, y la elige él:

1. Dejarlo y asumir el desfase — gratis.
2. Franjas por país, junto a las banderas — término medio, encaja con esto.
3. Convertir la hora al huso del cliente — lo correcto, más trabajo.

## LO QUE FALTA AUDITAR ANTES DE PROMETER NADA

**Cuántos sitios sortean cajones y variantes, y si todos pasan por la misma
función.** Si pasan por una, esto es pequeño; si cada uno sortea a su manera, es
otra historia — y es exactamente el tipo de cosa que en este proyecto ya salió
cara tres veces («la caja que una modalidad llena y otra no abre»).

Se sabe que existen al menos `sorteaCajonDeIntro` y `resolveFollowupVariant`.
Hay que confirmar que las intros de order bump, -DOU- y upsell pasen por ahí.

## POR DÓNDE EMPEZAR

| Fase | Qué | Para qué |
|---|---|---|
| 1 | La bandera en los cajones de intro, y verla en la lista | Probar la idea en lo más simple |
| 2 | Lo mismo en las variantes de seguimiento | Aquí ya tiene lo que pidió |
| 3 | Un aviso si un país se queda sin ningún cajón | Que no se le caiga un país sin enterarse |
| 4 | Los horarios por país | Cuando lo demás esté probado |
