// k6 load script (T03). Run: k6 run perf/k6-script.js (not in CI).
import http from 'k6/http';
export default function () { http.get('http://localhost:3000/items?page=1&limit=20'); }
