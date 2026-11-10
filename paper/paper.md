---
title: 'physAI-QA-interactive: an interactive visualization and annotation tool for physiological recordings in BIDS fMRI datasets'
tags:
  - neuroimaging
  - physiological recordings
  - BIDS
  - fMRI
  - signal quality
  - TypeScript
  - Python
authors:
  - name: Roza Gunes Bayrak
    orcid: 0000-0002-7197-1248
    affiliation: 1
  - name: Catie Chang
    orcid: 0000-0003-1541-9579
    affiliation: "1, 2, 3"
affiliations:
  - name: Electrical and Computer Engineering, Vanderbilt University, Nashville, TN 37235, United States
    index: 1
  - name: Biomedical Engineering, Vanderbilt University, Nashville, TN 37235, United States
    index: 2
  - name: Vanderbilt University Institute of Imaging Science, Nashville, TN 37235, United States
    index: 3
date: TODO
bibliography: paper.bib
---

<!--
Drafting notes (remove before submission)
- Completed items from paper/JOSS-TODO.md are written up here, in the
  section they belong to, and removed from the checklist.
- "Software design" describes the code as it is today (TypeScript server +
  viewer). Add the standalone server and launch command once JOSS-TODO
  Phase 2 lands.
- Claims about other tools in "State of the field" are from memory: check
  each one against the tool's current documentation.
- Check the current JOSS paper guidelines for required sections before
  submitting: https://joss.readthedocs.io/en/latest/paper.html
-->

# Summary

physAI-QA-interactive provides a single interface for visualizing, labeling and
annotating artifacts, both across whole recordings and within time windows. It
is designed for researchers who curate, quality-check or reuse BIDS-validated physiological 
datasets concurrent with functional MRI scans. It replaces most dataset-specific in-house
scripts and viewers with one interactive workflow that behaves the same way on
any BIDS dataset: review every channel of every scan, compute modality-specific
quality metrics, compare physiological events across modalities, and annotate
artifacts directly on the signal under review. Keeping visualization and
annotation together streamlines review, and recording every decision in one
shared format makes quality assessment consistent and reproducible across raters. 
The outputs, per-channel quality metrics for every scan (one TSV per dataset)
and artifact annotations (JSON), are stored as human-readable files for use in
downstream processing, whether to define inclusion criteria for an analysis or
to guide artifact correction.

# Statement of need

Systemic physiological processes, once primarily regarded as confounding noise
in fMRI studies, are increasingly recognized as valuable signals linked to
cognitive processes and individual differences in brain function [@yuan2013].
Concurrent recordings of peripheral physiology, such as cardiac and respiratory
signals, can enhance fMRI analysis through improved noise modeling
[@glover2000; @kasper2017] and provide complementary insights into brain-body
interactions. However, the utility of physiological data is contingent upon
recording quality and expertise in data handling. Quality assessment of 
physiological signals poses challenges distinct from those addressed by 
established neuroimaging quality assessment pipelines [@gray2009;
@bulte2017]. For fMRI, automated tools such as MRIQC [@esteban2017] have
standardized quality evaluation through image quality metrics and visual
reports, and their use has been formalized into reproducible QC protocols
[@provins2023]. No comparable solution exists for concurrent physiological
recordings. 

# State of the field

BIDS standardizes how these recordings are stored [@gorgolewski2016], 
and community efforts such as physiopy have begun compiling recommended practices 
for their acquisition and processing[@phys2bids; @physiopy2026], but the field 
still lacks a standardized approach to physiological quality assessment. Valuable 
publicly available tools exist, such as PhysIO [@kasper2017] and AFNI's `physio_calc.py` 
[@lauren2024], however their primary focus is on physiological noise modeling. 
These tools process individual recordings through scripts; none
offers an interactive, dataset-wide interface for reviewing, labeling and
annotating physiological signals. Signal quality indices for cardiac signals are well
established in biomedical engineering [@orphanidou2015; @li2012; @elgendi2016]
and available in general-purpose toolboxes such as NeuroKit2 [@makowski2021]. 
Beyond these, most labs that use physiological measures rely on their own in-house 
scripts and viewers, so quality assessment practices vary widely between groups. 

# Software design

physAI-QA-interactive is a browser-faced tool for exploring and annotating
physiological recordings stored in the Brain Imaging Data Structure (BIDS)
[@gorgolewski2016]. It discovers every subject, session, task and run in a
dataset and visualizes multimodal physiological signals alongside auxiliary measures.
Researchers can step through all scans of a dataset, zoom
into signals, compute per-channel signal quality indices on recordings,
and mark artifacts as time-stamped annotations saved alongside the dataset for
later correction or use for training machine learning models.
physAI-QA-interactive is the first released tool of physAI-QA, the quality
assurance (QA) component of the physAI research suite for physiological data.

