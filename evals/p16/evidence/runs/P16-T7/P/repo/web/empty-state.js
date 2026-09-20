// Empty dashboard state: token-driven, role=status preserved.
export function renderEmptyState(tokens = { primary: '#1a56db', surface: '#f4f6fb', radius: '8px' }) {
  return `<div role="status" style="color:${tokens.primary};background:${tokens.surface};border-radius:${tokens.radius}">` +
    'No dashboards yet. Create your first dashboard to start tracking metrics.</div>';
}
