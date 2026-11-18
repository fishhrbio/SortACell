"""Transparent baseline, without any trained model or calibrated probability."""

from datetime import UTC, datetime
from importlib.metadata import version

import numpy as np
from scipy import ndimage as ndi
from skimage import filters, measure

from .imaging import digest, plane

LABELS = {
    "dna": ["G1-like", "S-like", "G2/M-like", "uncertain", "excluded"],
    "marker": ["positive", "negative", "uncertain", "excluded"],
    "manual": ["class-1", "class-2", "uncertain", "excluded"],
}


def now():
    return datetime.now(UTC).isoformat()


def fingerprint(source, selection):
    import json

    return digest(
        json.dumps(
            {
                "sourceSha256": source["sha256"],
                "selection": selection,
                "measurementVersion": "raw-bg-v1",
            },
            sort_keys=True,
        ).encode()
    )


class Cancelled(Exception):
    pass


def check(cancel):
    if cancel.is_set():
        raise Cancelled()


def analyze(source, path, selection, run_id, cancel, calibration=None, progress=lambda *_: None):
    check(cancel)
    progress(10, "Reading selected plane")
    raw = plane(path, source, selection)
    check(cancel)
    progress(25, "Segmenting nuclei")
    smooth = filters.gaussian(raw, sigma=1, preserve_range=True)
    if float(np.ptp(smooth)) == 0:
        raise ValueError("Selected plane is constant; no segmentation threshold is available.")
    foreground = ndi.binary_fill_holes(smooth > filters.threshold_otsu(smooth))
    labels = measure.label(foreground, connectivity=2)
    counts = np.bincount(labels.ravel())
    keep = counts >= 60
    keep[0] = False
    labels = measure.label(keep[labels], connectivity=2)
    if labels.max() > 5000:
        raise ValueError(
            "More than 5,000 objects; select a smaller field or improve input quality."
        )
    labels = labels.astype(np.uint16)
    check(cancel)
    background = float(np.median(raw[labels == 0])) if np.any(labels == 0) else 0.0
    marker = (
        plane(path, source, selection, selection["markerChannel"])
        if selection.get("markerChannel") is not None
        else None
    )
    regions = measure.regionprops(labels, intensity_image=raw)
    if not regions:
        raise ValueError("No nuclei found with the baseline threshold. Check the nuclear channel.")
    if calibration:
        if calibration.get("syntheticOnly") and not source["isSynthetic"]:
            raise ValueError("Synthetic calibration cannot be applied to a real image.")
        if calibration.get("fingerprint") != fingerprint(source, selection):
            raise ValueError(
                "Calibration does not match this source and exact channel/plane selection."
            )
    objects = []
    signals = [
        float(np.maximum(r.image_intensity[r.image].astype(float) - background, 0).sum())
        for r in regions
    ]
    demo_reference = float(np.percentile(signals, 25))
    median_area = float(np.median([p.area for p in regions]))
    demo_dna_channel = source.get("generator", {}).get("nuclearChannel", 0)
    demo_applicable = source["isSynthetic"] and selection["nuclearChannel"] == demo_dna_channel
    progress(55, "Measuring raw signal and quality")
    for r, signal in zip(regions, signals, strict=True):
        check(cancel)
        values = raw[r.coords[:, 0], r.coords[:, 1]]
        saturation = (
            float(np.mean(values == np.iinfo(raw.dtype).max)) if raw.dtype.kind in "ui" else 0.0
        )
        flags = []
        y0, x0, y1, x1 = r.bbox
        if x0 == 0 or y0 == 0 or x1 == raw.shape[1] or y1 == raw.shape[0]:
            flags.append("border")
        if saturation > 0.01:
            flags.append("saturated")
        if r.solidity < 0.9 or r.area > 2 * median_area:
            flags.append("touching-or-irregular")
        suggested = "uncertain"
        reason = "No dataset calibration. Manual review required."
        mode = selection["mode"]
        if mode != "dna":
            reason = (
                "Manual marker annotation; no biological interpretation assigned."
                if mode == "marker"
                else "Manual annotation preset."
            )
        elif flags:
            reason = "Quality review required: " + ", ".join(flags)
        elif source["isSynthetic"] and not demo_applicable:
            reason = "The selected synthetic channel is not the DNA channel. Map Synthetic DNA for demo phase suggestions."
        elif demo_applicable or calibration:
            reference = calibration["g1Reference"] if calibration else demo_reference
            if reference <= 0:
                raise ValueError("No positive reference signal is available for the DNA rule.")
            ratio = signal / reference
            if 0.8 <= ratio <= 1.2:
                suggested = "G1-like"
            elif 1.2 < ratio < 1.8:
                suggested = "S-like"
            elif 1.8 <= ratio <= 2.2:
                suggested = "G2/M-like"
            reason = (
                ("Demo / synthetic. " if source["isSynthetic"] else "Unvalidated dataset rule. ")
                + f"Background-corrected DNA ratio {ratio:.2f}; rule windows 0.8–1.2 / >1.2–<1.8 / 1.8–2.2."
            )
        contours = measure.find_contours(np.pad(r.image.astype(float), 1), 0.5)
        outline = []
        for contour in contours:
            step = max(1, len(contour) // 100)
            outline.append(
                [
                    [round(float(x + x0 - 1), 2), round(float(y + y0 - 1), 2)]
                    for y, x in contour[::step]
                ]
            )
        objects.append(
            {
                "objectId": f"{source['sourceId']}:s{selection['seriesIndex']}:t{selection['tIndex']}:z{selection['zIndex']}:{run_id}:{r.label}",
                "runId": run_id,
                "maskLabel": int(r.label),
                "centroidPx": [float(r.centroid[1]), float(r.centroid[0])],
                "boundingBoxPx": [x0, y0, x1, y1],
                "areaPx": int(r.area),
                "integratedSignal": signal,
                "backgroundEstimate": background,
                "meanSignal": float(values.mean()),
                "markerMean": float(marker[r.coords[:, 0], r.coords[:, 1]].mean())
                if marker is not None
                else None,
                "saturationFraction": saturation,
                "qualityFlags": flags,
                "outlines": outline,
                "suggestion": {
                    "suggestedLabel": suggested,
                    "score": None,
                    "scoreKind": "none",
                    "reason": reason,
                },
                "review": {
                    "reviewedLabel": None,
                    "reviewStatus": "unreviewed",
                    "exclusionReason": None,
                    "reviewedAt": None,
                    "reviewer": "local",
                    "history": [],
                },
            }
        )
    return {
        "runId": run_id,
        "sourceId": source["sourceId"],
        "selection": selection,
        "analysisDimensionality": 2,
        "measurementStrategy": "single-plane",
        "createdAt": now(),
        "status": "finished",
        "softwareVersions": {
            p: version(p) for p in ["fastapi", "numpy", "scikit-image", "tifffile", "scipy"]
        },
        "segmentationVersion": "gaussian-otsu-components-v1",
        "featureVersion": "raw-bg-v1",
        "labelStrategyVersion": "dna-window-v1" if selection["mode"] == "dna" else "manual-v1",
        "calibrationId": calibration["id"]
        if calibration
        else ("synthetic-only-v1" if demo_applicable and selection["mode"] == "dna" else None),
        "calibration": calibration,
        "isSynthetic": source["isSynthetic"],
        "seed": 42 if source["isSynthetic"] else None,
        "dimensions": [raw.shape[1], raw.shape[0]],
        "warnings": [
            "Synthetic demonstration; no biological accuracy validation."
            if source["isSynthetic"]
            else "Real-data suggestions are unvalidated; review every object."
        ],
        "objects": objects,
    }, labels
