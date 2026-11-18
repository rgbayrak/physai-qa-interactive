# Release notes

## Unreleased

### Developer notes

Notes for the developers on decisions made for this version, which is not released yet.

#### What is kept between pages and launches

The viewer's choices are kept in the browser tab's `sessionStorage`, in one entry per dataset and dev server launch (`src/viewer/persistence.ts`; shared with Stats by `src/quality/linked-scan.ts`).

| Action | Buttons and dropdowns (channel, confound, events column, stack, locks, **Show peaks** boxes, scatter X, Y and Colour by) | Subject and scan |
|---|---|---|
| Reload the page | kept | kept |
| Switch between Explore and Annotate and Stats | kept | kept: both tabs show the same scan |
| Stop and relaunch the tool (`npm run dev`) | reset | reset: opens the first scan with no annotations |
| Close the browser tab | reset | reset |

The scan changes only when one is picked: the scan dropdowns, Prev/Next or the search box in Explore and Annotate, Prev/Next in Stats (Stats writes the scan it shows back), and a double-click on a scatter point. A scatter double-click is a new choice of scan, so it clears the locks: the picked scan opens in Stats and, on the way back, in Explore and Annotate.

#### Peak detection: detectors tested and not included

These were run in the comparison and are not included. Their code is kept, not run, in `scripts/archive/detect_peaks_tested.py`, so any of them can be brought back as it was.

| Signal | Detector | Library | Why not included |
|---|---|---|---|
| PPG | MSPTDfast v2 (Charlton et al. 2025) | NeuroKit2 0.3.0 | Not kept after the developer's visual inspection |
| PPG | HeartPy (van Gent et al. 2019) | HeartPy 1.2.7 | Not kept after the developer's visual inspection |
| PPG | MSPTD (Bishop and Ercole 2018) | NeuroKit2 0.3.0 | Slow |
| PPG, respiration | peakdet `peakfind_physio`, thresh 0.2 (DuPre et al. 2024) | peakdet 0.6.1 | Raised `ValueError: setting an array element with a sequence.`; ran on simulated 60 s, 100 Hz signals; cause not found |
| ECG | Pan–Tompkins, Hamilton, Christov, Elgendi 2010, Kalidas (SWT), Zong (WQRS), Khamis (UNSW), Nabian, Emrich (visibility graph), Elgendi 2013 (ECG), Rodrigues (adaptive steepness), Gamboa | NeuroKit2 0.3.0 | Not kept after the developer's visual inspection |
| ECG | XQRS | wfdb 4.3.1 | Not kept after the developer's visual inspection |
| Respiration | scipy `find_peaks`; BioSPPy | NeuroKit2 0.3.0 | Not kept after the developer's visual inspection |

#### Peak detection: choosing a default

The detectors were compared visually, scan by scan. The default for each signal type, and why:

| Signal | Default | Also kept | Review |
|---|---|---|---|
| PPG | Elgendi 2013 (NeuroKit2) | In-house | Elgendi 2013 did best. It is also the default PPG method in NeuroKit2. |
| Respiration | Khodadad 2018 (NeuroKit2) | Bettermann 1996 | Both methods performed well and were retained, with no clear basis for preferring one over the other. Khodadad 2018 (NeuroKit2's default) was selected as the default. |
| ECG | NeuroKit (NeuroKit2) | Engelse–Zeelenberg (modified) | Both methods performed well and were retained. NeuroKit was selected as the default, as its performance appeared slightly better. It is also the default ECG method in NeuroKit2. |

References:

- Bishop, S. M., & Ercole, A. (2018). In *Intracranial Pressure & Neuromonitoring XVI* (pp. 189–195). (As cited in NeuroKit2's `ppg_findpeaks`; title not yet checked.)
- Charlton, P. H., et al. (2025). *Physiological Measurement*, 46, 035002. (As cited in NeuroKit2's `ppg_findpeaks`; title not yet checked.)
- DuPre, E., et al. (2024). physiopy/peakdet: A python toolbox for reproducible physiological data analysis. Zenodo. <https://doi.org/10.5281/zenodo.13359249> (the v0.5.1 DOI, cited for v0.6.1, the version tested)
- van Gent, P., Farah, H., van Nes, N., & van Arem, B. (2019). *Journal of Open Research Software*, 7(1), 32. <https://doi.org/10.5334/jors.241> (full title in `paper/paper.bib`, `van2019heartpy`)
- The other ECG references (Pan & Tompkins 1985; Hamilton 2002; Christov 2004; Elgendi et al. 2010; Kalidas & Tamil 2017; Zong et al. 2003; Khamis et al. 2016; Nabian et al. 2018; Emrich et al. 2023; Elgendi 2013, *PLoS ONE* 8(9) e73557; Gutiérrez-Rivas et al. 2015 and Sadhukhan & Mitra 2012; Gamboa 2008, PhD thesis) are as listed in NeuroKit2's `ecg_findpeaks` docstring.
