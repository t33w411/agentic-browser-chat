"""Builds lib/docx-preview.js from the upstream docx-preview 0.4.1 release.

The Word-to-PDF converter (agent/docxToPdf.js) needs changes to docx-preview that upstream does not
have. This script applies every one of them to the published file, so the vendored copy can be
rebuilt, or moved to a new upstream release, instead of being edited by hand. Each change is marked
"abchat patch" in the output, and the header comment it writes lists them, as the Apache-2.0
licence asks of a modified file.

Usage:
    npm pack docx-preview@0.4.1          # in an empty scratch directory
    tar -xzf docx-preview-0.4.1.tgz
    python3 -I scripts/patch-docx-preview.py package/dist/docx-preview.js lib/docx-preview.js

Every replacement must match the upstream text exactly once, or the script stops with the text it
could not find. A new upstream release that moved the code fails here rather than producing a file
with some changes missing.
"""
import sys

if len(sys.argv) != 3:
    sys.exit('usage: patch-docx-preview.py <upstream dist/docx-preview.js> <output file>')
src = open(sys.argv[1], encoding='utf-8').read()

def rep(old, new):
    global src
    n = src.count(old)
    assert n == 1, (n, old[:120])
    src = src.replace(old, new)

# 0. Header: what was changed, as the Apache-2.0 licence asks.
rep("""/*
 * @license
 * docx-preview <https://github.com/VolodymyrBaydalka/docxjs>
 * Released under Apache License 2.0  <https://github.com/VolodymyrBaydalka/docxjs/blob/master/LICENSE>
 * Copyright Volodymyr Baydalka
 */""", """/*
 * @license
 * docx-preview <https://github.com/VolodymyrBaydalka/docxjs>
 * Released under Apache License 2.0  <https://github.com/VolodymyrBaydalka/docxjs/blob/master/LICENSE>
 * Copyright Volodymyr Baydalka
 *
 * Version 0.4.1, modified for Agentic Browser Chat. Every change is marked "abchat patch" and is
 * for converting a DOCX to a PDF in agent/docxToPdf.js:
 *   - font names are reduced to safe characters before they are written into CSS;
 *   - a run that names only an East Asian font keeps the Latin font it inherits;
 *   - row alignment (w:trPr/w:jc) no longer sets text-align on the row's cells;
 *   - header rows, rows that may not split, keep-with-next, keep-lines, widow control, contextual
 *     spacing, the paragraph style and the paragraph mark's size are written as data-abchat-*
 *     attributes for the paginator, and a paragraph with no style takes these from the default
 *     paragraph style;
 *   - a style's own paragraph and run properties win over its base style's, and a style with none
 *     of its own inherits them;
 *   - the default table style's cell margins are applied to the cells;
 *   - PAGE, NUMPAGES and SECTIONPAGES field results, simple and complex, are marked so the
 *     paginator can fill them in;
 *   - VML pictures (watermarks) render as img and VML text boxes as span, never as svg, and a text
 *     box carries its outline, fill and inner margins for the converter to draw;
 *   - drawings and VML pictures render as span rather than div, because a div inside a paragraph
 *     does not survive the page being written out as HTML and parsed again;
 *   - a drawing anchored to the page or its margins carries its position for the paginator;
 *   - each page keeps its section's header and footer variants for the pages the paginator adds;
 *   - tab stops are measured when the caller asks, not on a timer, and against the paragraph
 *     inside a text box when the converter has renamed it;
 *   - the default run properties apply to paragraphs as well as runs.
 */""")

# 1. Font names reach CSS text unescaped; keep only characters a family name needs.
rep("""    function encloseFontFamily(fontFamily) {
        return /^[^"'].*\\s.*[^"']$/.test(fontFamily) ? `'${fontFamily}'` : fontFamily;
    }""", """    function encloseFontFamily(fontFamily) {
        // abchat patch: a font name from the file is written into CSS, so it keeps only letters,
        // digits, spaces, dots and hyphens, and is always quoted.
        const clean = String(fontFamily ?? "").replace(/[^\\p{L}\\p{N} .\\-]/gu, "").trim();
        return clean ? `"${clean}"` : "serif";
    }""")

