import { sendTextMessage } from "@/lib/meta/client";
import { loadWorkflowConfig } from "@/lib/workflow/config";

export type NotificationSendResult = {
  attempted: number;
  sent: number;
  errors: string[];
};

function normalizePhone(value?: string | null): string {
  return (value ?? "").replace(/[^\d]/g, "");
}

async function notifyTelegram(
  chatId: string,
  text: string
): Promise<string | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    const error = "TELEGRAM_BOT_TOKEN no configurado";
    console.warn(`[notify] ${error}, no se envia Telegram`);
    return error;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Telegram HTTP ${res.status}: ${body}`);
    }
    console.log(`[notify] Telegram enviado a ${chatId}`);
    return null;
  } catch (err) {
    console.error(`[notify] fallo enviando Telegram a ${chatId}:`, err);
    return err instanceof Error ? err.message : "Error enviando Telegram";
  }
}

/**
 * Envia una notificacion administrativa sin romper el flujo si falla.
 *
 * Compatibilidad:
 * - Si el Centro de Notificaciones esta apagado, usa ADMIN_NOTIFY_PHONE como antes.
 * - Si esta encendido, usa los destinatarios configurados en Ajustes.
 */
export async function notifyAdmin(text: string): Promise<NotificationSendResult> {
  const result: NotificationSendResult = { attempted: 0, sent: 0, errors: [] };
  const config = loadWorkflowConfig();
  const settings = config?.notification_settings;
  const useManager = settings?.enabled === true;
  const legacyPhone = normalizePhone(process.env.ADMIN_NOTIFY_PHONE);
  const recipients = useManager
    ? (settings?.recipients ?? []).filter(
        (recipient) => recipient.enabled !== false
      )
    : legacyPhone
      ? [{ phone: legacyPhone, telegram_chat_id: "" }]
      : [];

  if (recipients.length === 0) {
    console.warn(
      "[notify] sin destinatarios configurados, no se envia notificacion"
    );
    result.errors.push("Sin destinatarios configurados");
    return result;
  }

  const whatsappEnabled = useManager
    ? settings?.whatsapp_enabled !== false
    : true;
  const telegramEnabled = useManager
    ? settings?.telegram_enabled === true
    : false;

  for (const recipient of recipients) {
    const phone = normalizePhone(recipient.phone);
    if (whatsappEnabled && phone) {
      result.attempted += 1;
      try {
        await sendTextMessage(phone, text);
        result.sent += 1;
        console.log(`[notify] WhatsApp enviado a ${phone}`);
      } catch (err) {
        console.error(`[notify] fallo enviando WhatsApp a ${phone}:`, err);
        result.errors.push(
          err instanceof Error ? err.message : `Error enviando WhatsApp a ${phone}`
        );
      }
    }

    const chatId = recipient.telegram_chat_id?.trim();
    if (telegramEnabled && chatId) {
      result.attempted += 1;
      const error = await notifyTelegram(chatId, text);
      if (error) {
        result.errors.push(error);
      } else {
        result.sent += 1;
      }
    }
  }

  if (result.attempted === 0) {
    result.errors.push("No hay canales activos para los destinatarios");
  }

  return result;
}
