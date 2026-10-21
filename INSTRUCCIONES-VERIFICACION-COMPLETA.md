# VERIFICACIÓN COMPLETA — CÓRRELA ENTERA, SIN PARAR, Y DEJA UN REPORTE

> Escrito el 12 de octubre de 2026 a petición de Alberto, para que la verificación se haga
> igual cada vez. Con sus palabras: **«necesito que no pare, y que me dé reporte al final»**.
>
> **AUTORIZACIÓN EXPRESA DEL DUEÑO:** corre todo esto **sin pedir permiso**, de principio a
> fin. Él se va a dormir. No le preguntes nada a mitad: si algo falla, lo anotas y SIGUES con
> lo siguiente. Solo paras si el servidor no arranca, porque entonces nada más se puede medir.
>
> ## 📖 LEE PRIMERO `COMO-SE-PRUEBA-ESTE-BOT.md`
>
> Son los **catorce tropiezos** que ya se pagaron montando este banco de pruebas: el simulador
> que habla por FormData, el contador que nunca llega a 2, las 43 conversaciones que ensucian
> una prueba, el servidor que ya estaba corriendo en otro puerto, los comprobantes que al
> repetirse se rechazan por duplicados.
>
> **Quince minutos de lectura te ahorran la noche entera.** No es documentación de fondo: es
> la lista de las trampas concretas que hay en el camino que vas a recorrer ahora.

---

## LO PRIMERO, Y NO ES NEGOCIABLE

### Su configuración se devuelve INTACTA

Las pruebas de recorrido tocan `config/intro-data.yaml`. **Antes de empezar, guarda una copia
y su huella; al terminar, compara y restaura.**

```powershell
# ANTES
Copy-Item 'config\intro-data.yaml' "$env:TEMP\intro-ANTES.yaml"
(Get-FileHash 'config\intro-data.yaml' -Algorithm SHA256).Hash

# AL TERMINAR — tiene que dar EXACTAMENTE la misma huella
(Get-FileHash 'config\intro-data.yaml' -Algorithm SHA256).Hash
```

Si no coincide: `Copy-Item "$env:TEMP\intro-ANTES.yaml" 'config\intro-data.yaml' -Force` y
**dilo en el reporte**. Esto ya pasó y le borró contenido una vez.

### Las conversaciones de prueba se borran

Si se quedan, `prueba-no-suma-ni-inventa-datos-de-pago` se pone roja **por culpa de la
prueba, no del código**. Pasó, y se perdió un rato buscando un fallo que no existía.

Los recorridos borran lo suyo salvo con `--conservar`. Al final, comprueba que no quedan
conversaciones de prueba y bórralas si quedaron.

### Lo que NO se toca

El motor: `engine.ts`, `handler.ts`, `config.ts`, `sender.ts`, `worker.ts`. Esta tarea es
**verificar**, no arreglar. Si encuentras un fallo, **lo anotas y sigues** — él decide.

### LOS COMPROBANTES — ya los tiene, no hacen falta más

```
C:\Users\alberto\Desktop\comprobantes para prueba
```

**El nombre de cada archivo dice su monto.** Son 33 y cubren sus 21 precios: los seis de Perú,
los siete de Ecuador y los ocho de Argentina, en precio normal y con descuento.

Para Ecuador hay **cuatro copias del de 3 dólares** (`B`, `c`, `d`, `COPIA 2`). Usa una
distinta en cada corrida: el validador guarda huella por fecha e importe, y repetir el mismo
archivo lo rechaza por duplicado — que es correcto, pero rompe la prueba.

Sus precios, para elegir el archivo que toca:

| | Básico normal / descuento | Full normal / descuento |
|---|---|---|
| **GRAFISMO** PE | 10 / 8 | 14 / 10 |
| **GRAFISMO** EC | 3 / 2 | 4 / 3.50 |
| **GRAFISMO** AR | 8000 / 5000 | 11000 / 9000 |
| **LECTO** PE | 11 / 9 | 15 / 11 |
| **LECTO** EC | 3.50 / 2.50 | 4.50 / 3.99 |
| **LECTO** AR | 8500 / 6500 | 12500 / 9500 |

