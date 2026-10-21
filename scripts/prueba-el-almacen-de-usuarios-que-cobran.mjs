// EL ALMACÉN DE USUARIOS QUE COBRAN: cada tienda cobra a quien se le diga.
//
// LO PIDIÓ EL DUEÑO el 30 de septiembre de 2026, con sus palabras: «la segunda
// cuenta es para que cobre otra persona, en vez de Alberto pongo otra persona…
// voy a usar quizás un nombre de receptor en un número de whatsapp y otro en otro
// número», porque «el otro usuario es para que trabaje otra persona en ese bot y
// cobre por su cuenta».
//
// Y pidió que se pueda REUTILIZAR: «sería genial que el usuario también pueda ser
// elegido en los demás».
//
// ── POR QUÉ LOS TRES DATOS SALEN DE UNA SOLA PUERTA ────────────────────────
//
// Son tres y tienen que ir juntos:
//
//     titular          aprueba el comprobante
//     nombre_completo  se NOMBRA en el mensaje
//     numero_de_cuenta a dónde se manda a pagar
//
// Si se leyeran por separado, el día que uno venga de la tienda y otro del país el
// bot le diría al cliente un nombre y esperaría otro: EL CLIENTE PAGA BIEN Y EL BOT
// LE RECHAZA EL COMPROBANTE. Esta prueba existe sobre todo para eso: comprueba que
// los tres se mueven a la vez.
//
// LO QUE PROTEGE, y es la garantía de todo el cambio:
//
//     SIN USUARIOS, O SIN COBRADOR ELEGIDO, SE COBRA EXACTAMENTE COMO HOY.
//
//   node scripts/prueba-el-almacen-de-usuarios-que-cobran.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const DOBLE = "stub:db";
registerHooks({
  resolve(esp, ctx, next) {
    if (esp === "@/lib/db") return { url: DOBLE, format: "module", shortCircuit: true };
    if (esp.startsWith("@/")) {
      const rel = esp.slice(2);
      const conExt = /\.[a-z]+$/.test(rel) ? rel : `${rel}.ts`;
      return { url: pathToFileURL(join(RAIZ, "src", conExt)).href, shortCircuit: true };
    }
    return next(esp, ctx);
  },
  load(url, ctx, next) {
    if (url === DOBLE)
      return {
        format: "module", shortCircuit: true,
        source: `
          export const getConversationByPhone = () => null;
          export const getConversationById = () => null;
          export const getFrozenPrices = () => null;
          export const getUpsellFrozenPrices = () => null; export const getPuestoEnLaFila = () => null; export const leerCompradosDeLaFila = () => []; export const moverLaFila = () => {};
          export const setFrozenPrices = () => {};
        `,
      };
    return next(url, ctx);
  },
});
const m = await import(pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href);

const conf = readFileSync(join(RAIZ, "src", "lib", "workflow", "config.ts"), "utf8");
const pago = readFileSync(join(RAIZ, "src", "lib", "workflow", "payment.ts"), "utf8");
const api = readFileSync(join(RAIZ, "src", "app", "api", "workflow", "route.ts"), "utf8");
const pantalla = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// Nombres y cuentas INVENTADOS: una prueba escrita con los suyos taparía justo el
// fallo que la regla de la casa evita, y además aquí son datos de dinero.
const CFG = {
  payment_validation: { yape_recipient_name_starts_with: "TITULAR GLOBAL" },
  payment_profiles_by_country: {
    PE: { numero_de_cuenta: "CUENTA-PE-DEL-PAIS", payment_validation: { yape_recipient_name_starts_with: "TITULAR PE" } },
    AR: { numero_de_cuenta: "CUENTA-AR-DEL-PAIS", payment_validation: { yape_recipient_name_starts_with: "TITULAR AR" } },
    EC: { numero_de_cuenta: "CUENTA-EC-DEL-PAIS", payment_validation: { yape_recipient_name_starts_with: "TITULAR EC" } },
  },
  cobradores: [
    {
      id: "u_uno",
      nombre: "PRIMERA PERSONA",
      por_pais: {
        PE: { titular: "TITULAR SUYO PE", numero_de_cuenta: "CUENTA-SUYA-PE" },
        AR: { titular: "TITULAR SUYO AR", numero_de_cuenta: "CUENTA-SUYA-AR", nombre_completo: "COMO FIRMA EN AR" },
      },
    },
    {
      id: "u_dos",
      nombre: "SEGUNDA PERSONA",
      // Solo Perú: el caso que el dueño describió.
      por_pais: { PE: { titular: "OTRO TITULAR PE", numero_de_cuenta: "OTRA-CUENTA-PE" } },
    },
    { id: "u_sin_nada", nombre: "TODAVIA NO COBRA" },
  ],
  tiendas: [
    { id: "t_a", nombre: "PRIMERA", numero: "111", cobrador: "u_uno" },
    { id: "t_b", nombre: "SEGUNDA", numero: "222", cobrador: "u_dos" },
    // LA REUTILIZACIÓN que él pidió: el MISMO usuario en otra tienda.
    { id: "t_c", nombre: "TERCERA", numero: "333", cobrador: "u_uno" },
    { id: "t_d", nombre: "SIN COBRADOR", numero: "444" },
    { id: "t_e", nombre: "COBRADOR BORRADO", numero: "555", cobrador: "u_que_ya_no_existe" },
  ],
};
const tiendaDe = (numero) => m.tiendaDelNumero(numero, CFG);
const cobro = (numero, pais) =>
  m.conLaTiendaDelTurno(tiendaDe(numero), () => m.elCobroDelPais(pais, CFG));

