# DerMee Admin API: contract per screen

This document is for the developers building the admin dashboard. Every endpoint below already exists in the backend. Swagger at `/api` has the exact request and response schemas, grouped under the `admin-*` tags.

- **Base URL:** `https://api.dermee.dz` in production (see [nginx/dermee.conf](../nginx/dermee.conf)), `http://localhost:3000` locally.
- **Auth:** `Authorization: Bearer <accessToken>`, using the token returned by `POST /auth/login`. Every `/admin/*` route returns `401` without a token and `403` when the user is not an `ADMIN`.
- **Creating the first admin:** `ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run admin:create` (inside the API container: `node dist/cli/create-admin.js`).

---

## Shared conventions

**Lists.** Every list takes `page` (from 1), `limit` (at most 100, default 20), `sortBy`, `sortDir` (`asc` / `desc`) and `search`, and returns:

```json
{ "data": [ … ], "pagination": { "page": 1, "limit": 20, "total": 134, "totalPages": 7, "hasNext": true, "hasPrev": false } }
```

All pagination, filtering and sorting happen on the server. An unknown `sortBy` value falls back to the endpoint's default.

**Dates.**
- Filters take `YYYY-MM-DD` dates. Both ends of a range are included, and days are Algeria days (UTC+1).
- Timestamps in responses are ISO strings in UTC. Display them in `Africa/Algiers`.
- Appointment times are entered and stored in UTC, the same way the existing booking flow works.

**Errors.** Every error has the same shape:

```json
{ "error": true, "responseBody": { "statusCode": 400, "message": "…", "error": "Bad Request" } }
```

`message` can be a string or an array of validation messages. Show it as is. Codes worth handling:

| Code | Meaning |
|---|---|
| `400` | A business rule refused the action. The message says why, e.g. "Cannot approve a doctor whose status is APPROVED". |
| `409` | Someone else changed the record at the same moment. Reload the record and let the admin retry. |

**Actions.**
- Action endpoints return the updated record, so you can replace the row or panel with it.
- Detail endpoints return `allowedActions`. Show only those buttons and hide or disable the rest.

**Confirmation dialogs.** Ask for confirmation, with a reason field where marked, before:

| Action | Reason |
|---|---|
| Reject doctor | **required**, and shown to the doctor |
| Suspend account | **required** |
| Cancel reservation | **required** |
| Reject or cancel order | **required** |
| Delete product | none (the response says whether the product was deleted or archived) |
| Stock adjustment | optional note |
| Start "view as user" | optional reason |

**Medical files.**
- Patient documents and doctor verification documents are **not public**. Their `url` (for example `/files/doctor-documents/:id`) requires the Bearer token.
- Download them with `fetch` (Bearer token) → `blob` → `URL.createObjectURL`, not with a plain `<img src>` or `<a href>`.
- Product photos and avatars under `/uploads/...` are public.

---

## 1. Registration dashboard

### KPI cards: `GET /admin/stats/registrations`

```json
{ "totalUsers": 1520, "totalClients": 1402, "totalDoctors": 118, "pendingDoctorApprovals": 7,
  "newRegistrationsThisMonth": 64, "newRegistrationsLastMonth": 51, "newRegistrationsChangePct": 25.5,
  "suspendedUsers": 3 }
```

Administrators are not counted. `newRegistrationsChangePct` is `null` when last month had 0 registrations.

### Chart: `GET /admin/stats/registrations/timeseries`

| Param | Values |
|---|---|
| `granularity` | `day` (default) \| `week` \| `month`. Weeks start on Sunday. |
| `from`, `to` | Custom range. Default: the last 30 days. |
| `role` | `PATIENT` \| `DOCTOR`, optional |

```json
{ "granularity": "day", "from": "2026-10-04", "to": "2026-11-02",
  "series": [ { "bucket": "2026-10-04", "clients": 3, "doctors": 1, "total": 4 }, … ],
  "totals": { "clients": 58, "doctors": 6, "total": 64 },
  "previous": { "from": "2026-09-04", "to": "2026-10-03", "clients": 47, "doctors": 4, "total": 51 },
  "change": { "totalPct": 25.5, "clientsPct": 23.4, "doctorsPct": 50 } }
```

