import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useEditorialSession } from '../useEditorialSession';
import { uiReady } from '@/lib/__tests__/editorialUiFixture';
import { requireConfirmedOutput } from '@/lib/editorialOutput';
it('accepts only the current session/run and increasing revision; ignores late callbacks and unmount', () => {
 const {result,unmount}=renderHook(()=>useEditorialSession('s')); const s=uiReady();
 act(()=>result.current.restore(s)); let run!:ReturnType<typeof result.current.begin>;
 act(()=>{run=result.current.begin()}); act(()=>run.checkpoint({...s,activeRunId:run.runId,revision:4}));
 act(()=>run.checkpoint({...s,activeRunId:'foreign',revision:99})); expect(result.current.session?.revision).toBe(4);
 act(()=>run.checkpoint({...s,activeRunId:run.runId,revision:3})); expect(result.current.session?.revision).toBe(4);
 act(()=>result.current.restore(undefined)); expect(run.isCurrent()).toBe(false); act(()=>run.checkpoint({...s,activeRunId:run.runId,revision:100})); expect(result.current.session).toBeUndefined(); unmount(); expect(run.isCurrent()).toBe(false);
});
it('persistence failure never unlocks output; replacement during persistence cannot unlock another revision', async()=>{
 const {result}=renderHook(()=>useEditorialSession('s')); act(()=>result.current.restore(uiReady()));
 await act(async()=>{await expect(result.current.confirm(async()=>{throw Error('disk')})).rejects.toThrow('disk')}); expect(()=>requireConfirmedOutput(result.current.session!)).toThrow();
 let resolve!:()=>void; const disk=vi.fn(()=>new Promise<void>(r=>{resolve=r})); let pending!:Promise<boolean>;
 act(()=>{pending=result.current.confirm(disk)}); act(()=>result.current.restore({...uiReady(),revision:20})); await act(async()=>{resolve(); expect(await pending).toBe(false)}); expect(result.current.session?.revision).toBe(20); expect(()=>requireConfirmedOutput(result.current.session!)).toThrow();
});
it('confirms the exact snapshot only after durable persistence',async()=>{
 const {result}=renderHook(()=>useEditorialSession('s')); act(()=>result.current.restore(uiReady())); await act(async()=>{expect(await result.current.confirm(async(next,expected)=>{expect(expected).toBe(3);expect(next.committed?.confirmation?.htmlHash).toBe(next.layout?.htmlHash)})).toBe(true)}); expect(requireConfirmedOutput(result.current.session!).document.title).toBe('Public title');
});
