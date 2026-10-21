// VARIAS CUENTAS DE FACEBOOK EN UN SOLO PROYECTO, SIN MEZCLARLAS — PARTE 1.
//
// ──── DE DONDE SALE ────────────────────────────────────────────────────────
//
// Lo pidio el 09/10/2026: «yo no quiero elegir una pagina de una cuenta y un pixel de
// la otra y un whatsapp de la otra. Ademas necesito yo saber cuantas cuentas de
// facebook estan conectadas, en este momento no lo veo, es incierto.»
//
// El diseño entero esta en PLAN-VARIAS-CUENTAS-DE-FACEBOOK.md.
//
// ──── QUE PROTEGE ──────────────────────────────────────────────────────────
//
// 1. LA REGLA DE LA MEZCLA, EJECUTADA DE VERDAD. Se importa `src/lib/meta/cuentas.ts`
//    tal cual (Node 24 ejecuta TypeScript): no se reescribe de memoria, porque una regla
//    reimplementada prueba lo que uno cree que hace.
// 2. QUE PEDIR LA CUENTA NO PUEDA DEJARLE SIN NUMEROS NI PAGINAS. Se pide en consultas
//    aparte; si se metiera en la peticion de la lista y Meta rechazara el campo, la lista
//    entera volveria vacia.
// 3. QUE NO APAREZCA EL BOTON «Conectar nueva cuenta». Es la parte 2: hoy conectar otra
//    cuenta reemplaza el permiso con el que se miden las compras de la primera.
//
// Nombres inventados a proposito: una prueba con los negocios reales taparia justo el
// fallo que esto evita.
import { readFileSync } from "node:fs";
import { compartidoPor, cuentaDeLaTienda, soloDeLaCuenta } from "../src/lib/meta/cuentas.ts";

let fallos = 0;
const pad = (t, n) => (t.length >= n ? t : t + " ".repeat(n - t.length));
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// Alfa es la cuenta de la tienda. Beta le COMPARTIO la pagina P4 y el pixel X3, pero NO la
// pagina P2 ni el pixel X2. (10/10/2026: «si estan compartidos tambien».)
const alfa = { id: "A", nombre: "Negocio Alfa" };
const beta = { id: "B", nombre: "Negocio Beta" };
const conectado = {
  numeros: [
    { id: "N1", cuenta: "A", cuentaNombre: "Negocio Alfa", accesoDe: [alfa] },
    { id: "N2", cuenta: "B", cuentaNombre: "Negocio Beta", accesoDe: [beta] },
    { id: "N3", cuenta: null, cuentaNombre: null },
  ],
  paginas: [
    { id: "P1", cuenta: "A", cuentaNombre: "Negocio Alfa", accesoDe: [alfa] },
    { id: "P2", etiqueta: "Pagina Beta", cuenta: "B", cuentaNombre: "Negocio Beta", accesoDe: [beta] },
    { id: "P3", cuenta: null, cuentaNombre: null },
    { id: "P4", cuenta: "B", cuentaNombre: "Negocio Beta", accesoDe: [beta, alfa] },
  ],
  pixels: [
    { id: "X1", cuenta: "A", cuentaNombre: "Negocio Alfa", accesoDe: [alfa] },
    { id: "X2", cuenta: "B", cuentaNombre: "Negocio Beta", accesoDe: [beta] },
    { id: "X3", cuenta: "B", cuentaNombre: "Negocio Beta", accesoDe: [beta, alfa] },
  ],
};

console.log("— la regla de la mezcla, ejecutada —\n");