- Empty buckets come back as `0`, so the series has no gaps and can be drawn directly.
- Plot `clients` and `doctors` as two series. `previous` covers the period of the same length just before.
- A range that is too long for the granularity returns `400`. The limits are about 400 days, 260 weeks or 120 months.

### Users table: `GET /admin/users`

| Param | Values |
|---|---|
| `search` | Name, first/last name, phone (spaces ignored) or email |
| `role` | `PATIENT` (Client) \| `DOCTOR` |
| `status` | `ACTIVE` \| `PENDING` \| `SUSPENDED` \| `REJECTED` |
| `from`, `to` | Registration date |
| `wilaya`, `commune` | Contains, case-insensitive |
| `sortBy` | `createdAt` (default) \| `name` \| `role` \| `lastActivityAt` |

Each row:

```json
{ "id": "…", "name": "Amina Benali", "firstName": "Amina", "lastName": "Benali", "role": "PATIENT", "roleLabel": "Client",
  "phoneNumber": "0555…", "email": "…", "wilaya": "Alger", "commune": "Bab Ezzouar",
  "createdAt": "…", "lastActivityAt": "…", "accountStatus": "ACTIVE", "specialty": null,
  "patientId": "…", "doctorId": null, "profilePictureUrl": null }
```

- **Location cell:** `wilaya` in small text, with `commune` underneath in larger bold text.
- **Opening a row:** clients go to `/admin/clients/:id`, doctors to `/admin/doctors/:id`. Both take the `User.id`.
- **Export:** `GET /admin/users/export?format=csv|xlsx`, with the same filters as the table.
  - The response is a file download. Use `fetch` → `blob`, because the Bearer header is required.
  - It is capped at 50,000 rows. The `X-Total-Rows` and `X-Exported-Rows` headers tell you if the export was cut.
  - Every export is written to the audit log.

**Status badges:**

| Status | Colour |
|---|---|
| `ACTIVE` | green |
| `PENDING` | amber |
| `REJECTED` | grey |
| `SUSPENDED` | red |

**Context menu (⋮ or right-click):** View profile · View as user · Suspend / Reactivate.

---

## 2. User management

### Clients: `GET /admin/clients`

Filters: `search`, `status` (`ACTIVE` | `SUSPENDED`), `from`/`to` (registration date), `wilaya`, `commune`.

`sortBy`: `createdAt` (default), `lastName`, `firstName`, `reservations`, `completedReservations`, `cancelledReservations`, `orders`, `lastActivityAt`.

Row: `userId`, `patientId`, `firstName`, `lastName`, `phoneNumber`, `email`, `wilaya`, `commune`, `reservations`, `completedReservations`, `cancelledReservations`, `noShowReservations`, `orders`, `createdAt`, `lastActivityAt`, `accountStatus`.

### Client profile

| Endpoint | Returns |
|---|---|
| `GET /admin/clients/:userId` | Personal and contact info, `address`, `wilaya`/`commune`, `signInMethods`, `createdAt`, `lastActivityAt`, `suspendReason`, `stats` (`reservations`, `reservationsByState`, `orders`, `documents`) and `statusHistory` |
| `GET /admin/clients/:userId/reservations` | Paginated reservation history |
| `GET /admin/clients/:userId/orders` | Paginated order history |

**Actions:**
- `POST /admin/users/:id/suspend` with `{ "reason": "…" }`. This signs the user out everywhere: their tokens and sockets are refused immediately.
- `POST /admin/users/:id/reactivate` with `{ "reason"?: "…" }`.

### Doctors: `GET /admin/doctors`

Filters: `search`, `status` (`PENDING` | `APPROVED` | `REJECTED` | `SUSPENDED`), `specialty`, `wilaya`, `commune`, `from`/`to`.

`sortBy`: `createdAt` (default), `lastName`, `firstName`, `specialty`, `reservations`, `status`. Sorting by `status` ascending puts pending doctors first, which gives you the review queue.

Row: `userId`, `doctorId`, `firstName`, `lastName`, `specialty`, `street`, `wilaya`, `commune`, `phoneNumber`, `createdAt`, `status`, `approvedAt`, `reservations`, `upcomingReservations`, `documents`, plus:

```json
"actions": { "approve": true, "reject": true, "suspend": true, "reactivate": false }
```

