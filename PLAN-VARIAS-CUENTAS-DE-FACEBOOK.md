# PLAN — UN SOLO PROYECTO PARA VARIAS CUENTAS DE FACEBOOK

> Dictado por Alberto el 9 de octubre de 2026. **El diseño está entero aquí; lo que se parte
> en dos es la ejecución, y el motivo está en la PARTE 2.**
>
> Quien retome esto: lee el archivo completo antes de tocar nada. La mitad del valor está en
> el apartado «lo que ya existe», que evita reconstruir lo que ya funciona.

---

## 1. QUÉ PIDE, CON SUS PALABRAS

> «yo normalmente lo que hacía es duplicar cualquier proyecto y conectarlo con otra app, lo
> que no quiero es duplicar, quiero que se mantenga trabajando con más de 1 cuenta de fb»

Y el problema concreto que le hizo pedirlo:

> «Cuando yo conecto mi nueva cuenta de facebook aún sigo viendo el número que está conectado
> de la otra cuenta, pero no hay nada que haga distinción… Está confuso, es como si fuese un
> meta connect único donde todo está combinado»

Y su miedo, que es el que manda sobre el diseño:

> «Yo no quiero elegir una página de una cuenta y un píxel de la otra y un whatsapp de la
> otra. Además necesito yo saber cuántas cuentas de facebook están conectadas, en este momento
> no lo veo, es incierto.»

---

## 2. CÓMO DEBE QUEDAR

Meta Connect deja de ser una lista revuelta y pasa a estar **agrupado por cuenta**:

```
                      2 cuentas conectadas

┌─ MI NEGOCIO ────────────────────────────────┐
│  🟦 GRAFISMO    +51 999 888   Pág. ✓  Px ✓  │
│  🟩 LECTO       +51 977 666   Pág. ✓  Px ✓  │
└─────────────────────────────────────────────┘

┌─ NEGOCIO DEL SOCIO ─────────────────────────┐
│  🟧 TIENDA 3    +52 155 234   Pág. ✓  Px ⚠️  │
└─────────────────────────────────────────────┘

              [ + Conectar nueva cuenta ]        ← PARTE 2
```

Y dentro de una tienda, **elegir el número fija la cuenta**:

```
Tienda 3
  Número   +52 155 234 5678
  Página   [ solo las de esa cuenta ▾ ]
  Píxel    [ solo los de esa cuenta ▾ ]
```

**No se evita la mezcla con cuidado: se evita no ofreciéndola.** Los de las otras cuentas ni
aparecen en la lista.

### Las tres cosas, en orden de importancia para él

1. **El contador.** Hoy no sabe cuántas cuentas tiene conectadas y eso le genera desconfianza.
   Es lo primero que debe ver al abrir.
2. **Los selectores acotados.** Es su miedo explícito. Mientras se pueda mezclar, no va a
   confiar en la pantalla.
3. **Las tarjetas por cuenta.** Lo que convierte «una lista revuelta» en algo que se entiende.

### Y un avisador, que no pidió pero le ahorra un disgusto

Si una tienda quedó con la página de una cuenta y el píxel de otra —porque se configuró antes
de esto— la pantalla lo dice:

```
⚠️ Esta tienda mezcla dos cuentas: la página es de X y el píxel de Y
```

Sin eso, lo descubriría el día que Meta no le registre una compra.

---

## 3. LO QUE YA EXISTE — NO SE RECONSTRUYE

Auditado el 09/10/2026. **La mitad del trabajo ya está hecho**, y es la mitad difícil.

| Qué | Dónde | Estado |
|---|---|---|
| Cada número guarda **su propio permiso** | `meta_whatsapp_connections.access_token` | ✅ |
| El bot contesta **por el número que entró** | `runtime-config.ts:228`, `numeroDeSalida` | ✅ |
| Cada página guarda **su propio permiso** | `messenger/client.ts:22` | ✅ |
| Conectar un número **no borra los otros** | `INSERT … ON CONFLICT(phone_number_id)` | ✅ |
| La tienda guarda su número, su página y su píxel | `Tienda` en `config.ts:3466` | ✅ |
| Intros, seguimientos y regalos ya van por tienda | las cuatro etiquetas de los cajones | ✅ |
| Se pide el **dueño de cada píxel** | `connect.ts:368`, `owner_business{id,name}` | ✅ |

**ESTO ES IMPORTANTE Y SE LE DIJO:** no hay que tocar nada de intros, seguimientos ni regalos.
Ya cuelgan de la tienda. Al conectar una cuenta nueva solo se crea su tienda y el contenido
sabe solo a quién pertenece. Ese trabajo se hizo en octubre sin saber que preparaba esto.

