// LOS NÚMEROS DE CUENTA ESCRITOS A MANO (23/10/2026, solo ALBERTO 4).
//
// Lo que evita: que al cambiar un número de cuenta escrito a mano por su comodín el cliente lea
// OTRA cosa. El dueño lo pidió así: «la respuesta que le llegue al cliente igual, pero con otra
// configuración interna». Ese día tenía su Yape escrito 437 veces y tres cuentas BCP distintas.
//
// Corre sobre el CÓDIGO REAL: compila src/lib/editor/numeros-a-mano.ts y lo interroga. Los datos
// son inventados a propósito (ningún producto, número ni persona real).
//
//   node scripts/prueba-numeros-a-mano.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const RAIZ = process.cwd();
const TMP = join(RAIZ, "scripts", "_tmp-numeros-a-mano");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
writeFileSync(
  join(TMP, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: { outDir: ".", module: "commonjs", target: "es2022", moduleResolution: "node", skipLibCheck: true, strict: true, noEmit: false },
    include: ["../../src/lib/editor/numeros-a-mano.ts"],
  }),
  "utf8"
);
try {
  execFileSync(process.execPath, [join(RAIZ, "node_modules", "typescript", "bin", "tsc"), "-p", join(TMP, "tsconfig.json")], { stdio: "pipe" });
} catch {
  // Si de verdad no se escribió nada, el require de abajo falla.
}
const require = createRequire(import.meta.url);
const na = require(join(TMP, "numeros-a-mano.js"));

let fallos = 0;
const ok = (cond, que) => {
  console.log(`${cond ? "ok   " : "FALLA"}  ${que}`);
  if (!cond) fallos++;
};

// ── EL CONTENIDO DE PRUEBA ──────────────────────────────────────────────────
// País AA: el dueño cobra por «billetera» (guardada CON espacios) y escribe a mano, además, un
// banco que no está guardado y la «interbancaria». País BB: otro país, con su propia cuenta y un
// texto que lleva por error la billetera de AA.
const cfg = {
  payment_profiles_by_country: {
    AA: {
      payment_validation: { yape_recipient_name_starts_with: "Persona Prueba" },
      nombre_completo: "Persona Prueba",
      numero_de_cuenta: "1112223334",
      cuentas_por_metodo: { billetera: "999 888 777", banco: "1112223334" },
      payment_buttons: [{ method: "billetera", label: "Billetera" }, { method: "banco", label: "Banco" }],
    },
    BB: {
      payment_validation: { yape_recipient_name_starts_with: "Otra Persona" },
      numero_de_cuenta: "5556667778",
      payment_buttons: [{ method: "deposito", label: "Depósito" }],
      payment_responses: {
        deposito: [{ texts: ["🔴 Cuenta del país: 999888777\nA nombre de: {{NOMBRE_RECEPTOR}}"] }],
      },
    },
  },
  modality_payment_profiles: {
    lineal: {
      AA: {
        payment_validation: { yape_recipient_name_starts_with: "Persona Prueba" },
        numero_de_cuenta: "1112223334",
        cuentas_por_metodo: { billetera: "999 888 777", banco: "1112223334" },
      },
    },
  },
  // Un usuario que es el MISMO dueño (mismo titular) y otro que no.
  cobradores: [
    { id: "yo", nombre: "Persona Prueba", por_pais: { AA: { titular: "Persona Prueba", numero_de_cuenta: "1112223334", cuentas_por_metodo: { billetera: "999 888 777" } } } },
    { id: "otra", nombre: "Ayudante", por_pais: { AA: { titular: "Ayudante Uno", numero_de_cuenta: "4443332221" } } },
  ],
  tiendas: [
    { id: "t1", nombre: "Tienda Uno", cobrador: "yo" },
    { id: "t2", nombre: "Tienda Dos", cobrador: "" },
  ],
  intro: [
    {
      paises: ["AA"],
      decisions: [
        {
          steps: [
            { texts: ["🟢 Billetera: 999888777\n👤 {{NOMBRE_RECEPTOR}}"] },
            { texts: ["📲 *BANCO*: -20304050607\n🏦 *INTERBANCARIA*: 0020304050607080"] },
          ],
        },
      ],
    },
  ],
  followups: [
    { paises: ["AA"], texts: ["Paga aquí 999 888 777 a nombre de Persona Prueba"] },
    // UNA PIEZA SIN BANDERA: la leen los dos países donde vende. En BB diría la cuenta de BB.
    { texts: ["Recuerda: billetera 999888777, a nombre de Persona Prueba"] },
    // Y UNA SOLO DE CC, donde no vende: no la lee nadie.
    { paises: ["CC"], texts: ["Cuenta 999888777"] },
  ],
  // Un texto que NO es de pago, con el mismo número (es su teléfono): no se toca.
  saludo: "Escríbenos al 999888777 cuando quieras",
  // Un enlace y un id de anuncio con cifras: no son cuentas.
  anuncio: { ids: ["120000000000001"], enlace: "https://example.com/1234567890/posts/9876543210 a nombre de" },
};
const original = JSON.stringify(cfg);