**Fixed actions column:** three icons (Approve ✓, Reject ✕, Suspend ⏸). Enable each one from `actions`. A suspended row shows Reactivate instead of Suspend.

| Action | Endpoint | Body |
|---|---|---|
| Approve | `POST /admin/doctors/:userId/approve` | `{ "reason"?: "note" }` |
| Reject | `POST /admin/doctors/:userId/reject` | `{ "reason": "…" }` (**required**, sent to the doctor) |
| Suspend | `POST /admin/doctors/:userId/suspend` | `{ "reason": "…" }` |
| Reactivate | `POST /admin/doctors/:userId/reactivate` | `{ "reason"?: "…" }` |
| Back to review | `POST /admin/doctors/:userId/re-review` | Rejected → pending |

**How the statuses work:**
- Suspension is separate from approval. Reactivating a doctor keeps their approval.
- Only `APPROVED` doctors with an active account appear in the patient app and can be booked.
- Doctors who existed before this release were migrated as `APPROVED`. New doctor sign-ups start as `PENDING`, and every admin gets a `DOCTOR_PENDING_APPROVAL` notification.

### Doctor profile

| Endpoint | Returns |
|---|---|
| `GET /admin/doctors/:userId` | Personal info; `professional` (`specialty`, `fees`, `workYears`, `about`, `workDays`); `verification` (`status`, `decidedAt`, `decidedBy {name, email}`, `rejectionReason`, `documents[]` each with an authenticated `url`); `stats` (`reservations`, `upcoming`, `reservationsByState`); `approvalHistory[]` (`field` `APPROVAL`\|`STATUS`, `fromValue`, `toValue`, `reason`, `actor {name}`, `createdAt`) |
| `GET /admin/doctors/:userId/reservations` | Paginated |
| `GET /admin/doctors/:userId/documents` | Verification documents |
| `GET /admin/doctors/:userId/approval-history` | Approval history only |

Doctors upload their own documents through `POST /doctor/me/documents` (multipart: `file`, `documentType` = `MEDICAL_LICENSE`\|`DIPLOMA`\|`ID_CARD`\|`OTHER`, `title`). The doctor app needs a screen for this, shown while the account is pending.

### View as user (impersonation)

1. **Start:** `POST /admin/impersonation/users/:userId` with `{ "reason"?: "…" }`. It returns:
   ```json
   { "accessToken": "…", "readOnly": true, "expiresAt": "…", "session": { "id": "…" }, "target": { "id", "name", "role" } }
   ```
2. **Keep the admin's own tokens untouched.** Store the impersonation token separately (memory or `sessionStorage`) and send it instead of the admin token while impersonating. Then open the patient or doctor UI.
3. **Banner:** `GET /impersonation/current` with the impersonation token returns `{ impersonating, admin {name}, target {name, role}, expiresAt }`. Keep a visible banner up the whole time: "Viewing as Amina Benali (read-only) · Exit".
4. **Exit:** `POST /impersonation/end` with the impersonation token. Then drop that token and switch back to the admin token. The token also expires on its own after 30 minutes and cannot be refreshed.
5. **Read-only rules:**
   - Every write request (`POST`/`PUT`/`PATCH`/`DELETE`) made with the token returns `403` with a clear message. Disable write buttons while the banner is shown.
   - Chat sockets refuse impersonation tokens.
   - Permissions are exactly the target user's, so admin routes return `403` during impersonation.
6. **Refused targets:** other admins and suspended accounts.
7. **Audit:** `GET /admin/impersonation/sessions` lists who viewed whom and when, and the start and end of each session are in the audit log. `POST /admin/impersonation/sessions/:id/end` lets an admin force-end one of their own sessions.

---

## 3. Marketplace

### Products: `GET /admin/products`

| Param | Values |
|---|---|
| `search` | Name, SKU or brand |
| `status` | `PUBLISHED` \| `UNPUBLISHED` \| `ARCHIVED`. Archived products are hidden unless asked for. |
| `category` | |
| `stockLevel` | `IN_STOCK` \| `LOW_STOCK` \| `OUT_OF_STOCK` |
| `sortBy` | `createdAt` \| `name` \| `price` \| `stock` \| `updatedAt` |

