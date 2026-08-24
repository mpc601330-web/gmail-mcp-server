import { DigestPart, MailMessage } from "./types.js";
const bytes = (s: string) => Buffer.byteLength(s, "utf8");

export function serializeEmail(mail: MailMessage, number: number): string {
  const n = String(number).padStart(6,"0");
  const context = mail.threadContext.map((m,i) => `--- PRIOR ${i+1} ---\nMESSAGE_ID: ${m.id}\nDATE: ${m.date}\nFROM: ${m.from}\nTO: ${m.to}\n${m.bodyText}`).join("\n");
  const attachments = mail.attachments.length ? mail.attachments.map(a => `- ${a.filename}\n  mime_type: ${a.mimeType}\n  size: ${a.size}\n  attachment_id: ${a.attachmentId ?? "unavailable"}`).join("\n") : "- none";
  return `EMAIL_NUMBER: #${n}\nSOURCE_ACCOUNT: ${mail.sourceAccount}\nMESSAGE_ID: ${mail.id}\nTHREAD_ID: ${mail.threadId}\nRECEIVED_AT: ${new Date(mail.internalDate).toISOString()}\nUNREAD: ${mail.unread}\n\nFROM: ${mail.from}\nTO: ${mail.to}\nCC: ${mail.cc}\nSUBJECT: ${mail.subject}\n\nBODY_TEXT:\n${mail.bodyText}\n\nBODY_HTML:\n${mail.bodyHtml}\n\nTHREAD_CONTEXT:\n${context || "none"}\n\nATTACHMENTS:\n${attachments}\n\nEND_EMAIL\n`;
}

export class DigestBuilder {
  constructor(private maxBytes: number) { if (maxBytes < 1024) throw new Error("AUREN_MAX_PART_BYTES must be at least 1024"); }
  build(digestId: string, generatedAt: string, mails: MailMessage[]): DigestPart[] {
    const payloadLimit = this.maxBytes - 700; const chunks: { text: string; unit: string }[] = [];
    mails.forEach((m,i) => {
      const full = serializeEmail(m,i+1); const unit = `${m.sourceAccount}:${m.id}`;
      if (bytes(full) <= payloadLimit) { chunks.push({text:full,unit}); return; }
      // Base64 makes arbitrary UTF-8 byte boundaries reversible and avoids corruption.
      const buf = Buffer.from(full); const fragmentBytes = Math.floor((payloadLimit-180)*3/4); const count = Math.ceil(buf.length/fragmentBytes);
      for(let f=0;f<count;f++) chunks.push({ text:`EMAIL_NUMBER: #${String(i+1).padStart(6,"0")}\nMESSAGE_ID: ${m.id}\nFRAGMENT: ${f+1}/${count}\nENCODING: base64-utf8\n\n${buf.subarray(f*fragmentBytes,Math.min((f+1)*fragmentBytes,buf.length)).toString("base64")}\nEND_FRAGMENT\n`, unit:`${unit}@${f+1}/${count}` });
    });
    const groups: typeof chunks[] = []; let current: typeof chunks = []; let size=0;
    for(const chunk of chunks) { const n=bytes(chunk.text); if(current.length && size+n>payloadLimit){groups.push(current);current=[];size=0;} current.push(chunk);size+=n; }
    if(current.length) groups.push(current); if(!groups.length) groups.push([]);
    return groups.map((group,i) => { const manifest=`DIGEST_ID: ${digestId}\nGENERATED_AT: ${generatedAt}\nTOTAL_EMAILS: ${mails.length}\nPART_NUMBER: ${i+1}\nTOTAL_PARTS: ${groups.length}\nUNITS: ${group.map(c=>c.unit).join(", ") || "none"}\n\n`; const subject=`[AUREN MAIL RAW][${digestId}] Parte ${i+1}/${groups.length}`; return {digestId,number:i+1,total:groups.length,subject,body:manifest+group.map(c=>c.text).join("\n"),units:group.map(c=>c.unit)}; });
  }
  validate(mails: MailMessage[], parts: DigestPart[]): void {
    const selected=new Set(mails.map(m=>`${m.sourceAccount}:${m.id}`)); const represented=new Set(parts.flatMap(p=>p.units.map(u=>u.replace(/@\d+\/\d+$/, ""))));
    if(selected.size!==represented.size || [...selected].some(k=>!represented.has(k))) throw new Error("Digest integrity validation failed: selected_messages != serialized_messages");
    for(const p of parts) if(bytes(p.body)>this.maxBytes) throw new Error(`Digest part ${p.number} exceeds byte limit`);
  }
}
