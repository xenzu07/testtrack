import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, Status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitSurveyDto } from './dto/submit-survey.dto';
import {
  EXPERIENCE_LEVELS,
  PROFICIENCY_LEVELS,
  SURVEY_VERSION,
  tasksFor,
} from './survey-definition';
import { QUALIFY_MIN_PROFICIENCY, QUALIFY_MIN_SCORE, scoreUnit } from './survey-scoring';

// what is stored in TechnicianSurvey.results
export interface SurveyResults {
  version: number;
  units: { tradeUnitId: string; name: string; score: number; qualified: boolean }[];
}

const roleSelect = {
  score: true,
  assignedAt: true,
  tradeUnit: { select: { id: true, name: true } },
} satisfies Prisma.TechnicianRoleSelect;

@Injectable()
export class TechniciansService {
  constructor(private prisma: PrismaService) {}

  private tradeUnits() {
    return this.prisma.tradeUnit.findMany({ orderBy: { name: 'asc' } });
  }

  // ---------------------------------------------------------------- survey

  // the questions plus the technician's current status (and last answers,
  // so a retake starts from what they said before)
  async getSurvey(userId: string) {
    const [units, user, last] = await Promise.all([
      this.tradeUnits(),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          surveyCompletedAt: true,
          tradeUnit: { select: { id: true, name: true } },
          technicianRoles: { select: roleSelect, orderBy: { score: 'desc' } },
        },
      }),
      this.prisma.technicianSurvey.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { answers: true },
      }),
    ]);
    if (!user) throw new NotFoundException('User not found');

    return {
      version: SURVEY_VERSION,
      proficiencyLevels: PROFICIENCY_LEVELS,
      experienceLevels: EXPERIENCE_LEVELS,
      rules: { minProficiency: QUALIFY_MIN_PROFICIENCY, minScore: QUALIFY_MIN_SCORE },
      units: units.map((u) => ({ id: u.id, name: u.name, tasks: tasksFor(u.name) })),
      status: {
        completedAt: user.surveyCompletedAt,
        primaryTradeUnit: user.tradeUnit,
        roles: user.technicianRoles,
        lastAnswers: last?.answers ?? null,
      },
    };
  }

  async submitSurvey(userId: string, dto: SubmitSurveyDto) {
    const units = await this.tradeUnits();

    // every trade unit answered exactly once, and nothing else
    const byUnit = new Map(dto.answers.map((a) => [a.tradeUnitId, a]));
    if (byUnit.size !== dto.answers.length) {
      throw new BadRequestException('Each trade unit can only be answered once');
    }
    const missing = units.filter((u) => !byUnit.has(u.id));
    if (missing.length) {
      throw new BadRequestException(
        `Please answer for every trade unit. Missing: ${missing.map((u) => u.name).join(', ')}`,
      );
    }
    if (byUnit.size !== units.length) {
      throw new BadRequestException('The survey contains an unknown trade unit');
    }

    // a double tap on "Submit" must not create two surveys
    const recent = await this.prisma.technicianSurvey.findFirst({
      where: { userId, createdAt: { gte: new Date(Date.now() - 10_000) } },
      select: { id: true },
    });
    if (recent) throw new ConflictException('Your survey was just submitted');

    // only known task ids are stored
    const answers = units.map((u) => {
      const a = byUnit.get(u.id)!;
      const known = new Set(tasksFor(u.name).map((t) => t.id));
      return {
        tradeUnitId: u.id,
        proficiency: a.proficiency,
        experience: a.proficiency === 0 ? 0 : a.experience,
        certified: a.proficiency === 0 ? false : a.certified,
        tasks: a.proficiency === 0 ? [] : [...new Set(a.tasks)].filter((t) => known.has(t)),
      };
    });

    const results: SurveyResults = {
      version: SURVEY_VERSION,
      units: units.map((u, i) => ({
        tradeUnitId: u.id,
        name: u.name,
        ...scoreUnit(answers[i], tasksFor(u.name).map((t) => t.id)),
      })),
    };
    const qualified = results.units.filter((r) => r.qualified);
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.technicianSurvey.create({
        data: {
          userId,
          answers: { version: SURVEY_VERSION, units: answers },
          results: results as unknown as Prisma.InputJsonValue,
        },
      }),
      // the latest survey replaces the previous set of roles
      this.prisma.technicianRole.deleteMany({ where: { userId } }),
      this.prisma.technicianRole.createMany({
        data: qualified.map((r) => ({
          userId,
          tradeUnitId: r.tradeUnitId,
          score: r.score,
          assignedAt: now,
        })),
      }),
      this.prisma.user.update({ where: { id: userId }, data: { surveyCompletedAt: now } }),
    ]);

    return {
      completedAt: now,
      results: results.units,
      roles: qualified.map((r) => ({ tradeUnit: { id: r.tradeUnitId, name: r.name }, score: r.score })),
    };
  }

  // coordinators/admins: a technician's latest survey with readable labels
  async surveyFor(technicianId: string) {
    const tech = await this.prisma.user.findUnique({
      where: { id: technicianId },
      select: {
        id: true,
        fullName: true,
        role: true,
        surveyCompletedAt: true,
        tradeUnit: { select: { id: true, name: true } },
        technicianRoles: { select: roleSelect, orderBy: { score: 'desc' } },
      },
    });
    if (!tech || tech.role !== Role.TECHNICIAN) throw new NotFoundException('Technician not found');

    const last = await this.prisma.technicianSurvey.findFirst({
      where: { userId: technicianId },
      orderBy: { createdAt: 'desc' },
    });
    const units = await this.tradeUnits();
    const nameOf = new Map(units.map((u) => [u.id, u.name]));

    let detail: unknown[] = [];
    if (last) {
      const answers = (last.answers as { units?: Record<string, unknown>[] }).units ?? [];
      const results = (last.results as unknown as SurveyResults).units ?? [];
      detail = results.map((r) => {
        const a = answers.find((x) => x.tradeUnitId === r.tradeUnitId) ?? {};
        const name = nameOf.get(r.tradeUnitId) ?? r.name;
        const checklist = tasksFor(name);
        const checked = new Set((a.tasks as string[] | undefined) ?? []);
        return {
          tradeUnitId: r.tradeUnitId,
          name,
          score: r.score,
          qualified: r.qualified,
          proficiency: PROFICIENCY_LEVELS[Number(a.proficiency ?? 0)]?.label ?? 'None',
          experience:
            Number(a.proficiency ?? 0) > 0
              ? (EXPERIENCE_LEVELS[Number(a.experience ?? 0)]?.label ?? null)
              : null,
          certified: Boolean(a.certified),
          tasks: checklist.filter((t) => checked.has(t.id)).map((t) => t.label),
          taskCount: checklist.length,
        };
      });
    }

    const primaryResult = tech.tradeUnit
      ? (detail as { tradeUnitId: string; qualified: boolean }[]).find(
          (d) => d.tradeUnitId === tech.tradeUnit!.id,
        )
      : undefined;

    return {
      technician: {
        id: tech.id,
        fullName: tech.fullName,
        primaryTradeUnit: tech.tradeUnit,
        surveyCompletedAt: tech.surveyCompletedAt,
        roles: tech.technicianRoles,
      },
      survey: last
        ? { submittedAt: last.createdAt, version: (last.results as { version?: number }).version ?? null, units: detail }
        : null,
      // the admin-assigned trade unit is not backed by the technician's own answers
      primaryNotQualified: Boolean(primaryResult && !primaryResult.qualified),
    };
  }

  // -------------------------------------------------------------- matching

  // A technician can take jobs for a trade unit when it is their assigned
  // (primary) unit OR the survey gave them that role. Technicians who have
  // not done the survey yet still match their primary unit, as before.
  qualifiedWhere(tradeUnitId: string): Prisma.UserWhereInput {
    return {
      OR: [{ tradeUnitId }, { technicianRoles: { some: { tradeUnitId } } }],
    };
  }

  async isQualified(technicianId: string, tradeUnitId: string) {
    const n = await this.prisma.user.count({
      where: { id: technicianId, ...this.qualifiedWhere(tradeUnitId) },
    });
    return n > 0;
  }

  // active technicians (optionally only those qualified for a trade unit),
  // with their roles and current workload
  async list(tradeUnitId?: string) {
    const technicians = await this.prisma.user.findMany({
      where: {
        role: Role.TECHNICIAN,
        isActive: true,
        ...(tradeUnitId ? this.qualifiedWhere(tradeUnitId) : {}),
      },
      select: {
        id: true,
        fullName: true,
        surveyCompletedAt: true,
        tradeUnit: { select: { id: true, name: true } },
        technicianRoles: { select: roleSelect, orderBy: { score: 'desc' } },
      },
      orderBy: { fullName: 'asc' },
    });

    const counts = await this.prisma.jobOrder.groupBy({
      by: ['technicianId', 'status'],
      where: { technicianId: { in: technicians.map((t) => t.id) } },
      _count: { _all: true },
    });

    return technicians.map((t) => {
      const mine = counts.filter((c) => c.technicianId === t.id);
      const n = (s: Status) => mine.find((c) => c.status === s)?._count._all ?? 0;
      const w = {
        assigned: n(Status.ASSIGNED),
        inProgress: n(Status.IN_PROGRESS),
        delayed: n(Status.DELAYED),
        awaitingVerification: n(Status.COMPLETED),
        closed: n(Status.CLOSED),
      };
      const { technicianRoles, ...rest } = t;
      const role = tradeUnitId
        ? technicianRoles.find((r) => r.tradeUnit.id === tradeUnitId)
        : undefined;
      return {
        ...rest,
        roles: technicianRoles,
        workload: { ...w, active: w.assigned + w.inProgress + w.delayed },
        // how this technician matches the requested trade unit
        match: tradeUnitId
          ? {
              primary: t.tradeUnit?.id === tradeUnitId,
              surveyScore: role?.score ?? null,
            }
          : undefined,
      };
    });
  }
}
