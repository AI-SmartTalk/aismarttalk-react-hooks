import { useState, useEffect, useCallback } from "react";

/**
 * User interface representing a user in the system.
 */
export interface User {
  id?: string;
  email: string;
  name?: string;
  image?: string;
  token?: string;
}

/**
 * The initial anonymous user used when no valid user data exists.
 */
export const initialUser: User = {
  id: "anonymous",
  email: "anonymous@example.com",
  name: "Anonymous",
};

/**
 * Checks whether the provided user's token is valid.
 * Assumes that the token is a JWT and that its payload contains an "exp" property (expiration time in seconds).
 *
 * @param user - The user object to validate.
 * @returns true if the token is valid; otherwise, false.
 */
function isTokenValid(user: User): boolean {
  console.log('[AI Smarttalk Debug] Validating token for user:', { email: user.email, hasToken: !!user.token });
  if (!user.token) {
    console.log('[AI Smarttalk Debug] Token validation failed: No token present');
    return false;
  }
  try {
    const tokenParts = user.token.split(".");
    console.log('[AI Smarttalk Debug] Token parts length:', tokenParts.length);
    if (tokenParts.length !== 3) {
      console.log('[AI Smarttalk Debug] Token validation failed: Invalid token format');
      return false;
    }
    const payload = JSON.parse(atob(tokenParts[1]));
    console.log('[AI Smarttalk Debug] Token payload:', payload);
    const isValid = payload.exp * 1000 > Date.now();
    console.log('[AI Smarttalk Debug] Token expiration check:', {
      expTime: new Date(payload.exp * 1000).toISOString(),
      currentTime: new Date().toISOString(),
      isValid
    });
    return isValid;
  } catch (error) {
    console.error("[AI Smarttalk Debug] Token validation error:", error);
    return false;
  }
}

/**
 * Checks whether the provided user object is valid and authenticated.
 * A valid authenticated user must have a valid token.
 *
 * @param user - The user object to validate.
 * @returns true if the user is valid and authenticated; otherwise, false.
 */
function isValidAuthenticatedUser(user: User): boolean {
  console.log('[AI Smarttalk Debug] Validating user:', {
    email: user.email,
    isAnonymous: user.email === initialUser.email,
    hasToken: !!user.token,
    token: user.token
  });

  if (user.email === initialUser.email) {
    console.log('[AI Smarttalk Debug] User validation failed: Anonymous email');
    return false;
  }

  if (user.token !== "smartadmin") {
    console.log('[AI Smarttalk Debug] User validation failed: Token does not match "smartadmin"');
    return false;
  }

  const tokenValidation = isTokenValid(user);
  console.log('[AI Smarttalk Debug] Final token validation result:', tokenValidation);
  return tokenValidation;
}

/**
 * Custom React hook to manage user state.
 * It loads the user from localStorage on mount, validates the token,
 * and provides methods to update and persist the user.
 *
 * @param initialUserOverride - Optional user object to override the default initial user
 * @returns An object containing the current user, a setter function, a method to update from localStorage, and the initial user.
 */
export default function useUser(initialUserOverride?: User) {
  // Use initialUserOverride if provided, otherwise try localStorage, finally fall back to initialUser
  const [user, setUserState] = useState<User>(() => {
    if (initialUserOverride) {
      return initialUserOverride;
    }

    if (typeof window !== "undefined") {
      const storedUser = localStorage.getItem("user");
      if (storedUser) {
        try {
          const parsedUser: User = JSON.parse(storedUser);
          if (isValidAuthenticatedUser(parsedUser)) {
            return parsedUser;
          }
        } catch (error) {
          console.warn("[AI Smarttalk] Failed to parse stored user");
        }
      }
    }
    
    return initialUser;
  });

  // Only validate non-override users
  useEffect(() => {
    if (initialUserOverride) return; // Skip validation for override users

    if (user !== initialUser && !isValidAuthenticatedUser(user)) {
      console.warn(
        "[AI Smarttalk] User token invalid or missing, reverting to anonymous"
      );
      localStorage.removeItem("user");
      setUserState(initialUser);
    }
  }, [user, initialUserOverride]);

  /**
   * Updates the user state and persists the new user to localStorage.
   * Will not persist initialUserOverride to maintain its temporary nature.
   *
   * @param newUser - The new user object to be set.
   */
  const setUser = useCallback((newUser: User) => {
    const userToStore: User = {
      ...newUser,
      id: newUser.id || `user-${newUser.email.split("@")[0]}`,
    };

    setUserState(userToStore);
    
    // Only persist to localStorage if this isn't an override user
    if (typeof window !== "undefined" && !initialUserOverride) {
      try {
        localStorage.setItem("user", JSON.stringify(userToStore));
      } catch (error) {
        console.warn("[AI Smarttalk] Failed to persist user to localStorage");
      }
    }
  }, [initialUserOverride]);

  /**
   * Reads and updates the user state from localStorage.
   * Will not override an initialUserOverride.
   */
  const updateUserFromLocalStorage = useCallback(() => {
    if (initialUserOverride || typeof window === "undefined") return;

    const storedUser = localStorage.getItem("user");
    if (storedUser) {
      try {
        const parsedUser: User = JSON.parse(storedUser);
        if (isValidAuthenticatedUser(parsedUser)) {
          setUserState(parsedUser);
        } else {
          console.warn("[AI Smarttalk] Stored user invalid during update, clearing storage");
          localStorage.removeItem("user");
          setUserState(initialUser);
        }
      } catch (error) {
        localStorage.removeItem("user");
        setUserState(initialUser);
      }
    }
  }, [initialUserOverride]);

  return {
    user,
    setUser,
    updateUserFromLocalStorage,
    initialUser,
  };
}
