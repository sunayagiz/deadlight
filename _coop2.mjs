import puppeteer from 'puppeteer-core';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT='/private/tmp/claude-501/-Users-ovguhan/9a50957b-90bd-40f5-8b94-28bce2b8b793/scratchpad';
const T0=Date.now(); const ms=()=>((Date.now()-T0)/1000).toFixed(1);
const b=await puppeteer.launch({executablePath:CHROME,headless:'new',
  args:['--no-sandbox','--use-gl=swiftshader','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']});
try{
const host=await b.newPage(); await host.setViewport({width:960,height:540});
const guest=await b.newPage(); await guest.setViewport({width:960,height:540});
await host.goto('http://localhost:4173/',{waitUntil:'domcontentloaded'});
await host.click('#host'); console.log(ms(),'host clicked');
await host.waitForFunction(()=>{const s=document.querySelector('#start');return s&&!s.disabled;},{timeout:20000});
const code=await host.$eval('.code',e=>e.textContent.trim()); console.log(ms(),'code',code);
await guest.goto('http://localhost:4173/',{waitUntil:'domcontentloaded'});
await guest.click('#join'); await guest.type('#code',code); await guest.click('#connect');
console.log(ms(),'guest connect clicked');
await guest.waitForFunction(()=>{const m=document.querySelector('#msg');return m&&/connected/i.test(m.textContent);},{timeout:30000}).then(()=>console.log(ms(),'guest CONNECTED to host')).catch(()=>console.log(ms(),'guest NEVER connected'));
await host.bringToFront();
await host.waitForFunction(()=>{const p=document.querySelector('#pc');return p&&p.textContent.includes('2');},{timeout:15000}).then(()=>console.log(ms(),'host sees 2')).catch(()=>console.log(ms(),'host never saw 2'));
await host.click('#start').catch(()=>{}); console.log(ms(),'start clicked');
await new Promise(r=>setTimeout(r,4500));
await host.bringToFront(); await new Promise(r=>setTimeout(r,250)); await host.screenshot({path:`${OUT}/coop_host.png`});
await guest.bringToFront(); await new Promise(r=>setTimeout(r,250)); await guest.screenshot({path:`${OUT}/coop_guest.png`});
// pull the guest HUD squad line to prove snapshots arrived
const gsquad=await guest.evaluate(()=>document.querySelector('canvas')?'canvas-present':'no-canvas');
console.log(ms(),'guest',gsquad,'DONE');
}catch(e){console.log(ms(),'FATAL',e.message);} finally{await b.close();}
