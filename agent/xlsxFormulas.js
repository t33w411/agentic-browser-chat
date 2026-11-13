(function () {
  const globalScopeForXlsxFormulas = globalThis;
  const nsForXlsxFormulas = globalScopeForXlsxFormulas.ABChatAgent || {};

  // Formulas for the XLSX writer. prepare() checks a formula and returns the text to store in
  // the file; evaluateWorkbook() works out each formula's value, so the file carries a cached
  // result. Excel recalculates on opening anyway (the workbook sets fullCalcOnLoad), but file
  // previews, mail attachments and the extension's own file reader show only cached values, so a
  // formula without one reads as blank there.
  //
  // A formula this module cannot evaluate (a function it does not know, an array constant, a
  // defined name) is still stored; it simply has no cached value. A formula that would make Excel
  // reject the file (semicolon separators, structured references, an unbalanced quote or
  // parenthesis) is refused, and the writer keeps the cell as text and warns.

  const MAX_FORMULA_CHARS_FOR_XLSX_FORMULAS = 8192;
  const MAX_COLUMNS_FOR_XLSX_FORMULAS = 16384;
  const MAX_ROWS_FOR_XLSX_FORMULAS = 1048576;
  const ERROR_LITERALS_FOR_XLSX_FORMULAS = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A'];

  // Functions added to Excel after 2007 are stored with a prefix, or Excel shows #NAME? until
  // the formula is re-entered by hand.
  const FUTURE_FUNCTIONS_FOR_XLSX_FORMULAS = [
    'AGGREGATE', 'CEILING.MATH', 'CEILING.PRECISE', 'CONCAT', 'COVARIANCE.P', 'COVARIANCE.S', 'DAYS',
    'FLOOR.MATH', 'FLOOR.PRECISE', 'FORECAST.LINEAR', 'IFNA', 'IFS', 'ISOWEEKNUM', 'MAXIFS', 'MINIFS',
    'MODE.SNGL', 'MODE.MULT', 'NETWORKDAYS.INTL', 'NORM.DIST', 'NORM.INV', 'NORM.S.DIST', 'NORM.S.INV',
    'NUMBERVALUE', 'PERCENTILE.EXC', 'PERCENTILE.INC', 'PERCENTRANK.EXC', 'PERCENTRANK.INC',
    'QUARTILE.EXC', 'QUARTILE.INC', 'RANK.AVG', 'RANK.EQ', 'STDEV.P', 'STDEV.S', 'SWITCH', 'TEXTJOIN',
    'T.DIST', 'T.INV', 'T.TEST', 'UNICHAR', 'UNICODE', 'VAR.P', 'VAR.S', 'WORKDAY.INTL', 'XLOOKUP',
    'XMATCH', 'XOR', 'TEXTBEFORE', 'TEXTAFTER'
  ];
  // These return several values that spill into neighbouring cells. A file needs extra metadata
  // for that, which this writer does not produce, so Excel would show only the first value. The
  // writer warns about them, and they are never evaluated.
  const SPILLING_FUNCTIONS_FOR_XLSX_FORMULAS = [
    'FILTER', 'SORT', 'SORTBY', 'UNIQUE', 'SEQUENCE', 'RANDARRAY', 'LET', 'LAMBDA', 'TEXTSPLIT',
    'VSTACK', 'HSTACK', 'TOCOL', 'TOROW', 'WRAPROWS', 'WRAPCOLS', 'TAKE', 'DROP', 'CHOOSECOLS',
    'CHOOSEROWS', 'EXPAND', 'MAP', 'REDUCE', 'SCAN', 'BYROW', 'BYCOL', 'MAKEARRAY'
  ];
  const WORKSHEET_PREFIXED_FOR_XLSX_FORMULAS = { FILTER: true, SORT: true };

  function FormulaProblemForXlsxFormulas(kindForProblem, messageForProblem) {
    this.kind = kindForProblem;
    this.message = messageForProblem;
  }
  function syntaxForXlsxFormulas(messageForSyntax) {
    return new FormulaProblemForXlsxFormulas('syntax', messageForSyntax);
  }
  function unsupportedForXlsxFormulas(messageForUnsupported) {
    return new FormulaProblemForXlsxFormulas('unsupported', messageForUnsupported);
  }

  // ---- References ----

  function columnIndexForXlsxFormulas(lettersForColumn) {
    var indexForColumn = 0;
    var upperForColumn = String(lettersForColumn).toUpperCase();
    for (var iForColumn = 0; iForColumn < upperForColumn.length; iForColumn++) {
      indexForColumn = indexForColumn * 26 + (upperForColumn.charCodeAt(iForColumn) - 64);
    }
    return indexForColumn - 1;
  }

  function columnNameForXlsxFormulas(indexForName) {
    var nameForColumn = '';
    var restForColumn = indexForName + 1;
    while (restForColumn > 0) {
      var remainderForColumn = (restForColumn - 1) % 26;
      nameForColumn = String.fromCharCode(65 + remainderForColumn) + nameForColumn;
      restForColumn = Math.floor((restForColumn - 1) / 26);
    }
    return nameForColumn;
  }

  function cellNameForXlsxFormulas(rowForName, columnForName) {
    return columnNameForXlsxFormulas(columnForName) + (rowForName + 1);
  }

  // ---- Tokens ----

  var CELL_RE_FOR_XLSX_FORMULAS = /^\$?([A-Za-z]{1,3})\$?([0-9]{1,7})/;
  var COLUMN_RANGE_RE_FOR_XLSX_FORMULAS = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})(?![A-Za-z0-9_(.!])/;
  var ROW_RANGE_RE_FOR_XLSX_FORMULAS = /^\$?([0-9]{1,7}):\$?([0-9]{1,7})(?![A-Za-z0-9_(.!])/;
  var NAME_RE_FOR_XLSX_FORMULAS = /^[A-Za-z_\\][A-Za-z0-9_.]*/;
  var NUMBER_RE_FOR_XLSX_FORMULAS = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/;

  // Reads a cell, a cell range, a column range, or a row range at the start of text.
  function readReferenceForXlsxFormulas(textForRef) {
    var columnsForRef = COLUMN_RANGE_RE_FOR_XLSX_FORMULAS.exec(textForRef);
    if (columnsForRef) {
      var firstColumnForRef = columnIndexForXlsxFormulas(columnsForRef[1]);
      var lastColumnForRef = columnIndexForXlsxFormulas(columnsForRef[2]);
      if (firstColumnForRef >= MAX_COLUMNS_FOR_XLSX_FORMULAS || lastColumnForRef >= MAX_COLUMNS_FOR_XLSX_FORMULAS) return null;
      return {
        length: columnsForRef[0].length, whole: 'columns',
        r1: 0, r2: MAX_ROWS_FOR_XLSX_FORMULAS - 1,
        c1: Math.min(firstColumnForRef, lastColumnForRef), c2: Math.max(firstColumnForRef, lastColumnForRef)
      };
    }
    var rowsForRef = ROW_RANGE_RE_FOR_XLSX_FORMULAS.exec(textForRef);
    if (rowsForRef) {
      var firstRowForRef = Number(rowsForRef[1]) - 1;
      var lastRowForRef = Number(rowsForRef[2]) - 1;
      if (firstRowForRef < 0 || lastRowForRef < 0 || firstRowForRef >= MAX_ROWS_FOR_XLSX_FORMULAS || lastRowForRef >= MAX_ROWS_FOR_XLSX_FORMULAS) return null;
      return {
        length: rowsForRef[0].length, whole: 'rows',
        r1: Math.min(firstRowForRef, lastRowForRef), r2: Math.max(firstRowForRef, lastRowForRef),
        c1: 0, c2: MAX_COLUMNS_FOR_XLSX_FORMULAS - 1
      };
    }
    var firstForRef = CELL_RE_FOR_XLSX_FORMULAS.exec(textForRef);
    if (!firstForRef) return null;
    var startColumnForRef = columnIndexForXlsxFormulas(firstForRef[1]);
    var startRowForRef = Number(firstForRef[2]) - 1;
    if (startColumnForRef >= MAX_COLUMNS_FOR_XLSX_FORMULAS || startRowForRef < 0 || startRowForRef >= MAX_ROWS_FOR_XLSX_FORMULAS) return null;
    var consumedForRef = firstForRef[0].length;
    var endColumnForRef = startColumnForRef;
    var endRowForRef = startRowForRef;
    if (textForRef.charAt(consumedForRef) === ':') {
      var secondForRef = CELL_RE_FOR_XLSX_FORMULAS.exec(textForRef.slice(consumedForRef + 1));
      if (secondForRef) {
        endColumnForRef = columnIndexForXlsxFormulas(secondForRef[1]);
        endRowForRef = Number(secondForRef[2]) - 1;
        if (endColumnForRef >= MAX_COLUMNS_FOR_XLSX_FORMULAS || endRowForRef < 0 || endRowForRef >= MAX_ROWS_FOR_XLSX_FORMULAS) return null;
        consumedForRef += 1 + secondForRef[0].length;
      }
    }
    // "A1B" or "LOG10(" are not references.
    if (/[A-Za-z0-9_(.]/.test(textForRef.charAt(consumedForRef))) return null;
    return {
      length: consumedForRef, whole: '',
      r1: Math.min(startRowForRef, endRowForRef), r2: Math.max(startRowForRef, endRowForRef),
      c1: Math.min(startColumnForRef, endColumnForRef), c2: Math.max(startColumnForRef, endColumnForRef)
    };
  }

  function tokenizeForXlsxFormulas(textForTokens) {
    var tokensForTokens = [];
    var indexForTokens = 0;
    var lengthForTokens = textForTokens.length;
    var depthForTokens = 0;
    while (indexForTokens < lengthForTokens) {
      var charForTokens = textForTokens.charAt(indexForTokens);
      var restForTokens = textForTokens.slice(indexForTokens);
      if (/\s/.test(charForTokens)) { indexForTokens++; continue; }
      if (charForTokens === '"') {
        var endForString = indexForTokens + 1;
        var valueForString = '';
        for (;;) {
          if (endForString >= lengthForTokens) throw syntaxForXlsxFormulas('a text value is missing its closing quote');
          if (textForTokens.charAt(endForString) === '"') {
            if (textForTokens.charAt(endForString + 1) === '"') { valueForString += '"'; endForString += 2; continue; }
            break;
          }
          valueForString += textForTokens.charAt(endForString);
          endForString++;
        }
        tokensForTokens.push({ type: 'str', value: valueForString, start: indexForTokens, end: endForString + 1 });
        indexForTokens = endForString + 1;
        continue;
      }
      if (charForTokens === '#') {
        var upperRestForError = restForTokens.toUpperCase();
        var literalForError = ERROR_LITERALS_FOR_XLSX_FORMULAS.find(function (candidateForError) { return upperRestForError.indexOf(candidateForError) === 0; });
        if (!literalForError) throw syntaxForXlsxFormulas('"' + restForTokens.slice(0, 8) + '" is not an Excel error value');
        tokensForTokens.push({ type: 'err', value: literalForError, start: indexForTokens, end: indexForTokens + literalForError.length });
        indexForTokens += literalForError.length;
        continue;
      }
      if (charForTokens === '{') {
        var closeForArray = textForTokens.indexOf('}', indexForTokens);
        if (closeForArray === -1) throw syntaxForXlsxFormulas('an array constant is missing its closing brace');
        tokensForTokens.push({ type: 'array', start: indexForTokens, end: closeForArray + 1 });
        indexForTokens = closeForArray + 1;
        continue;
      }
      if (charForTokens === "'") {
        var endForSheet = indexForTokens + 1;
        var nameForSheet = '';
        for (;;) {
          if (endForSheet >= lengthForTokens) throw syntaxForXlsxFormulas('a sheet name is missing its closing quote');
          if (textForTokens.charAt(endForSheet) === "'") {
            if (textForTokens.charAt(endForSheet + 1) === "'") { nameForSheet += "'"; endForSheet += 2; continue; }
            break;
          }
          nameForSheet += textForTokens.charAt(endForSheet);
          endForSheet++;
        }
        if (textForTokens.charAt(endForSheet + 1) !== '!') throw syntaxForXlsxFormulas('a quoted sheet name must be followed by ! and a cell reference');
        var quotedRefForSheet = readReferenceForXlsxFormulas(textForTokens.slice(endForSheet + 2));
        if (!quotedRefForSheet) throw syntaxForXlsxFormulas("'" + nameForSheet + "'! must be followed by a cell reference");
        tokensForTokens.push(Object.assign({ type: 'ref', sheet: nameForSheet, start: indexForTokens, refStart: endForSheet + 2, end: endForSheet + 2 + quotedRefForSheet.length }, quotedRefForSheet));
        indexForTokens = endForSheet + 2 + quotedRefForSheet.length;
        continue;
      }
      if (/[0-9.]/.test(charForTokens)) {
        var rowRangeForNumber = /^[0-9]/.test(charForTokens) ? readReferenceForXlsxFormulas(restForTokens) : null;
        if (rowRangeForNumber && rowRangeForNumber.whole === 'rows') {
          tokensForTokens.push(Object.assign({ type: 'ref', sheet: null, start: indexForTokens, refStart: indexForTokens, end: indexForTokens + rowRangeForNumber.length }, rowRangeForNumber));
          indexForTokens += rowRangeForNumber.length;
          continue;
        }
        var numberForTokens = NUMBER_RE_FOR_XLSX_FORMULAS.exec(restForTokens);
        if (!numberForTokens) throw syntaxForXlsxFormulas('"' + restForTokens.slice(0, 8) + '" is not a number');
        tokensForTokens.push({ type: 'num', value: Number(numberForTokens[0]), start: indexForTokens, end: indexForTokens + numberForTokens[0].length });
        indexForTokens += numberForTokens[0].length;
        continue;
      }
      if (/[A-Za-z_$\\]/.test(charForTokens)) {
        var sheetPrefixForTokens = /^([A-Za-z_][A-Za-z0-9_.]*)!/.exec(restForTokens);
        if (sheetPrefixForTokens) {
          var prefixedRefForTokens = readReferenceForXlsxFormulas(restForTokens.slice(sheetPrefixForTokens[0].length));
          if (!prefixedRefForTokens) throw syntaxForXlsxFormulas(sheetPrefixForTokens[0] + ' must be followed by a cell reference');
          var refStartForPrefix = indexForTokens + sheetPrefixForTokens[0].length;
          tokensForTokens.push(Object.assign({ type: 'ref', sheet: sheetPrefixForTokens[1], start: indexForTokens, refStart: refStartForPrefix, end: refStartForPrefix + prefixedRefForTokens.length }, prefixedRefForTokens));
          indexForTokens = refStartForPrefix + prefixedRefForTokens.length;
          continue;
        }
        var nameForTokens = NAME_RE_FOR_XLSX_FORMULAS.exec(restForTokens);
        var afterNameForTokens = nameForTokens ? restForTokens.slice(nameForTokens[0].length).replace(/^\s+/, '') : '';
        if (nameForTokens && afterNameForTokens.charAt(0) === '(') {
          tokensForTokens.push({ type: 'func', name: nameForTokens[0].toUpperCase(), start: indexForTokens, end: indexForTokens + nameForTokens[0].length });
          indexForTokens += nameForTokens[0].length;
          continue;
        }
        var refForTokens = readReferenceForXlsxFormulas(restForTokens);
        if (refForTokens) {
          tokensForTokens.push(Object.assign({ type: 'ref', sheet: null, start: indexForTokens, refStart: indexForTokens, end: indexForTokens + refForTokens.length }, refForTokens));
          indexForTokens += refForTokens.length;
          continue;
        }
        if (!nameForTokens) throw syntaxForXlsxFormulas('"' + restForTokens.slice(0, 8) + '" is not valid in a formula');
        var upperNameForTokens = nameForTokens[0].toUpperCase();
        if (upperNameForTokens === 'TRUE' || upperNameForTokens === 'FALSE') {
          tokensForTokens.push({ type: 'bool', value: upperNameForTokens === 'TRUE', start: indexForTokens, end: indexForTokens + nameForTokens[0].length });
        } else {
          tokensForTokens.push({ type: 'name', name: upperNameForTokens, start: indexForTokens, end: indexForTokens + nameForTokens[0].length });
        }
        indexForTokens += nameForTokens[0].length;
        continue;
      }
      var twoForTokens = restForTokens.slice(0, 2);
      if (twoForTokens === '<=' || twoForTokens === '>=' || twoForTokens === '<>') {
        tokensForTokens.push({ type: 'op', value: twoForTokens, start: indexForTokens, end: indexForTokens + 2 });
        indexForTokens += 2;
        continue;
      }
      if ('+-*/^&=<>%:'.indexOf(charForTokens) !== -1) {
        tokensForTokens.push({ type: 'op', value: charForTokens, start: indexForTokens, end: indexForTokens + 1 });
        indexForTokens++;
        continue;
      }
      if (charForTokens === '(') { depthForTokens++; tokensForTokens.push({ type: '(', start: indexForTokens, end: indexForTokens + 1 }); indexForTokens++; continue; }
      if (charForTokens === ')') {
        depthForTokens--;
        if (depthForTokens < 0) throw syntaxForXlsxFormulas('there is a closing parenthesis with no opening one');
        tokensForTokens.push({ type: ')', start: indexForTokens, end: indexForTokens + 1 });
        indexForTokens++;
        continue;
      }
      if (charForTokens === ',') { tokensForTokens.push({ type: ',', start: indexForTokens, end: indexForTokens + 1 }); indexForTokens++; continue; }
      if (charForTokens === ';') throw syntaxForXlsxFormulas('arguments are separated by commas in a file, not semicolons');
      if (charForTokens === '[') throw syntaxForXlsxFormulas('table references such as Table1[Column] are not available, because the workbook has no tables');
      if (charForTokens === '@') throw syntaxForXlsxFormulas('the @ operator cannot be stored in a file');
      throw syntaxForXlsxFormulas('"' + charForTokens + '" is not valid in a formula');
    }
    if (depthForTokens !== 0) throw syntaxForXlsxFormulas('a parenthesis is not closed');
    return tokensForTokens;
  }

  // ---- Parser ----
  // Excel's precedence, loosest first: comparison, &, + and -, * and /, ^, unary minus, %.

  function parseForXlsxFormulas(tokensForParse) {
    var positionForParse = 0;
    function peek() { return tokensForParse[positionForParse]; }
    function next() { return tokensForParse[positionForParse++]; }
    function isOp(tokenForOp, valuesForOp) {
      return tokenForOp && tokenForOp.type === 'op' && valuesForOp.indexOf(tokenForOp.value) !== -1;
    }
    function binaryLevel(operatorsForLevel, nextLevel) {
      return function () {
        var leftForLevel = nextLevel();
        while (isOp(peek(), operatorsForLevel)) {
          var opForLevel = next().value;
          leftForLevel = { t: 'bin', op: opForLevel, left: leftForLevel, right: nextLevel() };
        }
        return leftForLevel;
      };
    }
    function primary() {
      var tokenForPrimary = next();
      if (!tokenForPrimary) throw syntaxForXlsxFormulas('the formula ends where a value is expected');
      if (tokenForPrimary.type === 'num') return { t: 'num', value: tokenForPrimary.value };
      if (tokenForPrimary.type === 'str') return { t: 'str', value: tokenForPrimary.value };
      if (tokenForPrimary.type === 'bool') return { t: 'bool', value: tokenForPrimary.value };
      if (tokenForPrimary.type === 'err') return { t: 'err', value: tokenForPrimary.value };
      if (tokenForPrimary.type === 'array') return { t: 'unsupported', why: 'an array constant' };
      if (tokenForPrimary.type === 'name') return { t: 'unsupported', why: 'the name ' + tokenForPrimary.name };
      if (tokenForPrimary.type === 'ref') {
        var nodeForRef = { t: 'ref', sheet: tokenForPrimary.sheet, r1: tokenForPrimary.r1, c1: tokenForPrimary.c1, r2: tokenForPrimary.r2, c2: tokenForPrimary.c2, whole: tokenForPrimary.whole };
        if (isOp(peek(), [':'])) {
          next();
          primary();
          return { t: 'unsupported', why: 'a range built with :' };
        }
        return nodeForRef;
      }
      if (tokenForPrimary.type === 'func') {
        next();
        var argsForFunc = [];
        if (peek() && peek().type === ')') {
          next();
        } else {
          for (;;) {
            if (peek() && (peek().type === ',' || peek().type === ')')) argsForFunc.push({ t: 'blank' });
            else argsForFunc.push(expression());
            var separatorForFunc = next();
            if (!separatorForFunc) throw syntaxForXlsxFormulas(tokenForPrimary.name + '( is not closed');
            if (separatorForFunc.type === ')') break;
            if (separatorForFunc.type !== ',') throw syntaxForXlsxFormulas('expected a comma or ) in ' + tokenForPrimary.name + '(');
          }
        }
        return { t: 'func', name: tokenForPrimary.name.replace(/^_XLFN\.(_XLWS\.)?/, ''), args: argsForFunc };
      }
      if (tokenForPrimary.type === '(') {
        var innerForGroup = expression();
        var closeForGroup = next();
        if (!closeForGroup || closeForGroup.type !== ')') throw syntaxForXlsxFormulas('a parenthesis is not closed');
        return innerForGroup;
      }
      if (tokenForPrimary.type === 'op' && tokenForPrimary.value === ':') throw syntaxForXlsxFormulas('":" must sit between two cell references');
      throw syntaxForXlsxFormulas('"' + (tokenForPrimary.value || tokenForPrimary.type) + '" is out of place');
    }
    function percent() {
      var valueForPercent = primary();
      while (isOp(peek(), ['%'])) {
        next();
        valueForPercent = { t: 'pct', arg: valueForPercent };
      }
      return valueForPercent;
    }
    function unary() {
      if (isOp(peek(), ['-', '+'])) {
        var signForUnary = next().value;
        var argForUnary = unary();
        return signForUnary === '-' ? { t: 'neg', arg: argForUnary } : argForUnary;
      }
      return percent();
    }
    var power = binaryLevel(['^'], unary);
    var product = binaryLevel(['*', '/'], power);
    var sum = binaryLevel(['+', '-'], product);
    var concat = binaryLevel(['&'], sum);
    var compare = binaryLevel(['=', '<>', '<', '>', '<=', '>='], concat);
    function expression() { return compare(); }

    var treeForParse = expression();
    if (positionForParse < tokensForParse.length) {
      var strayForParse = tokensForParse[positionForParse];
      throw syntaxForXlsxFormulas('"' + (strayForParse.value || strayForParse.name || strayForParse.type) + '" is out of place');
    }
    return treeForParse;
  }

  // Checks a formula and returns what to store: function names and references in capitals, with
  // the prefix newer functions need. The leading "=" is optional and never stored.
  function prepareForXlsxFormulas(textForPrepare) {
    var rawForPrepare = String(textForPrepare == null ? '' : textForPrepare).replace(/^\s*=/, '').trim();
    if (!rawForPrepare) return { ok: false, error: 'the formula is empty' };
    if (rawForPrepare.length > MAX_FORMULA_CHARS_FOR_XLSX_FORMULAS) return { ok: false, error: 'the formula is longer than 8,192 characters' };
    var tokensForPrepare;
    var treeForPrepare;
    try {
      tokensForPrepare = tokenizeForXlsxFormulas(rawForPrepare);
      if (!tokensForPrepare.length) return { ok: false, error: 'the formula is empty' };
      treeForPrepare = parseForXlsxFormulas(tokensForPrepare);
    } catch (errForPrepare) {
      if (errForPrepare instanceof FormulaProblemForXlsxFormulas) return { ok: false, error: errForPrepare.message };
      throw errForPrepare;
    }
    var storedForPrepare = '';
    var cursorForPrepare = 0;
    var spillingForPrepare = [];
    var functionsForPrepare = [];
    tokensForPrepare.forEach(function (tokenForStore) {
      if (tokenForStore.type === 'func') {
        storedForPrepare += rawForPrepare.slice(cursorForPrepare, tokenForStore.start);
        var bareForStore = tokenForStore.name.replace(/^_XLFN\.(_XLWS\.)?/, '');
        functionsForPrepare.push(bareForStore);
        if (SPILLING_FUNCTIONS_FOR_XLSX_FORMULAS.indexOf(bareForStore) !== -1) spillingForPrepare.push(bareForStore);
        var prefixForStore = '';
        if (WORKSHEET_PREFIXED_FOR_XLSX_FORMULAS[bareForStore]) prefixForStore = '_xlfn._xlws.';
        else if (FUTURE_FUNCTIONS_FOR_XLSX_FORMULAS.indexOf(bareForStore) !== -1 || SPILLING_FUNCTIONS_FOR_XLSX_FORMULAS.indexOf(bareForStore) !== -1) prefixForStore = '_xlfn.';
        storedForPrepare += prefixForStore + bareForStore;
        cursorForPrepare = tokenForStore.end;
      } else if (tokenForStore.type === 'ref') {
        storedForPrepare += rawForPrepare.slice(cursorForPrepare, tokenForStore.refStart);
        storedForPrepare += rawForPrepare.slice(tokenForStore.refStart, tokenForStore.end).toUpperCase();
        cursorForPrepare = tokenForStore.end;
      }
    });
    storedForPrepare += rawForPrepare.slice(cursorForPrepare);
    return { ok: true, stored: storedForPrepare, tree: treeForPrepare, spilling: spillingForPrepare, functions: functionsForPrepare };
  }

  // ---- Values ----
  // A value is a number, a string, a boolean, null (an empty cell), an error { error }, or a
  // range { range: true, sheet, r1, c1, r2, c2 }. UNKNOWN is thrown when a value cannot be worked
  // out here; the cell is then stored without a cached result.

  var UNKNOWN_FOR_XLSX_FORMULAS = { unknown: true };
  var CIRCULAR_FOR_XLSX_FORMULAS = { circular: true };
  function errForXlsxFormulas(codeForErr) { return { error: codeForErr }; }
  function isErrForXlsxFormulas(valueForErr) { return !!(valueForErr && typeof valueForErr === 'object' && valueForErr.error); }
  function isRangeForXlsxFormulas(valueForRange) { return !!(valueForRange && typeof valueForRange === 'object' && valueForRange.range); }

  // Excel shows a number with up to 15 significant digits.
  function numberToTextForXlsxFormulas(numberForText) {
    if (!isFinite(numberForText)) return '#NUM!';
    if (Number.isInteger(numberForText) && Math.abs(numberForText) < 1e15) return String(numberForText);
    var preciseForText = Number(numberForText.toPrecision(15));
    var textForNumber = String(preciseForText);
    return textForNumber.replace(/e\+/, 'E+').replace(/e-/, 'E-');
  }

  function toNumberForXlsxFormulas(valueForNumber) {
    if (valueForNumber === null || valueForNumber === undefined) return 0;
    if (typeof valueForNumber === 'number') return valueForNumber;
    if (typeof valueForNumber === 'boolean') return valueForNumber ? 1 : 0;
    if (typeof valueForNumber === 'string') {
      var trimmedForNumber = valueForNumber.trim();
      if (trimmedForNumber === '') return errForXlsxFormulas('#VALUE!');
      var percentForNumber = /%$/.test(trimmedForNumber);
      var parsedForNumber = Number(trimmedForNumber.replace(/,/g, '').replace(/%$/, ''));
      if (!isFinite(parsedForNumber)) return errForXlsxFormulas('#VALUE!');
      return percentForNumber ? parsedForNumber / 100 : parsedForNumber;
    }
    if (isErrForXlsxFormulas(valueForNumber)) return valueForNumber;
    return errForXlsxFormulas('#VALUE!');
  }

  function toTextForXlsxFormulas(valueForText) {
    if (valueForText === null || valueForText === undefined) return '';
    if (typeof valueForText === 'string') return valueForText;
    if (typeof valueForText === 'number') return numberToTextForXlsxFormulas(valueForText);
    if (typeof valueForText === 'boolean') return valueForText ? 'TRUE' : 'FALSE';
    return valueForText;
  }

  function toBooleanForXlsxFormulas(valueForBoolean) {
    if (valueForBoolean === null || valueForBoolean === undefined) return false;
    if (typeof valueForBoolean === 'boolean') return valueForBoolean;
    if (typeof valueForBoolean === 'number') return valueForBoolean !== 0;
    if (typeof valueForBoolean === 'string') {
      var upperForBoolean = valueForBoolean.toUpperCase();
      if (upperForBoolean === 'TRUE') return true;
      if (upperForBoolean === 'FALSE') return false;
      return errForXlsxFormulas('#VALUE!');
    }
    return valueForBoolean;
  }

  // Excel orders numbers before text before booleans; text compares without case.
  function compareForXlsxFormulas(leftForCompare, rightForCompare) {
    var leftValue = leftForCompare;
    var rightValue = rightForCompare;
    if (leftValue === null) leftValue = typeof rightValue === 'string' ? '' : (typeof rightValue === 'boolean' ? false : 0);
    if (rightValue === null) rightValue = typeof leftValue === 'string' ? '' : (typeof leftValue === 'boolean' ? false : 0);
    function rank(valueForRank) { return typeof valueForRank === 'number' ? 0 : (typeof valueForRank === 'string' ? 1 : 2); }
    var rankDiff = rank(leftValue) - rank(rightValue);
    if (rankDiff !== 0) return rankDiff;
    if (typeof leftValue === 'string') {
      var leftLower = leftValue.toLowerCase();
      var rightLower = rightValue.toLowerCase();
      return leftLower < rightLower ? -1 : (leftLower > rightLower ? 1 : 0);
    }
    if (typeof leftValue === 'boolean') return (leftValue ? 1 : 0) - (rightValue ? 1 : 0);
    return leftValue < rightValue ? -1 : (leftValue > rightValue ? 1 : 0);
  }

  function wildcardRegexForXlsxFormulas(patternForWildcard) {
    var sourceForWildcard = '';
    for (var iForWildcard = 0; iForWildcard < patternForWildcard.length; iForWildcard++) {
      var charForWildcard = patternForWildcard.charAt(iForWildcard);
      if (charForWildcard === '~' && iForWildcard + 1 < patternForWildcard.length) {
        iForWildcard++;
        sourceForWildcard += patternForWildcard.charAt(iForWildcard).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      } else if (charForWildcard === '*') sourceForWildcard += '[\\s\\S]*';
      else if (charForWildcard === '?') sourceForWildcard += '[\\s\\S]';
      else sourceForWildcard += charForWildcard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp('^' + sourceForWildcard + '$', 'i');
  }

  // A SUMIF-style criterion: 5, ">=5", "<>done", "a*", or "" for an empty cell.
  function criterionForXlsxFormulas(criterionValue) {
    if (isErrForXlsxFormulas(criterionValue)) return criterionValue;
    if (typeof criterionValue === 'number') {
      return function (cellValue) { return typeof cellValue === 'number' ? cellValue === criterionValue : (typeof cellValue === 'string' && cellValue.trim() !== '' && Number(cellValue) === criterionValue); };
    }
    if (typeof criterionValue === 'boolean') {
      return function (cellValue) { return cellValue === criterionValue; };
    }
    var textForCriterion = toTextForXlsxFormulas(criterionValue);
    var matchForCriterion = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(textForCriterion);
    var opForCriterion = matchForCriterion[1] || '';
    var operandText = matchForCriterion[2];
    var operandNumber = operandText.trim() !== '' && isFinite(Number(operandText)) ? Number(operandText) : null;
    var operandUpper = operandText.toUpperCase();
    var operandBoolean = operandUpper === 'TRUE' ? true : (operandUpper === 'FALSE' ? false : null);
    if (operandText === '') {
      if (opForCriterion === '<>') return function (cellValue) { return cellValue !== null && cellValue !== ''; };
      if (opForCriterion === '' || opForCriterion === '=') return function (cellValue) { return cellValue === null || cellValue === ''; };
    }
    if (operandNumber !== null) {
      return function (cellValue) {
        var numberForCell = typeof cellValue === 'number' ? cellValue : null;
        if (opForCriterion === '' || opForCriterion === '=') return numberForCell === operandNumber || (typeof cellValue === 'string' && cellValue.trim() !== '' && Number(cellValue) === operandNumber);
        if (opForCriterion === '<>') return !(numberForCell === operandNumber);
        if (numberForCell === null) return false;
        if (opForCriterion === '<') return numberForCell < operandNumber;
        if (opForCriterion === '>') return numberForCell > operandNumber;
        if (opForCriterion === '<=') return numberForCell <= operandNumber;
        return numberForCell >= operandNumber;
      };
    }
    if (operandBoolean !== null && (opForCriterion === '' || opForCriterion === '=' || opForCriterion === '<>')) {
      return function (cellValue) {
        var equalForBoolean = cellValue === operandBoolean;
        return opForCriterion === '<>' ? !equalForBoolean : equalForBoolean;
      };
    }
    var patternForCriterion = wildcardRegexForXlsxFormulas(operandText);
    return function (cellValue) {
      if (opForCriterion === '' || opForCriterion === '=') return typeof cellValue === 'string' && patternForCriterion.test(cellValue);
      if (opForCriterion === '<>') return !(typeof cellValue === 'string' && patternForCriterion.test(cellValue));
      if (typeof cellValue !== 'string') return false;
      var orderForCriterion = compareForXlsxFormulas(cellValue, operandText);
      if (opForCriterion === '<') return orderForCriterion < 0;
      if (opForCriterion === '>') return orderForCriterion > 0;
      if (opForCriterion === '<=') return orderForCriterion <= 0;
      return orderForCriterion >= 0;
    };
  }

  // Excel's day count: serial 1 is 1900-01-01, and dates from March 1900 on match this formula
  // because Excel counts a 29 February 1900 that never existed.
  var EPOCH_MS_FOR_XLSX_FORMULAS = Date.UTC(1899, 11, 30);
  function serialFromPartsForXlsxFormulas(yearForSerial, monthForSerial, dayForSerial) {
    return Math.round((Date.UTC(yearForSerial, monthForSerial - 1, dayForSerial) - EPOCH_MS_FOR_XLSX_FORMULAS) / 86400000);
  }
  function partsFromSerialForXlsxFormulas(serialForParts) {
    var dateForParts = new Date(EPOCH_MS_FOR_XLSX_FORMULAS + Math.floor(serialForParts) * 86400000);
    return { year: dateForParts.getUTCFullYear(), month: dateForParts.getUTCMonth() + 1, day: dateForParts.getUTCDate(), weekday: dateForParts.getUTCDay() };
  }

  // ---- Evaluation ----

  // sheets: [{ name, rows: [[cell]] }], cell { formula } (text without "=") or { value }.
  // Returns { results: [ { 'r,c': { value } | { error } | { unknown: true } | { circular: true } } ] }.
  function evaluateWorkbookForXlsxFormulas(sheetsForWorkbook, optionsForWorkbook) {
    var safeOptionsForWorkbook = optionsForWorkbook || {};
    var todaySerialForWorkbook = typeof safeOptionsForWorkbook.todaySerial === 'number'
      ? safeOptionsForWorkbook.todaySerial
      : (function () { var nowForToday = new Date(); return serialFromPartsForXlsxFormulas(nowForToday.getFullYear(), nowForToday.getMonth() + 1, nowForToday.getDate()); })();
    var sheetIndexByName = {};
    sheetsForWorkbook.forEach(function (sheetForIndex, indexForSheet) {
      sheetIndexByName[String(sheetForIndex.name || '').toUpperCase()] = indexForSheet;
    });
    var stateForWorkbook = sheetsForWorkbook.map(function () { return {}; });
    var treesForWorkbook = sheetsForWorkbook.map(function () { return {}; });
    var BUSY = {};

    // Ranges stop at the last row and column any sheet uses, so A1:A1048576 costs what the data
    // costs. One bound for the whole workbook keeps two ranges of one size on different sheets
    // the same shape, as SUMIFS and SUMPRODUCT require.
    var usedRowsForWorkbook = 0;
    var usedColumnsForWorkbook = 0;
    sheetsForWorkbook.forEach(function (sheetForUsed) {
      var rowsForUsed = sheetForUsed.rows || [];
      usedRowsForWorkbook = Math.max(usedRowsForWorkbook, rowsForUsed.length);
      rowsForUsed.forEach(function (rowForUsed) { usedColumnsForWorkbook = Math.max(usedColumnsForWorkbook, Array.isArray(rowForUsed) ? rowForUsed.length : 0); });
    });
    // A range's values are kept only when the same range is asked for a second time, and only up
    // to a total cell budget. A running total ($B$2:B2, $B$2:B3, ...) asks for every range once;
    // keeping each one held about n*n/2 values and ran out of memory at 10,000 rows.
    var MAX_CACHED_RANGE_CELLS_FOR_WORKBOOK = 2000000;
    var rangeCacheForWorkbook = Object.create(null);
    var rangeSeenForWorkbook = Object.create(null);
    var cachedRangeCellsForWorkbook = 0;
    // Results of calls whose arguments include a multi-cell range, keyed by the call's text and
    // sheet. Every function here depends only on cell values, so an identical call on another row
    // (SUM($B$2:$B$900) on each row of a share column) has the same result.
    var callResultsForWorkbook = Object.create(null);
    var callKeyByNodeForWorkbook = new WeakMap();
    // Conditional aggregates keyed by their ranges and evaluated criteria, so a SUMIF by region
    // scans once per region rather than once per row.
    var conditionalResultsForWorkbook = Object.create(null);
    // Running sums down one column, extended only as far as a formula asks.
    var prefixSumsForWorkbook = Object.create(null);
    var prefixSeenForWorkbook = Object.create(null);
    // Indexes for exact lookups and plain-equality criteria, keyed by the range they index.
    var lookupIndexesForWorkbook = Object.create(null);
    var lookupSeenForWorkbook = Object.create(null);
    var equalityIndexesForWorkbook = Object.create(null);
    var equalitySeenForWorkbook = Object.create(null);
    // One budget for running sums and indexes, in cells, alongside the range cache's.
    var indexedCellsForWorkbook = 0;

    function cellValue(sheetIndexForCell, rowForCell, columnForCell) {
      var rowsForCell = sheetsForWorkbook[sheetIndexForCell].rows || [];
      var cellForValue = rowsForCell[rowForCell] && rowsForCell[rowForCell][columnForCell];
      if (!cellForValue) return null;
      if (cellForValue.formula == null) return cellForValue.value == null ? null : cellForValue.value;
      var keyForCell = rowForCell + ',' + columnForCell;
      var stateForCell = stateForWorkbook[sheetIndexForCell][keyForCell];
      if (stateForCell === BUSY) throw CIRCULAR_FOR_XLSX_FORMULAS;
      if (stateForCell) {
        if (stateForCell.unknown) throw UNKNOWN_FOR_XLSX_FORMULAS;
        if (stateForCell.circular) throw CIRCULAR_FOR_XLSX_FORMULAS;
        return stateForCell.error ? errForXlsxFormulas(stateForCell.error) : stateForCell.value;
      }
      stateForWorkbook[sheetIndexForCell][keyForCell] = BUSY;
      try {
        var treeForCell = treesForWorkbook[sheetIndexForCell][keyForCell];
        if (!treeForCell) {
          var preparedForCell = prepareForXlsxFormulas(cellForValue.formula);
          if (!preparedForCell.ok || preparedForCell.spilling.length) throw UNKNOWN_FOR_XLSX_FORMULAS;
          treeForCell = preparedForCell.tree;
          treesForWorkbook[sheetIndexForCell][keyForCell] = treeForCell;
        }
        var resultForCell = scalarOf(evaluate(treeForCell, sheetIndexForCell));
        if (typeof resultForCell === 'number' && !isFinite(resultForCell)) resultForCell = errForXlsxFormulas('#NUM!');
        if (resultForCell === null) resultForCell = 0;
        stateForWorkbook[sheetIndexForCell][keyForCell] = isErrForXlsxFormulas(resultForCell) ? { error: resultForCell.error } : { value: resultForCell };
        return resultForCell;
      } catch (thrownForCell) {
        if (thrownForCell === UNKNOWN_FOR_XLSX_FORMULAS || thrownForCell instanceof RangeError) {
          stateForWorkbook[sheetIndexForCell][keyForCell] = { unknown: true };
          throw UNKNOWN_FOR_XLSX_FORMULAS;
        }
        if (thrownForCell === CIRCULAR_FOR_XLSX_FORMULAS) {
          stateForWorkbook[sheetIndexForCell][keyForCell] = { circular: true };
        } else {
          stateForWorkbook[sheetIndexForCell][keyForCell] = { unknown: true };
          throw UNKNOWN_FOR_XLSX_FORMULAS;
        }
        throw thrownForCell;
      }
    }

    function rangeValues(rangeForValues) {
      var keyForValues = rangeForValues.sheet + ':' + rangeForValues.r1 + ':' + rangeForValues.c1 + ':' + rangeForValues.r2 + ':' + rangeForValues.c2;
      var cachedForValues = rangeCacheForWorkbook[keyForValues];
      if (cachedForValues) return cachedForValues;
      var lastRowForValues = Math.min(rangeForValues.r2, Math.max(rangeForValues.r1, usedRowsForWorkbook - 1));
      var lastColumnForValues = Math.min(rangeForValues.c2, Math.max(rangeForValues.c1, usedColumnsForWorkbook - 1));
      var gridForValues = [];
      for (var rowIndex = rangeForValues.r1; rowIndex <= lastRowForValues; rowIndex++) {
        var rowForValues = [];
        for (var columnIndex = rangeForValues.c1; columnIndex <= lastColumnForValues; columnIndex++) {
          rowForValues.push(cellValue(rangeForValues.sheet, rowIndex, columnIndex));
        }
        gridForValues.push(rowForValues);
      }
      if (!rangeSeenForWorkbook[keyForValues]) {
        rangeSeenForWorkbook[keyForValues] = true;
      } else {
        var sizeForValues = gridForValues.length * (gridForValues.length ? gridForValues[0].length : 0);
        if (cachedRangeCellsForWorkbook + sizeForValues <= MAX_CACHED_RANGE_CELLS_FOR_WORKBOOK) {
          rangeCacheForWorkbook[keyForValues] = gridForValues;
          cachedRangeCellsForWorkbook += sizeForValues;
        }
      }
      return gridForValues;
    }
    function rangeKeyOf(rangeForKey) {
      return rangeForKey.sheet + ':' + rangeForKey.r1 + ':' + rangeForKey.c1 + ':' + rangeForKey.r2 + ':' + rangeForKey.c2;
    }
    // The cache key for a call, or '' when the call has no multi-cell range and is cheap anyway.
    function callKeyOf(nodeForKey, sheetIndexForKey) {
      var keyForNode = callKeyByNodeForWorkbook.get(nodeForKey);
      if (keyForNode === undefined) {
        var hasRangeForKey = false;
        var textForKey = JSON.stringify(nodeForKey, function (nameForField, valueForField) {
          if (valueForField && valueForField.t === 'ref' && (valueForField.r1 !== valueForField.r2 || valueForField.c1 !== valueForField.c2)) hasRangeForKey = true;
          return valueForField;
        });
        keyForNode = hasRangeForKey ? textForKey : '';
        callKeyByNodeForWorkbook.set(nodeForKey, keyForNode);
      }
      return keyForNode ? sheetIndexForKey + '|' + keyForNode : '';
    }
    // SUM over rows r1..r2 of one column, from a running sum that starts at r1. Cells are read in
    // order and only up to r2, as the plain sum would read them, so circular references and the
    // first error are found exactly as before.
    // Returns undefined when no running sum is kept for the range: the first time its start is
    // seen (a moving window never comes back), or once the budget is spent. The caller then sums
    // the range directly.
    function columnSum(rangeForSum) {
      var keyForSum = rangeForSum.sheet + ':' + rangeForSum.c1 + ':' + rangeForSum.r1;
      var runForSum = prefixSumsForWorkbook[keyForSum];
      var lastForSum = Math.min(rangeForSum.r2, Math.max(rangeForSum.r1, usedRowsForWorkbook - 1)) - rangeForSum.r1;
      if (!runForSum) {
        if (!prefixSeenForWorkbook[keyForSum]) {
          prefixSeenForWorkbook[keyForSum] = true;
          return undefined;
        }
        runForSum = { totals: [], error: null, errorAt: -1 };
        prefixSumsForWorkbook[keyForSum] = runForSum;
      }
      if (runForSum.totals.length <= lastForSum) {
        if (indexedCellsForWorkbook + (lastForSum + 1 - runForSum.totals.length) > MAX_CACHED_RANGE_CELLS_FOR_WORKBOOK) return undefined;
        indexedCellsForWorkbook += lastForSum + 1 - runForSum.totals.length;
      }
      while (runForSum.totals.length <= lastForSum) {
        var offsetForSum = runForSum.totals.length;
        var cellForSum = cellValue(rangeForSum.sheet, rangeForSum.r1 + offsetForSum, rangeForSum.c1);
        var previousForSum = offsetForSum ? runForSum.totals[offsetForSum - 1] : 0;
        if (isErrForXlsxFormulas(cellForSum) && runForSum.errorAt === -1) {
          runForSum.error = cellForSum;
          runForSum.errorAt = offsetForSum;
        }
        runForSum.totals.push(typeof cellForSum === 'number' ? previousForSum + cellForSum : previousForSum);
      }
      if (runForSum.errorAt !== -1 && runForSum.errorAt <= lastForSum) return runForSum.error;
      return lastForSum < 0 ? 0 : runForSum.totals[lastForSum];
    }
    function flatValues(valueForFlat) {
      if (!isRangeForXlsxFormulas(valueForFlat)) return [valueForFlat];
      var flatForValues = [];
      rangeValues(valueForFlat).forEach(function (rowForFlat) { rowForFlat.forEach(function (cellForFlat) { flatForValues.push(cellForFlat); }); });
      return flatForValues;
    }
    function scalarOf(valueForScalar) {
      if (!isRangeForXlsxFormulas(valueForScalar)) return valueForScalar;
      if (valueForScalar.r1 === valueForScalar.r2 && valueForScalar.c1 === valueForScalar.c2) {
        return cellValue(valueForScalar.sheet, valueForScalar.r1, valueForScalar.c1);
      }
      throw UNKNOWN_FOR_XLSX_FORMULAS;
    }

    function arithmetic(opForArithmetic, leftForArithmetic, rightForArithmetic) {
      var leftNumber = toNumberForXlsxFormulas(leftForArithmetic);
      if (isErrForXlsxFormulas(leftNumber)) return leftNumber;
      var rightNumber = toNumberForXlsxFormulas(rightForArithmetic);
      if (isErrForXlsxFormulas(rightNumber)) return rightNumber;
      if (opForArithmetic === '+') return leftNumber + rightNumber;
      if (opForArithmetic === '-') return leftNumber - rightNumber;
      if (opForArithmetic === '*') return leftNumber * rightNumber;
      if (opForArithmetic === '/') return rightNumber === 0 ? errForXlsxFormulas('#DIV/0!') : leftNumber / rightNumber;
      if (leftNumber === 0 && rightNumber === 0) return errForXlsxFormulas('#NUM!');
      var powerResult = Math.pow(leftNumber, rightNumber);
      return isFinite(powerResult) ? powerResult : errForXlsxFormulas('#NUM!');
    }

    function evaluate(nodeForEval, sheetIndexForEval) {
      switch (nodeForEval.t) {
        case 'num': case 'str': case 'bool': return nodeForEval.value;
        case 'err': return errForXlsxFormulas(nodeForEval.value);
        case 'blank': return null;
        case 'unsupported': throw UNKNOWN_FOR_XLSX_FORMULAS;
        case 'ref': {
          var targetSheet = sheetIndexForEval;
          if (nodeForEval.sheet != null) {
            var foundSheet = sheetIndexByName[String(nodeForEval.sheet).toUpperCase()];
            if (foundSheet === undefined) return errForXlsxFormulas('#REF!');
            targetSheet = foundSheet;
          }
          return { range: true, sheet: targetSheet, r1: nodeForEval.r1, c1: nodeForEval.c1, r2: nodeForEval.r2, c2: nodeForEval.c2, whole: nodeForEval.whole };
        }
        case 'neg': {
          var negated = toNumberForXlsxFormulas(scalarOf(evaluate(nodeForEval.arg, sheetIndexForEval)));
          return isErrForXlsxFormulas(negated) ? negated : -negated;
        }
        case 'pct': {
          var percentValue = toNumberForXlsxFormulas(scalarOf(evaluate(nodeForEval.arg, sheetIndexForEval)));
          return isErrForXlsxFormulas(percentValue) ? percentValue : percentValue / 100;
        }
        case 'bin': {
          var leftValue = scalarOf(evaluate(nodeForEval.left, sheetIndexForEval));
          var rightValue = scalarOf(evaluate(nodeForEval.right, sheetIndexForEval));
          if (isErrForXlsxFormulas(leftValue)) return leftValue;
          if (isErrForXlsxFormulas(rightValue)) return rightValue;
          var opValue = nodeForEval.op;
          if (opValue === '&') return toTextForXlsxFormulas(leftValue) + toTextForXlsxFormulas(rightValue);
          if (opValue === '=' || opValue === '<>' || opValue === '<' || opValue === '>' || opValue === '<=' || opValue === '>=') {
            var order = compareForXlsxFormulas(leftValue, rightValue);
            if (opValue === '=') return order === 0;
            if (opValue === '<>') return order !== 0;
            if (opValue === '<') return order < 0;
            if (opValue === '>') return order > 0;
            if (opValue === '<=') return order <= 0;
            return order >= 0;
          }
          return arithmetic(opValue, leftValue, rightValue);
        }
        case 'func': {
          var implementation = FUNCTIONS[nodeForEval.name];
          if (!implementation) throw UNKNOWN_FOR_XLSX_FORMULAS;
          var callKey = callKeyOf(nodeForEval, sheetIndexForEval);
          if (callKey && callKey in callResultsForWorkbook) return callResultsForWorkbook[callKey];
          var callResult = implementation(nodeForEval.args, sheetIndexForEval);
          if (callKey) callResultsForWorkbook[callKey] = callResult;
          return callResult;
        }
        default:
          throw UNKNOWN_FOR_XLSX_FORMULAS;
      }
    }

    // ---- Function helpers ----
    function argValue(argForValue, sheetIndexForArg) { return evaluate(argForValue, sheetIndexForArg); }
    function argScalar(argForScalar, sheetIndexForArg) { return scalarOf(evaluate(argForScalar, sheetIndexForArg)); }
    function argNumber(argForNumber, sheetIndexForArg, fallbackForNumber) {
      if (!argForNumber || argForNumber.t === 'blank') return fallbackForNumber === undefined ? 0 : fallbackForNumber;
      return toNumberForXlsxFormulas(argScalar(argForNumber, sheetIndexForArg));
    }
    function argText(argForText, sheetIndexForArg) {
      var scalarForText = argScalar(argForText, sheetIndexForArg);
      return isErrForXlsxFormulas(scalarForText) ? scalarForText : toTextForXlsxFormulas(scalarForText);
    }
    function firstError(listForError) {
      for (var iForError = 0; iForError < listForError.length; iForError++) if (isErrForXlsxFormulas(listForError[iForError])) return listForError[iForError];
      return null;
    }
    // Numbers for SUM and friends. In a reference, only numbers count; a value typed straight
    // into the call counts if it reads as a number, and fails otherwise.
    function numbersOf(argsForNumbers, sheetIndexForNumbers) {
      var numbersForArgs = [];
      for (var iForArgs = 0; iForArgs < argsForNumbers.length; iForArgs++) {
        var argForNumbers = argsForNumbers[iForArgs];
        if (argForNumbers.t === 'blank') continue;
        var valueForNumbers = argValue(argForNumbers, sheetIndexForNumbers);
        if (isRangeForXlsxFormulas(valueForNumbers)) {
          var cellsForNumbers = flatValues(valueForNumbers);
          for (var jForCells = 0; jForCells < cellsForNumbers.length; jForCells++) {
            var cellForNumbers = cellsForNumbers[jForCells];
            if (isErrForXlsxFormulas(cellForNumbers)) return cellForNumbers;
            if (typeof cellForNumbers === 'number') numbersForArgs.push(cellForNumbers);
          }
        } else {
          if (isErrForXlsxFormulas(valueForNumbers)) return valueForNumbers;
          var coercedForNumbers = toNumberForXlsxFormulas(valueForNumbers);
          if (isErrForXlsxFormulas(coercedForNumbers)) return coercedForNumbers;
          numbersForArgs.push(coercedForNumbers);
        }
      }
      return numbersForArgs;
    }
    // Loops rather than Math.max.apply, which overflows the stack past about 100,000 values.
    function largestOf(listForLargest) {
      var largestForList = listForLargest[0];
      for (var iForLargest = 1; iForLargest < listForLargest.length; iForLargest++) if (listForLargest[iForLargest] > largestForList) largestForList = listForLargest[iForLargest];
      return largestForList;
    }
    function smallestOf(listForSmallest) {
      var smallestForList = listForSmallest[0];
      for (var iForSmallest = 1; iForSmallest < listForSmallest.length; iForSmallest++) if (listForSmallest[iForSmallest] < smallestForList) smallestForList = listForSmallest[iForSmallest];
      return smallestForList;
    }
    function aggregate(reducerForAggregate) {
      return function (argsForAggregate, sheetIndexForAggregate) {
        var numbersForAggregate = numbersOf(argsForAggregate, sheetIndexForAggregate);
        if (isErrForXlsxFormulas(numbersForAggregate)) return numbersForAggregate;
        return reducerForAggregate(numbersForAggregate);
      };
    }
    var sumAggregate = aggregate(function (n) { var totalForSum = 0; for (var iForSum = 0; iForSum < n.length; iForSum++) totalForSum += n[iForSum]; return totalForSum; });
    function roundTo(numberForRound, digitsForRound, modeForRound) {
      var factorForRound = Math.pow(10, digitsForRound);
      var scaledForRound = Math.abs(numberForRound) * factorForRound;
      // Nudge past binary error so 2.675 rounds to 2.68 as Excel's does.
      var nudgedForRound = Number(scaledForRound.toPrecision(15));
      var roundedForRound = modeForRound === 'up' ? Math.ceil(nudgedForRound) : (modeForRound === 'down' ? Math.floor(nudgedForRound) : Math.round(nudgedForRound));
      return Math.sign(numberForRound) * roundedForRound / factorForRound;
    }
    function roundFunction(modeForFunction) {
      return function (argsForRound, sheetIndexForRound) {
        var numberForRoundArg = argNumber(argsForRound[0], sheetIndexForRound);
        var digitsForRoundArg = argNumber(argsForRound[1], sheetIndexForRound, 0);
        var problemForRound = firstError([numberForRoundArg, digitsForRoundArg]);
        if (problemForRound) return problemForRound;
        return roundTo(numberForRoundArg, Math.trunc(digitsForRoundArg), modeForFunction);
      };
    }
    function shapeOf(rangeForShape) {
      var gridForShape = rangeValues(rangeForShape);
      return { grid: gridForShape, rows: gridForShape.length, columns: gridForShape.length ? gridForShape[0].length : 0 };
    }
    // Pairs of (range, criterion) for the *IFS functions; all ranges must have one shape.
    function conditionalMask(pairsForMask, sheetIndexForMask) {
      var maskForPairs = null;
      var shapeForPairs = null;
      for (var iForPair = 0; iForPair < pairsForMask.length; iForPair += 2) {
        var rangeForPair = argValue(pairsForMask[iForPair], sheetIndexForMask);
        if (isErrForXlsxFormulas(rangeForPair)) return rangeForPair;
        if (!isRangeForXlsxFormulas(rangeForPair)) return errForXlsxFormulas('#VALUE!');
        var testForPair = criterionForXlsxFormulas(argScalar(pairsForMask[iForPair + 1], sheetIndexForMask));
        if (isErrForXlsxFormulas(testForPair)) return testForPair;
        var cellsForPair = shapeOf(rangeForPair);
        if (shapeForPairs && (shapeForPairs.rows !== cellsForPair.rows || shapeForPairs.columns !== cellsForPair.columns)) return errForXlsxFormulas('#VALUE!');
        shapeForPairs = cellsForPair;
        var flatForPair = [];
        cellsForPair.grid.forEach(function (rowForPair) { rowForPair.forEach(function (cellForPair) { flatForPair.push(cellForPair); }); });
        if (!maskForPairs) maskForPairs = flatForPair.map(function () { return true; });
        for (var jForPair = 0; jForPair < flatForPair.length; jForPair++) {
          if (maskForPairs[jForPair] && !testForPair(flatForPair[jForPair])) maskForPairs[jForPair] = false;
        }
      }
      return { mask: maskForPairs || [], shape: shapeForPairs };
    }
    function flatOfShape(rangeArgForFlat, sheetIndexForFlat, shapeForFlat) {
      var valueForFlat = argValue(rangeArgForFlat, sheetIndexForFlat);
      if (isErrForXlsxFormulas(valueForFlat)) return valueForFlat;
      if (!isRangeForXlsxFormulas(valueForFlat)) return errForXlsxFormulas('#VALUE!');
      var cellsForFlat = shapeOf(valueForFlat);
      if (shapeForFlat && (cellsForFlat.rows !== shapeForFlat.rows || cellsForFlat.columns !== shapeForFlat.columns)) return errForXlsxFormulas('#VALUE!');
      var listForFlat = [];
      cellsForFlat.grid.forEach(function (rowForFlat) { rowForFlat.forEach(function (cellForFlat) { listForFlat.push(cellForFlat); }); });
      return listForFlat;
    }
    function conditionalAggregate(kindForConditional, hasValueRangeFirst, singlePair) {
      return function (argsForConditional, sheetIndexForConditional) {
        var valueArgForConditional;
        var pairArgsForConditional;
        if (singlePair) {
          pairArgsForConditional = [argsForConditional[0], argsForConditional[1]];
          valueArgForConditional = argsForConditional[2] && argsForConditional[2].t !== 'blank' ? argsForConditional[2] : argsForConditional[0];
        } else if (hasValueRangeFirst) {
          valueArgForConditional = argsForConditional[0];
          pairArgsForConditional = argsForConditional.slice(1);
        } else {
          valueArgForConditional = null;
          pairArgsForConditional = argsForConditional;
        }
        if (!pairArgsForConditional.length || pairArgsForConditional.length % 2 !== 0) return errForXlsxFormulas('#VALUE!');
        var memoKeyForConditional = conditionalKey(kindForConditional, valueArgForConditional, pairArgsForConditional, sheetIndexForConditional);
        if (memoKeyForConditional && memoKeyForConditional in conditionalResultsForWorkbook) return conditionalResultsForWorkbook[memoKeyForConditional];
        var resultForConditional = conditionalResult(kindForConditional, valueArgForConditional, pairArgsForConditional, sheetIndexForConditional);
        if (memoKeyForConditional) conditionalResultsForWorkbook[memoKeyForConditional] = resultForConditional;
        return resultForConditional;
      };
    }
    // The ranges and evaluated criteria of a conditional aggregate, or '' when an argument is not
    // a plain range or value (an error, say), which then takes the uncached path.
    function conditionalKey(kindForKey, valueArgForKey, pairArgsForKey, sheetIndexForKey) {
      var partsForKey = [kindForKey];
      if (valueArgForKey) {
        var valueRangeForKey = argValue(valueArgForKey, sheetIndexForKey);
        if (!isRangeForXlsxFormulas(valueRangeForKey)) return '';
        partsForKey.push(rangeKeyOf(valueRangeForKey));
      }
      for (var iForKey = 0; iForKey < pairArgsForKey.length; iForKey += 2) {
        var rangeForKey = argValue(pairArgsForKey[iForKey], sheetIndexForKey);
        if (!isRangeForXlsxFormulas(rangeForKey)) return '';
        var criterionForKey = argScalar(pairArgsForKey[iForKey + 1], sheetIndexForKey);
        if (criterionForKey !== null && typeof criterionForKey === 'object') return '';
        partsForKey.push(rangeKeyOf(rangeForKey), typeof criterionForKey + ':' + String(criterionForKey));
      }
      return partsForKey.join('|');
    }
    function conditionalResult(kindForConditional, valueArgForConditional, pairArgsForConditional, sheetIndexForConditional) {
      var indexedForConditional = indexedConditionalResult(kindForConditional, valueArgForConditional, pairArgsForConditional, sheetIndexForConditional);
      if (indexedForConditional !== undefined) return indexedForConditional;
      var maskedForConditional = conditionalMask(pairArgsForConditional, sheetIndexForConditional);
      if (isErrForXlsxFormulas(maskedForConditional)) return maskedForConditional;
      if (kindForConditional === 'count') {
        return maskedForConditional.mask.filter(Boolean).length;
      }
      var valuesForConditional = flatOfShape(valueArgForConditional, sheetIndexForConditional, maskedForConditional.shape);
      if (isErrForXlsxFormulas(valuesForConditional)) return valuesForConditional;
      var pickedForConditional = [];
      for (var iForPicked = 0; iForPicked < valuesForConditional.length; iForPicked++) {
        if (!maskedForConditional.mask[iForPicked]) continue;
        var valueForPicked = valuesForConditional[iForPicked];
        if (isErrForXlsxFormulas(valueForPicked)) return valueForPicked;
        if (typeof valueForPicked === 'number') pickedForConditional.push(valueForPicked);
      }
      if (kindForConditional === 'sum') return pickedForConditional.reduce(function (a, b) { return a + b; }, 0);
      if (kindForConditional === 'average') return pickedForConditional.length ? pickedForConditional.reduce(function (a, b) { return a + b; }, 0) / pickedForConditional.length : errForXlsxFormulas('#DIV/0!');
      if (kindForConditional === 'max') return pickedForConditional.length ? largestOf(pickedForConditional) : 0;
      return pickedForConditional.length ? smallestOf(pickedForConditional) : 0;
    }
    function finishConditional(kindForFinish, pickedForFinish) {
      if (kindForFinish === 'sum') { var totalForFinish = 0; for (var iForFinish = 0; iForFinish < pickedForFinish.length; iForFinish++) totalForFinish += pickedForFinish[iForFinish]; return totalForFinish; }
      if (kindForFinish === 'average') {
        if (!pickedForFinish.length) return errForXlsxFormulas('#DIV/0!');
        return finishConditional('sum', pickedForFinish) / pickedForFinish.length;
      }
      if (kindForFinish === 'max') return pickedForFinish.length ? largestOf(pickedForFinish) : 0;
      return pickedForFinish.length ? smallestOf(pickedForFinish) : 0;
    }
    // Plain-equality criteria (a value or "=value", no wildcard) are answered from an index of
    // the criteria range, so COUNTIF($A$2:$A$9000,A2) on every row reads only the matching cells
    // instead of the whole column. Each candidate is still checked with the criterion's own test,
    // so the index can only narrow the search. Returns undefined to take the scanning path: no
    // pair has a plain-equality criterion, or the range has not been asked for before.
    function indexedConditionalResult(kindForIndexed, valueArgForIndexed, pairArgsForIndexed, sheetIndexForIndexed) {
      var pairsForIndexed = [];
      var rowsForIndexed = -1;
      var columnsForIndexed = -1;
      var chosenForIndexed = -1;
      for (var iForPair = 0; iForPair < pairArgsForIndexed.length; iForPair += 2) {
        var rangeForPair = argValue(pairArgsForIndexed[iForPair], sheetIndexForIndexed);
        if (isErrForXlsxFormulas(rangeForPair)) return rangeForPair;
        if (!isRangeForXlsxFormulas(rangeForPair)) return errForXlsxFormulas('#VALUE!');
        var criterionValueForPair = argScalar(pairArgsForIndexed[iForPair + 1], sheetIndexForIndexed);
        var testForPair = criterionForXlsxFormulas(criterionValueForPair);
        if (isErrForXlsxFormulas(testForPair)) return testForPair;
        var gridForPair = rangeValues(rangeForPair);
        var columnsForPair = gridForPair.length ? gridForPair[0].length : 0;
        if (rowsForIndexed !== -1 && (rowsForIndexed !== gridForPair.length || columnsForIndexed !== columnsForPair)) return errForXlsxFormulas('#VALUE!');
        rowsForIndexed = gridForPair.length;
        columnsForIndexed = columnsForPair;
        var queryForPair = equalityQueryKey(criterionValueForPair);
        pairsForIndexed.push({ range: rangeForPair, grid: gridForPair, test: testForPair, query: queryForPair });
        if (chosenForIndexed === -1 && queryForPair) chosenForIndexed = pairsForIndexed.length - 1;
      }
      if (chosenForIndexed === -1) return undefined;
      var indexForIndexed = equalityIndex(pairsForIndexed[chosenForIndexed].range, pairsForIndexed[chosenForIndexed].grid);
      if (!indexForIndexed) return undefined;
      var candidatesForIndexed = indexForIndexed.get(pairsForIndexed[chosenForIndexed].query) || [];
      var matchedForIndexed = [];
      for (var iForCandidate = 0; iForCandidate < candidatesForIndexed.length; iForCandidate++) {
        var positionForCandidate = candidatesForIndexed[iForCandidate];
        var rowForCandidate = Math.floor(positionForCandidate / columnsForIndexed);
        var columnForCandidate = positionForCandidate % columnsForIndexed;
        var passesForCandidate = true;
        for (var jForPair = 0; jForPair < pairsForIndexed.length && passesForCandidate; jForPair++) {
          if (!pairsForIndexed[jForPair].test(pairsForIndexed[jForPair].grid[rowForCandidate][columnForCandidate])) passesForCandidate = false;
        }
        if (passesForCandidate) matchedForIndexed.push(positionForCandidate);
      }
      if (kindForIndexed === 'count') return matchedForIndexed.length;
      var valueRangeForIndexed = argValue(valueArgForIndexed, sheetIndexForIndexed);
      if (isErrForXlsxFormulas(valueRangeForIndexed)) return valueRangeForIndexed;
      if (!isRangeForXlsxFormulas(valueRangeForIndexed)) return errForXlsxFormulas('#VALUE!');
      var valueGridForIndexed = rangeValues(valueRangeForIndexed);
      if (valueGridForIndexed.length !== rowsForIndexed || (valueGridForIndexed.length ? valueGridForIndexed[0].length : 0) !== columnsForIndexed) return errForXlsxFormulas('#VALUE!');
      var pickedForIndexed = [];
      for (var iForMatched = 0; iForMatched < matchedForIndexed.length; iForMatched++) {
        var positionForMatched = matchedForIndexed[iForMatched];
        var valueForMatched = valueGridForIndexed[Math.floor(positionForMatched / columnsForIndexed)][positionForMatched % columnsForIndexed];
        if (isErrForXlsxFormulas(valueForMatched)) return valueForMatched;
        if (typeof valueForMatched === 'number') pickedForIndexed.push(valueForMatched);
      }
      return finishConditional(kindForIndexed, pickedForIndexed);
    }
    // The bucket a plain-equality criterion reads, or '' when the criterion is not one. Mirrors
    // the order criterionForXlsxFormulas tests in: number, then boolean, then text.
    function equalityQueryKey(criterionForQuery) {
      if (typeof criterionForQuery === 'number') return 'n:' + String(criterionForQuery);
      if (typeof criterionForQuery === 'boolean') return 'b:' + criterionForQuery;
      if (typeof criterionForQuery !== 'string') return '';
      var matchForQuery = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(criterionForQuery);
      if (matchForQuery[1] && matchForQuery[1] !== '=') return '';
      var operandForQuery = matchForQuery[2];
      if (operandForQuery === '') return '';
      if (operandForQuery.trim() !== '' && isFinite(Number(operandForQuery))) return 'n:' + String(Number(operandForQuery));
      var upperForQuery = operandForQuery.toUpperCase();
      if (upperForQuery === 'TRUE' || upperForQuery === 'FALSE') return 'b:' + (upperForQuery === 'TRUE');
      if (/[*?~]/.test(operandForQuery)) return '';
      return 's:' + upperForQuery;
    }
    // Every bucket a cell can match. Text is grouped by toUpperCase, which is never finer than
    // the case-insensitive regular expression the criterion uses; a text cell that reads as a
    // number is also in that number's bucket, as the number criterion accepts it.
    function equalityIndex(rangeForIndex, gridForIndex) {
      var keyForIndex = rangeKeyOf(rangeForIndex);
      var builtForIndex = equalityIndexesForWorkbook[keyForIndex];
      if (builtForIndex) return builtForIndex;
      if (!equalitySeenForWorkbook[keyForIndex]) {
        equalitySeenForWorkbook[keyForIndex] = true;
        return null;
      }
      var columnsForIndex = gridForIndex.length ? gridForIndex[0].length : 0;
      var sizeForIndex = gridForIndex.length * columnsForIndex;
      if (indexedCellsForWorkbook + sizeForIndex > MAX_CACHED_RANGE_CELLS_FOR_WORKBOOK) return null;
      indexedCellsForWorkbook += sizeForIndex;
      builtForIndex = new Map();
      function addForIndex(bucketForIndex, positionForIndex) {
        var listForBucket = builtForIndex.get(bucketForIndex);
        if (listForBucket) listForBucket.push(positionForIndex); else builtForIndex.set(bucketForIndex, [positionForIndex]);
      }
      for (var rowForIndex = 0; rowForIndex < gridForIndex.length; rowForIndex++) {
        for (var columnForIndex = 0; columnForIndex < columnsForIndex; columnForIndex++) {
          var cellForIndex = gridForIndex[rowForIndex][columnForIndex];
          var positionForCell = rowForIndex * columnsForIndex + columnForIndex;
          if (typeof cellForIndex === 'number') addForIndex('n:' + String(cellForIndex), positionForCell);
          else if (typeof cellForIndex === 'boolean') addForIndex('b:' + cellForIndex, positionForCell);
          else if (typeof cellForIndex === 'string') {
            addForIndex('s:' + cellForIndex.toUpperCase(), positionForCell);
            if (cellForIndex.trim() !== '') {
              var numberForCell = Number(cellForIndex);
              if (numberForCell === numberForCell) addForIndex('n:' + String(numberForCell), positionForCell);
            }
          }
        }
      }
      equalityIndexesForWorkbook[keyForIndex] = builtForIndex;
      return builtForIndex;
    }
    // The bucket lookupEqual would match a value in: text compares by toLowerCase there, and
    // numbers and booleans by value. '' for anything that cannot match by plain equality.
    function lookupKeyOf(valueForKey) {
      if (typeof valueForKey === 'number') return 'n:' + String(valueForKey);
      if (typeof valueForKey === 'boolean') return 'b:' + valueForKey;
      if (typeof valueForKey === 'string') return 's:' + valueForKey.toLowerCase();
      return '';
    }
    // First exact position of wanted in the list listFn builds, from an index of the list once the
    // same list is looked into a second time. Wildcards and blanks take the scanning path.
    function exactPosition(listKeyForExact, listFnForExact, wantedForExact) {
      var wantedKeyForExact = lookupKeyOf(wantedForExact);
      if (!wantedKeyForExact || (typeof wantedForExact === 'string' && /[*?~]/.test(wantedForExact))) return matchPosition(listFnForExact(), wantedForExact, 0);
      var indexForExact = lookupIndexesForWorkbook[listKeyForExact];
      if (!indexForExact) {
        var listForExact = listFnForExact();
        if (!lookupSeenForWorkbook[listKeyForExact] || indexedCellsForWorkbook + listForExact.length > MAX_CACHED_RANGE_CELLS_FOR_WORKBOOK) {
          lookupSeenForWorkbook[listKeyForExact] = true;
          return matchPosition(listForExact, wantedForExact, 0);
        }
        indexedCellsForWorkbook += listForExact.length;
        indexForExact = new Map();
        for (var iForExact = 0; iForExact < listForExact.length; iForExact++) {
          var keyForItem = lookupKeyOf(listForExact[iForExact]);
          if (keyForItem && !indexForExact.has(keyForItem)) indexForExact.set(keyForItem, iForExact);
        }
        lookupIndexesForWorkbook[listKeyForExact] = indexForExact;
      }
      var foundForExact = indexForExact.get(wantedKeyForExact);
      return foundForExact === undefined ? -1 : foundForExact;
    }
    function lookupEqual(cellForLookup, wantedForLookup) {
      if (typeof wantedForLookup === 'string' && /[*?~]/.test(wantedForLookup)) {
        return typeof cellForLookup === 'string' && wildcardRegexForXlsxFormulas(wantedForLookup).test(cellForLookup);
      }
      if (cellForLookup === null) return false;
      if (typeof cellForLookup !== typeof wantedForLookup) return false;
      return compareForXlsxFormulas(cellForLookup, wantedForLookup) === 0;
    }
    // Position (0-based) in a 1-D list, or -1. type 0 is exact; 1 is the largest value not above
    // the wanted one, in ascending data; -1 the smallest not below it, in descending data.
    function matchPosition(listForMatch, wantedForMatch, typeForMatch) {
      if (typeForMatch === 0) {
        for (var iForExact = 0; iForExact < listForMatch.length; iForExact++) if (lookupEqual(listForMatch[iForExact], wantedForMatch)) return iForExact;
        return -1;
      }
      var foundForMatch = -1;
      for (var iForApprox = 0; iForApprox < listForMatch.length; iForApprox++) {
        var cellForApprox = listForMatch[iForApprox];
        if (cellForApprox === null || typeof cellForApprox !== typeof wantedForMatch) continue;
        var orderForApprox = compareForXlsxFormulas(cellForApprox, wantedForMatch);
        if (typeForMatch > 0) {
          if (orderForApprox <= 0) foundForMatch = iForApprox; else break;
        } else {
          if (orderForApprox >= 0) foundForMatch = iForApprox; else break;
        }
      }
      return foundForMatch;
    }
    // Whether oneDimensional would give a list for this grid, without building the list.
    function isLineGrid(gridForLine) {
      return gridForLine.length <= 1 || gridForLine[0].length === 1;
    }
    function oneDimensional(rangeForOne) {
      var gridForOne = rangeValues(rangeForOne);
      if (gridForOne.length === 1) return gridForOne[0];
      if (gridForOne.every(function (rowForOne) { return rowForOne.length === 1; })) return gridForOne.map(function (rowForOne) { return rowForOne[0]; });
      return null;
    }
    function textFunction(transformForText) {
      return function (argsForText, sheetIndexForText) {
        var textForFunction = argText(argsForText[0], sheetIndexForText);
        return isErrForXlsxFormulas(textForFunction) ? textForFunction : transformForText(textForFunction);
      };
    }
    function mathFunction(transformForMath) {
      return function (argsForMath, sheetIndexForMath) {
        var numberForMath = argNumber(argsForMath[0], sheetIndexForMath);
        if (isErrForXlsxFormulas(numberForMath)) return numberForMath;
        var resultForMath = transformForMath(numberForMath);
        return typeof resultForMath === 'number' && !isFinite(resultForMath) ? errForXlsxFormulas('#NUM!') : resultForMath;
      };
    }
    function isFunction(testForIs) {
      return function (argsForIs, sheetIndexForIs) {
        var valueForIs = argValue(argsForIs[0], sheetIndexForIs);
        if (isRangeForXlsxFormulas(valueForIs)) valueForIs = scalarOf(valueForIs);
        return testForIs(valueForIs);
      };
    }
    function variance(numbersForVariance, sampleForVariance) {
      var countForVariance = numbersForVariance.length;
      if (countForVariance < (sampleForVariance ? 2 : 1)) return errForXlsxFormulas('#DIV/0!');
      var meanForVariance = numbersForVariance.reduce(function (a, b) { return a + b; }, 0) / countForVariance;
      var squaresForVariance = numbersForVariance.reduce(function (a, b) { return a + (b - meanForVariance) * (b - meanForVariance); }, 0);
      return squaresForVariance / (sampleForVariance ? countForVariance - 1 : countForVariance);
    }
    function kth(largestForKth) {
      return function (argsForKth, sheetIndexForKth) {
        var numbersForKth = numbersOf([argsForKth[0]], sheetIndexForKth);
        if (isErrForXlsxFormulas(numbersForKth)) return numbersForKth;
        var kForKth = argNumber(argsForKth[1], sheetIndexForKth);
        if (isErrForXlsxFormulas(kForKth)) return kForKth;
        kForKth = Math.ceil(kForKth);
        if (kForKth < 1 || kForKth > numbersForKth.length) return errForXlsxFormulas('#NUM!');
        var sortedForKth = numbersForKth.slice().sort(function (a, b) { return largestForKth ? b - a : a - b; });
        return sortedForKth[kForKth - 1];
      };
    }

    var FUNCTIONS = {
      SUM: function (args, s) {
        // A single one-column range, as in a running total, reads from the column's running sum.
        if (args.length === 1 && args[0].t === 'ref') {
          var rangeForSum = argValue(args[0], s);
          if (isRangeForXlsxFormulas(rangeForSum) && rangeForSum.c1 === rangeForSum.c2) {
            var runningForSum = columnSum(rangeForSum);
            if (runningForSum !== undefined) return runningForSum;
          }
        }
        return sumAggregate(args, s);
      },
      PRODUCT: aggregate(function (n) { return n.length ? n.reduce(function (a, b) { return a * b; }, 1) : 0; }),
      AVERAGE: aggregate(function (n) { return n.length ? n.reduce(function (a, b) { return a + b; }, 0) / n.length : errForXlsxFormulas('#DIV/0!'); }),
      MIN: aggregate(function (n) { return n.length ? smallestOf(n) : 0; }),
      MAX: aggregate(function (n) { return n.length ? largestOf(n) : 0; }),
      MEDIAN: aggregate(function (n) {
        if (!n.length) return errForXlsxFormulas('#NUM!');
        var sortedForMedian = n.slice().sort(function (a, b) { return a - b; });
        var middleForMedian = Math.floor(sortedForMedian.length / 2);
        return sortedForMedian.length % 2 ? sortedForMedian[middleForMedian] : (sortedForMedian[middleForMedian - 1] + sortedForMedian[middleForMedian]) / 2;
      }),
      STDEV: aggregate(function (n) { var v = variance(n, true); return isErrForXlsxFormulas(v) ? v : Math.sqrt(v); }),
      'STDEV.S': aggregate(function (n) { var v = variance(n, true); return isErrForXlsxFormulas(v) ? v : Math.sqrt(v); }),
      'STDEV.P': aggregate(function (n) { var v = variance(n, false); return isErrForXlsxFormulas(v) ? v : Math.sqrt(v); }),
      VAR: aggregate(function (n) { return variance(n, true); }),
      'VAR.S': aggregate(function (n) { return variance(n, true); }),
      'VAR.P': aggregate(function (n) { return variance(n, false); }),
      LARGE: kth(true),
      SMALL: kth(false),
      COUNT: function (args, s) {
        var countForCount = 0;
        args.forEach(function (arg) {
          if (arg.t === 'blank') return;
          var value = argValue(arg, s);
          if (isRangeForXlsxFormulas(value)) flatValues(value).forEach(function (cell) { if (typeof cell === 'number') countForCount++; });
          else if (typeof value === 'number' || typeof value === 'boolean' || (typeof value === 'string' && !isErrForXlsxFormulas(toNumberForXlsxFormulas(value)))) countForCount++;
        });
        return countForCount;
      },
      COUNTA: function (args, s) {
        var countForCountA = 0;
        args.forEach(function (arg) {
          if (arg.t === 'blank') return;
          var value = argValue(arg, s);
          if (isRangeForXlsxFormulas(value)) flatValues(value).forEach(function (cell) { if (cell !== null) countForCountA++; });
          else countForCountA++;
        });
        return countForCountA;
      },
      COUNTBLANK: function (args, s) {
        var value = argValue(args[0], s);
        if (!isRangeForXlsxFormulas(value)) return errForXlsxFormulas('#VALUE!');
        return flatValues(value).filter(function (cell) { return cell === null || cell === ''; }).length;
      },
      SUMIF: conditionalAggregate('sum', false, true),
      AVERAGEIF: conditionalAggregate('average', false, true),
      COUNTIF: function (args, s) { return conditionalAggregate('count', false, false)([args[0], args[1]], s); },
      SUMIFS: conditionalAggregate('sum', true, false),
      AVERAGEIFS: conditionalAggregate('average', true, false),
      MAXIFS: conditionalAggregate('max', true, false),
      MINIFS: conditionalAggregate('min', true, false),
      COUNTIFS: conditionalAggregate('count', false, false),
      SUMPRODUCT: function (args, s) {
        var listsForProduct = [];
        var shapeForProduct = null;
        for (var i = 0; i < args.length; i++) {
          var value = argValue(args[i], s);
          if (isErrForXlsxFormulas(value)) return value;
          if (!isRangeForXlsxFormulas(value)) throw UNKNOWN_FOR_XLSX_FORMULAS;
          var flat = flatOfShape(args[i], s, shapeForProduct);
          if (isErrForXlsxFormulas(flat)) return flat;
          if (!shapeForProduct) shapeForProduct = shapeOf(value);
          listsForProduct.push(flat);
        }
        if (!listsForProduct.length) return errForXlsxFormulas('#VALUE!');
        var total = 0;
        for (var j = 0; j < listsForProduct[0].length; j++) {
          var productForRow = 1;
          for (var k = 0; k < listsForProduct.length; k++) {
            var cell = listsForProduct[k][j];
            if (isErrForXlsxFormulas(cell)) return cell;
            productForRow *= typeof cell === 'number' ? cell : 0;
          }
          total += productForRow;
        }
        return total;
      },
      ROUND: roundFunction('nearest'),
      ROUNDUP: roundFunction('up'),
      ROUNDDOWN: roundFunction('down'),
      TRUNC: function (args, s) {
        var number = argNumber(args[0], s);
        var digits = argNumber(args[1], s, 0);
        var problem = firstError([number, digits]);
        return problem || roundTo(number, Math.trunc(digits), 'down');
      },
      INT: mathFunction(Math.floor),
      ABS: mathFunction(Math.abs),
      SIGN: mathFunction(Math.sign),
      SQRT: mathFunction(function (n) { return n < 0 ? errForXlsxFormulas('#NUM!') : Math.sqrt(n); }),
      EXP: mathFunction(Math.exp),
      LN: mathFunction(function (n) { return n <= 0 ? errForXlsxFormulas('#NUM!') : Math.log(n); }),
      LOG10: mathFunction(function (n) { return n <= 0 ? errForXlsxFormulas('#NUM!') : Math.log10(n); }),
      LOG: function (args, s) {
        var number = argNumber(args[0], s);
        var base = argNumber(args[1], s, 10);
        var problem = firstError([number, base]);
        if (problem) return problem;
        if (number <= 0 || base <= 0 || base === 1) return errForXlsxFormulas(base === 1 ? '#DIV/0!' : '#NUM!');
        return Math.log(number) / Math.log(base);
      },
      PI: function () { return Math.PI; },
      POWER: function (args, s) { return arithmetic('^', argScalar(args[0], s), argScalar(args[1], s)); },
      MOD: function (args, s) {
        var number = argNumber(args[0], s);
        var divisor = argNumber(args[1], s);
        var problem = firstError([number, divisor]);
        if (problem) return problem;
        if (divisor === 0) return errForXlsxFormulas('#DIV/0!');
        return number - divisor * Math.floor(number / divisor);
      },
      IF: function (args, s) {
        var condition = toBooleanForXlsxFormulas(argScalar(args[0], s));
        if (isErrForXlsxFormulas(condition)) return condition;
        if (condition) return args[1] && args[1].t !== 'blank' ? argScalar(args[1], s) : (args[1] ? 0 : true);
        if (args.length < 3) return false;
        return args[2].t === 'blank' ? 0 : argScalar(args[2], s);
      },
      IFS: function (args, s) {
        for (var i = 0; i + 1 < args.length; i += 2) {
          var condition = toBooleanForXlsxFormulas(argScalar(args[i], s));
          if (isErrForXlsxFormulas(condition)) return condition;
          if (condition) return argScalar(args[i + 1], s);
        }
        return errForXlsxFormulas('#N/A');
      },
      SWITCH: function (args, s) {
        var subject = argScalar(args[0], s);
        if (isErrForXlsxFormulas(subject)) return subject;
        var i = 1;
        for (; i + 1 < args.length; i += 2) {
          var candidate = argScalar(args[i], s);
          if (isErrForXlsxFormulas(candidate)) return candidate;
          if (compareForXlsxFormulas(subject, candidate) === 0 && typeof subject === typeof candidate) return argScalar(args[i + 1], s);
        }
        return i < args.length ? argScalar(args[i], s) : errForXlsxFormulas('#N/A');
      },
      CHOOSE: function (args, s) {
        var index = argNumber(args[0], s);
        if (isErrForXlsxFormulas(index)) return index;
        index = Math.floor(index);
        if (index < 1 || index >= args.length) return errForXlsxFormulas('#VALUE!');
        return argValue(args[index], s);
      },
      IFERROR: function (args, s) {
        var value = argScalar(args[0], s);
        return isErrForXlsxFormulas(value) ? argScalar(args[1], s) : value;
      },
      IFNA: function (args, s) {
        var value = argScalar(args[0], s);
        return isErrForXlsxFormulas(value) && value.error === '#N/A' ? argScalar(args[1], s) : value;
      },
      AND: function (args, s) {
        var result = true;
        for (var i = 0; i < args.length; i++) {
          var raw = argValue(args[i], s);
          var fromReference = isRangeForXlsxFormulas(raw);
          var values = flatValues(raw);
          for (var j = 0; j < values.length; j++) {
            // Empty cells and text inside a reference are skipped; text typed into the call is an error.
            if (values[j] === null || (fromReference && typeof values[j] === 'string')) continue;
            var flag = toBooleanForXlsxFormulas(values[j]);
            if (isErrForXlsxFormulas(flag)) return flag;
            if (!flag) result = false;
          }
        }
        return result;
      },
      OR: function (args, s) {
        var result = false;
        for (var i = 0; i < args.length; i++) {
          var raw = argValue(args[i], s);
          var fromReference = isRangeForXlsxFormulas(raw);
          var values = flatValues(raw);
          for (var j = 0; j < values.length; j++) {
            // Empty cells and text inside a reference are skipped; text typed into the call is an error.
            if (values[j] === null || (fromReference && typeof values[j] === 'string')) continue;
            var flag = toBooleanForXlsxFormulas(values[j]);
            if (isErrForXlsxFormulas(flag)) return flag;
            if (flag) result = true;
          }
        }
        return result;
      },
      NOT: function (args, s) {
        var flag = toBooleanForXlsxFormulas(argScalar(args[0], s));
        return isErrForXlsxFormulas(flag) ? flag : !flag;
      },
      ISBLANK: isFunction(function (v) { return v === null; }),
      ISNUMBER: isFunction(function (v) { return typeof v === 'number'; }),
      ISTEXT: isFunction(function (v) { return typeof v === 'string'; }),
      ISLOGICAL: isFunction(function (v) { return typeof v === 'boolean'; }),
      ISERROR: isFunction(function (v) { return isErrForXlsxFormulas(v); }),
      ISNA: isFunction(function (v) { return isErrForXlsxFormulas(v) && v.error === '#N/A'; }),
      LEN: textFunction(function (t) { return Array.from(t).length; }),
      UPPER: textFunction(function (t) { return t.toUpperCase(); }),
      LOWER: textFunction(function (t) { return t.toLowerCase(); }),
      // Capitals after any character that is not a letter, as Excel does ("o'neil" becomes "O'Neil").
      PROPER: textFunction(function (t) { return t.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, function (m, p, c) { return p + c.toUpperCase(); }); }),
      TRIM: textFunction(function (t) { return t.replace(/ +/g, ' ').replace(/^ | $/g, ''); }),
      LEFT: function (args, s) {
        var text = argText(args[0], s);
        var count = argNumber(args[1], s, 1);
        var problem = firstError([text, count]);
        if (problem) return problem;
        return count < 0 ? errForXlsxFormulas('#VALUE!') : Array.from(text).slice(0, Math.floor(count)).join('');
      },
      RIGHT: function (args, s) {
        var text = argText(args[0], s);
        var count = argNumber(args[1], s, 1);
        var problem = firstError([text, count]);
        if (problem) return problem;
        if (count < 0) return errForXlsxFormulas('#VALUE!');
        var chars = Array.from(text);
        return Math.floor(count) === 0 ? '' : chars.slice(-Math.floor(count)).join('');
      },
      MID: function (args, s) {
        var text = argText(args[0], s);
        var start = argNumber(args[1], s);
        var count = argNumber(args[2], s);
        var problem = firstError([text, start, count]);
        if (problem) return problem;
        if (start < 1 || count < 0) return errForXlsxFormulas('#VALUE!');
        return Array.from(text).slice(Math.floor(start) - 1, Math.floor(start) - 1 + Math.floor(count)).join('');
      },
      REPT: function (args, s) {
        var text = argText(args[0], s);
        var times = argNumber(args[1], s);
        var problem = firstError([text, times]);
        if (problem) return problem;
        if (times < 0 || text.length * times > 32767) return errForXlsxFormulas('#VALUE!');
        return text.repeat(Math.floor(times));
      },
      SUBSTITUTE: function (args, s) {
        var text = argText(args[0], s);
        var oldText = argText(args[1], s);
        var newText = argText(args[2], s);
        var problem = firstError([text, oldText, newText]);
        if (problem) return problem;
        if (oldText === '') return text;
        if (args[3] && args[3].t !== 'blank') {
          var instance = argNumber(args[3], s);
          if (isErrForXlsxFormulas(instance)) return instance;
          if (instance < 1) return errForXlsxFormulas('#VALUE!');
          var position = -1;
          for (var n = 0; n < Math.floor(instance); n++) {
            position = text.indexOf(oldText, position + 1);
            if (position === -1) return text;
          }
          return text.slice(0, position) + newText + text.slice(position + oldText.length);
        }
        return text.split(oldText).join(newText);
      },
      FIND: function (args, s) {
        var wanted = argText(args[0], s);
        var within = argText(args[1], s);
        var start = argNumber(args[2], s, 1);
        var problem = firstError([wanted, within, start]);
        if (problem) return problem;
        var found = within.indexOf(wanted, Math.floor(start) - 1);
        return found === -1 || start < 1 ? errForXlsxFormulas('#VALUE!') : found + 1;
      },
      SEARCH: function (args, s) {
        var wanted = argText(args[0], s);
        var within = argText(args[1], s);
        var start = argNumber(args[2], s, 1);
        var problem = firstError([wanted, within, start]);
        if (problem) return problem;
        if (/[*?~]/.test(wanted)) throw UNKNOWN_FOR_XLSX_FORMULAS;
        var found = within.toLowerCase().indexOf(wanted.toLowerCase(), Math.floor(start) - 1);
        return found === -1 || start < 1 ? errForXlsxFormulas('#VALUE!') : found + 1;
      },
      EXACT: function (args, s) {
        var left = argText(args[0], s);
        var right = argText(args[1], s);
        return firstError([left, right]) || left === right;
      },
      VALUE: function (args, s) {
        var text = argScalar(args[0], s);
        if (typeof text === 'number') return text;
        return toNumberForXlsxFormulas(toTextForXlsxFormulas(text));
      },
      CONCATENATE: function (args, s) {
        var out = '';
        for (var i = 0; i < args.length; i++) {
          var text = argText(args[i], s);
          if (isErrForXlsxFormulas(text)) return text;
          out += text;
        }
        return out;
      },
      CONCAT: function (args, s) {
        var out = '';
        for (var i = 0; i < args.length; i++) {
          var values = flatValues(argValue(args[i], s));
          for (var j = 0; j < values.length; j++) {
            if (isErrForXlsxFormulas(values[j])) return values[j];
            out += toTextForXlsxFormulas(values[j]);
          }
        }
        return out;
      },
      TEXTJOIN: function (args, s) {
        var delimiter = argText(args[0], s);
        var ignoreEmpty = toBooleanForXlsxFormulas(argScalar(args[1], s));
        var problem = firstError([delimiter, ignoreEmpty]);
        if (problem) return problem;
        var parts = [];
        for (var i = 2; i < args.length; i++) {
          var values = flatValues(argValue(args[i], s));
          for (var j = 0; j < values.length; j++) {
            if (isErrForXlsxFormulas(values[j])) return values[j];
            var text = toTextForXlsxFormulas(values[j]);
            if (ignoreEmpty && text === '') continue;
            parts.push(text);
          }
        }
        return parts.join(delimiter);
      },
      VLOOKUP: function (args, s) { return tableLookup(args, s, false); },
      HLOOKUP: function (args, s) { return tableLookup(args, s, true); },
      MATCH: function (args, s) {
        var wanted = argScalar(args[0], s);
        if (isErrForXlsxFormulas(wanted)) return wanted;
        var range = argValue(args[1], s);
        if (!isRangeForXlsxFormulas(range)) return errForXlsxFormulas('#N/A');
        if (!isLineGrid(rangeValues(range))) return errForXlsxFormulas('#N/A');
        var type = argNumber(args[2], s, 1);
        if (isErrForXlsxFormulas(type)) return type;
        var listForMatch = function () { return oneDimensional(range); };
        var position = type === 0
          ? exactPosition('l:' + rangeKeyOf(range), listForMatch, wanted)
          : matchPosition(listForMatch(), wanted, type > 0 ? 1 : -1);
        return position === -1 ? errForXlsxFormulas('#N/A') : position + 1;
      },
      INDEX: function (args, s) {
        var range = argValue(args[0], s);
        if (isErrForXlsxFormulas(range)) return range;
        if (!isRangeForXlsxFormulas(range)) throw UNKNOWN_FOR_XLSX_FORMULAS;
        var rows = range.r2 - range.r1 + 1;
        var columns = range.c2 - range.c1 + 1;
        var rowNumber = argNumber(args[1], s, 0);
        var columnNumber = args.length > 2 ? argNumber(args[2], s, 0) : null;
        var problem = firstError([rowNumber, columnNumber]);
        if (problem) return problem;
        if (columnNumber === null) {
          if (rows === 1) { columnNumber = rowNumber; rowNumber = 1; } else columnNumber = columns === 1 ? 1 : 0;
        }
        rowNumber = Math.floor(rowNumber);
        columnNumber = Math.floor(columnNumber);
        if (rowNumber < 0 || columnNumber < 0 || rowNumber > rows || columnNumber > columns) return errForXlsxFormulas('#REF!');
        return {
          range: true, sheet: range.sheet,
          r1: rowNumber === 0 ? range.r1 : range.r1 + rowNumber - 1, r2: rowNumber === 0 ? range.r2 : range.r1 + rowNumber - 1,
          c1: columnNumber === 0 ? range.c1 : range.c1 + columnNumber - 1, c2: columnNumber === 0 ? range.c2 : range.c1 + columnNumber - 1,
          whole: ''
        };
      },
      XLOOKUP: function (args, s) {
        var wanted = argScalar(args[0], s);
        if (isErrForXlsxFormulas(wanted)) return wanted;
        var lookupRange = argValue(args[1], s);
        var returnRange = argValue(args[2], s);
        if (!isRangeForXlsxFormulas(lookupRange) || !isRangeForXlsxFormulas(returnRange)) throw UNKNOWN_FOR_XLSX_FORMULAS;
        if (args.length > 4 && args[4].t !== 'blank') {
          var mode = argNumber(args[4], s);
          if (mode !== 0) throw UNKNOWN_FOR_XLSX_FORMULAS;
        }
        if (args.length > 5) throw UNKNOWN_FOR_XLSX_FORMULAS;
        if (!isLineGrid(rangeValues(lookupRange))) return errForXlsxFormulas('#VALUE!');
        var position = exactPosition('l:' + rangeKeyOf(lookupRange), function () { return oneDimensional(lookupRange); }, wanted);
        if (position === -1) return args.length > 3 && args[3].t !== 'blank' ? argScalar(args[3], s) : errForXlsxFormulas('#N/A');
        var vertical = lookupRange.r2 > lookupRange.r1;
        // Ranges of different lengths are #VALUE! in Excel. A wider return range is valid there
        // but spills, which this file cannot hold, so it is left without a result.
        if (vertical) {
          if (returnRange.r2 - returnRange.r1 !== lookupRange.r2 - lookupRange.r1) return errForXlsxFormulas('#VALUE!');
          if (returnRange.c1 !== returnRange.c2) throw UNKNOWN_FOR_XLSX_FORMULAS;
          return cellValue(returnRange.sheet, returnRange.r1 + position, returnRange.c1);
        }
        if (returnRange.c2 - returnRange.c1 !== lookupRange.c2 - lookupRange.c1) return errForXlsxFormulas('#VALUE!');
        if (returnRange.r1 !== returnRange.r2) throw UNKNOWN_FOR_XLSX_FORMULAS;
        return cellValue(returnRange.sheet, returnRange.r1, returnRange.c1 + position);
      },
      DATE: function (args, s) {
        var year = argNumber(args[0], s);
        var month = argNumber(args[1], s);
        var day = argNumber(args[2], s);
        var problem = firstError([year, month, day]);
        if (problem) return problem;
        year = Math.floor(year);
        if (year < 1900) year += 1900;
        var serial = serialFromPartsForXlsxFormulas(year, Math.floor(month), Math.floor(day));
        return serial < 1 ? errForXlsxFormulas('#NUM!') : serial;
      },
      YEAR: mathFunction(function (n) { return n < 0 ? errForXlsxFormulas('#NUM!') : partsFromSerialForXlsxFormulas(n).year; }),
      MONTH: mathFunction(function (n) { return n < 0 ? errForXlsxFormulas('#NUM!') : partsFromSerialForXlsxFormulas(n).month; }),
      DAY: mathFunction(function (n) { return n < 0 ? errForXlsxFormulas('#NUM!') : partsFromSerialForXlsxFormulas(n).day; }),
      WEEKDAY: function (args, s) {
        var serial = argNumber(args[0], s);
        var type = argNumber(args[1], s, 1);
        var problem = firstError([serial, type]);
        if (problem) return problem;
        var weekday = partsFromSerialForXlsxFormulas(serial).weekday;
        if (type === 1) return weekday + 1;
        if (type === 2) return weekday === 0 ? 7 : weekday;
        if (type === 3) return weekday === 0 ? 6 : weekday - 1;
        throw UNKNOWN_FOR_XLSX_FORMULAS;
      },
      EDATE: function (args, s) {
        var serial = argNumber(args[0], s);
        var months = argNumber(args[1], s);
        var problem = firstError([serial, months]);
        if (problem) return problem;
        var parts = partsFromSerialForXlsxFormulas(serial);
        var target = new Date(Date.UTC(parts.year, parts.month - 1 + Math.trunc(months), 1));
        var lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
        return serialFromPartsForXlsxFormulas(target.getUTCFullYear(), target.getUTCMonth() + 1, Math.min(parts.day, lastDay));
      },
      EOMONTH: function (args, s) {
        var serial = argNumber(args[0], s);
        var months = argNumber(args[1], s);
        var problem = firstError([serial, months]);
        if (problem) return problem;
        var parts = partsFromSerialForXlsxFormulas(serial);
        var end = new Date(Date.UTC(parts.year, parts.month + Math.trunc(months), 0));
        return serialFromPartsForXlsxFormulas(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate());
      },
      DAYS: function (args, s) {
        var end = argNumber(args[0], s);
        var start = argNumber(args[1], s);
        return firstError([end, start]) || Math.floor(end) - Math.floor(start);
      },
      TODAY: function () { return todaySerialForWorkbook; }
    };

    function tableLookup(args, s, horizontal) {
      var wanted = argScalar(args[0], s);
      if (isErrForXlsxFormulas(wanted)) return wanted;
      var table = argValue(args[1], s);
      if (isErrForXlsxFormulas(table)) return table;
      if (!isRangeForXlsxFormulas(table)) return errForXlsxFormulas('#VALUE!');
      var index = argNumber(args[2], s);
      if (isErrForXlsxFormulas(index)) return index;
      index = Math.floor(index);
      var approximate = args.length > 3 && args[3].t !== 'blank' ? toBooleanForXlsxFormulas(argScalar(args[3], s)) : true;
      if (isErrForXlsxFormulas(approximate)) return approximate;
      var grid = rangeValues(table);
      var depth = horizontal ? grid.length : (grid[0] ? grid[0].length : 0);
      if (index < 1) return errForXlsxFormulas('#VALUE!');
      if (index > depth) return errForXlsxFormulas('#REF!');
      var keysFor = function () { return horizontal ? (grid[0] || []) : grid.map(function (row) { return row[0]; }); };
      var position = approximate
        ? matchPosition(keysFor(), wanted, 1)
        : exactPosition((horizontal ? 'h:' : 'v:') + rangeKeyOf(table), keysFor, wanted);
      if (position === -1) return errForXlsxFormulas('#N/A');
      return horizontal ? grid[index - 1][position] : grid[position][index - 1];
    }

    // Row by row, so a running total down 5,000 rows resolves one step at a time instead of
    // recursing through every row above it.
    var resultsForWorkbook = sheetsForWorkbook.map(function (sheetForResults, sheetIndexForResults) {
      var resultsForSheet = {};
      (sheetForResults.rows || []).forEach(function (rowForResults, rowIndexForResults) {
        (rowForResults || []).forEach(function (cellForResults, columnIndexForResults) {
          if (!cellForResults || cellForResults.formula == null) return;
          var keyForResults = rowIndexForResults + ',' + columnIndexForResults;
          try {
            cellValue(sheetIndexForResults, rowIndexForResults, columnIndexForResults);
          } catch (thrownForResults) {
            if (thrownForResults !== UNKNOWN_FOR_XLSX_FORMULAS && thrownForResults !== CIRCULAR_FOR_XLSX_FORMULAS) throw thrownForResults;
          }
          var stateForResults = stateForWorkbook[sheetIndexForResults][keyForResults];
          resultsForSheet[keyForResults] = stateForResults && stateForResults !== BUSY ? stateForResults : { unknown: true };
        });
      });
      return resultsForSheet;
    });
    return { results: resultsForWorkbook, functions: Object.keys(FUNCTIONS) };
  }

  var supportedFunctionsForXlsxFormulas = null;
  // Whether evaluateWorkbook can work out a function's result.
  function supportsForXlsxFormulas(nameForSupports) {
    if (!supportedFunctionsForXlsxFormulas) {
      supportedFunctionsForXlsxFormulas = {};
      evaluateWorkbookForXlsxFormulas([]).functions.forEach(function (nameForList) { supportedFunctionsForXlsxFormulas[nameForList] = true; });
    }
    return !!supportedFunctionsForXlsxFormulas[String(nameForSupports || '').toUpperCase().replace(/^_XLFN\.(_XLWS\.)?/, '')];
  }

  nsForXlsxFormulas.xlsxFormulas = {
    prepare: prepareForXlsxFormulas,
    evaluateWorkbook: evaluateWorkbookForXlsxFormulas,
    supports: supportsForXlsxFormulas,
    columnName: columnNameForXlsxFormulas,
    cellName: cellNameForXlsxFormulas,
    serialFromParts: serialFromPartsForXlsxFormulas
  };

  globalScopeForXlsxFormulas.ABChatAgent = nsForXlsxFormulas;

  if (typeof module === 'object' && module && module.exports) {
    module.exports = nsForXlsxFormulas.xlsxFormulas;
  }
})();
