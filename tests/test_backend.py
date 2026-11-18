"""Acceptance checks for the implemented service; these do not validate biology."""

import csv
import io
import threading
import time

import numpy as np
import pytest
import tifffile
from fastapi.testclient import TestClient

from backend import analysis, imaging
from backend.main import create_app


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path / "workspace")
    with TestClient(app) as test_client:
        yield test_client


def selection(**changes):
    return {
        "seriesIndex": 0,
        "tIndex": 0,
        "zIndex": 0,
        "nuclearChannel": 0,
        "markerChannel": None,
        "mode": "dna",
        "confirmAxes": True,
        **changes,
    }


def import_tiff(client, array, **kwargs):
    buffer = io.BytesIO()
    tifffile.imwrite(buffer, array, photometric="minisblack", **kwargs)
    response = client.post(
        "/api/imports", files={"file": ("field.tiff", buffer.getvalue(), "image/tiff")}
    )
    assert response.status_code == 200, response.text
    return response.json(), buffer.getvalue()


def demo(client):
    response = client.post("/api/demo")
    assert response.status_code == 200, response.text
    return response.json()


def wait_job(client, job):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        response = client.get(f"/api/jobs/{job['jobId']}")
        assert response.status_code == 200, response.text
        current = response.json()
        if current["status"] in ["finished", "cancelled", "failed"]:
            return current
        time.sleep(0.01)
    pytest.fail("Local job failed to complete within 20 seconds")


def analyze(client, source, **changes):
    response = client.post(
        "/api/runs", json={"sourceId": source["sourceId"], "selection": selection(**changes)}
    )
    assert response.status_code == 202, response.text
    job = wait_job(client, response.json())
    assert job["status"] == "finished", job
    return client.get(f"/api/runs/{job['runId']}").json()


def review(client, run, obj, **body):
    return client.patch(f"/api/runs/{run['runId']}/objects/{obj['maskLabel']}/review", json=body)


def test_demo_bytes_metadata_and_duplicate_import(client):
    first, truth = imaging.synthetic()
    second, _ = imaging.synthetic()
    assert first == second
    assert set(np.unique(truth)) == set(range(49))
    source = demo(client)
    duplicate = demo(client)
    assert duplicate["sourceId"] == source["sourceId"] and duplicate["duplicate"]
    assert len(client.get("/api/sources").json()) == 1
    meta = source["series"][0]
    assert meta["axes"] == "CYX" and meta["shape"] == [2, 512, 512]
    assert meta["channels"] == ["Synthetic DNA", "Synthetic marker"]
    assert meta["pixelSize"]["x"] == 0.325
    assert meta["dtype"] == "uint16" and source["isSynthetic"]
    assert source["generator"]["seed"] == 42
    saved_truth = np.load(
        client.app.state.store.root / source["groundTruthPath"], allow_pickle=False
    )
    assert np.array_equal(saved_truth, truth)


def test_pipeline_review_undo_session_export_and_source_immutability(client):
    source = demo(client)
    path = client.app.state.store.root / source["relativeProjectPath"]
    before = imaging.digest(path.read_bytes())
    response = client.get(f"/api/sources/{source['sourceId']}/preview", params={"channel": 0})
    assert response.status_code == 200 and response.content.startswith(b"\x89PNG")
    run = analyze(client, source)
    assert len(run["objects"]) >= 40
    assert run["isSynthetic"] and run["calibrationId"] == "synthetic-only-v1"
    masks = np.load(client.app.state.store.root / run["maskPath"], allow_pickle=False)
    assert masks.shape == (512, 512)
    for obj in run["objects"]:
        assert obj["suggestion"]["score"] is None
        assert obj["suggestion"]["scoreKind"] == "none"
        assert int(np.sum(masks == obj["maskLabel"])) == obj["areaPx"]
        assert obj["objectId"].startswith(source["sourceId"] + ":s0:t0:z0:")
    obj = run["objects"][0]
    original = obj["suggestion"]
    assert review(client, run, obj, action="accept").json()["review"]["reviewStatus"] == "accepted"
    corrected = review(client, run, obj, action="correct", label="S-like").json()
    assert corrected["review"]["reviewedLabel"] == "S-like" and corrected["suggestion"] == original
    undone = review(client, run, obj, action="undo").json()
    assert undone["review"]["reviewStatus"] == "accepted" and len(undone["review"]["history"]) == 3
    other = run["objects"][1]
    assert review(client, run, other, action="exclude", reason="touching nuclei").status_code == 200
    saved = client.post(
        "/api/sessions",
        json={
            "name": "Acceptance check",
            "runId": run["runId"],
            "selectedObjectId": obj["objectId"],
            "filter": "reviewed",
        },
    )
    assert saved.status_code == 200, saved.text
    reopened = client.get(f"/api/sessions/{saved.json()['sessionId']}").json()
    assert reopened["run"]["selection"] == run["selection"]
    assert reopened["run"]["objects"][0]["review"]["reviewStatus"] == "accepted"
    assert reopened["source"]["sha256"] == before
    rows = list(
        csv.DictReader(
            io.StringIO(client.get(f"/api/runs/{run['runId']}/export?scope=reviewed").text)
        )
    )
    document = client.get(f"/api/runs/{run['runId']}/export?format=json&scope=reviewed").json()
    assert len(rows) == document["rowCount"] == 2
    assert len(document["objects"]) == 2 and "softwareVersions" in document["run"]
    assert imaging.digest(path.read_bytes()) == before


