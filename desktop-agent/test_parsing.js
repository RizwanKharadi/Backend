const TallyService = require('./src/services/TallyService');

const tallyService = new TallyService();

// Test Company XML
const companyXml = `<ENVELOPE>
    <HEADER>
        <VERSION>1</VERSION>
        <STATUS>1</STATUS>
    </HEADER>
    <BODY>
        <DESC>
            <CMPINFO>
                <COMPANY>0</COMPANY>
                <GROUP>0</GROUP>
                <LEDGER>0</LEDGER>
                <COSTCATEGORY>0</COSTCATEGORY>
                <COSTCENTRE>0</COSTCENTRE>
                <GODOWN>0</GODOWN>
                <STOCKGROUP>0</STOCKGROUP>
                <STOCKCATEGORY>0</STOCKCATEGORY>
                <STOCKITEM>4</STOCKITEM>
                <VOUCHERTYPE>0</VOUCHERTYPE>
                <CURRENCY>0</CURRENCY>
                <UNIT>0</UNIT>
                <BUDGET>0</BUDGET>
                <CLIENTRULE>0</CLIENTRULE>
                <SERVERRULE>0</SERVERRULE>
                <STATE>0</STATE>
                <TDSRATE>0</TDSRATE>
                <TAXCLASSIFICATION>0</TAXCLASSIFICATION>
                <STCATEGORY>0</STCATEGORY>
                <DEDUCTEETYPE>0</DEDUCTEETYPE>
                <ATTENDANCETYPE>0</ATTENDANCETYPE>
                <FBTCATEGORY>0</FBTCATEGORY>
                <FBTASSESSEETYPE>0</FBTASSESSEETYPE>
                <TARIFFCLASSIFICATION>0</TARIFFCLASSIFICATION>
                <EXCISEDUTYCLASSIFICATION>0</EXCISEDUTYCLASSIFICATION>
                <SERIALNUMBER>0</SERIALNUMBER>
                <ADJUSTMENTCLASSIFICATION>0</ADJUSTMENTCLASSIFICATION>
                <INCOMETAXSLAB>0</INCOMETAXSLAB>
                <INCOMETAXCLASSIFICATION>0</INCOMETAXCLASSIFICATION>
                <LBTCLASSIFICATION>0</LBTCLASSIFICATION>
                <TAXUNIT>0</TAXUNIT>
                <RETURNMASTER>0</RETURNMASTER>
                <GSTCLASSIFICATION>0</GSTCLASSIFICATION>
                <VOUCHERNUMBERSERIES>0</VOUCHERNUMBERSERIES>
                <VOUCHER>0</VOUCHER>
            </CMPINFO>
        </DESC>
        <DATA>
            <COLLECTION>
                <COMPANY NAME="Demo" RESERVEDNAME="">
                    <STARTINGFROM TYPE="Date">20250401</STARTINGFROM>
                    <BOOKSFROM TYPE="Date">20250401</BOOKSFROM>
                    <NAME TYPE="String">Demo</NAME>
                    <GUID TYPE="String">adef226d-68b8-4041-b4bc-2fa6b59ecaca</GUID>
                </COMPANY>
            </COLLECTION>
        </DATA>
    </BODY>
</ENVELOPE>`;

const parsedCompany = tallyService.xmlParser.parse(companyXml);
const companies = tallyService.extractCompaniesFromResponse(parsedCompany);

console.log('Parsed Companies:');
console.log(JSON.stringify(companies, null, 2));

// Test Voucher XML (simplified version)
const voucherXml = `<ENVELOPE>
    <HEADER>
        <VERSION>1</VERSION>
        <STATUS>1</STATUS>
    </HEADER>
    <BODY>
        <DESC>
            <STATICVARIABLES>
                <SVCURRENTCOMPANY>Demo</SVCURRENTCOMPANY>
            </STATICVARIABLES>
        </DESC>
        <DATA>
            <TALLYMESSAGE xmlns:UDF="TallyUDF">
                <VOUCHER REMOTEID="adef226d-68b8-4041-b4bc-2fa6b59ecaca-00000003" VCHKEY="adef226d-68b8-4041-b4bc-2fa6b59ecaca-0000b434:00000008" VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
                    <DATE>20260421</DATE>
                    <GUID>adef226d-68b8-4041-b4bc-2fa6b59ecaca-00000003</GUID>
                    <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
                    <VOUCHERNUMBER>2</VOUCHERNUMBER>
                    <PARTYNAME>ABC Enterprises</PARTYNAME>
                    <GSTREGISTRATION TAXTYPE="GST" TAXREGISTRATION="">Maharashtra Registration</GSTREGISTRATION>
                    <PLACEOFSUPPLY>Maharashtra</PLACEOFSUPPLY>
                    <STATENAME>Maharashtra</STATENAME>
                    <PARTYGSTIN></PARTYGSTIN>
                    <ALLINVENTORYENTRIES.LIST>
                        <STOCKITEMNAME>Iphone 17 Pro</STOCKITEMNAME>
                        <ACTUALQTY> 2.00 Nos</ACTUALQTY>
                        <BILLEDQTY> 2.00 Nos</BILLEDQTY>
                        <RATE>135000.00/Nos</RATE>
                        <AMOUNT>270000.00</AMOUNT>
                    </ALLINVENTORYENTRIES.LIST>
                    <LEDGERENTRIES.LIST>
                        <LEDGERNAME>ABC Enterprises</LEDGERNAME>
                        <AMOUNT>-270000.00</AMOUNT>
                    </LEDGERENTRIES.LIST>
                </VOUCHER>
            </TALLYMESSAGE>
        </DATA>
    </BODY>
</ENVELOPE>`;

