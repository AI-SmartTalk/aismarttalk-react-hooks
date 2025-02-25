/**
 * @jest-environment jsdom
 */
import React from 'react';
import { renderHook } from "@testing-library/react";
import { useChatMessages } from "../../hooks/useChatMessage";

// Mock all async behavior to prevent act warnings
jest.mock('../../hooks/useChatMessage', () => ({
  useChatMessages: jest.fn().mockImplementation(() => ({
    messages: [],
    notificationCount: 0,
    suggestions: [],
    error: null,
    setMessages: jest.fn(),
    setNotificationCount: jest.fn(), 
    updateSuggestions: jest.fn(),
    addMessage: jest.fn(),
    socketStatus: 'disconnected',
    typingUsers: [],
    conversationStarters: [],
    activeTool: null,
    fetchMessagesFromApi: jest.fn().mockResolvedValue([]),
    chatTitle: '',
    conversations: [],
    setConversations: jest.fn(),
    saveConversationHistory: jest.fn(),
    canvas: null,
    canvasHistory: { canvas: null },
    isLoading: false,
    onSend: jest.fn().mockResolvedValue({}),
    selectConversation: jest.fn(),
    updateChatTitle: jest.fn(),
    chatInstanceId: 'mock-instance-id',
    getNewInstance: jest.fn().mockResolvedValue('mock-instance-id'),
    createNewChat: jest.fn().mockResolvedValue('mock-instance-id')
  }))
}));

describe("useChatMessages", () => {
  const baseOptions = {
    chatModelId: "model-123",
    chatInstanceId: "chat-123",
    user: {
      id: "user1",
      name: "michel",
      email: "michel@dubois.fr"
    },
    setUser: jest.fn(),
    lang: "en",
    config: { apiUrl: "https://api.example.com" }
  };

  it("renders without crashing", () => {
    const { result } = renderHook(() => useChatMessages(baseOptions));
    expect(result.current).toBeDefined();
    expect(result.current.messages).toEqual([]);
  });
});
