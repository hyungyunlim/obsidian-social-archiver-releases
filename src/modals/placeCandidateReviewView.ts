import type { ArchiveLocation, PlaceCandidate } from '../services/WorkersAPIClient';
import {
  canAttachCandidateDirectly,
  placeCandidateRoleLabel,
  type CandidateCorrection,
} from './placeCandidateReviewModel';

export type CandidateReviewViewState = {
  readonly candidates: readonly PlaceCandidate[];
  readonly currentLocations: readonly ArchiveLocation[];
  readonly selected: ReadonlySet<string>;
  readonly corrections: ReadonlyMap<string, CandidateCorrection>;
  readonly editingCandidateId: string | null;
  readonly busy: boolean;
  readonly liveMessage: string;
  /** Whether the "Find … places with AI" CTA is offered (an extractor is wired). */
  readonly extractAvailable: boolean;
  /** Capacity reached — the CTA renders disabled with a hint (§7.1). */
  readonly extractDisabled: boolean;
  /** Extraction in flight — the CTA shows a spinner label. */
  readonly extracting: boolean;
};

export type CandidateReviewViewCallbacks = {
  readonly onToggle: (candidateId: string, checked: boolean) => void;
  readonly onEdit: (candidateId: string) => void;
  readonly onSave: (candidateId: string, name: string, addressText: string) => void;
  readonly onPicker: (
    candidate: PlaceCandidate,
    initialView: 'search' | 'existing',
    button: HTMLButtonElement,
  ) => void;
  readonly onDismiss: (candidateId: string) => void;
  readonly onAddSelected: () => void;
  readonly onDismissAll: () => void;
  readonly onExtract: () => void;
  readonly onClose: () => void;
};

export function renderCandidateReviewView(
  root: HTMLElement,
  state: CandidateReviewViewState,
  callbacks: CandidateReviewViewCallbacks,
): void {
  root.empty();
  root.createEl('h3', { text: 'Places in this post' });
  root.createEl('p', {
    cls: 'sa-place-candidate-intro',
    text: 'Review each detected place independently. Direct additions are applied together.',
  });
  const primary = state.currentLocations.find((location) => location.isPrimary);
  if (primary) {
    root.createEl('p', {
      cls: 'sa-place-candidate-current',
      text: `Current primary: ${primary.name}. New places are added without replacing it.`,
    });
  }
  const live = root.createDiv({ cls: 'sa-place-candidate-live' });
  live.setAttribute('aria-live', 'polite');
  live.setText(state.liveMessage);
  if (state.candidates.length === 0) {
    renderEmpty(root, state, callbacks);
    return;
  }
  const list = root.createDiv({ cls: 'sa-place-candidate-list' });
  list.setAttribute('role', 'list');
  for (const candidate of state.candidates) renderCandidate(list, candidate, state, callbacks);
  renderFooter(root, state, callbacks);
  if (state.busy) {
    // Any in-flight op (attach/dismiss/extract) locks the whole modal. The
    // extract CTA keeps its own spinner label + is-loading class from
    // renderExtractCta, so a disabled CTA still reads as progress.
    root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')
      .forEach((control) => { control.disabled = true; });
  }
}

/**
 * "Find (more) places with AI" CTA. Shared by the footer and the empty state.
 * Disabled (with a hint) at capacity; shows a spinner label while extracting.
 */
function renderExtractCta(
  parent: HTMLElement,
  state: CandidateReviewViewState,
  callbacks: CandidateReviewViewCallbacks,
  idleLabel: string,
): void {
  if (!state.extractAvailable) return;
  const button = parent.createEl('button', {
    cls: 'sa-place-candidate-extract',
    text: state.extracting ? 'Analyzing for places…' : idleLabel,
  });
  button.dataset.extractCta = 'true';
  if (state.extracting) button.addClass('is-loading');
  if (state.extractDisabled && !state.extracting) {
    button.disabled = true;
    button.setAttribute('title', 'Review pending suggestions first');
    button.setAttribute('aria-label', 'Review pending suggestions first');
  } else {
    button.disabled = state.extracting;
  }
  button.addEventListener('click', () => callbacks.onExtract());
}

