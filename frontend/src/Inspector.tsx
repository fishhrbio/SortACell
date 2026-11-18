import { useState } from 'react';
import { formatNumber, LABELS, type Mode, type Nucleus, type ReviewAction } from './api';

export function Status({ value }: { value: string }) {
  return <span className={'status-pill status-' + value}>{value}</span>;
}

interface Props {
  object: Nucleus;
  mode: Mode;
  busy: boolean;
  onReview: (action: ReviewAction, label?: string, reason?: string) => Promise<boolean>;
}

export default function Inspector({ object, mode, busy, onReview }: Props) {
  const [label, setLabel] = useState(object.review.reviewedLabel === 'excluded'
    ? object.suggestion.suggestedLabel : object.review.reviewedLabel ?? object.suggestion.suggestedLabel);
  const [reason, setReason] = useState(object.review.exclusionReason ?? '');
  const [excluding, setExcluding] = useState(false);
  const hasUndo = object.review.history.some(entry => entry.action !== 'undo' && !entry.undone);

  return <div className="inspector-body">
    <div className="object-title">
      <h3>Nucleus {String(object.maskLabel).padStart(2, '0')}</h3>
      <Status value={object.review.reviewStatus} />
    </div>
    <dl className="suggestion">
      <div><dt>Suggested label</dt><dd>{object.suggestion.suggestedLabel}</dd></div>
      <div><dt>Reviewed label</dt><dd>{object.review.reviewedLabel ?? 'Pending review'}</dd></div>
    </dl>
    <p className="small muted">{object.suggestion.reason}</p>
    {object.qualityFlags.length > 0 && <div className="quality">
      <strong>Check object quality</strong>
      <ul>{object.qualityFlags.map(flag => <li key={flag}>{flag.replaceAll('-', ' ')}</li>)}</ul>
    </div>}
    {object.review.exclusionReason && <p className="small reason"><strong>Exclusion reason</strong><br />{object.review.exclusionReason}</p>}
    <dl className="measurements">
      <div><dt>Centroid (x, y)</dt><dd>{object.centroidPx.map(n => formatNumber(n)).join(', ')} px</dd></div>
      <div><dt>Mask area</dt><dd>{formatNumber(object.areaPx)} px²</dd></div>
      <div><dt>Integrated signal</dt><dd>{formatNumber(object.integratedSignal)}</dd></div>
      <div><dt>Mean / background</dt><dd>{formatNumber(object.meanSignal)} / {formatNumber(object.backgroundEstimate)}</dd></div>
      <div><dt>Saturated pixels</dt><dd>{formatNumber(object.saturationFraction * 100, 2)}%</dd></div>
      {object.markerMean !== null && <div><dt>Marker mean</dt><dd>{formatNumber(object.markerMean)}</dd></div>}
    </dl>

    <fieldset disabled={busy} className="review-controls">
      <legend>Review decision</legend>
      <button className="primary wide" type="button" onClick={() => void onReview('accept')}>Accept suggestion</button>
      <form className="correction" onSubmit={event => { event.preventDefault(); void onReview('correct', label); }}>
        <label>Corrected label
          <select value={label} onChange={event => setLabel(event.target.value)}>
            {LABELS[mode].map(item => <option key={item}>{item}</option>)}
          </select>
        </label>
        <button type="submit">Apply correction</button>
      </form>
      <div className="button-pair">
        <button type="button" aria-expanded={excluding} onClick={() => setExcluding(!excluding)}>{excluding ? 'Cancel exclusion' : 'Exclude…'}</button>
        <button type="button" disabled={!hasUndo} onClick={() => void onReview('undo')}>Undo decision</button>
      </div>
      {excluding && <form onSubmit={async event => {
        event.preventDefault();
        if (reason.trim() && await onReview('exclude', undefined, reason)) setExcluding(false);
      }}>
        <label>Exclusion reason
          <textarea required maxLength={2000} value={reason} onChange={event => setReason(event.target.value)}
            placeholder="e.g. touching nuclei" />
        </label>
        <button className="wide" type="submit" disabled={!reason.trim()}>Confirm exclusion</button>
      </form>}
    </fieldset>

    <details className="details-box">
      <summary>History ({object.review.history.length})</summary>
      {object.review.history.length === 0 ? <p className="small muted">No review decisions yet.</p> :
        <ol className="history">{[...object.review.history].reverse().map((entry, index) => <li key={entry.at + index}>
          <strong>{entry.action}</strong> · {entry.after.reviewedLabel ?? 'Unreviewed'}{entry.undone ? ' · undone' : ''}
          <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>
        </li>)}</ol>}
      <details><summary>Object ID</summary><code className="small wrap">{object.objectId}</code></details>
    </details>
  </div>;
}
