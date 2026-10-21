# CÓMO SE PRUEBA ESTE BOT — Y DÓNDE ME TROPECÉ YO

> Escrito el 12 de octubre de 2026. Lo pidió Alberto: **«analiza cuáles fueron tus problemas
> para que no tropiece»**.
>
> Cada apartado de «LOS TROPIEZOS» es un fallo que YA SE COMETIÓ, con lo que costó. No son
> advertencias teóricas: son cicatrices. Léelas antes de montar un banco de pruebas nuevo, o
> las pagarás otra vez.
>
> El plan de ejecución está en `INSTRUCCIONES-VERIFICACION-COMPLETA.md`. **Este archivo
> explica el porqué**; aquel dice qué comandos correr.

---

## 1. LAS TRES CAPAS, Y QUÉ DEMUESTRA CADA UNA

| | Qué hace | Qué demuestra | Qué tarda |
|---|---|---|---|
| **`prueba-*.mjs`** | LEE el código fuente | que no se borró algo sin querer | milisegundos |
| **`recorrido-*.mjs`** | VIVE la venta: servidor, base, obrero | **que sigue vendiendo** | minutos |
| **Sus registros** | lo que pasó de verdad con clientes | la causa de un fallo real | gratis |

**LA REGLA QUE NACIÓ DE TREINTA HORAS PERDIDAS:** una prueba estática comprueba que un texto
ESTÉ ESCRITO en un archivo. Que esté escrito no prueba nada sobre lo que el bot hace con él.
Los días 13 y 14 de septiembre se entregaron tres correcciones «verificadas» solo con pruebas
estáticas: ninguna resolvió su caso, una dejó al bot mudo, y él hizo de banco de pruebas
durante treinta horas. La primera vez que se corrió el recorrido completo, el fallo apareció
en la primera pasada y gratis.

**Y LA TERCERA CAPA ES LA MÁS BARATA Y LA MÁS OLVIDADA.** Si él acaba de mandar un registro
donde el fallo se ve —sobre todo con sus pantallas en paralelo, donde una falla y otra no—
**eso ya es la medición**. Reproducirlo cuesta tiempo, créditos y paciencia para llegar al
sitio donde ya estábamos. Él lo dijo así: «yo creo que tú puedes detectar el problema sin
testear; lo que te mandé fue para testear LUEGO del arreglo».

---

## 2. LOS TROPIEZOS — CATORCE, Y TODOS PAGADOS

### 2.1 · El simulador habla por FormData, no por JSON

**Síntoma:** el mensaje no entra, o entra vacío, y el recorrido se queda esperando.

```
POST /api/test-simulator          { country, tienda, channel }   ← esto SÍ es JSON
POST .../mensaje                  FormData: content, button_id, file
DELETE /api/test-simulator/{id}   para limpiar
```

Mandar el mensaje como JSON parece correcto y falla en silencio. **Media hora.**

### 2.2 · `last_followup_index` NUNCA llega a 2

**Síntoma:** el recorrido espera el seguimiento 2 para siempre.

Ese contador se queda en 1. **Lo que marca que empezó la etapa de oferta es
`discount_active`.** Es el campo por el que hay que preguntar.

**Una tarde entera**, esperando algo que no iba a pasar.

### 2.3 · Leer el estado antes de que asienten las burbujas

**Síntoma:** la prueba dice que falta una burbuja, y al mirar a mano están todas.

El obrero manda **una burbuja por conversación cada 2 segundos**. Si se lee el estado justo
después de escribir, se lee a medias. Hay que esperar a que la cosa se quede quieta —en los
recorridos eso lo hace `queAsienten`— antes de comprobar nada.

### 2.4 · «8.500» leído como 8,5 y 500

**Síntoma:** un precio correcto se reporta como fallo.

Al sacar importes del texto con una expresión regular, el punto de los miles se confunde con
el decimal. Hace falta la regla de miles. Si no, los precios argentinos salen todos mal.

### 2.5 · La afirmación al revés

