import { create } from 'zustand';
import type { Attachment } from '@my-pi-harness/protocol';

interface AttachmentDrafts {
  drafts: Readonly<Record<string, Attachment[]>>;
  busy: Readonly<Record<string, boolean>>;
  setBusy: (key: string, busy: boolean) => void;
  add: (key: string, attachment: Attachment) => void;
  remove: (key: string, id: string) => void;
  clear: (key: string) => void;
  reset: () => void;
}

export const EMPTY_ATTACHMENTS: Attachment[] = [];

/** Stores metadata for unsubmitted drafts; encoded bytes never enter this Store. */
export const useAttachmentDrafts = create<AttachmentDrafts>((set) => {
  return {
    reset: (): void => {
      set({ drafts: {}, busy: {} });
    },
    drafts: {},
    busy: {},
    setBusy: (key, busy): void => {
      set((state): Partial<AttachmentDrafts> => {
        return { busy: { ...state.busy, [key]: busy } };
      });
    },
    add: (key, attachment): void => {
      set((state): Partial<AttachmentDrafts> => {
        const current = state.drafts[key] ?? EMPTY_ATTACHMENTS;
        if (
          current.length >= 8 ||
          current.some((entry): boolean => {
            return entry.id === attachment.id;
          })
        ) {
          return {};
        }
        return { drafts: { ...state.drafts, [key]: [...current, attachment] } };
      });
    },
    remove: (key, id): void => {
      set((state): Partial<AttachmentDrafts> => {
        return {
          drafts: {
            ...state.drafts,
            [key]: (state.drafts[key] ?? EMPTY_ATTACHMENTS).filter((entry): boolean => {
              return entry.id !== id;
            }),
          },
        };
      });
    },
    clear: (key): void => {
      set((state): Partial<AttachmentDrafts> => {
        const drafts = { ...state.drafts };
        delete drafts[key];
        return { drafts };
      });
    },
  };
});