// ── 1. CADA TIENDA COBRA A LO SUYO ──────────────────────────────────────────
console.log("\n— 1. cada número cobra a su cuenta —\n");
{
  const a = cobro("111", "PE");
  comprobar("la tienda A usa el titular de su usuario", a.titular === "TITULAR SUYO PE", a.titular);
  comprobar("y su número de cuenta", a.numero_de_cuenta === "CUENTA-SUYA-PE", a.numero_de_cuenta);
  const b = cobro("222", "PE");
  comprobar("la tienda B usa OTRO titular", b.titular === "OTRO TITULAR PE", b.titular);
  comprobar("y otra cuenta", b.numero_de_cuenta === "OTRA-CUENTA-PE", b.numero_de_cuenta);
  comprobar(
    "no se pisan entre ellas",
    a.titular !== b.titular && a.numero_de_cuenta !== b.numero_de_cuenta,
    "cada una la suya"
  );
}

// ── 2. EL MISMO USUARIO, REUTILIZADO ────────────────────────────────────────
//
// «sería genial que el usuario también pueda ser elegido en los demás».
console.log("\n— 2. el mismo usuario en varias tiendas —\n");
{
  const a = cobro("111", "PE");
  const c = cobro("333", "PE");
  comprobar(
    "la tienda C cobra igual que la A",
    c.titular === a.titular && c.numero_de_cuenta === a.numero_de_cuenta,
    "se escribe una vez"
  );
}

// ── 3. LOS TRES DATOS SE MUEVEN JUNTOS ──────────────────────────────────────
//
// LA COMPROBACIÓN QUE DA SENTIDO A LA PUERTA ÚNICA. Si el titular viniera del
// usuario y el número del país, el bot mandaría a pagar a una cuenta y aprobaría
// contra otro nombre.
console.log("\n— 3. el que valida y el que se nombra son el mismo —\n");
{
  const a = cobro("111", "PE");
  comprobar(
    "sin nombre completo escrito, se nombra al titular",
    a.nombre_completo === a.titular,
    a.nombre_completo
  );
  const conFirma = cobro("111", "AR");
  comprobar(
    "y con nombre completo escrito, manda ése",
    conFirma.nombre_completo === "COMO FIRMA EN AR" &&
      conFirma.titular === "TITULAR SUYO AR",
    "el titular sigue validando"
  );
  comprobar(
    "el titular y la cuenta son de la MISMA persona",
    conFirma.titular === "TITULAR SUYO AR" &&
      conFirma.numero_de_cuenta === "CUENTA-SUYA-AR",
    "nunca cruzados"
  );
}

