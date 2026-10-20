// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {FlatSpectrumScene,spectrumColor} from './spectrum-2d.js';
import {palettes,readVisualizerSettings,saveVisualizerSettings,defaultVisualizer} from './visualizer-settings.js';
it('defaults legacy spectrum preferences to 2D without losing the palette; explicit later 3D choices persist',()=>{
 localStorage.setItem('freeqify.visualizer.2d-review',JSON.stringify({engine:'spectrum',palette:'Amber CRT'}));
 expect(readVisualizerSettings('2d-review')).toMatchObject({engine:'spectrum2d',palette:'Amber CRT'});
 localStorage.setItem('freeqify.visualizer.2d-review',JSON.stringify({engine:'milkdrop',spectrumVersion:2}));expect(readVisualizerSettings('2d-review').engine).toBe('spectrum2d');
 saveVisualizerSettings('2d-review',{...defaultVisualizer,engine:'spectrum',palette:'Ice'});expect(readVisualizerSettings('2d-review')).toMatchObject({engine:'spectrum',palette:'Ice'});
});
it('draws actual levels as flat bars, remains empty for silence, and supports every existing palette without WebGL',()=>{
 const ctx={clearRect:vi.fn(),fillRect:vi.fn(),fillStyle:''},canvas=document.createElement('canvas');
 vi.spyOn(canvas,'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);vi.spyOn(canvas,'getBoundingClientRect').mockReturnValue({width:320,height:180} as DOMRect);
 const scene=new FlatSpectrumScene(canvas);scene.draw(32,1,true,0,'Freeqify Green');expect(ctx.fillRect).not.toHaveBeenCalled();
 scene.levels[0]=1;scene.draw(32,1,true,0,'Freeqify Green');expect(ctx.fillRect).toHaveBeenCalledTimes(32);
 expect(ctx.fillRect.mock.calls.every(([x,y,w,h])=>x>=0&&y>=0&&w>0&&h>0)).toBe(true);
 const colors=palettes.map(p=>spectrumColor(p,.4,.8));expect(new Set(colors.map(String)).size).toBe(palettes.length);expect(colors.flat().every(v=>v>=0&&v<=1)).toBe(true);
 expect(canvas.getContext).toHaveBeenCalledWith('2d');
});
