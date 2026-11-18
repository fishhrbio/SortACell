import { useEffect, useEffectEvent, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  endpoint, FILTERS, formatNumber, matchesFilter, request, sameSelection, send,
  type Calibration, type Filter, type Job, type Nucleus, type OpenSession, type ReviewAction,
  type Run, type RunSummary, type Selection, type Session, type Source,
} from './api';
import Inspector, { Status } from './Inspector';
import Mapping from './Mapping';
import Viewer from './Viewer';

const EMPTY_MAPPING: Selection = {
  seriesIndex: 0, tIndex: 0, zIndex: 0, nuclearChannel: null, markerChannel: null, mode: 'dna', confirmAxes: false,
};
const NO_OBJECTS: Nucleus[] = [];
const activeJob = (job: Job | null) => job?.status === 'queued' || job?.status === 'running';
const encode = encodeURIComponent;

export default function App() {
  const [sources, setSources] = useState<Source[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [calibrations, setCalibrations] = useState<Calibration[]>([]);
  const [source, setSource] = useState<Source | null>(null);
  const [selection, setSelection] = useState<Selection>(EMPTY_MAPPING);
  const [calibrationId, setCalibrationId] = useState('');
  const [run, setRun] = useState<Run | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [reveal, setReveal] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [openKey, setOpenKey] = useState('');
  const [cancelRequested, setCancelRequested] = useState(false);
  const jobId = job?.jobId;
  const queue = useRef<HTMLDivElement>(null);

  const series = source?.series.find(item => item.index === selection.seriesIndex);
  const viewReady = series?.supported && (!series.requiresAxisConfirmation || selection.confirmAxes) &&
    Number.isInteger(selection.tIndex) && selection.tIndex >= 0 && selection.tIndex < (series.sizes.T ?? 1) &&
    Number.isInteger(selection.zIndex) && selection.zIndex >= 0 && selection.zIndex < (series.sizes.Z ?? 1);
  const mapIssue = !source ? 'Load an image to begin.'
    : !viewReady ? 'Choose supported series, axes and plane indices.'
    : selection.nuclearChannel === null ? 'Map the nuclear channel to analyze.'
    : selection.mode === 'marker' && selection.markerChannel === null ? 'Map a separate marker channel.'
    : '';
  const currentRun = run && run.sourceId === source?.sourceId && sameSelection(selection, run.selection) ? run : null;
  const objects = currentRun?.objects ?? NO_OBJECTS;
  const visible = useMemo(() => objects.filter(item => matchesFilter(item, filter)), [objects, filter]);
  const filterCounts = useMemo(
    () => Object.fromEntries(FILTERS.map(({ key }) => [key, objects.filter(item => matchesFilter(item, key)).length])),
    [objects],
  );
  const selected = visible.find(item => item.objectId === selectedId) ?? visible[0] ?? null;
  const selectedIndex = selected ? visible.indexOf(selected) : -1;
  const processing = loading || busy || activeJob(job);
  const matchedCalibrations = calibrations.filter(item =>
    item.sourceSha256 === source?.sha256 && sameSelection(item.selection, selection));
  const stage = !source ? 0 : mapIssue ? 1 : currentRun ? 3 : 2;

  function report(problem: unknown) {
    setError(problem instanceof Error ? problem.message : String(problem));
  }

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      request<Source[]>('sources'), request<Session[]>('sessions'), request<RunSummary[]>('runs'),
      request<Calibration[]>('calibrations'),
    ]).then(([images, bookmarks, analyses, presets]) => {
      if (!cancelled) {
        setSources(images); setSessions(bookmarks); setRuns(analyses); setCalibrations(presets);
      }
    }).catch(problem => {
      if (!cancelled) setError('Could not load the local workspace. ' + String(problem));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: number | undefined;
    async function poll() {
      try {
        const result = await request<Job>('jobs/' + jobId);
        if (cancelled) return;
        if (result.status === 'finished') {
          const finished = await request<Run>('runs/' + result.runId);
          if (cancelled) return;
          setRun(finished);
          setRuns(previous => [{ ...finished, objectCount: finished.objects.length }, ...previous]);
          setSelectedId(finished.objects[0]?.objectId ?? null);
          setFilter('all');
          setSessionName('');
          setMessage(finished.objects.length + ' nuclei ready for review.');
          setJob(result);
        } else {
          setJob(result);
          if (result.status === 'failed') setError(result.message || 'Analysis failed.');
          else if (result.status === 'cancelled') setMessage(result.message);
          else timer = window.setTimeout(() => void poll(), 250);
        }
      } catch (problem) {
        if (!cancelled) {
          report(problem);
          setJob(null);
        }
      }
    }
    void poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [jobId]);

  useEffect(() => {
    const view = queue.current;
    const row = view?.querySelector('[aria-current="true"]');
    if (!view || !row) return;
    const box = view.getBoundingClientRect();
    const item = row.getBoundingClientRect();
    if (item.top < box.top + 36) view.scrollTop += item.top - box.top - 36;
    if (item.bottom > box.bottom) view.scrollTop += item.bottom - box.bottom;
  }, [selected?.objectId]);

  function select(id: string, center = true) {
    setSelectedId(id);
    if (center) setReveal(value => value + 1);
  }

  function move(offset: number) {
    const item = visible[selectedIndex + offset];
    if (item) select(item.objectId);
  }

  const onReviewKey = useEffectEvent((event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented || processing || saving) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) return;
      const offset = event.key.toLowerCase() === 'j' ? 1 : event.key.toLowerCase() === 'k' ? -1 : 0;
      const item = offset ? visible[selectedIndex + offset] : undefined;
      if (item) {
        event.preventDefault();
        setSelectedId(item.objectId);
        setReveal(value => value + 1);
      }
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => onReviewKey(event);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function installSource(image: Source) {
    const first = image.series.find(item => item.supported) ?? image.series[0];
    setSource(image);
    setSelection({ ...EMPTY_MAPPING, seriesIndex: first?.index ?? 0 });
    setCalibrationId('');
    setRun(null);
    setJob(null);
    setFilter('all');
    setSelectedId(null);
    setSessionName('');
    setSources(previous => previous.some(item => item.sourceId === image.sourceId)
      ? previous : [image, ...previous]);
  }

  async function importImage(file?: File) {
    if (file && file.size > 64 * 1024 ** 2) {
      setError('This TIFF exceeds the 64 MiB import limit.');
      return;
    }
    setBusy(true); setError(''); setMessage('');
    try {
      let imported: Source;
      if (file) {
        const form = new FormData();
        form.append('file', file);
        imported = await request<Source>('imports', { method: 'POST', body: form });
      } else {
        imported = await send<Source>('demo');
      }
      installSource(imported);
      setMessage(imported.duplicate ? 'Already imported. Opened the existing local source.' : 'Image imported. Map the nuclear channel to continue.');
    } catch (problem) { report(problem); }
    finally { setBusy(false); }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void importImage(file);
  }

  function updateSelection(patch: Partial<Selection>) {
    const next = { ...selection, ...patch };
    if (next.nuclearChannel === next.markerChannel) next.markerChannel = null;
    setSelection(next);
    const original = run && sameSelection(next, run.selection) && run.calibration ? run.calibration.id : '';
    setCalibrationId(original);
    setError('');
  }

  async function createCalibration(fields: { g1Reference: number; datasetScope: string; provenance: string; quantitativeConfirmed: boolean }) {
    if (!source || mapIssue) { setError(mapIssue); return false; }
    setBusy(true); setError('');
    try {
      const preset = await send<Calibration>('calibrations', { sourceId: source.sourceId, selection, ...fields });
      setCalibrations(previous => [preset, ...previous]);
      setCalibrationId(preset.id);
      setMessage('Calibration saved. Run analysis to apply it.');
      return true;
    } catch (problem) { report(problem); return false; }
    finally { setBusy(false); }
  }

  async function start() {
    if (!source || mapIssue || processing || saving) return;
    setBusy(true); setError(''); setMessage(''); setCancelRequested(false);
    try {
      setJob(await send<Job>('runs', { sourceId: source.sourceId, selection, calibrationId: calibrationId || null }));
    } catch (problem) { report(problem); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (!job) return;
    setCancelRequested(true);
    try { await send<Job>('jobs/' + job.jobId + '/cancel'); }
    catch (problem) { report(problem); setCancelRequested(false); }
  }

  async function changeReview(action: ReviewAction, label?: string, reason?: string) {
    if (!currentRun || !selected || saving) return false;
    setSaving(true); setError('');
    try {
      const updated = await send<Nucleus>(
        'runs/' + currentRun.runId + '/objects/' + selected.maskLabel + '/review',
        { action, label, reason }, 'PATCH',
      );
      setRun(previous => previous && previous.runId === currentRun.runId
        ? { ...previous, objects: previous.objects.map(item => item.objectId === updated.objectId ? updated : item) }
        : previous);
      setMessage('Nucleus ' + updated.maskLabel + ' · ' + updated.review.reviewStatus + '.');
      return true;
    } catch (problem) { report(problem); return false; }
    finally { setSaving(false); }
  }

  async function saveSession() {
    if (!currentRun || !sessionName.trim()) return;
    setBusy(true); setError('');
    try {
      const bookmark = await send<Session>('sessions', {
        name: sessionName.trim(), runId: currentRun.runId, selectedObjectId: selected?.objectId ?? null, filter,
      });
      setSessions(previous => [bookmark, ...previous]);
      setOpenKey('session:' + bookmark.sessionId);
      setMessage('Saved session “' + bookmark.name + '”.');
    } catch (problem) { report(problem); }
    finally { setBusy(false); }
  }

  async function reopen() {
    if (!openKey) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const [kind, id] = openKey.split(':');
      const bookmark = kind === 'session' ? await request<OpenSession>('sessions/' + encode(id)) : null;
      const restored = bookmark?.run ?? await request<Run>('runs/' + encode(id));
      const image = bookmark?.source ?? await request<Source>('sources/' + encode(restored.sourceId));
      installSource(image);
      setRun(restored);
      setSelection(restored.selection);
      setCalibrationId(restored.calibration?.id ?? '');
      setFilter(bookmark?.session.filter ?? 'all');
      setSelectedId(bookmark?.session.selectedObjectId ?? null);
      setSessionName(bookmark?.session.name ?? '');
      setMessage(bookmark ? 'Opened session “' + bookmark.session.name + '”.' : 'Opened an earlier analysis run.');
    } catch (problem) { report(problem); }
    finally { setBusy(false); }
  }

  const locked = processing || saving;
  return <div className="app-shell">
    <a className="skip-link" href="#image">Skip to image workspace</a>
    <header className="topbar">
      <div className="brand">
        <div aria-hidden="true" className="brand-mark"><i /><i /><i /></div>
        <div><h1>SortACell</h1><span>Microscopy annotation</span></div>
      </div>
      <nav className="steps" aria-label="Workflow">
        {[['Import', 'import'], ['Map channels', 'mapping'], ['Analyze', 'analysis'], ['Review', 'review'], ['Export', 'export']].map(([label, target], i) =>
          <a key={target} href={'#' + target} aria-current={stage === i ? 'step' : undefined}><span aria-hidden="true">{i + 1}</span>{label}</a>)}
      </nav>
      <div className="local-label"><i aria-hidden="true" /> Local workspace</div>
    </header>

    <main className="workspace">
      <aside className="rail" aria-label="Image and analysis settings">
        <section className="panel settings" id="import">
          <h2>Import image</h2>
          <label className={'file-button' + (locked ? ' disabled' : '')}>Open TIFF or OME-TIFF
            <input type="file" accept=".tif,.tiff,image/tiff" disabled={locked} onChange={chooseFile} />
          </label>
          <button type="button" className="wide demo-button" disabled={locked} onClick={() => void importImage()}>Load synthetic demo</button>
          {sources.length > 0 && <label>Imported images
            <select value={source?.sourceId ?? ''} disabled={locked} onChange={event => {
              const image = sources.find(item => item.sourceId === event.target.value);
              if (image) { installSource(image); setError(''); setMessage('Opened local image.'); }
            }}>
              <option value="" disabled>Choose imported image</option>
              {sources.map(item => <option key={item.sourceId} value={item.sourceId}>{item.name}</option>)}
            </select>
          </label>}
        </section>
        <section className="panel settings" id="mapping">
          <h2>Map channels</h2>
          {source && series ? <Mapping key={source.sourceId + ':' + series.index}
            source={source} series={series} selection={selection} disabled={locked} onChange={updateSelection}
            calibrations={matchedCalibrations} calibrationId={calibrationId} onCalibration={setCalibrationId} onCreateCalibration={createCalibration} />
            : <p className="muted">Image metadata and channel controls appear here after import.</p>}
        </section>
        <section className="panel settings" id="analysis">
          <h2>Analyze plane</h2>
          <button type="button" className="primary wide" disabled={locked || Boolean(mapIssue)} onClick={() => void start()}>{currentRun ? 'Run new analysis' : 'Analyze nuclei'}</button>
          {mapIssue && <p className="muted small">{mapIssue}</p>}
          {job && <div className="job-line">
            <progress aria-label="Analysis progress" max={100} value={job.progress} />
            <p className="small" role="status">{job.status} · {job.message}</p>
            {activeJob(job) && <button type="button" className="wide" disabled={cancelRequested} onClick={() => void cancel()}>{cancelRequested ? 'Cancelling…' : 'Cancel analysis'}</button>}
          </div>}
          {currentRun && <p className="mono small muted wrap">{currentRun.segmentationVersion}</p>}
        </section>
        <section className="panel settings" aria-labelledby="sessions">
          <h2 id="sessions">Sessions</h2>
          <form onSubmit={event => { event.preventDefault(); void saveSession(); }}>
            <label>Session name<input value={sessionName} disabled={locked || !currentRun} maxLength={120} onChange={event => setSessionName(event.target.value)} placeholder="Name this view" /></label>
            <button type="submit" disabled={locked || !currentRun || !sessionName.trim()} className="wide">Save session</button>
          </form>
          <label>Saved sessions and runs
            <select value={openKey} disabled={locked || (!sessions.length && !runs.length)} onChange={event => setOpenKey(event.target.value)}>
              <option value="" disabled>Choose a session or run</option>
              {sessions.length > 0 && <optgroup label="Saved sessions">{sessions.map(item => <option key={item.sessionId} value={'session:' + item.sessionId}>{item.name}</option>)}</optgroup>}
              {runs.length > 0 && <optgroup label="All analysis runs">{runs.map(item => <option key={item.runId} value={'run:' + item.runId}>
                {sources.find(image => image.sourceId === item.sourceId)?.name ?? 'Local image'} · {item.objectCount} nuclei · {new Date(item.createdAt).toLocaleString()}
              </option>)}</optgroup>}
            </select>
          </label>
          <button type="button" disabled={locked || !openKey} className="wide" onClick={() => void reopen()}>Reopen</button>
        </section>
      </aside>

      <div className="center">
        <section className="panel view-panel" id="image" tabIndex={-1} aria-label="Image workspace">
          <div className="panel-header">
            <div className="source-title"><h2>Image workspace</h2>{source && <p title={source.name}>{source.name}</p>}</div>
            {source?.isSynthetic && <span className="demo-tag">Demo / synthetic</span>}
            {source && !source.isSynthetic && <span className="scope-tag">Research review</span>}
          </div>
          {error && <div role="alert" className="alert"><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
          <div className="workspace-status" role="status">{message}</div>
          {source && series && viewReady
            ? <Viewer key={[source.sourceId, series.index, selection.tIndex, selection.zIndex, selection.nuclearChannel].join(':')}
              source={source} series={series} selection={selection} objects={objects} selected={selected} reveal={reveal}
              onSelect={id => { if (locked) return; if (!visible.some(item => item.objectId === id)) setFilter('all'); select(id, false); }} />
            : <div className="empty-stage">
              <div className="reticle" aria-hidden="true"><b/><i/><em/></div>
              <h3>{source ? 'Choose an image plane' : 'Open a microscopy image'}</h3>
              <p>{source ? 'Select a supported series and confirm its axes to see the image.' : 'Import a TIFF, or explore the full review workflow with the built-in synthetic field.'}</p>
              {!source && <button className="primary" type="button" disabled={locked} onClick={() => void importImage()}>Open demo field</button>}
            </div>}
        </section>

        <section className="panel queue-panel" id="review" aria-labelledby="queue-title">
          <div className="panel-header">
            <div><h2 id="queue-title">Review queue</h2><p>{currentRun ? visible.length + ' of ' + objects.length + ' nuclei' : 'Analyze an image plane to populate the queue.'}</p></div>
            {currentRun && <label className="inline-field">Filter
              <select value={filter} onChange={event => { setFilter(event.target.value as Filter); setSelectedId(null); setReveal(value => value + 1); }}>
                {FILTERS.map(item => <option key={item.key} value={item.key}>{item.label} ({filterCounts[item.key]})</option>)}
              </select>
            </label>}
          </div>
          {currentRun && <>
            {visible.length > 0 ? <div className="table-scroll" ref={queue}>
              <table>
                <thead><tr><th scope="col">Nucleus</th><th scope="col">Suggestion</th><th scope="col">Reviewed label</th><th scope="col">Status</th><th scope="col">Signal</th></tr></thead>
                <tbody>{visible.map(item => <tr key={item.objectId} className={selected?.objectId === item.objectId ? 'selected-row' : ''}>
                  <th scope="row"><button className="row-button" aria-current={selected?.objectId === item.objectId ? 'true' : undefined} disabled={locked} onClick={() => select(item.objectId)}>Nucleus {String(item.maskLabel).padStart(2, '0')}</button></th>
                  <td>{item.suggestion.suggestedLabel}</td>
                  <td>{item.review.reviewedLabel ?? '—'}</td>
                  <td><Status value={item.review.reviewStatus} /></td>
                  <td className="mono">{formatNumber(item.integratedSignal, 0)}</td>
                </tr>)}</tbody>
              </table>
            </div> : <p className="queue-empty">No nuclei match this filter.</p>}
            <div className="queue-footer">
              <span className="small muted">Previous / next <kbd>K</kbd> <kbd>J</kbd></span>
              <div className="button-pair">
                <button type="button" disabled={locked || selectedIndex <= 0} onClick={() => move(-1)}>Previous</button>
                <button type="button" disabled={locked || selectedIndex < 0 || selectedIndex >= visible.length - 1} onClick={() => move(1)}>Next</button>
              </div>
            </div>
          </>}
        </section>
      </div>

      <aside className="rail inspector" aria-label="Selected nucleus and exports">
        <section className="panel" aria-labelledby="inspector-title">
          <div className="panel-header"><h2 id="inspector-title">Nucleus inspector</h2></div>
          {selected && currentRun
            ? <Inspector key={selected.objectId} object={selected} mode={currentRun.selection.mode} busy={locked} onReview={changeReview} />
            : <p className="inspector-placeholder muted">Select a mask or choose a nucleus in the review queue.</p>}
        </section>
        <section className="panel settings" id="export">
          <h2>Export records</h2>
          <p className="small muted">{currentRun ? visible.length + ' rows in the current filter. CSV and JSON use the same selection.' : 'Run analysis to export nuclei and their review decisions.'}</p>
          <div className="button-pair">
            {(['csv', 'json'] as const).map(format => currentRun && !locked
              ? <a key={format} className="button" download href={endpoint('runs/' + currentRun.runId + '/export?format=' + format + '&scope=' + filter)}>Download {format.toUpperCase()}</a>
              : <button key={format} disabled>Download {format.toUpperCase()}</button>)}
          </div>
        </section>
      </aside>
    </main>
    <footer className="app-footer"><span>SortACell 0.1.0</span><span>Phase suggestions are unvalidated and require review.</span></footer>
  </div>;
}
