# Changelog

## 0.1.0 - 2026-10-12

First release. Browse folders outside your workspace from Paseo, limited to the folders you allow in the plugin's settings.

### Added

- Added an Allowed folders settings screen to add a folder by absolute or `~/` path with an optional label, see whether each folder exists, and remove it ([#2](https://github.com/ThePharmer/paseo-plugins/pull/2))
- Added editing a folder's label, with an empty label showing the folder name ([#4](https://github.com/ThePharmer/paseo-plugins/pull/4))
- Added an "Allowed folders" sidebar row that opens a full-screen folder tree ([#2](https://github.com/ThePharmer/paseo-plugins/pull/2))
- Added a Folders tab in the Explorer dock, next to Files and Changes, opened from the Command Center ([#2](https://github.com/ThePharmer/paseo-plugins/pull/2))
- Added a folder tree ported from Paseo's Files pane, with a folder picker, Material file icons, folders listed first, and hidden files shown ([#2](https://github.com/ThePharmer/paseo-plugins/pull/2))
- Added a file viewer with syntax highlighting, image preview, and Refresh, Copy path and Download ([#2](https://github.com/ThePharmer/paseo-plugins/pull/2))
- Added one workspace tab per open file, named after the file, which reopens after the app reloads ([#2](https://github.com/ThePharmer/paseo-plugins/pull/2))
- Added downloads on web and desktop, and through the share sheet on iOS and Android ([#2](https://github.com/ThePharmer/paseo-plugins/pull/2))

### Fixed

- Fixed the plugin failing to load on iOS and Android with "Cannot read property 'prototype' of undefined" ([#3](https://github.com/ThePharmer/paseo-plugins/pull/3))

### Security

- Refused every path outside the allowed folders, including `../` paths and symlinks that lead outside, and refused named pipes and other files that aren't regular files ([#2](https://github.com/ThePharmer/paseo-plugins/pull/2))

### Notes

- Downloads and tab restore on iOS and Android use modules inside the Paseo app that aren't part of the plugin API, and they haven't been tested on a device yet.
