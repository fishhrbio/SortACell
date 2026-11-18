import { memo, useEffect, useEffectEvent, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatNumber, previewUrl, type Nucleus, type Point, type Selection, type Series, type Source } from './api';

interface Props {
  source: Source;
  selection: Selection;
  series: Series;
  objects: Nucleus[];
  selected: Nucleus | null;
  reveal: number;
  onSelect: (id: string) => void;
}

function Viewer({ source, selection, series, objects, selected, reveal, onSelect }: Props) {
  const [channel, setChannel] = useState(selection.nuclearChannel ?? 0);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<Point | null>(null);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [showMasks, setShowMasks] = useState(true);
  const [showImage, setShowImage] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const surface = useRef<SVGSVGElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; center: Point; moved: boolean } | null>(null);
  const skipClick = useRef(false);
  const width = series.sizes.X;
  const height = series.sizes.Y;
  const position = center ?? [width / 2, height / 2];
  const url = previewUrl(source, selection, channel);

  const centerSelected = useEffectEvent(() => {
    if (selected) setCenter(zoom === 1 ? null : [selected.centroidPx[0] + .5, selected.centroidPx[1] + .5]);
  });
  useEffect(() => { centerSelected(); }, [reveal]);

  function selectChannel(next: number) {
    if (next === channel) return;
    setChannel(next);
    setImageError(false);
    setImageLoading(true);
  }

  function changeZoom(factor: number) {
    const next = Math.max(1, Math.min(8, zoom * factor));
    setZoom(next);
    setCenter(next === 1 ? null : selected ? [selected.centroidPx[0] + .5, selected.centroidPx[1] + .5] : position);
  }

  function fit() { setZoom(1); setCenter(null); }

  function panBy(dx: number, dy: number) {
    setCenter([Math.max(0, Math.min(width, position[0] + dx)), Math.max(0, Math.min(height, position[1] + dy))]);
  }

  function keyboard(event: KeyboardEvent<SVGSVGElement>) {
    const step = Math.max(width, height) / zoom / 15;
    if (event.key === '+' || event.key === '=') changeZoom(1.25);
    else if (event.key === '-') changeZoom(.8);
    else if (event.key === '0') fit();
    else if (event.key === 'ArrowLeft') panBy(-step, 0);
    else if (event.key === 'ArrowRight') panBy(step, 0);
    else if (event.key === 'ArrowUp') panBy(0, -step);
    else if (event.key === 'ArrowDown') panBy(0, step);
    else return;
    event.preventDefault();
  }

  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    skipClick.current = false;
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, center: position, moved: false };
  }

  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const state = drag.current;
    const node = surface.current;
    if (!node || !state || state.pointer !== event.pointerId || !event.buttons) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.moved && Math.hypot(dx, dy) < 5) return;
    state.moved = true;
    skipClick.current = true;
    node.setPointerCapture(event.pointerId);
    const box = node.getBoundingClientRect();
    const units = Math.max(width / box.width, height / box.height) / zoom;
    setCenter([
      Math.max(0, Math.min(width, state.center[0] - dx * units)),
      Math.max(0, Math.min(height, state.center[1] - dy * units)),
    ]);
  }

  const viewWidth = width / zoom;
  const viewHeight = height / zoom;
  const viewBox = [position[0] - viewWidth / 2, position[1] - viewHeight / 2, viewWidth, viewHeight].join(' ');
  const scale = series.pixelSize;
  const maskPaths = useMemo(() => objects.map(object => object.outlines.map(outline => outline.length
    ? 'M' + outline.map(([x, y]) => (x + .5) + ',' + (y + .5)).join('L') + 'Z' : '').join(' ')), [objects]);

  return <>
    <div className="viewport-tools">
      <label className="inline-field">Display channel
        <select value={channel} onChange={event => selectChannel(Number(event.target.value))}>
          {series.channels.map((name, index) => <option key={index} value={index}>{index} · {name}</option>)}
        </select>
      </label>
      <div className="zoom-tools" aria-label="Zoom controls">
        <button type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => changeZoom(.8)}>−</button>
        <button type="button" onClick={fit} title="Reset zoom and pan">Fit</button>
        <button type="button" aria-label="Zoom in" disabled={zoom >= 8} onClick={() => changeZoom(1.25)}>+</button>
        <output className="mono zoom-value" aria-label="Zoom level">{Math.round(zoom * 100)}%</output>
      </div>
    </div>
    <div className="image-stage">
      <svg ref={surface} tabIndex={0} role="group" aria-label="Microscopy image. Drag or use arrow keys to pan. Plus and minus zoom. Zero fits."
        className="micrograph" viewBox={viewBox} onKeyDown={keyboard}
        onPointerDown={pointerDown} onPointerMove={pointerMove}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <rect width={width} height={height} fill="#06080d" />
        <image key={url} href={url} width={width} height={height} opacity={showImage ? 1 : 0}
          onLoad={() => setImageLoading(false)}
          onError={() => { setImageError(true); setImageLoading(false); }}
          style={{ filter: 'brightness(' + brightness + '%) contrast(' + contrast + '%)' }} />
        {showMasks && objects.map((object, index) => <path key={object.objectId} data-mask={object.maskLabel}
          className={'mask' + (selected?.objectId === object.objectId ? ' mask-selected' : '')}
          d={maskPaths[index]} fillRule="evenodd" vectorEffect="non-scaling-stroke"
          onClick={() => { if (!skipClick.current) onSelect(object.objectId); }}>
          <title>Nucleus {object.maskLabel}</title>
        </path>)}
        {showMasks && selected && <g className="mask-tag" aria-hidden="true">
          <circle cx={selected.centroidPx[0] + .5} cy={selected.centroidPx[1] + .5} r={2.4 / zoom} />
        </g>}
      </svg>
      {imageLoading && <p className="image-message" role="status">Rendering image preview…</p>}
      {imageError && <p className="image-message" role="alert">Preview unavailable. Check the TIFF encoding or try another channel.</p>}
    </div>
    <div className="display-tools">
      <label><input type="checkbox" checked={showImage} onChange={event => setShowImage(event.target.checked)} /> Image</label>
      <label><input type="checkbox" checked={showMasks} onChange={event => setShowMasks(event.target.checked)} /> Masks</label>
      <label className="slider">Brightness <input type="range" min="50" max="200" value={brightness} onChange={event => setBrightness(Number(event.target.value))} /></label>
      <label className="slider">Contrast <input type="range" min="50" max="200" value={contrast} onChange={event => setContrast(Number(event.target.value))} /></label>
    </div>
    <div className="image-meta mono">
      <span>{width} × {height} px · {series.dtype}</span>
      <span>{scale ? formatNumber(scale.x, 4) + ' × ' + formatNumber(scale.y, 4) + ' ' + scale.unit + '/px' : 'Pixel scale unavailable'}</span>
      <span>Series {selection.seriesIndex} / T{selection.tIndex} / Z{selection.zIndex}</span>
    </div>
  </>;
}

export default memo(Viewer);
