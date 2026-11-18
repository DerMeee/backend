/** Splits a display name on the first space: "Amina Ben Ali" → { firstName: "Amina", lastName: "Ben Ali" }. */
export function splitName(name: string): {
  firstName: string | null;
  lastName: string | null;
} {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) return { firstName: null, lastName: null };
  const i = clean.indexOf(' ');
  if (i === -1) return { firstName: clean, lastName: null };
  return { firstName: clean.slice(0, i), lastName: clean.slice(i + 1) };
}

export function joinName(
  firstName?: string | null,
  lastName?: string | null,
): string {
  return [firstName, lastName]
    .filter((p) => p && p.trim())
    .join(' ')
    .trim();
}
