import { readFileSync } from 'fs';
let src = readFileSync('scripts/generate-160723-research.mjs', 'utf8');
src = src.replace(/\r\n/g, '\n');
const needle1 = "proxyComponents: [\n    '160620': {";
const idx1 = src.indexOf(needle1);
console.log('LF version idx:', idx1);
if (idx1 >= 0) {
  console.log('area:', JSON.stringify(src.slice(idx1, idx1+200)));
}

// show chars around where 513730 config starts
const idx3 = src.indexOf("'513730': {");
if (idx3 >= 0) {
  console.log('\n513730 config starts at', idx3);
  const chunk = src.slice(idx3, idx3 + 2000);
  const pc = chunk.indexOf('proxyComponents');
  console.log('proxyComponents within chunk at +', pc);
  console.log('proxyComponents area:', JSON.stringify(chunk.slice(pc, pc + 120)));
  console.log('160620 within chunk at +', chunk.indexOf("'160620'"));
}
