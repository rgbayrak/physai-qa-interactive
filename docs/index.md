# physAI-QA-interactive

**An interactive visualization and annotation tool for physiological recordings in BIDS fMRI datasets.**

physAI-QA-interactive lets you step through every scan of a BIDS dataset and view cardiac, respiratory and other physiological signals on one time axis, anchored at scan onset. You can check that alignment against scanner trigger pulses, compare the signals with fMRIPrep or MRIQC head-motion confounds and task events, compute per-channel signal quality metrics, and mark artifacts as annotations saved next to the dataset. The Stats tab compares the signal quality metrics across every scan of a dataset and exports them as a PDF report.

It is part of **physAI**, a research suite for physiological data. physAI-QA-interactive is the manual exploration and annotation tool of **physAI-QA**, the suite's quality assurance component.

![The Explore and Annotate tab: stepping through scans, zooming into a signal and its auxiliary charts](images/physviz.gif)

- **New here?** Start with {doc}`get-started`: install the tool, get a dataset and open it in your browser.
- **Using the tool?** The {doc}`user-guide/index` explains each part of the interface and what it shows.
- **Unfamiliar term?** See the {doc}`glossary`.

```{toctree}
:maxdepth: 2
:hidden:

get-started
user-guide/index
glossary
```
