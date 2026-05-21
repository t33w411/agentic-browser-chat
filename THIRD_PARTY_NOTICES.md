# Third-Party Notices

This extension bundles the following third-party libraries under `lib/`. Each retains its original license. This file lists them for attribution; consult each project for the canonical license text.

| Library | File(s) | License | Project |
|---|---|---|---|
| Dexie.js | `dexie.min.js` | Apache-2.0 | https://dexie.org |
| FlexSearch | `flexsearch.min.js` | Apache-2.0 | https://github.com/nextapps-de/flexsearch |
| highlight.js | `highlight.min.js`, `github-dark.min.css` | BSD-3-Clause | https://highlightjs.org |
| JSZip | `jszip.min.js` | MIT or GPLv3 (dual) | https://stuk.github.io/jszip/ |
| mammoth.js | `mammoth.min.js` | BSD-2-Clause | https://github.com/mwilliamson/mammoth.js |
| marked | `marked.min.js` | MIT | https://marked.js.org |
| MathJax | `mathjax-startup.js`, `tex-svg.js` | Apache-2.0 | https://www.mathjax.org |
| Mermaid | `mermaid.min.js`, `mermaid-guard.js` (wrapper) | MIT | https://mermaid.js.org |
| PapaParse | `papaparse.min.js` | MIT | https://www.papaparse.com |
| PDF.js | `pdf.min.js`, `pdf.worker.min.js` | Apache-2.0 | https://mozilla.github.io/pdf.js/ |
| DOMPurify | `purify.min.js` | Apache-2.0 or MPL-2.0 (dual) | https://github.com/cure53/DOMPurify |
| SheetJS (xlsx) | `xlsx.min.js` | Apache-2.0 (Community Edition) | https://sheetjs.com |

`lib/mermaid-guard.js` is original code in this repository, not third-party. It only wraps Mermaid's `customElements.define` call.

If you redistribute a built/packaged version of this extension, you must include the license texts of the libraries above. The simplest path is to copy the `LICENSE` file from each upstream project alongside the distribution.

If you spot a missing attribution or a license mismatch, please open an issue or PR.
