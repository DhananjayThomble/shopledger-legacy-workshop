var test = require('node:test');
var assert = require('node:assert/strict');
var pricing = require('../lib/pricing');
var invoice = require('../lib/invoice');
var reports = require('../lib/reports');

function billedOrder(items, coupon) {
  var totals = pricing.computeTotals(items, coupon);
  return {
    id: 101,
    items: items,
    coupon: coupon,
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: totals.tax,
    total: totals.total
  };
}

function mixedItems() {
  return [
    { id: 1, name: 'Rice', hsn: '1006', price: 500, qty: 2 },
    { id: 2, name: 'Ghee', hsn: '0405', price: 1000, qty: 1 }
  ];
}

test('billing apportions the capped coupon before applying each HSN rate', function () {
  var bill = pricing.computeTotals(mixedItems(), 'SAVE10');

  assert.deepEqual(
    [bill.subtotal, bill.discount, bill.taxable, bill.tax, bill.cgst, bill.sgst, bill.total],
    [2000, 150, 1850, 157.25, 78.63, 78.62, 2007.25]
  );
  assert.deepEqual(bill.lines.map(function (line) {
    return [line.gstPercent, line.discount, line.taxable, line.tax];
  }), [[5, 75, 925, 46.25], [12, 75, 925, 111]]);
});

test('invoice honours a legacy whole-percent GST rate when present', function () {
  var order = billedOrder([
    { id: 1, name: 'Rice', hsn: '1006', price: 100, qty: 1, gstRate: 12 }
  ], '');
  var figures = invoice.computeInvoiceFigures(order);

  assert.equal(figures.rows[0].gstPercent, 12);
  assert.equal(figures.tax, 12);
  assert.equal(figures.total, 112);
  assert.doesNotMatch(invoice.render(order), /Accountant Reconciliation Notice/);
  assert.equal(reports.getGstReconciliation({ orders: [order] }).mismatchCount, 0);
});

test('invoice total GST sums the same rounded line taxes used for billing', function () {
  var order = billedOrder([1, 2, 3].map(function (id) {
    return { id: id, name: 'Sample item', price: 0.03, qty: 1 };
  }), '');
  var figures = invoice.computeInvoiceFigures(order);

  assert.deepEqual(figures.rows.map(function (row) { return row.lineTax; }), [0.01, 0.01, 0.01]);
  assert.deepEqual([order.tax, order.total, figures.tax, figures.total], [0.03, 0.12, 0.03, 0.12]);
});

test('invoice preserves stored bill figures and uses the recorded coupon amount', function () {
  var order = { id: 102, items: mixedItems(), coupon: 'SAVE10', subtotal: 2000,
    discount: 200, tax: 153, total: 1953 };
  var figures = invoice.computeInvoiceFigures(order);
  var report = reports.getGstReconciliation({ orders: [order] });

  assert.deepEqual([figures.discount, figures.tax, figures.total], [200, 153, 1953]);
  assert.deepEqual(figures.rows.map(function (row) { return row.lineTax; }), [45, 108]);
  assert.equal(report.mismatchCount, 0);
  assert.equal(report.totalDelta, 0);
});

test('invoice flags when reconstructed line GST differs from stored GST', function () {
  var order = { id: 103, items: mixedItems(), subtotal: 2000,
    discount: 0, tax: 180, total: 2180 };

  var html = invoice.render(order);
  assert.match(html, /Invoice Total<\/td><td class="r">₹2180\.00/);
  assert.match(html, /Reconstructed line GST \(₹170\.00\) differs from recorded GST \(₹180\.00\)/);
});

test('invoice prints the billed total and GST breakdown for a discounted mixed-rate order', function () {
  var order = billedOrder(mixedItems(), 'SAVE10');
  var figures = invoice.computeInvoiceFigures(order);

  assert.equal(figures.total, 2007.25);
  assert.deepEqual([figures.discount, figures.tax, figures.cgst, figures.sgst],
    [150, 157.25, 78.63, 78.62]);
  assert.deepEqual(figures.rows.map(function (row) {
    return [row.gstPercent, row.lineTax];
  }), [[5, 46.25], [12, 111]]);
  var html = invoice.render(order);
  assert.match(html, /Invoice Total<\/td><td class="r">₹2007\.25/);
  assert.match(html, /CGST<\/td><td class="r">₹78\.63/);
  assert.match(html, /SGST<\/td><td class="r">₹78\.62/);
  assert.match(html, /Total GST\)<\/td><td class="r">₹157\.25/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
  assert.equal(reports.getGstReconciliation({ orders: [order] }).mismatchCount, 0);
});
