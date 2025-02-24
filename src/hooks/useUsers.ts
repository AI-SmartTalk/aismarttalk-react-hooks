import { useState, useEffect } from "react";
import { User } from "../types/users";

const initialUser: User = {
  id: 'anonymous',  // ID constant pour l'utilisateur anonyme
  email: 'anonymous@example.com',
  name: 'Anonymous',
};

const isTokenValid = (user: User): boolean => {
  if (!user.token) return false;
  try {
    const payload = JSON.parse(atob(user.token.split('.')[1]));
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
};

export default function useUser() {
  const [user, setUser] = useState<User>(initialUser);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        const parsedUser = JSON.parse(storedUser);
        if (isTokenValid(parsedUser)) {
          console.log('Loading stored user:', parsedUser);
          setUser(parsedUser);
        } else {
          console.log('Token expired, using new anonymous user');
          localStorage.removeItem('user');
          setUser(initialUser);
        }
      } else {
        console.log('No stored user, using initial:', initialUser);
      }
    }
  }, []);

  const updateUserFromLocalStorage = () => {
    if (typeof window !== 'undefined') {
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        const parsedUser = JSON.parse(storedUser);
        console.log('Updating user from storage:', parsedUser);
        setUser(parsedUser);
      }
    }
  };

  const setUserAndStorage = (newUser: User) => {
    console.log('Setting new user:', newUser);
    const userToStore = {
      ...newUser,
      id: newUser.id || `user-${newUser.email.split('@')[0]}` // Garantir un ID stable
    };
    console.log('Storing user:', userToStore);
    setUser(userToStore);
    if (typeof window !== 'undefined') {
      localStorage.setItem('user', JSON.stringify(userToStore));
    }
  };

  return { user, setUser: setUserAndStorage, updateUserFromLocalStorage, initialUser };
}
