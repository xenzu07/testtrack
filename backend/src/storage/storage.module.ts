import { Global, Module } from '@nestjs/common';
import { PhotoStorageService } from './photo-storage.service';
import { SignPhotoUrlsInterceptor } from './sign-photo-urls.interceptor';

@Global()
@Module({
  providers: [PhotoStorageService, SignPhotoUrlsInterceptor],
  exports: [PhotoStorageService, SignPhotoUrlsInterceptor],
})
export class StorageModule {}
