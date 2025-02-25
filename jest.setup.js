// This file contains setup code that will be run before each test

// Add any global mocks, configuration, or extensions here
// For example:

// Mock localStorage for tests
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn(),
      length: 0,
      key: jest.fn(),
    },
    writable: true
  });
}

// Silence console.error in tests (optional)
// jest.spyOn(console, 'error').mockImplementation(() => {});

// If you use React Testing Library, you might want to add custom matchers
// import '@testing-library/jest-dom'; 