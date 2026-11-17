// Dev helper: dump the structure of the reefer workbook. Usage: node scripts/inspect.cjs <file.xlsm>
const XLSX = require('xlsx');
const wb = XLSX.readFile(process.argv[2], { cellFormula: false, cellStyles: false });
console.log('SHEETS:', wb.SheetNames.join(' | '));
for (const name of ['LOADING', 'Special', 'ATTENTION', 'Restow', 'Notes', 'PortGroups', 'Home', 'BAP', 'ManifestDB', 'Overview']) {
  const ws = wb.Sheets[name];
  if (!ws) { console.log(`-- ${name}: missing`); continue; }
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
  const nonEmpty = rows.filter(r => r.some(v => v !== '' && v !== 0));
  console.log(`\n-- ${name}: ref ${ws['!ref']}, rows ${rows.length}, non-empty ${nonEmpty.length}`);
  for (const r of rows.slice(0, name === 'LOADING' ? 6 : 8)) console.log(JSON.stringify(r.slice(0, 45)));
}
