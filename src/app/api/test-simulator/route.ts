import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  getConversationById,
  getOrCreateConversation,
  setConversationCountry,
  setConversationWaPhoneNumberId,
  fijarTiendaPorFraseSiFalta,
  setConversationMessengerPage,
  setTestConversationChannel,
} from "@/lib/db";
import { COUNTRIES, type CountryCode } from "@/lib/countries";
import { loadWorkflowConfig } from "@/lib/workflow/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COUNTRY_CODES = new Set<CountryCode>(Object.keys(COUNTRIES) as CountryCode[]);
const PHONE_PREFIX: Record<CountryCode, string> = {
  PE: "51", MX: "52", CO: "57", AR: "54", BO: "591", GT: "502",
  CR: "506", CL: "56", EC: "593", SV: "503", VE: "58",
};

export async function POST(req: NextRequest) {
  let body: {
    country?: unknown;
    name?: unknown;
    channel?: unknown;
    tienda?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Datos de prueba inválidos" }, { status: 400 });
  }
  const channel = body.channel === "messenger" ? "messenger" : "whatsapp";
  const requestedCountry =
    typeof body.country === "string" && body.country.trim()
      ? (body.country.toUpperCase() as CountryCode)
      : null;
  if (requestedCountry && !COUNTRY_CODES.has(requestedCountry)) {
    return NextResponse.json({ error: "País de prueba inválido" }, { status: 400 });
  }
  if (channel === "whatsapp" && !requestedCountry) {
    return NextResponse.json({ error: "Elige un país para simular WhatsApp" }, { status: 400 });
  }
  const country = requestedCountry ?? "PE";
  const name = typeof body.name === "string" && body.name.trim()
    ? body.name.trim().slice(0, 40)
    : "Cliente de prueba";
  // Conserva el prefijo real para probar la detección de país, pero incluye
  // texto y un UUID: nunca puede coincidir con un teléfono de producción.
  const phone = `test:${PHONE_PREFIX[country]}-${crypto.randomUUID()}`;
  const convo = getOrCreateConversation(phone, name, "test");
  setTestConversationChannel(convo.id, channel);
  // El simulador fija la elección explícitamente: preserva la lada ficticia
  // para probar el origen, pero evita que un paso posterior caiga al país base.
  if (requestedCountry) {
    setConversationCountry(convo.id, requestedCountry);
  }
  // PROBAR UNA TIENDA EN EL SIMULADOR.
  //
  // LO PIDIO EL DUEÑO el 01/10/2026: «yo no puedo probar en celular, me van a cobrar
  // por conversacion. Necesito testear en el simulador, busca la manera». Y tiene
  // razon: desde el 1 de octubre Meta cobra por mensaje, asi que probar una tienda
  // escribiendo de verdad cuesta dinero cada vez.
  //
  // EL PROBLEMA: la tienda se encuentra por el numero de WhatsApp o por la pagina, y
  // el simulador no entra por ninguno de los dos. Asi que no encontraba tienda y
  // vendia el contenido general con la cuenta del dueño — y el habria pensado que
  // estaba roto.
  //
  // COMO SE RESUELVE SIN INVENTAR NADA: se le escribe a la conversacion de prueba el
  // MISMO dato con el que entra un cliente real —el numero de la tienda, o su pagina
  // si se simula Messenger—. De ahi en adelante todo el motor se comporta igual que
  // en vivo, porque lee exactamente lo que leeria. No hay un camino de prueba
  // aparte, que es como se acaba probando algo que no es lo que pasa.
  const idDeLaTienda =
    typeof body.tienda === "string" ? body.tienda.trim() : "";
  let tiendaProbada: { id: string; nombre: string } | null = null;
  if (idDeLaTienda) {
    const suya = (loadWorkflowConfig()?.tiendas ?? []).find(
      (t) => String(t?.id ?? "").trim() === idDeLaTienda
    );
    if (suya) {
      // En WhatsApp manda el numero; en Messenger, la pagina. Se escribe solo el del
      // canal que se esta simulando: escribir los dos haria que la tienda se
      // encontrara por un camino que en vivo no existe para ese canal.
      if (channel === "whatsapp") {
        setConversationWaPhoneNumberId(convo.id, String(suya.numero ?? "").trim());
      } else {
        setConversationMessengerPage(convo.id, String(suya.pagina ?? "").trim());
      }
      // UNA TIENDA CON FRASES DE ENTRADA comparte número con otras, así que el número solo
      // no la elige: en vivo la elige la frase del primer mensaje. Aquí se elige a mano y se
      // anota igual que la anotaría la frase. Solo en WhatsApp, que es donde actúan las
      // frases. Sin frases, nada cambia.
      const conFrases = (suya.frases_de_entrada ?? []).some((f) => String(f ?? "").trim());
      if (channel === "whatsapp" && conFrases) {
        fijarTiendaPorFraseSiFalta(convo.id, String(suya.id));
      }
      tiendaProbada = {
        id: String(suya.id),
        nombre: String(suya.nombre ?? "").trim() || "Tienda sin nombre",
      };
    }
  }
  return NextResponse.json({
    id: convo.id,
    phone: convo.phone,
    country: requestedCountry,
    name,
    channel,
    tienda: tiendaProbada,
    autoCountryDetection: loadWorkflowConfig()?.country_mode === "auto_phone",
  });
}

export async function GET(req: NextRequest) {
  // LA LISTA DE TIENDAS, para que el simulador pueda elegir con cual probar.
  //
  // Va aqui y no leyendo la configuracion entera desde el navegador: de todo el
  // archivo el simulador solo necesita el id y el nombre de cada tienda, y traerse
  // la configuracion completa para eso es cargar megas por dos campos.
  if (req.nextUrl.searchParams.get("tiendas") === "1") {
    const tiendas = (loadWorkflowConfig()?.tiendas ?? [])
      .filter((t) => String(t?.id ?? "").trim())
      .map((t, i) => ({
        id: String(t.id).trim(),
        nombre: String(t?.nombre ?? "").trim() || `Tienda ${i + 1}`,
        // Para avisar en la pantalla si esa tienda no atiende el canal que se
        // esta simulando: sin numero no hay WhatsApp, sin pagina no hay Messenger.
        tieneNumero: Boolean(String(t?.numero ?? "").trim()),
        tienePagina: Boolean(String(t?.pagina ?? "").trim()),
        apagada: t?.enabled === false,
      }));
    return NextResponse.json({ tiendas });
  }
  const id = Number(req.nextUrl.searchParams.get("id"));
  const convo = Number.isFinite(id) ? getConversationById(id) : undefined;
  if (!convo || convo.channel !== "test") {
    return NextResponse.json({ error: "Prueba no encontrada" }, { status: 404 });
  }
  return NextResponse.json({ id: convo.id, phone: convo.phone, name: convo.name });
}
