/**
 * Bespoke Lucide-Style SVG Iconography Library for SalonFlow
 * Precision 24x24 vector icons with configurable size and classes.
 */

function svg(paths, { size = 20, className = '', strokeWidth = 2, color = 'currentColor' } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="feather-icon ${className}">${paths}</svg>`;
}

export const Icons = {
  // Brand & Core
  scissors: (opts) => svg(`
    <circle cx="6" cy="6" r="3"/>
    <circle cx="6" cy="18" r="3"/>
    <line x1="20" y1="4" x2="8.12" y2="15.88"/>
    <line x1="14.47" y1="14.48" x2="20" y2="20"/>
    <line x1="8.12" y1="8.12" x2="12" y2="12"/>
  `, opts),

  sparkles: (opts) => svg(`
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
    <path d="M5 3v4"/>
    <path d="M19 17v4"/>
    <path d="M3 5h4"/>
    <path d="M17 19h4"/>
  `, opts),

  zap: (opts) => svg(`
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  `, opts),

  // Navigation & Tabs
  home: (opts) => svg(`
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  `, opts),

  users: (opts) => svg(`
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  `, opts),

  user: (opts) => svg(`
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  `, opts),

  queue: (opts) => svg(`
    <rect width="18" height="18" x="3" y="3" rx="2"/>
    <path d="M3 9h18"/>
    <path d="M9 21V9"/>
  `, opts),

  layers: (opts) => svg(`
    <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/>
    <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/>
    <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>
  `, opts),

  settings: (opts) => svg(`
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
    <circle cx="12" cy="12" r="3"/>
  `, opts),

  // Chair & Station
  armchair: (opts) => svg(`
    <path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3"/>
    <path d="M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H7v-2a2 2 0 0 0-4 0Z"/>
    <path d="M5 18v2"/>
    <path d="M19 18v2"/>
  `, opts),

  // Communication & Channels
  whatsapp: (opts) => svg(`
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>
    <path d="M9.5 9c-.2-.4-.4-.4-.6-.4h-.5c-.2 0-.4.1-.7.3s-.9.9-.9 2.1 1 2.4 1.1 2.6c.1.2 1.8 2.7 4.3 3.8 2.1.9 2.5.7 3 .7s1.5-.6 1.7-1.2c.2-.6.2-1.1.1-1.2s-.2-.2-.5-.3-1.5-.7-1.7-.8-.4-.1-.6.2-.7.8-.8 1c-.2.2-.3.2-.6.1s-1.1-.4-2-1.3c-.8-.7-1.3-1.5-1.4-1.8s0-.4.1-.5.3-.3.4-.5c.1-.2.2-.3.3-.4s0-.3 0-.4c-.1-.2-.6-1.4-.8-1.9z"/>
  `, opts),

  messageCircle: (opts) => svg(`
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>
  `, opts),

  phone: (opts) => svg(`
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.49 19.49 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
  `, opts),

  qrCode: (opts) => svg(`
    <rect width="5" height="5" x="3" y="3" rx="1"/>
    <rect width="5" height="5" x="16" y="3" rx="1"/>
    <rect width="5" height="5" x="3" y="16" rx="1"/>
    <path d="M21 16h-3a2 2 0 0 0-2 2v3"/>
    <path d="M21 21v.01"/>
    <path d="M12 7v3a2 2 0 0 1-2 2H7"/>
    <path d="M3 12h.01"/>
    <path d="M12 3h.01"/>
    <path d="M12 16v.01"/>
    <path d="M16 12h1"/>
    <path d="M21 12v.01"/>
    <path d="M12 21v-1"/>
  `, opts),

  // Actions & Controls
  plus: (opts) => svg(`
    <path d="M5 12h14"/>
    <path d="M12 5v14"/>
  `, opts),

  check: (opts) => svg(`
    <path d="M20 6 9 17l-5-5"/>
  `, opts),

  checkCircle2: (opts) => svg(`
    <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
    <path d="m9 12 2 2 4-4"/>
  `, opts),

  x: (opts) => svg(`
    <path d="M18 6 6 18"/>
    <path d="m6 6 12 12"/>
  `, opts),

  xCircle: (opts) => svg(`
    <circle cx="12" cy="12" r="10"/>
    <path d="m15 9-6 6"/>
    <path d="m9 9 6 6"/>
  `, opts),

  globe: (opts) => svg(`
    <circle cx="12" cy="12" r="10"/>
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>
    <path d="M2 12h20"/>
  `, opts),

  copy: (opts) => svg(`

    <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
  `, opts),

  externalLink: (opts) => svg(`
    <path d="M15 3h6v6"/>
    <path d="M10 14 21 3"/>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
  `, opts),

  calendar: (opts) => svg(`
    <path d="M8 2v4"/>
    <path d="M16 2v4"/>
    <rect width="18" height="18" x="3" y="4" rx="2"/>
    <path d="M3 10h18"/>
  `, opts),

  clock: (opts) => svg(`
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12 6 12 12 16 14"/>
  `, opts),

  refreshCw: (opts) => svg(`
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
    <path d="M21 3v5h-5"/>
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
    <path d="M8 16H3v5"/>
  `, opts),

  chevronLeft: (opts) => svg(`
    <path d="m15 18-6-6 6-6"/>
  `, opts),

  chevronRight: (opts) => svg(`
    <path d="m9 18 6-6-6-6"/>
  `, opts),

  arrowRight: (opts) => svg(`
    <path d="M5 12h14"/>
    <path d="m12 5 7 7-7 7"/>
  `, opts),

  arrowDown: (opts) => svg(`
    <path d="M12 5v14"/>
    <path d="m19 12-7 7-7-7"/>
  `, opts),

  arrowUp: (opts) => svg(`
    <path d="M12 19V5"/>
    <path d="m5 12 7-7 7 7"/>
  `, opts),


  trendingUp: (opts) => svg(`
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
    <polyline points="16 7 22 7 22 13"/>
  `, opts),

  search: (opts) => svg(`
    <circle cx="11" cy="11" r="8"/>
    <path d="m21 21-4.3-4.3"/>
  `, opts),

  volume2: (opts) => svg(`
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
  `, opts),

  volumeX: (opts) => svg(`
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
    <line x1="22" y1="9" x2="16" y2="15"/>
    <line x1="16" y1="9" x2="22" y2="15"/>
  `, opts),

  shield: (opts) => svg(`
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>
  `, opts),

  eye: (opts) => svg(`
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
    <circle cx="12" cy="12" r="3"/>
  `, opts),

  eyeOff: (opts) => svg(`
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>
    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/>
    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/>
    <line x1="2" y1="2" x2="22" y2="22"/>
  `, opts),

  mapPin: (opts) => svg(`
    <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/>
    <circle cx="12" cy="10" r="3"/>
  `, opts),

  edit: (opts) => svg(`
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
    <path d="m15 5 4 4"/>
  `, opts),

  trash: (opts) => svg(`
    <path d="M3 6h18"/>
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
    <line x1="10" y1="11" x2="10" y2="17"/>
    <line x1="14" y1="11" x2="14" y2="17"/>
  `, opts),

  coffee: (opts) => svg(`
    <path d="M10 2v2"/>
    <path d="M14 2v2"/>
    <path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h12Z"/>
    <path d="M6 2v2"/>
    <path d="M17 11h1a3 3 0 0 1 3 3v0a3 3 0 0 1-3 3h-1"/>
  `, opts),

  link: (opts) => svg(`
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
  `, opts),

  lock: (opts) => svg(`
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  `, opts),
};

