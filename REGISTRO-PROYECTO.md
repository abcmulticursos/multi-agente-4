# REGISTRO OFICIAL DEL PROYECTO — AGENTE-UNI-LECTOESCRITURA

> **Claude: este archivo es el registro AUTORITATIVO del proyecto. Léelo y actúa
> según esto. NO necesitas re-analizar el código para entender la estructura
> general — aquí está todo. Solo lee código puntual si vas a modificar algo
> específico.**

---

## Qué es
Bot de venta por WhatsApp de un producto digital (PDF educativo "Lectoescritura"
para niños de 4-8 años). El cliente escribe primero; el bot lo lleva por un
embudo hasta la compra y entrega el material.

## ⭐ ESTA CARPETA ES LA PLANTILLA OFICIAL
- **AGENTE-UNI-LECTOESCRITURA es la base de copiar-y-pegar** para productos
  nuevos. **NO usar `mundial` ni `universal` como plantilla.**
- Producto nuevo = duplicar esta carpeta → cambiar SOLO el contenido (en el
  panel `/editor` o en `config/intro-data.yaml`) → configurar bien el
  `GITHUB_REPO` del bot nuevo.

## ⚠️ CONFIG CRÍTICA (esto ya causó pérdida de contenido)
- **`GITHUB_REPO`** (variable de entorno del hosting) DEBE apuntar al repo de
  ESTE bot: `abcmulticursos/agente-uni-lectoescritura`. Si apunta a otro repo,
  el panel publica al lugar equivocado y **se pierde el contenido al deployar**.
- **`GITHUB_TOKEN`** con permiso de escritura en ESE repo (idealmente limitado
  solo a ese repo, así un repo equivocado falla y avisa).
- Ya hay un **bloqueo + cuadro "Entendido"** en el editor que avisa si el
  `GITHUB_REPO` no coincide con el repo de deploy.

## 🔒 REGLA DE GIT (obligatoria)
- **SIEMPRE `git pull --rebase origin main` ANTES de `git push`.** El contenido
  del panel se publica a GitHub; pushear sin pull pisa el trabajo del usuario.
  **Nunca force-push.**
- Existe `actualizar.ps1` (respalda el config + hace pull).

## Arquitectura (resumen)
- Next.js 16 + TypeScript + better-sqlite3. LLM vía OpenRouter (DeepSeek texto,
  Gemini visión/OCR).
- Meta Cloud API webhook → handler → phone-lock → workflow engine + LLM.
- **Todo el CONTENIDO vive en `config/intro-data.yaml`** (editable desde el panel
  `/editor`, hot-reload, sin redeploy). El código es AGNÓSTICO al producto.

## Principio rector: motor comercial generico, contenido hermetico

Este repositorio es un bot de ventas conectado mediante las APIs oficiales de
Meta. Meta entrega el mensaje entrante al webhook; el motor crea o recupera la
conversacion, ejecuta el flujo configurado y responde por el mismo canal. El
recorrido normal es: entrada del cliente -> informacion configurada ->
conversacion y seguimientos -> pago y validacion -> entrega -> postventa. Los
eventos de contacto, inicio de pago y compra se reportan a Meta CAPI cuando su
configuracion esta disponible.

`ctwa_clid` no crea la conversacion ni es requisito para vender. La
conversacion existe tambien para clientes organicos. Cuando el primer mensaje
viene de un anuncio Click-to-WhatsApp, Meta adjunta `referral.ctwa_clid`; se
guarda como atribucion de ese origen y permite reportar los eventos CAPI al
anuncio. Si no llega, el bot sigue atendiendo normalmente, pero no hay anuncio
al cual atribuir los eventos de WhatsApp.

La arquitectura debe ser una tienda vacia reutilizable: no codificar ni inferir
nombres, precios, beneficios, temarios, entregas, galerias, mensajes de pago ni
ninguna informacion de un curso/producto. Todo dato comercial se define
manualmente en el editor y en la configuracion del producto activo. Cambiar de
flores de papel a libros de lectura debe requerir solo cambiar el contenido del
editor, nunca una modificacion del motor.

El selector `Producto` del editor permite clonar el producto activo y crear
perfiles independientes. Cada perfil conserva su propia configuracion
comercial; activar otro perfil no debe mezclar sus textos con el anterior. Al
evaluar cambios, separar siempre el motor tecnico reutilizable del contenido
comercial: el primero puede evolucionar de forma generica; el segundo no debe
entrar al codigo de la arquitectura.

