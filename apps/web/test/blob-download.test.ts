import { createElement, type FC } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBlobDownload } from '../src/hooks/use-blob-download';
import type { AsyncEvent } from '../src/hooks/use-async-event';

const readDownload = (load: (signal: AbortSignal) => Promise<Blob>): AsyncEvent<[]> => {
  let download: AsyncEvent<[]> | undefined;
  const Probe: FC = () => {
    download = useBlobDownload('fixture', load, 'fixture.jsonl');
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  if (download === undefined) throw new Error('Download fixture was not rendered');
  return download;
};

const anchor = (): { href: string; download: string; click: () => void; remove: () => void } => {
  return { href: '', download: '', click: vi.fn(), remove: vi.fn() };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('temporary browser download ownership', () => {
  it('keeps exact bytes available after click, then releases the URL and temporary link', async () => {
    const link = anchor();
    const append = vi.fn();
    vi.stubGlobal('document', { createElement: () => link, body: { append } });
    const blob = new Blob(['{"text":"测试"}\n']);
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const download = readDownload(() => Promise.resolve(blob));
    download.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(create).toHaveBeenCalledWith(blob);
    expect(link.href).toBe('blob:fixture');
    expect(link.download).toBe('fixture.jsonl');
    expect(append).toHaveBeenCalledWith(link);
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(link.remove).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:fixture');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores duplicate clicks and cancelled late data before creating any download URL', async () => {
    let release: (blob: Blob) => void = () => {
      throw new Error('Download gate was not initialized');
    };
    const pending = new Promise<Blob>((resolve) => {
      release = resolve;
    });
    const signals: AbortSignal[] = [];
    const load = vi.fn((signal: AbortSignal): Promise<Blob> => {
      signals.push(signal);
      return pending;
    });
    const create = vi.spyOn(URL, 'createObjectURL');
    const download = readDownload(load);
    download.run();
    download.run();
    expect(load).toHaveBeenCalledTimes(1);
    download.cancel();
    expect(signals[0]?.aborted).toBe(true);
    release(new Blob(['late response']));
    await vi.advanceTimersByTimeAsync(0);
    expect(create).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases the URL and removes its link when browser download dispatch throws', async () => {
    const link = anchor();
    link.click = vi.fn(() => {
      throw new Error('Browser download failed');
    });
    vi.stubGlobal('document', { createElement: () => link, body: { append: vi.fn() } });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:failed');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const download = readDownload(() => Promise.resolve(new Blob(['fixture'])));
    download.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:failed');
    expect(link.remove).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
