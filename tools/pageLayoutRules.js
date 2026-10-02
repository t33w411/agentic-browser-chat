// Pure rules for the page_layout agent tool: value parsers, sort ordering, filter conditions, and
// the CSS declaration allowlist.
//
// The model never sends code to page_layout. It sends data (sort this collection by field b as a
// compact number, hide items whose duration is under 5:00, set font-size on region r3), and
// tools/pageLayout.js carries it out with the fixed operations defined here and there. Everything
// that decides what a value means or which declarations are allowed lives in this file so it can
// be tested without a page.
//
// The CSS allowlist is the security boundary for the style action. Values containing url(),
// image(), image-set(), element(), attr(), expression() or any character that could close the
// declaration are refused, so a style change can never fetch a resource (the standard CSS
// exfiltration trick needs a url()) or break out into a new rule. position is limited to static,
// relative and sticky so an element cannot be pinned over the page as a fake control, and
// transform, z-index and pointer-events are left out for the same reason.
//
// Nothing here touches the DOM or chrome.*, so it loads as an ordinary IIFE in the content script
// and exports through the CommonJS tail under Node (`module` is undefined in the browser, so that
// branch is inert there).

(function () {
  const globalScopeForLayoutRules = globalThis;
  const nsForLayoutRules = globalScopeForLayoutRules.ABChatContent || {};

  const PARSERS_FOR_LAYOUT_RULES = ['auto', 'number', 'compact_number', 'duration', 'relative_time', 'date', 'text'];
  const FILTER_OPS_FOR_LAYOUT_RULES = ['lt', 'lte', 'gt', 'gte', 'eq', 'neq', 'contains', 'not_contains', 'empty', 'not_empty'];
  const TEXT_ONLY_OPS_FOR_LAYOUT_RULES = { contains: true, not_contains: true, empty: true, not_empty: true };

  const MS_PER_UNIT_FOR_LAYOUT_RULES = {
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000
  };

  // Whole month names or their standard abbreviations only, bounded on both sides, so "Mayor",
  // "decimal" or "marathon" are not mistaken for dates.
  const MONTH_NAMES_FOR_LAYOUT_RULES = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
  const MONTH_NAME_PATTERN_FOR_LAYOUT_RULES = '\\b(?:' + MONTH_NAMES_FOR_LAYOUT_RULES + ')\\b\\.?';
  const MONTH_ABBREVIATIONS_FOR_LAYOUT_RULES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  // A month and day with no year: "Feb 22", "Sat, Feb 22", "22 Feb", "22 of February" (ordinals
  // are already stripped). The day may not run into a time ("Feb 9:00").
  const MONTH_DAY_PATTERN_FOR_LAYOUT_RULES = new RegExp(
    '\\b(' + MONTH_NAMES_FOR_LAYOUT_RULES + ')\\b\\.?\\s+(\\d{1,2})(?![\\d:])|\\b(\\d{1,2})\\s+(?:of\\s+)?(' + MONTH_NAMES_FOR_LAYOUT_RULES + ')\\b', 'i'
  );
  // A clock time: "9:00 AM", "21:30", "9am", "9:00:15 p.m.".
  const CLOCK_TIME_PATTERN_FOR_LAYOUT_RULES = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([ap])\.?\s?m\b\.?)?|\b(\d{1,2})\s*([ap])\.?\s?m\b\.?/i;

  function normalizeTextForLayoutRules(textForNormalize) {
    return String(textForNormalize == null ? '' : textForNormalize).replace(/\s+/g, ' ').trim();
  }

  function truncateTextForLayoutRules(textForTruncate, maxForTruncate) {
    const normalizedForTruncate = normalizeTextForLayoutRules(textForTruncate);
    if (normalizedForTruncate.length <= maxForTruncate) return normalizedForTruncate;
    return normalizedForTruncate.slice(0, Math.max(0, maxForTruncate - 1)).trimEnd() + '…';
  }

  // a, b, ..., z, aa, ab, ... Field ids are short so the model can refer to them cheaply.
  function fieldIdForIndexForLayoutRules(indexForFieldId) {
    let nForFieldId = Math.max(0, Math.floor(Number(indexForFieldId) || 0));
    let outForFieldId = '';
    do {
      outForFieldId = String.fromCharCode(97 + (nForFieldId % 26)) + outForFieldId;
      nForFieldId = Math.floor(nForFieldId / 26) - 1;
    } while (nForFieldId >= 0);
    return outForFieldId;
  }

  // Normalizes one numeric token that may carry thousands separators. When both "," and "." appear,
  // the one that occurs last is the decimal mark ("1,299.99" and "1.299,99" both mean 1299.99). A
  // single separator followed by exactly three digit groups reads as thousands; a lone "." is a
  // decimal ("1.234" is 1.234, the English reading), a lone "," with a non-three-digit tail is a
  // decimal ("1,5").
  function normalizeNumericTokenForLayoutRules(tokenForNumeric) {
    let tokenForNormalize = String(tokenForNumeric || '').replace(/[\s  ']/g, '').replace(/−/g, '-');
    if (!tokenForNormalize) return NaN;
    const lastCommaForNormalize = tokenForNormalize.lastIndexOf(',');
    const lastDotForNormalize = tokenForNormalize.lastIndexOf('.');
    if (lastCommaForNormalize !== -1 && lastDotForNormalize !== -1) {
      if (lastCommaForNormalize > lastDotForNormalize) {
        tokenForNormalize = tokenForNormalize.replace(/\./g, '').replace(',', '.');
      } else {
        tokenForNormalize = tokenForNormalize.replace(/,/g, '');
      }
    } else if (lastCommaForNormalize !== -1) {
      tokenForNormalize = /^-?\d{1,3}(?:,\d{3})+$/.test(tokenForNormalize)
        ? tokenForNormalize.replace(/,/g, '')
        : tokenForNormalize.replace(',', '.');
    } else if (lastDotForNormalize !== -1 && /^-?\d{1,3}(?:\.\d{3}){2,}$/.test(tokenForNormalize)) {
      tokenForNormalize = tokenForNormalize.replace(/\./g, '');
    }
    const valueForNormalize = Number(tokenForNormalize);
    return Number.isFinite(valueForNormalize) ? valueForNormalize : NaN;
  }

  const NUMERIC_TOKEN_PATTERN_FOR_LAYOUT_RULES = /[-−]?\d{1,3}(?:[,.  ' ]\d{3})+(?:[.,]\d+)?|[-−]?\d+(?:[.,]\d+)?/;

  function parseNumberForLayoutRules(textForNumber) {
    const matchForNumber = normalizeTextForLayoutRules(textForNumber).match(NUMERIC_TOKEN_PATTERN_FOR_LAYOUT_RULES);
    if (!matchForNumber) return null;
    const valueForNumber = normalizeNumericTokenForLayoutRules(matchForNumber[0]);
    return Number.isFinite(valueForNumber) ? valueForNumber : null;
  }

  const COMPACT_MULTIPLIERS_FOR_LAYOUT_RULES = {
    k: 1e3, thousand: 1e3,
    m: 1e6, million: 1e6,
    b: 1e9, bn: 1e9, billion: 1e9,
    t: 1e12, trillion: 1e12
  };

  // "1.2M views", "340K", "1.5 billion", "1,234,567 views". "No views" / "No comments" read as 0,
  // since that is how video and forum sites print a zero count.
  function parseCompactNumberForLayoutRules(textForCompact) {
    const normalizedForCompact = normalizeTextForLayoutRules(textForCompact);
    if (!normalizedForCompact) return null;
    const matchForCompact = normalizedForCompact.match(/([-−]?\d+(?:[.,]\d+)?)\s*(thousand|million|billion|trillion|bn|[kmbt])(?![a-z])/i);
    if (matchForCompact) {
      const baseForCompact = normalizeNumericTokenForLayoutRules(matchForCompact[1]);
      const multiplierForCompact = COMPACT_MULTIPLIERS_FOR_LAYOUT_RULES[matchForCompact[2].toLowerCase()];
      if (Number.isFinite(baseForCompact) && multiplierForCompact) {
        return Math.round(baseForCompact * multiplierForCompact);
      }
    }
    if (!/\d/.test(normalizedForCompact) && /^no\b/i.test(normalizedForCompact)) return 0;
    return parseNumberForLayoutRules(normalizedForCompact);
  }

  // Returns seconds. "12:04" is minutes:seconds, "1:02:03" hours:minutes:seconds, and word forms
  // such as "1h 5m", "12 min", "45 seconds" are summed.
  function parseDurationForLayoutRules(textForDuration) {
    const normalizedForDuration = normalizeTextForLayoutRules(textForDuration);
    if (!normalizedForDuration) return null;
    const colonMatchForDuration = normalizedForDuration.match(/(\d+):(\d{2})(?::(\d{2}))?(?!\d)/);
    if (colonMatchForDuration) {
      if (colonMatchForDuration[3] != null) {
        return Number(colonMatchForDuration[1]) * 3600 + Number(colonMatchForDuration[2]) * 60 + Number(colonMatchForDuration[3]);
      }
      return Number(colonMatchForDuration[1]) * 60 + Number(colonMatchForDuration[2]);
    }
    const wordPatternForDuration = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])/gi;
    let totalForDuration = 0;
    let foundForDuration = false;
    let partForDuration;
    while ((partForDuration = wordPatternForDuration.exec(normalizedForDuration)) !== null) {
      const amountForDuration = Number(partForDuration[1]);
      const unitForDuration = partForDuration[2].toLowerCase();
      if (unitForDuration.charAt(0) === 'h') totalForDuration += amountForDuration * 3600;
      else if (unitForDuration.charAt(0) === 'm') totalForDuration += amountForDuration * 60;
      else totalForDuration += amountForDuration;
      foundForDuration = true;
    }
    return foundForDuration ? Math.round(totalForDuration) : null;
  }

  function unitMsForLayoutRules(rawUnitForMs) {
    const unitForMs = String(rawUnitForMs || '').toLowerCase();
    if (/^(mo|mos|months?)$/.test(unitForMs)) return MS_PER_UNIT_FOR_LAYOUT_RULES.month;
    if (/^(s|secs?|seconds?)$/.test(unitForMs)) return MS_PER_UNIT_FOR_LAYOUT_RULES.second;
    if (/^(m|mins?|minutes?)$/.test(unitForMs)) return MS_PER_UNIT_FOR_LAYOUT_RULES.minute;
    if (/^(h|hrs?|hours?)$/.test(unitForMs)) return MS_PER_UNIT_FOR_LAYOUT_RULES.hour;
    if (/^(d|days?)$/.test(unitForMs)) return MS_PER_UNIT_FOR_LAYOUT_RULES.day;
    if (/^(w|wks?|weeks?)$/.test(unitForMs)) return MS_PER_UNIT_FOR_LAYOUT_RULES.week;
    if (/^(y|yrs?|years?)$/.test(unitForMs)) return MS_PER_UNIT_FOR_LAYOUT_RULES.year;
    return 0;
  }

  const RELATIVE_UNIT_PATTERN_FOR_LAYOUT_RULES = '(months?|mos?|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|years?|yrs?|s|m|h|d|w|y)';

  // Returns an approximate epoch-ms timestamp so "3 weeks ago" sorts on the same scale as a real
  // date: descending means newest first for both. Months are 30 days and years 365.
  function parseRelativeTimeForLayoutRules(textForRelative, nowMsForRelative) {
    const normalizedForRelative = normalizeTextForLayoutRules(textForRelative).toLowerCase();
    if (!normalizedForRelative) return null;
    const nowForRelative = Number.isFinite(nowMsForRelative) ? nowMsForRelative : Date.now();
    if (/\b(just now|moments? ago|right now)\b/.test(normalizedForRelative)) return nowForRelative;
    if (/\byesterday\b/.test(normalizedForRelative)) return nowForRelative - MS_PER_UNIT_FOR_LAYOUT_RULES.day;
    if (/\btoday\b/.test(normalizedForRelative)) return nowForRelative;
    if (/\btomorrow\b/.test(normalizedForRelative)) return nowForRelative + MS_PER_UNIT_FOR_LAYOUT_RULES.day;
    const agoMatchForRelative = normalizedForRelative.match(new RegExp('(\\d+(?:\\.\\d+)?|an?|one)\\s*' + RELATIVE_UNIT_PATTERN_FOR_LAYOUT_RULES + '\\b\\s*ago\\b'));
    if (agoMatchForRelative) {
      const amountForAgo = /^\d/.test(agoMatchForRelative[1]) ? Number(agoMatchForRelative[1]) : 1;
      const unitMsForAgo = unitMsForLayoutRules(agoMatchForRelative[2]);
      if (unitMsForAgo) return Math.round(nowForRelative - amountForAgo * unitMsForAgo);
    }
    const inMatchForRelative = normalizedForRelative.match(new RegExp('\\bin\\s+(\\d+(?:\\.\\d+)?|an?|one)\\s*' + RELATIVE_UNIT_PATTERN_FOR_LAYOUT_RULES + '\\b'));
    if (inMatchForRelative) {
      const amountForIn = /^\d/.test(inMatchForRelative[1]) ? Number(inMatchForRelative[1]) : 1;
      const unitMsForIn = unitMsForLayoutRules(inMatchForRelative[2]);
      if (unitMsForIn) return Math.round(nowForRelative + amountForIn * unitMsForIn);
    }
    return null;
  }

  // The clock time in a piece of text as [hours, minutes, seconds], or [0, 0, 0] when there is none
  // that makes sense.
  function clockTimeForLayoutRules(textForClock) {
    const matchForClock = CLOCK_TIME_PATTERN_FOR_LAYOUT_RULES.exec(textForClock || '');
    if (!matchForClock) return [0, 0, 0];
    let hoursForClock = Number(matchForClock[1] !== undefined ? matchForClock[1] : matchForClock[5]);
    const minutesForClock = Number(matchForClock[2] || 0);
    const secondsForClock = Number(matchForClock[3] || 0);
    const meridiemForClock = (matchForClock[4] || matchForClock[6] || '').toLowerCase();
    if (meridiemForClock) {
      if (hoursForClock < 1 || hoursForClock > 12) return [0, 0, 0];
      hoursForClock = hoursForClock % 12 + (meridiemForClock === 'p' ? 12 : 0);
    }
    if (hoursForClock > 23 || minutesForClock > 59 || secondsForClock > 59) return [0, 0, 0];
    return [hoursForClock, minutesForClock, secondsForClock];
  }

  // A month and day written without a year ("Sat, Feb 22 · 9:00 AM"), as local time in the year
  // that puts it nearest to now. Date.parse puts such a date in 2001, which sorts it before every
  // real date and makes a list that runs from December into January come out in the wrong order;
  // the nearest year gets that list right. Returns null when there is no month and day.
  function parseMonthDayForLayoutRules(textForMonthDay, nowMsForMonthDay) {
    const matchForMonthDay = MONTH_DAY_PATTERN_FOR_LAYOUT_RULES.exec(textForMonthDay);
    if (!matchForMonthDay) return null;
    const monthNameForMonthDay = (matchForMonthDay[1] || matchForMonthDay[4]).slice(0, 3).toLowerCase();
    const monthForMonthDay = MONTH_ABBREVIATIONS_FOR_LAYOUT_RULES.indexOf(monthNameForMonthDay);
    const dayForMonthDay = Number(matchForMonthDay[2] || matchForMonthDay[3]);
    if (monthForMonthDay === -1 || dayForMonthDay < 1 || dayForMonthDay > 31) return null;
    const timeForMonthDay = clockTimeForLayoutRules(textForMonthDay.slice(matchForMonthDay.index + matchForMonthDay[0].length));
    const nowForMonthDay = Number.isFinite(nowMsForMonthDay) ? nowMsForMonthDay : Date.now();
    const thisYearForMonthDay = new Date(nowForMonthDay).getFullYear();
    let bestForMonthDay = null;
    for (let yearForMonthDay = thisYearForMonthDay - 1; yearForMonthDay <= thisYearForMonthDay + 1; yearForMonthDay++) {
      const dateForMonthDay = new Date(yearForMonthDay, monthForMonthDay, dayForMonthDay, timeForMonthDay[0], timeForMonthDay[1], timeForMonthDay[2]);
      // Feb 30 rolls over into March; that is not a date.
      if (dateForMonthDay.getMonth() !== monthForMonthDay) continue;
      const msForMonthDay = dateForMonthDay.getTime();
      if (bestForMonthDay === null || Math.abs(msForMonthDay - nowForMonthDay) < Math.abs(bestForMonthDay - nowForMonthDay)) bestForMonthDay = msForMonthDay;
    }
    return bestForMonthDay;
  }

  // Returns epoch ms. Only text that looks like a date (a 4-digit year or a month name) is read,
  // because Date.parse on a bare number happily returns a date in 2001. A datetime attribute (from
  // a <time> element) wins over the visible text when present. Separators sites put between a date
  // and its time ("Feb 22 · 9:00 AM", "Feb 22 at 9:00") and ordinals ("22nd") are taken out first,
  // since Date.parse gives up on them. Text with a year goes to Date.parse, which also knows
  // numeric and zoned forms; text without one is read as a month and day in the nearest year.
  function parseDateForLayoutRules(textForDate, datetimeAttrForDate, nowMsForDate) {
    const attrForDate = normalizeTextForLayoutRules(datetimeAttrForDate);
    if (attrForDate) {
      const attrMsForDate = Date.parse(attrForDate);
      if (Number.isFinite(attrMsForDate)) return attrMsForDate;
    }
    const normalizedForDate = normalizeTextForLayoutRules(String(textForDate == null ? '' : textForDate)
      .replace(/[\u00b7\u2022|]/g, ' ')
      .replace(/(\d)(?:st|nd|rd|th)\b/gi, '$1')
      .replace(/\s(?:at|@|[-\u2013\u2014])\s+(?=\d{1,2}(?::\d{2}|\s*[ap]\.?\s?m\b))/gi, ' '));
    if (!normalizedForDate) return null;
    const monthRegexForDate = new RegExp(MONTH_NAME_PATTERN_FOR_LAYOUT_RULES, 'i');
    if (!/\b\d{4}\b/.test(normalizedForDate)) {
      return monthRegexForDate.test(normalizedForDate) ? parseMonthDayForLayoutRules(normalizedForDate, nowMsForDate) : null;
    }
    const candidatesForDate = [normalizedForDate];
    const isoMatchForDate = normalizedForDate.match(/\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/);
    if (isoMatchForDate) candidatesForDate.unshift(isoMatchForDate[0]);
    const monthFirstMatchForDate = normalizedForDate.match(new RegExp(MONTH_NAME_PATTERN_FOR_LAYOUT_RULES + '\\s+\\d{1,2},?\\s+\\d{4}', 'i'));
    if (monthFirstMatchForDate) candidatesForDate.push(monthFirstMatchForDate[0]);
    const dayFirstMatchForDate = normalizedForDate.match(new RegExp('\\d{1,2}\\s+' + MONTH_NAME_PATTERN_FOR_LAYOUT_RULES + ',?\\s+\\d{4}', 'i'));
    if (dayFirstMatchForDate) candidatesForDate.push(dayFirstMatchForDate[0]);
    for (let iForDate = 0; iForDate < candidatesForDate.length; iForDate++) {
      const msForDate = Date.parse(candidatesForDate[iForDate]);
      if (Number.isFinite(msForDate)) return msForDate;
    }
    return null;
  }

  // Guesses what kind of value a single piece of text holds. Order matters: "12:04" is a duration
  // before it is a number, "3 weeks ago" is a relative time before it is a number, and "1.2M" is a
  // compact number before it is a plain one.
  function detectKindForLayoutRules(textForDetect) {
    const normalizedForDetect = normalizeTextForLayoutRules(textForDetect);
    if (!normalizedForDetect) return 'text';
    if (/^\d{1,3}:\d{2}(?::\d{2})?$/.test(normalizedForDetect)) return 'duration';
    if (/\bago\b|^(yesterday|today|just now)$/i.test(normalizedForDetect)) return 'relative_time';
    if (/^\d+(?:\.\d+)?\s*(h|hrs?|hours?)(\s*\d+\s*(m|mins?|minutes?))?$|^\d+\s*(mins?|minutes?|secs?|seconds?)$/i.test(normalizedForDetect)) return 'duration';
    if (/\d(?:[.,]\d+)?\s*(thousand|million|billion|trillion|bn|[kmbt])(?![a-z])/i.test(normalizedForDetect)) return 'compact_number';
    if (/^no\s+\w+$/i.test(normalizedForDetect)) return 'compact_number';
    if (parseDateForLayoutRules(normalizedForDetect, '') !== null && new RegExp(MONTH_NAME_PATTERN_FOR_LAYOUT_RULES, 'i').test(normalizedForDetect)) return 'date';
    if (/^\d{4}-\d{2}-\d{2}/.test(normalizedForDetect)) return 'date';
    const digitCountForDetect = (normalizedForDetect.match(/\d/g) || []).length;
    const letterCountForDetect = (normalizedForDetect.match(/\p{L}/gu) || []).length;
    if (digitCountForDetect > 0 && letterCountForDetect <= 12) return 'number';
    return 'text';
  }

  // Picks one kind for a column of values: the most common non-text kind when it covers at least
  // 60% of the non-empty values, otherwise text. A column like ["1.2M views", "No views", "340K
  // views"] resolves to compact_number; a column of titles stays text.
  function chooseKindForValuesForLayoutRules(textsForChoose) {
    const countsForChoose = {};
    let nonEmptyForChoose = 0;
    (Array.isArray(textsForChoose) ? textsForChoose : []).forEach(function (textForChoose) {
      const normalizedForChoose = normalizeTextForLayoutRules(textForChoose);
      if (!normalizedForChoose) return;
      nonEmptyForChoose++;
      const kindForChoose = detectKindForLayoutRules(normalizedForChoose);
      countsForChoose[kindForChoose] = (countsForChoose[kindForChoose] || 0) + 1;
    });
    if (!nonEmptyForChoose) return 'text';
    // compact_number subsumes number: "1,234 views" and "1.2M views" in one column is one kind.
    if (countsForChoose.compact_number && countsForChoose.number) {
      countsForChoose.compact_number += countsForChoose.number;
      delete countsForChoose.number;
    }
    let bestKindForChoose = 'text';
    let bestCountForChoose = 0;
    Object.keys(countsForChoose).forEach(function (kindForBest) {
      if (kindForBest === 'text') return;
      if (countsForChoose[kindForBest] > bestCountForChoose) {
        bestKindForChoose = kindForBest;
        bestCountForChoose = countsForChoose[kindForBest];
      }
    });
    return bestCountForChoose >= Math.ceil(nonEmptyForChoose * 0.6) ? bestKindForChoose : 'text';
  }

  function isValidParserForLayoutRules(parserForValid) {
    return PARSERS_FOR_LAYOUT_RULES.indexOf(parserForValid) !== -1;
  }

  // Parses text as the given kind. Returns a number (for every kind except text), a lowercase
  // string (text), or null when the text holds no value of that kind. Never throws.
  function parseValueForLayoutRules(textForParse, kindForParse, optionsForParse) {
    const optsForParse = optionsForParse || {};
    const normalizedForParse = normalizeTextForLayoutRules(textForParse);
    let kindResolvedForParse = kindForParse;
    if (!kindResolvedForParse || kindResolvedForParse === 'auto') kindResolvedForParse = detectKindForLayoutRules(normalizedForParse);
    switch (kindResolvedForParse) {
      case 'number': return parseNumberForLayoutRules(normalizedForParse);
      case 'compact_number': return parseCompactNumberForLayoutRules(normalizedForParse);
      case 'duration': return parseDurationForLayoutRules(normalizedForParse);
      case 'relative_time': return parseRelativeTimeForLayoutRules(normalizedForParse, optsForParse.nowMs);
      case 'date': return parseDateForLayoutRules(normalizedForParse, optsForParse.datetimeAttr, optsForParse.nowMs);
      default: return normalizedForParse ? normalizedForParse.toLowerCase() : null;
    }
  }

  function compareKeysForLayoutRules(aForCompare, bForCompare, kindForCompare) {
    if (kindForCompare === 'text') {
      return String(aForCompare).localeCompare(String(bForCompare), undefined, { numeric: true, sensitivity: 'base' });
    }
    return aForCompare < bForCompare ? -1 : (aForCompare > bForCompare ? 1 : 0);
  }

  // Returns the permutation of indices that sorts keys. Null keys (missing or unparseable) always
  // go last whatever the direction, and ties keep their original relative order, so sorting an
  // already-sorted list is a no-op and a re-sort after more items load never shuffles equals.
  function sortIndicesForLayoutRules(keysForSort, kindForSort, orderForSort) {
    const directionForSort = orderForSort === 'desc' ? -1 : 1;
    const indicesForSort = (Array.isArray(keysForSort) ? keysForSort : []).map(function (_, iForIndex) { return iForIndex; });
    indicesForSort.sort(function (iA, iB) {
      const keyAForSort = keysForSort[iA];
      const keyBForSort = keysForSort[iB];
      const aMissingForSort = keyAForSort === null || keyAForSort === undefined;
      const bMissingForSort = keyBForSort === null || keyBForSort === undefined;
      if (aMissingForSort && bMissingForSort) return iA - iB;
      if (aMissingForSort) return 1;
      if (bMissingForSort) return -1;
      const cmpForSort = compareKeysForLayoutRules(keyAForSort, keyBForSort, kindForSort) * directionForSort;
      return cmpForSort !== 0 ? cmpForSort : iA - iB;
    });
    return indicesForSort;
  }

  // Direction words a sort label can use, each with the order it means and the kinds of value it
  // can describe. "newest" says nothing about a sort by title, so it is not judged there. Longer
  // phrases come first so "most recent" and "reverse chronological" win over "most" and
  // "chronological".
  const TIME_KINDS_FOR_LAYOUT_RULES = ['date', 'relative_time'];
  const AMOUNT_KINDS_FOR_LAYOUT_RULES = ['number', 'compact_number', 'duration'];
  const SORT_LABEL_WORDS_FOR_LAYOUT_RULES = [
    { pattern: 'reverse chronological', order: 'desc', kinds: TIME_KINDS_FOR_LAYOUT_RULES },
    { pattern: 'reverse alphabetical', order: 'desc', kinds: ['text'] },
    { pattern: 'most recent', order: 'desc', kinds: TIME_KINDS_FOR_LAYOUT_RULES },
    { pattern: 'least recent', order: 'asc', kinds: TIME_KINDS_FOR_LAYOUT_RULES },
    { pattern: 'most expensive', order: 'desc', kinds: AMOUNT_KINDS_FOR_LAYOUT_RULES },
    { pattern: 'new(?:est)? to old(?:est)?', order: 'desc', kinds: TIME_KINDS_FOR_LAYOUT_RULES },
    { pattern: 'old(?:est)? to new(?:est)?', order: 'asc', kinds: TIME_KINDS_FOR_LAYOUT_RULES },
    { pattern: 'high(?:est)? to low(?:est)?', order: 'desc', kinds: AMOUNT_KINDS_FOR_LAYOUT_RULES },
    { pattern: 'low(?:est)? to high(?:est)?', order: 'asc', kinds: AMOUNT_KINDS_FOR_LAYOUT_RULES },
    { pattern: 'z\\s*(?:-|–|to)\\s*a', order: 'desc', kinds: ['text'] },
    { pattern: 'a\\s*(?:-|–|to)\\s*z', order: 'asc', kinds: ['text'] },
    { pattern: 'alphabetical(?:ly)?', order: 'asc', kinds: ['text'] },
    { pattern: 'chronological(?:ly)?', order: 'asc', kinds: TIME_KINDS_FOR_LAYOUT_RULES },
    { pattern: 'newest|latest|newer', order: 'desc', kinds: TIME_KINDS_FOR_LAYOUT_RULES },
    { pattern: 'oldest|earliest|older', order: 'asc', kinds: TIME_KINDS_FOR_LAYOUT_RULES },
    { pattern: 'highest|largest|biggest|longest|most|priciest', order: 'desc', kinds: AMOUNT_KINDS_FOR_LAYOUT_RULES },
    { pattern: 'lowest|smallest|fewest|shortest|least|cheapest', order: 'asc', kinds: AMOUNT_KINDS_FOR_LAYOUT_RULES },
    { pattern: 'descending', order: 'desc', kinds: null },
    { pattern: 'ascending', order: 'asc', kinds: null }
  ];
  const SORT_LABEL_PATTERN_FOR_LAYOUT_RULES = new RegExp('\\b(?:' + SORT_LABEL_WORDS_FOR_LAYOUT_RULES.map(function (wordForPattern) {
    return '(' + wordForPattern.pattern + ')';
  }).join('|') + ')\\b', 'i');

  // The order a sort label states for a field of this kind: 'asc', 'desc', or '' when it states
  // none this file knows. The first direction word decides, so "newest to oldest" is desc. Only
  // English words are known; a label in another language is never judged.
  function sortLabelOrderForLayoutRules(labelForOrder, kindForOrder) {
    const matchForOrder = SORT_LABEL_PATTERN_FOR_LAYOUT_RULES.exec(normalizeTextForLayoutRules(labelForOrder));
    if (!matchForOrder) return '';
    for (let iForWord = 0; iForWord < SORT_LABEL_WORDS_FOR_LAYOUT_RULES.length; iForWord++) {
      if (matchForOrder[iForWord + 1] === undefined) continue;
      const wordForOrder = SORT_LABEL_WORDS_FOR_LAYOUT_RULES[iForWord];
      if (wordForOrder.kinds && wordForOrder.kinds.indexOf(kindForOrder) === -1) return '';
      return wordForOrder.order;
    }
    return '';
  }

  // Validates a filter spec once and returns a predicate over an item's raw field text. The
  // comparison value is parsed with the same kind as the field, so "5:00" against a duration
  // column means 300 seconds and "1M" against a view count means one million. An item whose field
  // does not parse never matches an ordering comparison: with mode "hide" it stays visible, with
  // mode "keep" it is hidden, which is what "only show videos over 1M views" should do to a live
  // stream that has no view count.
  function buildFilterPredicateForLayoutRules(specForFilter) {
    const spec = specForFilter || {};
    const opForFilter = String(spec.op || '').toLowerCase();
    if (FILTER_OPS_FOR_LAYOUT_RULES.indexOf(opForFilter) === -1) {
      return { ok: false, error: 'Unknown filter op "' + spec.op + '". Use one of: ' + FILTER_OPS_FOR_LAYOUT_RULES.join(', ') + '.' };
    }
    const rawValueForFilter = spec.value == null ? '' : normalizeTextForLayoutRules(spec.value);
    const needsValueForFilter = opForFilter !== 'empty' && opForFilter !== 'not_empty';
    if (needsValueForFilter && !rawValueForFilter) {
      return { ok: false, error: 'Filter op "' + opForFilter + '" needs a value.' };
    }
    let kindForFilter = spec.kind || 'auto';
    if (!isValidParserForLayoutRules(kindForFilter)) {
      return { ok: false, error: 'Unknown parse "' + kindForFilter + '". Use one of: ' + PARSERS_FOR_LAYOUT_RULES.join(', ') + '.' };
    }
    if (TEXT_ONLY_OPS_FOR_LAYOUT_RULES[opForFilter]) {
      kindForFilter = 'text';
    } else if (kindForFilter === 'auto') {
      kindForFilter = detectKindForLayoutRules(rawValueForFilter);
    }
    const nowMsForFilter = Number.isFinite(spec.nowMs) ? spec.nowMs : Date.now();
    const operandForFilter = needsValueForFilter
      ? parseValueForLayoutRules(rawValueForFilter, kindForFilter, { nowMs: nowMsForFilter })
      : null;
    if (needsValueForFilter && operandForFilter === null) {
      return { ok: false, error: 'Could not read "' + rawValueForFilter + '" as ' + kindForFilter + '.' };
    }
    const needleForFilter = rawValueForFilter.toLowerCase();
    function testForFilter(rawTextForTest, datetimeAttrForTest) {
      const textForTest = normalizeTextForLayoutRules(rawTextForTest);
      if (opForFilter === 'empty') return !textForTest;
      if (opForFilter === 'not_empty') return !!textForTest;
      if (opForFilter === 'contains') return textForTest.toLowerCase().indexOf(needleForFilter) !== -1;
      if (opForFilter === 'not_contains') return textForTest.toLowerCase().indexOf(needleForFilter) === -1;
      const keyForTest = parseValueForLayoutRules(textForTest, kindForFilter, { nowMs: nowMsForFilter, datetimeAttr: datetimeAttrForTest });
      if (keyForTest === null) return false;
      const cmpForTest = compareKeysForLayoutRules(keyForTest, operandForFilter, kindForFilter);
      switch (opForFilter) {
        case 'lt': return cmpForTest < 0;
        case 'lte': return cmpForTest <= 0;
        case 'gt': return cmpForTest > 0;
        case 'gte': return cmpForTest >= 0;
        case 'eq': return cmpForTest === 0;
        case 'neq': return cmpForTest !== 0;
        default: return false;
      }
    }
    return { ok: true, kind: kindForFilter, op: opForFilter, test: testForFilter };
  }

  // Properties a style change may set. Layout, spacing, sizing, typography, colour and borders:
  // enough to widen a column, enlarge text, unstick a header, recolour or hide a block.
  const ALLOWED_STYLE_PROPERTIES_FOR_LAYOUT_RULES = [
    'display', 'visibility', 'opacity', 'order',
    'flex', 'flex-direction', 'flex-wrap', 'flex-flow', 'flex-grow', 'flex-shrink', 'flex-basis',
    'justify-content', 'justify-items', 'justify-self', 'align-items', 'align-self', 'align-content', 'place-items', 'place-content',
    'gap', 'row-gap', 'column-gap',
    'grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-column', 'grid-row', 'grid-area', 'grid-auto-flow', 'grid-auto-columns', 'grid-auto-rows',
    'columns', 'column-count', 'column-width',
    'float', 'clear',
    'position', 'top', 'right', 'bottom', 'left',
    'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height', 'aspect-ratio', 'box-sizing',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'margin-inline', 'margin-block',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'padding-inline', 'padding-block',
    'overflow', 'overflow-x', 'overflow-y',
    'font-size', 'font-weight', 'font-style', 'font-family', 'line-height', 'letter-spacing', 'word-spacing',
    'text-align', 'text-transform', 'text-decoration', 'text-indent', 'white-space', 'word-break', 'overflow-wrap',
    'color', 'background-color', 'background', 'accent-color',
    'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-color', 'border-width', 'border-style', 'border-radius',
    'outline', 'outline-color', 'outline-width', 'outline-style', 'outline-offset', 'box-shadow',
    'object-fit', 'object-position', 'filter'
  ];
  const ALLOWED_STYLE_PROPERTY_SET_FOR_LAYOUT_RULES = new Set(ALLOWED_STYLE_PROPERTIES_FOR_LAYOUT_RULES);
  const ALLOWED_POSITION_VALUES_FOR_LAYOUT_RULES = { static: true, relative: true, sticky: true };
  const FORBIDDEN_STYLE_VALUE_PATTERN_FOR_LAYOUT_RULES = /url\s*\(|image-set\s*\(|image\s*\(|element\s*\(|attr\s*\(|expression\s*\(|paint\s*\(|javascript:|@|[<>{};\\]|\/\*/i;
  const MAX_STYLE_DECLARATIONS_FOR_LAYOUT_RULES = 20;
  const MAX_STYLE_VALUE_LENGTH_FOR_LAYOUT_RULES = 200;

  function toKebabCaseForLayoutRules(propForKebab) {
    return String(propForKebab || '').trim().replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  }

  // Accepts { "font-size": "18px" }, { fontSize: 18 } or "font-size: 18px; color: red". Returns
  // { ok, declarations: [{ prop, value }], rejected: [{ prop, reason }] }. A trailing !important is
  // dropped from the value because every declaration is applied as important anyway.
  function sanitizeStyleDeclarationsForLayoutRules(cssForSanitize) {
    const pairsForSanitize = [];
    if (typeof cssForSanitize === 'string') {
      cssForSanitize.split(';').forEach(function (chunkForSanitize) {
        const colonForSanitize = chunkForSanitize.indexOf(':');
        if (colonForSanitize === -1) {
          if (chunkForSanitize.trim()) pairsForSanitize.push([chunkForSanitize.trim(), '']);
          return;
        }
        pairsForSanitize.push([chunkForSanitize.slice(0, colonForSanitize), chunkForSanitize.slice(colonForSanitize + 1)]);
      });
    } else if (cssForSanitize && typeof cssForSanitize === 'object' && !Array.isArray(cssForSanitize)) {
      Object.keys(cssForSanitize).forEach(function (keyForSanitize) {
        pairsForSanitize.push([keyForSanitize, cssForSanitize[keyForSanitize]]);
      });
    } else {
      return { ok: false, declarations: [], rejected: [], error: 'css must be an object of property to value, e.g. { "font-size": "18px" }.' };
    }
    const declarationsForSanitize = [];
    const rejectedForSanitize = [];
    const seenForSanitize = new Set();
    pairsForSanitize.forEach(function (pairForSanitize) {
      const propForSanitize = toKebabCaseForLayoutRules(pairForSanitize[0]);
      if (!propForSanitize) return;
      if (!ALLOWED_STYLE_PROPERTY_SET_FOR_LAYOUT_RULES.has(propForSanitize)) {
        rejectedForSanitize.push({ prop: propForSanitize, reason: 'property not allowed' });
        return;
      }
      const rawValueForSanitize = pairForSanitize[1];
      if (typeof rawValueForSanitize !== 'string' && typeof rawValueForSanitize !== 'number') {
        rejectedForSanitize.push({ prop: propForSanitize, reason: 'value must be a string or number' });
        return;
      }
      let valueForSanitize = String(rawValueForSanitize).trim().replace(/\s*!\s*important\s*$/i, '').trim();
      if (!valueForSanitize) {
        rejectedForSanitize.push({ prop: propForSanitize, reason: 'empty value' });
        return;
      }
      if (valueForSanitize.length > MAX_STYLE_VALUE_LENGTH_FOR_LAYOUT_RULES) {
        rejectedForSanitize.push({ prop: propForSanitize, reason: 'value too long' });
        return;
      }
      if (FORBIDDEN_STYLE_VALUE_PATTERN_FOR_LAYOUT_RULES.test(valueForSanitize)) {
        rejectedForSanitize.push({ prop: propForSanitize, reason: 'value may not load resources or contain url(), attr(), braces, semicolons or comments' });
        return;
      }
      if (propForSanitize === 'position' && !ALLOWED_POSITION_VALUES_FOR_LAYOUT_RULES[valueForSanitize.toLowerCase()]) {
        rejectedForSanitize.push({ prop: propForSanitize, reason: 'position may only be static, relative, or sticky' });
        return;
      }
      if (seenForSanitize.has(propForSanitize)) {
        for (let iForDupe = 0; iForDupe < declarationsForSanitize.length; iForDupe++) {
          if (declarationsForSanitize[iForDupe].prop === propForSanitize) declarationsForSanitize[iForDupe].value = valueForSanitize;
        }
        return;
      }
      if (declarationsForSanitize.length >= MAX_STYLE_DECLARATIONS_FOR_LAYOUT_RULES) {
        rejectedForSanitize.push({ prop: propForSanitize, reason: 'too many declarations (max ' + MAX_STYLE_DECLARATIONS_FOR_LAYOUT_RULES + ')' });
        return;
      }
      seenForSanitize.add(propForSanitize);
      declarationsForSanitize.push({ prop: propForSanitize, value: valueForSanitize });
    });
    return {
      ok: declarationsForSanitize.length > 0,
      declarations: declarationsForSanitize,
      rejected: rejectedForSanitize,
      error: declarationsForSanitize.length ? '' : 'No allowed CSS declarations were given.'
    };
  }

  // ---------------------------------------------------------------- replay records
  //
  // Every page_layout apply, undo and reset from the agent leaves a record on its tool message. An
  // apply lists each change with a replay spec (where its target sits in terms that survive a
  // reload, plus the action's values). An undo or reset lists the change ids it removed and, in
  // `keys` at the same positions, the key of each one that came from a chat. The chat offers each
  // reply's changes, and the whole chat's, for replay on a later visit.

  const REPLAY_ACTIONS_FOR_LAYOUT_RULES = ['sort', 'filter', 'hide', 'style'];
  const MAX_REPLAY_CSS_PROPERTIES_FOR_LAYOUT_RULES = 20;
  const MAX_RECORD_KEY_CHARS_FOR_LAYOUT_RULES = 120;

  function boundedStringForLayoutRules(valueForBound, maxForBound) {
    return typeof valueForBound === 'string' ? valueForBound.slice(0, maxForBound) : '';
  }

  // The changes a run of records left on the page, in the order they were made. The records are one
  // reply's for that reply's row, or the whole chat's for its Apply all. Change ids restart after a
  // navigation, so an id names a change only within its own page load. A key names the same change
  // in every page load, including after the chat applies it again, which writes no record. So an
  // undo, a reset, or a sort that replaced an earlier sort removes by key when the record has one,
  // and by page load and id when it does not (records written before keys were kept).
  function netPageChangesForLayoutRules(recordsForNet) {
    const liveForNet = [];
    function removeChangeForNet(sessionForRemove, changeIdForRemove) {
      for (let iForRemove = liveForNet.length - 1; iForRemove >= 0; iForRemove--) {
        if (liveForNet[iForRemove].session === sessionForRemove && liveForNet[iForRemove].changeId === changeIdForRemove) {
          liveForNet.splice(iForRemove, 1);
          return;
        }
      }
    }
    function removeKeyForNet(keyForRemove) {
      const boundedKeyForRemove = keyForRemove.slice(0, MAX_RECORD_KEY_CHARS_FOR_LAYOUT_RULES);
      for (let iForKey = liveForNet.length - 1; iForKey >= 0; iForKey--) {
        if (liveForNet[iForKey].key === boundedKeyForRemove) liveForNet.splice(iForKey, 1);
      }
    }
    (Array.isArray(recordsForNet) ? recordsForNet : []).forEach(function (recordForNet) {
      if (!recordForNet || typeof recordForNet !== 'object') return;
      const sessionForNet = boundedStringForLayoutRules(recordForNet.session, 40);
      const originForNet = boundedStringForLayoutRules(recordForNet.origin, 300);
      if (recordForNet.op === 'apply' && Array.isArray(recordForNet.items)) {
        recordForNet.items.forEach(function (itemForNet) {
          if (!itemForNet || typeof itemForNet.key !== 'string' || !itemForNet.key) return;
          if (!itemForNet.spec || typeof itemForNet.spec !== 'object') return;
          if (typeof itemForNet.replaces_key === 'string' && itemForNet.replaces_key) removeKeyForNet(itemForNet.replaces_key);
          else if (typeof itemForNet.replaces === 'string' && itemForNet.replaces) removeChangeForNet(sessionForNet, itemForNet.replaces);
          removeKeyForNet(itemForNet.key);
          liveForNet.push({
            session: sessionForNet,
            changeId: boundedStringForLayoutRules(itemForNet.change_id, 20),
            key: itemForNet.key.slice(0, MAX_RECORD_KEY_CHARS_FOR_LAYOUT_RULES),
            origin: originForNet,
            action: boundedStringForLayoutRules(itemForNet.action, 20),
            description: boundedStringForLayoutRules(itemForNet.description, 200),
            spec: itemForNet.spec
          });
        });
      } else if ((recordForNet.op === 'undo' || recordForNet.op === 'reset') && Array.isArray(recordForNet.changeIds)) {
        const keysForNet = Array.isArray(recordForNet.keys) ? recordForNet.keys : [];
        recordForNet.changeIds.forEach(function (changeIdForNet, indexForNet) {
          const keyForNet = keysForNet[indexForNet];
          if (typeof keyForNet === 'string' && keyForNet) removeKeyForNet(keyForNet);
          else if (typeof changeIdForNet === 'string') removeChangeForNet(sessionForNet, changeIdForNet);
        });
      }
    });
    return liveForNet.map(function (entryForOut) {
      return { key: entryForOut.key, origin: entryForOut.origin, action: entryForOut.action, description: entryForOut.description, spec: entryForOut.spec };
    });
  }

  // Checks a stored replay spec and returns a copy holding only known keys of the expected types,
  // or null. It runs before every replay: the values it passes on then go through the same checks
  // as the model's own arguments (filter ops, parsers, the CSS allowlist).
  function sanitizeReplaySpecForLayoutRules(rawForSpec) {
    if (!rawForSpec || typeof rawForSpec !== 'object' || Array.isArray(rawForSpec)) return null;
    const actionForSpec = boundedStringForLayoutRules(rawForSpec.action, 20).toLowerCase();
    if (REPLAY_ACTIONS_FOR_LAYOUT_RULES.indexOf(actionForSpec) === -1) return null;
    const specOut = { action: actionForSpec };
    const collectionForSpec = rawForSpec.collection;
    const regionForSpec = rawForSpec.region;
    if (collectionForSpec && typeof collectionForSpec === 'object') {
      if (typeof collectionForSpec.itemSig !== 'string' || !collectionForSpec.itemSig || typeof collectionForSpec.clusterKey !== 'string' || !collectionForSpec.clusterKey) return null;
      specOut.collection = {
        itemSig: collectionForSpec.itemSig.slice(0, 400),
        clusterKey: collectionForSpec.clusterKey.slice(0, 1200),
        label: boundedStringForLayoutRules(collectionForSpec.label, 80)
      };
      // The title of the part of the page the list sits in, kept only for a list the scan told
      // apart from another one built from the same markup. An empty title is a real value here.
      if (typeof collectionForSpec.section === 'string') specOut.collection.section = collectionForSpec.section.slice(0, 200);
    } else if (regionForSpec && typeof regionForSpec === 'object') {
      if (typeof regionForSpec.sig !== 'string' || !regionForSpec.sig) return null;
      specOut.region = {
        sig: regionForSpec.sig.slice(0, 400),
        chain: boundedStringForLayoutRules(regionForSpec.chain, 6000),
        id: boundedStringForLayoutRules(regionForSpec.id, 40),
        kind: boundedStringForLayoutRules(regionForSpec.kind, 20),
        label: boundedStringForLayoutRules(regionForSpec.label, 80)
      };
    } else {
      return null;
    }
    const fieldForSpec = rawForSpec.field;
    if (fieldForSpec && typeof fieldForSpec === 'object' && specOut.collection) {
      if (fieldForSpec.path === '*') {
        specOut.field = { path: '*' };
      } else if (typeof fieldForSpec.path === 'string') {
        specOut.field = {
          path: fieldForSpec.path.slice(0, 2000),
          paths: (Array.isArray(fieldForSpec.paths) ? fieldForSpec.paths : []).filter(function (pathForSpec) {
            return typeof pathForSpec === 'string';
          }).slice(0, 12).map(function (pathForSpec) { return pathForSpec.slice(0, 2000); }),
          loose: boundedStringForLayoutRules(fieldForSpec.loose, 2000),
          kind: isValidParserForLayoutRules(fieldForSpec.kind) && fieldForSpec.kind !== 'auto' ? fieldForSpec.kind : 'text'
        };
      }
    }
    if (actionForSpec === 'sort' || actionForSpec === 'filter') {
      if (!specOut.collection) return null;
      specOut.parse = isValidParserForLayoutRules(rawForSpec.parse) ? rawForSpec.parse : 'auto';
    }
    if (actionForSpec === 'sort') {
      // A reversal of the page's own order reads no field.
      if (rawForSpec.order === 'reverse') {
        specOut.order = 'reverse';
        delete specOut.field;
      } else {
        if (!specOut.field || specOut.field.path === '*') return null;
        specOut.order = rawForSpec.order === 'desc' ? 'desc' : 'asc';
      }
    }
    if (actionForSpec === 'filter') {
      if (!specOut.field) specOut.field = { path: '*' };
      specOut.op = boundedStringForLayoutRules(rawForSpec.op, 20);
      specOut.value = typeof rawForSpec.value === 'number' && Number.isFinite(rawForSpec.value)
        ? rawForSpec.value
        : boundedStringForLayoutRules(rawForSpec.value, 200);
      specOut.mode = rawForSpec.mode === 'keep' ? 'keep' : 'hide';
    }
    if (actionForSpec === 'style') {
      const cssForSpec = rawForSpec.css;
      if (!cssForSpec || typeof cssForSpec !== 'object' || Array.isArray(cssForSpec)) return null;
      const cssOut = {};
      Object.keys(cssForSpec).slice(0, MAX_REPLAY_CSS_PROPERTIES_FOR_LAYOUT_RULES).forEach(function (propForSpec) {
        if (typeof cssForSpec[propForSpec] === 'string') cssOut[propForSpec.slice(0, 60)] = cssForSpec[propForSpec].slice(0, 200);
      });
      if (!Object.keys(cssOut).length) return null;
      specOut.css = cssOut;
      if (specOut.collection && rawForSpec.part === 'items') specOut.part = 'items';
    }
    if ((actionForSpec === 'hide' || actionForSpec === 'style') && specOut.field && specOut.field.path === '*') delete specOut.field;
    specOut.label = boundedStringForLayoutRules(rawForSpec.label, 80);
    return specOut;
  }

  nsForLayoutRules.pageLayoutRules = {
    PARSERS: PARSERS_FOR_LAYOUT_RULES.slice(),
    FILTER_OPS: FILTER_OPS_FOR_LAYOUT_RULES.slice(),
    ALLOWED_STYLE_PROPERTIES: ALLOWED_STYLE_PROPERTIES_FOR_LAYOUT_RULES.slice(),
    normalizeText: normalizeTextForLayoutRules,
    truncateText: truncateTextForLayoutRules,
    fieldIdForIndex: fieldIdForIndexForLayoutRules,
    parseNumber: parseNumberForLayoutRules,
    parseCompactNumber: parseCompactNumberForLayoutRules,
    parseDuration: parseDurationForLayoutRules,
    parseRelativeTime: parseRelativeTimeForLayoutRules,
    parseDate: parseDateForLayoutRules,
    detectKind: detectKindForLayoutRules,
    chooseKindForValues: chooseKindForValuesForLayoutRules,
    isValidParser: isValidParserForLayoutRules,
    parseValue: parseValueForLayoutRules,
    sortIndices: sortIndicesForLayoutRules,
    sortLabelOrder: sortLabelOrderForLayoutRules,
    buildFilterPredicate: buildFilterPredicateForLayoutRules,
    sanitizeStyleDeclarations: sanitizeStyleDeclarationsForLayoutRules,
    netPageChanges: netPageChangesForLayoutRules,
    sanitizeReplaySpec: sanitizeReplaySpecForLayoutRules
  };
  globalScopeForLayoutRules.ABChatContent = nsForLayoutRules;

  if (typeof module === 'object' && module && module.exports) {
    module.exports = nsForLayoutRules.pageLayoutRules;
  }
})();