// ── 1. LO QUE ENCUENTRA ─────────────────────────────────────────────────────
const lista = na.buscarNumerosAMano(cfg);
const de = (cifras) => lista.find((h) => h.tipo === "numero" && h.clave === cifras);
const billetera = de("999888777");
ok(!!billetera, "encuentra la billetera escrita a mano");
ok(billetera?.cuenta?.clave === "billetera", "y sabe que es la cuenta «billetera» de AA");
ok(billetera?.fueraDePago === 1, "y cuenta aparte el texto que no es de pago (su teléfono)");
ok(!!de("20304050607") && !!de("0020304050607080"), "encuentra el banco y la interbancaria que no están guardados");
ok(de("20304050607")?.pais === "AA", "y sabe que son de AA por la billetera de la burbuja de al lado");
ok(!lista.some((h) => h.clave === "120000000000001" || h.clave === "1234567890"), "no confunde un id de anuncio ni un enlace con una cuenta");
ok(lista.some((h) => h.tipo === "nombre" && h.clave === "Persona Prueba"), "encuentra el nombre del titular escrito a mano");
ok(na.nombrePropuesto(de("0020304050607080")) === "Interbancaria", "propone el nombre de su línea («Interbancaria»)");
ok(na.claveLibre(cfg, "AA", "banco", "20304050607") === "banco_2", "si «banco» ya es otra cuenta, propone «banco_2» (no la pisa)");

// ── 2. LA BILLETERA: EN AA SALE IGUAL, EN BB NO ─────────────────────────────
const pB = na.prepararPase(cfg, billetera, { formato: "999888777" });
const enAA = pB.resultados.find((r) => r.pais === "AA");
const enBB = pB.resultados.find((r) => r.pais === "BB");
ok(enAA?.igual === true, "en AA el comodín da el mismo número en todas las tiendas");
ok(enAA?.soloFormato === true, "y avisa que cambian los espacios (estaba guardada con espacios)");
ok(enBB?.igual === false && enBB.diferencias[0]?.sale === "5556667778", "en BB diría la cuenta de BB: NO sale igual, y lo dice");
ok(pB.resultados.find((r) => r.pais === null)?.igual === true, "la pieza de un país donde no vende no la lee nadie: se puede pasar");
const rB = na.aplicarPase(cfg, billetera, pB);
const tB = JSON.stringify(rB.cfg);
ok(tB.includes("🟢 Billetera: {{CUENTA_BILLETERA}}"), "pasa la de AA (con bandera AA) al comodín");
ok(tB.includes("Cuenta del país: 999888777"), "deja como está el texto de BB");
ok(tB.includes("Recuerda: billetera 999888777"), "deja como está la pieza SIN bandera (también la lee BB) hasta que él lo apruebe");
ok(tB.includes("Cuenta {{CUENTA_BILLETERA}}"), "pasa la pieza que solo lee un país donde no vende");
ok(tB.includes("Escríbenos al 999888777"), "no toca el texto que no es de pago");
const rB2 = na.aplicarPase(cfg, billetera, pB, ["BB"]);
const tB2 = JSON.stringify(rB2.cfg);
ok(tB2.includes("Recuerda: billetera {{CUENTA_BILLETERA}}") && tB2.includes("Cuenta del país: {{CUENTA_BILLETERA}}"), "con BB aprobado, se pasan también los que lee BB");
ok(rB.cfg.payment_profiles_by_country.AA.cuentas_por_metodo.billetera === "999888777", "guarda la cuenta con el formato elegido");
ok(rB.cfg.cobradores[0].por_pais.AA.cuentas_por_metodo.billetera === "999888777", "y también en el usuario que es él mismo");
ok(rB.cfg.cobradores[1].por_pais.AA.cuentas_por_metodo === undefined, "y NO en el usuario que es otra persona");
ok(JSON.stringify(cfg) === original, "el contenido original no se modifica (se copia)");

// ── 3. UNA CUENTA NUEVA: LA INTERBANCARIA ───────────────────────────────────
const inter = na.buscarNumerosAMano(rB.cfg).find((h) => h.clave === "0020304050607080");
const pI = na.prepararPase(rB.cfg, inter);
ok(pI.nueva && pI.comodin === "{{CUENTA_INTERBANCARIA}}", "propone guardarla como «interbancaria»");
ok(pI.resultados.every((r) => r.igual), "y sale igual en todas las tiendas (también en la que cobra su usuario)");
const rI = na.aplicarPase(rB.cfg, inter, pI);
ok(rI.cfg.payment_profiles_by_country.AA.cuentas_por_metodo.interbancaria === "0020304050607080", "la guarda en el país");
ok(rI.cfg.modality_payment_profiles.lineal.AA.cuentas_por_metodo.interbancaria === "0020304050607080", "y en su copia de la modalidad");
ok(rI.cfg.cobradores[0].por_pais.AA.cuentas_por_metodo.interbancaria === "0020304050607080", "y en su usuario (si no, ahí saldría su cuenta principal)");
ok(JSON.stringify(rI.cfg).includes("🏦 *INTERBANCARIA*: {{CUENTA_INTERBANCARIA}}"), "y el texto ya usa el comodín");

