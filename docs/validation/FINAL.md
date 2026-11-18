# SortACell v0.1.0 verification

Tested November 18, 2026, on Windows with Python 3.12.14, Node.js 24.22.1, pnpm 11.25.0, React 19.3.1, Vite 7.3.8, and FastAPI 0.164.0. Exact dependencies are in the lockfiles.

| Check | Result |
| --- | --- |
| Backend tests | 24 passing cases. Includes bounded TIFF parsing, exact mapping, unsupported and external-reference TIFFs, duplicate imports, source SHA-256 integrity, saturation, calibration boundaries, correction and undo, cancellation and failure without partial commits, session persistence, and CSV escaping. |
| Python consistency | Ruff lint, Ruff format check, and pip dependency check passed. |
| Production frontend | TypeScript check and Vite build passed. |
| Loopback service | Generated 48 synthetic nuclei and exported 48 CSV rows using the live API. [Smoke result](server-smoke.json) |
| Browser workflows | 3 Playwright tests passed in Chromium-based Microsoft Edge against the production build and live local API. |
| Wiki staging | All six wiki pages and the sidebar were generated under a temporary path with owner-specific links. |

The browser suite verified synthetic import, explicit mapping, navigating and selecting masks at different zoom levels, display-only adjustments, correction and undo, exclusions, filters, saving and reopening, and matching CSV and JSON downloads. Separate scenarios verified ordinary TIFF axis confirmation, preserved uncertainty without a calibration, reuse of a matching preset, and reopening an earlier run after a failed job.

The suite verified visible keyboard focus and shortcuts outside form fields. The reviewed workspace had zero axe findings in the WCAG 2.0/2.1 A and AA rule set used in the test. A 390 px viewport check found no horizontal page overflow. Calculated contrast ratios included 16.81:1 for primary text on panels, 9.27:1 for secondary text, 14.41:1 for primary button text, and 16.69:1 for the keyboard focus ring on panels.

One upstream Starlette deprecation warning about the httpx test transport remains. The backend tests pass with that transport.

The included GitHub Actions workflow is prepared for the repository. Hosted CI results are pending publication. This verification used generated and constructed TIFF data. Biological accuracy, representative instrument exports, and compatibility with a live OMERO server have yet to be evaluated.
