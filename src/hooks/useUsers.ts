import { useState, useEffect } from "react";
import { User } from "../types/users";

/**
 * Default user object representing an anonymous user
 */
const initialUser: User = {
  id: "anonymous", // ID constant pour l'utilisateur anonyme
  email: "anonymous@example.com",
  name: "Anonymous",
};

/**
 * Checks whether the provided user's token is valid.
 * Assumes that the token is a JWT and that its payload contains an "exp" property (expiration time in seconds).
 * 
 * @param user - The user object to validate
 * @returns boolean indicating if the token is valid
 */
const isTokenValid = (user: User): boolean => {
  if (!user.token) return false;
  try {
    const payload = JSON.parse(atob(user.token.split(".")[1]));
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
};

/**
 * Custom hook for managing user state and local storage synchronization
 * 
 * @returns Object containing user state and management functions
 * @property {User} user - Current user state
 * @property {(newUser: User) => void} setUser - Function to update user state and storage
 * @property {() => void} updateUserFromLocalStorage - Function to sync user state from storage
 * @property {User} initialUser - Default anonymous user object
 */
export default function useUser() {
  const [user, setUser] = useState<User>(initialUser);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedUser = localStorage.getItem("user");
      if (storedUser) {
        const parsedUser = JSON.parse(storedUser);
        if (isTokenValid(parsedUser)) {
          setUser(parsedUser);
        } else {
          localStorage.removeItem("user");
          setUser(initialUser);
        }
      } else {
      }
    }
  }, []);

  /**
   * Updates the user state from localStorage if available
   */
  const updateUserFromLocalStorage = () => {
    if (typeof window !== "undefined") {
      const storedUser = localStorage.getItem("user");
      if (storedUser) {
        const parsedUser = JSON.parse(storedUser);

        setUser(parsedUser);
      }
    }
  };

  /**
   * Updates both the user state and localStorage with new user data
   * Ensures the user has a stable ID based on email if none provided
   * 
   * @param newUser - New user data to store
   */
  const setUserAndStorage = (newUser: User) => {
    const userToStore = {
      ...newUser,
      id: newUser.id || `user-${newUser.email.split("@")[0]}`, // Garantir un ID stable
    };

    setUser(userToStore);
    if (typeof window !== "undefined") {
      localStorage.setItem("user", JSON.stringify(userToStore));
    }
  };

  return {
    user,
    setUser: setUserAndStorage,
    updateUserFromLocalStorage,
    initialUser,
  };
}
