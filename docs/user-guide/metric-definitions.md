# Metric definitions

What each column of `quality_metrics.tsv` holds, which channels it is computed for, and where it comes from. The metrics are being reviewed one at a time against their source papers; the **Status** column says which ones are done. A metric that does not apply to a channel is `n/a`.

## Channel types

The PPG metrics below, and the peak detectors (see [Detected peaks](explore-and-annotate.md#detected-peaks)), use one rule for a column's type. BIDS gives no per-column signal type: it recommends the names `cardiac` and `respiratory` and allows any other name (see {doc}`inputs-and-outputs`), so the type comes from the name.

- The name is split into words at `_`, `-`, `.` and spaces; case and a trailing number are ignored. Each word is looked up: `ecg`, `ekg` → ECG; `ppg`, `pleth`, `pulse`, `bvp` → PPG; `respiratory`, `resp`, `rsp`, `breath`, `belt` → respiration. Words of other known signals (EDA, gas such as `CO2`, blood pressure, EMG) give no metrics or detectors.
- One signal type in the name gives that type: `PPG`, `ECG2`, `resp_belt`, `respiratory_chest`.
- The BIDS `cardiac` with no second signal word (`cardiac`, `cardiac2`) is **taken as PPG**: BIDS defines it as a "continuous pulse measurement", which can also be ECG. The run prints a note; if the column is ECG, rerun with `--channel cardiac=ecg`.
- A specific cardiac word settles the generic one: `ECG_cardiac` is ECG, `cardiac_PPG` is PPG.
- A gas word settles a respiration one: `respiratory_CO2` and `respiratory_O2` are gas measured in the breath, not a breathing belt, so they are grouped with gas and get no respiration metrics or detectors.
- Names of two signal types (`ppg_ecg`, `pulse_resp`) are **ambiguous**, and names with no known word (`ch3`) are **unknown**. Both are skipped by the PPG metrics and the peak detectors, and the run prints a warning with the fix.
- `--channel <column>=<ppg|ecg|resp|none>` sets a column's type for that run only, in `scripts/compute-quality-metrics.ts` and `scripts/compute-peaks.ts`; it wins over the name. It is not remembered: pass it again on the next run.

Before computing, both scripts print a **channel types table**: every column the physio sidecars list, the type it was taken as, why, and how many recordings have it. Rows marked `!` are assumptions or skipped columns to check, with their `--channel` fix. For example, for ds003192:

```text
  column             type         recordings  why
! cardiac            PPG                  20  assumed: BIDS "cardiac" can be PPG or ECG; add --channel cardiac=ecg if ECG
  respiratory_chest  respiration          20  word "respiratory"
  respiratory_CO2    gas                  20  word "CO2" settles "respiratory"; not analysed
  respiratory_O2     gas                  20  word "O2" settles "respiratory"; not analysed
  trigger            —                    20  non-physio (scanner trigger)
  time               —                    20  non-physio (time stamp)
```

The table is saved with the results: `channel_types` in the metrics' `dataset.json`, and `channel_types.json` in the dataset's peaks folder.

### Recognised words

Words are compared without case, separators or a trailing number. A test (`src/quality/__tests__/channels.test.ts`) checks this table against the code (`PHYSIO_CHANNELS` and `NON_PHYSIO_CHANNELS` in `src/quality/channels.ts`), so the two cannot drift apart.

<!-- channel-vocabulary:start -->
| Type | Words | Metrics and peak detectors |
|---|---|---|
| PPG | `ppg`, `pleth`, `plethysmograph`, `pulse`, `puls`, `pulseox`, `pulseoximeter`, `bvp` | PPG |
| PPG (assumed) | `cardiac` | PPG, with a note |
| ECG | `ecg`, `ekg` | ECG |
| respiration | `respiratory`, `respiration`, `resp`, `rsp`, `breathing`, `breath`, `respbelt`, `belt` | respiration |
| electrodermal | `eda`, `edatonic`, `edaphasic`, `gsr`, `scr`, `scl`, `skinconductance` | none |
| gas | `co2`, `o2`, `etco2`, `capnography` | none |
| blood pressure | `bp`, `abp`, `bloodpressure` | none |
| muscle (EMG) | `emg` | none |
| non-physio (excluded) | `trigger`, `trig`, `ttl`, `scanner`, `scannertrigger`, `volume`, `slice`, `mark`, `marker`, `event`, `stim`, `stimulus`, `digital`, `sync`, `time`, `timestamp` | none (left out of the metrics; whole names only) |
<!-- channel-vocabulary:end -->

## Filtering

Metrics computed on a filtered signal use one filter per signal type. This is the reference the tool uses:

| Signal | Method | Filter | Notes |
|---|---|---|---|
| PPG | `elgendi` (NeuroKit2 `ppg_clean` default; Elgendi et al. 2013) | 0.5–8 Hz band-pass, Butterworth, order 2, applied forward and backward (zero-phase) | General-purpose choice |

The filter is implemented in `src/data/filters.ts` to match `scipy.signal.butter(..., output="sos")` followed by `scipy.signal.sosfiltfilt`, as NeuroKit2 applies it (Makowski et al. 2021). It needs a sampling rate above 16 Hz (twice the 8 Hz upper edge); below that the filtered metrics are `n/a`. Other signal types have no filter yet, so their filtered metrics are `n/a`.

Filtering a flat signal leaves rounding noise (values near 1e-16) rather than exact zeros. A window of the filtered signal whose standard deviation is at or below 1e3 × machine epsilon × the largest absolute raw value counts as flat, and is skipped by SNR and zero crossing. This is a numerical tolerance (ad hoc, user-approved), not an analysis parameter.

## Summary

| TSV column | Channels | Computed on | Window | 
|---|---|---|---|
| `mean` | all, with a physical unit | raw signal | whole recording | 
| `std_dev` | all | raw signal | whole recording | 
| `std_dev_filtered` | PPG | band-pass filtered signal | whole recording | 
| `snr` | PPG | band-pass filtered signal | 1 s, stepped by 1 s | 
| `entropy` | PPG | raw signal | 1 s, stepped by 1 s | 
| `kurtosis` | PPG | raw signal | 1 s, stepped by 1 s | 
| `skewness` | PPG | raw signal | 5 s, stepped by 1 s | 
| `zero_crossing` | PPG | band-pass filtered signal | 1 s, stepped by 1 s | 
| `perfusion` | PPG | raw and band-pass filtered signal | 1 s | 
| `relative_power` | PPG | raw signal | 60 s, stepped by 30 s | 

## Implemented metrics

### Mean (`mean`)

The average of the raw signal over the whole recording, i.e. its DC level: the sum of the samples divided by their number.

The DC level only means something in a physical unit. The column is therefore given only when the physio sidecar gives the channel a unit other than `"arbitrary"`, the string BIDS uses for arbitrary units (BIDS Specification, Common principles, Units). It is `n/a` when the unit is missing or `"arbitrary"`. This applies to the `mean` column only: means used inside other metrics are computed whatever the units.

### Perfusion (`perfusion`)

The perfusion index P_SQI of Elgendi (2016, Eq. 2), in percent: the peak-to-peak of the band-pass filtered signal y divided by the absolute mean of the raw signal x, times 100. It is computed for channels named `ppg`, `pleth`, `pulse` or `cardiac` (case ignored); ECG and respiratory channels get `n/a`.

- **Filter for y:** the PPG reference filter (see [Filtering](#filtering)). Elgendi (2016) gives no filter, so the one from Elgendi et al. (2013) is used.
- **Window:** 1 s windows stepped by 1 s (Elgendi 2016, Section 3).
- **One value per recording:** the mean over the windows. The paper does not say how windows are combined, so this is ad hoc.
- All windows are kept. The first and last one or two include the filter's start-up transients and read higher (on a synthetic pulse: about 23 and 26 against 20 mid-recording), which matters more for short recordings.
- Windows whose raw mean is 0 are skipped. A signal that was already centred (e.g. a preprocessed derivative) has a raw mean near 0 and gives very large values.

### Skewness (`skewness`)

The skewness S_SQI of Elgendi (2016, Eq. 3): the mean of [(xᵢ − μₓ) / σ]³ over the N samples of the raw PPG signal x. It replaces the whole-recording skewness of every channel; only PPG channels (`ppg`, `pleth`, `pulse`, `cardiac`) get a value.

- **Moments:** the paper calls μₓ and σ "empirical estimates" without saying whether σ divides by N or N − 1. The tool divides by N (population moments), as `scipy.stats.skew` does by default (`bias=True`; Virtanen et al. 2020).
- **Window:** moving windows of 5 s with a 1 s step. Elgendi (2016, Section 3) tested windows of 1 to 30 s stepped by 1 s and found 2 to 5 s best; 5 s is the user's choice within that range.
- **One value per recording:** the mean over the windows (ad hoc, as for perfusion).
- **Reading:** 0 is symmetric. In the paper, values above 0 indicated good quality, with this windowing.

### Kurtosis (`kurtosis`)

The kurtosis K_SQI of Elgendi (2016, Eq. 4): the mean of [(xᵢ − μₓ) / σ]⁴ over the N samples of the raw PPG signal x. This is Pearson's definition: a normal distribution gives 3, and nothing is subtracted. It replaces the whole-recording excess kurtosis of every channel and the 60 s windowed kurtosis (`kurtosis_windowed`, removed); only PPG channels get a value.

- **Moments:** population moments (divide by N), as for skewness; `scipy.stats.kurtosis(x, fisher=False)` gives the same value.
- **Window:** 1 s windows stepped by 1 s (Elgendi 2016, Section 3, p. 11), so they do not overlap.
- **One value per recording:** the mean over the windows (ad hoc, as for perfusion).

### Entropy (`entropy`)

The entropy E_SQI of Elgendi (2016, Eq. 5): −Σ x[n]² ln(x[n]²) over the samples of the raw PPG signal x. Only PPG channels get a value. It is not approximate entropy (Pincus 1991), which is a different measure.

- **A sum, not a mean:** its size depends on the signal's amplitude (and so its units) and on the number of samples per window (the sampling rate). Compare it only between recordings with the same units and rate.
- **Zero samples** add 0, the limit of u ln u as u → 0.
- **Window:** 1 s windows stepped by 1 s, as for perfusion and kurtosis.
- **One value per recording:** the mean over the windows (ad hoc, as for perfusion).

### Zero crossing (`zero_crossing`)

The zero crossing Z_SQI of Elgendi (2016): "the rate of sign-changes in the processed signal", the number of sign changes per sample of the filtered PPG signal y. It replaces the sign-change rate in Hz of the raw signal (`zero_crossing_rate`, removed); only PPG channels get a value. A clean pulse at f Hz gives about 2f divided by the sampling rate.

- **Text and equation disagree:** Eq. 6 as printed, (1/N) Σ I{y < 0}, counts samples below 0, not sign changes, and gives about 0.5 whatever the heart rate. The tool follows the text and the definition it cites, Chen (1988): the short-time zero-crossing count Z_n = Σ_m [sign change at m] · w(n − m). Here w is a rectangular window over each 1 s window, scaled by 1/N as in Eq. 6 (user decision).
- **Sign change** at sample m: y[m] and y[m − 1] lie on different sides of 0, with 0 counted as positive.
- **Filter:** the PPG reference filter (see [Filtering](#filtering)).
- **Window:** 1 s windows stepped by 1 s; **one value per recording:** the mean over the windows (ad hoc, as for perfusion).
- Neither NeuroKit2 nor BioSPPy implements it.

### SNR (`snr`)

The signal-to-noise ratio N_SQI of Elgendi (2016, Eq. 7): σ²(|y|) / σ²(y), the variance of the absolute value of the filtered PPG signal y over the variance of y. It replaces the mean / standard deviation of the raw signal for every channel; only PPG channels get a value.

- Both variances come from the same filtered signal, so it does not separate a signal from a noise estimate; it describes the shape of y. A clean sine gives 1 − 8/π² ≈ 0.189. It does not depend on amplitude or units, and whether the variances divide by N or N − 1 cancels.
- **Filter:** the PPG reference filter (see [Filtering](#filtering)).
- **Window:** the paper gives none; 1 s windows stepped by 1 s, as for zero crossing (user decision). **One value per recording:** the mean over the windows (ad hoc, as for perfusion).
- Elgendi (2016, Table 2) found it a weak discriminator between quality groups (as noted in the project's metric map; not checked here).
- Neither NeuroKit2 nor BioSPPy implements it.

### Relative power (`relative_power`)

The relative power R_SQI of Elgendi (2016, Eq. 9): the power spectral density (Welch's method) in 1 to 2.25 Hz, where most of the systolic and diastolic wave energy lies, over the PSD in 0 to 8 Hz. Only PPG channels with at least 60 s of data get a value.

The paper gives the bands and Welch's method only. Every other setting is NeuroKit2's `ppg_quality(method="relative_power")` default (Makowski et al. 2021; user decision):

- **Input:** the raw PPG signal.
- **Windows:** 60 s, stepped by 30 s. In each window the mean is removed.
- **Welch:** periodic Hann window; segment length half the window (30 s), from `signal_psd`'s default minimum frequency; 50 % segment overlap; FFT length twice the segment (zero-padded); density scaling; no detrending.
- **Band power:** trapezoidal integral of the PSD over [1, 2.25) and [0, 8) Hz, lower edge included and upper edge excluded. Eq. 9 writes plain sums; with evenly spaced bins the ratio is nearly the same.
- **One value per recording:** the mean over the windows (ad hoc, as for perfusion; NeuroKit2 returns one value per sample).

Implemented in `src/data/spectrum.ts` (Welch as `scipy.signal.welch`, with an exact DFT of any length by Bluestein's method).

### Compared with NeuroKit2

NeuroKit2's `ppg_quality` (Makowski et al. 2021) implements Elgendi's skewness, kurtosis, entropy, perfusion and relative power, but not zero crossing or SNR; BioSPPy has no PPG quality indices. Where this tool differs (checked against the NeuroKit2 source, 2026-11-16):

- **Same formula** for skewness and kurtosis: the mean of ((x − μ)/σ)ⁿ with σ dividing by N, Pearson kurtosis (no −3).
- **Input:** NeuroKit2 passes the cleaned (filtered) PPG; this tool uses the raw signal x, as Eqs. 3 to 5 state.
- **Entropy:** NeuroKit2 computes the Shannon entropy of a 16-bin histogram, not Eq. 5.
- **Window:** NeuroKit2 uses 3 s windows stepped by 1 s for skewness, kurtosis, entropy and perfusion; this tool uses 5 s for skewness and 1 s for the others.
- **Output:** NeuroKit2 returns one value per sample (each window's value held until the next); this tool reports the mean over windows.

## Not reviewed yet

These are described as the code computes them today. Known differences from the source papers are listed so they can be checked during the review.

- **Std Dev** (`std_dev`): standard deviation of the raw signal. On the raw signal it includes slow drift.
- **Std Dev (filtered)** (`std_dev_filtered`): standard deviation of the signal after the PPG reference filter (see [Filtering](#filtering)). It measures the pulse amplitude without drift. PPG channels only until a filter is chosen for the other signal types.

Other candidate metrics (the PaPaGei morphology metrics sVRI, IPA and SQI; approximate entropy, Pincus 1991; beat and breath correlation, Romano 2023) are left out of the metrics until each has been reviewed against its paper.
## References

- BIDS Specification, Common principles, Units: <https://bids-specification.readthedocs.io/en/stable/common-principles.html>
- Elgendi, M. (2016). Optimal signal quality index for photoplethysmogram signals. *Bioengineering*, 3(4), 21.
- Chen, C. H. (1988). *Signal Processing Handbook*. CRC Press, New York. (Reference [26] of Elgendi 2016, for the zero-crossing definition.)
- Elgendi, M., Norton, I., Brearley, M., Abbott, D., & Schuurmans, D. (2013). Systolic peak detection in acceleration photoplethysmograms measured from emergency responders in tropical conditions. *PLoS ONE*, 8(10). (As cited in the NeuroKit2 source.)
- Makowski, D., Pham, T., Lau, Z. J., Brammer, J. C., Lespinasse, F., Pham, H., Schölzel, C., & Chen, S. H. A. (2021). NeuroKit2: A Python toolbox for neurophysiological signal processing. *Behavior Research Methods*, 53(4), 1689–1696.
- DuPre, E., Glen, D., Kikas, G., Markello, R., Miedema, M., Moia, S., Picard, M.-È., Salo, T., Stickland, R., Tan, M. X., & Uruñuela, E. (2024). physiopy/peakdet: A python toolbox for reproducible physiological data analysis (v0.5.1). Zenodo. <https://doi.org/10.5281/zenodo.13359249>
- Pincus, S. M. (1991). Approximate entropy as a measure of system complexity. *Proceedings of the National Academy of Sciences*, 88(6), 2297–2301. <https://doi.org/10.1073/pnas.88.6.2297>
- BioSPPy: Biosignal Processing in Python, <https://github.com/scientisst/BioSPPy> (general reference for signal quality indices, e.g. `sSQI` and `kSQI` in `biosppy/signals/ecg.py`, which return `scipy.stats.skew` and `scipy.stats.kurtosis` of the segment given). Carreiras, C., et al. (2015–). (Citation cited from memory, not yet checked.)
- Virtanen, P., et al. (2020). SciPy 1.0: fundamental algorithms for scientific computing in Python. *Nature Methods*, 17, 261–272. (Cited from memory, not yet checked.)
- Romano, C., Innocenti, L., Schena, E., Sacchetti, M., Nicolò, A., & Massaroni, C. (2023). A signal quality index for improving the estimation of breath-by-breath respiratory rate during sport and exercise. *IEEE Sensors Journal*, 23(24), 31250–31258.
- PaPaGei (2025, ICLR): full reference to be added once checked.
