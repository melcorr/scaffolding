export const GLOBAL_NAMESPACE = '__scalprum__';
export interface AppMetadata {
  name: string;
  appId?: string;
  elementId?: string;
  rootLocation?: string;
  scriptLocation?: string;
  manifestLocation?: string;
}
export interface AppsConfig {
  [key: string]: AppMetadata;
}

export interface Factory {
  init: (sharing: any) => void;
  modules: {
    [key: string]: {
      default: any;
      prefetch?: (scalprumApi: Scalprum) => Promise<unknown>;
    };
  };
  expiration: Date;
}

export interface ScalprumOptions {
  cacheTimeout: number;
}

export type Scalprum<T = any> = T & {
  appsConfig: AppsConfig;
  pendingInjections: {
    [key: string]: () => void;
  };
  pendingLoading: {
    [key: string]: Promise<IModule>;
  };
  pendingPrefetch: {
    [key: string]: Promise<unknown>;
  };
  factories: {
    [key: string]: Factory;
  };
  scalprumOptions: ScalprumOptions;
};

export type Container = Window & Factory;

export interface IModule {
  default: any;
  prefetch?: Promise<any>;
}

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    [GLOBAL_NAMESPACE]: Scalprum;
  }
}

declare function __webpack_init_sharing__(scope: string): void;
declare let __webpack_share_scopes__: any;

export const handlePrefetchPromise = (id: string, prefetch: any) => {
  setPendingPrefetch(id, prefetch);
  prefetch.finally(() => {
    removePrefetch(id);
  });
};

export const getScalprum = <T = Record<string, unknown>>(): Scalprum<T> => window[GLOBAL_NAMESPACE];
export const getCachedModule = (scope: string, module: string, skipCache = false): any | undefined => {
  try {
    const factory: Factory = window[GLOBAL_NAMESPACE].factories[scope];
    if (!factory || !factory.expiration) {
      return {};
    }
    /**
     * Invalidate module after 2 minutes
     */
    const isExpired =
      skipCache || (new Date().getTime() - factory.expiration.getTime()) / 1000 > window[GLOBAL_NAMESPACE].scalprumOptions.cacheTimeout;
    if (isExpired) {
      delete window[GLOBAL_NAMESPACE].factories[scope];
      return {};
    }

    const cachedModule = factory.modules[module];
    if (!module) {
      return {};
    }

    const prefetchID = `${scope}#${module}`;
    const prefetchPromise = getPendingPrefetch(prefetchID);
    if (prefetchPromise) {
      return { cachedModule, prefetchPromise };
    }
    if (cachedModule?.prefetch) {
      handlePrefetchPromise(prefetchID, cachedModule.prefetch(getScalprum()));
      return { cachedModule, prefetchPromise: getPendingPrefetch(prefetchID) };
    }
    return { cachedModule };
  } catch (error) {
    // If something goes wrong during the cache retrieval, reload module.
    console.warn(`Unable to retrieve cached module ${scope} ${module}. New module will be loaded.`, error);
    return {};
  }
};

export const setPendingInjection = (id: string, injectionLock: Promise<any>): void => {
  window[GLOBAL_NAMESPACE].pendingInjections[id] = injectionLock;
};

export const getPendingInjection = (id: string): Promise<any> | undefined => {
  return window[GLOBAL_NAMESPACE].pendingInjections[id];
};

export const setPendingPrefetch = (id: string, prefetch: Promise<any>): void => {
  window[GLOBAL_NAMESPACE].pendingPrefetch[id] = prefetch;
};

export const getPendingPrefetch = (id: string): Promise<any> | undefined => {
  return window[GLOBAL_NAMESPACE].pendingPrefetch?.[id];
};

export const removePrefetch = (id: string) => {
  delete window[GLOBAL_NAMESPACE].pendingPrefetch[id];
};

export const resolvePendingInjection = (id: string) => {
  delete window[GLOBAL_NAMESPACE].pendingInjections[id];
};

export const setPendingLoading = (scope: string, module: string, promise: Promise<any>): Promise<any> => {
  window[GLOBAL_NAMESPACE].pendingLoading[`${scope}#${module}`] = promise;
  promise
    .then((data) => {
      delete window[GLOBAL_NAMESPACE].pendingLoading[`${scope}#${module}`];
      return data;
    })
    .catch(() => {
      delete window[GLOBAL_NAMESPACE].pendingLoading[`${scope}#${module}`];
    });
  return promise;
};

export const getPendingLoading = (scope: string, module: string): Promise<any> | undefined => {
  return window[GLOBAL_NAMESPACE].pendingLoading[`${scope}#${module}`];
};

