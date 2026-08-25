import { GoogleMailGateway } from "./gmail-client.js"; import { CollectorRunner } from "./runner.js"; import { StateStore } from "./state.js";
const state=new StateStore(); let release:(()=>void)|undefined;
try{release=state.acquireLock();const r=await new CollectorRunner(new GoogleMailGateway(),state).run();console.log(`[auren] Run completed successfully: ${r.emails} message(s), ${r.parts} part(s)`);}catch{console.error("[auren] Run failed. Credentials and message data have been suppressed; inspect the workflow step and retry.");process.exitCode=1;}finally{release?.();}
