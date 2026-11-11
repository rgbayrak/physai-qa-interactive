# Get started

## What it is for

physAI-QA-interactive is designed for researchers who curate, validate, or reuse BIDS-compliant datasets containing physiological recordings, such as cardiac and respiratory signals.

It runs locally on your computer and opens in your web browser, providing an interactive environment to explore, review, and annotate physiological recordings.


See the {doc}`overview` for how these fit together.

## What you need

- **Node.js 22 (LTS)**, which comes with npm. Install it from <https://nodejs.org/en/download>.
- **Git**, to download the project.
- **A BIDS-compliant dataset with physiological recordings.**
- **A desktop web browser.**

The commands in these docs are for the macOS and Linux terminal. On Windows, use PowerShell (see {doc}`user-guide/start`).

## Install

Check that Node.js is installed:

```bash
node --version   # prints v22…
npm --version    # prints a version number
```

Then download the project and install its packages:

```bash
git clone https://github.com/rgbayrak/physai-qa-interactive.git
cd physai-qa-interactive
npm install
```

Run all later commands in this project folder.

## Next

{doc}`user-guide/start`: choose a dataset and open it in your browser.