// ── 3b. EL NOMBRE PARA LEER NO CRUZA DE PERSONA ─────────────────────────────
//
// EL FALLO REAL, y lo destapó el dueño el 01/10/2026: creó dos usuarios de prueba,
// dejó el «nombre completo» vacío en los dos —preguntando para qué servía— y el bot
// iba a enseñar el nombre completo DEL PAÍS, o sea el del dueño, mientras validaba
// el comprobante contra el titular DEL USUARIO.
//
// El cliente paga bien, el comprobante sale a nombre del usuario, y el bot le había
// dicho otro nombre. Es exactamente lo que la puerta única existe para impedir,
// entrando por la puerta del respaldo.
//
// No le mordió porque {{NOMBRE_COMPLETO}} no está en ninguna de sus burbujas —0
// usos contra 233 del receptor— pero el día que lo usara cobraba mal.
console.log("\n— 3b. el nombre que se enseña es de quien cobra —\n");
{
  const conNombreDelPais = {
    payment_profiles_by_country: {
      PE: {
        nombre_completo: "NOMBRE COMPLETO DEL DUEÑO",
        payment_validation: { yape_recipient_name_starts_with: "TITULAR PE" },
      },
    },
    cobradores: [
      { id: "u_x", nombre: "OTRA", por_pais: { PE: { titular: "TITULAR DE OTRA" } } },
    ],
    tiendas: [{ id: "t_x", numero: "777", cobrador: "u_x" }],
  };
  const r = m.conLaTiendaDelTurno(
    m.tiendaDelNumero("777", conNombreDelPais),
    () => m.elCobroDelPais("PE", conNombreDelPais)
  );
  comprobar(
    "sin nombre completo propio, se usa SU titular",
    r.nombre_completo === "TITULAR DE OTRA",
    r.nombre_completo
  );
  comprobar(
    "y NUNCA el nombre completo del dueño",
    r.nombre_completo !== "NOMBRE COMPLETO DEL DUEÑO",
    "ése era el comprobante rechazado"
  );
  // Sin cobrador, el respaldo del país SIGUE funcionando: ahí el nombre del país y
  // su titular son de la misma persona, así que no hay cruce.
  const sinCobrador = m.elCobroDelPais("PE", conNombreDelPais);
  comprobar(
    "sin cobrador, el nombre del país sigue valiendo",
    sinCobrador.nombre_completo === "NOMBRE COMPLETO DEL DUEÑO",
    "no se rompió lo de siempre"
  );
}

// ── 4. UN PAÍS QUE EL USUARIO NO COBRA ──────────────────────────────────────
//
// Se decidió con el dueño: cae a la cuenta del país. El dinero le entra a ÉL y no
// a la otra persona, y eso se avisa en la pantalla. La alternativa era no mandar
// número, y una venta rota es peor.
console.log("\n— 4. el país que ese usuario no cobra —\n");
{
  const b = cobro("222", "AR");
  comprobar("cae al titular del país", b.titular === "TITULAR AR", b.titular);
  comprobar("y a la cuenta del país", b.numero_de_cuenta === "CUENTA-AR-DEL-PAIS", b.numero_de_cuenta);
  comprobar(
    "NO se queda sin número de cuenta",
    b.numero_de_cuenta !== "",
    "la venta no se rompe"
  );
  comprobar(
    "y NO se le presta la cuenta del otro usuario",
    b.numero_de_cuenta !== "CUENTA-SUYA-AR",
    "nada se filtra entre usuarios"
  );
}

// ── 5. LA GARANTÍA: SIN COBRADOR, TODO COMO HOY ─────────────────────────────
console.log("\n— 5. sin cobrador elegido, como siempre —\n");
{
  const d = cobro("444", "PE");
  comprobar("la tienda sin cobrador usa el del país", d.titular === "TITULAR PE", d.titular);
  comprobar("y la cuenta del país", d.numero_de_cuenta === "CUENTA-PE-DEL-PAIS");
  const sinTienda = m.elCobroDelPais("PE", CFG);
  comprobar(
    "sin tienda atendiendo, igual",
    sinTienda.titular === "TITULAR PE" &&
      sinTienda.numero_de_cuenta === "CUENTA-PE-DEL-PAIS",
    "es el camino de hoy"
  );
  // Un cobrador borrado no puede dejar a la tienda sin cobrar.
  const e = cobro("555", "PE");
  comprobar(
    "un cobrador que ya no existe cae al país",
    e.titular === "TITULAR PE" && e.numero_de_cuenta === "CUENTA-PE-DEL-PAIS",
    "no deja la venta muda"
  );
  // Un usuario sin ningún país escrito tampoco.
  const soloGlobal = {
    ...CFG,
    tiendas: [{ id: "t_z", numero: "999", cobrador: "u_sin_nada" }],
  };
  const z = m.conLaTiendaDelTurno(
    m.tiendaDelNumero("999", soloGlobal),
    () => m.elCobroDelPais("PE", soloGlobal)
  );
  comprobar(
    "un usuario sin cuentas cae al país",
    z.titular === "TITULAR PE",
    "no aprueba a cualquiera"
  );
}

