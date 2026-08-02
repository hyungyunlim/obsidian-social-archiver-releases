import { setIcon } from 'obsidian';
import type {
  ArchiveLocation,
  PlaceCandidate,
  ProviderSearchCandidate,
} from '../services/WorkersAPIClient';
import type { ExtractPlaceCandidatesExecutionPreference } from '../types/place-candidate-attachment';
import {
  PLACE_KINDS,
  type PlaceKind,
  type PlaceKindIntent,
} from '../shared/platforms/place-kinds';
import {
  canAttachCandidateDirectly,
  candidateSearchQuery,
  placeCandidateRoleLabel,
  providerCandidateAddress,
  providerCandidateName,
  type CandidateCorrection,
  type CandidateInlineSearch,
  type StagedCandidateMatch,
} from './placeCandidateReviewModel';
import type { MapSearchProvider } from '../shared/platforms/map-search-provider';

export type CandidateReviewViewState = {
  readonly candidates: readonly PlaceCandidate[];
  readonly currentLocations: readonly ArchiveLocation[];
  readonly staged: ReadonlyMap<string, StagedCandidateMatch>;
  readonly searches: ReadonlyMap<string, CandidateInlineSearch>;
  readonly corrections: ReadonlyMap<string, CandidateCorrection>;
  readonly contextNoteIntents: ReadonlyMap<string, boolean>;
  readonly placeKindIntents: ReadonlyMap<string, PlaceKindIntent>;
  readonly editingCandidateId: string | null;
  readonly provider: MapSearchProvider;
  readonly providerAvailability: Readonly<Record<MapSearchProvider, boolean>>;
  readonly preparing: boolean;
  readonly busy: boolean;
  readonly liveMessage: string;
  readonly extractAvailable: boolean;
  readonly extractDisabled: boolean;
  readonly extracting: boolean;
  readonly imagesAvailable: boolean;
  readonly commentsAvailable: boolean;
  readonly includeOcr: boolean;
  readonly includeComments: boolean;
  readonly executionPreference: ExtractPlaceCandidatesExecutionPreference;
};

export type CandidateReviewViewCallbacks = {
  readonly onClearStage: (candidateId: string) => void;
  readonly onStageDirect: (candidateId: string) => void;
  readonly onContextNoteToggle: (candidateId: string, checked: boolean) => void;
  readonly onPlaceKindChange: (candidateId: string, placeKind: PlaceKind | null) => void;
  readonly onEdit: (candidateId: string) => void;
  readonly onSave: (candidateId: string, name: string, addressText: string) => void;
  readonly onSearch: (candidateId: string, query: string) => void;
  readonly onStageProvider: (candidateId: string, result: ProviderSearchCandidate) => void;
  readonly onPickerExisting: (candidate: PlaceCandidate, button: HTMLButtonElement) => void;
  readonly onProviderChange: (provider: MapSearchProvider) => void;
  readonly onDismiss: (candidateId: string) => void;
  readonly onAddReady: () => void;
  readonly onDismissAll: () => void;
  readonly onIncludeOcrToggle: (checked: boolean) => void;
  readonly onIncludeCommentsToggle: (checked: boolean) => void;
  readonly onExecutionPreferenceChange: (
    preference: ExtractPlaceCandidatesExecutionPreference,
  ) => void;
  readonly onExtract: () => void;
  readonly onClose: () => void;
};

const PLACE_KIND_ICON_NAMES: Readonly<Record<PlaceKind, string>> = {
  restaurant: 'utensils',
  cafe: 'coffee',
  bakery: 'croissant',
  bar: 'martini',
  hospital: 'hospital',
  pharmacy: 'pill',
  fitness: 'dumbbell',
  kids: 'baby',
  hotel: 'bed',
  culture: 'landmark',
  outdoor: 'mountain',
  shopping: 'shopping-bag',
  transit: 'bus',
  education: 'book-open',
  public: 'university',
};

