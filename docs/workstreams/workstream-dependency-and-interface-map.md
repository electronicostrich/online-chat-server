# Workstream Dependency and Interface Map

## Purpose

This document makes workstream seams explicit. It identifies which workstreams own which interfaces, what must be frozen before parallel work begins, and where the highest integration risk lives.

## Interface ownership table

| Interface / Contract | Primary Owner | Consumers | Freeze Priority | Notes |
|---|---|---|---|---|
| API error envelope | WS-01 | All | High | Must be consistent across backend features |
| DB migration conventions | WS-01 | All backend streams | High | Prevent naming and migration collisions |
| Session cookie + CSRF contract | WS-02 | WS-05, WS-07 | High | Shared by HTTP and websocket auth |
| Authorization helper contract | WS-02 + WS-03 | WS-04, WS-06, WS-07 | High | Should not be reimplemented ad hoc |
| Room/member/admin/ban domain rules | WS-03 | WS-04, WS-05, WS-06, WS-07 | High | Central to permissions matrix |
| Friendship/block/DM eligibility rules | WS-03 | WS-04, WS-07 | High | Needed before DM send/create logic |
| Message payload schema | WS-04 | WS-05, WS-07 | High | Includes IDs, reply ref, author, timestamps |
| Chat sequence/watermark contract | WS-04 | WS-05, WS-07, WS-08 | Critical | Needed for sync correctness |
| Read-state contract | WS-04 | WS-05, WS-07 | High | Must define clear-on-open semantics |
| Websocket event envelope | WS-05 | WS-07, WS-08 | High | Event ID, type, actor, sequence, timestamp |
| Presence heartbeat + status rules | WS-05 | WS-07, WS-08 | High | Multi-tab aggregation needs consistency |
| Attachment metadata schema | WS-06 | WS-04, WS-07 | Medium | Includes display filename and storage key |
| Seed data model | WS-08 | All | Medium | Should mirror stable core entities |
| E2E flow ownership map | WS-08 | All | Medium | Prevents test gaps |

## Highest-risk interface seams

## 1. Message persistence <-> websocket delivery
Owner pair:
- WS-04
- WS-05

Why risky:
- If message schema, sequence allocation, and event delivery timing are not aligned, clients will see duplicates, missing messages, or inconsistent unread state.

What must be frozen early:
- when sequence is assigned
- persist-before-publish rule
- event payload shape
- gap-detection behavior
- reconnect recovery contract

## 2. Session validity <-> websocket lifecycle
Owner pair:
- WS-02
- WS-05

Why risky:
- If HTTP auth and websocket auth diverge, revoked sessions may stay live or valid users may get dropped incorrectly.

What must be frozen early:
- websocket auth handshake mechanism
- revoked-session behavior
- heartbeat expectations
- stale socket policy

## 3. Membership/ban state <-> attachment authorization
Owner pair:
- WS-03
- WS-06

Why risky:
- If file access is checked differently than room access, former members may retain downloads they should not have.

What must be frozen early:
- current-membership authorization rule
- room-ban behavior
- room deletion cleanup behavior

## 4. Read-state contract <-> frontend chat-open behavior
Owner pair:
- WS-04
- WS-07
n- WS-05

Why risky:
- If the frontend clears unread too early or without server acknowledgment, multi-tab unread state will drift.

What must be frozen early:
- when open-chat may advance read state
- whether sync-to-head is required before clear
- websocket readstate update payload

## Dependency graph by workstream

## WS-01 Platform and Runtime Foundations
Depends on: none

Unblocks:
- WS-02
- WS-03
- WS-04
- WS-05
- WS-06
- WS-07
- WS-08

## WS-02 Identity, Sessions, and Security
Depends on:
- WS-01

Unblocks:
- WS-05 websocket auth and revocation
- WS-07 authenticated frontend flows
- all secure backend feature streams

## WS-03 Core Chat Domain
Depends on:
- WS-01
- WS-02

Unblocks:
- WS-04 message authorization
- WS-05 invitation/membership/ban events
- WS-06 file authorization
- WS-07 room/contact/moderation screens

## WS-04 Messaging and Durable History
Depends on:
- WS-01
- WS-02
- WS-03 for authorization and chat eligibility

Unblocks:
- WS-05 realtime event fan-out
- WS-07 chat rendering and unread flows
- WS-08 continuity/regression tests

## WS-05 Realtime Gateway, Presence, and Synchronization
Depends on:
- WS-01
- WS-02
- WS-03
- WS-04

Unblocks:
- WS-07 live UX
- WS-08 reconnect/presence test coverage

## WS-06 Attachments and File Access
Depends on:
- WS-01
- WS-02
- WS-03
- WS-04

Unblocks:
- WS-07 attachment UX
- WS-08 attachment authorization tests

## WS-07 Frontend Experience and Moderation UI
Depends on:
- WS-01
- WS-02
- WS-03
- WS-04
- WS-05 for live updates
- WS-06 for attachments

## WS-08 Integration, Seed Data, Observability, and Hardening
Depends on:
- WS-01 immediately
- all others progressively

## Merge-order recommendations

1. Merge WS-01 skeleton first.
2. Merge WS-02 auth/session foundation next.
3. Merge stable schema/domain primitives from WS-03.
4. Merge WS-04 message/history contract before deep websocket work.
5. Merge WS-05 event fan-out and presence after message contract is stable.
6. Merge WS-06 once membership authorization is stable.
7. Merge WS-07 continuously behind feature flags or staged screens.
8. Merge WS-08 tests and hardening continuously, but do not let it lag until the end.

## Required contract review points

Run explicit review checkpoints at these moments:

### Review Point 1
After WS-01 + WS-02:
- auth/session conventions
- error envelope
- migration conventions
- configuration model

### Review Point 2
After WS-03 + WS-04 API drafts:
- room/relationship rules
- DM eligibility
- message schema
- sequence/watermark semantics
- read-state contract

### Review Point 3
Before WS-05 broad implementation:
- websocket event envelope
- publish-after-commit rule
- reconnect contract
- stale socket / heartbeat policy

### Review Point 4
Before WS-07 integration push:
- API examples finalized
- moderation permission behavior
- unread clearing semantics
- attachment metadata shape

## Workstream-specific test ownership

| Flow | Primary Test Owner | Supporting Streams |
|---|---|---|
| register/login/logout/current-session | WS-02 | WS-07 |
| revoke another session and drop live socket | WS-08 | WS-02, WS-05 |
| create/join/leave room | WS-03 | WS-07 |
| remove member -> banned behavior | WS-03 | WS-07, WS-08 |
| friend request -> accept -> DM eligibility | WS-03 | WS-07 |
| send message -> unread update -> websocket delivery | WS-08 | WS-04, WS-05, WS-07 |
| reconnect after missing messages -> gap repair | WS-08 | WS-04, WS-05, WS-07 |
| upload file -> remove from room -> lose download access | WS-08 | WS-03, WS-06, WS-07 |
| multi-tab activity -> online/AFK/offline transitions | WS-08 | WS-05, WS-07 |

## Minimum workstream kickoff checklist

Before parallel execution begins, ensure these are written down:
- canonical API base paths
- event envelope example
- message object example
- room membership and role payload example
- auth cookie and CSRF rules
- migration naming convention
- seed-user and seed-room fixtures
- ownership for each integration test above