**Síntoma:** la prueba se pone roja cuando el bot hace lo CORRECTO.

Se escribió esperando que el precio fuera igual, y marcó como fallo la bajada legítima de
3.50 a 2.50 —que es el descuento funcionando—. **Antes de dar una roja por buena, pregúntate
si lo que marcó no será justo lo que debía pasar.**

### 2.6 · Las conversaciones de prueba que se quedan

**Síntoma:** `prueba-no-suma-ni-inventa-datos-de-pago` se pone roja sin que nadie tocara nada.

Un recorrido dejó **43 conversaciones** de prueba vivas y esa prueba las contó. Se perdió
tiempo buscando un fallo que no existía: lo había creado el propio banco.

**Los recorridos borran lo suyo salvo con `--conservar`. Si usas `--conservar`, limpia tú.**

### 2.7 · Su configuración queda tocada

**Síntoma:** no hay síntoma. Y eso es lo peligroso.

Los recorridos escriben en `config/intro-data.yaml`. Dos corridas murieron a medias —por falta
de memoria— y la configuración se quedó a medio camino.

**Huella SHA256 antes y después, siempre.** Y una copia en `$env:TEMP` por si acaso. Él ya
perdió contenido una vez por algo parecido.

### 2.8 · Ya hay un servidor corriendo

**Síntoma:** `Another next dev server is already running` y el recorrido no encuentra nada.

Pasó: había uno en el 3007, se intentó levantar otro en el 3100 y el segundo se murió solo.
**Mira primero si ya hay uno vivo y usa ESE puerto.**

```powershell
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 3000,3007,3100 }
```

### 2.9 · La primera petición tarda y parece caída

**Síntoma:** el servidor dice `Ready`, pero la primera llamada a una ruta nueva no contesta y
parece que no arrancó.

Next compila cada ruta **la primera vez que la piden**. Puede tardar medio minuto. Hay que
reintentar con paciencia antes de dar nada por muerto.

### 2.10 · Los recorridos tardan de verdad

**Síntoma:** el comando «se cuelga» y se mueve a segundo plano.

**No está colgado: está viviendo los tiempos del bot.** Las esperas entre burbujas y los
minutos de los seguimientos son reales, puestos a propósito. Un recorrido de seguimientos
hasta el 2 puede ser largo.

**Pon tiempos de espera generosos y no lo mates a los dos minutos.**

### 2.11 · Los comprobantes no se inventan

**Síntoma:** `--comprobante=` falla porque no hay archivo.

Las pruebas de pago necesitan **imágenes de comprobante de verdad**. Él las guarda en una
carpeta de su escritorio. **Si no las tienes a mano, salta esas pruebas y dilo en el
reporte** — no te inventes un archivo ni uses una imagen cualquiera.

### 2.12 · El mismo comprobante dos veces = duplicado

**Síntoma:** un pago legítimo se rechaza en la segunda corrida.

El validador guarda huellas: número de operación, y también **fecha + importe**. Repetir la
misma corrida con el mismo comprobante lo marca como repetido — **que es lo correcto**, pero
rompe la prueba.

**Varía el comprobante entre corridas**, o cuenta con ese rechazo y no lo reportes como fallo.

### 2.13 · Las pruebas que leen el código se rompen al cambiarlo

**Síntoma:** una prueba verde de ayer se pone roja hoy sin que el comportamiento cambie.

Varias pruebas **sacan un trozo del archivo fuente y lo ejecutan**. Eso es bueno —prueban el
código de verdad, no una copia escrita de memoria— pero si piden la forma EXACTA de una línea,
dejan de encontrarla en cuanto esa línea crece.

**Cómo se hace bien, aprendido a base de romperlo:**
- Captura hasta un punto estable, no una línea literal
- **Quita los comentarios** antes de ejecutar: el trozo se aplana a una línea y un `//`
  aplanado se come el resto
- **Quita las anotaciones de tipo** (`as { … }`): es TypeScript y se ejecuta como JavaScript

