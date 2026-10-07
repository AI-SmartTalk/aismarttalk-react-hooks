import { act, renderHook, waitFor } from '@testing-library/react';
import { useConversationHistory } from './useConversationHistory';
const item = (id: string) => ({ id, title: id, preview: 'preview', lastUpdated: '2026-09-23T10:00:00Z', messageCount: 4 });
const response = (items: any[], cursor: string | null = null) => ({ ok: true, json: async () => ({ conversations: items, nextCursor: cursor }) });
const options = { apiUrl: 'http://api.test', chatModelId: 'shop', userId: 'alice', token: 'signed-token' };

it('loads persistent summaries with an empty browser and appends bounded pages without duplicate IDs', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce(response([item('old')], 'next')).mockResolvedValueOnce(response([item('old'), item('older')]));
  const { result, unmount } = renderHook(() => useConversationHistory(options));
  await waitFor(() => expect(result.current.conversations).toHaveLength(1));
  await act(async () => { await result.current.loadMore(); });
  expect(result.current.conversations.map(c => c.id)).toEqual(['old', 'older']);
  expect((global.fetch as jest.Mock).mock.calls[1][0]).toContain('cursor=next');
  expect(result.current.hasMore).toBe(false);
  expect(result.current.conversations[0].messages).toEqual([]);
  unmount();
});
it('never exposes the previous account history or a late response after logout', async () => {
  let complete!: Function;
  global.fetch = jest.fn(() => new Promise(resolve => { complete = resolve; })) as any;
  const { result, rerender, unmount } = renderHook(({ token }) => useConversationHistory({ ...options, token }), { initialProps: { token: options.token as string | undefined } });
  rerender({ token: undefined });
  await act(async () => { complete(response([item('private')])); });
  expect(result.current.conversations).toEqual([]);
  expect(result.current.isLoading).toBe(false);
  unmount();
});
it('queries messages on the server and retains explicit retry after an error', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce(response([item('match')]));
  const { result, unmount } = renderHook(() => useConversationHistory({ ...options, search: 'invoice' }));
  await waitFor(() => expect(result.current.error).toBeTruthy());
  await act(async () => { await result.current.refresh(); });
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('q=invoice');
  expect(result.current.conversations[0].id).toBe('match');
  expect(result.current.error).toBeNull();
  unmount();
});
it('persists rename/removal and refreshes from the server only after success', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce(response([item('old')])).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(response([{ ...item('old'), title: 'Renamed' }])).mockResolvedValueOnce({ ok: false, status: 403 });
  const { result, unmount } = renderHook(() => useConversationHistory(options));
  await waitFor(() => expect(result.current.conversations).toHaveLength(1));
  await act(async () => { await result.current.rename('old', 'Renamed'); });
  expect(result.current.conversations[0].title).toBe('Renamed');
  expect((global.fetch as jest.Mock).mock.calls[1][1]).toMatchObject({ method: 'PATCH', body: '{"title":"Renamed"}' });
  await act(async () => { await expect(result.current.remove('old')).rejects.toThrow(); });
  expect(result.current.conversations).toHaveLength(1);
  unmount();
});
