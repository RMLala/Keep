import { readFile, writeFile } from 'node:fs/promises';
const html = await readFile(new URL('../Passkeep.html', import.meta.url), 'utf8');
const embedded = html.replace('</head>', '<script type="module" src="/native-entry.js"></script></head>');
await writeFile(new URL('../web/index.html', import.meta.url), embedded);
