// agent/xlsxFormulas.js: the check that decides what formula text is stored in an XLSX, and the
// evaluator that works out each formula's cached value.
//
// The module is new, so there is no earlier version to replay these against. Instead each
// Excel-specific rule below was checked by breaking it in a scratch copy of the module and
// confirming the matching test fails: with unary minus binding after "^", -B1^2 gives -4; with
// MOD taking the sign of the dividend, MOD(-7,3) gives -1; with ROUND as Math.round, ROUND(-2.5,0)
// gives -2; with no _xlfn. prefix, the IFS and XLOOKUP assertions fail; with the comparison type
// order removed, 2<"a" gives false; and with the cycle check removed, the recursion overflows and
// both cells come back with no result instead of being reported as circular.

const test = require('node:test');
const assert = require('node:assert');

const formulas = require('../agent/xlsxFormulas.js');

// Builds evaluator input from rows of plain values and "=formula" strings, and returns the
// results of the first sheet keyed by A1 references.
function evaluateForTest(rows, more) {
  const toCell = function (raw) {
    return typeof raw === 'string' && raw.charAt(0) === '=' ? { formula: formulas.prepare(raw).stored } : { value: raw };
  };
  const sheets = [{ name: 'Sheet1', rows: rows.map(function (row) { return row.map(toCell); }) }].concat(more || []);
  const results = formulas.evaluateWorkbook(sheets, { todaySerial: 46339 }).results[0];
  const byRef = {};
  Object.keys(results).forEach(function (key) {
    const parts = key.split(',');
    byRef[formulas.cellName(Number(parts[0]), Number(parts[1]))] = results[key];
  });
  return byRef;
}

test('prepare uppercases names and references and drops a leading "="', function () {
  const prepared = formulas.prepare('=sum(a1:b2)+average($c$1:c9)');
  assert.strictEqual(prepared.ok, true);
  assert.strictEqual(prepared.stored, 'SUM(A1:B2)+AVERAGE($C$1:C9)');
  assert.deepStrictEqual(prepared.functions.sort(), ['AVERAGE', 'SUM']);
});

test('functions newer than Excel 2007 are stored with their prefix, and text inside quotes is left alone', function () {
  assert.strictEqual(formulas.prepare('IFS(A1>1,"x",TRUE,"y")').stored, '_xlfn.IFS(A1>1,"x",TRUE,"y")');
  assert.strictEqual(formulas.prepare('xlookup(A1,B:B,C:C)').stored, '_xlfn.XLOOKUP(A1,B:B,C:C)');
  assert.strictEqual(formulas.prepare('concat("a;b","[x]",textjoin(",",TRUE,A1:A3))').stored,
    '_xlfn.CONCAT("a;b","[x]",_xlfn.TEXTJOIN(",",TRUE,A1:A3))');
  assert.strictEqual(formulas.prepare("'q1 sales'!b2*2").stored, "'q1 sales'!B2*2");
});

test('spilling functions are flagged, and FILTER and SORT get the worksheet prefix', function () {
  const filtered = formulas.prepare('FILTER(A1:A9,B1:B9>0)');
  assert.strictEqual(filtered.stored, '_xlfn._xlws.FILTER(A1:A9,B1:B9>0)');
  assert.deepStrictEqual(filtered.spilling, ['FILTER']);
  assert.deepStrictEqual(formulas.prepare('UNIQUE(A1:A9)').spilling, ['UNIQUE']);
  assert.deepStrictEqual(formulas.prepare('SUM(A1:A9)').spilling, []);
});

test('formulas Excel would reject are refused with a reason', function () {
  const cases = {
    'SUM(A1;A2)': /semicolons/,
    'SUM(Table1[Sales])': /table references/,
    '@A1': /@ operator/,
    'SUM(A1': /parenthesis/,
    '"abc': /quote/
  };
  Object.keys(cases).forEach(function (text) {
    const prepared = formulas.prepare(text);
    assert.strictEqual(prepared.ok, false, text);
    assert.match(prepared.error, cases[text], text);
  });
});

test('operators follow Excel: unary minus before "^", MOD takes the divisor sign, ROUND goes away from zero', function () {
  const results = evaluateForTest([
    [2, '=-A1^2', '=MOD(-7,3)', '=MOD(7,-3)', '=ROUND(-2.5,0)', '=ROUND(2.5,0)', '=2^3^2']
  ]);
  assert.deepStrictEqual(results.B1, { value: 4 });
  assert.deepStrictEqual(results.C1, { value: 2 });
  assert.deepStrictEqual(results.D1, { value: -2 });
  assert.deepStrictEqual(results.E1, { value: -3 });
  assert.deepStrictEqual(results.F1, { value: 3 });
  assert.deepStrictEqual(results.G1, { value: 64 });
});

