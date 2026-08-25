import { google, gmail_v1 } from "googleapis";
import { TokenStore } from "../token-store.js";
import { Attachment, MailMessage, ThreadMessage } from "./types.js";

export interface MailGateway {
  accounts(): string[];
  collect(account: string, afterMs: number, beforeMs: number, threadLimit: number): Promise<MailMessage[]>;
  send(account: string, recipient: string, subject: string, body: string, digestId: string, part: number): Promise<void>;
}

function decode(data?: string | null): string { return data ? Buffer.from(data, "base64url").toString("utf8") : ""; }
function header(p: gmail_v1.Schema$MessagePart | undefined, name: string): string {
  return p?.headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}
function bodies(p?: gmail_v1.Schema$MessagePart): { text: string; html: string; attachments: Attachment[] } {
  const out = { text: "", html: "", attachments: [] as Attachment[] };
  const walk = (part?: gmail_v1.Schema$MessagePart) => {
    if (!part) return;
    if (part.filename) out.attachments.push({ filename: part.filename, mimeType: part.mimeType ?? "application/octet-stream", size: part.body?.size ?? 0, attachmentId: part.body?.attachmentId ?? undefined });
    if (part.mimeType === "text/plain") out.text += decode(part.body?.data);
    if (part.mimeType === "text/html") out.html += decode(part.body?.data);
    part.parts?.forEach(walk);
  }; walk(p); return out;
}
function cleanQuoted(text: string): string {
  // Gmail often embeds the whole conversation. Thread context is supplied separately.
  const markers = [/\nOn .+wrote:\s*\n/i, /\n-{2,}\s*Original Message\s*-{2,}/i, /\nFrom:\s.*\nSent:\s/im];
  let end = text.length; for (const marker of markers) { const m = marker.exec(text); if (m?.index !== undefined) end = Math.min(end, m.index); }
  return text.slice(0, end).trim();
}

export class GoogleMailGateway implements MailGateway {
  constructor(private store = new TokenStore()) {}
  accounts(): string[] { return this.store.listAccounts().map(a => a.email); }
  private async api(account: string) {
    const token = this.store.getRefreshToken(account); if (!token) throw new Error(`No token for ${account}`);
    const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: token }); return google.gmail({ version: "v1", auth });
  }
  async collect(account: string, afterMs: number, beforeMs: number, threadLimit: number): Promise<MailMessage[]> {
    const api = await this.api(account); const ids = new Map<string, true>();
    // One-second overlap prevents boundary loss; exact filtering below removes
    // old read messages. Duplicates are preferable to gaps after clock rounding.
    const afterSec = Math.floor(afterMs / 1000)-1; const beforeSec = Math.ceil(beforeMs / 1000);
    for (const q of [`after:${afterSec} before:${beforeSec}`, `is:unread before:${beforeSec}`]) {
      let pageToken: string | undefined;
      do { const page = await api.users.messages.list({ userId: "me", q, maxResults: 500, pageToken });
        page.data.messages?.forEach(m => m.id && ids.set(m.id, true)); pageToken = page.data.nextPageToken ?? undefined;
      } while (pageToken);
    }
    const result: MailMessage[] = [];
    for (const id of ids.keys()) {
      const got = (await api.users.messages.get({ userId: "me", id, format: "full" })).data;
      const internalDate = Number(got.internalDate ?? 0); const content = bodies(got.payload);
      const unread = (got.labelIds ?? []).includes("UNREAD");
      if (internalDate > beforeMs || (internalDate <= afterMs && !unread)) continue;
      const thread = (await api.users.threads.get({ userId: "me", id: got.threadId!, format: "full" })).data.messages ?? [];
      const context: ThreadMessage[] = thread.filter(m => m.id !== id).slice(-threadLimit).map(m => {
        const b = bodies(m.payload); return { id: m.id!, date: header(m.payload, "Date"), from: header(m.payload, "From"), to: header(m.payload, "To"), bodyText: cleanQuoted(b.text || b.html) };
      });
      result.push({ sourceAccount: account, id, threadId: got.threadId!, internalDate, unread, from: header(got.payload,"From"), to: header(got.payload,"To"), cc: header(got.payload,"Cc"), subject: header(got.payload,"Subject"), bodyText: content.text, bodyHtml: content.html, attachments: content.attachments, threadContext: context });
    }
    return result.sort((a,b) => a.internalDate-b.internalDate);
  }
  async send(account: string, recipient: string, subject: string, body: string, digestId: string, part: number): Promise<void> {
    const api = await this.api(account); const messageId = `<auren-${digestId}-${part}@local>`;
    const raw = Buffer.from([`To: ${recipient}`, `Subject: ${subject}`, `Message-ID: ${messageId}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", body].join("\r\n")).toString("base64url");
    await api.users.messages.send({ userId: "me", requestBody: { raw } });
  }
}
