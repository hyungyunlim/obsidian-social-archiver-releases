/**
 * Minimal ambient declaration for jszip used by the Instagram import engine.
 *
 * JSZip ships its own bundled `.d.ts`, but this shim provides a type-safe
 * fallback so `tsc --noEmit` succeeds even before `npm install` pulls the
 * package into node_modules. When the real package is present, its types
 * merge with (and augment) this declaration via declaration merging; if not,
 * this narrow surface is enough for the engine code.
 */

declare module 'jszip' {
  export interface JSZipObject {
    name: string;
    dir: boolean;
    date: Date;
    async(type: 'string'): Promise<string>;
    async(type: 'uint8array'): Promise<Uint8Array>;
    async(type: 'arraybuffer'): Promise<ArrayBuffer>;
    async(type: 'blob'): Promise<Blob>;
  }

  export type JSZipFileIterator = (relativePath: string, file: JSZipObject) => void;

  export default class JSZip {
    static loadAsync(data: ArrayBuffer | Uint8Array | Blob | string): Promise<JSZip>;
    file(path: string): JSZipObject | null;
    forEach(cb: JSZipFileIterator): void;
  }
}