test('comparisons order numbers before text before booleans, and text compares without case', function () {
  const results = evaluateForTest([[2, 'a', '=A1<B1', '=B1<TRUE', '="ABC"="abc"', '=A1="2"']]);
  assert.deepStrictEqual(results.C1, { value: true });
  assert.deepStrictEqual(results.D1, { value: true });
  assert.deepStrictEqual(results.E1, { value: true });
  assert.deepStrictEqual(results.F1, { value: false });
});

test('aggregates skip text and blanks in ranges, and whole-column ranges stop at the used rows', function () {
  const results = evaluateForTest([
    ['Item', 'Amount', '=SUM(B:B)', '=COUNT(B:B)', '=COUNTA(A:A)', '=AVERAGE(B2:B5)'],
    ['a', 10],
    ['b', 'n/a'],
    ['c', null],
    ['d', 20]
  ]);
  assert.deepStrictEqual(results.C1, { value: 30 });
  assert.deepStrictEqual(results.D1, { value: 2 });
  assert.deepStrictEqual(results.E1, { value: 5 });
  assert.deepStrictEqual(results.F1, { value: 15 });
});

test('conditional functions take criteria with operators and wildcards', function () {
  const results = evaluateForTest([
    ['North', 10, '=SUMIF(A1:A4,"North",B1:B4)', '=COUNTIF(A1:A4,"S*")', '=SUMIFS(B1:B4,A1:A4,"<>North",B1:B4,">=5")', '=AVERAGEIF(B1:B4,">5")'],
    ['South', 4],
    ['North', 6],
    ['Sahel', 8]
  ]);
  assert.deepStrictEqual(results.C1, { value: 16 });
  assert.deepStrictEqual(results.D1, { value: 2 });
  assert.deepStrictEqual(results.E1, { value: 8 });
  assert.deepStrictEqual(results.F1, { value: 8 });
});

// Before the #VALUE! check, XLOOKUP over ranges of different lengths gave no result at all, so the
// file had no cached value and no warning; H1 failed against that version.
test('lookups find exact matches, a miss is #N/A, and ranges of different lengths are #VALUE!', function () {
  const results = evaluateForTest([
    ['Code', 'Price', '=VLOOKUP("b2",A2:B4,2,FALSE)', '=INDEX(B2:B4,MATCH("C3",A2:A4,0))', '=XLOOKUP("a1",A2:A4,B2:B4)', '=VLOOKUP("zz",A2:B4,2,FALSE)', '=IFERROR(F1,"none")', '=XLOOKUP("a1",A2:A4,B2:B3)'],
    ['A1', 5],
    ['B2', 7],
    ['C3', 9]
  ]);
  assert.deepStrictEqual(results.C1, { value: 7 });
  assert.deepStrictEqual(results.D1, { value: 9 });
  assert.deepStrictEqual(results.E1, { value: 5 });
  assert.deepStrictEqual(results.F1, { error: '#N/A' });
  assert.deepStrictEqual(results.G1, { value: 'none' });
  assert.deepStrictEqual(results.H1, { error: '#VALUE!' });
});

test('dates are Excel serials, and DATE rolls an overflowing day into the next month', function () {
  const results = evaluateForTest([
    ['=DATE(2026,1,1)', '=DATE(2026,2,29)', '=EOMONTH(DATE(2026,1,15),1)', '=EDATE(DATE(2026,1,31),1)', '=YEAR(B1)&"-"&MONTH(B1)', '=TODAY()', '=DAYS(B1,A1)']
  ]);
  assert.deepStrictEqual(results.A1, { value: 46023 });
  assert.deepStrictEqual(results.B1, { value: 46082 });
  assert.deepStrictEqual(results.C1, { value: 46081 });
  assert.deepStrictEqual(results.D1, { value: 46081 });
  assert.deepStrictEqual(results.E1, { value: '2026-3' });
  assert.deepStrictEqual(results.F1, { value: 46339 });
  assert.deepStrictEqual(results.G1, { value: 59 });
  assert.strictEqual(formulas.serialFromParts(2026, 7, 2), 46205);
});

