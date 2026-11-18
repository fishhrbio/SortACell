# Development

SortACell serves a Vite-built React and TypeScript frontend from a single FastAPI process on loopback. Use one server worker. The frontend and scientific pipeline run locally. The optional API documentation page may fetch its UI assets from a CDN.

| Component | Responsibility |
| --- | --- |
| `frontend/src/` | Image import and mapping, SVG preview and masks, nucleus review, saved sessions and export controls. |
| `backend/imaging.py` | TIFF metadata, bounds checks, source verification, preview raster, and generated fixture. |
| `backend/analysis.py` | 2D segmentation, raw signal measurement, quality flags, and provisional suggestions. |
| `backend/main.py` | API routes, job worker, session handling, review history and exports. |
| `backend/store.py` | SQLite record transactions and local paths. |

## Development and testing

Follow the README to set up the locked dependencies. Start Uvicorn at `127.0.0.1:8000`, then run `pnpm dev` from `frontend/` to use the Vite server at `127.0.0.1:5173`. The Vite server forwards API requests to the local backend.

Run `python -m pytest -q`, `python -m ruff check backend tests`, and `python -m ruff format --check backend tests` from the repository root with the project Python environment active. To run the browser suite, stop any development server using port 8000. From `frontend/`, run `pnpm build`, `pnpm exec playwright install chromium`, and `pnpm test:e2e`. Playwright starts a separate service with isolated workspace data. Use `SORTACELL_PYTHON` to specify an interpreter if the project Python isn't on PATH. An installed Chromium-based browser can be used via `SORTACELL_BROWSER`.

The service exposes [OpenAPI JSON](http://127.0.0.1:8000/api/openapi.json) and [interactive API docs](http://127.0.0.1:8000/api/docs) while running. Key routes cover imports, source metadata and previews, analysis jobs, run review records, calibration presets, named sessions, and scoped exports.

## Troubleshooting

- **The root reports that the frontend must be built.** Run `pnpm build` from `frontend/`, then restart Uvicorn so it mounts the compiled assets.
- **Analyze is disabled.** Check the series, T/Z indices, nuclear channel, TIFF axis confirmation, and distinct marker mapping if using marker review.
- **A field failed to segment.** Check the displayed error and confirm a nonconstant grayscale nuclear plane. Earlier runs remain available under **Saved sessions and runs**.
- **A source hash changed or a mask is missing.** Restore the complete workspace backup. Keep the files in the data directory intact.
