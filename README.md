# Setup Temporal Action

This GitHub Action installs the [Temporal CLI](https://github.com/temporalio/cli) on a GitHub Actions runner.

Maintainers can follow the [release guide](RELEASE.md) to publish a new version.

## Usage

To use this action, add the following step to your GitHub Actions workflow:

```yaml
steps:
  - name: Install Temporal CLI
    uses: temporalio/setup-temporal@v0

  - name: Start a local Temporal server
    shell: bash
    run: temporal server start-dev --headless &
```

By default, the action installs the latest version of the Temporal CLI. You can specify the version of the Temporal CLI to install using the version input:

```yaml
steps:
  - name: Install Temporal CLI
    uses: temporalio/setup-temporal@v0
    with:
      version: v0.12.0
```

## CLI caching

The action restores and saves the CLI with the official `actions/cache/restore`
and `actions/cache/save` actions. These use GitHub's cache service on GitHub
runners and Blacksmith's colocated cache automatically on Blacksmith runners;
no Blacksmith-specific action or configuration is needed.

Cache entries are separated by operating system, architecture, and the resolved
download URL. The action resolves `latest` before constructing the key, so a new
release gets a new cache entry. A cache hit skips the CLI archive download;
the small download-metadata request still runs. Cache service failures do not
prevent installation: the action downloads the CLI when restoration fails.

To disable remote caching:

```yaml
- uses: temporalio/setup-temporal@v0
  with:
    cache: 'false'
```

The `cache-hit` output is `true` when the remote cache restored an exact entry,
and `path` is the directory containing the installed CLI. Caches retain the cache
service's normal branch scoping and eviction behavior.

See the [Blacksmith cache guide](https://docs.blacksmith.sh/blacksmith-caching/dependencies-actions)
for the automatic integration. Self-hosted runners must support Node.js 24
actions and provide the archive tools required by `actions/cache`.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
