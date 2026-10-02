// 샘플 PDF(3쪽)와 PNG 이미지를 Chromium으로 생성
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const fs = require('fs');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const pg = await b.newPage({ viewport: { width: 800, height: 600 } });
  const pages = [1, 2, 3].map(n => `<div style="page-break-after:always;font:40px sans-serif;padding:60px"><h1 style="color:#c00">SAMPLE PAGE ${n}</h1><p>ProGuide 원본 자료실 테스트 ${n}쪽</p><div style="width:300px;height:200px;background:#2d5f8f"></div></div>`).join('');
  await pg.setContent('<html><body style="margin:0">' + pages + '</body></html>');
  fs.writeFileSync('sample.pdf', await pg.pdf({ format: 'A4', printBackground: true }));
  await pg.setContent('<body style="margin:0"><div style="width:600px;height:400px;background:linear-gradient(90deg,#e33,#33e);font:60px sans-serif;color:#fff;display:flex;align-items:center;justify-content:center">IMAGE TEST</div></body>');
  fs.writeFileSync('sample.png', await pg.screenshot({ clip: { x: 0, y: 0, width: 600, height: 400 } }));
  await b.close();
})();
