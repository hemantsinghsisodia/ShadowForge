export function isCoarsePointer(): boolean {
  return window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(hover: none)').matches;
}

export function phonePortrait(): boolean {
  return isCoarsePointer() && window.innerHeight > window.innerWidth && window.innerWidth < 700;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