### Lo que NO existe

| Qué falta | Por qué duele |
|---|---|
| El dueño de cada **número** | sin eso no se puede agrupar ni acotar |
| El dueño de cada **página** | lo mismo |
| Dónde guardarlos | las dos tablas no tienen esa columna |

**CORRECCIÓN A UNA AFIRMACIÓN ANTERIOR:** se dijo que «connect.ts ya pide owner_business, así
que el dato ya existe». **Eso solo vale para los píxeles.** Para números y páginas hay que
pedírselo a Meta y guardarlo. El error fue generalizar desde el caso del píxel sin comprobar
los otros dos.

---

## 4. PARTE 1 — AGRUPAR Y ACOTAR

**Sin riesgo para la venta.** Nada de lo que corre hoy cambia de comportamiento.

1. Añadir la **cuenta dueña** a las dos tablas de conexiones. Columna nueva, idempotente, como
   todas las de `db.ts`.
2. Pedírsela a Meta al conectar y al pulsar «Actualizar lista de Meta».
3. El **contador** arriba de Meta Connect.
4. Las **tarjetas por cuenta**.
5. Los **selectores acotados** en la tienda.
6. El **aviso de tienda mezclada**.

### Lo que pasa con lo ya conectado

Las conexiones de hoy quedan como **«cuenta sin identificar»** hasta que él pulse una vez
«Actualizar lista de Meta». Eso hay que decírselo en la pantalla, con esas palabras y con el
botón al lado — no dejarlo como un misterio.

### Lo que NO se hace en la parte 1

**El botón «Conectar nueva cuenta».** Ver la parte 2.

---

## 5. PARTE 2 — EL BOTÓN, Y POR QUÉ VA APARTE

**ESTE ES EL APARTADO QUE NO SE PUEDE SALTAR.**

Enviar mensajes ya funciona por cuenta: cada número lleva su permiso. **Medir, no.**

- La medición de compras en Meta (CAPI) usa **un solo permiso global**: `getCapiAccessToken()`
- La lectura de anuncios para el ROAS, igual: `saveMetaAdsReader`

Así que **un botón «Conectar nueva cuenta» que solo sea pantalla le apagaría la medición de la
primera cuenta**: el permiso global se reemplaza por el de la segunda, y las compras de la
primera dejan de registrarse en Meta.

Eso es dinero, y no se nota: la venta sigue saliendo bien. Solo deja de contarse.

**La parte 2 es guardar un permiso de medición POR CUENTA**, y que cada tienda mida con el de
la suya. Recién ahí se pone el botón.

Va en su propio commit, y toca el camino de la medición — no el de la venta.

### HECHO el 10/10/2026 — cómo quedó

Al auditarla aparecieron **tres fallos más** que hacía entrar con una segunda cuenta, y se
cerraron juntos:

| Qué hacía | Cómo quedó |
|---|---|
| Una sola llave de medición para todas las tiendas | Tabla `meta_cuentas`: un permiso por cuenta. La compra usa el de la cuenta de su tienda (`elPermisoDeLaTienda`, en `conversions.ts`) |
| La lista de píxeles se **reemplazaba** con la de la última cuenta | Se **junta** (`juntarPixeles`, en `callback/route.ts`) |
| Una cuenta nueva con un solo número lo pasaba a **«Activo»** | Con «Conectar nueva cuenta», nunca |
| El permanente era uno solo y global | «Generar permiso permanente» en cada tarjeta, guardado solo en su cuenta |

**LA REGLA DE LA MEDICIÓN** (`permisoDeMedicionDeLaCuenta`, en `db.ts`):

1. Si la cuenta tiene **permanente propio**, usa ese.
2. Si entró por **«Conectar nueva cuenta»**, usa el de su login (caduca a los ~60 días).
3. Si no, devuelve null y se mide **como antes de todo esto**. Con una sola cuenta es
   siempre este caso: nada cambia.

**«Conectar nueva cuenta»** (`/api/meta/connect/start?nueva=1`) no pisa nada de la de
siempre: ni `meta_user_token`, ni el número activo, ni los píxeles, ni las variables
detectadas, ni el permiso de login de una cuenta principal.

**El motor no se tocó**: `engine.ts`, `handler.ts`, `payment.ts` y el envío siguen
iguales. Solo cambió con qué permiso se manda a Meta la compra que ya se mandaba.