// ── 4. EL BANCO QUE NO ES EL GUARDADO ───────────────────────────────────────
const banco = na.buscarNumerosAMano(rI.cfg).find((h) => h.clave === "20304050607");
const pK = na.prepararPase(rI.cfg, banco);
ok(pK.comodin === "{{CUENTA_BANCO_2}}", "el banco escrito a mano se guarda como «banco_2», sin pisar el guardado");
const rK = na.aplicarPase(rI.cfg, banco, pK);
ok(JSON.stringify(rK.cfg).includes("-{{CUENTA_BANCO_2}}"), "y el guion de delante se queda (el cliente lee lo mismo)");

// ── 5. LO QUE EL BOT LEERÁ: la regla del bot, tienda por tienda ─────────────
for (const t of [null, "yo"]) {
  const perfil = rK.cfg.payment_profiles_by_country.AA;
  ok(na.cuentaQueSale(rK.cfg, "AA", "interbancaria", t, perfil) === "0020304050607080", `interbancaria sale bien ${t ? "con su usuario" : "sin tienda"}`);
  ok(na.cuentaQueSale(rK.cfg, "AA", "banco_2", t, perfil) === "20304050607", `banco_2 sale bien ${t ? "con su usuario" : "sin tienda"}`);
}
ok(na.cuentaQueSale(rK.cfg, "AA", "interbancaria", "otra", rK.cfg.payment_profiles_by_country.AA) === "4443332221", "con OTRA persona cobrando sale su cuenta (por eso su ficha avisa si le falta)");

// ── 6. EL NOMBRE ────────────────────────────────────────────────────────────
const nombre = na.buscarNumerosAMano(rK.cfg).find((h) => h.tipo === "nombre");
const pN = na.prepararPase(rK.cfg, nombre);
ok(pN.comodin === "{{NOMBRE_COMPLETO}}" && pN.resultados.find((r) => r.pais === "AA")?.igual === true, "el nombre pasa a {{NOMBRE_COMPLETO}} y en AA sale igual");
ok(pN.resultados.find((r) => r.pais === "BB")?.diferencias[0]?.sale === "Otra Persona", "en la pieza sin bandera, BB leería su propio nombre: lo avisa");
const rN = na.aplicarPase(rK.cfg, nombre, pN);
ok(JSON.stringify(rN.cfg).includes("a nombre de {{NOMBRE_COMPLETO}}"), "y el texto lo usa");

// Un número cuyos textos solo lee un país donde no sale igual (y no aprobado): no se guarda nada.
const soloDeBB = { ...rN.cfg, extra: { paises: ["BB"], texts: ["Cuenta nueva: 7770001112"] } };
const hBB = na.buscarNumerosAMano(soloDeBB).find((h) => h.clave === "7770001112");
const rBB = na.aplicarPase(soloDeBB, hBB, na.prepararPase(soloDeBB, hBB, { pais: "AA" }));
ok(rBB.textos === 0 && rBB.cfg === soloDeBB, "si no cambia ningún texto, no guarda la cuenta (no queda nada «sin usar»)");

// ── 7. RENOMBRAR UNA CUENTA ARRASTRA SUS TEXTOS ─────────────────────────────
const ren = na.renombrarComodin(rN.cfg, "interbancaria", "cci");
ok(ren.textos === 1 && JSON.stringify(ren.cfg).includes("{{CUENTA_CCI}}"), "al renombrar la cuenta, los textos cambian de comodín");
ok(na.textosQueUsan(ren.cfg, "interbancaria") === 0, "y no queda ninguno con el nombre viejo");

// ── 8. EL AVISO AMARILLO ────────────────────────────────────────────────────
const avisos = na.avisosDeNumeros(rN.cfg);
const enTexto = na.numerosGuardadosEn("Paga al 999888777 o al 4443332221", avisos);
ok(enTexto.length === 2, "el aviso ve los dos números guardados en una caja de texto");
ok(enTexto.find((x) => x.escrito === "999888777")?.comodin === "{{CUENTA_BILLETERA}}", "y propone el comodín de la cuenta del dueño");
ok(enTexto.find((x) => x.escrito === "4443332221")?.comodin === null, "la de otra persona no la cambia sola");

rmSync(TMP, { recursive: true, force: true });
console.log(fallos ? `\n${fallos} FALLA(S)` : "\nTODO OK");
process.exit(fallos ? 1 : 0);
