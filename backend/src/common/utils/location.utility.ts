/**
 * Canonical Zero-Cost Google Maps Directions Resolver
 * 
 * Generates turn-by-turn navigation URLs compliant with Google Maps Universal URL scheme.
 * Requires 0 API keys and has zero billing charges.
 */
export function resolveSalonDirectionsUrl(salon?: {
  latitude?: number | null;
  longitude?: number | null;
  googleMapsUrl?: string | null;
  address?: string | null;
  city?: string | null;
} | null): string {
  if (!salon) return '';

  // 1. Highest accuracy: Exact GPS Coordinates (Opens turn-by-turn navigation mode directly)
  if (
    typeof salon.latitude === 'number' &&
    typeof salon.longitude === 'number' &&
    !isNaN(salon.latitude) &&
    !isNaN(salon.longitude) &&
    (salon.latitude !== 0 || salon.longitude !== 0)
  ) {
    return `https://www.google.com/maps/dir/?api=1&destination=${salon.latitude},${salon.longitude}`;
  }

  // 2. Direct verified Google Maps Pin or Share link
  if (salon.googleMapsUrl && typeof salon.googleMapsUrl === 'string' && salon.googleMapsUrl.trim().startsWith('http')) {
    return salon.googleMapsUrl.trim();
  }

  // 3. Fallback: Search by address & city
  const queryParts = [salon.address, salon.city].filter(Boolean).map((s) => String(s).trim()).filter(Boolean);
  if (queryParts.length > 0) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryParts.join(', '))}`;
  }

  return '';
}