test('errors propagate, and a reference to a missing sheet is #REF!', function () {
  const results = evaluateForTest([['=1/0', '=A1+1', '=Nowhere!A1', '=SQRT(-1)', '=VALUE("abc")', '=ISERROR(A1)']]);
  assert.deepStrictEqual(results.A1, { error: '#DIV/0!' });
  assert.deepStrictEqual(results.B1, { error: '#DIV/0!' });
  assert.deepStrictEqual(results.C1, { error: '#REF!' });
  assert.deepStrictEqual(results.D1, { error: '#NUM!' });
  assert.deepStrictEqual(results.E1, { error: '#VALUE!' });
  assert.deepStrictEqual(results.F1, { value: true });
});

test('references reach other sheets, with quoted names', function () {
  const assumptions = { name: 'Rate & mix', rows: [[{ value: 'Rate' }, { value: 0.2 }]] };
  const results = evaluateForTest([[100, "=A1*'Rate & mix'!$B$1"]], [assumptions]);
  assert.deepStrictEqual(results.B1, { value: 20 });
});

test('a circular reference is reported on every cell in the cycle, not evaluated', function () {
  const results = evaluateForTest([['=B1+1', '=A1+1', '=5']]);
  assert.deepStrictEqual(results.A1, { circular: true });
  assert.deepStrictEqual(results.B1, { circular: true });
  assert.deepStrictEqual(results.C1, { value: 5 });
});

test('an unknown function leaves the formula without a result, and supports() says so', function () {
  const results = evaluateForTest([['=FOO(1)', '=SUM(1,2)']]);
  assert.deepStrictEqual(results.A1, { unknown: true });
  assert.deepStrictEqual(results.B1, { value: 3 });
  assert.strictEqual(formulas.supports('FOO'), false);
  assert.strictEqual(formulas.supports('_xlfn.XLOOKUP'), true);
  assert.strictEqual(formulas.supports('sumifs'), true);
});

test('text functions handle accents and joins', function () {
  const results = evaluateForTest([
    ['  élan  vital ', '=PROPER(TRIM(A1))', '=LEN(A1)', '=TEXTJOIN(", ",TRUE,"a","","b")', '=SUBSTITUTE("a-b-c","-","+",2)', '=SEARCH("V",A1)']
  ]);
  assert.deepStrictEqual(results.B1, { value: 'Élan Vital' });
  assert.deepStrictEqual(results.C1, { value: 14 });
  assert.deepStrictEqual(results.D1, { value: 'a, b' });
  assert.deepStrictEqual(results.E1, { value: 'a-b+c' });
  assert.deepStrictEqual(results.F1, { value: 9 });
});

// ---- Caches and indexes ----
//
// The evaluator keeps a range's values, a running sum, or an index of a range only from the second
// time the same range is used. So a formula evaluated alone takes the plain scanning path, and the
// same formula evaluated among many that share its ranges reads the caches and indexes. The two
// must agree. The data mixes what an index could get wrong: numbers next to numeric text, case
// variants, a German sharp s against its two-letter capital form, the long s, booleans next to the
// text TRUE, blanks, a wildcard, an error, and a circular reference below the error.
//
// Checked by breaking the evaluator in a scratch copy, one change at a time, and confirming this
// test fails: with numeric text left out of the number buckets, SUMIF on 5 gave 2 instead of
// 12.5; with lookups keyed by exact case, a lookup found nothing (#N/A) where it should find row
// 5; with the candidate check skipped, COUNTIFS ignored its second criterion and counted 5 instead
// of 3; and with the running sum stopping at the first error, SUM($B$1:B22) gave #DIV/0! instead
// of reporting the circular reference below it.

const MIXED_COLUMN_FOR_TEST = [5, '5', ' 5 ', '5.0', 'abc', 'ABC', 'Abc', true, 'TRUE', null, '', 0, 7, 'a*',
  'straße', 'STRASSE', 'ǅ', 'x', 'abc', 5, 'ſ', 'S', 3.5, 'a~b'];
const MIXED_ROWS_FOR_TEST = MIXED_COLUMN_FOR_TEST.length;

function mixedDataRowsForTest() {
  return MIXED_COLUMN_FOR_TEST.map(function (value, index) {
    const row = index + 1;
    let b = { value: row };
    if (row === 6) b = { formula: '1/0' };
    if (row === 22) b = { formula: 'B22+1' };
    const c = row === 9 ? { value: 'n/a' } : { value: (row % 5) + 0.5 };
    return [{ value: value }, b, c];
  });
}

