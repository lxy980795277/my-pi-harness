import { Value } from 'typebox/value';
import { InputRequestSchema, type InputRequest } from '@my-pi-harness/protocol';
import { RuntimeError } from '../errors';
import { resolvedQuoteText } from './search';
import type { RunSearchPort } from './ports';

interface InputReferenceOptions {
  search?: Pick<RunSearchPort, 'resolveQuote'>;
}

type InputReferences = Pick<InputRequest, 'searchQuotes'>;

/** Host-owned input references are checked before acceptance and are never parsed from visible text. */
export class InputReferenceResolver {
  public constructor(private readonly options: InputReferenceOptions) {}

  public validate(sessionId: string, input: InputReferences): void {
    this.references(sessionId, input);
  }

  public text(sessionId: string, input: InputReferences & Pick<InputRequest, 'text'>): string {
    const references = this.references(sessionId, input);
    if (references.length === 0) return input.text;
    const reference = references.join('\n\n');
    const base = input.text.trim() ? input.text : '请结合所选引用回答。';
    const text = base.endsWith(reference) ? base : `${base}\n\n${reference}`;
    if (!Value.Check(InputRequestSchema.properties.text, text))
      throw new RuntimeError('INPUT_TOO_LONG', '引用资料与输入合计过长，请缩短输入后重试。');
    return text;
  }

  private references(sessionId: string, input: InputReferences): string[] {
    const references: string[] = [];
    if (input.searchQuotes?.length) {
      if (!this.options.search)
        throw new RuntimeError('SEARCH_UNAVAILABLE', '当前服务不能解析搜索引用。');
      if (input.searchQuotes.length > 4)
        throw new RuntimeError('SEARCH_QUOTE_LIMIT', '每次输入最多引用4个来源选区。');
      for (const selection of input.searchQuotes)
        references.push(
          resolvedQuoteText(selection, this.options.search.resolveQuote(sessionId, selection)),
        );
    }
    return references;
  }
}
