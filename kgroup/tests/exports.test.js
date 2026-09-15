/* =========================================================================
   Exports CSV / XLSX / PDF (exports.js) — fichiers produits sans bibliothèque,
   donc vérifiés ici au niveau de leur structure : un octet décalé dans une
   table xref ou un CRC faux, et Excel ou le lecteur PDF refusent le fichier.
   ========================================================================= */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

const X = require("../exports.js");

const COLUMNS = [
  { key: "at", label: "Date", type: "datetime" },
  { key: "customer", label: "Client", type: "text" },
  { key: "qty", label: "Qté", type: "int", total: "sum" },
  { key: "amount", label: "Montant", type: "money", total: "sum" },
  { key: "share", label: "Part", type: "percent" },
];
const ROWS = [
  { at: "2026-09-01T09:05:00", customer: "Zoé ; « Aït »", qty: 2, amount: 300, share: 0.25 },
  { at: "2026-09-02T18:30:00", customer: "=CMD()", qty: 1, amount: 1500, share: 0.125 },
  { at: "2026-09-03T10:00:00", customer: 'Guillemets "doubles"\nsur deux lignes', qty: 3, amount: 450, share: 0.625 },
];
const SPEC = {
  filename: "Rapport des ventes — Sept. 2026",
  title: "Rapport des ventes",
  subtitle: "Du 01/09/2026 au 30/09/2026",
  kpis: [{ label: "Chiffre d'affaires", value: "2 250 DHS" }],
  chart: { title: "CA", labels: ["1", "2", "3"], values: [300, 1500, 450] },
  sections: [{ name: "Ventes", title: "Détail", columns: COLUMNS, rows: ROWS, totals: true }],
};

/* ---- lecture minimale d'une archive ZIP ---- */
function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.strictEqual(dv.getUint32(end, true), 0x06054b50, "fin de répertoire central");
  const count = dv.getUint16(end + 10, true);
  let at = dv.getUint32(end + 16, true);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.strictEqual(dv.getUint32(at, true), 0x02014b50, "entrée du répertoire central");
    const crc = dv.getUint32(at + 16, true);
    const size = dv.getUint32(at + 20, true);
    const nameLen = dv.getUint16(at + 28, true);
    const local = dv.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    assert.strictEqual(dv.getUint32(local, true), 0x04034b50, `en-tête local de ${name}`);
    const localNameLen = dv.getUint16(local + 26, true);
    const data = bytes.subarray(local + 30 + localNameLen, local + 30 + localNameLen + size);
    assert.strictEqual(X.crc32(data), crc, `CRC de ${name}`);
    files[name] = new TextDecoder().decode(data);
    at += 46 + nameLen;
  }
  return files;
}

