// Heat on near-neutral greys (DESIGN.md): #FA5D19 with white on fills in both
// modes, as the design specifies (3.2:1, the large-text/UI level). Navigation
// chrome stays neutral; heat marks actions only. Status colours held to AA.
export const PALETTE = {
  bg: ['#F9F9F9', '#0A0A0A'],
  surface: ['#FFFFFF', '#141414'],
  card: ['#FFFFFF', '#171717'],
  muted: ['#EFEFEF', '#262626'],
  fill: ['#EFEFEF', '#262626'], // = muted (older name)
  line: ['#E8E8E8', '#333333'],
  text: ['#262626', '#F5F5F5'],
  dim: ['#5C5C5C', '#A3A3A3'],
  faint: ['#666666', '#8F8F8F'],
  accent: ['#FA5D19', '#FA5D19'],
  onAccent: ['#FFFFFF', '#FFFFFF'],
  blue: ['#1F5BD6', '#6B9AFF'],
  green: ['#1D7A3A', '#4ED273'],
  red: ['#C4291B', '#FF6B5C'],
  warn: ['#8A5E00', '#F0C040'],
} as const satisfies Record<string, readonly [string, string]>;
