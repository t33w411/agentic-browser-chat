(function () {
  // mermaid.min.js calls customElements.define() for several element names.
  // On first page load this works fine. On re-injection after an extension
  // reload the same names are already registered, causing customElements.define
  // to throw a NotSupportedError. That exception propagates through mermaid's
  // factory function, so the UMD assignment `globalThis.mermaid = b0()` never
  // completes and window.mermaid is left undefined.
  //
  // Patching customElements.define here (before mermaid.min.js runs) makes the
  // call idempotent: duplicate registrations are silently skipped instead of
  // throwing, allowing mermaid's factory to complete and set window.mermaid.
  if (!customElements || typeof customElements.define !== 'function') {
    return;
  }
  var _origDefineForMermaidGuard = customElements.define.bind(customElements);
  customElements.define = function mermaidGuardDefine(name, constructor, options) {
    if (customElements.get(name)) {
      // Surface silently-ignored duplicate registrations so future mermaid upgrades
      // that try to redefine an element under an existing name are discoverable.
      try {
        console.debug('[abchat] mermaid-guard: skipped duplicate customElements.define for "' + name + '"');
      } catch (_) {}
      return;
    }
    return _origDefineForMermaidGuard(name, constructor, options);
  };
})();
