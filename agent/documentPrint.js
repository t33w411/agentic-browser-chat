(function () {
  var globalScopeForDocumentPrint = globalThis;
  var agentNamespaceForDocumentPrint = globalScopeForDocumentPrint.ABChatAgent || {};

  // Renders the document block model as one HTML page for Chrome to print to PDF. It reads the
  // same blocks and the same table layout helpers as the DOCX writer, so a PDF and a DOCX made
  // from one spec agree. Fonts come from Fontsource as static files, one per weight and subset:
  // Chrome embeds a static font in the PDF as TrueType, while a variable font becomes Type 3.

  var FONT_CDN_BASE_FOR_DOCUMENT_PRINT = 'https://cdn.jsdelivr.net/fontsource/fonts/';

  // The characters each Fontsource subset file covers. A face is only downloaded when the page
  // uses a character in its range.
  var SUBSET_RANGES_FOR_DOCUMENT_PRINT = {
    'latin': 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    'latin-ext': 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
    'cyrillic': 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116',
    'cyrillic-ext': 'U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F',
    'greek': 'U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF',
    'greek-ext': 'U+1F00-1FFF',
    'vietnamese': 'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
    'math': 'U+0302-0303, U+0305, U+0307-0308, U+0310, U+0312, U+0315, U+031A, U+0326-0327, U+032C, U+032F-0330, U+0332-0333, U+0338, U+033A, U+0346, U+034D, U+0391-03A1, U+03A3-03A9, U+03B1-03C9, U+03D1, U+03D5-03D6, U+03F0-03F1, U+03F4-03F5, U+2016-2017, U+2034-2038, U+203C, U+2040, U+2043, U+2047, U+2050, U+2057, U+205F, U+2070-2071, U+2074-208E, U+2090-209C, U+20D0-20DC, U+20E1, U+20E5-20EF, U+2100-2112, U+2114-2115, U+2117-2121, U+2123-214F, U+2190, U+2192, U+2194-21AE, U+21B0-21E5, U+21F1-21F2, U+21F4-2211, U+2213-2214, U+2216-22FF, U+2308-230B, U+2310, U+2319, U+231C-2321, U+2336-237A, U+237C, U+2395, U+239B-23B7, U+23D0, U+23DC-23E1, U+2474-2475, U+25AF, U+25B3, U+25B7, U+25BD, U+25C1, U+25CA, U+25CC, U+25FB, U+266D-266F, U+27C0-27FF, U+2900-2AFF, U+2B0E-2B11, U+2B30-2B4C, U+2BFE, U+3030, U+FF5B, U+FF5D, U+1D400-1D7FF, U+1EE00-1EEFF',
    'symbols': 'U+0001-000C, U+000E-001F, U+007F-009F, U+20DD-20E0, U+20E2-20E4, U+2150-218F, U+2190, U+2192, U+2194-2199, U+21AF, U+21E6-21F0, U+21F3, U+2218-2219, U+2299, U+22C4-22C6, U+2300-243F, U+2440-244A, U+2460-24FF, U+25A0-27BF, U+2800-28FF, U+2921-2922, U+2981, U+29BF, U+29EB, U+2B00-2BFF, U+4DC0-4DFF, U+FFF9-FFFB, U+10140-1018E, U+10190-1019C, U+101A0, U+101D0-101FD, U+102E0-102FB, U+10E60-10E7E, U+1D2C0-1D2D3, U+1D2E0-1D37F, U+1F000-1F0FF, U+1F100-1F1AD, U+1F1E6-1F1FF, U+1F30D-1F30F, U+1F315, U+1F31C, U+1F31E, U+1F320-1F32C, U+1F336, U+1F378, U+1F37D, U+1F382, U+1F393-1F39F, U+1F3A7-1F3A8, U+1F3AC-1F3AF, U+1F3C2, U+1F3C4-1F3C6, U+1F3CA-1F3CE, U+1F3D4-1F3E0, U+1F3ED, U+1F3F1-1F3F3, U+1F3F5-1F3F7, U+1F408, U+1F415, U+1F41F, U+1F426, U+1F43F, U+1F441-1F442, U+1F444, U+1F446-1F449, U+1F44C-1F44E, U+1F453, U+1F46A, U+1F47D, U+1F4A3, U+1F4B0, U+1F4B3, U+1F4B9, U+1F4BB, U+1F4BF, U+1F4C8-1F4CB, U+1F4D6, U+1F4DA, U+1F4DF, U+1F4E3-1F4E6, U+1F4EA-1F4ED, U+1F4F7, U+1F4F9-1F4FB, U+1F4FD-1F4FE, U+1F503, U+1F507-1F50B, U+1F50D, U+1F512-1F513, U+1F53E-1F54A, U+1F54F-1F5FA, U+1F610, U+1F650-1F67F, U+1F687, U+1F68D, U+1F691, U+1F694, U+1F698, U+1F6AD, U+1F6B2, U+1F6B9-1F6BA, U+1F6BC, U+1F6C6-1F6CF, U+1F6D3-1F6D7, U+1F6E0-1F6EA, U+1F6F0-1F6F3, U+1F6F7-1F6FC, U+1F700-1F7FF, U+1F800-1F80B, U+1F810-1F847, U+1F850-1F859, U+1F860-1F887, U+1F890-1F8AD, U+1F8B0-1F8BB, U+1F8C0-1F8C1, U+1F900-1F90B, U+1F93B, U+1F946, U+1F984, U+1F996, U+1F9E9, U+1FA00-1FA6F, U+1FA70-1FA7C, U+1FA80-1FA89, U+1FA8F-1FAC6, U+1FACE-1FADC, U+1FADF-1FAE9, U+1FAF0-1FAF8, U+1FB00-1FBFF',
    'arabic': 'U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC, U+102E0-102FB, U+10E60-10E7E, U+10EC2-10EC4, U+10EFC-10EFF, U+1EE00-1EE03, U+1EE05-1EE1F, U+1EE21-1EE22, U+1EE24, U+1EE27, U+1EE29-1EE32, U+1EE34-1EE37, U+1EE39, U+1EE3B, U+1EE42, U+1EE47, U+1EE49, U+1EE4B, U+1EE4D-1EE4F, U+1EE51-1EE52, U+1EE54, U+1EE57, U+1EE59, U+1EE5B, U+1EE5D, U+1EE5F, U+1EE61-1EE62, U+1EE64, U+1EE67-1EE6A, U+1EE6C-1EE72, U+1EE74-1EE77, U+1EE79-1EE7C, U+1EE7E, U+1EE80-1EE89, U+1EE8B-1EE9B, U+1EEA1-1EEA3, U+1EEA5-1EEA9, U+1EEAB-1EEBB, U+1EEF0-1EEF1',
    'armenian': 'U+0308, U+0530-058F, U+2010, U+2024, U+25CC, U+FB13-FB17',
    'bengali': 'U+0951-0952, U+0964-0965, U+0980-09FE, U+1CD0, U+1CD2, U+1CD5-1CD6, U+1CD8, U+1CE1, U+1CEA, U+1CED, U+1CF2, U+1CF5-1CF7, U+200C-200D, U+20B9, U+25CC, U+A8F1',
    'devanagari': 'U+0900-097F, U+1CD0-1CF9, U+200C-200D, U+20A8, U+20B9, U+20F0, U+25CC, U+A830-A839, U+A8E0-A8FF, U+11B00-11B09',
    'ethiopic': 'U+030E, U+1200-1399, U+2D80-2DDE, U+AB01-AB2E, U+1E7E0-1E7E6, U+1E7E8-1E7EB, U+1E7ED-1E7EE, U+1E7F0-1E7FE',
    'georgian': 'U+0589, U+10A0-10FF, U+1C90-1CBA, U+1CBD-1CBF, U+205A, U+2D00-2D2F, U+2E31',
    'gujarati': 'U+0951-0952, U+0964-0965, U+0A80-0AFF, U+200C-200D, U+20B9, U+25CC, U+A830-A839',
    'gurmukhi': 'U+0951-0952, U+0964-0965, U+0A01-0A76, U+200C-200D, U+20B9, U+25CC, U+262C, U+A830-A839',
    'hebrew': 'U+0307-0308, U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F',
    'kannada': 'U+0951-0952, U+0964-0965, U+0C80-0CF3, U+1CD0, U+1CD2-1CD3, U+1CDA, U+1CF2, U+1CF4, U+200C-200D, U+20B9, U+25CC, U+A830-A835',
    'khmer': 'U+1780-17FF, U+19E0-19FF, U+200C-200D, U+25CC',
    'lao': 'U+0E81-0EDF, U+200C-200D, U+25CC',
    'malayalam': 'U+0307, U+0323, U+0951-0952, U+0964-0965, U+0D00-0D7F, U+1CDA, U+1CF2, U+200C-200D, U+20B9, U+25CC, U+A830-A832',
    'myanmar': 'U+1000-109F, U+200C-200D, U+25CC, U+A92E, U+A9E0-A9FE, U+AA60-AA7F, U+116D0-116E3',
    'sinhala': 'U+0964-0965, U+0D81-0DF4, U+1CF2, U+200C-200D, U+25CC, U+111E1-111F4',
    'tamil': 'U+0964-0965, U+0B82-0BFA, U+200C-200D, U+20B9, U+25CC',
    'telugu': 'U+0951-0952, U+0964-0965, U+0C00-0C7F, U+1CDA, U+1CF2, U+200C-200D, U+25CC',
    'thai': 'U+02D7, U+0303, U+0331, U+0E01-0E5B, U+200C-200D, U+25CC'
  };

  // Fontsource files for every web font the themes and the curated list use: the regular and bold
  // weights that exist, whether italics exist, and the subsets with a known range.
  var WEB_FONTS_FOR_DOCUMENT_PRINT = {
    'carlito': { id: 'carlito', weights: [400, 700], italic: true, subsets: ['cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'latin', 'latin-ext', 'vietnamese'] },
    'caladea': { id: 'caladea', weights: [400, 700], italic: true, subsets: ['latin', 'latin-ext'] },
    'arimo': { id: 'arimo', weights: [400, 700], italic: true, subsets: ['cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'hebrew', 'latin', 'latin-ext', 'vietnamese'] },
    'tinos': { id: 'tinos', weights: [400, 700], italic: true, subsets: ['cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'hebrew', 'latin', 'latin-ext', 'vietnamese'] },
    'gelasio': { id: 'gelasio', weights: [400, 700], italic: true, subsets: ['latin', 'latin-ext', 'vietnamese'] },
    'eb garamond': { id: 'eb-garamond', weights: [400, 700], italic: true, subsets: ['cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'latin', 'latin-ext', 'vietnamese'] },
    'cousine': { id: 'cousine', weights: [400, 700], italic: true, subsets: ['cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'hebrew', 'latin', 'latin-ext', 'vietnamese'] },
    'inconsolata': { id: 'inconsolata', weights: [400, 700], italic: false, subsets: ['latin', 'latin-ext', 'vietnamese'] },
    'inter': { id: 'inter', weights: [400, 700], italic: true, subsets: ['cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'latin', 'latin-ext', 'vietnamese'] },
    'roboto': { id: 'roboto', weights: [400, 700], italic: true, subsets: ['cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'latin', 'latin-ext', 'math', 'symbols', 'vietnamese'] },
    'open sans': { id: 'open-sans', weights: [400, 700], italic: true, subsets: ['cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'hebrew', 'latin', 'latin-ext', 'math', 'symbols', 'vietnamese'] },
    'lato': { id: 'lato', weights: [400, 700], italic: true, subsets: ['latin', 'latin-ext'] },
    'source sans 3': { id: 'source-sans-3', weights: [400, 700], italic: true, subsets: ['cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'latin', 'latin-ext', 'vietnamese'] },
    'nunito sans': { id: 'nunito-sans', weights: [400, 700], italic: true, subsets: ['cyrillic', 'cyrillic-ext', 'latin', 'latin-ext', 'vietnamese'] },
    'work sans': { id: 'work-sans', weights: [400, 700], italic: true, subsets: ['latin', 'latin-ext', 'vietnamese'] },
    'ibm plex sans': { id: 'ibm-plex-sans', weights: [400, 700], italic: true, subsets: ['cyrillic', 'cyrillic-ext', 'greek', 'latin', 'latin-ext', 'vietnamese'] },
    'montserrat': { id: 'montserrat', weights: [400, 700], italic: true, subsets: ['cyrillic', 'cyrillic-ext', 'latin', 'latin-ext', 'vietnamese'] },
    'poppins': { id: 'poppins', weights: [400, 700], italic: true, subsets: ['devanagari', 'latin', 'latin-ext'] },
    'raleway': { id: 'raleway', weights: [400, 700], italic: true, subsets: ['cyrillic', 'cyrillic-ext', 'latin', 'latin-ext', 'vietnamese'] },
    'merriweather': { id: 'merriweather', weights: [400, 700], italic: true, subsets: ['cyrillic', 'cyrillic-ext', 'latin', 'latin-ext', 'vietnamese'] },
    'lora': { id: 'lora', weights: [400, 700], italic: true, subsets: ['cyrillic', 'cyrillic-ext', 'latin', 'latin-ext', 'math', 'symbols', 'vietnamese'] },
    'source serif 4': { id: 'source-serif-4', weights: [400, 700], italic: true, subsets: ['cyrillic', 'cyrillic-ext', 'greek', 'latin', 'latin-ext', 'vietnamese'] },
    'libre baskerville': { id: 'libre-baskerville', weights: [400, 700], italic: true, subsets: ['latin', 'latin-ext'] },
    'crimson pro': { id: 'crimson-pro', weights: [400, 700], italic: true, subsets: ['latin', 'latin-ext', 'vietnamese'] },
    'playfair display': { id: 'playfair-display', weights: [400, 700], italic: true, subsets: ['cyrillic', 'latin', 'latin-ext', 'vietnamese'] },
    'dm serif display': { id: 'dm-serif-display', weights: [400], italic: true, subsets: ['latin', 'latin-ext'] },
    'jetbrains mono': { id: 'jetbrains-mono', weights: [400, 700], italic: true, subsets: ['cyrillic', 'cyrillic-ext', 'greek', 'latin', 'latin-ext', 'vietnamese'] },
    'ibm plex mono': { id: 'ibm-plex-mono', weights: [400, 700], italic: true, subsets: ['cyrillic', 'cyrillic-ext', 'latin', 'latin-ext', 'vietnamese'] },
    'source code pro': { id: 'source-code-pro', weights: [400, 700], italic: true, subsets: ['cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'latin', 'latin-ext', 'vietnamese'] }
  };

  // A font the user named that is not in the table. Its files are tried in the subsets most
  // families have; a file that does not exist fails to load and the next font in the stack is used.
  var USER_FONT_SUBSETS_FOR_DOCUMENT_PRINT = ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext', 'greek', 'vietnamese'];

  // Last web font in every stack, for accented Latin, Greek and Cyrillic a theme font lacks.
  var FALLBACK_FACE_FOR_DOCUMENT_PRINT = {
    id: 'noto-sans', weights: [400, 700], italic: true,
    subsets: ['latin-ext', 'cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'vietnamese']
  };

  var CJK_RANGE_FOR_DOCUMENT_PRINT = 'U+3000-30FF, U+31F0-31FF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF';

  // A script found in the document text adds its Noto Sans family to every font stack.
  var SCRIPT_FONTS_FOR_DOCUMENT_PRINT = [
    { key: 'arabic', test: /[\u0600-\u06FF\u0750-\u077F\u0870-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/, id: 'noto-sans-arabic', subset: 'arabic' },
    { key: 'hebrew', test: /[\u0590-\u05FF\uFB1D-\uFB4F]/, id: 'noto-sans-hebrew', subset: 'hebrew' },
    { key: 'devanagari', test: /[\u0900-\u097F\uA8E0-\uA8FF]/, id: 'noto-sans-devanagari', subset: 'devanagari' },
    { key: 'bengali', test: /[\u0980-\u09FF]/, id: 'noto-sans-bengali', subset: 'bengali' },
    { key: 'gurmukhi', test: /[\u0A00-\u0A7F]/, id: 'noto-sans-gurmukhi', subset: 'gurmukhi' },
    { key: 'gujarati', test: /[\u0A80-\u0AFF]/, id: 'noto-sans-gujarati', subset: 'gujarati' },
    { key: 'tamil', test: /[\u0B80-\u0BFF]/, id: 'noto-sans-tamil', subset: 'tamil' },
    { key: 'telugu', test: /[\u0C00-\u0C7F]/, id: 'noto-sans-telugu', subset: 'telugu' },
    { key: 'kannada', test: /[\u0C80-\u0CFF]/, id: 'noto-sans-kannada', subset: 'kannada' },
    { key: 'malayalam', test: /[\u0D00-\u0D7F]/, id: 'noto-sans-malayalam', subset: 'malayalam' },
    { key: 'sinhala', test: /[\u0D80-\u0DFF]/, id: 'noto-sans-sinhala', subset: 'sinhala' },
    { key: 'thai', test: /[\u0E00-\u0E7F]/, id: 'noto-sans-thai', subset: 'thai' },
    { key: 'lao', test: /[\u0E80-\u0EFF]/, id: 'noto-sans-lao', subset: 'lao' },
    { key: 'myanmar', test: /[\u1000-\u109F]/, id: 'noto-sans-myanmar', subset: 'myanmar' },
    { key: 'georgian', test: /[\u10A0-\u10FF\u1C90-\u1CBF\u2D00-\u2D2F]/, id: 'noto-sans-georgian', subset: 'georgian' },
    { key: 'armenian', test: /[\u0530-\u058F]/, id: 'noto-sans-armenian', subset: 'armenian' },
    { key: 'ethiopic', test: /[\u1200-\u139F\u2D80-\u2DDF]/, id: 'noto-sans-ethiopic', subset: 'ethiopic' },
    { key: 'khmer', test: /[\u1780-\u17FF\u19E0-\u19FF]/, id: 'noto-sans-khmer', subset: 'khmer' },
    // Japanese is checked before Chinese: kana means the Han characters are kanji.
    { key: 'japanese', test: /[\u3040-\u30FF\u31F0-\u31FF]/, id: 'noto-sans-jp', subset: 'japanese', range: CJK_RANGE_FOR_DOCUMENT_PRINT },
    { key: 'korean', test: /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/, id: 'noto-sans-kr', subset: 'korean', range: 'U+1100-11FF, U+3000-303F, U+3130-318F, U+AC00-D7AF, U+FF00-FFEF' },
    { key: 'chinese', test: /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/, id: 'noto-sans-sc', subset: 'chinese-simplified', range: CJK_RANGE_FOR_DOCUMENT_PRINT }
  ];
  var TRADITIONAL_CHINESE_LANG_RE_FOR_DOCUMENT_PRINT = /^zh-(tw|hk|mo|hant)/i;

  var MAX_SCRIPT_SCAN_CHARS_FOR_DOCUMENT_PRINT = 300000;
  var PX_TO_PT_FOR_DOCUMENT_PRINT = 0.75;
  var GENERIC_FAMILY_FOR_DOCUMENT_PRINT = { sans: 'sans-serif', serif: 'serif', mono: 'monospace' };
  var ORDERED_MARKERS_FOR_DOCUMENT_PRINT = ['decimal', 'lower-alpha', 'lower-roman'];
  var BULLET_MARKERS_FOR_DOCUMENT_PRINT = ['disc', 'circle', 'square'];

  function layoutForDocumentPrint() {
    var generationForLayout = agentNamespaceForDocumentPrint.documentGeneration;
    if (!generationForLayout || !generationForLayout.layout) throw new Error('documentGeneration.js must load before a document is printed.');
    return generationForLayout.layout;
  }

  function escapeHtmlForDocumentPrint(valueForEscape) {
    return String(valueForEscape == null ? '' : valueForEscape)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // A CSS string literal that cannot end the string or the surrounding <style> element.
  function cssStringForDocumentPrint(valueForCss) {
    return '"' + String(valueForCss == null ? '' : valueForCss).replace(/[\\"]/g, '\\$&')
      .replace(/[\u0000-\u001F\u007F<>]/g, function (charForCss) {
        return '\\' + charForCss.charCodeAt(0).toString(16) + ' ';
      }) + '"';
  }

  function hexForDocumentPrint(valueForHex) {
    var textForHex = String(valueForHex == null ? '' : valueForHex).trim().replace(/^#/, '');
    return /^[0-9a-fA-F]{6}$/.test(textForHex) ? '#' + textForHex.toUpperCase() : '';
  }

  function cleanFamilyForDocumentPrint(nameForClean) {
    return String(nameForClean == null ? '' : nameForClean).replace(/["'\\<>;{}()]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function fontIdForDocumentPrint(nameForId) {
    return cleanFamilyForDocumentPrint(nameForId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function ptForDocumentPrint(valueForPt) {
    return (Math.round(Number(valueForPt) * 100) / 100) + 'pt';
  }

  function safeHrefForDocumentPrint(hrefForSafe) {
    var textForSafe = String(hrefForSafe == null ? '' : hrefForSafe).trim();
    return /^(https?:|mailto:)/i.test(textForSafe) ? textForSafe : '';
  }

  function bytesToBase64ForDocumentPrint(bytesForBase64) {
    var binaryForBase64 = '';
    for (var offsetForBase64 = 0; offsetForBase64 < bytesForBase64.length; offsetForBase64 += 0x8000) {
      binaryForBase64 += String.fromCharCode.apply(null, bytesForBase64.subarray(offsetForBase64, offsetForBase64 + 0x8000));
    }
    return btoa(binaryForBase64);
  }

  // ---- Text and scripts ----

  // Gathers the document's text, up to a cap, so its scripts can be detected.
  function collectTextForDocumentPrint(valueForCollect, accForCollect) {
    if (valueForCollect == null || accForCollect.chars >= MAX_SCRIPT_SCAN_CHARS_FOR_DOCUMENT_PRINT) return accForCollect;
    if (typeof valueForCollect === 'string') {
      accForCollect.parts.push(valueForCollect);
      accForCollect.chars += valueForCollect.length;
      return accForCollect;
    }
    if (Array.isArray(valueForCollect)) {
      valueForCollect.forEach(function (itemForCollect) { collectTextForDocumentPrint(itemForCollect, accForCollect); });
      return accForCollect;
    }
    if (typeof valueForCollect === 'object') {
      ['text', 'subtitle', 'title', 'cite', 'caption', 'label', 'value', 'runs', 'items', 'rows', 'paragraphs', 'details'].forEach(function (keyForCollect) {
        if (valueForCollect[keyForCollect] != null) collectTextForDocumentPrint(valueForCollect[keyForCollect], accForCollect);
      });
    }
    return accForCollect;
  }

  // The script fonts a text needs, in stack order.
  function detectScriptFontsForDocumentPrint(textForDetect, langForDetect) {
    var textForScripts = String(textForDetect || '');
    var foundForDetect = [];
    var hasJapaneseForDetect = false;
    SCRIPT_FONTS_FOR_DOCUMENT_PRINT.forEach(function (scriptForDetect) {
      if (!scriptForDetect.test.test(textForScripts)) return;
      if (scriptForDetect.key === 'japanese') hasJapaneseForDetect = true;
      if (scriptForDetect.key === 'chinese') {
        if (hasJapaneseForDetect) return;
        if (TRADITIONAL_CHINESE_LANG_RE_FOR_DOCUMENT_PRINT.test(String(langForDetect || ''))) {
          foundForDetect.push({ key: 'chinese', id: 'noto-sans-tc', subset: 'chinese-traditional', range: scriptForDetect.range });
          return;
        }
      }
      foundForDetect.push({ key: scriptForDetect.key, id: scriptForDetect.id, subset: scriptForDetect.subset, range: scriptForDetect.range || '' });
    });
    return foundForDetect;
  }

  // ---- Fonts ----

  function makeFontRegistryForDocumentPrint(scriptFontsForRegistry) {
    var facesForRegistry = {};
    var orderForRegistry = [];
    function addFace(faceForAdd) {
      if (!facesForRegistry[faceForAdd.alias]) {
        facesForRegistry[faceForAdd.alias] = faceForAdd;
        orderForRegistry.push(faceForAdd.alias);
      }
      return faceForAdd.alias;
    }
    var scriptAliasesForRegistry = (scriptFontsForRegistry || []).map(function (scriptForAlias) {
      return addFace({
        alias: 'abchat-' + scriptForAlias.id, id: scriptForAlias.id, weights: [400, 700], italic: false,
        subsets: [scriptForAlias.subset], range: scriptForAlias.range || '', family: scriptForAlias.id, userNamed: false
      });
    });
    var fallbackAliasForRegistry = '';
    function webAlias(familyForWeb, userNamedForWeb) {
      var cleanForWeb = cleanFamilyForDocumentPrint(familyForWeb);
      if (!cleanForWeb) return '';
      var knownForWeb = WEB_FONTS_FOR_DOCUMENT_PRINT[cleanForWeb.toLowerCase()];
      var idForWeb = knownForWeb ? knownForWeb.id : fontIdForDocumentPrint(cleanForWeb);
      if (!idForWeb) return '';
      return addFace(knownForWeb
        ? { alias: 'abchat-' + idForWeb, id: idForWeb, weights: knownForWeb.weights, italic: knownForWeb.italic, subsets: knownForWeb.subsets, family: cleanForWeb, userNamed: false }
        : { alias: 'abchat-' + idForWeb, id: idForWeb, weights: [400, 700], italic: true, subsets: USER_FONT_SUBSETS_FOR_DOCUMENT_PRINT, family: cleanForWeb, userNamed: !!userNamedForWeb });
    }
    // role: { web, local, kind, userNamed, localFirst }. A themed document puts the web font
    // first, so it prints the same on every machine. A source document puts its own font first,
    // because that is the font the author chose, and the web font is its metric-compatible clone.
    // In a themed stack the script faces come before the local name: Arial and Times carry
    // Arabic and Hebrew on Windows and macOS, so a local name ahead of them would win those
    // characters on some machines and not others. Each script face has a unicode-range, so
    // Latin text still skips it and reaches the local name when the web font fails to load.
    function stack(roleForStack) {
      var safeRoleForStack = roleForStack || {};
      var namesForStack = [];
      function pushName(nameForPush) {
        var cleanNameForPush = cleanFamilyForDocumentPrint(nameForPush);
        if (cleanNameForPush && namesForStack.indexOf(cleanNameForPush) === -1) namesForStack.push(cleanNameForPush);
      }
      var aliasForStack = safeRoleForStack.web ? webAlias(safeRoleForStack.web, safeRoleForStack.userNamed) : '';
      if (safeRoleForStack.localFirst) pushName(safeRoleForStack.local);
      if (aliasForStack) pushName(aliasForStack);
      scriptAliasesForRegistry.forEach(pushName);
      pushName(safeRoleForStack.local);
      if (!fallbackAliasForRegistry) {
        fallbackAliasForRegistry = addFace({
          alias: 'abchat-' + FALLBACK_FACE_FOR_DOCUMENT_PRINT.id, id: FALLBACK_FACE_FOR_DOCUMENT_PRINT.id,
          weights: FALLBACK_FACE_FOR_DOCUMENT_PRINT.weights, italic: FALLBACK_FACE_FOR_DOCUMENT_PRINT.italic,
          subsets: FALLBACK_FACE_FOR_DOCUMENT_PRINT.subsets, family: 'Noto Sans', userNamed: false
        });
      }
      pushName(fallbackAliasForRegistry);
      return namesForStack.map(function (nameForQuote) { return '"' + nameForQuote + '"'; }).join(', ')
        + ', ' + (GENERIC_FAMILY_FOR_DOCUMENT_PRINT[safeRoleForStack.kind] || 'sans-serif');
    }
    function faces() {
      return orderForRegistry.map(function (aliasForFaces) { return facesForRegistry[aliasForFaces]; });
    }
    return { stack: stack, faces: faces };
  }

  // Each bold or italic face lists the regular file after its own. Many display families a user
  // names (Lobster, Pacifico, Bebas Neue) ship only a regular weight, and when a face's only
  // file fails Chrome skips to the next family in the stack, so every heading would print in
  // the fallback font. With the regular file listed second, the heading keeps the named font.
  function fontFaceCssForDocumentPrint(facesForCss) {
    var rulesForCss = [];
    facesForCss.forEach(function (faceForCss) {
      faceForCss.subsets.forEach(function (subsetForCss) {
        var rangeForCss = faceForCss.range || SUBSET_RANGES_FOR_DOCUMENT_PRINT[subsetForCss];
        if (!rangeForCss) return;
        faceForCss.weights.forEach(function (weightForCss) {
          (faceForCss.italic ? ['normal', 'italic'] : ['normal']).forEach(function (styleForCss) {
            var filesForFace = [weightForCss + '-' + styleForCss, weightForCss + '-normal', '400-normal']
              .filter(function (fileForFace, indexForFile, listForFile) { return listForFile.indexOf(fileForFace) === indexForFile; });
            var srcForFace = filesForFace.map(function (fileForSrc) {
              return 'url("' + FONT_CDN_BASE_FOR_DOCUMENT_PRINT + faceForCss.id + '@latest/' + subsetForCss + '-' + fileForSrc + '.woff2") format("woff2")';
            }).join(', ');
            rulesForCss.push('@font-face { font-family: "' + faceForCss.alias + '"; font-style: ' + styleForCss
              + '; font-weight: ' + weightForCss + '; font-display: block; src: ' + srcForFace + '; unicode-range: '
              + rangeForCss + '; }');
          });
        });
      });
    });
    return rulesForCss.join('\n');
  }

  // ---- The look: theme or the source document's own defaults ----

  // Fonts a source document often names that the curated list does not, mapped to the web font
  // with the same metrics, so the printed lines break where the author's did.
  var METRIC_CLONES_FOR_DOCUMENT_PRINT = {
    'liberation serif': 'Tinos', 'liberation sans': 'Arimo', 'liberation mono': 'Cousine',
    'times': 'Tinos', 'courier': 'Cousine', 'carlito': 'Carlito', 'caladea': 'Caladea'
  };

  function curatedCloneForDocumentPrint(nameForClone) {
    var cloneForName = METRIC_CLONES_FOR_DOCUMENT_PRINT[cleanFamilyForDocumentPrint(nameForClone).toLowerCase()];
    if (cloneForName) return cloneForName;
    var themesForClone = agentNamespaceForDocumentPrint.documentThemes;
    var curatedForClone = themesForClone && typeof themesForClone.findFont === 'function' ? themesForClone.findFont(nameForClone) : null;
    return curatedForClone ? curatedForClone.web : '';
  }

  function kindOfFamilyForDocumentPrint(nameForKind) {
    var themesForKind = agentNamespaceForDocumentPrint.documentThemes;
    var describedForKind = themesForKind && typeof themesForKind.describeFont === 'function' ? themesForKind.describeFont(nameForKind) : null;
    return describedForKind ? describedForKind.kind : 'sans';
  }

  function buildLookForDocumentPrint(contextForLook, docDefaultsForLook) {
    var themeForLook = contextForLook && contextForLook.theme;
    if (themeForLook) {
      var pageForLook = contextForLook.page || { widthPt: 612, heightPt: 792 };
      var marginForLook = themeForLook.marginPt;
      return {
        themed: true,
        theme: themeForLook,
        colors: themeForLook.colors,
        sizes: themeForLook.sizes,
        spacing: themeForLook.spacing,
        page: { widthPt: pageForLook.widthPt, heightPt: pageForLook.heightPt, margins: { top: marginForLook, right: marginForLook, bottom: marginForLook, left: marginForLook } },
        fonts: {
          heading: { web: themeForLook.fonts.heading.web, local: themeForLook.fonts.heading.office, kind: themeForLook.fonts.heading.kind, userNamed: !!(themeForLook.overrides && themeForLook.overrides.heading_font) },
          body: { web: themeForLook.fonts.body.web, local: themeForLook.fonts.body.office, kind: themeForLook.fonts.body.kind, userNamed: !!(themeForLook.overrides && themeForLook.overrides.body_font) },
          mono: { web: themeForLook.fonts.mono.web, local: themeForLook.fonts.mono.office, kind: 'mono' }
        },
        pageNumbers: contextForLook.pageNumbers ? (themeForLook.footer === 'page-x-of-y' ? 'page-x-of-y' : 'page-number') : '',
        headerText: contextForLook.headerText || ''
      };
    }
    var defaultsForLook = docDefaultsForLook || {};
    var bodySizeForLook = defaultsForLook.fontSizePt || 11;
    var familyForLook = defaultsForLook.fontFamily || 'Calibri';
    var sourceMarginsForLook = defaultsForLook.margins || {};
    var bodyRoleForLook = { web: curatedCloneForDocumentPrint(familyForLook), local: familyForLook, kind: kindOfFamilyForDocumentPrint(familyForLook), localFirst: true };
    return {
      themed: false,
      theme: null,
      colors: {
        text: '000000', muted: '555555', heading: '000000', primary: '000000', accent: '555555', accentText: '000000',
        link: '0563C1', rule: '808080', tableBorder: 'D9D9D9', tableHeaderFill: '', tableHeaderText: '000000',
        tableHeaderRule: '000000', tableStripe: '', calloutFill: 'F2F2F2'
      },
      sizes: { body: bodySizeForLook, small: Math.max(7, bodySizeForLook - 2), title: 20, subtitle: 13, headings: [18, 15, 13, 12, 11, 11] },
      spacing: { line: 1.15, after: 6, headingBefore: [12, 10, 8, 8, 8, 8], headingAfter: [4, 4, 4, 4, 4, 4] },
      page: {
        widthPt: defaultsForLook.pageWidthPt || 612,
        heightPt: defaultsForLook.pageHeightPt || 792,
        margins: {
          top: sourceMarginsForLook.top || 72, right: sourceMarginsForLook.right || 72,
          bottom: sourceMarginsForLook.bottom || 72, left: sourceMarginsForLook.left || 72
        }
      },
      fonts: {
        heading: bodyRoleForLook,
        body: bodyRoleForLook,
        mono: { web: 'Inconsolata', local: 'Consolas', kind: 'mono', localFirst: true }
      },
      pageNumbers: '',
      headerText: ''
    };
  }

  // ---- Inline content ----

  function makeInlineRendererForDocumentPrint(lookForInline, registryForInline) {
    function runFontStack(nameForRun) {
      if (lookForInline.themed) return registryForInline.stack({ web: nameForRun, local: nameForRun, kind: kindOfFamilyForDocumentPrint(nameForRun), userNamed: true });
      return registryForInline.stack({ web: curatedCloneForDocumentPrint(nameForRun), local: nameForRun, kind: kindOfFamilyForDocumentPrint(nameForRun), localFirst: true });
    }
    function textHtml(textForHtml) {
      return String(textForHtml == null ? '' : textForHtml).split(/\r?\n/).map(escapeHtmlForDocumentPrint).join('<br>');
    }
    function runHtml(runForHtml) {
      var safeRunForHtml = runForHtml || {};
      var htmlForRun = textHtml(safeRunForHtml.text);
      if (!htmlForRun) return '';
      var stylesForRun = [];
      var colorForRun = hexForDocumentPrint(safeRunForHtml.color);
      if (colorForRun) stylesForRun.push('color: ' + colorForRun);
      var highlightForRun = hexForDocumentPrint(safeRunForHtml.highlight);
      if (highlightForRun) stylesForRun.push('background-color: ' + highlightForRun);
      var sizeForRun = Number(safeRunForHtml.sizePt);
      if (sizeForRun > 0 && sizeForRun <= 400) stylesForRun.push('font-size: ' + ptForDocumentPrint(sizeForRun));
      if (safeRunForHtml.font && !safeRunForHtml.mono) stylesForRun.push('font-family: ' + runFontStack(safeRunForHtml.font));
      if (safeRunForHtml.mono) htmlForRun = '<code>' + htmlForRun + '</code>';
      if (safeRunForHtml.italic) htmlForRun = '<em>' + htmlForRun + '</em>';
      if (safeRunForHtml.bold) htmlForRun = '<strong>' + htmlForRun + '</strong>';
      if (stylesForRun.length) htmlForRun = '<span style="' + escapeHtmlForDocumentPrint(stylesForRun.join('; ')) + '">' + htmlForRun + '</span>';
      var hrefForRun = safeHrefForDocumentPrint(safeRunForHtml.href);
      if (hrefForRun) htmlForRun = '<a href="' + escapeHtmlForDocumentPrint(hrefForRun) + '">' + htmlForRun + '</a>';
      return htmlForRun;
    }
    // A string, or an array of runs from html or the blocks path.
    return function contentHtml(contentForHtml) {
      if (Array.isArray(contentForHtml)) return contentForHtml.map(runHtml).join('');
      return textHtml(contentForHtml);
    };
  }

  // ---- Blocks ----

  function borderCssForDocumentPrint(edgeForCss) {
    if (!edgeForCss) return 'none';
    var widthForCss = Math.max(0.25, Math.min(12, Number(edgeForCss.widthPt) || 0.5));
    return ptForDocumentPrint(widthForCss) + ' solid ' + (hexForDocumentPrint(edgeForCss.color) || '#000000');
  }

  function widerEdgeForDocumentPrint(firstEdgeForWider, secondEdgeForWider) {
    if (!firstEdgeForWider) return secondEdgeForWider || null;
    if (!secondEdgeForWider) return firstEdgeForWider;
    return (Number(secondEdgeForWider.widthPt) || 0) > (Number(firstEdgeForWider.widthPt) || 0) ? secondEdgeForWider : firstEdgeForWider;
  }

  // Mirrors the DOCX table writer: the same grid, header detection, figure alignment, column
  // widths, total row and theme table style. Borders are written on each cell, so a table edge and
  // an inside line can differ exactly as they do in Word.
  function tableHtmlForDocumentPrint(blockForTable, stateForTable) {
    var layoutForTable = stateForTable.layout;
    var lookForTable = stateForTable.look;
    var colorsForTable = lookForTable.colors;
    var gridForTable = layoutForTable.expandTableGrid(blockForTable.rows);
    if (gridForTable.colCount === 0 || gridForTable.rows.length === 0) return '';
    var plainRowsForTable = layoutForTable.tableToPlainRows(blockForTable.rows);
    var isLayoutForTable = blockForTable.bordered === false && !blockForTable.borderSpec;
    var hasHeaderForTable = !isLayoutForTable && layoutForTable.tableHasHeader(blockForTable, gridForTable);
    var colCountForTable = gridForTable.colCount;
    var bodySizeForTable = lookForTable.sizes.body;
    var sizePtForTable = (!lookForTable.themed || isLayoutForTable) ? bodySizeForTable
      : (colCountForTable > 8 ? bodySizeForTable - 2 : (colCountForTable > 5 ? bodySizeForTable - 1 : bodySizeForTable));
    var paddingForTable = isLayoutForTable ? { top: 1.5, bottom: 1.5, left: 0, right: 8 } : { top: 3.5, bottom: 3.5, left: 5.5, right: 5.5 };
    var alignmentsForTable = lookForTable.themed
      ? layoutForTable.columnAlignments(plainRowsForTable, hasHeaderForTable, blockForTable.align)
      : (Array.isArray(blockForTable.align) ? blockForTable.align : []);
    var widthsForTable = layoutForTable.computeTableColumnWidths(plainRowsForTable, stateForTable.contentWidthPt, blockForTable.columns, function (textForMeasure) {
      return String(textForMeasure).length * sizePtForTable * 0.52 + paddingForTable.left + paddingForTable.right;
    }, alignmentsForTable);
    var widthTotalForTable = widthsForTable.reduce(function (sumForTotal, widthForTotal) { return sumForTotal + widthForTotal; }, 0) || 1;
    var lastRowIndexForTable = gridForTable.rows.length - 1;
    var totalRowIndexForTable = (lookForTable.themed && !isLayoutForTable && plainRowsForTable.length > (hasHeaderForTable ? 2 : 1)
      && layoutForTable.isTotalRow(plainRowsForTable[lastRowIndexForTable])) ? lastRowIndexForTable : -1;
    var styleForTable = lookForTable.themed ? lookForTable.theme.table.style : 'source';
    var specForTable = blockForTable.borderSpec
      || (isLayoutForTable ? null : (lookForTable.themed ? layoutForTable.themedTableBorderSpec(lookForTable.theme) : layoutForTable.tableBorderSpecForBlock(blockForTable)))
      || {};
    var paintsThemeForTable = lookForTable.themed && !isLayoutForTable && !blockForTable.borderSpec;
    var bodyRowCounterForTable = 0;

    var rowsHtmlForTable = gridForTable.rows.map(function (descriptorsForRow, rowIndexForRow) {
      var isHeaderRowForRow = hasHeaderForTable && rowIndexForRow === 0;
      var isTotalRowForRow = rowIndexForRow === totalRowIndexForTable;
      var rowFillForRow = '';
      if (paintsThemeForTable) {
        if (isHeaderRowForRow) {
          rowFillForRow = colorsForTable.tableHeaderFill || '';
        } else {
          if (lookForTable.theme.table.zebra && bodyRowCounterForTable % 2 === 1 && !isTotalRowForRow) rowFillForRow = colorsForTable.tableStripe;
          bodyRowCounterForTable++;
        }
      }
      var headerRuleForRow = null;
      if (paintsThemeForTable && isHeaderRowForRow && (styleForTable === 'lines' || styleForTable === 'booktabs')) {
        headerRuleForRow = { widthPt: styleForTable === 'lines' ? 1.5 : 0.75, color: colorsForTable.tableHeaderRule };
      }
      var totalRuleForRow = (paintsThemeForTable && isTotalRowForRow) ? { widthPt: 1, color: colorsForTable.tableHeaderRule } : null;
      var colCursorForRow = 0;
      var cellsHtmlForRow = descriptorsForRow.map(function (descriptorForCell) {
        var spanForCell = Math.max(1, Number(descriptorForCell.colSpan) || 1);
        var columnForCell = colCursorForRow;
        colCursorForRow += spanForCell;
        if (descriptorForCell.kind === 'vmerge') return '';
        var rowSpanForCell = descriptorForCell.kind === 'cell' ? Math.max(1, Number(descriptorForCell.rowSpan) || 1) : 1;
        var lastRowOfCellForCell = rowIndexForRow + rowSpanForCell - 1;
        var topEdgeForCell = rowIndexForRow === 0 ? specForTable.top : specForTable.insideH;
        var bottomEdgeForCell = lastRowOfCellForCell >= lastRowIndexForTable ? specForTable.bottom : specForTable.insideH;
        var leftEdgeForCell = columnForCell === 0 ? specForTable.left : specForTable.insideV;
        var rightEdgeForCell = colCursorForRow >= colCountForTable ? specForTable.right : specForTable.insideV;
        if (headerRuleForRow) bottomEdgeForCell = widerEdgeForDocumentPrint(bottomEdgeForCell, headerRuleForRow);
        if (totalRuleForRow) topEdgeForCell = widerEdgeForDocumentPrint(topEdgeForCell, totalRuleForRow);
        var fillForCell = hexForDocumentPrint(descriptorForCell.fill) || hexForDocumentPrint(rowFillForRow);
        var stylesForCell = [
          'border-top: ' + borderCssForDocumentPrint(topEdgeForCell),
          'border-bottom: ' + borderCssForDocumentPrint(bottomEdgeForCell),
          'border-left: ' + borderCssForDocumentPrint(leftEdgeForCell),
          'border-right: ' + borderCssForDocumentPrint(rightEdgeForCell)
        ];
        if (fillForCell) stylesForCell.push('background-color: ' + fillForCell);
        if (descriptorForCell.kind !== 'cell') {
          return '<td style="' + stylesForCell.join('; ') + '"></td>';
        }
        var isHeaderCellForCell = !isLayoutForTable && (isHeaderRowForRow || !!descriptorForCell.header);
        var colorForCell = hexForDocumentPrint(descriptorForCell.color);
        if (!colorForCell && isHeaderCellForCell && !blockForTable.borderSpec) colorForCell = hexForDocumentPrint(colorsForTable.tableHeaderText);
        if (!colorForCell && blockForTable.keyValue && columnForCell === 0) colorForCell = hexForDocumentPrint(colorsForTable.muted);
        if (colorForCell) stylesForCell.push('color: ' + colorForCell);
        var alignForCell = String(descriptorForCell.align || alignmentsForTable[columnForCell] || '').toLowerCase();
        if (alignForCell === 'center' || alignForCell === 'right' || alignForCell === 'justify') stylesForCell.push('text-align: ' + alignForCell);
        var boldForCell = isHeaderCellForCell || isTotalRowForRow || (blockForTable.keyValue && columnForCell === 0) || (isLayoutForTable && !!descriptorForCell.header);
        if (boldForCell) stylesForCell.push('font-weight: 700');
        if (isHeaderRowForRow) stylesForCell.push('vertical-align: bottom');
        var paragraphsForCell = (Array.isArray(descriptorForCell.paragraphs) && descriptorForCell.paragraphs.length) ? descriptorForCell.paragraphs : [[]];
        var bodyHtmlForCell = paragraphsForCell.map(function (runsForCellParagraph) {
          return '<p>' + stateForTable.content(runsForCellParagraph) + '</p>';
        }).join('');
        var tagForCell = isHeaderRowForRow ? 'th' : 'td';
        var spanAttrsForCell = (spanForCell > 1 ? ' colspan="' + spanForCell + '"' : '') + (rowSpanForCell > 1 ? ' rowspan="' + rowSpanForCell + '"' : '');
        return '<' + tagForCell + spanAttrsForCell + ' style="' + stylesForCell.join('; ') + '">' + bodyHtmlForCell + '</' + tagForCell + '>';
      }).join('');
      return '<tr>' + cellsHtmlForRow + '</tr>';
    });

    var colgroupForTable = '<colgroup>' + widthsForTable.map(function (widthForCol) {
      return '<col style="width: ' + (Math.round(widthForCol / widthTotalForTable * 10000) / 100) + '%">';
    }).join('') + '</colgroup>';
    var headHtmlForTable = hasHeaderForTable ? '<thead>' + rowsHtmlForTable[0] + '</thead>' : '';
    var bodyRowsForTable = hasHeaderForTable ? rowsHtmlForTable.slice(1) : rowsHtmlForTable;
    var tableStyleForTable = 'font-size: ' + ptForDocumentPrint(sizePtForTable)
      + '; --cell-pad: ' + ptForDocumentPrint(paddingForTable.top) + ' ' + ptForDocumentPrint(paddingForTable.right) + ' '
      + ptForDocumentPrint(paddingForTable.bottom) + ' ' + ptForDocumentPrint(paddingForTable.left);
    var captionTextForTable = typeof blockForTable.caption === 'string' ? blockForTable.caption.trim() : '';
    return (captionTextForTable ? '<p class="caption">' + escapeHtmlForDocumentPrint(captionTextForTable) + '</p>' : '')
      + '<table class="' + (isLayoutForTable ? 'layout' : 'data') + '" style="' + tableStyleForTable + '">' + colgroupForTable
      + headHtmlForTable + '<tbody>' + bodyRowsForTable.join('') + '</tbody></table>';
  }

  // Entries carry a level from 0 to 2, whether they are ordered, and the key of the list element
  // they came from. A deeper entry opens a list inside the item before it, so the nesting matches
  // Word's indents. A new key at the same depth closes the open list and starts another, so each
  // list element numbers from 1 and a parent list resumes its count after a sub-list.
  function nestedListHtmlForDocumentPrint(entriesForList, stateForList) {
    if (!entriesForList.length) return '';
    var outForList = [];
    var depthForList = -1;
    var itemOpenForList = [];
    var tagAtDepthForList = [];
    var keyAtDepthForList = [];
    function openList(levelForOpen, entryForOpen) {
      var tagForOpen = entryForOpen.ordered ? 'ol' : 'ul';
      outForList.push('<' + tagForOpen + ' class="l' + levelForOpen + '">');
      tagAtDepthForList[levelForOpen] = tagForOpen;
      keyAtDepthForList[levelForOpen] = String(entryForOpen.key || 0);
      itemOpenForList[levelForOpen] = false;
    }
    function closeList(levelForClose) {
      if (itemOpenForList[levelForClose]) outForList.push('</li>');
      itemOpenForList[levelForClose] = false;
      outForList.push('</' + tagAtDepthForList[levelForClose] + '>');
    }
    entriesForList.forEach(function (entryForList) {
      var levelForItem = Math.max(0, Math.min(2, Number(entryForList.level) || 0));
      var keyForItem = String(entryForList.key || 0);
      while (depthForList > levelForItem) {
        closeList(depthForList);
        depthForList--;
      }
      if (depthForList === levelForItem && keyAtDepthForList[depthForList] !== keyForItem) {
        closeList(depthForList);
        depthForList--;
      }
      if (depthForList === -1) {
        openList(0, entryForList);
        depthForList = 0;
      }
      while (depthForList < levelForItem) {
        if (!itemOpenForList[depthForList]) {
          outForList.push('<li class="skip">');
          itemOpenForList[depthForList] = true;
        }
        openList(depthForList + 1, entryForList);
        depthForList++;
      }
      if (itemOpenForList[depthForList]) outForList.push('</li>');
      outForList.push('<li>' + stateForList.content(entryForList.runs || entryForList.text));
      itemOpenForList[depthForList] = true;
    });
    while (depthForList >= 0) {
      closeList(depthForList);
      depthForList--;
    }
    return '<div class="list">' + outForList.join('') + '</div>';
  }

  function alignAttrForDocumentPrint(alignForAttr) {
    var alignTextForAttr = String(alignForAttr || '').toLowerCase();
    return (alignTextForAttr === 'center' || alignTextForAttr === 'right' || alignTextForAttr === 'justify')
      ? ' style="text-align: ' + alignTextForAttr + '"'
      : '';
  }

  function imageHtmlForDocumentPrint(blockForImage, stateForImage) {
    var resolvedForImage = blockForImage.resolved || {};
    var bytesForImage = resolvedForImage.bytes;
    var typeForImage = String(resolvedForImage.contentType || '').toLowerCase();
    if (!bytesForImage || !bytesForImage.length || !/^image\/(png|jpeg|gif|webp|bmp|svg\+xml)$/.test(typeForImage)) return '';
    // A picture from the chat has the size it is shown at, and is centred over its caption.
    if (blockForImage.shown) {
      var captionForPicture = typeof blockForImage.caption === 'string' ? blockForImage.caption.trim() : '';
      return '<div class="picture"><img alt="' + escapeHtmlForDocumentPrint(blockForImage.alt || '') + '" src="data:' + typeForImage + ';base64,' + bytesToBase64ForDocumentPrint(bytesForImage)
        + '" style="width: ' + ptForDocumentPrint(blockForImage.shown.widthPt) + '; height: ' + ptForDocumentPrint(blockForImage.shown.heightPt) + '">'
        + (captionForPicture ? '<p class="picture-caption">' + escapeHtmlForDocumentPrint(captionForPicture) + '</p>' : '') + '</div>';
    }
    var widthPtForImage = Math.max(1, (Number(resolvedForImage.wPx) || 1) * PX_TO_PT_FOR_DOCUMENT_PRINT);
    var heightPtForImage = Math.max(1, (Number(resolvedForImage.hPx) || 1) * PX_TO_PT_FOR_DOCUMENT_PRINT);
    var scaleForImage = Math.min(1, stateForImage.contentWidthPt / widthPtForImage, stateForImage.contentHeightPt / heightPtForImage);
    return '<p class="figure"><img alt="" src="data:' + typeForImage + ';base64,' + bytesToBase64ForDocumentPrint(bytesForImage)
      + '" style="width: ' + ptForDocumentPrint(widthPtForImage * scaleForImage) + '; height: ' + ptForDocumentPrint(heightPtForImage * scaleForImage) + '"></p>';
  }

  function calloutHtmlForDocumentPrint(blockForCallout, stateForCallout) {
    var themesForCallout = agentNamespaceForDocumentPrint.documentThemes;
    var lookForCallout = stateForCallout.look;
    var tonesForCallout = (lookForCallout.themed && themesForCallout && typeof themesForCallout.calloutColors === 'function')
      ? themesForCallout.calloutColors(lookForCallout.theme, blockForCallout.tone)
      : { bar: lookForCallout.colors.accent, fill: lookForCallout.colors.calloutFill, title: lookForCallout.colors.accentText || lookForCallout.colors.accent };
    var piecesForCallout = [];
    var titleForCallout = typeof blockForCallout.title === 'string' ? blockForCallout.title.trim() : '';
    if (titleForCallout) {
      piecesForCallout.push('<p class="callout-title" style="color: ' + (hexForDocumentPrint(tonesForCallout.title) || '#000000') + '">' + escapeHtmlForDocumentPrint(titleForCallout) + '</p>');
    }
    stateForCallout.layout.calloutParagraphs(blockForCallout).forEach(function (contentForPiece) {
      piecesForCallout.push('<p>' + stateForCallout.content(contentForPiece) + '</p>');
    });
    if (!piecesForCallout.length) return '';
    return '<div class="callout" style="border-left-color: ' + (hexForDocumentPrint(tonesForCallout.bar) || '#555555')
      + '; background-color: ' + (hexForDocumentPrint(tonesForCallout.fill) || '#F2F2F2') + '">' + piecesForCallout.join('') + '</div>';
  }

  function blockHtmlForDocumentPrint(blockForBlock, stateForBlock) {
    var layoutForBlock = stateForBlock.layout;
    var typeForBlock = blockForBlock.type;
    var contentForBlock = layoutForBlock.blockContent(blockForBlock);
    if (typeForBlock === 'image') return imageHtmlForDocumentPrint(blockForBlock, stateForBlock);
    if (typeForBlock === 'title') {
      var subtitleForBlock = typeof blockForBlock.subtitle === 'string' ? blockForBlock.subtitle.trim() : '';
      return '<div class="title-block"><p class="title"' + alignAttrForDocumentPrint(blockForBlock.align) + '>' + stateForBlock.content(contentForBlock) + '</p>'
        + (subtitleForBlock ? '<p class="subtitle"' + alignAttrForDocumentPrint(blockForBlock.align) + '>' + escapeHtmlForDocumentPrint(subtitleForBlock) + '</p>' : '')
        + '</div>';
    }
    if (typeForBlock === 'subtitle') return '<p class="subtitle"' + alignAttrForDocumentPrint(blockForBlock.align) + '>' + stateForBlock.content(contentForBlock) + '</p>';
    if (typeForBlock === 'heading') {
      var levelForBlock = Math.max(1, Math.min(6, Number(blockForBlock.level) || 1));
      return '<h' + levelForBlock + alignAttrForDocumentPrint(blockForBlock.align) + '>' + stateForBlock.content(contentForBlock) + '</h' + levelForBlock + '>';
    }
    if (typeForBlock === 'bullet' || typeForBlock === 'numbered' || typeForBlock === 'list') {
      return nestedListHtmlForDocumentPrint(layoutForBlock.listEntries(blockForBlock), stateForBlock);
    }
    if (typeForBlock === 'table') return tableHtmlForDocumentPrint(blockForBlock, stateForBlock);
    if (typeForBlock === 'key_value') {
      var pairsForBlock = (Array.isArray(blockForBlock.rows) ? blockForBlock.rows : []).map(function (pairForBlock) {
        if (Array.isArray(pairForBlock)) return [pairForBlock[0], pairForBlock.slice(1).join(' ')];
        if (pairForBlock && typeof pairForBlock === 'object') return [pairForBlock.label, pairForBlock.value];
        return [String(pairForBlock == null ? '' : pairForBlock), ''];
      });
      if (!pairsForBlock.length) return '';
      return tableHtmlForDocumentPrint({
        rows: pairsForBlock,
        bordered: false,
        keyValue: true,
        columns: Array.isArray(blockForBlock.columns) ? blockForBlock.columns : [30, 70]
      }, stateForBlock);
    }
    if (typeForBlock === 'callout') return calloutHtmlForDocumentPrint(blockForBlock, stateForBlock);
    if (typeForBlock === 'quote') {
      var citeForBlock = typeof blockForBlock.cite === 'string' ? blockForBlock.cite.trim() : '';
      return '<blockquote><p>' + stateForBlock.content(contentForBlock) + '</p>'
        + (citeForBlock ? '<p class="cite">' + escapeHtmlForDocumentPrint(citeForBlock) + '</p>' : '') + '</blockquote>';
    }
    if (typeForBlock === 'divider') return '<hr>';
    if (typeForBlock === 'page_break') return '<div class="page-break"></div>';
    return '<p' + alignAttrForDocumentPrint(blockForBlock.align) + '>' + stateForBlock.content(contentForBlock) + '</p>';
  }

  // ---- Cover ----

  // The cover is the first page, on a named page with no margins so it can run to the edges.
  // Everything on it is placed where the layout from documentGeneration says, the same place the
  // DOCX and the built-in PDF put it. The page counts as page 1 but shows no number or header.
  // Font stacks hold quotes, so they go in the stylesheet (coverCss), never in a style attribute.
  function coverHtmlForDocumentPrint(layoutForCover) {
    var ptCover = ptForDocumentPrint;
    var colorsForCover = layoutForCover.colors;
    var boxStyle = function (box) {
      return 'left: ' + ptCover(box.x) + '; top: ' + ptCover(box.y) + '; width: ' + ptCover(box.w) + '; height: ' + ptCover(box.h) + ';';
    };
    var partsForCover = [];
    if (layoutForCover.photo) {
      partsForCover.push('<img class="cover-art" alt="' + escapeHtmlForDocumentPrint(layoutForCover.photo.alt || '') + '" src="data:image/' + layoutForCover.photo.ext + ';base64,'
        + bytesToBase64ForDocumentPrint(layoutForCover.photo.bytes) + '" style="' + boxStyle(layoutForCover.art) + '">');
    }
    if (layoutForCover.variant === 'band') {
      partsForCover.push('<div class="cover-fill" style="' + boxStyle(layoutForCover.art) + ' background-color: ' + hexForDocumentPrint(colorsForCover.band) + ';"></div>');
      if (layoutForCover.bandArt) {
        partsForCover.push('<img class="cover-art" alt="" src="data:image/png;base64,' + bytesToBase64ForDocumentPrint(layoutForCover.bandArt.png) + '" style="' + boxStyle(layoutForCover.art) + '">');
      }
      partsForCover.push('<div class="cover-fill" style="' + boxStyle(layoutForCover.strip) + ' background-color: ' + hexForDocumentPrint(colorsForCover.strip) + ';"></div>');
    }
    var alignForCover = layoutForCover.align === 'center' ? 'center' : 'left';
    var textForCover = '';
    if (layoutForCover.rule) {
      textForCover += '<div class="cover-rule" style="width: ' + ptCover(layoutForCover.rule.w) + '; height: ' + ptCover(layoutForCover.rule.h)
        + '; background-color: ' + hexForDocumentPrint(colorsForCover.rule) + ';' + (alignForCover === 'center' ? ' margin-left: auto; margin-right: auto;' : '') + '"></div>';
    }
    textForCover += '<p class="cover-title" style="font-size: ' + ptCover(layoutForCover.titleSize)
      + '; font-weight: ' + (layoutForCover.titleBold ? 700 : 400) + '; color: ' + hexForDocumentPrint(colorsForCover.title) + ';">' + escapeHtmlForDocumentPrint(layoutForCover.title) + '</p>';
    if (layoutForCover.subtitle) {
      textForCover += '<p class="cover-subtitle" style="font-size: ' + ptCover(layoutForCover.subtitleSize) + '; color: ' + hexForDocumentPrint(colorsForCover.subtitle) + ';">'
        + escapeHtmlForDocumentPrint(layoutForCover.subtitle) + '</p>';
    }
    var textPlace = layoutForCover.variant === 'band'
      ? 'bottom: ' + ptCover(layoutForCover.height - layoutForCover.textBottom) + ';'
      : 'top: ' + ptCover(layoutForCover.textTop) + ';';
    partsForCover.push('<div class="cover-text" style="left: ' + ptCover(layoutForCover.margin) + '; width: ' + ptCover(layoutForCover.textWidth) + '; ' + textPlace
      + ' text-align: ' + alignForCover + ';">' + textForCover + '</div>');
    if (layoutForCover.details.length) {
      var detailsPlace = layoutForCover.variant === 'band'
        ? 'top: ' + ptCover(layoutForCover.detailsTop) + ';'
        : 'bottom: ' + ptCover(layoutForCover.height - layoutForCover.detailsBottom) + ';';
      partsForCover.push('<div class="cover-details" style="left: ' + ptCover(layoutForCover.margin) + '; width: ' + ptCover(layoutForCover.textWidth) + '; ' + detailsPlace
        + ' text-align: ' + alignForCover + '; font-size: ' + ptCover(layoutForCover.detailSize) + '; color: ' + hexForDocumentPrint(colorsForCover.details) + ';">'
        + layoutForCover.details.map(function (lineForCover) { return '<p>' + escapeHtmlForDocumentPrint(lineForCover) + '</p>'; }).join('') + '</div>');
    }
    // A point short of the page, so rounding cannot push the section onto a second, blank page.
    return '<section class="cover" style="width: ' + ptCover(layoutForCover.width) + '; height: ' + ptCover(layoutForCover.height - 1) + ';">' + partsForCover.join('') + '</section>';
  }

  function coverCssForDocumentPrint(stacksForCoverCss) {
    return [
      '.cover-title { font-family: ' + stacksForCoverCss.heading + '; }',
      '@page cover { margin: 0; @top-right { content: none; } @bottom-right { content: none; } @bottom-center { content: none; } }',
      '.cover { page: cover; position: relative; overflow: hidden; break-after: page; margin: 0; }',
      '.cover-art, .cover-fill, .cover-text, .cover-details { position: absolute; }',
      '.cover-art { display: block; object-fit: cover; }',
      '.cover-rule { margin-bottom: 22pt; }',
      '.cover-title { line-height: 1.08; margin: 0 0 10pt; }',
      '.cover-subtitle { line-height: 1.25; margin: 0; }',
      '.cover-details { line-height: 1.4; }',
      '.cover-details p { margin: 0 0 2pt; }'
    ].join('\n');
  }

  // ---- Page and styles ----

  function pageCssForDocumentPrint(lookForPage, stacksForPage) {
    var marginsForPage = lookForPage.page.margins;
    var boxStyleForPage = 'font-family: ' + stacksForPage.body + '; font-size: ' + ptForDocumentPrint(lookForPage.sizes.small)
      + '; color: ' + hexForDocumentPrint(lookForPage.colors.muted) + ';';
    var boxesForPage = '';
    if (lookForPage.pageNumbers === 'page-x-of-y') {
      boxesForPage += ' @bottom-right { content: counter(page) " / " counter(pages); ' + boxStyleForPage + ' }';
    } else if (lookForPage.pageNumbers === 'page-number') {
      boxesForPage += ' @bottom-center { content: counter(page); ' + boxStyleForPage + ' }';
    }
    if (lookForPage.headerText) {
      boxesForPage += ' @top-right { content: ' + cssStringForDocumentPrint(lookForPage.headerText) + '; ' + boxStyleForPage + ' }';
    }
    return '@page { size: ' + ptForDocumentPrint(lookForPage.page.widthPt) + ' ' + ptForDocumentPrint(lookForPage.page.heightPt)
      + '; margin: ' + ptForDocumentPrint(marginsForPage.top) + ' ' + ptForDocumentPrint(marginsForPage.right) + ' '
      + ptForDocumentPrint(marginsForPage.bottom) + ' ' + ptForDocumentPrint(marginsForPage.left) + ';' + boxesForPage + ' }';
  }

  function documentCssForDocumentPrint(lookForCss, stacksForCss) {
    var colorsForCss = lookForCss.colors;
    var sizesForCss = lookForCss.sizes;
    var spacingForCss = lookForCss.spacing;
    var textColorForCss = hexForDocumentPrint(colorsForCss.text) || '#000000';
    var mutedForCss = hexForDocumentPrint(colorsForCss.muted) || '#555555';
    var headingColorForCss = hexForDocumentPrint(colorsForCss.heading) || textColorForCss;
    var afterForCss = ptForDocumentPrint(spacingForCss.after);
    var lineForCss = Math.round(spacingForCss.line * 1.2 * 100) / 100;
    var rulesForCss = [
      pageCssForDocumentPrint(lookForCss, stacksForCss),
      'html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
      'body { margin: 0; font-family: ' + stacksForCss.body + '; font-size: ' + ptForDocumentPrint(sizesForCss.body) + '; line-height: ' + lineForCss
        + '; color: ' + textColorForCss + '; font-kerning: normal; text-rendering: optimizeLegibility; orphans: 2; widows: 2; overflow-wrap: break-word; }',
      'p { margin: 0 0 ' + afterForCss + '; }',
      'a { color: ' + (hexForDocumentPrint(colorsForCss.link) || '#0563C1') + '; text-decoration: underline; }',
      'code { font-family: ' + stacksForCss.mono + '; font-size: 0.92em; }',
      'strong { font-weight: 700; }',
      '.title-block { margin: 0 0 18pt; break-after: avoid; }',
      '.title { font-family: ' + stacksForCss.heading + '; font-size: ' + ptForDocumentPrint(sizesForCss.title) + '; font-weight: 700; line-height: 1.15; color: ' + headingColorForCss + '; margin: 0 0 4pt; }',
      '.subtitle { font-size: ' + ptForDocumentPrint(sizesForCss.subtitle) + '; color: ' + mutedForCss + '; margin: 0 0 18pt; }',
      '.title-block .subtitle { margin-bottom: 0; }',
      'ul, ol { margin: 0; padding-left: 18pt; }',
      '.list { margin: 0 0 ' + afterForCss + '; padding-left: 18pt; }',
      'li { margin: 0 0 ' + ptForDocumentPrint(Math.min(4, spacingForCss.after)) + '; padding-left: 4pt; }',
      'li > ul, li > ol { margin-top: ' + ptForDocumentPrint(Math.min(4, spacingForCss.after)) + '; }',
      'li.skip { list-style: none; }',
      'ul > li::marker { color: ' + (hexForDocumentPrint(colorsForCss.accentText || colorsForCss.accent) || textColorForCss) + '; }',
      'table { border-collapse: collapse; width: 100%; table-layout: fixed; margin: 0 0 ' + ptForDocumentPrint(Math.max(spacingForCss.after, 6)) + '; line-height: 1.25; }',
      'thead { display: table-header-group; }',
      'tr { break-inside: avoid; }',
      'th, td { padding: var(--cell-pad); vertical-align: top; text-align: left; font-weight: 400; overflow-wrap: anywhere; }',
      'th p, td p { margin: 0; }',
      '.caption { font-weight: 700; color: ' + mutedForCss + '; font-size: ' + ptForDocumentPrint(sizesForCss.small) + '; margin: 8pt 0 4pt; break-after: avoid; }',
      '.callout { border-left: 3pt solid; padding: 6pt 12pt; margin: 8pt 0 12pt; break-inside: avoid; }',
      '.callout p { margin: 0 0 4pt; }',
      '.callout p:last-child { margin-bottom: 0; }',
      '.callout-title { font-weight: 700; }',
      'blockquote { margin: 6pt 18pt 10pt; padding-left: 10pt; border-left: 2.25pt solid ' + (hexForDocumentPrint(colorsForCss.rule) || '#808080')
        + '; font-style: italic; color: ' + mutedForCss + '; }',
      'blockquote p { margin: 0; }',
      'blockquote .cite { font-style: normal; text-align: right; font-size: ' + ptForDocumentPrint(sizesForCss.small) + '; margin-top: 4pt; }',
      'hr { border: 0; border-top: 0.75pt solid ' + (hexForDocumentPrint(colorsForCss.rule) || '#808080') + '; margin: 0 0 ' + ptForDocumentPrint(Math.max(12, spacingForCss.after * 2)) + '; }',
      '.page-break { break-after: page; height: 0; }',
      '.figure { margin: 0 0 ' + afterForCss + '; break-inside: avoid; }',
      '.figure img { display: block; max-width: 100%; }',
      '.picture { margin: 4pt 0 ' + ptForDocumentPrint(spacingForCss.after + 6) + '; text-align: center; break-inside: avoid; }',
      '.picture img { display: block; margin: 0 auto; }',
      '.picture-caption { font-weight: 700; color: ' + mutedForCss + '; font-size: ' + ptForDocumentPrint(sizesForCss.small) + '; margin: 4pt 0 0; }'
    ];
    for (var levelForCss = 1; levelForCss <= 6; levelForCss++) {
      rulesForCss.push('h' + levelForCss + ' { font-family: ' + stacksForCss.heading + '; font-size: ' + ptForDocumentPrint(sizesForCss.headings[levelForCss - 1])
        + '; font-weight: 700; ' + (levelForCss >= 4 ? 'font-style: italic; ' : '') + 'line-height: 1.2; color: ' + headingColorForCss
        + '; margin: ' + ptForDocumentPrint(spacingForCss.headingBefore[levelForCss - 1]) + ' 0 ' + ptForDocumentPrint(spacingForCss.headingAfter[levelForCss - 1])
        + '; break-after: avoid; break-inside: avoid; }');
    }
    rulesForCss.push('body > :first-child, .title-block + h1, .title-block + h2 { margin-top: 0; }');
    if (lookForCss.themed && lookForCss.theme.title && lookForCss.theme.title.align === 'center') rulesForCss.push('.title, .subtitle { text-align: center; }');
    if (lookForCss.themed && lookForCss.theme.title && lookForCss.theme.title.rule) {
      rulesForCss.push('.title-block { padding-bottom: 8pt; border-bottom: 1.5pt solid ' + (hexForDocumentPrint(colorsForCss.accent) || '#555555') + '; }');
    }
    if (lookForCss.themed && lookForCss.theme.headingRule) {
      rulesForCss.push('h1 { padding-bottom: 4pt; border-bottom: 0.75pt solid ' + (hexForDocumentPrint(colorsForCss.rule) || '#808080') + '; }');
    }
    for (var depthForCss = 0; depthForCss < 3; depthForCss++) {
      rulesForCss.push('ul.l' + depthForCss + ' { list-style-type: ' + BULLET_MARKERS_FOR_DOCUMENT_PRINT[depthForCss] + '; }');
      rulesForCss.push('ol.l' + depthForCss + ' { list-style-type: ' + ORDERED_MARKERS_FOR_DOCUMENT_PRINT[depthForCss] + '; }');
    }
    return rulesForCss.join('\n');
  }

  // Header and footer for Chrome before 131, which ignores @page margin boxes. These templates
  // render without the page's web fonts, so they name system fonts only.
  function legacyTemplatesForDocumentPrint(lookForTemplates) {
    var fontForTemplates = lookForTemplates.fonts.body.kind === 'serif' ? 'Georgia, \'Times New Roman\', serif' : 'Arial, Helvetica, sans-serif';
    var styleForTemplates = 'font-family: ' + fontForTemplates + '; font-size: ' + ptForDocumentPrint(lookForTemplates.sizes.small)
      + '; color: ' + (hexForDocumentPrint(lookForTemplates.colors.muted) || '#555555') + '; width: 100%; margin: 0 '
      + ptForDocumentPrint(lookForTemplates.page.margins.right) + ' 0 ' + ptForDocumentPrint(lookForTemplates.page.margins.left) + ';';
    var footerForTemplates = '<div></div>';
    if (lookForTemplates.pageNumbers === 'page-x-of-y') {
      footerForTemplates = '<div style="' + styleForTemplates + ' text-align: right;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>';
    } else if (lookForTemplates.pageNumbers === 'page-number') {
      footerForTemplates = '<div style="' + styleForTemplates + ' text-align: center;"><span class="pageNumber"></span></div>';
    }
    var headerForTemplates = lookForTemplates.headerText
      ? '<div style="' + styleForTemplates + ' text-align: right;">' + escapeHtmlForDocumentPrint(lookForTemplates.headerText) + '</div>'
      : '<div></div>';
    return {
      needed: !!(lookForTemplates.pageNumbers || lookForTemplates.headerText),
      header: headerForTemplates,
      footer: footerForTemplates
    };
  }

  // input: the prepared spec (blocks or content, plus docDefaults from html). context: the render
  // context from documentGeneration (theme, page, pageNumbers, headerText). options: { title, lang }.
  // Returns { html, fonts, templates }, where fonts lists the web fonts the page declares and
  // which of them the user named, so the printer can report one that did not load.
  function renderDocumentHtmlForDocumentPrint(inputForRender, contextForRender, optionsForRender) {
    var layoutForRender = layoutForDocumentPrint();
    var safeOptionsForRender = optionsForRender || {};
    var blocksForRender = layoutForRender.tidyBlocks(layoutForRender.normalizeBlocks(inputForRender, 'PDF creation requires blocks, html, or content.'));
    var lookForRender = buildLookForDocumentPrint(contextForRender, inputForRender.docDefaults || null);
    var langForRender = String(safeOptionsForRender.lang || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 35) || 'en';
    var coverForRender = lookForRender.themed && inputForRender.coverLayout ? inputForRender.coverLayout : null;
    var textForRender = collectTextForDocumentPrint([coverForRender, blocksForRender], { parts: [], chars: 0 }).parts.join('\n');
    var scriptFontsForRender = detectScriptFontsForDocumentPrint(textForRender, langForRender);
    var registryForRender = makeFontRegistryForDocumentPrint(scriptFontsForRender);
    var stacksForRender = {
      body: registryForRender.stack(lookForRender.fonts.body),
      heading: registryForRender.stack(lookForRender.fonts.heading),
      mono: registryForRender.stack(lookForRender.fonts.mono)
    };
    var pageForRender = lookForRender.page;
    var stateForRender = {
      layout: layoutForRender,
      look: lookForRender,
      content: makeInlineRendererForDocumentPrint(lookForRender, registryForRender),
      contentWidthPt: Math.max(72, pageForRender.widthPt - pageForRender.margins.left - pageForRender.margins.right),
      contentHeightPt: Math.max(72, pageForRender.heightPt - pageForRender.margins.top - pageForRender.margins.bottom)
    };
    var bodyForRender = blocksForRender.map(function (blockForRender) {
      if (!blockForRender || typeof blockForRender !== 'object') return '';
      return blockHtmlForDocumentPrint(blockForRender, stateForRender);
    }).join('\n');
    if (coverForRender) bodyForRender = coverHtmlForDocumentPrint(coverForRender) + '\n' + bodyForRender;
    var facesForRender = registryForRender.faces();
    var htmlForRender = '<!DOCTYPE html>\n<html lang="' + langForRender + '"><head><meta charset="utf-8">'
      + '<title>' + escapeHtmlForDocumentPrint(String(safeOptionsForRender.title || 'Document').slice(0, 200)) + '</title>'
      + '<style>\n' + fontFaceCssForDocumentPrint(facesForRender) + '\n' + documentCssForDocumentPrint(lookForRender, stacksForRender)
      + (coverForRender ? '\n' + coverCssForDocumentPrint(stacksForRender) : '') + '\n</style>'
      + '</head><body>\n' + bodyForRender + '\n</body></html>';
    return {
      html: htmlForRender,
      fonts: facesForRender.map(function (faceForList) {
        return { alias: faceForList.alias, family: faceForList.family, userNamed: !!faceForList.userNamed };
      }),
      scripts: scriptFontsForRender.map(function (scriptForList) { return scriptForList.key; }),
      templates: legacyTemplatesForDocumentPrint(lookForRender)
    };
  }

  agentNamespaceForDocumentPrint.documentPrint = {
    renderHtml: renderDocumentHtmlForDocumentPrint,
    detectScriptFonts: detectScriptFontsForDocumentPrint,
    fontFaceCss: fontFaceCssForDocumentPrint,
    webFonts: WEB_FONTS_FOR_DOCUMENT_PRINT
  };

  globalScopeForDocumentPrint.ABChatAgent = agentNamespaceForDocumentPrint;
})();
