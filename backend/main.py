"""Loopback-only application, durable runs, cancellable jobs, and reproducible exports."""

import csv
import io
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4

import numpy as np
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import analysis, imaging
from .store import Store

ROOT = Path(__file__).resolve().parents[1]


class Selection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    seriesIndex: int = 0
    tIndex: int = 0
    zIndex: int = 0
    nuclearChannel: int | None = None
    markerChannel: int | None = None
    mode: Literal["dna", "marker", "manual"] = "dna"
    confirmAxes: bool = False


class RunRequest(BaseModel):
    sourceId: str
    selection: Selection
    calibrationId: str | None = None


class ReviewRequest(BaseModel):
    action: Literal["accept", "correct", "exclude", "undo"]
    label: str | None = None
    reason: str | None = Field(default=None, max_length=2000)


class CalibrationRequest(RunRequest):
    g1Reference: float = Field(gt=0, allow_inf_nan=False)
    datasetScope: str = Field(min_length=3, max_length=500)
    provenance: str = Field(min_length=3, max_length=2000)
    quantitativeConfirmed: bool


class SessionRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    runId: str
    selectedObjectId: str | None = None
    filter: str = "all"


FILTERS = {"all", "uncertain", "unreviewed", "accepted", "corrected", "excluded", "reviewed"}


def filtered(objects, scope):
    if scope not in FILTERS:
        raise ValueError("Unknown review filter.")
    if scope == "all":
        return objects
    if scope == "uncertain":
        return [
            o
            for o in objects
            if (o["review"]["reviewedLabel"] or o["suggestion"]["suggestedLabel"]) == "uncertain"
        ]
    if scope == "reviewed":
        return [o for o in objects if o["review"]["reviewStatus"] != "unreviewed"]
    return [o for o in objects if o["review"]["reviewStatus"] == scope]


