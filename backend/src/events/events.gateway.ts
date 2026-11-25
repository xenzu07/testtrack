import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Status } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { JWT_ALGORITHM, JwtPayload, resolveSessionUser } from '../auth/session';
import { corsOriginCheck } from '../common/cors';

// what the event is about, so apps can react (e.g. show the accept/decline
// prompt to a technician, or a toast to coordinators)
export type EventKind =
  | 'assignment.offered'
  | 'assignment.accepted'
  | 'assignment.declined'
  | 'assignment.withdrawn'
  | 'form.submitted'
  | 'form.updated';

export interface StatusChangedEvent {
  reportId: string;
  jobOrderId: string | null;
  status: Status;
  message: string;
  at: string;
  kind?: EventKind;
  // the technician an assignment event is about
  technicianId?: string;
}

@WebSocketGateway({ cors: { origin: corsOriginCheck } })
export class EventsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private jwt: JwtService, private prisma: PrismaService) {}

  // only clients with a valid, current session stay connected; the role used
  // for the room comes from the database, not from the (possibly stale) token
  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('Missing token');
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        algorithms: [JWT_ALGORITHM],
      });
      const user = await resolveSessionUser(this.prisma, payload);
      if (!user) throw new Error('Session no longer valid');
      await client.join(`user:${user.userId}`);
      await client.join(`role:${user.role}`);
    } catch {
      client.disconnect(true);
    }
  }

  // coordinators and admins see everything; others see only the users listed
  statusChanged(
    event: Omit<StatusChangedEvent, 'at'>,
    userIds: (string | null | undefined)[],
  ) {
    try {
      const rooms = new Set<string>(['role:COORDINATOR', 'role:ADMIN']);
      userIds.forEach((id) => {
        if (id) rooms.add(`user:${id}`);
      });
      const payload: StatusChangedEvent = { ...event, at: new Date().toISOString() };
      this.server.to([...rooms]).emit('report.statusChanged', payload);
    } catch (e) {
      // a failed notification must never break the saved change
      this.logger.warn(`Could not emit event: ${String(e)}`);
    }
  }

  // a new notification, only to its owner (every open tab / app of theirs)
  notification(userId: string, payload: unknown) {
    try {
      this.server.to(`user:${userId}`).emit('notification.new', payload);
    } catch (e) {
      this.logger.warn(`Could not emit notification: ${String(e)}`);
    }
  }
}