function mixedFormulasForTest() {
  const n = MIXED_ROWS_FOR_TEST;
  const list = [];
  for (let i = 1; i <= n; i++) {
    list.push('COUNTIF($A$1:$A$' + n + ',A' + i + ')');
    list.push('SUMIF($A$1:$A$' + n + ',A' + i + ',$C$1:$C$' + n + ')');
    list.push('COUNTIFS($A$1:$A$' + n + ',A' + i + ',$C$1:$C$' + n + ',">2")');
    list.push('MATCH(A' + i + ',$A$1:$A$' + n + ',0)');
    list.push('VLOOKUP(A' + i + ',$A$1:$C$' + n + ',3,FALSE)');
    list.push('XLOOKUP(A' + i + ',$A$1:$A$' + n + ',$C$1:$C$' + n + ',"none")');
    list.push('SUM($B$1:B' + i + ')');
    list.push('SUM($C$1:C' + i + ')');
    list.push('SUM($C$1:$C$' + n + ')/' + (i + 1));
    if (i + 2 <= n) list.push('SUM(C' + i + ':C' + (i + 2) + ')');
  }
  ['5', '"5"', '"abc"', '"=ABC"', 'TRUE', '"true"', '"straße"', '"STRASSE"', '"a~*"', '"a*"', '""', '"<>abc"', '">4"', '"s"', '"a~b"']
    .forEach(function (criterion) {
      list.push('COUNTIF($A$1:$A$' + n + ',' + criterion + ')');
      list.push('SUMIF($A$1:$A$' + n + ',' + criterion + ',$C$1:$C$' + n + ')');
      list.push('MATCH(' + criterion + ',$A$1:$A$' + n + ',0)');
      list.push('VLOOKUP(' + criterion + ',$A$1:$C$' + n + ',3,FALSE)');
    });
  return list;
}

// Places formula k at a fixed cell to the right of the data, inside the data's rows, so whole
// columns and the used range are the same alone and together.
function formulaCellForTest(k) {
  return { row: k % MIXED_ROWS_FOR_TEST, column: 4 + Math.floor(k / MIXED_ROWS_FOR_TEST) };
}

function evaluateMixedForTest(formulaTexts, onlyIndex) {
  const rows = mixedDataRowsForTest();
  formulaTexts.forEach(function (text, k) {
    if (onlyIndex !== undefined && k !== onlyIndex) return;
    const at = formulaCellForTest(k);
    while (rows[at.row].length < at.column) rows[at.row].push({ value: null });
    rows[at.row][at.column] = { formula: formulas.prepare(text).stored };
  });
  return formulas.evaluateWorkbook([{ name: 'Data', rows: rows }], { todaySerial: 46339 }).results[0];
}

test('cached, indexed, and running-sum results match each formula evaluated on its own', function () {
  const texts = mixedFormulasForTest();
  const together = evaluateMixedForTest(texts);
  texts.forEach(function (text, k) {
    const at = formulaCellForTest(k);
    const key = at.row + ',' + at.column;
    const alone = evaluateMixedForTest(texts, k)[key];
    assert.deepStrictEqual(together[key], alone, text);
  });
  // A few values pinned outright, so the comparison is not between two equally wrong answers.
  const result = function (text) { const at = formulaCellForTest(texts.indexOf(text)); return together[at.row + ',' + at.column]; };
  assert.deepStrictEqual(result('COUNTIF($A$1:$A$24,5)'), { value: 5 });
  assert.deepStrictEqual(result('COUNTIF($A$1:$A$24,"abc")'), { value: 4 });
  assert.deepStrictEqual(result('COUNTIF($A$1:$A$24,"STRASSE")'), { value: 1 });
  assert.deepStrictEqual(result('MATCH("abc",$A$1:$A$24,0)'), { value: 5 });
  assert.deepStrictEqual(result('SUM($B$1:B5)'), { value: 15 });
  assert.deepStrictEqual(result('SUM($B$1:B10)'), { error: '#DIV/0!' });
  assert.deepStrictEqual(result('SUM($B$1:B24)'), { circular: true });
});

// The evaluator used to keep the values of every range it read. A running total reads a new range
// on every row, so 10,000 rows held about 50 million values. Against that version this test ran
// out of memory after 10 seconds with node --max-old-space-size=1024.
test('a running total down 10,000 rows is worked out without keeping every range', function () {
  const rows = [];
  for (let i = 1; i <= 10000; i++) rows.push([{ value: i }, { formula: 'SUM($A$1:A' + i + ')' }]);
  const results = formulas.evaluateWorkbook([{ name: 'Run', rows: rows }], {}).results[0];
  assert.deepStrictEqual(results['9999,1'], { value: 50005000 });
  assert.deepStrictEqual(results['4,1'], { value: 15 });
});
