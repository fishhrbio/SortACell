# GitHub posting sheet

**Repository name** `SortACell`

**About description**

> Local microscopy annotation for TIFF and OME-TIFF. Inspect nuclear masks, review label suggestions, and export reproducible CSV and JSON records.

**Topics** `microscopy`, `image-analysis`, `annotation`, `ome-tiff`, `bioimage-analysis`, `fastapi`, `react`

**Release title** `SortACell v0.1.0 — Local microscopy review`

**Release description**

> SortACell reduces repetitive microscopy annotation by bringing image review, nuclear measurements, and per-object decisions into one local workspace. Import a TIFF or OME-TIFF, map the channels and one 2D plane, inspect the generated masks, and keep corrections separate from the original suggestions. Reopen saved sessions or export filtered records to CSV and JSON.
>
> The release includes a synthetic demo, a manual marker preset, and a calibration gate for DNA-content suggestions on real images. No independent biological accuracy has been established. The current release supports local file import, with a read-only OMERO connector planned for a later milestone.

## Publication steps after the owner's green light

1. Confirm the repository owner and visibility before creating `SortACell`. Use the About description and topics above. The local package currently has no open-source license grant. Add a license only if the owner chooses one.
2. Publish the source tree to the default branch. Use the source ZIP contents as prepared. The archive excludes local workspace databases, images supplied by users, Python environments, dependency folders, and build output. The README screenshot contains only the generated demo.
3. Enable Wikis if available on the selected repository plan. Create the first wiki page on GitHub, then stage the Markdown locally and copy the staged pages into the wiki clone. The script rewrites page links for the chosen owner. [GitHub wiki creation and local editing](https://docs.github.com/en/communities/documenting-your-project-with-wikis/adding-or-editing-wiki-pages)
4. Verify the repo README, CI status, topics, and wiki navigation before creating the `v0.1.0` GitHub release. Use the release text above and attach the source ZIP and checksum if desired.

Stage wiki files locally after the GitHub owner is known. This command writes files only to the destination you choose.

```text
python scripts/stage_wiki.py OWNER ../SortACell-wiki-staged
```

The repository includes the full wiki source under `wiki/` so readers can use it even when the separate GitHub wiki is unavailable.
