// Rename brand "Kimi K3 AI" / "Kimi K3" -> "kimik3" across both locale files.
import { readFileSync, writeFileSync } from 'node:fs';

function rename(file) {
  const path = new URL(file, import.meta.url);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  let changes = 0;
  for (const [k, v] of Object.entries(json)) {
    if (typeof v !== 'string') continue;
    const next = v
      .replaceAll('Kimi K3 AI', 'kimik3')
      .replaceAll('Kimi K3', 'kimik3');
    if (next !== v) {
      json[k] = next;
      changes++;
    }
  }
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log(`${file}: ${changes} values renamed`);
}

rename('../messages/en.json');
rename('../messages/zh.json');
