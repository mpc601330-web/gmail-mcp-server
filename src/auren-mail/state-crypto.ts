import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const MAGIC = Buffer.from("AURENSTATE1");
const key = (secret:string,salt:Buffer) => scryptSync(secret,salt,32);
export function encryptState(plain:Buffer, secret:string):Buffer {
  if(secret.length<32) throw new Error("State encryption key must contain at least 32 characters");
  const salt=randomBytes(16),iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key(secret,salt),iv);
  const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);return Buffer.concat([MAGIC,salt,iv,cipher.getAuthTag(),encrypted]);
}
export function decryptState(blob:Buffer, secret:string):Buffer {
  if(!blob.subarray(0,MAGIC.length).equals(MAGIC))throw new Error("Invalid encrypted state format");
  let p=MAGIC.length;const salt=blob.subarray(p,p+=16),iv=blob.subarray(p,p+=12),tag=blob.subarray(p,p+=16),data=blob.subarray(p);
  const decipher=createDecipheriv("aes-256-gcm",key(secret,salt),iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(data),decipher.final()]);
}
export function transformState(mode:"encrypt"|"decrypt",input:string,output:string,secret:string):void {
  const result=mode==="encrypt"?encryptState(readFileSync(input),secret):decryptState(readFileSync(input),secret);mkdirSync(dirname(output),{recursive:true});const tmp=`${output}.${process.pid}.tmp`;writeFileSync(tmp,result,{mode:0o600});renameSync(tmp,output);
}
if(process.argv[1]?.endsWith("state-crypto.ts")||process.argv[1]?.endsWith("state-crypto.js")){
  const [mode,input,output]=process.argv.slice(2);const secret=process.env.AUREN_STATE_ENCRYPTION_KEY;
  if((mode!=="encrypt"&&mode!=="decrypt")||!input||!output||!secret){console.error("Usage: state:crypto <encrypt|decrypt> <input> <output>; AUREN_STATE_ENCRYPTION_KEY is required");process.exitCode=2;}else{try{transformState(mode,input,output,secret);console.log(`State ${mode} completed`);}catch{console.error(`State ${mode} failed (details suppressed)`);process.exitCode=1;}}
}
