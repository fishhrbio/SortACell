# Methods and limitations

## Measurements and masks

The service inspects TIFF series metadata with tifffile, then reads one explicitly selected 2D plane from a bounded decoded series. Version `gaussian-otsu-components-v1` smooths the nuclear image with a Gaussian filter (sigma 1 px), thresholds it with Otsu, fills holes, and labels 8-connected components. Components smaller than 60 pixels are removed. Mask contours are drawn in the same pixel coordinate system as the preview.

Feature version `raw-bg-v1` reads measurements from the untouched raw plane. Background is the median outside retained labels. Integrated signal is the sum of max(raw minus background, 0) over the mask. Marker mean, when mapped, is the raw mean for the marker channel inside the same nucleus. Centroids are x/y coordinates in pixels, area is in pixels squared, and fluorescence values are in instrument-dependent units.

Objects that touch the image edge, have over 1% of pixels at the maximum integer storage value, or have low solidity or large area relative to peers are flagged for review. These rules can miss artifacts. An instrument may clip below the storage maximum. Connected components can merge touching nuclei, and illumination, contrast, and field density can affect segmentation.

## DNA-content suggestions

The demo uses an artificial, two-channel OME-TIFF with 48 generated nuclei and a deliberately saturated object. The synthetic DNA channel has deterministic generation parameters and a retained ground-truth mask. The demo reference comes from the lower quartile of measured synthetic signal.

A real field needs a user-supplied positive G1 integrated-signal reference, dataset description, reference provenance, and confirmation that the data are suitable for quantitative DNA measurement. A calibration can be reused only for the exact source hash, series, time, Z, mapped channels, and preset. For eligible objects, version `dna-window-v1` assigns labels by the integrated-signal ratio to the reference. G1-like uses 0.8–1.2, S-like uses >1.2–<1.8, and G2/M-like uses 1.8–2.2. Values outside those ranges and flagged DNA objects stay uncertain. These windows are provisional rules. The API provides no calibrated probability.

DNA content can support broad stage grouping under appropriate imaging and quantification conditions. DNA amount alone cannot separate G0 from G1 or G2 from M. Segmented objects represent nuclear masks, with their own boundaries and quality limitations. [Roukos et al., 2015](https://pmc.ncbi.nlm.nih.gov/articles/PMC6318798/)

## What validation still requires

Select a representative de-identified real dataset with acquisition details and independently reviewed masks and labels. Keep related fields from the same acquisition or biological sample together when splitting calibration and evaluation sets. Report segmentation overlap and missed or merged objects separately from label agreement, per-class results, uncertainty and exclusion rates, and reviewer correction time. Document which datasets and stain types each result supports.
