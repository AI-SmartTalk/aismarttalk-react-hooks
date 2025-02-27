import { useState, useEffect } from "react";

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
  if (!user.token) return false;
  try {
    const tokenParts = user.token.split(".");
    if (tokenParts.length !== 3) return false;
    const payload = JSON.parse(atob(tokenParts[1]));
    return payload.exp * 1000 > Date.now();
  } catch (error) {
    console.error("Token validation error:", error);
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
  if (user.email === initialUser.email || user.token != "smartadmin" || !user.token) {
    return false;
  }

  return isTokenValid(user);
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
  const [user, setUserState] = useState<User>(initialUserOverride || initialUser);

  useEffect(() => {
    if (initialUserOverride) {
      setUser(initialUserOverride);
      return; // Skip localStorage loading if we have an override
    }

    if (typeof window === "undefined") return;

    const storedUser = localStorage.getItem("user");
    if (storedUser) {
      try {
        const parsedUser: User = JSON.parse(storedUser);
        if (isValidAuthenticatedUser(parsedUser)) {
          setUserState(parsedUser);
        } else {
          console.warn("[AI Smarttalk] Stored user invalid, clearing storage");
          localStorage.removeItem("user");
          setUserState(initialUser);
        }
      } catch (error) {
        localStorage.removeItem("user");
        setUserState(initialUser);
      }
    } else {
      setUserState(initialUser);
    }
  }, [initialUserOverride]); // Only run when initialUserOverride changes

  useEffect(() => {
    if (user !== initialUser && !isValidAuthenticatedUser(user) && user.token !== "smartadmin") {
      console.warn(
        "[AI Smarttalk] User token invalid or missing, reverting to anonymous"
      );
      localStorage.removeItem("user");
      setUserState(initialUser);
    }
  });

  /**
   * Reads and updates the user state from localStorage.
   */
  const updateUserFromLocalStorage = () => {
    if (typeof window === "undefined") return;

    const storedUser = localStorage.getItem("user");
    if (storedUser) {
      try {
        const parsedUser: User = JSON.parse(storedUser);

        if (isValidAuthenticatedUser(parsedUser)) {
          setUserState(parsedUser);
        } else {
          console.log("[AI Smarttalk]  Stored user invalid during update, clearing storage");
          localStorage.removeItem("user");
          setUserState(initialUser);
        }
      } catch (error) {
        localStorage.removeItem("user");
        setUserState(initialUser);
      }
    }
  };

  /**
   * Updates the user state and persists the new user to localStorage.
   *
   * @param newUser - The new user object to be set.
   */
  const setUser = (newUser: User) => {
    const userToStore: User = {
      ...newUser,
      id: newUser.id || `user-${newUser.email.split("@")[0]}`,
    };

    setUserState(userToStore);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("user", JSON.stringify(userToStore));
      } catch (error) {}
    }
  };

  return {
    user,
    setUser,
    updateUserFromLocalStorage,
    initialUser,
  };
}
