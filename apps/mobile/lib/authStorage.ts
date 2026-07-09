import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

type TokenStorage = {
  getItem: (key: string) => Promise<string | null | undefined> | string | null | undefined;
  setItem: (key: string, value: string) => Promise<void> | void;
  removeItem: (key: string) => Promise<void> | void;
};

const secureStorage: TokenStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

const webStorage: TokenStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => {
    localStorage.setItem(key, value);
  },
  removeItem: (key) => {
    localStorage.removeItem(key);
  },
};

export const tokenStorage: TokenStorage =
  Platform.OS === "web" ? webStorage : secureStorage;
