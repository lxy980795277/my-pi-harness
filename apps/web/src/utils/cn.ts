import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Combines conditional classes and resolves competing Tailwind utilities. */
export const cn = (...inputs: ClassValue[]): string => {
  return twMerge(clsx(inputs));
};
