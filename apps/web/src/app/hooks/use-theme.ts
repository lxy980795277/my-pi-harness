import { useCallback, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
}

const readTheme = (): Theme => {
  const preference = localStorage.getItem('my-pi-harness.theme');

  if (preference === 'light' || preference === 'dark') {
    return preference;
  }

  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }

  return 'light';
};

/** Persists the user's theme locally; model and runtime settings remain daemon-owned. */
export const useTheme = (): ThemeState => {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('my-pi-harness.theme', theme);
  }, [theme]);

  const toggleTheme = useCallback((): void => {
    setTheme((current) => {
      if (current === 'light') {
        return 'dark';
      }

      return 'light';
    });
  }, []);

  return { theme, toggleTheme };
};
