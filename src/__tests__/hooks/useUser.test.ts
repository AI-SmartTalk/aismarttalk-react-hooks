import { renderHook, act } from '@testing-library/react';
import useUser, { User } from '../../hooks/useUser';

describe('useUser', () => {
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

  beforeEach(() => {
    // Clear localStorage mock
    localStorageMock.clear();
    jest.clearAllMocks();
    
    // Setup localStorage mock
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
  });

  // Helper to create valid and invalid tokens
  const createValidToken = () => {
    const now = Math.floor(Date.now() / 1000);
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({ exp: now + 3600 })); // Valid for 1 hour
    const signature = btoa('signature');
    return `${header}.${payload}.${signature}`;
  };

  const createExpiredToken = () => {
    const now = Math.floor(Date.now() / 1000);
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({ exp: now - 3600 })); // Expired 1 hour ago
    const signature = btoa('signature');
    return `${header}.${payload}.${signature}`;
  };

  it('should initialize with anonymous user when localStorage is empty', () => {
    const { result } = renderHook(() => useUser());
    
    expect(result.current.user).toEqual(expect.objectContaining({
      id: 'anonymous',
      email: 'anonymous@example.com',
      name: 'Anonymous'
    }));
    
    expect(localStorageMock.getItem).toHaveBeenCalledWith('user');
  });

  it('should load user from localStorage if available', () => {
    const testUser: User = {
      id: 'test-id',
      email: 'test@example.com',
      name: 'Test User',
      token: createValidToken()
    };
    
    localStorageMock.setItem('user', JSON.stringify(testUser));
    
    const { result } = renderHook(() => useUser());
    
    expect(result.current.user).toEqual(testUser);
  });

  it('should set and persist a new user', () => {
    const { result } = renderHook(() => useUser());
    
    const newUser: User = {
      email: 'new@example.com',
      name: 'New User',
      token: createValidToken()
    };
    
    act(() => {
      result.current.setUser(newUser);
    });
    
    // Should add an ID if not provided
    expect(result.current.user.id).toBe('user-new');
    expect(result.current.user.email).toBe('new@example.com');
    expect(result.current.user.name).toBe('New User');
    
    // Should persist to localStorage
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'user', 
      expect.any(String)
    );
    
    // Verify the stored value
    const storedUser = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);
    expect(storedUser.email).toBe('new@example.com');
  });

  it('should handle JSON parse errors when loading from localStorage', () => {
    // Set corrupted data in localStorage
    localStorageMock.setItem('user', 'not-valid-json');
    
    const { result } = renderHook(() => useUser());
    
    // Should fall back to anonymous user
    expect(result.current.user).toEqual(expect.objectContaining({
      id: 'anonymous',
      email: 'anonymous@example.com'
    }));
    
    // Should clean up the corrupted data
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('user');
  });

  it('should handle expired token by falling back to anonymous user', () => {
    const expiredUser: User = {
      id: 'expired-id',
      email: 'expired@example.com',
      name: 'Expired User',
      token: createExpiredToken()
    };
    
    localStorageMock.setItem('user', JSON.stringify(expiredUser));
    
    const { result } = renderHook(() => useUser());
    
    // Should fall back to anonymous user
    expect(result.current.user).toEqual(expect.objectContaining({
      id: 'anonymous',
      email: 'anonymous@example.com'
    }));
    
    // Should clean up the expired user data
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('user');
  });

  it('should handle invalid token format by falling back to anonymous user', () => {
    const invalidUser: User = {
      id: 'invalid-id',
      email: 'invalid@example.com',
      name: 'Invalid User',
      token: 'not-a-jwt-token'
    };
    
    localStorageMock.setItem('user', JSON.stringify(invalidUser));
    
    const { result } = renderHook(() => useUser());
    
    // Should fall back to anonymous user
    expect(result.current.user).toEqual(expect.objectContaining({
      id: 'anonymous',
      email: 'anonymous@example.com'
    }));
    
    // Should clean up the invalid user data
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('user');
  });

  it('should update user from localStorage', () => {
    const { result } = renderHook(() => useUser());
    
    // Start with anonymous user
    expect(result.current.user.id).toBe('anonymous');
    
    // Set a new user in localStorage directly
    const updatedUser: User = {
      id: 'updated-id',
      email: 'updated@example.com',
      name: 'Updated User',
      token: createValidToken()
    };
    
    localStorageMock.setItem('user', JSON.stringify(updatedUser));
    
    // Call updateUserFromLocalStorage
    act(() => {
      result.current.updateUserFromLocalStorage();
    });
    
    // User should be updated from localStorage
    expect(result.current.user).toEqual(updatedUser);
  });

  it('should handle localStorage errors when setting user', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    
    // Mock localStorage.setItem to throw error
    localStorageMock.setItem.mockImplementationOnce(() => {
      throw new Error('QuotaExceededError');
    });
    
    const { result } = renderHook(() => useUser());
    
    const newUser: User = {
      email: 'error@example.com',
      name: 'Error User',
      token: createValidToken()
    };
    
    // This should not throw despite localStorage error
    act(() => {
      result.current.setUser(newUser);
    });
    
    // User state should still be updated in memory
    expect(result.current.user.email).toBe('error@example.com');
    
    // Cleanup
    consoleErrorSpy.mockRestore();
  });
});