# 2. eastAsia only as a fallback after a Latin font.
rep("""        parseFont(node, style) {
            var ascii = globalXmlParser.attr(node, "ascii");
            var asciiTheme = values.themeValue(node, "asciiTheme");
            var eastAsia = globalXmlParser.attr(node, "eastAsia");
            var fonts = [ascii, asciiTheme, eastAsia].filter(x => x).map(x => encloseFontFamily(x));
            if (fonts.length > 0)
                style["font-family"] = [...new Set(fonts)].join(', ');
        }""", """        parseFont(node, style) {
            // abchat patch: Word sets Latin text in the ascii or hAnsi font and uses eastAsia only for
            // East Asian characters. A run that names only eastAsia keeps the Latin font it inherits;
            // listing eastAsia first printed a CV's English text in an East Asian font's Latin glyphs.
            var ascii = globalXmlParser.attr(node, "ascii") || globalXmlParser.attr(node, "hAnsi");
            var asciiTheme = values.themeValue(node, "asciiTheme") || values.themeValue(node, "hAnsiTheme");
            var eastAsia = globalXmlParser.attr(node, "eastAsia");
            if (!ascii && !asciiTheme)
                return;
            var fonts = [ascii && encloseFontFamily(ascii), asciiTheme, eastAsia && encloseFontFamily(eastAsia)].filter(x => x);
            style["font-family"] = [...new Set(fonts)].join(', ');
        }""")

# 3. Theme typefaces are written into CSS custom properties.
rep("""                if (fontScheme.majorFont) {
                    variables['--docx-majorHAnsi-font'] = fontScheme.majorFont.latinTypeface;
                }
                if (fontScheme.minorFont) {
                    variables['--docx-minorHAnsi-font'] = fontScheme.minorFont.latinTypeface;
                }""", """                // abchat patch: theme typefaces are cleaned like any other font name.
                if (fontScheme.majorFont) {
                    variables['--docx-majorHAnsi-font'] = encloseFontFamily(fontScheme.majorFont.latinTypeface);
                }
                if (fontScheme.minorFont) {
                    variables['--docx-minorHAnsi-font'] = encloseFontFamily(fontScheme.minorFont.latinTypeface);
                }""")

# 4. Line spacing: Word scales "auto" spacing by the font's own line height, not by its size.
rep("""                    case "auto":
                        style["line-height"] = `${(line / 240).toFixed(2)}`;
                        break;
                    case "atLeast":
                        style["line-height"] = `calc(100% + ${line / 20}pt)`;
                        break;""", """                    // abchat patch: Word's "auto" spacing is a multiple of the font's own line height
                    // (ascent, descent and gap), and "atLeast" is the larger of that and the value.
                    // --abchat-lh is that height over the font size, set per paragraph by the paginator.
                    case "auto":
                        style["line-height"] = `calc(var(--abchat-lh, 1.15) * ${(line / 240).toFixed(3)})`;
                        break;
                    case "atLeast":
                        style["line-height"] = `max(calc(var(--abchat-lh, 1.15) * 1em), ${line / 20}pt)`;
                        break;""")

# 5. widowControl and contextualSpacing are read.
rep("""            case "keepNext":
                props.keepNext = xml.boolAttr(elem, "val", true);
                break;
            case "pageBreakBefore":""", """            case "keepNext":
                props.keepNext = xml.boolAttr(elem, "val", true);
                break;
            case "widowControl":
                // abchat patch: read for the paginator.
                props.widowControl = xml.boolAttr(elem, "val", true);
                break;
            case "contextualSpacing":
                // abchat patch: read for the converter.
                props.contextualSpacing = xml.boolAttr(elem, "val", true);
                break;
            case "pageBreakBefore":""")

