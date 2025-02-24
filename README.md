# AI Smarttalk react hook

A collection of high-quality, reusable React hooks for integrating [AI Smarttalk](https://aismarttalk.tech)'s [AI Agents](https://aismarttalk.tech) into your react application. This library provides hooks for managing chat messages, user state, and chat instance initialization with robust error handling, token validation, and localStorage persistence.

## What's New in 1.1.0

### Introducing `useAISmarttalkChat`

We're excited to introduce a new consolidated hook that combines the functionality of `useChatMessages`, `useUser`, and `useChatInstance` into a single, more powerful hook. This new hook provides a simpler, more intuitive API while maintaining all the features you love.


#### Key Improvements:
- **Simplified Integration**: One hook instead of three separate ones
- **Better TypeScript Support**: Comprehensive JSDoc documentation and improved type definitions
- **Reduced Boilerplate**: Less code needed to get started
- **Enhanced Performance**: Optimized internal state management
- **More Features**: Access to typing indicators, conversation starters, and active tools

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
npm install @aismarttalk/react-hooks
# or
yarn add @aismarttalk/react-hooks
```

> _Note: Replace `@aismarttalk/react-hooks` with the actual package name if different._

---

## Getting Started

### Using `useAiSmarttalkChat`

```tsx
import { useAISmarttalkChat } from '@aismarttalk/react-hooks';

const ChatComponent = () => {
  const {
    messages,
    addMessage,
    user,
    setUser,
    chatInstanceId,
    resetChat,
    socketStatus,
    error,
    // ... and more
  } = useAISmarttalkChat({
    chatModelId: 'cm19b7zil0004llwr7xtrbogz',
    lang: 'en',
    config: {
      apiUrl: 'https://aismarttalk.tech',
      wsUrl: 'wss://ws.223.io.aismarttalk.tech',
      apiToken: 'your-api-token',
    },
  });

  return (
    // Your chat UI implementation
  );
};
```

### Using `useChatInstance`

```tsx
import React from 'react';
import useChatInstance from '@aismarttalk/react-hooks/hooks/useChatInstance';

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

Enjoy integrating chat functionality with [AI Smarttalk](https://aismarttalk.tech) React Hooks!