{
  const r = cuentaDeLaTienda({ numero: "N1", pagina: "P1", pixel: "X1" }, conectado);
  comprobar("todo de la misma cuenta: no mezcla", r.mezcla === null);
  comprobar("y la cuenta la fija el numero", r.cuenta?.id === "A", r.cuenta?.nombre);
}
{
  const r = cuentaDeLaTienda({ numero: "N1", pagina: "P4", pixel: "X3" }, conectado);
  comprobar(
    "pagina y pixel COMPARTIDOS con su cuenta: no mezcla",
    r.mezcla === null,
    "Meta los acepta, y el los quiere poder usar"
  );
}
{
  const r = cuentaDeLaTienda({ numero: "N1", pagina: "P2", pixel: "X1" }, conectado);
  comprobar("la pagina de otra cuenta y NO compartida: aviso", r.mezcla !== null);
  comprobar(
    "y lo dice con los nombres",
    /página «Pagina Beta» es de Negocio Beta y no está compartida con Negocio Alfa/.test(
      r.mezcla ?? ""
    ),
    r.mezcla
  );
}
{
  // El caso que se escapa si solo se mira lo escrito: pixel vacio, y el de Meta
  // Connect es de la otra cuenta. Mide en el de la otra igual.
  const r = cuentaDeLaTienda({ numero: "N1", pagina: "P1", pixel: "" }, conectado, "X2");
  comprobar("pixel vacio y el general es de otra: mezcla", r.mezcla !== null);
  comprobar(
    "y avisa de que es el de Meta Connect",
    /píxel de Meta Connect/.test(r.mezcla ?? ""),
    ""
  );
}
{
  const r = cuentaDeLaTienda({ numero: "N1", pagina: "P1", pixel: "" }, conectado, "X1");
  comprobar("pixel vacio y el general es suyo: no mezcla", r.mezcla === null);
}
{
  const r = cuentaDeLaTienda({ numero: "N1", pagina: "P3", pixel: "X1" }, conectado);
  comprobar(
    "una pieza sin identificar NO se da por mezclada",
    r.mezcla === null,
    "no se sabe, y un aviso que se equivoca se ignora"
  );
}
{
  // CAMBIO DEL 10/10/2026: antes, sin numero identificado, se avisaba si pagina y pixel
  // eran de dueños distintos. Con los compartidos eso ya no dice nada —dos dueños
  // distintos pueden estar compartidos con la misma cuenta—, y sin numero no hay cuenta
  // con la que comparar. Se calla en vez de dar un aviso que puede ser falso.
  const r = cuentaDeLaTienda({ numero: "N3", pagina: "P1", pixel: "X2" }, conectado);
  comprobar("numero sin identificar: no hay cuenta fijada", r.cuenta === null);
  comprobar("y no se avisa: no hay con que comparar", r.mezcla === null);
}

console.log("\n— los selectores ofrecen lo suyo y lo compartido, nada mas —\n");

{
  const { visibles, escondidas } = soloDeLaCuenta(conectado.paginas, "A", "");
  comprobar(
    "con la cuenta A salen las suyas y las compartidas con ella",
    visibles.map((v) => v.id).join(",") === "P1,P4",
    visibles.map((v) => v.id).join(",")
  );
  comprobar("ni las de B sin compartir ni las sin identificar", escondidas === 2);
  comprobar(
    "y la compartida dice de quien viene",
    compartidoPor(conectado.paginas[3], "A") === "Negocio Beta" &&
      compartidoPor(conectado.paginas[0], "A") === null
  );
}
{
  const { visibles } = soloDeLaCuenta(conectado.paginas, "A", "P2");
  comprobar(
    "la que YA tiene puesta sigue a la vista",
    visibles.some((v) => v.id === "P2"),
    "si no, el selector diria «escrito a mano»"
  );
}
{
  const { visibles, escondidas } = soloDeLaCuenta(conectado.paginas, null, "");
  comprobar(
    "sin cuenta fijada no se esconde nada",
    visibles.length === 4 && escondidas === 0
  );
}

console.log("\n— pedir la cuenta no puede vaciar las listas —\n");

const connect = readFileSync("src/lib/meta/connect.ts", "utf8");
const callback = readFileSync("src/app/api/meta/connect/callback/route.ts", "utf8");
const db = readFileSync("src/lib/db.ts", "utf8");

