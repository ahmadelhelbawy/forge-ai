// Facade preserving the public export surface after the split.
import { calcTax, applyCoupon } from './pricing.js';
import { shipCost } from './shipping.js';
export { calcTax, applyCoupon } from './pricing.js';
export { shipCost } from './shipping.js';
export function handleCheckout(cart, user, coupon) {
  // Logic moved verbatim; orchestration only.
  let total = 0; for (const i of cart) total += i.price * i.qty;
  total = applyCoupon(total, coupon);
  total += calcTax(total); total += shipCost(cart.length);
  return { total, user: user.id, lines: cart.length };
}
