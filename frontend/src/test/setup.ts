import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/**
 * Unit Test Setup
 *
 * This setup provides infrastructure mocks for browser APIs not available in Node.js.
 * These are NOT data mocks - they are required for the test environment to function.
 *
 * Tests should use real API calls where possible. Backend must be running for
 * tests that make API calls.
 *
 * Note: Tests that make API calls without backend will fail with network errors.
 * This is expected behavior - run backend before running tests.
 */

// Mock localStorage (browser API not available in Node.js - infrastructure mock)
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] || null,
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// Mock URL.createObjectURL (browser API not available in Node.js - infrastructure mock)
(globalThis as typeof globalThis & { URL: typeof URL }).URL.createObjectURL = vi.fn(() => "blob:mock-url");
(globalThis as typeof globalThis & { URL: typeof URL }).URL.revokeObjectURL = vi.fn();

// Mock IntersectionObserver (browser API not available in Node.js - infrastructure mock)
const IntersectionObserverMock = vi.fn(() => ({
  disconnect: vi.fn(),
  observe: vi.fn(),
  takeRecords: vi.fn(),
  unobserve: vi.fn(),
}));

vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);

// Mock ResizeObserver (browser API not available in Node.js - infrastructure mock)
const ResizeObserverMock = vi.fn(() => ({
  disconnect: vi.fn(),
  observe: vi.fn(),
  unobserve: vi.fn(),
}));

vi.stubGlobal('ResizeObserver', ResizeObserverMock);

// Mock window.matchMedia (browser API - infrastructure mock)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

afterEach(() => {
  cleanup();
  localStorageMock.clear();
});
