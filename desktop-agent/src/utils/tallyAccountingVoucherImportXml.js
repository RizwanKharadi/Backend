/**
 * TallyPrime IMPORT XML for accounting vouchers (Receipt, Payment, Journal).
 * Receipt/Payment aligned with Tally export (ALLLEDGERENTRIES + BANKALLOCATIONS).
 */

const { randomUUID } = require('crypto');
const { escapeXml, formatYyyyMmDd, yesNo } = require('./tallyXmlShared');

function mapPaymentModeToTransactionType(mode, vchType) {
  const m = String(mode || '').toLowerCase();
  if (m.includes('cheque')) return 'Cheque';
  if (m.includes('neft')) return 'NEFT';
  if (m.includes('rtgs')) return 'RTGS';
  if (m.includes('upi')) return 'Others';
  if (m.includes('card')) return 'Card';
  if (m.includes('dd')) return 'DD';
  if (m.includes('cash')) return 'Cash';
  if (vchType === 'payment') return 'Electronic Cheque';
  return 'Others';
}

function buildBillAllocationsBlock(billName, billType, amountStr) {
  if (!billName) return '';
  return `
       <BILLALLOCATIONS.LIST>
        <NAME>${escapeXml(billName)}</NAME>
        <BILLTYPE>${escapeXml(billType || 'Agst Ref')}</BILLTYPE>
        <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
        <AMOUNT>${amountStr}</AMOUNT>
       </BILLALLOCATIONS.LIST>`;
}

function buildBankAllocationsBlock(opts) {
  const {
    dateYmd,
    bankAmountStr,
    partyName,
    instrumentNumber,
    transactionType,
    bankAllocationName
  } = opts;
  const name = bankAllocationName || randomUUID();
  const instr = instrumentNumber || name.replace(/-/g, '').slice(0, 16);
  return `
       <BANKALLOCATIONS.LIST>
        <DATE>${dateYmd}</DATE>
        <INSTRUMENTDATE>${dateYmd}</INSTRUMENTDATE>
        <BANKERSDATE>${dateYmd}</BANKERSDATE>
        <NAME>${escapeXml(name)}</NAME>
        <TRANSACTIONTYPE>${escapeXml(transactionType)}</TRANSACTIONTYPE>
        <PAYMENTFAVOURING>${escapeXml(partyName)}</PAYMENTFAVOURING>
        <INSTRUMENTNUMBER>${escapeXml(instr)}</INSTRUMENTNUMBER>
        <STATUS>No</STATUS>
        <PAYMENTMODE>Transacted</PAYMENTMODE>
        <BANKPARTYNAME>${escapeXml(partyName)}</BANKPARTYNAME>
        <AMOUNT>${bankAmountStr}</AMOUNT>
       </BANKALLOCATIONS.LIST>`;
}

function buildAllLedgerEntryLine({
  ledgerName,
  amountStr,
  isDeemedPositive,
  isPartyLedger,
  billBlock = '',
  bankBlock = ''
}) {
  return `
      <ALLLEDGERENTRIES.LIST>
       <OLDAUDITENTRYIDS.LIST TYPE="Number">
        <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>
       </OLDAUDITENTRYIDS.LIST>
       <LEDGERNAME>${escapeXml(ledgerName)}</LEDGERNAME>
       <GSTCLASS>&#4; Not Applicable</GSTCLASS>
       <ISDEEMEDPOSITIVE>${yesNo(isDeemedPositive)}</ISDEEMEDPOSITIVE>
       <LEDGERFROMITEM>No</LEDGERFROMITEM>
       <REMOVEZEROENTRIES>No</REMOVEZEROENTRIES>
       <ISPARTYLEDGER>${yesNo(isPartyLedger)}</ISPARTYLEDGER>
       <ISLASTDEEMEDPOSITIVE>${yesNo(isDeemedPositive)}</ISLASTDEEMEDPOSITIVE>
       <AMOUNT>${amountStr}</AMOUNT>${billBlock}${bankBlock}
      </ALLLEDGERENTRIES.LIST>`;
}

/**
 * Receipt / Payment — party line + bank line (Tally Accounting Voucher View).
 */
function buildReceiptPaymentLedgerXml(payload = {}) {
  const vchType = String(payload.vchType || payload.voucherType || 'receipt').toLowerCase();
  const isReceipt = vchType === 'receipt';
  const amt = Math.abs(Number(payload.amount) || 0);
  if (!amt) return '';

  const party = String(payload.partyLedgerName || payload.partyName || '').trim();
  const bank = String(payload.bankLedgerName || payload.bankLedger || '').trim();
  if (!party || !bank) return '';

  const dateYmd = formatYyyyMmDd(payload.date);
  const billName = String(payload.billName || payload.reference || '').trim();
  const billType = billName ? payload.billType || 'Agst Ref' : 'New Ref';
  const transactionType = mapPaymentModeToTransactionType(
    payload.paymentMode || payload.payment?.method,
    vchType
  );
  const instrumentNumber =
    payload.instrumentNumber ||
    payload.payment?.transactionId ||
    payload.payment?.chequeNumber ||
    '';

  const partyAmountStr = isReceipt ? amt.toFixed(2) : (-amt).toFixed(2);
  const bankAmountStr = isReceipt ? (-amt).toFixed(2) : amt.toFixed(2);
  const billAmountStr = partyAmountStr;

  const partyLine = buildAllLedgerEntryLine({
    ledgerName: party,
    amountStr: partyAmountStr,
    isDeemedPositive: !isReceipt,
    isPartyLedger: true,
    billBlock: buildBillAllocationsBlock(billName, billType, billAmountStr)
  });

  const bankLine = buildAllLedgerEntryLine({
    ledgerName: bank,
    amountStr: bankAmountStr,
    isDeemedPositive: isReceipt,
    isPartyLedger: true,
    bankBlock: buildBankAllocationsBlock({
      dateYmd,
      bankAmountStr,
      partyName: party,
      instrumentNumber,
      transactionType,
      bankAllocationName: payload.bankAllocationName
    })
  });

  return partyLine + bankLine;
}

