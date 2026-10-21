// El aviso de "este país está encendido pero le falta configurar esto".
//
// Lo que evita: encender un país, no llenarle nada, y que el bot le mande al
// cliente el texto de muestra tal cual — "[Referencia 🇲🇽 Mexico] Escribe aqui
// los datos reales para SPEI..." — o le cobre el precio de otro país.
//
// Corre sobre el CÓDIGO REAL: compila revisar-pais.ts y lo interroga.
//
//   node scripts/prueba-aviso-pais.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const RAIZ = process.cwd();
const TMP = join(RAIZ, "scripts", "_tmp-aviso");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

writeFileSync(
  join(TMP, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        outDir: ".",
        module: "commonjs",
        target: "es2022",
        moduleResolution: "node",
        skipLibCheck: true,
        esModuleInterop: true,
        noEmit: false,
        baseUrl: "../..",
        paths: { "@/*": ["src/*"] },
      },
      include: ["../../src/lib/editor/revisar-pais.ts"],
    },
    null,
    2
  ),
  "utf8"
);

try {
  execFileSync(
    process.execPath,
    [join(RAIZ, "node_modules", "typescript", "bin", "tsc"), "-p", join(TMP, "tsconfig.json")],
    { stdio: "pipe" }
  );
} catch {
  // Si de verdad no se hubiera escrito nada, el require de abajo falla.
}

const require = createRequire(import.meta.url);
const { revisarPais, esTextoDeReferencia } = require(join(TMP, "revisar-pais.js"));

// Texto de muestra REAL, copiado tal cual de la configuración de un país sin
// llenar. Si algún día cambia la forma de sembrarlo, esta prueba lo canta.
const MUESTRA_SPEI =
  "[Referencia 🇲🇽 Mexico] Escribe aqui los datos reales para SPEI. Incluye titular, banco/cuenta/enlace y el monto {{precio}}.";
const MUESTRA_PRESENTACION =
  "[Referencia Mexico] Puedes pagar por transferencia SPEI, OXXO o Mercado Pago. Cambia este texto.";

// Forma REAL del editor: el texto vive en `texts`, no en `body`.
const paso = (texto) => [
  { type: "text", drive_url: "", texts: [texto], delay_after_sec: 0, enabled: true },
];
// Forma del motor (la del YAML), que también tiene que reconocer.
const pasoDelMotor = (texto) => [{ type: "text", body: texto }];
const pasoConVariantes = (texto) => [{ type: "text", body_variants: [texto] }];

const mexicoSinLlenar = {
  enabled: true,
  course_price_soles: 0,
  payment_text: MUESTRA_PRESENTACION,
  payment_buttons: [
    { label: "SPEI", method: "spei" },
    { label: "OXXO", method: "oxxo" },
  ],
  payment_responses: {
    spei: paso(MUESTRA_SPEI),
    oxxo: paso(MUESTRA_SPEI.replace("SPEI", "OXXO")),
  },
};

