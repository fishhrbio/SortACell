# Review workflow

## Choose a capability and the channels it needs

| Preset | Mapping | What it offers |
| --- | --- | --- |
| DNA content | Nuclear DNA channel | G1-like, S-like, and G2/M-like suggestions on the synthetic DNA fixture or with a matching, confirmed calibration. Otherwise suggestions are uncertain. |
| Marker review | Nuclear channel and a distinct marker channel | Segmentation on the nuclear channel, mean marker signal over each nuclear mask, and manual positive, negative or uncertain labels. |
| Manual review | Nuclear channel | Segmentation and measurements with manual class-1, class-2 and uncertain labels. |

Display channels can be switched independently of analysis. Change the mapping and run a new analysis when you need a different measurement plane or preset.

## Inspect the field

Use **Fit**, **+**, and **−** to adjust the view. Drag the image to pan. With the image focused, arrow keys pan, plus and minus zoom, and zero fits. Brightness and contrast modify only the PNG preview. Image and mask visibility are independent.

Click a mask or select its row to open the same nucleus in the inspector. Selecting a row centers the nucleus when zoomed. Use **Previous** and **Next**, or **K** and **J**, to move through the active filter. Shortcuts yield to form fields. Use Tab to reach viewer, review, and export controls from the keyboard.

## Review each suggestion

Compare the source pixels and mask before accepting. Use **Apply correction** to assign a different supported label. Use **Exclude…** with a reason when an object should be omitted from a downstream analysis. **Undo decision** restores the previous review state and records that undo in the history. Exclusions remain visible under **Excluded** and are included in **All objects** exports.

An uncertain object stays in the **Uncertain** filter until it has a reviewed label other than uncertain. Use **Unreviewed** for work still pending and **Reviewed** for accepted, corrected, and excluded records. The filter counts update as decisions are saved.