physAI-QA-interactive builds on open-source community standards and tools: it reads data
organized in BIDS [@gorgolewski2016] and works directly with datasets managed by
DataLad [@halchenko2021]. Its documentation shows how to install a dataset from
OpenNeuro [@markiewicz2021] with DataLad and fetch only the physiological and
confound files, so users can start reviewing public data without downloading
whole datasets. It has four key components:

- **BIDS reader.** Discovers subjects, sessions, tasks and runs, follows BIDS
  metadata inheritance, skips files that DataLad has not yet fetched, and
  finds the physiological and derivatives folders by their content. It
  locates fMRIPrep [@esteban2019] or MRIQC motion confounds, task events and
  BOLD sidecars, checks file and folder names against the rules of the
  dataset's declared BIDS version, and reports how many physiological files
  are downloaded. Results are served to the browser as a JSON API.
- **Signal quality metrics.** Whole-recording statistics for every channel,
  plus windowed and beat-level metrics for cardiac [@elgendi2016; @pincus1991]
  and respiratory channels. A script computes them for every scan of a
  dataset, keeping only physiological channels, and writes one TSV per
  dataset, with a log of each run.
- **Viewer and annotation.** Linked overview and detail charts, built on a
  TypeScript chart library over D3 [@bostock2011], stay responsive on
  high-rate recordings. Extra channels, task events and motion confounds
  follow the same time window. Annotations are saved per scan and channel as
  JSON with times and sample indices, ready to use as artifact masks. The
  interface keeps all of its state in a single object; charts, controls and
  annotations are separate modules that receive state and page elements as
  arguments rather than reaching into the page themselves.
- **Dataset-level view.** Beyond single-scan review, the precomputed quality
  metrics of every physiological recording are compared across the whole
  dataset. A scatter plot under the viewer plots any two metrics, or a metric
  against a participant variable such as age, with the scan being viewed
  highlighted. Outliers can be followed directly: selecting a point opens
  that scan in the Stats tab, which shows its waveforms, available subject
  information, and where each of its quality metrics falls in the group
  distribution; the same view is exported as a PDF report. Moving between
  the two lets researchers find problem scans quickly and see why they stand
  out.

These follow four design goals: a low entry barrier (any standard BIDS dataset,
only the dataset path to set), standardized checks with flexible judgement (fixed metric
definitions and annotation format),
transparency (documented metrics, outputs stored as plain files), and
modularity (data access and metrics separate from the interface).


# Software testing

Automated tests, run by continuous integration on every push to the main
branch and every pull request, cover:

- **BIDS reading:** dataset discovery, finding the physiological and
  derivatives folders, sidecar lookup, physiological reading, fMRIPrep and
  MRIQC confounds, task events and downloaded-file counts, on two small
  synthetic BIDS datasets included in the repository and on real OpenNeuro
  [@markiewicz2021] datasets when present.
- **Dataset checks:** the required dataset path, and file and folder names
  against the rules of the declared BIDS version.
- **Timing checks:** trigger detection and verification.
- **Signal quality metrics:** values on synthetic signals with known statistics,
  and the dataset-wide metrics output (file format, identical output on reruns,
  exclusion of non-physiological channels, the run log).
- **Annotations:** saving, loading, and rejection of unsafe file paths.
- **Interface logic:** annotation format, scan navigation and search, session
  resume, chart helpers and the metric definitions.

# Research use

The software has been developed and tested on public datasets, including
DMT-HAR-MED (OpenNeuro ds006644) [@egger2025dataset; @egger2025], the
multi-echo dataset ds000210 [@dupre2017], and selected CNeuroMod datasets
(movie10 and friends). These datasets have been used to exercise the tool's
dataset-wide quality summaries and scan-level review workflows during
development. We are not aware of an independent study or laboratory that has
yet used physAI-QA-interactive to produce results for its own analyses.

# Outlook

physAI-QA-interactive is the manual half of physAI-QA. Its companion,
physAI-QA-auto, is in development and will bring automated artifact detection, annotation and correction. Because every annotation made in
physAI-QA-interactive records both times and sample indices in a shared format, the labels researchers create today can train and evaluate those automated
tools, closing the loop between expert review and automated QA.

# AI usage disclosure

Code in physAI-QA-interactive was generated with Anthropic's Claude (Claude
Opus 5.5, via Claude Code). The lead author reviewed and manually approved all
changes.

# Acknowledgements

TODO

# References