**OJO CON EL 10 EN PERÚ:** es el básico de GRAFISMO **y** su full con descuento. No uses ese
comprobante para las dos cosas en la misma corrida.

### Antes de nada: `git pull`

Su contenido vive en la nube y lo edita desde el panel. **Empieza siempre por `git pull`**, o
estarás probando contra un contenido viejo y los fallos que reportes serán fantasmas.

### Y al terminar: NO DEPLOYES

Él deploya. Tú no. Aunque todo salga verde.

---

## PASO 1 — COMPILAR LIMPIO

```powershell
Remove-Item '.next' -Recurse -Force -ErrorAction SilentlyContinue
npx tsc --noEmit
```

La caché esconde errores que el deploy sí ve. Por eso se borra `.next` primero.

---

## PASO 2 — LA BATERÍA ESTÁTICA

```powershell
$rojas=@(); $n=0
Get-ChildItem scripts\prueba-*.mjs | ForEach-Object {
  $n++; $o = node $_.FullName 2>&1
  if ($LASTEXITCODE -ne 0) { $rojas += $_.Name }
}
"$n pruebas, $($rojas.Count) rojas"
$rojas | ForEach-Object { "  - $_" }
```

### LAS SIETE ROJAS CONOCIDAS — NO LAS PERSIGAS

Estas estaban rojas **antes** de cualquier cambio. Salen de su contenido, no del código:

```
prueba-acepto-el-extra-y-no-llego-nada
prueba-el-cajon-de-pago-cobra-lo-de-su-paso
prueba-el-visor-ensena-el-precio-del-pais
prueba-elegir-por-el-numero
prueba-motor-sin-datos-de-un-pais
prueba-regalo-no-se-mete-en-medio
prueba-regatear-no-es-elegir
```

**Si salen esas siete y solo esas, está bien.** Una octava roja SÍ es una regresión y va al
reporte con su nombre y lo que dice.

---

## PASO 3 — LA VENTA DE VERDAD

**Esto es lo único que demuestra que sigue vendiendo.** Una prueba estática comprueba que un
texto esté escrito; que esté escrito no prueba nada sobre lo que el bot hace con él.

**PRIMERO MIRA SI YA HAY UNO CORRIENDO.** Si levantas otro, el segundo se muere solo con
`Another next dev server is already running` y te quedas sin saber por qué nada responde:

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in 3000,3007,3100 } |
  Select-Object LocalPort, OwningProcess