function icon(element: HTMLElement, name: string): void {
  element.empty();
  if (typeof setIcon === 'function') setIcon(element, name);
  else element.textContent = '●';
}

export function renderCandidateReviewView(
  root: HTMLElement,
  state: CandidateReviewViewState,
  callbacks: CandidateReviewViewCallbacks,
): void {
  root.empty();
  root.createEl('p', {
    cls: 'sa-place-candidate-intro',
    text: 'Likely places are matched automatically. Remove a wrong match or search again in its row.',
  });
  const primary = state.currentLocations.find((location) => location.isPrimary);
  if (primary) {
    root.createEl('p', {
      cls: 'sa-place-candidate-current',
      text: `Current primary: ${primary.name}. New places are added without replacing it.`,
    });
  }
  // The map-search toolbar only makes sense once there are rows to match.
  if (state.candidates.length > 0) renderReviewToolbar(root, state, callbacks);
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
}

function renderReviewToolbar(
  root: HTMLElement,
  state: CandidateReviewViewState,
  callbacks: CandidateReviewViewCallbacks,
): void {
  const toolbar = root.createDiv({ cls: 'sa-place-candidate-toolbar' });
  const providerLabel = toolbar.createEl('label', { cls: 'sa-place-candidate-provider' });
  providerLabel.createSpan({ text: 'Map search' });
  const select = providerLabel.createEl('select');
  select.setAttribute('aria-label', 'Map search provider');
  const providers: readonly [MapSearchProvider, string][] = [
    ['kakaomap', 'Kakao Map'],
    ['googlemaps', 'Google Maps'],
  ];
  for (const [value, label] of providers) {
    const option = select.createEl('option', { value, text: label });
    option.value = value;
    option.selected = state.provider === value;
    option.disabled = state.providerAvailability[value] === false;
  }
  select.value = state.provider;
  select.disabled = state.busy || state.preparing;
  select.addEventListener('change', () => {
    callbacks.onProviderChange(select.value as MapSearchProvider);
  });
  if (state.preparing) {
    const status = toolbar.createSpan({ cls: 'sa-place-candidate-preparing' });
    const spinner = status.createSpan({ cls: 'sa-place-candidate-spinner' });
    icon(spinner, 'loader-circle');
    status.createSpan({ text: 'Matching places…' });
  } else {
    toolbar.createSpan({
      cls: 'sa-place-candidate-ready-count',
      text: `${state.staged.size} ready`,
    });
  }
}

function renderExtractControls(
  parent: HTMLElement,
  state: CandidateReviewViewState,
  callbacks: CandidateReviewViewCallbacks,
  idleLabel: string,
): void {
  if (!state.extractAvailable) return;
  const wrapper = parent.createDiv({ cls: 'sa-place-candidate-extract-wrapper' });
  const button = wrapper.createEl('button', {
    cls: 'sa-place-candidate-extract',
    text: state.extracting ? 'Analyzing for places…' : idleLabel,
  });
  // With nothing to review yet, the extraction IS the primary action.
  if (state.candidates.length === 0) button.addClass('mod-cta');
  button.dataset.extractCta = 'true';
  if (state.extracting) button.addClass('is-loading');
  button.disabled = state.extracting || state.extractDisabled || state.busy;
  if (state.extractDisabled && !state.extracting) {
    button.setAttribute('title', 'Review pending suggestions first');
    button.setAttribute('aria-label', 'Review pending suggestions first');
  }
  button.addEventListener('click', () => callbacks.onExtract());

  const inputs = wrapper.createDiv({ cls: 'sa-place-candidate-extract-inputs' });
  renderExtractionToggle(
    inputs,
    'Photo text',
    state.includeOcr,
    state.imagesAvailable,
    state.extracting,
    callbacks.onIncludeOcrToggle,
  );
  renderExtractionToggle(
    inputs,
    'Comments',
    state.includeComments,
    state.commentsAvailable,
    state.extracting,
    callbacks.onIncludeCommentsToggle,
  );
  const execution = inputs.createEl('label', { cls: 'sa-place-candidate-execution' });
  execution.createSpan({ text: 'Run with' });
  const executionSelect = execution.createEl('select');
  executionSelect.setAttribute('aria-label', 'Place extraction execution');
  for (const [value, label] of [
    ['auto', 'Auto'],
    ['local', 'Local executor'],
    ['server', 'Cloud'],
  ] as const) {
    const option = executionSelect.createEl('option', { value, text: label });
    option.value = value;
    option.selected = state.executionPreference === value;
  }
  executionSelect.value = state.executionPreference;
  executionSelect.disabled = state.extracting || state.busy;
  executionSelect.addEventListener('change', () => {
    callbacks.onExecutionPreferenceChange(
      executionSelect.value as ExtractPlaceCandidatesExecutionPreference,
    );
  });
}

