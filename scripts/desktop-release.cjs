/** Selects an explicitly named candidate without requiring build credentials on verification hosts. */
function desktopSigningMode(environment) {
  const mode = environment.MY_PI_HARNESS_DESKTOP_SIGNING ?? 'unsigned';
  if (!['unsigned', 'signed'].includes(mode)) {
    throw new Error('MY_PI_HARNESS_DESKTOP_SIGNING must be unsigned or signed');
  }
  return { mode, signed: mode === 'signed' };
}

/** Validates certificate-backed build settings without exposing credentials. */
function desktopReleaseOptions(environment, platform) {
  const { mode, signed } = desktopSigningMode(environment);
  if (signed && !['darwin', 'win32'].includes(platform)) {
    throw new Error('Signed desktop releases require a macOS or Windows build host');
  }
  if (signed && platform === 'darwin') {
    if (environment.CSC_NAME?.trim() === '-') {
      throw new Error('Ad-hoc identity cannot be used for a signed macOS release');
    }
    if (!environment.CSC_NAME && !(environment.CSC_LINK && environment.CSC_KEY_PASSWORD)) {
      throw new Error('Signed macOS release requires CSC_NAME or CSC_LINK and CSC_KEY_PASSWORD');
    }
    // Match electron-builder v26 credential precedence; partial earlier groups must not mask later ones.
    if (environment.APPLE_ID || environment.APPLE_APP_SPECIFIC_PASSWORD) {
      requireGroup(environment, ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']);
    } else if (
      environment.APPLE_API_KEY ||
      environment.APPLE_API_KEY_ID ||
      environment.APPLE_API_ISSUER
    ) {
      requireGroup(environment, ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']);
    } else if (!environment.APPLE_KEYCHAIN_PROFILE) {
      throw new Error('Signed macOS release requires complete Apple notarization credentials');
    }
  }
  if (signed && platform === 'win32') {
    if (
      !(environment.WIN_CSC_LINK ?? environment.CSC_LINK) ||
      !(environment.WIN_CSC_KEY_PASSWORD ?? environment.CSC_KEY_PASSWORD)
    ) {
      throw new Error(
        'Signed Windows release requires WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD (or CSC equivalents)',
      );
    }
  }
  return {
    mode,
    signed,
    mac: {
      identity: signed ? environment.CSC_NAME : null,
      hardenedRuntime: signed,
      notarize: signed,
      binaries: ['Contents/Resources/node/node'],
    },
    win: { signExecutable: signed, signExts: ['.exe', '.dll', '.node'] },
  };
}

function requireGroup(environment, names) {
  if (names.some((name) => !environment[name])) {
    throw new Error(`Signed macOS release requires ${names.join(', ')}`);
  }
}

/** Native SQLite and the bundled Node runtime must be built on their actual target host and architecture. */
function desktopBuildArguments(arguments_, platform, architecture) {
  if (arguments_.length !== 1 || !['dir', 'installer'].includes(arguments_[0])) {
    throw new Error(
      'Usage: package-desktop.mjs dir|installer (current host and architecture only)',
    );
  }
  if (!['arm64', 'x64'].includes(architecture)) throw new Error('Unsupported desktop architecture');
  const target = arguments_[0];
  if (target === 'installer' && !['darwin', 'win32'].includes(platform)) {
    throw new Error('Desktop installers currently support macOS DMG and Windows NSIS only');
  }
  const platformOption = { darwin: '--mac', win32: '--win', linux: '--linux' }[platform];
  if (platformOption === undefined) throw new Error('Unsupported desktop build host');
  return [
    '--config',
    'electron-builder.config.cjs',
    platformOption,
    target === 'dir' ? 'dir' : platform === 'darwin' ? 'dmg' : 'nsis',
    `--${architecture}`,
    '--publish',
    'never',
  ];
}

module.exports = { desktopSigningMode, desktopReleaseOptions, desktopBuildArguments };