// ── 6. EL RESPALDO GLOBAL DEL TITULAR SE CONSERVA ───────────────────────────
//
// Existía antes y no se toca: un país sin titular escrito usa el global. El del
// NÚMERO no tiene respaldo global a propósito —una cuenta es de un país concreto—
// y eso también se comprueba.
console.log("\n— 6. los respaldos de siempre, intactos —\n");
{
  const sinPerfil = {
    payment_validation: { yape_recipient_name_starts_with: "TITULAR GLOBAL" },
    payment_profiles_by_country: {},
  };
  const r = m.elCobroDelPais("PE", sinPerfil);
  comprobar("el titular cae al global", r.titular === "TITULAR GLOBAL", r.titular);
  comprobar(
    "pero la cuenta NO tiene global",
    r.numero_de_cuenta === "",
    "una cuenta es de un país concreto"
  );
}

// ── 7. UNA SOLA PUERTA ──────────────────────────────────────────────────────
//
// Mientras alguien lea el titular por su cuenta, puede desalinearse del que se le
// enseña al cliente. Por eso se comprueba que las cuatro lecturas pasen por aquí.
console.log("\n— 7. las cuatro lecturas pasan por la puerta —\n");
comprobar(
  "existe la puerta",
  /export function elCobroDelPais\(/.test(conf)
);
comprobar(
  "el nombre del receptor",
  /return elCobroDelPais\(country, config\)\.titular;/.test(conf)
);
comprobar(
  "el nombre completo",
  /return elCobroDelPais\(country, config\)\.nombre_completo;/.test(conf)
);
// Lleva el MÉTODO porque en un país se cobra por billetera Y por banco, y son
// cuentas distintas. Ver `prueba-una-cuenta-por-metodo`.
comprobar(
  "el número de cuenta",
  /return elCobroDelPais\(country, config, metodo\)\.numero_de_cuenta;/.test(conf)
);
comprobar(
  "y LA VALIDACIÓN DEL COMPROBANTE",
  /const expectedComoLoEscribio = elCobroDelPais\(countryCode, config\)\.titular;/.test(
    pago
  ),
  "el mismo nombre que se le enseñó"
);
comprobar(
  "a payment.ts no le queda la lectura vieja",
  !/yape_recipient_name_starts_with/.test(pago),
  "no puede desalinearse"
);

// ── 8. SOBREVIVE AL GUARDADO ────────────────────────────────────────────────
console.log("\n— 8. los usuarios no se pierden al guardar —\n");
comprobar("hay un lector propio", /function leeCobradores\(/.test(api));
comprobar(
  "se leen al abrir",
  /const cobradores = leeCobradores\(config\?\.cobradores\);/.test(api) &&
    /\n      cobradores,/.test(api)
);
comprobar("y se escriben al guardar", /doc\.set\("cobradores", leeCobradores\(body\.cobradores\)\);/.test(api));
comprobar(
  "sin id no se guarda",
  /\.filter\(\(c\) => String\(c\?\.id \?\? ""\)\.trim\(\)\)/.test(api),
  "el id ata la tienda con su cobrador"
);
// Cuenta también las cuentas por método: un usuario que solo escribió su cuenta de
// banco SÍ cobra en ese país, y tirarlo por «está en blanco» lo dejaría sin cobrar.
// Cuenta las cuentas por metodo Y los metodos apagados: un pais donde lo unico
// escrito es «no cobra por banco» tiene informacion, y tirarlo la perderia.
comprobar(
  "un país en blanco no se escribe",
  /!titular &&\s*\r?\n?\s*!numero_de_cuenta &&\s*\r?\n?\s*!nombre_completo &&\s*\r?\n?\s*!tieneCuentas &&\s*\r?\n?\s*metodos_apagados\.length === 0/.test(
    api
  ),
  "ausente = aquí no cobra"
);
comprobar(
  "la tienda guarda a quién cobra",
  /\{ cobrador: str\(t\.cobrador\)\.trim\(\) \}/.test(api)
);

// ── 9. LA PANTALLA ──────────────────────────────────────────────────────────
console.log("\n— 9. el almacén se ve y se elige —\n");
comprobar("existe el almacén", /function CobradoresDelProyecto\(/.test(pantalla));
// VIVE EN EL MENÚ USUARIOS, no en el de ajustes.
//
// Estuvo unas horas en ajustes y era el sitio equivocado. Lo dijo el dueño el
// 30/09/2026: «yo pensé que ya que en el menú usuarios se encuentran los usuarios
// con sus respectivos datos de pagos y burbujas, pensé que allí se almacenarían los
// usuarios». Todo lo del cobro vive en ese menú, así que el almacén también.
//
// Y había algo peor: quedaban DOS cosas llamadas «👤 Usuario», una en cada menú.
// Si alguien lo devuelve a ajustes, esto se pone rojo.
comprobar(
  "vive en el MENÚ USUARIOS, no en ajustes",
  /titleKey="usuario_cobradores"/.test(pantalla) &&
    !/titleKey="ajustes_cobradores"/.test(pantalla),
  "donde está todo lo del cobro"
);
comprobar(
  "y no hay dos sitios para abrirlo",
  (pantalla.match(/<CobradoresDelProyecto/g) ?? []).length === 1,
  "dos sitios es como se vuelve a discrepar"
);
comprobar(
  "las cuentas se abren por país",
  /Rellena <strong>solo los países donde esta persona cobre<\/strong>/.test(pantalla)
);
comprobar(
  // El hueco se ensancho el 02/10/2026: entre el rotulo y las opciones entro el RETRATO
  // del cobrador elegido, que el pidio para no confundir a dos personas de nombre
  // parecido. Lo que esta comprobacion protege no cambia.
  "la tienda elige quién cobra",
  /Quién cobra[\s\S]{0,2200}?La cuenta del país · como hoy/.test(pantalla)
);
comprobar(
  // Y QUE EL RETRATO SIGA AHI. Sin esto, quitarlo no pondria roja ninguna prueba y
  // volveria la lista de nombres parecidos.
  "y se ve la cara del elegido",
  /<RetratoDelCobrador\s*\r?\n?\s*foto=\{[\s\S]{0,200}?find\(\(c\) => c\.id === tienda\.cobrador\)\?\.foto/.test(
    pantalla
  ),
  "referencia visual, no solo el nombre"
);
// ── LA FOTO DEL USUARIO ────────────────────────────────────────────────────
//
// LO PIDIO EL DUEÑO el 02/10/2026: «necesito que haya un lugar donde yo pueda poner una
// foto imagen y que aparezca ahi, y si no hay foto que aparezca la silueta que tu ya
// sabes poner».
//
// NO ES ADORNO: con varias tiendas, «quien cobra» es una lista de nombres parecidos, y
// elegir al equivocado manda al cliente a pagar a OTRA PERSONA. Esta semana confundio a
// dos.
console.log("\n— su foto, y la silueta cuando no hay —\n");
comprobar(
  "hay donde poner la foto",
  /value=\{cobrador\.foto \?\? ""\}/.test(pantalla),
  "en su propia tarjeta"
);
comprobar(
  "y sin foto sale una silueta dibujada",
  /function RetratoDelCobrador\(/.test(pantalla) && /<svg viewBox="0 0 24 24"/.test(pantalla),
  "un SVG, no un emoji que cambia en cada sistema"
);
comprobar(
  "si la foto no carga, vuelve la silueta",
  /onError=\{\(\) => setRoto\(true\)\}/.test(pantalla),
  "una URL caducada no deja un recuadro roto"
);
comprobar(
  "y una URL nueva merece otro intento",
  /useEffect\(\(\) => \{\s*\r?\n?\s*setRoto\(false\);\s*\r?\n?\s*\}, \[url\]\);/.test(pantalla),
  "corregirla quita la silueta sin recargar"
);
comprobar(
  "nunca viaja al cliente, y se dice en la pantalla",
  /El cliente nunca la ve\./.test(pantalla)
);
comprobar(
  "y sobrevive al guardado",
  /\.\.\.\(str\(c\?\.foto\)\.trim\(\) \? \{ foto: str\(c\.foto\)\.trim\(\) \} : \{\}\)/.test(
    readFileSync(join(RAIZ, "src", "app", "api", "workflow", "route.ts"), "utf8")
  ),
  "si no se nombra, se pierde en silencio"
);

comprobar(
  "el usuario nace con id propio, no con su nombre",
  /id: `cobra_\$\{Date\.now\(\)\.toString\(36\)\}`/.test(pantalla),
  "renombrarlo no lo convierte en otro"
);
comprobar(
  "y al cargar se tira el que no tenga id",
  /loaded\.cobradores = Array\.isArray\(loaded\.cobradores\)/.test(pantalla)
);
// LOS DOS AVISOS DE DINERO. Son la parte que evita que se entere por el banco.
comprobar(
  "avisa del país que el cobrador no cubre",
  /no tiene cuenta en/.test(pantalla) &&
    /pagaría a\{" "\}\s*<strong>tu<\/strong> cuenta del país/.test(pantalla),
  "dinero que no llega a quien debía"
);
comprobar(
  "y avisa de una cuenta sin titular",
  /Tiene cuenta pero no titular/.test(pantalla),
  "sin titular no hay quien valide"
);
comprobar(
  "solo avisa de los países que se venden",
  /if \(!perfil \|\| perfil\.enabled === false\) return false;/.test(pantalla),
  "un aviso que no se puede resolver enseña a ignorarlos"
);
// ── LA CHAPA DEL COMODÍN SOBRE CADA CASILLA ─────────────────────────────────
//
// LO PIDIÓ EL DUEÑO el 01/10/2026, y el motivo es el fallo entero. Con sus
// palabras: «no le pusiste el comodín sobre esas textareas… por eso yo no tenía ni
// pucha idea que esos datos reemplazaban al comodín, es como estar sin brújula».
//
// Las casillas de «Datos para pago» llevan esa chapa desde siempre. Las de este
// almacén salieron sin ella, así que parecían otra cosa — un dato que se guarda y
// no se sabe adónde va. Una pantalla que no dice a qué alimenta una casilla
// obliga a adivinar, y adivinando con datos de cobro se cobra mal.
comprobar(
  "el titular dice a qué comodín alimenta",
  /Titular \(aprueba el comprobante\)\s*\r?\n?\s*<ChapaDeComodin comodin="\{\{NOMBRE_RECEPTOR\}\}" \/>/.test(
    pantalla
  ),
  "la brújula"
);
comprobar(
  "el número de cuenta también",
  /Número de cuenta\s*\r?\n?\s*<ChapaDeComodin comodin="\{\{NUMERO_DE_CUENTA\}\}" \/>/.test(
    pantalla
  )
);
comprobar(
  "y el nombre completo",
  /Nombre completo \(solo para leer\)\s*\r?\n?\s*<ChapaDeComodin comodin="\{\{NOMBRE_COMPLETO\}\}" \/>/.test(
    pantalla
  )
);
// Y LAS DE CADA MÉTODO COMPARTEN COMODÍN, que es lo que menos se espera: sin
// decirlo, uno busca un comodín por método y no lo encuentra.
comprobar(
  "las de cada método dicen que comparten el comodín",
  /Las tres llenan <strong>el mismo comodín<\/strong>/.test(pantalla) &&
    /Todas llenan <strong>el mismo comodín<\/strong>/.test(pantalla),
  "en el almacén y en Datos para pago"
);

comprobar(
  "dice qué tiendas le cobran a cada usuario",
  /Le cobran:/.test(pantalla)
);
comprobar(
  "y avisa al borrar uno que se está usando",
  /volverían a cobrar a la cuenta del país/.test(pantalla)
);

console.log(
  fallos === 0
    ? "\nTODO OK — cada tienda cobra a quien debe, y sin usuarios se cobra como hoy\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
