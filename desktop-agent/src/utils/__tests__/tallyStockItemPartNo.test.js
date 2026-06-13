const { injectStockItemPartNo } = require('../tallyStockItemPartNo');

describe('injectStockItemPartNo', () => {
  test('inserts PARTNO before closing STOCKITEM tag', () => {
    const xml = '<STOCKITEM><NAME>Item A</NAME></STOCKITEM>';
    const out = injectStockItemPartNo(xml, 'BC-001');
    expect(out).toContain('<PARTNO>BC-001</PARTNO>');
    expect(out).toMatch(/<PARTNO>BC-001<\/PARTNO>\s*<\/STOCKITEM>/);
  });

  test('replaces existing PARTNO', () => {
    const xml = '<STOCKITEM><PARTNO>OLD</PARTNO></STOCKITEM>';
    const out = injectStockItemPartNo(xml, 'NEW');
    expect(out).toContain('<PARTNO>NEW</PARTNO>');
    expect(out).not.toContain('OLD');
  });
});
