import { describe, expect, it } from 'vitest';
import { isAllowedProcessEnvironmentName } from '../src/index.js';

describe('explicit process environment names', () => {
  it.each(['API_TOKEN', 'PUBLIC_MODE', 'FIXTURE_DIRECTORY', '_PRIVATE2', 'NODE', 'GITHUB_TOKEN'])(
    'allows ordinary explicit environment key %s',
    (name) => {
      expect(isAllowedProcessEnvironmentName(name)).toBe(true);
    },
  );

  it.each([
    '',
    '1TOKEN',
    'API-TOKEN',
    'API\0TOKEN',
    'Path',
    'NODE_TLS_REJECT_UNAUTHORIZED',
    'GIT_CONFIG_COUNT',
    'RUBYLIB',
    'PYTHONSTARTUP',
    'PERL5LIB',
    'dyld_custom_library',
    'lD_custom_library',
  ])('rejects invalid syntax or launch-control key %s', (name) => {
    expect(isAllowedProcessEnvironmentName(name)).toBe(false);
  });
});
