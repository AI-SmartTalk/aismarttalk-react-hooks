import { act, renderHook } from '@testing-library/react';
import socketIOClient from 'socket.io-client';
import { useSocketHandler } from './useSocketHandler';
jest.mock('socket.io-client', () => ({ __esModule: true, default: jest.fn() }));

it('reconnects on token renewal and ignores events from the old identity', () => {
  const sockets: any[] = [];
  (socketIOClient as jest.Mock).mockImplementation(() => {
    const callbacks: Record<string, Function> = {};
    const socket = { onAny: jest.fn(), io: { on: jest.fn() }, on: jest.fn((event, cb) => { callbacks[event] = cb; }), emit: jest.fn(), disconnect: jest.fn(), removeAllListeners: jest.fn(), callbacks };
    sockets.push(socket); return socket;
  });
  const joined = jest.fn(); const setter = jest.fn(); const dispatch = jest.fn();
  const canvas: any = {};
  const { rerender, unmount } = renderHook(({ token }) => useSocketHandler('conversation', { id: 'alice', email: 'alice@example.test', token } as any,
    'http://ws.test', 'http://core.test', 'model', dispatch, setter, setter, setter, setter, setter, setter, canvas, [], false, joined), { initialProps: { token: 'old' } });
  act(() => sockets[0].callbacks.connect());
  expect(sockets[0].emit).toHaveBeenCalledWith('join', { chatInstanceId: 'conversation' });
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
  unmount();
});
