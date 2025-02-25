import { useState } from 'react';
import { FrontChatMessage } from '../../types/chat';
import { User } from '../../types/users';
import { ChatActionTypes } from '../../reducers/chatReducers';
import { saveConversationHistory } from '../../utils/localStorageHelpers';

export const useMessageHandler = (
  chatInstanceId: string,
  user: User,
  dispatch: Function,
  chatTitle: string,
  setChatTitle: (title: string) => void,
  messages: FrontChatMessage[],
) => {
  const [error, setError] = useState<string | null>(null);

  const addMessage = (message: Partial<FrontChatMessage> & { text: string }) => {
    if (!chatInstanceId) return;
    const newMessage: FrontChatMessage = {
      id: message.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      text: message.text,
      isSent: true,
      chatInstanceId,
      created_at: message.created_at || new Date().toISOString(),
      updated_at: message.updated_at || new Date().toISOString(),
      user: message.user || {
        id: user.id ?? '',
        email: user.email ?? '',
        name: user.name ?? '',
        image: user.image ?? '',
      },
    };
  
    if (chatTitle === '💬') {
      setChatTitle(
        newMessage.text.slice(0, 50) +
          (newMessage.text.length > 50 ? '...' : '')
      );
    }
  
    dispatch({
      type: ChatActionTypes.ADD_MESSAGE,
      payload: { message: newMessage, chatInstanceId, userEmail: user.email },
    });
  
    const updatedMessages = [...messages, newMessage];
    saveConversationHistory(chatInstanceId, chatTitle || '', updatedMessages);
  };

  return { addMessage, error, setError };
}; 