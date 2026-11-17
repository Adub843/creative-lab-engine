const { chromium } = require('playwright'); const fs = require('fs');
const dir = process.argv[2]; const svg = fs.readFileSync(dir + '/icon.svg', 'utf8');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  for (const [name, size, pad] of [['icon-192.png',192,0],['icon-512.png',512,0],['icon-180.png',180,0],['icon-maskable-512.png',512,1]]) {
    await p.setViewportSize({ width: size, height: size });
    const inner = pad ? svg.replace('rx="11" fill="#1b1e23"/>', 'rx="0" fill="#1b1e23"/><g transform="translate(24 24) scale(.74) translate(-24 -24)">').replace('</svg>', '</g></svg>') : svg;
    await p.setContent(`<style>html,body{margin:0;background:${pad||name==='icon-180.png'?'#1b1e23':'transparent'}}svg{width:${size}px;height:${size}px;display:block}</style>${inner}`);
    await p.screenshot({ path: dir + '/' + name, omitBackground: !pad && name!=='icon-180.png' });
  }
  await b.close();
})();