def test_real_uncalibrated_image_never_gets_demo_phase_labels(client):
    data = np.zeros((128, 128), dtype=np.uint16)
    data[30:55, 30:55] = 3000
    data[70:100, 70:100] = 6000
    source, _ = import_tiff(client, data)
    run = analyze(client, source)
    assert not run["isSynthetic"] and run["calibrationId"] is None
    assert all(o["suggestion"]["suggestedLabel"] == "uncertain" for o in run["objects"])


@pytest.mark.parametrize(
    "change",
    [
        {"nuclearChannel": None},
        {"nuclearChannel": 5},
        {"zIndex": 1},
        {"seriesIndex": 99},
        {"mode": "marker", "markerChannel": None},
        {"mode": "marker", "markerChannel": 0},
    ],
)
def test_missing_or_invalid_mapping_is_rejected(client, change):
    source = demo(client)
    response = client.post(
        "/api/runs", json={"sourceId": source["sourceId"], "selection": selection(**change)}
    )
    assert response.status_code == 422


def test_marker_and_manual_presets_change_capability(client):
    source = demo(client)
    run = analyze(client, source, mode="marker", markerChannel=1)
    obj = run["objects"][0]
    assert obj["markerMean"] is not None
    assert obj["suggestion"]["suggestedLabel"] == "uncertain"
    assert review(client, run, obj, action="correct", label="positive").status_code == 200
    assert review(client, run, obj, action="correct", label="G1-like").status_code == 422
    manual = analyze(client, source, mode="manual")
    assert all(o["suggestion"]["suggestedLabel"] == "uncertain" for o in manual["objects"])


def test_synthetic_marker_channel_does_not_receive_dna_suggestions(client):
    run = analyze(client, demo(client), nuclearChannel=1)
    assert run["calibrationId"] is None
    assert all(o["suggestion"]["suggestedLabel"] == "uncertain" for o in run["objects"])


def test_unsupported_axes_and_ordinary_tiff_confirmation(client):
    source, _ = import_tiff(
        client, np.zeros((3, 32, 32), dtype=np.uint16), metadata={"axes": "QYX"}
    )
    assert not source["series"][0]["supported"]
    assert (
        client.post(
            "/api/runs", json={"sourceId": source["sourceId"], "selection": selection()}
        ).status_code
        == 422
    )
    gray, _ = import_tiff(client, np.ones((32, 32), dtype=np.uint16))
    assert (
        client.post(
            "/api/runs",
            json={"sourceId": gray["sourceId"], "selection": selection(confirmAxes=False)},
        ).status_code
        == 422
    )


def test_explicit_series_and_time_z_channel_selection(client):
    buffer = io.BytesIO()
    data = np.arange(2 * 3 * 2 * 32 * 32, dtype=np.uint16).reshape(2, 3, 2, 32, 32)
    tifffile.imwrite(buffer, data, ome=True, photometric="minisblack", metadata={"axes": "TCZYX"})
    source = client.post(
        "/api/imports", files={"file": ("stack.ome.tif", buffer.getvalue())}
    ).json()
    picked = selection(tIndex=1, zIndex=1, nuclearChannel=2)
    path = client.app.state.store.root / source["relativeProjectPath"]
    assert np.array_equal(imaging.plane(path, source, picked), data[1, 2, 1])
    two_series = io.BytesIO()
    with tifffile.TiffWriter(two_series) as writer:
        writer.write(np.zeros((32, 32), dtype=np.uint16), photometric="minisblack")
        writer.write(np.ones((48, 48), dtype=np.uint16), photometric="minisblack")
    multi = client.post(
        "/api/imports", files={"file": ("series.tif", two_series.getvalue())}
    ).json()
    assert len(multi["series"]) == 2
    path = client.app.state.store.root / multi["relativeProjectPath"]
    assert imaging.plane(path, multi, selection(seriesIndex=1)).shape == (48, 48)


