# Photos

An Astro photo gallery, with a separate local album editor.

## Album editor

Use Node 22.12+ and pnpm. Install dependencies with `pnpm install`, then run:

```sh
pnpm editor
```

Open **http://127.0.0.1:4322** in desktop Chrome. Click **Open project**, select this repository (the folder containing `src`), and allow read/write access. The browser reads and writes local files directly; photos are not uploaded to a server. The editor is excluded from the public gallery build.

- Create albums and edit their title, description, and URL slug.
- Add full-resolution JPEG, PNG, or WebP files using **Add photos** or drag-and-drop. RAW and HEIC files must be exported to a supported format first.
- Select a photo to edit its caption and required alt text. Blank captions use alt text in the gallery viewer.
- Drag albums or photos to reorder them, or use their arrow buttons.
- Click **Save** to write the draft to disk. **Reload** returns to the on-disk version. Drafts are held in memory and are lost when the tab closes or reloads.

Projects open from metadata without scanning or decoding the image library. Visible photos load cached previews at up to 640 pixels, with two image jobs at a time in a background worker. Imports enter the draft immediately after checking the destination folder; originals are validated before saving. Selecting photos keeps the grid layout stable.

New originals are copied byte-for-byte into `src/images/<album-slug>/`; safe filename suffixes prevent collisions. Existing image paths do not change when an album slug changes. Removing a photo or album removes metadata only and leaves image files on disk. Album order and photo order are saved in `src/data/albums.json` using the existing schema.

If another program edits the JSON while a draft is open, saving is blocked. Copy any draft text you want to keep, then reload and reapply your edits. Images are written before metadata, so a failed save can leave unreferenced files; retrying in the same session reuses successfully copied images. File System Access does not provide a multi-file transaction: avoid editing these files simultaneously in another tool. Grant access again if Chrome prompts after permissions change.

## Gallery and checks

```sh
pnpm dev           # Preview the gallery while editing
pnpm build         # Build the public gallery
pnpm editor:build  # Type-check and build the local editor
pnpm editor:test   # Metadata and file-saving tests
```

Astro generates responsive WebP thumbnails from the source images. Full-resolution sources are retained, including their embedded metadata; prepare exports accordingly. Album configuration changes become public only through your usual gallery build/deployment workflow.
