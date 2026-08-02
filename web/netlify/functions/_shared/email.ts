import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "./config.ts";
import { log } from "./logger.ts";

const sharedDir = dirname(fileURLToPath(import.meta.url));
const bundledTemplateDir = join(sharedDir, "templates", "emails");
const webTemplateDir = join(sharedDir, "..", "..", "..", "templates", "emails");

export type EmailTemplateName =
  | "escalation"
  | "lead-qualified"
  | "lead"
  | "appointment-booked"
  | "appointment"
  | "appointment-reminder";

const TEMPLATE_ALIASES: Record<EmailTemplateName, string> = {
  escalation: "escalation",
  "lead-qualified": "lead",
  lead: "lead",
  "appointment-booked": "appointment",
  appointment: "appointment",
  "appointment-reminder": "appointment-reminder",
};

const EMBEDDED_TEMPLATES: Record<string, string> = {
  escalation: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;"><h2 style="color:#b45309;">Human help needed</h2><p><strong>{{customerName}}</strong> needs a team member on <strong>{{channel}}</strong>.</p><p style="background:#fffbeb;padding:12px;border-radius:8px;">{{message}}</p><p><a href="{{dashboardUrl}}">Open conversation in AI Business OS</a></p></body></html>`,
  lead: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;"><h2 style="color:#047857;">New qualified lead</h2><p><strong>{{customerName}}</strong> is ready for follow-up.</p><ul><li>Email: {{email}}</li><li>Phone: {{phone}}</li><li>Interest: {{interest}}</li><li>Budget: {{budget}}</li><li>Timeline: {{timeline}}</li></ul><p><a href="{{dashboardUrl}}">View leads in AI Business OS</a></p></body></html>`,
  appointment: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;"><h2 style="color:#0f766e;">Appointment booked</h2><p>New appointment: <strong>{{customerName}}</strong> on <strong>{{date}}</strong> at <strong>{{time}}</strong>.</p><p>{{message}}</p><p><a href="{{dashboardUrl}}">View calendar in AI Business OS</a></p></body></html>`,
  "appointment-reminder": `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;"><h2 style="color:#0f766e;">Appointment reminder sent</h2><p>A 1-hour reminder was sent to the customer.</p><p>{{message}}</p><p><a href="{{dashboardUrl}}">Open AI Business OS</a></p></body></html>`,
};

function loadTemplateFile(name: EmailTemplateName): string {
  const fileName = `${TEMPLATE_ALIASES[name]}.html`;
  for (const dir of [webTemplateDir, bundledTemplateDir]) {
    try {
      return readFileSync(join(dir, fileName), "utf8");
    } catch {
      // try next location
    }
  }
  return EMBEDDED_TEMPLATES[TEMPLATE_ALIASES[name]] ?? "<p>{{message}}</p>";
}

export function renderEmailTemplate(
  name: EmailTemplateName,
  variables: Record<string, string>,
): string {
  let html = loadTemplateFile(name);
  for (const [key, value] of Object.entries(variables)) {
    html = html.replaceAll(`{{${key}}}`, value || "—");
  }
  return html;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const { apiKey } = getConfig().resend;
  const from = getConfig().resend.fromEmail;

  if (!apiKey) {
    log.info("email_send_skipped", {
      action: "send_email",
      status: "logged",
      to: "[REDACTED]",
      subject: input.subject,
    });
    return false;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html ?? undefined,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      log.warn("email_send_failed", {
        action: "send_email",
        status: response.status,
        error: detail.slice(0, 200),
      });
    }

    return response.ok;
  } catch (error) {
    log.warn("email_send_failed", {
      action: "send_email",
      status: "error",
      error: error instanceof Error ? error.message : "send failed",
    });
    return false;
  }
}

export function escalationEmailSubject(customerName: string): string {
  const name = customerName.trim() || "Customer";
  return `[AI OS] Human help needed — ${name}`;
}

export function leadQualifiedEmailSubject(customerName: string): string {
  const name = customerName.trim() || "New lead";
  return `[AI OS] Qualified lead — ${name}`;
}

export function whatsappLeadAlert(input: {
  name: string;
  email?: string;
  interest?: string;
}): string {
  const parts = [
    `New qualified lead: ${input.name || "Unknown"}`,
    input.email ? input.email : "",
    input.interest ? `interested in ${input.interest}` : "",
  ].filter(Boolean);
  return parts.join(", ").slice(0, 900);
}
