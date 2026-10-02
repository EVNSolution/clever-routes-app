import type { DriverAccessRestoreResult, DriverAccessTokenStore } from '../domain/driver/driverAccessTokenStore';

/** Observe completed account-store operations without adding awaits to authentication. */
export function observeDriverAccessStore(store: DriverAccessTokenStore, observer: {
  changed(access:DriverAccessRestoreResult):void;
  cleared(cause: 'account_replacement' | 'store_clear'):void;
}):DriverAccessTokenStore {
  let generation=0;
  const notify=(access:DriverAccessRestoreResult)=>{try{observer.changed(access);}catch{/* diagnostic sink is isolated */}};
  function after<T>(result:Promise<T>):Promise<T> {
    const expected=generation;
    return result.then(value=>{if(expected===generation) void store.loadActiveDriverAccess().then(access=>{if(expected===generation) notify(access);}).catch(()=>undefined);return value;});
  }
  return {
    ...store,
    clear:(expectedIdentity)=>{
      const expected=++generation;
      if(expectedIdentity===undefined) {
        try{observer.cleared('store_clear');}catch{/* diagnostic sink is isolated */}
        return store.clear();
      }
      return store.clear(expectedIdentity).then(()=>{
        if(expected===generation) {
          try{observer.cleared('store_clear');}catch{/* diagnostic sink is isolated */}
        }
      });
    },
    loadActiveDriverAccess:()=>{const expected=generation;return store.loadActiveDriverAccess().then(access=>{if(expected===generation) notify(access);return access;});},
    clearActiveRouteSession:(...args)=>after(store.clearActiveRouteSession(...args)),
    clearCachedRouteAccess:(...args)=>after(store.clearCachedRouteAccess(...args)),
    markActiveRouteStarted:(...args)=>after(store.markActiveRouteStarted(...args)),
    markActiveRouteCompletionPending:(...args)=>after(store.markActiveRouteCompletionPending(...args)),
    saveActiveRouteSession:(...args)=>after(store.saveActiveRouteSession(...args)),
    saveAuthenticatedDriver:(input)=>{
      const expected=++generation;
      return store.saveAuthenticatedDriver(input).then(()=>{
        if(expected===generation) {
          try{observer.cleared('account_replacement');}catch{/* diagnostic sink is isolated */}
          notify({kind:'active',accountAccess:input.accountAccess,driverProfile:{phoneE164:input.phoneE164}});
        }
      });
    },
    saveFromInvitedRouteAccess:(...args)=>after(store.saveFromInvitedRouteAccess(...args)),
    saveRefreshedAccountAccess:(...args)=>after(store.saveRefreshedAccountAccess(...args)),
  };
}
