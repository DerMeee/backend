# DerMee Backend — How It Works

DerMee is a dermatology platform: patients find a doctor, book an appointment (in person or online through Google Meet), share medical documents, and chat with the doctor. The data model also includes a pharmacy / e-commerce part (products, cart, orders), but that part has no working API yet.

> **Admin release (November 2026):** sections 1–12 describe the platform before the admin back office. Several behaviours changed (doctor approval, reservation states, soft cancel, private medical files, chat delivery). See [§13](#13-admin-system-november-2026) for what is different, and [docs/admin-api.md](docs/admin-api.md) for the admin endpoints.

This document covers:

1. [Tech stack](#1-tech-stack)
2. [Project layout](#2-project-layout)
3. [What happens to a request](#3-what-happens-to-a-request)
4. [Data model](#4-data-model)
5. [Authentication and permissions](#5-authentication-and-permissions)
6. [API modules and endpoints](#6-api-modules-and-endpoints)
7. [Booking logic in detail](#7-booking-logic-in-detail)
8. [Real-time chat](#8-real-time-chat)
9. [File uploads](#9-file-uploads)
10. [Configuration (environment variables)](#10-configuration-environment-variables)
11. [Running locally](#11-running-locally)
12. [Deployment](#12-deployment)
13. [Admin system (November 2026)](#13-admin-system-november-2026)
14. [Migration baseline runbook (one time, production)](#14-migration-baseline-runbook-one-time-production)
15. [Known issues and gaps](#15-known-issues-and-gaps)

---

## 1. Tech stack

| Concern | Choice |
|---|---|
| Framework | NestJS 11 (Express adapter) |
| Language | TypeScript |
| Database | PostgreSQL 14 |
| ORM | Prisma 7, connected through the `@prisma/adapter-pg` driver adapter |
| Auth | Passport: JWT, Google OAuth2, Facebook OAuth |
| Validation | `class-validator` / `class-transformer` through a global `ValidationPipe` |
| Real-time | Socket.IO (`@nestjs/websockets`) |
| Video visits | Google Calendar API (creates an event with a Meet link) |
| Uploads | Multer, stored on local disk under `./uploads` |
| API docs | Swagger at `/api` |
| Security headers | Helmet (CSP turned off so Swagger UI works) |
| Containers | Docker (multi-stage build), Docker Compose |
| CI/CD | GitHub Actions (lint + build), Jenkins (build, push, deploy), Ansible |
| Registry | GitHub Container Registry (`ghcr.io/morsiyoucef-alter/dermeee-api`) |
| Reverse proxy | Nginx on the VPS |

`package.json` also lists TypeORM, `mssql`, `tedious`, `@prisma/adapter-mssql` and `csrf-csrf`. None of them are used: the code only uses Prisma on Postgres, and the CSRF middleware is commented out in `main.ts`.

---

## 2. Project layout

```
backend/
├── src/
│   ├── main.ts                  # Bootstrap: middleware, CORS, Swagger, static files
│   ├── app.module.ts            # Root module, wires all feature modules
│   ├── app.controller.ts        # GET /  and  GET /service-worker.js
│   ├── config/config.ts         # Small config factory (port, secrets)
│   ├── prisma/                  # PrismaService (global), connects with DATABASE_URL
│   ├── auth/                    # Login, signup, refresh, OAuth, guards, decorators
│   ├── appointment/             # Booking, approve / reject / reschedule, listings
│   ├── doctor/                  # Doctor listing, weekly schedule, exceptions, leaves, calendar, export
│   ├── patient/                 # Patient profile and medical document uploads
│   ├── user/                    # Profile picture upload (any role)
│   ├── messages/                # Chat over REST + Socket.IO gateway
│   ├── google/                  # GoogleCalendarService (Meet links)
│   ├── product/                 # Scaffold only, returns placeholder strings
│   ├── middlewares/             # HttpExceptionFilter, LoggingMiddleware
│   └── utils/catch-service-error.ts
├── prisma/
│   ├── schema.prisma            # Data model
│   └── migrations/              # SQL migrations (applied with `prisma migrate deploy`)
├── prisma.config.ts             # Prisma CLI config (schema path, migrations path, DB URL)
├── Dockerfile                   # 3-stage image build
├── docker-entrypoint.sh         # Runs migrations, then starts the app
├── docker-compose.yml           # Local / single-host stack (Postgres + API + frontend)
├── deploy/
│   ├── docker-compose.prod.yml  # Production stack (uses images from the registry)
│   ├── env.server.example       # Template for /opt/dermeee/.env on the VPS
│   └── ansible/                 # Deploy playbook + inventories
├── Jenkinsfile                  # Build → push → deploy pipeline
├── .github/workflows/ci.yml     # Lint, format check, build on push / PR
├── nginx/dermee.conf            # Reverse proxy config for the VPS
├── docker-deploy.sh             # Older manual deploy script (build on the server)
└── ecosystem.config.js          # PM2 config (older non-Docker option)
```

Each feature folder follows the usual Nest shape: `*.module.ts`, `*.controller.ts` (HTTP layer, Swagger annotations), `*.service.ts` (business logic with Prisma), and `dto/` (request/response classes with validation rules).

---

## 3. What happens to a request

```mermaid
flowchart LR
    C[Client] --> N[Nginx]
    N --> H[Helmet + CORS + cookie-parser]
    H --> L[LoggingMiddleware]
    L --> G[Guards<br/>JwtAuthGuard / AuthorizationGuard / PatientRoleGuard]
    G --> V[ValidationPipe<br/>whitelist + forbidNonWhitelisted + transform]
    V --> CT[Controller]
    CT --> S[Service]
    S --> P[(PostgreSQL via Prisma)]
    S -.-> GC[Google Calendar API]
    S -. error .-> F[HttpExceptionFilter]
```

Set up in [main.ts](src/main.ts):

- **Static files**: `./uploads` is served at `/uploads/*`.
- **CORS**: `ALLOWED_ORIGINS` is a comma-separated list. If it is empty or `*`, every origin is allowed. `credentials: true` is always on.
- **Validation**: any field in the body that the DTO does not declare is rejected with a 400. Query strings are converted to their DTO types (for example `page` becomes a number).
- **Swagger**: available at `/api`, with Bearer auth.
- **Port**: `PORT`, default `3000`.

Error handling works in two layers:

1. Every service method wraps its body in `try { … } catch (e) { catchServiceError(e) }`. Nest HTTP errors (400, 403, 404…) are re-thrown as they are. Anything else becomes a 500 `InternalServerErrorException`.
2. The global [HttpExceptionFilter](src/middlewares/http.exception.filter.ts) logs the error and returns:
   ```json
   { "error": true, "responseBody": { "statusCode": 400, "message": "...", "error": "Bad Request" } }
   ```

[LoggingMiddleware](src/middlewares/logging.middleware.ts) logs `METHOD url status duration` for 200 and 201 responses only. Errors are logged by the filter.

---

## 4. Data model

Defined in [prisma/schema.prisma](prisma/schema.prisma). IDs are `cuid()` strings, except `ScheduleException`, which uses `uuid()`.

```mermaid
erDiagram
    User ||--o| Address : has
    User ||--o| Doctor : "doctorProfile"
    User ||--o| Patient : "patientProfile"
    User ||--o{ Message : sends
    User ||--o{ Message : receives
    User ||--o{ Notification : has

    Doctor ||--o{ WorkDay : "weekly schedule"
    Doctor ||--o{ ScheduleException : "date overrides"
    Doctor ||--o{ DoctorLeave : "holidays"
    Doctor ||--o{ Appointment : receives

    Patient ||--o{ Appointment : books
    Patient ||--o{ PatientDocument : uploads
    Patient ||--o| Cart : has
    Patient ||--o{ Order : places
    Patient ||--o{ Wishlist : has

    Appointment ||--o| AppointmentReport : has
    Cart ||--o{ CartItem : contains
    Order ||--o{ OrderItem : contains
    Product ||--o{ CartItem : ""
    Product ||--o{ OrderItem : ""
    Product ||--o{ Wishlist : ""
```

### Identity: one `User`, one role profile

- `User` holds the login data: email, `passwordHash` (null for social-only accounts), `googleId`, `facebookId`, `role` (`PATIENT` | `DOCTOR` | `ADMIN`), and `profilePictureUrl`.
- Each user also has **one** role profile: a `Doctor` row (fees, years of experience, about) or a `Patient` row.
- **Two different IDs exist for the same person, and mixing them up is the most common source of confusion:**
  - `User.id` is what the JWT carries (`userId`), and what most endpoints take as input (for example `doctorUserId` when booking, and `:id` in `/doctor/:id`).
  - `Doctor.id` and `Patient.id` are what `Appointment`, `WorkDay` and the other tables actually reference. Services convert between them with `findUnique({ where: { userId } })`.

### Scheduling

| Model | Meaning |
|---|---|
| `WorkDay` | The doctor's normal weekly hours. At most one per weekday (`@@unique([doctorId, day])`). `startTime` and `endTime` are full `DateTime` values, but only the hour and minute matter. |
| `ScheduleException` | An override for one specific date (`@@unique([doctorId, date])`). `CANCELLED` means the doctor is off that day. `ADDED` or `CHANGED` means different hours (`start`/`end` stored as `"HH:mm"` strings). |
| `DoctorLeave` | A holiday or leave over a date range (`startDate` → `endDate`). The API calls these "holidays". |

The schema comments explain the design: the weekly schedule stays small (7 rows at most), and one-off changes live in their own table so they do not alter the base schedule and keep history.

### Appointments

`Appointment` has `doctorId`, `patientId`, `type` (free text, default `GENERAL`), `visitMode` (`ONSITE` | `ONLINE`), `state`, `startAt`, `endAt`, plus `meetLink` and `googleCalendarEventId` for online visits.

`AppointmentState` has five values: `PENDING`, `SCHEDULED`, `CONFIRMED`, `COMPLETED`, `CANCELLED`. The code only ever sets `PENDING`, `CONFIRMED` and `CANCELLED` (see [§7](#7-booking-logic-in-detail)).

### Other models

- `PatientDocument`: files a patient uploads (prescription, lab result, medical report, insurance, other).
- `Message`: a direct message between two users.
- `Notification`, `AppointmentReport`, `Product`, `Cart`, `CartItem`, `Wishlist`, `Order`, `OrderItem`: exist in the schema, but no endpoint reads or writes them yet. `PaymentMethod` (`BARIDIMOB`, `CIB`, `CASH`) points to an Algerian market.

---

## 5. Authentication and permissions

### Tokens

[AuthService](src/auth/auth.service.ts) issues two JWTs signed with different secrets. Both carry `{ userId, role }`.

| Token | Secret | Lifetime | Use |
|---|---|---|---|
| Access token | `JWT_SECRET` | 15 min | Sent as `Authorization: Bearer <token>` (an `access_token` cookie also works) |
| Refresh token | `REFRESH_SECRET` | 7 days | Sent in the body of `POST /auth/refresh-token` to get a new access token |

The refresh endpoint returns only a new access token. The refresh token is not rotated, and refresh tokens are not stored anywhere, so they cannot be revoked.

### Sign-in flows

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant API
    participant DB
    participant OA as Google / Facebook

    Note over FE,DB: Email + password
    FE->>API: POST /auth/signup {name, email, password, role?, address?, fees?...}
    API->>DB: create Address? + User + (Doctor or Patient) in one transaction
    API-->>FE: {accessToken, refreshToken, user}
    FE->>API: POST /auth/login {email, password}
    API->>DB: find user, bcrypt.compare
    API-->>FE: {accessToken, refreshToken, user}

    Note over FE,OA: Social login (browser redirect)
    FE->>API: GET /auth/google  (or /auth/facebook)
    API-->>OA: redirect to consent screen
    OA-->>API: GET /auth/google/callback
    API->>DB: find by googleId → else link to existing email → else create User + Patient
    API-->>FE: 302 to OAUTH_SUCCESS_REDIRECT?accessToken=...&refreshToken=...
```

Details:

- Signup accepts `role` = `PATIENT` (default) or `DOCTOR`. Choosing `DOCTOR` creates a `Doctor` profile with the `fees`, `workYears` and `about` sent in the request. The DTO is the place to check whether anyone can sign up as a doctor without approval.
- Social login always creates a **patient**. If a user with the same email already exists, the social ID is linked to that account.
- A user who signed up through social login cannot use password login: the API replies "This account uses social login".
- The login response includes `user.patient` or `user.doctor` depending on the role, so the frontend gets the profile ID straight away.

### Guards

| Guard | File | What it does |
|---|---|---|
| `JwtAuthGuard` | [jwt-aut.guard.ts](src/auth/guards/jwt-aut.guard.ts) | Checks the JWT. [JwtStrategy](src/auth/strategies/jwt.strategy.ts) then loads the user from the database on **every request** and sets `req.user = { id, userId, role }`. |
| `AuthorizationGuard` | [authorization.guard.ts](src/auth/guards/authorization.guard.ts) | Reads `@Permissions([{ resource, action }])` from the route and checks it against a role → permissions table hard-coded in the guard. |
| `PatientRoleGuard` | [patient-role.guard.ts](src/patient/patient-role.guard.ts) | Requires `role === PATIENT`, loads the `Patient` row and attaches it as `req.patient`. |

`@CurrentUser()` reads `req.user` for HTTP requests and `client.data.user` for WebSocket messages.

Permission table in `AuthorizationGuard`:

| Resource | ADMIN | DOCTOR | PATIENT |
|---|---|---|---|
| `users` | CRUD | – | – |
| `appointments` | CRUD | read, update | create, read |
| `products` | CRUD | – | read |
| `chats` | CRUD | create, read | create, read |
| `patients` | – | read | – |
| `doctor` | – | create, read, update, delete | – |

These permissions only check the **role**. Whether a user owns the record (for example "is this my appointment?") is checked inside the services.

---

## 6. API modules and endpoints

The full, live list is in Swagger at `/api`. Below, **Auth** means `JwtAuthGuard`, and **Perm** is the `@Permissions` value checked by `AuthorizationGuard`.

### `/auth`: [auth.controller.ts](src/auth/auth.controller.ts)

| Method | Path | Guard | Purpose |
|---|---|---|---|
| POST | `/auth/signup` | – | Create an account (patient or doctor) |
| POST | `/auth/login` | – | Email + password login |
| POST | `/auth/refresh-token` | – | Exchange a refresh token for a new access token |
| GET | `/auth/profile` | Auth | Current user with address and role profile |
| GET | `/auth/google`, `/auth/google/callback` | Passport | Google OAuth |
| GET | `/auth/facebook`, `/auth/facebook/callback` | Passport | Facebook OAuth |

### `/doctor`: [doctor.controller.ts](src/doctor/doctor.controller.ts)

| Method | Path | Perm | Purpose |
|---|---|---|---|
| GET | `/doctor` | public | Paginated list of doctors (`page`, `limit`) |
| GET | `/doctor/:id` | public | One doctor (by `User.id`) |
| POST | `/doctor/schedule` | doctor:create | Add a weekly work day `{ day: 0–6 (0 = Sunday), start: "HH:mm", end: "HH:mm" }` |
| GET | `/doctor/schedule?date=` | doctor:read | The logged-in doctor's free slots for a date |
| PATCH | `/doctor/schedule` | doctor:update | Change a work day |
| POST / GET / DELETE | `/doctor/schedule/exception[/:id]` | doctor:* | Manage date overrides |
| POST / GET / DELETE | `/doctor/schedule/holidays[/:id]` | doctor:* | Manage leaves |
| GET | `/doctor/schedule/calendar?month=&year=` | doctor:read | Month view: per-day slots, booked slots, booking rate |
| GET | `/doctor/schedule/export` | doctor:read | Export the schedule as `.ics` (iCalendar) or JSON |
| GET | `/doctor/patients/:patientId/documents` | patients:read | A patient's documents. Only allowed if the doctor has at least one appointment with that patient. |

### `/appointments`: [appointment.controller.ts](src/appointment/appointment.controller.ts)

Every route requires Auth.

| Method | Path | Perm | Purpose |
|---|---|---|---|
| GET | `/appointments/schedule/doctor/:id?date=` | appointments:read | Free slots for a doctor (`:id` = `User.id`). The patient-facing slot picker uses this. |
| POST | `/appointments` | – (service checks the caller is a patient) | Request a booking |
| GET | `/appointments/patient` | – | The patient's appointments (paginated, `dateFrom` / `dateTo`) |
| GET | `/appointments/doctor` | – | The doctor's appointments (paginated, date filter) |
| GET | `/appointments/doctor/day?date=` | – | The doctor's appointments for one day |
| GET | `/appointments/:id` | – (must be the doctor or patient on it) | Appointment details, including `meetLink` |
| PATCH | `/appointments/:id` | – | Generic update (see [§15](#15-known-issues-and-gaps)) |
| DELETE | `/appointments/:id` | – (must be the doctor or patient) | Cancel. **Deletes the row.** |
| POST | `/appointments/:id/approve` | appointments:update | The doctor approves → `CONFIRMED` (+ Meet link if online) |
| POST | `/appointments/:id/reject` | appointment:update ⚠️ | The doctor rejects → `CANCELLED` |
| PUT | `/appointments/:id/reschedule` | appointment:update ⚠️ | The doctor moves the appointment |

⚠️ The resource name is singular (`appointment`) on these two routes, so they are always refused. See [§15](#15-known-issues-and-gaps).

### `/patients`: [patient.controller.ts](src/patient/patient.controller.ts)

Requires Auth and `PatientRoleGuard`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/patients/me` | Patient profile |
| POST | `/patients/me/documents` | Upload a document (multipart field `file` + `documentType`, `title`) |
| GET | `/patients/me/documents` | List the patient's documents |
| DELETE | `/patients/me/documents/:id` | Delete the database row and the file on disk |

### `/users`: [user-profile.controller.ts](src/user/user-profile.controller.ts)

Requires Auth, any role.

| Method | Path | Purpose |
|---|---|---|
| POST | `/users/me/profile-picture` | Upload an avatar (multipart field `file`) |
| DELETE | `/users/me/profile-picture` | Remove the avatar |

### `/messages`: [messages.controller.ts](src/messages/messages.controller.ts)

Requires Auth. Create, list the conversation with `receiverId`, get one, edit your own message, delete your own message. The same actions are also available over Socket.IO ([§8](#8-real-time-chat)).

### `/product`

[product.service.ts](src/product/product.service.ts) is still the Nest generator stub (it returns strings such as `"This action returns all product"`), and its routes have no guards.

### Root

- `GET /` returns a hello string.
- `GET /service-worker.js` returns a service worker that does nothing, so browsers stop logging 404s for it.

---

## 7. Booking logic in detail

This is the core of the product. The logic is split between [AppointmentService](src/appointment/appointment.service.ts) and [DoctorService](src/doctor/doctor.service.ts).

### 7.1 Computing free slots

Both `GET /appointments/schedule/doctor/:id?date=YYYY-MM-DD` and `GET /doctor/schedule?date=` call `DoctorService.getDoctorSchedule(doctorUserId, date)`:

```mermaid
flowchart TD
    A[date] --> B{DoctorLeave covers date?}
    B -- yes --> X1[unavailable: 'Doctor is on leave']
    B -- no --> C{ScheduleException on date?}
    C -- CANCELLED --> X2[unavailable]
    C -- ADDED / CHANGED --> D[hours = exception.start → exception.end]
    C -- none --> E{WorkDay for this weekday?}
    E -- no --> X3[unavailable: 'does not work this day']
    E -- yes --> F[hours = workDay.startTime → endTime]
    D --> G[cut hours into 30-minute slots]
    F --> G
    G --> H[remove slots whose start time matches a non-cancelled appointment]
    H --> R["{ date, slots: ['09:00','09:30',...], available, reason? }"]
```

The order matters: **leave beats exception, and exception beats the weekly schedule.**

`GET /doctor/schedule/calendar` applies the same rules to every day of a month (`getDayAvailability`). It also returns booked slots and a summary: total, booked, available, booking rate.

Slots are always 30 minutes long. A slot counts as booked only if an appointment **starts** at exactly that time. A 60-minute appointment at 10:00 blocks the 10:00 slot, but 10:30 still shows as free.

### 7.2 Lifecycle of an appointment

```mermaid
stateDiagram-v2
    [*] --> PENDING: patient POST /appointments
    PENDING --> CONFIRMED: doctor /approve<br/>(online → Google Meet link created)
    PENDING --> CANCELLED: doctor /reject
    PENDING --> PENDING: doctor /reschedule
    CONFIRMED --> CONFIRMED: doctor /reschedule
    PENDING --> [*]: DELETE (row removed)
    CONFIRMED --> [*]: DELETE (row removed)
    note right of CONFIRMED
      SCHEDULED and COMPLETED exist in the
      enum but nothing sets them yet
    end note
```

### 7.3 Booking: `POST /appointments`

Body: `{ doctorUserId, date: "YYYY-MM-DD", time: "HH:mm", durationMinutes, type?, visitMode? }`

1. Combine `date` and `time` into `startAt`. Reject times in the past.
2. Look up the caller's `Patient` (403 if the caller is not a patient) and the doctor's `Doctor` row from `doctorUserId`.
3. Check for a conflict: another appointment of this doctor with **exactly the same `startAt`** in state `SCHEDULED` or `CONFIRMED`.
4. `endAt = startAt + durationMinutes` (30 minutes by default).
5. Create the appointment in state `PENDING`, with `type` defaulting to `GENERAL` and `visitMode` to `ONSITE`.

Booking does **not** check working hours, leaves or exceptions. The frontend is expected to send a slot taken from the slot endpoint. The full check happens when the doctor approves.

### 7.4 Approval: `POST /appointments/:id/approve`

1. The caller must be the appointment's doctor, and the state must be `PENDING`.
2. `isTimeSlotAvailable(doctorId, startAt, endAt, excludeId)` checks four things:
   - no **overlapping** `SCHEDULED` or `CONFIRMED` appointment (real overlap check, not just the same start time);
   - the doctor has a `WorkDay` for that weekday, and the appointment fits inside its hours;
   - there is **no** `ScheduleException` of any type on that date;
   - no `DoctorLeave` covers the appointment.
3. If `visitMode === ONLINE`:
   - Google credentials (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`) must be set, otherwise the API returns 400;
   - [GoogleCalendarService](src/google/google-calendar.service.ts) creates an event on `GOOGLE_CALENDAR_ID` (default `primary`) with a `hangoutsMeet` conference and both emails as attendees, so Google sends them the invitations;
   - `meetLink` and `googleCalendarEventId` are saved on the appointment.
4. State becomes `CONFIRMED`. An optional `message` in the body is only written to the log for now (a notification is still a TODO).

Google access uses **one shared Google account** (a stored OAuth refresh token, typically obtained through the OAuth Playground), not each doctor's own Google account.

### 7.5 Reject, reschedule, cancel

- **Reject**: the doctor rejects their own `PENDING` appointment → `CANCELLED`.
- **Reschedule** `{ newDate, newStart, newEnd, reason? }`: the doctor's own appointment, not cancelled. Checks: end after start, not in the past, `isTimeSlotAvailable`. The new times are saved. A `PENDING` appointment stays `PENDING`; anything else becomes `CONFIRMED`. The Google Calendar event is **not** updated.
- **Cancel** (`DELETE`): the patient or the doctor on the appointment can do it. The row is **deleted**, so no history is kept, and the Calendar event is not removed.

### 7.6 Time zones

The code mixes local-time methods (`setHours`, `getHours`, `toTimeString`) with UTC methods (`setUTCHours`, `getUTCDay`). This only gives consistent results when the server runs in **UTC**. That is the default in the `node:20-alpine` container, so production works. Running the API locally on a machine set to another time zone (for example Algeria, UTC+1) can shift slots by an hour. Clients should treat all times as UTC.

---

## 8. Real-time chat

[MessagesGateway](src/messages/messages.gateway.ts) is a Socket.IO gateway on the same port as the HTTP API (default path `/socket.io`).

- **Connect**: the client sends the access token as `io(url, { auth: { token } })` or as an `Authorization: Bearer` header. An invalid or missing token disconnects the socket. A valid one sets `client.data.user = { userId, role }` and joins the room `user:<userId>`.
- **Events the client can send**: `createMessage {content, receiverId}`, `findAllMessages <receiverId>` (the last 50 messages between the two users), `findOneMessage <id>`, `updateMessage {id, content}`, `removeMessage <id>`.
- **Events the server sends**: `message` (one new message) and `messages` (a conversation history).

Messages are saved in the `Message` table. The REST endpoints and the socket events share the same `MessagesService`, so a message sent over REST is also pushed over the socket.

⚠️ The server currently sends these events to **every connected client** (`server.emit`), not only to the receiver's `user:<id>` room. See [§15](#15-known-issues-and-gaps).

---

## 9. File uploads

Files are written to the local disk with Multer and served by Nest at `/uploads/...`.

| Kind | Folder | Name | Limit | Allowed types |
|---|---|---|---|---|
| Patient document | `uploads/patient-files/<patientId>/` | `<uuid>.<ext>` | 15 MB | PDF, JPEG, PNG, WebP, DOC, DOCX |
| Profile picture | `uploads/profile-pictures/<userId>/` | `profile.<ext>` (older variants are deleted) | 5 MB | JPEG, PNG, GIF, WebP |

The database stores the **public path** (for example `/uploads/patient-files/abc/uuid.pdf`) in `fileUrl` or `profilePictureUrl`.

Access control: the `/uploads` route is a plain static file server with **no auth check**. Anyone with the URL can download the file. The random UUID in the file name is the only protection. Listing a patient's documents requires a doctor who has an appointment with that patient, but the file URLs themselves are public.

---

## 10. Configuration (environment variables)

Read through `ConfigService` (global `ConfigModule`) or `process.env`. Locally they come from `backend/.env`. In production they come from `/opt/dermeee/.env` (template: [deploy/env.server.example](deploy/env.server.example)).

| Variable | Required | Used for |
|---|---|---|
| `DATABASE_URL` | **yes** | Postgres connection. The app refuses to start without it. In Compose it is built from the `POSTGRES_*` values. |
| `JWT_SECRET` | **yes** | Signs access tokens and checks socket tokens |
| `REFRESH_SECRET` | **yes** | Signs refresh tokens |
| `PORT` | no (3000) | HTTP port |
| `ALLOWED_ORIGINS` | no | CORS list, comma-separated. Empty means `*`. |
| `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET`, `OAUTH_GOOGLE_CALLBACK_URL` | **yes, at startup** | Google sign-in. The strategy uses `getOrThrow`, so the app crashes if any is missing. |
| `OAUTH_FACEBOOK_APP_ID`, `OAUTH_FACEBOOK_APP_SECRET`, `OAUTH_FACEBOOK_CALLBACK_URL` | **yes, at startup** | Facebook sign-in (same `getOrThrow` behaviour) |
| `OAUTH_SUCCESS_REDIRECT` | for OAuth | Frontend URL that receives `?accessToken=&refreshToken=` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | for online visits | Calendar / Meet. Without them, approving an online visit returns 400. |
| `GOOGLE_CALENDAR_ID` | no (`primary`) | Calendar that receives the events |
| `GOOGLE_OAUTH_REDIRECT_URI` | no | Redirect URI tied to the refresh token (default: OAuth Playground) |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` | Compose | Database container |
| `API_PORT`, `FRONTEND_PORT` | Compose | Host ports (3000 / 3001) |
| `DOCKER_REGISTRY`, `API_IMAGE_TAG`, `FRONTEND_IMAGE_TAG` | prod Compose | Which images to run. `API_IMAGE_TAG` is rewritten by Ansible on every deploy. |
| `CSRF_SECRET` | no | Passed in by `docker-compose.yml` but not used (CSRF is disabled) |

The Google variables come in **two separate sets**: `OAUTH_GOOGLE_*` is for "Sign in with Google", and `GOOGLE_*` is for creating Calendar/Meet events. They can belong to the same Google Cloud project, but the code reads them independently.

---

## 11. Running locally

```bash
# 1. Install dependencies (also runs prisma generate before builds)
npm install

# 2. Start Postgres (or point DATABASE_URL at an existing database)
docker compose up -d postgres

# 3. Create backend/.env with at least:
#    DATABASE_URL=postgresql://dermee_user:dermee_password@localhost:5432/dermee_db?schema=public
#    JWT_SECRET=...  REFRESH_SECRET=...
#    OAUTH_GOOGLE_* and OAUTH_FACEBOOK_* (placeholder values are enough to boot)

# 4. Apply migrations and generate the Prisma client
npx prisma migrate deploy      # or `npx prisma migrate dev` while changing the schema
npx prisma generate

# 5. Run
npm run start:dev              # watch mode on :3000, Swagger at http://localhost:3000/api
```

Other scripts: `npm run lint`, `npm run format:check`, `npm test` (Jest unit tests, `*.spec.ts`), `npm run test:e2e`, and `npx prisma studio` (database browser).

To run the whole stack in Docker on one machine (Postgres + API + frontend, built from `../frontend`): `docker compose up -d --build`, or `./docker-deploy.sh`.

---

## 12. Deployment

### 12.1 Overview

```mermaid
flowchart TB
    Dev[Developer] -->|push / PR| GH[GitHub repo]
    GH -->|on push/PR| GA[GitHub Actions<br/>lint + format + build<br/>no deploy]
    GH -->|webhook| NX[Nginx on VPS<br/>/github-webhook/]
    NX --> J[Jenkins :8080 on VPS]
    J -->|1. checkout, tag = git short SHA| J
    J -->|2. docker build + push| R[(GHCR<br/>dermeee-api:SHA and :latest)]
    J -->|3. main/master only:<br/>ansible-playbook over SSH| A[Ansible]
    A -->|copy compose file,<br/>set API_IMAGE_TAG in .env| VPS
    subgraph VPS["/opt/dermeee on the VPS"]
      DC[docker compose -f docker-compose.prod.yml]
      PG[(postgres:14-alpine<br/>volume postgres_data)]
      API[dermee-api :3000]
      FE[dermee-frontend :3001]
      DC --> PG & API & FE
    end
    R -->|docker compose pull api| API
    U[Users] --> NG2[Nginx :80<br/>dermee.dz / www.dermee.dz]
    NG2 -->|/auth /doctor /appointment* /product /api /health| API
    NG2 -->|everything else| FE
```

The backend and the frontend live in **separate repositories**, and each one builds and pushes its own image. Only the backend repo holds the deploy files (prod Compose file, Ansible playbook). By default the playbook pulls only `api`. The frontend tag is set by hand or by the frontend's own pipeline through `FRONTEND_IMAGE_TAG`.

Jenkins runs **on the same VPS** as the app. The committed inventory [jenkins.ini](deploy/ansible/inventory/jenkins.ini) points Ansible at `localhost` as the `deploy` user over SSH.

### 12.2 The Docker image

[Dockerfile](Dockerfile), three stages on `node:20-alpine`:

1. `dependencies`: production `npm ci` (this stage is not used by the final image).
2. `build`: full `npm ci`, `prisma generate`, `nest build` → `dist/`.
3. `production`: production `npm ci`, copy `dist/` and the generated Prisma client, copy `prisma/` (schema and migrations) and `docker-entrypoint.sh`, then run as the non-root user `nestjs` (uid 1001) on port 3000.

When the container starts, [docker-entrypoint.sh](docker-entrypoint.sh) runs:

```
sleep 5  →  npx prisma migrate deploy  →  npx prisma generate  →  exec node dist/main.js
```

So **database migrations run automatically on every deploy**, before the new code starts. If a migration fails, the script logs a warning and starts the app anyway.

### 12.3 Jenkins pipeline: [Jenkinsfile](Jenkinsfile)

| Stage | What it does |
|---|---|
| Checkout | `IMAGE_TAG = git rev-parse --short=7 HEAD` |
| Validate registry | Fails if `DOCKER_REGISTRY` is empty (fallback: `ghcr.io/morsiyoucef-alter`) |
| Docker login | Credential `docker-registry-credentials` (GitHub user + PAT with `write:packages`) |
| Build & push API | Pushes `dermeee-api:<sha>` and `:latest` |
| Deploy with Ansible | Only on `main`/`master`. Uses SSH key `vps-ssh-deploy-key` and runs `ansible-playbook -i inventory/jenkins.ini playbooks/deploy.yml -e image_tag=<sha>` |

Builds of other branches still build and push an image (including `:latest`), but do not deploy. `disableConcurrentBuilds()` stops two deploys from running at once.

### 12.4 Ansible playbook: [deploy.yml](deploy/ansible/playbooks/deploy.yml)

1. Check that `image_tag` was passed, and that `/opt/dermeee` and `/opt/dermeee/.env` exist (it never creates secrets).
2. Copy [deploy/docker-compose.prod.yml](deploy/docker-compose.prod.yml) to `/opt/dermeee/`.
3. Replace the `API_IMAGE_TAG=` line in `.env` with the new SHA.
4. `docker compose pull api && docker compose up -d --remove-orphans`.

Compose then recreates only the `api` container, because it is the only one whose image changed. Postgres keeps running, and its data lives in the `postgres_data` volume.

### 12.5 Nginx: [nginx/dermee.conf](nginx/dermee.conf)

Nginx runs on the host (not in Docker) and listens on port 80 for `dermee.dz` and `www.dermee.dz`:

- `/auth`, `/doctor`, `/product`, `/appointment` (prefix match, so `/appointments` is included), `/api` (Swagger) and `/health` go to the API at `127.0.0.1:3000`.
- `/github-webhook` goes to Jenkins at `127.0.0.1:8080`, with redirects disabled, because a redirect turns GitHub's POST into a failed request.
- Everything else goes to the Next.js frontend at `127.0.0.1:3001`.

The config only has a port 80 block. HTTPS (certbot or similar) is set up separately, see [NGINX-SETUP.md](NGINX-SETUP.md).

### 12.6 First-time server setup (summary)

The full checklist and the problems already met are in [CI-CD-PIPELINE.md](CI-CD-PIPELINE.md).

1. Install Docker, Nginx, Java and Jenkins on the VPS. Add the `jenkins` user to the `docker` group. Create a `deploy` user in the `docker` group with Jenkins' SSH public key in its `authorized_keys`.
2. `mkdir -p /opt/dermeee` and copy `deploy/env.server.example` to `/opt/dermeee/.env`, then fill in the secrets.
3. In Jenkins, create the credentials `docker-registry-credentials` and `vps-ssh-deploy-key`, then a Pipeline job "from SCM" with script path `Jenkinsfile` and "GitHub hook trigger" enabled.
4. Add a GitHub webhook pointing to `http(s)://<domain>/github-webhook/`.
5. Install `nginx/dermee.conf` into `sites-enabled` and reload Nginx.

### 12.7 Rolling back

Every build is pushed under its git SHA, so a rollback means running the playbook with an older tag:

```bash
cd deploy/ansible
ansible-playbook -i inventory/jenkins.ini playbooks/deploy.yml -e image_tag=<older-sha>
```

Or set `API_IMAGE_TAG=<older-sha>` in `/opt/dermeee/.env` by hand and run `docker compose -f docker-compose.prod.yml up -d api`. Migrations are **not** rolled back automatically. If a release changed the schema, the old code has to work with the new schema.

### 12.8 Older options still in the repo

- [docker-deploy.sh](docker-deploy.sh): builds the images on the server with the root `docker-compose.yml`. It predates the registry and Jenkins flow.
- [ecosystem.config.js](ecosystem.config.js): PM2 config for running `dist/main.js` directly without Docker.

---

## 13. Admin system (November 2026)

The admin back office lives under `/admin/*`. The endpoint contract for each screen is in [docs/admin-api.md](docs/admin-api.md).

### New modules

| Folder | What it does |
|---|---|
| `src/admin/` | Registration stats, the users / clients / doctors tables, doctor approval, suspension, reservation monitoring, and the reservation alert job |
| `src/audit/` | `AuditService.log(tx, …)`, written in the same transaction as the change it records; `GET /admin/audit-logs` |
| `src/settings/` | Admin-editable thresholds (`urgentHours`, `mediumHours`, `defaultLowStockThreshold`) |
| `src/notifications/` | In-app notifications, pushed live as the `notification` socket event |
| `src/realtime/` | Socket.IO push to `user:<id>` rooms, so any service can notify a user |
| `src/impersonation/` | Read-only "view as user" sessions, plus a global guard that blocks every write made with such a token |
| `src/inventory/` | `StockService`: the only code path that changes stock, through one conditional SQL update |
| `src/order/` | Checkout, plus independent order, payment and delivery statuses, and admin order management |
| `src/product/` | Shop listing (published products only), admin product CRUD, photo upload, stock adjustments |
| `src/storage/` | Private storage for medical files and authenticated downloads at `/files/...` |
| `src/cli/` | `create-admin.js` (create the first admin) and `move-patient-files.js` |

### Rules that changed for existing features

- **Doctors** start as `PENDING` and stay hidden from patients until an admin approves them (`src/doctor/doctor-visibility.ts`). Doctors who existed before this release were migrated as `APPROVED`.
- **Suspended accounts** (`User.status`) are refused by `JwtStrategy`, login, refresh, OAuth and sockets.
- **Reservations** follow `src/appointment/appointment-state.ts`: `PENDING` → `CONFIRMED` (doctor) → `DERMEE_CONFIRMED` (admin) → `COMPLETED` / `NO_SHOW`, plus `CANCELLED` and `REJECTED`. Every change goes through `AppointmentService.transition()`, which writes `AppointmentStatusHistory`.
  - Cancelling now keeps the row instead of deleting it.
  - Booking and rescheduling lock the doctor's schedule, so two parallel bookings can't take the same slot.
- **Availability** follows one set of rules for both the slot list and the booking check: leave, then the date exception, then weekly hours, then overlapping reservations.
- **Urgency** (`src/appointment/urgency.ts`) is computed from the visit time and the confirmation state, using the thresholds in settings.
- **Orders** reserve stock when they are placed. Rejecting or cancelling an order gives the stock back exactly once.
- **Chat events** go only to the two people in the conversation.
- **Medical files:** patient documents and doctor verification documents are stored privately and served only after a permission check. The old `/uploads/patient-files/...` path returns 404.
- **Permissions:** resources are typed constants in `src/auth/permissions.ts`, and a unit test checks every decorator against that table.

### Scheduled job

Every 10 minutes, `ReservationAlertsJob` alerts admins about unconfirmed reservations that are close to their time or already overdue.
- A Postgres advisory lock makes sure only one copy runs at a time.
- Each alert has a dedupe key, so the same alert is never sent twice.
- Set `DISABLE_SCHEDULED_JOBS=true` on extra replicas.

### Tests

- `npm test` runs the unit tests: state machine, urgency, order rules, the permission map, the read-only guard, CSV, dates and settings.
- `E2E_DATABASE_URL=postgresql://…/dermee_e2e npm run test:e2e` runs the end-to-end suite against a disposable database whose name must end in `_e2e` or `_test`. It covers:
  - role checks on every admin route;
  - suspension;
  - the doctor approval flow;
  - booking and stock races;
  - the reservation lifecycle;
  - impersonation;
  - exports;
  - alert de-duplication.

---

## 14. Migration baseline runbook (one time, production)

**Why this is needed:** until now production was updated with `prisma db push`, so its `_prisma_migrations` table doesn't match the schema. Two catch-up migrations describe everything `db push` already did:
- `20261102000000_sync_add_pending_state`
- `20261102000100_sync_db_push`

On production they must be **marked as applied without running**. The admin migrations after them then run normally.

1. **Back up.** On the VPS: `docker exec dermee-postgres pg_dump -U dermee_user -Fc dermee_db > /opt/dermeee/backup-$(date +%F).dump`
2. **Look (read only).** In `psql`:
   ```sql
   SELECT migration_name, finished_at FROM _prisma_migrations;   -- does init exist?
   SELECT to_regclass('"Chat"'), to_regclass('"ChatParticipant"'); -- leftovers from init?
   ```
3. **Check for drift (read only).** From the new image, with `DATABASE_URL` pointing at production:
   ```bash
   docker compose -f docker-compose.prod.yml run --rm --no-deps --entrypoint sh api -c \
     "npx prisma migrate diff --from-config-datasource --to-schema prisma/baseline/schema-at-sync.prisma --script"
   ```
   `schema-at-sync.prisma` is the schema the two catch-up migrations produce. The output must be **empty**. Any SQL it prints is a difference between production and that schema, which you fix by hand first. Leftover `Chat` / `ChatParticipant` tables can be dropped after the backup. If the product-images or ratings tables from `feature/product-apis` show up, someone already pushed that branch to production; tell me and I'll adjust the marketplace migration.
4. **Mark the catch-up migrations as applied.** Deploy once with:
   ```bash
   ansible-playbook -i inventory/jenkins.ini playbooks/deploy.yml -e image_tag=<sha> \
     -e "prisma_resolve_applied=['20251014105411_init','20261102000000_sync_add_pending_state','20261102000100_sync_db_push']"
   ```
   Leave `20251014105411_init` out of the list if step 2 showed it is already recorded. The container then runs `migrate deploy`, which applies only the admin migrations.
5. **After deploy:**
   - Create the first admin: `docker compose -f docker-compose.prod.yml exec api node dist/cli/create-admin.js`, with `ADMIN_EMAIL`, `ADMIN_NAME` and `ADMIN_PASSWORD` set in the environment.
   - Move old patient files: run `node dist/cli/move-patient-files.js` (dry run), then again with `--apply`.
   - Set stock quantities for existing products. They start at 0, so they can't be ordered until you do.
6. **From now on:** never use `db push` on a shared database. Use `npx prisma migrate dev` locally (with `SHADOW_DATABASE_URL` set) and commit the migration. CI checks that the migrations rebuild `schema.prisma` exactly.

---

## 15. Known issues and gaps

Status after the admin release. ✅ means fixed in this release.

### Production impact

1. ✅ Reject and reschedule always returned 403 because of the `'appointment'` typo. Resources are now typed and checked by a test.
2. ✅ `GET /health` exists, so the Docker healthcheck works.
3. ✅ / ⚠️ Nginx has a new `api.dermee.dz` server block that routes every API path, including Socket.IO. **To do:** add the DNS record and a TLS certificate, and point the frontend's API base URL at it. The `dermee.dz` block still routes only the old paths, on purpose: the frontend will need its own `/admin` pages.
4. ✅ Uploads and private files have Docker volumes and folders owned by the app user.
5. ✅ The OAuth variables are listed as required in `env.server.example`. The app still refuses to start without them.
6. ✅ Chat events go only to the sender and the receiver. `GET /messages/:id` checks that the caller is one of them.

### Booking logic

7. ✅ Pending requests now block the slot, the check covers the full time range, and it runs under a lock.
8. ✅ Days with an `ADDED` or `CHANGED` exception use the exception's hours instead of blocking approval.
9. ✅ The unreachable branch in reschedule is gone. Rescheduling must fit the doctor's schedule.
10. ⚠️ The slot list in `DoctorService.getDoctorSchedule` still hides only the slot where a reservation starts, so a 60-minute visit doesn't hide the next 30-minute slot. Booking itself does check the full range, so the slot is refused at booking time instead of being hidden.
11. ✅ Cancelling keeps the row, and cancel and reject delete the Google Calendar event. Reschedule moves the event.
12. ✅ `SCHEDULED` was removed. `COMPLETED` and `NO_SHOW` are set by the doctor or an admin. `AppointmentReport` still has no endpoint.

### Security and cleanup

13. ✅ `PATCH /appointments/:id` is limited to the patient who booked, while the request is `PENDING`, and only for `type` and `visitMode`.
14. ✅ Medical files are private (see §13).
15. ⚠️ OAuth still sends tokens back in the redirect URL. Refresh tokens are still stateless; they're refused for suspended accounts but can't be revoked one by one.
16. ⚠️ CORS still falls back to `*` when `ALLOWED_ORIGINS` is empty. Set it in production.
17. ⚠️ The permission guard no longer logs user objects, but some older services still `console.log` request data (signup DTOs, the `CurrentUser` decorator).
18. ⚠️ Unused packages (TypeORM, MSSQL, `csrf-csrf`) are still installed.
19. ✅ The entrypoint now stops when a migration fails.
20. ⚠️ Times: appointment times are handled in UTC everywhere. Doctors' weekly hours are UTC hours too, so the frontend must convert from and to Algeria time (UTC+1). Registration and reservation charts already use Algeria days.
21. ⚠️ Wilaya and commune are free text (`Address.state` / `Address.city`), so filters use "contains". A reference table of Algeria's wilayas and communes would make them exact; it needs an official, up-to-date dataset (the number of wilayas changed recently).
22. ⚠️ `npm run lint` still reports formatting errors in files this release didn't touch. `npm run format` fixes them.
