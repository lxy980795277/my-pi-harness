import type { ChangeEvent, SubmitEvent } from 'react';

export type Action = () => void;
export type ValueChange<Value> = (value: Value) => void;
export type InputChange = (event: ChangeEvent<HTMLInputElement>) => void;
export type TextChange = (event: ChangeEvent<HTMLTextAreaElement>) => void;
export type FormSubmit = (event: SubmitEvent<HTMLFormElement>) => void;
