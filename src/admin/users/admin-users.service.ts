import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AuditAction, AuditEntity } from '../../audit/audit-actions';
import type { Actor } from '../../common/request-user';
import { dateRangeFilter } from '../../common/dates';
import { paginate, resolveSort, skipTake } from '../../common/pagination';
import { CSV_BOM, csvRow, safeSheetValue } from '../../common/csv';
import { catchServiceError } from '../../utils/catch-service-error';
import { displayStatus } from '../accounts/account-status.service';
import type {
  AccountStatusFilter,
  AdminUsersQueryDto,
  ExportQueryDto,
} from './dto/admin-users-query.dto';

const EXPORT_MAX_ROWS = 50_000;
const EXPORT_BATCH = 1_000;

const userRowSelect = {
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  email: true,
  phoneNumber: true,
  role: true,
  status: true,
  createdAt: true,
  lastActivityAt: true,
  profilePictureUrl: true,
  address: { select: { state: true, city: true } },
  doctorProfile: {
    select: { id: true, approvalStatus: true, specialty: true },
  },
  patientProfile: { select: { id: true } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userRowSelect }>;

function statusWhere(status?: AccountStatusFilter): Prisma.UserWhereInput {
  switch (status) {
    case 'SUSPENDED':
      return { status: 'SUSPENDED' };
    case 'PENDING':
      return {
        status: 'ACTIVE',
        doctorProfile: { is: { approvalStatus: 'PENDING' } },
      };
    case 'REJECTED':
      return {
        status: 'ACTIVE',
        doctorProfile: { is: { approvalStatus: 'REJECTED' } },
      };
    case 'ACTIVE':
      return {
        status: 'ACTIVE',
        OR: [
          { role: 'PATIENT' },
          { doctorProfile: { is: { approvalStatus: 'APPROVED' } } },
        ],
      };
    default:
      return {};
  }
}

/** Filters shared by the table and the export, so an export is exactly what the admin sees. */
export function buildUsersWhere(q: AdminUsersQueryDto): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [
    { role: q.role ? q.role : { in: ['PATIENT', 'DOCTOR'] } },
    statusWhere(q.status),
  ];
  const createdAt = dateRangeFilter(q.from, q.to);
  if (createdAt) and.push({ createdAt });
  if (q.search?.trim()) {
    const term = q.search.trim();
    const contains = { contains: term, mode: 'insensitive' as const };
    and.push({
      OR: [
        { name: contains },
        { firstName: contains },
        { lastName: contains },
        { email: contains },
        // Phone numbers: also match without spaces, e.g. "0555 12 34" vs "055512 34".
        { phoneNumber: { contains: term.replace(/\s+/g, '') } },
        { phoneNumber: contains },
      ],
    });
  }
  if (q.wilaya?.trim()) {
    and.push({
      address: {
        is: { state: { contains: q.wilaya.trim(), mode: 'insensitive' } },
      },
    });
  }
  if (q.commune?.trim()) {
    and.push({
      address: {
        is: { city: { contains: q.commune.trim(), mode: 'insensitive' } },
      },
    });
  }
  return { AND: and };
}

export function mapUserRow(u: UserRow) {
  return {
    id: u.id,
    name: u.name,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    phoneNumber: u.phoneNumber,
    role: u.role,
    roleLabel: u.role === 'PATIENT' ? 'Client' : 'Doctor',
    /** Small text in the location column. */
    wilaya: u.address?.state ?? null,
    /** Large bold text under the wilaya. */
    commune: u.address?.city ?? null,
    createdAt: u.createdAt,
    lastActivityAt: u.lastActivityAt,
    profilePictureUrl: u.profilePictureUrl,
    specialty: u.doctorProfile?.specialty ?? null,
    patientId: u.patientProfile?.id ?? null,
    doctorId: u.doctorProfile?.id ?? null,
    accountStatus: displayStatus(
      u.status,
      u.role,
      u.doctorProfile?.approvalStatus,
    ),
  };
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private orderBy(
    q: AdminUsersQueryDto,
  ): Prisma.UserOrderByWithRelationInput[] {
    const dir = q.sortDir;
    const column = resolveSort<Prisma.UserOrderByWithRelationInput>(
      q.sortBy,
      {
        createdAt: { createdAt: dir },
        name: { name: dir },
        role: { role: dir },
        lastActivityAt: { lastActivityAt: { sort: dir, nulls: 'last' } },
      },
      'createdAt',
    );
    // id as tie-breaker keeps pages stable.
    return [column, { id: dir }];
  }

  async list(q: AdminUsersQueryDto) {
    try {
      const where = buildUsersWhere(q);
      const [total, rows] = await Promise.all([
        this.prisma.user.count({ where }),
        this.prisma.user.findMany({
          where,
          select: userRowSelect,
          orderBy: this.orderBy(q),
          ...skipTake(q.page, q.limit),
        }),
      ]);
      return paginate(rows.map(mapUserRow), total, q.page, q.limit);
    } catch (error) {
      catchServiceError(error);
    }
  }

  /**
   * Streams the filtered users as CSV or XLSX. Rows are read in batches with a cursor,
   * so memory stays flat whatever the size. Capped at 50k rows; every export is audited
   * because it contains personal data.
   */
  async export(q: ExportQueryDto, actor: Actor, res: Response) {
    const where = buildUsersWhere(q);
    const total = await this.prisma.user.count({ where });
    const rowsToExport = Math.min(total, EXPORT_MAX_ROWS);

    await this.audit.log(this.prisma, {
      actor,
      action: AuditAction.USERS_EXPORTED,
      entityType: AuditEntity.USER,
      metadata: {
        format: q.format,
        filters: { ...q, page: undefined, limit: undefined },
        rows: rowsToExport,
        total,
      },
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `dermee-users-${stamp}.${q.format}`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Total-Rows', String(total));
    res.setHeader('X-Exported-Rows', String(rowsToExport));

    const header = [
      'Full name',
      'First name',
      'Last name',
      'Role',
      'Phone',
      'Email',
      'Wilaya',
      'Commune',
      'Registered at',
      'Status',
      'Last activity',
    ];
    const toValues = (u: ReturnType<typeof mapUserRow>) => [
      u.name,
      u.firstName,
      u.lastName,
      u.roleLabel,
      u.phoneNumber,
      u.email,
      u.wilaya,
      u.commune,
      u.createdAt,
      u.accountStatus,
      u.lastActivityAt,
    ];

    if (q.format === 'xlsx') {
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
        stream: res,
        useStyles: true,
      });
      const ws = wb.addWorksheet('Users');
      ws.columns = header.map((h) => ({ header: h, width: 22 }));
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).commit();
      for await (const batch of this.batches(where, rowsToExport)) {
        for (const u of batch)
          ws.addRow(toValues(u).map(safeSheetValue)).commit();
      }
      ws.commit();
      await wb.commit();
      return;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.write(CSV_BOM + csvRow(header));
    for await (const batch of this.batches(where, rowsToExport)) {
      res.write(batch.map((u) => csvRow(toValues(u))).join(''));
    }
    res.end();
  }

  private async *batches(where: Prisma.UserWhereInput, max: number) {
    let cursor: string | undefined;
    let sent = 0;
    while (sent < max) {
      const rows = await this.prisma.user.findMany({
        where,
        select: userRowSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: Math.min(EXPORT_BATCH, max - sent),
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) return;
      sent += rows.length;
      cursor = rows[rows.length - 1].id;
      yield rows.map(mapUserRow);
    }
  }
}
