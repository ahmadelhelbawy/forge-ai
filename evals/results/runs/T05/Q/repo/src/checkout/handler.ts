// T04: 60-line single handler to split. Behaviour must not change.
export function handleCheckout(cart, user, coupon, gift, tax, ship) {
  let total = 0; for (const i of cart) total += i.price * i.qty;
  if (coupon) total -= coupon.amount; if (gift) total -= gift.amount;
  total += total * tax; total += ship;
  return { total, user: user.id, lines: cart.length };
}
