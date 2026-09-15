/* =========================================================================
   KGROUP — Exports de rapports : CSV, Excel (XLSX) et PDF
   -------------------------------------------------------------------------
   Aucune bibliothèque, comme le reste du frontend (les graphiques sont déjà
   dessinés à la main). Les trois formats sont produits dans le navigateur, à
   partir des données déjà chargées par la page :

     CSV   texte séparé par « ; » + BOM UTF-8 : Excel en français l'ouvre
           directement en colonnes, accents compris.
     XLSX  un vrai classeur Office Open XML (archive ZIP de fichiers XML) :
           nombres et dates typés, en-têtes figés, filtres, totaux en formules.
     PDF   un document PDF 1.4 en polices standard (Helvetica, encodage
           WinAnsi) : en-tête, indicateurs, histogramme, tableaux paginés.

   Même fichier pour le navigateur (window.KGExport) et pour les tests Node
   (require("../exports.js")) : les constructeurs de fichiers sont purs, seul
   download() touche au DOM.

   Description d'un rapport (« spec ») :
     {
       filename:    "ventes-2026-09",          // sans extension
       title:       "Rapport des ventes",
       subtitle:    "Du 01/09/2026 au 15/09/2026",
       meta:        ["Commercial : tous"],     // lignes d'information
       orientation: "portrait" | "landscape",  // PDF
       kpis:        [{ label, value }],        // PDF + feuille « Résumé » XLSX
       chart:       { title, labels, values, money },   // PDF
       sections:    [{ name, title, note, columns, rows, totals }],
       csvSection:  0,                         // tableau exporté en CSV
     }
   Colonne : { key, label, type, get(row), total }
     type  : "text" | "int" | "money" | "percent" | "date" | "datetime"
     total : "sum" pour totaliser la colonne, ou un texte fixe
   ========================================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KGExport = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const BRAND = "KGROUP Parfumery";
  const CURRENCY = "DHS";

  /* ------------------------------------------------------------------ *
   * Valeurs et formats communs                                          *
   * ------------------------------------------------------------------ */
  const NUMERIC = new Set(["int", "money", "percent"]);
  const pad2 = (n) => String(n).padStart(2, "0");

  /** Date JS ou null. « AAAA-MM-JJ » est lu en heure locale, sans décalage. */
  function toDate(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const [y, m, d] = v.split("-").map(Number);
      return new Date(y, m - 1, d);
    }
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const toNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  /** 1234567 -> « 1 234 567 » (espace simple : lisible partout, PDF compris). */
  function groupDigits(n) {
    const v = Math.round(toNumber(n));
    const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return (v < 0 ? "-" : "") + s;
  }

  const formatDate = (d) => (d ? `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}` : "");
  const formatDateTime = (d) => (d ? `${formatDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : "");

  function rawValue(col, row) {
    return typeof col.get === "function" ? col.get(row) : row[col.key];
  }

  /**
   * Mise en forme d'une valeur selon le type de sa colonne.
   *   "display" : texte lisible (PDF)       1 234 DHS, 12,5 %, 15/09/2026 10:30
   *   "csv"     : texte relu par un tableur  1234,      12,5,   15/09/2026 10:30
   */
  function formatByType(type, v, mode) {
    const csv = mode === "csv";
    switch (type) {
      case "int": return csv ? String(Math.round(toNumber(v))) : groupDigits(v);
      case "money": return csv ? String(Math.round(toNumber(v))) : groupDigits(v) + " " + CURRENCY;
      case "percent": {
        const p = (toNumber(v) * 100).toFixed(1).replace(".", ",");
        return csv ? p : p + " %";
      }
      case "date": return formatDate(toDate(v));
      case "datetime": return formatDateTime(toDate(v));
      default: return v == null ? "" : String(v);
    }
  }

  /** Texte affiché dans un PDF. */
  const displayValue = (col, row) => formatByType(col.type, rawValue(col, row), "display");

  /** Total d'une colonne (somme), ou texte fixe fourni par la spec. */
  function columnTotal(col, rows) {
    if (col.total === "sum") return rows.reduce((n, r) => n + toNumber(rawValue(col, r)), 0);
    return col.total == null ? null : col.total;
  }

  function hasTotals(section) {
    return Boolean(section.totals) && section.columns.some((c) => c.total != null);
  }

  /** Nom de fichier sûr sur tous les systèmes. */
  function safeFilename(name) {
    const base = String(name || "rapport")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return base || "rapport";
  }

  /* ------------------------------------------------------------------ *
   * CSV                                                                 *
   * ------------------------------------------------------------------ */
  const csvCell = (col, row) => formatByType(col.type, rawValue(col, row), "csv");

  /**
   * Un texte saisi par un utilisateur (« =HYPERLINK(…) ») ne doit pas devenir
   * une formule à l'ouverture dans un tableur : on le préfixe d'une apostrophe.
   */
  function neutralizeFormula(s) {
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }

  function csvEscape(s, sep) {
    const text = String(s);
    return text.includes(sep) || /["\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function toCsv(section, opts) {
    const sep = (opts && opts.separator) || ";";
    const cols = section.columns;
    const lines = [cols.map((c) => csvEscape(c.label, sep)).join(sep)];
    for (const row of section.rows) {
      lines.push(cols.map((c) => {
        let s = csvCell(c, row);
        if (!NUMERIC.has(c.type)) s = neutralizeFormula(s);
        return csvEscape(s, sep);
      }).join(sep));
    }
    if (hasTotals(section)) {
      lines.push(cols.map((c, i) => {
        const t = columnTotal(c, section.rows);
        if (t == null) return i === 0 ? "Total" : "";
        return csvEscape(typeof t === "number" ? formatByType(c.type, t, "csv") : String(t), sep);
      }).join(sep));
    }
    return lines.join("\r\n") + "\r\n";
  }

  /* ------------------------------------------------------------------ *
   * ZIP (méthode « stored ») — conteneur du format XLSX                 *
   * ------------------------------------------------------------------ */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  const utf8 = (s) => new TextEncoder().encode(s);

  function concatBytes(parts) {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }

  /** files: [{ name, data: Uint8Array }] -> archive ZIP. */
  function zip(files, when) {
    const date = when || new Date();
    const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
    const dosDate = (((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const f of files) {
      const name = utf8(f.name);
      const data = f.data;
      const crc = crc32(data);

      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);          // version requise
      lv.setUint16(6, 0x0800, true);      // noms en UTF-8
      lv.setUint16(8, 0, true);           // stocké, sans compression
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      lv.setUint16(28, 0, true);
      local.set(name, 30);
      locals.push(local, data);

      const central = new Uint8Array(46 + name.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);     // les autres champs restent à 0
      central.set(name, 46);
      centrals.push(central);

      offset += local.length + data.length;
    }

    const centralSize = centrals.reduce((n, c) => n + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    return concatBytes([...locals, ...centrals, end]);
  }

  /* ------------------------------------------------------------------ *
   * XLSX                                                                *
   * ------------------------------------------------------------------ */
  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  /** Retire les demi-paires UTF-16 isolées, interdites en XML. */
  function dropLoneSurrogates(s) {
    let out = "";
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = s.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { out += s[i] + s[i + 1]; i++; }
        continue;
      }
      if (c >= 0xdc00 && c <= 0xdfff) continue;
      out += s[i];
    }
    return out;
  }

  function xmlEscape(s) {
    return dropLoneSurrogates(String(s == null ? "" : s))
      // Caractères de contrôle interdits en XML 1.0.
      .replace(/[ --￾￿]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function columnName(index) {
    let n = index + 1;
    let s = "";
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  /** Numéro de série Excel d'une date locale (jours depuis le 30/12/1899). */
  function excelSerial(d) {
    return (d.getTime() - d.getTimezoneOffset() * 60000) / 86400000 + 25569;
  }

  /* Index des styles de cellule — voir STYLES_XML plus bas. */
  const S = {
    text: 0, header: 1, int: 2, money: 3, datetime: 4, date: 5, percent: 6,
    title: 7, subtitle: 8, totalText: 9, totalInt: 10, totalMoney: 11,
    totalPercent: 12, headerNum: 13, label: 14,
  };
  const TYPE_STYLE = { int: S.int, money: S.money, datetime: S.datetime, date: S.date, percent: S.percent };
  const TOTAL_STYLE = { int: S.totalInt, money: S.totalMoney, percent: S.totalPercent };

  const STYLES_XML = XML_HEAD +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="4">' +
    '<numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/>' +
    '<numFmt numFmtId="165" formatCode="dd/mm/yyyy"/>' +
    '<numFmt numFmtId="166" formatCode="#,##0 &quot;DHS&quot;"/>' +
    '<numFmt numFmtId="167" formatCode="0.0%"/>' +
    "</numFmts>" +
    '<fonts count="5">' +
    '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="15"/><color rgb="FF0B7A4B"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><i/><sz val="10"/><color rgb="FF6B7A73"/><name val="Calibri"/><family val="2"/></font>' +
    "</fonts>" +
    '<fills count="4">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF0B7A4B"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF0FAF5"/><bgColor indexed="64"/></patternFill></fill>' +
    "</fills>" +
    '<borders count="2">' +
    "<border><left/><right/><top/><bottom/><diagonal/></border>" +
    '<border><left/><right/><top style="thin"><color rgb="FF0B7A4B"/></top><bottom/><diagonal/></border>' +
    "</borders>" +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="15">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
    '<xf numFmtId="3" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>' +
    '<xf numFmtId="166" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>' +
    '<xf numFmtId="167" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    "</cellXfs>" +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>";

  function inlineStr(ref, text, style) {
    return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
  }

  function numberCell(ref, value, style, formula) {
    const v = toNumber(value);
    return `<c r="${ref}"${style ? ` s="${style}"` : ""}>${formula ? `<f>${formula}</f>` : ""}<v>${v}</v></c>`;
  }

  function dataCell(ref, col, row) {
    const v = rawValue(col, row);
    if (col.type === "date" || col.type === "datetime") {
      const d = toDate(v);
      return d ? numberCell(ref, excelSerial(d), TYPE_STYLE[col.type]) : "";
    }
    if (NUMERIC.has(col.type)) return numberCell(ref, v, TYPE_STYLE[col.type]);
    if (v == null || v === "") return "";
    return inlineStr(ref, String(v), 0);
  }

  /** Largeur de colonne en caractères, estimée sur l'en-tête et les données. */
  function columnWidth(col, rows) {
    let max = String(col.label || "").length + 2;
    const sample = rows.length > 400 ? rows.slice(0, 400) : rows;
    for (const r of sample) {
      const len = col.type === "datetime" ? 16 : col.type === "date" ? 10 : displayValue(col, r).length;
      if (len > max) max = len;
    }
    return Math.min(60, Math.max(9, max + 2));
  }

  /** Une feuille : titre, sous-titre, en-tête figé, données, totaux. */
  function sheetXml(section, sheetIndex, docMeta) {
    const cols = section.columns;
    const rows = section.rows || [];
    const lastCol = columnName(Math.max(0, cols.length - 1));
    const out = [];
    let r = 0;

    const title = section.title || docMeta.title;
    if (title) out.push(`<row r="${++r}">${inlineStr("A" + r, title, S.title)}</row>`);
    const sub = [docMeta.subtitle, ...(docMeta.meta || []), section.note].filter(Boolean);
    for (const line of sub) out.push(`<row r="${++r}">${inlineStr("A" + r, line, S.subtitle)}</row>`);
    if (r) r++; // ligne vide avant le tableau

    const headerRow = ++r;
    out.push(`<row r="${headerRow}">` + cols.map((c, i) =>
      inlineStr(columnName(i) + headerRow, c.label, NUMERIC.has(c.type) ? S.headerNum : S.header)).join("") + "</row>");

    for (const row of rows) {
      r++;
      out.push(`<row r="${r}">` + cols.map((c, i) => dataCell(columnName(i) + r, c, row)).join("") + "</row>");
    }
    const lastDataRow = r;

    if (hasTotals(section)) {
      r++;
      const cells = cols.map((c, i) => {
        const ref = columnName(i) + r;
        const t = columnTotal(c, rows);
        if (t == null) return inlineStr(ref, i === 0 ? "Total" : "", S.totalText);
        if (typeof t !== "number") return inlineStr(ref, String(t), S.totalText);
        const range = `${columnName(i)}${headerRow + 1}:${columnName(i)}${Math.max(headerRow + 1, lastDataRow)}`;
        return numberCell(ref, t, TOTAL_STYLE[c.type] || S.totalInt, rows.length ? `SUM(${range})` : null);
      });
      out.push(`<row r="${r}">${cells.join("")}</row>`);
    }

    const widths = cols.map((c, i) =>
      `<col min="${i + 1}" max="${i + 1}" width="${columnWidth(c, rows)}" customWidth="1"/>`).join("");
    const pane = `<pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/>` +
      `<selection pane="bottomLeft" activeCell="A${headerRow + 1}" sqref="A${headerRow + 1}"/>`;
    const filter = rows.length ? `<autoFilter ref="A${headerRow}:${lastCol}${lastDataRow}"/>` : "";

    return {
      xml: XML_HEAD +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheetViews><sheetView workbookViewId="0"${sheetIndex === 0 ? ' tabSelected="1"' : ""}>${pane}</sheetView></sheetViews>` +
        `<cols>${widths}</cols>` +
        `<sheetData>${out.join("")}</sheetData>` +
        filter +
        '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
        "</worksheet>",
      filterRange: rows.length ? `$A$${headerRow}:$${lastCol}$${lastDataRow}` : null,
    };
  }

  /** Nom de feuille valide (31 caractères, sans []:*?/\) et unique. */
  function sheetNames(sections) {
    const used = new Set();
    return sections.map((s, i) => {
      let base = String(s.name || s.title || `Feuille ${i + 1}`).replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || `Feuille ${i + 1}`;
      let name = base;
      let n = 2;
      while (used.has(name.toLowerCase())) name = base.slice(0, 28) + " " + n++;
      used.add(name.toLowerCase());
      return name;
    });
  }

  function toXlsx(spec) {
    const sections = (spec.sections || []).slice();
    // Les indicateurs forment une première feuille « Résumé », lisible seule.
    if (spec.kpis && spec.kpis.length) {
      sections.unshift({
        name: "Résumé",
        title: spec.title,
        columns: [{ key: "label", label: "Indicateur", type: "text" }, { key: "value", label: "Valeur", type: "text" }],
        rows: spec.kpis.map((k) => ({ label: k.label, value: k.value })),
      });
    }
    if (!sections.length) sections.push({ name: "Rapport", columns: [{ key: "x", label: "", type: "text" }], rows: [] });

    const names = sheetNames(sections);
    const docMeta = { title: spec.title, subtitle: spec.subtitle, meta: spec.meta };
    // Chaque feuille rappelle la période ; les lignes d'information complètes
    // restent sur la première.
    const sheets = sections.map((s, i) => sheetXml(s, i,
      i === 0 ? docMeta : { title: s.title || spec.title, subtitle: spec.subtitle }));

    const definedNames = sheets
      .map((s, i) => (s.filterRange
        ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xmlEscape(names[i].replace(/'/g, "''"))}'!${s.filterRange}</definedName>`
        : ""))
      .join("");

    const workbook = XML_HEAD +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
      names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
      "</sheets>" + (definedNames ? `<definedNames>${definedNames}</definedNames>` : "") + "</workbook>";

    const workbookRels = XML_HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
      `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      "</Relationships>";

    const contentTypes = XML_HEAD +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      "</Types>";

    const rootRels = XML_HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      "</Relationships>";

    const now = spec.now ? toDate(spec.now) : new Date();
    const core = XML_HEAD +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${xmlEscape(spec.title || "Rapport")}</dc:title><dc:creator>${BRAND}</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now.toISOString().slice(0, 19)}Z</dcterms:created>` +
      "</cp:coreProperties>";
    const app = XML_HEAD +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>KGROUP</Application></Properties>';

    return zip([
      { name: "[Content_Types].xml", data: utf8(contentTypes) },
      { name: "_rels/.rels", data: utf8(rootRels) },
      { name: "docProps/core.xml", data: utf8(core) },
      { name: "docProps/app.xml", data: utf8(app) },
      { name: "xl/workbook.xml", data: utf8(workbook) },
      { name: "xl/_rels/workbook.xml.rels", data: utf8(workbookRels) },
      { name: "xl/styles.xml", data: utf8(STYLES_XML) },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: utf8(s.xml) })),
    ], now);
  }

  /* ------------------------------------------------------------------ *
   * PDF                                                                 *
   * -------------------------------------------------------------------
   * Polices standard Helvetica / Helvetica-Bold en WinAnsiEncoding : tout
   * lecteur PDF les possède, rien n'est à embarquer. Les largeurs de glyphes
   * (métriques AFM Adobe) servent à tronquer et à aligner à droite.
   * ------------------------------------------------------------------ */
  const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
  // Codes 160-255 (Latin-1).
  const W_REG_HI = [278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
  const W_BOLD_HI = [278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556];
  // Caractères Unicode placés en 128-159 par WinAnsiEncoding : [code, largeur, largeur gras].
  const WIN_SPECIAL = {
    "€": [0x80, 556, 556], "‚": [0x82, 222, 278], "ƒ": [0x83, 556, 556],
    "„": [0x84, 333, 500], "…": [0x85, 1000, 1000], "†": [0x86, 556, 556],
    "‡": [0x87, 556, 556], "ˆ": [0x88, 333, 333], "‰": [0x89, 1000, 1000],
    "Š": [0x8a, 667, 667], "‹": [0x8b, 333, 333], "Œ": [0x8c, 1000, 1000],
    "Ž": [0x8e, 611, 611], "‘": [0x91, 222, 278], "’": [0x92, 222, 278],
    "“": [0x93, 333, 500], "”": [0x94, 333, 500], "•": [0x95, 350, 350],
    "–": [0x96, 556, 556], "—": [0x97, 1000, 1000], "˜": [0x98, 333, 333],
    "™": [0x99, 1000, 1000], "š": [0x9a, 500, 556], "›": [0x9b, 333, 333],
    "œ": [0x9c, 944, 944], "ž": [0x9e, 500, 500], "Ÿ": [0x9f, 667, 667],
  };

  /**
   * Chaîne JS -> codes WinAnsi. Espaces insécables -> espace ; lettres hors
   * Latin-1 -> leur lettre de base (ă -> a) ; pictogrammes retirés ; le reste
   * (écritures non latines) devient « ? » plutôt que de disparaître.
   */
  function toWinAnsi(str) {
    const out = [];
    for (const ch of String(str == null ? "" : str)) {
      const cp = ch.codePointAt(0);
      if (cp === 0x09 || cp === 0x0a || cp === 0x0d) { out.push(32); continue; }
      if (cp < 0x20 || cp === 0x7f) continue;
      if (cp < 0x7f || (cp >= 0xa0 && cp <= 0xff)) { out.push(cp === 0xa0 ? 32 : cp); continue; }
      if (WIN_SPECIAL[ch]) { out.push(WIN_SPECIAL[ch][0]); continue; }
      if (cp === 0x202f || cp === 0x2009 || cp === 0x2007 || cp === 0x2002 || cp === 0x2003) { out.push(32); continue; }
      if (cp === 0x2212) { out.push(45); continue; }                        // signe moins
      if ((cp >= 0x1f000 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf) ||
          (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x200d || (cp >= 0x2b00 && cp <= 0x2bff)) continue;
      const base = ch.normalize("NFD").charAt(0);
      const bcp = base.codePointAt(0);
      if (base !== ch && bcp < 0x7f) { out.push(bcp); continue; }
      out.push(63); // "?"
    }
    return out;
  }

  function charWidth(code, bold) {
    if (code >= 32 && code <= 126) return (bold ? W_BOLD : W_REG)[code - 32];
    if (code >= 160 && code <= 255) return (bold ? W_BOLD_HI : W_REG_HI)[code - 160];
    for (const k in WIN_SPECIAL) if (WIN_SPECIAL[k][0] === code) return WIN_SPECIAL[k][bold ? 2 : 1];
    return 556;
  }

  function textWidth(codes, size, bold) {
    let w = 0;
    for (const c of codes) w += charWidth(c, bold);
    return (w * size) / 1000;
  }

  /** Coupe un texte trop long et termine par « … ». */
  function fitCodes(codes, maxWidth, size, bold) {
    if (textWidth(codes, size, bold) <= maxWidth) return codes;
    const ell = 0x85;
    const budget = maxWidth - (charWidth(ell, bold) * size) / 1000;
    const out = [];
    let w = 0;
    for (const c of codes) {
      const cw = (charWidth(c, bold) * size) / 1000;
      if (w + cw > budget) break;
      out.push(c);
      w += cw;
    }
    while (out.length && out[out.length - 1] === 32) out.pop();
    out.push(ell);
    return out;
  }

  /** Littéral PDF entièrement ASCII : les octets hors ASCII passent en octal. */
  function pdfLiteral(codes) {
    let s = "(";
    for (const c of codes) {
      if (c === 40 || c === 41 || c === 92) s += "\\" + String.fromCharCode(c);
      else if (c >= 32 && c <= 126) s += String.fromCharCode(c);
      else s += "\\" + c.toString(8).padStart(3, "0");
    }
    return s + ")";
  }

  /**
   * Chaîne de métadonnées (Titre, Auteur) : UTF-16BE avec BOM. Le dictionnaire
   * Info n'utilise pas WinAnsi mais PDFDocEncoding, qui diffère sur 0x80-0x9F
   * (« — » y devenait « Š ») ; l'UTF-16 est exact pour tout caractère.
   */
  function pdfTextString(str) {
    const s = String(str == null ? "" : str);
    let hex = "FEFF";
    for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
    return "<" + hex + ">";
  }

  const num = (n) => {
    const v = Math.round(n * 100) / 100;
    return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, "");
  };

  function hexToRgb(hex) {
    const h = String(hex || "#000000").replace("#", "");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  }
  const rgb = (hex) => hexToRgb(hex).map(num).join(" ");

  const COLORS = {
    brand: "#0B7A4B", brandSoft: "#F0FAF5", brandLine: "#CFE9DC", ink: "#10201A",
    ink2: "#34433D", muted: "#6B7A73", line: "#E4EBE7", zebra: "#F7FAF8", white: "#FFFFFF",
  };

  const PAGE_SIZES = { portrait: [595.28, 841.89], landscape: [841.89, 595.28] };

  /** Mise en page : une liste de pages, chacune une liste d'opérateurs PDF. */
  class PdfWriter {
    constructor(opts) {
      const [w, h] = PAGE_SIZES[opts.orientation] || PAGE_SIZES.portrait;
      this.w = w;
      this.h = h;
      this.margin = 36;
      this.footerSpace = 30;
      this.title = opts.title || "Rapport";
      this.pages = [];
      this.onNewPage = null;
      this.addPage();
    }

    get contentWidth() { return this.w - this.margin * 2; }
    get bottom() { return this.margin + this.footerSpace; }

    addPage() {
      this.ops = [];
      this.pages.push(this.ops);
      this.y = this.h - this.margin;
      if (this.pages.length > 1) {
        // Rappel discret du document en tête des pages suivantes.
        this.text(this.margin, this.y - 8, `${BRAND} — ${this.title}`, { size: 8, color: COLORS.muted });
        this.line(this.margin, this.y - 14, this.w - this.margin, this.y - 14, COLORS.line, 0.6);
        this.y -= 26;
      }
      if (this.onNewPage) this.onNewPage();
    }

    /** Garantit `space` points avant le pied de page, sinon change de page. */
    ensure(space) {
      if (this.y - space < this.bottom) { this.addPage(); return true; }
      return false;
    }

    rect(x, y, w, h, color) {
      this.ops.push(`${rgb(color)} rg ${num(x)} ${num(y)} ${num(w)} ${num(h)} re f`);
    }

    line(x1, y1, x2, y2, color, width) {
      this.ops.push(`${rgb(color)} RG ${num(width || 0.5)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`);
    }

    /** Texte sur une ligne. align: left | right | center ; maxWidth tronque. */
    text(x, y, str, o) {
      const opts = o || {};
      const size = opts.size || 9;
      const bold = Boolean(opts.bold);
      let codes = toWinAnsi(str);
      if (opts.maxWidth) codes = fitCodes(codes, opts.maxWidth, size, bold);
      if (!codes.length) return 0;
      const width = textWidth(codes, size, bold);
      let tx = x;
      if (opts.align === "right") tx = x - width;
      else if (opts.align === "center") tx = x - width / 2;
      this.ops.push(`BT /${bold ? "F2" : "F1"} ${num(size)} Tf ${rgb(opts.color || COLORS.ink)} rg 1 0 0 1 ${num(tx)} ${num(y)} Tm ${pdfLiteral(codes)} Tj ET`);
      return width;
    }

    /** Paragraphe avec retour à la ligne automatique. */
    paragraph(str, o) {
      const opts = o || {};
      const size = opts.size || 9;
      const lead = size * 1.4;
      const words = String(str || "").split(/\s+/).filter(Boolean);
      let lineWords = [];
      const flush = () => {
        if (!lineWords.length) return;
        this.ensure(lead);
        this.text(this.margin, this.y - size, lineWords.join(" "), { size, color: opts.color || COLORS.ink2, bold: opts.bold });
        this.y -= lead;
        lineWords = [];
      };
      for (const w of words) {
        const candidate = lineWords.concat(w).join(" ");
        if (textWidth(toWinAnsi(candidate), size, opts.bold) > this.contentWidth && lineWords.length) flush();
        lineWords.push(w);
      }
      flush();
    }

    /** Octets du fichier PDF. */
    build(info) {
      const total = this.pages.length;
      // Pied de page, maintenant que le nombre de pages est connu.
      this.pages.forEach((ops, i) => {
        this.ops = ops;
        const y = this.margin - 4;
        this.line(this.margin, y + 12, this.w - this.margin, y + 12, COLORS.line, 0.6);
        this.text(this.margin, y, `${BRAND} · ${this.title}`, { size: 7.5, color: COLORS.muted, maxWidth: this.contentWidth - 90 });
        this.text(this.w - this.margin, y, `Page ${i + 1} / ${total}`, { size: 7.5, color: COLORS.muted, align: "right" });
      });

      const objects = [];
      const add = (body) => { objects.push(body); return objects.length; };
      const catalog = add(null);
      const pagesObj = add(null);
      const fontReg = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
      const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
      const kids = [];
      for (const ops of this.pages) {
        const content = ops.join("\n");
        const contentObj = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
        kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${num(this.w)} ${num(this.h)}] ` +
          `/Resources << /Font << /F1 ${fontReg} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentObj} 0 R >>`));
      }
      objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
      objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
      const d = info.now || new Date();
      const stamp = `D:${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
      const infoObj = add(`<< /Title ${pdfTextString(info.title || this.title)} /Author ${pdfTextString(BRAND)} ` +
        `/Producer (KGROUP) /CreationDate (${stamp}) >>`);

      // Chaque caractère vaut un octet (tout est ASCII, sauf la ligne binaire
      // d'en-tête écrite en Latin-1) : les positions de la table xref sont
      // donc exactement les longueurs de chaîne.
      let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
      const offsets = [];
      objects.forEach((body, i) => {
        offsets.push(out.length);
        out += `${i + 1} 0 obj\n${body}\nendobj\n`;
      });
      const xrefAt = out.length;
      out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f\r\n`;
      for (const off of offsets) out += String(off).padStart(10, "0") + " 00000 n\r\n";
      out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

      const bytes = new Uint8Array(out.length);
      for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
      return bytes;
    }
  }

  /* ---- Sections du PDF ---- */

  function pdfHeader(pdf, spec, now) {
    const m = pdf.margin;
    const bandH = 58;
    const top = pdf.h - m;
    pdf.rect(m, top - bandH, pdf.contentWidth, bandH, COLORS.brand);
    pdf.text(m + 16, top - 26, BRAND, { size: 17, bold: true, color: COLORS.white });
    pdf.text(m + 16, top - 42, "La senteur du luxe", { size: 9, color: "#CFE9DC" });
    pdf.text(pdf.w - m - 16, top - 26, spec.badge || "Rapport", { size: 10, bold: true, color: COLORS.white, align: "right" });
    pdf.text(pdf.w - m - 16, top - 42, `Généré le ${formatDateTime(now)}`, { size: 8.5, color: "#CFE9DC", align: "right" });
    pdf.y = top - bandH - 26;

    pdf.text(m, pdf.y, spec.title || "Rapport", { size: 18, bold: true, color: COLORS.ink, maxWidth: pdf.contentWidth });
    pdf.y -= 16;
    const lines = [spec.subtitle, ...(spec.meta || [])].filter(Boolean);
    for (const l of lines) {
      pdf.text(m, pdf.y, l, { size: 9.5, color: COLORS.muted, maxWidth: pdf.contentWidth });
      pdf.y -= 13;
    }
    pdf.y -= 8;
  }

  function pdfKpis(pdf, kpis) {
    if (!kpis || !kpis.length) return;
    const perRow = Math.min(kpis.length, pdf.w > pdf.h ? 6 : 4);
    const gap = 10;
    const boxW = (pdf.contentWidth - gap * (perRow - 1)) / perRow;
    const boxH = 48;
    for (let i = 0; i < kpis.length; i += perRow) {
      pdf.ensure(boxH + 10);
      const top = pdf.y;
      kpis.slice(i, i + perRow).forEach((k, j) => {
        const x = pdf.margin + j * (boxW + gap);
        pdf.rect(x, top - boxH, boxW, boxH, COLORS.brandSoft);
        pdf.rect(x, top - boxH, 3, boxH, COLORS.brand);
        pdf.text(x + 12, top - 17, k.label, { size: 8, color: COLORS.muted, maxWidth: boxW - 18 });
        pdf.text(x + 12, top - 36, k.value, { size: 13, bold: true, color: COLORS.brand, maxWidth: boxW - 18 });
      });
      pdf.y = top - boxH - gap;
    }
    pdf.y -= 8;
  }

  function sectionTitle(pdf, title, note) {
    pdf.ensure(40);
    pdf.text(pdf.margin, pdf.y - 11, title, { size: 12, bold: true, color: COLORS.ink, maxWidth: pdf.contentWidth });
    pdf.y -= 17;
    if (note) {
      pdf.text(pdf.margin, pdf.y - 9, note, { size: 8.5, color: COLORS.muted, maxWidth: pdf.contentWidth });
      pdf.y -= 13;
    }
    pdf.y -= 4;
  }

  function pdfChart(pdf, chart) {
    if (!chart || !chart.values || !chart.values.length) return;
    const h = 150;
    sectionTitle(pdf, chart.title || "Évolution", chart.note);
    pdf.ensure(h + 24);
    const top = pdf.y;
    const left = pdf.margin + 44;
    const width = pdf.contentWidth - 50;
    const base = top - h;
    const max = Math.max(1, ...chart.values.map(toNumber));
    const fmt = (v) => {
      const n = toNumber(v);
      if (n >= 1e6) return (n / 1e6).toFixed(1).replace(".", ",") + " M";
      if (n >= 1e3) return (n / 1e3).toFixed(1).replace(".", ",") + " k";
      return groupDigits(n);
    };
    for (let g = 0; g <= 4; g++) {
      const gy = base + (h * g) / 4;
      pdf.line(left, gy, left + width, gy, COLORS.line, 0.5);
      pdf.text(left - 6, gy - 3, fmt((max * g) / 4), { size: 7, color: COLORS.muted, align: "right" });
    }
    const n = chart.values.length;
    const slot = width / n;
    const bw = Math.min(34, slot * 0.62);
    chart.values.forEach((v, i) => {
      const bh = (toNumber(v) / max) * (h - 12);
      const x = left + slot * i + (slot - bw) / 2;
      if (bh > 0) pdf.rect(x, base, bw, bh, COLORS.brand);
      if (toNumber(v) > 0 && slot > 22) pdf.text(x + bw / 2, base + bh + 3, fmt(v), { size: 6.5, color: COLORS.ink2, align: "center" });
      const label = (chart.labels || [])[i];
      if (label && (n <= 16 || i % Math.ceil(n / 16) === 0)) {
        pdf.text(x + bw / 2, base - 11, label, { size: 7, color: COLORS.muted, align: "center", maxWidth: slot + 6 });
      }
    });
    pdf.y = base - 26;
  }

  /** Largeurs de colonnes : mesurées sur le contenu, puis ajustées à la page. */
  function layoutColumns(pdf, cols, rows, size) {
    const padX = 10;
    const sample = rows.length > 300 ? rows.slice(0, 300) : rows;
    const natural = cols.map((c) => {
      let w = textWidth(toWinAnsi(c.label), size, true);
      for (const r of sample) w = Math.max(w, textWidth(toWinAnsi(displayValue(c, r)), size, false));
      const cap = NUMERIC.has(c.type) || c.type === "date" || c.type === "datetime" ? 110 : 190;
      return Math.min(cap, w) + padX;
    });
    const avail = pdf.contentWidth;
    const sum = natural.reduce((a, b) => a + b, 0);
    if (sum <= avail) {
      const extra = (avail - sum) / cols.length;
      return natural.map((w) => w + extra);
    }
    // Trop large : on réduit d'abord les colonnes de texte.
    const fixed = cols.map((c) => NUMERIC.has(c.type) || c.type === "date" || c.type === "datetime");
    const fixedSum = natural.reduce((a, w, i) => a + (fixed[i] ? w : 0), 0);
    const flexSum = sum - fixedSum;
    if (fixedSum < avail * 0.8 && flexSum > 0) {
      const ratio = (avail - fixedSum) / flexSum;
      return natural.map((w, i) => (fixed[i] ? w : Math.max(34, w * ratio)));
    }
    return natural.map((w) => (w * avail) / sum);
  }

  function pdfTable(pdf, section) {
    const cols = section.columns;
    const rows = section.rows || [];
    const size = cols.length > 8 ? 7.5 : 8.5;
    const rowH = size + 8;
    sectionTitle(pdf, section.title || section.name || "Tableau", section.note);

    if (!rows.length) {
      pdf.text(pdf.margin, pdf.y - 10, "Aucune donnée pour cette période.", { size: 9, color: COLORS.muted });
      pdf.y -= 26;
      return;
    }

    const widths = layoutColumns(pdf, cols, rows, size);
    const xs = [];
    widths.reduce((x, w) => { xs.push(x); return x + w; }, pdf.margin);
    const pad = 5;

    const cellText = (c, i, value, opts) => {
      const right = NUMERIC.has(c.type);
      const x = right ? xs[i] + widths[i] - pad : xs[i] + pad;
      pdf.text(x, pdf.y - rowH + 5, value, Object.assign({ size, align: right ? "right" : "left", maxWidth: widths[i] - pad * 2 }, opts));
    };

    const header = () => {
      pdf.rect(pdf.margin, pdf.y - rowH, pdf.contentWidth, rowH, COLORS.brand);
      cols.forEach((c, i) => cellText(c, i, c.label, { bold: true, color: COLORS.white }));
      pdf.y -= rowH;
    };

    pdf.ensure(rowH * 3);
    header();
    rows.forEach((row, idx) => {
      if (pdf.ensure(rowH)) header();
      if (idx % 2 === 1) pdf.rect(pdf.margin, pdf.y - rowH, pdf.contentWidth, rowH, COLORS.zebra);
      cols.forEach((c, i) => cellText(c, i, displayValue(c, row), { color: COLORS.ink }));
      pdf.y -= rowH;
    });

    if (hasTotals(section)) {
      if (pdf.ensure(rowH + 2)) header();
      pdf.rect(pdf.margin, pdf.y - rowH, pdf.contentWidth, rowH, COLORS.brandSoft);
      pdf.line(pdf.margin, pdf.y, pdf.margin + pdf.contentWidth, pdf.y, COLORS.brand, 0.8);
      cols.forEach((c, i) => {
        const t = columnTotal(c, rows);
        if (t == null) { if (i === 0) cellText(c, i, "Total", { bold: true }); return; }
        cellText(c, i, typeof t === "number" ? formatByType(c.type, t, "display") : String(t), { bold: true });
      });
      pdf.y -= rowH;
    }
    pdf.y -= 16;
  }

  function toPdf(spec) {
    const now = spec.now ? toDate(spec.now) : new Date();
    const pdf = new PdfWriter({ orientation: spec.orientation, title: spec.title });
    pdfHeader(pdf, spec, now);
    pdfKpis(pdf, spec.kpis);
    pdfChart(pdf, spec.chart);
    for (const section of spec.sections || []) pdfTable(pdf, section);
    if (spec.footnote) pdf.paragraph(spec.footnote, { size: 8.5, color: COLORS.muted });
    return pdf.build({ title: spec.title, now });
  }

  /* ------------------------------------------------------------------ *
   * Assemblage et téléchargement                                        *
   * ------------------------------------------------------------------ */
  const MIME = {
    csv: "text/csv;charset=utf-8",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pdf: "application/pdf",
  };

  /** { bytes, mime, filename } pour le format demandé. */
  function build(format, spec) {
    const f = String(format || "").toLowerCase();
    const name = safeFilename(spec.filename || spec.title);
    if (f === "csv") {
      const section = (spec.sections || [])[spec.csvSection || 0] || { columns: [], rows: [] };
      // BOM UTF-8 : sans lui, Excel lit le fichier en ANSI et casse les accents.
      const bytes = concatBytes([new Uint8Array([0xef, 0xbb, 0xbf]), utf8(toCsv(section))]);
      return { bytes, mime: MIME.csv, filename: name + ".csv" };
    }
    if (f === "xlsx") return { bytes: toXlsx(spec), mime: MIME.xlsx, filename: name + ".xlsx" };
    if (f === "pdf") return { bytes: toPdf(spec), mime: MIME.pdf, filename: name + ".pdf" };
    throw new Error("Format d'export inconnu : " + format);
  }

  /** Construit le fichier et le propose au téléchargement (navigateur). */
  function download(format, spec) {
    const file = build(format, spec);
    const blob = new Blob([file.bytes], { type: file.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    // Laisser au navigateur le temps de lire le blob avant de le libérer.
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
    return file;
  }

  return {
    BRAND, build, download, toCsv, toXlsx, toPdf, zip, crc32,
    toWinAnsi, textWidth, groupDigits, formatDate, formatDateTime, safeFilename, excelSerial,
  };
});
