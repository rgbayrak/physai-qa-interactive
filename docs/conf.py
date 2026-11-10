# Sphinx configuration for the physAI-QA-interactive documentation.
# Build locally with:
#   uv run --no-project --with-requirements docs/requirements.txt \
#     sphinx-build -W -b html docs docs/_build/html

project = "physAI-QA-interactive"
author = "physAI-QA-interactive contributors"
copyright = "2026, physAI-QA-interactive contributors"

extensions = ["myst_parser"]

# Pages are Markdown (MyST)
source_suffix = {".md": "markdown"}
myst_enable_extensions = ["colon_fence", "deflist"]
# Anchors for headings, so in-page links like [x](#some-heading) resolve
myst_heading_anchors = 3

# Build output and macOS folder files
exclude_patterns = [
    "_build",
    ".DS_Store",
]

html_theme = "insipid"
html_title = "physAI-QA-interactive"