Row: `id`, `imageUrl` (primary photo), `name`, `sku`, `category`, `brand`, `price`, `stock`, `stockLevel`, `lowStockThreshold`, `effectiveLowStockThreshold`, `status`, `hasOrders`, `createdAt`, `images[]`.

**Badges:**
- `stockLevel`: `OUT_OF_STOCK` red, `LOW_STOCK` amber, `IN_STOCK` none.
- `status`: `PUBLISHED` green, `UNPUBLISHED` grey, `ARCHIVED` dark.

| Action | Endpoint |
|---|---|
| Add product | `POST /admin/products` `{ name, description?, category?, brand?, price, sku?, stock?, lowStockThreshold?, status?: PUBLISHED\|UNPUBLISHED, images?: [url] }` |
| Upload photo | `POST /admin/products/:id/images/upload` (multipart `file`, JPEG/PNG/WebP, 5 MB). Create the product first, then upload. |
| Edit, change price | `PATCH /admin/products/:id`. Stock is **not** editable here. |
| Publish / unpublish / archive | `PATCH /admin/products/:id/status` `{ status }` |
| Delete | `DELETE /admin/products/:id`. Returns `{ deleted, archived, message }`. A product that was ever ordered is archived instead of deleted. |
| Stock adjustment | `POST /admin/products/:id/stock-adjustments` `{ delta: +10 \| -3, reason?: ADJUSTMENT\|RETURN, note? }`. Returns `400` if the stock would go below 0. |
| Movement history | `GET /admin/products/:id/stock-movements`: `delta`, `stockAfter`, `reason` (`INITIAL`, `ADJUSTMENT`, `ORDER_PLACED`, `ORDER_RELEASED`, `RETURN`), `actor`, `orderId`, `note`, `createdAt` |
| Alerts panel | `GET /admin/products/alerts`: `{ outOfStock: [...], lowStock: [...] }` |

Every one of these changes is audited. When stock crosses a product's alert level, admins get a `LOW_STOCK` notification. The alert level is the product's `lowStockThreshold`, or the `defaultLowStockThreshold` setting when it has none.

### Orders: `GET /admin/orders` (KPIs: `GET /admin/orders/stats`)

| Param | Values |
|---|---|
| `from`, `to` | Order date |
| `customer` | Name or phone |
| `search` | Reference such as `ORD-000045`, or name / phone |
| `wilaya`, `commune` | |
| `product` | Product id or part of a name |
| `status` | `PENDING`\|`CONFIRMED`\|`REJECTED`\|`CANCELLED` |
| `paymentStatus` | `PENDING`\|`PAID`\|`FAILED`\|`REFUNDED` |
| `deliveryStatus` | `NOT_SHIPPED`\|`SENT_TO_DELIVERY`\|`DELIVERED` |
| `payMethod` | |
| `sortBy` | `createdAt` \| `totalAmount` \| `refNo` \| `updatedAt` |

Row: `reference`, `customer {name, phoneNumber}`, `wilaya`, `commune`, `items [{productName, quantity}]`, `itemsCount`, `totalAmount`, `payMethod` + `payMethodLabel` (`CASH` = "Cash on delivery"), `status`, `paymentStatus`, `deliveryStatus`, `deliveryCompany`, `trackingNumber`, `createdAt`.

**Order details:** `GET /admin/orders/:id` returns:
- `customer`, `deliveryAddress`;
- `items[]` with `unitPrice`, `quantity`, `subtotal`, `imageUrl`, `sku`;
- `totalAmount`, `payment {method, status, paidAt}`;
- `delivery {status, company, trackingNumber, shippedAt, deliveredAt}`;
- `history[]` (`field` `STATUS`\|`PAYMENT`\|`DELIVERY`, `fromValue`, `toValue`, `note`, `actor`), which also serves as the delivery updates timeline;
- `labels`, and `allowedActions { status: [...], payment: [...], delivery: [...] }`.

**The three statuses move independently, and each has its own control:**