## Regla permanente: ahorro de tokens

Todo cambio debe cuidar el ahorro de tokens de IA. Antes de proponer o entregar
una implementacion, indicar de forma explicita su impacto esperado, usando una
de estas conclusiones o una equivalente concreta:

- "Este cambio no afecta el super ahorro de tokens."
- "Este cambio aumentara ligeramente el consumo de tokens" y explicar por que.
- "Este cambio aumentara el consumo de tokens" y explicar que contexto,
  instrucciones o respuestas adicionales lo producen.

No evaluar el costo solo por el numero de lineas de codigo: lo que afecta el
consumo es principalmente el contexto enviado al LLM, las instrucciones del
prompt, las llamadas adicionales y la longitud de las respuestas generadas.
Evitar contextos duplicados, prompts innecesariamente largos, llamadas
repetidas y respuestas fijas extensas. El ahorro nunca debe debilitar las
protecciones criticas de pago, entrega, postventa o aislamiento de contenido.

## Modalidades (mutuamente exclusivas, se eligen en el panel)
- **lineal**: 1 producto.
- **order_bump**: básico (producto principal) vs combo (principal + complemento);
  upsell intermedio al ir a pagar.
- **doble_oferta_dos** ("Doble Oferta 2 Prod"): 2 productos, elige uno.
- **bioferta** (etiqueta "Doble Oferta" en el panel): producto A, producto B, y
  PACK (ambos). Si paga el pack → entrega los dos. Si paga uno y quiere el otro →
  lo guía a completar la diferencia.

## Post-compra (IGUAL en todas las modalidades — es por ESTADO, no por modalidad)
Tras entregar: captura de correo (mensaje personalizado) → ofrecimiento del
regalo → comentario en Facebook → entrega del regalo.
- Switch en el panel **"Re-ofrecer regalo y volver a pedir correo"**
  (`post_sale_reoffer`): ON = re-ofrece de forma sutil; OFF = ofrece/pide una
  sola vez.
- Mensaje de correo avisa revisar la carpeta de SPAM.

## Upgrade (order bump y doble oferta)
Si compró el básico y quiere el combo/el otro, el bot le dice el saldo a
completar; al pagar la diferencia, acumula y entrega el combo. (Los gates de
upgrade usan `(isOrderBumpActive() || isDobleOfertaActive())`.)

## Pagos
- Precio esperado sale del config. Aprobación: monto pagado ≥ precio → APROBADO.
  El monto lo LEE la IA de visión del comprobante (punto débil: fotos borrosas).
  Alerta al admin tras 3+ fallos. Modo HUMANO en el panel para tomar control.
- Métodos de pago dinámicos: lista con etiqueta + método + variantes (aliases)
  editables + reordenar. Detección por título/alias con tolerancia a typos.

## Selector de país
Campo `country` en config → moneda a Meta (ISO), símbolo `{{MONEDA}}`, dialecto
del LLM, zona horaria. 10 países. Default Perú.

## 📌 PENDIENTE PRINCIPAL — CONTROL DE BURBUJAS (ahorro)
- Falta: un **campo numérico en el panel** para el MÁXIMO de burbujas que el bot
  manda por respuesta del LLM. Hoy el LLM parte respuestas en 5-7 burbujas.
- Implementación: gatear el "chunking" (en `handler.ts`, donde parte por `\n\n`)
  con ese máximo (si excede, AGRUPAR los chunks en ≤ máximo). + config + switch.
- **URGENTE porque:** WhatsApp cobrará POR MENSAJE desde el **1-OCT-2026**
  (verificado), incluidas las respuestas dentro de la ventana de 24h. Menos
  burbujas = menos costo.

## Gotchas (NO son bugs)
- La IA de visión (Gemini) a veces tarda 30-60s en leer un comprobante (latencia
  de Google) → parece que el bot "se pausa", pero entrega bien.
- Debounce: si el cliente manda varios mensajes rápido, el bot espera a que
  "termine" antes de responder.
- Comprobante DUPLICADO (misma foto/fecha/monto) → "ya te lo envié" (correcto, no
  re-entrega).

## Carpetas en el Desktop del usuario
- **AGENTE-UNI-LECTOESCRITURA** → este bot + LA PLANTILLA oficial.
- **agente-whatsapp-mundial** → bot de grafismo EN VIVO (NO es plantilla).
- **agente-whatsapp-universal** → base vieja (ya NO es la plantilla; usar lecto).