Y cuando una de estas se ponga roja: **mira si cambió el comportamiento o solo el molde.** Si
es el molde, se actualiza conservando lo que comprueba. **No se borra.**

### 2.14 · PowerShell no es Bash

**Síntoma:** el comando no hace lo que parece.

- `&&` **no existe** → usa `;` o `if ($?) { … }`
- **NUNCA `Set-Content` sobre un archivo de código** → rompe los acentos y deja el proyecto
  sin compilar. Está prohibido en CLAUDE.md.
- Mensajes de commit con acentos o comillas → escríbelos a un archivo y `git commit -F ese`
- La herramienta Bash está rota en este equipo (sale con 5). **PowerShell.**

---

## 3. LAS SIETE ROJAS CONOCIDAS

```
prueba-acepto-el-extra-y-no-llego-nada
prueba-el-cajon-de-pago-cobra-lo-de-su-paso
prueba-el-visor-ensena-el-precio-del-pais
prueba-elegir-por-el-numero
prueba-motor-sin-datos-de-un-pais
prueba-regalo-no-se-mete-en-medio
prueba-regatear-no-es-elegir
```

Estaban rojas **antes**. Salen de su contenido, no del código.

**NO LAS PERSIGAS.** Él lo dejó dicho: importar código para taparlas le rompió FRANKO. Si el
rojo sale de su contenido, **se reporta y se deja**.

Una octava roja SÍ es una regresión.

---

## 4. LAS DOS COSAS QUE MÁS TIEMPO AHORRAN

### 4.1 · Medir, no suponer

Si la frase empieza por «creo que», «probablemente» o «debe de ser», **no hay diagnóstico**.
Hay una hipótesis, y las hipótesis se miden antes de escribirlas en el código.

**Cómo se mide:** un banco pequeño que EJECUTE el código real —sacado del archivo, no
reescrito de memoria— y que imprima un número por escalón. El fallo está donde el número
cambia.

Un código reimplementado prueba lo que uno cree que hace, **que es justo lo que se está
poniendo en duda**.

### 4.2 · Pon el dato en la pantalla

Esto resolvió en un minuto un fallo que llevaba dos intentos fallidos.

El visor enseñaba el producto equivocado. Se razonó sobre código correcto dos veces. Lo que lo
destrabó fue **escribir en la cabecera de cada columna qué producto juega**: al comparar la
cabecera con la burbuja, el problema se partió en dos de un vistazo.

> **Cuando no sepas por dónde seguir, haz que la pantalla diga lo que está pensando.**

---

## 5. LO QUE NO SE PUEDE PROBAR, Y HAY QUE DECIRLO

Dicho con esas palabras en el reporte: **«esto quedó probado, esto no»**.

- **Lo que contesta el modelo.** El recorrido cubre el motor. Los turnos de conversación
  necesitan `--con-modelo`, que **gasta sus créditos** y se pide permiso antes.
- **Messenger e Instagram vendiendo de verdad.** Nunca se ha corrido una venta completa por
  ahí. El código está; la venta no se ha vivido.
- **Dos páginas de Messenger a la vez.** Escrito el 01/10/2026, nunca medido.
- **Dos cuentas de Facebook de verdad.** No hay una segunda cuenta para probar.
- **El registro de una compra real en Meta.** Eso solo se ve con una venta de verdad.

---

## 6. EL ORDEN, Y POR QUÉ ES ESE

1. **Compilar limpio** (borrando `.next`) — si no compila, lo demás sobra
2. **La batería estática** — barata, caza lo que se borró sin querer
3. **La venta de verdad** — lo único que contesta «¿sigue vendiendo?»
4. **Lo específico del cambio** — proporcional al riesgo, no por costumbre
5. **El reporte** — con lo que falló Y lo que no se pudo probar

**Y rojo primero.** Antes de arreglar, corre la prueba hasta VER el fallo con sus propias
letras. Quien no la vio fallar no sabe si arregló algo o si nunca estuvo roto.
