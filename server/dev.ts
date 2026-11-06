import process from 'node:process'
process.env.PORT ??= '3000'
process.env.PUBLIC_ORIGIN ??= 'http://127.0.0.1:5173'
await import('./main.ts')
