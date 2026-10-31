// Adapter pattern: converts a TazaJol report to the Open311 GeoReport v2 request format.
// This is only a format converter; there is NO connection to any akimat system.
const SERVICE_NAMES = { road: 'Roads', light: 'Street lighting', trash: 'Waste', play: 'Playgrounds', build: 'Construction damage', other: 'Other' };
function toOpen311(r, baseUrl = '') {
  return {
    service_request_id: String(r.id),
    status: r.status === 'fixed' ? 'closed' : 'open',
    status_notes: r.status,
    service_code: r.category,
    service_name: SERVICE_NAMES[r.category] || r.category,
    description: r.description,
    requested_datetime: new Date(r.createdAt).toISOString(),
    lat: r.lat, long: r.lng,
    media_url: r.photoUrl ? baseUrl + r.photoUrl : null,
  };
}
module.exports = { toOpen311 };