# 5a. A style's own paragraph and run properties win over its base style's, a style with none of
# its own still inherits them, and every base is resolved before the styles built on it.
rep("""            const stylesMap = keyBy(styles.filter(x => x.id != null), x => x.id);
            for (const style of styles.filter(x => x.basedOn)) {
                var baseStyle = stylesMap[style.basedOn];
                if (baseStyle) {
                    style.paragraphProps = mergeDeep(style.paragraphProps, baseStyle.paragraphProps);
                    style.runProps = mergeDeep(style.runProps, baseStyle.runProps);""", """            const stylesMap = keyBy(styles.filter(x => x.id != null), x => x.id);
            // abchat patch: merging into the style let the base's properties overwrite the style's
            // own, a style with no w:pPr inherited none, and a base listed after a style built on it
            // was not resolved yet. Bases now come first, and the style's own properties win.
            const abchatDepth = (style) => {
                let depth = 0;
                for (let s = style, seen = new Set(); s?.basedOn && !seen.has(s); s = stylesMap[s.basedOn]) {
                    seen.add(s);
                    depth++;
                }
                return depth;
            };
            for (const style of styles.filter(x => x.basedOn).sort((a, b) => abchatDepth(a) - abchatDepth(b))) {
                var baseStyle = stylesMap[style.basedOn];
                if (baseStyle) {
                    style.paragraphProps = mergeDeep(mergeDeep({}, baseStyle.paragraphProps), style.paragraphProps);
                    style.runProps = mergeDeep(mergeDeep({}, baseStyle.runProps), style.runProps);""")

# 6. Row alignment and cantSplit.
rep("""                    case "gridAfter":
                        row.gridAfter = globalXmlParser.intAttr(c, "val");
                        break;
                    default:
                        return false;""", """                    case "gridAfter":
                        row.gridAfter = globalXmlParser.intAttr(c, "val");
                        break;
                    case "jc":
                        // abchat patch: w:trPr/w:jc places the row, it does not align the text in its
                        // cells; as text-align it centred every cell of a centred table.
                        break;
                    case "cantSplit":
                        row.cantSplit = globalXmlParser.boolAttr(c, "val", true);
                        break;
                    default:
                        return false;""")

rep("""            if (elem.gridAfter)
                children.push(this.renderTableCellPlaceholder(elem.gridAfter));
            this.currentCellPosition.row++;
            return this.toHTML(elem, ns.html, "tr", children);""", """            if (elem.gridAfter)
                children.push(this.renderTableCellPlaceholder(elem.gridAfter));
            this.currentCellPosition.row++;
            // abchat patch: header rows repeat on each page, and a cantSplit row moves whole.
            const abchatRow = this.toHTML(elem, ns.html, "tr", children);
            if (elem.isHeader)
                abchatRow.setAttribute("data-abchat-header-row", "1");
            if (elem.cantSplit)
                abchatRow.setAttribute("data-abchat-cant-split", "1");
            return abchatRow;""")

# 7. Paragraph keep rules.
rep("""            const numbering = elem.numbering ?? style?.paragraphProps?.numbering;
            if (numbering) {
                result.classList.add(this.numberingClass(numbering.id, numbering.level));
            }
            return result;
        }""", """            const numbering = elem.numbering ?? style?.paragraphProps?.numbering;
            if (numbering) {
                result.classList.add(this.numberingClass(numbering.id, numbering.level));
            }
            // abchat patch: the paragraph's keep rules, from itself or its style, for the paginator.
            // Word applies widow control unless it is turned off, though no file states it.
            // A paragraph with no style of its own has the default paragraph style.
            if (this.abchatStyleMapSeen !== this.styleMap) {
                this.abchatStyleMapSeen = this.styleMap;
                this.abchatDefaultParagraphStyle = Object.values(this.styleMap ?? {}).find(s => s.isDefault && s.target == "p");
            }
            const abchatStyle = style || this.abchatDefaultParagraphStyle;
            const abchatFlag = (name) => elem[name] ?? abchatStyle?.paragraphProps?.[name];
            if (abchatFlag("keepNext"))
                result.setAttribute("data-abchat-keep-next", "1");
            if (abchatFlag("keepLines"))
                result.setAttribute("data-abchat-keep-lines", "1");
            if (abchatFlag("widowControl") === false)
                result.setAttribute("data-abchat-no-widow-control", "1");
            // Word drops a paragraph's space before and after next to a paragraph of the same style
            // when it has contextual spacing; the converter compares the style ids.
            if (abchatFlag("contextualSpacing"))
                result.setAttribute("data-abchat-contextual", "1");
            result.setAttribute("data-abchat-style", elem.styleName ?? abchatStyle?.id ?? "");
            // abchat patch: the paragraph mark's own size (w:pPr/w:rPr/w:sz), which sets the height of
            // an empty paragraph in Word and is otherwise not rendered.
            if (elem.runProps?.fontSize)
                result.setAttribute("data-abchat-mark-size", elem.runProps.fontSize);
            return result;
        }""")