**Pendiente, visto y no tocado:** el permiso con el que **envía** cada número también es del
login y caduca a los ~60 días. Ya era así antes; con dos cuentas se nota el doble.

### HECHO el 10/10/2026 — los activos compartidos y el filtro por cuenta

Al ver su pantalla real con 3 cuentas, pidió: «que cada cuenta tenga sus propios
activos, y que yo pueda elegir activos de una misma cuenta, y si están compartidos
también».

**EL ERROR QUE CORRIGE:** la regla de la parte 1 solo miraba al **dueño**. Un píxel que
BM Basura 2 le comparte a Aula Virtual Pro salía como «mezcla» y no se ofrecía en su
tienda, aunque Meta lo acepta.

- Cada número, página y píxel guarda **con qué cuentas está compartido**
  (`compartido_con`, y `accesoDe` en los píxeles).
- **Un activo vale para una tienda si es de la cuenta de su número o está compartido
  con ella.** Solo se avisa si no es ninguna de las dos cosas (`puedeUsarlo`, en
  `src/lib/meta/cuentas.ts`).
- En el selector de la tienda, los compartidos dicen «compartido por …».
- **«Ver cuenta»**, arriba en Meta Connect: filtra las tarjetas y las secciones 4, 6 y 7.
  Lo activo sale siempre, aunque sea de otra cuenta.
- **«Probar cada tienda»** prueba el píxel **real** de cada tienda, con el permiso con el
  que mide de verdad. La versión anterior probaba un píxel cualquiera de la cuenta.

**Para que aparezcan los compartidos** hay que volver a pulsar «Actualizar lista de Meta»
y «Conectar nueva cuenta» con cada login: cada login solo sabe de sus negocios.

### HECHO el 10/10/2026 — «la diferenciación», y una sola app

**Lo que quedó claro tras una tarde de confusión:** se usa **una sola app** (la de la
sección 1). Las demás cuentas de Facebook entran por esa misma app, o ni eso si su Facebook
administra el negocio de la otra. Los números de otras apps se pasan al bot con
**«Suscribir»**, que es por cuenta de WhatsApp (WABA), no por número. **La idea de «una
app por cuenta» quedó descartada.**

**El bloque de arriba de Meta Connect** —él lo llama «la diferenciación»— se rehízo sobre
un dibujo que aprobó con sus datos reales: un bloque por negocio, una fila por número 📱,
página 📘 y píxel 🎯, y **«Suscribir» / «✓ Suscrito»** al lado de cada número
(`whatsapp/suscribir`). Se quitaron de ahí el selector «Ver cuenta», las tiendas y la
medición: él lo encontró «bien enredado».

**La medición** (permiso permanente por negocio, «Probar cada tienda») pasó a la sección
«7. Píxel» (`MedicionPorCuenta`).

---

## 6. LO QUE NO SE TOCA

- **El motor.** Nada de `engine.ts`, `handler.ts` ni el envío.
- **Las intros, los seguimientos y los regalos.** Ya van por tienda.
- **El permiso de cada número y de cada página.** Ya funcionan y fueron un arreglo suyo del
  01/10/2026, cuando su segunda página contestaba con el token de la primera.
- **La aplicación de Meta es una sola, y eso no lo decide el proyecto.** Lo decide Meta. En la
  práctica: la otra persona autoriza su número a la app de él. No hay nada que programar ahí.

---

## 7. LO QUE NO SE VA A PODER PROBAR

Dicho por delante, para que nadie lo entregue como verificado:

- **No hay dos cuentas de Facebook de verdad para probar.** Lo de agrupar se puede probar con
  datos inventados; lo de conectar una segunda cuenta real, no.
- **Dos páginas de Messenger vendiendo a la vez nunca se ha medido.** El código está desde el
  01/10/2026 y está comentado, pero no se ha vivido una venta por cada una.

**Recomendación:** cuando tenga la primera cuenta ajena conectada, correr una venta completa
por ese número ANTES de meterle tráfico.

---

## 8. POR QUÉ ESTE ARCHIVO EXISTE

Lo pidió él:

> «¿no tienes manera de indicarle cómo sería el proyecto para no darle por partes? quizás
> podrías crear un archivo de cómo debería quedar»

Y tiene razón en lo que señala: **partir la ejecución no debe significar partir el diseño.**
Quien haga la parte 1 tiene que saber adónde va la parte 2, o tomará decisiones que luego
estorben.

El orden de ejecución sigue siendo 1 y después 2, por lo que dice el apartado 5.
