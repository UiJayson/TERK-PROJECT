import { createId } from "./auth-crypto.ts";
import { getSiteUrl } from "./config.ts";
import * as db from "./db.ts";
import {
  escalationEmailSubject,
  leadQualifiedEmailSubject,
  renderEmailTemplate,
  sendEmail,
  whatsappLeadAlert,
} from "./email.ts";
import { log } from "./logger.ts";
import {
  parseNotificationPreferences,
  resolveAdminEmail,
  resolveAdminWhatsApp,
} from "./notification-preferences.ts";
import { sendTextMessage } from "./whatsapp-sender.ts";

export type NotificationEvent =
  | "conversation_escalated"
  | "lead_qualified"
  | "appointment_booked"
  | "appointment_reminder"
  | "daily_summary"
  | "bi_price_change"
  | "bi_risk_alert"
  | "bi_weekly_report";

/** @deprecated Use NotificationEvent */
export type NotificationType = "escalation" | "qualified_lead" | "appointment_booked";

export interface SendNotificationInput {
  workspaceId: string;
  event: NotificationEvent;
  title: string;
  message: string;
  link?: string;
  metadata?: Record<string, unknown>;
  customerName?: string;
  channel?: string;
  leadEmail?: string;
  leadPhone?: string;
  interest?: string;
  budget?: string;
  timeline?: string;
  appointmentDate?: string;
  appointmentTime?: string;
}

function dashboardBaseUrl(): string {
  return getSiteUrl();
}

function conversationUrl(metadata?: Record<string, unknown>): string {
  const base = dashboardBaseUrl();
  const conversationId = metadata?.conversationId;
  if (typeof conversationId === "string" && conversationId) {
    return `${base}/app/conversations?conversation=${encodeURIComponent(conversationId)}`;
  }
  return `${base}/app/conversations`;
}

function resolveLink(input: SendNotificationInput): string {
  if (input.link) return input.link;
  if (input.event === "lead_qualified") return `${dashboardBaseUrl()}/app/leads`;
  if (input.event === "appointment_booked") return `${dashboardBaseUrl()}/app/conversations`;
  if (input.event === "daily_summary") return `${dashboardBaseUrl()}/app/analytics`;
  return conversationUrl(input.metadata);
}

function eventMessage(input: SendNotificationInput): string {
  if (input.event === "conversation_escalated") {
    const name = input.customerName?.trim() || "Customer";
    return `Customer ${name} requested human help. View: ${resolveLink(input)}`;
  }
  if (input.event === "lead_qualified") {
    const name = input.customerName?.trim() || "Unknown";
    const email = input.leadEmail ?? "—";
    const interest = input.interest ?? "general inquiry";
    return `New qualified lead: ${name}, ${email}, interested in ${interest}`;
  }
  if (input.event === "appointment_booked") {
    const name = input.customerName?.trim() || "Customer";
    const date = input.appointmentDate ?? "TBD";
    const time = input.appointmentTime ?? "TBD";
    return `New appointment: ${name} on ${date} at ${time}`;
  }
  return input.message;
}

function whatsappAlertText(input: SendNotificationInput): string {
  if (input.event === "lead_qualified") {
    return whatsappLeadAlert({
      name: input.customerName ?? "Unknown",
      email: input.leadEmail,
      interest: input.interest,
    });
  }

  if (input.event === "conversation_escalated") {
    return eventMessage(input).slice(0, 900);
  }

  return `${input.title}\n\n${eventMessage(input)}`.slice(0, 900);
}

async function sendEmailForEvent(
  input: SendNotificationInput,
  to: string,
): Promise<boolean> {
  const dashboardUrl = resolveLink(input);
  const vars = {
    customerName: input.customerName ?? "Customer",
    channel: input.channel ?? "chat",
    message: eventMessage(input),
    email: input.leadEmail ?? "—",
    phone: input.leadPhone ?? "—",
    interest: input.interest ?? "—",
    budget: input.budget ?? "—",
    timeline: input.timeline ?? "—",
    date: input.appointmentDate ?? "—",
    time: input.appointmentTime ?? "—",
    dashboardUrl,
  };

  switch (input.event) {
    case "conversation_escalated":
      return sendEmail({
        to,
        subject: escalationEmailSubject(input.customerName ?? "Customer"),
        text: eventMessage(input),
        html: renderEmailTemplate("escalation", vars),
      });
    case "lead_qualified":
      return sendEmail({
        to,
        subject: leadQualifiedEmailSubject(input.customerName ?? "New lead"),
        text: eventMessage(input),
        html: renderEmailTemplate("lead", vars),
      });
    case "appointment_booked":
      return sendEmail({
        to,
        subject: `[AI OS] Appointment booked — ${input.customerName ?? "Customer"}`,
        text: eventMessage(input),
        html: renderEmailTemplate("appointment", vars),
      });
    case "appointment_reminder":
      return sendEmail({
        to,
        subject: `[AI OS] Appointment reminder sent — ${input.customerName ?? "Customer"}`,
        text: input.message,
        html: renderEmailTemplate("appointment-reminder", vars),
      });
    case "daily_summary":
      return sendEmail({
        to,
        subject: `[AI OS] Daily summary`,
        text: input.message,
      });
    default:
      return sendEmail({
        to,
        subject: `[AI OS] ${input.title}`,
        text: input.message,
      });
  }
}