# 8. Simple fields keep their result runs, marked.
rep("""                    case "bookmarkStart":
                        result.children.push(parseBookmarkStart(el, globalXmlParser));
                        break;""", """                    case "fldSimple": {
                        // abchat patch: keep the field's result runs (they were dropped), marked
                        // when the field is a page number.
                        const abchatKind = abchatFieldKind(globalXmlParser.attr(el, "instr"));
                        for (const fieldRun of globalXmlParser.elements(el, "r")) {
                            const run = this.parseRun(fieldRun, result);
                            if (abchatKind)
                                run.abchatField = abchatKind;
                            result.children.push(run);
                        }
                        break;
                    }
                    case "bookmarkStart":
                        result.children.push(parseBookmarkStart(el, globalXmlParser));
                        break;""")

rep("""    function encloseFontFamily(fontFamily) {""", """    // abchat patch: the page-number fields the paginator fills in.
    function abchatFieldKind(instruction) {
        const match = /^\\s*(PAGE|NUMPAGES|SECTIONPAGES)\\b/i.exec(instruction || "");
        return match ? match[1].toLowerCase() : null;
    }
    function encloseFontFamily(fontFamily) {""")

# 9. Complex fields: track begin/instr/separate/end and mark result runs.
rep("""        renderRun(elem) {
            if (elem.fieldRun)
                return null;
            let children = this.renderElements(elem.children);
            if (elem.verticalAlign) {
                children = [this.h({ tagName: elem.verticalAlign, children: this.renderElements(elem.children) })];
            }
            const result = this.toHTML(elem, ns.html, "span", children);
            if (elem.id)
                result.id = elem.id;
            return result;
        }""", """        renderRun(elem) {
            if (elem.fieldRun) {
                // abchat patch: follow the field so its result runs can be marked.
                this.abchatTrackField(elem);
                return null;
            }
            let children = this.renderElements(elem.children);
            if (elem.verticalAlign) {
                children = [this.h({ tagName: elem.verticalAlign, children: this.renderElements(elem.children) })];
            }
            const result = this.toHTML(elem, ns.html, "span", children);
            if (elem.id)
                result.id = elem.id;
            const abchatKind = elem.abchatField || this.abchatCurrentFieldKind();
            if (abchatKind)
                result.setAttribute("data-abchat-field", abchatKind);
            return result;
        }
        // abchat patch: a stack of open complex fields. A result run is marked with the innermost
        // field that has reached its separator.
        abchatTrackField(elem) {
            this.abchatFields ?? (this.abchatFields = []);
            for (const child of elem.children || []) {
                if (child.type == DomType.ComplexField) {
                    if (child.charType == "begin")
                        this.abchatFields.push({ instruction: "", separated: false });
                    else if (child.charType == "separate" && this.abchatFields.length)
                        this.abchatFields[this.abchatFields.length - 1].separated = true;
                    else if (child.charType == "end")
                        this.abchatFields.pop();
                }
                else if (child.type == DomType.Instruction && this.abchatFields.length) {
                    this.abchatFields[this.abchatFields.length - 1].instruction += child.text || "";
                }
            }
        }
        abchatCurrentFieldKind() {
            const fields = this.abchatFields || [];
            for (let i = fields.length - 1; i >= 0; i--) {
                if (fields[i].separated)
                    return abchatFieldKind(fields[i].instruction);
            }
            return null;
        }""")

