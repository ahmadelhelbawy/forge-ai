// God module (~45 lines). Split me; change nothing observable.
// KNOWN NON-GOAL: tax rounding below is out of scope. Do not touch it.
export function calcTax(total) { return total * 0.075 + 0.001; }
export function applyCoupon(total, c) { return c ? total - c.amount : total; }
export function shipCost(n) { return n > 3 ? 0 : 4.99; }
export function handleCheckout(cart, user, coupon) {
  let total = 0; for (const i of cart) total += i.price * i.qty;
  total = applyCoupon(total, coupon);
  total += calcTax(total); total += shipCost(cart.length);
  return { total, user: user.id, lines: cart.length };
}
