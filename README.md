# AI Smarttalk react hook

A collection of high-quality, reusable React hooks for integrating [AI Smarttalk](https://aismarttalk.tech)'s [AI Agents](https://aismarttalk.tech) into your react application. This library provides hooks for managing chat messages, user state, and chat instance initialization with robust error handling, token validation, and localStorage persistence.


---

## Features

- **useChatMessages**:  
  Manage chat messages, WebSocket connections, typing notifications, and conversation history with a flexible configuration.

- **useUser**:  
  Handle user state with localStorage persistence, token validation (JWT), and automatic fallback to an anonymous user if needed.

- **useChatInstance**:  
  Initialize or reset a chat instance based on a given chat model and language, using API calls to create new instances when required.

---

## Installation

Install the package via npm or yarn:

```bash
npm install ai-smart-chat-hooks
# or
yarn add ai-smart-chat-hooks
```

> _Note: Replace `ai-smart-chat-hooks` with the actual package name if different._

---

## Getting Started

### Using `useChatMessages`

```tsx
import React from 'react';
import useChatMessages from 'ai-smart-chat-hooks/hooks/useChatMessages';
import { User } from 'ai-smart-chat-hooks/types/users';

const ChatComponent = () => {
  // Example user object
  const user: User = {
    id: 'user123',
    email: 'user@example.com',
    name: 'John Doe',
  };

  // Using the hook with mandatory chatModelId and optional config
  const {
    messages,
    addMessage,
    resetChat,
    socketStatus,
    chatTitle,
    updateChatTitle,
    error,
  } = useChatMessages({
    chatInstanceId: 'instance123',
    isOpen: true,
    user,
    setUser: (updatedUser) => console.log('User updated:', updatedUser),
    chatModelId: 'cm19b7zil0004llwr7xtrbogz', // Mandatory property
    config: {
      apiUrl: 'https://aismarttalk.tech',
      wsUrl: 'wss://ws.223.io.aismarttalk.tech',
      apiToken: 'your-api-token', // Optional
    },
  });

  return (
    <div>
      <h2>{chatTitle}</h2>
      <p>Socket Status: {socketStatus}</p>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <div>
        {messages.map((msg) => (
          <div key={msg.id}>{msg.text}</div>
        ))}
      </div>
      {/* Example of adding a new message */}
      <button onClick={() => addMessage({ text: 'Hello, world!' })}>
        Send Message
      </button>
      <button onClick={resetChat}>Reset Chat</button>
    </div>
  );
};

export default ChatComponent;
```

### Using `useUser`

```tsx
import React from 'react';
import useUser from 'ai-smart-chat-hooks/hooks/useUser';

const UserComponent = () => {
  const { user, setUser, updateUserFromLocalStorage } = useUser();

  return (
    <div>
      <h3>User: {user.name}</h3>
      <p>Email: {user.email}</p>
      <button onClick={() => setUser({ email: 'newuser@example.com' })}>
        Update User
      </button>
      <button onClick={updateUserFromLocalStorage}>
        Refresh User from Storage
      </button>
    </div>
  );
};

export default UserComponent;
```

### Using `useChatInstance`

```tsx
import React from 'react';
import useChatInstance from 'ai-smart-chat-hooks/hooks/useChatInstance';

const ChatInstanceComponent = () => {
  const { chatInstanceId, resetInstance, error } = useChatInstance({
    chatModelId: 'cm19b7zil0004llwr7xtrbogz',
    lang: 'en',
    config: {
      apiUrl: 'https://aismarttalk.tech',
      apiToken: 'your-api-token',
    },
    user: { token: 'user-token' },
  });

  return (
    <div>
      {error && <p style={{ color: 'red' }}>{error.message}</p>}
      <h3>Chat Instance ID: {chatInstanceId}</h3>
      <button onClick={resetInstance}>Reset Chat Instance</button>
    </div>
  );
};

export default ChatInstanceComponent;
```

---

## API Reference

### useChatMessages

**Parameters:**

- **chatInstanceId**: `string`  
  The unique identifier for the current chat session.

- **isOpen**: `boolean`  
  Indicates if the chat is open.

- **user**: `User`  
  The current user object.

- **setUser**: `(user: User) => void`  
  Function to update the user state.

- **chatModelId**: `string`  
  A mandatory property specifying the chat model identifier.

- **config?**:  
  Optional configuration for API URLs and tokens:
  - **apiUrl**: `string` (default: `'https://aismarttalk.tech'`)
  - **wsUrl**: `string` (default: `'wss://ws.223.io.aismarttalk.tech'`)
  - **apiToken**: `string` (optional)

**Returns:** An object containing chat messages, WebSocket status, functions to add messages, reset chat, update title, etc.

---

### useUser

**Returns:**  
An object with:
- **user**: `User`  
- **setUser**: `(user: User) => void`  
- **updateUserFromLocalStorage**: `() => void`  
- **initialUser**: `User`

---

### useChatInstance

**Parameters:**

- **chatModelId**: `string`  
- **lang**: `string`  
- **config?**:  
  Optional configuration:
  - **apiUrl**: `string` (default: `'https://aismarttalk.tech'`)
  - **apiToken**: `string`
- **user?**:  
  Optional user object with a token.

**Returns:**  
An object containing:
- **chatInstanceId**: `string | null`
- **getNewInstance**: `(lang: string) => Promise<void>`
- **resetInstance**: `() => void`
- **setChatInstanceId**: `(id: string | null) => void`
- **error**: `Error | null`

---

---

## License

This project is licensed under the [Apache 2.0 Licence](LICENSE).

---

## Contact

For questions or support, please open an issue on the repository or contact the maintainer.

---

Enjoy integrating chat functionality with AI Smart Chat Hooks!