# 10. VML: watermark pictures as img, text boxes as span.
rep("""                case "imagedata":
                    result.tagName = "image";
                    Object.assign(result.attrs, { width: '100%', height: '100%' });
                    result.imageHref = {
                        id: globalXmlParser.attr(el, "id"),
                        title: globalXmlParser.attr(el, "title"),
                    };
                    break;""", """                case "imagedata":
                    result.tagName = "image";
                    Object.assign(result.attrs, { width: '100%', height: '100%' });
                    result.imageHref = {
                        id: globalXmlParser.attr(el, "id"),
                        title: globalXmlParser.attr(el, "title"),
                    };
                    // abchat patch: gain or blacklevel is Word's "washout" for a picture watermark.
                    result.abchatWashout = !!(globalXmlParser.attr(el, "gain") || globalXmlParser.attr(el, "blacklevel"));
                    break;""")

rep("""        renderVmlElement(elem) {
            var container = this.h({ ns: ns.svg, tagName: "svg", style: elem.cssStyleText });
            const result = this.renderVmlChildElement(elem);
            if (elem.imageHref?.id) {
                this.tasks.push(this.document?.loadDocumentImage(elem.imageHref.id, this.currentPart)
                    .then(x => result.setAttribute("href", x)));
            }
            container.appendChild(result);
            requestAnimationFrame(() => {
                const bb = container.firstElementChild.getBBox();
                container.setAttribute("width", `${Math.ceil(bb.x + bb.width)}`);
                container.setAttribute("height", `${Math.ceil(bb.y + bb.height)}`);
            });
            return container;
        }""", """        renderVmlElement(elem) {
            // abchat patch: the print page takes no svg, and its size was set in a frame callback that
            // a hidden document never runs. A VML picture becomes an img and a VML text box a span,
            // each carrying the VML style for the paginator to place; other VML shapes are left out.
            if (elem.imageHref?.id) {
                const picture = this.h({ tagName: "img" });
                picture.setAttribute("data-abchat-vml", elem.cssStyleText || "");
                if (elem.abchatWashout)
                    picture.setAttribute("data-abchat-washout", "1");
                this.tasks.push(this.document?.loadDocumentImage(elem.imageHref.id, this.currentPart)
                    .then(x => { if (x) picture.src = x; }));
                return picture;
            }
            const textbox = (elem.children || []).find(child => child.type == DomType.VmlElement && child.tagName == "foreignObject");
            if (textbox) {
                const box = this.h({ tagName: "span" });
                box.style.display = "inline-block";
                box.setAttribute("data-abchat-vml", elem.cssStyleText || "");
                box.setAttribute("data-abchat-box", JSON.stringify({
                    stroked: elem.abchatStroked ?? null, strokeColor: elem.abchatStrokeColor ?? elem.attrs?.stroke ?? null,
                    strokeWeight: elem.abchatStrokeWeight ?? null, filled: elem.abchatFilled ?? null,
                    fillColor: elem.attrs?.fill ?? null, inset: textbox.abchatInset ?? null
                }));
                this.renderElements(textbox.children, box);
                return box;
            }
            return null;
        }""")

