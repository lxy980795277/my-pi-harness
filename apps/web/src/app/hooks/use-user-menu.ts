import { useCallback, useRef, useState } from 'react';
import type { UserMenuState } from '@/app/types/application';
import type { Action } from '@/types/events';

/** Dialogs inherit the persistent card as their opener; only confirmation invokes sign-out. */
export const useUserMenu = (onSettings: Action, onLogout: Action): UserMenuState => {
  const [open, setOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const dialogOwnsFocus = useRef(false);
  const changeOpen = useCallback((next: boolean): void => {
    if (next) {
      dialogOwnsFocus.current = false;
    }
    setOpen(next);
  }, []);
  const settings = useCallback((): void => {
    dialogOwnsFocus.current = true;
    setOpen(false);
    trigger.current?.focus();
    onSettings();
  }, [onSettings]);
  const logout = useCallback((): void => {
    dialogOwnsFocus.current = true;
    setOpen(false);
    trigger.current?.focus();
    setLogoutOpen(true);
  }, []);
  const changeLogoutOpen = useCallback((next: boolean): void => {
    setLogoutOpen(next);
  }, []);
  const confirmLogout = useCallback((): void => {
    setLogoutOpen(false);
    setOpen(false);
    onLogout();
  }, [onLogout]);
  const closeFocus = useCallback((event: Event): void => {
    event.preventDefault();
    if (dialogOwnsFocus.current) {
      dialogOwnsFocus.current = false;
      return;
    }
    trigger.current?.focus();
  }, []);
  return {
    open,
    trigger,
    changeOpen,
    settings,
    logout,
    logoutOpen,
    changeLogoutOpen,
    confirmLogout,
    closeFocus,
  };
};
