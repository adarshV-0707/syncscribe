# Socket.IO Testing

This folder contains manual Socket.IO client scripts used to verify SyncScribe's real-time collaboration flow outside Postman.

## Purpose

These scripts simulate two authenticated users connected to the same document room:

- Owner socket client
- Collaborator socket client

The scripts are executed from the terminal using `socket.io-client`.

## Verified Flow

- JWT-based socket authentication works for owner and collaborator.
- Both users can join the same document room using `join_document`.
- Server emits `active_users` with connected users.
- Owner can trigger a document save using `trigger_save`.
- Owner receives `save_confirmed`.
- Collaborator receives real-time `document_updated` and `version_created` events.
- Socket save creates a new document version in MongoDB.
- Version content is verified through the REST version APIs.

## Verified Result

- Socket.IO testing passed successfully.
- This validates the core real-time collaboration behavior required for the project.

## Required Values

The scripts need these values while running:

| Value | Meaning |
|---|---|
| `SOCKET_URL` | Backend socket server URL, for example `http://localhost:5000` |
| `OWNER_TOKEN` | Access token of the document owner |
| `COLLAB_TOKEN` | Access token of the collaborator |
| `DOCUMENT_ID` | ID of the active document being tested |
| `BASE_VERSION` | Current latest version of the document before saving |

