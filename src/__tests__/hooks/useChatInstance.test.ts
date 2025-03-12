import { renderHook, act, waitFor } from '@testing-library/react';
import useChatInstance from '../../hooks/useChatInstance';

describe('useChatInstance', () => {
  // Mock localStorage
  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: jest.fn((key: string) => store[key] || null),
      setItem: jest.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: jest.fn((key: string) => {
        delete store[key];
      }),
      clear: jest.fn(() => {
        store = {};
      }),
    };
  })();

  // Mock fetch
  const fetchMock = jest.fn();
  global.fetch = fetchMock;
  
  // Capture console.error
  const originalConsoleError = console.error;
  let consoleErrorSpy: jest.SpyInstance;

  // Helper function to wait for async effects to complete
  const flushPromises = () => new Promise(resolve => setTimeout(resolve, 100));

  beforeEach(() => {
    // Clear mocks
    localStorageMock.clear();
    jest.clearAllMocks();
    
    // Setup localStorage mock
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
    
    // Setup successful fetch response by default
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ chatInstanceId: 'new-instance-123' }),
      text: async () => 'Success'
    }));
    
    // Mock console.error to prevent noise in test output
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  
  afterEach(() => {
    // Restore console.error
    consoleErrorSpy.mockRestore();
  });

  it('should create a new instance when localStorage is empty', async () => {
    const { result } = renderHook(() => useChatInstance({
      chatModelId: 'model-123',
      lang: 'en',
      config: { apiUrl: 'https://api.example.com' }
    }));
    
    // Initial state should be empty
    expect(result.current.chatInstanceId).toBe('');
    
    // Wait for the effect to run and API call to complete
    await act(async () => {
      await flushPromises();
    });
    
    // Now the chat instance should be set
    expect(result.current.chatInstanceId).toBe('new-instance-123');
    
    // Verify API was called
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/api/chat/createInstance',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String)
      })
    );
    
    // Verify localStorage was updated with the new format
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'chatInstanceId[model-123-standard]', 
      'new-instance-123'
    );
  });

  it('should load existing instance from localStorage', async () => {
    // Set existing instance in localStorage before rendering hook
    act(() => {
      localStorageMock.setItem('chatInstanceId[model-123-standard]', 'existing-instance-456');
    });
    
    const { result } = renderHook(() => useChatInstance({
      chatModelId: 'model-123',
      lang: 'en',
      config: { apiUrl: 'https://api.example.com' }
    }));
    
    // Wait for the effect to run
    await act(async () => {
      await flushPromises();
    });
    
    // The chat instance should be loaded from localStorage
    expect(result.current.chatInstanceId).toBe('existing-instance-456');
    
    // No API call should happen
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should create a new instance when getNewInstance is called', async () => {
    // Setup initial instance
    act(() => {
      localStorageMock.setItem('chatInstanceId[model-123-standard]', 'existing-instance-456');
    });
    
    const { result } = renderHook(() => useChatInstance({
      chatModelId: 'model-123',
      lang: 'en',
      config: { apiUrl: 'https://api.example.com' }
    }));
    
    // Wait for initial load
    await act(async () => {
      await flushPromises();
    });
    
    expect(result.current.chatInstanceId).toBe('existing-instance-456');
    
    // Setup mock for new instance
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ chatInstanceId: 'french-instance-789' }),
      text: async () => 'Success'
    }));
    
    // Call getNewInstance
    await act(async () => {
      await result.current.getNewInstance();
      await flushPromises();
    });
    
    // Verify state was updated
    expect(result.current.chatInstanceId).toBe('french-instance-789');
    
    // Verify API was called with correct parameters
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/api/chat/createInstance',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ 
          chatModelId: 'model-123', 
          lang: 'en',
          userEmail: 'anonymous@example.com',
          userName: 'Anonymous'
        })
      })
    );
  });

  it('should handle API errors gracefully', async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500, text: () => 'Server Error' }));

    const { result } = renderHook(() => useChatInstance({ chatModelId: 'model-123', lang: 'en' }));

    await waitFor(() => expect(result.current.error).toBeTruthy());
  });

  it('should include user token in headers when provided', async () => {
    const user = { token: 'user-token-123' };

    const { result } = renderHook(() => useChatInstance({
      chatModelId: 'model-123',
      lang: 'en',
      config: { apiUrl: 'https://api.example.com', apiToken: 'api-token-123' },
      user,
    }));

    await waitFor(() => expect(result.current.chatInstanceId).toBe('new-instance-123'));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/api/chat/createInstance',
      expect.objectContaining({
        headers: expect.objectContaining({
          appToken: 'api-token-123',
          'Content-Type': 'application/json',
        }),
      })
    );
  });

  it('should store and read instance ID correctly from localStorage', async () => {
    // Set up the initial stored instance
    act(() => {
      localStorageMock.setItem('chatInstanceId[model-123-standard]', 'stored-instance-789');
    });

    const { result } = renderHook(() => useChatInstance({ 
      chatModelId: 'model-123', 
      lang: 'en' 
    }));

    // Wait for the effect to run
    await act(async () => {
      await flushPromises();
    });

    expect(result.current.chatInstanceId).toBe('stored-instance-789');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should perform cleanup correctly', async () => {
    const { result } = renderHook(() => useChatInstance({ 
      chatModelId: 'model-123', 
      lang: 'en' 
    }));

    // Wait for initial setup
    await act(async () => {
      await flushPromises();
    });

    // Perform cleanup
    await act(async () => {
      await result.current.cleanup();
      await flushPromises();
    });

    expect(localStorageMock.removeItem).toHaveBeenCalledWith('chatInstanceId[model-123-standard]');
    expect(result.current.chatInstanceId).toBe('');
  });
});
