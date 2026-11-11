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
# attrs_block: {.class} on the line before a block, e.g. {.table-note}
myst_enable_extensions = ["colon_fence", "deflist", "attrs_block"]
# Anchors for headings, so in-page links like [x](#some-heading) resolve
myst_heading_anchors = 3

# Build output and macOS folder files
exclude_patterns = [
    "_build",
    ".DS_Store",
]

html_theme = "insipid"
html_title = "physAI-QA-interactive"  # browser tabs; the top bar hides it (custom.css)
html_logo = "images/logo.png"  # shown at the top of the sidebar
html_favicon = "images/logo.png"
templates_path = ["_templates"]  # globaltoc.html: project name as the sidebar heading
html_static_path = ["_static"]
html_css_files = ["custom.css"]  # smaller sidebar logo
html_js_files = ["sidebar.js"]  # collapsible "Contributing" entry in the sidebar

# Persistent table of contents: the whole site's contents in the sidebar,
# open by default on screens at least 60rem wide (it still has a toggle,
# and starts closed on phones so it does not cover the text)
html_sidebars = {"**": ["globaltoc.html"]}
html_theme_options = {
    # Wider text column than the theme's default, so screenshots and the
    # workflow diagram are readable
    "body_max_width": "64em",
    "initial_sidebar_visibility_threshold": "60rem",
    "globaltoc_collapse": False,
    "globaltoc_includehidden": True,  # the home page's toctree is hidden
    "globaltoc_maxdepth": 2,
}
