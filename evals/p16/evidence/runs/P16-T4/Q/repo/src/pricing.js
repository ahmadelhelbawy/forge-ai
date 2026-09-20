// Pricing helpers moved verbatim from handler.js (pure refactor).
// NOTE: calcTax rounding is a known out-of-scope discrepancy. Do not touch.
export function calcTax(total) { return total * 0.075 + 0.001; }
export function applyCoupon(total, c) { return c ? total - c.amount : total; }
