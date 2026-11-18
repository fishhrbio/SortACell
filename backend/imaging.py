"""Bounded TIFF reader and deterministic synthetic fixture. Source files are never edited."""

import hashlib
import io
import math
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image
from skimage.draw import ellipse

MAX_UPLOAD = 64 * 1024**2
MAX_DECODED = 128 * 1024**2
MAX_PLANE = 4_000_000


def digest(data):
    return hashlib.sha256(data).hexdigest()


def inspect(path: Path):
    result = []
    with tifffile.TiffFile(path, _multifile=False) as tif:
        images = []
        if tif.ome_metadata:
            root = ET.fromstring(tif.ome_metadata)
            if root.find("{*}BinaryOnly") is not None:
                raise ValueError(
                    "External OME metadata is unsupported. Export one self-contained OME-TIFF."
                )
            root_uuid = root.get("UUID")
            if any(node.text != root_uuid for node in root.findall(".//{*}TiffData/{*}UUID")):
                raise ValueError(
                    "Multi-file OME-TIFF is unsupported. Export one self-contained OME-TIFF."
                )
            images = root.findall("{*}Image")
        for index, series in enumerate(tif.series):
            axes, shape = series.axes, list(series.shape)
            sizes = dict(zip(axes, shape, strict=True))
            errors = []
            if (
                len(set(axes)) != len(axes)
                or any(a not in "TCZYX" for a in axes)
                or not axes.endswith("YX")
            ):
                errors.append(
                    f"Unsupported axes {axes}; supported axes are T/C/Z followed by YX. RGB/sample and ambiguous stacks are not quantitative channel maps."
                )
            if series.dtype.kind not in "uif" or series.dtype.itemsize > 8:
                errors.append("Only real numeric grayscale samples are supported.")
            if math.prod(shape) * series.dtype.itemsize > MAX_DECODED:
                errors.append(
                    "Series exceeds the 128 MiB decoded limit; export a smaller field first."
                )
            if sizes.get("Y", 0) * sizes.get("X", 0) > MAX_PLANE:
                errors.append("Plane exceeds 4 million pixels; tiling is not supported yet.")
            pixels = images[index].find("{*}Pixels") if index < len(images) else None
            channels = pixels.findall("{*}Channel") if pixels is not None else []
            names = [c.get("Name") or c.get("ID") for c in channels]
            count = sizes.get("C", 1)
            names = [names[c] if c < len(names) else f"Channel {c}" for c in range(count)]
            scale = None
            if pixels is not None and pixels.get("PhysicalSizeX"):
                try:
                    sx = float(pixels.get("PhysicalSizeX"))
                    sy = float(pixels.get("PhysicalSizeY", pixels.get("PhysicalSizeX")))
                    if all(math.isfinite(v) and v > 0 for v in [sx, sy]):
                        scale = {"x": sx, "y": sy, "unit": pixels.get("PhysicalSizeXUnit", "µm")}
                except ValueError:
                    pass
            result.append(
                {
                    "index": index,
                    "axes": axes,
                    "shape": shape,
                    "sizes": sizes,
                    "dtype": str(series.dtype),
                    "channels": names,
                    "pixelSize": scale,
                    "supported": not errors,
                    "issues": errors,
                    "requiresAxisConfirmation": not tif.is_ome,
                }
            )
        if not result:
            raise ValueError("TIFF contains no image series.")
        return {"format": "OME-TIFF" if tif.is_ome else "TIFF", "series": result}


def verify_source(path, source):
    try:
        with Path(path).open("rb") as stream:
            sha = hashlib.file_digest(stream, "sha256").hexdigest()
    except OSError as exc:
        raise ValueError(
            "Source file is missing or unreadable. Restore the full workspace backup."
        ) from exc
    if sha != source["sha256"]:
        raise ValueError("Source hash mismatch. Restore the immutable source before continuing.")


