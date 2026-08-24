import { DigestBuilder } from "./digest.js"; import { MailGateway } from "./gmail-client.js"; import { StateStore } from "./state.js";
export class CollectorRunner {
  constructor(private gateway:MailGateway,private stateStore:StateStore,private now=()=>new Date()){}
  async run():Promise<{digestId:string;emails:number;parts:number}> {
    const state=this.stateStore.load(); const recipient=process.env.AUREN_DIGEST_RECIPIENT; const sender=process.env.AUREN_SENDER_ACCOUNT;
    if(!recipient||!sender) throw new Error("AUREN_DIGEST_RECIPIENT and AUREN_SENDER_ACCOUNT are required");
    if(state.pending){ for(const part of state.pending.parts) if(!state.pending.sentParts.includes(part.number)){ await this.gateway.send(sender,recipient,part.subject,part.body,state.pending.digestId,part.number); state.pending.sentParts.push(part.number); this.stateStore.save(state); } const r={digestId:state.pending.digestId,emails:state.pending.selectedKeys.length,parts:state.pending.parts.length}; state.lastSuccessfulRun=this.now().toISOString();state.lastSuccessfulCutoffMs=state.pending.cutoffMs;delete state.pending;this.stateStore.save(state);return r; }
    const start=this.now(); const cutoff=start.getTime(); const lookback=Number(process.env.AUREN_INITIAL_LOOKBACK_DAYS??7)*86400000; const after=state.lastSuccessfulCutoffMs??cutoff-lookback; const mails=(await Promise.all(this.gateway.accounts().map(a=>this.gateway.collect(a,after,cutoff,Number(process.env.AUREN_THREAD_MAX_MESSAGES??20))))).flat();
    const seen=new Set<string>(); const unique=mails.filter(m=>{const k=`${m.sourceAccount}:${m.id}`;if(seen.has(k))return false;seen.add(k);return true;});
    const digestId=start.toISOString().replace(/[-:]/g,"").slice(0,8)+"-"+start.toISOString().slice(11,16).replace(":",""); const builder=new DigestBuilder(Number(process.env.AUREN_MAX_PART_BYTES??18000000)); const parts=builder.build(digestId,start.toISOString(),unique);builder.validate(unique,parts);
    state.pending={digestId,startedAt:start.toISOString(),cutoffMs:cutoff,selectedKeys:unique.map(m=>`${m.sourceAccount}:${m.id}`),parts,sentParts:[]};this.stateStore.save(state);return this.run();
  }
}
