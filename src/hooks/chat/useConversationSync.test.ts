import { act, renderHook } from '@testing-library/react';
import { useConversationSync } from './useConversationSync';

const response = (serverTime = '2026-09-30T10:00:00Z') => ({ ok: true, status: 200,
  json: async () => ({ messages: [{ id: 'agent-1' }], serverTime }) });
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { promise, resolve }; };

describe('durable conversation sync', () => {
  let fetchMock: jest.Mock;
  const base = { chatInstanceId: 'chat-1', apiUrl: 'https://api.example', socketStatus: 'connected', onHistory: jest.fn() };
  beforeEach(() => { jest.useFakeTimers({ doNotFake: ["queueMicrotask"] }); base.onHistory.mockClear(); fetchMock = jest.fn().mockResolvedValue(response()); global.fetch = fetchMock; });
  afterEach(() => { jest.useRealTimers(); });
  const flush = async () => { await act(async () => { await Promise.resolve(); }); };

  it('fetches despite a cached history, and supports later refreshes with a server cursor', async () => {
    const { result } = renderHook(() => useConversationSync(base));
    await flush();
    await act(async () => { await result.current(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('since=2026-09-30T09%3A59%3A55.000Z');
    expect(fetchMock.mock.calls[0][1].cache).toBe('no-store');
  });
  it('coalesces overlapping requests', async () => {
    const pending = deferred(); fetchMock.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useConversationSync(base));
    const first = result.current(), second = result.current();
    expect(first).toBe(second); await flush(); expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(response()); await first; });
  });
  it('retries a failed initial request instead of locking initialization', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    renderHook(() => useConversationSync(base)); await flush();
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(base.onHistory).toHaveBeenCalledTimes(1);
  });
  it('does not apply a response from a previous conversation or carry over its cursor', async () => {
    const pending = deferred(); fetchMock.mockReturnValueOnce(pending.promise);
    const { rerender } = renderHook(({ id }) => useConversationSync({ ...base, chatInstanceId: id }), { initialProps: { id: 'old' } });
    await flush(); rerender({ id: 'new' }); await flush();
    await act(async () => { pending.resolve(response('2030-01-01T00:00:00Z')); });
    expect(base.onHistory).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.example/api/chat/history/new');
  });
  it('aborts on unmount and leaves no recovery timers', async () => {
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const { unmount } = renderHook(() => useConversationSync(base));
    await flush(); unmount(); await flush();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
  it.each([401, 403, 404])('stops retries after access rejection %s', async status => {
    fetchMock.mockResolvedValue({ ok: false, status });
    const { result } = renderHook(() => useConversationSync(base)); await flush();
    await act(async () => { await result.current(); jest.advanceTimersByTime(120000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('recovers when reopening a minimized widget and when the network returns', async () => {
    renderHook(() => useConversationSync(base)); await flush();
    await act(async () => { window.dispatchEvent(new CustomEvent('aismarttalk:visibility', { detail: false })); });
    await act(async () => { jest.advanceTimersByTime(15000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new CustomEvent('aismarttalk:visibility', { detail: true })); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