```

Si ya hay uno, **úsalo** y salta el arranque. Si no:

```powershell
# En una ventana, y déjala viva:
npm run dev
```

Espera a que diga `Ready`. Anota el puerto (suele ser 3007).

**Y ten paciencia con la primera llamada:** Next compila cada ruta la primera vez que se la
piden. Puede tardar medio minuto y parecer caída. Reintenta antes de darla por muerta.

Luego, en otra ventana:

```powershell
node scripts/recorrido-completo.mjs --todas
```

Eso recorre las modalidades. Después, una por una las que él usa de verdad:

```powershell
node scripts/recorrido-completo.mjs --modalidad=lineal
node scripts/recorrido-completo.mjs --modalidad=doble_oferta_dos
node scripts/recorrido-completo.mjs --modalidad=order_bump
node scripts/recorrido-completo.mjs --pais=MX
node scripts/recorrido-completo.mjs --pais=EC
```

**NO uses `--con-modelo`.** Gasta sus créditos y él no lo ha autorizado para esto.

---

## PASO 4 — LOS RECORRIDOS DE LAS DOS TIENDAS

Sus dos tiendas de verdad:

```
tienda_mupk9ybz   GRAFISMO FONETICO
tienda_muq67lks   LECTO ESCRITURA
```

### Los seguimientos, que es donde más se pierde

```powershell
node scripts/recorrido-por-los-seguimientos.mjs --hasta=1 --paises=PE,EC,AR
node scripts/recorrido-por-los-seguimientos.mjs --hasta=2 --tienda=tienda_mupk9ybz
node scripts/recorrido-por-los-seguimientos.mjs --hasta=2 --tienda=tienda_muq67lks
```

**Para saber si llegó la oferta, mira `discount_active`, NO `last_followup_index`.** Ese se
queda en 1 y esperarlo es esperar para siempre. Costó una tarde descubrirlo.

### La transición entre semimodalidades

```powershell
node scripts/recorrido-por-los-seguimientos.mjs --hasta=2 --tienda=tienda_mupk9ybz --transicion=segunda_oculta
node scripts/recorrido-transicion-de-submodalidad.mjs
```

### Los comprobantes malos y el upgrade

```powershell
node scripts/recorrido-comprobantes-malos.mjs --tienda=tienda_muq67lks --pais=PE
node scripts/recorrido-del-upgrade.mjs --tienda=tienda_muq67lks --pais=EC
```

---

## PASO 5 — LAS CUATRO PRUEBAS QUE FALTAN, Y POR QUÉ

> Estas salen de mirar lo que se implementó estos días: el kanban por tienda, y en Meta
> Connect las columnas `business_id`/`business_name`, el agrupado por cuenta, los selectores
> acotados y el aviso de mezcla.
>
> **Ninguna de las pruebas estáticas que ya existen cubre esto.** Escríbelas y córrelas.

### 5.1 — El token no se pierde al refrescar · `prueba-refrescar-no-borra-el-permiso.mjs`

**EL RIESGO:** al añadir `business_id` y `business_name`, el `INSERT … ON CONFLICT` de
`meta_whatsapp_connections` y de `meta_connections` se tocó. Si alguna de esas dos escrituras
dejara el `access_token` vacío o lo sustituyera, **el bot se queda mudo** — y no da error: la
conversación entra, y no sale nada.

**Qué comprobar:** que en los dos `ON CONFLICT DO UPDATE` el `access_token` se conserva o se
actualiza con un valor real, y que **nunca** puede quedar en `NULL` o vacío al refrescar.
Léelo en `db.ts` y, si puedes, ejecútalo contra una base de prueba.

### 5.2 — Una conexión sin negocio sigue siendo elegible · `prueba-cuenta-sin-identificar-no-bloquea.mjs`

**EL RIESGO, y es el más probable de todos:** sus conexiones de hoy quedan como **«Cuenta sin
identificar»** hasta que pulse «Actualizar lista de Meta». Si el selector acotado solo ofrece
lo del MISMO negocio, y el negocio está vacío, puede que **no pueda elegir ni su página ni su
píxel** — y se quede sin poder configurar nada.

**Qué comprobar:** con `businessName` vacío o nulo, los selectores de página y de píxel
**siguen ofreciendo opciones**. Lo vacío agrupa bajo «Cuenta sin identificar», no excluye.

### 5.3 — El aviso de mezcla no grita sin motivo · `prueba-el-aviso-de-mezcla-no-miente.mjs`

**EL RIESGO:** si el aviso ⚠️ aparece cuando no hay mezcla de verdad —por ejemplo porque uno
de los dos negocios está sin identificar— él va a desconfiar de la pantalla entera.

**Qué comprobar:**
- Página de negocio A + píxel de negocio B → **avisa**
- Página y píxel del mismo negocio → **no avisa**
- Alguno sin negocio identificado → **NO avisa**, porque no se sabe, y no saber no es mezclar
- Un píxel compartido entre dos negocios → **no avisa**: es un caso real y legítimo

### 5.4 — El kanban no esconde conversaciones · `prueba-el-kanban-no-pierde-tarjetas.mjs`

**EL RIESGO:** `/api/conversations` ahora resuelve la tienda de cada fila. Si una conversación
entró por un número que ya no pertenece a ninguna tienda, su `tienda_nombre` queda vacío. Con
el filtro en «Todas» esa tarjeta **tiene que seguir saliendo**.

**Qué comprobar:**
- Sin filtro de tienda, salen TODAS, incluidas las de tienda vacía
- La suma de las tarjetas de cada tienda, más las sin tienda, da el total
- Que `/api/conversations` sigue devolviendo todos los campos que ya devolvía

---

## PASO 6 — EL REPORTE

Déjalo en `REPORTE-VERIFICACION.md`, en la raíz, con la fecha. Él lo lee al despertar.

**Con este formato, que es el que entiende:**

```markdown
# REPORTE DE VERIFICACIÓN — <fecha>