def test_saturated_objects_remain_uncertain(client):
    run = analyze(client, demo(client))
    saturated = [o for o in run["objects"] if "saturated" in o["qualityFlags"]]
    assert saturated
    assert all(o["suggestion"]["suggestedLabel"] == "uncertain" for o in saturated)


def test_rerun_keeps_reviewed_prior_run_and_uses_new_ids(client):
    source = demo(client)
    first = analyze(client, source)
    assert (
        review(client, first, first["objects"][0], action="correct", label="S-like").status_code
        == 200
    )
    second = analyze(client, source)
    assert first["runId"] != second["runId"]
    assert {o["objectId"] for o in first["objects"]}.isdisjoint(
        o["objectId"] for o in second["objects"]
    )
    assert (
        client.get(f"/api/runs/{first['runId']}").json()["objects"][0]["review"]["reviewedLabel"]
        == "S-like"
    )


def test_failed_and_cancelled_jobs_do_not_commit_partial_runs(client, monkeypatch):
    source = demo(client)
    prior = analyze(client, source)

    def fail(*_args, **_kwargs):
        raise ValueError("Injected segmentation failure")

    monkeypatch.setattr(analysis, "analyze", fail)
    failed = client.post(
        "/api/runs", json={"sourceId": source["sourceId"], "selection": selection()}
    ).json()
    assert wait_job(client, failed)["status"] == "failed"
    assert client.get(f"/api/runs/{failed['runId']}").status_code == 404
    entered = threading.Event()

    def cancellable(_source, _path, _selection, _run_id, cancel, *_args):
        entered.set()
        assert cancel.wait(5), "Cancellation was never delivered"
        analysis.check(cancel)

    monkeypatch.setattr(analysis, "analyze", cancellable)
    cancelled = client.post(
        "/api/runs", json={"sourceId": source["sourceId"], "selection": selection()}
    ).json()
    assert entered.wait(5)
    client.post(f"/api/jobs/{cancelled['jobId']}/cancel")
    assert wait_job(client, cancelled)["status"] == "cancelled"
    assert client.get(f"/api/runs/{cancelled['runId']}").status_code == 404
    assert client.get(f"/api/runs/{prior['runId']}").status_code == 200
    assert len(list((client.app.state.store.root / "masks").glob("*.npy"))) == 1


def test_csv_quotes_formulas_and_json_exact_originals(client):
    run = analyze(client, demo(client))
    reason = '=HYPERLINK("example"), quoted "text"\nsecond line'
    obj = run["objects"][0]
    assert review(client, run, obj, action="exclude", reason=reason).status_code == 200
    rows = list(
        csv.DictReader(
            io.StringIO(client.get(f"/api/runs/{run['runId']}/export?scope=excluded").text)
        )
    )
    assert len(rows) == 1 and rows[0]["exclusion_reason"] == "'" + reason
    assert rows[0]["escaped_fields"] == "exclusion_reason"
    document = client.get(f"/api/runs/{run['runId']}/export?format=json&scope=excluded").json()
    assert document["objects"][0]["review"]["exclusionReason"] == reason


def test_exclusion_requires_reason_and_undo_cannot_erase_suggestion(client):
    run = analyze(client, demo(client))
    obj = run["objects"][0]
    assert review(client, run, obj, action="exclude", reason=" ").status_code == 422
    assert review(client, run, obj, action="correct", label="excluded").status_code == 422
    assert review(client, run, obj, action="undo").status_code == 422
    assert review(client, run, obj, action="correct", label="G2/M-like").status_code == 200
    undone = review(client, run, obj, action="undo").json()
    assert (
        undone["review"]["reviewStatus"] == "unreviewed"
        and undone["suggestion"] == obj["suggestion"]
    )


