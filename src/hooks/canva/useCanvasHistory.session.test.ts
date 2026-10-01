import { act, renderHook } from '@testing-library/react';
import useCanvasHistory from './useCanvasHistory';

it('does not retain documents when the conversation changes or is cleared', () => {
  (localStorage.getItem as jest.Mock).mockReturnValue(null);
  const { result, rerender } = renderHook(({ id }) => useCanvasHistory('model', id), { initialProps: { id: 'alice' } });
  act(() => result.current.setCanvasesFromAPI([{ id: 'private-document', title: 'Private', content: 'private content' } as any]));
  expect(result.current.canvases).toHaveLength(1);
  rerender({ id: '' });
  expect(result.current.canvases).toEqual([]);
  expect(result.current.canvas.content).toEqual([]);
  rerender({ id: 'bob' });
  expect(result.current.history).toEqual([]);
  expect(result.current.canvases).toEqual([]);
});
