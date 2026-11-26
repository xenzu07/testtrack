import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, mergeMap } from 'rxjs';
import { PhotoStorageService } from './photo-storage.service';

// Turns stored photo paths into short-lived signed URLs on the way out.
// It runs after the route's guards and service checks, so a URL is only ever
// handed to a user who was already allowed to see that report or job.
@Injectable()
export class SignPhotoUrlsInterceptor implements NestInterceptor {
  constructor(private storage: PhotoStorageService) {}

  intercept(_ctx: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(mergeMap((data) => from(this.storage.signPhotoFields(data))));
  }
}
