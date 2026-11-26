// Animations are on unless the person asked their computer to reduce motion (or ?static=1 is in the address, used for screenshots).
export const ANIMATE = typeof window !== 'undefined'
  && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  && !/[?&]static=1/.test(window.location.search);