comprobar(
  "la lista de paginas se pide igual que antes",
  connect.includes('"id,name,picture{url},access_token"') &&
    !/me\/accounts[\s\S]{0,400}business\{/.test(connect),
  "la cuenta va en consulta aparte"
);
comprobar(
  "y la de numeros tambien",
  /phone_numbers\{id,display_phone_number,verified_name,code_verification_status\}" \}/.test(
    connect
  ) && !/owned_whatsapp_business_accounts[\s\S]{0,200}owner_business_info/.test(connect)
);
comprobar(
  "las consultas de la cuenta nunca lanzan",
  /export async function cuentaDeLaWaba[\s\S]{0,700}catch \{\s*return null;/.test(connect) &&
    /export async function cuentaDeLaPagina[\s\S]{0,700}catch \{\s*return null;/.test(connect)
);
comprobar(
  "rellenar lo viejo no puede tumbar la conexion",
  /try \{\s*await identificarLasCuentasQueFaltan\(\);\s*\} catch/.test(callback)
);
comprobar(
  "lo viejo se identifica con el permiso de CADA UNO",
  /cuentaDeLaWaba\(fila\.waba_id, fila\.access_token\)/.test(callback) &&
    /cuentaDeLaPagina\(fila\.page_id, fila\.page_access_token\)/.test(callback),
  "no hace falta entrar con la otra cuenta"
);
comprobar(
  "un fallo de red no borra la cuenta ya guardada",
  /business_id = COALESCE\(excluded\.business_id, meta_whatsapp_connections\.business_id\)/.test(db) &&
    /business_id = COALESCE\(excluded\.business_id, meta_connections\.business_id\)/.test(db)
);

// ──── PARTE 2 (10/10/2026): EL BOTON, Y LO QUE NO PUEDE PISAR ─────────────
//
// En la parte 1 aqui se comprobaba que NO hubiera boton «Conectar nueva cuenta», porque
// entonces apagaba la medicion de la primera cuenta. La parte 2 lo pone, y lo que se
// protege ahora es lo que lo hacia peligroso: que entrar con otra cuenta no pise el
// permiso de siempre, ni el numero activo, ni los pixeles, y que cada tienda mida con
// el permiso de su cuenta.
console.log("\n— parte 2: la cuenta nueva no pisa nada de la de siempre —\n");

const metaConnect = readFileSync("src/app/meta-connect/page.tsx", "utf8");
const conversions = readFileSync("src/lib/meta/conversions.ts", "utf8");
const permanente = readFileSync("src/app/api/meta/connect/token-permanente/route.ts", "utf8");

comprobar(
  "el boton entra marcado como cuenta nueva",
  /href="\/api\/meta\/connect\/start\?nueva=1"[\s\S]{0,300}Conectar nueva cuenta/.test(metaConnect)
);
comprobar(
  "y no guarda su permiso como el de siempre",
  /if \(!nuevaCuenta\) \{[\s\S]{0,700}setMetaRuntimeSettings\(\{ meta_user_token: userToken \}\)/.test(
    callback
  ),
  "el que mide la cuenta principal"
);
comprobar(
  "ni cambia el numero activo",
  /active: !nuevaCuenta && whatsAppOptions\.length === 1/.test(callback)
);
comprobar(
  "ni reemplaza la lista de pixeles: la junta",
  /pixels_detectados: JSON\.stringify\(\s*juntarPixeles\(/.test(callback)
);
comprobar(
  "cada cuenta guarda el permiso de su login",
  /guardarPermisoDeConexionDeCuentas\(\s*negociosDelLogin,\s*userToken,\s*nuevaCuenta \? "nueva" : "principal"/.test(
    callback
  )
);
comprobar(
  "una cuenta nueva no pisa el permiso de una principal",
  /WHEN meta_cuentas\.origen = 'principal' AND excluded\.origen = 'nueva'\s*THEN meta_cuentas\.token_conexion/.test(
    db
  )
);

console.log("\n— los compartidos (10/10/2026) —\n");

comprobar(
  "cada numero guarda con que cuentas esta compartido",
  /compartidoCon: juntarAcceso\(\s*getMetaWhatsAppConnection\(option\.phoneNumberId\)\?\.compartido_con,/.test(
    callback
  )
);
comprobar(
  "y cada pagina tambien",
  /compartidoCon: juntarAcceso\(\s*getMetaConnectionByPageId\(page\.pageId\)\?\.compartido_con,/.test(
    callback
  )
);
comprobar(
  "un login no borra lo que sabe el otro login",
  /const queSeQuedan = leerListaDeAcceso\(guardado\)\.filter\(\(c\) => !delLogin\.has\(c\.id\)\);/.test(
    callback
  ),
  "solo habla de sus negocios"
);
comprobar(
  "un fallo de red no borra el compartido guardado",
  /compartido_con = COALESCE\(excluded\.compartido_con, meta_whatsapp_connections\.compartido_con\)/.test(db) &&
    /compartido_con = COALESCE\(excluded\.compartido_con, meta_connections\.compartido_con\)/.test(db)
);
// ──── LA DIFERENCIACION (10/10/2026) ──────────────────────────────────────
//
// Aqui se comprobaba el filtro «Ver cuenta». Se quito ese mismo dia: el lo encontro
// «bien enredado», y aprobo sobre un dibujo un bloque por negocio con «Suscribir» al lado
// de cada numero. Lo que se vigila ahora es ese boton.
const suscribir = readFileSync("src/app/api/meta/connect/whatsapp/suscribir/route.ts", "utf8");
comprobar(
  "cada numero se suscribe con SU propio permiso",
  /subscribeWhatsAppToWebhooks\(\{\s*wabaId: fila\.waba_id,\s*accessToken: fila\.access_token,/.test(
    suscribir
  )
);
comprobar(
  "y suscribir no cambia cual esta activo",
  !/activateMetaWhatsAppConnection|saveMetaWhatsAppConnection/.test(suscribir)
);
comprobar(
  "el estado se lee de Meta, una vez por cuenta de WhatsApp",
  /if \(!porCuenta\.has\(fila\.waba_id\)\)/.test(suscribir) &&
    /estaSuscritaAEstaApp\(/.test(suscribir)
);
comprobar(
  "si Meta no contesta, no se inventa un estado",
  /export async function estaSuscritaAEstaApp[\s\S]{0,900}catch \{\s*return null;/.test(connect)
);
comprobar(
  "«Probar» prueba el pixel REAL de cada tienda",
  /probarUnPixel\(cuenta\.id, t\.pixelId!\)/.test(metaConnect)
);

// ──── DE QUE CUENTA DE FACEBOOK ES CADA COSA (10/10/2026) ──────────────────
//
// «no hay un indicador o separador que me diga de que bm ni cuenta es ese activo». Y:
// «eso no se llaman cuentas entonces, realmente estan conectadas 2 cuentas de facebook».
console.log("\n— de que cuenta de Facebook es cada cosa —\n");
const loConectadoSrc = readFileSync("src/lib/meta/lo-conectado.ts", "utf8");
const editorSrc = readFileSync("src/app/editor/page.tsx", "utf8");
comprobar(
  "al entrar se apunta quien entro",
  /const quienEntro = await fetchCuentaDeFacebook\(userToken\);/.test(callback) &&
    /nuevaCuenta \? "nueva" : "principal",\s*quienEntro/.test(callback)
);
comprobar(
  "una cuenta anexada no le quita un negocio a la principal",
  /facebook_nombre = CASE\s*WHEN meta_cuentas\.origen = 'principal' AND excluded\.origen = 'nueva'\s*THEN meta_cuentas\.facebook_nombre/.test(
    db
  )
);
comprobar(
  "el separador se arma en un solo sitio",
  /export function separadorDe\(/.test(loConectadoSrc) &&
    (loConectadoSrc.match(/\.\.\.conSuCuenta\(/g) ?? []).length === 3,
  "numeros, paginas y pixeles"
);
comprobar(
  "el selector de la tienda lo dibuja",
  /o\.separador && o\.separador !== ordenadas\[i - 1\]\?\.separador/.test(editorSrc)
);
comprobar(
  "y Meta Connect cuenta cuentas de Facebook y negocios por separado",
  /"cuenta de Facebook", "cuentas de Facebook"/.test(metaConnect) &&
    /"negocio", "negocios"/.test(metaConnect)
);

// «Sería genial que sean pop ups… que se vea la imagen de la página, del número y que el
// píxel se represente como debe ser» — el círculo morado con «◎», no el tridente.
{
  const ini = metaConnect.indexOf("function DiferenciacionPorNegocio(");
  const fin = metaConnect.indexOf("const NOMBRE_DEL_ORIGEN", ini);
  const bloque = ini >= 0 && fin > ini ? metaConnect.slice(ini, fin) : "";
  comprobar(
    "el pixel es el circulo morado con «◎»",
    /<AvatarDeOpcion inicial="◎" colorCirculo="bg-violet-500" \/>/.test(bloque) &&
      !/SimboloDeConjuntoDeDatos|🎯/.test(bloque),
    "el de BOT FRANKO"
  );
  comprobar(
    "numeros y paginas con su foto fresca",
    /\/api\/meta\/avatar\?wa=/.test(bloque) && /\/api\/meta\/avatar\?page=/.test(bloque)
  );
  comprobar(
    "cada negocio abre su pop up",
    /onClick=\{\(\) => setNegocioAbierto\(cuenta\.id\)\}/.test(bloque) &&
      /role="dialog"/.test(bloque)
  );
}

console.log("\n— parte 2: cada tienda mide con lo suyo, y una sola cuenta como antes —\n");

comprobar(
  "la compra usa el permiso de su cuenta, y si no, el de siempre",
  /const token = elPermisoDeLaTienda\(conversationId\) \?\? getCapiAccessToken\(\);/.test(
    conversions
  )
);
comprobar(
  "medir no puede romper una venta",
  /function elPermisoDeLaTienda[\s\S]{0,1600}\} catch \{\s*return null;/.test(conversions)
);
comprobar(
  "una cuenta principal sin permanente mide como antes",
  /if \(fila\.token_permanente\) return[\s\S]{0,200}if \(fila\.origen === "nueva" && fila\.token_conexion\)[\s\S]{0,120}return null;/.test(
    db
  ),
  "con una sola cuenta no cambia nada"
);
comprobar(
  "el permanente de una cuenta no toca los globales",
  /if \(cuenta\) \{\s*\/\/[^\n]*\n\s*guardarPermisoPermanenteDeCuenta\(cuenta, cuerpo\.access_token\);\s*\} else \{/.test(
    permanente
  )
);
comprobar(
  "el contador esta arriba del todo",
  // Desde el 10/10/2026 el bloque de arriba es la diferenciación por negocio.
  metaConnect.indexOf("<DiferenciacionPorNegocio />") > -1 &&
    metaConnect.indexOf("<DiferenciacionPorNegocio />") < metaConnect.indexOf("<SetDeVenta"),
  "antes que el resumen de venta"
);

console.log("");
if (fallos > 0) {
  console.log(`${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — cada tienda en su cuenta, y cada cuenta mide con lo suyo");
