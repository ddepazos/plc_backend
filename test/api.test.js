import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server.js';
import { config, root } from '../config.js';
import { createStore } from '../services/store.js';

async function fixture(t) {
 const dir = await mkdtemp(path.join(os.tmpdir(), 'plc-test-'));
 const settings = { ...config(), port:0, storeFile:path.join(dir,'demo.json') };
 const server = await createApp(settings);
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dir,{recursive:true,force:true}); });
 const base = `http://127.0.0.1:${server.address().port}`;
 const get = async route => { const response = await fetch(base+route); return {status:response.status,body:await response.json()}; };
 const post = async (route,body,key=randomUUID(),headers={}) => {const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key,...headers},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 return {base,get,post,settings};
}
test('operaciones, detalle, idempotencia y persistencia',async t=>{
 const {get,post,settings}=await fixture(t);
 assert.equal((await get('/api/wallet')).body.balance,2450);
 const key=randomUUID();
 const sent=await post('/api/send',{amount:'25.10',recipient:'PLC-DEMO-DESTINO',note:'Ensayo'},key);
 assert.equal(sent.status,200);
 assert.equal((await post('/api/send',{amount:'25.10',recipient:'PLC-DEMO-DESTINO',note:'Ensayo'},key)).body.replayed,true);
 assert.equal((await post('/api/send',{amount:'26',recipient:'PLC-DEMO-DESTINO'},key)).status,409);
 assert.equal((await get('/api/transactions/'+sent.body.transaction.id)).body.note,'Ensayo');
 await post('/api/receive',{amount:'10.20'});
 await post('/api/topups',{amount:'100',method:'bank'});
 await post('/api/topups',{amount:'20',method:'ethereum'});
 assert.equal((await get('/api/wallet')).body.balance,2555.1);
 const reopened=await createStore(settings);
 assert.equal(reopened.read().user.balanceCents,255510);
 assert.equal(reopened.read().transactions.length,8);
 assert.equal((await get('/api/transactions/missing')).status,404);
});
test('rechaza montos, credenciales, métodos y sobregiros sin mutar saldo',async t=>{
 const {get,post}=await fixture(t);
 for(const amount of [0,-1,'0.001','1e3','abc',true,null,1000001]) assert.equal((await post('/api/receive',{amount})).status,400);
 assert.equal((await post('/api/send',{amount:2451,recipient:'PLC-DEMO-DESTINO'})).status,409);
 assert.equal((await post('/api/send',{amount:10,recipient:'real@example.com'})).status,400);
 assert.equal((await post('/api/send',{amount:10,recipient:'PLC-DEMO-7A21-F9C4-2B83'})).status,400);
 assert.equal((await post('/api/topups',{amount:10,method:'card'})).status,400);
 assert.equal((await post('/api/topups',{amount:10,method:'bank',password:'fake'})).status,400);
 assert.equal((await post('/api/receive',{amount:10},'')).status,400);
 assert.equal((await get('/api/wallet')).body.balance,2450);
});
test('concurrencia no pierde actualizaciones ni permite sobregiro',async t=>{
 const {get,post}=await fixture(t);
 const results=await Promise.all([1,2,3].map(()=>post('/api/send',{amount:1000,recipient:'PLC-DEMO-DESTINO'})));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,200,409]);
 assert.equal((await get('/api/wallet')).body.balance,450);
 const key=randomUUID();
 await Promise.all([1,2,3].map(()=>post('/api/receive',{amount:'0.01'},key)));
 assert.equal((await get('/api/wallet')).body.balance,450.01);
});
test('seguridad HTTP, archivos privados y JSON inválido',async t=>{
 const {base,get,post}=await fixture(t);
 for(const route of ['/backend/storage/demo.json','/.git/config','/package.json','/pages/missing.html']) assert.equal((await get(route)).status,404);
 assert.equal((await post('/api/receive',{amount:1},randomUUID(),{Origin:'https://example.com'})).status,403);
 assert.equal((await post('/api/receive',{amount:1},randomUUID(),{'Content-Type':'text/plain'})).status,415);
 const malformed=await fetch(base+'/api/receive',{method:'POST',headers:{'Content-Type':'application/json'},body:'{broken'});
 assert.equal(malformed.status,400);
 const large=await post('/api/receive',{amount:1,note:'x'.repeat(9000)});assert.equal(large.status,413);
 const html=await fetch(base+'/pages/wallet.html');assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});
test('archivo dañado no se reemplaza por seed',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'plc-corrupt-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'demo.json');await writeFile(file,'broken');
 await assert.rejects(createStore({...config(),storeFile:file}));assert.equal(await readFile(file,'utf8'),'broken');
});
test('rutas locales HTML, CSS, JS y enlaces con ancla existen',async()=>{
 const {readdir}=await import('node:fs/promises');
 const files=['index.html',...(await readdir(path.join(root,'pages'))).map(f=>'pages/'+f)];
 for(const file of files){
 const html=await readFile(path.join(root,file),'utf8');
 assert.ok(!html.includes('jquery'));
 for(const match of html.matchAll(/(?:href|src)="([^\"]+)"/g)){
 const value=match[1];if(/^(https?:|mailto:)/.test(value))continue;
 const [rel,hash]=value.split('#');const clean=rel.split('?')[0];const target=clean?path.resolve(root,path.dirname(file),clean):path.resolve(root,file);
 const content=await readFile(target,'utf8');
 if(hash)assert.ok(content.includes(`id="${hash}"`),`${file}: ancla ${value}`);
 }
 }
});
