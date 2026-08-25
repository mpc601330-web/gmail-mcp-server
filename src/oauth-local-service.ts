import { createHash, randomBytes } from "node:crypto";

export const LOCAL_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
];

export interface OAuthSession { url:string; state:string; verifier:string; redirectUri:string }
export interface OAuthTokens { accessToken?:string; refreshToken?:string }
export interface LocalOAuthProvider {
  authorizationUrl(input:{redirectUri:string;state:string;challenge:string;scopes:string[]}):string;
  exchangeCode(input:{code:string;redirectUri:string;verifier:string}):Promise<OAuthTokens>;
  accountEmail(tokens:OAuthTokens):Promise<string>;
}
export interface TokenRepository { addAccount(email:string,refreshToken:string):void; getTokensDataForExport():string; readonly size:number }

export class LocalAuthorizationService {
  constructor(private provider:LocalOAuthProvider,private store:TokenRepository,private log:(line:string)=>void=console.log) {}
  createSession(redirectUri:string):OAuthSession {
    const verifier=randomBytes(48).toString("base64url"),state=randomBytes(24).toString("base64url");
    const challenge=createHash("sha256").update(verifier).digest("base64url");
    return {redirectUri,verifier,state,url:this.provider.authorizationUrl({redirectUri,state,challenge,scopes:LOCAL_OAUTH_SCOPES})};
  }
  async complete(session:OAuthSession,result:{code:string;state:string}):Promise<{email:string;tokensData:string}> {
    if(!result.code||result.state!==session.state)throw new Error("OAuth callback state is invalid");
    const tokens=await this.provider.exchangeCode({code:result.code,redirectUri:session.redirectUri,verifier:session.verifier});
    if(!tokens.refreshToken)throw new Error("Google did not return a refresh token; revoke prior consent and retry");
    const email=await this.provider.accountEmail(tokens);if(!email)throw new Error("Google did not return an account email");
    this.store.addAccount(email,tokens.refreshToken);this.log(`Authorization completed; ${this.store.size} account(s) configured`);
    return {email,tokensData:this.store.getTokensDataForExport()};
  }
}
