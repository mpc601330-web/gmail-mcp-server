export interface Attachment { filename: string; mimeType: string; size: number; attachmentId?: string }
export interface MailMessage {
  sourceAccount: string; id: string; threadId: string; internalDate: number; unread: boolean;
  from: string; to: string; cc: string; subject: string; bodyText: string; bodyHtml: string;
  attachments: Attachment[]; threadContext: ThreadMessage[];
}
export interface ThreadMessage { id: string; date: string; from: string; to: string; bodyText: string }
export interface DigestPart { digestId: string; number: number; total: number; subject: string; body: string; units: string[] }
export interface PendingRun { digestId: string; startedAt: string; cutoffMs: number; selectedKeys: string[]; parts: DigestPart[]; sentParts: number[] }
export interface CollectorState { lastSuccessfulRun?: string; lastSuccessfulCutoffMs?: number; pending?: PendingRun }