# 11. Drawing anchors keep their position.
rep("""                    case "positionH":
                    case "positionV":
                        if (!simplePos) {
                            let pos = n.localName == "positionH" ? posX : posY;
                            var alignNode = globalXmlParser.element(n, "align");
                            var offsetNode = globalXmlParser.element(n, "posOffset");
                            pos.relative = globalXmlParser.attr(n, "relativeFrom") ?? pos.relative;
                            if (alignNode)
                                pos.align = alignNode.textContent;
                            if (offsetNode)
                                pos.offset = convertLength(offsetNode.textContent, LengthUsage.Emu);
                        }
                        break;""", """                    case "positionH":
                    case "positionV":
                        if (!simplePos) {
                            let pos = n.localName == "positionH" ? posX : posY;
                            var alignNode = globalXmlParser.element(n, "align");
                            var offsetNode = globalXmlParser.element(n, "posOffset");
                            pos.relative = globalXmlParser.attr(n, "relativeFrom") ?? pos.relative;
                            if (alignNode)
                                pos.align = alignNode.textContent;
                            if (offsetNode)
                                pos.offset = convertLength(offsetNode.textContent, LengthUsage.Emu);
                            // abchat patch: which of the two the file gave.
                            pos.abchatAlign = alignNode ? alignNode.textContent : null;
                            pos.abchatOffset = offsetNode ? parseInt(offsetNode.textContent, 10) / 12700 : null;
                        }
                        break;""")

rep("""            else if (isAnchor && (posX.align == 'left' || posX.align == 'right')) {
                result.cssStyle["float"] = posX.align;
            }
            return result;
        }""", """            else if (isAnchor && (posX.align == 'left' || posX.align == 'right')) {
                result.cssStyle["float"] = posX.align;
            }
            // abchat patch: an anchor's position, in points, for the paginator to place one that is
            // anchored to the page or its margins.
            if (isAnchor) {
                result.abchatAnchor = {
                    h: posX.relative, v: posY.relative,
                    alignH: posX.abchatAlign ?? null, alignV: posY.abchatAlign ?? null,
                    x: posX.abchatOffset ?? 0, y: posY.abchatOffset ?? 0,
                    behind: globalXmlParser.boolAttr(node, "behindDoc", false)
                };
            }
            return result;
        }""")

rep("""        renderDrawing(elem) {
            var result = this.toHTML(elem, ns.html, "div");
            result.style.display = "inline-block";
            result.style.position = "relative";
            result.style.textIndent = "0px";
            return result;
        }""", """        renderDrawing(elem) {
            // abchat patch: a span, not a div. The drawing sits inside a paragraph, and the HTML
            // parser ends a paragraph at a div, so the printed page would lay the picture out as a
            // block of its own with an empty paragraph after it.
            var result = this.toHTML(elem, ns.html, "span");
            result.style.display = "inline-block";
            result.style.position = "relative";
            result.style.textIndent = "0px";
            // abchat patch: see parseDrawing.
            if (elem.abchatAnchor)
                result.setAttribute("data-abchat-anchor", JSON.stringify(elem.abchatAnchor));
            return result;
        }""")

rep("""        renderVmlPicture(elem) {
            return this.renderContainer(elem, "div");
        }""", """        renderVmlPicture(elem) {
            // abchat patch: w:pict sits in a run, so its container is inline, as in Word, and a span
            // for the same reason as renderDrawing.
            return this.renderContainer(elem, "span");
        }""")

# 12. Header and footer variants for every page.
rep("""                const pageElement = this.createPageElement(this.className, props, document.cssStyle);
                this.options.renderHeaders && this.renderHeaderFooter(props.headerRefs, props, result.length, prevProps != props, pageElement);""", """                const pageElement = this.createPageElement(this.className, props, document.cssStyle);
                // abchat patch: every header and footer variant of the section, for the pages the
                // paginator adds after this one.
                pageElement.abchatPage = {
                    props,
                    firstOfSection: prevProps != props,
                    evenAndOdd: this.document.settingsPart?.settings?.evenAndOddHeaders ?? false,
                    headers: this.options.renderHeaders ? this.abchatHeaderFooterVariants(props.headerRefs, props) : {},
                    footers: null
                };
                this.abchatFields = [];
                this.options.renderHeaders && this.renderHeaderFooter(props.headerRefs, props, result.length, prevProps != props, pageElement);""")

