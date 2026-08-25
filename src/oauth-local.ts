import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { google } from "googleapis";
import { CodeChallengeMethod } from "google-auth-library";
import { LocalAuthorizationService, LocalOAuthProvider, OAuthTokens } from "./oauth-local-service.js";
import { TokenStore } from "./token-store.js";

if(existsSync(".env"))process.loadEnvFile(".env");

class GoogleLocalOAuthProvider implements LocalOAuthProvider {
  authorizationUrl({redirectUri,state,challenge,scopes}:{redirectUri:string;state:string;challenge:string;scopes:string[]}):string {
    return this.client(redirectUri).generateAuthUrl({access_type:"offline",prompt:"consent",scope:scopes,state,code_challenge:challenge,code_challenge_method:CodeChallengeMethod.S256});
  }
  async exchangeCode({code,redirectUri,verifier}:{code:string;redirectUri:string;verifier:string}):Promise<OAuthTokens> {
    const {tokens}=await this.client(redirectUri).getToken({code,codeVerifier:verifier,redirect_uri:redirectUri});
    return {accessToken:tokens.access_token??undefined,refreshToken:tokens.refresh_token??undefined};
  }
  async accountEmail(tokens:OAuthTokens):Promise<string> {
    const auth=this.client();auth.setCredentials({access_token:tokens.accessToken,refresh_token:tokens.refreshToken});
    const response=await google.oauth2({version:"v2",auth}).userinfo.get();return response.data.email??"";
  }
  private client(redirectUri?:string){return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET,redirectUri);}
}

async function loopback():Promise<{redirectUri:string;result:Promise<{code:string;state:string}>;close:()=>void}> {
  let resolve!:(value:{code:string;state:string})=>void,reject!:(error:Error)=>void;
  const result=new Promise<{code:string;state:string}>((ok,no)=>{resolve=ok;reject=no;});
  const server=createServer((req,res)=>{try{const url=new URL(req.url??"/","http://127.0.0.1");if(url.pathname!=="/oauth/callback"){res.writeHead(404).end();return;}const error=url.searchParams.get("error"),code=url.searchParams.get("code"),state=url.searchParams.get("state")??"";if(error||!code){res.writeHead(400,{"Content-Type":"text/plain; charset=utf-8"}).end("Autorización cancelada. Puede cerrar esta pestaña.");reject(new Error("OAuth authorization was denied"));}else{res.writeHead(200,{"Content-Type":"text/plain; charset=utf-8"}).end("Cuenta autorizada. Puede cerrar esta pestaña y volver al terminal.");resolve({code,state});}}catch{res.writeHead(400).end();reject(new Error("Invalid OAuth callback"));}});
  await new Promise<void>((resolveListen,rejectListen)=>{server.once("error",rejectListen);server.listen(0,"127.0.0.1",()=>resolveListen());});
  const address=server.address();if(!address||typeof address==="string")throw new Error("Could not start local callback");
  return {redirectUri:`http://127.0.0.1:${address.port}/oauth/callback`,result,close:()=>server.close()};
}

function requiredEnvironment():void {for(const name of ["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","ENCRYPTION_KEY"])if(!process.env[name])throw new Error(`${name} is required`);}
async function authorize():Promise<void>{requiredEnvironment();const callback=await loopback();let timeout:NodeJS.Timeout|undefined;try{const service=new LocalAuthorizationService(new GoogleLocalOAuthProvider(),new TokenStore({preferEnv:true}));const session=service.createSession(callback.redirectUri);console.log("\nAbra esta URL en el navegador de este mismo ordenador y autorice la cuenta:\n");console.log(session.url);console.log("\nEsperando el consentimiento de Google (máximo 10 minutos)...");const expired=new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error("OAuth callback timed out")),10*60_000);});const result=await Promise.race([callback.result,expired]);const completed=await service.complete(session,result);console.log("\nADVERTENCIA: el siguiente valor contiene credenciales cifradas. Cópielo directamente al GitHub Environment Secret TOKENS_DATA; no lo publique ni lo guarde en Git.\n");console.log(completed.tokensData);}finally{if(timeout)clearTimeout(timeout);callback.close();}}
function list():void{const store=new TokenStore({preferEnv:true});console.log(`Accounts configured: ${store.size}`);store.listAccounts().forEach((account,index)=>console.log(`${index+1}. ${account.email}`));}
function remove(email:string|undefined):void{if(!email)throw new Error("Usage: npm run oauth:remove -- account@example.com");const store=new TokenStore({preferEnv:true});if(!store.removeAccount(email))throw new Error("Account not found");console.log("\nCopy the updated encrypted value directly to GitHub Secret TOKENS_DATA:\n");console.log(store.getTokensDataForExport());}
const command=process.argv[2]??"authorize";try{if(command==="authorize")await authorize();else if(command==="list")list();else if(command==="remove")remove(process.argv[3]);else throw new Error("Unknown OAuth command");}catch{console.error("OAuth operation failed. Sensitive error details were suppressed; verify configuration, consent, and try again.");process.exitCode=1;}
