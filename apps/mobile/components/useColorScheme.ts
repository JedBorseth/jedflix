import { useColorScheme as useColorSchemeCore } from 'react-native';

export type ColorScheme = 'light' | 'dark';

export const useColorScheme = (): ColorScheme => {
  const coreScheme = useColorSchemeCore();
  return coreScheme === 'dark' ? 'dark' : 'light';
};
