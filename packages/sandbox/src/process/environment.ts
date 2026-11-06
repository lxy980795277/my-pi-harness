const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CONTROL_ENVIRONMENT =
  /^(?:PATH|HOME|TMPDIR|TMP|TEMP|SHELL|ENV|BASH_ENV|NODE_.*|LD_.*|DYLD_.*|PYTHON.*|RUBY.*|PERL.*|ZDOTDIR|GIT_.*)$/i;

/**
 * Check explicit process environment names without allowing host launch controls.
 * @param name A public environment key or a secret slot's environment name.
 * @returns Whether the name is syntactically valid and may be supplied by the caller.
 */
export function isAllowedProcessEnvironmentName(name: string): boolean {
  return ENVIRONMENT_NAME.test(name) && !CONTROL_ENVIRONMENT.test(name);
}