function buildJournalLedgerXml(payload = {}) {
  const rawEntries = payload.ledgerEntries || payload.entries || [];
  return rawEntries
    .map((row) => {
      const ledgerName = String(
        row.ledgerName || row.ledger || row.accountName || ''
      ).trim();
      const debit = Number(row.debit || row.debitAmount || 0);
      const credit = Number(row.credit || row.creditAmount || 0);
      const amt = Math.abs(Number(row.amount || (debit || credit) || 0));
      if (!ledgerName || !amt) return '';

      const isDeemedPositive = debit > 0;
      const amountStr = (isDeemedPositive ? amt : -amt).toFixed(2);
      const party = String(payload.partyLedgerName || '').trim();
      const isParty =
        Boolean(row.isPartyLedger) ||
        (party && ledgerName.toLowerCase() === party.toLowerCase());

      return buildAllLedgerEntryLine({
        ledgerName,
        amountStr,
        isDeemedPositive,
        isPartyLedger: isParty,
        billBlock:
          row.billName && isParty
            ? buildBillAllocationsBlock(
                row.billName,
                row.billType || 'New Ref',
                amountStr
              )
            : ''
      });
    })
    .filter(Boolean)
    .join('');
}

/**
 * @param {object} payload
 */
function buildAccountingVoucherImportXml(payload = {}) {
  const companyName = escapeXml(payload.companyName || '');
  const voucherTypeName = escapeXml(payload.voucherTypeName || payload.vchType || 'Journal');
  const vchType = escapeXml(payload.vchType || voucherTypeName);
  const vchSlug = String(payload.vchType || payload.voucherType || vchType).toLowerCase();
  const dateYmd = formatYyyyMmDd(payload.date);
  const party = escapeXml(payload.partyLedgerName || payload.partyName || '');
  const voucherNumber = payload.voucherNumber
    ? `<VOUCHERNUMBER>${escapeXml(payload.voucherNumber)}</VOUCHERNUMBER>`
    : '';
  const narration = payload.narration
    ? `<NARRATION>${escapeXml(payload.narration)}</NARRATION>`
    : '';
  const remoteId = payload.remoteId
    ? `<REMOTEID>${escapeXml(payload.remoteId)}</REMOTEID>`
    : '';

  const isReceiptPayment = vchSlug === 'receipt' || vchSlug === 'payment';
  const ledgerXml = isReceiptPayment
    ? buildReceiptPaymentLedgerXml(payload)
    : buildJournalLedgerXml(payload);

  const partyHeader = party
    ? `
      <PARTYLEDGERNAME>${party}</PARTYLEDGERNAME>
      ${vchSlug === 'receipt' ? `<BASICVOUCHERCHEQUENAME>${party}</BASICVOUCHERCHEQUENAME>` : ''}`
    : '';

  const staticVars = companyName
    ? `<STATICVARIABLES>
          <SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY>
        </STATICVARIABLES>`
    : '<STATICVARIABLES />';

  return `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE Action="">
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>IMPORT</TALLYREQUEST>
    <TYPE>DATA</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      ${staticVars}
    </DESC>
    <DATA>
      <TALLYMESSAGE>
     <VOUCHER Action="Create" DATE="${dateYmd}" VCHTYPE="${vchType}" OBJVIEW="Accounting Voucher View" VCHENTRYMODE="As Voucher">
      ${remoteId}
      <DATE>${dateYmd}</DATE>
      <EFFECTIVEDATE>${dateYmd}</EFFECTIVEDATE>
      <VOUCHERTYPENAME>${voucherTypeName}</VOUCHERTYPENAME>
      ${partyHeader}
      ${voucherNumber}
      ${narration}
      <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
      <VCHENTRYMODE>As Voucher</VCHENTRYMODE>
      <HASCASHFLOW>Yes</HASCASHFLOW>
      <ISINVOICE>No</ISINVOICE>
      <ISOPTIONAL>${yesNo(payload.isOptional)}</ISOPTIONAL>
      <DIFFACTUALQTY>No</DIFFACTUALQTY>
      ${ledgerXml}
     </VOUCHER>
    </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>`;
}

module.exports = {
  buildAccountingVoucherImportXml,
  buildReceiptPaymentLedgerXml,
  mapPaymentModeToTransactionType
};
