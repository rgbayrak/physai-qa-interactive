# Glossary

```{glossary}
Annotation
  What you record about a scan in the Annotations box: a Signal Quality rating and Notes for the whole recording, and labelled time windows. Saved as one JSON file per scan and channel.

Artifact
  A part of a recording that does not reflect the physiology being measured, for example from movement, a loose sensor or scanner interference.

BIDS
  Brain Imaging Data Structure: a standard for naming and organizing neuroimaging data and its metadata. See <https://bids.neuroimaging.io>.

BIDS_ROOT
  The setting that points the tool at the main BIDS folder, the one with `dataset_description.json`. Required. See also `BIDSPHYS_ROOT` and `BIDSDER_ROOT` in the user guide.

Channel
  One column of a physiological recording, such as `cardiac`, `respiratory` or `trigger`. The column names are listed in the sidecar's `Columns`.

Confounds
  Per-volume measures computed by fMRIPrep or MRIQC, such as head motion. The tool shows one at a time in the Confound chart.

DataLad
  A tool for managing versioned datasets. It can download a dataset's file list first and fetch file contents only when needed. Built on git-annex.

Derivatives
  Files computed from the raw data by a pipeline such as fMRIPrep or MRIQC, usually stored in a `derivatives/` folder.

Events file
  A BIDS `*_events.tsv` file listing the onset, duration and type of each task event in a scan.

Framewise displacement
  A summary of head motion between consecutive volumes, in millimetres. Shown colour-coded in the Confound chart.

git-annex
  The tool DataLad uses to keep large file contents separate from the file list. A file that is listed but not yet fetched is a link with no content.

Physiological recording
  A signal recorded alongside the scan, such as cardiac (pulse or ECG), respiratory or electrodermal activity. In BIDS, stored as `*_physio.tsv.gz` with a JSON sidecar.

Scan
  One run of one task for one subject (and session), with its physiological recording. The tool steps through scans one at a time.

Scan onset
  The start of the first BOLD volume of a scan. All charts use it as t = 0.

Sidecar
  A JSON file next to a data file that describes it, for example `SamplingFrequency`, `StartTime` and `Columns` for a physiological recording.

Signal quality metric
  A number computed from a channel that describes its quality, such as signal-to-noise ratio or beat-to-beat correlation. Computed for every scan by the quality metrics script.

Time window
  A stretch of a recording that you mark and label with Annotate on, for example where an artifact occurs.

TR
  Repetition time: the time between the starts of consecutive BOLD volumes, from `RepetitionTime` in the BOLD sidecar.

Trigger
  A pulse the scanner sends at each volume, often recorded as a `trigger` channel. The tool uses triggers to check the recording's timing.
```
