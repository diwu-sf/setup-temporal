import os from 'os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as actionsCore from '@actions/core';
import * as toolCache from '@actions/tool-cache';
import { DownloadInfo, getDownloadInfo } from './download-info.js';

export function parseVersion(version: string): string {
  const matchDetails = version.match(/^[v]?(\d+)(?:\.(\d+)(?:\.(\d+))?)?((?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/);
  if (matchDetails) {
    const major = matchDetails[1];
    const minor = matchDetails[2] || '0';
    const patch = matchDetails[3] || '0';
    const suffix = matchDetails[4] || '';
    return `v${major}.${minor}.${patch}${suffix}`;
  }
  if (version === 'latest') {
    return 'latest';
  }
  throw new Error(`Invalid version: '${version}'`);
}

function getCurrentArch(): string {
  const arch = os.arch() as NodeJS.Architecture;
  switch (arch) {
    case 'arm64':
      return 'arm64';
    case 'x64':
      return 'amd64';
    default:
      throw new Error(`Unsupported architecture: '${arch}'`);
  }
}

function getCurrentPlatform(): string {
  const platform = os.platform();
  switch (platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'darwin';
    case 'linux':
      return 'linux';
    default:
      throw new Error(`Unsupported platform: '${platform}'`);
  }
}

export function cacheIdentity(info: DownloadInfo, platform: string, arch: string): string {
  // Resolve latest before keying the cache: its archive URL identifies the actual release.
  const artifact = createHash('sha256').update(info.archiveUrl).update('\0').update(info.fileToExtract).digest('hex');
  return `setup-temporal-v1-${platform}-${arch}-${artifact}`;
}

export async function prepare(): Promise<void> {
  const version = parseVersion(actionsCore.getInput('version'));
  const cacheEnabled = actionsCore.getBooleanInput('cache');
  const platform = getCurrentPlatform();
  const arch = getCurrentArch();
  const info = await getDownloadInfo(version, platform, arch);
  const key = cacheIdentity(info, platform, arch);
  const directory = path.join(os.homedir(), '.cache', 'setup-temporal', key);
  actionsCore.setOutput('cache-enabled', cacheEnabled);
  actionsCore.setOutput('cache-key', key);
  actionsCore.setOutput('directory', directory);
  actionsCore.setOutput('archive-url', info.archiveUrl);
  actionsCore.setOutput('file-to-extract', info.fileToExtract);
}

async function executableExists(binary: string): Promise<boolean> {
  try {
    await fs.access(binary, constants.X_OK);
    return (await fs.stat(binary)).isFile();
  } catch {
    return false;
  }
}

export async function installCli(info: DownloadInfo, directory: string, cacheHit: boolean): Promise<void> {
  const binary = path.join(directory, path.basename(info.fileToExtract));
  if (cacheHit && (await executableExists(binary))) {
    actionsCore.info('Using the restored Temporal CLI');
  } else {
    if (cacheHit) actionsCore.warning('The restored cache has no executable Temporal CLI; downloading it again');
    await fs.rm(directory, { recursive: true, force: true });
    const archive = await toolCache.downloadTool(info.archiveUrl);
    let extracted: string | undefined;
    try {
      extracted = info.archiveUrl.endsWith('.zip')
        ? await toolCache.extractZip(archive)
        : await toolCache.extractTar(archive);
      await fs.mkdir(directory, { recursive: true });
      await fs.copyFile(path.join(extracted, info.fileToExtract), binary);
      if (process.platform !== 'win32') await fs.chmod(binary, 0o755);
    } finally {
      await fs.rm(archive, { force: true });
      if (extracted) await fs.rm(extracted, { recursive: true, force: true });
    }
  }
  actionsCore.addPath(directory);
}

export async function install(): Promise<void> {
  await installCli(
    {
      archiveUrl: actionsCore.getInput('archive-url', { required: true }),
      fileToExtract: actionsCore.getInput('file-to-extract', { required: true }),
    },
    actionsCore.getInput('directory', { required: true }),
    actionsCore.getInput('cache-hit') === 'true',
  );
}
