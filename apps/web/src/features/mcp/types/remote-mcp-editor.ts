import type { InputChange, TextChange, ValueChange, FormSubmit, Action } from '@/types/events';
import type { SelectOption } from '@/components/ui/select-field';
import type {
  RemoteMcpDraft,
  RemoteMcpEditorMode,
  RemoteMcpHeaderDraft,
} from '@/features/mcp/types/remote-mcp';

export type RemoteMcpHeaderInputType = 'text' | 'password';
export type RemoteMcpHeaderField = 'name' | 'value';

export interface RemoteMcpHeaderRow extends RemoteMcpHeaderDraft {
  inputType: RemoteMcpHeaderInputType;
  placeholder: string;
  changeName: InputChange;
  changeValue: InputChange;
  remove: Action;
}

export interface RemoteMcpEditorState {
  title: string;
  mode: RemoteMcpEditorMode;
  draft: RemoteMcpDraft;
  encoded: string;
  headerRows: RemoteMcpHeaderRow[];
  changeMode: ValueChange<string>;
  changeField: InputChange;
  changeTransport: ValueChange<string>;
  changeEncoded: TextChange;
  addHeader: Action;
  changeOAuth: ValueChange<boolean>;
  connectionId: string;
  connectionOptions: SelectOption[];
  changeConnection: ValueChange<string>;
  changeOpen: ValueChange<boolean>;
  submit: FormSubmit;
  test: Action;
  pending: boolean;
  saving: boolean;
  testing: boolean;
  error: string | null;
  testSummary: string | null;
  notice: string | null;
}
