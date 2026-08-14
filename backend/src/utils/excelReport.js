const ExcelJS = require('exceljs');

const COLOR_PRIMARY = 'FF065F46';
const COLOR_PRIMARY_LIGHT = 'FF059669';
const COLOR_ACCENT = 'FFF59E0B';
const COLOR_ZEBRA = 'FFF3F8F6';
const COLOR_BORDER = 'FFD7E3DE';

function newWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EcolePay';
  workbook.created = new Date();
  return workbook;
}

/**
 * Ecrit l'en-tete (bandeau ecole + titre + sous-titre) sur les 5 premieres lignes
 * d'une feuille, fusionnees sur `numCols` colonnes. Retourne la ligne libre suivante.
 */
function addLetterhead(sheet, { ecole, title, subtitle, generatedBy, numCols }) {
  const lastCol = String.fromCharCode(64 + numCols); // A, B, C... (jusqu'a 26 colonnes)

  sheet.mergeCells(`A1:${lastCol}1`);
  const nomCell = sheet.getCell('A1');
  nomCell.value = (ecole?.nom || 'EcolePay').toUpperCase();
  nomCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  nomCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(1).height = 28;
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_PRIMARY } };
  for (let c = 1; c <= numCols; c++) sheet.getRow(1).getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_PRIMARY } };

  sheet.mergeCells(`A2:${lastCol}2`);
  const coordCell = sheet.getCell('A2');
  const coord = [ecole?.adresse, ecole?.telephone, ecole?.email].filter(Boolean).join('  •  ');
  coordCell.value = coord || ' ';
  coordCell.font = { size: 9, color: { argb: 'FFE6F2EC' } };
  coordCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(2).height = 16;
  for (let c = 1; c <= numCols; c++) sheet.getRow(2).getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_PRIMARY_LIGHT } };

  sheet.getRow(3).height = 6;

  sheet.mergeCells(`A4:${lastCol}4`);
  const titleCell = sheet.getCell('A4');
  titleCell.value = title;
  titleCell.font = { bold: true, size: 13, color: { argb: COLOR_PRIMARY.replace('FF', 'FF') } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(4).height = 22;

  sheet.mergeCells(`A5:${lastCol}5`);
  const subCell = sheet.getCell('A5');
  const genLine = `Généré le ${new Date().toLocaleString('fr-FR')}${generatedBy ? ` par ${generatedBy}` : ''}`;
  subCell.value = subtitle ? `${subtitle}  —  ${genLine}` : genLine;
  subCell.font = { italic: true, size: 9, color: { argb: 'FF6B7A75' } };
  subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(5).height = 16;

  sheet.getRow(6).height = 6;

  return 7;
}

function deviseLabel(code) { return code === 'CDF' ? 'FC' : code; }

/**
 * Ecrit un tableau de donnees stylise a partir de `startRow` : ligne d'en-tete
 * coloree + lignes de donnees avec bordures et zebra striping + formats numeriques.
 * columns: [{ header, key, width, type: 'text'|'number'|'currency'|'percent', totalize: bool }]
 * Les colonnes de type 'currency' sont supposees exprimees dans la devise principale (USD) ;
 * si options.devise/options.taux sont fournis et != USD, elles sont converties a la volee.
 * Retourne la ligne libre suivante.
 */
function addTable(sheet, startRow, columns, rows, options = {}) {
  const devise = options.devise || 'USD';
  const taux = options.taux || 1;
  const label = deviseLabel(devise);
  const numFmt = devise === 'USD' ? `#,##0.00 "${label}"` : `#,##0 "${label}"`;
  const convertir = (v) => (devise === 'USD' ? v : v * taux);

  // La largeur passee en `col.width` sert de plancher ; on l'elargit automatiquement si le
  // contenu reel (en-tete ou valeurs) est plus long, pour ne jamais tronquer/comprimer un nom,
  // un email ou un montant a 8 chiffres. Les colonnes existantes n'ont donc plus besoin d'un
  // reglage manuel au pixel pres.
  const headerLabels = columns.map((col) => (col.type === 'currency' ? `${col.header} (${label})` : col.header));
  const widths = columns.map((col, i) => Math.max(col.width || 12, headerLabels[i].length + 2));
  rows.forEach((r) => {
    columns.forEach((col, i) => {
      const rawVal = r[col.key];
      let display;
      if (col.type === 'currency') display = convertir(parseFloat(rawVal) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
      else display = rawVal === undefined || rawVal === null ? '' : String(rawVal);
      widths[i] = Math.min(60, Math.max(widths[i], display.length + 2));
    });
  });
  sheet.columns = columns.map((c, i) => ({ key: c.key, width: widths[i] }));

  const headerRow = sheet.getRow(startRow);
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = headerLabels[i];
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_PRIMARY_LIGHT } };
    cell.alignment = { vertical: 'middle', horizontal: col.type === 'text' ? 'left' : 'center' };
    cell.border = { bottom: { style: 'thin', color: { argb: COLOR_BORDER } } };
  });
  headerRow.height = 20;

  const totals = {};
  rows.forEach((r, idx) => {
    const row = sheet.getRow(startRow + 1 + idx);
    columns.forEach((col, i) => {
      const cell = row.getCell(i + 1);
      const rawVal = r[col.key];
      const val = col.type === 'currency' ? convertir(parseFloat(rawVal) || 0) : rawVal;
      cell.value = val === undefined || val === null ? '' : val;
      cell.alignment = { vertical: 'middle', horizontal: col.type === 'text' ? 'left' : 'center' };
      cell.border = { bottom: { style: 'thin', color: { argb: COLOR_BORDER } } };
      if (col.type === 'currency') { cell.numFmt = numFmt; cell.alignment.horizontal = 'right'; }
      if (col.type === 'percent') { cell.numFmt = '0.0"%"'; }
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ZEBRA } };
      if (col.totalize) totals[col.key] = (totals[col.key] || 0) + (parseFloat(rawVal) || 0);
    });
    row.height = 18;
  });

  let nextRow = startRow + 1 + rows.length;
  if (options.showTotals && Object.keys(totals).length) {
    const totalRow = sheet.getRow(nextRow);
    columns.forEach((col, i) => {
      const cell = totalRow.getCell(i + 1);
      cell.border = { top: { style: 'double', color: { argb: COLOR_PRIMARY.replace('FF', 'FF') } } };
      cell.font = { bold: true };
      if (i === 0) cell.value = 'TOTAL';
      else if (col.totalize) {
        cell.value = col.type === 'currency' ? convertir(totals[col.key]) : totals[col.key];
        if (col.type === 'currency') cell.numFmt = numFmt;
        cell.alignment = { horizontal: 'right' };
      }
    });
    totalRow.height = 20;
    nextRow += 1;
  }

  return nextRow + 1;
}

function addSectionTitle(sheet, row, text, numCols) {
  const lastCol = String.fromCharCode(64 + numCols);
  sheet.mergeCells(`A${row}:${lastCol}${row}`);
  const cell = sheet.getCell(`A${row}`);
  cell.value = text;
  cell.font = { bold: true, size: 11, color: { argb: COLOR_PRIMARY } };
  sheet.getRow(row).height = 20;
  return row + 1;
}

async function sendWorkbook(res, workbook, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
}

module.exports = { newWorkbook, addLetterhead, addTable, addSectionTitle, sendWorkbook, deviseLabel, COLOR_PRIMARY, COLOR_PRIMARY_LIGHT, COLOR_ACCENT };