rep("""                this.options.renderFooters && this.renderHeaderFooter(props.footerRefs, props, result.length, prevProps != props, pageElement);
                result.push(pageElement);""", """                pageElement.abchatPage.footers = this.options.renderFooters ? this.abchatHeaderFooterVariants(props.footerRefs, props) : {};
                this.abchatFields = [];
                this.options.renderFooters && this.renderHeaderFooter(props.footerRefs, props, result.length, prevProps != props, pageElement);
                this.abchatFields = [];
                result.push(pageElement);""")

rep("""        renderHeaderFooter(refs, props, page, firstOfSection, into) {
            if (!refs)
                return;""", """        // abchat patch: renders each of the default, first and even variants, unattached, with the
        // margins renderHeaderFooter gives them.
        abchatHeaderFooterVariants(refs, props) {
            const variants = {};
            if (!refs)
                return variants;
            for (const type of ["default", "first", "even"]) {
                const ref = refs.find(x => x.type == type);
                const part = ref && this.document.findPartByRelId(ref.id, this.document.documentPart);
                if (!part)
                    continue;
                this.currentPart = part;
                if (!this.usedHederFooterParts.includes(part.path)) {
                    this.processElement(part.rootElement);
                    this.usedHederFooterParts.push(part.path);
                }
                this.abchatFields = [];
                const [el] = this.renderElements([part.rootElement]);
                if (el && props?.pageMargins) {
                    if (part.rootElement.type === DomType.Header) {
                        el.style.marginTop = `calc(${props.pageMargins.header} - ${props.pageMargins.top})`;
                        el.style.minHeight = `calc(${props.pageMargins.top} - ${props.pageMargins.header})`;
                    }
                    else if (part.rootElement.type === DomType.Footer) {
                        el.style.marginBottom = `calc(${props.pageMargins.footer} - ${props.pageMargins.bottom})`;
                        el.style.minHeight = `calc(${props.pageMargins.bottom} - ${props.pageMargins.footer})`;
                    }
                }
                if (el)
                    variants[type] = el;
                this.currentPart = null;
            }
            this.abchatFields = [];
            return variants;
        }
        renderHeaderFooter(refs, props, page, firstOfSection, into) {
            if (!refs)
                return;""")

# 13. Tab stops: record what each tab needs, and measure on request.
rep("""            if (this.options.experimental) {
                tabSpan.className = this.tabStopClass();
                var stops = findParent(elem, DomType.Paragraph)?.tabs;
                this.currentTabs.push({ stops, span: tabSpan });
            }
            return tabSpan;""", """            if (this.options.experimental) {
                tabSpan.className = this.tabStopClass();
                var stops = findParent(elem, DomType.Paragraph)?.tabs;
                this.currentTabs.push({ stops, span: tabSpan });
                // abchat patch: kept on the span, so a copy made by the paginator can be measured.
                tabSpan.setAttribute("data-abchat-tab", JSON.stringify({ stops: stops || [], size: this.defaultTabSize || null }));
            }
            return tabSpan;""")

rep("""        refreshTabStops() {
            if (!this.options.experimental)
                return;
            setTimeout(() => {""", """        refreshTabStops() {
            if (!this.options.experimental)
                return;
            // abchat patch: the caller measures tabs itself once fonts have loaded (abchatUpdateTabs).
            if (this.options.abchatManualTabs)
                return;
            setTimeout(() => {""")

rep("""    exports.defaultOptions = defaultOptions;""", """    // abchat patch: measures one tab span from its data-abchat-tab record.
    function abchatUpdateTab(span, pixelToPoint) {
        let record = null;
        try {
            record = JSON.parse(span.getAttribute("data-abchat-tab") || "null");
        }
        catch (e) {
            return;
        }
        if (!record || !span.closest("p, .abchat-as-p"))
            return;
        updateTabStop(span, record.stops, record.size || "36pt", pixelToPoint);
    }
    exports.abchatUpdateTab = abchatUpdateTab;
    exports.abchatPixelToPoint = computePixelToPoint;
    exports.defaultOptions = defaultOptions;""")

