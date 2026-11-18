export type Mode = 'dna' | 'marker' | 'manual';
export type Filter = 'all' | 'uncertain' | 'unreviewed' | 'accepted' | 'corrected' | 'excluded' | 'reviewed';
export type ReviewStatus = Exclude<Filter, 'all' | 'uncertain' | 'reviewed'>;
export type ReviewAction = 'accept' | 'correct' | 'exclude' | 'undo';
export type Point = [number, number];

export interface Series {
  index: number;
  axes: string;
  shape: number[];
  sizes: Record<string, number>;
  dtype: string;
  channels: string[];
  pixelSize: { x: number; y: number; unit: string } | null;
  supported: boolean;
  issues: string[];
  requiresAxisConfirmation: boolean;
}
export interface Source {
  sourceId: string;
  name: string;
  sha256: string;
  isSynthetic: boolean;
  format: string;
  series: Series[];
  duplicate?: boolean;
}
export interface Selection {
  seriesIndex: number;
  tIndex: number;
  zIndex: number;
  nuclearChannel: number | null;
  markerChannel: number | null;
  mode: Mode;
  confirmAxes: boolean;
}
export interface ReviewState {
  reviewedLabel: string | null;
  reviewStatus: ReviewStatus;
  exclusionReason: string | null;
  reviewedAt: string | null;
}
export interface Nucleus {
  objectId: string;
  maskLabel: number;
  centroidPx: Point;
  areaPx: number;
  integratedSignal: number;
  backgroundEstimate: number;
  meanSignal: number;
  markerMean: number | null;
  saturationFraction: number;
  qualityFlags: string[];
  outlines: Point[][];
  suggestion: { suggestedLabel: string; reason: string };
  review: ReviewState & {
    history: { action: ReviewAction; at: string; before: ReviewState; after: ReviewState; undone?: boolean }[];
  };
}
export interface Calibration {
  id: string;
  sourceSha256: string;
  selection: Selection;
  datasetScope: string;
  provenance: string;
  g1Reference: number;
}
export interface RunSummary {
  runId: string;
  sourceId: string;
  selection: Selection;
  calibration: Calibration | null;
  calibrationId: string | null;
  createdAt: string;
  isSynthetic: boolean;
  dimensions: Point;
  segmentationVersion: string;
  objectCount: number;
}
export type Run = Omit<RunSummary, 'objectCount'> & { objects: Nucleus[] };
export interface Job {
  jobId: string;
  runId: string;
  status: 'queued' | 'running' | 'cancelled' | 'finished' | 'failed';
  progress: number;
  message: string;
}
export interface Session {
  sessionId: string;
  runId: string;
  name: string;
  filter: Filter;
  selectedObjectId: string | null;
}
export interface OpenSession { source: Source; run: Run; session: Session }

export const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All objects' }, { key: 'uncertain', label: 'Uncertain' },
  { key: 'unreviewed', label: 'Unreviewed' }, { key: 'reviewed', label: 'Reviewed' },
  { key: 'accepted', label: 'Accepted' }, { key: 'corrected', label: 'Corrected' },
  { key: 'excluded', label: 'Excluded' },
];

export const LABELS: Record<Mode, string[]> = {
  dna: ['G1-like', 'S-like', 'G2/M-like', 'uncertain'],
  marker: ['positive', 'negative', 'uncertain'],
  manual: ['class-1', 'class-2', 'uncertain'],
};

export function matchesFilter(object: Nucleus, filter: Filter) {
  if (filter === 'all') return true;
  const { review, suggestion } = object;
  if (filter === 'uncertain') return (review.reviewedLabel ?? suggestion.suggestedLabel) === 'uncertain';
  if (filter === 'reviewed') return review.reviewStatus !== 'unreviewed';
  return review.reviewStatus === filter;
}

export function sameSelection(a: Selection, b: Selection) {
  return a.seriesIndex === b.seriesIndex && a.tIndex === b.tIndex && a.zIndex === b.zIndex &&
    a.nuclearChannel === b.nuclearChannel && a.markerChannel === b.markerChannel &&
    a.confirmAxes === b.confirmAxes && a.mode === b.mode;
}

export const endpoint = (path: string) => '/api/' + path;
export const previewUrl = (source: Source, selection: Selection, channel: number) => {
  const query = new URLSearchParams({
    series: String(selection.seriesIndex), t: String(selection.tIndex), z: String(selection.zIndex),
    channel: String(channel), confirm: String(selection.confirmAxes),
  });
  return endpoint('sources/' + source.sourceId + '/preview?' + query);
};

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(endpoint(path), init);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const detail = typeof data.detail === 'string'
      ? data.detail
      : Array.isArray(data.detail) ? data.detail.map((entry: { msg: string }) => entry.msg).join('. ') : null;
    throw new Error(detail || 'The local service returned HTTP ' + response.status + '.');
  }
  return response.json() as Promise<T>;
}

export function send<T>(path: string, body?: unknown, method = 'POST') {
  return request<T>(path, body === undefined ? { method } : {
    method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  });
}

export function formatNumber(number: number, digits = 1) {
  return new Intl.NumberFormat('en', { maximumFractionDigits: digits }).format(number);
}
