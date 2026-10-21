import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidad",
  description:
    "Política de privacidad del servicio de atención y venta por WhatsApp de abcMulticursos.",
};

const EMPRESA = "abcMulticursos";
const CONTACTO_EMAIL = "abcmulticursos@gmail.com";
const ACTUALIZADO = "16 de junio de 2026";

export default function PrivacidadPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 leading-relaxed text-neutral-800">
      <h1 className="mb-2 text-2xl font-bold text-neutral-900">
        Política de Privacidad
      </h1>
      <p className="mb-8 text-sm text-neutral-500">
        Última actualización: {ACTUALIZADO}
      </p>

      <p className="mb-6">
        En <strong>{EMPRESA}</strong> respetamos tu privacidad. Esta política
        explica qué datos recopilamos cuando te comunicas con nosotros por
        WhatsApp, para qué los usamos y cuáles son tus derechos. Al escribirnos
        por WhatsApp aceptas las prácticas descritas aquí.
      </p>

      <Section titulo="1. Quiénes somos">
        <p>
          {EMPRESA} es un emprendimiento dedicado a la venta de material
          educativo digital (archivos PDF descargables e imprimibles) para el
          aprendizaje de niños. Brindamos atención y ventas a través de WhatsApp
          usando la API oficial de WhatsApp Business (Meta).
        </p>
      </Section>

      <Section titulo="2. Qué información recopilamos">
        <ul className="list-disc space-y-1 pl-6">
          <li>
            Tu <strong>número de teléfono</strong> de WhatsApp y el{" "}
            <strong>nombre</strong> que tienes configurado en tu perfil.
          </li>
          <li>
            El <strong>contenido de los mensajes</strong> que nos envías (texto,
            imágenes, audios o documentos), incluido el comprobante de pago si
            decides comprar.
          </li>
          <li>
            Datos necesarios para procesar tu compra y entregarte el material
            (por ejemplo, tu correo electrónico si lo proporcionas para el
            envío).
          </li>
        </ul>
        <p className="mt-3">
          No solicitamos ni almacenamos datos de tarjetas de crédito; los pagos
          se realizan por los medios que tú elijes y nos confirmas.
        </p>
      </Section>

      <Section titulo="3. Para qué usamos tu información">
        <ul className="list-disc space-y-1 pl-6">
          <li>Responder tus consultas y brindarte atención al cliente.</li>
          <li>
            Procesar tu compra, validar tu pago y entregarte el material
            educativo.
          </li>
          <li>
            Enviarte mensajes de seguimiento relacionados con tu interés o tu
            compra.
          </li>
          <li>Mejorar la calidad de nuestro servicio.</li>
        </ul>
      </Section>

      <Section titulo="4. Con quién compartimos tu información">
        <p>
          <strong>No vendemos ni alquilamos tus datos a terceros.</strong> Solo
          compartimos información con proveedores que hacen posible el servicio,
          y únicamente en lo necesario:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-6">
          <li>
            <strong>Meta Platforms</strong> (WhatsApp Business), para el envío y
            recepción de mensajes.
          </li>
          <li>
            Proveedores de infraestructura tecnológica que alojan nuestro
            sistema de forma segura.
          </li>
        </ul>
      </Section>

      <Section titulo="5. Cuánto tiempo conservamos tus datos">
        <p>
          Conservamos tus datos solo durante el tiempo necesario para atenderte,
          gestionar tu compra y cumplir obligaciones legales o contables. Cuando
          ya no son necesarios, los eliminamos o anonimizamos.
        </p>
      </Section>

      <Section titulo="6. Tus derechos">
        <p>
          Puedes solicitar en cualquier momento acceder a tus datos,
          corregirlos o eliminarlos, así como dejar de recibir nuestros
          mensajes. Para ejercer estos derechos, escríbenos al correo indicado
          más abajo o respóndenos por WhatsApp pidiendo que dejemos de
          contactarte.
        </p>
      </Section>

      <Section titulo="7. Seguridad">
        <p>
          Aplicamos medidas razonables para proteger tu información frente a
          accesos no autorizados, pérdida o uso indebido. Ningún sistema es 100%
          infalible, pero trabajamos para mantener tus datos seguros.
        </p>
      </Section>

      <Section titulo="8. Cambios a esta política">
        <p>
          Podemos actualizar esta política ocasionalmente. La versión vigente
          siempre estará disponible en esta misma página, con su fecha de última
          actualización.
        </p>
      </Section>

      <Section titulo="9. Contacto">
        <p>
          Si tienes preguntas sobre esta política o sobre el tratamiento de tus
          datos, contáctanos en:{" "}
          <a
            href={`mailto:${CONTACTO_EMAIL}`}
            className="font-medium text-emerald-700 underline"
          >
            {CONTACTO_EMAIL}
          </a>
          .
        </p>
      </Section>

      <footer className="mt-10 border-t border-neutral-200 pt-5 text-sm text-neutral-500">
        © {new Date().getFullYear()} {EMPRESA}. Todos los derechos reservados.
      </footer>
    </main>
  );
}

function Section({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-7">
      <h2 className="mb-2 text-lg font-semibold text-neutral-900">{titulo}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
