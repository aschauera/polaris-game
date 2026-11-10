// Original vector markers, not terrain textures; occurrences currently have no simulation effects.
export const RESOURCES = {
  stone: {
    name: 'Stone deposit', height: 0.65,
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><g stroke="#f4f3df" stroke-width=".8" stroke-linejoin="round">
      <path fill="#d0ccc1" d="M2 12 7 9 12 12 12 19 7 22 2 19Z"/><path fill="#898c89" d="M7 15 12 12 12 19 7 22Z"/>
      <path fill="#b9b9b0" d="M7 15 2 12 7 9 12 12Z"/><path fill="#ded9cc" d="M9 5 15 2 21 5 21 16 15 19 9 16Z"/>
      <path fill="#91958f" d="M15 8 21 5 21 16 15 19Z"/><path fill="#f2eddd" d="M9 5 15 2 21 5 15 8Z"/>
    </g></svg>`,
  },
  apples: {
    name: 'Apple grove', height: 0.9,
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#754724" d="M11 3h2v6h-2Z"/>
      <path fill="#57a23f" stroke="#eff4ce" stroke-width=".8" d="M13 6V3l3-2h4v3l-3 3Z"/>
      <path fill="#d93a25" stroke="#fff1cb" stroke-width="1" stroke-linejoin="round" d="M4 8h5l3 2 3-2h5v3h2v7h-3v3h-5l-2-1-2 1H5v-3H2v-7h2Z"/>
      <path fill="#f76438" d="M5 10h4v3H7v5H4v-6h1Z"/><path fill="#a82120" d="M16 12h4v5h-3v3h-3v-3h2Z"/>
    </svg>`,
  },
  fish: {
    name: 'Fish shoal', height: 0.28,
    icon: `<svg viewBox="0 0 28 24" aria-hidden="true"><path fill="#318bd6" stroke="#c9f5ff" stroke-width="1.2" stroke-linejoin="round"
      d="M2 9h3V6h5V3h5v3h5v3h3l4-4v14l-4-4h-3v3h-5v3h-5v-3H5v-3H2Z"/>
      <path fill="#70c8ed" d="M5 8h6V6h7v3h3v3H5Z"/><path fill="#1e62ad" d="M5 13h16v3h-6v3h-4v-3H5Z"/>
      <path fill="#103553" d="M6 9h3v3H6Z"/><path fill="#ddf8fb" d="M6 9h1v1H6Z"/>
    </svg>`,
  },
} as const

export type ResourceKind = keyof typeof RESOURCES
