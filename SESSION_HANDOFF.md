# SortACell session handoff

## Local release

SortACell v0.1.0 implements the first milestone from the supplied `BUILD_PROMPT.md`. The project directory contains the React/TypeScript review workspace, FastAPI service, tests, reproducible dependency locks, draft CI, full README, and wiki source. The source ZIP is the package for review and GitHub upload.

The user approved continuing the local build on November 18, 2026. The separate authorization for GitHub publication is pending. Use the posting sheet to apply repository details, stage the wiki for the confirmed owner, and prepare the first GitHub release after approval. [GitHub posting sheet](docs/GITHUB.md)

## Operating the app

Build the frontend, run FastAPI on 127.0.0.1:8000, then load the generated demo or import a supported TIFF. The README has exact commands. Keep `.sortacell/` or the configured data directory together when making a backup. The browser workspace supports browsing saved runs even when they have no session bookmark.

The extracted starter remains under the chat's `work/starter/02-cell-phase-sorter/` directory. The design references provided visual context. No archive launcher was executed.

## Verification and scientific status

The release tests use synthetic and constructed TIFF fixtures. Biological phase suggestions remain unvalidated on independently labeled real data. The software checks and tested environment are recorded in the verification report. [Verification](docs/validation/FINAL.md)

## Next development milestone

1. Obtain a representative de-identified real OME-TIFF with acquisition details and independently reviewed nuclei.
2. Expand reader coverage against representative input and evaluate segmentation and label agreement separately on held-out fields.
3. Scope a read-only OMERO connector, then assess batch processing, tiled images, and additional marker strategies.
