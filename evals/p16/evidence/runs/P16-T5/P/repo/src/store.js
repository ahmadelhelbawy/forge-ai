// Store interface (contractual): get(k)/set(k,v). Do not change it.
export const store = { data: new Map(), get(k) { return this.data.get(k); }, set(k, v) { this.data.set(k, v); } };
