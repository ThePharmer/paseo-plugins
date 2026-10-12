# paseo-plugins

Paseo plugins by ThePharmer.

| Plugin                          | What it does                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------- |
| [file-explorer](file-explorer/) | Browse folders you allow in the plugin's settings, outside the current workspace |

Install one from Git:

```bash
paseo plugin install git:ThePharmer/paseo-plugins:file-explorer
```

## file-explorer

A read-only file explorer for folders you list in **Settings → Plugins → file-explorer → Allowed folders**. It mirrors Paseo's core Files pane: the same tree, sort order, hidden-file toggle, Material file icons, and highlighted source view.

Where it shows up:

- **Explorer dock:** a **Folders** tab next to Files and Changes (Command Center: "Open allowed folders in Explorer").
- **Sidebar:** **Allowed folders** opens a full-screen tree that works without a workspace, which suits phones.
- **File tabs:** every file you open from the dock gets its own workspace tab named after the file.

The daemon refuses any folder that is not in the list, any path that climbs out of an allowed folder, and symlinks that resolve outside it. Anyone using a device paired with the host can read every file inside the allowed folders.

Known limits:

- Read-only. Create, rename, duplicate, delete, upload, editing, and live updates are planned.
- Markdown shows as highlighted source; there is no rendered preview yet.
- On iOS and Android, Download opens the share sheet through the Paseo app's own Expo modules, and file tabs are restored after an app restart through the app's SQLite module. Neither is a documented plugin API, so a Paseo app update can turn them off. The plugin detects that and falls back: no native download on Android, the plain share sheet on iOS, and file tabs that need reopening after a restart.
- The client bundle is about 1.9 MB, mostly syntax-highlighting grammars.

## Releasing

Each plugin is versioned and released on its own.

1. Bump the version inside the plugin, which updates both package.json and package-lock.json:

   ```bash
   cd file-explorer && npm version minor --no-git-tag-version
   ```

2. Add a `## X.Y.Z - YYYY-MM-DD` entry at the top of the plugin's CHANGELOG.md (below `## Unreleased`, if there is one).
3. Merge to main. The Release workflow tags `<plugin>/vX.Y.Z` and publishes a GitHub Release with that entry as its notes.

CI fails a pull request that changes a CHANGELOG.md without bumping the version. Notes for a later release can go under `## Unreleased` without a bump. `npm run release:check` runs the same check locally, and `npm run release:dry-run` shows what would be released.

To install a specific release:

```bash
paseo plugin install git:ThePharmer/paseo-plugins:file-explorer --ref file-explorer/v0.1.0
```

`--ref` only applies to the first install. `paseo plugin update` follows `main`, so main always has to be releasable.

## License

Apache 2.0. See [LICENSE](LICENSE). Files copied from [getpaseo/paseo](https://github.com/getpaseo/paseo) keep their original notices and name the upstream commit they came from. Third-party notices are in [file-explorer/THIRD_PARTY_NOTICES.md](file-explorer/THIRD_PARTY_NOTICES.md).