| Control | Endpoint | Rules |
|---|---|---|
| Order status | `POST /admin/orders/:id/status` `{ status, reason? }` | `PENDING` → `CONFIRMED` / `REJECTED` / `CANCELLED`; `CONFIRMED` → `CANCELLED`. Reject and cancel need a reason and **put the stock back**. A delivered order can't be cancelled. |
| Payment | `POST /admin/orders/:id/payment` `{ paymentStatus, note? }` | `PENDING` → `PAID` / `FAILED`; `FAILED` → `PENDING` / `PAID`; `PAID` → `REFUNDED` |
| Delivery | `POST /admin/orders/:id/delivery` `{ deliveryStatus?, deliveryCompany?, trackingNumber?, note? }` | `NOT_SHIPPED` → `SENT_TO_DELIVERY` needs a confirmed order and a company; then `DELIVERED`, or back to `NOT_SHIPPED` for a returned parcel. Without `deliveryStatus` the call only records info or an update note. |

The customer gets a notification for each order status change and each delivery change.

**Checkout (patient app).** Stock is reserved when the order is placed:
1. `POST /cart/items` `{ productId, quantity }`. Only published, in-stock products can be added.
2. `POST /orders` `{ payMethod, recipientName?, recipientPhone?, wilaya?, commune?, addressLine?, deliveryNote? }`. Empty fields are filled from the profile.
3. `PATCH /orders/me/:id/cancel` cancels the order while it is still pending.

---

## 4. Reservation follow-up

### KPI cards: `GET /admin/reservations/stats`

Returns `totalReservations`, `pendingDoctorConfirmation`, `confirmedByDoctor`, `confirmedByDermee`, `upcoming`, `cancelled`, `rejected`, `completed`, `noShow`, `overdueUnconfirmed`, `urgentUnconfirmed`, `awaitingOutcome` and `thresholds`.

### Chart: `GET /admin/reservations/timeseries`

Params: `granularity`, `from`, `to`, and `dateField` (`createdAt` = bookings made, `startAt` = appointments taking place).

The series is split by current state: `pending`, `confirmedByDoctor`, `confirmedByDermee`, `completed`, `cancelled`, `rejected`, `noShow`.

### Table: `GET /admin/reservations`

| Param | Values |
|---|---|
| `createdFrom`, `createdTo` | Reservation date |
| `appointmentFrom`, `appointmentTo` | Appointment date |
| `client`, `doctor` | Name or phone |
| `wilaya`, `commune` | Client's or doctor's address |
| `status` | One or more, comma separated |
| `urgency` | `OVERDUE`\|`URGENT`\|`MEDIUM`\|`NOT_URGENT` |
| `search` | Reference `RSV-000123`, or name / phone |
| `sortBy` | `priority` (default) \| `startAt` \| `createdAt` \| `statusChangedAt` |

Row: `reference`, `client {name, phoneNumber, wilaya, commune}`, `createdAt`, `doctor {name, phoneNumber, specialty}`, `startAt`/`endAt`, `state` + `stateLabel`, `statusChangedAt` (last status update), and:

```json
"urgency": { "level": "URGENT", "awaitingConfirmation": true, "needsOutcome": false, "hoursUntilStart": 5.5, "priority": 1 }
```

**Lifecycle and badges:**

| State | Label | Colour |
|---|---|---|
| `PENDING` | Pending doctor confirmation | amber |
| `CONFIRMED` | Confirmed by doctor | blue |
| `DERMEE_CONFIRMED` | Confirmed by Dermee | green |
| `COMPLETED` | Completed | dark green |
| `CANCELLED` | Cancelled | grey |
| `REJECTED` | Rejected | grey |
| `NO_SHOW` | No-show | red outline |

**Urgency badges:**

| Level | Meaning | Colour |
|---|---|---|
| `OVERDUE` | The visit time passed and it was never fully confirmed. Needs immediate attention. | red, filled |
| `URGENT` | Within `urgentHours` (24 h by default) | red |
| `MEDIUM` | Within `mediumHours` (72 h by default) | orange |
| `NOT_URGENT` | Later than that | grey |
| `null` | Finished. Show no badge. | — |

- `needsOutcome: true` means the reservation was fully confirmed, the time has passed, and nobody has recorded Completed or No-show. Show it as "Record outcome".
- **Default sort (`priority`):** overdue first, then urgent and waiting for the doctor, then urgent and waiting for Dermee, then medium, and so on. Fully confirmed reservations come after all unconfirmed ones.

### Details: `GET /admin/reservations/:id`

