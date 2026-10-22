import type { Metadata, Viewport } from "next";
import { Inter, Manrope, Noto_Color_Emoji } from "next/font/google";
import "./globals.css";

/**
 * LA LETRA DE LOS TÍTULOS.
 *
 * Los títulos iban con la letra del sistema, que en Windows es Segoe UI: una
 * letra de leer párrafos, no de titular. Puesta en grande y en negrita se ve
 * ancha y blanda, y un título que no pesa no ordena la pantalla.
 *
 * Manrope es geométrica y cierra mucho el espacio entre letras, así que en
 * tamaño grande y peso 800 hace bloque. Es la clase de letra de la referencia.
 *
 * SOLO PARA TÍTULOS. El texto corrido se queda con la del sistema, que es la
 * que mejor se lee en cada máquina y no cuesta ninguna descarga.
 *
 * `display: "swap"` dibuja desde el primer momento con la del sistema y cambia
 * cuando llega: sin esto, los títulos aparecen en blanco hasta que baja la
 * fuente.
 */
const fuenteDeTitulos = Manrope({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--fuente-titulo",
  display: "swap",
});

/**
 * LA LETRA PROLIJA (22/10/2026): «mira el mío que parece una chatarra vieja y el de Sendy se ve
 * más ordenado… en el mío se ven más delgaditas las letras». Segoe UI en tamaño chico se ve
 * flaca; Inter está hecha para pantalla y a 13–15 px se lee firme. SOLO donde lleva la clase
 * `prolijo` (los cajones editores y Mis tiendas): el resto del bot no cambia.
 */
const fuenteProlija = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--fuente-prolija",
  display: "swap",
});

/**
 * LOS EMOJIS, DIBUJADOS IGUAL EN TODAS LAS MÁQUINAS.
 *
 * QUÉ PASABA. El editor no usaba ninguna fuente de emojis: descargaba cada uno
 * como una IMAGEN suelta desde un repositorio público, con la dirección escrita
 * SIN número de versión. Ese repositorio movió su carpeta y desde entonces
 * devuelve error para todos. El componente tiene una red de seguridad —si la
 * imagen no llega, dibuja el carácter a secas—, así que la caída fue silenciosa:
 * no hubo cuadros rotos, simplemente volvieron los emojis del sistema.
 *
 * POR QUÉ ESO ROMPE UN MAC VIEJO. En macOS Mojave (2018) la tipografía de
 * emojis no conoce nada posterior a esa fecha: los de 2021 en adelante salen
 * como cuadraditos. Y los COMPUESTOS —persona + hilo invisible + objeto, que son
 * 249 de los 1.921 del catálogo— se dibujan PARTIDOS EN DOS, que es el «me sale
 * el emoji y al lado otro que lo complementa».
 *
 * POR QUÉ UNA FUENTE Y NO IMÁGENES. Una textarea de HTML no puede mostrar
 * imágenes: ahí siempre manda la tipografía. Con las imágenes, el editor se veía
 * bien en los visores y mal en la caja donde se escribe. Una fuente vale para
 * las dos, y además compone bien los emojis de dos piezas.
 *
 * POR QUÉ AUTO-ALOJADA. `next/font` descarga la fuente al compilar y la sirve
 * desde este mismo servidor. No hay ninguna dirección de terceros que pueda
 * cambiar debajo — que es exactamente lo que rompió lo anterior. Y el navegador
 * la guarda: se baja una vez y en los refrescos siguientes no la vuelve a pedir.
 */
const fuenteDeEmojis = Noto_Color_Emoji({
  subsets: ["emoji"],
  weight: "400",
  variable: "--fuente-emoji",
  display: "swap",
  // No se precarga: pesa, y no hace falta tenerla antes de pintar. Con `swap`,
  // la página sale con los emojis del sistema y los cambia en cuanto llega.
  preload: false,
});

export const metadata: Metadata = {
  title: "Agente WhatsApp",
  description: "Dashboard del agente conectado a la API oficial de WhatsApp Cloud.",
};

/**
 * Sin esto, el celular dibuja la página como si fuera un monitor y todo sale
 * diminuto. Se declara explícito para no depender del valor por defecto.
 *
 * NO se bloquea el zoom a propósito: poder acercar para leer un comprobante
 * borroso vale más que cualquier ganancia estética.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

/**
 * EL TEMA SE ELIGE ANTES DE PINTAR.
 *
 * Si esperase a que arranque React, la página se dibujaría primero en claro y
 * cambiaría a oscuro medio segundo después: un fogonazo blanco en cada carga.
 *
 * Por eso va como script suelto en el `<head>`: corre antes de que se pinte
 * nada. Y va envuelto en try/catch porque en una ventana privada leer el
 * almacenamiento puede lanzar, y un error aquí dejaría la página en blanco.
 */
/**
 * EL TEMA OSCURO ESTÁ GUARDADO, NO BORRADO.
 *
 * Se apaga a propósito mientras se termina el claro. Estaba a medias: los
 * paneles de color —el ámbar de los avisos, el rojo de los bloqueos, el verde
 * de lo aprobado— seguían siendo claros mientras la letra de encima ya se había
 * vuelto blanca. Blanco sobre crema no se lee. Eso no es feo, es inservible, y
 * un tema a medias suelto es peor que no tenerlo.
 *
 * QUÉ SE APAGA. La elección. Aquí siempre se pone «claro», sin mirar lo que
 * haya guardado, y el botón de cambiar tema no se dibuja en ninguna pantalla.
 *
 * QUÉ NO SE TOCA. Todo lo demás: los colores del oscuro en `globals.css`, la
 * variante `oscuro:` y el componente del botón. Volver a encenderlo es leer
 * otra vez lo guardado aquí y devolver el botón a las dos barras.
 *
 * Y NO SE BORRA LO GUARDADO: quien tenía elegido el oscuro lo recupera tal cual
 * el día que se encienda.
 */
const ELEGIR_TEMA_ANTES_DE_PINTAR = `document.documentElement.dataset.tema="claro";`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="es"
      className={`${fuenteDeTitulos.variable} ${fuenteDeEmojis.variable} ${fuenteProlija.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: ELEGIR_TEMA_ANTES_DE_PINTAR }} />
      </head>
      {/* EL SUELO DE TODO EL BOT SALE DEL TEMA.
          Iba con un gris fijo. Ahora lo pone el tema, así que el chat, el
          tablero y el editor pisan el mismo suelo y los tres cambian a la vez
          con el botón de claro/oscuro. */}
      <body className="min-h-screen bg-fondo text-tinta antialiased">
        {children}
      </body>
    </html>
  );
}