const parsedVoucher = tallyService.xmlParser.parse(voucherXml);
const vouchers = tallyService.extractVouchersFromResponse(parsedVoucher);

console.log('\nParsed Vouchers:');
console.log(JSON.stringify(vouchers, null, 2));

// Test Parties XML
const partiesXml = `<ENVELOPE>
    <HEADER>
        <VERSION>1</VERSION>
        <STATUS>1</STATUS>
    </HEADER>
    <BODY>
        <DESC>
            <CMPINFO>
                <COMPANY>0</COMPANY>
                <GROUP>0</GROUP>
                <LEDGER>6</LEDGER>
                <COSTCATEGORY>0</COSTCATEGORY>
                <COSTCENTRE>0</COSTCENTRE>
                <GODOWN>2</GODOWN>
                <STOCKGROUP>0</STOCKGROUP>
                <STOCKCATEGORY>0</STOCKCATEGORY>
                <STOCKITEM>6</STOCKITEM>
                <VOUCHERTYPE>0</VOUCHERTYPE>
                <CURRENCY>1</CURRENCY>
                <UNIT>0</UNIT>
                <BUDGET>0</BUDGET>
                <CLIENTRULE>0</CLIENTRULE>
                <SERVERRULE>0</SERVERRULE>
                <STATE>0</STATE>
                <TDSRATE>0</TDSRATE>
                <TAXCLASSIFICATION>0</TAXCLASSIFICATION>
                <STCATEGORY>0</STCATEGORY>
                <DEDUCTEETYPE>0</DEDUCTEETYPE>
                <ATTENDANCETYPE>0</ATTENDANCETYPE>
                <FBTCATEGORY>0</FBTCATEGORY>
                <FBTASSESSEETYPE>0</FBTASSESSEETYPE>
                <TARIFFCLASSIFICATION>0</TARIFFCLASSIFICATION>
                <EXCISEDUTYCLASSIFICATION>0</EXCISEDUTYCLASSIFICATION>
                <SERIALNUMBER>0</SERIALNUMBER>
                <ADJUSTMENTCLASSIFICATION>0</ADJUSTMENTCLASSIFICATION>
                <INCOMETAXSLAB>0</INCOMETAXSLAB>
                <INCOMETAXCLASSIFICATION>0</INCOMETAXCLASSIFICATION>
                <LBTCLASSIFICATION>0</LBTCLASSIFICATION>
                <TAXUNIT>2</TAXUNIT>
                <RETURNMASTER>0</RETURNMASTER>
                <GSTCLASSIFICATION>0</GSTCLASSIFICATION>
                <VOUCHERNUMBERSERIES>3</VOUCHERNUMBERSERIES>
                <VOUCHER>2</VOUCHER>
            </CMPINFO>
        </DESC>
        <DATA>
            <COLLECTION ISMSTDEPTYPE="Yes" MSTDEPTYPE="8">
                <LEDGER NAME="ABC Enterprises" RESERVEDNAME="">
                    <GUID>adef226d-68b8-4041-b4bc-2fa6b59ecaca-000000ce</GUID>
                    <PARENT>Sundry Debtors</PARENT>
                    <COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>
                    <LEDGSTREGDETAILS.LIST>
                        <APPLICABLEFROM>20250401</APPLICABLEFROM>
                        <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
                        <PLACEOFSUPPLY>Maharashtra</PLACEOFSUPPLY>
                    </LEDGSTREGDETAILS.LIST>
                    <LEDMAILINGDETAILS.LIST>
                        <APPLICABLEFROM>20250401</APPLICABLEFROM>
                        <MAILINGNAME>ABC Enterprises</MAILINGNAME>
                        <STATE>Maharashtra</STATE>
                        <COUNTRY>India</COUNTRY>
                    </LEDMAILINGDETAILS.LIST>
                    <CONTACTDETAILS.LIST>
                        <NAME>Primary Mobile No.</NAME>
                        <PHONENUMBER/>
                        <COUNTRYISDCODE>+91</COUNTRYISDCODE>
                    </CONTACTDETAILS.LIST>
                </LEDGER>
                <LEDGER NAME="XYZ Enterprises" RESERVEDNAME="">
                    <GUID>adef226d-68b8-4041-b4bc-2fa6b59ecaca-000000d2</GUID>
                    <PARENT>Sundry Creditors</PARENT>
                    <COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>
                    <LEDGSTREGDETAILS.LIST>
                        <APPLICABLEFROM>20250401</APPLICABLEFROM>
                        <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
                        <PLACEOFSUPPLY>Maharashtra</PLACEOFSUPPLY>
                    </LEDGSTREGDETAILS.LIST>
                    <LEDMAILINGDETAILS.LIST>
                        <APPLICABLEFROM>20250401</APPLICABLEFROM>
                        <MAILINGNAME>XYZ Enterprises</MAILINGNAME>
                        <STATE>Maharashtra</STATE>
                        <COUNTRY>India</COUNTRY>
                    </LEDMAILINGDETAILS.LIST>
                </LEDGER>
            </COLLECTION>
        </DATA>
    </BODY>
</ENVELOPE>`;

const parsedParties = tallyService.xmlParser.parse(partiesXml);
const parties = tallyService.extractPartiesFromResponse(parsedParties);

console.log('\nParsed Parties:');
console.log(JSON.stringify(parties, null, 2));