Returns the `client` and `doctor` with their contact details and location, appointment times, `createdAt`, `statusChangedAt`, `meetLink`, `cancelReason`, `cancelledBy`, `urgency`, and:
- `history[]` (`fromLabel` → `toLabel`, `actor`, `note`, `createdAt`);
- `adminNotes[]` (`content`, `author`, `createdAt`);
- `allowedActions`.

**Admin actions.** Show only the ones listed in `allowedActions`:

| Action | Endpoint | When |
|---|---|---|
| Confirm on behalf of Dermee | `POST /admin/reservations/:id/confirm` `{ note? }` | After the doctor confirmed, before the visit |
| Mark completed | `POST /admin/reservations/:id/complete` `{ note? }` | After the visit time |
| Mark no-show | `POST /admin/reservations/:id/no-show` `{ note? }` | After the visit time |
| Cancel | `POST /admin/reservations/:id/cancel` `{ reason }` | Any time before it is finished. The patient and the doctor are notified. |
| Add note | `POST /admin/reservations/:id/notes` `{ content }` | Internal only. Never shown to the doctor or patient. |

Admins can't confirm or reject on the doctor's behalf: that step belongs to the doctor (`POST /appointments/:id/approve|reject`).

### Thresholds: `GET /admin/settings` and `PATCH /admin/settings`

Body: `{ urgentHours?, mediumHours?, defaultLowStockThreshold? }`. `mediumHours` must stay greater than `urgentHours`.

---

## 5. Notifications

`GET /notifications` lists the current user's notifications (`unreadOnly`, `type`, paging) and includes `unread`.

| Endpoint | Purpose |
|---|---|
| `GET /notifications/unread-count` | Count for the bell badge |
| `PATCH /notifications/:id/read` | Mark one as read |
| `POST /notifications/read-all` | Mark all as read |

**Live updates:** connect Socket.IO with `io(API_URL, { auth: { token } })` and listen for the `notification` event. The payload is the notification row. Use `link` to open the related page, for example `/admin/reservations/:id`.

**Types admins receive:**

| Type | When |
|---|---|
| `RESERVATION_PENDING_DOCTOR` | New booking awaiting the doctor |
| `RESERVATION_AWAITING_DERMEE` | The doctor confirmed |
| `RESERVATION_APPROACHING_UNCONFIRMED` | Within the urgent window and still unconfirmed. Checked every 10 minutes. |
| `RESERVATION_OVERDUE_UNCONFIRMED` | The visit time passed while unconfirmed |
| `DOCTOR_PENDING_APPROVAL` | A doctor signed up |
| `ORDER_PLACED` | New order |
| `LOW_STOCK` | A product crossed its alert level |

The scheduled checks never send the same alert twice for the same reservation.

---

## 6. Audit log: `GET /admin/audit-logs`

Filters: `actorId`, `action`, `entityType` (`User`, `Doctor`, `Product`, `Order`, `Appointment`, `ImpersonationSession`, `SystemSetting`), `entityId`, `from`/`to`.

Each row: `actorId`, `actorEmail`, `impersonatorId`, `action`, `entityType`, `entityId`, `before`, `after`, `metadata`, `ip`, `createdAt`. Passwords and tokens are never logged.

**Actions recorded:**

| Area | Actions |
|---|---|
| Doctor approval | `DOCTOR_APPROVED`, `DOCTOR_REJECTED`, `DOCTOR_RE_REVIEW` |
| Accounts | `USER_SUSPENDED`, `USER_REACTIVATED`, `USERS_EXPORTED` |
| Products and stock | `PRODUCT_CREATED`, `PRODUCT_UPDATED`, `PRODUCT_STATUS_CHANGED`, `PRODUCT_ARCHIVED`, `PRODUCT_DELETED`, `STOCK_ADJUSTED` |
| Orders | `ORDER_STATUS_CHANGED`, `ORDER_PAYMENT_STATUS_CHANGED`, `ORDER_DELIVERY_UPDATED` |
| Reservations | `RESERVATION_STATUS_CHANGED`, `RESERVATION_NOTE_ADDED` |
| Impersonation | `IMPERSONATION_STARTED`, `IMPERSONATION_ENDED` |
| Settings | `SETTINGS_UPDATED` |
| CLI | `ADMIN_CREATED`, `USER_PROMOTED_TO_ADMIN` |

The audit row is written in the same database transaction as the change, so a change is never saved without its audit entry.
