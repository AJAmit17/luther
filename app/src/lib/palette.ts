export const PALETTE = {
  bg: ['#F2F5F4', '#101716'],
  surface: ['#FFFFFF', '#141E1B'],
  card: ['#FFFFFF', '#192321'],
  muted: ['#E6ECE9', '#23332D'],
  fill: ['#E6ECE9', '#23332D'], // = muted (older name)
  line: ['#CCD9D3', '#354740'],
  text: ['#16201E', '#EDF4F1'],
  dim: ['#52635E', '#A3B5AE'],
  faint: ['#596B62', '#8FA59B'],
  accent: ['#086B64', '#89D5C7'],
  onAccent: ['#FFFFFF', '#102B26'],
  blue: ['#0B5CD6', '#6EA8FE'],
  green: ['#216C43', '#8AD6A6'],
  red: ['#AF2932', '#FFA3AA'],
  warn: ['#875100', '#FFD184'],
} as const satisfies Record<string, readonly [string, string]>;