# The tab measurement uses the global document's Range and getComputedStyle; measured in another
# document's frame it must use that document's.
rep("""            const tabStops = Array.from(p.querySelectorAll(`.${elem.className}`));
            const nextIdx = tabStops.indexOf(elem) + 1;
            const range = document.createRange();""", """            const tabStops = Array.from(p.querySelectorAll(`.${elem.className}`));
            const nextIdx = tabStops.indexOf(elem) + 1;
            // abchat patch: a range in the span's own document, which may be a frame's.
            const range = elem.ownerDocument.createRange();""")
rep("""        const pbb = p.getBoundingClientRect();
        const pcs = getComputedStyle(p);""", """        const pbb = p.getBoundingClientRect();
        // abchat patch: the style of the paragraph's own window.
        const pcs = (p.ownerDocument.defaultView || window).getComputedStyle(p);""")


# 14. Default run properties apply to paragraph marks too.
rep("""                    case "rPrDefault":
                        var rPr = globalXmlParser.element(c, "rPr");
                        if (rPr)
                            result.styles.push({
                                target: "span",
                                values: this.parseDefaultProperties(rPr, {})
                            });
                        break;""", """                    case "rPrDefault":
                        var rPr = globalXmlParser.element(c, "rPr");
                        if (rPr) {
                            result.styles.push({
                                target: "span",
                                values: this.parseDefaultProperties(rPr, {})
                            });
                            // abchat patch: Word applies the default run properties to the paragraph
                            // mark as well, so an empty paragraph has the default font and size.
                            result.styles.push({
                                target: "p",
                                values: this.parseDefaultProperties(rPr, {})
                            });
                        }
                        break;""")

# A paragraph inside a text box is renamed to span.abchat-as-p by the converter; its tabs measure
# against that paragraph, not the one holding the text box.
rep("""    function updateTabStop(elem, tabs, defaultTabSize, pixelToPoint = 72 / 96) {
        const p = elem.closest("p");""", """    function updateTabStop(elem, tabs, defaultTabSize, pixelToPoint = 72 / 96) {
        // abchat patch: a paragraph inside a text box is a span with the class abchat-as-p.
        const p = elem.closest("p, .abchat-as-p");""")

# The default table style's cell rules reach the cells.
rep("""                    if (defautStyles[style.target] == style)
                        selector = `.${this.className} ${style.target}, ` + selector;""", """                    // abchat patch: for a default style the rule went to .docx <target> without its sub-target,
                    // so the default table style's cell margins were set on the table, where padding is
                    // ignored and does not inherit, and Word's 5.4 pt cell margins were lost. Cell rules now
                    // select the cells. Paragraph and run rules keep reaching cells by inheritance, below
                    // any paragraph style, as before.
                    if (defautStyles[style.target] == style)
                        selector = `.${this.className} ${style.target}${style.target == "table" && subStyle.target == "td" ? " td" : ""}, ` + selector;""")

# A VML text box keeps its outline, fill and inner margins.
rep("""                case "fillcolor":
                    result.attrs.fill = at.value;
                    break;""", """                case "fillcolor":
                    result.attrs.fill = at.value;
                    break;
                // abchat patch: a text box's outline, fill and inner margins, for the converter to draw.
                case "stroked":
                    result.abchatStroked = at.value;
                    break;
                case "strokecolor":
                    result.abchatStrokeColor = at.value;
                    break;
                case "strokeweight":
                    result.abchatStrokeWeight = at.value;
                    break;
                case "filled":
                    result.abchatFilled = at.value;
                    break;
                case "inset":
                    result.abchatInset = at.value;
                    break;""")

# The source map is not shipped.
rep("\n//# sourceMappingURL=docx-preview.js.map", "")

open(sys.argv[2], 'w', encoding='utf-8').write(src)
print('written', len(src))
