const TIME_ZONE = 'Africa/Kinshasa';

function parseDate(value) {
  if (!value) return null;
  if (typeof value === 'string' && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    return new Date(`${value.replace(' ', 'T')}+01:00`);
  }
  return new Date(value);
}

export function formatDateTime(value) {
  if (!value) return '—';
  return parseDate(value).toLocaleString('fr-FR', { timeZone: TIME_ZONE });
}

export function formatDate(value) {
  if (!value) return '—';
  return parseDate(value).toLocaleDateString('fr-FR', { timeZone: TIME_ZONE });
}