def create_app(data_dir=None):
    store = Store(Path(data_dir or os.environ.get("SORTACELL_DATA_DIR", ROOT / ".sortacell")))
    jobs = {}
    job_lock = threading.RLock()
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="sortacell")

    @asynccontextmanager
    async def lifespan(_app):
        yield
        with job_lock:
            for job in jobs.values():
                if job["status"] in ["queued", "running"]:
                    job["cancel"].set()
        executor.shutdown(wait=True)

    app = FastAPI(
        title="SortACell",
        version="0.1.0",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.add_middleware(
        TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "[::1]", "testserver"]
    )
    app.state.store, app.state.jobs, app.state.executor = store, jobs, executor

    @app.middleware("http")
    async def local_access(request: Request, call_next):
        origin = request.headers.get("origin")
        allowed = {
            "http://127.0.0.1:8000",
            "http://localhost:8000",
            "http://127.0.0.1:5173",
            "http://localhost:5173",
        }
        if origin and origin not in allowed:
            return Response("Cross-origin access is not permitted.", status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        if request.url.path == "/":
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
            )
        return response

    @app.exception_handler(KeyError)
    async def not_found(_request, exc):
        return Response(
            json.dumps({"detail": str(exc)}), status_code=404, media_type="application/json"
        )

    @app.exception_handler(ValueError)
    async def invalid(_request, exc):
        return Response(
            json.dumps({"detail": str(exc)}), status_code=422, media_type="application/json"
        )

    def source_path(source):
        return store.root / source["relativeProjectPath"]

    def register(data, filename, synthetic=False):
        sha = imaging.digest(data)
        source_id = "src-" + sha
        with store.lock:
            try:
                return {**store.get("source", source_id), "duplicate": True}
            except KeyError:
                pass
            path = store.root / "sources" / (sha + ".tiff")
            path.write_bytes(data)
            try:
                metadata = imaging.inspect(path)
            except ValueError:
                path.unlink(missing_ok=True)
                raise
            except Exception as exc:
                path.unlink(missing_ok=True)
                raise ValueError(
                    "Cannot inspect TIFF. Use a self-contained OME-TIFF or grayscale TIFF."
                ) from exc
            source = {
                "sourceId": source_id,
                "name": Path(filename.replace("\\", "/")).name,
                "sha256": sha,
                "relativeProjectPath": f"sources/{sha}.tiff",
                "isSynthetic": synthetic,
                "createdAt": analysis.now(),
                **metadata,
            }
            store.put("source", source_id, source)
            return {**source, "duplicate": False}

    @app.get("/api/health")
    def health():
        return {
            "status": "ok",
            "name": "SortACell",
            "version": "0.1.0",
            "storage": "local",
            "scientificValidation": "unvalidated",
        }

    @app.get("/api/sources")
    def sources():
        return store.all("source")

    @app.post("/api/imports")
    async def import_file(file: Annotated[UploadFile, File()]):
        if not (file.filename or "").lower().endswith((".tif", ".tiff")):
            raise HTTPException(
                415,
                "Use .tif/.tiff (including .ome.tif/.ome.tiff). OMERO is a server platform, not a universal file format.",
            )
        chunks, total = [], 0
        while chunk := await file.read(1024 * 1024):
            total += len(chunk)
            if total > imaging.MAX_UPLOAD:
                raise HTTPException(413, "TIFF upload exceeds the 64 MiB limit.")
            chunks.append(chunk)
        return register(b"".join(chunks), file.filename)

    @app.post("/api/demo")
    def demo():
        data, truth = imaging.synthetic()
        source = register(data, "SortACell-synthetic.ome.tiff", synthetic=True)
        with store.lock:
            if source["isSynthetic"]:
                truth_path = "sources/" + source["sha256"] + "-truth.npy"
                np.save(store.root / truth_path, truth, allow_pickle=False)
                source.update(
                    groundTruthPath=truth_path,
                    generator={
                        "version": "grid-ellipses-v1",
                        "seed": 42,
                        "objectCount": 48,
                        "shape": [2, 512, 512],
                        "nuclearChannel": 0,
                        "markerChannel": 1,
                        "backgroundMean": 450,
                        "backgroundStd": 55,
                        "signalLevels": [8000, 12000, 16000, 10000],
                        "saturatedObject": 48,
                    },
                )
                store.put(
                    "source",
                    source["sourceId"],
                    {k: v for k, v in source.items() if k != "duplicate"},
                )
        return source

    @app.get("/api/sources/{source_id}")
    def source_metadata(source_id: str):
        return store.get("source", source_id)

    @app.get("/api/sources/{source_id}/preview")
    def preview(
        source_id: str,
        series: int = 0,
        t: int = 0,
        z: int = 0,
        channel: int = 0,
        confirm: bool = False,
    ):
        source = store.get("source", source_id)
        selection = {
            "seriesIndex": series,
            "tIndex": t,
            "zIndex": z,
            "nuclearChannel": channel,
            "confirmAxes": confirm,
        }
        data = imaging.plane(source_path(source), source, selection)
        return Response(imaging.preview(data), media_type="image/png")

    @app.get("/api/calibrations")
    def calibrations():
        return store.all("calibration")

    @app.post("/api/calibrations")
    def calibration(body: CalibrationRequest):
        source = store.get("source", body.sourceId)
        selection = body.selection.model_dump()
        imaging.validate_selection(source, selection)
        if not body.quantitativeConfirmed or selection["mode"] != "dna":
            raise ValueError("Confirm quantitative DNA-image suitability and use the DNA preset.")
        record = {
            "id": "cal-" + uuid4().hex,
            "mode": "dna",
            "version": "1",
            "syntheticOnly": source["isSynthetic"],
            "fingerprint": analysis.fingerprint(source, selection),
            "sourceSha256": source["sha256"],
            "selection": selection,
            "g1Reference": body.g1Reference,
            "datasetScope": body.datasetScope,
            "provenance": body.provenance,
            "validationState": "unvalidated",
            "qualityPolicy": "uncertain for border, saturation >1%, touching/irregular suspicion",
            "ruleReference": "dna-window-v1",
            "createdAt": analysis.now(),
        }
        return store.put("calibration", record["id"], record)

    def public_job(job):
        return {k: v for k, v in job.items() if k != "cancel"}

    def worker(job_id, source, selection, calibration):
        job = jobs[job_id]
        with job_lock:
            if job["cancel"].is_set():
                job.update(status="cancelled", message="Cancelled before analysis")
                return
            job.update(status="running", message="Starting local analysis")

        def progress(percent, message):
            with job_lock:
                job.update(progress=percent, message=message)

        mask_path = store.root / "masks" / (job["runId"] + ".npy")
        try:
            run, masks = analysis.analyze(
                source,
                source_path(source),
                selection,
                job["runId"],
                job["cancel"],
                calibration,
                progress,
            )
            with job_lock:
                analysis.check(job["cancel"])
                np.save(mask_path, masks, allow_pickle=False)
                run["maskPath"] = "masks/" + mask_path.name
                store.put("run", run["runId"], run)
                job.update(status="finished", progress=100, message="Ready for review")
        except analysis.Cancelled:
            mask_path.unlink(missing_ok=True)
            with job_lock:
                job.update(status="cancelled", message="Cancelled; previous runs preserved")
        except Exception as exc:  # noqa: BLE001 - Job boundary must expose arbitrary worker failures.
            mask_path.unlink(missing_ok=True)
            with job_lock:
                job.update(status="failed", message=str(exc)[:1000])

    @app.post("/api/runs", status_code=202)
    def run_analysis(body: RunRequest):
        source = store.get("source", body.sourceId)
        selection = body.selection.model_dump()
        imaging.validate_selection(source, selection)
        calibration = store.get("calibration", body.calibrationId) if body.calibrationId else None
        if calibration:
            if calibration["syntheticOnly"] and not source["isSynthetic"]:
                raise ValueError("Synthetic calibration cannot be applied to a real image.")
            if calibration["fingerprint"] != analysis.fingerprint(source, selection):
                raise ValueError("Calibration does not match this source and selection.")
        with job_lock:
            if sum(j["status"] in ["queued", "running"] for j in jobs.values()) >= 2:
                raise HTTPException(409, "Analysis queue is full. Wait or cancel the active job.")
            job_id, run_id = "job-" + uuid4().hex, "run-" + uuid4().hex
            job = {
                "jobId": job_id,
                "runId": run_id,
                "status": "queued",
                "progress": 0,
                "message": "Queued",
                "cancel": threading.Event(),
            }
            jobs[job_id] = job
        executor.submit(worker, job_id, source, selection, calibration)
        return public_job(job)

    @app.get("/api/jobs/{job_id}")
    def job_status(job_id: str):
        with job_lock:
            if job_id not in jobs:
                raise KeyError(
                    "Job no longer exists; jobs are ephemeral across server restarts. Saved runs remain available."
                )
            return public_job(jobs[job_id])

    @app.post("/api/jobs/{job_id}/cancel")
    def cancel_job(job_id: str):
        with job_lock:
            if job_id not in jobs:
                raise KeyError("Job not found")
            job = jobs[job_id]
            if job["status"] in ["queued", "running"]:
                job["cancel"].set()
                job["message"] = "Cancellation requested"
            return public_job(job)

    @app.get("/api/runs")
    def list_runs():
        return [
            {k: v for k, v in r.items() if k != "objects"} | {"objectCount": len(r["objects"])}
            for r in store.all("run")
        ]

    @app.get("/api/runs/{run_id}")
    def run(run_id: str):
        return store.get("run", run_id)

    @app.patch("/api/runs/{run_id}/objects/{mask_label}/review")
    def review(run_id: str, mask_label: int, body: ReviewRequest):
        with store.lock:
            run = store.get("run", run_id)
            obj = next((o for o in run["objects"] if o["maskLabel"] == mask_label), None)
            if obj is None:
                raise KeyError("Object not found")
            current = obj["review"]
            history = current["history"]
            before = {k: v for k, v in current.items() if k != "history"}
            if body.action == "undo":
                target = next(
                    (h for h in reversed(history) if h["action"] != "undo" and not h.get("undone")),
                    None,
                )
                if target is None:
                    raise ValueError("No review decision to undo.")
                target["undone"] = True
                current.update(target["before"])
            else:
                label = (
                    obj["suggestion"]["suggestedLabel"] if body.action == "accept" else body.label
                )
                if body.action == "exclude":
                    if not body.reason or not body.reason.strip():
                        raise ValueError("An exclusion reason is required.")
                    label = "excluded"
                if label not in analysis.LABELS[run["selection"]["mode"]] or (
                    label == "excluded" and body.action != "exclude"
                ):
                    raise ValueError(
                        "Choose a label supported by this capability preset; use Exclude with a reason for exclusion."
                    )
                current.update(
                    reviewedLabel=label,
                    reviewStatus={
                        "accept": "accepted",
                        "correct": "corrected",
                        "exclude": "excluded",
                    }[body.action],
                    exclusionReason=body.reason if body.action == "exclude" else None,
                    reviewedAt=analysis.now(),
                )
            history.append(
                {
                    "action": body.action,
                    "at": analysis.now(),
                    "before": before,
                    "after": {k: v for k, v in current.items() if k != "history"},
                }
            )
            store.put("run", run_id, run)
            return obj

    @app.get("/api/sessions")
    def sessions():
        return store.all("session")

    @app.post("/api/sessions")
    def save_session(body: SessionRequest):
        run = store.get("run", body.runId)
        if body.filter not in FILTERS:
            raise ValueError("Unknown filter.")
        if body.selectedObjectId is not None and not any(
            o["objectId"] == body.selectedObjectId for o in run["objects"]
        ):
            raise ValueError("Selected object does not belong to this run.")
        record = {
            "sessionId": "session-" + uuid4().hex,
            "createdAt": analysis.now(),
            "sourceId": run["sourceId"],
            **body.model_dump(),
        }
        return store.put("session", record["sessionId"], record)

    @app.get("/api/sessions/{session_id}")
    def open_session(session_id: str):
        record = store.get("session", session_id)
        run = store.get("run", record["runId"])
        source = store.get("source", record["sourceId"])
        imaging.verify_source(source_path(source), source)
        if not (store.root / run["maskPath"]).is_file():
            raise ValueError(
                "Saved segmentation mask is missing. Restore the full workspace backup."
            )
        return {"session": record, "run": run, "source": source}

    @app.get("/api/runs/{run_id}/export")
    def export(run_id: str, format: Literal["csv", "json"] = "csv", scope: str = "all"):
        run = store.get("run", run_id)
        source = store.get("source", run["sourceId"])
        objects = filtered(run["objects"], scope)
        if format == "json":
            document = {
                "schemaVersion": 1,
                "application": "SortACell 0.1.0",
                "exportedAt": analysis.now(),
                "exportFilter": scope,
                "rowCount": len(objects),
                "source": source,
                "run": {k: v for k, v in run.items() if k != "objects"},
                "units": {
                    "areaPx": "pixel²",
                    "integratedSignal": "sum(max(raw-background,0)); instrument units",
                    "centroidPx": "pixel; x,y",
                },
                "csvEscaping": "Text with leading =,+,-,@ or control whitespace is apostrophe-prefixed; escaped_fields identifies altered fields. Exact originals are retained in this JSON.",
                "objects": objects,
            }
            return Response(
                json.dumps(document, ensure_ascii=False, allow_nan=False, indent=2),
                media_type="application/json",
                headers={"Content-Disposition": f'attachment; filename="SortACell-{run_id}.json"'},
            )
        columns = [
            "source_id",
            "source_sha256",
            "series_index",
            "t_index",
            "z_index",
            "channel_selection",
            "run_id",
            "object_id",
            "centroid_x_px",
            "centroid_y_px",
            "area_px",
            "integrated_signal",
            "mean_signal",
            "background_estimate",
            "marker_mean",
            "saturation_fraction",
            "suggested_label",
            "reviewed_label",
            "review_status",
            "quality_flags",
            "exclusion_reason",
            "score",
            "score_kind",
            "calibration_id",
            "strategy_version",
            "is_synthetic",
            "escaped_fields",
        ]
        output = io.StringIO(newline="")
        writer = csv.DictWriter(output, fieldnames=columns)
        writer.writeheader()
        for o in objects:
            r, s, sel = o["review"], o["suggestion"], run["selection"]
            row = {
                "source_id": source["sourceId"],
                "source_sha256": source["sha256"],
                "series_index": sel["seriesIndex"],
                "t_index": sel["tIndex"],
                "z_index": sel["zIndex"],
                "channel_selection": json.dumps(
                    {"nuclear": sel["nuclearChannel"], "marker": sel["markerChannel"]}
                ),
                "run_id": run_id,
                "object_id": o["objectId"],
                "centroid_x_px": o["centroidPx"][0],
                "centroid_y_px": o["centroidPx"][1],
                "area_px": o["areaPx"],
                "integrated_signal": o["integratedSignal"],
                "mean_signal": o["meanSignal"],
                "background_estimate": o["backgroundEstimate"],
                "marker_mean": o["markerMean"],
                "saturation_fraction": o["saturationFraction"],
                "suggested_label": s["suggestedLabel"],
                "reviewed_label": r["reviewedLabel"],
                "review_status": r["reviewStatus"],
                "quality_flags": ";".join(o["qualityFlags"]),
                "exclusion_reason": r["exclusionReason"],
                "score": s["score"],
                "score_kind": s["scoreKind"],
                "calibration_id": run["calibrationId"],
                "strategy_version": run["labelStrategyVersion"],
                "is_synthetic": run["isSynthetic"],
            }
            escaped = []
            for key, value in row.items():
                if (
                    isinstance(value, str)
                    and value
                    and (
                        value[0] in "=+-@\t\r\n" or value.lstrip().startswith(("=", "+", "-", "@"))
                    )
                ):
                    row[key] = "'" + value
                    escaped.append(key)
            row["escaped_fields"] = ";".join(escaped)
            writer.writerow(row)
        return Response(
            output.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="SortACell-{run_id}.csv"'},
        )

    dist = ROOT / "frontend" / "dist"
    if (dist / "assets").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/")
    def index():
        if not (dist / "index.html").exists():
            return Response(
                "Build the frontend first: cd frontend && pnpm install --frozen-lockfile && pnpm build",
                status_code=503,
            )
        return FileResponse(dist / "index.html")

    return app


app = create_app()