async function logNotificationAttempt(input: {
  workspaceId: string;
  event: NotificationEvent;
  channel: string;
  status: "sent" | "failed" | "logged" | "skipped";
  payload: Record<string, unknown>;
}): Promise<void> {
  await db.saveAdminNotification({
    id: createId("notify"),
    workspaceId: input.workspaceId,
    type: input.event,
    channel: input.channel,
    status: input.status,
    payload: input.payload,
  });
}

export async function sendNotification(input: SendNotificationInput): Promise<void> {
  const profile = await db.getBusinessProfile(input.workspaceId);
  const prefs = parseNotificationPreferences(profile);
  const ownerEmail = await db.getWorkspaceOwnerEmail(input.workspaceId);
  const adminEmail = resolveAdminEmail(prefs, ownerEmail);
  const adminPhone = resolveAdminWhatsApp(prefs, profile);
  const link = resolveLink(input);
  const message = eventMessage(input);

  const payload = {
    event: input.event,
    title: input.title,
    message,
    link,
    ...input.metadata,
  };

  await db.createDashboardNotification({
    id: createId("notif"),
    workspaceId: input.workspaceId,
    type: input.event,
    title: input.title,
    message,
    link,
    metadata: input.metadata ?? {},
  });

  await logNotificationAttempt({
    workspaceId: input.workspaceId,
    event: input.event,
    channel: "dashboard",
    status: "sent",
    payload,
  });

  if (prefs.emailEnabled && adminEmail) {
    const emailSent = await sendEmailForEvent({ ...input, message }, adminEmail);
    await logNotificationAttempt({
      workspaceId: input.workspaceId,
      event: input.event,
      channel: "email",
      status: emailSent ? "sent" : "failed",
      payload: { ...payload, to: "[REDACTED]" },
    });
  }

  const wantsWhatsApp =
    prefs.whatsappEnabled &&
    (input.event === "conversation_escalated" || input.event === "lead_qualified");

  if (wantsWhatsApp && adminPhone) {
    const channelConfig = await db.getChannelConfig(input.workspaceId);
    const whatsapp = channelConfig?.whatsapp as Record<string, unknown> | undefined;
    const phoneNumberId = whatsapp?.phoneNumberId as string | undefined;

    if (phoneNumberId && whatsapp?.accessTokenEnc) {
      try {
        const { decryptSecret } = await import("./secret-crypto.ts");
        const accessToken = decryptSecret(String(whatsapp.accessTokenEnc));
        const alertText = whatsappAlertText({ ...input, message });

        await sendTextMessage(
          adminPhone.replace(/\D/g, ""),
          alertText,
          phoneNumberId,
          accessToken,
        );

        await logNotificationAttempt({
          workspaceId: input.workspaceId,
          event: input.event,
          channel: "whatsapp_admin",
          status: "sent",
          payload: { ...payload, to: "[REDACTED]" },
        });
      } catch (error) {
        log.warn("whatsapp_admin_alert_failed", {
          workspaceId: input.workspaceId,
          action: "send_notification",
          error: error instanceof Error ? error.message : "send failed",
        });
        await logNotificationAttempt({
          workspaceId: input.workspaceId,
          event: input.event,
          channel: "whatsapp_admin",
          status: "failed",
          payload: {
            ...payload,
            error: error instanceof Error ? error.message : "send failed",
          },
        });
      }
    }
  }
}

/** Backward-compatible wrapper for existing call sites */
export async function notifyBusinessOwner(input: {
  workspaceId: string;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  customerName?: string;
  channel?: string;
  leadEmail?: string;
  leadPhone?: string;
  interest?: string;
  budget?: string;
  timeline?: string;
  appointmentDate?: string;
  appointmentTime?: string;
}): Promise<void> {
  const eventMap: Record<NotificationType, NotificationEvent> = {
    escalation: "conversation_escalated",
    qualified_lead: "lead_qualified",
    appointment_booked: "appointment_booked",
  };

  await sendNotification({
    workspaceId: input.workspaceId,
    event: eventMap[input.type],
    title: input.title,
    message: input.body,
    metadata: input.metadata,
    customerName: input.customerName,
    channel: input.channel,
    leadEmail: input.leadEmail,
    leadPhone: input.leadPhone,
    interest: input.interest,
    budget: input.budget,
    timeline: input.timeline,
    appointmentDate: input.appointmentDate,
    appointmentTime: input.appointmentTime,
  });
}

export async function sendDailySummary(input: {
  workspaceId: string;
  conversations: number;
  leads: number;
  appointments: number;
}): Promise<void> {
  const message = `Yesterday: ${input.conversations} conversations, ${input.leads} leads, ${input.appointments} appointments`;
  await sendNotification({
    workspaceId: input.workspaceId,
    event: "daily_summary",
    title: "Daily summary",
    message,
  });
}
