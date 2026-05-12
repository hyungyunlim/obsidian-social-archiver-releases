/**
 * Promise-based replacement for the `immediate` npm package.
 *
 * The original `immediate` polyfill ships several fallbacks for older runtimes
 * — `MessageChannel`, `MutationObserver`, dynamic `<script>` element creation,
 * etc. The script-element branch trips the Obsidian community plugin
 * "Code obfuscation" lint heuristic even though we never reach it at runtime
 * (Obsidian's Electron always has native Promise). Aliasing the package to
 * this tiny Promise-only implementation lets the bundler dead-code-eliminate
 * every other branch.
 */
const queueMicro: (cb: () => void) => void =
  typeof queueMicrotask === 'function'
    ? queueMicrotask
    : (cb) => { void Promise.resolve().then(cb); };

export default function immediate<T extends unknown[]>(
  task: (...args: T) => void,
  ...args: T
): void {
  queueMicro(() => task(...args));
}
