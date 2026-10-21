/** Hysteresis keeps mobile chrome stable around the collapse boundary. */
export function mobileBannerCompact(scrollY: number, wasCompact: boolean): boolean {
  if (scrollY <= 24) return false;
  if (scrollY > 96) return true;
  return wasCompact;
}
