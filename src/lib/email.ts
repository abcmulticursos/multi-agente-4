import nodemailer, { type Transporter } from "nodemailer";

let cachedTransporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (cachedTransporter) return cachedTransporter;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      "GMAIL_USER o GMAIL_APP_PASSWORD no configuradas en el entorno"
    );
  }
  cachedTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
    // Ninguna espera es eterna (05/11/2026, ver limites.ts): por defecto, hasta 10 min sin respuesta de Gmail.
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
  });
  return cachedTransporter;
}

export interface SendEmailParams {
  to: string;
  fromName: string;
  subject: string;
  body: string;
}

/**
 * Envía un email vía Gmail SMTP. Requiere GMAIL_USER y GMAIL_APP_PASSWORD
 * en el entorno (la "Contraseña de aplicación" generada en Google).
 *
 * El email queda visible en la bandeja "Enviados" del Gmail asociado.
 */
export async function sendEmail(params: SendEmailParams): Promise<void> {
  // ÚLTIMA LÍNEA DE DEFENSA. Una plantilla sin rellenar es un objeto con los
  // campos vacíos: no es null ni tiene comodines, así que pasa los guardas de
  // arriba. Sin esto, a quien acaba de pagar le llegaba un correo en blanco —
  // que parece una estafa. Antes eso que mandar nada.
  if (!params.subject?.trim() || !params.body?.trim()) {
    throw new Error(
      "Plantilla de correo vacía (asunto o cuerpo sin texto): no se envía"
    );
  }
  const transporter = getTransporter();
  const fromAddr = process.env.GMAIL_USER;
  if (!fromAddr) throw new Error("GMAIL_USER no configurada");

  await transporter.sendMail({
    from: `"${params.fromName}" <${fromAddr}>`,
    to: params.to,
    subject: params.subject,
    text: params.body,
  });
}
