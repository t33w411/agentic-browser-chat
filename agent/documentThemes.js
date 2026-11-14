(function () {
  const globalScopeForDocumentThemes = globalThis;
  const nsForDocumentThemes = globalScopeForDocumentThemes.ABChatAgent || {};

  // The look of a new document is decided here, not by the model, so every file comes out
  // consistent whichever model wrote it. The model only picks a theme by name and may override a
  // colour or a font. Every builder (DOCX, PDF, and later XLSX and PPTX) reads the resolved theme.

  const DEFAULT_THEME_NAME_FOR_DOCUMENT_THEMES = 'professional';
  // Relative luminance at which a colour on white reaches 3:1 contrast, the floor for large text.
  const MAX_HEADING_LUMINANCE_FOR_DOCUMENT_THEMES = 0.3;

  // Curated fonts. DOCX, XLSX and PPTX name their fonts rather than carrying them, so `office` must
  // be a font most machines already have. `web` is the Google Fonts family the PDF print route
  // loads; for an Office font it is the metric-compatible open clone, so line breaks match.
  const FONTS_FOR_DOCUMENT_THEMES = [
    { name: 'Calibri', kind: 'sans', office: 'Calibri', web: 'Carlito' },
    { name: 'Cambria', kind: 'serif', office: 'Cambria', web: 'Caladea' },
    { name: 'Arial', kind: 'sans', office: 'Arial', web: 'Arimo' },
    { name: 'Helvetica', kind: 'sans', office: 'Arial', web: 'Arimo' },
    { name: 'Times New Roman', kind: 'serif', office: 'Times New Roman', web: 'Tinos' },
    { name: 'Georgia', kind: 'serif', office: 'Georgia', web: 'Gelasio' },
    { name: 'Garamond', kind: 'serif', office: 'Garamond', web: 'EB Garamond' },
    { name: 'Courier New', kind: 'mono', office: 'Courier New', web: 'Cousine' },
    { name: 'Consolas', kind: 'mono', office: 'Consolas', web: 'Inconsolata' },
    { name: 'Inter', kind: 'sans', office: 'Arial', web: 'Inter' },
    { name: 'Roboto', kind: 'sans', office: 'Arial', web: 'Roboto' },
    { name: 'Open Sans', kind: 'sans', office: 'Arial', web: 'Open Sans' },
    { name: 'Lato', kind: 'sans', office: 'Calibri', web: 'Lato' },
    { name: 'Source Sans 3', kind: 'sans', office: 'Calibri', web: 'Source Sans 3' },
    { name: 'Nunito Sans', kind: 'sans', office: 'Calibri', web: 'Nunito Sans' },
    { name: 'Work Sans', kind: 'sans', office: 'Arial', web: 'Work Sans' },
    { name: 'IBM Plex Sans', kind: 'sans', office: 'Arial', web: 'IBM Plex Sans' },
    { name: 'Montserrat', kind: 'sans', office: 'Arial', web: 'Montserrat' },
    { name: 'Poppins', kind: 'sans', office: 'Arial', web: 'Poppins' },
    { name: 'Raleway', kind: 'sans', office: 'Arial', web: 'Raleway' },
    { name: 'Merriweather', kind: 'serif', office: 'Georgia', web: 'Merriweather' },
    { name: 'Lora', kind: 'serif', office: 'Georgia', web: 'Lora' },
    { name: 'Source Serif 4', kind: 'serif', office: 'Cambria', web: 'Source Serif 4' },
    { name: 'Libre Baskerville', kind: 'serif', office: 'Georgia', web: 'Libre Baskerville' },
    { name: 'Crimson Pro', kind: 'serif', office: 'Cambria', web: 'Crimson Pro' },
    { name: 'EB Garamond', kind: 'serif', office: 'Garamond', web: 'EB Garamond' },
    { name: 'Playfair Display', kind: 'serif', office: 'Georgia', web: 'Playfair Display' },
    { name: 'DM Serif Display', kind: 'serif', office: 'Georgia', web: 'DM Serif Display' },
    { name: 'JetBrains Mono', kind: 'mono', office: 'Consolas', web: 'JetBrains Mono' },
    { name: 'IBM Plex Mono', kind: 'mono', office: 'Consolas', web: 'IBM Plex Mono' },
    { name: 'Source Code Pro', kind: 'mono', office: 'Consolas', web: 'Source Code Pro' }
  ];

  const SERIF_HINT_FOR_DOCUMENT_THEMES = /serif|times|georgia|garamond|cambria|baskerville|palatino|book|minion|caslon|bodoni|didot|merriweather|lora|playfair/i;
  const MONO_HINT_FOR_DOCUMENT_THEMES = /mono|courier|consolas|menlo|monaco|inconsolata|code/i;

  // Table styles:
  //   header-fill  filled header row in the primary colour, light row lines, striped rows
  //   lines        no fill, a strong rule under the header, light row lines
  //   grid         every cell boxed, lightly tinted header
  //   booktabs     rules only above and below the header and under the last row
  // Deck covers (PPTX title and section slides):
  //   fill         the primary colour fills the slide, with an accent band along the bottom
  //   plain        white, with the accent rule under the title or a bar beside a section title
  // A filled cover also gets a faint pattern in the primary colour (deck.pattern) unless the slide
  // has its own background or asks for none.
  const THEMES_FOR_DOCUMENT_THEMES = [
    {
      name: 'professional',
      label: 'Professional',
      useFor: 'business reports, proposals, memos, invoices, and procedures',
      fonts: { heading: 'Calibri', body: 'Calibri', mono: 'Consolas' },
      webFonts: { heading: 'Source Sans 3', body: 'Source Sans 3', mono: 'Source Code Pro' },
      colors: { text: '1F2328', muted: '5B6470', heading: '1F3864', primary: '1F3864', accent: '2E75B6' },
      sizes: { body: 11, small: 9, title: 26, subtitle: 13, headings: [17, 13.5, 12, 11, 11, 11] },
      spacing: { line: 1.15, after: 8, headingBefore: [20, 14, 12, 10, 10, 10], headingAfter: [6, 4, 4, 2, 2, 2] },
      title: { align: 'left', rule: true },
      headingRule: false,
      table: { style: 'header-fill', zebra: true },
      deck: { cover: 'fill', pattern: 'grid' },
      footer: 'page-x-of-y',
      marginPt: 72
    },
    {
      name: 'modern',
      label: 'Modern',
      useFor: 'one-pagers, product and project briefs, pitch decks, startup and tech documents, and résumés',
      fonts: { heading: 'Arial', body: 'Arial', mono: 'Consolas' },
      webFonts: { heading: 'Montserrat', body: 'Inter', mono: 'JetBrains Mono' },
      colors: { text: '1F2937', muted: '6B7280', heading: '111827', primary: '0F766E', accent: '0F766E' },
      sizes: { body: 10.5, small: 8.5, title: 28, subtitle: 13, headings: [16, 13, 11.5, 10.5, 10.5, 10.5] },
      spacing: { line: 1.2, after: 8, headingBefore: [22, 16, 12, 10, 10, 10], headingAfter: [6, 4, 3, 2, 2, 2] },
      title: { align: 'left', rule: false },
      headingRule: false,
      table: { style: 'lines', zebra: false },
      deck: { cover: 'fill', pattern: 'dots' },
      footer: 'page-x-of-y',
      marginPt: 66
    },
    {
      name: 'classic',
      label: 'Classic',
      useFor: 'formal letters, legal documents, policies, contracts, and traditional correspondence',
      fonts: { heading: 'Georgia', body: 'Georgia', mono: 'Courier New' },
      webFonts: { heading: 'Libre Baskerville', body: 'Lora', mono: 'Cousine' },
      colors: { text: '222222', muted: '5E5A55', heading: '1A1A1A', primary: '6B1F2A', accent: '6B1F2A' },
      sizes: { body: 11, small: 9, title: 22, subtitle: 12, headings: [15, 13, 11.5, 11, 11, 11] },
      spacing: { line: 1.2, after: 8, headingBefore: [18, 14, 12, 10, 10, 10], headingAfter: [6, 4, 4, 2, 2, 2] },
      title: { align: 'center', rule: true },
      headingRule: false,
      table: { style: 'grid', zebra: false },
      deck: { cover: 'plain' },
      footer: 'page-number',
      marginPt: 72
    },
    {
      name: 'minimal',
      label: 'Minimal',
      useFor: 'technical documentation, notes, meeting minutes, checklists, and plain internal documents',
      fonts: { heading: 'Arial', body: 'Arial', mono: 'Consolas' },
      webFonts: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
      colors: { text: '1A1A1A', muted: '6E6E6E', heading: '111111', primary: '333333', accent: '555555' },
      sizes: { body: 10.5, small: 8.5, title: 20, subtitle: 11.5, headings: [14, 12, 11, 10.5, 10.5, 10.5] },
      spacing: { line: 1.2, after: 6, headingBefore: [16, 12, 10, 8, 8, 8], headingAfter: [4, 3, 2, 2, 2, 2] },
      title: { align: 'left', rule: false },
      headingRule: false,
      table: { style: 'lines', zebra: false },
      deck: { cover: 'plain' },
      footer: 'page-number',
      marginPt: 64
    },
    {
      name: 'academic',
      label: 'Academic',
      useFor: 'essays, research papers, theses, coursework, and anything that follows school or journal conventions',
      fonts: { heading: 'Times New Roman', body: 'Times New Roman', mono: 'Courier New' },
      webFonts: { heading: 'Tinos', body: 'Tinos', mono: 'Cousine' },
      colors: { text: '000000', muted: '404040', heading: '000000', primary: '000000', accent: '000000' },
      sizes: { body: 12, small: 10, title: 18, subtitle: 12, headings: [14, 12, 12, 12, 12, 12] },
      spacing: { line: 1.5, after: 6, headingBefore: [18, 12, 12, 12, 12, 12], headingAfter: [6, 6, 6, 6, 6, 6] },
      title: { align: 'center', rule: false },
      headingRule: false,
      table: { style: 'booktabs', zebra: false },
      deck: { cover: 'plain' },
      footer: 'page-number',
      marginPt: 72
    },
    {
      name: 'vibrant',
      label: 'Vibrant',
      useFor: 'flyers, newsletters, event programmes, marketing pieces, and other documents meant to catch the eye',
      fonts: { heading: 'Arial', body: 'Calibri', mono: 'Consolas' },
      webFonts: { heading: 'Poppins', body: 'Nunito Sans', mono: 'JetBrains Mono' },
      colors: { text: '1E1B2E', muted: '625D75', heading: '4C1D95', primary: '5B21B6', accent: 'E8590C' },
      sizes: { body: 11, small: 9, title: 30, subtitle: 14, headings: [18, 14, 12, 11, 11, 11] },
      spacing: { line: 1.2, after: 8, headingBefore: [22, 16, 12, 10, 10, 10], headingAfter: [6, 4, 4, 2, 2, 2] },
      title: { align: 'left', rule: true },
      headingRule: false,
      table: { style: 'header-fill', zebra: true },
      deck: { cover: 'fill', pattern: 'waves' },
      footer: 'page-x-of-y',
      marginPt: 66
    }
  ];

  // Callout tones. `info` follows the theme's accent so a callout always matches the document.
  const CALLOUT_TONE_COLORS_FOR_DOCUMENT_THEMES = {
    success: '2F855A',
    warning: 'B7791F',
    danger: 'C53030',
    note: '6B7280'
  };

  const PAGE_SIZES_FOR_DOCUMENT_THEMES = {
    letter: { widthPt: 612, heightPt: 792 },
    a4: { widthPt: 595.28, heightPt: 841.89 },
    legal: { widthPt: 612, heightPt: 1008 }
  };

  // Regions that use US Letter rather than A4.
  const LETTER_REGIONS_FOR_DOCUMENT_THEMES = {
    US: true, CA: true, MX: true, PH: true, CL: true, CO: true, VE: true, CR: true,
    GT: true, PA: true, DO: true, PR: true, SV: true, NI: true, BZ: true
  };

  function cloneForDocumentThemes(valueForClone) {
    return JSON.parse(JSON.stringify(valueForClone));
  }

  // '#1f3864', '1F3864' and '#abc' are accepted; anything else returns ''.
  function normalizeHexColorForDocumentThemes(valueForNormalize) {
    var textForNormalize = String(valueForNormalize == null ? '' : valueForNormalize).trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(textForNormalize)) {
      textForNormalize = textForNormalize.split('').map(function (charForNormalize) {
        return charForNormalize + charForNormalize;
      }).join('');
    }
    return /^[0-9a-fA-F]{6}$/.test(textForNormalize) ? textForNormalize.toUpperCase() : '';
  }

  function rgbFromHexForDocumentThemes(hexForRgb) {
    var safeForRgb = normalizeHexColorForDocumentThemes(hexForRgb) || '000000';
    return [0, 2, 4].map(function (offsetForRgb) { return parseInt(safeForRgb.substr(offsetForRgb, 2), 16); });
  }

  function hexFromRgbForDocumentThemes(rgbForHex) {
    return rgbForHex.map(function (channelForHex) {
      var clampedForHex = Math.max(0, Math.min(255, Math.round(channelForHex)));
      return (clampedForHex < 16 ? '0' : '') + clampedForHex.toString(16);
    }).join('').toUpperCase();
  }

  // Mixes a colour with white. amount 0 keeps the colour, 1 gives white.
  function tintHexColorForDocumentThemes(hexForTint, amountForTint) {
    var amountClampedForTint = Math.max(0, Math.min(1, Number(amountForTint) || 0));
    return hexFromRgbForDocumentThemes(rgbFromHexForDocumentThemes(hexForTint).map(function (channelForTint) {
      return channelForTint + (255 - channelForTint) * amountClampedForTint;
    }));
  }

  // WCAG relative luminance, 0 for black to 1 for white.
  function luminanceForDocumentThemes(hexForLuminance) {
    var channelsForLuminance = rgbFromHexForDocumentThemes(hexForLuminance).map(function (channelForLuminance) {
      var srgbForLuminance = channelForLuminance / 255;
      return srgbForLuminance <= 0.03928 ? srgbForLuminance / 12.92 : Math.pow((srgbForLuminance + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channelsForLuminance[0] + 0.7152 * channelsForLuminance[1] + 0.0722 * channelsForLuminance[2];
  }

  // The colour itself when it reads as text on white (3:1), otherwise the same hue darkened in
  // steps until it does. Used wherever an accent colour is drawn as text or as a list marker.
  function readableOnWhiteForDocumentThemes(hexForReadable) {
    var rgbForReadable = rgbFromHexForDocumentThemes(hexForReadable);
    for (var stepForReadable = 0; stepForReadable <= 20; stepForReadable++) {
      var keepForReadable = 1 - stepForReadable * 0.05;
      var candidateForReadable = hexFromRgbForDocumentThemes(rgbForReadable.map(function (channelForReadable) {
        return channelForReadable * keepForReadable;
      }));
      if (luminanceForDocumentThemes(candidateForReadable) <= MAX_HEADING_LUMINANCE_FOR_DOCUMENT_THEMES) return candidateForReadable;
    }
    return '000000';
  }

  function findFontForDocumentThemes(nameForFind) {
    var keyForFind = String(nameForFind == null ? '' : nameForFind).trim().toLowerCase();
    if (!keyForFind) return null;
    for (var iForFind = 0; iForFind < FONTS_FOR_DOCUMENT_THEMES.length; iForFind++) {
      if (FONTS_FOR_DOCUMENT_THEMES[iForFind].name.toLowerCase() === keyForFind) return FONTS_FOR_DOCUMENT_THEMES[iForFind];
    }
    return null;
  }

  // A font outside the curated list is one the user named. It is used as named in every format:
  // Office formats reference it by name, and the PDF print route tries to load it.
  function describeFontForDocumentThemes(nameForDescribe) {
    var curatedForDescribe = findFontForDocumentThemes(nameForDescribe);
    if (curatedForDescribe) {
      return {
        name: curatedForDescribe.name,
        kind: curatedForDescribe.kind,
        office: curatedForDescribe.office,
        web: curatedForDescribe.web,
        curated: true
      };
    }
    var cleanForDescribe = String(nameForDescribe == null ? '' : nameForDescribe).replace(/["';{}<>]/g, '').trim().slice(0, 60);
    if (!cleanForDescribe) return null;
    var kindForDescribe = MONO_HINT_FOR_DOCUMENT_THEMES.test(cleanForDescribe)
      ? 'mono'
      : (SERIF_HINT_FOR_DOCUMENT_THEMES.test(cleanForDescribe) ? 'serif' : 'sans');
    return { name: cleanForDescribe, kind: kindForDescribe, office: cleanForDescribe, web: cleanForDescribe, curated: false };
  }

  function findThemeDefinitionForDocumentThemes(nameForTheme) {
    var keyForTheme = String(nameForTheme == null ? '' : nameForTheme).trim().toLowerCase();
    for (var iForTheme = 0; iForTheme < THEMES_FOR_DOCUMENT_THEMES.length; iForTheme++) {
      if (THEMES_FOR_DOCUMENT_THEMES[iForTheme].name === keyForTheme) return THEMES_FOR_DOCUMENT_THEMES[iForTheme];
    }
    return null;
  }

  function fontRoleForDocumentThemes(officeNameForRole, webNameForRole) {
    var describedForRole = describeFontForDocumentThemes(officeNameForRole);
    return {
      name: describedForRole.name,
      kind: describedForRole.kind,
      office: describedForRole.office,
      web: webNameForRole || describedForRole.web
    };
  }

  // Derived colours are computed from primary and accent, so overriding either one restyles the
  // header row, stripes, rules and callouts to match.
  function deriveColorsForDocumentThemes(themeForDerive) {
    var colorsForDerive = themeForDerive.colors;
    var styleForDerive = themeForDerive.table.style;
    var primaryForDerive = colorsForDerive.primary;
    var derivedForDerive = {
      link: colorsForDerive.accent === '000000' ? '1F4E9A' : readableOnWhiteForDocumentThemes(colorsForDerive.accent),
      accentText: readableOnWhiteForDocumentThemes(colorsForDerive.accent),
      rule: tintHexColorForDocumentThemes(colorsForDerive.accent, 0.55),
      tableBorder: tintHexColorForDocumentThemes(colorsForDerive.text, 0.82),
      tableHeaderFill: '',
      tableHeaderText: colorsForDerive.heading,
      tableHeaderRule: primaryForDerive,
      tableStripe: '',
      calloutFill: tintHexColorForDocumentThemes(colorsForDerive.accent, 0.9)
    };
    if (styleForDerive === 'header-fill') {
      derivedForDerive.tableHeaderFill = primaryForDerive;
      derivedForDerive.tableHeaderText = luminanceForDocumentThemes(primaryForDerive) > 0.45 ? colorsForDerive.text : 'FFFFFF';
      derivedForDerive.tableBorder = tintHexColorForDocumentThemes(primaryForDerive, 0.78);
    } else if (styleForDerive === 'grid') {
      derivedForDerive.tableHeaderFill = tintHexColorForDocumentThemes(primaryForDerive, 0.9);
      derivedForDerive.tableHeaderText = colorsForDerive.text;
      derivedForDerive.tableBorder = tintHexColorForDocumentThemes(colorsForDerive.text, 0.6);
    } else if (styleForDerive === 'booktabs') {
      derivedForDerive.tableHeaderRule = colorsForDerive.text;
      derivedForDerive.tableBorder = colorsForDerive.text;
    }
    if (themeForDerive.table.zebra) {
      derivedForDerive.tableStripe = tintHexColorForDocumentThemes(primaryForDerive, 0.93);
    }
    Object.keys(derivedForDerive).forEach(function (keyForDerive) {
      colorsForDerive[keyForDerive] = derivedForDerive[keyForDerive];
    });
  }

  // overrides: { primary_color, accent_color, heading_font, body_font }. Each bad value is skipped
  // with a warning, never an error, so a typo still produces a document.
  // format: a DOCX only names its fonts, so a font outside the curated list gets a warning that a
  // reader may see a substitute. A PDF gets no such warning here: Chrome embeds the font, and the
  // printer warns when it can find it nowhere; the built-in writer's note covers its own fonts.
  function resolveThemeForDocumentThemes(nameForResolve, overridesForResolve, formatForResolve) {
    var warningsForResolve = [];
    var definitionForResolve = null;
    if (nameForResolve != null && String(nameForResolve).trim() !== '') {
      definitionForResolve = findThemeDefinitionForDocumentThemes(nameForResolve);
      if (!definitionForResolve) {
        warningsForResolve.push('Unknown theme "' + String(nameForResolve).slice(0, 40) + '"; used ' + DEFAULT_THEME_NAME_FOR_DOCUMENT_THEMES + '.');
      }
    }
    if (!definitionForResolve) definitionForResolve = findThemeDefinitionForDocumentThemes(DEFAULT_THEME_NAME_FOR_DOCUMENT_THEMES);
    var themeForResolve = cloneForDocumentThemes(definitionForResolve);
    themeForResolve.fonts = {
      heading: fontRoleForDocumentThemes(definitionForResolve.fonts.heading, definitionForResolve.webFonts.heading),
      body: fontRoleForDocumentThemes(definitionForResolve.fonts.body, definitionForResolve.webFonts.body),
      mono: fontRoleForDocumentThemes(definitionForResolve.fonts.mono, definitionForResolve.webFonts.mono)
    };
    delete themeForResolve.webFonts;

    var safeOverridesForResolve = (overridesForResolve && typeof overridesForResolve === 'object') ? overridesForResolve : {};
    var appliedForResolve = {};
    [['primary_color', 'primary'], ['accent_color', 'accent']].forEach(function (pairForColor) {
      var rawForColor = safeOverridesForResolve[pairForColor[0]];
      if (rawForColor == null || rawForColor === '') return;
      var hexForColor = normalizeHexColorForDocumentThemes(rawForColor);
      if (!hexForColor) {
        warningsForResolve.push(pairForColor[0] + ' "' + String(rawForColor).slice(0, 20) + '" is not a hex colour such as #1F3864; kept the theme colour.');
        return;
      }
      themeForResolve.colors[pairForColor[1]] = hexForColor;
      // A brand colour is asked for so it shows, so headings take it in every theme, including the
      // ones whose own headings are near-black. A colour too light to read as text on white (under
      // 3:1 contrast) gives the headings the theme's text colour instead, which never clashes.
      if (pairForColor[1] === 'primary') {
        themeForResolve.colors.heading = luminanceForDocumentThemes(hexForColor) <= MAX_HEADING_LUMINANCE_FOR_DOCUMENT_THEMES
          ? hexForColor
          : definitionForResolve.colors.text;
      }
      appliedForResolve[pairForColor[0]] = '#' + hexForColor;
    });
    // A brand colour given alone recolours the accents too (bullets, rules, callouts), so the
    // document never mixes the brand colour with the theme's own accent.
    if (appliedForResolve.primary_color && !appliedForResolve.accent_color) {
      themeForResolve.colors.accent = themeForResolve.colors.primary;
    }
    [['heading_font', 'heading'], ['body_font', 'body']].forEach(function (pairForFont) {
      var rawForFont = safeOverridesForResolve[pairForFont[0]];
      if (rawForFont == null || rawForFont === '') return;
      var describedForFont = describeFontForDocumentThemes(rawForFont);
      if (!describedForFont) return;
      themeForResolve.fonts[pairForFont[1]] = {
        name: describedForFont.name,
        kind: describedForFont.kind,
        office: describedForFont.office,
        web: describedForFont.web
      };
      appliedForResolve[pairForFont[0]] = describedForFont.name;
      if (!describedForFont.curated && formatForResolve !== 'pdf') {
        warningsForResolve.push(pairForFont[0] + ' "' + describedForFont.name + '" is not in the curated list. It is used as named; a reader without it installed sees a substitute.');
      }
    });
    deriveColorsForDocumentThemes(themeForResolve);
    themeForResolve.overrides = appliedForResolve;
    return { theme: themeForResolve, warnings: warningsForResolve };
  }

  function calloutColorsForDocumentThemes(themeForCallout, toneForCallout) {
    var toneKeyForCallout = String(toneForCallout || 'info').toLowerCase();
    var barForCallout = CALLOUT_TONE_COLORS_FOR_DOCUMENT_THEMES[toneKeyForCallout]
      || (themeForCallout && themeForCallout.colors ? themeForCallout.colors.accent : '2E75B6');
    return {
      bar: barForCallout,
      fill: tintHexColorForDocumentThemes(barForCallout, 0.9),
      title: readableOnWhiteForDocumentThemes(barForCallout)
    };
  }

  function defaultPageSizeForLocaleForDocumentThemes(languageTagForLocale) {
    var tagForLocale = String(languageTagForLocale || '').trim();
    if (!tagForLocale) return 'letter';
    var partsForLocale = tagForLocale.replace(/_/g, '-').split('-');
    for (var iForLocale = 1; iForLocale < partsForLocale.length; iForLocale++) {
      if (/^[A-Za-z]{2}$/.test(partsForLocale[iForLocale])) {
        return LETTER_REGIONS_FOR_DOCUMENT_THEMES[partsForLocale[iForLocale].toUpperCase()] ? 'letter' : 'a4';
      }
    }
    // A bare language tag has no region. English keeps the long-standing Letter default.
    return partsForLocale[0].toLowerCase() === 'en' ? 'letter' : 'a4';
  }

  // page: { size: 'letter' | 'a4' | 'legal', orientation: 'portrait' | 'landscape' }.
  function resolvePageForDocumentThemes(pageForResolve, languageTagForResolve) {
    var warningsForPage = [];
    var safePageForResolve = (pageForResolve && typeof pageForResolve === 'object') ? pageForResolve : {};
    var sizeKeyForPage = String(safePageForResolve.size || '').trim().toLowerCase();
    if (sizeKeyForPage && !PAGE_SIZES_FOR_DOCUMENT_THEMES[sizeKeyForPage]) {
      warningsForPage.push('Unknown page size "' + sizeKeyForPage.slice(0, 20) + '"; used the default for the user\'s locale.');
      sizeKeyForPage = '';
    }
    if (!sizeKeyForPage) sizeKeyForPage = defaultPageSizeForLocaleForDocumentThemes(languageTagForResolve);
    var orientationForPage = String(safePageForResolve.orientation || '').trim().toLowerCase() === 'landscape' ? 'landscape' : 'portrait';
    var dimsForPage = PAGE_SIZES_FOR_DOCUMENT_THEMES[sizeKeyForPage];
    var landscapeForPage = orientationForPage === 'landscape';
    return {
      size: sizeKeyForPage,
      orientation: orientationForPage,
      widthPt: landscapeForPage ? dimsForPage.heightPt : dimsForPage.widthPt,
      heightPt: landscapeForPage ? dimsForPage.widthPt : dimsForPage.heightPt,
      warnings: warningsForPage
    };
  }

  function listThemesForDocumentThemes() {
    return THEMES_FOR_DOCUMENT_THEMES.map(function (themeForList) {
      return { name: themeForList.name, label: themeForList.label, useFor: themeForList.useFor };
    });
  }

  function listFontsForDocumentThemes() {
    return FONTS_FOR_DOCUMENT_THEMES.map(function (fontForList) {
      return { name: fontForList.name, kind: fontForList.kind, office: fontForList.office, web: fontForList.web };
    });
  }

  nsForDocumentThemes.documentThemes = {
    DEFAULT_THEME: DEFAULT_THEME_NAME_FOR_DOCUMENT_THEMES,
    THEME_NAMES: THEMES_FOR_DOCUMENT_THEMES.map(function (themeForName) { return themeForName.name; }),
    PAGE_SIZE_NAMES: Object.keys(PAGE_SIZES_FOR_DOCUMENT_THEMES),
    CALLOUT_TONES: ['info'].concat(Object.keys(CALLOUT_TONE_COLORS_FOR_DOCUMENT_THEMES)),
    listThemes: listThemesForDocumentThemes,
    listFonts: listFontsForDocumentThemes,
    findFont: findFontForDocumentThemes,
    describeFont: describeFontForDocumentThemes,
    resolveTheme: resolveThemeForDocumentThemes,
    calloutColors: calloutColorsForDocumentThemes,
    defaultPageSizeForLocale: defaultPageSizeForLocaleForDocumentThemes,
    resolvePage: resolvePageForDocumentThemes,
    normalizeHexColor: normalizeHexColorForDocumentThemes,
    tintHexColor: tintHexColorForDocumentThemes,
    luminance: luminanceForDocumentThemes,
    readableOnWhite: readableOnWhiteForDocumentThemes
  };

  globalScopeForDocumentThemes.ABChatAgent = nsForDocumentThemes;

  if (typeof module === 'object' && module && module.exports) {
    module.exports = nsForDocumentThemes.documentThemes;
  }
})();
