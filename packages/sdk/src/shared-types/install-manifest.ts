export interface InstallManifest {
  toolName: string;
  toolVersion: string | null;
  installedAt: string;
  sourceUrl?: string;
  sourcePath?: string;
  artifactSha256?: string;
  entry: string;
  runtime: 'bun';
  packageName?: string;
  packageVersion?: string;
  installStrategy: 'source+npm' | 'source+npm+bundle';
  sdkVersion?: string;
  sdkIntegrity?: string;
}
