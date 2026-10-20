import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const root=process.cwd(),mod=name=>import(pathToFileURL(join(root,'apps/server/dist',name)).href);
const {readConfig}=await mod('config.js'),{openAuthStore}=await mod('auth/store.js'),{createApp}=await mod('app.js');
if(!process.env.FREEQIFY_PLAYWRIGHT_MODULE)throw new Error('Set FREEQIFY_PLAYWRIGHT_MODULE to an installed playwright-core index.mjs.');
const {chromium}=await import(pathToFileURL(process.env.FREEQIFY_PLAYWRIGHT_MODULE).href);
const temp=await mkdtemp(join(tmpdir(),'freeqify-listening-review-'));
const output=process.env.FREEQIFY_SCREENSHOT_DIR||join(temp,'screenshots');await mkdir(output,{recursive:true});
const config=readConfig({NODE_ENV:'test',DATA_DIR:temp,AUTH_SECURE_COOKIES:'false',HOST:'127.0.0.1',BASE_PATH:'/'});
const store=openAuthStore(config),owner=await store.createInitialAdmin('visualizer-review','isolated-review-passphrase-no-production-access');
const session=store.createSession(owner);
const track={id:'listening_fixture',title:'Spectrum / Transient Study',artist:'Generated audio · local test fixture',album:'Listening Room',albumId:'review_album',artworkId:null,duration:120,format:'wav',trackNumber:1};
const album={id:'review_album',title:'Listening Room',artist:track.artist,artistId:'review_artist',artworkId:null,trackCount:1,year:2026};
const sr=24000,seconds=120,wav=Buffer.alloc(44+sr*seconds*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(sr,24);wav.writeUInt32LE(sr*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
const bed=new Float32Array(sr);for(let i=0;i<sr;i++){for(let band=0;band<48;band++){const hz=Math.round(45*(10000/45)**(band/47));bed[i]+=Math.sin(i/sr*2*Math.PI*hz+band*1.7)*.015;}}
for(let i=0;i<sr*seconds;i++){
 const t=i/sr,beat=t%.5,hit=Math.exp(-beat*24),quiet=Math.floor(t/5)%3===2?.035:1;
 const sound=(bed[i%sr]*.8+Math.sin(t*2*Math.PI*(64+35*hit))*.4*hit+Math.sin(t*2*Math.PI*220)*.13+Math.sin(t*2*Math.PI*940)*.08+Math.sin(t*2*Math.PI*3600)*.05* Math.exp(-(t%.25)*20)+Math.sin(t*2*Math.PI*8100)*.025)*quiet;
 wav.writeInt16LE(Math.round(sound*29000),44+i*2);
}
const library={ping:async()=>{},overview:async()=>({artists:1,albums:1,tracks:1,scanning:false}),artists:async()=>[],artist:async()=>({artist:{id:'review_artist',name:track.artist,albumCount:1,artworkId:null},albums:[album]}),albums:async()=>({items:[album],nextOffset:null}),album:async()=>({album,tracks:[track]}),tracks:async()=>({items:[track],nextOffset:null}),track:async id=>({...track,id,title:id===track.id?track.title:'Second generated fixture'}),search:async()=>({artists:[],albums:[album],tracks:[track]}),artwork:async()=>{throw new Error('fixture has no artwork');},stream:async(_id,_format,range)=>{
 let start=0,end=wav.length-1;const match=range?.match(/^bytes=(\d+)-(\d*)$/);if(match){start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
 return new Response(wav.subarray(start,end+1),{status:match?206:200,headers:{'content-type':'audio/wav','content-length':String(end-start+1),'accept-ranges':'bytes',...(match?{'content-range':`bytes ${start}-${end}/${wav.length}`}:{})}});
}};
store.savePlayback(owner.id,JSON.stringify({queue:[{key:'fixture_entry',source:'local',trackId:track.id},{key:'fixture_next',source:'local',trackId:'listening_fixture_next'}],order:['fixture_entry','fixture_next'],current:'fixture_entry',position:0,shuffle:false,repeat:'all',volume:.4,muted:false}));
const app=await createApp(config,{authStore:store,library});let browser;
try{
 await app.listen({host:'127.0.0.1',port:0});const origin=`http://127.0.0.1:${app.server.address().port}`;
 browser=await chromium.launch({executablePath:process.env.FREEQIFY_CHROME_BINARY||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1440,height:900}});const errors=[];
 await context.addCookies([{name:'freeqify_session',value:session.token,domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Lax'}]);
 const reducedReview=process.argv.includes('--reduced');const layoutOnly=process.argv.includes('--layout-only');
 if(reducedReview)await context.addInitScript(user=>{const key=`freeqify.visualizer.${user}`;if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({enabled:true,reduced:true}));},owner.id);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 // Observe measured level uploads and render submissions without synchronous GPU readback.
 await page.addInitScript(()=>{
  window.__milkAudioPeak=0;window.__milkDraws=0;
  const timeData=AnalyserNode.prototype.getByteTimeDomainData;
  AnalyserNode.prototype.getByteTimeDomainData=function(array){timeData.call(this,array);window.__milkAudioPeak=Math.max(window.__milkAudioPeak,...Array.from(array,v=>Math.abs(v-128)));};
  const plainDraw=WebGL2RenderingContext.prototype.drawArrays;
  WebGL2RenderingContext.prototype.drawArrays=function(...args){window.__milkDraws++;return plainDraw.apply(this,args);};
  const matrix=WebGL2RenderingContext.prototype.uniformMatrix4fv;
  WebGL2RenderingContext.prototype.uniformMatrix4fv=function(location,transpose,values){window.__cameraMatrix=Array.from(values);return matrix.call(this,location,transpose,values);};
  const upload=WebGL2RenderingContext.prototype.uniform1fv,draw=WebGL2RenderingContext.prototype.drawArraysInstanced;
  window.__spectrumSamples=[];window.__spectrumDraws=0;
  WebGL2RenderingContext.prototype.uniform1fv=function(location,values,...rest){window.__spectrumSamples.push(Math.max(...values));if(window.__spectrumSamples.length>200)window.__spectrumSamples.shift();return upload.call(this,location,values,...rest);};
  WebGL2RenderingContext.prototype.drawArraysInstanced=function(...args){window.__spectrumDraws++;return draw.apply(this,args);};
 });
 await page.goto(origin);await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>.3);
 const quality=async reduced=>{if(!reducedReview)return;await page.locator('.visualizer-settings summary').click();await page.getByLabel('Reduced effects',{exact:true}).setChecked(reduced);await page.locator('.visualizer-settings summary').click();};
 const audio=await page.locator('audio').elementHandle();let initialSource=await audio.getAttribute('src');
 await page.getByRole('button',{name:'Open Now Playing'}).click();const dialog=page.getByRole('dialog',{name:'Now Playing'});
 await page.waitForFunction(()=>window.__spectrumSamples.some(v=>v>.01));
 console.log('PASS decoded fixture audio drives nonzero real WebGL uniforms');
 const camera=()=>page.evaluate(()=>window.__cameraMatrix);
 const waitCamera=()=>page.waitForTimeout(250);
 const desktopCamera=async()=>{
  const box=await page.locator('canvas').boundingBox(),x=box.x+box.width*.5,y=box.y+box.height*.5;
  await page.mouse.dblclick(x,y);await waitCamera();const initial=await camera();
  await page.mouse.move(x,y);await page.mouse.down();
  for(const [dx,dy] of [[80,50],[-60,-70],[60,-50],[-80,70]]){await page.mouse.move(x+dx,y+dy,{steps:3});await waitCamera();assert.notDeepEqual(await camera(),initial);}
  await page.mouse.up();await page.mouse.wheel(0,-250);await waitCamera();assert.notDeepEqual(await camera(),initial);
  await page.mouse.dblclick(x,y);await waitCamera();assert.deepEqual(await camera(),initial);
  assert(await audio.evaluate(a=>!a.paused));
 };
 if(!process.argv.includes('--milkdrop-only')){
 await desktopCamera();
 await page.mouse.wheel(0,150);await waitCamera();const chosenCamera=await camera();
 const trackSource=await audio.getAttribute('src');
 await page.getByRole('button',{name:'Next track',exact:true}).click();await page.waitForFunction(src=>document.querySelector('audio')?.getAttribute('src')!==src,trackSource);await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>.3);await waitCamera();assert.deepEqual(await camera(),chosenCamera);
 const nextSource=await audio.getAttribute('src');
 await page.getByRole('button',{name:'Next track',exact:true}).click();await page.waitForFunction(src=>document.querySelector('audio')?.getAttribute('src')!==src,nextSource);await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>.3);await waitCamera();assert.deepEqual(await camera(),chosenCamera);
 initialSource=await audio.getAttribute('src');console.log('PASS camera persistence across track changes');
 await desktopCamera();console.log('PASS embedded drag in all directions, wheel zoom, camera reset and continuous playback');
 }
 await page.waitForTimeout(700);
 const geometry=await dialog.evaluate(d=>{const a=d.querySelector('.visualizer').getBoundingClientRect(),b=d.querySelector('.now-playing-companion').getBoundingClientRect();return {visualizerShare:a.width/(a.width+b.width),width:d.clientWidth,height:d.clientHeight,scrollHeight:d.scrollHeight};});
 assert(geometry.visualizerShare>=.70&&geometry.visualizerShare<=.76,JSON.stringify(geometry));console.log('Desktop geometry',geometry);
 // Dual-engine integration under production CSP, using the same audio element.
 const milkCanvas=page.getByRole('img',{name:'Live MilkDrop music visualization',exact:true});
 const spectrumDraws=()=>page.evaluate(()=>window.__spectrumDraws);
 await page.getByLabel('Visualizer palette').selectOption('Synthwave');
 const beforeSwitch=await audio.evaluate(a=>({time:a.currentTime,volume:a.volume,src:a.currentSrc}));
 await page.getByLabel('Visualizer mode').selectOption('milkdrop');
 await milkCanvas.waitFor();await page.waitForTimeout(1800);
 assert.equal(await page.locator('.visualizer [role=status]').count(),0,await page.locator('.visualizer [role=status]').allTextContents().then(v=>v.join(' ')));
 assert(await page.evaluate(()=>window.__milkAudioPeak>0&&window.__milkDraws>0),'MilkDrop must sample real audio and submit GPU draws');
 const frozen=await spectrumDraws();await page.waitForTimeout(400);assert.equal(await spectrumDraws(),frozen);
 const afterSwitch=await audio.evaluate(a=>({time:a.currentTime,volume:a.volume,src:a.currentSrc,paused:a.paused}));
 assert(afterSwitch.time>beforeSwitch.time);assert.equal(afterSwitch.volume,beforeSwitch.volume);assert.equal(afterSwitch.src,beforeSwitch.src);assert(!afterSwitch.paused);
 const preset=page.getByLabel('MilkDrop preset'),first=await preset.inputValue();
 await page.getByLabel('Next preset',{exact:true}).click();assert.notEqual(await preset.inputValue(),first);
 await page.getByLabel('Previous preset',{exact:true}).click();assert.equal(await preset.inputValue(),first);
 await page.getByLabel('Random preset',{exact:true}).click();assert.notEqual(await preset.inputValue(),first);
 for(const value of await preset.locator('option').evaluateAll(options=>options.map(o=>o.value))){await preset.selectOption(value);await page.waitForTimeout(150);assert.equal(await page.locator('.visualizer [role=status]').count(),0,await page.locator('.visualizer [role=status]').allTextContents().then(v=>v.join(' ')));}
 await page.getByRole('button',{name:'Immersive view',exact:true}).click();await page.waitForTimeout(300);
 assert((await milkCanvas.boundingBox()).width>1440*.9);
 await page.screenshot({path:join(output,'milkdrop-immersive.png')});
 await page.getByLabel('Visualizer mode').selectOption('spectrum');await page.waitForTimeout(400);
 assert.equal(await page.getByLabel('Visualizer palette').inputValue(),'Synthwave');
 await page.getByLabel('Visualizer mode').selectOption('milkdrop');await page.waitForTimeout(400);
 await page.keyboard.press('Escape');await page.waitForTimeout(1800);
 await page.screenshot({path:join(output,'milkdrop-desktop.png')});
 await page.getByLabel('Visualizer mode').selectOption('spectrum');await page.waitForTimeout(300);
 console.log('PASS MilkDrop presets, inactive spectrum, playback continuity, immersive switching and palette restoration under production CSP');
 if(!layoutOnly){
 await page.getByRole('button',{name:'Pause',exact:true}).click();await page.waitForTimeout(600);await quality(false);await page.screenshot({path:join(output,'desktop.png')});await quality(true);await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.getByRole('button',{name:'Immersive view',exact:true}).click();
 await page.getByLabel('Visualizer palette').selectOption('Synthwave');await page.waitForTimeout(600);
 await desktopCamera();console.log('PASS immersive camera controls');
 const immersiveBounds=await page.locator('canvas').boundingBox();assert(immersiveBounds.width>1440*.9,JSON.stringify(immersiveBounds));
 assert(await audio.evaluate(a=>a===document.querySelector('audio')&&!a.paused));assert.equal(await audio.getAttribute('src'),initialSource);
 await page.locator('canvas').focus();await page.keyboard.press('Space');await page.waitForTimeout(600);await quality(false);await page.screenshot({path:join(output,'immersive.png')});await quality(true);await page.locator('canvas').focus();await page.keyboard.press('Space');
 await page.mouse.click(800,300);await page.waitForFunction(()=>document.querySelector('.player-fullscreen').classList.contains('player-chrome-idle'),{timeout:15000});
 assert((await dialog.getAttribute('class')).includes('player-chrome-idle'));console.log('PASS immersive idle fade');
 await page.mouse.move(790,310);await page.waitForTimeout(150);assert(!(await dialog.getAttribute('class')).includes('player-chrome-idle'));
 await page.keyboard.press('Escape');assert(!(await dialog.getAttribute('class')).includes('player-immersive'));assert(await dialog.isVisible());
 await page.locator('canvas').focus();await page.keyboard.press('f');assert((await dialog.getAttribute('class')).includes('player-immersive'));
 await page.keyboard.press('Space');assert(await audio.evaluate(a=>a.paused));await page.keyboard.press('Space');await page.waitForFunction(()=>!document.querySelector('audio').paused);
 await page.keyboard.press('Escape');console.log('PASS keyboard F, Space, Escape and persistent audio');
 }
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 for(const [width,height] of [[390,844],[360,640],[320,568],[740,360],[1100,650]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(400);
  const bounds=await dialog.evaluate(d=>({overflowX:d.scrollWidth>d.clientWidth+1,overflowY:d.scrollHeight>d.clientHeight+1,canvas:d.querySelector('canvas').getBoundingClientRect().toJSON(),play:d.querySelector('.player-play').getBoundingClientRect().toJSON()}));
  console.log('Viewport',width,height,JSON.stringify(bounds));assert(!bounds.overflowX);assert(bounds.canvas.height>=200||width>700);assert(bounds.play.bottom<=height||bounds.overflowY);
  if(width===390){
   const cdp=await context.newCDPSession(page),box=await page.locator('canvas').boundingBox();
   const x=Math.round(box.x+box.width*.4),y=Math.round(box.y+box.height*.5);
   const touch=async(type,points)=>{await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y}))});await waitCamera();};
   const initial=await camera();
   await touch('touchStart',[[1,x,y]]);await touch('touchMove',[[1,x+35,y+25]]);await touch('touchEnd',[]);assert.notDeepEqual(await camera(),initial);
   const rotated=await camera();
   await touch('touchStart',[[1,x,y],[2,x+50,y]]);await touch('touchMove',[[1,x-20,y],[2,x+80,y]]);await touch('touchEnd',[]);assert.notDeepEqual(await camera(),rotated);
   // Native touch double-tap, with no scrolling/browser zoom on the canvas.
   for(let tap=0;tap<2;tap++){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
   await waitCamera();assert.deepEqual(await camera(),initial);await cdp.detach();
   console.log('PASS mobile touch rotation, pinch, double-tap and paused redraw');
  }
  if(width===390||width===740)await page.screenshot({path:join(output,`${width===390?'mobile':'landscape'}.png`)});
  if(width===390||width===320){
   await page.getByLabel('Visualizer mode').selectOption('milkdrop');await page.waitForTimeout(500);
   const milkBounds=await milkCanvas.boundingBox();assert(milkBounds.height>=200);
   const controls=await page.getByLabel('Random preset',{exact:true}).boundingBox();assert(controls.x>=0&&controls.x+controls.width<=width);
   await page.getByLabel('Next preset',{exact:true}).click();
   if(width===390)await page.screenshot({path:join(output,'milkdrop-mobile.png')});
   await page.getByRole('button',{name:'Immersive view',exact:true}).click();await page.waitForTimeout(200);
   const milkImmersive=await dialog.evaluate(d=>({overflow:d.scrollWidth>d.clientWidth+1,play:d.querySelector('.player-play').getBoundingClientRect().bottom}));
   assert(!milkImmersive.overflow&&milkImmersive.play<=height,JSON.stringify(milkImmersive));
   assert((await milkCanvas.boundingBox()).width>=width*.9);
   await page.getByLabel('Next preset',{exact:true}).click();
   if(width===390)await page.screenshot({path:join(output,'milkdrop-mobile-immersive.png')});
   await page.keyboard.press('Escape');
   await page.getByLabel('Visualizer mode').selectOption('spectrum');await page.waitForTimeout(250);
  }
  await page.getByRole('button',{name:'Immersive view',exact:true}).click();await page.waitForTimeout(200);assert(await page.getByRole('button',{name:'Exit immersive view',exact:true}).isVisible());
  const immersive=await dialog.evaluate(d=>({x:d.scrollWidth>d.clientWidth+1,y:d.scrollHeight>d.clientHeight+1,play:d.querySelector('.player-play').getBoundingClientRect().bottom}));if(immersive.x||immersive.y)console.log('Overflow elements',await dialog.evaluate(d=>[...d.querySelectorAll('*')].map(e=>({tag:e.tagName,label:e.getAttribute('aria-label'),details:e.closest('details')?.open,cls:typeof e.className==='string'?e.className:'',rect:e.getBoundingClientRect().toJSON()})).filter(e=>e.rect.right>innerWidth+1||e.rect.left< -1)));assert(!immersive.x&&!immersive.y,JSON.stringify(immersive));assert(immersive.play<=height);
  if(width===390)await page.screenshot({path:join(output,'mobile-immersive.png')});
  await page.keyboard.press('Escape');assert(await dialog.isVisible());
 }
 await page.setViewportSize({width:1440,height:900});assert(await audio.evaluate(a=>a.paused));await page.waitForTimeout(800);
 let count=-1,stable=0;for(let attempt=0;attempt<40&&stable<5;attempt++){await page.waitForTimeout(200);const next=await page.evaluate(()=>window.__spectrumDraws);stable=next===count?stable+1:0;count=next;}assert(stable>=5,'Paused rendering did not settle');await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>window.__spectrumDraws),count);console.log('PASS no ongoing GPU submissions while paused');
 await page.getByRole('button',{name:'Close Now Playing'}).click();assert.equal(await page.locator('audio').count(),1);assert.equal(await audio.getAttribute('src'),initialSource);
 await page.getByRole('button',{name:'Open Now Playing'}).click();await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('audio').paused);assert(await audio.evaluate(a=>a===document.querySelector('audio')));
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(300);assert.equal(await page.locator('canvas:visible').count(),1);
 assert.deepEqual(errors,[]);console.log('PASS reopen, reduced-motion toggle, no browser exceptions');
 await page.getByLabel('Visualizer mode').selectOption('milkdrop');
 await page.getByLabel('Next preset',{exact:true}).click();
 const savedPreset=await page.getByLabel('MilkDrop preset').inputValue();
 await page.reload();await page.getByRole('button',{name:'Open Now Playing'}).click();
 assert.equal(await page.getByLabel('Visualizer mode').inputValue(),'milkdrop');
 assert.equal(await page.getByLabel('MilkDrop preset').inputValue(),savedPreset);
 assert(await page.locator('audio').evaluate(a=>a.paused));
 console.log('PASS engine/preset persistence after reload with paused playback restoration');
 await writeFile(join(output,'verification.json'),JSON.stringify({fixture:'Generated test tones; no real library data',geometry,errors,reducedReview,layoutOnly},null,2)+'\n');
}finally{await browser?.close();await app.close();await rm(temp,{recursive:true,force:true});}
