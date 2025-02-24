import { useEffect, useState } from 'react';

interface UseChatInstanceProps {
  chatModelId: string;   
  lang: string;          
  config?: {
    apiUrl?: string;     
    apiToken?: string;
  };
  user?: {
    token?: string;
  };
}

export const useChatInstance = ({
  chatModelId,
  lang,
  config,
  user,
}: UseChatInstanceProps) => {
  const {
    apiUrl = 'https://aismarttalk.tech',
    apiToken = '',
  } = config || {};

  const [chatInstanceId, setChatInstanceId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const initializeChatInstance = async () => {
    try {
      console.log('Initializing chat instance with:', {
        chatModelId,
        lang,
        userToken: user?.token ? 'present' : 'absent',
      });

      
      const savedInstance = localStorage.getItem(`chatInstanceId[${chatModelId}]`);
      if (savedInstance && savedInstance.length > 0) {
        console.log('Found saved chat instance:', savedInstance);
        setChatInstanceId(savedInstance);
      } else {
        console.log('No saved chat instance found, creating new one');
        await getNewInstance(lang);
      }
    } catch (err) {
      console.error('Error initializing chat instance:', {
        error: err instanceof Error ? err.message : 'Unknown error',
        stack: err instanceof Error ? err.stack : undefined,
      });
      setError(err instanceof Error ? err : new Error('Unknown error'));
      
      await getNewInstance(lang);
    }
  };

  const getNewInstance = async (newLang: string) => {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'appToken': apiToken,
      };

      if (user?.token) {
        headers['x-use-chatbot-auth'] = 'true';
        headers['Authorization'] = `Bearer ${user.token}`;
      }

      const response = await fetch(`${apiUrl}/api/chat/createInstance`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ chatModelId, lang: newLang }),
      });

      console.log('Create instance response status:', response.status);

      if (!response.status || response.status < 200 || response.status >= 300) {
        const errorText = await response.text();
        throw new Error(`Failed to create chat instance: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('Created new chat instance:', data.chatInstanceId);

      try {
        localStorage.setItem(`chatInstanceId[${chatModelId}]`, data.chatInstanceId);
        console.log('Saved chat instance to localStorage');
      } catch (storageError) {
        console.error('Error saving to localStorage:', {
          error: storageError instanceof Error ? storageError.message : 'Unknown storage error',
        });
      }

      setChatInstanceId(data.chatInstanceId);
      setError(null);
    } catch (err) {
      const errorDetails = {
        message: err instanceof Error ? err.message : 'Unknown error',
        stack: err instanceof Error ? err.stack : undefined,
        type: err instanceof Error ? err.constructor.name : typeof err,
      };
      console.error('Error in getNewInstance:', errorDetails);
      setError(err instanceof Error ? err : new Error('Failed to create chat instance'));
      throw err;
    }
  };

  
  const resetInstance = () => {
    try {
      localStorage.removeItem(`chatInstanceId[${chatModelId}]`);
      console.log('Removed chat instance from localStorage');
    } catch (err) {
      console.error('Error removing from localStorage:', {
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
    setChatInstanceId(null);
    setError(null);
  };

  useEffect(() => {
    initializeChatInstance();
    
  }, [chatModelId, lang, user, apiUrl, apiToken]);

  return { chatInstanceId, getNewInstance, resetInstance, setChatInstanceId, error };
};

export default useChatInstance;
