type ImmediateHandle = number;
type ImmediateCallback = (...args: unknown[]) => void;
type ImmediateHost = {
  setImmediate?: (handler: ImmediateCallback, ...args: unknown[]) => ImmediateHandle;
  clearImmediate?: (handle: ImmediateHandle) => void;
};

const host = globalThis as unknown as ImmediateHost;
const scheduled = new Map<ImmediateHandle, number>();
let nextHandle = 1;

if (typeof host.setImmediate !== 'function') {
  host.setImmediate = (handler: ImmediateCallback, ...args: unknown[]): ImmediateHandle => {
    if (typeof handler !== 'function') {
      throw new TypeError('setImmediate handler must be a function');
    }

    const handle = nextHandle++;
    const timeout = window.setTimeout((): void => {
      scheduled.delete(handle);
      handler(...args);
    }, 0);
    scheduled.set(handle, timeout);
    return handle;
  };
}

if (typeof host.clearImmediate !== 'function') {
  host.clearImmediate = (handle: ImmediateHandle): void => {
    const timeout = scheduled.get(handle);
    if (typeof timeout === 'number') {
      window.clearTimeout(timeout);
      scheduled.delete(handle);
    }
  };
}

export {};
