/** Single source of truth for department dropdowns (client-side). Server models keep department as free String so custom "Other" values save cleanly. */

export const DEPARTMENTS = [
  'Computer Science',
  'Information Technology',
  'Electronics',
  'Electrical Engineering',
  'Mechanical',
  'Civil Engineering',
  'Chemical Engineering',
  'Aerospace Engineering',
  'Biotechnology',
  'Biomedical Engineering',
  'Metallurgical Engineering',
  'Production Engineering',
  'Instrumentation Engineering',
  'Mechatronics',
  'Automobile Engineering',
  'Data Science & AI',
  'Cybersecurity',
  'Applied Sciences',
  'Mathematics & Computing',
  'Physics',
  'Chemistry',
  'Humanities & Management',
  'Architecture',
  'Design',
  'Law',
  'Commerce & Business',
  'Administration',
  'Other',
];

export const OTHER_DEPARTMENT = 'Other';

/** True when the select is on "Other" (custom text input should show). */
export const isOtherDepartment = (v) => v === OTHER_DEPARTMENT;

/**
 * Normalise a department value before POST/PATCH.
 * If "Other" is picked, use the trimmed custom value; fall back to "Other".
 */
export function resolveDepartment(selected, custom) {
  if (!isOtherDepartment(selected)) return selected;
  const c = String(custom || '').trim();
  return c || OTHER_DEPARTMENT;
}