function renderExtractionToggle(
  parent: HTMLElement,
  label: string,
  checked: boolean,
  available: boolean,
  extracting: boolean,
  onChange: (checked: boolean) => void,
): void {
  const control = parent.createEl('label', { cls: 'sa-place-candidate-source-toggle' });
  control.toggleClass('is-disabled', !available);
  const checkbox = control.createEl('input', { type: 'checkbox' });
  checkbox.checked = checked;
  checkbox.disabled = extracting || !available;
  checkbox.setAttribute('aria-label', available ? `Include ${label}` : `${label} unavailable`);
  checkbox.addEventListener('change', () => onChange(checkbox.checked));
  control.createSpan({ text: available ? label : `No ${label.toLowerCase()}` });
}

function renderCandidate(
  parent: HTMLElement,
  candidate: PlaceCandidate,
  state: CandidateReviewViewState,
  callbacks: CandidateReviewViewCallbacks,
): void {
  const staged = state.staged.get(candidate.id);
  const correction = state.corrections.get(candidate.id);
  const card = parent.createDiv({ cls: 'sa-place-candidate-card' });
  card.setAttribute('role', 'listitem');
  card.dataset.candidateId = candidate.id;
  card.toggleClass('is-selected', Boolean(staged));

  const header = card.createDiv({ cls: 'sa-place-candidate-header' });
  if (staged) {
    const selectedIcon = header.createSpan({ cls: 'sa-place-candidate-selected-icon' });
    icon(selectedIcon, 'circle-check');
  }
  const title = header.createDiv({ cls: 'sa-place-candidate-title' });
  title.createEl('strong', {
    text: staged?.displayName || correction?.name || candidate.name || 'Detected place',
  });
  const roleLabel = placeCandidateRoleLabel(candidate.role);
  if (roleLabel) title.createSpan({ cls: 'sa-place-candidate-role', text: roleLabel });
  if (staged) {
    const cancel = header.createEl('button', { cls: 'sa-place-candidate-cancel-match' });
    cancel.setAttribute('aria-label', `Cancel match for ${staged.displayName}`);
    cancel.setAttribute('title', 'Remove this match');
    icon(cancel, 'x');
    cancel.addEventListener('click', () => callbacks.onClearStage(candidate.id));
  }

  const address = staged?.displayAddress || correction?.addressText || candidate.addressText;
  if (address) card.createEl('p', { cls: 'sa-place-candidate-address', text: address });
  renderEvidence(card, candidate);

  if (staged) {
    renderMatchedDetails(card, candidate, state, callbacks);
  } else if (state.editingCandidateId === candidate.id) {
    renderCorrection(card, candidate, correction, callbacks);
  } else {
    renderInlineSearch(card, candidate, state, callbacks);
    renderUnmatchedActions(card, candidate, correction, callbacks);
  }
}

function renderEvidence(card: HTMLElement, candidate: PlaceCandidate): void {
  if (!candidate.evidenceText) return;
  const originLabel = candidate.evidenceOrigin === 'comment'
    ? 'Found in a comment'
    : candidate.evidenceOrigin === 'image_text'
      ? 'Found in image text'
      : null;
  if (originLabel) {
    card.createSpan({ cls: 'sa-place-candidate-evidence-origin', text: originLabel });
  }
  card.createEl('p', {
    cls: 'sa-place-candidate-evidence',
    text: candidate.evidenceText,
  });
}