def test_calibration_scope_and_synthetic_rejection(client):
    synthetic = demo(client)
    body = {
        "sourceId": synthetic["sourceId"],
        "selection": selection(),
        "g1Reference": 4_000_000,
        "datasetScope": "Synthetic fixture",
        "provenance": "Software test only",
        "quantitativeConfirmed": True,
    }
    calibration = client.post("/api/calibrations", json=body)
    assert calibration.status_code == 200, calibration.text
    cal = calibration.json()
    data = np.zeros((64, 64), dtype=np.uint16)
    data[20:40, 20:40] = 2000
    real, _ = import_tiff(client, data)
    rejected = client.post(
        "/api/runs",
        json={"sourceId": real["sourceId"], "selection": selection(), "calibrationId": cal["id"]},
    )
    assert rejected.status_code == 422 and "Synthetic calibration" in rejected.text
    mismatch = client.post(
        "/api/runs",
        json={
            "sourceId": synthetic["sourceId"],
            "selection": selection(nuclearChannel=1),
            "calibrationId": cal["id"],
        },
    )
    assert mismatch.status_code == 422 and "does not match" in mismatch.text
    body.update(sourceId=real["sourceId"], datasetScope="One test field", g1Reference=800_000)
    real_cal = client.post("/api/calibrations", json=body).json()
    assert not real_cal["syntheticOnly"] and real_cal["validationState"] == "unvalidated"
    assert real_cal["sourceSha256"] == real["sha256"]


def test_source_tampering_is_detected_before_measurement(client):
    source = demo(client)
    path = client.app.state.store.root / source["relativeProjectPath"]
    with path.open("ab") as stream:
        stream.write(b"changed")
    response = client.get(f"/api/sources/{source['sourceId']}/preview")
    assert response.status_code == 422 and "hash mismatch" in response.text


def test_invalid_formats_corrupt_tiff_and_cross_origin_access(client):
    assert client.post("/api/imports", files={"file": ("field.omero", b"bad")}).status_code == 415
    assert client.post("/api/imports", files={"file": ("field.tif", b"bad")}).status_code == 422
    assert client.post("/api/demo", headers={"Origin": "https://example.com"}).status_code == 403
    assert client.get("/api/health", headers={"Host": "example.com"}).status_code == 400


def test_external_ome_references_are_rejected(client):
    xml = """<?xml version="1.0" encoding="UTF-8"?>
<OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06" UUID="urn:uuid:root">
<Image ID="Image:0"><Pixels ID="Pixels:0" DimensionOrder="XYCZT" Type="uint16" SizeX="32" SizeY="32" SizeC="1" SizeZ="1" SizeT="1">
<Channel ID="Channel:0:0" SamplesPerPixel="1"/><TiffData><UUID FileName="../external.tif">urn:uuid:external</UUID></TiffData>
</Pixels></Image></OME>"""
    buffer = io.BytesIO()
    tifffile.imwrite(buffer, np.ones((32, 32), dtype=np.uint16), description=xml, metadata=None)
    response = client.post("/api/imports", files={"file": ("external.ome.tif", buffer.getvalue())})
    assert response.status_code == 422 and "Multi-file OME-TIFF" in response.text
    assert client.get("/api/sources").json() == []


def test_resource_limits_are_checked_before_pixel_decode(client, monkeypatch):
    monkeypatch.setattr(imaging, "MAX_DECODED", 100)
    source, _ = import_tiff(client, np.ones((32, 32), dtype=np.uint16))
    assert not source["series"][0]["supported"]
    assert (
        client.post(
            "/api/runs", json={"sourceId": source["sourceId"], "selection": selection()}
        ).status_code
        == 422
    )
    monkeypatch.setattr(imaging, "MAX_UPLOAD", 50)
    assert client.post("/api/imports", files={"file": ("large.tif", b"x" * 51)}).status_code == 413


def test_durable_reopen_survives_service_restart(client):
    run = analyze(client, demo(client))
    obj = run["objects"][0]
    review(client, run, obj, action="correct", label="S-like")
    saved = client.post(
        "/api/sessions", json={"name": "Restart test", "runId": run["runId"]}
    ).json()
    with TestClient(create_app(client.app.state.store.root)) as restarted:
        reopened = restarted.get(f"/api/sessions/{saved['sessionId']}")
        assert reopened.status_code == 200, reopened.text
        assert reopened.json()["run"]["objects"][0]["review"]["reviewedLabel"] == "S-like"