def validate_selection(source, selection):
    si = selection["seriesIndex"]
    if si < 0 or si >= len(source["series"]):
        raise ValueError("Choose an existing image series.")
    meta = source["series"][si]
    if not meta["supported"]:
        raise ValueError(" ".join(meta["issues"]))
    if meta["requiresAxisConfirmation"] and not selection.get("confirmAxes"):
        raise ValueError("Confirm the displayed TIFF axes before analysis or preview.")
    for axis, key in [("T", "tIndex"), ("Z", "zIndex"), ("C", "nuclearChannel")]:
        n = selection.get(key)
        if n is None or n < 0 or n >= meta["sizes"].get(axis, 1):
            raise ValueError(f"Map a valid {axis} index ({key}).")
    marker = selection.get("markerChannel")
    if marker is not None and (marker < 0 or marker >= meta["sizes"].get("C", 1)):
        raise ValueError("The mapped marker channel does not exist.")
    if selection.get("mode") == "marker" and (
        marker is None or marker == selection["nuclearChannel"]
    ):
        raise ValueError("Marker review requires a separate mapped marker channel.")
    return meta


def plane(path, source, selection, channel=None):
    meta = validate_selection(source, selection)
    verify_source(path, source)
    with tifffile.TiffFile(path, _multifile=False) as tif:
        data = tif.series[selection["seriesIndex"]].asarray()
    indices = {
        "T": selection["tIndex"],
        "Z": selection["zIndex"],
        "C": selection["nuclearChannel"] if channel is None else channel,
    }
    if channel is not None and not 0 <= channel < meta["sizes"].get("C", 1):
        raise ValueError("Display channel does not exist.")
    data = data[tuple(slice(None) if a in "YX" else indices[a] for a in meta["axes"])]
    if data.ndim != 2 or not np.isfinite(data).all():
        raise ValueError("Selected plane must be finite 2D grayscale data.")
    return data


def preview(data):
    lo, hi = np.percentile(data, [1, 99.8])
    scaled = np.clip((data.astype(float) - lo) / max(float(hi - lo), 1) * 255, 0, 255).astype(
        np.uint8
    )
    buffer = io.BytesIO()
    Image.fromarray(scaled).save(buffer, format="PNG")
    return buffer.getvalue()


def synthetic():
    """Seeded two-channel 512px field, deliberately including one saturated nucleus."""
    rng = np.random.default_rng(42)
    data = rng.normal(450, 55, (2, 512, 512)).clip(0).astype(np.float64)
    truth = np.zeros((512, 512), dtype=np.uint16)
    for i in range(48):
        row, col = divmod(i, 8)
        cy, cx = 42 + row * 82 + rng.integers(-10, 10), 32 + col * 64 + rng.integers(-8, 8)
        ry, rx = int(rng.integers(12, 18)), int(rng.integers(10, 15))
        yy, xx = ellipse(cy, cx, ry, rx, shape=truth.shape)
        truth[yy, xx] = i + 1
        signal = [8_000, 12_000, 16_000, 10_000][i % 4]
        texture = rng.normal(1, 0.08, len(yy))
        data[0, yy, xx] += signal * texture
        data[1, yy, xx] += (7000 if i % 3 == 0 else 900) * texture
        if i == 47:
            data[0, yy, xx] = 65535
    buffer = io.BytesIO()
    tifffile.imwrite(
        buffer,
        np.clip(data, 0, 65535).astype(np.uint16),
        ome=True,
        photometric="minisblack",
        metadata={
            "UUID": "urn:uuid:637e7c83-4493-4db2-aaf7-000000000042",
            "axes": "CYX",
            "Channel": {"Name": ["Synthetic DNA", "Synthetic marker"]},
            "PhysicalSizeX": 0.325,
            "PhysicalSizeY": 0.325,
            "PhysicalSizeXUnit": "µm",
            "PhysicalSizeYUnit": "µm",
        },
    )
    return buffer.getvalue(), truth
