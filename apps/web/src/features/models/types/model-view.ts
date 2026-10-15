import type {
  ConnectionResult,
  CustomProtocol,
  ModelDefinition,
  NativeProviderInfo,
  ProviderConfig,
} from '@my-pi-harness/protocol';
import type { Dispatch, SetStateAction } from 'react';
import type { SelectOption } from '@/components/ui/select-field';
import type { ModelCatalog } from '@/features/models/hooks/use-model-catalog';
import type { Action, FormSubmit, InputChange, ValueChange } from '@/types/view-events';

export interface ModelSettingsState extends ModelCatalog {
  providerId: string | null;
  provider: ProviderConfig | null;
  modelsProvider: ProviderConfig | null;
  native: NativeProviderInfo | undefined;
  addProvider: Action;
  openProvider: ValueChange<string>;
  openModels: ValueChange<string>;
  closeModels: Action;
  modelsOpenChange: ValueChange<boolean>;
  toggle: (provider: ProviderConfig, enabled: boolean) => void;
  toggling: boolean;
  configuredCount: number;
  availableModelCount: number;
  providerMissing: boolean;
  error: string | null;
}
export interface DefaultModelState {
  options: SelectOption[];
  selectedKey: string;
  thinking: string;
  thinkingOptions: SelectOption[];
  changeModel: ValueChange<string>;
  changeThinking: ValueChange<string>;
  invalid: boolean;
  pending: boolean;
  error: string | null;
}
export interface ProviderCardState {
  subtitle: string;
  configure: Action;
  models: Action;
  toggle: ValueChange<boolean>;
  authDescription: string;
  visibleModels: ModelDefinition[];
  remainingModels: number;
}
export interface ProviderEditorState {
  name: string;
  setName: Dispatch<SetStateAction<string>>;
  baseUrl: string;
  setBaseUrl: Dispatch<SetStateAction<string>>;
  api: CustomProtocol;
  changeApi: ValueChange<string>;
  apiHelp: string;
  requiresApiKey: boolean;
  changeRequiresKey: ValueChange<boolean>;
  key: string;
  setKey: Dispatch<SetStateAction<string>>;
  inputType: 'text' | 'password';
  toggleKey: Action;
  keyVisible: boolean;
  method: 'api_key' | 'oauth';
  changeMethod: ValueChange<string>;
  custom: boolean;
  supportsOAuth: boolean;
  supportsApiKey: boolean;
  flowId: string | null;
  oauthActive: boolean;
  title: string;
  showSave: boolean;
  busy: boolean;
  submit: FormSubmit;
  startAuth: Action;
  removeCredential: Action;
  remove: Action;
  confirmDelete: boolean;
  confirmCredential: boolean;
  setConfirmCredential: Dispatch<SetStateAction<boolean>>;
  openCredentialRemoval: Action;
  setConfirmDelete: Dispatch<SetStateAction<boolean>>;
  openDelete: Action;
  complete: Action;
  partialSaved: boolean;
  error: string | null;
  saveDisabled: boolean;
  credentialPreview: string | undefined;
  storedMethod: 'api_key' | 'oauth' | null;
}
export interface ProviderEditorFields {
  changeName: InputChange;
  changeBaseUrl: InputChange;
  changeKey: InputChange;
  baseUrlPlaceholder: string;
  protocolOptions: SelectOption[];
}
export interface ProviderModelsEditorState {
  models: ModelDefinition[];
  custom: boolean;
  newId: string;
  changeNewId: InputChange;
  add: Action;
  update: ValueChange<ModelDefinition>;
  remove: ValueChange<string>;
  submit: FormSubmit;
  close: Action;
  pending: boolean;
  test: ValueChange<string>;
  testing: boolean;
  persistedIds: Set<string>;
  results: Record<string, ConnectionResult>;
  error: string | null;
}
export interface ModelRowState {
  changeContext: InputChange;
  changeTokens: InputChange;
  changeReasoning: ValueChange<boolean>;
  removeModel: Action;
  testModel: Action;
}
