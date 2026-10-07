import { act, renderHook, waitFor } from '@testing-library/react';
import socketIOClient from 'socket.io-client';
import { useSocketHandler } from './useSocketHandler';
jest.mock('socket.io-client', () => ({ __esModule: true, default: jest.fn() }));

it('reconnects on token renewal and ignores events from the old identity', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ socketToken: 'signed-grant' }) });
  const sockets: any[] = [];
  (socketIOClient as jest.Mock).mockImplementation(() => {
    const callbacks: Record<string, Function> = {};
    const socket = { connected: true, onAny: jest.fn(), io: { on: jest.fn() }, on: jest.fn((event, cb) => { callbacks[event] = cb; }), emit: jest.fn(), disconnect: jest.fn(), removeAllListeners: jest.fn(), callbacks };
    sockets.push(socket); return socket;
  });
  const joined = jest.fn(); const setter = jest.fn(); const dispatch = jest.fn();
  const canvas: any = {};
  const { rerender, unmount } = renderHook(({ token }) => useSocketHandler('conversation', { id: 'alice', email: 'alice@example.test', token } as any,
    'http://ws.test', 'http://core.test', 'model', dispatch, setter, setter, setter, setter, setter, setter, canvas, [], false, joined), { initialProps: { token: 'old' } });
  act(() => sockets[0].callbacks.connect());
  await waitFor(() => expect(sockets[0].emit).toHaveBeenCalledWith('join', { chatInstanceId: 'conversation', chatModelId: 'model', socketToken: 'signed-grant' }));
  const admissions = (global.fetch as jest.Mock).mock.calls.length;
  act(() => sockets[0].callbacks['session-access-denied']());
  expect(global.fetch).toHaveBeenCalledTimes(admissions);
  setter.mockClear();
  act(() => sockets[0].callbacks['otp-login']({ chatInstanceId: 'other-conversation', user: { id: 'attacker' }, token: 'attacker-token' }));
  expect(setter).not.toHaveBeenCalled();
  const previous = sockets[0].callbacks.joined;
  rerender({ token: 'renewed' });
  expect(sockets[0].disconnect).toHaveBeenCalled();
  act(() => { previous({ chatInstanceId: 'conversation' }); });
  expect(joined).not.toHaveBeenCalled();
  act(() => { sockets[1].callbacks.joined({ chatInstanceId: 'conversation' }); });
  expect(joined).toHaveBeenCalledTimes(1);
  // Realtime attribution must agree with history after a visitor is claimed.
  const guest = { id: 'sys_anonymous', email: 'visitor@example.test', name: 'Visitor', role: 'ANONYMOUS' };
  act(() => sockets[1].callbacks['chat-message']({ chatInstanceId: 'conversation', message: { id: 'guest-message', text: 'hello', user: guest } }));
  expect(dispatch.mock.calls.at(-1)[0].payload.message).toMatchObject({ isSent: true, user: guest });
  act(() => sockets[1].callbacks['chat-message']({ chatInstanceId: 'conversation', message: { id: 'agent-message', text: 'reply', user: { id: 'alice', email: 'alice@example.test' }, metadata: { sentAsAgent: true } } }));
  expect(dispatch.mock.calls.at(-1)[0].payload.message.isSent).toBe(false);
  act(() => sockets[1].callbacks['chat-message']({ chatInstanceId: 'conversation', message: { id: 'bot-message', text: 'reply', user: { id: 'alice', email: 'alice@example.test', role: 'BOT' } } }));
  expect(dispatch.mock.calls.at(-1)[0].payload.message.isSent).toBe(false);
  unmount();
});

describe('socket admission request budget', () => {
  let socket: any;
  const joined = jest.fn(), setter = jest.fn();
  beforeEach(() => {
    jest.useFakeTimers(); joined.mockClear();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ socketToken: 'signed-grant' }) });
    (socketIOClient as jest.Mock).mockImplementation(() => {
      const callbacks: Record<string, Function> = {}, manager: Record<string, Function> = {};
      socket = { connected: true, callbacks, manager, onAny: jest.fn(), io: { on: (event: string, cb: Function) => { manager[event] = cb; } }, on: (event: string, cb: Function) => { callbacks[event] = cb; }, emit: jest.fn(), disconnect: jest.fn(), removeAllListeners: jest.fn() };
      return socket;
    });
  });
  afterEach(() => jest.useRealTimers());
  const mount = () => renderHook(() => useSocketHandler('conversation', { id: 'alice', token: 'account' } as any,
    'http://ws.test', 'http://core.test', 'model', setter, setter, setter, setter, setter, setter, setter, {} as any, [], false, joined));
  const flush = async () => { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); };
  it('renews grants for five minutes without reloading history and recovers once per reconnect', async () => {
    const { unmount } = mount();
    act(() => socket.callbacks.connect()); await flush();
    act(() => socket.callbacks.joined({ chatInstanceId: 'conversation' }));
    for (let i = 0; i < 6; i++) {
      await act(async () => { jest.advanceTimersByTime(45000); });
      act(() => socket.callbacks.joined({ chatInstanceId: 'conversation' }));
    }
    expect(global.fetch).toHaveBeenCalledTimes(7);
    expect(joined).toHaveBeenCalledTimes(1);
    act(() => { socket.callbacks.disconnect('transport close'); socket.manager.reconnect(); socket.callbacks.connect(); });
    await flush(); expect(global.fetch).toHaveBeenCalledTimes(8);
    act(() => { socket.callbacks.joined({ chatInstanceId: 'conversation' }); socket.callbacks.joined({ chatInstanceId: 'conversation' }); });
    expect(joined).toHaveBeenCalledTimes(2);
    unmount(); await flush();
    await act(async () => { jest.advanceTimersByTime(90000); });
    expect(global.fetch).toHaveBeenCalledTimes(8);
  });
  it('stops asking for grants after definitive authorization rejection', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 403, json: async () => ({ code: 'CONVERSATION_ACCESS_DENIED' }) });
    const { unmount } = mount(); act(() => socket.callbacks.connect()); await flush();
    await act(async () => { jest.advanceTimersByTime(180000); socket.callbacks['session-access-denied'](); });
    expect(global.fetch).toHaveBeenCalledTimes(1); expect(socket.emit).not.toHaveBeenCalled(); unmount();
  });
  it('aborts an unavailable admission and allows a later renewal without overlapping requests', async () => {
    (global.fetch as jest.Mock).mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const { unmount } = mount(); act(() => socket.callbacks.connect()); await flush();
    act(() => socket.callbacks.connect()); expect(global.fetch).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(10000); });
    expect((global.fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { jest.advanceTimersByTime(35000); });
    expect(global.fetch).toHaveBeenCalledTimes(2); unmount(); await flush();
    await act(async () => { jest.advanceTimersByTime(90000); });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
