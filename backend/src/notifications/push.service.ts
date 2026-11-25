import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PushDevice, PushPlatform } from '@prisma/client';
import { createSign } from 'crypto';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

export interface PushMessage {
  notificationId: string;
  title: string;
  body: string;
  kind: string;
  reportId?: string | null;
  jobOrderId?: string | null;
  formId?: string | null;
  // web dashboard page to open when the browser notification is clicked
  url?: string | null;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

// Sends pushes to registered phones (Firebase Cloud Messaging, HTTP v1 API)
// and browsers (Web Push with VAPID). Each channel is off until its keys are
// configured; a failed push never affects the saved notification.
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private fcm: ServiceAccount | null = null;
  private fcmToken: { value: string; expires: number } | null = null;
  private webPush = false;
  readonly vapidPublicKey: string | null;

  constructor(private prisma: PrismaService, private config: ConfigService) {
    this.vapidPublicKey = this.config.get<string>('VAPID_PUBLIC_KEY')?.trim() || null;
  }

  onModuleInit() {
    const raw = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_BASE64')?.trim();
    if (raw) {
      try {
        const json = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as ServiceAccount;
        if (!json.project_id || !json.client_email || !json.private_key) throw new Error('missing fields');
        this.fcm = json;
        this.logger.log(`Phone push on (Firebase project "${json.project_id}")`);
      } catch (e) {
        this.logger.error(`FIREBASE_SERVICE_ACCOUNT_BASE64 is not a valid service-account key (${String(e)}); phone push is off`);
      }
    } else {
      this.logger.warn('Phone push is off: FIREBASE_SERVICE_ACCOUNT_BASE64 is not set');
    }

    const priv = this.config.get<string>('VAPID_PRIVATE_KEY')?.trim();
    const subject = this.config.get<string>('VAPID_SUBJECT')?.trim();
    if (this.vapidPublicKey && priv && subject) {
      try {
        webpush.setVapidDetails(subject, this.vapidPublicKey, priv);
        this.webPush = true;
        this.logger.log('Browser push on (Web Push)');
      } catch (e) {
        this.logger.error(`VAPID keys are not valid (${String(e)}); browser push is off`);
      }
    } else {
      this.logger.warn('Browser push is off: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are not all set');
    }
  }

  get status() {
    return { phone: this.fcm !== null, browser: this.webPush };
  }

  // delivers one notification to every device of one user
  async sendToUser(userId: string, msg: PushMessage) {
    const devices = await this.prisma.pushDevice.findMany({ where: { userId } });
    await Promise.allSettled(
      devices.map((d) => (d.platform === PushPlatform.WEB ? this.sendWeb(d, msg) : this.sendFcm(d, msg))),
    );
  }

  private async sendWeb(d: PushDevice, msg: PushMessage) {
    if (!this.webPush || !d.p256dh || !d.auth) return;
    try {
      await webpush.sendNotification(
        { endpoint: d.token, keys: { p256dh: d.p256dh, auth: d.auth } },
        JSON.stringify({ title: msg.title, body: msg.body, url: msg.url ?? '/', tag: msg.notificationId }),
        { TTL: 24 * 3600, urgency: 'normal' },
      );
    } catch (e: any) {
      // 404 / 410: the browser unsubscribed or the subscription expired
      if (e?.statusCode === 404 || e?.statusCode === 410) await this.forget(d.id);
      else this.logger.warn(`Browser push failed (${e?.statusCode ?? String(e)})`);
    }
  }

  private async sendFcm(d: PushDevice, msg: PushMessage) {
    if (!this.fcm) return;
    try {
      const token = await this.accessToken();
      const data: Record<string, string> = { notificationId: msg.notificationId, kind: msg.kind };
      if (msg.reportId) data.reportId = msg.reportId;
      if (msg.jobOrderId) data.jobOrderId = msg.jobOrderId;
      if (msg.formId) data.formId = msg.formId;
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.fcm.project_id)}/messages:send`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: d.token,
              notification: { title: msg.title, body: msg.body },
              data,
              android: { priority: 'HIGH', notification: { tag: msg.notificationId } },
              apns: { payload: { aps: { sound: 'default' } } },
            },
          }),
        },
      );
      if (res.ok) return;
      const text = await res.text();
      // the app was uninstalled or the token was replaced
      if (res.status === 404 || text.includes('UNREGISTERED') || (res.status === 400 && text.includes('registration token'))) {
        await this.forget(d.id);
      } else {
        this.logger.warn(`Phone push failed (${res.status}): ${text.slice(0, 200)}`);
      }
    } catch (e) {
      this.logger.warn(`Phone push failed: ${String(e)}`);
    }
  }

  private async forget(deviceId: string) {
    await this.prisma.pushDevice.deleteMany({ where: { id: deviceId } });
  }

  // OAuth access token for the FCM API from the service account (RS256 JWT),
  // cached until shortly before it expires
  private async accessToken(): Promise<string> {
    if (this.fcmToken && this.fcmToken.expires > Date.now() + 60_000) return this.fcmToken.value;
    const sa = this.fcm!;
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
    });
    if (!res.ok) throw new Error(`token request failed (${res.status})`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.fcmToken = { value: json.access_token, expires: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }
}
