/**
 * Centralized Application Constants for Salon SaaS Frontend
 */

export const SERVICE_CATEGORIES = [
  { category: 'Hair & Beard Services', icon: '✂️' },
  { category: 'Skin & Facial Care', icon: '✨' },
  { category: 'Hair Color & Treatments', icon: '🎨' },
  { category: 'Hands & Feet Care', icon: '💅' },
  { category: 'Spa & Wellness', icon: '💆' },
  { category: 'Beauty & Grooming', icon: '💄' },
  { category: 'Combos & Packages', icon: '🎁' },
];

export const SERVICE_DURATION_OPTIONS = [
  { value: 30, label: '30 mins' },
  { value: 45, label: '45 mins' },
  { value: 60, label: '60 mins (1 hr)' },
  { value: 75, label: '75 mins (1 hr 15m)' },
  { value: 90, label: '90 mins (1 hr 30m)' },
  { value: 105, label: '105 mins (1 hr 45m)' },
  { value: 120, label: '120 mins (2 hrs)' },
  { value: 135, label: '135 mins (2 hrs 15m)' },
  { value: 150, label: '150 mins (2 hrs 30m)' },
  { value: 165, label: '165 mins (2 hrs 45m)' },
  { value: 180, label: '180 mins (3 hrs)' },
  { value: 195, label: '195 mins (3 hrs 15m)' },
  { value: 210, label: '210 mins (3 hrs 30m)' },
  { value: 225, label: '225 mins (3 hrs 45m)' },
  { value: 240, label: '240 mins (4 hrs)' },
];

/**
 * Renders HTML <option> tags for service duration selection dropdowns.
 * Handles legacy values cleanly.
 */
export function renderServiceDurationOptions(selectedDuration = 30) {
  const selectedNum = parseInt(selectedDuration, 10) || 30;
  let hasMatch = false;
  const optionsHtml = SERVICE_DURATION_OPTIONS.map((opt) => {
    const isSel = opt.value === selectedNum;
    if (isSel) hasMatch = true;
    return `<option value="${opt.value}" ${isSel ? 'selected' : ''}>${opt.label}</option>`;
  }).join('');

  if (!hasMatch && selectedNum > 0) {
    return `<option value="${selectedNum}" selected>${selectedNum} mins (Legacy - select multiple of 15)</option>` + optionsHtml;
  }
  return optionsHtml;
}