## EN UNA LÍNEA
<«todo bien» o «hay N cosas que mirar»>

## LO QUE SE PROBÓ
| Qué | Resultado |
|---|---|
| Compilación | limpia / N errores |
| Batería estática | N pruebas, N rojas |
| Las 7 rojas conocidas | las mismas / apareció otra |
| Venta completa, las modalidades | pasó / falló en X |
| Seguimientos 1 y 2 | pasó / falló en X |
| Transición de semimodalidad | pasó / falló en X |
| Comprobantes malos | pasó / falló en X |
| Upgrade | pasó / falló en X |
| Las 4 pruebas nuevas | N verdes, N rojas |

## LO QUE FALLÓ
<Para cada fallo, y en este orden:>
**Error detectado:** <qué pasa, en una frase, sin tecnicismos>
**Dónde:** <archivo y línea>
**Qué cliente lo viviría:** <el caso real, con palabras suyas>
**NO LO ARREGLÉ** porque esta tarea era verificar.

## LO QUE NO QUEDÓ PROBADO
<Dilo con esas palabras. Lo que no se pudo medir, y por qué.>

## SU CONFIGURACIÓN
Huella antes: <sha>
Huella después: <sha>
<«idéntica» o «se restauró»>

## CONVERSACIONES DE PRUEBA
<«ninguna quedó» o «se borraron N»>
```

---

---

## QUÉ HACER CON LAS CUATRO PRUEBAS NUEVAS

**Súbelas.** Son lo único que se escribe en esta tarea, y subirlas es lo correcto: una prueba
que se queda sin subir se pierde y hay que volver a escribirla.

```powershell
git add scripts/prueba-refrescar-no-borra-el-permiso.mjs
git add scripts/prueba-cuenta-sin-identificar-no-bloquea.mjs
git add scripts/prueba-el-aviso-de-mezcla-no-miente.mjs
git add scripts/prueba-el-kanban-no-pierde-tarjetas.mjs
git add REPORTE-VERIFICACION.md
```

El mensaje del commit, a un archivo —lleva acentos y `git commit -m` los rompe en PowerShell—
y después `git commit -F ese-archivo`, `git push`.

**Lo que NO se sube:** ningún arreglo. Si alguna prueba nueva sale roja, **se sube roja** y se
explica en el reporte. Una prueba roja que señala un fallo real vale más que una verde que lo
tapa — y arreglarlo de madrugada es exactamente lo que él no quiere que pase.

---

## LAS REGLAS DE ESTA TAREA, RESUMIDAS

1. **No pares.** Un fallo se anota y se sigue.
2. **No arregles nada.** Es verificar. Él decide qué se toca.
3. **No persigas las 7 rojas conocidas.**
4. **No gastes `--con-modelo`.** Son sus créditos.
5. **Devuélvele su configuración idéntica**, y dilo con la huella.
6. **Borra las conversaciones de prueba.**
7. **Frases cortas en el reporte.** El detalle va al código, no al chat.
8. **Di siempre la modalidad y la tienda** cuando reportes un fallo: sin eso no sabe dónde
   mirar, y son seis modalidades y dos tiendas.
