/**
 * PlacesCliService — thin adapter between Obsidian CLI flag bags and the
 * place-candidate review endpoints.
 *
 * Extraction proposes place *candidates*; they only become attached locations
 * once confirmed. The plugin UI has had that review queue since Places P3a and
 * the desktop CLI got it later, but the Obsidian CLI had no way to see or
 * confirm a candidate — an agent could archive a post with a place in it and
 * then had to hand the user back to the UI.
 *
 * Candidates carry the evidence they were extracted from, which is what makes
 * them judgeable, so `list` returns evidence and score rather than just names.
 *
 * Does NOT register CLI handlers — that wiring lives in `CliRegistry`.
 */

import { CliValidationError, parseCsv, parseEnum, parseNumber, parseString, type CliParams } from './CliParams';

/** The slice of WorkersAPIClient this service needs. */
export interface PlacesCliClient {
  getPlaceCandidates(
    query: { archiveIds: readonly string[] } | { state: 'pending'; limit?: number },
  ): Promise<{
    items: ReadonlyArray<{
      id: string;
      archiveId: string;
      name: string | null;
      addressText: string | null;
      evidenceType: string;
      evidenceText: string;
      confidenceBucket: string | null;
      score: number | null;
    }>;
    pendingCount: number;
  }>;
  attachPlaceCandidatesBatch(
    archiveId: string,
    body: {
      idempotencyKey: string;
      candidates: ReadonlyArray<{ candidateId: string }>;
    },
  ): Promise<{
    replayed: boolean;
    outcomes: ReadonlyArray<{
      candidateId: string;
      outcome: string;
      canonicalLocation: { name: string } | null;
    }>;
    remainingPendingCount: number;
  }>;
  detachPlace(placeKey: string): Promise<{ archiveIds: string[]; removedCount: number }>;
}

export const PLACES_ACTIONS = ['list', 'attach', 'detach'] as const;
export type PlacesCliAction = (typeof PLACES_ACTIONS)[number];

export interface PlaceCandidateCliSummary {
  candidateId: string;
  archiveId: string;
  name: string | null;
  address: string | null;
  evidenceType: string;
  evidence: string;
  confidence: string | null;
  score: number | null;
}

export interface PlacesListCliResult {
  candidates: PlaceCandidateCliSummary[];
  /** Total pending server-side — may exceed `candidates.length` under `limit`. */
  pendingCount: number;
}

export interface PlacesAttachCliResult {
  archiveId: string;
  /** `replayed` means the idempotency key matched an earlier attach. */
  replayed: boolean;
  attached: Array<{ candidateId: string; outcome: string; place: string | null }>;
  remainingPendingCount: number;
}

export interface PlacesDetachCliResult {
  placeKey: string;
  removedCount: number;
  archiveIds: string[];
}

export type PlacesCliResult = PlacesListCliResult | PlacesAttachCliResult | PlacesDetachCliResult;

export class PlacesCliService {
  constructor(
    private readonly client: PlacesCliClient,
    /** Injected so a test can assert the key is sent without matching a UUID. */
    private readonly newIdempotencyKey: () => string = () => crypto.randomUUID(),
  ) {}

  /** Drive the `social-archiver:places` command. */
  async run(params: CliParams): Promise<PlacesCliResult> {
    const action = (parseEnum(params, 'action', PLACES_ACTIONS) ?? 'list') as PlacesCliAction;
    if (action === 'list') return this.list(params);
    if (action === 'attach') return this.attach(params);
    return this.detach(params);
  }

  private async detach(params: CliParams): Promise<PlacesDetachCliResult> {
    const placeKey = parseString(params, 'placeKey');
    if (!placeKey) {
      throw new CliValidationError(
        'placeKey',
        "action='detach' requires 'placeKey' (\"<source>:<externalId>\"). Archives themselves are never deleted.",
      );
    }
    const result = await this.client.detachPlace(placeKey);
    return { placeKey, removedCount: result.removedCount, archiveIds: result.archiveIds };
  }

  private async list(params: CliParams): Promise<PlacesListCliResult> {
    const archiveIds = parseCsv(params, 'archive');
    if (archiveIds.length > 50) {
      throw new CliValidationError('archive', 'At most 50 archive ids can be queried at once.');
    }
    const limit = parseNumber(params, 'limit', { integer: true, min: 1, max: 100 });
    const response = await this.client.getPlaceCandidates(
      archiveIds.length > 0
        ? { archiveIds }
        : { state: 'pending', ...(limit !== undefined ? { limit } : {}) },
    );
    return {
      candidates: response.items.map((item) => ({
        candidateId: item.id,
        archiveId: item.archiveId,
        name: item.name,
        address: item.addressText,
        evidenceType: item.evidenceType,
        evidence: item.evidenceText,
        confidence: item.confidenceBucket,
        score: item.score,
      })),
      pendingCount: response.pendingCount,
    };
  }

  private async attach(params: CliParams): Promise<PlacesAttachCliResult> {
    const archiveId = parseString(params, 'archive');
    if (!archiveId) {
      throw new CliValidationError('archive', "action='attach' requires 'archive' (the archive id).");
    }
    const candidateIds = parseCsv(params, 'candidate');
    if (candidateIds.length === 0) {
      throw new CliValidationError(
        'candidate',
        "action='attach' requires 'candidate' (one or more candidate ids). List them first with action='list'.",
      );
    }

    const result = await this.client.attachPlaceCandidatesBatch(archiveId, {
      // Required by the server so a retried attach cannot double-attach.
      idempotencyKey: this.newIdempotencyKey(),
      candidates: candidateIds.map((candidateId) => ({ candidateId })),
    });

    return {
      archiveId,
      replayed: result.replayed,
      attached: result.outcomes.map((outcome) => ({
        candidateId: outcome.candidateId,
        outcome: outcome.outcome,
        place: outcome.canonicalLocation?.name ?? null,
      })),
      remainingPendingCount: result.remainingPendingCount,
    };
  }
}
