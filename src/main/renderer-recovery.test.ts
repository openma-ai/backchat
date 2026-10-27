import {afterEach,describe,expect,it,vi} from 'vitest';
import {RendererRecovery} from './renderer-recovery';

afterEach(()=>vi.useRealTimers());
function fixture(){
 const reload=vi.fn(),fallback=vi.fn(),log=vi.fn();
 const recovery=new RendererRecovery({reload,fallback,log,isDestroyed:()=>false});
 return {recovery,reload,fallback,log};
}
describe('bounded renderer recovery',()=>{
 it('reloads only the renderer after a crash and records success after load',async()=>{
  vi.useFakeTimers();const f=fixture();f.recovery.gone('crashed');
  expect(f.reload).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(500);
  expect(f.reload).toHaveBeenCalledTimes(1);f.recovery.loaded();
  expect(f.log).toHaveBeenCalledWith('recovered',expect.any(Object));f.recovery.dispose();
 });
 it('stops after two crashes in a five minute window instead of looping',async()=>{
  vi.useFakeTimers();const f=fixture();
  for(let i=0;i<2;i++){f.recovery.gone('crashed');await vi.advanceTimersByTimeAsync(500);f.recovery.loaded();}
  f.recovery.gone('crashed');await vi.advanceTimersByTimeAsync(500);
  expect(f.reload).toHaveBeenCalledTimes(2);expect(f.fallback).toHaveBeenCalledTimes(1);f.recovery.dispose();
 });
 it('offers native recovery if a reload never finishes',async()=>{
  vi.useFakeTimers();const f=fixture();f.recovery.gone('oom');await vi.advanceTimersByTimeAsync(20_500);
  expect(f.fallback).toHaveBeenCalledTimes(1);f.recovery.dispose();
 });
 it('does not recover a clean exit and cancels pending reload on close',async()=>{
  vi.useFakeTimers();const f=fixture();f.recovery.gone('clean-exit');
  await vi.advanceTimersByTimeAsync(1000);expect(f.reload).not.toHaveBeenCalled();
  f.recovery.gone('crashed');f.recovery.dispose();await vi.advanceTimersByTimeAsync(1000);
  expect(f.reload).not.toHaveBeenCalled();
 });
 it('allows another bounded attempt after the window expires',async()=>{
  vi.useFakeTimers();const f=fixture();
  for(let i=0;i<2;i++){f.recovery.gone('crashed');await vi.advanceTimersByTimeAsync(500);f.recovery.loaded();}
  await vi.advanceTimersByTimeAsync(300_001);f.recovery.gone('crashed');await vi.advanceTimersByTimeAsync(500);
  expect(f.reload).toHaveBeenCalledTimes(3);f.recovery.dispose();
 });
});
