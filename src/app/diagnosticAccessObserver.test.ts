import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createDriverAccessTokenStore} from '../domain/driver/driverAccessTokenStore';
import {observeDriverAccessStore} from './diagnosticAccessObserver';

test('a failed diagnostic observer cannot break token reads or logout',async()=>{
 const values=new Map<string,string>();
 const store=createDriverAccessTokenStore({storage:{getItemAsync:async k=>values.get(k)??null,setItemAsync:async(k,v)=>{values.set(k,v);},deleteItemAsync:async k=>{values.delete(k);}}});
 const observed=observeDriverAccessStore(store,{changed:()=>{throw new Error('sink');},cleared:()=>{throw new Error('sink');}});
 assert.equal((await observed.loadActiveDriverAccess()).kind,'missing');
 await observed.clear();
});
test('post-write diagnostics do not await a stalled read',async()=>{
 const base=createDriverAccessTokenStore({storage:{getItemAsync:async()=>null,setItemAsync:async()=>undefined,deleteItemAsync:async()=>undefined}});
 base.loadActiveDriverAccess=()=>new Promise(()=>undefined);
 base.saveRefreshedAccountAccess=async()=>undefined;
 const observed=observeDriverAccessStore(base,{changed:()=>undefined,cleared:()=>undefined});
 await observed.saveRefreshedAccountAccess({} as never);
});
test('a read started before logout cannot resurrect the previous diagnostic account',async()=>{
 let resolveRead!:(value:{kind:'missing'})=>void;
 const base=createDriverAccessTokenStore({storage:{getItemAsync:async()=>null,setItemAsync:async()=>undefined,deleteItemAsync:async()=>undefined}});
 base.loadActiveDriverAccess=()=>new Promise(resolve=>{resolveRead=resolve;});
 let notifications=0;
 const observed=observeDriverAccessStore(base,{changed:()=>{notifications++;},cleared:()=>undefined});
 const old=observed.loadActiveDriverAccess();
 await observed.clear();
 resolveRead({kind:'missing'});await old;
 assert.equal(notifications,0);
});
test('new login is observable before caller continues even when post-save reads hang',async()=>{
 const base=createDriverAccessTokenStore({storage:{getItemAsync:async()=>null,setItemAsync:async()=>undefined,deleteItemAsync:async()=>undefined}});
 base.saveAuthenticatedDriver=async()=>undefined;
 base.loadActiveDriverAccess=()=>new Promise(()=>undefined);
 let kind:string|undefined;
 const observed=observeDriverAccessStore(base,{changed:access=>{kind=access.kind;},cleared:()=>undefined});
 await observed.saveAuthenticatedDriver({accountAccess:{} as never,phoneE164:'+10000000000'});
 assert.equal(kind,'active');
});
test('failed account replacement does not clear or change diagnostics',async()=>{
 const base=createDriverAccessTokenStore({storage:{getItemAsync:async()=>null,setItemAsync:async()=>undefined,deleteItemAsync:async()=>undefined}});
 base.saveAuthenticatedDriver=async()=>{throw new Error('save failed');};
 const events:string[]=[];
 const observed=observeDriverAccessStore(base,{changed:()=>{events.push('changed');},cleared:()=>{events.push('cleared');}});
 await assert.rejects(observed.saveAuthenticatedDriver({accountAccess:{} as never,phoneE164:'+10000000000'}),/save failed/);
 assert.deepEqual(events,[]);
});
test('unguarded clear marks diagnostics blocked before a durable clear failure settles',async()=>{
 const base=createDriverAccessTokenStore({storage:{getItemAsync:async()=>null,setItemAsync:async()=>undefined,deleteItemAsync:async()=>{throw new Error('clear failed');}}});
 const events:string[]=[];
 const observed=observeDriverAccessStore(base,{changed:()=>{events.push('changed');},cleared:()=>{events.push('cleared');}});
 await assert.rejects(observed.clear(),/clear failed/);
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(events,['cleared']);
});
test('distinguishes automatic token clear from account replacement',async()=>{
 const base=createDriverAccessTokenStore({storage:{getItemAsync:async()=>null,setItemAsync:async()=>undefined,deleteItemAsync:async()=>undefined}});
 const causes:string[]=[];
 const observed=observeDriverAccessStore(base,{changed:()=>undefined,cleared:cause=>{causes.push(cause);}});
 await observed.clear();
 await observed.saveAuthenticatedDriver({accountAccess:{} as never,phoneE164:'+10000000000'});
 assert.deepEqual(causes,['store_clear','account_replacement']);
});

test('forwards conditional mutation identities and does not notify on rejected stale mutations',async()=>{
 const base=createDriverAccessTokenStore({storage:{getItemAsync:async()=>null,setItemAsync:async()=>undefined,deleteItemAsync:async()=>undefined}});
 const expected={accessToken:'expected-access',phoneE164:'+14165550100',refreshToken:'expected-refresh'};
 const forwarded:{clear?:unknown;refresh?:unknown}={};
 base.clear=async input=>{forwarded.clear=input;throw new Error('stale clear');};
 base.saveRefreshedAccountAccess=async(_access,input)=>{forwarded.refresh=input;throw new Error('stale refresh');};
 let changed=0;
 let cleared=0;
 const observed=observeDriverAccessStore(base,{changed:()=>{changed++;},cleared:()=>{cleared++;}});

 await assert.rejects(observed.saveRefreshedAccountAccess({} as never,expected),/stale refresh/);
 await assert.rejects(observed.clear(expected),/stale clear/);
 assert.deepEqual(forwarded,{clear:expected,refresh:expected});
 assert.equal(changed,0);
 assert.equal(cleared,0);
});

test('notifies only after matched conditional save and clear complete',async()=>{
 const base=createDriverAccessTokenStore({storage:{getItemAsync:async()=>null,setItemAsync:async()=>undefined,deleteItemAsync:async()=>undefined}});
 const expected={accessToken:'expected-access',phoneE164:'+14165550100',refreshToken:'expected-refresh'};
 base.saveRefreshedAccountAccess=async()=>undefined;
 let resolveClear!:()=>void;
 base.clear=()=>new Promise(resolve=>{resolveClear=resolve;});
 const events:string[]=[];
 const observed=observeDriverAccessStore(base,{changed:()=>{events.push('changed');},cleared:()=>{events.push('cleared');}});

 await observed.saveRefreshedAccountAccess({} as never,expected);
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(events,['changed']);
 const clearing=observed.clear(expected);
 assert.deepEqual(events,['changed']);
 resolveClear();
 await clearing;
 assert.deepEqual(events,['changed','cleared']);
});
