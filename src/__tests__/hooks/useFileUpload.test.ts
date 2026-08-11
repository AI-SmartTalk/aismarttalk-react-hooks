import { renderHook, act } from '@testing-library/react';
import { useFileUpload } from '../../hooks/fileUpload/useFileUpload';

/** `Response` n'existe pas sous jsdom : seule la surface utilisée est simulée. */
const jsonResponse = (body: unknown, status = 200) => {
  const response = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone: () => response,
  };
  return response;
};

const file = () => new File(['contenu'], 'rapport.pdf', { type: 'application/pdf' });

const props = (token?: string) => ({
  chatModelId: 'cm_1',
  chatInstanceId: 'ci_1',
  config: { apiUrl: 'https://core.example.com', apiToken: 'app-token' },
  user: token ? { token } : undefined,
});

describe('useFileUpload', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('vise la route v1 quand la personne est identifiée', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ attachment: { id: 'a1' } }, 202));

    const { result } = renderHook(() => useFileUpload(props('user-token')));
    await act(async () => {
      await result.current.uploadFile(file(), 'EDIT');
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://core.example.com/api/v1/me/conversations/ci_1/attachments');
    expect(init.headers.Authorization).toBe('Bearer user-token');
    expect((init.body as FormData).get('purpose')).toBe('EDIT');
  });

  it('reste sur la route publique pour un visiteur anonyme', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }, 202));

    const { result } = renderHook(() => useFileUpload(props()));
    await act(async () => {
      await result.current.uploadFile(file());
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/public/chatModel/cm_1/chatInstance/ci_1/canva');
    expect((fetchMock.mock.calls[0][1].body as FormData).get('purpose')).toBe('ANALYSIS');
  });

  it('repasse par la route publique face à un cœur qui ne connaît pas la v1', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'Not found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ success: true }, 202));

    const { result } = renderHook(() => useFileUpload(props('user-token')));
    await act(async () => {
      await result.current.uploadFile(file());
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('/canva');
  });

  it('ne masque pas un refus légitime derrière un repli', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'File exceeds the allowed size' }, 413));

    const { result } = renderHook(() => useFileUpload(props('user-token')));
    let response: any;
    await act(async () => {
      response = await result.current.uploadFile(file());
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.success).toBe(false);
    expect(response.error).toBe('File exceeds the allowed size');
  });

  it('rend le message du serveur, pas seulement le statut', async () => {
    const onUploadError = jest.fn();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Unsupported file type: .zip' }, 415));

    const { result } = renderHook(() =>
      useFileUpload({ ...props(), onUploadError }),
    );
    await act(async () => {
      await result.current.uploadFile(file());
    });

    expect(onUploadError).toHaveBeenCalledWith('Unsupported file type: .zip');
    expect(result.current.error).toBe('Unsupported file type: .zip');
  });
});
