import { closeSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"; import { dirname } from "node:path";
import { CollectorState } from "./types.js";
export class StateStore {
  constructor(public path=`${process.env.AUREN_STATE_DIR ?? "./data/auren"}/state.json`) {}
  load(): CollectorState { try{return JSON.parse(readFileSync(this.path,"utf8"));}catch{return {};} }
  save(state: CollectorState): void { mkdirSync(dirname(this.path),{recursive:true}); const tmp=`${this.path}.${process.pid}.tmp`; writeFileSync(tmp,JSON.stringify(state,null,2),{mode:0o600}); renameSync(tmp,this.path); }
  acquireLock(): () => void { mkdirSync(dirname(this.path),{recursive:true}); const lock=`${this.path}.lock`; let fd:number; try{fd=openSync(lock,"wx",0o600);}catch{throw new Error("Another Auren Mail run is active (state lock exists)");} writeFileSync(fd,`${process.pid}\n`);return()=>{closeSync(fd);try{unlinkSync(lock);}catch{}}; }
}
