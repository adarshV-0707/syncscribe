# SyncScribe Postman Collection

This folder contains the Postman collection and environment template used to test the SyncScribe REST APIs.

## Files

- `SyncScribe Backend API.postman_collection.json` — Postman collection for REST API requests.
- `SyncScribe Local.postman_environment.example.json` — environment template with required variables.

## Collection Overview

- `Auth` — user registration, login, token refresh, current user, account update, avatar update, logout
- `Documents` — create, fetch, list owned/shared documents, search, update info, soft delete, restore, permanent delete
- `InviteLinks` — create, list, preview, join, revoke invite links
- `Collaborator` — list collaborators, update role, remove collaborator, leave document
- `Versions` — list versions, get version content, contribution summary

## Workflow Notes

- Run owner auth first to generate `ownerAccessToken`, `ownerId`, and `accessToken`.
- Run collaborator auth to generate `collabAccessToken` and `collabUserId`.
- Owner-only routes require `accessToken` to use the owner token.
- Collaborator routes like join/leave require `accessToken` to use the collaborator token.
- Document, invite link, collaborator, and version IDs are saved automatically by collection scripts.
- Avatar upload requests require selecting a local image file manually.
- Real Postman environment exports are not committed because they may contain JWTs, invite tokens, and generated IDs.