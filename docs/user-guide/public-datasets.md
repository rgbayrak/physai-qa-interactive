# Public datasets

No dataset of your own? These datasets have physiological recordings in BIDS format and work with the tool.

## OpenNeuro datasets with physiological recordings

The GitHub column is the repository DataLad installs from (see [Download with DataLad](#download-with-datalad-ds006644-example)).

| OpenNeuro | Name | GitHub | Tested |
|---|---|---|---|
| [ds000210](https://openneuro.org/datasets/ds000210) | Multi-echo fMRI replication sample of autobiographical memory, prospection and theory of mind reasoning tasks | [OpenNeuroDatasets/ds000210](https://github.com/OpenNeuroDatasets/ds000210) | Yes |
| [ds001168](https://openneuro.org/datasets/ds001168) | A high resolution 7-Tesla resting-state fMRI test-retest dataset with cognitive and physiological measures | [OpenNeuroDatasets/ds001168](https://github.com/OpenNeuroDatasets/ds001168) |  |
| [ds002547](https://openneuro.org/datasets/ds002547) | SharedStates | [OpenNeuroDatasets/ds002547](https://github.com/OpenNeuroDatasets/ds002547) |  |
| [ds002785](https://openneuro.org/datasets/ds002785) | Amsterdam Open MRI Collection (AOMIC) PIOP1 | [OpenNeuroDatasets/ds002785](https://github.com/OpenNeuroDatasets/ds002785) |  |
| [ds002790](https://openneuro.org/datasets/ds002790) | Amsterdam Open MRI Collection (AOMIC) PIOP2 | [OpenNeuroDatasets/ds002790](https://github.com/OpenNeuroDatasets/ds002790) |  |
| [ds003097](https://openneuro.org/datasets/ds003097) | Amsterdam Open MRI Collection (AOMIC) ID1000 | [OpenNeuroDatasets/ds003097](https://github.com/OpenNeuroDatasets/ds003097) |  |
| [ds003357](https://openneuro.org/datasets/ds003357) | The influence of heart rate variability biofeedback on cardiac regulation and functional brain connectivity | [OpenNeuroDatasets/ds003357](https://github.com/OpenNeuroDatasets/ds003357) |  |
| [ds003452](https://openneuro.org/datasets/ds003452) | Dual Mechanisms of Cognitive Control project | [OpenNeuroDatasets/ds003452](https://github.com/OpenNeuroDatasets/ds003452) |  |
| [ds003592](https://openneuro.org/datasets/ds003592) | Neurocognitive aging data release with behavioral, structural, and multi-echo functional MRI measures | [OpenNeuroDatasets/ds003592](https://github.com/OpenNeuroDatasets/ds003592) |  |
| [ds003823](https://openneuro.org/datasets/ds003823) | Heart rate variability biofeedback training and emotion regulation | [OpenNeuroDatasets/ds003823](https://github.com/OpenNeuroDatasets/ds003823) |  |
| [ds004493](https://openneuro.org/datasets/ds004493) | Neural activity induced by sensory stimulation can drive large-scale cerebrospinal fluid flow during wakefulness in humans | [OpenNeuroDatasets/ds004493](https://github.com/OpenNeuroDatasets/ds004493) |  |
| [ds004636](https://openneuro.org/datasets/ds004636) | Cognitive tasks, anatomical MRI, and functional MRI data evaluating the construct of self-regulation | [OpenNeuroDatasets/ds004636](https://github.com/OpenNeuroDatasets/ds004636) |  |
| [ds004645](https://openneuro.org/datasets/ds004645) | Resting-state fMRI signals contain spectral signatures of local hemodynamic response timing | [OpenNeuroDatasets/ds004645](https://github.com/OpenNeuroDatasets/ds004645) |  |
| [ds004662](https://openneuro.org/datasets/ds004662) | Denoising task-correlated head motion from motor-task fMRI data with multi-echo ICA | [OpenNeuroDatasets/ds004662](https://github.com/OpenNeuroDatasets/ds004662) | Yes |
| [ds005418](https://openneuro.org/datasets/ds005418) | Cerebrovascular Reactivity: CO2 inhalation and resting state comparisons | [OpenNeuroDatasets/ds005418](https://github.com/OpenNeuroDatasets/ds005418) |  |
| [ds006644](https://openneuro.org/datasets/ds006644) | DMT-HAR-MED: Effects of DMT and harmine during meditation: Functional MRI dataset | [OpenNeuroDatasets/ds006644](https://github.com/OpenNeuroDatasets/ds006644) | Yes |

ds006644 is the dataset used throughout these docs and in the {doc}`user-study`. It includes fMRIPrep derivatives, so the confounds chart works.

## Download with DataLad (ds006644 example)

OpenNeuro publishes every dataset as a [DataLad](https://www.datalad.org) dataset. DataLad first downloads only the file list; you then fetch just the files you need (here for the purpose of this tool, not the large imaging files).

1. **Install DataLad** by following the instructions for your operating system at <https://www.datalad.org/#install>.

2. **Install the dataset.** This downloads the file list and small files such as `dataset_description.json`, but not the recordings. Replace `ds006644` with the dataset you want:

   ```bash
   datalad install -s https://github.com/OpenNeuroDatasets/ds006644.git data/ds006644
   cd data/ds006644
   ```

3. **Get the physiological recordings.** For a dataset with sessions:

   ```bash
   datalad get sub-*/ses-*/func/*_physio.*
   ```

   For a dataset without sessions:

   ```bash
   datalad get sub-*/func/*_physio.*
   ```

4. **Optional: get the confounds**, if the dataset has fMRIPrep derivatives (for the confounds chart):

   ```bash
   datalad get derivatives/fmriprep/sub-*/ses-*/func/*_desc-confounds_timeseries.*
   ```

5. **Start the tool** from the project folder (see {doc}`start`):

   ```bash
   BIDS_ROOT=data/ds006644 npm run dev
   ```

For the full list of files the tool reads (BOLD sidecars, task events, derivatives stored as a subdataset), see [what to download with DataLad](troubleshooting.md#if-using-datalad-what-to--datalad-get).
