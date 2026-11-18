# Getting started

Install Python 3.12, Node.js 24, and pnpm 11.25.0. The repository README has commands for Windows PowerShell, macOS, and Linux. Start the local service and open [SortACell](http://127.0.0.1:8000).

## Try the generated field

1. Select **Load synthetic demo**. The **Demo / synthetic** label identifies the generated field.
2. In **Map channels**, choose **0 · Synthetic DNA** as the nuclear channel. Use the default DNA-content preset and T0/Z0.
3. Select **Analyze nuclei**. An analysis run stores masks, source coordinates, object features, and suggestions.
4. Select a nucleus in the image or queue. Review the original suggestion, measurements, and quality flags in the inspector.
5. Correct one label and exclude a different nucleus with a reason. Set the filter to **Reviewed** to see both decisions.
6. Name and save the session. Reload the page, choose your session under **Saved sessions and runs**, and select **Reopen**.
7. Download both formats. The row count for each download follows the active filter.

## Supported images

- Self-contained TIFF and OME-TIFF with grayscale numeric YX planes. Supported optional axes are series-local T, C, and Z.
- Select the series, indices, and nuclear channel explicitly. Ordinary TIFF requires axis confirmation before preview or analysis. The importer rejects ambiguous axes rather than guessing at channels or projecting a stack.
- Limits are 64 MiB per upload, 128 MiB per decoded series, 4 million pixels per plane, and 5,000 segmented objects. Use a smaller export if you encounter these limits.
- RGB samples, missing external OME components, unknown stack axes, and tiled whole-slide workflows are outside the supported subset. Compression support depends on the TIFF codec. Use a self-contained grayscale export with a supported encoding if decoding fails.
- OMERO users can export single-file OME-TIFF from their server as a starting point. [Official OMERO export overview](https://www.openmicroscopy.org/omero/features/export/)

Continue with the [review workflow](Review-Workflow.md).
