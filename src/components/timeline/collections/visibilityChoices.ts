import { setIcon } from 'obsidian';

/**
 * "Who can see it" as option cards — icon, name and what it means — like the
 * desktop app's VisibilityPicker. A radiogroup: arrow keys move the choice and
 * only the checked card is in the Tab order.
 */

export interface VisibilityChoice<T extends string> {
  value: T;
  label: string;
  hint: string;
  icon: string;
}

export interface VisibilityChoicesHandle<T extends string> {
  setValue(value: T): void;
  setDisabled(disabled: boolean): void;
}

export function renderVisibilityChoices<T extends string>(
  parent: HTMLElement,
  options: {
    labelledBy: string;
    choices: ReadonlyArray<VisibilityChoice<T>>;
    value: T;
    onSelect: (value: T) => void;
  },
): VisibilityChoicesHandle<T> {
  const group = parent.createDiv({ cls: 'sa-visibility-choices', attr: { role: 'radiogroup', 'aria-labelledby': options.labelledBy } });
  let current = options.value;
  let disabled = false;
  const buttons: HTMLButtonElement[] = [];

  const paint = (): void => {
    options.choices.forEach((choice, index) => {
      const button = buttons[index];
      if (!button) return;
      const checked = choice.value === current;
      button.toggleClass('is-checked', checked);
      button.setAttribute('aria-checked', String(checked));
      button.tabIndex = checked ? 0 : -1;
      button.disabled = disabled;
    });
  };

  const choose = (index: number): void => {
    const wrapped = (index + options.choices.length) % options.choices.length;
    const choice = options.choices[wrapped];
    if (!choice) return;
    buttons[wrapped]?.focus();
    if (choice.value !== current) options.onSelect(choice.value);
  };

  options.choices.forEach((choice, index) => {
    const button = group.createEl('button', { cls: 'sa-visibility-choice', attr: { type: 'button', role: 'radio' } });
    const icon = button.createSpan({ cls: 'sa-visibility-choice-icon', attr: { 'aria-hidden': 'true' } });
    setIcon(icon, choice.icon);
    const text = button.createSpan({ cls: 'sa-visibility-choice-text' });
    text.createSpan({ cls: 'sa-visibility-choice-label', text: choice.label });
    text.createSpan({ cls: 'sa-visibility-choice-hint', text: choice.hint });
    button.addEventListener('click', () => {
      if (choice.value !== current) options.onSelect(choice.value);
    });
    button.addEventListener('keydown', (event) => {
      if (disabled) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        choose(index + 1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        choose(index - 1);
      }
    });
    buttons.push(button);
  });
  paint();

  return {
    setValue(value: T): void {
      current = value;
      paint();
    },
    setDisabled(next: boolean): void {
      disabled = next;
      paint();
    },
  };
}
