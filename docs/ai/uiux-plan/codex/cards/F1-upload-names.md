# Card F1: uploaded pictures and videos keep their file names

Read `_review-common.md` in this folder first.

Today an imported picture or video keeps no file name: Assets shows "Imported image 3", and a picture sent to the Director shows as "The Last Ferry · upload". Audio and documents already keep theirs.

1. `POST /images/uploads` and `POST /media/uploads` accept an optional `name` query parameter: 1–120 characters, no control characters and no slashes, the same rule as audio and documents. It is part of the idempotent request identity, so a replay with another name is refused like any changed body.
2. Store it with the import, and use it as the asset label in the asset library (`AssetItem.label`) and as the attachment name in `MessageAttachmentView.name`.
   - Imports without a name keep today's labels.
   - Existing data needs no migration.
3. Web: `uploadPath` in `apps/web/src/next/model/assets-import.ts` sends `name` for images and video too, and the sample film's simulated routes use it as the label. You may edit those two web files, plus their tests.
4. Tests:
   - a named PNG, JPEG and video import show their names in Assets and on a message;
   - an unnamed import keeps the old label;
   - an invalid name is refused;
   - replaying with a different name is refused.