function renderMatchedDetails(
  card: HTMLElement,
  candidate: PlaceCandidate,
  state: CandidateReviewViewState,
  callbacks: CandidateReviewViewCallbacks,
): void {
  const kindControl = card.createEl('label', { cls: 'sa-place-candidate-kind' });
  const kindIcon = kindControl.createSpan({ cls: 'sa-place-candidate-kind-icon' });
  const kindSelect = kindControl.createEl('select');
  kindSelect.setAttribute('aria-label', `Place type for ${candidate.name ?? 'place'}`);
  const currentKind = state.placeKindIntents.get(candidate.id)?.placeKind ?? null;
  icon(kindIcon, currentKind ? PLACE_KIND_ICON_NAMES[currentKind] : 'map-pin');
  const emptyKind = kindSelect.createEl('option', { value: '', text: 'Place type' });
  emptyKind.value = '';
  for (const kind of PLACE_KINDS) {
    const option = kindSelect.createEl('option', {
      value: kind,
      text: kind.replaceAll('_', ' '),
    });
    option.value = kind;
    option.selected = currentKind === kind;
  }
  kindSelect.value = currentKind ?? '';
  kindSelect.addEventListener('change', () => {
    const value = (kindSelect.value || null) as PlaceKind | null;
    icon(kindIcon, value ? PLACE_KIND_ICON_NAMES[value] : 'map-pin');
    callbacks.onPlaceKindChange(candidate.id, value);
  });

  if (!candidate.contextText) return;
  const context = card.createDiv({ cls: 'sa-place-candidate-context' });
  context.createEl('p', { text: candidate.contextText });
  if (candidate.contextScope === 'candidate') {
    const toggle = context.createEl('label', { cls: 'sa-place-candidate-context-toggle' });
    const checkbox = toggle.createEl('input', { type: 'checkbox' });
    checkbox.checked = state.contextNoteIntents.get(candidate.id) === true;
    checkbox.setAttribute('aria-label', 'Save this as a place note');
    checkbox.addEventListener('change', () => {
      callbacks.onContextNoteToggle(candidate.id, checkbox.checked);
    });
    toggle.createSpan({ text: 'Save this as a place note' });
  } else {
    context.createSpan({
      cls: 'sa-place-candidate-context-hint',
      text: 'Shared context for multiple places — not saved automatically.',
    });
  }
}

function renderInlineSearch(
  card: HTMLElement,
  candidate: PlaceCandidate,
  state: CandidateReviewViewState,
  callbacks: CandidateReviewViewCallbacks,
): void {
  const search = state.searches.get(candidate.id);
  const form = card.createEl('form', { cls: 'sa-place-candidate-inline-search' });
  const input = form.createEl('input', {
    type: 'search',
    value: search?.query ?? candidateSearchQuery(candidate),
  });
  input.setAttribute('aria-label', `Search for ${candidate.name ?? 'place'}`);
  input.placeholder = 'Search name or address';
  const submit = form.createEl('button', {
    text: search?.status === 'loading' ? 'Searching…' : 'Search',
  });
  submit.disabled = state.busy || search?.status === 'loading';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    callbacks.onSearch(candidate.id, input.value);
  });
  if (search?.status === 'empty') {
    card.createEl('p', {
      cls: 'sa-place-candidate-search-status',
      text: 'No exact result. Refine the search or use the archived address.',
    });
  } else if (search?.status === 'error' || search?.status === 'rate-limited') {
    card.createEl('p', {
      cls: 'sa-place-candidate-search-status is-error',
      text: search.errorMessage ?? 'Could not search places.',
    });
  }
  if (search?.status !== 'results') return;
  const results = card.createDiv({ cls: 'sa-place-candidate-search-results' });
  for (const result of search.results) {
    const resultButton = results.createEl('button', { cls: 'sa-place-candidate-search-result' });
    const copy = resultButton.createSpan();
    copy.createEl('strong', { text: providerCandidateName(result) });
    copy.createEl('small', { text: providerCandidateAddress(result) });
    const chevron = resultButton.createSpan({ cls: 'sa-place-candidate-result-chevron' });
    icon(chevron, 'chevron-right');
    resultButton.addEventListener('click', () => callbacks.onStageProvider(candidate.id, result));
  }
}

