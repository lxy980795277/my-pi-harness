import type { ComponentProps, MouseEvent, ReactNode } from 'react';
import type { ExtraProps } from 'streamdown';

export interface MarkdownProps {
  text: string;
  streaming?: boolean;
  className?: string;
}

export interface MarkdownCodeData {
  code: string;
  language: string;
}

export type MarkdownTokenKind = 'plain' | 'comment' | 'keyword' | 'string' | 'number' | 'function';

export interface MarkdownToken {
  content: string;
  className: string;
  key: number;
}

export interface MarkdownCodeLine {
  tokens: MarkdownToken[];
  key: number;
  ending: string;
}

export interface MarkdownCodeElementProps {
  children?: ReactNode;
  className?: string;
}

export interface MarkdownLinkState {
  url: string | undefined;
  handleClick: (event: MouseEvent<HTMLAnchorElement>) => void;
  error: string | null;
}

export type MarkdownPreProps = ComponentProps<'pre'> & ExtraProps;
export type MarkdownLinkProps = ComponentProps<'a'> & ExtraProps;
export type MarkdownImageProps = ComponentProps<'img'> & ExtraProps;
export type MarkdownTableProps = ComponentProps<'table'> & ExtraProps;
export type MarkdownCellProps = ComponentProps<'td'> & ExtraProps;
export type MarkdownHeaderCellProps = ComponentProps<'th'> & ExtraProps;
