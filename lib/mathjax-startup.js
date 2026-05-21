window.MathJax = {
  tex: {
    inlineMath: [['\\(', '\\)']],
    displayMath: [['\\[', '\\]'], ['$$', '$$']],
    processEscapes: true,
    processEnvironments: true,
  },
  svg: {
    fontCache: 'global', // Share SVG <defs> across all math elements on the page
  },
  options: {
    skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
    ignoreHtmlClass: 'tex2jax_ignore',
    processHtmlClass: 'tex2jax_process',
    enableMenu: false, // shadow DOM focus-null crash on menu unpost
  },
  startup: {
    typeset: false, // Don't auto-typeset on load — we call typesetMathJax() manually
  },
};
