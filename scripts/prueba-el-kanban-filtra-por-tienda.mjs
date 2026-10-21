// EL TABLERO SE PUEDE MIRAR TIENDA POR TIENDA.
//
// ──── DE DONDE SALE ────────────────────────────────────────────────────────
//
// Lo pidio el 08/10/2026: «necesito que el kanban tambien sea por tienda».
//
// NO ES SOLO ORDENAR TARJETAS: ARREGLA LAS CUENTAS. Con dos tiendas vendiendo a la vez, la
// columna «Precio normal» sumaba en un mismo numero ventas de productos distintos a precios
// distintos. Veia S/. 48 y no sabia cuanto era de GRAFISMO y cuanto de LECTO. Al elegir una
// tienda, ese numero por fin significa algo.
//
// ──── LA DECISION QUE PROTEGE ESTA PRUEBA ──────────────────────────────────
//
// La tienda sale del numero por el que entro el cliente, y esa correspondencia vive en la
// configuracion, en el servidor. Habia dos caminos:
//
//   A. copiar esa logica al navegador  → DOS sitios decidiendo la tienda, y el dia que
//      cambien, el panel diria una cosa y el bot otra.
//   B. que el servidor la resuelva con `laTiendaDeLaConversacion`, la MISMA funcion que usa
//      el bot para vender, y la mande junto a cada conversacion.
//
// Se eligio B. CLAUDE.md lo pide con todas las letras: «reutilizar y extender la ruta
// existente; no añadir parches paralelos».
import { readFileSync } from "node:fs";

const ruta = readFileSync("src/app/api/conversations/route.ts", "utf8");
const tablero = readFileSync("src/components/KanbanBoard.tsx", "utf8");

let fallos = 0;
const pad = (t, n) => (t.length >= n ? t : t + " ".repeat(n - t.length));
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 54)} ${valor}`);
};

console.log("— la tienda la decide el servidor, por una sola puerta —\n");

comprobar(
  "usa la misma funcion que el bot",
  /laTiendaDeLaConversacion\(fila\)/.test(ruta),
  "nada de deducirla en el navegador"
);
comprobar(
  "y la manda con su color",
  /tienda_nombre:/.test(ruta) && /tienda_color:/.test(ruta),
  "el tablero filtra y pinta"
);
comprobar(
  "la fila sigue llegando entera",
  /\.\.\.fila,/.test(ruta),
  "es un campo que se añade, no un recorte"
);
// EL NAVEGADOR NO DEBE SABER QUE NUMERO ES DE QUE TIENDA. Si algun dia aparece aqui una
// tabla de numeros, son dos sitios decidiendo y vuelve el fallo que esto evita.
comprobar(
  "el tablero NO deduce la tienda por su cuenta",
  !/wa_phone_number_id/.test(tablero),
  "solo usa lo que le manda el servidor"
);

console.log("\n— el filtro, con el mismo molde que los de pais y origen —\n");

comprobar(
  "existe el filtro",
  /const \[tiendaFiltro, setTiendaFiltro\]/.test(tablero)
);
comprobar(
  "recorta la MISMA lista que usa todo el tablero",
  /porOrigen\.filter\(\(c\) => \(c\.tienda_nombre \?\? ""\) === tiendaFiltro\)/.test(
    tablero
  ),
  "por eso tambien cuadra el dinero"
);
comprobar(
  "y el tablero se recalcula al cambiarlo",
  /paisFiltro,\s*\n\s*origenFiltro,\s*\n\s*tiendaFiltro,\s*\n\s*\]\);/.test(tablero),
  "sin esto se quedaria congelado"
);
comprobar(
  "las tiendas del desplegable salen de los leads",
  /const tiendasConLeads = useMemo/.test(tablero),
  "no de la configuracion: aqui se elige entre lo que hay"
);
comprobar(
  "y respeta el pais y el origen ya elegidos",
  /if \(paisFiltro && paisDe\(c\) !== paisFiltro\) continue;[\s\S]{0,120}?if \(origenFiltro && origenDe\(c\) !== origenFiltro\) continue;/.test(
    tablero
  ),
  "para que los numeros del desplegable cuadren"
);

console.log("\n— y la salida, que es lo que mas se olvida —\n");

// EL FALLO QUE SE CAZO LEYENDO EL CODIGO, antes de que el lo viviera:
// elegir GRAFISMO, cambiar a un pais donde GRAFISMO no vendio, y que el selector desaparezca
// CON EL FILTRO PUESTO. El tablero se veria vacio y sin forma de deshacerlo.
comprobar(
  "el selector no desaparece con un filtro puesto",
  /\(tiendasConLeads\.length > 1 \|\| tiendaFiltro\)/.test(tablero),
  "un filtro que no se puede quitar es una trampa"
);
comprobar(
  "y la elegida sin leads sale con «(0)»",
  /!tiendasConLeads\.some\(\(t\) => t\.nombre === tiendaFiltro\)/.test(tablero),
  "explica por que esta vacio"
);

console.log("\n— la etiqueta en cada tarjeta —\n");

comprobar(
  "cada tarjeta dice de que tienda es",
  /\{convo\.tienda_nombre && \(/.test(tablero)
);
comprobar(
  "con el color que el eligio en Ajustes",
  /backgroundColor: convo\.tienda_color \|\| "#14b8a6"/.test(tablero),
  "el mismo que ve en el editor"
);
// SE PINTA CON `style` A PROPOSITO: es un color que escribe el usuario, y Tailwind no puede
// generar clases para colores que no conoce al compilar.
comprobar(
  "y no con una clase de Tailwind",
  !/bg-\[\$\{/.test(tablero),
  "no existiria esa clase"
);

console.log("");
if (fallos > 0) {
  console.log(`${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — el tablero se mira tienda por tienda, y las cuentas cuadran");