function renderCandidate(
  parent: HTMLElement,
  candidate: PlaceCandidate,
  state: CandidateReviewViewState,
  callbacks: CandidateReviewViewCallbacks,
): void {
  const correction = state.corrections.get(candidate.id);
  const direct = canAttachCandidateDirectly(candidate, correction);
  const card = parent.createDiv({ cls: 'sa-place-candidate-card' });
  card.setAttribute('role', 'listitem');
  card.dataset.candidateId = candidate.id;
  card.toggleClass('is-selected', state.selected.has(candidate.id));
  const header = card.createDiv({ cls: 'sa-place-candidate-header' });
  if (direct) {
    const selectTarget = header.createEl('label', { cls: 'sa-place-candidate-select' });
    const select = selectTarget.createEl('input', { type: 'checkbox' });
    select.dataset.selectCandidate = candidate.id;
    select.checked = state.selected.has(candidate.id);
    select.setAttribute('aria-label', `Select ${candidate.name ?? candidate.addressText ?? 'place'}`);
    select.addEventListener('change', () => callbacks.onToggle(candidate.id, select.checked));
  }
  const title = header.createDiv({ cls: 'sa-place-candidate-title' });
  title.createEl('strong', { text: correction?.name || candidate.name || 'Detected place' });
  const roleLabel = placeCandidateRoleLabel(candidate.role);
  if (roleLabel) {
    title.createSpan({ cls: 'sa-place-candidate-role', text: roleLabel });
  }
  title.createSpan({
    cls: 'sa-place-candidate-confidence', text: candidate.confidenceBucket ?? 'unrated',
  });
  const address = correction?.addressText || candidate.addressText;
  if (address) card.createEl('p', { cls: 'sa-place-candidate-address', text: address });
  if (candidate.evidenceText) {
    const evidence = candidate.evidenceText.length > 240
      ? `${candidate.evidenceText.slice(0, 240)}…`
      : candidate.evidenceText;
    card.createEl('p', {
      cls: 'sa-place-candidate-evidence', text: `${candidate.evidenceType}: ${evidence}`,
    });
  }
  card.createEl('p', {
    cls: 'sa-place-candidate-meta',
    text: [
      candidate.externalSource,
      candidate.confidenceBucket ? `${candidate.confidenceBucket} confidence` : null,
      direct ? 'Direct addition available' : 'Exact place required',
    ].filter((value): value is string => Boolean(value)).join(' · '),
  });
  if (state.editingCandidateId === candidate.id) {
    renderCorrection(card, candidate, correction, callbacks);
  }
  renderActions(card, candidate, callbacks);
}

function renderCorrection(
  parent: HTMLElement,
  candidate: PlaceCandidate,
  correction: CandidateCorrection | undefined,
  callbacks: CandidateReviewViewCallbacks,
): void {
  const form = parent.createDiv({ cls: 'sa-place-candidate-correction' });
  const name = form.createEl('input', {
    type: 'text', value: correction?.name ?? candidate.name ?? '',
  });
  name.dataset.correctionName = candidate.id;
  name.setAttribute('aria-label', 'Corrected place name');
  const address = form.createEl('input', {
    type: 'text', value: correction?.addressText ?? candidate.addressText ?? '',
  });
  address.dataset.correctionAddress = candidate.id;
  address.setAttribute('aria-label', 'Corrected address');
  const save = form.createEl('button', { text: 'Save details' });
  save.dataset.saveCandidate = candidate.id;
  save.addEventListener('click', () => callbacks.onSave(candidate.id, name.value, address.value));
}

function renderActions(
  card: HTMLElement,
  candidate: PlaceCandidate,
  callbacks: CandidateReviewViewCallbacks,
): void {
  const actions = card.createDiv({ cls: 'sa-place-candidate-actions' });
  if (!['maps_url', 'caption_llm'].includes(candidate.evidenceType)) {
    action(actions, 'Edit details', 'editCandidate', candidate, () => callbacks.onEdit(candidate.id));
  }
  action(actions, 'Find exact place', 'providerCandidate', candidate, (button) => {
    callbacks.onPicker(candidate, 'search', button);
  });
  action(actions, 'Choose existing location', 'existingCandidate', candidate, (button) => {
    callbacks.onPicker(candidate, 'existing', button);
  });
  action(actions, 'Dismiss', 'dismissCandidate', candidate, () => callbacks.onDismiss(candidate.id));
}

function action(
  parent: HTMLElement,
  text: string,
  dataKey: string,
  candidate: PlaceCandidate,
  onClick: (button: HTMLButtonElement) => void,
): void {
  const button = parent.createEl('button', { text });
  button.dataset[dataKey] = candidate.id;
  button.addEventListener('click', () => onClick(button));
}

function renderFooter(
  root: HTMLElement,
  state: CandidateReviewViewState,
  callbacks: CandidateReviewViewCallbacks,
): void {
  const footer = root.createDiv({ cls: 'sa-place-candidate-footer' });
  footer.createSpan({ text: `${state.selected.size} selected` });
  const actions = footer.createDiv({ cls: 'sa-place-candidate-footer-actions' });
  renderExtractCta(actions, state, callbacks, 'Find more places with AI');
  const dismissAll = actions.createEl('button', {
    cls: 'sa-place-candidate-dismiss-all', text: 'Dismiss all',
  });
  dismissAll.addEventListener('click', callbacks.onDismissAll);
  const add = actions.createEl('button', {
    cls: 'mod-cta sa-place-candidate-add-selected', text: 'Add selected',
  });
  add.disabled = state.selected.size === 0 || state.busy;
  add.addEventListener('click', callbacks.onAddSelected);
  const close = actions.createEl('button', { text: 'Close' });
  close.addEventListener('click', callbacks.onClose);
}

function renderEmpty(
  root: HTMLElement,
  state: CandidateReviewViewState,
  callbacks: CandidateReviewViewCallbacks,
): void {
  root.createDiv({
    cls: 'sa-place-candidate-empty',
    text: state.extractAvailable
      ? 'No place suggestions yet.'
      : 'All place candidates are reviewed.',
  });
  const actions = root.createDiv({ cls: 'sa-place-candidate-footer-actions' });
  renderExtractCta(actions, state, callbacks, 'Find places with AI');
  const close = actions.createEl('button', { text: 'Close' });
  close.addEventListener('click', callbacks.onClose);
}