const argentinaLista = {
  enabled: true,
  course_price_soles: 7000,
  payment_text: "Puedes pagar al siguiente número 👇\n\nCUENTA: 34509283450",
  payment_buttons: [{ label: "Transferencia", method: "transferencia_bancaria" }],
  payment_responses: {
    transferencia_bancaria: paso("CBU 34509283450, titular Franko. Manda tu captura."),
  },
};

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (nombre, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(nombre, 58)} ${valor}`);
};

// --- El país a medio llenar: tiene que avisar de las tres cosas -------------
const mx = revisarPais(mexicoSinLlenar);
comprobar("país sin llenar: avisa que falta el precio", mx.faltaElPrecio, String(mx.faltaElPrecio));
comprobar(
  "país sin llenar: nombra los métodos que son de muestra",
  mx.metodosDeReferencia.length === 2 &&
    mx.metodosDeReferencia.includes("SPEI") &&
    mx.metodosDeReferencia.includes("OXXO"),
  mx.metodosDeReferencia.join(", ") || "(ninguno)"
);
comprobar(
  "país sin llenar: avisa que la presentación es de muestra",
  mx.presentacionDeReferencia,
  String(mx.presentacionDeReferencia)
);
comprobar("país sin llenar: da 3 avisos", mx.avisos.length === 3, String(mx.avisos.length));

// --- El país listo: cero ruido ---------------------------------------------
const ar = revisarPais(argentinaLista);
comprobar(
  "país completo: no avisa nada",
  ar.avisos.length === 0,
  ar.avisos.join(" | ") || "(silencio, correcto)"
);

// --- Casos sueltos ----------------------------------------------------------
const sinPerfil = revisarPais(undefined);
comprobar(
  "país sin perfil: avisa del precio y nada más",
  sinPerfil.faltaElPrecio && sinPerfil.metodosDeReferencia.length === 0,
  sinPerfil.avisos.length + " aviso(s)"
);

const precioCero = revisarPais({ ...argentinaLista, course_price_soles: 0 });
comprobar(
  "precio en 0 cuenta como sin precio",
  precioCero.faltaElPrecio && precioCero.avisos.length === 1,
  precioCero.avisos[0] ?? "(ninguno)"
);

const mitadYMitad = revisarPais({
  ...argentinaLista,
  payment_buttons: [
    { label: "Transferencia", method: "transferencia_bancaria" },
    { label: "Mercado Pago", method: "mercado_pago" },
  ],
  payment_responses: {
    transferencia_bancaria: paso("CBU 34509283450, titular Franko."),
    mercado_pago: paso(MUESTRA_SPEI.replace("SPEI", "Mercado Pago")),
  },
});
comprobar(
  "método real + método de muestra: solo señala el de muestra",
  mitadYMitad.metodosDeReferencia.length === 1 &&
    mitadYMitad.metodosDeReferencia[0] === "Mercado Pago",
  mitadYMitad.metodosDeReferencia.join(", ") || "(ninguno)"
);

comprobar(
  "reconoce la marca aunque cambie la envoltura",
  esTextoDeReferencia("  [REFERENCIA Chile] lo que sea  ") &&
    !esTextoDeReferencia("Transferí al CBU 123 y mandame la captura"),
  "sí"
);
// Las dos formas de guardar un paso tienen que dar el mismo resultado: si solo
// mirara la del editor, el aviso nunca saltaría sobre lo que hay en el YAML.
const enFormaDeMotor = revisarPais({
  ...mexicoSinLlenar,
  payment_responses: { spei: pasoDelMotor(MUESTRA_SPEI) },
});
comprobar(
  "reconoce el paso en la forma del motor (body)",
  enFormaDeMotor.metodosDeReferencia.length === 1,
  enFormaDeMotor.metodosDeReferencia.join(", ") || "(ninguno)"
);
const conVariantes = revisarPais({
  ...mexicoSinLlenar,
  payment_responses: { spei: pasoConVariantes(MUESTRA_SPEI) },
});
comprobar(
  "reconoce el paso con variaciones (body_variants)",
  conVariantes.metodosDeReferencia.length === 1,
  conVariantes.metodosDeReferencia.join(", ") || "(ninguno)"
);

comprobar(
  "un texto vacío no se toma por texto de muestra",
  !esTextoDeReferencia("") && !esTextoDeReferencia(null) && !esTextoDeReferencia(undefined),
  "sí"
);

// --- Los cajones de datos de pago vacíos ------------------------------------
//
// PASO DE VERDAD: una tienda con precio puesto y los cajones en blanco. El
// cliente eligió y, en medio de los datos de pago, le llegó una burbuja VACÍA:
// {{METODO_DE_PAGO_1}} se sustituye por nada. No da error, no avisa a nadie, y
// lo que falta es justo el número al que hay que pagar.
const conPagoDirecto = revisarPais(argentinaLista, {
  pagoDirectoEncendido: true,
});
comprobar(
  "pago directo encendido y cajones vacíos: avisa",
  conPagoDirecto.cajonesDePagoVacios.length === 2 &&
    conPagoDirecto.avisos.some((a) => a.includes("burbuja vacía")),
  conPagoDirecto.cajonesDePagoVacios.join(", ") || "(ninguno)"
);
comprobar(
  // Sin pago directo nadie usa esos cajones de fábrica: un aviso que sale
  // siempre es un aviso que ya no se lee.
  "pago directo apagado: no avisa de los cajones",
  revisarPais(argentinaLista).cajonesDePagoVacios.length === 0,
  "silencio"
);
comprobar(
  "con los cajones llenos, tampoco avisa",
  revisarPais(
    {
      ...argentinaLista,
      metodo_pago_1: "CBU 34509283450, titular Franko.",
      metodo_pago_principal: "CBU 34509283450, titular Franko.",
    },
    { pagoDirectoEncendido: true }
  ).avisos.length === 0,
  "silencio"
);
comprobar(
  "señala solo el que falta",
  revisarPais(
    { ...argentinaLista, metodo_pago_principal: "CBU 34509283450." },
    { pagoDirectoEncendido: true }
  ).cajonesDePagoVacios.join(", ") === "{{METODO_DE_PAGO_1}}",
  "el 1"
);

rmSync(TMP, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
