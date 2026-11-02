import { requireApiVersion, type ButtonComponent } from 'obsidian';

/**
 * Style a button as destructive on every supported Obsidian version.
 *
 * `setWarning()` is deprecated since 1.13 and `setDestructive()` does not exist
 * before it (minAppVersion is 1.10.0). 1.13+ implements `setWarning()` as
 * `setDestructive().setCta()`; older versions add `mod-warning`. Doing the same
 * here keeps every button looking exactly as it did.
 */
export function setDestructive(button: ButtonComponent): ButtonComponent {
  if (requireApiVersion('1.13.0')) return button.setDestructive().setCta();
  button.buttonEl.addClass('mod-warning');
  return button;
}
