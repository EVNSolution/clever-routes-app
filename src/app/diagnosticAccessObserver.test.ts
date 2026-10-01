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
test('failed clear re-observes the retained account without hiding the business failure',async()=>{
 const base=createDriverAccessTokenStore({storage:{getItemAsync:async()=>null,setItemAsync:async()=>undefined,deleteItemAsync:async()=>{throw new Error('clear failed');}}});
 let notified=0;
 const observed=observeDriverAccessStore(base,{changed:()=>{notified++;},cleared:()=>undefined});
 await assert.rejects(observed.clear(),/clear failed/);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(notified,1);
});
