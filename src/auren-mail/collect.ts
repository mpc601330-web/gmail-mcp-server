import { GoogleMailGateway } from "./gmail-client.js"; import { CollectorRunner } from "./runner.js"; import { StateStore } from "./state.js";
const state=new StateStore(); let release:(()=>void)|undefined;
try{release=state.acquireLock();const r=await new CollectorRunner(new GoogleMailGateway(),state).run();console.log(`[auren] Digest ${r.digestId}: ${r.emails} emails in ${r.parts} parts`);}catch(e){console.error(`[auren] Run failed: ${e instanceof Error?e.message:"unknown error"}`);process.exitCode=1;}finally{release?.();}
