import { readFile, writeFile, mkdir } from 'node:fs/promises';
const html = await readFile(new URL('../Passkeep.html', import.meta.url), 'utf8');
const embedded = html.replace('</head>', '<script type="module" src="/native-entry.js"></script></head>');
await writeFile(new URL('../web/index.html', import.meta.url), embedded);
const xlsx = await readFile(new URL('../node_modules/xlsx/dist/xlsx.full.min.js', import.meta.url), 'utf8');
const standalone = html.replace('</head>', () => `<script>${xlsx.replaceAll('</script>', '<\\/script>')}</script></head>`);
await writeFile(new URL('../Passkeep-Standalone.html', import.meta.url), standalone);
await mkdir(new URL('../public/', import.meta.url), { recursive: true });
