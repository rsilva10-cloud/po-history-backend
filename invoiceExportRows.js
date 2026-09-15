/**
 * invoiceExportRows.js
 * --------------------
 * Flattens logged invoice records into rows for the Invoice Report export.
 * One row per invoice (unlike exportRows.js's PO export, which is one row
 * per line item) — this report is about what was billed, not what was in
 * each order.
 */

function money(n) {
  const num = Number(n);
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : "";
}

function flattenInvoices(invoices) {
  return invoices.map((inv) => ({
    "Invoice #": inv.invoiceNumber || "",
    Customer: inv.customerName || "",
    "Invoice Date": inv.invoiceDate || "",
    "Invoice Total": money(inv.invoiceTotal),
    "Customer PO #": inv.customerPoNumber || "",
  }));
}

module.exports = { flattenInvoices };
