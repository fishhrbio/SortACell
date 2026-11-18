import { useState } from 'react';
import { formatNumber, type Calibration, type Selection, type Series, type Source } from './api';

const MODES = {
  dna: { title: 'DNA content · e.g. DAPI', help: 'Broad phase suggestions use a matching calibration. Without one, review labels manually.' },
  marker: { title: 'Marker review · positive / negative', help: 'Requires a separate marker channel. Label positive or negative after inspecting its signal.' },
  manual: { title: 'Manual review', help: 'Measure the nuclear channel and assign a general class by hand.' },
};

interface Props {
  source: Source;
  series: Series;
  selection: Selection;
  disabled: boolean;
  onChange: (patch: Partial<Selection>) => void;
  calibrations: Calibration[];
  calibrationId: string;
  onCalibration: (id: string) => void;
  onCreateCalibration: (body: { g1Reference: number; datasetScope: string; provenance: string; quantitativeConfirmed: boolean }) => Promise<boolean>;
}

export default function Mapping({ source, selection, series, disabled, onChange, calibrations, calibrationId, onCalibration, onCreateCalibration }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const currentCalibration = calibrations.find(item => item.id === calibrationId);
  return <fieldset disabled={disabled}>
    <legend className="sr-only">Plane and channel assignment</legend>
    <label>Series
      <select value={selection.seriesIndex} onChange={event => onChange({
        seriesIndex: Number(event.target.value), tIndex: 0, zIndex: 0, nuclearChannel: null, markerChannel: null, confirmAxes: false,
      })}>
        {source.series.map(item => <option key={item.index} value={item.index}>{item.index} · {item.axes} · {item.shape.join(' × ')}</option>)}
      </select>
    </label>
    <p className="small mono muted data-line">{source.format} · {series.axes} · {series.dtype}</p>
    {!series.supported ? <p className="inline-error">{series.issues.join(' ')}</p> : <>
      <div className="split-inputs">
        <label>Time (T)<input type="number" min={0} max={(series.sizes.T ?? 1) - 1} value={Number.isNaN(selection.tIndex) ? '' : selection.tIndex}
          onChange={event => onChange({ tIndex: event.target.valueAsNumber })} /></label>
        <label>Depth (Z)<input type="number" min={0} max={(series.sizes.Z ?? 1) - 1} value={Number.isNaN(selection.zIndex) ? '' : selection.zIndex}
          onChange={event => onChange({ zIndex: event.target.valueAsNumber })} /></label>
      </div>
      {series.requiresAxisConfirmation && <label className="check">
        <input type="checkbox" checked={selection.confirmAxes} onChange={event => onChange({ confirmAxes: event.target.checked })} />
        Confirm the displayed TIFF axes
      </label>}
      <label>Capability preset
        <select value={selection.mode} onChange={event => onChange({ mode: event.target.value as Selection['mode'] })}>
          {Object.entries(MODES).map(([key, mode]) => <option value={key} key={key}>{mode.title}</option>)}
        </select>
      </label>
      <p className="small muted">{MODES[selection.mode].help}</p>
      <label>Nuclear channel
        <select value={selection.nuclearChannel ?? ''} onChange={event => onChange({ nuclearChannel: event.target.value === '' ? null : Number(event.target.value) })}>
          <option value="">Choose nuclear channel</option>
          {series.channels.map((name, i) => <option key={i} value={i}>{i} · {name}</option>)}
        </select>
      </label>
      <label>Marker channel {selection.mode !== 'marker' && '(optional)'}
        <select value={selection.markerChannel ?? ''} onChange={event => onChange({ markerChannel: event.target.value === '' ? null : Number(event.target.value) })}>
          <option value="">No marker channel</option>
          {series.channels.map((name, i) => <option key={i} value={i} disabled={i === selection.nuclearChannel}>{i} · {name}</option>)}
        </select>
      </label>
      {selection.mode === 'dna' && !source.isSynthetic && <details className="details-box">
        <summary>Dataset calibration</summary>
        <label>Matching calibration
          <select value={calibrationId} onChange={event => onCalibration(event.target.value)}>
            <option value="">None · manual review</option>
            {calibrations.map(item => <option key={item.id} value={item.id}>{item.datasetScope} · {formatNumber(item.g1Reference)}</option>)}
          </select>
        </label>
        {currentCalibration && <p className="small wrap muted">{currentCalibration.provenance}</p>}
        <button className="wide" type="button" aria-expanded={showCreate} onClick={() => setShowCreate(!showCreate)}>{showCreate ? 'Close form' : 'Create calibration'}</button>
        {showCreate && <form onSubmit={async event => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          setCalibrating(true);
          try {
            if (await onCreateCalibration({
              g1Reference: Number(values.get('reference')),
              datasetScope: String(values.get('scope')).trim(),
              provenance: String(values.get('provenance')).trim(),
              quantitativeConfirmed: confirmed,
            })) setShowCreate(false);
          } finally { setCalibrating(false); }
        }}>
          <label>Dataset scope<input name="scope" required minLength={3} maxLength={500} /></label>
          <label>G1 integrated signal reference<input name="reference" type="number" min="0" step="any" required /></label>
          <label>Reference provenance<textarea name="provenance" required minLength={3} maxLength={2000} /></label>
          <label className="check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
            I confirmed this image is suitable for quantitative DNA measurement.
          </label>
          <button className="wide" type="submit" disabled={!confirmed || calibrating}>Save calibration</button>
        </form>}
      </details>}
    </>}
  </fieldset>;
}
