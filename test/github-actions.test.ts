import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decryptState, encryptState, transformState } from "../src/auren-mail/state-crypto.js";
import { StateStore } from "../src/auren-mail/state.js";
import { TokenStore } from "../src/token-store.js";

test("encrypted operational state round-trips without plaintext leakage", () => {
  const secret="s".repeat(32),plain=Buffer.from('{"lastSuccessfulRun":"2026-08-24","private":"mail body"}');
  const encrypted=encryptState(plain,secret);
  assert.equal(encrypted.includes(Buffer.from("mail body")),false);
  assert.deepEqual(decryptState(encrypted,secret),plain);
  assert.throws(()=>decryptState(encrypted,"wrong".repeat(8)));
});

test("state transport restores a checkpoint on a fresh runner filesystem", () => {
  const dir=mkdtempSync(join(tmpdir(),"auren-gh-")),source=join(dir,"first/state.json"),cipher=join(dir,"state.enc"),restored=join(dir,"fresh/state.json"),secret="k".repeat(32);
  const store=new StateStore(source);store.save({lastSuccessfulRun:"2026-08-24T18:00:00Z",lastSuccessfulCutoffMs:123});
  transformState("encrypt",source,cipher,secret);transformState("decrypt",cipher,restored,secret);
  assert.equal(new StateStore(restored).load().lastSuccessfulCutoffMs,123);
});

test("empty filesystem is valid but malformed state refuses checkpoint reset",()=>{
  const path=join(mkdtempSync(join(tmpdir(),"auren-gh-")),"state.json"),store=new StateStore(path);
  assert.deepEqual(store.load(),{});writeFileSync(path,"not-json");assert.throws(()=>store.load(),/refusing to reset/);
});

test("TokenStore imports multiple encrypted accounts from TOKENS_DATA",()=>{
  const old={...process.env};const root=mkdtempSync(join(tmpdir(),"auren-token-"));
  try{process.env.ENCRYPTION_KEY="token-key".repeat(5);process.env.DATA_DIR=join(root,"one");delete process.env.TOKENS_DATA;const first=new TokenStore();first.addAccount("one@example.test","refresh-one");first.addAccount("two@example.test","refresh-two");const exported=first.getTokensDataForExport();process.env.DATA_DIR=join(root,"fresh");process.env.TOKENS_DATA=exported;const restored=new TokenStore();assert.deepEqual(restored.listAccounts().map(a=>a.email),["one@example.test","two@example.test"]);assert.equal(restored.getRefreshToken("two@example.test"),"refresh-two");assert.equal(exported.includes("refresh-one"),false);}finally{process.env=old;}
});

test("missing and malformed account secrets are handled safely",()=>{
  const old={...process.env};const root=mkdtempSync(join(tmpdir(),"auren-token-"));
  try{process.env.DATA_DIR=root;delete process.env.TOKENS_DATA;assert.equal(new TokenStore().size,0);process.env.TOKENS_DATA="definitely-not-credentials";assert.throws(()=>new TokenStore(),/TOKENS_DATA is malformed/);}finally{process.env=old;}
});
