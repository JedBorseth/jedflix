import { Link, type Href } from 'expo-router';
import * as Linking from 'expo-linking';
import type { ComponentProps } from 'react';
import { Platform } from 'react-native';

export function ExternalLink(props: Omit<ComponentProps<typeof Link>, 'href'> & { href: string }) {
  return (
    <Link
      target="_blank"
      {...props}
      href={props.href as Href}
      onPress={(e) => {
        if (Platform.OS !== 'web') {
          // Prevent expo-router from handling the URL, and open the system
          // browser (Safari on iOS) instead of an in-app web view.
          e.preventDefault();
          void Linking.openURL(props.href);
        }
      }}
    />
  );
}
