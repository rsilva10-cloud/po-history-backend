/**
 * exportRows.js
 * -------------
 * Flattens a PO (with nested line items and shipments) into one row per
 * line item, for Excel/CSV export. Relies on line items already carrying
 * denormalized itemName/warehouseName fields \u2014 the front end fills those
 * in before saving to this backend, since this backend doesn't have the
 * item catalog itself.
 */

function money(n) {
  const num = Number(n);
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : "";
}

function flattenPOs(pos) {
  const rows = [];

  pos.forEach((po) => {
    const lineItems = po.lineItems || [];
    const shipments = po.shipments || {};

    if (lineItems.length === 0) {
      rows.push({
        "PO Number": po.poNumber || "",
        Customer: po.customerName || "",
        "Ship Street": po.shipStreet || "",
        "Ship City": po.shipCity || "",
        "Ship State": po.shipState || "",
        "Ship Zip": po.shipZip || "",
        "Order Date": po.orderDate || "",
        Status: po.status || "",
        SKU: "",
        "SKU Number": "",
        "Item Name": "",
        Qty: "",
        "Purchase Price": "",
        "Sell Price": "",
        "Line Margin $": "",
        "Line Margin %": "",
        Warehouse: "",
        Carrier: "",
        "Tracking #": "",
        "Ship Date": "",
      });
      return;
    }

    lineItems.forEach((li) => {
      const shipment = shipments[li.warehouseId] || {};
      const qty = Number(li.qty) || 0;
      const purchase = Number(li.purchasePrice) || 0;
      const sell = Number(li.sellPrice) || 0;
      const marginDollar = (sell - purchase) * qty;
      const marginPct = sell > 0 ? ((sell - purchase) / sell) * 100 : 0;
      const carrier = shipment.carrier === "Other" ? shipment.customCarrier || "Other" : shipment.carrier || "";

      rows.push({
        "PO Number": po.poNumber || "",
        Customer: po.customerName || "",
        "Ship Street": po.shipStreet || "",
        "Ship City": po.shipCity || "",
        "Ship State": po.shipState || "",
        "Ship Zip": po.shipZip || "",
        "Order Date": po.orderDate || "",
        Status: po.status || "",
        SKU: li.sku || "",
        "SKU Number": li.skuNumber || "",
        "Item Name": li.itemName || "",
        Qty: qty,
        "Purchase Price": money(purchase),
        "Sell Price": money(sell),
        "Line Margin $": money(marginDollar),
        "Line Margin %": Math.round(marginPct * 10) / 10,
        Warehouse: li.warehouseName || li.warehouseId || "",
        Carrier: carrier,
        "Tracking #": shipment.tracking || "",
        "Ship Date": shipment.shipDate || "",
      });
    });
  });

  return rows;
}

function toCsv(rows) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (val) => {
    const s = val == null ? "" : String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  });
  return lines.join("\n");
}

module.exports = { flattenPOs, toCsv };
