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
- The client bundle is about 1.8 MB, mostly syntax-highlighting grammars.

## License

Apache 2.0. See [LICENSE](LICENSE). Files copied from [getpaseo/paseo](https://github.com/getpaseo/paseo) keep their original notices and name the upstream commit they came from. Third-party notices are in [file-explorer/THIRD_PARTY_NOTICES.md](file-explorer/THIRD_PARTY_NOTICES.md).
