/**
 * Inject TallyPrime PARTNO into stock item IMPORT XML.
 * @see https://help.tallysolutions.com/sample-xml/ (Stock Item — Part No)
 */

function escapeXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {string} xml - STOCKITEM import XML from tally-sync-ts buildPostXml
 * @param {string} partNo
 * @returns {string}
 */
function injectStockItemPartNo(xml, partNo) {
  const value = String(partNo || '').trim();
  if (!value) return xml;
  const tag = `<PARTNO>${escapeXml(value)}</PARTNO>`;
  if (/<PARTNO>/i.test(xml)) {
    return xml.replace(/<PARTNO>[^<]*<\/PARTNO>/i, tag);
  }
  return xml.replace(/<\/STOCKITEM>/i, `${tag}</STOCKITEM>`);
}

module.exports = { injectStockItemPartNo, escapeXml };