test("CSV : BOM, séparateur « ; », guillemets et formules neutralisées", () => {
  const file = X.build("csv", SPEC);
  assert.strictEqual(file.filename, "Rapport-des-ventes-Sept.-2026.csv", "nom de fichier sans accent ni espace");
  assert.deepStrictEqual([...file.bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "BOM UTF-8 pour Excel");
  const text = new TextDecoder().decode(file.bytes.slice(3));
  const lines = text.split("\r\n");
  assert.strictEqual(lines[0], "Date;Client;Qté;Montant;Part");
  assert.strictEqual(lines[1], '01/09/2026 09:05;"Zoé ; « Aït »";2;300;25,0', "un « ; » dans une valeur est protégé");
  assert.ok(lines[2].includes(";'=CMD();"), "une formule saisie ne s'exécute pas à l'ouverture");
  assert.ok(text.includes('"Guillemets ""doubles""\nsur deux lignes"'), "guillemets doublés, retour à la ligne conservé");
  assert.ok(text.trimEnd().endsWith("Total;;6;2250;"), "ligne de total");
});

test("XLSX : archive valide, cellules typées, totaux en formules", () => {
  const file = X.build("xlsx", SPEC);
  assert.strictEqual(file.mime, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const files = readZip(file.bytes);
  for (const part of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/styles.xml",
    "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]) {
    assert.ok(files[part], `partie ${part} présente`);
  }
  assert.match(files["xl/workbook.xml"], /<sheet name="Résumé" sheetId="1"/);
  assert.match(files["xl/workbook.xml"], /<sheet name="Ventes" sheetId="2"/);

  const sheet = files["xl/worksheets/sheet2.xml"];
  assert.match(sheet, /<c r="C5" s="2"><v>2<\/v><\/c>/, "quantité : nombre, pas texte");
  assert.match(sheet, /<c r="D6" s="3"><v>1500<\/v><\/c>/, "montant au format DHS");
  assert.match(sheet, /<c r="A5" s="4"><v>46266\.37847\d*<\/v><\/c>/, "date au format numérique Excel");
  assert.match(sheet, /<f>SUM\(D5:D7\)<\/f><v>2250<\/v>/, "total : formule + valeur calculée");
  assert.ok(sheet.includes("Zoé ; « Aït »"), "UTF-8 préservé");
  assert.ok(sheet.includes("&lt;") === false && sheet.includes("Guillemets &quot;doubles&quot;"), "XML échappé");
  assert.match(sheet, /<pane ySplit="4" topLeftCell="A5"/, "en-tête figé");
  assert.match(sheet, /<autoFilter ref="A4:E7"\/>/, "filtres sur le tableau");
});

test("XLSX : caractères interdits en XML retirés sans casser le reste", () => {
  const nasty = { ...SPEC, kpis: null, sections: [{ name: "a/b:c*?", columns: COLUMNS.slice(1, 2), rows: [{ customer: "AB\uD800C😀" }] }] };
  const files = readZip(X.build("xlsx", nasty).bytes);
  assert.match(files["xl/workbook.xml"], /<sheet name="a b c" /, "nom de feuille nettoyé");
  assert.ok(files["xl/worksheets/sheet1.xml"].includes(">ABC😀<"));
});

test("PDF : structure valide, offsets xref exacts, texte en WinAnsi", () => {
  const file = X.build("pdf", { ...SPEC, orientation: "landscape" });
  const pdf = Buffer.from(file.bytes).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-1.4\n"));
  assert.ok(pdf.trimEnd().endsWith("%%EOF"));

  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(pdf)[1]);
  assert.strictEqual(pdf.slice(startxref, startxref + 4), "xref", "startxref pointe sur la table");
  const [, first, count] = /xref\n(\d+) (\d+)\r?\n/.exec(pdf.slice(startxref));
  assert.strictEqual(Number(first), 0);
  const entries = pdf.slice(startxref).split("\n").slice(2, 2 + Number(count)).map((l) => l.replace("\r", ""));
  entries.slice(1).forEach((e, i) => {
    const offset = Number(e.slice(0, 10));
    assert.strictEqual(pdf.slice(offset, offset + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `objet ${i + 1}`);
  });
  for (const m of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const start = m.index + m[0].length;
    assert.strictEqual(pdf.slice(start + Number(m[1]), start + Number(m[1]) + 10), "\nendstream", "longueur de flux exacte");
  }
  assert.match(pdf, /\/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding/);
  assert.ok(pdf.includes("(D\\351tail)"), "« é » encodé en octal WinAnsi");
  assert.ok(pdf.includes("/Count 1"), "une page pour ce petit rapport");
});

test("PDF : titre des métadonnées en UTF-16, tiret cadratin compris", () => {
  const pdf = Buffer.from(X.build("pdf", { title: "Relevé — Zoé", sections: [] }).bytes).toString("latin1");
  const hex = /\/Title <FEFF([0-9A-F]+)>/.exec(pdf)[1];
  const title = Buffer.from(hex, "hex").swap16().toString("utf16le");
  assert.strictEqual(title, "Relevé — Zoé");
});

test("PDF : les longs tableaux se paginent et répètent l'en-tête", () => {
  const rows = Array.from({ length: 180 }, (_, i) => ({ at: "2026-09-01T10:00:00", customer: `Client ${i}`, qty: 1, amount: 50, share: 0 }));
  const pdf = Buffer.from(X.build("pdf", { title: "Long", sections: [{ title: "Détail", columns: COLUMNS, rows }] }).bytes).toString("latin1");
  const pages = Number(/\/Count (\d+)/.exec(pdf)[1]);
  assert.ok(pages >= 4, `180 lignes sur plusieurs pages (${pages})`);
  assert.strictEqual((pdf.match(/\(Montant\) Tj/g) || []).length, pages, "en-tête répété sur chaque page");
  assert.ok(pdf.includes(`(Page ${pages} / ${pages})`), "numérotation des pages");
});

test("WinAnsi : accents, ponctuation typographique, pictogrammes", () => {
  assert.deepStrictEqual(X.toWinAnsi("é€’…"), [0xe9, 0x80, 0x92, 0x85]);
  assert.deepStrictEqual(X.toWinAnsi("1 234"), [49, 32, 50, 51, 52], "espace fine insécable -> espace");
  assert.deepStrictEqual(X.toWinAnsi("ă"), [97], "lettre hors Latin-1 -> lettre de base");
  assert.deepStrictEqual(X.toWinAnsi("💰OK"), [79, 75], "pictogramme retiré");
  assert.deepStrictEqual(X.toWinAnsi("س"), [63], "écriture non latine signalée par ?");
});

test("format inconnu refusé", () => {
  assert.throws(() => X.build("docx", SPEC), /Format d'export inconnu/);
});