function renderUnmatchedActions(
  card: HTMLElement,
  candidate: PlaceCandidate,
  correction: CandidateCorrection | undefined,
  callbacks: CandidateReviewViewCallbacks,
): void {
  const actions = card.createDiv({ cls: 'sa-place-candidate-actions' });
  if (canAttachCandidateDirectly(candidate, correction)) {
    action(actions, 'Use address as shown', 'stageDirect', candidate, () => {
      callbacks.onStageDirect(candidate.id);
    });
  }
  if (!['maps_url', 'caption_llm'].includes(candidate.evidenceType)) {
    action(actions, 'Edit address', 'editCandidate', candidate, () => callbacks.onEdit(candidate.id));
  }
  action(actions, 'Choose saved place', 'existingCandidate', candidate, (button) => {
    callbacks.onPickerExisting(candidate, button);
  });
  action(actions, 'Dismiss', 'dismissCandidate', candidate, () => callbacks.onDismiss(candidate.id));
}

function renderCorrection(
  parent: HTMLElement,
  candidate: PlaceCandidate,
  correction: CandidateCorrection | undefined,
  callbacks: CandidateReviewViewCallbacks,
): void {
  const form = parent.createDiv({ cls: 'sa-place-candidate-correction' });
  const name = form.createEl('input', {
    type: 'text',
    value: correction?.name ?? candidate.name ?? '',
  });
  name.dataset.correctionName = candidate.id;
  name.setAttribute('aria-label', 'Corrected place name');
  const address = form.createEl('input', {
    type: 'text',
    value: correction?.addressText ?? candidate.addressText ?? '',
  });
  address.dataset.correctionAddress = candidate.id;
  address.setAttribute('aria-label', 'Corrected address');
  const save = form.createEl('button', { text: 'Use details' });
  save.dataset.saveCandidate = candidate.id;
  save.addEventListener('click', () => callbacks.onSave(candidate.id, name.value, address.value));
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
  const actions = footer.createDiv({ cls: 'sa-place-candidate-footer-actions' });
  renderExtractControls(actions, state, callbacks, 'Find more places with AI');
  const secondary = actions.createDiv({ cls: 'sa-place-candidate-footer-secondary' });
  const dismissAll = secondary.createEl('button', {
    cls: 'sa-place-candidate-dismiss-all',
    text: 'Dismiss all',
  });
  dismissAll.addEventListener('click', callbacks.onDismissAll);
  const close = secondary.createEl('button', { text: 'Close' });
  close.addEventListener('click', callbacks.onClose);
  const noteCount = [...state.staged.keys()].filter(
    (candidateId) => state.contextNoteIntents.get(candidateId) === true,
  ).length;
  const add = secondary.createEl('button', {
    cls: 'mod-cta sa-place-candidate-add-selected',
    text: noteCount > 0
      ? `Save ${state.staged.size} ${state.staged.size === 1 ? 'place' : 'places'} and notes`
      : `Add ${state.staged.size} ${state.staged.size === 1 ? 'place' : 'places'}`,
  });
  add.disabled = state.staged.size === 0 || state.busy || state.preparing;
  add.addEventListener('click', callbacks.onAddReady);
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
  renderExtractControls(actions, state, callbacks, 'Find places with AI');
  const secondary = actions.createDiv({ cls: 'sa-place-candidate-footer-secondary' });
  const close = secondary.createEl('button', { text: 'Close' });
  close.addEventListener('click', callbacks.onClose);
}
