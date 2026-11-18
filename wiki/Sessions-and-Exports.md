# Sessions and exports

## Save and reopen

A successful analysis creates a durable run with its own ID, source hash, selection, segmentation version, and masks. Object IDs combine source, selected series/T/Z, run, and mask label. Rerunning creates new IDs and leaves earlier decisions attached to their original run.

Review edits save immediately to the current run. A named session bookmarks the run, selected object, and filter. Reopening the bookmark loads the current review state of that run. Use **All analysis runs** in the same menu to reopen a previous run without a named bookmark.

## Export a filtered view

Both download buttons use the current queue filter and report how many rows it includes. Use **All objects** for the complete run. Use **Reviewed** for accepted, corrected and excluded rows, or choose a status individually. Always inspect the review status when including excluded rows in a downstream table.

- **CSV** gives one row per nucleus, with source hash, plane and channel mapping, run and object IDs, features, suggestion, reviewed label, status, flags, and exclusion reason. It quotes fields containing commas, quotes, or newlines. Formula-like text is prefixed with an apostrophe and listed under `escaped_fields`.
- **JSON** retains original text, review history, outlines, source and run metadata, and measurement units. It also records the export filter, row count, and schema version.

## Back up your workspace

Stop the service and copy the entire `.sortacell/` directory, or the directory set through `SORTACELL_DATA_DIR`. It contains the source TIFF copies, masks, and SQLite records. Point a new installation at the copy to reopen the runs. CSV and JSON are analysis exports. Restore a complete workspace to recover source pixels and full mask arrays.
