import fs from 'fs';
const p = 'server/src/services/graph.seed.js';
let s = fs.readFileSync(p, 'utf8');
const needle = 'WHERE a.id < b.id';
const repl = 'WHERE a.id < b.id AND a.listed <> false AND b.listed <> false';
if (!s.includes(needle)) { console.error('MISS'); process.exit(1); }
s = s.replace(needle, repl);
fs.writeFileSync(p, s);
console.log('seed patched OK');
