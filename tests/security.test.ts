import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {encrypt,decrypt,hashPassword,verifyPassword,equalSecret} from '../src/lib/crypto.ts';
import {snapshotSchema,credentialSchema} from '../src/lib/schema.ts';
test('credentials encrypt, authenticate and bind to environment',()=>{
  const key=randomBytes(32);const plain=JSON.stringify({apiKey:'test-only-value',secretKey:'secret-only-value'});
  const ciphertext=encrypt(plain,'binance:testnet',key);
  assert(!ciphertext.includes('test-only-value'));assert.equal(decrypt(ciphertext,'binance:testnet',key),plain);
  assert.throws(()=>decrypt(ciphertext,'binance:mainnet',key));assert.throws(()=>decrypt(ciphertext,'binance:testnet',randomBytes(32)));
  const parts=ciphertext.split('.');parts[3]=Buffer.from('altered').toString('base64url');assert.throws(()=>decrypt(parts.join('.'),'binance:testnet',key));
  assert.notEqual(encrypt(plain,'binance:testnet',key),ciphertext);
});
test('owner password and tokens reject mismatches',()=>{
  const hash=hashPassword('test-owner-password');assert(verifyPassword('test-owner-password',hash));assert(!verifyPassword('wrong',hash));assert(!verifyPassword('wrong','bad'));
  assert(equalSecret('token','token'));assert(!equalSecret('token','different'));assert(!equalSecret('','token'));
});
test('credentials reject unexpected properties and invalid environment',()=>{
  const sample={environment:'testnet',apiKey:'a'.repeat(64),secretKey:'b'.repeat(64)};
  assert(credentialSchema.safeParse(sample).success);assert(!credentialSchema.safeParse({...sample,url:'https://evil.test'}).success);assert(!credentialSchema.safeParse({...sample,environment:'other'}).success);
});
test('snapshot refuses arbitrary secrets and invalid measurements',()=>{
  const sample={capturedAt:new Date().toISOString(),runtime:{state:'RUNNING',updatedAt:new Date().toISOString(),dryRun:true,testnet:true,symbol:'BTCUSDT',timeframe:'15m',entryEnabled:true},balance:1000,performance:{totalTrades:0,winRate:0,netPnl:0,todayPnl:0,profitFactor:null},signal:null,position:null,history:[],trades:[]};
  assert(snapshotSchema.safeParse(sample).success);assert(!snapshotSchema.safeParse({...sample,apiKey:'secret'}).success);assert(!snapshotSchema.safeParse({...sample,balance:Infinity}).success);
});