export const preloadModule = async (scope: string, module: string, processor?: (item: any) => string, skipCache = false) => {
  const { manifestLocation } = getAppData(scope);
  const cachedModule = getCachedModule(scope, module, skipCache);
  let modulePromise = getPendingLoading(scope, module);

  // lock preloading if module exists or is already being loaded
  if (!modulePromise && Object.keys(cachedModule || {}).length == 0 && manifestLocation) {
    modulePromise = processManifest(manifestLocation, scope, processor).then(() => asyncLoader(scope, module));
  }

  // add scalprum API later
  const prefetchID = `${scope}#${module}`;

  if (!getPendingPrefetch(prefetchID) && cachedModule?.prefetch) {
    handlePrefetchPromise(prefetchID, cachedModule.prefetch(getScalprum()));
  }

  return setPendingLoading(scope, module, Promise.resolve(modulePromise));
};

export const initialize = <T = unknown>({
  appsConfig,
  api,
  options,
}: {
  appsConfig: AppsConfig;
  api?: T;
  options?: Partial<ScalprumOptions>;
}): void => {
  const defaultOptions: ScalprumOptions = {
    cacheTimeout: 120,
    ...options,
  };
  window[GLOBAL_NAMESPACE] = {
    appsConfig,
    pendingInjections: {},
    pendingLoading: {},
    pendingPrefetch: {},
    factories: {},
    scalprumOptions: defaultOptions,
    ...api,
  };
};

export const getAppData = (name: string): AppMetadata => window[GLOBAL_NAMESPACE].appsConfig[name];

const shouldInjectScript = (src: string) => document.querySelectorAll(`script[src="${src}"]`)?.length === 0;

export const injectScript = (appName: string, scriptLocation: string): Promise<[any, HTMLScriptElement | undefined]> => {
  let s: HTMLScriptElement | undefined = undefined;
  if (!shouldInjectScript(scriptLocation)) {
    return Promise.resolve([appName, document.querySelectorAll(`script[src="${scriptLocation}"]`)?.[0] as HTMLScriptElement]);
  }
  const injectionPromise: Promise<[any, HTMLScriptElement | undefined]> = new Promise((res, rej) => {
    s = document.createElement('script');
    s.src = scriptLocation;
    s.id = `container_entry_${appName}`;
    s.onload = () => {
      res([appName, s]);
    };
    s.onerror = (...args) => {
      rej([args, s]);
    };
  });
  if (typeof s !== 'undefined') {
    document.body.appendChild(s);
  }

  return injectionPromise;
};

export async function processManifest(
  url: string,
  appName: string,
  scope: string,
  processor: ((value: any) => string) | undefined
): Promise<[unknown, HTMLScriptElement | undefined][]> {
  const headers = new Headers();
  headers.append('Pragma', 'no-cache');
  headers.append('Cache-Control', 'no-cache');
  headers.append('expires', '0');
  const manifest = await (
    await fetch(url, {
      method: 'GET',
      headers,
    })
  ).json();
  const pendingInjection = getPendingInjection(scope);
  if (pendingInjection) {
    return pendingInjection;
  }

  const injectionPromise = Promise.all(
    Object.entries(manifest)
      .filter(([key]) => (scope ? key === scope : true))
      .flatMap(processor || ((value: any) => (value[1] as { entry: string }).entry || value))
      .map(async (scriptLocation: string) => {
        const data = await injectScript(appName, scriptLocation);
        resolvePendingInjection(scope);
        return data;
      })
  );
  setPendingInjection(scope, injectionPromise);
  injectionPromise.then((res) => {
    resolvePendingInjection(scope);
    return res;
  });
  return injectionPromise;
}

export async function asyncLoader(scope: string, module: string): Promise<IModule> {
  if (typeof scope === 'undefined' || scope.length === 0) {
    throw new Error("Scope can't be undefined or empty");
  }
  if (typeof module === 'undefined' || module.length === 0) {
    throw new Error("Module can't be undefined or empty");
  }

  if (!module.startsWith('./')) {
    console.warn(`Your module ${module} doesn't start with './' this indicates an error`);
  }

  await __webpack_init_sharing__('default');
  const container: Container = (window as { [key: string]: any })[scope];
  await container.init(__webpack_share_scopes__.default);
  const factory = await (window as { [key: string]: any })[scope].get(module);

  if (!window[GLOBAL_NAMESPACE].factories[scope]) {
    window[GLOBAL_NAMESPACE].factories[scope] = {};
  }

  const moduleFactory = factory();
  const factoryCache: Factory = {
    init: container.init,
    modules: {
      ...window[GLOBAL_NAMESPACE].factories[scope].modules,
      [module]: {
        ...moduleFactory,
      },
    },
    expiration: new Date(),
  };

  window[GLOBAL_NAMESPACE].factories[scope] = factoryCache;
  return factory();
}
